/* Private, explicit offline cache. Files are stored only after explicit user confirmation. */
const CACHE = "profilreise-offline-v38";
const FILE_CACHE = "profilreise-offline-files-v1";
const SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/shared/theme.js",
  "/shared/theme.css",
  "/script.js",
  "/shared/material-upload.js",
  "/deep-link.js",
  "/shared/openstreetmap.js",
  "/shared/calendar-model.js",
  "/shared/calendar-view.js",
  "/shared/calendar-export.js",
  "/shared/shared-notes.js",
  "/shared/ideas-v2.js",
  "/shared/offline-files.js",
  "/shared/connectivity-status.js",
  "/shared/ui-copy.js",
  "/shared/calendar-view.css",
  "/data/calendar.json",
  "/data/trip.json",
  "/data/materials.json",
  "/data/journeys.json",
  "/manifest.webmanifest",
  "/icon.svg",
];
const allowed = (path) =>
  SHELL.includes(path) || /^\/data\/routes\/[a-z0-9-]{1,80}\.json$/.test(path);
const purge = async () => {
  for (const key of await caches.keys())
    if (key.startsWith("profilreise-offline-")) await caches.delete(key);
};
let generation = 0;
async function clearCache() {
  generation++;
  await purge();
}
function valid(response, path) {
  if (!response.ok || response.redirected) return false;
  const type = response.headers.get("content-type") || "";
  if (path.endsWith(".json")) return type.includes("application/json");
  if (path.endsWith(".js")) return /javascript/.test(type);
  if (path.endsWith(".css")) return type.includes("text/css");
  if (path === "/" || path === "/index.html")
    return response.headers.get("x-portal-content") === "authenticated";
  return !type.includes("text/html");
}
async function remember(request, response, epoch) {
  if (epoch !== generation) return;
  const headers = new Headers(response.headers);
  headers.set("x-offline-cached-at", new Date().toISOString());
  const body = await response.clone().arrayBuffer();
  if (epoch !== generation) return;
  const cache = await caches.open(CACHE);
  await cache.put(
    request,
    new Response(body, { status: response.status, headers }),
  );
  if (epoch !== generation) await purge();
}

function fileCacheKey(value) {
  const url = new URL(value, self.location.origin);
  if (/^\/api\/files\//.test(url.pathname)) url.search = "";
  return url.toString();
}

async function cachedFileResponse(request) {
  const cache = await caches.open(FILE_CACHE);
  const cached = await cache.match(fileCacheKey(request.url));
  if (!cached) return null;
  const range = request.headers.get("range");
  if (!range) return cached;
  const body = await cached.clone().arrayBuffer();
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || body.byteLength === 0) return cached;
  let start = match[1] === "" ? 0 : Number(match[1]);
  let end = match[2] === "" ? body.byteLength - 1 : Number(match[2]);
  if (match[1] === "" && match[2] !== "") {
    const length = Math.min(Number(match[2]), body.byteLength);
    start = body.byteLength - length;
    end = body.byteLength - 1;
  }
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    start >= body.byteLength
  ) {
    return new Response(null, {
      status: 416,
      headers: { "content-range": `bytes */${body.byteLength}` },
    });
  }
  end = Math.min(end, body.byteLength - 1);
  const headers = new Headers(cached.headers);
  headers.set("accept-ranges", "bytes");
  headers.set("content-range", `bytes ${start}-${end}/${body.byteLength}`);
  headers.set("content-length", String(end - start + 1));
  return new Response(body.slice(start, end + 1), {
    status: 206,
    headers,
  });
}

async function cacheWithProgress(cache, key, response, file, state, port) {
  if (!response.body || typeof ReadableStream === "undefined") {
    await cache.put(key, response);
    state.completedBytes += Number(file.size || 0);
    return;
  }
  const reader = response.body.getReader();
  let fileBytes = 0;
  const stream = new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        state.completedBytes += fileBytes;
        return;
      }
      fileBytes += value.byteLength;
      const loaded = state.completedBytes + fileBytes;
      port?.postMessage({
        type: "CACHE_PROGRESS",
        file: file.name || "Datei",
        fileIndex: state.fileIndex,
        fileTotal: state.fileTotal,
        loaded,
        total: state.totalBytes,
        percent: state.totalBytes > 0 ? Math.min(100, Math.round((loaded / state.totalBytes) * 100)) : 0,
      });
      controller.enqueue(value);
    },
    cancel(reason) { return reader.cancel(reason); },
  });
  await cache.put(key, new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  }));
}

