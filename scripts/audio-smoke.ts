import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer, { type Browser } from 'puppeteer-core';
import { checkSystemAudio, serveSystemAudio } from '../src/system-audio.js';
import { findBrowser } from '../src/browser.js';

const errors: string[] = [];
const stream = await serveSystemAudio(await checkSystemAudio(), message => errors.push(message), {host:'127.0.0.1',localAddress:'127.0.0.1'});
const profile = await mkdtemp(join(tmpdir(), 'raumcast-audio-test-'));
let browser: Browser | undefined;
try {
  assert.equal((await fetch(new URL('/audio.wav', stream.url))).status, 404);
  assert.equal((await fetch(stream.url + 'audio.mp3', { method: 'HEAD' })).status, 404);
  browser = await puppeteer.launch({ executablePath: await findBrowser(), headless: true, userDataDir: profile });
  const page = await browser.newPage();
  let receiverVolume = { level:0.26, muted:false, controlType:'master' };
  await page.exposeFunction('raumcastAudio', (action: string, patch: Partial<typeof receiverVolume>) => {
    if (action === 'volume') receiverVolume = { ...receiverVolume, ...patch };
    if (action === 'adjust') receiverVolume.level += (patch as {delta:number}).delta;
    if (action === 'mute') receiverVolume.muted = !receiverVolume.muted;
    return { ok:true, data:receiverVolume };
  });
  await page.goto(stream.url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !(document.querySelector('#receiver-volume') as HTMLInputElement).disabled);
  assert.equal(await page.$eval('#receiver-volume', el => (el as HTMLInputElement).value), '26');
  assert.equal(await page.$eval('#receiver-volume', el => (el as HTMLInputElement).max), '40');
  assert.ok(await page.$eval('#receiver-volume', el => el.getBoundingClientRect().width) > 500);
  await page.$eval('#receiver-volume', el => { (el as HTMLInputElement).value = '26.5'; el.dispatchEvent(new Event('change')); });
  await page.waitForFunction(() => document.querySelector('#volume-value')?.textContent === '26,5 %');
  await page.click('#volume-up');
  await page.waitForFunction(() => document.querySelector('#volume-value')?.textContent === '27 %');
  await page.click('#volume-range');
  assert.equal(await page.$eval('#receiver-volume', el => (el as HTMLInputElement).max), '100');
  assert.equal(receiverVolume.level, 0.27);
  await page.focus('#receiver-volume');
  receiverVolume.level = 0.10;
  await page.waitForFunction(() => document.querySelector('#volume-value')?.textContent === '10 %');
  await page.click('#volume-up');
  await page.waitForFunction(() => document.querySelector('#volume-value')?.textContent === '10,5 %');
  await page.click('#receiver-mute');
  await page.waitForFunction(() => document.querySelector('#receiver-mute')?.getAttribute('aria-pressed') === 'true');
  assert.ok(Math.abs(receiverVolume.level - 0.105) < 1e-9);
  assert.equal(receiverVolume.muted, true);
  // Muting is essential here: this test decodes the captured output locally
  // without creating a Cast route and must never play it back into the monitor.
  await page.evaluate(async () => {
    const audio = document.querySelector('audio')!;
    audio.muted = true;
    await Promise.race([audio.play(), new Promise((_, reject) => setTimeout(() => reject(new Error('Keine dekodierbare Audioaufnahme.')), 15000))]);
  });
  await page.waitForFunction(() => document.querySelector('audio')!.readyState >= 3, { timeout: 15000 });
  assert.deepEqual(errors, []);
  console.log('Audiotest erfolgreich: Standardausgabe erfasst und MP3-Livestream mit Vorlauf in Chromium dekodiert. Receiverregler mit simuliertem Receiver geprüft. Kein Cast-Gerät verwendet.');
} finally {
  stream.close();
  await browser?.close();
  await rm(profile, { recursive: true, force: true });
}
