# Audit Raumcast — 30.10.2026

Aktueller Stand: Alle vier Auditbefunde sind behoben. Der folgende Bericht dokumentiert den ursprünglichen Auditstand; die unten beschriebenen ursprünglichen Fehler sind durch Regressionstests abgesichert.

| Befund | Korrektur |
| --- | --- |
| Wechselndes Enter-Ziel | Die Auswahl bleibt an den Empfängernamen gebunden. |
| Verlorene Stop-Möglichkeit | Fehlende oder mehrdeutige Discovery-Daten führen zu „Verbindung nicht bestätigt“. Ziel und Stop-Möglichkeit bleiben erhalten. Nur der bekannte, eindeutig identifizierte Empfänger ohne Sitzung bestätigt das Ende; alternativ beendet ein erfolgreicher Stop die eigene Zuordnung. |
| Blockierte Anfrage nach spätem Startresultat | Eine Operationskennung verhindert, dass Antworten nach einem bereits gemeldeten Ende erneut einen wartenden Zustand erzeugen. |
| Veraltete Prüfung beim Raumwechsel | Direkt nach dem Stop werden Verfügbarkeit, Belegung, Eindeutigkeit und Empfänger-ID erneut geprüft. |

Zusätzlich wird ein Stop an einen inzwischen mehrdeutigen oder durch eine andere ID ersetzten Empfänger verweigert. Die Oberfläche erklärt dann, dass Raumcast geschlossen werden kann, um die eigene Browserübertragung zu beenden. Ein fehlgeschlagener Stop behält das Ziel und ist wiederholbar.

Validierung der Korrekturen: 21 Controller-/Speichertests, TypeScript-Prüfung, erweiterter UI-Test einschließlich Verlust der Discovery während einer Sitzung und das aktualisierte Audit-Skript. Die Hardware- und Plattformgrenzen am Ende dieses Berichts bestehen weiterhin.

Ergebnis: Vier reproduzierte Fehler in Auswahl und Zustandssteuerung. Vor regelmäßigem Unterrichtseinsatz sollten diese behoben werden. Der Anwendungscode wurde für den Audit nicht verändert. Hinzugefügt wurden dieser Bericht und `scripts/audit-repro.ts`.

## P1 — Eine aktualisierte Raumliste ändert das Ziel für Enter

Ort: `ui/app.js:66–68`, `ui/app.js:121–122`.

Die Tastaturauswahl wird als Listenindex gespeichert. Nach einer neuen Discovery-Liste wird neu sortiert; der Index bleibt gleich, obwohl er jetzt einen anderen Empfänger bezeichnet.

Reproduktion im echten Chromium mit simulierten Empfängern: Suche `20`, mit Pfeil nach unten Raum 208 auswählen. Raum 206 neu entdecken. Die Auswahl springt auf 206; Enter startet nachweislich `CWSR206PCWB`.

Auswirkung: Der Bildschirm kann in einem anderen als dem vom Nutzer gewählten Raum erscheinen. Der Systemdialog fragt nach dem Bildschirm und schützt nicht vor dieser falschen Raumwahl.

Abhilfe: Auswahl an die Empfängeridentität binden und beim Rendern erhalten. Verschwindet das gewählte Ziel, eine erneute ausdrückliche Auswahl verlangen. Das gilt auch bei Änderungen von Favoriten oder der Sortierung nach letzter Nutzung.

## P1 — Fehlende Discovery-Daten verwerfen die Kontrolle über die eigene Sitzung

Ort: `src/controller.ts:25–35`, `src/controller.ts:56–57`; Stop-Knopf: `ui/app.js:57`.

Wenn der bisher aktive Empfänger in einem `Cast.sinksUpdated`-Ereignis fehlt, wird sofort `owned = null` gesetzt. Eine fehlende Erkennung wird damit wie eine bestätigte Beendigung behandelt.

Reproduktion: Eigene Sitzung als aktiv melden, danach ein leeres Discovery-Ereignis senden, anschließend `stop()` aufrufen. Es wird kein `Cast.stopCasting` gesendet und der Stop-Knopf verschwindet.

Auswirkung: Bei vorübergehender Nichterkennung geht das bisherige Ziel verloren. Falls die Übertragung tatsächlich noch läuft, lässt sie sich über den normalen Stop-Knopf nicht mehr beenden. Ob AirServer in einer konkreten Netzunterbrechung weiter anzeigt, wurde nicht mit Hardware getestet; der Verlust der Steuerungsmöglichkeit ist im Controller reproduziert.

Abhilfe: Erreichbarkeit und Sitzungszustand getrennt führen. Das eigene Ziel bis zu explizitem Stop oder belastbarer Beendigungsbestätigung behalten. Einen unbestätigten beziehungsweise nicht erreichbaren Zustand mit Beenden/Wiederherstellen anbieten.

