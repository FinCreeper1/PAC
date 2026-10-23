# PAC-Versionen

Jede Version beginnt mit `## vX.Y.Z`. Der Text darunter erscheint im Installer und
im Adminbereich als Update-Hinweis und wird mit `npm run release` als GitHub-Release
veröffentlicht. Kurz und für Lehrkräfte verständlich schreiben.

## v1.1.16

- Einrichtung mit klar getrennten Schaltflächen, hervorgehobenem Abschluss und geordneter Anordnung auf kleinen Bildschirmen.
- Wolke-Zugangsdaten heißen jetzt „App-Benutzername“ und „App-Passwort“.

## v1.1.15

- Einrichtung in drei Schritten mit separater Wolke-Prüfung und Anleitung für die ersten Schritte als Reiseleitung.
- Klarere Anmeldungen und Hinweise zu Offline-Speicherung, Kalenderabo und dem Neuladen veröffentlichter Pläne.
- Änderungen vor dem Veröffentlichen zusammengefasst; verständliche Fehlermeldungen und Hinweise bei fehlenden Voraussetzungen für Reiseideen.

## v1.1.14

- Kurzer Hinweis am Speichern-Button; die Erklärung zu Entwurf und Veröffentlichung lässt sich mit „Was bedeutet das?“ aufklappen.

## v1.1.13

- Termine mit „Speichern“ zuerst in den Entwurf übernehmen. Erst „Veröffentlichen“ macht den geänderten Reiseplan für Teilnehmende sichtbar; klare Hinweise erklären beide Schritte.

## v1.1.12

- Rechnungen übersichtlicher bearbeiten: Rechnungsbetrag und Zahlungen zusammen, offener Betrag direkt sichtbar, „Vollständig bezahlt“ zum Übernehmen des Gesamtbetrags und gemeinsame Speicheraktionen. Zahlungsstatus ohne Textüberlauf; bestehende Zahlungen lassen sich über den Status bearbeiten.

## v1.1.11

- Budgetfelder in Rechenreihenfolge: Maximalbetrag pro Schüler, Schülerzahl, Gesamtbudget. Speichern und Abbrechen bleiben im breiten Formular nebeneinander.

## v1.1.10

- Rechnungsbudget aus Maximalbetrag pro Schüler und Schülerzahl automatisch berechnen. Der Kategorienbalken zeigt auch den noch freien Betrag und dessen Anteil am Budget.

## v1.1.9

- PDF-Gesamtplan und Tagesplan verwenden dieselben Terminfarben wie der Reiseplan, einschließlich Bahnfahrten, Freizeit und vorläufiger Termine.

## v1.1.8

- Drucken und PDF-Speichern kompakt unter dem Reiseplan aufklappen; Tagesplan und Gesamtplan gemeinsam erreichbar. Auch die Demo bietet den Gesamtplan als PDF an.

## v1.1.7

- Ruhige, durchgehende Videoanleitungen mit sanften Zooms. Im Setup direkt an den passenden Wolke-Feldern aufklappbar; die Infoseite erklärt jeden Schritt neben dem Video.

## v1.1.6

- Die Einrichtung erklärt WebDAV-Adresse, Benutzername und App-Passwort mit kurzen Videos inklusive Zooms, Texthinweisen und Pause-/Spulfunktion.

## v1.1.5

- Bahnverbindungen über Mitternacht importieren: automatische Aufteilung auf die Reisetage, vollständige Zugabschnitte mit Datum und passende Live-Abfragen auch am Folgetag.

## v1.1.4

- Gesamten Reiseplan zusätzlich als Kalenderansicht drucken oder als PDF sichern: Wochenraster im Querformat mit allen Terminen, Uhrzeiten und Orten.

## v1.1.3

- Rechnungen mit Teilzahlungen, bezahltem Betrag und Restbetrag; offene Summe und CSV-Export berücksichtigen Anzahlungen. Reisekosten und Budget werden auf der Startseite vorgestellt.

## v1.1.2

- Neu gestalteter Tagesplan-Ausdruck: übersichtliche Zeitspalte, hervorgehobene Treffpunkte und Hinweise sowie Bahnverbindungen als Tabelle. Die Druckauswahl im Reiseplan ist aufgeräumter.

## v1.1.1

- Tagespläne für einzelne oder alle Reisetage drucken und über den Druckdialog als PDF sichern, inklusive Orten, Treffpunkten, veröffentlichten Hinweisen und Bahnverbindungen.

## v1.1.0

- Der Reiseplan bleibt während langsamer Uploads und Speichervorgänge abrufbar; größere Dateilisten werden schneller geladen.
- Unter Einstellungen lassen sich alle Geräte abmelden. Passwortänderungen beenden bestehende Sitzungen; Teilnehmende bleiben höchstens 14 Tage ohne Onlineaktivität angemeldet. Nach diesem Update ist einmalig eine neue Anmeldung erforderlich.
- Beschädigte Notiz- und Budgetdaten werden geschützt und nicht durch leere Werte überschrieben.
- Uploads erklären eine Überschreitung des Cloudflare-Größenlimits. Update- und Wiederherstellungsanleitungen sind aktualisiert.

## v1.0.22

- Auf den PAC-Anmeldeseiten führt ein zusätzlicher Button direkt zum Admin- bzw. normalen Login.

## v1.0.21

- Die PAC-Demo zeigt einen eigenen Versionshinweis. Der Update-Button ist dort ausgegraut und deaktiviert.

## v1.0.20

