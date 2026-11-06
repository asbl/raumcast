import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temporary = await mkdtemp(join(tmpdir(), 'raumcast-ui-'));
process.env.RAUMCAST_DATA_DIR = temporary;
const { launch } = await import('../src/main.js');
const app = await launch();
const errors: string[] = [];
app.page.on('pageerror', error => errors.push(String(error)));
try {
  const page = app.page;
  page.setDefaultTimeout(30000);
  await page.bringToFront();
  // Reproduce the initial app-window load before the command bridge is attached.
  const delayed = await app.browser.newPage();
  try {
    await delayed.goto(page.url());
    await delayed.waitForFunction(() => typeof (window as any).raumcast === 'undefined');
    assert.equal(await delayed.$eval('#error', el => (el as HTMLElement).hidden), true);
    await delayed.click('#refresh');
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
  assert.equal(await page.$$eval('.room', rows => rows.length), 7);
  await page.type('#search', '208');
  await page.waitForFunction(() => document.querySelectorAll('.room').length === 1);
  assert.equal(await page.$eval('.room strong', el => el.textContent), 'Raum A208');
  await page.click('.room button[data-action="favorite"]');
  await page.waitForSelector('.starred');
  await page.click('.room button[data-action="rename"]');
  await page.type('#alias', 'Physik 208');
  await page.click('#rename-form button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('.room strong')?.textContent === 'Physik 208');
  await page.focus('#search');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#connection')?.textContent?.includes('Sitzung gemeldet'));
  assert.equal(app.controller.phase, 'active');
  assert.equal(app.controller.owned, 'CWSR208PCWB');
  const activeTransport = app.controller.transport as unknown as import('../src/demo.js').DemoTransport;
  activeTransport.emit('Cast.sinksUpdated', { sinks: [] });
  await page.waitForFunction(() => document.querySelector('#connection')?.textContent?.includes('nicht bestätigt'));
  assert.equal(await page.$eval('#stop', el => !(el as HTMLButtonElement).hidden && !(el as HTMLButtonElement).disabled), true);
  assert.equal(app.controller.owned, 'CWSR208PCWB');
  await page.click('#stop');
  await page.waitForFunction(() => document.querySelector('#connection')?.textContent?.includes('bereit'));
  assert.equal(app.controller.phase, 'idle');
  await page.reload();
  await page.bringToFront();
  await page.waitForSelector('.starred');
  await page.click('#favorites');
  await page.waitForFunction(() => document.querySelectorAll('.room').length === 1);
  assert.equal(await page.$eval('.room strong', el => el.textContent), 'Physik 208');
  // Combine area, favorites and search, including renamed rooms.
  await page.click('#prefixes button[data-prefix="G"]');
  await page.waitForFunction(() => document.querySelectorAll('.room').length === 0);
  await page.click('#all');
  await page.waitForFunction(() => document.querySelectorAll('.room').length === 2);
  await page.type('#search', '01');
  await page.waitForFunction(() => document.querySelector('.room strong')?.textContent === 'Raum G01');
  assert.equal(await page.$$eval('.room', rows => rows.length), 1);
  await page.click('.room button[data-action="rename"]');
  await page.type('#alias', 'Aula');
  await page.click('#rename-form button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('.room strong')?.textContent === 'Aula');
  assert.equal(await page.$eval('#prefixes button[aria-pressed="true"]', el => (el as HTMLElement).dataset.prefix), 'G');
  await page.click('.room button[data-action="favorite"]');
  await page.waitForSelector('.starred');
  await page.click('#favorites');
  await page.waitForFunction(() => document.querySelectorAll('.room').length === 1);
  await page.click('#prefixes button[data-prefix="E"]');
  await page.waitForFunction(() => document.querySelectorAll('.room').length === 0);
  await page.click('#all');
  await page.waitForFunction(() => document.querySelector('.room strong')?.textContent === 'Raum E01');
  // Restore ordinary sorting to reproduce the audit's changing-list scenario.
  await app.controller.store.update('CWSR208PCWB', { alias:'', favorite:false, lastUsed:0 });
  await page.click('#prefixes button[data-prefix="A"]');
  await page.$eval('#search', el => { (el as HTMLInputElement).value = ''; el.dispatchEvent(new Event('input')); });
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.room strong')).some(el => el.textContent === 'Raum A208'));
  await page.type('#search', '20');
  await page.waitForFunction(() => document.querySelectorAll('.room').length === 2);
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.$eval('.room.focused small', el => el.textContent), 'CWSR208PCWB');
  const transport = app.controller.transport as unknown as import('../src/demo.js').DemoTransport;
  transport.sinks.push({ id:'206', name:'CWSR206PCWB' });
  transport.emit('Cast.sinksUpdated', { sinks: structuredClone(transport.sinks) });
  await page.waitForFunction(() => document.querySelectorAll('.room').length === 3);
  assert.equal(await page.$eval('.room.focused small', el => el.textContent), 'CWSR208PCWB');
  transport.sinks = transport.sinks.filter(sink => sink.name !== 'CWSR208PCWB');
  transport.emit('Cast.sinksUpdated', { sinks: structuredClone(transport.sinks) });
  // The saved room remains visible offline; Enter must not select another room.
  await page.waitForFunction(() => document.querySelector('.room.focused .connect')?.hasAttribute('disabled'));
  await page.keyboard.press('Enter');
  assert.equal(app.controller.owned, null);
  await page.click('#prefixes button[data-prefix="G"]');
  await page.$eval('#search', el => { (el as HTMLInputElement).value = ''; el.dispatchEvent(new Event('input')); });
  await page.waitForFunction(() => document.querySelectorAll('.room').length === 2);
  // A normal receiver click chooses audio automatically, without a mode control.
  transport.sinks.push({ id:'audio:onkyo', name:'Onkyo Receiver' });
  transport.emit('Cast.sinksUpdated', { sinks: structuredClone(transport.sinks) });
  await page.click('#prefixes button[data-prefix="*"]');
  await page.type('#search', 'Onkyo');
  await page.waitForFunction(() => document.querySelectorAll('.room').length === 1);
  assert.equal(await page.$('#transfer-mode'), null);
  await page.click('.room .connect');
  await page.waitForFunction(() => document.querySelector('#instruction')?.textContent?.includes('Computerton wird übertragen'));
  assert.equal(app.controller.mode, 'audio');
  assert.equal(await page.$eval('#audio-note', el => !(el as HTMLElement).hidden), true);
  await page.reload();
  await page.bringToFront();
  await page.waitForFunction(() => document.querySelector('#instruction')?.textContent?.includes('Computerton wird übertragen'));
  assert.equal(app.controller.mode, 'audio');
  await page.click('#stop');
  await page.waitForFunction(() => document.querySelector('#connection')?.textContent?.includes('bereit'));
  assert.equal(await page.$eval('#audio-note', el => (el as HTMLElement).hidden), true);
  await page.click('#prefixes button[data-prefix="G"]');
  await page.waitForFunction(() => document.querySelectorAll('.room').length === 2);
  await mkdir('artifacts', { recursive:true });
  await page.screenshot({ path:'artifacts/demo.png' });
  assert.deepEqual(errors, []);
  console.log('UI-Test erfolgreich: Suche, Favorit, Alias, Enter, Start/Stopp, Neuladen, Bereichsfilter und stabile Raumauswahl sowie Computerton-Modus.');
} catch(error) {
  console.log('UI diagnostic', errors, app.controller.snapshot(), await app.page.evaluate(() => document.body.innerText));
  throw error;
} finally {
  await app.shutdown();
  await rm(temporary, { recursive:true, force:true });
}
