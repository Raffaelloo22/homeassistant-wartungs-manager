# Änderungsverlauf

## 1.2.16

- Versionsdatum direkt hinter der Versionsnummer in den Einstellungen ergänzt. Die interne Datenrevision wird dort nicht mehr angezeigt.

## 1.2.15

- Batteriewarnungen in den Gerätekacheln sind kontrastreicher und fett hervorgehoben. Der blassrosa Hintergrund wurde entfernt.

## 1.2.14

- Info-Symbol direkt neben der Fälligkeitsregel im Aufgabenformular ergänzt. Eine aufklappbare Hilfe erklärt alle sieben Regelarten mit Beispielen, ohne eingegebene Formulardaten zu verwerfen.
- Unterschiede bei Einmalaufgaben, offenen Intervallen, Saison-Wochentagen, Messwertgrenzen und Geräteanzeigen erläutert.
- Allgemeine Einstellungen in drei eigene Kacheln für Batteriewarnung, Home-Assistant-Meldung und Währung aufgeteilt.
- Manuelle Gerätezuordnung benötigt wieder eine ausdrücklich gewählte Kategorie. Automatische Namens-/Hersteller-/Modellregeln und die Option «Automatisch zuordnen» entfernt; nicht zugeordnete Geräte erscheinen unter «Ohne Kategorie».

## 1.2.13

- Gerätekacheln zeigen den Batteriestand ohne zusätzlichen Warnschwellentext.
- Ausschliesslich der gemessene Prozentwert erscheint rot, wenn er unter dem aktuellen Schwellenwert liegt. Sensor- und Schwellenwertänderungen aktualisieren die Farbe unmittelbar; unbekannte Werte bleiben neutral.

## 1.2.12

- Verbrauchsmaterial-PDF auf A4-Querformat umgestellt, weiterhin eine kompakte Zeile je Artikel.
- Vor den Geräten erscheint bei Batterien der dynamische Gesamtbedarf aus derselben Berechnung wie in der App, beispielsweise «20 Geräte benötigen 24 Batterien». Unbekannte Mengen bleiben als solche erkennbar.
- Lange Listen behalten einen lesbaren Restzähler; Suche, Zuordnungsfilter, Logo sowie Datum, Uhrzeit und Seitenzahl bleiben erhalten.

## 1.2.11

- Gezielte Änderungsmarkierung für ausgewählte Geräte über die Admin-Schnittstelle. Sie verwendet die aktuelle Home-Assistant-Zeit und verändert ausschliesslich den Änderungszeitstempel; Gerätedaten, Erfassungsdatum und Aufgaben bleiben erhalten.

## 1.2.10

- Gerätefilter «Änderungen» berücksichtigt Erfassungsdatum und letzten Änderungszeitpunkt unabhängig voneinander: gestern erfasst und heute bearbeitet erscheint in beiden Tagesfiltern. Aufgaben und Historie bleiben ausgenommen.
- Neu erfasste Importgeräte ohne Erfassungsdatum erhalten einen Zeitstempel. Mitgelieferte Datierungen und bestehende Geräte bleiben unverändert; eine Datenwiederherstellung wird nicht als neue Erfassung datiert.

## 1.2.9

- Geräte nach Änderungen filtern: heute, gestern, vergangene 7 oder 30 Tage. Aufgaben, Historie und laufende Home-Assistant-Messwerte ändern den Gerätezeitstempel nicht. Ältere Geräte ohne verlässlichen Zeitstempel bleiben unter „Alle“ sichtbar.
- „Duplizieren“ in der Geräteakte: Stammdaten vor dem Anlegen prüfen, eindeutigen Namen erhalten und die Kopie als aktives Gerät speichern. Seriennummer, HA-/Sensorzuordnungen, Geräteverknüpfungen, Aufgaben und Historie werden nicht übernommen; Bestände bleiben unverändert. Wiederholte Speicherversuche erzeugen keine zusätzliche Kopie.

## 1.2.8

- Hinweistext im Verbrauchsmaterial entfernt.
- Gerätezuordnung direkt rechts neben die Artikelanzahl in die gemeinsame Filterleiste verschoben; auf schmalen Bildschirmen passt sich die Zeile an.

## 1.2.7

- Zuordnungsfilter „Gerätezuordnung: Alle | mit | ohne“ für Kacheln, Liste und PDF; der PDF-Export berücksichtigt die Auswahl zusätzlich auf der Serverseite.
- Zusatzzeilen unter dem PDF-Titel entfernt; Datum und Uhrzeit stehen mittig in der Fusszeile jeder Seite.

## 1.2.6

- PDF-Lagerliste verdichtet: eine Schriftfamilie und eine feste Zeile je Artikel, Bestand und Einheit nebeneinander.
- Lange Angaben werden sichtbar gekürzt; Gruppentitel erscheinen nur einmal. Seitenumbrüche teilen keine Materialzeilen mehr.
- Wartungs-Manager-Logo in der Fusszeile jeder PDF-Seite.

## 1.2.5

