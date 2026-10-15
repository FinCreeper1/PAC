# Bestehende PAC-Instanz aktualisieren

Der öffentliche Installer legt eine neue Instanz an. Für Updates wird gezielt der vorhandene Worker im eigenen Cloudflare-Konto aktualisiert. Dieser manuelle Weg benötigt Node.js 22 oder neuer und eine Cloudflare-Anmeldung, aber keinen GitHub-Account. Ein Update-Button mit OAuth ist noch nicht implementiert.

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

Bau und Konfiguration des Update-Befehls werden als Dry-Run geprüft. Ein echtes Update einer bestehenden Nutzerinstanz und ein echter Rollback sind noch nicht verifiziert; diese Anleitung beschreibt den vorbereiteten manuellen Weg.

## Instanzen mit App-Einrichtung

PAC_SETUP_SECRET muss erhalten bleiben: Es schützt die verschlüsselte Konfiguration im Durable Object. Lösche oder rotiere es nicht ohne vorherige Migration dieser Konfiguration. Das PORTAL-Binding und die bestehende Durable-Object-Klasse ebenfalls erhalten. Der persönliche Setup-Link ist nach erfolgreicher Einrichtung kein Weg zum Ändern der Einstellungen. Manuell im Cloudflare-Dashboard gesetzte Variablen und Secrets können Formularwerte überschreiben.
