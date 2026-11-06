import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export type RoomPreference = { alias: string; favorite: boolean; lastUsed: number };
export type Preferences = Record<string, RoomPreference>;

export function dataDirectory(): string {
  if (process.env.RAUMCAST_DATA_DIR) return process.env.RAUMCAST_DATA_DIR;
  if (process.platform === 'win32') return join(process.env.LOCALAPPDATA || homedir(), 'Raumcast');
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Raumcast');
  return join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'raumcast');
}

export class PreferenceStore {
  value: Preferences = Object.create(null);
  private writes: Promise<void> = Promise.resolve();
  private writeError?: unknown;
  constructor(readonly filename: string) {}
  async load() {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filename, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Ungültige Raumdaten');
      for (const [name, item] of Object.entries(parsed)) {
        const p = item as RoomPreference;
        if (!p || typeof p.alias !== 'string' || typeof p.favorite !== 'boolean' || !Number.isFinite(p.lastUsed)) {
          throw new Error('Ungültige Raumdaten');
        }
        this.value[name] = { alias: p.alias, favorite: p.favorite, lastUsed: p.lastUsed };
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  async update(name: string, patch: Partial<RoomPreference>) {
    const task = this.writes.then(async () => {
      const current = this.value[name] ?? { alias:'', favorite:false, lastUsed:0 };
      const next = Object.assign(Object.create(null), this.value, { [name]:{ ...current, ...patch } }) as Preferences;
      const serialized = JSON.stringify(next, null, 2) + '\n';
      await mkdir(dirname(this.filename), { recursive: true, mode: 0o700 });
      const temporary = this.filename + '.tmp';
      await writeFile(temporary, serialized, { mode: 0o600 });
      await rename(temporary, this.filename);
      this.value = next;
      this.writeError = undefined;
    });
    this.writes = task.catch(error => { this.writeError = error; });
    await task;
  }
  async flush() { await this.writes; if (this.writeError) throw this.writeError; }
}
