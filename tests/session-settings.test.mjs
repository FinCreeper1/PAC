import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
const source = readFileSync(
  new URL("../public/admin/settings.js", import.meta.url),
  "utf8",
);
function fixture({ confirm = true, ok = true } = {}) {
  const nodes = new Map(),
    calls = [],
    destinations = [];
  const node = (key) => {
    if (!nodes.has(key))
      nodes.set(key, {
        events: {},
        elements: {},
        disabled: false,
        querySelectorAll: () => [],
        addEventListener(name, fn) {
          this.events[name] = fn;
        },
      });
    return nodes.get(key);
  };
  const context = vm.createContext({
    $: node,
    csrf: "test-csrf",
    sessionExpired: false,
    window: { confirm: () => confirm },
    location: { assign: (target) => destinations.push(target) },
    FormData: class {
      *[Symbol.iterator]() {
        yield ["PORTAL_PASSWORD", "new-password"];
      }
    },
    adminFetch: async (url, options) => {
      calls.push({ url, options });
      return {
        ok,
        json: async () =>
          ok ? { reauthenticate: true } : { error: "Unavailable" },
      };
    },
  });
  vm.runInContext(source, context);
  return { node, calls, destinations };
}
test("all-device logout asks for confirmation and uses an authenticated CSRF POST", async () => {
  const cancelled = fixture({ confirm: false });
  await cancelled
    .node("#revoke-sessions")
    .events.click({ currentTarget: cancelled.node("#revoke-sessions") });
  assert.equal(cancelled.calls.length, 0);
  const app = fixture();
  await app
    .node("#revoke-sessions")
    .events.click({ currentTarget: app.node("#revoke-sessions") });
  assert.equal(app.calls[0].url, "/api/admin/sessions/revoke");
  assert.equal(app.calls[0].options.method, "POST");
  assert.equal(app.calls[0].options.headers["x-csrf-token"], "test-csrf");
  assert.deepEqual(app.destinations, ["/__logout"]);
});
test("revocation failure leaves a useful message and allows retry", async () => {
  const app = fixture({ ok: false });
  await app
    .node("#revoke-sessions")
    .events.click({ currentTarget: app.node("#revoke-sessions") });
  assert.equal(app.node("#sessions-status").textContent, "Unavailable");
  assert.equal(app.node("#revoke-sessions").disabled, false);
  assert.deepEqual(app.destinations, []);
});
test("a saved password change returns the admin to login", async () => {
  const app = fixture();
  await app
    .node("#configuration-form")
    .events.submit({
      preventDefault() {},
      currentTarget: app.node("#configuration-form"),
    });
  assert.equal(app.calls[0].url, "/api/admin/configuration");
  assert.deepEqual(app.destinations, ["/admin"]);
});
