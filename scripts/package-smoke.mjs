// Run on each target OS to verify the downloaded runtime and packaged imports.
import { mkdtemp, rm, readFile, access } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
const target = process.platform === 'win32' ? 'windows-x64' : process.platform === 'darwin' ? `macos-${process.arch}` : `linux-${process.arch}`;
const archive = resolve('release', `raumcast-${target}.${process.platform === 'win32' ? 'zip' : 'tar.gz'}`);
const temp = await mkdtemp(join(tmpdir(), 'raumcast-paket-'));
const installer = process.argv.includes('--installer');
if (installer && process.platform !== 'win32') throw new Error('Setup-Test benötigt Windows.');
const app = join(temp, 'Raumcast Test ä');
try {
  if (installer) {
    // NSIS requires /D last and unquoted, including paths containing spaces.
    execFileSync(resolve('release', 'raumcast-windows-x64-setup.exe'), ['/S', `/D=${app}`], {
      stdio:'inherit', timeout:90_000, windowsVerbatimArguments:true,
    });
  } else {
    execFileSync('tar', [process.platform === 'win32' ? '-xf' : '-xzf', archive, '-C', temp]);
  }
  const installedApp = installer ? app : join(temp, 'raumcast');
  const runtime = join(installedApp, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node');
  execFileSync(runtime, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    const { roomLabel, roomPrefix } = await import('./dist/controller.js');
    assert.equal(roomLabel('CWSRE01PCWB'), 'Raum E01');
    assert.equal(roomPrefix('CWSR208PCWB'), 'A');
    const { launch } = await import('./dist/main.js');
    assert.equal(typeof launch, 'function');
    console.log('Paket und Laufzeit funktionieren: ' + process.platform + '/' + process.arch);
  `], { cwd:installedApp, stdio:'inherit' });
  if (process.argv.includes('--browser')) {
    execFileSync(installer ? join(installedApp, 'Raumcast.exe') : runtime,
      [...(installer ? [] : [join(installedApp, 'dist', 'main.js')]), '--demo', '--smoke'], {
      cwd:installedApp, stdio:'inherit', env:{ ...process.env, RAUMCAST_DATA_DIR:join(temp, 'profile') }, timeout:90_000,
    });
    assert.equal((await readFile(join(installedApp, 'artifacts', 'demo.png'))).subarray(1, 4).toString(), 'PNG');
  }
  if (installer) {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '$p = Start-Process -FilePath $env:RAUMCAST_TEST_UNINSTALLER -ArgumentList /S -Wait -PassThru; exit $p.ExitCode'], {
      env:{ ...process.env, RAUMCAST_TEST_UNINSTALLER:join(installedApp, 'Deinstallieren.exe') }, timeout:90_000,
    });
    await assert.rejects(access(runtime));
  }
} finally { await rm(temp, { recursive:true, force:true }); }
