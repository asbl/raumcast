import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { DirectCastAudio, type MediaClient, type MediaPlayer } from '../src/direct-audio.js';

class Player extends EventEmitter implements MediaPlayer {
  session?: {sessionId:string};
  media?: Record<string, unknown>;
  load(media: Record<string, unknown>, _options: unknown, callback: (error: Error | null, status: object) => void) {
    this.media = media;
    callback(null, { playerState:'IDLE', extendedStatus:{ playerState:'LOADING' } });
  }
}
class Client extends EventEmitter implements MediaClient {
  player = new Player();
  stops = 0; closes = 0;
  connect(_endpoint: unknown, ready: () => void) { ready(); }
  launch(_application: unknown, callback: (error: Error | null, player: Player) => void) { callback(null, this.player); }
  stop(player: MediaPlayer, callback: (error: Error | null) => void) { assert.equal(player, this.player); this.stops++; callback(null); }
  close() { this.closes++; }
}
test('direkter Stream bestätigt Aktivität erst bei PLAYING und stoppt nur die eigene Sitzung einmal', async () => {
  const client = new Client();
  const audio = new DirectCastAudio(() => {}, () => client);
  let started = false;
  const start = audio.start({host:'127.0.0.1',port:8009}, 'http://local/audio.mp3').then(() => { started = true; });
  await Promise.resolve(); assert.equal(started, false);
  assert.equal(client.player.media?.streamType, 'LIVE');
  client.player.emit('status', { playerState:'BUFFERING' });
  await Promise.resolve(); assert.equal(started, false);
  client.player.emit('status', { playerState:'PLAYING' });
  await start;
  await Promise.all([audio.stop(), audio.stop()]);
  assert.equal(client.stops, 1); assert.equal(client.closes, 1);
});
test('Receiver-Ladefehler wird gemeldet und eine abgebrochene Anfrage kann nicht spät starten', async () => {
  const client = new Client(); const audio = new DirectCastAudio(() => {}, () => client);
  const start = audio.start({host:'127.0.0.1',port:8009}, 'http://local/audio.mp3');
  const rejected = assert.rejects(start, /nicht abspielen/);
  client.player.emit('status', { playerState:'IDLE', idleReason:'ERROR' });
  await rejected; await audio.stop();
  const next = new DirectCastAudio(() => {}, () => new Client());
  const pending = next.start({host:'127.0.0.1',port:8009}, 'http://local/audio.mp3');
  const cancelled = assert.rejects(pending, /beendet/); next.close(); await cancelled;
});

test('Stop wiederholt nach Verbindungsfehler ausschließlich die gespeicherte Sitzungs-ID', async () => {
  const first = new Client();
  first.player.session = {sessionId:'own-session'};
  const firstRequests:Record<string,unknown>[]=[];
  Object.assign(first,{receiver:{request(message:Record<string,unknown>,callback:(error:Error)=>void){ firstRequests.push(message);callback(new Error('Verbindungsfehler')); }}});
  const retry = new Client();
  const requests: Record<string, unknown>[] = [];
  Object.assign(retry, {receiver:{request(message: Record<string,unknown>, callback: (error:null,response:object)=>void) {
    requests.push(message); callback(null,{status:{applications:[{sessionId:'foreign-session'}]}});
  }}});
  const clients = [first,retry];
  const audio = new DirectCastAudio(() => {}, () => clients.shift()!);
  const start = audio.start({host:'127.0.0.1',port:8009},'http://local/audio.mp3');
  first.player.emit('status',{playerState:'PLAYING'}); await start;
  await assert.rejects(audio.stop(), /Verbindungsfehler/);
  await audio.stop();
  assert.deepEqual(firstRequests,[{type:'STOP',sessionId:'own-session'}]);
  assert.deepEqual(requests,[{type:'STOP',sessionId:'own-session'}]);
  assert.equal(retry.stops,0);
});

test('Medienzustände werden auch nach dem Start gemeldet', async () => {
  const client = new Client(); const states:string[]=[];
  const audio = new DirectCastAudio(() => {}, () => client, state => states.push(state));
  const start=audio.start({host:'127.0.0.1',port:8009},'http://local/audio.mp3');
  client.player.emit('status',{playerState:'PLAYING'}); await start;
  client.player.emit('status',{playerState:'BUFFERING'});
  client.player.emit('status',{playerState:'IDLE',idleReason:'FINISHED'});
  assert.deepEqual(states,['active','buffering','ended']);
  audio.close();
});