// Package metadata is written before downloading so interrupted saves remain manageable.
const dayKey = (date) => new URL(`/__offline-day/${date}`, self.location.origin).href;
const isDayFile = (url) => {
  const parsed = new URL(url, self.location.origin);
  return parsed.origin === self.location.origin && /^\/api\/files\/[a-z0-9-]{1,64}\/[0-9a-f-]{36}$/i.test(parsed.pathname);
};
async function dayRecords(cache) {
  const records = [];
  for (const request of await cache.keys()) {
    if (!/^\/__offline-day\/\d{4}-\d{2}-\d{2}$/.test(new URL(request.url).pathname)) continue;
    try { records.push(await (await cache.match(request)).json()); } catch {}
  }
  return records;
}
async function deleteUnshared(cache, keys, exceptDate) {
  const shared = new Set((await dayRecords(cache))
    .filter((record) => record.isoDate !== exceptDate).flatMap((record) => record.keys || []));
  for (const key of keys) if (!shared.has(key)) await cache.delete(key);
}
async function cacheDayFiles(data, port) {
  const files = (Array.isArray(data.files) ? data.files : []).filter((file) => isDayFile(file.url || ""));
  const isoDate = typeof data.isoDate === "string" ? data.isoDate : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) throw new Error("Ungültiger Reisetag");
  const epoch = generation;
  const checkSession = () => { if (epoch !== generation) throw new Error("Offline-Speicherung nach Abmeldung beendet."); };
  const cache = await caches.open(FILE_CACHE);
  const materialUrls = [...new Set(files.map((file) => file.materialsUrl).filter((url) =>
    /^\/api\/materials\?project=[a-z0-9%-]{1,120}$/i.test(url || "")))];
  const keys = [...new Set([...files.map((file) => fileCacheKey(file.url)),
    ...materialUrls.map((url) => new URL(url, self.location.origin).href)])];
  const previous = await cache.match(dayKey(isoDate));
  const old = previous ? await previous.json() : {};
  // Event-only saves add to the day package instead of evicting other events.
  const packageFiles = data.retainExisting
    ? [...new Map([...(old.files || (old.keys || []).filter(isDayFile).map(url=>({url}))), ...files].map(file=>[fileCacheKey(file.url),file])).values()]
    : files;
  const record = { isoDate, files: packageFiles, keys: [...new Set([...(old.keys || []), ...keys])], cachedAt: new Date().toISOString() };
  const saveRecord = async () => {
    checkSession();
    await cache.put(dayKey(isoDate), new Response(JSON.stringify(record), {headers:{"content-type":"application/json"}}));
  };
  await saveRecord();
  const state = {completedBytes:0, totalBytes:files.reduce((sum,file)=>sum+Number(file.size||0),0), fileIndex:0, fileTotal:files.length};
  for (const file of files) {
    checkSession();
    state.fileIndex++;
    port?.postMessage({type:"CACHE_PROGRESS",phase:"preparing",file:file.name||"Datei",fileIndex:state.fileIndex,fileTotal:state.fileTotal});
    const response = await fetch(file.url, {cache:"no-store",credentials:"same-origin"});
    checkSession();
    if (!response.ok || response.redirected) throw new Error(`${file.name || "Datei"} konnte nicht geladen werden`);
    await cacheWithProgress(cache, fileCacheKey(file.url), response, file, state, port);
    checkSession();
  }
  for (const url of materialUrls) {
    const response = await fetch(url, {cache:"no-store",credentials:"same-origin"});
    checkSession();
    if (!response.ok || response.redirected || !response.headers.get("content-type")?.includes("application/json"))
      throw new Error("Dateiliste konnte nicht geladen werden");
    await cache.put(new URL(url,self.location.origin).href,response);
  }
  checkSession();
  if (!data.retainExisting) await deleteUnshared(cache, (old.keys || []).filter((key) => !keys.includes(key)), isoDate);
  record.keys = data.retainExisting ? [...new Set([...(old.keys || []), ...keys])] : keys;
  await saveRecord();
  return {cached: files.length};
}
async function listDayFiles(data = {}) {
  const cache = await caches.open(FILE_CACHE);
  const records = await dayRecords(cache);
  // Older interrupted saves had no day record. Recover their date from the manifest.
  for (const file of data.files || []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(file.isoDate || "") || !isDayFile(file.url || "")) continue;
    let record = records.find((item) => item.isoDate === file.isoDate);
    if (!record) { record = {isoDate:file.isoDate,files:[],keys:[]}; records.push(record); }
    if (record.removed || !record.files) continue; // Legacy complete packages use their stored keys below.
    if (!record.files.some((item) => item.url === file.url)) record.files.push(file);
  }
  const days = [];
  const assignedKeys = new Set();
  for (const record of records) {
    if (record.removed) continue;
    const files = record.files || (record.keys || []).filter(isDayFile).map((url) => ({url}));
    const unique = [...new Map(files.map((file) => [fileCacheKey(file.url),file])).values()];
    let cached = 0, bytes = 0, unknownSizes = 0;
    for (const file of unique) {
      const response = await cache.match(fileCacheKey(file.url));
      if (!response) continue;
      cached++;
      assignedKeys.add(fileCacheKey(file.url));
      const size = Number(response.headers.get("content-length") || file.size || 0);
      if (size > 0) bytes += size; else unknownSizes++;
    }
    if (cached) days.push({isoDate:record.isoDate,cached,total:unique.length,bytes,unknownSizes,complete:cached===unique.length});
  }
  const orphanFiles = (await cache.keys()).filter((request)=>isDayFile(request.url) && !assignedKeys.has(request.url)).length;
  return {days:days.sort((a,b)=>a.isoDate.localeCompare(b.isoDate)),orphanFiles};
}
async function removeDayFiles(data) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.isoDate || "")) throw new Error("Ungültiger Reisetag");
  const cache = await caches.open(FILE_CACHE);
  // Recover ownership for legacy partial packages before removing shared entries.
  const records = await dayRecords(cache);
  for (const file of data.files || []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(file.isoDate || "") || !isDayFile(file.url || "")) continue;
    let record = records.find((item)=>item.isoDate===file.isoDate);
    if (!record) {record={isoDate:file.isoDate,keys:[]};records.push(record);}
    if (record.removed) continue;
    record.keys = [...new Set([...(record.keys||[]),fileCacheKey(file.url),
      ...(/^\/api\/materials\?project=[a-z0-9%-]{1,120}$/i.test(file.materialsUrl||"") ? [new URL(file.materialsUrl,self.location.origin).href] : [])])];
  }
  const record = records.find((item)=>item.isoDate===data.isoDate);
  const shared = new Set(records.filter((item)=>item.isoDate!==data.isoDate).flatMap((item)=>item.keys||[]));
  for (const key of record?.keys || []) if (!shared.has(key)) await cache.delete(key);
  // A tombstone prevents the manifest from rediscovering this removed day via
  // files that are still owned by a different day.
  await cache.put(dayKey(data.isoDate), new Response(JSON.stringify({isoDate:data.isoDate,removed:true,keys:[],files:[]}), {headers:{"content-type":"application/json"}}));
  return {};
}
// Serialize package mutations across tabs so a deletion cannot race a save.
let fileOperations = Promise.resolve();
function mutateFiles(operation) {
  const epoch = generation;
  const next = fileOperations.catch(()=>{}).then(() => {
    if (epoch !== generation) throw new Error("Offline-Vorgang nach Abmeldung beendet.");
    return operation();
  });
  fileOperations = next;
  return next;
}

