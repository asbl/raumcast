# Audit der vollständigen Raumcast-Umsetzung – 30.10.2026

> Nachtrag: Die sieben Befunde sind inzwischen korrigiert. Umsetzung und aktuelle Prüfungen stehen in [AUDIT-FIXES-2026-10-30.md](AUDIT-FIXES-2026-10-30.md). Der folgende Bericht beschreibt den ursprünglichen Auditstand. Das Reproduktionsskript prüft jetzt die erwarteten Korrekturen.

## Ergebnis

**Sieben reproduzierte Befunde: einmal P1 und sechsmal P2.** Vor einer Freigabe für den regelmäßigen Einsatz sollten insbesondere die Sitzungszuordnung und die Synchronisierung der Lautstärke korrigiert werden. Erfolgreiche Standardtests belegen diese Fehlerfreiheit derzeit nicht.

Für diesen Audit wurde kein Anwendungscode geändert. Hinzugefügt wurden dieser Bericht und `scripts/audit-complete-repro.ts`. Die laufende Onkyo-Verbindung wurde weder beendet noch umgestellt. Reproduktionen verwenden simulierte Empfänger und temporäre Daten. Der echte Audio-Smoke-Test erfasst die lokale Ausgabe zur stummgeschalteten Browserdekodierung, sendet jedoch nichts an einen Receiver.

## Geprüfter Stand und Umfang

- Basis: Commit `99625ab` plus sämtliche lokalen Änderungen, einschließlich bislang ungetrackter Anwendungsmodule. Der Commit allein enthält die neuen Funktionen nicht.
- Arbeitskopie: `/home/sbl/code-git/raumcast`.
- Tatsächlich gestartete Kopie: `/home/sbl/code/git/raumcast`. `src/` und `ui/` sind beim Audit identisch. Deren bestehende Auditdateien wurden nicht überschrieben.
- Laufzeit: Linux, Node.js `v26.8.1`, Chromium `155.0.8059.79`. Das portable Paket wurde zusätzlich mit seiner enthaltenen Node-Laufzeit geprüft.
- Umfang: Discovery und automatische Moduswahl, Desktopsteuerung, Audioaufnahme und MP3-Pufferung, direkter Cast-Medienclient, HTTP-Zugriffsschutz, Receiver-Lautstärke, beide Oberflächen, Einstellungen, Start-/Stop-/Fehlerabläufe, Browserstart, Abhängigkeiten, Paketierung und CI-Konfiguration.
- Fingerabdruck des Anwendungscodes: `9f56691e7f823556d6470e8d3c391cd036ef3855fcb24991286237b23c88f3c7`, ermittelt mit `sha256sum src/*.ts ui/* package.json package-lock.json | sha256sum` vor Hinzufügen dieses Berichts. Audit- und Testskripte sind darin nicht enthalten.

## A1 – P1: Nach Verlust der Audiozuordnung kann Stop eine fremde Sitzung treffen

**Orte:** `src/controller.ts:50`, `src/controller.ts:63`, `src/controller.ts:99`; `src/cast-support.ts:57`, `src/cast-support.ts:65`, `src/cast-support.ts:164`.

**Auslöser:** Eine eigene Audiositzung ist aktiv. Discovery verliert den Empfänger. Der Controller behält `owned`, gibt aber über `releaseSystemAudio()` das direkte Medienobjekt einschließlich seiner eigenen Sitzungszuordnung frei. Danach wird derselbe Empfänger mit einer anderen Sitzung wiederentdeckt.

**Nachweis:** Die Reproduktion benutzt den echten Controller und `ChromiumCastTransport` mit einem simulierten CDP-Kanal. Die neue fremde Sitzung führt erneut zu `phase = active`. Beim anschließenden Stop fehlt das direkte Audioobjekt; der Transport fällt auf `Cast.stopCasting` nur mit `sinkName` zurück. Der generische Stop-Aufruf wird nachweislich gesendet. Er bezeichnet nicht mehr die zuvor gestartete eigene Mediensitzung.

**Auswirkung:** Der Schutz vor dem Beenden anderer Übertragungen ist in diesem Ablauf nicht gewährleistet. Im Audit wurde keine reale fremde Sitzung beendet; belegt ist der dafür falsche Steuerungsaufruf.

**Empfehlung:** Geräteidentität und eigene Sitzungsidentität getrennt behalten. Nach Freigabe einer direkten Sitzung keinen generischen Stop für eine inzwischen andere Sitzung verwenden. Eine wiederentdeckte beliebige Sitzung darf nicht automatisch als eigene gelten.

