# Bestehende PAC-Instanz aktualisieren

Der öffentliche Installer erstellt neue Instanzen und aktualisiert vorhandene PAC-Worker nach Cloudflare-Anmeldung. GitHub ist für beide Wege nicht erforderlich. Alternativ steht der manuelle CLI-Weg mit Node.js 22 oder neuer zur Verfügung.

## Update über die Oberfläche

1. Vorher die Wolke über deren vorhandene Sicherungsfunktion sichern. Ein Code-Rollback stellt keine Reisedaten wieder her.
2. In PAC unter Einstellungen die installierte und verfügbare Version sowie die Hinweise prüfen und „PAC aktualisieren“ öffnen.
3. Beim Installer unter `/app` bei Cloudflare anmelden, das richtige Konto und die vorhandene PAC-Instanz auswählen. Bei einer Custom Domain die Instanz anhand des tatsächlichen Worker-Namens zuordnen.
4. Der Installer prüft das vorhandene PORTAL-Binding, ersetzt den Code und erhält Variablen, Secrets und Bindings. Anschließend prüft er bis zu 15 Minuten die laufende Version. Bei unbestätigter Aktivierung nicht blind erneut installieren, sondern die angezeigte Meldung und Cloudflare prüfen.
5. PAC erneut öffnen und die vorhandenen Daten prüfen. Das Update auf die neue Sitzungsbindung meldet alte Sitzungen einmalig ab; mit dem bisherigen Passwort erneut anmelden.

Die folgenden CLI-Schritte sind die Alternative zur Oberfläche.

## Vorbereiten

1. Lade die aktuelle öffentliche Vorlage von https://github.com/FinCreeper1/PAC/archive/refs/heads/main.zip herunter und entpacke sie in einen neuen Ordner. Persönliche Anpassungen vorab separat sichern.
2. Notiere aus dem Cloudflare-Dashboard die Account-ID, den genauen bisherigen Worker-Namen (z. B. `pac-123456abcdef`) und die bisherige aktive Version. Prüfe, dass du Zugriff auf dieses Konto hast.
3. Sichere deine Wolke über deren vorhandene Sicherungsfunktion. Verwende denselben WebDAV-Benutzer, Wolke-Ordner und dieselben Portal-Secrets weiter. Insbesondere SESSION_SECRET und CALENDAR_FEED_SECRET nicht neu erzeugen.
4. Öffne im entpackten PAC-Ordner ein Terminal:

```sh
npm ci
npx wrangler login
npm test
```

## Zuerst nur bauen

Ersetze die beiden Platzhalter durch dein Konto und deinen bestehenden Worker. Der Dry-Run lädt nichts hoch und führt keine Datenmigration aus:

```sh
CLOUDFLARE_ACCOUNT_ID=DEINE_ACCOUNT_ID npx wrangler deploy --name DEIN_BISHERIGER_WORKER --keep-vars --dry-run
```

## Update ausführen

Nach erfolgreichem Dry-Run denselben Befehl ohne `--dry-run` ausführen:

```sh
CLOUDFLARE_ACCOUNT_ID=DEINE_ACCOUNT_ID npx wrangler deploy --name DEIN_BISHERIGER_WORKER --keep-vars
```

`--keep-vars` erhält im Dashboard gesetzte Variablen. Bestehende Worker-Secrets werden bei einem normalen Deployment übernommen. In der Vorlage sind keine produktiven Variablen oder Secrets enthalten. Lokale `.dev.vars` sind für die Entwicklung bestimmt und kein Ersatz für die Einstellungen des produktiven Workers.

Der Name muss exakt stimmen: Bei einem anderen Namen kann Wrangler eine neue Instanz anlegen. Das vorhandene PORTAL-Binding, die Klasse Portal und die Migration v1 bleiben erhalten. Entferne oder ändere diese Angaben nicht. Vor neuen Versionen mit zusätzlichen Migrationen die jeweiligen Versionshinweise prüfen.

Dateien und Anwendungsdaten bleiben im bisherigen Wolke-Ordner; ein Deployment importiert keine Demo-Daten in einen vorhandenen Snapshot. Neue statische Assets ersetzen die bisher ausgelieferten Assets; eigene Änderungen an HTML/JS müssen vorher übernommen werden.

## Danach prüfen

Öffne die bisherige PAC-Adresse. Prüfe Teilnehmer- und Admin-Anmeldung, den vorhandenen Kalender, eine Notiz und den Download einer vorhandenen Datei. Prüfe unter Settings, dass NEXTCLOUD_* und die übrigen Secrets weiter gesetzt sind. Falls eine Einrichtungsseite erscheint, zuerst die Konfiguration kontrollieren und keine neue Instanz erstellen.

## Zur vorigen Code-Version zurück

Wähle im Cloudflare-Dashboard die zuvor notierte Version oder nutze:

```sh
CLOUDFLARE_ACCOUNT_ID=DEINE_ACCOUNT_ID npx wrangler rollback DEINE_VORIGE_VERSION_ID --name DEIN_BISHERIGER_WORKER
```

Ein Code-Rollback stellt keine zwischenzeitlich geänderten Wolkendaten wieder her. Cloudflare kann Rollbacks über inkompatible Durable-Object-Migrationen ablehnen. Deshalb sind ein Wolke-Backup und die Prüfung der Versionshinweise weiterhin erforderlich.

## Prüfstand

Automatisierte Tests prüfen OAuth-/Update-Zustände, den Erhalt von Bindings, Aktivierungswiederholungen und Versionsabfragen. Die lokale workerd-HTTP-Prüfung simuliert Cloudflare-Endpunkte; Dry-Runs veröffentlichen nichts. Diese Prüfungen bestätigen keinen echten OAuth-Durchlauf mit einem fremden Konto und keinen produktiven Rollback. Die Freigabeanforderungen stehen in `installer/README.md`.

## Instanzen mit App-Einrichtung

PAC_SETUP_SECRET muss erhalten bleiben: Es schützt die verschlüsselte Konfiguration im Durable Object. Lösche oder rotiere es nicht ohne vorherige Migration dieser Konfiguration. Das PORTAL-Binding und die bestehende Durable-Object-Klasse ebenfalls erhalten. Der persönliche Setup-Link ist nach erfolgreicher Einrichtung kein Weg zum Ändern der Einstellungen. Manuell im Cloudflare-Dashboard gesetzte Variablen und Secrets können Formularwerte überschreiben.
