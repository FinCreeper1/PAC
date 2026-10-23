import { json } from "./http.js";
import { adminCalendar } from "./admin-calendar.js";
import { tripSettings } from "./trip-settings.js";
import { configuration } from "./configuration.js";
import {
  importJourney,
  reserveTransitousSearch,
  TransitousPolicyError,
  prepareSearch,
  textJourney,
  SearchDetailsRequired,
} from "./journey-import.js";
import {
  openConfiguration,
  finishSetup,
  onboardingResponse,
} from "./onboarding.js";
import { missingSettings, setupResponse } from "./setup.js";
import { withCredit } from "./credit.js";
import {
  onRequest as authenticate,
  sign,
  safeEqual,
} from "./legacy/_middleware.js";
import * as materials from "./legacy/api/materials.js";
import { handleIdeas } from "./ideas.js";
import { NextcloudStorage, StorageConflict } from "./nextcloud.js";
import { onRequestGet as fileDownload } from "./legacy/api/files/[[path]].js";
import { onRequestGet as mapsToken } from "./legacy/api/apple-maps-token.js";
import "../public/shared/calendar-model.js";
import "../public/shared/calendar-export.js";
import seed from "../public/data/calendar.json" with { type: "json" };
import trip from "../public/data/trip.json" with { type: "json" };
import aliases from "../public/data/materials.json" with { type: "json" };
import journeys from "../public/data/journeys.json" with { type: "json" };
import { sessionMethods } from "./sessions.js";
import { parseStored, StoredDataError } from "./stored-data.js";
import { invoices } from "./invoices.js";
class PortalFailure extends Error {
  constructor(stage, cause) {
    super("Portal operation failed");
    this.stage = stage;
    if (Number.isInteger(cause?.status)) this.status = cause.status;
    this.reason =
      cause?.name === "TimeoutError"
        ? "timeout"
        : cause?.reason === "etag"
          ? "etag"
          : "response";
  }
}
const cookie = (name, value, age) =>
  `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
const redirect = (location, session) =>
  new Response(null, {
    status: 303,
    headers: { location, "set-cookie": session, "cache-control": "no-store" },
  });
const secret = (env) => env.CALENDAR_FEED_SECRET || env.ADMIN_PASSWORD;
const feedToken = (env) => sign("profilreise:calendar-feed:v1", secret(env));
const attachmentToken = (env, event, id) =>
  sign(`profilreise:calendar-attachment:v1:${event}:${id}`, secret(env));
function decodeHeader(request, name) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(atob(request.headers.get(name) || ""), (c) =>
        c.charCodeAt(0),
      ),
    );
  } catch {
    return "";
  }
}

// One object serializes writes; application data stays exclusively in Nextcloud.
export class Portal {
  constructor(state, env) {
    this.state = state;
    this.baseEnv = env;
    this.env = env;
    this.queue = Promise.resolve();
    this.cloud = env.cloudStorage || null;
    this.snapshots = { generation: 0, cache: null };
  }
  async fetch(request) {
    const readOnly = ["GET", "HEAD", "OPTIONS"].includes(request.method);
    const run = async () => {
      await this.loadConfiguration();
      // Every request owns its snapshot, credentials and adapter. Only writes
      // share a queue; slow uploads cannot block pages or independent reads.
      const context = Object.create(this);
      context.owner = this;
      context.env = this.env;
      context.cloud = this.cloud;
      context.currentSnapshot = undefined;
      context.cacheSnapshot = readOnly;
      context.snapshotGeneration = this.snapshots.generation;
      if (!readOnly) this.invalidateSnapshot();
      try {
        return await context.handle(request);
      } finally {
        if (!readOnly) this.invalidateSnapshot();
      }
    };
    const result = readOnly ? run() : this.queue.then(run);
    if (!readOnly) this.queue = result.catch(() => {});
    return result.catch((error) => {
      if (error instanceof StoredDataError)
        return json({ error: error.message, code: "stored_data_corrupt" }, 503);
      if (error instanceof StorageConflict)
        return json({ error: error.message }, 409);
      console.error("portal_request_failed", error.message);
      const diagnostic = {
        stage: error instanceof PortalFailure ? error.stage : "request",
        ...(Number.isInteger(error.status)
          ? { upstreamStatus: error.status }
          : {}),
        ...(error instanceof PortalFailure ? { reason: error.reason } : {}),
      };
      return json(
        {
          error: "Die Reise konnte nicht geladen werden.",
          code: "storage_unavailable",
          diagnostic,
        },
        502,
      );
    });
  }
  invalidateSnapshot() {
    this.snapshots.generation++;
    this.snapshots.cache = null;
  }
  configured() {
    return missingSettings(this.env, Boolean(this.cloud)).length === 0;
  }
  async loadConfiguration() {
    if (!this.configurationPromise) {
      this.configurationPromise = (async () => {
        const record = await this.state.storage.get("configuration:v1");
        if (record) {
          const config = await openConfiguration(
            record,
            this.baseEnv.PAC_SETUP_SECRET,
          );
          this.env = { ...config, ...this.baseEnv };
        }
      })().catch((error) => {
        this.configurationPromise = null;
        throw error;
      });
    }
    return this.configurationPromise;
  }
  async snapshot() {
    if (
      !this.currentSnapshot &&
      this.cacheSnapshot &&
      this.snapshots.cache?.expires > Date.now()
    )
      this.currentSnapshot = structuredClone(this.snapshots.cache.snapshot);
    if (!this.currentSnapshot) {
      let record;
      try {
        record = await this.cloud.readText("calendar:snapshot");
      } catch (error) {
        throw new PortalFailure("calendar-read", error);
      }
      let value;
      try {
        value =
          record.value === null
            ? {
                calendar: CalendarModel.normalize(seed, trip),
                trip,
                journeys,
                materials: aliases,
                routes: {},
              }
            : JSON.parse(record.value);
      } catch {
        throw new PortalFailure("calendar-parse");
      }
      if (
        !value ||
        !value.calendar ||
        !value.routes ||
        !value.trip ||
        !value.journeys ||
        !value.materials
      )
        throw new PortalFailure("calendar-shape");
      try {
        value.calendar = CalendarModel.normalize(value.calendar, value.trip);
      } catch {
        throw new PortalFailure("calendar-normalize");
      }
      this.currentSnapshot = { value, etag: record.etag };
      if (
        this.cacheSnapshot &&
        this.snapshotGeneration === this.snapshots.generation
      )
        this.snapshots.cache = {
          snapshot: structuredClone(this.currentSnapshot),
          expires: Date.now() + 5000,
        };
    }
    return this.currentSnapshot;
  }
  async calendar() {
    return (await this.snapshot()).value.calendar;
  }
  async route(ref) {
    return (await this.snapshot()).value.routes[ref + ".json"] || null;
  }
  async saveSnapshot(value) {
    const current = await this.snapshot();
    await this.cloud.writeText(
      "calendar:snapshot",
      JSON.stringify(value),
      current.etag,
    );
  }

  async revision(calendar) {
    return sign(JSON.stringify(calendar), "calendar-revision-v1");
  }
  storeAdapter() {
    return {
      list: (options) => this.cloud.list(options),
      getWithMetadata: (key, type) => this.cloud.getWithMetadata(key, type),
      put: (key, value, options) =>
        this.cloud.putFile(key, value, options.metadata),
      delete: (key) => this.cloud.delete(key),
    };
  }
  async handle(request) {
    const env = this.env,
      url = new URL(request.url),
      path = url.pathname,
      method = request.method;
    // Probe the running Portal object, not just the newly deployed outer Worker.
    if (path === "/api/version" && method === "GET")
      return json({ version: this.baseEnv.PAC_VERSION || "source" });
    if (path === "/api/setup") return finishSetup(request, this);
    if (path === "/api/setup/check") return finishSetup(request, this, true);
    if (path === "/setup" || path === "/setup.js") {
      if (!["GET", "HEAD"].includes(method))
        return json({ error: "Methode nicht erlaubt." }, 405);
      if (this.configured())
        return new Response(null, {
          status: 303,
          headers: { location: "/", "cache-control": "no-store" },
        });
      if (
        typeof this.baseEnv.PAC_SETUP_SECRET === "string" &&
        this.baseEnv.PAC_SETUP_SECRET.length >= 32
      )
        return onboardingResponse(request);
    }
    const missing = missingSettings(env, Boolean(this.cloud));
    if (missing.length) {
      if (
        this.baseEnv.PAC_SETUP_SECRET?.length >= 32 &&
        !path.startsWith("/api/")
      )
        return new Response(null, {
          status: 303,
          headers: { location: "/setup", "cache-control": "no-store" },
        });
      return setupResponse(request, missing);
    }
    try {
      this.cloud ||= new NextcloudStorage(env);
    } catch {
      return setupResponse(request, [], true);
    }
    if (
      !["GET", "HEAD", "OPTIONS"].includes(method) &&
      request.headers.get("origin") &&
      request.headers.get("origin") !== url.origin
    )
      return json({ error: "Fremder Ursprung." }, 403);
    const session = await this.adminSession(request);
    if (path === "/admin/login" && method === "POST") {
      const body = await request.formData();
      if (!safeEqual(String(body.get("password") || ""), env.ADMIN_PASSWORD))
        return this.adminLogin(request, true);
      const id = crypto.randomUUID(),
        csrf = crypto.randomUUID();
      const now = Date.now(),
        stale = [
          ...(
            (await this.state.storage.list?.({ prefix: "session:" })) ??
            new Map()
          ).entries(),
        ]
          .filter(([, v]) => !v || v.expires < now)
          .map(([k]) => k);
      for (let i = 0; i < stale.length; i += 128)
        await this.state.storage.delete(stale.slice(i, i + 128));
      await this.state.storage.put(`session:${id}`, {
        csrf,
        expires: now + 7200000,
        credential: await this.adminCredential(),
      });
      return redirect("/admin", cookie("profilreise_admin", id, 7200));
    }
    if (path.startsWith("/admin") || path.startsWith("/api/admin/")) {
      if (!session)
        return path.startsWith("/api/")
          ? json({ error: "Bitte erneut anmelden." }, 401)
          : this.adminLogin(request);
      if (
        !["GET", "HEAD"].includes(method) &&
        !safeEqual(request.headers.get("x-csrf-token") || "", session.csrf)
      )
        return json(
          { error: "Ungültiger Sitzungsschlüssel.", code: "csrf_invalid" },
          403,
        );
      if (path === "/admin/logout" && method === "POST") {
        await this.state.storage.delete(`session:${session.id}`);
        return redirect("/admin", cookie("profilreise_admin", "", 0));
      }
      if (path === "/api/admin/sessions/revoke" && method === "POST") {
        await this.revokeSessions();
        const response = json({ revoked: true, reauthenticate: true });
        response.headers.set("set-cookie", cookie("profilreise_admin", "", 0));
        response.headers.append(
          "set-cookie",
          cookie("profilreise_session", "", 0),
        );
        return response;
      }
      if (path === "/api/admin/session" && method === "GET") {
        // Only extend once half of the lifetime is used, so polling does not write on every check.
        if (session.expires - Date.now() < 3600000)
          await this.state.storage.put(`session:${session.id}`, {
            csrf: session.csrf,
            expires: Date.now() + 7200000,
            credential: session.credential,
          });
        const response = json({ authenticated: true });
        response.headers.set(
          "set-cookie",
          cookie("profilreise_admin", session.id, 7200),
        );
        return response;
      }
      if (path === "/api/admin/invoice-budget") {
        const record = await this.cloud.readText("invoices:budget");
        const current = parseStored(record.value, {
          budgetCents: null,
          students: null,
        });
        const revision = await this.revision(current);
        if (method === "GET")
          return json({ ...current, revision, csrf: session.csrf });
        if (method !== "PUT")
          return json({ error: "Methode nicht erlaubt." }, 405);
        const text = await request.text();
        if (text.length > 1024) return json({ error: "Eingabe zu groß." }, 413);
        let body;
        try {
          body = JSON.parse(text);
        } catch {
          return json({ error: "Ungültige Eingabe." }, 400);
        }
        if (
          !(
            body.budgetCents === null ||
            (Number.isSafeInteger(body.budgetCents) &&
              body.budgetCents >= 0 &&
              body.budgetCents <= 9999999999)
          ) ||
          !(
            body.students === null ||
            (Number.isSafeInteger(body.students) &&
              body.students > 0 &&
              body.students <= 100000)
          )
        )
          return json(
            { error: "Budget und Schülerzahl bitte gültig eingeben." },
            400,
          );
        if (body.revision !== revision)
          return json(
            {
              error:
                "Das Budget wurde inzwischen geändert. Bitte Rechnungen neu öffnen.",
            },
            409,
          );
        const next = { budgetCents: body.budgetCents, students: body.students };
        await this.cloud.writeText(
          "invoices:budget",
          JSON.stringify(next),
          record.etag,
        );
        return json({ ...next, revision: await this.revision(next) });
      }
      if (
        path === "/api/admin/invoices" ||
        path.startsWith("/api/admin/invoices/")
      )
        return this.invoices(request, session);
      if (path === "/api/admin/configuration")
        return configuration.call(this, request, session);
      if (path === "/api/admin/settings")
        return tripSettings.call(this, request, session);
      if (path === "/api/admin/calendar")
        return adminCalendar.call(this, request, session);
      if (path === "/api/admin/journey-import" && method === "POST") {
        const text = await request.text();
        if (text.length > 24000)
          return json({ error: "Eingefügter Text zu lang." }, 413);
        try {
          const body = JSON.parse(text),
            timeZone =
              (await this.snapshot()).value.trip.timeZone || "Europe/Berlin";
          const transitousConfig = {
            TRANSITOUS_USAGE_CONFIRMED: "true",
            TRANSITOUS_CONTACT: "https://github.com/FinCreeper1/PAC",
            ...env,
          };
          const own =
            typeof body.url === "string" && textJourney(body.url, timeZone);
          let reserved = false;
          try {
            const prepared = prepareSearch(body.url, body.search, timeZone);
            const cacheKey = JSON.stringify([
              prepared.origin,
              prepared.destination,
              prepared.date,
              prepared.time,
              timeZone,
            ]);
            const cached = await this.state.storage.get(
              "journey-search:last:v1",
            );
            if (
              cached?.key === cacheKey &&
              Date.now() - cached.at < 60000 &&
              cached.at <= Date.now()
            )
              return json(cached.result);
            await reserveTransitousSearch(this.state.storage, transitousConfig);
            reserved = true;
            const result = {
              ...(await importJourney(
                body.url,
                fetch,
                body.search,
                timeZone,
                transitousConfig,
              )),
              recommended: null,
            };
            await this.state.storage.put("journey-search:last:v1", {
              key: cacheKey,
              at: Date.now(),
              result,
            });
            return json(result);
          } catch (error) {
            if (!own || error.status === 429) throw error;
            const reason =
              error.name === "TimeoutError"
                ? "Transitous hat nicht rechtzeitig geantwortet."
                : error.message;
            return json({
              choices: [own],
              recommended: null,
              source: "text",
              retryAfter: reserved ? 60 : 0,
              warning: `${reason} Als Ersatz stehen nur die Angaben aus deinem Text bereit.`,
            });
          }
        } catch (error) {
          return json(
            {
              error:
                error.name === "TimeoutError"
                  ? "Die Fahrplan-API antwortet gerade nicht. Bitte erneut versuchen."
                  : error.message,
              requiresSearch: error instanceof SearchDetailsRequired,
              detected: error.detected,
              retryAfter: error.retryAfter,
            },
            error instanceof TransitousPolicyError
              ? error.status
              : error instanceof SearchDetailsRequired
                ? 422
                : 400,
          );
        }
      }
      if (path === "/api/admin/place-search" && method === "GET")
        return this.placeSearch(url);
      if (path.startsWith("/api/"))
        return json({ error: "Nicht gefunden." }, 404);
      if (!["GET", "HEAD"].includes(method))
        return json({ error: "Methode nicht erlaubt." }, 405);
      return this.asset(
        request,
        path === "/admin" || path === "/admin/" ? "/admin/index.html" : path,
      );
    }
    if (path === "/calendar.ics") {
      if (method !== "GET" && method !== "HEAD")
        return json({ error: "Methode nicht erlaubt." }, 405);
      if (!safeEqual(url.searchParams.get("token") || "", await feedToken(env)))
        return json({ error: "Ungültiger Token." }, 401);
      return this.feed(request);
    }
    const attachment =
      /^\/calendar-attachment\/([a-z0-9-]+)\/([a-f0-9-]+)\/([a-f0-9]+)\//.exec(
        path,
      );
    if (attachment) {
      if (!["GET", "HEAD"].includes(method))
        return json({ error: "Methode nicht erlaubt." }, 405);
      if (
        !safeEqual(
          attachment[3],
          await attachmentToken(env, attachment[1], attachment[2]),
        )
      )
        return json({ error: "Ungültiger Token." }, 401);
      return this.download(request, attachment[1], attachment[2]);
    }
    if (session && path.startsWith("/data/routes/")) {
      const route = await this.route(
        path
          .split("/")
          .at(-1)
          .replace(/\.json$/, ""),
      );
      if (route) return json(route);
    }
    if (
      session &&
      (path.startsWith("/shared/") ||
        path.startsWith("/data/routes/") ||
        path === "/api/apple-maps-token")
    )
      return path.startsWith("/api/")
        ? mapsToken({ env })
        : this.asset(request, path);
    return authenticate({
      request,
      env: {
        ...env,
        SESSION_SECRET: await this.participantCredential(),
        getPortalTrip: async () => (await this.snapshot()).value.trip,
      },
      next: () => this.portal(request),
    });
  }
  async adminLogin(request, error = false) {
    // Reuse the existing login page, including its escaping and visual design.
    const page = await authenticate({
      request: new Request(new URL("/", request.url)),
      env: {
        ...this.env,
        getPortalTrip: async () => (await this.snapshot()).value.trip,
      },
      next: () => new Response(),
    });
    return new Response(
      (await page.text())
        .replace('action="/__login"', 'action="/admin/login"')
        .replace("Kalender öffnen", "Admin öffnen")
        .replace(
          'href="/admin">Zum Admin-Login</a>',
          'href="/">Zum normalen Login</a>',
        )
        .replace(
          "Dieser Kalender ist nur für Teilnehmende zugänglich.",
          error
            ? "Das Adminpasswort ist nicht richtig."
            : "Mit dem Passwort für die Reiseleitung anmelden.",
        ),
      {
        status: error ? 401 : 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        },
      },
    );
  }
  async asset(request, path = new URL(request.url).pathname) {
    const response = await this.env.ASSETS.fetch(
      new Request(new URL(path, request.url), {
        method: request.method === "HEAD" ? "HEAD" : "GET",
      }),
    );
    const result = new Response(response.body, response);
    result.headers.set("cache-control", "private, no-store");
    return result;
  }
  async context(request) {
    const calendar = await this.calendar(),
      snapshot = (await this.snapshot()).value;
    return {
      request,
      env: {
        ...this.env,
        MATERIALS: this.storeAdapter(),
        eventStorage: async () => (id) =>
          calendar.events.some((e) => e.id === id)
            ? snapshot.materials[id] || id
            : null,
      },
    };
  }
  async download(request, event, id) {
    const context = await this.context(request);
    const response = await fileDownload({
      ...context,
      params: { path: [event, id] },
    });
    if (request.method === "HEAD") return new Response(null, response);
    return response;
  }
  async portal(request) {
    const url = new URL(request.url),
      path = url.pathname,
      method = request.method;
    // Authenticated page and static asset requests never need a WebDAV snapshot.
    if (!path.startsWith("/api/") && !path.startsWith("/data/")) {
      if (!["GET", "HEAD"].includes(method))
        return json({ error: "Methode nicht erlaubt." }, 405);
      return this.asset(request, path === "/" ? "/index.html" : path);
    }
    const context =
      path === "/api/materials"
        ? await this.context(request)
        : { request, env: this.env };
    if (path === "/data/calendar.json") return json(await this.calendar());
    const dataFile = /^\/data\/(trip|journeys|materials)\.json$/.exec(path);
    if (dataFile) return json((await this.snapshot()).value[dataFile[1]]);
    if (path.startsWith("/data/routes/")) {
      const route = await this.route(
        path
          .split("/")
          .at(-1)
          .replace(/\.json$/, ""),
      );
      if (route) return json(route);
    }
    if (path === "/api/calendar-subscription" && method === "GET")
      return json({
        path: "/calendar.ics?token=" + (await feedToken(this.env)),
      });
    if (path === "/api/apple-maps-token" && method === "GET")
      return mapsToken(context);
    if (path === "/api/ideas")
      return handleIdeas(
        request,
        this.cloud,
        (await this.snapshot()).value,
        this.env,
      );
    if (path === "/api/notes") {
      if (method !== "GET")
        return json(
          { error: "Notizen werden mit dem Kalender veröffentlicht." },
          403,
        );
      const event = (await this.calendar()).events.find(
        (e) => e.id === url.searchParams.get("event"),
      );
      if (!event) return json({ error: "Unbekannter Termin." }, 400);
      const legacy =
        event.note == null
          ? (await this.cloud.readText("note:" + event.id)).value
          : null;
      return json({ note: event.note ?? legacy ?? "" });
    }
    if (path === "/api/shared-note") return this.sharedNote(request);
    if (path === "/api/offline-manifest" && method === "GET")
      return json(await this.manifest());
    if (path === "/api/materials") {
      if (method === "PUT") {
        const project = url.searchParams.get("project") || "",
          storageKey = (await context.env.eventStorage())(project);
        if (!storageKey) return json({ error: "Unbekannter Termin." }, 400);
        if (
          !safeEqual(
            decodeHeader(request, "x-portal-password"),
            this.env.PORTAL_PASSWORD,
          )
        )
          return json({ error: "Das Passwort ist nicht richtig." }, 401);
        const password = decodeHeader(request, "x-delete-password"),
          name = decodeHeader(request, "x-file-name");
        if (!password || password.length > 128 || !name || !request.body)
          return json(
            { error: "Dateiname und Löschpasswort erforderlich." },
            400,
          );
        const rawSize = request.headers.get("content-length"),
          expectedSize =
            rawSize !== null && /^\d+$/.test(rawSize)
              ? Number(rawSize)
              : undefined;
        if (
          typeof FixedLengthStream === "function" &&
          !Number.isSafeInteger(expectedSize)
        )
          return json(
            {
              error:
                "Die Dateigröße fehlt. Bitte die Datei erneut als vollständige Datei hochladen.",
            },
            411,
          );
        const id = crypto.randomUUID(),
          metadata = {
            name: materials.safeFilename(name),
            type: "application/octet-stream",
            uploadedAt: new Date().toISOString(),
            ...(await materials.createDeletePasswordData(password)),
          };
        const object = await this.cloud.putFile(
          `${storageKey}/${id}`,
          request.body,
          metadata,
          expectedSize,
        );
        return json(
          {
            file: {
              id,
              name: metadata.name,
              type: metadata.type,
              size: object.size,
              uploadedAt: metadata.uploadedAt,
            },
          },
          201,
        );
      }
      const handler =
        materials[
          {
            GET: "onRequestGet",
            POST: "onRequestPost",
            DELETE: "onRequestDelete",
          }[method]
        ];
      return handler
        ? handler(context)
        : json({ error: "Methode nicht erlaubt." }, 405);
    }
    const file = /^\/api\/files\/([a-z0-9-]+)\/([a-f0-9-]+)$/.exec(path);
    if (file && ["GET", "HEAD"].includes(method))
      return this.download(request, file[1], file[2]);
    if (path.startsWith("/api/"))
      return json({ error: "Nicht gefunden." }, 404);
    if (!["GET", "HEAD"].includes(method))
      return json({ error: "Methode nicht erlaubt." }, 405);
    return this.asset(request, path === "/" ? "/index.html" : path);
  }
  invoices(request, session) {
    return invoices.call(this, request, session);
  }
  async sharedNote(request) {
    const method = request.method;
    if (!["GET", "PUT"].includes(method))
      return json({ error: "Methode nicht erlaubt." }, 405);
    const body = method === "PUT" ? await request.json() : {},
      id = body.event || new URL(request.url).searchParams.get("event");
    if (!(await this.calendar()).events.some((e) => e.id === id))
      return json({ error: "Unbekannter Termin." }, 400);
    const key = `shared-note:${id}`,
      record = await this.cloud.readText(key),
      current = parseStored(record.value, {
        text: "",
        revision: 0,
        updatedAt: null,
      });
    if (method === "GET") return json(current);
    if (typeof body.text !== "string" || body.text.length > 10000)
      return json({ error: "Notiz zu lang." }, 400);
    if (
      body.baseRevision !== current.revision &&
      body.text !== current.text &&
      body.baseText !== current.text
    )
      return json({ ...current, conflict: true }, 409);
    const next = {
      text: body.text,
      revision: current.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    await this.cloud.writeText(key, JSON.stringify(next), record.etag);
    return json(next);
  }
  async manifest() {
    const calendar = await this.calendar(),
      files = [],
      store = this.storeAdapter(),
      snapshot = (await this.snapshot()).value;
    for (const event of calendar.events) {
      let cursor;
      do {
        const page = await store.list({
          prefix: `${snapshot.materials[event.id] || event.id}/`,
          cursor,
        });
        for (const entry of page.keys)
          if (entry.metadata) {
            const { name, type, size, uploadedAt } = entry.metadata,
              id = entry.name.split("/").at(-1);
            files.push({
              event: event.id,
              id,
              name,
              type,
              size,
              uploadedAt,
              day: event.day,
              isoDate: calendar.days[event.day - 1].isoDate,
              title: event.title,
              url: `/api/files/${event.id}/${id}`,
              materialsUrl: `/api/materials?project=${event.id}`,
            });
          }
        cursor = page.cursor;
      } while (cursor);
    }
    return {
      generatedAt: new Date().toISOString(),
      days: calendar.days,
      files,
    };
  }
  async feed(request) {
    const calendar = await this.calendar(),
      manifest = await this.manifest(),
      url = new URL(request.url);
    const events = await Promise.all(
      calendar.events.map(async (event) =>
        CalendarExport.calendarExportEvent(
          {
            ...event,
            url: url.origin,
            attachments: await Promise.all(
              manifest.files
                .filter((f) => f.event === event.id)
                .map(async (f) => ({
                  ...f,
                  url: `${url.origin}/calendar-attachment/${event.id}/${f.id}/${await attachmentToken(this.env, event.id, f.id)}/${encodeURIComponent(f.name)}`,
                })),
            ),
          },
          calendar,
        ),
      ),
    );
    const text = CalendarExport.buildCalendarFile(
      events,
      new Date(calendar.publishedAt || "2026-10-14T00:00:00Z"),
    );
    const etag = '"' + (await this.revision(text)) + '"';
    return new Response(
      request.method === "HEAD" || request.headers.get("if-none-match") === etag
        ? null
        : text,
      {
        status: request.headers.get("if-none-match") === etag ? 304 : 200,
        headers: {
          "content-type": "text/calendar; charset=utf-8",
          "cache-control": "private, no-cache",
          etag,
        },
      },
    );
  }
  async placeSearch(url) {
    const query = (url.searchParams.get("q") || "").trim();
    if (!query || query.length > 200)
      return json({ error: "Bitte einen Ort eingeben." }, 400);
    const key = `places:${query.toLowerCase()}`,
      cached = await this.state.storage.get(key);
    if (cached && cached.expires > Date.now())
      return json({ places: cached.places });
    // Reserve only the service's shared request budget, without queuing reads
    // behind the external network call or behind unrelated portal writes.
    const owner = this.owner;
    const reserved = (owner.placeQueue || Promise.resolve()).then(async () => {
      const last = (await this.state.storage.get("place-search-last")) || 0;
      if (Date.now() - last < 1100) return false;
      await this.state.storage.put("place-search-last", Date.now());
      return true;
    });
    owner.placeQueue = reserved.catch(() => {});
    if (!(await reserved))
      return json({ error: "Bitte einen Moment warten." }, 429);
    const response = await fetch(
      "https://nominatim.openstreetmap.org/search?" +
        new URLSearchParams({
          q: query,
          format: "jsonv2",
          limit: "6",
          "accept-language": "de",
        }),
      {
        headers: { "user-agent": "Profilreise-Ortssuche/1.0" },
        signal: AbortSignal.timeout(12000),
      },
    );
    if (!response.ok)
      return json({ error: "Ortssuche derzeit nicht verfügbar." }, 502);
    const places = (await response.json())
      .filter(
        (row) =>
          Number.isFinite(Number(row.lat)) && Number.isFinite(Number(row.lon)),
      )
      .map((row) => ({
        name: row.display_name,
        formattedAddress: row.display_name,
        coordinate: { latitude: Number(row.lat), longitude: Number(row.lon) },
      }));
    await this.state.storage.put(key, {
      places,
      expires: Date.now() + 604800000,
    });
    return json({ places });
  }
}
Object.assign(Portal.prototype, sessionMethods);

export default {
  async fetch(request, env) {
    const response = await env.PORTAL.get(
      env.PORTAL.idFromName("portal-v1"),
    ).fetch(request);
    const result = new Response(
      request.method === "HEAD" ? null : response.body,
      response,
    );
    result.headers.set("x-content-type-options", "nosniff");
    result.headers.set("x-frame-options", "DENY");
    result.headers.set("referrer-policy", "strict-origin-when-cross-origin");
    return withCredit(result);
  },
};
