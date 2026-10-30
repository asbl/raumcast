// Run on each target OS to verify the downloaded runtime and packaged imports.
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
const target = process.platform === 'win32' ? 'windows-x64' : process.platform === 'darwin' ? `macos-${process.arch}` : `linux-${process.arch}`;
const archive = resolve('release', `raumcast-${target}.${process.platform === 'win32' ? 'zip' : 'tar.gz'}`);
const temp = await mkdtemp(join(tmpdir(), 'raumcast-paket-'));
try {
  execFileSync('tar', [process.platform === 'win32' ? '-xf' : '-xzf', archive, '-C', temp]);
  const app = join(temp, 'raumcast');
  const runtime = join(app, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node');
  execFileSync(runtime, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    const { roomLabel, roomPrefix } = await import('./dist/controller.js');
    assert.equal(roomLabel('CWSRE01PCWB'), 'Raum E01');
    assert.equal(roomPrefix('CWSR208PCWB'), 'A');
    const { launch } = await import('./dist/main.js');
    assert.equal(typeof launch, 'function');
    console.log('Paket und Laufzeit funktionieren: ' + process.platform + '/' + process.arch);
  `], { cwd:app, stdio:'inherit' });
  if (process.argv.includes('--browser')) {
    execFileSync(runtime, [join(app, 'dist', 'main.js'), '--demo', '--smoke'], {
      cwd:app, stdio:'inherit', env:{ ...process.env, RAUMCAST_DATA_DIR:join(temp, 'profile') }, timeout:90_000,
    });
  }
} finally { await rm(temp, { recursive:true, force:true }); }
