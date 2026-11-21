import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { AppInstance } from '../src/instance.js';
import { createHash } from 'node:crypto';

test('Zweitstarts aktivieren dieselbe Instanz; fremde Profile und Schließen bleiben unabhängig', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'raumcast-instance-'));
  const other = join(dir, 'other'); await mkdir(other);
  let activations = 0;
  let failActivation = false;
  const first = new AppInstance(async () => { if (failActivation) throw new Error('Fenster wird beendet'); activations++; });
  const second = new AppInstance(async () => { throw new Error('kein Eigentümer'); });
  const independent = new AppInstance(async () => {});
  t.after(async () => { await Promise.all([first.close(), second.close(), independent.close()]); await rm(dir, { recursive:true, force:true }); });
  // Legacy files (including empty/invalid/recycled PIDs) have no authority.
  await writeFile(join(dir, 'raumcast.pid'), '0');
  assert.equal(await first.acquire(dir), 'primary');
  assert.equal(await independent.acquire(other), 'primary');
  assert.equal(await second.acquire(dir), 'activated');
  await second.close();
  assert.equal(await second.acquire(dir), 'activated');
  assert.equal(activations, 2);
  failActivation = true;
  await assert.rejects(second.acquire(dir), /Fenster wird beendet/);
  assert.equal(activations, 2);
  failActivation = false;
  assert.equal(await second.acquire(dir), 'activated');
  assert.equal(activations, 3);
  await first.close();
  assert.equal(await second.acquire(dir), 'primary');
});

test('Gleichzeitige Kaltstarts haben genau einen Eigentümer; Prozessabbruch gibt die Sperre frei', { timeout:30000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'raumcast-instance-race-'));
  const children: ChildProcess[] = [];
  t.after(async () => {
    await Promise.all(children.map(async child => {
      if (child.exitCode === null && child.signalCode === null) {
        const ended = once(child, 'exit'); child.kill(); await ended;
      }
    }));
    await rm(dir, { recursive:true, force:true });
  });
  const moduleUrl = new URL('../src/instance.ts', import.meta.url).href;
  const start = () => new Promise<{ child:ChildProcess; state:string }>((resolve, reject) => {
    const code = `import {AppInstance} from ${JSON.stringify(moduleUrl)}; const app=new AppInstance(async()=>{}); const state=await app.acquire(${JSON.stringify(dir)}); console.log(JSON.stringify({state})); if(state==='activated') await app.close();`;
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], { stdio:['ignore', 'pipe', 'pipe'] });
    children.push(child);
    let output = '', errors = '';
    child.stderr!.on('data', chunk => { errors += chunk; });
    child.stdout!.on('data', chunk => {
      output += chunk;
      if (output.includes('\n')) resolve({ child, state:JSON.parse(output.split('\n')[0]).state });
    });
    child.once('error', reject);
    child.once('exit', code => { if (!output.includes('\n')) reject(new Error(`Instanz beendet (${code}): ${errors}`)); });
  });
  const results = await Promise.all(Array.from({ length:6 }, start));
  assert.equal(results.filter(result => result.state === 'primary').length, 1);
  assert.equal(results.filter(result => result.state === 'activated').length, 5);
  const owner = results.find(result => result.state === 'primary')!.child;
  const died = once(owner, 'exit'); owner.kill('SIGKILL'); await died;
  assert.equal((await start()).state, 'primary');
});
test('Eine Portkollision darf nach dem Schließen des fremden Profils keine zweite Instanz ermöglichen', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'raumcast-instance-collision-'));
  const canonical = await realpath(dir);
  const ports = new Map<number, string>();
  let pair!: [string, string];
  for (let i = 0; i <= 40000; i++) {
    const candidate = join(canonical, String(i));
    const hash = createHash('sha256').update(process.platform === 'win32' ? candidate.toLowerCase() : candidate).digest('hex');
    const port = Number.parseInt(hash.slice(0, 8), 16) % 40000;
    if (ports.has(port)) { pair = [ports.get(port)!, candidate]; break; }
    ports.set(port, candidate);
  }
  await Promise.all(pair.map(path => mkdir(path)));
  const first = new AppInstance(async () => {}), second = new AppInstance(async () => {}), third = new AppInstance(async () => {});
  t.after(async () => { await Promise.all([first.close(), second.close(), third.close()]); await rm(dir, { recursive:true, force:true }); });
  assert.equal(await first.acquire(pair[0]), 'primary');
  await assert.rejects(second.acquire(pair[1]), /anderes.*Profil/);
  await first.close();
  assert.equal(await second.acquire(pair[1]), 'primary');
  assert.equal(await third.acquire(pair[1]), 'activated');
});
