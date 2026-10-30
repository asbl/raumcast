import puppeteer, { type Browser } from 'puppeteer-core';
import { mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CastController, type CastTransport } from './controller.js';
import { dataDirectory, PreferenceStore } from './storage.js';
import { findBrowser } from './browser.js';
import { DemoTransport } from './demo.js';

const demo = process.argv.includes('--demo');
const root = dirname(dirname(fileURLToPath(import.meta.url)));
let browser: Browser | undefined;
let controller: CastController | undefined;
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  controller?.dispose();
  await controller?.store.flush();
  await browser?.close().catch(() => {});
}

export async function launch() {
  const data = join(dataDirectory(), ...(demo ? ['demo'] : []));
  await mkdir(data, { recursive: true, mode: 0o700 });
  const store = new PreferenceStore(join(data, 'rooms.json'));
  await store.load();
  const url = pathToFileURL(join(root, 'ui', 'index.html')).href;
  // Puppeteer's defaults disable MediaRouter. Use only explicit arguments so
  // Cast discovery stays enabled and no feature overrides replace user defaults.
  browser = await puppeteer.launch({
    executablePath: await findBrowser(), headless: false, pipe: true,
    userDataDir: join(data, 'browser-profile'), defaultViewport: null,
    ignoreDefaultArgs: true, protocolTimeout: 120_000,
    args: ['--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check',
      '--window-size=620,780', `--app=${url}`],
  });
  browser.on('disconnected', () => { controller?.dispose(); });
  const pages = await browser.pages();
  const page = pages.find(p => p.url() === url) || pages[0] || await browser.newPage();
  // The bridge is restricted to our local UI; no web server or listening port.
  await page.setRequestInterception(true);
  page.on('request', request => {
    const allowed = request.url() === url || ['app.js', 'style.css'].some(file =>
      request.url() === pathToFileURL(join(root, 'ui', file)).href);
    void (allowed ? request.continue() : request.abort()).catch(() => {});
  });
  const cdp = await page.createCDPSession();
  controller = new CastController(demo ? new DemoTransport() : cdp as unknown as CastTransport, store);
  const cast = controller;
  let initializationError = '';
  await page.exposeFunction('raumcast', async (action: unknown, payload: unknown) => {
    try {
      if (page.url() !== url) throw new Error('Unzulässiger Seitenaufruf.');
      const p = payload as { name?: string; alias?: string; favorite?: boolean } | undefined;
      if (action === 'snapshot') return { ok: true, data: { ...cast.snapshot(), demo, initializationError } };
      if (initializationError) throw new Error(initializationError);
      if (action === 'refresh') await cast.refresh();
      else if (action === 'stop') await cast.stop();
      else if ((action === 'start' || action === 'preference') && typeof p?.name === 'string') {
        if (action === 'start') await cast.start(p.name);
        else await cast.preference(p.name, {
          ...(p.alias !== undefined ? { alias: p.alias.trim() } : {}),
          ...(p.favorite !== undefined ? { favorite: p.favorite } : {}),
        });
      } else throw new Error('Unbekannter Befehl.');
      return { ok: true };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });
  await page.goto(url);
  try { await cast.initialize(); }
  catch (error) {
    initializationError = `Cast-Steuerung konnte nicht gestartet werden: ${(error as Error).message}`;
    console.error(initializationError);
  }
  console.log(`Raumcast${demo ? ' DEMO' : ''} gestartet. Profil und Räume: ${data}`);
  if (process.argv.includes('--smoke')) {
    await page.waitForFunction(() => document.querySelector('#connection')?.textContent?.includes('bereit'));
    await mkdir(join(root, 'artifacts'), { recursive: true });
    await page.screenshot({ path: join(root, 'artifacts', demo ? 'demo.png' : 'live.png') });
    console.log(JSON.stringify({ browser: await browser.version(), ...cast.snapshot(), initializationError }, null, 2));
    if (initializationError) process.exitCode = 1;
    await shutdown();
  }
  page.on('close', () => { void shutdown(); });
  return { browser, page, controller: cast, initializationError, shutdown };
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void shutdown(); });
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) launch().catch(async error => {
  console.error(`Raumcast: ${error.message}`);
  process.exitCode = 1;
  await shutdown();
});
