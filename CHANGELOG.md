# Änderungsverlauf

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
