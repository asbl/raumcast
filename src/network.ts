import { get } from 'node:http';
import { networkInterfaces } from 'node:os';

// Antwortet ohne Umweg mit HTTP 204. Anmeldeportale leiten die unverschlüsselte
// Anfrage um oder liefern stattdessen ihre eigene Seite aus.
export const probeUrl = 'http://connectivitycheck.gstatic.com/generate_204';
export type NetworkState = 'unknown' | 'online' | 'login' | 'offline' | 'disconnected';

const virtualInterface = /^(lo|docker|br-|veth|virbr|vmnet|vboxnet)/;
export function inNetwork(interfaces: ReturnType<typeof networkInterfaces> = networkInterfaces()): boolean {
  return Object.entries(interfaces).some(([name, addresses]) => !virtualInterface.test(name) &&
    addresses?.some(({ address, internal }) => !internal && !address.startsWith('169.254.') && !/^fe80:/i.test(address)));
}
// Folgt bewusst keinen Umleitungen, denn gerade sie verraten das Anmeldeportal.
export function probeStatus(url = probeUrl, timeout = 5000): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = get(url, { signal: AbortSignal.timeout(timeout), agent: false }, response => {
      resolve(response.statusCode ?? 0);
      response.destroy();
    });
    request.on('error', reject);
  });
}
export class NetworkMonitor {
  state: NetworkState = 'unknown';
  private checkedAt = 0;
  private pending?: Promise<void>;
  constructor(private probe: () => Promise<number> = probeStatus, private connected: () => boolean = inNetwork, private now: () => number = Date.now) {}
  /** Prüft erneut, wenn das letzte Ergebnis veraltet ist; mit Warnung häufiger. */
  refreshIfStale(): void {
    if (this.now() - this.checkedAt >= (this.state === 'online' ? 30_000 : 5_000)) void this.check();
  }
  check(): Promise<void> {
    return this.pending ??= this.run().finally(() => { this.checkedAt = this.now(); this.pending = undefined; });
  }
  private async run() {
    try {
      if (!this.connected()) { this.state = 'disconnected'; return; }
      const status = await this.probe();
      // 511 ist der eigens für Anmeldeportale vorgesehene Status.
      this.state = status === 204 ? 'online' : (status >= 200 && status < 400) || status === 511 ? 'login' : 'offline';
    } catch { this.state = 'offline'; }
  }
}
