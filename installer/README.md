# PAC Installer

Öffentliche Einrichtung: https://pac-install.linusleupold.workers.dev

Dauerhafte öffentliche Einrichtungsseite für andere Nutzer. Jeder Browser erhält einen eigenen Hintergrundauftrag. Nach ausdrücklicher Zustimmung zu Cloudflares Nutzungsbedingungen und Datenschutzerklärung wird eine neue temporäre Cloudflare-Instanz erstellt und PAC darin bereitgestellt. Nur dieser Nutzer erhält seinen Übernahme-Link. Er übernimmt die Instanz bei Cloudflare und trägt dort seine Wolke-Zugangsdaten ein. GitHub-Verknüpfung und lokale Programme sind für den Nutzer nicht erforderlich.

## Bauen und veröffentlichen

```sh
npm ci
npm test
npm run build
npm run deploy
```

Das Build-Skript verwendet ausschließlich die bereinigte Vorlage aus `../dist-template`. Falls sie fehlt, erzeugt es sie über den vorhandenen Export. Die Demo-Teilnehmerliste wird vor dem Bundeln geprüft. Sämtliche statischen PAC-Dateien werden in das Worker-Modul eingebaut. Dadurch braucht die Bereitstellung neuer Nutzer keine Git-Abfragen und keinen separaten Assets-Upload.

Der Installer wird im dauerhaften Betreiberkonto veröffentlicht, nicht in einem temporären Nutzerkonto. Bei mehreren Cloudflare-Konten das Ziel mit `CLOUDFLARE_ACCOUNT_ID` festlegen. `RATE_SALT` kann als Worker-Secret gesetzt werden, um die Hashes der IP-basierten Anfragelimits zusätzlich zu salzen. Der Installer braucht weder einen Betreiber-API-Token als Runtime-Secret noch die Wolke-Konfiguration des Betreibers.

## Ablauf und Trennung

- HttpOnly-/Secure-/SameSite-Strict-Cookie mit 256 zufälligen Bits. Kein Sitzungs- oder Übernahme-Token in Installer-URLs oder Browser-LocalStorage.
- Eigener SQLite Durable Object pro Sitzung; CSRF-Token und Origin-Prüfung für schreibende Anfragen. Unangeforderte fremde Ursprünge werden abgewiesen.
- Die Cloudflare-Prüfaufgabe wird serverseitig in begrenzten Schritten über Durable-Object-Alarme gelöst. Die offizielle SHA-256-Checkpoint-Kette bleibt identisch; übergroße Aufgaben werden abgewiesen.
- Temporäre API-Tokens bleiben serverseitig und werden nach erfolgreichem Deployment gelöscht. Der Übernahme-Link bleibt ausschließlich in der zugehörigen Sitzung bis zum Ablauf verfügbar. Ein Alarm entfernt danach die gespeicherten Daten.
- Kontoerstellung wird nach einer unklaren Unterbrechung nicht automatisch wiederholt. Vorübergehende Fehler bei Challenge oder Upload werden höchstens zweimal erneut versucht.
- Limits: drei Starts pro IP-Hash und Stunde sowie 20 Starts insgesamt pro Stunde. Die Limit-Daten werden nach dem Stundenfenster gelöscht. Cloudflare kann unabhängig davon weitere Rate-Limits oder Missbrauchsprüfungen anwenden.
- Runtime-Observability ist deaktiviert. Der Anwendungscode protokolliert keine API-Antworten, Kontotokens oder Claim-Links.
- Es werden keinerlei Wolke-Passwörter abgefragt oder verarbeitet. Diese trägt der Nutzer nach der Übernahme direkt in seinem eigenen Cloudflare-Worker ein.

Der Betreiber muss den Installer dauerhaft in seinem Konto behalten. Das spätere Übernehmen der Nutzerinstanzen gewährt dem Installer keinen dauerhaften Kontozugriff. Nachträgliche Updates einer übernommenen Nutzerinstanz benötigen eine separate Cloudflare-Anmeldung oder einen gesonderten OAuth-Ablauf.

## Prüfung

`npm test` prüft Checkpoint-Korrektheit und Größenlimits, getrennte Sitzungen, Zustimmung, CSRF/Origin, vollständigen simulierten Deployment-Ablauf, Token-Löschung, Ablauf, Anfragelimits und Upload-Metadaten. Dabei werden keine echten Cloudflare-Konten angelegt.

Eine zusätzliche echte Workerd-/HTTP-Integration mit simulierten Cloudflare-Endpunkten ist vorhanden:

```sh
npx wrangler dev --config tests/wrangler.runtime.jsonc --port 8793 --persist-to /tmp/pac-installer-runtime-state
# Separates Terminal:
node scripts/check-runtime.mjs
```

Diese Prüfung durchläuft die tatsächlichen Durable-Object-Alarme und die HTTP-API. Sie führt keine visuellen Tests aus und akzeptiert keine externen Nutzungsbedingungen für Testkonten.

Cloudflare-Protokoll: https://developers.cloudflare.com/workers/platform/claim-deployments/

Verifiziert: zwölf Funktionstests, Worker-Dry-Run, vollständiger Workerd-/HTTP-Ablauf mit simuliertem Cloudflare sowie HTTP-Prüfung der veröffentlichten Seite (Sitzungstrennung und Zustimmungspflicht). Es wurde dabei kein reales Nutzerkonto als Test angelegt.