## A7 – P2: Veraltete Lautstärke kann unerwartet große Sprünge erzeugen

**Orte:** `src/audio-controls.ts:49`, `src/audio-controls.ts:60`.

**Auslöser:** Der Lautstärkeregler hat den Tastaturfokus. Eine Fernbedienung oder eine andere Anwendung verändert die tatsächliche Receiver-Lautstärke.

**Nachweis im echten Chromium mit simuliertem Receiver:** Ausgangswert 25 %. Regler fokussieren, Gerätewert auf 10 % ändern und länger als das dreisekündige Abfrageintervall warten. Es erfolgt keine Statusabfrage, der Regler bleibt auf 25 %. Ein Klick auf `+0,5 %` sendet anschließend **25,5 % statt 10,5 %**.

**Auswirkung:** Die Anzeige kann dauerhaft veraltet bleiben, und eine vermeintlich kleine Änderung kann den Receiver erheblich lauter stellen als erwartet. Dafür ist keine Netzwerkstörung erforderlich; normaler Tastaturfokus genügt.

**Empfehlung:** Abfragen nur während einer tatsächlichen Bearbeitung kurz aussetzen, nicht solange das Element fokussiert ist. Externe Änderungen nachführen und relative Änderungen auf einen aktuellen bestätigten Wert beziehen. Bei fehlgeschlagenem Setzen den bestätigten Wert klar vom gewünschten Wert unterscheiden.

## A2 – P2: Receiver-App und tatsächliche Musikwiedergabe werden verwechselt

**Orte:** `src/controller.ts:50`; `src/direct-audio.ts:56`; `src/cast-support.ts:156`.

**Auslöser:** Der Receiver meldet bereits eine laufende Default-Media-Receiver-App, während `DirectCastAudio.start()` noch auf `PLAYING` wartet.

**Nachweis:** Ein offener Audiostart wird simuliert. Ein Sink-Ereignis mit einer Sitzung setzt den Controller sofort auf `active`, obwohl der Startaufruf noch läuft. Scheitert dieser danach, bleibt `phase = active` bestehen. Zusätzlich wird `IDLE` mit `idleReason = FINISHED` nach einem erfolgreichen Start zwar im direkten Medienobjekt gespeichert, aber nicht an den Controller gemeldet.

**Auswirkung:** Die Oberfläche kann „Computerton wird übertragen“ melden, obwohl der Stream noch lädt, fehlgeschlagen oder bereits beendet ist. Der Unit-Test, der in `DirectCastAudio` auf `PLAYING` wartet, schützt die darüberliegende Zustandssteuerung nicht.

**Empfehlung:** Für Audio eigene transportierte Medienereignisse verwenden: Start erst bei bestätigtem `PLAYING`, Nachpuffern als `BUFFERING`, Ende und Fehler explizit an den Controller melden. Eine bloß gestartete Receiver-App ist keine Wiedergabebestätigung.

## A3 – P2: Ein fehlgeschlagener Audio-Stop ist nicht wiederholbar

**Orte:** `src/direct-audio.ts:80`, `src/direct-audio.ts:90`; `src/cast-support.ts:61`.

**Auslöser:** Die erste Stop-Anfrage scheitert oder läuft in das Zeitlimit.

**Nachweis:** Ein simulierter Client beantwortet den ersten Stop mit einem Fehler und würde den zweiten erfolgreich beantworten. Zwei Aufrufe von `DirectCastAudio.stop()` liefern denselben ersten Fehler; tatsächlich wird nur eine Anfrage gesendet. `stopping` speichert auch die abgewiesene Promise dauerhaft, und `finally` schließt den Client.

**Auswirkung:** Erneutes Drücken von „Beenden“ kann den Fehler nicht beheben. Die lokale Aufnahme wird zwar beendet, eine Bestätigung des Receiver-Stopps bleibt aber aus. Der Controller-Test für wiederholbaren Stop verwendet einen vereinfachten Transport und deckt diese konkrete Implementierung nicht ab.

**Empfehlung:** Fehlgeschlagene Stop-Operationen nicht dauerhaft als abgeschlossene Operation zwischenspeichern. Die eigene Sitzungskennung bis zur Beendigungsbestätigung bewahren und einen erneuten Verbindungs-/Stopversuch ausschließlich für diese Sitzung ermöglichen.

## A4 – P2: Fehlgeschlagenes Speichern lässt Anzeige und Datei auseinanderlaufen

**Orte:** `src/storage.ts:34`, `src/storage.ts:44`, `src/storage.ts:47`.

