import { sealConfiguration, validateSetup, probe } from "./onboarding.js";
import { NextcloudStorage } from "./nextcloud.js";
import { json } from "./http.js";

export async function configuration(request, session) {
  const env = this.env,
    method = request.method,
    url = new URL(request.url);
  const keys = ["NEXTCLOUD_WEBDAV_URL", "NEXTCLOUD_USERNAME", "NEXTCLOUD_ROOT"];
  const editable =
    typeof this.baseEnv.PAC_SETUP_SECRET === "string" &&
    this.baseEnv.PAC_SETUP_SECRET.length >= 32;
  const revision = await this.revision(this.env);
  if (method === "GET")
    return json({
      values: Object.fromEntries(keys.map((key) => [key, env[key] || ""])),
      editable,
      revision,
      csrf: session.csrf,
      domain: url.hostname,
    });
  if (method !== "PUT") return json({ error: "Methode nicht erlaubt." }, 405);
  if (!editable)
    return json(
      {
        error:
          "Diese Installation verwaltet Zugangsdaten über Cloudflare Variables and Secrets.",
      },
      409,
    );
  const raw = await request.text();
  if (raw.length > 16384) return json({ error: "Eingabe zu groß." }, 413);
  let body, config;
  try {
    body = JSON.parse(raw);
    if (body.revision !== revision)
      return json(
        { error: "Konfiguration inzwischen geändert. Bitte neu laden." },
        409,
      );
    const merged = { ...env };
    for (const key of [
      ...keys,
      "PORTAL_PASSWORD",
      "ADMIN_PASSWORD",
      "NEXTCLOUD_APP_PASSWORD",
    ]) {
      if (typeof body[key] !== "string")
        throw Error("Ungültige Konfiguration.");
      if (body[key]) {
        if (this.baseEnv[key] !== undefined && body[key] !== env[key])
          throw Error(
            key + " wird über Cloudflare verwaltet. Bitte dort ändern.",
          );
        merged[key] = body[key];
      }
    }
    config = validateSetup({
      ...merged,
      confirmPortal: body.PORTAL_PASSWORD
        ? body.confirmPortal
        : merged.PORTAL_PASSWORD,
      confirmAdmin: body.ADMIN_PASSWORD
        ? body.confirmAdmin
        : merged.ADMIN_PASSWORD,
    });
    config.SESSION_SECRET = env.SESSION_SECRET;
    config.CALENDAR_FEED_SECRET = env.CALENDAR_FEED_SECRET;
  } catch (error) {
    return json({ error: error.message }, 400);
  }
  try {
    await (this.baseEnv.probeSetupStorage || probe)(config);
  } catch {
    return json(
      {
        error:
          "Wolke nicht erreichbar oder nicht beschreibbar. Konfiguration wurde nicht geändert.",
      },
      422,
    );
  }
  // Switching storage must never silently seed a fresh trip or lose existing files.
  if (keys.some((key) => config[key] !== env[key])) {
    try {
      const target = new NextcloudStorage(config);
      const record = await target.readText("calendar:snapshot");
      const saved = JSON.parse(record.value);
      if (saved.trip.id !== (await this.snapshot()).value.trip.id)
        throw Error();
    } catch {
      return json(
        {
          error:
            "Der neue Wolke-Zugang muss dieselbe vorhandene Reise enthalten. Kopiere zuvor den vollständigen Reiseordner.",
        },
        409,
      );
    }
  }
  await this.state.storage.put(
    "configuration:v1",
    await sealConfiguration(config, this.baseEnv.PAC_SETUP_SECRET),
  );
  this.env = { ...config, ...this.baseEnv };
  this.cloud = this.baseEnv.cloudStorage || null;
  this.owner.env = this.env;
  this.owner.cloud = this.cloud;
  this.invalidateSnapshot();
  const reauthenticate =
    config.PORTAL_PASSWORD !== env.PORTAL_PASSWORD ||
    config.ADMIN_PASSWORD !== env.ADMIN_PASSWORD;
  if (reauthenticate) await this.revokeSessions();
  return json({
    saved: true,
    reauthenticate,
    revision: await this.revision(this.env),
  });
}
