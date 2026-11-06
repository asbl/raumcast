Raumcast 0.1.2 startet unter Windows standardmäßig ohne GPU-Beschleunigung. Das soll leere App-Fenster bei Grafiktreiberproblemen umgehen, bei denen die Oberfläche geladen ist und der Mauszeiger auf unsichtbare Bedienelemente reagiert. Die Ursache am betroffenen Rechner ist noch nicht abschließend bestätigt. Der Grafikmodus wird protokolliert; `--enable-gpu` erlaubt einen Vergleich mit dem Browserstandard. Die Softwaredarstellung kann mehr CPU benötigen.

Der Pakettest prüft jetzt auch die Bildinhalte des Screenshots, damit ein leeres PNG nicht mehr als erfolgreicher Oberflächentest zählt. Automatisierte Tests ersetzen weiterhin keinen Test am betroffenen Windows-Rechner und am AirServer.

Raumcast 0.1.1 verbessert den Windows-Start und bietet erstmals eine einzelne Setup-EXE als Download. Das Setup enthält die Node.js-Laufzeit, installiert für den aktuellen Benutzer ohne Administratorrechte und legt einen Startmenüeintrag an. Der EXE-Starter öffnet keine Kommandozeile. Das ZIP bleibt als portable Alternative verfügbar.

Der Start wartet auf das App-Fenster, behandelt Windows-Dateipfade robust und meldet einen Fehler, wenn die Oberfläche nicht geladen werden kann. Die Windows-CI prüft Installation, Demo-Oberfläche über den EXE-Starter und Deinstallation.

Raumcast ist für Nutzerinnen und Nutzer der **CWS Usingen** gedacht und vereinfacht die Bildschirmübertragung an die AirServer in den Unterrichtsräumen. Raumsuche, Bereichsfilter und Anzeigenamen sind auf die Geräte- und Raumbezeichnungen der CWS Usingen abgestimmt. Favoriten und eigene Raumnamen erleichtern die tägliche Nutzung.

Die Pakete enthalten die Node.js-Laufzeit. Chrome oder Chromium muss bereits installiert sein. Unter Windows kann die einzelne Setup-Datei verwendet werden. Sie installiert ohne Administratorrechte und legt einen Startmenüeintrag an. Die Archive müssen vollständig entpackt werden:

| System | Download | Starter |
| --- | --- | --- |
| Linux x64 | `raumcast-linux-x64.tar.gz` | `Raumcast.sh`; optional `Installieren.sh` für das Startmenü |
| Windows x64 (Setup) | `raumcast-windows-x64-setup.exe` | Setup ausführen, danach Raumcast im Startmenü öffnen |
| Windows x64 (portabel) | `raumcast-windows-x64.zip` | `Raumcast.exe` oder `Raumcast.cmd` |
| macOS Apple Silicon | `raumcast-macos-arm64.tar.gz` | `Raumcast.command` |
| macOS Intel | `raumcast-macos-x64.tar.gz` | `Raumcast.command` |

Die eigenen Starter sind nicht signiert oder notarisiert. macOS und Windows können daher eine Bestätigung für heruntergeladene Programme verlangen. macOS benötigt gegebenenfalls die Berechtigung zur Bildschirmaufnahme für Chrome/Chromium.

Bereichszuordnung: 208 wird A208; RA wird A; D und RD werden D; RE wird E; RG wird G. Der Systemdialog zur Bildschirmauswahl bleibt erhalten.

Die vier dokumentierten Auditbefunde sind behoben und durch Regressionstests abgesichert. Die echte Übertragung an AirServer und das Verhalten bei Netzwerkunterbrechungen müssen weiterhin im jeweiligen Schulnetz geprüft werden. Paket-/Laufzeittests auf anderen Plattformen sind kein Ersatz für diesen Test.

`SHA256SUMS.txt` enthält die Prüfsummen der Downloads. Das Programm nutzt ein eigenes Browserprofil und öffnet keinen Debugging-Netzwerkport.

Neu im Quellstand:

- Prüfung der unterstützten Cast-Modi vor dem Start schützt vor dem Chromium-Absturzpfad bei reinen Audioempfängern.
- Unter Linux wählt Raumcast bei reinen Audioempfängern automatisch „Computerton“, um die aktuelle Standard-Audioausgabe einschließlich Tidal im Webbrowser zu übertragen. Displays bleiben im Bildschirmmodus; eine separate Modusauswahl entfällt. Benötigt werden `ffmpeg`, `parec` und `pactl` (Manjaro: `ffmpeg` und `libpulse`).
- Die Aufnahme endet beim Stoppen, Schließen und bei Verbindungsverlust. Der Audio-Endpunkt lauscht ausschließlich lokal; es werden keine Audiodateien gespeichert.
- 50 Anwendungstests sowie UI- und echte Audioaufnahme-/Browserdekodiertests geprüft. Verbindungsaufbau und Stopp am echten Onkyo TX-L50 ohne Absturz geprüft; die hörbare Wiedergabe bleibt vor Ort zu bestätigen. Cast bringt Pufferverzögerung mit und ist kein zugesicherter verlustfreier HiRes-Übertragungsweg.

- Computerton wird als direkter MP3-Livestream mit 320 kbit/s an den Default Media Receiver gesendet. Der Browser-Mirroring-Pfad für Audio entfällt. Der Stream-Endpunkt erlaubt ausschließlich den ausgewählten Receiver und den eigenen Rechner.
- Receiver-Lautstärke und Stummschaltung direkt im Audio-Tab, einschließlich Anzeige des aktuellen Gerätewerts; am Onkyo TX-L50 geprüft.

- Sieben Auditbefunde korrigiert: sichere Audio-Sitzungszuordnung, tatsächliche Wiedergabestatus, wiederholbarer Stop, bestätigte Speicherung, dauerhaftes Browserprofil, erneute Initialisierung und frischer Lautstärkeabgleich.
- Audit-Regressionsprüfung und produktiver MP3-Smoke-Test in die CI aufgenommen; Audit- und Umsetzungsbericht liegen den Paketen bei.
