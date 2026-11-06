# Raumcast

Raumcast ist für Nutzerinnen und Nutzer der **CWS Usingen** gedacht. Das Tool vereinfacht die Bildschirmübertragung an die AirServer in den Unterrichtsräumen: Raum suchen, Enter drücken und den Bildschirm im Systemdialog auswählen.

Raumsuche, Anzeigenamen und Bereichsfilter sind an die Geräte- und Raumbezeichnungen der CWS Usingen angepasst. Aus technischen Empfängernamen wie `CWSR208PCWB` wird beispielsweise „Raum A208“. Räume lassen sich nach A, D, E oder G filtern und als Favoriten speichern. Die Zuordnungen D/RD → D, RE → E, RA → A und RG → G sowie reine Raumnummern → A entsprechen dieser Anpassung. Für andere Schulen oder andere Namensschemata muss die Raumerkennung gegebenenfalls geändert werden.

Die Anwendung ist ein lokaler Prototyp für Linux, Windows und macOS. Sie steuert eine eigene Chrome-/Chromium-Instanz und überträgt im Bildschirmmodus den gesamten ausgewählten Bildschirm. Unter Linux wird bei reinen Audioempfängern automatisch der Computerton übertragen. Der gewohnte Systemdialog zur Bildschirmauswahl bleibt erhalten.

## Downloads

Das Windows-Setup und die portablen Pakete enthalten die Node.js-Laufzeit. Du brauchst zusätzlich installiertes Chrome oder Chromium und Zugang zum selben Netz wie die AirServer.