## P2 — Ereignisreihenfolge erzeugt einen blockierten Zustand ohne beendbares Ziel

Ort: `src/controller.ts:33–35`, `src/controller.ts:65`, `src/controller.ts:76–82`.

Reproduktion: Einen Startaufruf offen halten. Währenddessen zunächst eine aktive Sitzung und dann deren Ende melden. Anschließend den Startaufruf erfolgreich auflösen. Ergebnis: `phase = 'pending'`, `owned = null`, `busy = false`.

Auswirkung: Neue Starts werden wegen `pending` abgewiesen. Die Oberfläche zeigt keinen Stop-Knopf. Ein Neustart ist nötig, um über die normale Bedienung wieder verbinden zu können. Der Timer schreibt lediglich eine Fehlermeldung und löst die Blockade nicht.

Abhilfe: Startoperationen mit einer Kennung versehen und späte Antworten nur auf die noch aktuelle Operation anwenden. Die Invariante erzwingen, dass ein wartender Start ein Ziel hat. Bereits empfangene Endereignisse dürfen von einer später eintreffenden Startantwort nicht überschrieben werden.

## P2 — Beim Raumwechsel wird die Zielprüfung nach dem Stop nicht erneuert

Ort: `src/controller.ts:66–76`.

Die Prüfung auf Verfügbarkeit, Eindeutigkeit und Belegung erfolgt vor `await stopOwned()`. Während dieses asynchronen Stopps kann sich die Discovery-Liste ändern.

Reproduktion: Während einer eigenen Sitzung den Wechsel zu einem freien Ziel beginnen, die Stop-Antwort verzögern und das neue Ziel inzwischen als belegt melden. Nach der Stop-Antwort wird trotzdem `Cast.startDesktopMirroring` an das inzwischen belegte Ziel gesendet.

Auswirkung: Der zugesagte Schutz für belegte Empfänger greift in diesem Ablauf nicht. Dieselbe veraltete Prüfung betrifft verschwundene oder inzwischen mehrdeutige Ziele. Ob Chromium den Start dann ablehnt oder eine Sitzung ersetzt, hängt vom tatsächlichen Empfänger-/Browserverhalten ab und wurde nicht auf Hardware festgestellt.

Abhilfe: Den aktuellen Zieleintrag nach dem Stop erneut prüfen, unmittelbar vor dem Start. Die unvermeidbare Änderung zwischen Prüfung und Empfängerantwort muss zusätzlich als möglicher Verbindungsfehler behandelt werden.

## Durchgeführte Prüfungen

- `npm run check`: bestanden, einschließlich des Audit-Skripts.
- `npm test`: acht von acht bestanden. Die oben dokumentierten Ereignisfolgen waren dort bislang nicht abgedeckt.
- `npm run test:ui`: beim parallelen Lauf mit einer weiteren Browserprüfung einmal mit einer falschen Suchergebnis-Erwartung gescheitert; beim anschließenden isolierten Lauf bestanden. Ursache dieses einzelnen Testfehlers nicht abschließend ermittelt. UI-Läufe vorerst einzeln ausführen.
- `npm audit --json`: keine gemeldeten bekannten Schwachstellen in den aufgelösten npm-Abhängigkeiten. Das ist keine Aussage über die Sicherheit des installierten Browsers oder aller Programmabläufe.
- Alle vier Befunde über `scripts/audit-repro.ts` bestätigt. Der vierte ausgegebene Befund verwendet echtes Chromium und simulierte Empfänger. Die Controller-Befunde verwenden verzögerbare Transportantworten.

Reproduktion aus dem Projektordner:

```sh
./node_modules/.bin/tsx scripts/audit-repro.ts --demo
```

Das Skript wurde nach den Korrekturen auf die erwarteten fehlerfreien Abläufe umgestellt. Ein erfolgreicher Lauf bestätigt jetzt die Behebung aller vier ursprünglichen Reproduktionen. Die Controller-Abläufe sind zusätzlich als reguläre Regressionstests in `npm test` enthalten. Das Skript verwendet temporäre Datenverzeichnisse und keine echten Empfänger.

## Sicherheits- und Testgrenzen

Positiv geprüft im Code: lokale Prozess-Pipe statt Debugging-Port, eigenes Browserprofil, Darstellung von Empfängernamen per `textContent`, CSP und eingeschränkte lokale Dateiabrufe. Im geprüften Anwendungscode wurde kein direkt reproduzierbarer HTML-Injektionsfehler festgestellt.

Nicht praktisch geprüft: AirServer im Schulnetz, reale Bildschirmdialog-Abbrüche, Verhalten bei tatsächlichen Netzwerkunterbrechungen sowie Windows und macOS. Die Demo beweist Bedienung und Anwendungslogik, aber nicht das Verhalten der echten Cast-Schnittstelle bei diesen Ereignissen.
