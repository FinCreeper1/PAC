// Start an isolated local workerd instance, run HTTP assertions, and clean up.
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const installer = process.argv.includes("--installer");
const cwd = fileURLToPath(
  new URL(installer ? "../installer/" : "../", import.meta.url),
);
const cli = join(cwd, "node_modules/wrangler/bin/wrangler.js");
const temp = await mkdtemp(join(tmpdir(), "pac-runtime-"));
const server = createServer();
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const port = server.address().port;
await new Promise((resolve) => server.close(resolve));
const base = "http://127.0.0.1:" + port;
const child = spawn(
  process.execPath,
  [
    cli,
    "dev",
    "--local",
    "--config",
    "tests/wrangler.runtime.jsonc",
    "--ip",
    "127.0.0.1",
    "--port",
    String(port),
    "--inspector-port",
    "0",
    "--persist-to",
    join(temp, "state"),
    "--log-level",
    "error",
  ],
  {
    cwd,
    env: {
      ...process.env,
      CI: "true",
      WRANGLER_SEND_METRICS: "false",
      XDG_CONFIG_HOME: temp,
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let output = "",
  exitCode;
const exited = new Promise((resolve) => {
  child.once("exit", (code) => {
    exitCode = code;
    resolve();
  });
  child.once("error", (error) => {
    output += error.message;
    exitCode = 1;
    resolve();
  });
});
for (const stream of [child.stdout, child.stderr])
  stream.on("data", (chunk) => {
    output = (output + chunk).slice(-12000);
  });
try {
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (exitCode !== undefined) throw Error("Runtime did not start: " + output);
    try {
      const response = await fetch(
        base + (installer ? "/api/session" : "/api/version"),
        { signal: AbortSignal.timeout(500) },
      );
      if (response.ok) {
        await response.body?.cancel();
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) throw Error("Runtime startup timed out: " + output);
  const check = spawn(process.execPath, ["scripts/check-runtime.mjs"], {
    cwd,
    env: { ...process.env, PAC_TEST_BASE: base },
    stdio: "inherit",
    timeout: 60000,
  });
  const status = await new Promise((resolve, reject) => {
    check.once("exit", resolve);
    check.once("error", reject);
  });
  if (status !== 0)
    throw Error("HTTP integration failed (exit " + status + ").\n" + output);
} finally {
  child.kill("SIGTERM");
  let timer;
  await Promise.race([
    exited,
    new Promise((resolve) => {
      timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 3000);
    }),
  ]);
  clearTimeout(timer);
  await rm(temp, { recursive: true, force: true });
}
