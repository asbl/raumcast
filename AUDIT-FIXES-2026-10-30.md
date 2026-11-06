# Umsetzung der Auditkorrekturen – 30.10.2026

Die sieben Befunde aus `AUDIT-IMPLEMENTATION-2026-10-30.md` sind im lokalen Quellstand korrigiert. Der ursprüngliche Bericht bleibt als Beschreibung des geprüften Ausgangsstands erhalten.

| Befund | Korrektur | Nachweis |
| --- | --- | --- |
| A1: Stop kann nach Discovery-Verlust eine fremde Sitzung treffen | Audio-Stop verwendet einen eigenen Transportbefehl. Nach einem Discovery-Verlust wird die Aufnahme angehalten, die eigene Mediensitzung einschließlich Kennung bleibt für Stop erhalten. Kein Rückfall auf `Cast.stopCasting` nach Empfängernamen. Wiederentdeckte fremde Sitzungen bestätigen die eigene Wiedergabe nicht. | Controller und tatsächlicher Transport mit simuliertem CDP: Verlust, Fremdbelegung und Stop ohne generischen CDP-Stop. |
| A2: Falscher Wiedergabestatus | Audiozustände sind an die konkrete Startoperation gebunden. Erst `PLAYING` aktiviert die Übertragung. `BUFFERING` wird separat angezeigt; `IDLE/FINISHED` und andere bestätigte Medienenden beenden die Zuordnung. Fehler ergeben einen unbestätigten Zustand mit Stop-Möglichkeit. Alte Ereignisse einer vorherigen Operation werden ignoriert. | Controller-/Medienclienttests einschließlich Ladefehler, später Ereignisse und Medienende. |
| A3: Stop nicht wiederholbar | Fehlgeschlagene Stop-Promises werden nicht dauerhaft gespeichert. Bei einem erneuten Versuch wird neu verbunden und ausschließlich die gespeicherte eigene Sitzungs-ID an `STOP` übermittelt. Ungültige Antworten werden als Fehler behandelt. | Simulierter Fehler beim ersten Stop, erfolgreiche Wiederholung über neuen Client; beide Nachrichten verwenden nur `own-session`. |
| A4: Anzeige und Datei widersprechen sich nach Schreibfehler | Einstellungen werden erst nach erfolgreichem Schreiben und atomarem Umbenennen veröffentlicht. Wartende Änderungen bauen auf dem zuletzt bestätigten Stand auf. `flush()` meldet einen offenen Schreibfehler bis zum erfolgreichen Retry. Browser und Aufnahme werden auch bei einem Speicherfehler beim Beenden geschlossen. | Erzwungener Schreibfehler, unveränderter bestätigter Speicher, fehlgeschlagenes `flush()`, danach erfolgreiche serielle Wiederholung und Dateivergleich. |
| A5: Temporäres statt dauerhaftem Browserprofil | Das eigene Profilverzeichnis wird ausdrücklich als `--user-data-dir` an Chromium übergeben, auch bei `ignoreDefaultArgs: true`. | Reale Browserargumente im Audit-Regressionslauf. |
| A6: Keine Wiederholung nach Initialisierungsfehler | „Suchen“ bleibt für einen erneuten Initialisierungsversuch verfügbar. Bei Erfolg wird der Fehler gelöscht. Initialisierung und Fehler haben eigene Statusanzeigen; lokale Einstellungen bleiben bedienbar. | Im echten Browser scheitert nur das erste `Cast.enable`; Klick auf „Suchen“ stellt die Bereitschaft ohne Neustart her. |
| A7: Veraltete Lautstärke und unerwartete Sprünge | Tastaturfokus unterbindet Statusabfragen nicht mehr; nur aktives Ziehen pausiert sie. Relative Tasten-/Pfeilschritte lesen vor dem Setzen den aktuellen Receiver-Wert und werden seriell angewendet. Stummschalten liest ebenfalls den aktuellen Zustand. Fehlgeschlagene Eingaben zeigen wieder den bestätigten Wert. | Browsertest mit externer Änderung von 25 auf 10 % während Reglerfokus: nächster Schritt ist 10,5 %. Eine weitere Änderung vor dem nächsten Poll wird ebenfalls richtig berücksichtigt. Backendtest für serielle relative Änderungen. |

## Testabdeckung

- `npm test`: 46 Tests; unter anderem neue `test/audit-regressions.test.ts` und erweiterte Medienclienttests.
- `npm run test:audit`: die Audit-Reproduktion prüft jetzt das korrigierte Verhalten, einschließlich echter Browserprüfungen für A5–A7. Es werden keine physischen Empfänger angesteuert.
- `npm run test:audio`: echte Aufnahme, produktiver MP3-Zweig mit Vorlauf und stummgeschaltete Browserdekodierung; Lautstärkebridge simuliert. Der zuvor geprüfte WAV-Zweig ist damit nicht mehr der einzige Audio-Smoke-Nachweis.
- `npm run test:ui`: Desktop- und Audioabläufe, Neustart der Oberfläche, Suche und Präferenzen mit Demo-Empfängern. Die Testseite wird vor der Bedienung und nach dem Neuladen aktiviert. Browserprüfungen laufen nacheinander.
- TypeScript-Prüfung und Produktionsbuild; Linux-Paketbau und Start des entpackten Pakets.
- Die CI enthält zusätzlich `test:audit` und `test:audio`; für den Audiotest wird eine virtuelle PulseAudio-Ausgabe angelegt. Der geänderte GitHub-Workflow wird erst mit einem zukünftigen CI-Lauf selbst ausgeführt.

## Verbleibende Grenzen

Der Musikstream bleibt MP3 mit Receiver-Pufferung und ist weder verlustfrei noch verzögerungsfrei. Die Audiofunktion bleibt Linux-spezifisch. Ein Hör-/Langzeittest, echte Netzwerkabbrüche und die Bedienung konkurrierender physischer Sender sind durch die simulierten Fehlerfälle nicht vollständig ersetzt. Windows/macOS sowie Schul-AirServer wurden für diese Korrektur nicht praktisch neu geprüft.

Die Änderungen und Pakete sind lokal; dieser Umsetzungsschritt veröffentlicht keinen GitHub-Release.