**Auslöser:** Favorit oder Alias wird geändert, das Schreiben scheitert etwa wegen eines nicht beschreibbaren oder ungültigen Pfads.

**Nachweis:** Im temporären Verzeichnis wird ein reguläres File als vermeintliches Elternverzeichnis verwendet. `update()` scheitert reproduzierbar. `store.value` enthält den neuen Favoriten trotzdem. Ein anschließendes `flush()` meldet Erfolg, da die Fehler-Promise für die Schreibkette abgefangen wurde.

**Auswirkung:** Die Oberfläche zeigt eine nicht gespeicherte Einstellung; nach Neustart fehlt sie. Beim Beenden wird der fehlgeschlagene Schreibzustand nicht erneut erkennbar.

**Empfehlung:** Bestätigten Speicherzustand und gewünschte Änderungen getrennt führen beziehungsweise eine fehlgeschlagene Änderung revisionssicher zurücknehmen. Schreibfehler für `flush()` und die Oberfläche nachvollziehbar erhalten.

## A5 – P2: Das konfigurierte dauerhafte Browserprofil wird nicht verwendet

**Ort:** `src/main.ts:39`.

**Nachweis:** Beim echten Browserstart wird `userDataDir = <Datenverzeichnis>/browser-profile` übergeben. Wegen `ignoreDefaultArgs: true` geht dieses Argument nicht in die erzeugte Befehlszeile ein. Die tatsächlich gestarteten Argumente enthalten stattdessen `--user-data-dir=/tmp/puppeteer_dev_chrome_profile-…`. Das wurde an der von `launch()` gestarteten Browserinstanz gemessen und im installierten Puppeteer-Code nachvollzogen.

**Auswirkung:** Browsereinstellungen und Freigaben werden entgegen der Dokumentation nicht im vorgesehenen Profil erhalten. Mehrere Instanzen werden außerdem nicht durch dieses vorgesehene gemeinsame Browserprofil begrenzt. Die normalen Raumpräferenzen in `rooms.json` sind davon unabhängig. Es wird weiterhin ein separates temporäres Profil genutzt, nicht das normale Firefox-/Chromium-Profil.

**Empfehlung:** Das gewünschte `--user-data-dir` bei vollständig eigenen Startargumenten ausdrücklich setzen und die tatsächlichen Startargumente in einem Regressionstest prüfen.

## A6 – P2: Nach einem vorübergehenden Initialisierungsfehler ist kein erneuter Versuch möglich

**Orte:** `src/main.ts:69`, `src/main.ts:90`; `ui/app.js` beim Deaktivieren der Suche.

**Nachweis im echten Chromium mit Demo-Transport:** Nur das erste `Cast.enable` schlägt fehl. Ein späterer direkter `Cast.enable`-Aufruf funktioniert. Der UI-Befehl `refresh` wird dennoch schon an `initializationError` abgewiesen; der Suchknopf bleibt deaktiviert.

**Auswirkung:** Eine vorübergehende Störung macht die Anwendung bis zum Neustart unbenutzbar. Favoriten-/Aliasbefehle werden ebenfalls blockiert. Das Problem war bereits im vorhandenen zweiten Release-Audit der gestarteten Projektkopie beschrieben und ist weiterhin vorhanden.

**Empfehlung:** Einen erneuten Initialisierungsversuch erlauben und bei Erfolg den Fehler zurücksetzen. Während eines Initialisierungsfehlers keinen normalen Bereitschaftsstatus anzeigen.

## Test- und Architekturgrenzen

