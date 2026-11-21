import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { loadSettings, type SettingsRecovery } from './recover-settings.js';

export type ViewSettings = { favoritesOnly: boolean; prefix: string };
export function validateViewSettings(value: unknown): ViewSettings {
  const settings = value as ViewSettings | null;
  if (!settings || typeof settings.favoritesOnly !== 'boolean' || typeof settings.prefix !== 'string' || !/^(\*|[A-Z]{0,20})$/.test(settings.prefix)) {
    throw new Error('Ungültige Raumfilter.');
  }
  return { favoritesOnly:settings.favoritesOnly, prefix:settings.prefix };
}
export class ViewSettingsStore {
  value: ViewSettings = { favoritesOnly:false, prefix:'*' };
  recovery?: SettingsRecovery;
  private writes: Promise<void> = Promise.resolve();
  private writeError?: unknown;
  constructor(readonly filename: string) {}
  async load() {
    const loaded = await loadSettings(this.filename, validateViewSettings, () => ({ favoritesOnly:false, prefix:'*' }));
    this.value = loaded.value;
    this.recovery = loaded.recovery;
  }
  async update(value: unknown) {
    const next = validateViewSettings(value);
    const task = this.writes.then(async () => {
      await mkdir(dirname(this.filename), { recursive:true, mode:0o700 });
      await writeFile(this.filename + '.tmp', JSON.stringify(next) + '\n', { mode:0o600 });
      await rename(this.filename + '.tmp', this.filename);
      this.value = next;
      this.writeError = undefined;
    });
    this.writes = task.catch(error => { this.writeError = error; });
    await task;
  }
  async flush() { await this.writes; if (this.writeError) throw this.writeError; }
}
