# PAC · Cloudflare Worker mit Wolke-Speicher

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2FFinCreeper1%2FPAC)


Portal und API laufen als JavaScript auf Cloudflare Workers. Dateien und Anwendungsdaten bleiben im vorhandenen Nextcloud-Speicher („Wolke“) und werden per WebDAV gelesen und geschrieben. PHP und Hetzner werden von dieser Variante nicht für die Ausführung benötigt.

## Architektur

- `public/`: Portal, Administration, PWA und Ausgangsdaten. Nur dieser Ordner wird als Asset veröffentlicht; Konfiguration und Zugangsdaten bleiben privat.
- `src/index.js`: Routing, getrennte Anmeldungen, Administration, Kalender, gemeinsame Notizen, Ortssuche, Offline-Manifest und signierte Kalenderabos.
- `src/nextcloud.js`: WebDAV-Adapter mit derselben Ordnerstruktur und denselben Textschlüsseln wie `php/NextcloudStorage.php`. Upload und Download werden gestreamt. XML-Antworten werden mit einem Parser auf Namespaces, Statuscodes und zulässige Pfade geprüft. Zugangsdaten werden nicht an Weiterleitungsziele gesendet.
- `src/ideas.js`: vorhandenes `ideas:board` mit Autor, Datum, Freizeitfenster und Teilnahmeliste; kompatibel zum aktuellen PHP-Backend und zum vorhandenen Ideen-Frontend.
- `PORTAL`: ein Durable Object koordiniert gleichzeitige Anfragen. Sein Speicher enthält ausschließlich technische Admin-Sitzungen und den Ortssuchcache mit Ablaufzeit. Kalender, Routen, Ideen, Notizen und Dateien werden nicht im Durable Object gespeichert.
- `assets.run_worker_first: true`: Die Anmeldung wird vor statischen Abrufen geprüft.

R2, D1 und Cloudflare-KV werden nicht benötigt. Das Durable Object bleibt die zentrale Koordination für einen Portal-Worker. Der Objektname `portal-v1` bleibt bei Deployments gleich.

## Vorhandene Wolke weiterverwenden

Die vier `NEXTCLOUD_*`-Werte müssen auf denselben WebDAV-Benutzer und Stammordner wie in der bisherigen privaten Konfiguration zeigen:

| Worker-Variable | Bisherige PHP-Konfiguration |
| --- | --- |
| `NEXTCLOUD_WEBDAV_URL` | `nextcloud_webdav_url` |
| `NEXTCLOUD_USERNAME` | `nextcloud_username` |
| `NEXTCLOUD_APP_PASSWORD` | `nextcloud_app_password` |
| `NEXTCLOUD_ROOT` | `nextcloud_root` |

Das vorhandene Speicherformat bleibt erhalten:

- Dateien: `<root>/files/<Termin-Alias>/<Datei-UUID>`.
- Private Dateimetadaten inklusive PBKDF2-Löschpasswort: `<root>/metadata/<Termin-Alias>/<Datei-UUID>.json`.
- Textdaten: `<root>/text/<SHA-256-des-Schlüssels>.txt`.
- Schlüssel: `calendar:snapshot`, `ideas:board`, `shared-note:<eventId>` und ältere `note:<eventId>`.

Der Worker lädt den veröffentlichten Kalender, Reiseinformationen, Materialaliase, Verbindungsdetails und Routen aus `calendar:snapshot`. Neue Veröffentlichungen aktualisieren diesen Snapshot in der Wolke. Nur wenn der Snapshot tatsächlich fehlt (HTTP 404), dienen die mitgelieferten Ausgangsdaten als Startzustand. Ein Wolkenausfall liefert einen Speicherfehler und wird nicht als leerer Datenbestand behandelt. Ein Deployment überschreibt keine Wolkendaten.

Vorhandene Wolkendateien, gemeinsame Notizen und Ideen brauchen bei gleicher Konfiguration keinen Import. Inhalte, die bisher nur im lokalen Hetzner-Sicherungsordner liegen und noch nicht nach Nextcloud synchronisiert wurden, müssen vor dem Wechsel mit der bestehenden Synchronisierung übertragen werden. Der Worker synchronisiert nicht mit dem bisherigen Hetzner-Ordner.

Änderungen an Textdaten prüfen zusätzlich das Nextcloud-ETag mit `If-Match`; neue Dokumente werden mit `If-None-Match: *` angelegt. So überschreiben parallele bedingte Worker-Schreibzugriffe keine neueren Stände. Das alte PHP-Backend verwendet diese ETag-Prüfung nicht: Für den produktiven Wechsel dessen Schreibzugriffe beenden, damit es keine Worker-Änderungen aus seinem lokalen Sicherungsstand überschreibt.

## Lokal starten

Node.js 22 oder neuer:

```sh
cd PAC
npm ci
cp .dev.vars.example .dev.vars
# Passwörter, Secrets und NEXTCLOUD_* in .dev.vars eintragen.
npm run dev
```

Wrangler simuliert das Durable Object lokal; WebDAV greift auf den konfigurierten echten Wolke-Ordner zu. Für schreibende Tests einen eigenen Testordner verwenden. `.dev.vars` und `.wrangler` sind ignoriert. Das Beispiel enthält keine produktiven Zugangsdaten.

## Deploy to Cloudflare

