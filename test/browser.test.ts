import assert from 'node:assert/strict';
import { test } from 'node:test';
import { browserGraphicsArgs } from '../src/browser.js';

test('Windows uses software rendering by default, with an explicit GPU diagnostic override', () => {
  assert.deepEqual(browserGraphicsArgs('win32', []), ['--disable-gpu']);
  assert.deepEqual(browserGraphicsArgs('win32', ['--enable-gpu']), []);
  assert.deepEqual(browserGraphicsArgs('win32', ['--enable-gpu', '--disable-gpu']), ['--disable-gpu']);
});

test('Other platforms keep their graphics defaults but can test software rendering', () => {
  for (const platform of ['linux', 'darwin'] as const) {
    assert.deepEqual(browserGraphicsArgs(platform, []), []);
    assert.deepEqual(browserGraphicsArgs(platform, ['--disable-gpu']), ['--disable-gpu']);
  }
});
