import { EventEmitter } from 'node:events';
import { PreferenceStore } from './storage.js';

export type Sink = { id: string; name: string; session?: string };
export interface CastTransport {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on(event: string, listener: (payload: any) => void): unknown;
}
function roomParts(name: string) {
  const code = /^CWS(.+?)(?:P?CWB)$/i.exec(name.trim())?.[1] ?? name.trim().replace(/^Raum\s+/i, '');
  const match = /^([a-z]*)\s*[- ]?(\d+[a-z]?)$/i.exec(code);
  if (!match) return null;
  const prefix = match[1].toUpperCase();
  const areas: Record<string, string> = { '': 'A', R: 'A', D: 'E', RD: 'E', RE: 'E', RA: 'A', RG: 'G' };
  return { prefix: areas[prefix] ?? prefix, number: match[2].toUpperCase() };
}
export function roomLabel(name: string): string {
  const parts = roomParts(name);
  return parts ? `Raum ${parts.prefix}${parts.number}` : name;
}
export function roomPrefix(name: string): string {
  return roomParts(name)?.prefix ?? '';
}

export class CastController extends EventEmitter {
  sinks: Sink[] = [];
  phase: 'idle' | 'starting' | 'pending' | 'active' | 'uncertain' | 'stopping' = 'idle';
  owned: string | null = null;
  busy = false;
  issue = '';
  private pendingTimer?: ReturnType<typeof setTimeout>;
  private ownedId: string | null = null;
  private observedActive = false;
  private operation = 0;
  private disposed = false;
  constructor(readonly transport: CastTransport, readonly store: PreferenceStore) {
    super();
    transport.on('Cast.sinksUpdated', ({ sinks }: { sinks: Sink[] }) => {
      if (this.disposed) return;
      this.sinks = sinks;
      if (!this.owned || this.phase === 'stopping') return;
      const matches = sinks.filter(s => s.name === this.owned);
      const sink = matches.length === 1 && matches[0].id === this.ownedId ? matches[0] : undefined;
      if (sink?.session) {
        const first = !this.observedActive;
        this.observedActive = true;
        this.phase = 'active';
        clearTimeout(this.pendingTimer);
        if (first) void store.update(this.owned, { lastUsed: Date.now() }).catch(e => {
          this.issue = `Raum konnte nicht gespeichert werden: ${e.message}`;
        });
      } else if (this.observedActive) {
        if (sink) this.clearOwned(); // The same identified receiver now reports no session.
        else {
          // Discovery loss or ambiguity is not confirmation that mirroring stopped.
          this.phase = 'uncertain';
          clearTimeout(this.pendingTimer);
        }
      }
    });
    transport.on('Cast.issueUpdated', ({ issueMessage }: { issueMessage: string }) => {
      if (!this.disposed) this.issue = issueMessage;
    });
  }
  async initialize() { await this.transport.send('Cast.enable'); }
  snapshot() {
    const names = new Set([...this.sinks.map(s => s.name), ...Object.keys(this.store.value), ...(this.owned ? [this.owned] : [])]);
    const rooms = [...names].map(name => {
      const matches = this.sinks.filter(s => s.name === name);
      const pref = this.store.value[name];
      return {
        name, label: pref?.alias || roomLabel(name), code: roomParts(name) ? roomLabel(name).replace(/^Raum /, '') : '',
        prefix: roomPrefix(name), favorite: pref?.favorite || false,
        lastUsed: pref?.lastUsed || 0, available: matches.length > 0,
        ambiguous: matches.length > 1, session: matches[0]?.session || '',
      };
    });
    return { rooms, phase: this.phase, owned: this.owned, busy: this.busy, issue: this.issue };
  }
  private async stopOwned() {
    if (!this.owned) return;
    const name = this.owned;
    const matches = this.sinks.filter(s => s.name === name);
    if (matches.length > 1 || (matches.length === 1 && matches[0].id !== this.ownedId)) {
      this.phase = 'uncertain';
      throw new Error('Empfänger ist nicht mehr eindeutig identifizierbar. Bitte Raumcast schließen, um die eigene Übertragung zu beenden.');
    }
    const operation = this.operation;
    this.phase = 'stopping';
    clearTimeout(this.pendingTimer);
    try {
      await this.transport.send('Cast.stopCasting', { sinkName: name });
      if (operation === this.operation && !this.disposed) this.clearOwned();
    } catch (error) {
      if (operation === this.operation && !this.disposed) this.phase = 'uncertain';
      throw error;
    }
  }
  private clearOwned() {
    ++this.operation; // Invalidate replies belonging to an ended request.
    this.owned = null;
    this.ownedId = null;
    this.observedActive = false;
    this.phase = 'idle';
    clearTimeout(this.pendingTimer);
  }
  private requireTarget(name: string, expectedId?: string): Sink {
    const matches = this.sinks.filter(s => s.name === name);
    if (matches.length !== 1) throw new Error(matches.length ? 'Empfängername ist mehrdeutig.' : 'Empfänger ist nicht mehr verfügbar.');
    if (expectedId && matches[0].id !== expectedId) throw new Error('Der Empfänger hat sich geändert. Bitte den Raum erneut auswählen.');
    if (matches[0].session) throw new Error('Dieser Empfänger wird bereits verwendet.');
    return matches[0];
  }
  async start(name: string) {
    if (this.disposed) throw new Error('Raumcast wurde beendet.');
    if (this.busy || this.phase === 'pending') throw new Error('Eine Verbindungsanfrage läuft bereits.');
    if (this.owned === name && this.phase === 'active') return;
    const target = this.requireTarget(name);
    this.busy = true;
    this.issue = '';
    try {
      await this.stopOwned();
      if (this.disposed) return;
      // Stopping the old session may take time; discovery can change meanwhile.
      this.requireTarget(name, target.id);
      const operation = ++this.operation;
      this.owned = name;
      this.ownedId = target.id;
      this.observedActive = false;
      this.phase = 'starting';
      try {
        await this.transport.send('Cast.startDesktopMirroring', { sinkName: name });
      } catch (error) {
        // A timeout can leave a real request behind. Preserve its target for Stop.
        if (!this.disposed && operation === this.operation && this.phase === 'starting') this.phase = 'pending';
        throw error;
      }
      if (!this.disposed && operation === this.operation && this.phase === 'starting') {
        this.phase = 'pending';
        this.pendingTimer = setTimeout(() => {
          if (!this.disposed && operation === this.operation && this.phase === 'pending') {
            this.issue = 'Keine aktive Sitzung bestätigt. Bitte im Browser prüfen oder die Anfrage beenden.';
          }
        }, 20_000);
        this.pendingTimer.unref?.();
      }
    } catch (error) {
      this.issue = error instanceof Error ? error.message : String(error);
      throw error;
    } finally { this.busy = false; }
  }
  async stop() {
    if (this.disposed) throw new Error('Raumcast wurde beendet.');
    if (this.busy) throw new Error('Bitte zuerst den Bildschirmdialog bestätigen oder abbrechen.');
    this.busy = true;
    try { await this.stopOwned(); this.issue = ''; }
    catch (error) {
      this.issue = error instanceof Error ? error.message : String(error);
      throw error;
    }
    finally { this.busy = false; }
  }
  async refresh() {
    if (this.busy || this.owned) throw new Error('Die Suche kann nach dem Beenden der Übertragung neu gestartet werden.');
    this.busy = true;
    try {
      await this.transport.send('Cast.disable');
      this.sinks = [];
      await this.initialize();
      this.issue = '';
    } finally { this.busy = false; }
  }
  async preference(name: string, patch: { favorite?: boolean; alias?: string }) {
    if (!this.snapshot().rooms.some(r => r.name === name)) throw new Error('Unbekannter Raum.');
    if (patch.alias !== undefined && (typeof patch.alias !== 'string' || patch.alias.length > 100)) throw new Error('Ungültiger Raumname.');
    if (patch.favorite !== undefined && typeof patch.favorite !== 'boolean') throw new Error('Ungültiger Favorit.');
    await this.store.update(name, patch);
  }
  dispose() { this.disposed = true; ++this.operation; clearTimeout(this.pendingTimer); }
}
