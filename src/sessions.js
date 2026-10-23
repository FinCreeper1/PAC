import { sign, safeEqual } from "./legacy/_middleware.js";

export const sessionMethods = {
  async sessionEpoch() {
    return (await this.state.storage.get("sessions:epoch")) || "initial";
  },
  async participantCredential() {
    return sign(
      JSON.stringify([
        "participant-v2",
        this.env.PORTAL_PASSWORD,
        await this.sessionEpoch(),
      ]),
      this.env.SESSION_SECRET,
    );
  },
  async adminCredential() {
    return sign(
      JSON.stringify([
        "admin-v2",
        this.env.ADMIN_PASSWORD,
        await this.sessionEpoch(),
      ]),
      this.env.SESSION_SECRET,
    );
  },
  async adminSession(request) {
    const raw = (request.headers.get("cookie") || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("profilreise_admin="))
      ?.slice("profilreise_admin=".length);
    if (!raw) return null;
    const session = await this.state.storage.get(`session:${raw}`);
    if (
      !session ||
      session.expires < Date.now() ||
      !safeEqual(session.credential || "", await this.adminCredential())
    )
      return null;
    return { ...session, id: raw };
  },
  async revokeSessions() {
    // Persist the epoch first: even a concurrently renewed old session is invalid.
    await this.state.storage.put("sessions:epoch", crypto.randomUUID());
    const rows = await this.state.storage.list({ prefix: "session:" });
    for (const key of rows.keys()) await this.state.storage.delete(key);
  },
};
