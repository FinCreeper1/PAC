# PAC Installer

Öffentliche Adresse: [profilfahrt.linusfin.de/install](https://profilfahrt.linusfin.de/install)

Dieser Ordner enthält den vollständigen Installer: Website unter `public/`, Worker und OAuth-Anmeldung unter `src/`, Build-Skripte unter `scripts/` sowie Tests unter `tests/`. Die PAC-Vorlage liegt eine Ebene darüber im selben Repository. Generierte Bundles, lokale Zugangsdaten und `node_modules` werden nicht versioniert.

Der Installer verwendet die direkte Cloudflare-Anmeldung (Authorization Code mit PKCE). Nutzer melden sich bei Cloudflare an, wählen ein freigegebenes Konto und bestätigen dort die Erstellung eines eigenen PAC-Workers. GitHub ist nicht erforderlich. Wolke-Zugangsdaten werden anschließend direkt im eigenen Worker hinterlegt.

**Öffentliche Freigabe:** Die registrierte Client-ID ist eingebaut. Für fremde Konten muss Cloudflare die Domain bestätigen und der OAuth-Client öffentlich freigegeben sein. Ein echter öffentlicher OAuth-Durchlauf steht noch aus. Ohne konfigurierte Client-ID zeigt die Seite einen Einrichtungshinweis und lässt keine Anmeldung zu. Der alte temporäre Kontoerstellungsweg wurde entfernt, da Cloudflare ihn aus Workers mit Code 1017 blockiert.

## Einmalige Einrichtung für den Betreiber

1. Unter Cloudflare → Manage Account → OAuth clients einen Client erstellen:
   - Name: PAC
   - Grant: `authorization_code`, Response: `code`
   - Token authentication: `none` (PKCE S256, kein Client-Secret)
   - Redirect: `https://pac-install.linusleupold.workers.dev/oauth/callback`
   - Required scopes: `account-settings.read` und `workers-scripts.admin` (Workers → Admin)
2. Für die Veröffentlichung an andere Konten Client-URL auf einer eigenen verifizierbaren Domain, Logo und Scopes hinterlegen. Den von Cloudflare vorgegebenen DNS-TXT-Eintrag für die Domain setzen und den Client nach erfolgreicher Prüfung öffentlich schalten. Private Clients funktionieren nur für Mitglieder des Betreiberkontos.
3. Die erhaltene öffentliche Client-ID unter `vars.OAUTH_CLIENT_ID` in `wrangler.jsonc` setzen. Die PAC-Client-ID ist bereits eingetragen. Kein Client-Secret, Zugriffstoken oder Betreiber-API-Token wird als Runtime-Secret benötigt.
4. Mit einem eigenen Cloudflare-Testkonto den echten Anmelde-, Auswahl- und Deployment-Ablauf prüfen, bevor die Freischaltung als abgeschlossen gilt.

Cloudflare-Dokumentation: [Client registrieren](https://developers.cloudflare.com/fundamentals/oauth/create-an-oauth-client/), [OAuth-Endpunkte](https://developers.cloudflare.com/fundamentals/oauth/integrate-with-cloudflare/).

## Bauen und veröffentlichen

Voraussetzung: Node.js 22 oder neuer. Im Wurzelordner der PAC-Vorlage zuerst deren Abhängigkeiten installieren, anschließend den Installer bauen:

```sh
npm ci
cd installer
npm ci
npm test
npm run test:runtime
npm run build
npm run deploy
```

## Versionen und Update-Hinweise

PAC-Versionen heißen `vX.Y.Z` (z. B. `v1.0.5`). Vor jedem Deployment mit
geänderter Vorlage:

1. `version` in `cloudflare-worker/package.json` erhöhen (Fehlerbehebung: letzte
   Stelle, neue Funktion: mittlere Stelle).
2. In `cloudflare-worker/CHANGELOG.md` einen Abschnitt `## vX.Y.Z` mit kurzen,
   für Lehrkräfte verständlichen Stichpunkten ergänzen. Ohne Abschnitt bricht der Build ab.
3. Bauen und deployen, danach `GITHUB_TOKEN=… npm run release` im Ordner
   `cloudflare-worker` ausführen. Das legt das GitHub-Release `vX.Y.Z` in
   FinCreeper1/PAC an oder aktualisiert dessen Text (Token mit „Contents: write“).

Der Installer liefert unter `/api/version` Version, Hinweise und Release-Link.
Die Hinweise stammen aus dem GitHub-Release der eingebauten Version (10 Minuten
gecacht); fehlt es oder ist GitHub nicht erreichbar, wird der eingebaute
CHANGELOG-Text gezeigt. Installer-Übersicht und Adminbereich zeigen die Hinweise,
sobald ein Update verfügbar ist. Wird die Version nicht erhöht, gilt geänderter
Code als gleiche Version und bestehende PACs erhalten kein Update-Angebot.

Der Build verwendet ausschließlich die bereinigte Demo-Vorlage. Bei mehreren Betreiberkonten `CLOUDFLARE_ACCOUNT_ID` setzen. `RATE_SALT` kann als Secret die IP-Hashes zusätzlich salzen. Die echte Wolke-Konfiguration und persönliche Teilnehmerdaten werden nicht eingebaut.

## Sitzungen und Bereitstellung

- Secure-/HttpOnly-/SameSite-Lax-Cookie, eigener SQLite Durable Object pro Sitzung. Lax erlaubt die Rückkehr vom Cloudflare-Login.
- CSRF und Origin-Prüfung für schreibende API-Anfragen. OAuth-State und PKCE-Verifier werden nur serverseitig gespeichert. State wird vor dem Tokenaustausch verbraucht.
- Kontoauswahl wird gegen die von Cloudflare gelieferte Kontoliste geprüft. Es werden bis zu 50 zugängliche Konten angezeigt.
- Neue Worker heißen `pac-<12 zufällige Hexzeichen>`. Vorhandene Scripts werden nicht überschrieben. Bei einer unklaren Upload-Unterbrechung erfolgt kein automatischer Neuversuch.
- Tokens werden nach Erfolg, Fehler oder Ablauf aus der Sitzung gelöscht, spätestens nach einer Stunde. Keine Refresh-Tokens werden angefordert. Cloudflare-Grants lassen sich zusätzlich im eigenen Konto widerrufen.
- 30 Login-Starts pro IP-Hash und Stunde, 300 global. Kein Logging von Codes, Tokens oder API-Antworten; Observability deaktiviert.
- Wolke-Zugangsdaten werden nur direkt beim eigenen PAC-Worker eingetragen.

## Prüfungen

`npm test` prüft PKCE, Callback-State und Replay-Schutz, CSRF, Konfiguration, Kontoprüfung, Tokenlöschung, Nichtüberschreiben vorhandener Worker, Upload-Metadaten und Limits.

Workerd-Integration mit simulierten Cloudflare-Endpunkten:

```sh
npx wrangler dev --config tests/wrangler.runtime.jsonc --port 8793 --persist-to /tmp/pac-installer-oauth-tests
node scripts/check-runtime.mjs
```

Diese Prüfungen sind nicht visuell und ersetzen keinen echten OAuth-Durchlauf mit einem registrierten Client.

## Wolke-Einrichtung und Fehlerfälle

Die Erfolgsseite verlinkt `/setup.html` mit WebDAV-Beispiel, App-Passwort, Ordnerregeln und der Anleitung für Secrets. Neu erstellte PAC-Instanzen zeigen bei fehlenden Angaben eine Einrichtungsseite; API-Anfragen erhalten weiterhin JSON mit `configuration_missing` oder `configuration_invalid`. Es werden nur Variablennamen, keine gesetzten Werte angezeigt.

Abgelehnte Anmeldung, fehlende Konten oder Rechte und abgelaufene Sitzungen führen zu einer erklärten Fehlermeldung mit Neustartmöglichkeit. Nach einem unklaren Upload bleibt ein Link zum gewählten Worker erhalten, damit Nutzer vor einer neuen Installation auf bereits angelegte Ressourcen prüfen können. Zugangstokens werden auch dabei gelöscht.

## Berechtigung zum Anlegen neuer Worker

Der Installer benötigt Workers Admin, da Workers Editor laut Cloudflare nur vorhandene Ressourcen ändern darf. Account Settings Read bleibt für die Kontoauswahl erforderlich. Wird ein bestehender OAuth-Client von Edit auf Admin geändert, müssen Nutzer neu zustimmen; bereits ausgestellte Tokens erhalten dadurch keine zusätzlichen Rechte. Die Admin-Berechtigung bezieht sich auf Workers im freigegebenen Konto und erlaubt auch deren Löschen. PAC verwendet sie zum Erstellen einer neuen Instanz und löscht das gespeicherte Token danach. Quelle: https://developers.cloudflare.com/workers/authorization/

## Persönliche App-Ersteinrichtung

Jede neue Bereitstellung enthält ein zufälliges Worker-Secret PAC_SETUP_SECRET mit 256 Bit. Die private Installer-Erfolgsseite liefert den persönlichen Link /setup#token=… zur neuen Instanz. Wolke-Passwörter werden erst dort eingegeben und nicht an den Installer gesendet. Der Token verbleibt in der zugehörigen Installer-Sitzung bis zu deren Ablauf, um den Link erneut öffnen zu können. Das eigene PAC speichert die Konfiguration verschlüsselt, prüft die Wolke und sperrt nach Abschluss weitere Ersteinrichtungen. Bereits eingerichtete Worker werden durch diese Änderung nicht umgestellt.

## Zusätzliche Adresse auf Hetzner

`https://profilfahrt.linusfin.de/install/` verwendet einen PHP-cURL-Proxy aus
`installer-proxy/` zum selben Worker unter `/install/`. Der Worker verwendet dort
Pfade unter `/install`, ein separates Cookie mit `Path=/install` und die feste
OAuth-Rücksprungadresse `https://profilfahrt.linusfin.de/install/oauth/callback`.
Diese Adresse muss zusätzlich beim OAuth-Client freigegeben sein. Die ursprüngliche
workers.dev-Adresse mit ihrer bisherigen Rücksprungadresse bleibt nutzbar.

`scripts/deploy-installer-proxy.py` richtet das neue Verzeichnis ein und ergänzt
nur die Ausnahme für `/install` in der bestehenden Portal-`.htaccess`. Die bisherige
Datei wird außerhalb von `public_html` gesichert. Das Skript bricht bei einem bereits
vorhandenen `install`-Verzeichnis ab. Cloudflare-Deployment und Hetzner-Proxy müssen
bei späteren Änderungen gemeinsam berücksichtigt werden.

Damit das Limit pro IP auch über den Proxy greift, sendet `index.php` die
Nutzer-IP als `X-PAC-Client-IP` zusammen mit `X-PAC-Proxy-Secret`. Der Worker
übernimmt diese IP nur, wenn der Wert dem Worker-Secret `PROXY_SECRET` entspricht;
sonst gilt `CF-Connecting-IP`. Einrichtung: zufälligen Wert erzeugen, per
`wrangler secret put PROXY_SECRET` setzen und auf Hetzner als
`install/secret.php` mit Inhalt `<?php return '…';` ablegen (nicht im Repository).
Ohne diese Datei teilen sich alle Proxy-Nutzer weiterhin ein Kontingent.

## Zugreisen verwalten

Neue Instanzen bieten in der Reiseplan-Verwaltung „Neue Zugreise“. Zugabschnitte
lassen sich mit Bahnhöfen, Zugbezeichnung, Zeiten und Gleisen hinzufügen,
entfernen und umsortieren. Bahnhof-IDs und Zugnummern ermöglichen die bestehenden
Live-Abfragen. Erste Abfahrt und letzte Ankunft werden durch die Terminzeiten
bestimmt. Zugdetails werden zusammen mit dem Kalender in der Wolke gespeichert.
Bestehende Verbindungen können im Termin unter „Zugverbindung hinzufügen oder
bearbeiten“ geändert werden. Der Installer baut bei jedem Build eine frische,
bereinigte Vorlage aus dem aktuellen Quellcode.

Der im Installer eingegebene Reisename wird im persönlichen Einrichtungslink übergeben und als Reisetitel vorausgefüllt. Er bleibt dort bearbeitbar; eine zweite Eingabe ist nicht erforderlich.

Die Ersteinrichtung bietet einen kompakten Von-/Bis-Zeitraum. Das Ende übernimmt bei Bedarf den Beginn. Passwörter lassen sich ein- und ausblenden; Portal- und Adminpasswort benötigen mindestens 6 Zeichen und müssen unterschiedlich sein.

Unter „Deine Wolke“ erklärt eine Anleitung WebDAV-Adresse, Benutzername, App-Passwort und Reiseordner. Der Christianeum-Link öffnet IServ in einem neuen Tab, sodass Anleitung und Formulareingaben geöffnet bleiben. Die Menüpfade orientieren sich an der verlinkten Nextcloud-Dokumentation und können je nach Schulinstallation abweichen.


## Verbindungsimport mit Transitous

Die Fahrplansuche verwendet wieder ausschließlich die öffentliche Transitous-MOTIS-API
unter `https://api.transitous.org/api/` (`v1/geocode`, `v6/plan`). transport.rest
wird nicht mehr angefragt. Bereits gespeicherte transport.rest-Verbindungen behalten
ihre Herkunftsangaben.

Der Betreiber hat am 18.10.2026 im Matrix-Chat bestätigt, dass für die besprochene
Nutzung derselbe User-Agent verwendet werden kann. Die Rückmeldung erklärt außerdem,
dass kleine Anwendungen bei Einhaltung der übrigen Anforderungen nicht eigens
nachfragen müssen. Diese Rückmeldung hebt die übrigen Bedingungen nicht auf:
https://transitous.org/api/.

Der Code muss unter geeigneter Open-Source-Lizenz veröffentlicht sein; leichtes
Prototyp-Testen vor der Veröffentlichung ist laut Richtlinie zulässig. Die Nutzung
muss nicht kommerziell und ressourcenschonend sein. Erhebliche Last erfordert weitere
Abstimmung. Für die im Matrix-Chat beschriebene PAC-Nutzung ist der Import standardmäßig aktiv.
Alle Instanzen verwenden `PAC/<Version> (https://github.com/FinCreeper1/PAC)`.
`TRANSITOUS_CONTACT` kann den Kontakt überschreiben;
`TRANSITOUS_USAGE_CONFIRMED=false` deaktiviert die API-Suche für eine Instanz.
Quellen und OpenStreetMap werden sichtbar verlinkt.

Pro Portal höchstens ein Suchversuch pro Minute, maximal drei API-Aufrufe ohne
Wiederholung und mit gemeinsamem 45-Sekunden-Timeout. Vollständige Textabschnitte
werden ohne API übernommen. Übersichten mit fehlenden Umstiegen lösen eine Suche
aus; bei Fehlern bleibt die Übersicht mit Warnung verfügbar. Ergebnisse erfordern
eine ausdrückliche Auswahl. Kurze Bahn-vbid-Links allein liefern keine Suchdaten.
Planzeiten haben Vorrang. Transitous-IDs werden nicht als EVA-Nummern für die
DB-Live-Abfrage verwendet. Fahrten über Mitternacht werden abgelehnt.

## Aktualisierte Browser-Dateien

Der Installer versieht lokale JavaScript- und CSS-Verweise in den eingebauten
HTML-Seiten mit einem SHA-256-Inhaltsfingerprint. Nach einem Update lädt der
Browser dadurch die zur jeweiligen Veröffentlichung gehörenden Dateien.
Bereits geöffnete Verwaltungsseiten müssen einmal neu geöffnet werden; ein
Update ersetzt keinen JavaScript-Code, der in einem offenen Fenster bereits läuft.

Die Rückgängig-Historie im Adminportal bleibt innerhalb der geöffneten Sitzung
auch nach dem Speichern erhalten. „Letzte Änderung zurücknehmen“ stellt den
vorherigen Plan als Entwurf wieder her; erneut speichern veröffentlicht ihn.
Beim Neuladen beginnt eine neue Historie.

## Kartenanbieter ändern

Neue Installationen bieten im Adminportal den separaten Bereich „Einstellungen“.
Dort lässt sich OpenStreetMap oder Apple MapKit dauerhaft für die Reise wählen.
OpenStreetMap benötigt keinen Token; für MapKit muss `APPLE_MAPS_TOKEN` im eigenen
Worker hinterlegt sein. Die Auswahl wird unabhängig von Kalenderentwürfen in der
Wolke gespeichert. Teilnehmende laden den Reiseplan nach einer Änderung neu.
Das Installer-Update aktualisiert die Vorlage für neue Installationen, nicht
bereits installierte persönliche Worker.

## Rechnungen und Belege

Neue Instanzen bieten im Adminportal einen eigenen Tab „Rechnungen“. Die
Reiseleitung kann Dateien bis 25 MB hochladen, herunterladen und nach Bestätigung
ohne zusätzliche Passwortabfrage löschen. Alle Datei-Endpunkte benötigen eine
Adminsitzung, Änderungen zusätzlich den CSRF-Schlüssel. Die separate Wolke-Ablage
ist nicht Bestandteil der Teilnehmer-Dateien, Kalenderanhänge oder Offline-Downloads.

Die Reiseleitung kann im Rechnungsbereich das Reisebudget und die Schülerzahl
speichern. Der Kreis zeigt den verbrauchten Anteil; Restbetrag und Überschreitungen
stehen zusätzlich als Text daneben. Kosten, Budget und Rest werden pro Schüler
umgerechnet. Belege ohne Betrag werden als nicht eingerechnet ausgewiesen.
Die Angaben bleiben im Adminbereich und werden mit Revisionsschutz in der Wolke gespeichert.

## Ladezeit der installierten Portale

Seit dem Performance-Update vom 16.10.2026 laden authentifizierte HTML-, JavaScript-
und CSS-Anfragen ohne Kalenderabruf aus Nextcloud. Aufeinanderfolgende lesende
Anfragen teilen sich für höchstens fünf Sekunden einen privaten Snapshot im
Arbeitsspeicher des jeweiligen Portal-Durable-Objects. Änderungen aus anderen
Instanzen können deshalb bis zu fünf Sekunden später sichtbar werden.
Schreibende Anfragen verwerfen diesen Cache und prüfen den aktuellen Wolkenstand
weiterhin mit Revision und ETag. Der Cache wird nicht öffentlich ausgeliefert.

Validierung: 83 Worker-Tests, 28 Installer-Tests und Installer-Dry-Run erfolgreich.
Installer veröffentlicht (Version `0ab06b94-bb97-494a-9539-aa349b68f13c`),
`pac-test4` mit demselben Bundle aktualisiert; vorherigen Code unter
`/private/tmp/pac-performance-test4-backup.multipart` gesichert und vorhandene
Bindings sowie das zurückgelesene Bundle geprüft. Keine visuellen Tests ausgeführt.

## Audit vom 17.10.2026

Behoben: `setup.html` nutzte Inline-Styles, die die CSP blockierte; Sitzungscookie
läuft jetzt mit der Aktivität mit und wird nach dem OAuth-Rücksprung erneuert;
Zurück-Navigation von Cloudflare hinterlässt keinen gesperrten Anmeldeknopf;
Nicht-JSON-Fehler des Proxys erscheinen lesbar. Neu: Favicon, Live-Vorschau der
pac-Adresse und angezeigte Adresse auf der Erfolgsseite. Entfernt: Fehlerauswertung
des alten Temporärkonto-Wegs, ungenutzte Exporte und CSS, Link zur manuellen
Einrichtung auf der Erfolgsseite (die Seite selbst bleibt für ältere Instanzen).

Validierung: 30 Installer-Tests, Dry-Run und Workerd-Integration erfolgreich.
Installer veröffentlicht (Version `8b4d7a90-fef7-4c97-8aaf-e706bec9f7bc`),
`pac-test4` mit demselben Bundle aktualisiert; Backup unter
`/private/tmp/pac-installer-audit-test4-backup.multipart`, Bindings und
zurückgelesenes Bundle geprüft. Keine visuellen Tests ausgeführt.
## PAC mit einem Klick aktualisieren

Der Einstellungen-Tab im Adminportal zeigt die installierte und die neueste PAC-Version
(`/api/version` des Installers, öffentlich mit CORS). „PAC aktualisieren“ öffnet den
Installer mit `?update=<worker>`. Nach der Cloudflare-Anmeldung wird dieses PAC
automatisch aktualisiert: Es wird nur der Code ersetzt (`keep_bindings`), Secrets,
Variablen, das PORTAL-Durable-Object und die Wolkendaten bleiben erhalten. Worker ohne
PORTAL-Binding werden nicht verändert. Das Token wird danach gelöscht. Bei eigener
Domain wählt man das PAC in der Liste aus. Die Version ist ein Fingerprint des Bundles.

## Bestätigte Aktivierung nach Updates

Nach dem Upload bleibt der Installer in der Phase „Neue Version wird aktiviert“.
Ein persistenter Alarm prüft alle zehn Sekunden `/api/version` auf der öffentlichen
Instanz. Dieser Endpunkt meldet die Bundle-Version aus dem tatsächlich laufenden
Portal-Durable-Object, ohne Anmeldung oder Zugriff auf Nextcloud. Die Antworten
werden nicht gecacht. Erst die erwartete Version schaltet den Erfolgsbildschirm
und den Link zurück ins Adminportal frei. Das bestätigt den geprüften
Auslieferungsweg; es ist keine Garantie für die gleichzeitige globale Umstellung.

Alte Antworten und vorübergehende Fehler werden ohne weiteren Upload wiederholt.
Nach 15 Minuten wird eine nicht bestätigte Aktivierung ausdrücklich gemeldet,
statt Erfolg vorzutäuschen. Ein erneutes Laden des Installers setzt die Prüfung
fort. OAuth-Zugangsdaten werden bereits nach dem Upload gelöscht.

Validierung: 117 Worker-/Installer-Tests und Installer-Dry-Run erfolgreich;
keine visuellen Tests durchgeführt.

### Korrektur der Aktivierungsprüfung am 17.10.2026

Die Cloudflare-Laufzeit unterstützt bei `fetch` ausschließlich die Redirect-Modi
`follow` und `manual`. Der bisherige Modus `error` löste vor dem Netzwerkabruf
eine Ausnahme aus, sodass selbst eine bereits aktive Version nie bestätigt wurde.
Die Prüfung verwendet nun `manual`; Weiterleitungen bestätigen keine Aktivierung.
`global_fetch_strictly_public` erlaubt öffentliche Aufrufe zwischen Workern.

Der Statusabruf setzt überfällige Prüfungen auch ohne Alarm fort. Zeitpunkt,
Prüfanzahl und ein begrenzter Fehlercode werden mitgeliefert. Die Oberfläche
zeigt einen Fortschrittsbalken für die drei Schritte Hochladen, Aktivierung prüfen
und Abschluss. Der Balken stellt Phasen dar, keine geschätzte Restdauer.

Validierung: 119 Tests erfolgreich. Ein temporärer Cloudflare-Diagnose-Worker
reproduzierte den konkreten Redirect-Laufzeitfehler. Mit korrigiertem Code erkannte
dieselbe Prüfung die öffentliche Version von `pac-test4` im ersten Versuch als
`updated`. Der Diagnose-Worker wurde danach entfernt. Keine visuellen Tests.

## Mobile Admin-Ansicht (17.10.2026)

Bei 320–375 px abgeschnittene Bereichs-Tabs, umbrechende Kopfzeile, überlappender
Bezahlt-Status in Rechnungszeilen und zu schmale Zugabschnitte im Editor korrigiert.
Geprüft mit Playwright-Screenshots bei 320 und 375 px (lokal, mit Testdaten).
93 Worker- und 35 Installer-Tests erfolgreich. Installer veröffentlicht
(Version `f373767b-9edf-4216-bb36-8904b535d402`), `pac-test4` mit demselben Bundle
aktualisiert; Backup unter `/private/tmp/pac-mobile-test4-backup.multipart`,
Bindings und zurückgelesenes Bundle geprüft.

## Direkter Zeitraum für Abgabefristen (17.10.2026)

Die Verwaltung neuer Installationen bietet „Von · Anzeigen ab“ und „Bis · Abgabe“
als zusammengehörigen Zeitraum. Ohne Beginn gilt die Frist sofort; ohne optionale
Ausblendzeit endet die Anzeige bei Abgabe. Eine spätere Ausblendzeit hält die
abgelaufene Frist als Warnung sichtbar. Bestehende Fristen ohne Beginn behalten
ihr Verhalten. Der Server prüft die Reihenfolge der Zeitpunkte.

Validierung: 95 Worker- und 37 Installer-Tests sowie Installer-Dry-Run erfolgreich.
Keine visuellen Tests. Deployment ausschließlich für `pac-install`;
`pac-test4` und andere bestehende Instanzen werden nicht aktualisiert.
PAC-Vorlagenversion: `edd529288527`.
## Countdown-Einstellungen überarbeitet (17.10.2026)

Countdown und Abgabefrist sind jetzt Schalterkarten mit kurzer Erklärung. Die
Fristfelder erscheinen nur bei aktivierter Abgabefrist in einem verbundenen Bereich;
Abgabe- und Ausblendzeit stehen nebeneinander (unter 520 px untereinander), die
Warnzeit hat die Einheit „Minuten“. Geprüft mit Playwright-Screenshots bei 1280
und 375 px. 93 Worker- und 37 Installer-Tests erfolgreich. Installer veröffentlicht
(Version `1ee48506-20a5-42ff-8598-0c8a11e530f5`), `pac-test4` mit demselben Bundle
aktualisiert; Backup unter `/private/tmp/pac-countdown-design-test4-backup.multipart`.


### Buchungseingabe und Claude-Design wiederhergestellt

Der Zeitraum wird nun in dieser Reihenfolge eingegeben: Startdatum, Startuhrzeit,
Enddatum, Enduhrzeit. Bei leerem Enddatum übernimmt es die Auswahl des Startdatums.
Beide Zeitpunkte sind beim Übernehmen erforderlich. Warnzeit und optionale spätere
Ausblendzeit stehen unter „Weitere Optionen“. Claudes Schalterkarten,
PAC-Kartenlayout und Rückkehr zur Übersicht sind zusammengeführt.
97 Worker- und 37 Installer-Tests erfolgreich; keine visuellen Tests.
Ausschließlich der Installer wird veröffentlicht, test4 bleibt unverändert.

## Darkmode-Korrekturen im Installer (18.10.2026)

Die dunkle Knopf-Regel in `theme.css` gilt nicht mehr für Teilen-Symbol,
„Neues PAC erstellen“, Teilen-Optionen (inkl. „Mehr“) und Schließen-Knopf; diese
behalten ihre gedämpften Farben und Hover-Flächen. 37 Installer-Tests erfolgreich.
Ausschließlich der Installer wird veröffentlicht; die PAC-Vorlage ist unverändert,
daher braucht `pac-test4` kein Update.

## Zusammenführung vergessener Branches (18.10.2026)

Sechs fertige Worktree-Branches waren nie auf `main` und wurden durch Deploys aus
anderen Worktrees überschrieben: Agenda-Sortierung, automatische
Countdown-Übernahme, Update für PACs ohne Version, Tageszeiten, Undo/Redo-Lag,
Versionsnummern/Release Notes – dazu der Darkmode-Fix. Alle zusammengeführt;
104 Worker- und 40 Installer-Tests erfolgreich. Installer veröffentlicht
(Version `015b3825-28e5-4dc8-a57b-f74800991019`, PAC v1.0.0 / Code
`5a692ba7e520`), `pac-test4` über `updatePac` mit demselben Bundle aktualisiert;
Backup unter `~/Documents/ChatGPT/pac-test4-backup-2026-10-18-merge.multipart`.

**Regel:** Erst auf `main` zusammenführen, dann ausschließlich von `main` aus
deployen. Ein Deploy aus einem Worktree-Branch überschreibt alles, was nur auf
`main` oder in anderen Branches liegt.


## Lokale Runtime-Prüfung

`npm run test:runtime` startet eine isolierte lokale workerd-Instanz und führt `scripts/check-runtime.mjs` automatisch gegen deren HTTP-Port aus. OAuth-Tokenaustausch, Konten und Deployment werden simuliert. Geprüft werden PKCE, Callback, Kontenauswahl, Alarm-Deployment, Sitzungsisolation und die tatsächliche `/app`-Anmeldeseite. Es werden keine Cloudflare-Ressourcen angelegt. Die gemeinsame CI führt diesen Test zusätzlich zu den Node-Tests und beiden Dry-Run-Builds aus.

## PAC endgültig löschen

Die angemeldete Verwaltungsübersicht bietet auf jeder PAC-Karte „Löschen“.
Drei Dialogschritte warnen vor dem Verlust, verlangen den exakten technischen
PAC-Namen (zum Beispiel `pac-berlin-2027`) und fragen abschließend nach der
unwiderruflichen Löschung. Abbrechen und Escape beenden den Ablauf.

Die API verlangt eine gültige Cloudflare-Sitzung, das freigegebene Konto,
CSRF, den exakten Namen und eine fünf Minuten gültige, einmal verwendbare
Bestätigung für dieses Konto und PAC. Vor dem Löschen wird die PORTAL-Bindung
geprüft; `pac-install` und fremde Worker werden abgelehnt. Cloudflare löscht
den Worker ohne `force`, sodass Referenzen anderer Worker das Löschen weiterhin
verhindern können. Es gibt keine automatische Wiederholung bei unklarem Ausgang.
Die Worker-Konfiguration wird gelöscht; separat in Nextcloud gespeicherte
Reisedaten und Dateien bleiben erhalten. Es werden keine Nextcloud-Zugangsdaten
an den Installer übermittelt und keine Wolke-Dateien gelöscht.

API-Grundlage: https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/delete/
