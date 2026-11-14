import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
if (process.platform !== 'linux') throw new Error('Dieser Installer ist für Linux.');
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const quote = s => '"' + s.replaceAll('\\', '\\\\\\\\').replaceAll('"', '\\\\"').replaceAll('`', '\\\\`').replaceAll('$', '\\\\$').replaceAll('%', '%%') + '"';
const directory = join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'applications');
await mkdir(directory, { recursive:true });
// Icon= takes a plain path (no Exec-style quoting/field codes), escaped only for literal backslashes.
const icon = join(root, 'assets', 'icon.svg').replaceAll('\\', '\\\\');
await writeFile(join(directory, 'raumcast.desktop'), `[Desktop Entry]\nType=Application\nName=Raumcast\nComment=Bildschirm im richtigen Raum teilen\nExec=${quote(join(root, 'runtime', 'node'))} ${quote(join(root, 'dist', 'main.js'))}\nIcon=${icon}\nStartupWMClass=Raumcast\nTerminal=false\nCategories=Education;\nStartupNotify=false\n`);
console.log('Raumcast im Startmenü installiert. Den entpackten Programmordner bitte behalten.');
