import { createRequire } from 'node:module';
import { createSocket } from 'node:dgram';
import { isIP } from 'node:net';
import { EventEmitter } from 'node:events';

export interface MediaStatus { playerState?: string; idleReason?: string; extendedStatus?: { playerState?: string } }
export type AudioState = 'active' | 'buffering' | 'ended';
export interface MediaPlayer extends EventEmitter {
  session?: { sessionId: string };
  load(media: Record<string, unknown>, options: { autoplay: boolean }, callback: (error: Error | null, status: MediaStatus) => void): void;
}
export interface MediaClient extends EventEmitter {
  receiver?: { request(message: Record<string, unknown>, callback: (error: Error | null, response: { type?: string; status?: unknown }) => void): void };
  connect(endpoint: { host: string; port: number }, ready: () => void): void;
  launch(application: unknown, callback: (error: Error | null, player: MediaPlayer) => void): void;
  stop(player: MediaPlayer, callback: (error: Error | null) => void): void;
  close(): void;
}
const cast = createRequire(import.meta.url)('castv2-client') as { Client: new () => MediaClient; DefaultMediaReceiver: unknown };
export async function localAddressFor(endpoint: { host: string; port: number }): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createSocket(isIP(endpoint.host) === 6 ? 'udp6' : 'udp4');
    const timer = setTimeout(() => finish(new Error('Lokale Netzwerkadresse nicht gefunden.')), 3000);
    let done = false;
    function finish(error?: Error, address?: string) {
      if (done) return; done = true; clearTimeout(timer); socket.close();
      if (error) reject(error); else resolve(address!);
    }
    socket.on('error', error => finish(error));
    socket.connect(endpoint.port, endpoint.host, () => finish(undefined, socket.address().address));
  });
}

export class DirectCastAudio {
  private client: MediaClient;
  private player?: MediaPlayer;
  private sessionId?: string;
  private endpoint?: { host: string; port: number };
  private disconnected = false;
  status: MediaStatus = { playerState:'IDLE' };
  bufferingEvents = 0;
  private closed = false;
  private stopping?: Promise<void>;
  private cancelStart?: (error: Error) => void;
  private cancelStop?: (error: Error) => void;
  constructor(private onError: (message: string) => void,
    private factory: () => MediaClient = () => new cast.Client(),
    private onState: (state: AudioState) => void = () => {}) {
    this.client = this.makeClient();
  }
  private makeClient() {
    const client = this.factory();
    client.on('error', (error: Error) => {
      if (this.closed || client !== this.client) return;
      this.disconnected = true;
      if (this.cancelStop) this.cancelStop(error);
      else if (this.cancelStart) this.cancelStart(error);
      else this.onError(error.message);
    });
    return client;
  }
  async start(endpoint: { host: string; port: number }, url: string): Promise<void> {
    if (this.closed) throw new Error('Audioübertragung beendet.');
    this.endpoint = endpoint;
    return new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => finish(new Error('Receiver startet den Musikstream nicht rechtzeitig.')), 35000);
      const finish = (error?: Error) => {
        if (done) return; done = true; clearTimeout(timer); this.cancelStart = undefined;
        if (error) reject(error); else resolve();
      };
      this.cancelStart = error => finish(error);
      const status = (value: MediaStatus) => {
        if (this.closed || this.stopping) return;
        if (this.status.playerState === 'PLAYING' && value.playerState === 'BUFFERING') this.bufferingEvents++;
        this.status = value;
        if (value.playerState === 'PLAYING') { this.onState('active'); finish(); }
        else if (value.playerState === 'BUFFERING') this.onState('buffering');
        else if (value.playerState === 'IDLE' && value.idleReason) {
          if (value.idleReason === 'ERROR') {
            const message = 'Receiver kann den direkten Musikstream nicht abspielen.';
            if (!done) finish(new Error(message)); else this.onError(message);
          } else {
            finish(new Error('Receiver hat den Musikstream beendet.'));
            this.onState('ended');
          }
        }
      };
      this.client.connect(endpoint, () => {
        if (this.closed || done) return;
        this.client.launch(cast.DefaultMediaReceiver, (error, player) => {
          if (this.closed || done) return;
          if (error) { finish(error); return; }
          this.player = player;
          this.sessionId = player.session?.sessionId;
          player.on('status', status);
          player.load({ contentId:url, contentType:'audio/mpeg', streamType:'LIVE', metadata:{ metadataType:3, title:'Raumcast – Computerton' } }, { autoplay:true }, (error, value) => {
            if (error) finish(error); else status(value);
          });
        });
      });
    });
  }
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    const attempt = this.stopOnce();
    this.stopping = attempt;
    void attempt.then(() => { this.stopping = undefined; }, () => { this.stopping = undefined; });
    return attempt;
  }
  private async stopOnce(): Promise<void> {
    if (this.closed) return;
    if (!this.player) { this.close(); return; }
    try {
      await new Promise<void>((resolve, reject) => {
        let done = false;
        const finish = (error?: Error | null) => {
          if (done) return; done = true; clearTimeout(timer); this.cancelStop = undefined;
          if (error) reject(error); else resolve();
        };
        const timer = setTimeout(() => finish(new Error('Receiver bestätigt das Beenden nicht.')), 4000);
        this.cancelStop = error => finish(error);
        const send = () => {
          if (done || this.closed) return;
          // Address only the recorded session, even if another app has taken over.
          if (this.sessionId && this.client.receiver) {
            this.client.receiver.request({ type:'STOP', sessionId:this.sessionId }, (error, response) => {
              finish(error || (!response?.status ? new Error('Eigene Sitzung konnte nicht als beendet bestätigt werden.') : undefined));
            });
          } else if (!this.disconnected) this.client.stop(this.player!, error => finish(error));
          else finish(new Error('Eigene Sitzungskennung fehlt; kein Stop an eine fremde Sitzung.'));
        };
        if (this.disconnected) {
          if (!this.sessionId || !this.endpoint) { finish(new Error('Eigene Sitzungskennung fehlt.')); return; }
          this.client = this.makeClient();
          this.client.connect(this.endpoint, send);
        } else send();
      });
      this.close();
    } catch (error) {
      this.disconnected = true;
      try { this.client.close(); } catch {}
      throw error;
    }
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.cancelStart?.(new Error('Audioübertragung beendet.'));
    this.cancelStop?.(new Error('Audioübertragung beendet.'));
    try { this.client.close(); } catch {}
  }
}
