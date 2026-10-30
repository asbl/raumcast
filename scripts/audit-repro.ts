import { EventEmitter } from 'node:events';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CastController } from '../src/controller.js';
import { PreferenceStore } from '../src/storage.js';
const dir = await mkdtemp(join(tmpdir(), 'raumcast-audit-'));
const a = { id:'a', name:'CWSR205PCWB' };
const b = { id:'b', name:'CWSR208PCWB' };
class Transport extends EventEmitter {
  calls: string[] = [];
  pause = '';
  release?: () => void;
  async send(method: string, params?: Record<string, unknown>) {
    this.calls.push(`${method}:${params?.sinkName || ''}`);
    if (method === this.pause) await new Promise<void>(resolve => { this.release = resolve; });
  }
  sinks(sinks: unknown[]) { this.emit('Cast.sinksUpdated', { sinks }); }
}
const stores: PreferenceStore[] = [];
const controllers: CastController[] = [];
async function setup(index: number) {
  const store = new PreferenceStore(join(dir, `${index}.json`));
  stores.push(store);
  const t = new Transport();
  const c = new CastController(t, store); controllers.push(c);
  t.sinks([a,b]);
  return { t,c };
}
try {
  {
    const {t,c} = await setup(1);
    t.pause = 'Cast.startDesktopMirroring';
    const pending = c.start(a.name);
    await new Promise(resolve => setImmediate(resolve));
    t.sinks([{...a,session:'Desktop'},b]);
    t.sinks([a,b]);
    t.release!(); await pending;
    assert.equal(c.phase, 'idle'); assert.equal(c.owned, null);
    t.pause = ''; await c.start(b.name);
    assert.equal(c.owned, b.name);
    console.log('A1 behoben: späte Startantwort blockiert nach Sitzungsende keinen neuen Start.');
  }
  {
    const {t,c} = await setup(2);
    await c.start(a.name); t.sinks([{...a,session:'Desktop'},b]);
    t.sinks([]);
    await c.stop();
    assert.equal(t.calls.some(call => call === `Cast.stopCasting:${a.name}`), true);
    console.log('A2 behoben: nach Discovery-Verlust bleibt das eigene Ziel explizit beendbar.');
  }
  {
    const {t,c} = await setup(3);
    await c.start(a.name); t.sinks([{...a,session:'Desktop'},b]);
    t.pause = 'Cast.stopCasting';
    const switching = c.start(b.name);
    const rejected = assert.rejects(switching, /bereits verwendet/);
    t.sinks([{...a,session:'Desktop'},{...b,session:'Fremde Sitzung'}]);
    t.release!(); await rejected;
    assert.equal(t.calls.some(call => call === `Cast.startDesktopMirroring:${b.name}`), false);
    console.log('A3 behoben: ein inzwischen belegter Zielraum erhält keinen Startbefehl.');
  }
  process.env.RAUMCAST_DATA_DIR = join(dir,'ui');
  const { launch } = await import('../src/main.js');
  const app = await launch();
  try {
    await app.page.waitForSelector('.room');
    await app.page.type('#search','20');
    await app.page.waitForFunction(() => document.querySelectorAll('.room').length === 2);
    await app.page.keyboard.press('ArrowDown');
    assert.equal(await app.page.$eval('.room.focused strong', el => el.textContent), 'Raum A208');
    const transport = app.controller.transport as unknown as EventEmitter & { sinks: unknown[] };
    transport.sinks.push({id:'206',name:'CWSR206PCWB'});
    transport.emit('Cast.sinksUpdated',{sinks:structuredClone(transport.sinks)});
    await app.page.waitForFunction(() => document.querySelectorAll('.room').length === 3);
    assert.equal(await app.page.$eval('.room.focused strong', el => el.textContent), 'Raum A208');
    await app.page.keyboard.press('Enter');
    await app.page.waitForFunction(() => document.querySelector('#connection')?.textContent?.includes('Sitzung gemeldet'));
    assert.equal(app.controller.owned,'CWSR208PCWB');
    console.log('A4 behoben: neue Räume erhalten die Auswahl; Enter startet weiterhin den gewählten Raum 208.');
  } finally { await app.shutdown(); }
} finally {
  controllers.forEach(c => c.dispose());
  await Promise.all(stores.map(store => store.flush()));
  await rm(dir,{recursive:true,force:true});
}
