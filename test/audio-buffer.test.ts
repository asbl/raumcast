import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prefillAudio } from '../src/audio-buffer.js';

test('Audio-Vorlauf hält den Streamanfang zurück und gibt Header und Folgedaten vollständig in Reihenfolge aus', async () => {
  const stream = prefillAudio(8); const output: Buffer[] = [];
  stream.on('data', chunk => output.push(chunk));
  stream.write(Buffer.from('HEADER'));
  assert.equal(output.length, 0);
  stream.write(Buffer.from('1234'));
  assert.equal(Buffer.concat(output).toString(), 'HEADER1234');
  stream.end(Buffer.from('5678'));
  await new Promise<void>(resolve => stream.on('end', resolve));
  assert.equal(Buffer.concat(output).toString(), 'HEADER12345678');
});
