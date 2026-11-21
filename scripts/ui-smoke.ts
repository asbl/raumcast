import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temporary = await mkdtemp(join(tmpdir(), 'raumcast-ui-'));
process.env.RAUMCAST_DATA_DIR = temporary;
const realFetch = globalThis.fetch;
const appVersion = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
let updateResult: 'available' | 'current' | 'offline' = 'available';
let updateRequests = 0;
globalThis.fetch = (async (url, options) => {
  if (url === 'https://api.github.com/repos/asbl/raumcast/releases/latest') {
    updateRequests++;
    if (updateResult === 'offline') throw new Error('Test: offline');
    return Response.json({ tag_name:updateResult === 'available' ? 'v99.0.0' : `v${appVersion}` });
  }
  return realFetch(url, options);
}) as typeof fetch;
const { launch } = await import('../src/main.js');
const app = await launch();
const errors: string[] = [];
app.page.on('pageerror', error => errors.push(String(error)));

try {
  const page = app.page;
  page.setDefaultTimeout(30000);
  // App windows may stop animation/IntersectionObserver callbacks when the desktop
  // is idle. Poll on timers and send real mouse events after checking the hit target.
  const click = async (selector: string) => {
    await page.waitForSelector(selector);
    const point = await page.$eval(selector, element => {
      element.scrollIntoView({ block:'center', inline:'center', behavior:'instant' });
      const rect = element.getBoundingClientRect();
      const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
      if (!element.contains(document.elementFromPoint(x, y))) throw new Error('Klickziel ist verdeckt.');
      if ((element as HTMLButtonElement).disabled) throw new Error('Klickziel ist deaktiviert.');
      return { x, y };
    });
    await page.mouse.click(point.x, point.y);
  };
  await page.bringToFront();
  // Reproduce the initial app-window load before the command bridge is attached.
  const delayed = await app.browser.newPage();
  try {
    await delayed.goto(page.url());
    await delayed.waitForFunction(() => typeof (window as any).raumcast === 'undefined', { polling:100 });
    assert.equal(await delayed.$eval('#error', el => (el as HTMLElement).hidden), true);
    await delayed.$eval('#refresh', element => (element as HTMLButtonElement).click());
    assert.equal(await delayed.$eval('#error', el => (el as HTMLElement).hidden), true);
    // Advance the connection deadline without making the test wait 15 seconds.
    await delayed.evaluate(async () => {
      const now = Date.now;
      Date.now = () => now() + 16000;
      try { await (window as any).poll(); }
      finally { Date.now = now; }
    });
    assert.equal(await delayed.$eval('#error', el => !(el as HTMLElement).hidden && el.textContent?.includes('Verbindung zur Raumcast-Steuerung fehlt')), true);
    const initialSnapshot = await page.evaluate(() => (window as any).raumcast('snapshot'));
    await delayed.exposeFunction('raumcast', () => initialSnapshot);
    await delayed.waitForSelector('.room');
    assert.equal(await delayed.$eval('#error', el => (el as HTMLElement).hidden), true);
  } finally { await delayed.close(); }
  await page.bringToFront();
  await page.waitForSelector('.room');
  console.log('UI: Raumwahl, Favoriten und Alias');
  await page.waitForFunction(() => (document.querySelector('#session') as HTMLElement).hidden, { polling:100 });
  assert.equal(await page.$eval('#help', element => (element as HTMLDetailsElement).open), false);
  assert.equal(await page.$eval('#about', element => (element as HTMLDetailsElement).open), false);
  assert.equal(await page.$$eval('.room small', elements => elements.length), 0);
  await mkdir('artifacts', { recursive:true });
  await page.screenshot({ path:'artifacts/demo-initial.png' });
  assert.equal(await page.$$eval('.room', rows => rows.length), 7);
  await page.type('#search', '208');
  assert.equal(await page.$eval('#search', element => (element as HTMLInputElement).value), '208');
  await page.waitForFunction(() => document.querySelectorAll('.room').length === 1, { polling:100 });
  assert.equal(await page.$eval('.room strong', el => el.textContent), 'Raum A208');
  await click('.room button[data-action="favorite"]');
  await page.waitForSelector('.starred');
  await click('.room button[data-action="rename"]');
  const originalStoreUpdate = app.controller.store.update.bind(app.controller.store);
  app.controller.store.update = async (name, patch) => {
    if (patch.alias === 'Fehler beim Speichern') throw new Error('Simulierter Schreibfehler');
    await originalStoreUpdate(name, patch);
  };
  await page.type('#alias', 'Fehler beim Speichern');
  await click('#rename-form button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('#error')?.textContent?.includes('Simulierter Schreibfehler'), { polling:100 });
  assert.equal(await page.$eval('#rename-dialog', element => (element as HTMLDialogElement).open), true);
  assert.match(await page.$eval('#rename-error', element => (element as HTMLElement).hidden ? '' : element.textContent!), /Simulierter Schreibfehler/);
  assert.equal(await page.$eval('#alias', element => (element as HTMLInputElement).value), 'Fehler beim Speichern');
  app.controller.store.update = originalStoreUpdate;
  await page.$eval('#alias', element => (element as HTMLInputElement).select());
  await page.type('#alias', 'Physik 208');
  await click('#rename-form button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('.room strong')?.textContent === 'Physik 208', { polling:100 });
  await page.focus('#search');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#session')?.getAttribute('data-phase') === 'active', { polling:100 });
  assert.equal(app.controller.phase, 'active');
  assert.equal(app.controller.owned, 'CWSR208PCWB');
  const activeTransport = app.controller.transport as unknown as import('../src/demo.js').DemoTransport;
  activeTransport.emit('Cast.sinksUpdated', { sinks: [] });
  await page.waitForFunction(() => document.querySelector('#session')?.getAttribute('data-phase') === 'uncertain', { polling:100 });
  assert.equal(await page.$eval('#stop', el => !(el as HTMLButtonElement).hidden && !(el as HTMLButtonElement).disabled), true);
  assert.equal(app.controller.owned, 'CWSR208PCWB');
  await click('#stop');
  await page.waitForFunction(() => (document.querySelector('#session') as HTMLElement)?.hidden, { polling:100 });
  assert.equal(app.controller.phase, 'idle');
  await page.reload();
  await page.bringToFront();
  await page.waitForSelector('.starred');
  await click('#favorites');
  await page.waitForFunction(() => document.querySelectorAll('.room').length === 1, { polling:100 });
  assert.equal(await page.$eval('.room strong', el => el.textContent), 'Physik 208');
  // Combine area, favorites and search, including renamed rooms.
  console.log('UI: Bereichsfilter und wechselnde Empfänger');
  await click('#prefixes button[data-prefix="G"]');
  await page.waitForFunction(() => document.querySelectorAll('.room').length === 0, { polling:100 });
  await click('#all');
  await page.waitForFunction(() => document.querySelectorAll('.room').length === 2, { polling:100 });
  await page.type('#search', '01');
  await page.waitForFunction(() => document.querySelector('.room strong')?.textContent === 'Raum G01', { polling:100 });
  assert.equal(await page.$$eval('.room', rows => rows.length), 1);
  await click('.room button[data-action="rename"]');
  await page.type('#alias', 'Aula');
  await click('#rename-form button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('.room strong')?.textContent === 'Aula', { polling:100 });
  assert.equal(await page.$eval('#prefixes button[aria-pressed="true"]', el => (el as HTMLElement).dataset.prefix), 'G');
  await click('.room button[data-action="favorite"]');
  await page.waitForSelector('.starred');
  await click('#favorites');
  await page.waitForFunction(() => document.querySelectorAll('.room').length === 1, { polling:100 });
  await click('#prefixes button[data-prefix="E"]');
  await page.waitForFunction(() => document.querySelectorAll('.room').length === 0, { polling:100 });
  await click('#all');
  await page.waitForFunction(() => document.querySelector('.room strong')?.textContent === 'Raum E01', { polling:100 });
  // Restore ordinary sorting to reproduce the audit's changing-list scenario.
  await app.controller.store.update('CWSR208PCWB', { alias:'', favorite:false, lastUsed:0 });
  await click('#prefixes button[data-prefix="A"]');
  await page.$eval('#search', el => { (el as HTMLInputElement).value = ''; el.dispatchEvent(new Event('input')); });
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.room strong')).some(el => el.textContent === 'Raum A208'), { polling:100 });
  await page.type('#search', '20');
  await page.waitForFunction(() => document.querySelectorAll('.room').length === 2, { polling:100 });
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.$eval('.room.focused .connect', el => (el as HTMLElement).dataset.name), 'CWSR208PCWB');
  const transport = app.controller.transport as unknown as import('../src/demo.js').DemoTransport;
  transport.sinks.push({ id:'206', name:'CWSR206PCWB' });
  transport.emit('Cast.sinksUpdated', { sinks: structuredClone(transport.sinks) });
  await page.waitForFunction(() => document.querySelectorAll('.room').length === 3, { polling:100 });
  assert.equal(await page.$eval('.room.focused .connect', el => (el as HTMLElement).dataset.name), 'CWSR208PCWB');
  transport.sinks = transport.sinks.filter(sink => sink.name !== 'CWSR208PCWB');
  transport.emit('Cast.sinksUpdated', { sinks: structuredClone(transport.sinks) });
  // The saved room remains visible offline; Enter must not select another room.
  await page.waitForFunction(() => document.querySelector('.room.focused .connect')?.hasAttribute('disabled'), { polling:100 });
  await page.keyboard.press('Enter');
  assert.equal(app.controller.owned, null);
  await click('#prefixes button[data-prefix="G"]');
  await page.$eval('#search', el => { (el as HTMLInputElement).value = ''; el.dispatchEvent(new Event('input')); });
  await page.waitForFunction(() => document.querySelectorAll('.room').length === 2, { polling:100 });
  // A normal receiver click chooses audio automatically, without a mode control.
  console.log('UI: Computerton');
  transport.sinks.push({ id:'audio:onkyo', name:'Onkyo Receiver' });
  transport.emit('Cast.sinksUpdated', { sinks: structuredClone(transport.sinks) });
  await click('#prefixes button[data-prefix="*"]');
  await page.type('#search', 'Onkyo');
  await page.waitForFunction(() => document.querySelectorAll('.room').length === 1, { polling:100 });
  assert.equal(await page.$('#transfer-mode'), null);
  await click('.room .connect');
  await page.waitForFunction(() => document.querySelector('#session')?.getAttribute('data-phase') === 'active' && document.querySelector('#session')?.getAttribute('data-mode') === 'audio', { polling:100 });
  assert.equal(app.controller.mode, 'audio');
  assert.equal(await page.$eval('#audio-note', el => !(el as HTMLElement).hidden), true);
  await page.reload();
  await page.bringToFront();
  await page.waitForFunction(() => document.querySelector('#session')?.getAttribute('data-phase') === 'active' && document.querySelector('#session')?.getAttribute('data-mode') === 'audio', { polling:100 });
  assert.equal(app.controller.mode, 'audio');
  await click('#stop');
  await page.waitForFunction(() => (document.querySelector('#session') as HTMLElement)?.hidden, { polling:100 });
  assert.equal(await page.$eval('#audio-note', el => (el as HTMLElement).hidden), true);
  await click('#prefixes button[data-prefix="G"]');
  await page.waitForFunction(() => document.querySelectorAll('.room').length === 2, { polling:100 });
  // View settings persist independently of rooms and are restored on reload.
  console.log('UI: gespeicherte Filter und zuletzt verwendete Räume');
  await app.controller.store.update('CWSR208PCWB', { lastUsed:Date.now() - 1000 });
  await click('#favorites');
  await page.waitForFunction(() => document.querySelectorAll('.room').length === 1, { polling:100 });
  await page.waitForFunction(async () => {
    const result = await (window as any).raumcast('snapshot');
    return result.data.viewSettings.favoritesOnly && result.data.viewSettings.prefix === 'G';
  }, { polling:100 });
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#favorites')?.getAttribute('aria-pressed') === 'true' && document.querySelector('#prefixes button[aria-pressed="true"]')?.getAttribute('data-prefix') === 'G', { polling:100 });
  assert.equal(await page.$$eval('.room', rows => rows.length), 1);
  assert.equal(await page.$eval('#recent', el => !(el as HTMLElement).hidden), true);
  // A recent offline target is visible but cannot be started.
  assert.equal(await page.$eval('#recent-rooms button[data-recent-name="CWSR208PCWB"]', el => (el as HTMLButtonElement).disabled), true);
  // Recent targets deliberately remain accessible across area/favorite filters.
  console.log('UI: Diagnose und Wiederherstellung');
  await click('#recent-rooms button[data-recent-name="Onkyo Receiver"]');
  await page.waitForFunction(() => document.querySelector('#session')?.getAttribute('data-phase') === 'active' && document.querySelector('#session')?.getAttribute('data-mode') === 'audio', { polling:100 });
  await click('#help summary');
  await page.waitForFunction(() => (document.querySelector('#diagnostics') as HTMLTextAreaElement)?.value.includes('Eigenes Ziel: Onkyo Receiver'), { polling:100 });
  assert.equal(await page.$eval('#recover', el => el.textContent), 'Übertragung beenden und neu suchen');
  await click('#recover');
  await page.waitForFunction(() => (document.querySelector('#session') as HTMLElement)?.hidden && !(document.querySelector('#recover') as HTMLButtonElement)?.disabled, { polling:100 });
  assert.equal(app.controller.owned, null);
  await click('#copy-diagnostics');
  await page.waitForFunction(() => !!document.querySelector('#copy-status')?.textContent, { polling:100 });
  assert.match(await page.$eval('#diagnostics', el => (el as HTMLTextAreaElement).value), /Eigenes Ziel: keines/);
  assert.match(await page.$eval('#diagnostics', el => (el as HTMLTextAreaElement).value), /Browser: Chrome/);
  assert.equal(updateRequests, 0); // Demo never contacts GitHub automatically.
  console.log('UI: Updates und Offline-Wiederholung');
  await click('#about summary');
  await click('#check-update');
  await page.waitForFunction(() => document.querySelector('#update-status')?.textContent?.includes('99.0.0'), { polling:100 });
  assert.equal(await page.$eval('#download', el => (el as HTMLElement).hidden), false);
  await click('#about summary');
  assert.equal(await page.$eval('#update-notice', element => (element as HTMLElement).hidden), false);
  await click('#update-notice');
  assert.equal(await page.$eval('#about', element => (element as HTMLDetailsElement).open), true);
  // Exercise the real download action while keeping the browser test offline.
  const originalNewPage = app.browser.newPage.bind(app.browser);
  let downloadTab: Awaited<ReturnType<typeof originalNewPage>> | undefined;
  app.browser.newPage = async () => {
    downloadTab = await originalNewPage();
    await downloadTab.setRequestInterception(true);
    downloadTab.on('request', request => { void request.respond({ status:200, contentType:'text/html', body:'<!doctype html><title>Raumcast Downloads</title>' }); });
    return downloadTab;
  };
  try {
    await click('#download');
    await app.browser.waitForTarget(target => target.url() === 'https://github.com/asbl/raumcast/releases/latest');
    assert.equal(downloadTab?.url(), 'https://github.com/asbl/raumcast/releases/latest');
    await downloadTab!.waitForFunction(() => document.title === 'Raumcast Downloads', { polling:100 });
  } finally {
    app.browser.newPage = originalNewPage;
    await downloadTab?.close();
    await page.bringToFront();
  }
  updateResult = 'offline';
  await click('#check-update');
  await page.waitForFunction(() => document.querySelector('#update-status')?.textContent?.includes('offline'), { polling:100 });
  assert.equal(await page.$eval('#download', el => (el as HTMLElement).hidden), true);
  updateResult = 'current';
  await click('#check-update');
  await page.waitForFunction(() => document.querySelector('#update-status')?.textContent?.includes('Kein Update verfügbar'), { polling:100 });
  // Failed filter persistence must remain visible after unrelated commands.
  await page.evaluate(() => {
    const original = (window as any).raumcast;
    (window as any).restoreBridge = () => { (window as any).raumcast = original; };
    (window as any).raumcast = async (action: string, payload: unknown) => {
      if (action === 'viewSettings') return { ok:false, error:'Simulierter Filterfehler' };
      if (action === 'diagnostics') return { ok:false, error:'Simulierter Diagnosefehler' };
      return original(action, payload);
    };
  });
  await click('#all');
  await page.waitForFunction(() => document.querySelector('#error')?.textContent?.includes('Raumfilter konnten nicht gespeichert'), { polling:100 });
  await click('#check-update');
  await page.waitForFunction(() => document.querySelector('#update-status')?.textContent?.includes('Kein Update verfügbar'), { polling:100 });
  assert.match(await page.$eval('#error', element => element.textContent!), /Raumfilter konnten nicht gespeichert/);
  await click('#copy-diagnostics');
  await page.waitForFunction(() => document.querySelector('#copy-status')?.textContent?.includes('konnte nicht geladen'), { polling:100 });
  assert.equal(await page.$eval('#diagnostics', element => (element as HTMLTextAreaElement).value), '');
  await page.evaluate(() => (window as any).restoreBridge());
  await click('#all');
  await page.waitForFunction(() => (document.querySelector('#error') as HTMLElement).hidden, { polling:100 });
  // A failed download must close the newly created tab.
  updateResult = 'available';
  await click('#check-update');
  await page.waitForFunction(() => !(document.querySelector('#download') as HTMLElement).hidden, { polling:100 });
  const failedTabClosed = new Promise<void>(resolve => {
    app.browser.newPage = async () => {
      const tab = await originalNewPage();
      tab.once('close', () => resolve());
      await tab.setRequestInterception(true);
      tab.on('request', request => { void request.abort('failed'); });
      return tab;
    };
  });
  try {
    await click('#download'); await failedTabClosed;
    await page.bringToFront();
    await page.waitForFunction(() => document.querySelector('#error')?.textContent?.includes('ERR_FAILED'), { polling:100 });
  } finally { app.browser.newPage = originalNewPage; }
  await click('#help summary');
  await click('#all');
  await page.waitForFunction(() => document.querySelectorAll('.room').length === 2, { polling:100 });
  await page.$eval('#search', element => { (element as HTMLInputElement).value = 'kein solcher Raum'; element.dispatchEvent(new Event('input')); });
  await page.waitForFunction(() => document.querySelectorAll('.room').length === 0, { polling:100 });
  assert.equal(await page.$eval('#empty-hint', element => (element as HTMLElement).hidden), true);
  await click('#reset-filters');
  await page.waitForFunction((count: number) => document.querySelectorAll('.room').length === count, { polling:100 }, app.controller.snapshot().rooms.length);
  assert.equal(await page.$eval('#search', element => (element as HTMLInputElement).value), '');
  await click('#prefixes button[data-prefix="G"]');
  await mkdir('artifacts', { recursive:true });
  await page.$eval('#about', element => { (element as HTMLDetailsElement).open = false; });
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path:'artifacts/demo.png' });
  assert.deepEqual(errors, []);
  console.log('UI-Test erfolgreich: Suche, Favorit, Alias, Enter, Start/Stopp, stabile Raumauswahl, Computerton, gespeicherte Filter, zuletzt verwendete Räume, Diagnose, Wiederherstellung und Updates.');
} catch(error) {
  console.log('UI diagnostic', errors, app.controller.snapshot(), await app.page.evaluate(() => ({ search:(document.querySelector('#search') as HTMLInputElement)?.value, text:document.body.innerText })));
  throw error;
} finally {
  globalThis.fetch = realFetch;
  await app.shutdown();
  await rm(temporary, { recursive:true, force:true });
}
