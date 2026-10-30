import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CastController, roomLabel, roomPrefix, type Sink } from '../src/controller.js';
import { PreferenceStore } from '../src/storage.js';

class FakeTransport extends EventEmitter {
  commands: { method: string; params?: Record<string, unknown> }[] = [];
  fail = '';
  pause = '';
  release?: () => void;
  async send(method: string, params?: Record<string, unknown>) {
    this.commands.push({ method, params });
    if (method === this.pause) await new Promise<void>(resolve => { this.release = resolve; });
    if (method === this.fail) throw new Error('Testabbruch');
  }
  discover(sinks: Sink[]) { this.emit('Cast.sinksUpdated', { sinks }); }
}
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await mkdtemp(join(tmpdir(), 'raumcast-'));
  const store = new PreferenceStore(join(dir, 'rooms.json'));
  await store.load();
  const transport = new FakeTransport();
  const controller = new CastController(transport, store);
  t.after(async () => { controller.dispose(); await store.flush(); await rm(dir, { recursive:true, force:true }); });
  return { store, transport, controller };
}
const room = { id:'208', name:'CWSR208PCWB' };
test('Bereiche werden aus dem Originalnamen erkannt, einschließlich führender Nullen', () => {
  for (const [name, expected] of [['CWSG01PCWB','G'], ['CWSE01PCWB','E'], ['CWSD32PCWB','E'], ['G01','G'], ['Raum e02','E'], ['Raum 208','A'], ['208','A'], ['CWS208PCWB','A'], ['Beamer Aula','']]) {
    assert.equal(roomPrefix(name), expected);
  }
});
test('D, RD und RE werden E zugeordnet, RA wird A und RG wird G', () => {
  for (const [prefix, area] of [['D','E'], ['RD','E'], ['RE','E'], ['E','E'], ['RA','A'], ['A','A'], ['RG','G'], ['G','G'], ['R','A']]) {
    for (const name of [`CWS${prefix}01PCWB`, `${prefix}01`, `Raum ${prefix.toLowerCase()}02`]) {
      assert.equal(roomPrefix(name), area, name);
    }
  }
});
test('Schulnamen werden lesbar, andere Namen bleiben erhalten', () => {
  assert.equal(roomLabel(room.name), 'Raum A208');
  assert.equal(roomLabel('208'), 'Raum A208');
  assert.equal(roomLabel('CWSD32PCWB'), 'Raum E32');
  assert.equal(roomLabel('CWSRD01PCWB'), 'Raum E01');
  assert.equal(roomLabel('CWSRE01PCWB'), 'Raum E01');
  assert.equal(roomLabel('CWSRA01PCWB'), 'Raum A01');
  assert.equal(roomLabel('CWSRG01PCWB'), 'Raum G01');
  assert.equal(roomLabel('Beamer Aula'), 'Beamer Aula');
});
test('CWS-Empfänger mit CWB und PCWB werden demselben Bereich zugeordnet', async t => {
  for (const suffix of ['CWB', 'PCWB']) {
    assert.equal(roomLabel(`CWSD12${suffix}`), 'Raum E12');
    assert.equal(roomPrefix(`CWSD12${suffix}`), 'E');
    assert.equal(roomLabel(`CWSRG01${suffix}`), 'Raum G01');
    assert.equal(roomLabel(`CWSR208${suffix}`), 'Raum A208');
  }
  const { controller:c, transport:p } = await fixture(t);
  p.discover([{ id:'d12', name:'CWSD12CWB' }]);
  assert.equal(c.snapshot().rooms[0].prefix, 'E');
  assert.equal(c.snapshot().rooms[0].code, 'E12');
  await c.start('CWSD12CWB');
  assert.deepEqual(p.commands.at(-1), { method:'Cast.startDesktopMirroring', params:{ sinkName:'CWSD12CWB' } });
});
test('startet nur Desktop-Mirroring und bestätigt Aktivität erst nach Ereignis', async t => {
  const { controller:c, transport:p } = await fixture(t);
  p.discover([room]);
  await c.start(room.name);
  assert.equal(c.phase, 'pending');
  assert.deepEqual(p.commands[0], { method:'Cast.startDesktopMirroring', params:{ sinkName:room.name } });
  p.discover([{ ...room, session:'Bildschirm' }]);
  assert.equal(c.phase, 'active');
  await c.stop();
  assert.equal(c.phase, 'idle');
  assert.equal(p.commands.at(-1)?.method, 'Cast.stopCasting');
});
test('blockiert verschwundene, mehrdeutige und belegte Empfänger', async t => {
  const { controller:c, transport:p } = await fixture(t);
  await assert.rejects(c.start(room.name), /nicht mehr verfügbar/);
  p.discover([room, { ...room, id:'other' }]);
  await assert.rejects(c.start(room.name), /mehrdeutig/);
  p.discover([{ ...room, session:'Fremde Sitzung' }]);
  await assert.rejects(c.start(room.name), /bereits verwendet/);
  await c.stop();
  assert.equal(p.commands.length, 0);
});
test('Raumwechsel beendet zuerst die eigene Übertragung', async t => {
  const { controller:c, transport:p } = await fixture(t);
  const next = { id:'205', name:'CWSR205PCWB' };
  p.discover([room, next]); await c.start(room.name);
  p.discover([{ ...room, session:'Bildschirm' }, next]);
  await c.start(next.name);
  assert.deepEqual(p.commands.map(c => c.method), ['Cast.startDesktopMirroring','Cast.stopCasting','Cast.startDesktopMirroring']);
  assert.equal(c.owned, next.name);
});
test('fehlgeschlagener Stopp verhindert Start im nächsten Raum', async t => {
  const { controller:c, transport:p } = await fixture(t);
  const next = { id:'205', name:'CWSR205PCWB' };
  p.discover([room, next]); await c.start(room.name);
  p.discover([{ ...room, session:'Bildschirm' }, next]);
  p.fail = 'Cast.stopCasting';
  await assert.rejects(c.start(next.name));
  assert.equal(c.owned, room.name);
  assert.equal(p.commands.filter(c => c.method === 'Cast.startDesktopMirroring').length, 1);
});
test('abgebrochene oder zeitüberschrittene Anfrage bleibt explizit beendbar', async t => {
  const { controller:c, transport:p } = await fixture(t);
  p.discover([room]); p.fail = 'Cast.startDesktopMirroring';
  await assert.rejects(c.start(room.name));
  assert.equal(c.phase, 'pending');
  assert.equal(c.busy, false);
  await c.stop(); assert.equal(c.owned, null);
});
test('Favoriten, Alias und nicht verfügbare Räume bleiben nach Neustart erhalten', async t => {
  const { controller:c, transport:p, store } = await fixture(t);
  p.discover([room]);
  await c.preference(room.name, { favorite:true, alias:'Physik' });
  const reopened = new PreferenceStore(store.filename); await reopened.load();
  const next = new CastController(new FakeTransport(), reopened);
  assert.deepEqual(next.snapshot().rooms[0], { name:room.name, label:'Physik', code:'A208', prefix:'A', favorite:true, lastUsed:0, available:false, ambiguous:false, session:'' });
});
test('beschädigte Einstellungen werden nicht stillschweigend überschrieben', async t => {
  const { store } = await fixture(t);
  await writeFile(store.filename, '{broken');
  await assert.rejects(new PreferenceStore(store.filename).load());
});

