// Local HTTP fixture only: application requests use the real WebDAV adapter,
// whose upstream is an in-memory server. No production credentials or network.
import worker, { Portal as BasePortal } from "../src/index.js";
import { mockWebdav } from "./helpers/webdav.mjs";
export class Portal extends BasePortal {
  constructor(state, env) {
    const webdav = mockWebdav();
    super(state, {
      ...env,
      ...webdav.env,
      cloudStorage: webdav.cloud,
      PORTAL_PASSWORD: "runtime-participant",
      ADMIN_PASSWORD: "runtime-admin",
      SESSION_SECRET: "runtime-only-session-secret-not-for-production",
      CALENDAR_FEED_SECRET:
        "runtime-only-calendar-feed-secret-not-for-production",
      PAC_VERSION: "runtime-test",
    });
    const slow = { started: false, release: null };
    this.slow = slow;
    const put = webdav.cloud.putFile.bind(webdav.cloud);
    webdav.cloud.putFile = async (...args) => {
      if (args[2].name === "runtime-slow.bin") {
        slow.started = true;
        await new Promise((resolve) => {
          slow.release = resolve;
        });
      }
      return put(...args);
    };
  }
  async handle(request) {
    // Test control exists only in this fixture, never in a production Worker.
    const path = new URL(request.url).pathname;
    if (path === "/__test/upload-status")
      return Response.json({ started: this.slow.started });
    if (path === "/__test/release-upload") {
      this.slow.release?.();
      return Response.json({ released: true });
    }
    return super.handle(request);
  }
}
export default worker;
