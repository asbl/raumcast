import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesReceiver, volumePatch } from '../src/receiver-volume.js';

test('Lautstärkeregelung akzeptiert gültige Werte und lehnt ungültige Änderungen ab', () => {
  assert.deepEqual(volumePatch({ level:0, muted:true }), { level:0, muted:true });
  assert.deepEqual(volumePatch({ level:1 }), { level:1 });
  for (const value of [null, [], {}, {level:-0.1}, {level:1.1}, {level:NaN}, {level:'50'}, {muted:1}]) {
    assert.throws(() => volumePatch(value));
  }
});
test('Receiver-Adresse wird anhand der vollständigen Geräte-ID statt des Namens zugeordnet', () => {
  const id = 'cast:18ab768bd47c9d4d8c2a9b274702ff6a';
  assert.equal(matchesReceiver(id, '18AB768B-D47C-9D4D-8C2A-9B274702FF6A'), true);
  assert.equal(matchesReceiver(id, '18ab768bd47c9d4d8c2a9b274702ff6b'), false);
  assert.equal(matchesReceiver(id, '18ab'), false);
  assert.equal(matchesReceiver(id, undefined), false);
  assert.equal(matchesReceiver('dial:' + id.slice(5), id.slice(5)), false);
});
