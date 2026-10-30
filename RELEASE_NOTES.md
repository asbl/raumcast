Raumcast ist für Nutzerinnen und Nutzer der **CWS Usingen** gedacht und vereinfacht die Bildschirmübertragung an die AirServer in den Unterrichtsräumen. Raumsuche, Bereichsfilter und Anzeigenamen sind auf die Geräte- und Raumbezeichnungen der CWS Usingen abgestimmt. Favoriten und eigene Raumnamen erleichtern die tägliche Nutzung.

Die Pakete enthalten die Node.js-Laufzeit. Chrome oder Chromium muss bereits installiert sein. Den gesamten Programmordner entpacken und den passenden Starter öffnen:

| System | Download | Starter |
| --- | --- | --- |
| Linux x64 | `raumcast-linux-x64.tar.gz` | `Raumcast.sh`; optional `Installieren.sh` für das Startmenü |
| Windows x64 | `raumcast-windows-x64.zip` | `Raumcast.cmd` |
| macOS Apple Silicon | `raumcast-macos-arm64.tar.gz` | `Raumcast.command` |
| macOS Intel | `raumcast-macos-x64.tar.gz` | `Raumcast.command` |

Die eigenen Starter sind nicht signiert oder notarisiert. macOS und Windows können daher eine Bestätigung für heruntergeladene Programme verlangen. macOS benötigt gegebenenfalls die Berechtigung zur Bildschirmaufnahme für Chrome/Chromium.

Bereichszuordnung: 208 wird A208; RA wird A; D und RD werden D; RE wird E; RG wird G. Der Systemdialog zur Bildschirmauswahl bleibt erhalten.

Die vier dokumentierten Auditbefunde sind behoben und durch Regressionstests abgesichert. Die echte Übertragung an AirServer und das Verhalten bei Netzwerkunterbrechungen müssen weiterhin im jeweiligen Schulnetz geprüft werden. Paket-/Laufzeittests auf anderen Plattformen sind kein Ersatz für diesen Test.

`SHA256SUMS.txt` enthält die Prüfsummen der Downloads. Das Programm nutzt ein eigenes Browserprofil und öffnet keinen Debugging-Netzwerkport.
