import Bonjour from 'bonjour-service';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { isIP } from 'node:net';

export type ReceiverVolume = { level: number; muted: boolean; controlType?: string };
export function volumePatch(value: unknown): { level?: number; muted?: boolean } {
  const patch = value as { level?: unknown; muted?: unknown } | null;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Ungültige Lautstärke.');
  const result: { level?: number; muted?: boolean } = {};
  if (patch.level !== undefined) {
    if (typeof patch.level !== 'number' || !Number.isFinite(patch.level) || patch.level < 0 || patch.level > 1) throw new Error('Lautstärke muss zwischen 0 und 100 Prozent liegen.');
    result.level = patch.level;
  }
  if (patch.muted !== undefined) {
    if (typeof patch.muted !== 'boolean') throw new Error('Ungültiger Stummschaltwert.');
    result.muted = patch.muted;
  }
  if (!Object.keys(result).length) throw new Error('Keine Lautstärke angegeben.');
  return result;
}
export function matchesReceiver(sinkId: string, serviceId: unknown): boolean {
  return sinkId.startsWith('cast:') && typeof serviceId === 'string' && serviceId.length >= 16
    && sinkId.slice(5).replaceAll('-', '').toLowerCase() === serviceId.replaceAll('-', '').toLowerCase();
}
interface VolumeClient extends EventEmitter {
  connect(endpoint: { host: string; port: number }, ready: () => void): void;
  getVolume(callback: (error: Error | null, volume: ReceiverVolume) => void): void;
  setVolume(patch: { level?: number; muted?: boolean }, callback: (error: Error | null, volume: ReceiverVolume) => void): void;
  close(): void;
}
const { Client } = createRequire(import.meta.url)('castv2-client') as { Client: new () => VolumeClient };

export class ReceiverVolumeControl {
  private endpoint?: Promise<{ host: string; port: number }>;
  private closed = false;
  private changes: Promise<unknown> = Promise.resolve();
  private cancelDiscovery?: () => void;
  private requests = new Set<(error: Error) => void>();
  constructor(private sinkId: string) {}
  private discover() {
    return new Promise<{ host: string; port: number }>((resolve, reject) => {
      let done = false;
      let browser: ReturnType<Bonjour['find']> | undefined;
      let bonjour: Bonjour | undefined;
      const finish = (error?: Error, endpoint?: { host: string; port: number }) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        browser?.stop(); bonjour?.destroy();
        this.cancelDiscovery = undefined;
        if (error) reject(error); else resolve(endpoint!);
      };
      const timer = setTimeout(() => finish(new Error('Receiver-Adresse für die Lautstärkeregelung nicht gefunden.')), 6000);
      this.cancelDiscovery = () => finish(new Error('Audioübertragung beendet.'));
      bonjour = new Bonjour({}, (error: Error) => finish(error));
      browser = bonjour.find({ type: 'googlecast' }, service => {
        if (!matchesReceiver(this.sinkId, service.txt?.id)) return;
        const host = service.addresses?.find(address => isIP(address) === 4) || service.addresses?.find(address => isIP(address));
        if (host && Number.isInteger(service.port) && service.port > 0 && service.port <= 65535) finish(undefined, { host, port: service.port });
      });
    });
  }
  async getEndpoint() {
    if (this.closed) throw new Error('Audioübertragung beendet.');
    this.endpoint ??= this.discover().catch(error => { this.endpoint = undefined; throw error; });
    return this.endpoint;
  }
  async get() { return this.request(); }
  private change(task: () => Promise<ReceiverVolume>): Promise<ReceiverVolume> {
    const next = this.changes.catch(() => {}).then(task);
    this.changes = next;
    return next;
  }
  async set(value: unknown) { const patch = volumePatch(value); return this.change(() => this.request(patch)); }
  async adjust(delta: unknown) {
    if (typeof delta !== 'number' || !Number.isFinite(delta) || Math.abs(delta) > 1) throw new Error('Ungültiger Lautstärkeschritt.');
    return this.change(async () => {
      const current = await this.get();
      return this.request({ level:Math.max(0, Math.min(1, Math.round((current.level + delta) * 10000) / 10000)) });
    });
  }
  async toggleMute() {
    return this.change(async () => { const current = await this.get(); return this.request({ muted:!current.muted }); });
  }
  private async request(patch?: { level?: number; muted?: boolean }): Promise<ReceiverVolume> {
    if (this.closed) throw new Error('Audioübertragung beendet.');
    this.endpoint ??= this.discover().catch(error => { this.endpoint = undefined; throw error; });
    const endpoint = await this.endpoint;
    if (this.closed) throw new Error('Audioübertragung beendet.');
    return new Promise((resolve, reject) => {
      const client = new Client();
      let done = false;
      const finish = (error: Error | null, volume?: ReceiverVolume) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.requests.delete(cancel);
        client.close();
        if (error) reject(error);
        else if (!volume || !Number.isFinite(volume.level) || volume.level < 0 || volume.level > 1) reject(new Error('Receiver meldet keinen regelbaren Lautstärkewert.'));
        else resolve(volume);
      };
      const cancel = (error: Error) => finish(error);
      this.requests.add(cancel);
      const timer = setTimeout(() => finish(new Error('Receiver antwortet nicht auf die Lautstärkeabfrage.')), 4000);
      client.on('error', cancel);
      client.connect(endpoint, () => {
        if (done) return;
        if (patch) client.setVolume(patch, finish); else client.getVolume(finish);
      });
    });
  }
  close() {
    this.closed = true;
    this.cancelDiscovery?.();
    for (const cancel of [...this.requests]) cancel(new Error('Audioübertragung beendet.'));
  }
}
