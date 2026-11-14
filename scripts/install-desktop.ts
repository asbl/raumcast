import { mkdir, writeFile, chmod } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'linux') throw new Error('Diese Startmenü-Installation ist für Linux. Auf anderen Systemen npm start verwenden.');
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const quoteShell = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
const launcher = join(root, 'start-raumcast.sh');
await writeFile(launcher, `#!/bin/sh\ncd ${quoteShell(root)} || exit 1\nexec ${quoteShell(process.execPath)} ${quoteShell(join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'))} src/main.ts "$@"\n`, { mode:0o755 });
await chmod(launcher, 0o755);
// Desktop Exec has its own escaping rules, distinct from shell quoting.
const desktopQuote = (s: string) => '"' + s.replaceAll('\\', '\\\\\\\\').replaceAll('"', '\\\\"').replaceAll('`', '\\\\`').replaceAll('$', '\\\\$').replaceAll('%', '%%') + '"';
const directory = join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'applications');
await mkdir(directory, { recursive:true });
const target = join(directory, 'raumcast.desktop');
// Icon= takes a plain path (no Exec-style quoting/field codes), escaped only for literal backslashes.
const icon = join(root, 'assets', 'icon.svg').replaceAll('\\', '\\\\');
await writeFile(target, `[Desktop Entry]\nType=Application\nName=Raumcast\nComment=Bildschirm im richtigen Raum teilen\nExec=${desktopQuote(launcher)}\nIcon=${icon}\nStartupWMClass=Raumcast\nTerminal=false\nCategories=Education;\nStartupNotify=false\n`);
console.log(`Startmenü-Eintrag installiert: ${target}`);
