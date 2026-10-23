"use strict";
// File bytes are sent in the body; only small metadata values use headers.
function uploadHeader(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function sendMaterialUpload(
  file,
  project,
  password,
  deletePassword,
  onProgress,
) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(
      "PUT",
      `/api/materials?project=${encodeURIComponent(project)}`,
    );
    request.responseType = "json";
    request.setRequestHeader("Content-Type", "application/octet-stream");
    request.setRequestHeader("X-Portal-Password", uploadHeader(password));
    request.setRequestHeader("X-Delete-Password", uploadHeader(deletePassword));
    request.setRequestHeader("X-File-Name", uploadHeader(file.name));
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && event.total > 0)
        onProgress(
          Math.min(100, Math.round((event.loaded / event.total) * 100)),
        );
    });
    request.addEventListener("load", () => {
      const result = request.response || {};
      if (request.status >= 200 && request.status < 300) resolve(result);
      else
        reject(
          new Error(
            result.error ||
              (request.status === 413
                ? "Die Datei überschreitet das Upload-Limit dieser Instanz. Cloudflare Free/Pro erlaubt höchstens 100 MB pro Datei."
                : `Upload fehlgeschlagen (HTTP ${request.status}).`),
          ),
        );
    });
    request.addEventListener("error", () =>
      reject(new Error("Upload fehlgeschlagen. Bitte die Verbindung prüfen.")),
    );
    request.addEventListener("abort", () =>
      reject(new Error("Upload wurde abgebrochen.")),
    );
    request.send(file);
  });
}
