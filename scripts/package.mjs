// Build portable releases on Linux. Application dependencies contain no native addons.
import { cp, mkdir, readFile, writeFile, chmod, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
process.chdir(root);
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const version = `v${pkg.config.nodeRuntime}`;
const targets = ['linux-x64', 'win-x64', 'darwin-x64', 'darwin-arm64'];
const requested = process.argv.slice(2);
if (requested.some(target => !targets.includes(target))) throw new Error('Unbekanntes Paket-Ziel');
if (process.platform !== 'linux') throw new Error('Die Release-Pakete werden auf Linux gebaut (tar, zip und unzip erforderlich).');
const chosen = requested.length ? requested : targets;
const cache = join(root, '.cache', version);
const output = join(root, 'release');
const common = join(root, 'build', 'common');
await mkdir(cache, { recursive:true });
await mkdir(output, { recursive:true });
await rm(common, { recursive:true, force:true });
await mkdir(common, { recursive:true });
for (const file of ['package.json', 'package-lock.json', 'README.md', 'AUDIT.md', 'AUDIT-IMPLEMENTATION-2026-10-30.md', 'AUDIT-FIXES-2026-10-30.md']) await cp(file, join(common, file));
for (const dir of ['dist', 'ui', 'assets']) await cp(dir, join(common, dir), { recursive:true });
await mkdir(join(common, 'docs'), { recursive:true });
await cp('docs/screenshot.png', join(common, 'docs', 'screenshot.png'));
await mkdir(join(common, 'scripts'), { recursive:true });
await cp('scripts/install-portable.mjs', join(common, 'scripts', 'install-portable.mjs'));
execFileSync('npm', ['ci', '--omit=dev', '--omit=optional', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd:common, stdio:'inherit' });

async function download(name) {
  const response = await fetch(`https://nodejs.org/dist/${version}/${name}`);
  if (!response.ok) throw new Error(`Node-Download ${name}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
const checksums = (await download('SHASUMS256.txt')).toString('utf8');
const source = await Promise.all(chosen.map(async target => {
  const filename = `node-${version}-${target}.${target.startsWith('win-') ? 'zip' : 'tar.gz'}`;
  const expected = checksums.split('\n').find(line => line.trim().endsWith(` ${filename}`))?.split(/\s+/)[0];
  if (!expected) throw new Error(`Keine offizielle Prüfsumme für ${filename}`);
  const destination = join(cache, filename);
  let data;
  try { data = await readFile(destination); } catch { data = await download(filename); }
  if (createHash('sha256').update(data).digest('hex') !== expected) throw new Error(`Prüfsumme stimmt nicht: ${filename}`);
  await writeFile(destination, data);
  return { target, destination };
}));

const files = [];
for (const { target, destination } of source) {
  console.log(`Paket erstellen: ${target}`);
  const staging = join(root, 'build', target);
  await rm(staging, { recursive:true, force:true });
  const app = join(staging, 'raumcast');
  const runtimeSource = join(staging, 'node-source');
  await cp(common, app, { recursive:true });
  await mkdir(runtimeSource, { recursive:true });
  const windows = target.startsWith('win-');
  if (windows) execFileSync('unzip', ['-q', destination, '-d', runtimeSource]);
  else execFileSync('tar', ['-xzf', destination, '-C', runtimeSource]);
  const nodeRoot = join(runtimeSource, `node-${version}-${target}`);
  await mkdir(join(app, 'runtime'), { recursive:true });
  await cp(join(nodeRoot, windows ? 'node.exe' : 'bin/node'), join(app, 'runtime', windows ? 'node.exe' : 'node'));
  await cp(join(nodeRoot, 'LICENSE'), join(app, 'runtime', 'NODE-LICENSE.txt'));
  if (windows) {
    await writeFile(join(app, 'Raumcast.cmd'), '@echo off\r\ncd /d "%~dp0"\r\n"%~dp0runtime\\node.exe" "%~dp0dist\\main.js" %*\r\nif errorlevel 1 pause\r\n');
    execFileSync('makensis', ['-V2', `-DAPP_DIR=${app}`, 'scripts/windows-launcher.nsi'], { stdio:'inherit' });
    const installer = 'raumcast-windows-x64-setup.exe';
    execFileSync('makensis', ['-V2', `-DAPP_DIR=${app}`, `-DOUTPUT_FILE=${join(output, installer)}`, `-DVERSION=${pkg.version}`, 'scripts/windows-installer.nsi'], { stdio:'inherit' });
    files.push(installer);
  } else {
    await chmod(join(app, 'runtime', 'node'), 0o755);
    const startName = target.startsWith('darwin-') ? 'Raumcast.command' : 'Raumcast.sh';
    await writeFile(join(app, startName), '#!/bin/sh\nRAUMCAST_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1\ncd "$RAUMCAST_ROOT" || exit 1\nexec "$RAUMCAST_ROOT/runtime/node" "$RAUMCAST_ROOT/dist/main.js" "$@"\n', { mode:0o755 });
    if (target.startsWith('linux-')) await writeFile(join(app, 'Installieren.sh'), '#!/bin/sh\nRAUMCAST_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1\nexec "$RAUMCAST_ROOT/runtime/node" "$RAUMCAST_ROOT/scripts/install-portable.mjs"\n', { mode:0o755 });
  }
  const name = `raumcast-${target === 'win-x64' ? 'windows-x64' : target.replace('darwin-', 'macos-')}.${windows ? 'zip' : 'tar.gz'}`;
  const archive = join(output, name);
  await rm(archive, { force:true });
  if (windows) execFileSync('zip', ['-qr', archive, 'raumcast'], { cwd:staging });
  else execFileSync('tar', ['-czf', archive, '-C', staging, 'raumcast']);
  files.push(name);
}
const sums = [];
for (const name of files) sums.push(`${createHash('sha256').update(await readFile(join(output, name))).digest('hex')}  ${name}`);
await writeFile(join(output, 'SHA256SUMS.txt'), sums.join('\n') + '\n');
console.log(`Fertig: ${files.join(', ')}`);