- PDF-Export der gefilterten Verbrauchsmaterial-Lagerliste, mit Titel, Datum, Gruppen und Seitenzahlen.

- Option „Nicht nachkaufen“ für Batterietypen: automatische Nachkaufaufträge und Nachkaufaktion ausblenden, beispielsweise für Akkus. Die Nachkaufgrenze bleibt für ein späteres Wiedereinschalten erhalten.

## 1.2.4

- Batterietyp im Geräteformular aus den erfassten Typen auswählen; bestehende Sondertypen bleiben erhalten.

- Batteriekacheln zeigen die Anzahl zugeordneter Geräte und den summierten Batteriebedarf, auch auf Smartphones. Unbekannte Mengen werden ausdrücklich gekennzeichnet.

- Optionaler Zuordnungsfilter im Verbrauchsmaterial blendet Batterien und weitere Artikel ohne zugeordnete Geräte aus. Kombinierbar mit der Textsuche in Kacheln und Liste; Bestände und Zuordnungen bleiben erhalten.

## 1.2.3

- Grauer Hintergrund füllt auch bei kurzen oder leeren Ansichten die gesamte Bildschirmhöhe.
- Auswahl des Batterieschwellenwert-Helfers unter die Batteriewarnung verschoben.
- Währung und Meldungseinstellungen speichern geänderte Felder beim Verlassen automatisch.
- Meldungen täglich, wöchentlich oder monatlich planen; bestehende Wochenpläne bleiben erhalten.
- Verbrauchsmaterial innerhalb jeder Listengruppe alphabetisch nach der Bezeichnung sortiert.

## 1.2.2

- Verbrauchsmaterial-Liste in Batterien und weiteres Material gruppiert; die Bezeichnung öffnet direkt das Bearbeitungsfenster.
- Darstellungsumschalter rechtsbündig, Gerätenamen näher an der Bezeichnung und Hinweistext ausschliesslich in der Kachelansicht.
- Sofortiger Jahresfilter im Log, kombinierbar mit der Textsuche.
- Allgemeine Angaben, Batterieschwellenwert und Wochenmeldung direkt in der ersten Einstellungskachel statt in separaten Fenstern.

## 1.2.1

- Kompakte Liste als reine Lagerliste mit Menge, Bezeichnung und zugeordneten Geräten, ohne Aktionsknöpfe und Nachkaufgrenzen. Suche, Artikelanzahl und Darstellungsumschalter stehen in einer gemeinsamen Zeile.

- „Entfernen“ für Batterietypen und weiteres Verbrauchsmaterial in das jeweilige Bearbeitungsfenster verschoben. Kacheln und mobile Aktionsmenüs zeigen nur noch die übrigen Aktionen; die bestehende Sicherheitsabfrage bleibt erhalten.

## 1.2.0

- Sofortige Textsuche im Verbrauchsmaterial, einschliesslich Batterien, Notizen und zugeordneter Geräte.
- Umschalter zwischen Kacheln und einer kompakten Liste mit Beständen, Nachkaufgrenzen und Aktionen.
- Optionale Shop-Links für Batterietypen und weitere Materialien, direkt beim Artikel und bei zugehörigen Nachkaufaufträgen erreichbar.

## 1.1.1

- Konfigurationsschema für die ausschliessliche Einrichtung über Home-Assistant-Geräte & Dienste ergänzt; dadurch entfällt die hassfest-Warnung.
- GitHub-Actions auf die aktuellen Hauptversionen mit nativer Node-24-Laufzeit aktualisiert.
- Testanmeldungen im Home-Assistant-Lebenszyklus über den gespeicherten Refresh-Token erneuern; ungültige neue Zugangsdaten werden sofort als Testfehler gemeldet.
- Geräte-, Aufgaben- und Verbrauchsmaterialdaten sowie vorhandene Funktionen bleiben erhalten.

## 1.1.0

Erste öffentliche Version des Wartungs-Managers.

- Lokales Geräteverzeichnis mit manuellen Geräteakten und Verknüpfungen zu Home-Assistant-Geräten.
- Einmalige, wiederkehrende, saisonale, rotierende und sensorgestützte Wartungsaufgaben, bearbeitbare Historie und Rückgängig-Funktion für Erledigungen.
- Bestand für Batterien und weiteres Verbrauchsmaterial mit Notizen, Zuordnungen, Bestandsabzügen und Nachkaufaufträgen.
- Kompakte Verbrauchsmaterialansicht auf Smartphones, anpassungsfähige Navigation und ausgeglichene Abstände im Kopfbereich.
- Einstellbare Währung für Kosten und auswählbarer Helfer für die Batterieschwelle mit kompatiblen Standardwerten für bestehende Installationen.
- Leerer Anfangsdatenbestand, MIT-Lizenz, mitgelieferte Symbole sowie Einrichtung auf Deutsch und Englisch.
- Paketmetadaten für Marketplace/HACS und automatisierte Veröffentlichungsprüfung.

Die Domäne und der Speichername bleiben `ha_wartung`; vorhandene Wartungsverzeichnisse aus früheren privaten Installationen bleiben erhalten.