| System | Download | Installation bzw. Start |
| --- | --- | --- |
| Windows x64 (Setup) | [Setup herunterladen](https://github.com/asbl/raumcast/releases/latest/download/raumcast-windows-x64-setup.exe) | Setup ausführen, danach „Raumcast“ im Startmenü öffnen |
| Windows x64 (portabel) | [ZIP herunterladen](https://github.com/asbl/raumcast/releases/latest/download/raumcast-windows-x64.zip) | `Raumcast.exe` (alternativ `Raumcast.cmd` zur Diagnose) |
| macOS Apple Silicon (M-Serie) | [Archiv herunterladen](https://github.com/asbl/raumcast/releases/latest/download/raumcast-macos-arm64.tar.gz) | `Raumcast.command` |
| macOS Intel | [Archiv herunterladen](https://github.com/asbl/raumcast/releases/latest/download/raumcast-macos-x64.tar.gz) | `Raumcast.command` |
| Linux x64, etwa Manjaro | [Archiv herunterladen](https://github.com/asbl/raumcast/releases/latest/download/raumcast-linux-x64.tar.gz) | `Raumcast.sh` |

Das Windows-Setup ist eine einzelne Datei und installiert für den aktuellen Benutzer ohne Administratorrechte. Es legt einen Startmenüeintrag an; Raumcast startet darüber ohne sichtbare Kommandozeile. Die Deinstallation erfolgt über die Windows-Einstellungen. Gespeicherte Räume und das Browserprofil bleiben dabei erhalten. Das ZIP bleibt als portable Alternative verfügbar.

[Alle Releases](https://github.com/asbl/raumcast/releases) · [SHA-256-Prüfsummen](https://github.com/asbl/raumcast/releases/latest/download/SHA256SUMS.txt)

Unter Linux kann `Installieren.sh` zusätzlich einen Startmenü-Eintrag anlegen. Den entpackten Programmordner anschließend behalten. Unter macOS und Windows können wegen der fehlenden Signierung Rückfragen des Betriebssystems erscheinen. macOS benötigt gegebenenfalls eine Bildschirmaufnahmeberechtigung für den verwendeten Browser. Die Pakete sind ein Prototyp: Die echte AirServer-Verbindung muss vor Ort getestet werden.

![Raumcast mit Raumauswahl und Bereichsfilter im Demomodus](docs/screenshot.png)

## Aus dem Quellcode starten

Voraussetzungen: Node.js ab Version 22, npm sowie installiertes Chrome oder Chromium mit Google-Cast-Unterstützung. Im Schulnetz müssen die AirServer per Google Cast erreichbar sein.

```sh
git clone https://github.com/asbl/raumcast.git
cd raumcast
npm ci
npm start
```

Unter Linux legt `npm run install:desktop` einen Startmenü-Eintrag **Raumcast** an. Über die GNOME-Tastatureinstellungen lässt sich anschließend optional `start-raumcast.sh` als eigenes Tastenkürzel hinterlegen.

Nach einem Umzug des Projektordners den Startmenü-Eintrag neu anlegen:

```sh
npm run install:desktop
```

Nur eine echte Raumcast-Instanz gleichzeitig öffnen: Das eigene Browserprofil kann jeweils nur von einem Browserprozess verwendet werden. Dein normaler Browser kann parallel geöffnet bleiben. Zum Beenden das Raumcast-Fenster schließen; dadurch wird auch seine Browserinstanz und damit deren Übertragung beendet.

## Bedienung

- Raumnummer oder Gerätename eingeben; Pfeiltasten wählen einen Eintrag, Enter verbindet.
- Unter „Bereich“ nach dem Raumkürzel filtern, etwa G für G01 oder E für E01. Die Kürzel stammen aus den Originalnamen und bleiben beim Umbenennen erhalten. Bereich, Textsuche und Favoriten sind kombinierbar; „Alle Bereiche“ setzt den Bereichsfilter zurück.
- Bereichszuordnung: D und RD erscheinen gemeinsam unter D, RE unter E, RA unter A und RG unter G. Bereits vorhandene E-, A- und G-Räume gehören zum jeweiligen selben Bereich.
- Räume ohne Buchstabenkürzel gehören zu A: 208 wird als A208 angezeigt, ebenso die bisher als 208 dargestellten Empfänger mit technischem R-Präfix. Die Suche findet sowohl A208 als auch 208, auch bei einem eigenen Anzeigenamen.
- Alternativ einen Raum direkt anklicken.
- Der Stern speichert einen Favoriten; der Stift ändert den Anzeigenamen. Ein leerer Anzeigename stellt den automatisch erkannten Namen wieder her.
- `CWSR208PCWB` wird automatisch zu „Raum A208“, `CWSD32PCWB` zu „Raum D32“. Der Originalname bleibt sichtbar.
- Die Empfängernamen dürfen auf `PCWB` oder `CWB` enden. Beispielsweise erscheint `CWSD12CWB` als „Raum D12“ im Bereich D und ist über `12`, `D12` oder den Originalnamen auffindbar.
- Raum auswählen, dann den Bildschirm im gewohnten Systemdialog freigeben. Der Dialog wird nicht automatisch bestätigt.
- Während der Übertragung kannst du das Fenster minimieren. „Übertragung beenden“ beendet die eigene Sitzung.
- Geht die Erkennung eines eigenen Empfängers verloren, erscheint „Verbindung nicht bestätigt“. Das Ziel und der Stop-Knopf bleiben erhalten. Bei Wiedererkennung wird der Status erneut abgeglichen. Falls ein Stop fehlschlägt, kannst du ihn wiederholen oder Raumcast schließen.
- Ein Wechsel zu einem anderen Raum beendet zuerst die eigene alte Sitzung.
- Direkt nach dem Stop wird der Zielraum erneut auf Verfügbarkeit, Belegung und eindeutige Identität geprüft. Hat er sich inzwischen geändert, wird kein neuer Startbefehl gesendet.
- Gespeicherte Räume bleiben auch ohne Netzwerk sichtbar, sind dann aber nicht auswählbar.
- Bereits belegte oder namensgleiche Empfänger werden für neue Verbindungen gesperrt. Die Cast-Schnittstelle adressiert Empfänger beim Starten über ihren Namen.

## Demo und Tests

```sh
npm run demo
npm run check
npm test
npm run test:ui
npm start -- --smoke
```

Die Demo simuliert sieben Empfänger und überträgt nichts. Sie ist sichtbar als DEMO markiert und speichert Daten getrennt vom echten Betrieb.

Die Unit-Tests prüfen unter anderem Start/Stopp, Raumwechsel, Abbrüche, belegte und mehrdeutige Empfänger sowie gespeicherte Einstellungen. Der UI-Test startet echtes Chromium mit simuliertem Cast-Transport und prüft Suche, Favorit, Alias, Enter, Start/Stopp und Neuladen. Er speichert `artifacts/demo.png`. `--smoke` prüft Browserstart und die echte Cast-Schnittstelle ohne eine Übertragung zu starten, speichert `artifacts/live.png` und beendet die Anwendung wieder. Es ist kein vollständiger Netzwerkerkennungstest.

## Erster Test im Schulnetz

1. `npm start` ausführen und warten, bis die Raumliste erscheint.
2. Einen freien Raum mit kontrollierbarem Display auswählen.
3. Bildschirm im Systemdialog auswählen; prüfen, ob im richtigen Raum das Bild erscheint.
4. Übertragung beenden und erneut verbinden.
5. Bildschirmdialog einmal abbrechen. Falls die Anfrage weiter angezeigt wird, „Anfrage beenden“ wählen.
6. Raumwechsel und Wiederverbindung nach einem WLAN-Wechsel ausprobieren.

Wenn keine Empfänger erscheinen: Schulnetz und manuelle Cast-Erkennung im normalen Chrome vergleichen, dann „Suchen“ verwenden. Erreichbare Empfänger werden vom Browser entdeckt; Raumcast implementiert keine eigene Netzwerksuche.

Die Cast-Protokollaufrufe können während eines offenen Dialogs auf dessen Antwort warten. Währenddessen sind weitere Start-/Stoppbefehle gesperrt; bitte den Systemdialog bestätigen oder abbrechen. Ein Protokollaufruf hat ein Zeitlimit von zwei Minuten. Nach einem Fehler oder unbestätigtem Start bleibt das Ziel explizit beendbar. Im Zweifel das Raumcast-Fenster schließen.

Ist ein bereits verwendeter Empfänger inzwischen namensgleich mit einem anderen oder durch eine andere Empfänger-ID ersetzt, wird kein Stop an dieses unklare Ziel gesendet. In diesem Fall beendet das Schließen von Raumcast dessen eigene Browserinstanz. Die bekannten Fehler aus dem Audit sind behoben; Details und Regressionstests stehen in `AUDIT.md`.

## Konfiguration und Plattformen

Die Plattformlogik erkennt Chromium/Chrome unter Linux, Chrome unter Windows und Chrome/Chromium unter macOS. Ein anderer Installationspfad lässt sich über `RAUMCAST_BROWSER` angeben:

```sh
RAUMCAST_BROWSER=/usr/bin/chromium npm start
```

Unter PowerShell beispielsweise:

```powershell
$env:RAUMCAST_BROWSER = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
npm start
```

Unter Windows startet Raumcast ab Version 0.1.2 standardmäßig mit Softwaredarstellung (`--disable-gpu`). Das umgeht den GPU-Pfad bei leeren Fenstern, deren Bedienelemente trotzdem auf den Mauszeiger reagieren. Der Grafikmodus steht in `raumcast.log`. Zum Vergleich kann `Raumcast.exe --enable-gpu` den Browserstandard verwenden; `--disable-gpu` erzwingt die Softwaredarstellung auch unter Linux und macOS. Die Softwaredarstellung kann die CPU-Auslastung erhöhen. Die Bildschirmübertragung muss weiterhin am jeweiligen Gerät geprüft werden.

Die automatische Windows-Erkennung berücksichtigt die üblichen Chrome-Installationspfade. macOS kann zusätzlich die Berechtigung zur Bildschirmaufnahme verlangen. GitHub Actions prüft die Anwendungstests sowie die entpackten Laufzeiten und Programmimporte auf Windows x64, macOS Intel und macOS Apple Silicon. Der vollständige Browser-UI-Test und der portable Browserstart werden unter Linux geprüft. Unter Windows prüft die CI zusätzlich Installation, den neuen EXE-Starter mit Demo-Oberfläche und Deinstallation (`npm run test:package -- --installer --browser`). Die reale Bildschirmübertragung auf Windows und macOS bleibt vor Ort zu testen. Der zusätzliche Shell-Installer für portable Pakete ist Linux-spezifisch.

Standardverzeichnis für Browserprofil und `rooms.json`:

| System | Verzeichnis |
| --- | --- |
| Linux | `$XDG_DATA_HOME/raumcast`, sonst `~/.local/share/raumcast` |
| Windows | `%LOCALAPPDATA%\Raumcast` |
| macOS | `~/Library/Application Support/Raumcast` |

Mit `RAUMCAST_DATA_DIR` kann ein anderes Datenverzeichnis gewählt werden. Zum manuellen Bearbeiten von `rooms.json` Raumcast vorher schließen. Ein beschädigtes Einstellungsformat führt zu einer Fehlermeldung, damit keine bestehenden Daten stillschweigend überschrieben werden.

## Architektur und Grenzen

`src/main.ts` startet den Browser über Puppeteer und verbindet die lokale Oberfläche mit `src/controller.ts`. Der Controller verarbeitet Cast-Ereignisse und kontrolliert Verbindungszustände. `src/storage.ts` speichert Raumnamen, Favoriten und letzte Nutzung atomar. `ui/` enthält die Oberfläche ohne Framework.

Die Steuerung verwendet eine Prozess-Pipe, keinen offenen Debugging-Port. Die Oberfläche wird direkt aus lokalen Dateien geladen. Im Audiomodus läuft zusätzlich ein temporärer HTTP-Endpunkt mit zufälligem URL-Pfad. Er liefert den Musikstream direkt an den ausgewählten Receiver. Der Zugriff ist auf dessen IP-Adresse und den eigenen Rechner beschränkt. Die Bedienseite wird über Loopback geöffnet, und die privilegierten Lautstärkebefehle sind auf genau diese Seite begrenzt. Der Endpunkt wird beim Beenden geschlossen. Das Browserprofil ist vom normalen Browser getrennt. Puppeteers übliche Startargumente würden MediaRouter deaktivieren; daher verwenden wir bewusst eigene minimale Startargumente.

Die CDP-Cast-Schnittstelle ist experimentell. Eine vom Empfänger gemeldete Sitzung beweist nicht, dass am Display ein korrektes Bild erscheint. Die Oberfläche sagt deshalb „Sitzung gemeldet“. Die Anwendung kann fremde Sitzungen nicht zuverlässig einem Besitzer zuordnen; sie startet keine Verbindung zu bereits als belegt gemeldeten Empfängern und bietet Stoppen nur für selbst angefragte Ziele an.

Lokal auf Manjaro/GNOME/Wayland geprüft: Browserstart, `Cast.enable`, TypeScript-Prüfung, Controller-Tests und UI-Test. Die echte AirServer-Übertragung, Systemdialog-Abbruch und Raumwechsel im Schulnetz bleiben praktisch zu prüfen.

Technische Quellen:

- [Chrome DevTools Protocol: Cast](https://chromedevtools.github.io/devtools-protocol/tot/Cast/)
- [Puppeteer: CDP-Sitzungen](https://pptr.dev/api/puppeteer.page.createcdpsession)
- [Chrome: separates Profil für Remote Debugging](https://developer.chrome.com/blog/remote-debugging-port)

## Pakete bauen und veröffentlichen

```sh
npm run package
npm run test:package -- --browser
```

Der Paketbau benötigt Linux sowie `tar`, `zip`, `unzip` und NSIS (`makensis`, unter Debian/Ubuntu: `sudo apt-get install nsis`). Er lädt die in `package.json` festgelegte Node.js-Version von nodejs.org, prüft die offiziellen SHA-256-Prüfsummen und legt vier Archive und das Windows-Setup unter `release/` ab. Entwicklungsabhängigkeiten und persönliche Browserprofile sind nicht enthalten. Node.js-Lizenz und die Lizenzdateien der npm-Abhängigkeiten liegen den Paketen bei.

Der Workflow „Test and portable downloads“ baut und prüft die Pakete. Eine manuell gestartete Ausführung mit `publish=true` veröffentlicht nach erfolgreichen Tests die Version aus `package.json` als Release. Für weitere Releases muss die Versionsnummer erhöht werden.

### Erkannte Audioempfänger

Ein erkannter Cast-Empfänger unterstützt nicht automatisch Bildschirmübertragung.
Vor einem Start prüft Raumcast deshalb die Desktop-Quellen in Chromiums
`chrome://media-router-internals/`. Bei einem bestätigten reinen Audioempfänger wählt Raumcast automatisch den Computerton. Bei Displays wird weiterhin der Bildschirm übertragen. Fehlt eine eindeutige Bestätigung der Gerätefähigkeiten, erscheint eine Fehlermeldung. Eine laufende Übertragung bleibt in diesem Fall
erhalten. Sind die Diagnosedaten nicht verfügbar oder nicht eindeutig, wird der
Start ebenfalls abgelehnt. Die Shield kann weiterhin verwendet werden, sofern
Chromium sie als Desktop-Empfänger meldet.

Hintergrund: Der [Chromium-Cast-Handler](https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/devtools/protocol/cast_handler.cc)
greift beim Desktop-Start ohne Nullprüfung auf die passende Quelle zu. Das
[CDP-Cast-Protokoll](https://chromedevtools.github.io/devtools-protocol/tot/Cast/)
übermittelt die unterstützten Übertragungsmodi nicht an Raumcast. Deshalb erfolgt
die zusätzliche Prüfung anhand der Browserdiagnose. Diese interne Schnittstelle
kann sich mit Browserupdates ändern; dann wird der Start mit einer Fehlermeldung
abgebrochen.


### Computerton unter Linux (auch Tidal im Webbrowser)

1. Benötigt werden `ffmpeg`, `parec` und `pactl` sowie PulseAudio oder PipeWire mit PulseAudio-Kompatibilität. Unter Manjaro stammen die Programme aus `ffmpeg` und `libpulse`; unter Debian/Ubuntu aus `ffmpeg` und `pulseaudio-utils`.
2. Raumcast starten. Eine gesonderte Modusauswahl ist nicht nötig.
3. Einen freien Cast-Audioempfänger (z. B. Onkyo) auswählen. Raumcast erkennt anhand der gemeldeten Fähigkeiten, ob es sich um einen reinen Audioempfänger handelt, und startet automatisch den Computerton. Displays, Shield und AirServer verwenden bei bestätigter Desktop-Unterstützung weiterhin den Bildschirmmodus.
4. Tidal im normalen Browser abspielen. Es werden alle Klänge der beim Start gewählten Standardausgabe erfasst, einschließlich Benachrichtigungen. Anwendungen auf anderen Audioausgängen werden nicht mit erfasst. Die lokale Wiedergabe von Tidal bleibt bestehen.
5. Mit „Übertragung beenden“ stoppen oder das Raumcast-Hauptfenster schließen. Beim Wechsel des Standard-Audioausgangs die Übertragung neu starten.

Die Aufnahme liest ausschließlich den Monitor der Audioausgabe, nicht das Mikrofon. Es wird keine Audiodatei gespeichert. PCM-Stereo (48 kHz, 16 Bit) wird als MP3 mit 320 kbit/s kodiert und über den Default Media Receiver direkt abgespielt. Der zusätzliche Weg durch Browserwiedergabe, erneute Tonaufnahme und Opus-Mirroring entfällt. Der Audio-Tab dient der Receiver-Lautstärke und spielt den Ton nicht lokal ab. Die Audioaufnahme und der lokale Endpunkt werden bei Stopp, Aufnahmefehler oder bestätigtem Sitzungsende geschlossen.

Cast puffert den Ton: Dieser Modus eignet sich für Musik, weniger für lippensynchrones Video. Die Cast-Übertragung ist nicht als verlustfreier Tidal-HiRes-Weg zugesichert. Sie hängt nicht von einer Cast-Funktion der Tidal-Webseite ab. Windows und macOS haben in dieser Version keinen Modus zum Erfassen des gesamten Computertons; die Bildschirmfunktion bleibt verfügbar.

`npm run test:audio` prüft unter Linux die echte Audioaufnahme und deren Dekodierung in einem stummgeschalteten Testbrowser. Der Test benötigt die genannten Audioprogramme und eine laufende Audioausgabe. Er verbindet sich mit keinem Cast-Gerät. Der UI-Test prüft den Audiomodus mit simulierten Empfängern; die Wiedergabe auf einem echten Onkyo muss vor Ort geprüft werden.


Beim lokalen Onkyo-Test wurde festgestellt, dass der Startmenüeintrag auf `/home/sbl/code/git/raumcast` zeigte, während Änderungen zunächst in einer zweiten Kopie lagen. Die gestartete Kopie ist jetzt ebenfalls aktualisiert. Chromium 155 meldet hier leere `discovered_sinks` und auf acht Zeichen gekürzte Geräte-IDs. Raumcast gleicht diese deshalb mit den vollständigen CDP-IDs ab und berücksichtigt die tatsächlichen Desktop-/Tab-Ergebnisse. Der echte Onkyo TX-L50 wurde damit per normalem Empfängerklick verbunden: Status `active`, Modus `audio`, keine Fehlermeldung; die Testübertragung wurde anschließend beendet. Die hörbare Wiedergabe am Receiver ist vom Nutzer zu prüfen.

Unter dem Datenverzeichnis entsteht `raumcast.log` mit Programmordner, Browserversion, gewähltem Modus und Verbindungsfehlern. Audiodaten werden darin nicht gespeichert.


### Stabilität und Receiver-Lautstärke

Der geöffnete Audio-Tab enthält einen Regler „Receiver-Lautstärke“ und eine Stummschaltung. Diese steuern den Cast-Lautstärkewert des gewählten Receivers direkt; es handelt sich nicht um die Lautstärke des Firefox-Tabs. Der aktuelle Gerätewert wird abgefragt und regelmäßig aktualisiert. Beim Verbinden wird die Lautstärke nicht automatisch verändert. Die Zuordnung erfolgt per vollständiger Cast-Geräte-ID. Kann ein Empfänger seine Lautstärke nicht regeln oder ist die direkte Verbindung nicht erreichbar, zeigt der Tab das an; die Audioübertragung bleibt davon unabhängig.

Eine Erhöhung des Chromium-Puffers beseitigte die hörbaren Aussetzer nicht. In der längeren Messung hatte der Browser konstant über eine Sekunde Daten vorrätig, während der Mirroring-Pfad regelmäßig Audioframes verwarf. Für Musik verwendet Raumcast deshalb jetzt einen direkten MP3-Livestream mit TCP-Übertragung und Receiver-Pufferung. Der Receiver bestätigt den Start erst mit PLAYING; beim Beenden wird ausschließlich die von Raumcast gestartete Mediensitzung beendet. Vor der ersten Auslieferung werden etwa zwei Sekunden MP3-Daten gesammelt, damit der Receiver auch nach dem Start einen Vorlauf hat. Der Start kann mehrere Sekunden dauern. MP3 mit 320 kbit/s ist kein verlustfreier HiRes-Weg. Die Bildschirmfunktion behält ihren bisherigen Browserpfad und dessen Standardpuffer.

Die Lautstärkeregelung wurde am Onkyo TX-L50 durch Auslesen und Zurückschreiben des unveränderten Werts (26 %) sowie über den Regler im Audio-Tab geprüft. Die Cast-Verbindung blieb aktiv. Die Abhängigkeit `protobufjs` wird für `castv2-client` explizit auf eine aktuelle Version überschrieben; `npm audit` meldet im geprüften Stand keine Schwachstellen.


Der Receiver-Regler nutzt standardmäßig den Feinbereich 0–40 % über die volle Breite des Audio-Tabs. Pfeiltasten ändern um 0,1 Prozentpunkte, die Plus-/Minus-Tasten um 0,5 Prozentpunkte; die Anzeige zeigt Dezimalwerte. Der volle Bereich 0–100 % lässt sich ohne Änderung der Lautstärke einblenden. Liegt der Gerätewert bereits über 40 %, wird automatisch der volle Bereich angezeigt. Halbe Prozentpunkte wurden am Onkyo TX-L50 geprüft. Bei schnellen Eingaben wird der zuletzt gewünschte Wert nach einer noch laufenden Anfrage gesendet.


### Auditkorrekturen

Die sieben Befunde des vollständigen Audits sind im lokalen Quellstand korrigiert; Details stehen in [AUDIT-FIXES-2026-10-30.md](AUDIT-FIXES-2026-10-30.md). Audio-Stop und Medienereignisse bleiben an die eigene Sitzung gebunden. Ein fehlgeschlagener Stop kann erneut verbunden werden. Lautstärketasten lesen jeweils den aktuellen Gerätewert; Tastaturfokus blockiert keine Statusabfrage. Schreibfehler bleiben bis zum erfolgreichen Speichern sichtbar, und die Cast-Suche kann nach einem Initialisierungsfehler wiederholt werden.

`npm run test:audit` prüft die korrigierten Fehlerfälle mit simulierten Empfängern und echtem Browser. `npm run test:audio` prüft den produktiven MP3-Pfad einschließlich Vorlauf. Die CI führt beide Prüfungen zusätzlich aus. Browser-UI-Tests sollten nacheinander ausgeführt werden.
