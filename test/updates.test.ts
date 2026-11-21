import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNewerVersion, UpdateChecker } from '../src/updates.js';

test('Updatevergleich berücksichtigt Zahlen und akzeptiert nur stabile Versionen', () => {
  assert.equal(isNewerVersion('v0.1.10', '0.1.4'), true);
  assert.equal(isNewerVersion('0.2.0', '0.1.99'), true);
  assert.equal(isNewerVersion('0.1.4', '0.1.4'), false);
  assert.equal(isNewerVersion('0.1.3', '0.1.4'), false);
  for (const version of ['v1.0.0-beta', 'latest', '1.0', '01.2.3', '9007199254740992.0.0']) assert.throws(() => isNewerVersion(version, '0.1.4'));
});
test('Parallele Updateprüfungen teilen eine Anfrage und erlauben Wiederholung nach Netzfehler', async () => {
  let calls = 0;
  let release!: () => void;
  const checker = new UpdateChecker('0.1.4', (async (url, options) => {
    assert.equal(url, 'https://api.github.com/repos/asbl/raumcast/releases/latest');
    assert.ok(options?.signal);
    calls++;
    if (calls === 1) {
      await new Promise<void>(resolve => { release = resolve; });
      throw new Error('offline');
    }
    return Response.json({ tag_name:'v0.2.0', html_url:'https://untrusted.example/' });
  }) as typeof fetch);
  const first = checker.check(), second = checker.check();
  assert.equal(first, second);
  assert.equal(checker.status.state, 'checking');
  release(); await first;
  assert.equal(checker.status.state, 'error');
  await checker.check();
  assert.equal(calls, 2);
  assert.equal(checker.status.state, 'available');
  assert.equal(checker.status.latest, '0.2.0');
});
test('Fehlende, ungültige und Vorab-Releases werden nicht als Updates angeboten', async () => {
  for (const payload of [{ tag_name:'v1.0.0', draft:true }, { tag_name:'v1.0.0', prerelease:true }, {}, { tag_name:'v2.0.0-beta' }]) {
    const checker = new UpdateChecker('0.1.4', (async () => Response.json(payload)) as typeof fetch);
    await checker.check(); assert.equal(checker.status.state, 'error');
  }
  const current = new UpdateChecker('0.1.4', (async () => Response.json({ tag_name:'v0.1.4' })) as typeof fetch);
  await current.check(); assert.equal(current.status.state, 'current');
  const denied = new UpdateChecker('0.1.4', (async () => new Response('', { status:403 })) as typeof fetch);
  await denied.check(); assert.match(denied.status.message!, /HTTP 403/);
});
