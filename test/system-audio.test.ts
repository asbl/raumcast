import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audioClientAllowed } from '../src/system-audio.js';

test('direkter Audiostream erlaubt nur Loopback, den eigenen Rechner und den ausgewählten Receiver', () => {
  const receiver = { host:'192.168.178.55', localAddress:'192.168.178.46' };
  for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1', receiver.host, receiver.localAddress]) {
    assert.equal(audioClientAllowed(address, receiver), true);
  }
  for (const address of [undefined, '192.168.178.99', '10.0.0.1', '::ffff:192.168.178.99']) {
    assert.equal(audioClientAllowed(address, receiver), false);
  }
  assert.equal(audioClientAllowed(receiver.host), false);
  assert.equal(audioClientAllowed('127.0.0.1'), true);
});
