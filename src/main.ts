import puppeteer, { type Browser } from 'puppeteer-core';
import { mkdir } from 'node:fs/promises';
import { appendFileSync, statSync, renameSync } from 'node:fs';
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
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  controller?.dispose();
  try { await controller?.store.flush(); }
  catch(error) { console.error(`Einstellungen konnten nicht gespeichert werden: ${String(error)}`); process.exitCode = 1; }
  finally { await browser?.close().catch(() => {}); }
}

export async function launch() {
  const data = join(dataDirectory(), ...(demo ? ['demo'] : []));
  await mkdir(data, { recursive: true, mode: 0o700 });
  const logPath = join(data, 'raumcast.log');
  try { if (statSync(logPath).size > 1_000_000) renameSync(logPath, logPath + '.old'); } catch {}
  const log = (message: string) => {
    try { appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`, { mode: 0o600 }); } catch {}
  };
  log(`Start: Programmordner ${root}; Demo ${demo}`);
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
    args: ['--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check', ...graphicsArgs,
      '--window-size=620,780', `--user-data-dir=${join(data, 'browser-profile')}`, `--app=${url}`],
  });
  log(`Browser: ${await browser.version()}`);
  browser.on('disconnected', () => { log(closing ? 'Browser regulär beendet.' : 'Browserverbindung unerwartet beendet.'); controller?.dispose(); });
  // Wait for the app window itself; an initial/other tab can otherwise receive
  // the bridge while the visible app window remains uninitialized.
  const target = await browser.waitForTarget(t => t.type() === 'page' && sameLocalFile(t.url(), url), { timeout: 30_000 });
  const page = await target.page();
  if (!page) throw new Error('Das Raumcast-Fenster konnte nicht geöffnet werden.');
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
  await page.goto(url);
  try {
    await page.waitForFunction(() => !!document.querySelector('#search') && !!document.querySelector('#count')?.textContent, { timeout: 15_000 });
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
  console.error(`Raumcast: ${error.message}`);
  process.exitCode = 1;
  await shutdown();
});
