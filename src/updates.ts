export const releasesUrl = 'https://github.com/asbl/raumcast/releases/latest';
export type UpdateStatus = { state: 'idle' | 'checking' | 'current' | 'available' | 'error'; latest?: string; checkedAt?: string; message?: string };

function versionParts(value: string): number[] | null {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  const parts = match?.slice(1).map(Number);
  return parts?.every(Number.isSafeInteger) ? parts : null;
}
export function isNewerVersion(latest: string, current: string): boolean {
  const a = versionParts(latest), b = versionParts(current);
  if (!a || !b) throw new Error('Unbekanntes Versionsformat.');
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
export class UpdateChecker {
  status: UpdateStatus = { state:'idle' };
  private pending?: Promise<void>;
  constructor(private version: string, private request: typeof fetch = fetch) {}
  check(): Promise<void> {
    if (this.pending) return this.pending;
    this.status = { state:'checking' };
    this.pending = this.run().finally(() => { this.pending = undefined; });
    return this.pending;
  }
  private async run() {
    try {
      const response = await this.request('https://api.github.com/repos/asbl/raumcast/releases/latest', {
        headers: { Accept:'application/vnd.github+json', 'User-Agent':`Raumcast/${this.version}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error(`GitHub antwortet mit HTTP ${response.status}.`);
      const release = await response.json() as { tag_name?: unknown; draft?: boolean; prerelease?: boolean };
      if (typeof release.tag_name !== 'string' || release.draft || release.prerelease) throw new Error('Keine gültige stabile Version gemeldet.');
      const newer = isNewerVersion(release.tag_name, this.version);
      this.status = { state:newer ? 'available' : 'current', latest:release.tag_name.replace(/^v/, ''), checkedAt:new Date().toISOString() };
    } catch (error) {
      this.status = { state:'error', message:`Updateprüfung nicht möglich: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
}
