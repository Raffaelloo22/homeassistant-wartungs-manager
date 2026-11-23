# Änderungsverlauf

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