async function cachedMaterialList(url) {
  const cache = await caches.open(FILE_CACHE);
  const cached = await cache.match(url);
  if (cached) return cached;
  // Interrupted downloads may already contain file bodies but no server file list.
  const files = new Map();
  for (const record of await dayRecords(cache)) {
    if (record.removed) continue;
    for (const file of record.files || []) {
      if (!file.materialsUrl || new URL(file.materialsUrl,self.location.origin).href !== url) continue;
      if (await cache.match(fileCacheKey(file.url))) {
        const id = file.id || new URL(file.url,self.location.origin).pathname.split("/").at(-1);
        files.set(id,{id,name:file.name||"Datei",size:file.size||0,uploadedAt:file.uploadedAt||""});
      }
    }
  }
  return files.size ? new Response(JSON.stringify({files:[...files.values()]}),{headers:{"content-type":"application/json"}}) : null;
}

async function dayFileStatus(data) {
  const files = Array.isArray(data.files) ? data.files : [];
  const cache = await caches.open(FILE_CACHE);
  const urls = [];
  for (const file of files) {
    if (await cache.match(fileCacheKey(file.url || ""))) urls.push(file.url);
  }
  return { cached: urls.length, total: files.length, urls };
}

self.addEventListener("install", (event) =>
  event.waitUntil(self.skipWaiting()),
);
async function migrateShellCaches() {
  const names = (await caches.keys()).filter(
    (name) =>
      name.startsWith("profilreise-offline-") &&
      name !== CACHE &&
      name !== FILE_CACHE,
  );
  if (names.length === 0) return;
  const target = await caches.open(CACHE);
  for (const name of names) {
    const source = await caches.open(name);
    for (const request of await source.keys()) {
      if (await target.match(request)) continue;
      const response = await source.match(request);
      if (response) await target.put(request, response);
    }
  }
  for (const name of names) await caches.delete(name);
}