Der offizielle [Deploy-to-Cloudflare-Assistent](https://developers.cloudflare.com/workers/platform/deploy-buttons/) kann den eigenständigen Ordner direkt aus einem öffentlichen GitHub- oder GitLab-Repository übernehmen. Der Button muss auf die Repository-URL einschließlich `/tree/<branch>/cloudflare-worker` zeigen; dieser Unterordner wird zur Wurzel des neu angelegten Repositorys. Wird nur der Inhalt von `cloudflare-worker/` veröffentlicht, genügt dessen Repository-URL.

Der Assistent liest die erforderlichen Secret-Namen aus `.dev.vars.example` und zeigt die Beschreibungen aus `package.json`. Eigene Portal-/Adminpasswörter und Secrets sowie die vorhandenen vier `NEXTCLOUD_*`-Werte im Assistenten eintragen. Das optionale `APPLE_MAPS_TOKEN` wird anschließend bei Bedarf als Worker-Secret ergänzt. Das Durable Object wird aus der Wrangler-Konfiguration eingerichtet; die Anwendungsdaten bleiben im konfigurierten Wolke-Ordner.

Build-Befehl: `npm run build`. Deploy-Befehl: `npm run deploy`. Der Ordner enthält seine Abhängigkeiten und alle Anwendungsdateien, sodass der Build keine Dateien aus dem übergeordneten PHP-Projekt benötigt.

## Bereitstellen per CLI

```sh
npx wrangler login
npx wrangler secret put PORTAL_PASSWORD
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET
npx wrangler secret put CALENDAR_FEED_SECRET
npx wrangler secret put NEXTCLOUD_WEBDAV_URL
npx wrangler secret put NEXTCLOUD_USERNAME
npx wrangler secret put NEXTCLOUD_APP_PASSWORD
npx wrangler secret put NEXTCLOUD_ROOT
# Nur für Apple Maps erforderlich:
npx wrangler secret put APPLE_MAPS_TOKEN
npm test
npm run build
npm run deploy
```

`SESSION_SECRET` und `CALENDAR_FEED_SECRET` unabhängig mit mindestens 32 zufälligen Bytes erzeugen. Portal- und Adminpasswort getrennt wählen. Ohne eigenes Feed-Secret wird das Adminpasswort für den Feed verwendet. Mit identischem Feed-Secret bleiben die HMAC-Token zum PHP-Feed kompatibel; beim Wechsel der Domain die Abo-URL entsprechend anpassen. Die SQLite-Migration legt das Durable Object beim ersten Deployment an. Tests und Dry-Run legen keine produktiven Ressourcen an.

Eine eigene Domain erst nach Prüfung über eine Workers Custom Domain einrichten. Diese Änderung schaltet keine bestehende Domain um und veröffentlicht nichts produktiv.

## Optionalen Kalender importieren

Wenn in der Wolke noch kein aktueller `calendar:snapshot` existiert, kann ein zuvor geprüfter lokaler Kalender über die Admin-API veröffentlicht werden:

```sh
WORKER_URL=https://your-worker.workers.dev ADMIN_PASSWORD='...' \
  node scripts/import-calendar.mjs ../data/admin-calendar.json
```

Das Skript liest Revision und CSRF-Schlüssel vor dem Schreiben. Referenzierte Routen müssen bereits im Wolken-Snapshot oder unter `public/data/routes/` vorhanden sein oder als `mapRoute` im Kalender enthalten sein. Der reguläre Zugriff auf einen vorhandenen Wolken-Snapshot benötigt diesen Import nicht.

## Grenzen

- Neue Dateien werden konservativ als `application/octet-stream` heruntergeladen. Bestehende Dateien behalten den in der Wolke gespeicherten MIME-Typ und die bisherige sichere Vorschau-Auswahl.
- Konkurrierende gemeinsame Notizen melden HTTP 409. Der vorhandene Editor unterstützt die manuelle Zusammenführung.
- Bei einer nicht erreichbaren Wolke stehen vorhandene Browser-Offlinedaten weiterhin zur Verfügung; neue serverseitige Schreibvorgänge werden nicht als erfolgreich bestätigt.
- Apple Maps, die OpenStreetMap-Ortssuche und Bahn-Liveinformationen benötigen weiterhin die jeweiligen externen Dienste. Apple Maps benötigt ein gültiges Token.
- Cloudflare- und Nextcloud-Limits gelten weiter; Dateilisten mit vielen Metadatendateien erzeugen mehrere WebDAV-Unteranfragen.

## Prüfung

```sh
npm test
npm run build
```

Die Tests nutzen einen isolierten WebDAV-Testserver im Speicher über den echten Adapter. Sie prüfen bestehende PHP-Speicherpfade, ETag-Konflikte, alte Dateien und Ideen, Upload/Listung/Download/Löschung, fehlgeschlagene Uploads, XML-Prüfung, Wolkenausfälle, Anmeldung, CSRF, Kalenderveröffentlichung, Notizkonflikte, Offline-Manifest und Kalenderabos. Es erfolgen keine Zugriffe auf die produktive Wolke und keine visuellen Tests.

Eine optionale HTTP-Prüfung gegen eine lokal gestartete Worker-Instanz ist möglich, wenn `.dev.vars` ausdrücklich auf einen separaten Wolke-Testordner zeigt und die lokalen Testpasswörter verwendet werden:

```sh
npx wrangler dev --port 8791 --var PORTAL_PASSWORD:local-test --var ADMIN_PASSWORD:local-admin --var SESSION_SECRET:local-secret-for-integration-only
# In einem zweiten Terminal:
CONFIRM_ISOLATED_TEST_STORAGE=1 node scripts/check-local-http.mjs
```

Diese optionale Prüfung veröffentlicht den Testkalender erneut und legt eine Testdatei an, die anschließend gelöscht wird. Sie wurde für die Nextcloud-Variante nicht gegen einen echten Wolke-Ordner ausgeführt.
