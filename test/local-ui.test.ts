import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sameLocalFile } from '../src/local-ui.js';

test('Windows UI paths accept Chromium URL serialization and extracted folder names', () => {
  const expected = 'file:///C:/Users/J%C3%B6rg/Downloads/Raumcast%20(1)/ui/index.html';
  assert.equal(sameLocalFile('file:///c:/Users/Jörg/Downloads/Raumcast%20(1)/ui/index.html', expected, true), true);
  assert.equal(sameLocalFile('file:///C:/Users/J%C3%B6rg/Downloads/Raumcast%20(1)/ui/%69ndex.html', expected, true), true);
});

test('UI allowlist rejects other files, remote pages, queries and fragments', () => {
  const expected = 'file:///C:/Raumcast/ui/index.html';
  for (const actual of ['file:///C:/Raumcast/ui/app.js', 'https://example.com/index.html', `${expected}?x`, `${expected}#x`, 'invalid', 'file:///C:/Raumcast/ui/index.html/extra']) {
    assert.equal(sameLocalFile(actual, expected, true), false, actual);
  }
  assert.equal(sameLocalFile('file:///tmp/UI/index.html', 'file:///tmp/ui/index.html', false), false);
});
