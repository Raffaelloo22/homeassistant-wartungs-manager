# Mitwirken

Halte Änderungen überschaubar und beschreibe das konkrete Problem, das daraus entstehende Verhalten und die durchgeführten Prüfungen. Eröffne vor einer grösseren Umgestaltung oder einer Änderung des Datenformats ein Issue.

## Entwicklung

Die Integration liegt in `custom_components/ha_wartung`. Das Dashboard verwendet native Web Components und benötigt keinen Frontend-Build. Die unabhängige Fachlogik steht in `engine.py`.

Python- und Frontend-Regressionstests ausführen:

```sh
python3 -m unittest discover -s tests -q
for testfile in tests/test_frontend_*.cjs; do node "$testfile"; done
node --check custom_components/ha_wartung/frontend/panel.js
```

Verwende für Integrationstests und Browserprüfungen eine separate, entbehrliche Home-Assistant-Instanz. Führe Tests nicht gegen eine produktive Haushaltsinstanz aus. GitHub Actions führt die Veröffentlichungsprüfung, die Python- und Frontend-Tests sowie die in den Workflow-Dateien konfigurierten Home-Assistant-Lebenszyklustests aus.

Die Lebenszyklustests mit Docker und einem offiziellen Home-Assistant-Image starten:

```sh
python3 scripts/test_ha_lifecycle.py --version 2026.11.2
```

Das Testskript erstellt eine isolierte temporäre Konfiguration, bindet den Zugriff ausschliesslich an localhost, prüft Installation, Neustart, Aktualisierung und erneute Einrichtung und entfernt anschliessend den Testcontainer. Mit `--keep` bleibt die Umgebung mit erfundenen Testdaten für Browserprüfungen erhalten.

Behalte die Domäne `ha_wartung` und die Kompatibilität mit gespeicherten Daten bei. Neue Einstellungen benötigen Standardwerte, die bestehende Installationen erhalten. Ändere Geräte-, Entitäts- oder Helferkennungen nicht automatisch.

## Testdaten und Meldungen

Verwende erfundene Namen, Beispielkennungen und reservierte Beispiel-URLs. Nimm keine echten Exporte, `.storage`-Dateien, Zugriffstoken, Gerätefotos oder Bildschirmfotos aus einem Haushalt ins Repository auf. Tests sollen das Verhalten prüfen und nicht lediglich die Implementierung nachbilden.

Prüfe bei Änderungen am Dashboard sowohl eine schmale Smartphone-Ansicht als auch eine Desktop-Ansicht. Bedienelemente müssen mit Tastatur und Touch funktionieren; endgültige Änderungen benötigen eine klare Bestätigung.

## Veröffentlichungen

Tag, Manifest-Version und Laufzeitversion müssen übereinstimmen. Führe vor einem Antrag auf Katalogaufnahme die HACS- und hassfest-Prüfungen ohne übersprungene Validierungen aus. Veröffentliche einen vollständigen GitHub-Release und nicht nur einen Tag. Änderungen für Nutzerinnen und Nutzer stehen in [CHANGELOG.md](CHANGELOG.md).

Mit einem Beitrag erklärst du dich einverstanden, dass er unter der MIT-Lizenz dieses Repositorys veröffentlicht wird. Behalte Urheberrechts- und Lizenzhinweise für Material Dritter bei.