test('Discovery-Verlust behält das eigene Ziel und sendet weiterhin Stop', async t => {
  const { controller:c, transport:p } = await fixture(t);
  p.discover([room]); await c.start(room.name);
  p.discover([{ ...room, session:'Desktop' }]);
  p.discover([]);
  assert.equal(c.phase, 'uncertain');
  assert.equal(c.owned, room.name);
  assert.equal(c.snapshot().rooms[0].available, false);
  await c.stop();
  assert.deepEqual(p.commands.at(-1), { method:'Cast.stopCasting', params:{ sinkName:room.name } });
  assert.equal(c.phase, 'idle');
});

test('Wiederentdeckung stellt den aktiven Status wieder her', async t => {
  const { controller:c, transport:p } = await fixture(t);
  p.discover([room]); await c.start(room.name);
  p.discover([{ ...room, session:'Desktop' }]); p.discover([]);
  p.discover([{ ...room, session:'Desktop' }]);
  assert.equal(c.phase, 'active');
  assert.equal(c.owned, room.name);
});

for (const fails of [false, true]) {
  test(`Späte Start${fails ? 'fehlermeldung' : 'antwort'} überschreibt ein bestätigtes Sitzungsende nicht`, async t => {
    const { controller:c, transport:p } = await fixture(t);
    p.discover([room]); p.pause = 'Cast.startDesktopMirroring';
    const start = c.start(room.name);
    const outcome = fails ? assert.rejects(start, /Testabbruch/) : start;
    await new Promise(resolve => setImmediate(resolve));
    p.discover([{ ...room, session:'Desktop' }]); p.discover([room]);
    if (fails) p.fail = 'Cast.startDesktopMirroring';
    p.release!(); await outcome;
    assert.equal(c.phase, 'idle'); assert.equal(c.owned, null); assert.equal(c.busy, false);
    p.pause = ''; p.fail = '';
    await c.start(room.name);
    assert.equal(c.phase, 'pending'); assert.equal(c.owned, room.name);
  });
}

