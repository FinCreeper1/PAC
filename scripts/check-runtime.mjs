import assert from "node:assert/strict";
const base = process.env.PAC_TEST_BASE;
assert.ok(
  base && /^http:\/\/127\.0\.0\.1:\d+$/.test(base),
  "Only an isolated local fixture is allowed",
);
const call = (path, options = {}) =>
  fetch(base + path, {
    redirect: "manual",
    signal: AbortSignal.timeout(10000),
    ...options,
  });
const login = async (admin = false) => {
  const response = await call(admin ? "/admin/login" : "/__login", {
    method: "POST",
    headers: { origin: base },
    body: new URLSearchParams({
      password: admin ? "runtime-admin" : "runtime-participant",
    }),
  });
  assert.equal(response.status, 303);
  return response.headers.get("set-cookie").split(";")[0];
};
const participant = await login(),
  admin = await login(true);
const calendar = await (
  await call("/api/admin/calendar", { headers: { cookie: admin } })
).json();
const event = calendar.calendar.events[0].id;
const bytes = new Uint8Array(2 * 1024 * 1024);
for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
const headers = {
  cookie: participant,
  origin: base,
  "content-type": "application/octet-stream",
  "x-file-name": btoa("runtime.bin"),
  "x-portal-password": btoa("runtime-participant"),
  "x-delete-password": btoa("runtime-delete"),
};
// A real HTTP body traverses workerd's Durable Object and FixedLengthStream.
const upload = await call("/api/materials?project=" + event, {
  method: "PUT",
  headers,
  body: bytes,
});
assert.equal(upload.status, 201, await upload.clone().text());
const { file } = await upload.json();
assert.equal(file.size, bytes.length);
const download = await call("/api/files/" + event + "/" + file.id, {
  headers: { cookie: participant },
});
assert.equal(download.status, 200);
assert.deepEqual(new Uint8Array(await download.arrayBuffer()), bytes);
assert.equal(
  (
    await call("/api/files/" + event + "/" + file.id, {
      method: "HEAD",
      headers: { cookie: participant },
    })
  ).status,
  200,
);
// Hold the upstream upload until independent HTTP reads have completed.
const slow = call("/api/materials?project=" + event, {
  method: "PUT",
  headers: { ...headers, "x-file-name": btoa("runtime-slow.bin") },
  body: bytes,
});
try {
  let started = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    started = (await (await call("/__test/upload-status")).json()).started;
    if (started) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(started, true);
  const reads = await Promise.all(
    ["/api/version", "/data/calendar.json", "/script.js"].map((path) =>
      call(path, {
        headers: { cookie: participant },
        signal: AbortSignal.timeout(2000),
      }),
    ),
  );
  assert.deepEqual(
    reads.map((response) => response.status),
    [200, 200, 200],
  );
  for (const response of reads) await response.body?.cancel();
} finally {
  await call("/__test/release-upload");
}
assert.equal((await slow).status, 201);
calendar.calendar.events[0].title = "Runtime publication";
const publish = {
  method: "PUT",
  headers: {
    cookie: admin,
    origin: base,
    "content-type": "application/json",
    "x-csrf-token": calendar.csrf,
  },
  body: JSON.stringify(calendar),
};
assert.equal((await call("/api/admin/calendar", publish)).status, 200);
assert.equal((await call("/api/admin/calendar", publish)).status, 409);
const revoked = await call("/api/admin/sessions/revoke", {
  method: "POST",
  headers: { cookie: admin, origin: base, "x-csrf-token": calendar.csrf },
});
assert.equal(revoked.status, 200);
assert.equal(
  (
    await call("/api/calendar-subscription", {
      headers: { cookie: participant },
    })
  ).status,
  401,
);
assert.equal(
  (await call("/api/admin/calendar", { headers: { cookie: admin } })).status,
  401,
);
assert.equal(
  (
    await call("/api/calendar-subscription", {
      headers: { cookie: await login() },
    })
  ).status,
  200,
);
console.log(
  "Workerd HTTP integration passed: streaming upload/download, concurrent reads during upload, HEAD, calendar conflicts, session revocation and new login. No production services or visual tests.",
);
