import { test } from 'node:test';
import assert from 'node:assert/strict';
import { supportsDesktop, supportsMode, preferredMode } from '../src/cast-support.js';

const sink = { id: 'cast:123456789', name: 'SHIELD' };
function state(source: string, ids = ['cast:1234']) {
  return { discovered_sinks: { cast: [{ id: 'cast:1234', name: 'SHIELD' }] }, available_sinks: { [source]: ids } };
}
test('nur bestätigte Desktop-Quellen erlauben den Start, auch mit Systemaudio', () => {
  for (const source of ['CAST:urn:x-org.chromium.media:source:desktop', 'CAST:urn:x-org.chromium.media:source:desktop:?with_audio=true']) {
    assert.equal(supportsDesktop(state(source), sink), true);
    assert.equal(supportsDesktop(state(source, []), sink), false);
  }
  assert.equal(supportsDesktop(state('CAST:urn:x-org.chromium.media:source:tab:1'), sink), false);
});
test('fehlende Daten, unbekannte Empfänger und gekürzte ID-Kollisionen blockieren den Start', () => {
  assert.equal(supportsDesktop(null, sink), false);
  assert.equal(supportsDesktop({}, sink), false);
  const data = state('CAST:urn:x-org.chromium.media:source:desktop');
  assert.equal(supportsDesktop(data, { ...sink, name: 'Onkyo' }), false);
  data.discovered_sinks.cast.push({ id: 'cast:1234', name: 'Onkyo' });
  assert.equal(supportsDesktop(data, sink), false);
});

test('Audioempfänger dürfen Tab-Audio unterstützen, während Desktop blockiert bleibt', () => {
  const data = state('CAST:urn:x-org.chromium.media:source:tab:42');
  assert.equal(supportsMode(data, sink, 'tab'), true);
  assert.equal(supportsDesktop(data, sink), false);
});

test('Automatik wählt Desktop für Displays und Audio nur für bestätigte Audioempfänger', () => {
  const tab = 'CAST:urn:x-org.chromium.media:source:tab:42';
  const desktop = 'CAST:urn:x-org.chromium.media:source:desktop';
  const audio = { ...state(tab), discovered_sinks: { cast: [{ id:'cast:1234', name:'SHIELD', capabilities:4 }] } };
  assert.equal(preferredMode(audio, sink), 'audio');
  assert.equal(preferredMode({ ...audio, available_sinks: { [tab]:['cast:1234'], [desktop]:['cast:1234'] } }, sink), 'desktop');
  for (const capabilities of [undefined, 0, 5, -2]) {
    const unknown = { ...audio, discovered_sinks: { cast:[{ id:'cast:1234', name:'SHIELD', capabilities }] } };
    assert.throws(() => preferredMode(unknown, sink), /nicht eindeutig bestätigt/);
  }
  assert.throws(() => preferredMode(null, sink), /nicht eindeutig bestätigt/);
});

test('Chromium mit leeren discovered_sinks und achtstelligen IDs erkennt Onkyo und Shield', () => {
  const onkyo = { id:'cast:18ab768bd47c9d4d8c2a9b274702ff6a', name:'Onkyo TX-L50' };
  const shield = { id:'cast:4affa20820603887148e2b969b06ceb2', name:'SHIELD' };
  const data = {
    discovered_sinks: {}, known_sinks: [onkyo, shield],
    available_sinks: {
      'CAST:urn:x-org.chromium.media:source:desktop': ['cast:4aff'],
      'CAST:urn:x-org.chromium.media:source:tab:*': ['cast:18ab', 'cast:4aff'],
    },
  };
  assert.equal(preferredMode(data, onkyo), 'audio');
  assert.equal(preferredMode(data, shield), 'desktop');
  assert.equal(supportsDesktop(data, onkyo), false);
  assert.equal(supportsMode(data, onkyo, 'tab'), true);
  assert.equal(supportsMode({ ...data, known_sinks: [...data.known_sinks, { ...onkyo, id:'cast:18abOTHER', name:'Other' }] }, onkyo, 'tab'), false);
  assert.equal(supportsMode({ ...data, known_sinks: [] }, onkyo, 'tab'), false);
});
