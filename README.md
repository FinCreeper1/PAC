# PAC · Dein Portal für die Profilfahrt

Termine, Reiseunterlagen und gemeinsame Planung an einem Ort – für Teilnehmende und Reiseleitung.

**[PAC mit dem Installer einrichten →](https://profilfahrt.linusfin.de/install)**

Der Installer führt dich durch die Einrichtung deiner eigenen PAC-Instanz auf Cloudflare. Eine GitHub-Verknüpfung ist dafür nicht erforderlich. Dateien und Reisedaten werden in deinem Nextcloud-Speicher („Wolke“) abgelegt.

## Was PAC bietet

- **Reiseplan:** Termine, Orte und Bahnverbindungen im gemeinsamen Kalender.
- **Unterlagen:** Dateien zu Terminen und gemeinsame Notizen.
- **Gemeinsame Planung:** Ideen sammeln und darüber abstimmen.
- **Unterwegs:** Offline-Funktionen und Kalenderabos.
- **Verwaltung:** Eigener Admin-Bereich für die Reiseleitung.

## Quellcode

Der vollständige **[Installer-Quellcode](installer/)** enthält die Website, die Cloudflare-Anmeldung, die Bereitstellung und Updates sowie Tests und eine Build-Anleitung.

## Installation

Am einfachsten startest du über den **[Installer](https://profilfahrt.linusfin.de/install)**. Halte dafür dein Cloudflare-Konto und die Zugangsdaten zu deinem Nextcloud-Speicher bereit.

Alternativ kannst du die Vorlage direkt über Cloudflare bereitstellen:

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2FFinCreeper1%2FPAC)

## Technische Dokumentation

<details>
<summary>Architektur, lokale Entwicklung und manuelle Bereitstellung</summary>

## Architektur

- `public/`: Portal, Administration, PWA und Ausgangsdaten. Nur dieser Ordner wird als Asset veröffentlicht; Konfiguration und Zugangsdaten bleiben privat.
- `src/index.js`: Routing und Anfragekoordination. `sessions.js` verwaltet Sitzungswiderruf, `configuration.js` die verschlüsselten Zugänge, `trip-settings.js` Reiseeinstellungen, `admin-calendar.js` die Kalenderveröffentlichung und `invoices.js` Belege.
- `public/admin/`: Kalendereditor, Rechnungen und Einstellungen liegen in getrennten Skripten; `public/shared/material-upload.js` enthält den Upload-Transport.
- `src/nextcloud.js`: WebDAV-Adapter mit derselben Ordnerstruktur und denselben Textschlüsseln wie `php/NextcloudStorage.php`. Upload und Download werden gestreamt. XML-Antworten werden mit einem Parser auf Namespaces, Statuscodes und zulässige Pfade geprüft. Zugangsdaten werden nicht an Weiterleitungsziele gesendet.
- `src/ideas.js`: vorhandenes `ideas:board` mit Autor, Datum, Freizeitfenster und Teilnahmeliste; kompatibel zum aktuellen PHP-Backend und zum vorhandenen Ideen-Frontend.
- `PORTAL`: ein Durable Object serialisiert verändernde Anfragen; Leseanfragen besitzen eigenen Anfragezustand und laufen unabhängig davon. Ein generationsgeschützter Kurzzeitcache verhindert, dass verspätete Leseantworten nach einem Schreibvorgang einen alten Stand zurücklegen. Sein Speicher enthält technische Admin-Sitzungen, den Ortssuchcache mit Ablaufzeit und bei Einrichtung über das App-Formular die verschlüsselte Zugangskonfiguration. Kalender, Routen, Ideen, Notizen und Dateien werden nicht im Durable Object gespeichert.
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

## Ohne GitHub-Verknüpfung: Deploy & Claim

Mit `npx wrangler deploy --temporary` lässt sich die Vorlage in einem temporären Cloudflare-Konto bereitstellen. Wrangler fordert vorher die Zustimmung zu Cloudflares Nutzungsbedingungen und Datenschutzerklärung. Der anschließend erzeugte persönliche Claim-Link muss innerhalb von 60 Minuten vollständig eingelöst werden, damit Konto und Worker erhalten bleiben. Dafür ist nur eine Cloudflare-Anmeldung erforderlich.

Den Claim-Link nicht öffentlich teilen: Er erlaubt die Übernahme des Kontos. Nach der Übernahme die Portal- und Nextcloud-Secrets unter **Settings → Variables and Secrets** einrichten. Bis dahin antwortet PAC mit HTTP 503 und einem Einrichtungshinweis. Wolken-Zugangsdaten werden nicht in die öffentliche Vorlage eingebaut.

Die Bereitstellung benötigt keine GitHub-Anbindung. Der offizielle Deploy-Button bleibt als zusätzliche Installationsmöglichkeit verfügbar.

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
  node scripts/import-calendar.mjs ../old/data/admin-calendar.json
```

Das Skript liest Revision und CSRF-Schlüssel vor dem Schreiben. Referenzierte Routen müssen bereits im Wolken-Snapshot oder unter `public/data/routes/` vorhanden sein oder als `mapRoute` im Kalender enthalten sein. Der reguläre Zugriff auf einen vorhandenen Wolken-Snapshot benötigt diesen Import nicht.

## Grenzen

- Neue Dateien werden konservativ als `application/octet-stream` heruntergeladen. Bestehende Dateien behalten den in der Wolke gespeicherten MIME-Typ und die bisherige sichere Vorschau-Auswahl.
- Konkurrierende gemeinsame Notizen melden HTTP 409. Der vorhandene Editor unterstützt die manuelle Zusammenführung.
- Bei einer nicht erreichbaren Wolke stehen vorhandene Browser-Offlinedaten weiterhin zur Verfügung; neue serverseitige Schreibvorgänge werden nicht als erfolgreich bestätigt.
- Apple Maps, die OpenStreetMap-Ortssuche und Bahn-Liveinformationen benötigen weiterhin die jeweiligen externen Dienste. Apple Maps benötigt ein gültiges Token.
- Cloudflare- und Nextcloud-Limits gelten weiter. Dateilisten laden Metadaten in Gruppen mit höchstens vier parallelen Abrufen; die Anzahl der WebDAV-Unteranfragen bleibt proportional zur Dateizahl.

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

Diese optionale Prüfung veröffentlicht den Testkalender erneut und legt eine Testdatei an, die anschließend gelöscht wird. Am 15.10.2026 wurde dieser Ablauf in der echten Worker-Runtime gegen einen eigens angelegten Wolke-Testordner geprüft: Teilnehmer-/Admin-Anmeldung, Kalender-Veröffentlichung, gemeinsame Notizen, Upload/Download/Löschung, Offline-Manifest und Kalenderabo. Der Testordner wurde anschließend gelöscht und sein Fehlen per HTTP 404 bestätigt. Bestehende Nutzerdaten wurden nicht verändert.

## Bestehende Instanz aktualisieren

Im Adminbereich unter Einstellungen zeigt PAC die installierte und die verfügbare Version. „PAC aktualisieren“ öffnet den Installer; nach Cloudflare-Anmeldung und Auswahl der vorhandenen Instanz ersetzt er deren Code und prüft die Aktivierung. Der manuelle CLI-Weg bleibt verfügbar; beide Wege und ihre Prüfgrenzen stehen in [UPDATING.md](UPDATING.md).

## Einrichtung direkt in PAC

Neue Installer-Instanzen erhalten einen persönlichen Einrichtungslink. Öffne ihn, lege unterschiedliche Portal-/Adminpasswörter mit mindestens 6 Zeichen (längere Passwörter empfohlen) fest und trage WebDAV-Adresse, Benutzername, App-Passwort und Wolke-Ordner ein. „Einrichtung abschließen“ prüft den Lese-/Schreibzugriff mit einer temporären Datei, speichert die Konfiguration und öffnet PAC angemeldet. Sitzungsschlüssel und Kalendergeheimnis werden automatisch erzeugt.

Die Konfiguration liegt AES-GCM-verschlüsselt im eigenen Durable Object. Der Schlüssel wird aus dem Worker-Secret PAC_SETUP_SECRET abgeleitet. Dieses Secret bei Updates und Sicherungen unbedingt erhalten; ohne es lässt sich die gespeicherte Konfiguration nicht mehr lesen. Die Reiseinhalte bleiben in Nextcloud. Manuell gesetzte Worker-Variablen/Secrets haben Vorrang vor Formularwerten.

Der persönliche Link enthält einen geheimen Token im URL-Fragment. Er wird beim Öffnen aus der Adresszeile entfernt und gehört nur der Person, die die Instanz einrichtet. Nach erfolgreicher Einrichtung nimmt die Setup-API keine Änderungen mehr an. Vorhandene konfigurierte Instanzen bleiben unverändert nutzbar. Ältere unkonfigurierte Instanzen brauchen zunächst das Code-Update und ein zufälliges PAC_SETUP_SECRET im Cloudflare-Dashboard; anschließend ist /setup#token=DEIN_SECRET der persönliche Einrichtungslink.

### Reisedaten im Setup

Wähle zwischen einer neuen Reise und der Übernahme einer vorhandenen Wolken-Reise. Neue Reisen benötigen Titel, Beginn, Ende, Startort und Ziel; Teilnehmende werden optional zeilenweise eingetragen. Der Kalender startet ohne Demo-Termine mit genau den ausgewählten Tagen. Bei einer bereits gespeicherten Reise bricht „Neue Reise“ ohne Überschreiben ab; mit „Vorhandene Reise übernehmen“ bleiben Kalender, Dateien und Metadaten unverändert. Die Login-Seite verwendet anschließend die Reisedaten aus der Wolke.

### Einstellungen nach der Einrichtung

Im Admin-Tab „Einstellungen“ lassen sich Reisetitel, Zeitraum, Start, Ziel,
Zeitzone und Teilnehmende sowie der Kartenanbieter ändern. Tage mit vorhandenen
Terminen können nicht entfernt werden. Nach Änderungen der Reisedaten die Seite
vor der weiteren Kalenderbearbeitung neu laden.

Bei Installationen mit App-Einrichtung können dort auch Portal- und
Adminpasswort sowie WebDAV-Zugang und Wolke-Ordner geändert werden. Leere
Passwortfelder behalten ihre bisherigen Werte. Zugangsdaten werden verschlüsselt
im eigenen Durable Object gespeichert; bestehende Passwörter werden nie an das
Formular zurückgegeben. Cloudflare-Variablen haben weiterhin Vorrang und müssen
bei Bedarf im Cloudflare-Dashboard geändert werden. Ein Speicherwechsel setzt
voraus, dass der vollständige Reiseordner zuvor kopiert wurde und dieselbe
Reise-ID enthält. Sitzungs- und Kalenderabo-Geheimnisse bleiben erhalten.

Die aktuelle Domain wird gesperrt angezeigt. Custom Domains werden über den
verlinkten Cloudflare-Bereich verwaltet. Der Update-Manager bietet Links zu
Änderungen und zur Update-/Rollback-Anleitung. Die Versionsprüfung erfolgt über den Installer. Die Installation benötigt eine Cloudflare-Anmeldung und die Auswahl der vorhandenen Instanz; sie läuft anschließend mit Aktivierungsprüfung. Bei einem nicht erreichbaren Versionsdienst bleibt der manuelle Einstieg möglich.


## Sitzungen und Geräte

Teilnehmer-Sitzungen laufen nach 14 Tagen ohne Onlineaktivität ab; Admin-Sitzungen nach zwei Stunden und werden bei aktiver Nutzung verlängert. Unter Einstellungen → „Alle Geräte abmelden“ kann die Reiseleitung beide Rollen zentral abmelden. Passwortänderungen über das Formular beenden ebenfalls sämtliche Sitzungen; bei Änderungen über Cloudflare verlieren die Sitzungen der jeweils geänderten Rolle ihre Gültigkeit. Kalenderabo-Geheimnisse werden beim formularbasierten Passwortwechsel und beim Gerätewiderruf erhalten.

Die neue Sitzungsbindung erfordert beim ersten Update von einer älteren Version eine erneute Anmeldung. Bereits offline gespeicherte Inhalte auf fremden Geräten können ohne Verbindung nicht aus der Ferne gelöscht werden. Erkennt der Service Worker beim nächsten geschützten Onlineabruf eine abgelaufene Sitzung, löscht er die Offline-Caches.

## Dateiuploads und Größenlimits

Materialien werden einzeln als binärer HTTP-`PUT` vom Browser an `/api/materials?project=…` gesendet und vom Worker an Nextcloud gestreamt. Kleine Header enthalten Dateiname, Portal- und Löschpasswort; der Dateiinhalt liegt im Request-Body. Rechnungsbelege verwenden denselben Streaming-Ansatz, haben zusätzlich eine Anwendungsgrenze von 25 MiB und benötigen eine Admin-Sitzung mit CSRF-Schlüssel.

Cloudflare Free/Pro begrenzt den Request-Body auf 100 MB; eine kleinere konfigurierte Grenze oder Nextcloud-Limits können früher greifen. Die gesamte Headergröße ist separat auf 128 KB begrenzt. Streaming reduziert den Speicherbedarf des Workers, umgeht aber die Body-Grenze nicht. Eine Datei ist derzeit eine Anfrage, ohne Chunking oder Wiederaufnahme. Eine Ablehnung mit HTTP 413 wird im Uploadformular erläutert. Mehrere Dateien werden nacheinander einzeln übertragen.

Quelle: [Cloudflare Request-/Response-Limits](https://developers.cloudflare.com/workers/platform/limits/#request-and-response-limits).

## Automatische und lokale Prüfungen

Die GitHub-Actions-Pipeline `.github/workflows/verify.yml` führt auf Push und Pull Request beide Testsuiten, beide HTTP-Runtime-Prüfungen, die Prüfung des bereinigten Templates und beide Dry-Run-Builds aus. Sie benötigt keine Produktions-Secrets und führt keine Deployments oder visuellen Tests aus.

```sh
npm test
npm run test:runtime
npm test --prefix installer
npm run test:runtime --prefix installer
npm run build
npm run build --prefix installer
```

Die Runtime-Prüfungen starten automatisch eine lokale workerd-Instanz mit isoliertem Speicher in einem temporären Verzeichnis. Nextcloud und Cloudflare-OAuth/-Deployment werden simuliert. Der Worker-Test schickt echte HTTP-Dateibytes durch Durable Object und FixedLengthStream und prüft Download, Kalenderkonflikte und Sitzungswiderruf. Das ersetzt keinen produktiven OAuth-Durchlauf oder Lasttest gegen einen realen Nextcloud-Server.

## Beschädigte Textdaten wiederherstellen

Fehlende Notiz- oder Budgetdokumente erhalten weiterhin einen leeren Anfangszustand. Ungültiges JSON oder ungültige Feldtypen führen dagegen zu HTTP 503 mit `stored_data_corrupt`; Lesen und Speichern bleiben gesperrt, damit die Originaldatei erhalten bleibt.

Zur Wiederherstellung die betroffene Datei unter `<root>/text/` zuerst separat sichern. Der Dateiname ist SHA-256 des Schlüssels `shared-note:<eventId>` beziehungsweise `invoices:budget`, gefolgt von `.txt`. Eine gültige frühere Version über Nextcloud-Versionen oder eine Wolke-Sicherung wiederherstellen und danach erneut laden. Die Datei nicht als Reparatur löschen: Das würde den gespeicherten Inhalt entfernen. PAC legt dafür keine automatische zusätzliche Sicherung an.

</details>
