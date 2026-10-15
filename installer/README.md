# PAC Installer

Öffentliche Adresse: https://pac-install.linusleupold.workers.dev

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

```sh
npm ci
npm test
npm run build
npm run deploy
```

Der Build verwendet ausschließlich die bereinigte Demo-Vorlage. Bei mehreren Betreiberkonten `CLOUDFLARE_ACCOUNT_ID` setzen. `RATE_SALT` kann als Secret die IP-Hashes zusätzlich salzen. Die echte Wolke-Konfiguration und persönliche Teilnehmerdaten werden nicht eingebaut.

## Sitzungen und Bereitstellung

- Secure-/HttpOnly-/SameSite-Lax-Cookie, eigener SQLite Durable Object pro Sitzung. Lax erlaubt die Rückkehr vom Cloudflare-Login.
- CSRF und Origin-Prüfung für schreibende API-Anfragen. OAuth-State und PKCE-Verifier werden nur serverseitig gespeichert. State wird vor dem Tokenaustausch verbraucht.
- Kontoauswahl wird gegen die von Cloudflare gelieferte Kontoliste geprüft. Es werden bis zu 50 zugängliche Konten angezeigt.
- Neue Worker heißen `pac-<12 zufällige Hexzeichen>`. Vorhandene Scripts werden nicht überschrieben. Bei einer unklaren Upload-Unterbrechung erfolgt kein automatischer Neuversuch.
- Tokens werden nach Erfolg, Fehler oder Ablauf aus der Sitzung gelöscht, spätestens nach einer Stunde. Keine Refresh-Tokens werden angefordert. Cloudflare-Grants lassen sich zusätzlich im eigenen Konto widerrufen.
- Drei Login-Starts pro IP-Hash und Stunde, 20 global. Kein Logging von Codes, Tokens oder API-Antworten; Observability deaktiviert.
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
