import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { mkdir } from 'node:fs/promises';
import { appendFileSync, statSync, renameSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CastController } from './controller.js';
import { dataDirectory, PreferenceStore } from './storage.js';
import { findBrowser, browserGraphicsArgs } from './browser.js';
import { ChromiumCastTransport } from './cast-support.js';
import { DemoTransport } from './demo.js';
import { sameLocalFile } from './local-ui.js';
import { ViewSettingsStore } from './view-settings.js';
import { UpdateChecker, releasesUrl } from './updates.js';
import { AppInstance } from './instance.js';

const demo = process.argv.includes('--demo');
const root = dirname(dirname(fileURLToPath(import.meta.url)));
let browser: Browser | undefined;
let controller: CastController | undefined;
let activePage: Page | undefined;
let instance: AppInstance | undefined;
let activationRequested = false;
let closing = false;
let shutdownTask: Promise<void> | undefined;
let viewSettings: ViewSettingsStore | undefined;
export class AlreadyRunningError extends Error {}
async function activateWindow() {
  if (closing) throw new Error('Raumcast wird beendet. Bitte danach erneut starten.');
  activationRequested = true;
  if (!activePage || activePage.isClosed()) return;
  const session = await activePage.createCDPSession();
  try {
    const { windowId, bounds } = await session.send('Browser.getWindowForTarget');
    if (bounds.windowState === 'minimized') await session.send('Browser.setWindowBounds', { windowId, bounds:{ windowState:'normal' } });
    await activePage.bringToFront();
    activationRequested = false;
  } finally { await session.detach().catch(() => {}); }
}
function shutdown(): Promise<void> {
  return shutdownTask ??= performShutdown();
}
async function performShutdown() {
  closing = true;
  controller?.dispose();
  try { await Promise.all([controller?.store.flush(), viewSettings?.flush()]); }
  catch(error) { console.error(`Einstellungen konnten nicht gespeichert werden: ${String(error)}`); process.exitCode = 1; }
  finally {
    await browser?.close().catch(() => {});
    await instance?.close();
  }
}