- `npm run test:audio` ruft `serveSystemAudio()` ohne Receiver-Parameter auf. Dadurch wird der lokale **WAV-Zweig** geprüft. Der produktive **MP3-Zweig mit Netzwerkadresse, 80-kB-Vorlauf und Receiver-HTTP-Client** ist damit nicht als Gesamtstrecke geprüft.
- Die CI führt diesen Audio-Smoke-Test überhaupt nicht aus. Der Browser-UI-Test verwendet Demo-Geräte; der Paket-Browsertest ebenfalls. Die Controller-, direkten Medienclient- und Zugriffskontrolltests prüfen sinnvolle Teilverträge, aber nicht deren vollständiges Zusammenspiel. A1–A3 sind Beispiele für die verbleibenden Lücken.
- Automatische Moduswahl und Desktop-Vorabprüfung hängen von einer internen Chromium-Diagnoseseite und deren JSON-Struktur ab. Der Code verweigert bei unbestätigten Daten den Start, die Kompatibilität mit anderen Browserständen bleibt aber zu prüfen.
- Computerton wird nur unter Linux unterstützt und benötigt externe Audioprogramme. Die Pakete enthalten diese nicht. Die gestartete Standardausgabe wird erfasst; später anders geroutete Anwendungen oder ein geänderter Standardausgang werden nicht automatisch nachgeführt.
- Der Musikweg ist MP3 mit 320 kbit/s, nicht verlustfreies Tidal-HiRes. Der 80-kB-Vorlauf entspricht ungefähr zwei Sekunden, erklärt aber nicht die gesamte Verzögerung: Hinzu kommen Decoder-/Receiverpuffer und der Start der Receiver-App. Der Regler steuert den Cast-Gerätewert, keine zugesicherte dB-Kalibrierung.
- Der HTTP-Musikstream ist im lokalen Netz unverschlüsselt. Zufälliger URL-Pfad und IP-Zugriffsbeschränkung wurden im Code geprüft; sie sind keine kryptografische Authentifizierung des Empfängers. Für mDNS-/Cast-Geräte wird ein vertrauenswürdiges lokales Netz vorausgesetzt.
- Frische Downloads/der veröffentlichte GitHub-Release wurden in diesem Audit nicht auf neue Funktionen geprüft. Der hier untersuchte Stand ist noch nicht committed/veröffentlicht. Windows/macOS und reale AirServer wurden nicht neu praktisch geprüft.

## Durchgeführte Prüfungen

| Prüfung | Ergebnis |
| --- | --- |
| `npm run check` | Bestanden, auch nach Hinzufügen der Reproduktion |
| `npm test` | 40/40 bestanden |
| `npm run build` | Bestanden |
| `npm run test:ui` | Bestanden, echtes Chromium mit Demo-Transport |
| `npm run test:audio` | Bestanden, echte Aufnahme und stummgeschaltete WAV-Dekodierung; Receiver-Regler simuliert |
| `npm audit --omit=dev` | Keine gemeldeten bekannten Schwachstellen |
| `git diff --check` | Bestanden |
| `node scripts/package.mjs linux-x64` | Linux-Paket erfolgreich gebaut |
| `npm run test:package -- --browser` | Entpackte Laufzeit, Produktionsimporte und Demo-Browserstart bestanden |
| `tsx scripts/audit-complete-repro.ts --browser` | A1–A7 bestätigt; keine realen Receiver angesteuert |
| Abgleich der Projektkopien | Anwendungscode in `src/` und `ui/` identisch |

Die Reproduktion ist absichtlich ein **Nachweisskript für den fehlerhaften Auditstand**, kein Test, der die korrekte Implementierung behauptet. Ein erfolgreicher Lauf bestätigt die beschriebenen Fehler. Nach einer Korrektur müssen die entsprechenden Szenarien als Tests für das gewünschte Verhalten übernommen werden.

```sh
./node_modules/.bin/tsx scripts/audit-complete-repro.ts --browser
```

## Positiv geprüfte Eigenschaften

- Zufälliger Stream-Pfad, Prüfung der tatsächlichen Remote-IP und getrennte, auf die konkrete lokale Audioseite begrenzte Lautstärkebridge.
- Keine automatische Lautstärkeerhöhung beim Verbinden; serverseitige Prüfung von Wertebereich und Stummschaltwert.
- Gerätenamen in der Hauptoberfläche über `textContent`, CSP und eingeschränkte Dateiabrufe; kein direkter HTML-Einschleusungspfad in den geprüften Anzeigen festgestellt.
- Native Prozesse werden mit Argumentlisten ohne Shell gestartet; Aufnahme der Ausgangs-Monitorquelle statt eines Mikrofons; keine Audiodatei wird abgelegt.
- Direkte Mediensteuerung wartet auf `PLAYING`, besitzt Zeitlimits und verwendet beim regulären Stop das eigene Medienobjekt. Die Fehler liegen insbesondere in der Kopplung mit dem Controller und in den Wiederherstellungspfaden.
- Konservativer Umgang mit verschwundenen, mehrdeutigen oder ausgetauschten Empfänger-IDs ist teilweise durch Regressionstests abgesichert.

## Empfohlene Reihenfolge

1. A1: eigene Sitzungsidentität und sichere Wiederherstellung/Beendigung.
2. A7: aktuelle Lautstärke und sichere relative Änderungen.
3. A2/A3: Medienzustände und wiederholbarer Stop.
4. A5/A6/A4: Profil, Initialisierungswiederholung und Speicherfehler.
5. Danach ein automatisierter Integrationstest für den tatsächlichen direkten MP3-Pfad und ein dokumentierter Hör-/Langzeittest am Receiver; erst anschließend neue Pakete veröffentlichen.
