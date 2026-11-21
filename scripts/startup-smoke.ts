import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const temporary = await mkdtemp(join(tmpdir(), 'raumcast-startup-'));
process.env.RAUMCAST_DATA_DIR = temporary;
process.argv.push('--demo');
await mkdir(join(temporary, 'demo'));
const corrupt = { 'rooms.json':'{"broken":', 'view-settings.json':'{"favoritesOnly":"invalid","prefix":"G"}' };
for (const [name, source] of Object.entries(corrupt)) await writeFile(join(temporary, 'demo', name), source);
const { launch } = await import('../src/main.js');
const app = await launch();
const childArgs = ['--import', 'tsx', 'src/main.ts', '--demo'];
try {
  const page = app.page;
  const snapshot = await page.evaluate(async () => (await (window as any).raumcast('snapshot')).data);
  assert.equal(snapshot.recoveries.length, 2);
  await page.waitForFunction(() => !(document.querySelector('#settings-warning') as HTMLElement).hidden, { polling:100 });
  for (const recovery of snapshot.recoveries) assert.equal(await readFile(recovery.backup, 'utf8'), corrupt[recovery.filename.split(/[/\\]/).at(-1) as keyof typeof corrupt]);
  const diagnostic = await page.evaluate(async () => (await (window as any).raumcast('diagnostics')).data);
  assert.match(diagnostic, /Beschädigte Einstellungen wurden gesichert/);
  await page.$eval('#acknowledge-recovery', element => (element as HTMLButtonElement).click());
  await page.waitForFunction(() => (document.querySelector('#settings-warning') as HTMLElement).hidden, { polling:100 });
  console.log('Startprüfung: beschädigte Dateien gesichert, Oberfläche und Diagnose verfügbar.');

  const session = await page.createCDPSession();
  const { windowId } = await session.send('Browser.getWindowForTarget');
  const before = (await app.browser.pages()).length;
  await session.send('Browser.setWindowBounds', { windowId, bounds:{ windowState:'minimized' } });
  const second = await exec(process.execPath, childArgs, { env:process.env, timeout:20000 });
  assert.match(second.stdout, /Raumcast läuft bereits/);
  assert.notEqual((await session.send('Browser.getWindowBounds', { windowId })).bounds.windowState, 'minimized');
  assert.equal((await app.browser.pages()).length, before);
  assert.equal(app.controller.phase, 'idle');
  await session.detach();
  console.log('Startprüfung: Zweitstart aktiviert das minimierte Fenster ohne zusätzliche Browserinstanz.');

  const disconnected = new Promise<void>(resolve => app.browser.once('disconnected', () => resolve()));
  app.page.emit('error', new Error('Simulierter Rendererabsturz'));
  await disconnected;
  await app.shutdown();
  console.log('Startprüfung: simulierter Rendererfehler beendet Browser und Instanzsteuerung automatisch.');
  const browserCrash = `process.argv.push('--demo'); const {launch}=await import(${JSON.stringify(new URL('../src/main.ts', import.meta.url).href)}); const app=await launch(); const ended=new Promise(resolve=>app.browser.once('disconnected',resolve)); app.browser.process().kill('SIGKILL'); await ended; await app.shutdown(); console.log('BROWSER_CLEANED');`;
  const crashed = await exec(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', browserCrash], { env:process.env, timeout:30000 });
  assert.match(crashed.stdout, /BROWSER_CLEANED/);
  await assert.rejects(exec(process.execPath, [...childArgs, '--smoke'], {
    env:{ ...process.env, RAUMCAST_BROWSER:join(temporary, 'missing-browser') }, timeout:20000,
  }));
  const restarted = await exec(process.execPath, [...childArgs, '--smoke'], { env:process.env, timeout:45000, maxBuffer:2_000_000 });
  assert.match(restarted.stdout, /Raumcast DEMO gestartet/);
  console.log('Startprüfung: Browserabbruch und fehlgeschlagener Start geben die Instanzsperre frei; Neustart erfolgreich.');
} finally {
  await app.shutdown();
  await rm(temporary, { recursive:true, force:true });
}
