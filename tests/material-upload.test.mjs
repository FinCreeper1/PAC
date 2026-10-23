import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
const source = readFileSync(
  new URL("../public/shared/material-upload.js", import.meta.url),
  "utf8",
);
function fixture(status, response) {
  let request;
  class Xhr {
    constructor() {
      request = this;
      this.headers = {};
      this.events = {};
      this.upload = { addEventListener() {} };
    }
    open(method, url) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(key, value) {
      this.headers[key] = value;
    }
    addEventListener(name, fn) {
      this.events[name] = fn;
    }
    send(file) {
      this.body = file;
      this.status = status;
      this.response = response;
      this.events.load();
    }
  }
  const context = vm.createContext({ XMLHttpRequest: Xhr, TextEncoder, btoa });
  vm.runInContext(source, context);
  return {
    send: (...args) => context.sendMaterialUpload(...args),
    request: () => request,
  };
}
test("material transport sends the file body unchanged with UTF-8 metadata in headers", async () => {
  const f = fixture(201, { file: { id: "stored" } }),
    file = { name: "Übung.pdf", size: 42 };
  const result = await f.send(file, "trip-event", "secret", "delete", () => {});
  assert.equal(result.file.id, "stored");
  assert.equal(f.request().method, "PUT");
  assert.equal(f.request().body, file);
  assert.equal(f.request().url, "/api/materials?project=trip-event");
  assert.equal(
    f.request().headers["X-File-Name"],
    Buffer.from(file.name).toString("base64"),
  );
});
test("Cloudflare 413 responses without JSON explain the per-request upload limit", async () => {
  const f = fixture(413, null);
  await assert.rejects(
    f.send({ name: "large.bin" }, "event", "secret", "delete", () => {}),
    /100 MB/,
  );
});