test('Discovery-Verlust während des Startaufrufs bleibt nach dessen Antwort beendbar', async t => {
  const { controller:c, transport:p } = await fixture(t);
  p.discover([room]); p.pause = 'Cast.startDesktopMirroring';
  const start = c.start(room.name);
  await new Promise(resolve => setImmediate(resolve));
  p.discover([{ ...room, session:'Desktop' }]); p.discover([]);
  p.release!(); await start;
  assert.equal(c.phase, 'uncertain'); assert.equal(c.owned, room.name);
  await c.stop(); assert.equal(c.owned, null);
});

const nextRoom = { id:'205', name:'CWSR205PCWB' };
for (const [description, changed, message] of [
  ['belegt', [{ ...nextRoom, session:'Fremde Sitzung' }], /bereits verwendet/],
  ['verschwunden', [], /nicht mehr verfügbar/],
  ['mehrdeutig', [nextRoom, { ...nextRoom, id:'other' }], /mehrdeutig/],
  ['ausgetauscht', [{ ...nextRoom, id:'replacement' }], /hat sich geändert/],
] as const) {
  test(`Raumwechsel prüft das Ziel nach dem Stop erneut: ${description}`, async t => {
    const { controller:c, transport:p } = await fixture(t);
    p.discover([room, nextRoom]); await c.start(room.name);
    p.discover([{ ...room, session:'Desktop' }, nextRoom]);
    p.pause = 'Cast.stopCasting';
    const switching = c.start(nextRoom.name);
    const rejected = assert.rejects(switching, message);
    p.discover([{ ...room, session:'Desktop' }, ...changed]);
    p.release!(); await rejected;
    assert.equal(p.commands.filter(command => command.method === 'Cast.startDesktopMirroring').length, 1);
    assert.equal(c.phase, 'idle'); assert.equal(c.owned, null); assert.equal(c.busy, false);
  });
}

test('Mehrdeutigkeit während einer eigenen Sitzung verhindert Stop am falschen Empfänger', async t => {
  const { controller:c, transport:p } = await fixture(t);
  p.discover([room]); await c.start(room.name);
  p.discover([{ ...room, session:'Desktop' }]);
  p.discover([{ ...room, session:'Desktop' }, { ...room, id:'other' }]);
  assert.equal(c.phase, 'uncertain');
  await assert.rejects(c.stop(), /nicht mehr eindeutig/);
  assert.equal(c.owned, room.name);
  assert.equal(p.commands.some(command => command.method === 'Cast.stopCasting'), false);
  p.discover([{ ...room, session:'Desktop' }]);
  await c.stop(); assert.equal(c.phase, 'idle');
});

test('Fehlgeschlagener Stop bleibt unbestätigt und kann wiederholt werden', async t => {
  const { controller:c, transport:p } = await fixture(t);
  p.discover([room]); await c.start(room.name);
  p.discover([{ ...room, session:'Desktop' }]); p.fail = 'Cast.stopCasting';
  await assert.rejects(c.stop(), /Testabbruch/);
  assert.equal(c.phase, 'uncertain'); assert.equal(c.owned, room.name); assert.equal(c.busy, false);
  p.fail = ''; await c.stop(); assert.equal(c.phase, 'idle');
});
