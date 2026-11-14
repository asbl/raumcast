import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { mkdir } from 'node:fs/promises';
import { appendFileSync, statSync, renameSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CastController } from './controller.js';
import { dataDirectory, PreferenceStore } from './storage.js';
import { findBrowser, browserGraphicsArgs } from './browser.js';
import { ChromiumCastTransport } from './cast-support.js';
import { DemoTransport } from './demo.js';
import { sameLocalFile } from './local-ui.js';

const demo = process.argv.includes('--demo');
const root = dirname(dirname(fileURLToPath(import.meta.url)));
let browser: Browser | undefined;
let controller: CastController | undefined;
let activePage: Page | undefined;
let lockPath: string | undefined;
let closing = false;
export class AlreadyRunningError extends Error {}
// A running instance that shares the browser profile would otherwise silently absorb the
// new launch into an un-wired window (Chromium's single-instance forwarding), hanging the
// new process instead of failing. Detect it up front via a PID lock and bail out early.
function readLivePid(path: string): number | undefined {
  let pid: number;
  try { pid = Number(readFileSync(path, 'utf8').trim()); }
  catch { return undefined; }
  if (!Number.isInteger(pid)) return undefined;
  try { process.kill(pid, 0); return pid; }
  catch { return undefined; }
}
async function shutdown() {
  if (closing) return;
  closing = true;
  controller?.dispose();
  try { await controller?.store.flush(); }
  catch(error) { console.error(`Einstellungen konnten nicht gespeichert werden: ${String(error)}`); process.exitCode = 1; }
  finally {
    await browser?.close().catch(() => {});
    if (lockPath) try { unlinkSync(lockPath); } catch {}
  }
}
// Asks an already-running instance to raise its window; Windows cannot deliver SIGUSR1
// between processes, so there the user just sees the "already running" message instead.
process.on('SIGUSR1', () => { void activePage?.bringToFront().catch(() => {}); });

