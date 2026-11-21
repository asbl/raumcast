import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PreferenceStore } from '../src/storage.js';
import { ViewSettingsStore } from '../src/view-settings.js';

test('Ungültige Raumdaten werden vollständig gesichert und nicht teilweise importiert', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'raumcast-recovery-'));
  t.after(() => rm(dir, { recursive:true, force:true }));
  const filename = join(dir, 'rooms.json');
  const source = JSON.stringify({ valid:{ alias:'Physik', favorite:true, lastUsed:1 }, invalid:{ alias:42 } });
  await writeFile(filename, source);
  const store = new PreferenceStore(filename); await store.load();
  assert.deepEqual(Object.keys(store.value), []);
  assert.equal(await readFile(store.recovery!.backup, 'utf8'), source);
  await store.update('new', { favorite:true });
  assert.equal(await readFile(store.recovery!.backup, 'utf8'), source);
  const next = new PreferenceStore(filename); await next.load();
  assert.equal(next.recovery, undefined);
  assert.equal(next.value.new.favorite, true);
});
test('Dateisystemfehler werden nicht als beschädigte JSON-Dateien behandelt', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'raumcast-recovery-'));
  t.after(() => rm(dir, { recursive:true, force:true }));
  const filename = join(dir, 'view-settings.json'); await mkdir(filename);
  await assert.rejects(new ViewSettingsStore(filename).load());
  assert.deepEqual(await readdir(dir), ['view-settings.json']);
});
