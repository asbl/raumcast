import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { NetworkMonitor, inNetwork, probeStatus } from '../src/network.js';

const address = (value: string, internal = false) => [{ address:value, internal } as any];

test('Netzwerk wird nur bei nutzbarer Adresse einer echten Schnittstelle erkannt', () => {
  assert.equal(inNetwork({ lo:address('127.0.0.1', true), docker0:address('172.17.0.1'), wlan0:address('fe80::1') }), false);
  assert.equal(inNetwork({ eth0:address('169.254.3.4') }), false);
  assert.equal(inNetwork({ wlan0:address('10.1.2.3') }), true);
});

test('Antworten werden als online, Web-Anmeldung oder ohne Verbindung eingeordnet', async () => {
  for (const [status, expected] of [[204,'online'], [200,'login'], [302,'login'], [511,'login'], [503,'offline']] as const) {
    const monitor = new NetworkMonitor(async () => status, () => true);
    await monitor.check();
    assert.equal(monitor.state, expected, String(status));
  }
  const failing = new NetworkMonitor(async () => { throw new Error('Zeitlimit'); }, () => true);
  await failing.check();
  assert.equal(failing.state, 'offline');
});

test('Ohne Netzwerk wird nicht angefragt', async () => {
  const monitor = new NetworkMonitor(async () => assert.fail('Anfrage ohne Netzwerk'), () => false);
  await monitor.check();
  assert.equal(monitor.state, 'disconnected');
});

test('Parallele Prüfungen teilen eine Anfrage; Wiederholung erst nach Ablauf', async () => {
  let requests = 0, time = 100_000, status = 302;
  const monitor = new NetworkMonitor(async () => { requests++; return status; }, () => true, () => time);
  await Promise.all([monitor.check(), monitor.check()]);
  assert.equal(requests, 1);
  time += 4_000; monitor.refreshIfStale();
  assert.equal(requests, 1);
  status = 204; time += 1_000; monitor.refreshIfStale(); await monitor.check();
  assert.equal(monitor.state, 'online');
  time += 29_000; monitor.refreshIfStale();
  assert.equal(requests, 2);
});

test('Umleitung eines Anmeldeportals wird nicht verfolgt', async () => {
  const server = createServer((_request, response) => response.writeHead(302, { Location:'/anmeldung' }).end());
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try { assert.equal(await probeStatus(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`), 302); }
  finally { server.close(); }
});