export async function launch() {
  const data = join(dataDirectory(), ...(demo ? ['demo'] : []));
  await mkdir(data, { recursive: true, mode: 0o700 });
  const logPath = join(data, 'raumcast.log');
  try { if (statSync(logPath).size > 1_000_000) renameSync(logPath, logPath + '.old'); } catch {}
  const log = (message: string) => {
    try { appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`, { mode: 0o600 }); } catch {}
  };
  log(`Start: Programmordner ${root}; Demo ${demo}`);
  const pidPath = join(data, 'raumcast.pid');
  const existing = readLivePid(pidPath);
  if (existing !== undefined) {
    log(`Bereits laufende Instanz erkannt (PID ${existing}); Start abgebrochen.`);
    try { process.kill(existing, 'SIGUSR1'); } catch {}
    throw new AlreadyRunningError(`Raumcast läuft bereits (PID ${existing}). Das vorhandene Fenster wurde in den Vordergrund geholt.`);
  }
  writeFileSync(pidPath, String(process.pid), { mode: 0o600 });
  lockPath = pidPath;
  const store = new PreferenceStore(join(data, 'rooms.json'));
  await store.load();
  const url = pathToFileURL(join(root, 'ui', 'index.html')).href;
  const graphicsArgs = browserGraphicsArgs();
  log(`Plattform: ${process.platform}; Grafik: ${graphicsArgs.length ? 'Software (--disable-gpu)' : 'Browserstandard'}`);
  // Puppeteer's defaults disable MediaRouter. Use only explicit arguments so
  // Cast discovery stays enabled and no feature overrides replace user defaults.
  browser = await puppeteer.launch({
    executablePath: await findBrowser(), headless: false, pipe: true,
    dumpio: process.env.RAUMCAST_DEBUG === '1',
    userDataDir: join(data, 'browser-profile'), defaultViewport: null,
    ignoreDefaultArgs: true, protocolTimeout: 120_000,
    // --class sets the X11 WM_CLASS and CHROME_DESKTOP the Wayland app_id; both are matched
    // against the installed raumcast.desktop's StartupWMClass/filename so GNOME Shell and
    // similar desktops show the Raumcast icon instead of a generic Chromium one.
    env: { ...process.env, CHROME_DESKTOP: 'raumcast.desktop' },
    args: ['--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check', ...graphicsArgs,
      '--window-size=620,780', `--user-data-dir=${join(data, 'browser-profile')}`, '--class=Raumcast', `--app=${url}`],
  });
  log(`Browser: ${await browser.version()}`);
  browser.on('disconnected', () => { log(closing ? 'Browser regulär beendet.' : 'Browserverbindung unerwartet beendet.'); controller?.dispose(); });
  // Wait for the app window itself; an initial/other tab can otherwise receive
  // the bridge while the visible app window remains uninitialized.
  const target = await browser.waitForTarget(t => t.type() === 'page' && sameLocalFile(t.url(), url), { timeout: 30_000 });
  log(`App-Fenster gefunden: ${target.url()}`);
  const page = await target.page();
  if (!page) throw new Error('Das Raumcast-Fenster konnte nicht geöffnet werden.');
  activePage = page;
  // The command bridge is restricted to our local UI.
  await page.setRequestInterception(true);
  page.on('request', request => {
    const allowed = sameLocalFile(request.url(), url) || ['app.js', 'style.css'].some(file =>
      sameLocalFile(request.url(), pathToFileURL(join(root, 'ui', file)).href));
    if (!allowed) log(`Oberflächenanfrage blockiert: ${request.url()}`);
    void (allowed ? request.continue() : request.abort()).catch(() => {});
  });
  page.on('requestfailed', request => log(`Oberfläche konnte Datei nicht laden: ${request.url()}; ${request.failure()?.errorText}`));
  const cdp = await page.createCDPSession();
  controller = new CastController(demo ? new DemoTransport() : new ChromiumCastTransport(browser, cdp, log), store);
  const cast = controller;
  page.on('error', error => log(`Oberfläche abgestürzt: ${error.message}`));
  page.on('pageerror', error => log(`Oberflächenfehler: ${String(error)}`));
  let initializationError = '';
  let initializing = true;
  const initializationMessage = (error:unknown) => `Cast-Steuerung konnte nicht gestartet werden: ${error instanceof Error ? error.message : String(error)}`;
  await page.exposeFunction('raumcast', async (action: unknown, payload: unknown) => {
    try {
      if (!sameLocalFile(page.url(), url)) throw new Error('Unzulässiger Seitenaufruf.');
      const p = payload as { name?: string; alias?: string; favorite?: boolean; mode?: unknown } | undefined;
      if (action === 'snapshot') return { ok: true, data: { ...cast.snapshot(), demo, systemAudioSupported: demo || process.platform === 'linux', initializing, initializationError } };
      if (action === 'refresh') {
        if (initializing) throw new Error('Cast wird noch initialisiert.');
        if (cast.busy || cast.owned) throw new Error('Bitte zuerst die laufende Übertragung beenden.');
        initializing = true;
        try {
          if (initializationError) await cast.initialize(); else await cast.refresh();
          initializationError = '';
        } catch(error) { initializationError = initializationMessage(error); throw error; }
        finally { initializing = false; }
      }
      else if (action === 'stop') await cast.stop();
      else if ((action === 'start' || action === 'preference') && typeof p?.name === 'string') {
        if (action === 'start') {
          if (initializing || initializationError) throw new Error(initializationError || 'Cast wird noch initialisiert.');
          if (p.mode !== undefined && p.mode !== 'desktop' && p.mode !== 'audio' && p.mode !== 'auto') throw new Error('Unbekannter Übertragungsmodus.');
          await cast.start(p.name, p.mode ?? 'auto');
        }
        else await cast.preference(p.name, {
          ...(p.alias !== undefined ? { alias: p.alias.trim() } : {}),
          ...(p.favorite !== undefined ? { favorite: p.favorite } : {}),
        });
      } else throw new Error('Unbekannter Befehl.');
      return { ok: true };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (action !== 'snapshot') log(`Befehl ${String(action)} fehlgeschlagen: ${message}`);
      return { ok: false, error: message };
    }
  });
  log('Programmsteuerung bereitgestellt; Oberfläche wird geladen.');
  await page.goto(url);
  try {
    await page.waitForFunction(() => typeof (window as any).raumcast === 'function' && !!document.querySelector('#search') && !!document.querySelector('#count')?.textContent, { timeout: 15_000 });
    log('Oberfläche mit Programmsteuerung verbunden.');
    await page.bringToFront();
  } catch (error) {
    log(`Oberfläche nicht startbereit: ${String(error)}`);
    throw new Error(`Raumcast-Oberfläche konnte nicht geladen werden. Details: ${logPath}`);
  }
  try { await cast.initialize(); }
  catch (error) {
    initializationError = initializationMessage(error);
    console.error(initializationError);
  } finally { initializing = false; }
  console.log(`Raumcast${demo ? ' DEMO' : ''} gestartet. Profil und Räume: ${data}`);
  if (process.argv.includes('--smoke')) {
    if (!initializationError) await page.waitForFunction(() => document.querySelector('#connection')?.textContent?.includes('bereit'));
    await mkdir(join(root, 'artifacts'), { recursive: true });
    await page.screenshot({ path: join(root, 'artifacts', demo ? 'demo.png' : 'live.png') });
    console.log(JSON.stringify({ browser: await browser.version(), ...cast.snapshot(), initializationError }, null, 2));
    if (initializationError) process.exitCode = 1;
    await shutdown();
  }
  page.on('close', () => { void shutdown(); });
  return { browser, page, controller: cast, get initializationError() { return initializationError; }, shutdown };
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void shutdown(); });
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) launch().catch(async error => {
  if (error instanceof AlreadyRunningError) console.log(error.message);
  else { console.error(`Raumcast: ${error.message}`); process.exitCode = 1; }
  await shutdown();
});