async function launchApplication() {
  const data = join(dataDirectory(), ...(demo ? ['demo'] : []));
  await mkdir(data, { recursive: true, mode: 0o700 });
  const logPath = join(data, 'raumcast.log');
  try { if (statSync(logPath).size > 1_000_000) renameSync(logPath, logPath + '.old'); } catch {}
  const log = (message: string) => {
    try { appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`, { mode: 0o600 }); } catch {}
  };
  log(`Start: Programmordner ${root}; Demo ${demo}`);
  instance = new AppInstance(activateWindow, () => browser?.process()?.pid);
  const ownership = await instance.acquire(data);
  if (closing) { await instance.close(); throw new Error('Raumcast wurde während des Starts beendet.'); }
  if (ownership === 'activated') {
    log('Vorhandene Instanz aktiviert; zweiter Start beendet.');
    throw new AlreadyRunningError('Raumcast läuft bereits. Das vorhandene Fenster wurde aktiviert oder wird nach dem Start angezeigt.');
  }
  const store = new PreferenceStore(join(data, 'rooms.json'));
  await store.load();
  viewSettings = new ViewSettingsStore(join(data, 'view-settings.json'));
  await viewSettings.load();
  const settings = viewSettings;
  const recoveries = [store.recovery, settings.recovery].filter(item => item !== undefined);
  for (const recovery of recoveries) log(recovery.message);
  let recoveryAcknowledged = false;
  const version = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version:string }).version;
  const updates = new UpdateChecker(version);
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
  if (closing) { await browser.close(); throw new Error('Raumcast wurde während des Starts beendet.'); }
  const browserVersion = await browser.version();
  log(`Raumcast: ${version}; Browser: ${browserVersion}`);
  browser.on('disconnected', () => {
    log(closing ? 'Browser regulär beendet.' : 'Browserverbindung unerwartet beendet.');
    void shutdown();
  });
  // Wait for the app window itself; an initial/other tab can otherwise receive
  // the bridge while the visible app window remains uninitialized.
  const target = await browser.waitForTarget(t => t.type() === 'page' && sameLocalFile(t.url(), url), { timeout: 30_000 });
  log(`App-Fenster gefunden: ${target.url()}`);
  const page = await target.page();
  if (!page) throw new Error('Das Raumcast-Fenster konnte nicht geöffnet werden.');
  activePage = page;
  page.once('close', () => { void shutdown(); });
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
  page.on('error', error => { log(`Oberfläche abgestürzt: ${error.message}`); void shutdown(); });
  page.on('pageerror', error => log(`Oberflächenfehler: ${String(error)}`));
  let initializationError = '';
  let initializing = true;
  const initializationMessage = (error:unknown) => `Cast-Steuerung konnte nicht gestartet werden: ${error instanceof Error ? error.message : String(error)}`;
  await page.exposeFunction('raumcast', async (action: unknown, payload: unknown) => {
    try {
      if (!sameLocalFile(page.url(), url)) throw new Error('Unzulässiger Seitenaufruf.');
      const p = payload as { name?: string; alias?: string; favorite?: boolean; mode?: unknown } | undefined;
      if (closing) throw new Error('Raumcast wird beendet.');
      if (action === 'snapshot') return { ok: true, data: { ...cast.snapshot(), demo, systemAudioSupported: demo || process.platform === 'linux', initializing, initializationError, version, viewSettings:settings.value, update:updates.status, recoveries:recoveryAcknowledged ? [] : recoveries } };
      if (action === 'diagnostics') {
        const state = cast.snapshot();
        return { ok:true, data:[
          `Raumcast ${version}${demo ? ' DEMO' : ''} · ${new Date().toISOString()}`,
          `System: ${process.platform}/${process.arch}; Node ${process.version}`,
          `Browser: ${browserVersion}; Grafik: ${graphicsArgs.length ? 'Software' : 'Browserstandard'}`,
          `Cast: ${initializing ? 'wird vorbereitet' : initializationError ? 'nicht bereit' : 'bereit'}`,
          `Sitzung: ${state.phase}; Modus: ${state.mode}; beschäftigt: ${state.busy}`,
          `Eigenes Ziel: ${state.owned || 'keines'}`,
          `Empfänger: ${state.rooms.filter(room => room.available).length} verfügbar; ${state.rooms.filter(room => room.ambiguous).length} mehrdeutig; ${state.rooms.filter(room => room.session).length} mit Sitzung`,
          `Letzte Empfängermeldung: ${cast.lastDiscoveryAt ? new Date(cast.lastDiscoveryAt).toISOString() : 'noch keine'}`,
          `Fehler: ${initializationError || state.issue || 'keiner'}`,
          `Updateprüfung: ${updates.status.state}${updates.status.latest ? '; neueste Version ' + updates.status.latest : ''}`,
          `Programmordner: ${root}`, `Protokoll: ${logPath}`,
          ...recoveries.map(recovery => recovery.message),
        ].join('\n') };
      }
      if (action === 'acknowledgeRecovery') recoveryAcknowledged = true;
      else if (action === 'viewSettings') await settings.update(payload);
      else if (action === 'checkUpdate') await updates.check();
      else if (action === 'openDownload') {
        const downloadPage = await browser!.newPage();
        try {
          await downloadPage.goto(releasesUrl, { waitUntil:'domcontentloaded', timeout:15_000 });
          await downloadPage.bringToFront();
        } catch (error) { await downloadPage.close().catch(() => {}); throw error; }
      }
      else if (action === 'refresh' || action === 'recover') {
        if (initializing) throw new Error('Cast wird noch initialisiert.');
        if (cast.busy || (action === 'refresh' && cast.owned)) throw new Error('Bitte zuerst die laufende Übertragung beenden.');
        initializing = true;
        try {
          if (action === 'recover') await cast.recover();
          else if (initializationError) await cast.initialize(); else await cast.refresh();
          initializationError = '';
        } catch(error) {
          if (!cast.owned) initializationError = initializationMessage(error);
          throw error;
        }
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
    await page.waitForFunction(() => typeof (window as any).raumcast === 'function' && !!document.querySelector('#search') && !!document.querySelector('#count')?.textContent, { timeout: 15_000, polling:100 });
    log('Oberfläche mit Programmsteuerung verbunden.');
    await page.bringToFront();
    if (activationRequested) await activateWindow();
  } catch (error) {
    log(`Oberfläche nicht startbereit: ${String(error)}`);
    throw new Error(`Raumcast-Oberfläche konnte nicht geladen werden. Details: ${logPath}`);
  }
  try { await cast.initialize(); }
  catch (error) {
    initializationError = initializationMessage(error);
    console.error(initializationError);
  } finally { initializing = false; }
  if (!demo && !process.argv.includes('--smoke')) void updates.check();
  console.log(`Raumcast${demo ? ' DEMO' : ''} gestartet. Profil und Räume: ${data}`);
  if (process.argv.includes('--smoke')) {
    if (!initializationError) await page.waitForFunction(() => document.querySelector('#session')?.getAttribute('data-ready') === 'true', { polling:100 });
    await mkdir(join(root, 'artifacts'), { recursive: true });
    await page.screenshot({ path: join(root, 'artifacts', demo ? 'demo.png' : 'live.png') });
    console.log(JSON.stringify({ browser: await browser.version(), ...cast.snapshot(), initializationError }, null, 2));
    if (initializationError) process.exitCode = 1;
    await shutdown();
  }
  return { browser, page, controller: cast, get initializationError() { return initializationError; }, shutdown };
}
export async function launch() {
  try { return await launchApplication(); }
  catch (error) { await shutdown(); throw error; }
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void shutdown(); });
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) launch().catch(async error => {
  if (error instanceof AlreadyRunningError) console.log(error.message);
  else { console.error(`Raumcast: ${error.message}`); process.exitCode = 1; }
  await shutdown();
});