- Bahnhöfe wie Hamburg-Sülldorf werden auch erkannt, wenn die Fahrplansuche Stadt und Bahnhof getrennt führt. Bindestriche und Leerzeichen werden bei der Suche berücksichtigt.

## v1.0.19

- Bahnhöfe wie Aachen West werden auch dann erkannt, wenn mehrere Fahrplananbieter unterschiedliche Kennungen für denselben Bahnhof liefern. Hinweise bei nicht gefundenen oder mehrdeutigen Bahnhöfen sind genauer.

## v1.0.18

- Beim Bearbeiten eines Termins führt das Formular nach vollständigen Uhrzeiten zur Bestätigung und anschließend direkt zum Ort. Nach der Ortsauswahl folgen die weiteren Angaben.

## v1.0.17

- Die Punkte der Zugreise-Zeitleiste sitzen jetzt mittig auf der Linie.

## v1.0.16

- Übernommene Zugreisen erscheinen als Zeitleiste: Abfahrts- und Ankunftszeiten mit Bahnhof und Gleis, dazwischen der Zug mit Fahrtdauer und markierte Umstiege mit Wartezeit.

## v1.0.15

- Gefundene Zugverbindungen erscheinen als übersichtliche Karten: Abfahrt und Ankunft groß, Reisedauer und Zahl der Umstiege als Hinweis, darunter Züge mit Zeiten und Umstiegsbahnhöfe mit Wartezeit. Die ganze Karte ist anklickbar.

## v1.0.14

- Wiederholte identische Verbindungssuchen zeigen das zuletzt gefundene Ergebnis. Die Wartezeit zwischen verschiedenen Suchen wird mit Countdown angezeigt. Fehler der Fahrplansuche werden konkret benannt und nicht mehr als unvollständiger Teilentext ausgegeben.

## v1.0.13

- Zugreisen einfacher übernehmen: Text aus „Teilen“ einfügen, die passende Verbindung mit Umstiegen auswählen und speichern. Die Suche nutzt wieder Transitous. Zusätzliche Suchfelder und manuelle Zugdaten sind eingeklappt; fehlende Angaben werden bei Bedarf eingeblendet.

## v1.0.12

- Eine rote Linie im Wochenplan zeigt am heutigen Tag die aktuelle Uhrzeit.

## v1.0.11

- Die Fahrplansuche nutzt jetzt transport.rest ohne API-Key oder Transitous-Freigabe. Gefundene Verbindungen werden zur Auswahl angezeigt. Bei Ausfällen bleibt die Textübersicht mit Hinweis nutzbar.

## v1.0.10

- Fahrtdaten werden zuerst direkt aus dem eingefügten Text gelesen und vor der Übernahme zur Prüfung angezeigt. Vollständige Zugabschnitte bleiben getrennt; bei Übersichten wird auf fehlende Umstiege hingewiesen. Eine Fahrplansuche erfolgt nur bei unvollständigen Angaben.

## v1.0.9

- Ohne freigeschalteten Transitous-Import wird die Zugreise direkt aus dem Teilen-Text angelegt (Abfahrt, Ankunft, Gleise, Züge) – ganz ohne externe Abfrage.

## v1.0.8

- Der Teilen-Text aus dem DB Navigator („• von …, Abfahrt … / • nach …, Ankunft …“) wird jetzt vollständig erkannt.

## v1.0.7

- Zugreisen anlegen geht jetzt per Einfügen: Bahn-Link oder den Text aus „Teilen“ bzw. einer Buchungsmail einfügen – Start, Ziel, Tag, Abfahrt und Züge werden erkannt, die Verbindung wird automatisch gesucht und bei eindeutigem Treffer direkt übernommen.

## v1.0.6

- Beim Laden einer Karte steht jetzt „Karte wird geladen …“ statt „Apple Maps wird geladen …“, auch wenn OpenStreetMap eingestellt ist.

## v1.0.5

- Die leere Ecke über der Zeitspalte im Wochenplan passt jetzt zur Kopfzeile.

## v1.0.4

- Abmelden meldet wieder zuverlässig ab und behält den Dunkelmodus.

## v1.0.3

- „Abmelden und Offline-Daten löschen“ führt jetzt sofort zur Anmeldeseite, ohne Neuladen.

## v1.0.2

- Hochgeladene Dateien werden sicherer abgeschirmt ausgeliefert.
- Robusterer Umgang mit gespeicherten Daten und kurzzeitigen Nextcloud-Störungen.
- Kürzere Installer-Texte, neue Datenschutzseite und korrigierte Changelog-Box.

## v1.0.1

- Wiederhergestellte Funktionen in einem gemeinsamen Stand zusammengeführt.
- Tagesansicht mit heutigem Tag, kommenden Tagen und eingeklappten vergangenen Tagen.
- Countdown-Einstellungen werden automatisch in den Entwurf übernommen.
- Tagesbeginn und Tagesende in Einrichtung und Reiseeinstellungen anpassbar.
- Flüssigeres Rückgängigmachen und Wiederholen im Kalender.
- Verbesserte mobile Installer-Ansicht und Schaltflächen im Dunkelmodus.
- Update-Angebot auch für bestehende PACs ohne Versionsangabe.

## v1.0.0

- Verständliche Versionsnummern wie v1.0.0 statt Prüfsummen.
- Update-Hinweise erscheinen direkt im Adminbereich und im Installer.
- Termine lassen sich auch ohne Ort und Karte speichern.
- Neue Reisen nutzen OpenStreetMap ohne zusätzlichen Kartenschlüssel.
- Teilnehmende einzeln bearbeiten und entfernen.