self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      await migrateShellCaches();
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener("message", (event) => {
  if (event.data?.type === "CLEAR_PORTAL") {
    event.waitUntil(
      clearCache().then(() => event.ports[0]?.postMessage({ cleared: true })),
    );
    return;
  }
  if (["CACHE_DAY_FILES", "CACHE_EVENT_FILES"].includes(event.data?.type)) {
    event.waitUntil(
      mutateFiles(() => cacheDayFiles({...event.data, retainExisting:event.data.type === "CACHE_EVENT_FILES"}, event.ports[0]))
        .then((result) => event.ports[0]?.postMessage({ ok: true, ...result }))
        .catch((error) =>
          event.ports[0]?.postMessage({ ok: false, error: error.message }),
        ),
    );
    return;
  }
  if (event.data?.type === "STATUS_DAY_FILES") {
    event.waitUntil(
      dayFileStatus(event.data)
        .then((result) => event.ports[0]?.postMessage({ ok: true, ...result }))
        .catch((error) =>
          event.ports[0]?.postMessage({ ok: false, error: error.message }),
        ),
    );
    return;
  }
  if (["LIST_DAY_FILES", "REMOVE_DAY_FILES", "REMOVE_ALL_DAY_FILES"].includes(event.data?.type)) {
    const operation = event.data.type === "LIST_DAY_FILES" ? listDayFiles(event.data)
      : mutateFiles(() => event.data.type === "REMOVE_DAY_FILES" ? removeDayFiles(event.data)
        : caches.delete(FILE_CACHE).then(() => ({})));
    event.waitUntil(operation.then((result)=>event.ports[0]?.postMessage({ok:true,...result}))
      .catch((error)=>event.ports[0]?.postMessage({ok:false,error:error.message})));
    return;
  }
  if (event.data?.type !== "CACHE_PORTAL") return;
  const routes = Array.isArray(event.data.routes)
    ? event.data.routes.filter((ref) => /^[a-z0-9-]{1,80}$/.test(ref))
    : [];
  event.waitUntil(
    (async () => {
      const epoch = generation;
      const paths = [
        ...SHELL,
        ...routes.map((ref) => `/data/routes/${ref}.json`),
      ];
      for (const path of paths) {
        try {
          const response = await fetch(path, {
            cache: "no-store",
            credentials: "same-origin",
          });
          if (generation !== epoch) return;
          if (!valid(response, path)) {
            if (
              response.status === 401 ||
              response.headers.get("content-type")?.includes("text/html")
            )
              await clearCache();
            return;
          }
          if (path === "/data/calendar.json") {
            const calendar = await response.clone().json();
            for (const item of calendar.events || []) {
              if (/^[a-z0-9-]{1,80}$/.test(item.routeRef || "")) {
                const routePath = `/data/routes/${item.routeRef}.json`;
                if (!paths.includes(routePath)) paths.push(routePath);
              }
            }
          }
          await remember(path, response, epoch);
        } catch {
          return;
        }
      }
      event.source?.postMessage({ type: "OFFLINE_READY" });
    })(),
  );
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === "/__logout") {
    event.respondWith(
      (async () => {
        await clearCache();
        try {
          return await fetch(event.request);
        } catch {
          return new Response(
            '<!doctype html><html lang="de"><meta charset="utf-8"><title>Abgemeldet</title><p>Offline-Daten gelöscht. Zum erneuten Anmelden bitte eine Internetverbindung herstellen.</p></html>',
            {
              headers: {
                "content-type": "text/html; charset=utf-8",
                "cache-control": "no-store",
              },
            },
          );
        }
      })(),
    );
    return;
  }
  if (event.request.method === "GET" && /^\/api\/files\//.test(url.pathname)) {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(event.request);
          if (response.status === 401 || response.status === 403) {
            try { await clearCache(); } catch {}
            return response;
          }
          if (response.status >= 500) return (await cachedFileResponse(event.request)) || response;
          return response;
        } catch {
          return (
            (await cachedFileResponse(event.request)) ||
            new Response("Datei ist nicht offline gespeichert.", { status: 503 })
          );
        }
      })(),
    );
    return;
  }
  if (
    event.request.method === "GET" &&
    url.pathname === "/api/materials" &&
    url.searchParams.has("project")
  ) {
    event.respondWith(
      (async () => {
        let failure;
        try {
          const response = await fetch(event.request);
          if (response.status < 500) return response;
          failure = response;
        } catch {}
        const cached = await cachedMaterialList(event.request.url);
        if (cached) {
          // Mark stale fallback explicitly so the UI shows the outage alongside saved files.
          const headers = new Headers(cached.headers);
          headers.set("x-offline-materials", failure ? "storage-error" : "offline");
          headers.delete("x-file-providers-unavailable");
          if (failure?.headers.get("x-file-providers-unavailable") === "1")
            headers.set("x-file-providers-unavailable", "1");
          return new Response(cached.body,{status:200,headers});
        }
        return failure || new Response(JSON.stringify({error:"Offline: Keine gespeicherte Dateiliste verfügbar."}), {
          status:503,headers:{"content-type":"application/json"},
        });
      })(),
    );
    return;
  }
  if (event.request.method !== "GET") return;
  const isNavigation = event.request.mode === "navigate" || event.request.destination === "document";
  // Installer HTML uses content revisions. Only that known asset query is safe
  // to cache; token-bearing API/data URLs must still bypass the offline cache.
  const versionedAsset = /\.(js|css)$/.test(url.pathname) &&
    /^\?v=[a-f0-9]{16}$/.test(url.search);
  if (!isNavigation && ((!versionedAsset && url.search) || !allowed(url.pathname))) return;
  event.respondWith(
    (async () => {
      const epoch = generation;
      try {
        const response = await fetch(event.request);
        if (valid(response, isNavigation ? "/" : url.pathname))
          await remember(isNavigation ? "/" : event.request, response, epoch).catch(() => {});
        else if (
          response.status === 401 ||
          response.headers.get("content-type")?.includes("text/html")
        )
          await clearCache();
        return response;
      } catch {
        const cached = isNavigation
          ? (await caches.match("/", { cacheName: CACHE })) ||
            (await caches.match("/index.html", { cacheName: CACHE }))
          : (await caches.match(event.request, { cacheName: CACHE })) ||
            (versionedAsset ? await caches.match(url.pathname, { cacheName: CACHE }) : null);
        if (cached) return cached;
        return new Response("Dieser Inhalt ist offline noch nicht verfügbar.", {
          status: 503,
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      }
    })(),
  );
});
