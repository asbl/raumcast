import type { Browser, CDPSession, Page } from 'puppeteer-core';
import { DirectCastAudio, localAddressFor } from './direct-audio.js';
import { ReceiverVolumeControl } from './receiver-volume.js';
import { checkSystemAudio, serveSystemAudio } from './system-audio.js';
import type { CastTransport, Sink } from './controller.js';

// CDP omits supported cast modes. Read Chromium's own desktop-source results
// before calling startDesktopMirroring: that handler dereferences a missing
// source for unsupported sinks instead of returning a protocol error.
type RouterState = {
  discovered_sinks?: Record<string, unknown>;
  available_sinks?: Record<string, unknown>;
  known_sinks?: Sink[];
};
const sourceMatches = (source: string, mode: 'desktop' | 'tab') =>
  new RegExp(`^CAST:urn:x-org\\.chromium\\.media:source:${mode}(?:$|:)`).test(source);
export function supportsDesktop(state: unknown, sink: Sink): boolean { return supportsMode(state, sink, 'desktop'); }
export function supportsMode(state: unknown, sink: Sink, mode: 'desktop' | 'tab'): boolean {
  const data = state as RouterState | null;
  const known = data?.known_sinks ?? Object.values(data?.discovered_sinks ?? {}).flat();
  return Object.entries(data?.available_sinks ?? {}).some(([source, ids]) =>
    sourceMatches(source, mode) && Array.isArray(ids) && ids.some(id => {
      // Chromium releases abbreviate diagnostic IDs to different lengths.
      // Match against full CDP IDs and reject any abbreviation collision.
      if (typeof id !== 'string' || id.length < 8 || !sink.id.startsWith(id)) return false;
      const matches = known.filter((item: any) => typeof item?.id === 'string' && (item.id.startsWith(id) || id.startsWith(item.id)));
      return matches.length === 1 && (matches[0] as Sink).name === sink.name;
    }));
}

export function preferredMode(state: unknown, sink: Sink): 'desktop' | 'audio' {
  if (supportsDesktop(state, sink)) return 'desktop';
  const data = state as RouterState | null;
  const desktopKnown = Object.entries(data?.available_sinks ?? {}).some(([source, ids]) => sourceMatches(source, 'desktop') && Array.isArray(ids));
  const entry = Object.values(data?.discovered_sinks ?? {}).flat().find((item: any) => typeof item?.id === 'string' && sink.id.startsWith(item.id) && item.name === sink.name) as { capabilities?: number } | undefined;
  const capabilities = entry?.capabilities;
  const audioOnly = typeof capabilities === 'number' && Number.isSafeInteger(capabilities) && capabilities >= 0 && (capabilities & 5) === 4;
  // An explicit desktop result excluding this sink, together with a positive
  // tab result, also confirms the audio path when discovered_sinks is empty.
  if ((desktopKnown || audioOnly) && supportsMode(state, sink, 'tab')) return 'audio';
  throw new Error('Der Übertragungsmodus dieses Empfängers ist noch nicht eindeutig bestätigt. Bitte die Suche erneut starten.');
}

export class ChromiumCastTransport implements CastTransport {
  private audio?: { page: Page; direct: DirectCastAudio; stream: Awaited<ReturnType<typeof serveSystemAudio>>; name: string; requestId:number; suspended:boolean; volume: ReceiverVolumeControl };
  private disposed = false;
  private sinks: Sink[] = [];
  constructor(private browser: Browser, private cdp: CDPSession, private log: (message: string) => void = () => {}) {
    cdp.on('Cast.sinksUpdated', event => { this.sinks = event.sinks; });
  }
  async send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (method === 'Raumcast.startSystemAudio' || method === 'Cast.startDesktopMirroring') this.log(`${method}: ${String(params?.sinkName)}`);
    if (method === 'Raumcast.startSystemAudio') {
      try { return await this.startSystemAudio(String(params?.sinkName), String(params?.sinkId), Number(params?.requestId)); }
      catch (error) { this.audio?.stream.close(); if (this.audio) await this.audio.direct.stop().catch(() => {}); throw error; }
    }
    if (method === 'Raumcast.stopSystemAudio') {
      if (!this.audio) return; // Never fall back to a device-wide CDP stop.
      if (this.audio.name !== params?.sinkName) throw new Error('Eigene Audiositzung passt nicht zum Empfänger.');
      const audio = this.audio;
      // End capture before Chrome restores local playback on stopping Cast.
      audio.stream.close();
      await audio.direct.stop();
      this.releaseSystemAudio();
      return;
    }
    return (this.cdp as unknown as CastTransport).send(method, params);
  }
  on(event: string, listener: (payload: any) => void) {
    return (this.cdp as unknown as CastTransport).on(event, listener);
  }
  async selectMode(sink: Sink) {
    const mode = preferredMode(await this.readState(), sink);
    this.log(`Empfänger ${sink.name}: automatisch ${mode}`);
    return mode;
  }
  async assertDesktopMirroringSupported(sink: Sink) { await this.assertModeSupported(sink, 'desktop'); }
  async assertSystemAudioSupported(sink: Sink) {
    await checkSystemAudio();
    await this.assertModeSupported(sink, 'tab');
  }
  private async assertModeSupported(sink: Sink, mode: 'desktop' | 'tab') {
    if (!supportsMode(await this.readState(), sink, mode)) {
      throw new Error(mode === 'desktop' ? 'Dieser Empfänger unterstützt keine bestätigte Bildschirmübertragung. Bitte einen bildschirmfähigen Cast-Empfänger auswählen.' : 'Dieser Empfänger unterstützt keine bestätigte Audioübertragung aus einem Browser-Tab.');
    }
  }
  private async readState(): Promise<unknown> {
    const page = await this.browser.newPage();
    try {
      await page.goto('chrome://media-router-internals/', { timeout: 5000 });
      // Recent Chromium versions gate diagnostic pages behind a profile toggle.
      // This changes only Raumcast's dedicated browser profile.
      if (page.url().startsWith('chrome://debug-webuis-disabled')) {
        await page.goto('chrome://chrome-urls/', { timeout: 5000 });
        await page.waitForFunction(() => document.querySelector('chrome-urls-app')?.shadowRoot?.querySelector('cr-button'), { timeout: 5000 });
        await page.evaluate(() => {
          const root = document.querySelector('chrome-urls-app')!.shadowRoot!;
          if (!root.querySelector('a[href="chrome://media-router-internals"]')) {
            (root.querySelector('cr-button') as HTMLElement).click();
          }
        });
        await page.waitForFunction(() => document.querySelector('chrome-urls-app')?.shadowRoot?.querySelector('a[href="chrome://media-router-internals"]'), { timeout: 5000 });
        await page.goto('chrome://media-router-internals/', { timeout: 5000 });
      }
      const state = await page.evaluate(async () => {
        const moduleUrl = 'chrome://resources/js/cr.js';
        const { sendWithPromise } = await import(moduleUrl);
        return Promise.race([
          sendWithPromise('getState'),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Cast-Prüfung: Zeitlimit')), 5000)),
        ]);
      });
      return { ...(state as RouterState), known_sinks: this.sinks };
    } catch (error) {
      throw new Error(`Übertragung kann nicht sicher gestartet werden: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await page.close().catch(() => {});
    }
  }
  private async startSystemAudio(name: string, id: string, requestId:number) {
    if (this.disposed) throw new Error('Raumcast wurde beendet.');
    this.releaseSystemAudio();
    const source = await checkSystemAudio();
    const volume = new ReceiverVolumeControl(id);
    let endpoint: {host:string; port:number};
    let localAddress: string;
    try { endpoint = await volume.getEndpoint(); localAddress = await localAddressFor(endpoint); }
    catch(error) { volume.close(); throw error; }
    const fail = (message:string) => {
      if (this.audio?.requestId === requestId) {
        this.cdp.emit('Raumcast.audioState', {requestId, state:'error', message});
        this.suspendSystemAudio();
      }
    };
    const stream = await serveSystemAudio(source, message => {
      fail(message);
    }, { host:endpoint.host, localAddress }).catch(error => { volume.close(); throw error; });
    const direct = new DirectCastAudio(fail, undefined, state => {
      if (this.audio?.requestId === requestId && (state === 'ended' || !this.audio.suspended)) this.cdp.emit('Raumcast.audioState', {requestId, state});
    });
    if (this.disposed) { stream.close(); volume.close(); direct.close(); return; }
    let page: Page;
    try { page = await this.browser.newPage(); }
    catch (error) { stream.close(); volume.close(); direct.close(); throw error; }
    if (this.disposed) { stream.close(); volume.close(); direct.close(); await page.close().catch(() => {}); return; }
    this.audio = { page, direct, stream, name, requestId, suspended:false, volume };
    await page.exposeFunction('raumcastAudio', async (action: unknown, patch: unknown) => {
      try {
        if (page.url() !== stream.url || this.audio?.page !== page) throw new Error('Audioübertragung beendet.');
        const data = action === 'status' ? await volume.get()
          : action === 'volume' ? await volume.set(patch)
          : action === 'adjust' ? await volume.adjust((patch as {delta?:unknown})?.delta)
          : action === 'mute' ? await volume.toggleMute() : undefined;
        if (!data) throw new Error('Unbekannter Audiobefehl.');
        return { ok:true, data };
      } catch(error) { return { ok:false, error:error instanceof Error ? error.message : String(error) }; }
    });
    page.once('close', () => {
      stream.close(); volume.close();
      if (this.audio?.page === page && !this.audio.suspended) {
        this.suspendSystemAudio();
        this.cdp.emit('Raumcast.audioState', {requestId, state:'error', message:'Audiofenster geschlossen. Die eigene Anfrage kann weiterhin beendet werden.'});
      }
    });
    await page.goto(stream.url, { waitUntil: 'domcontentloaded', timeout: 5000 });
    const current = this.sinks.filter(sink => sink.name === name);
    if (current.length !== 1 || current[0].id !== id || current[0].session) throw new Error('Audioempfänger ist nicht mehr eindeutig verfügbar oder bereits belegt.');
    if (this.disposed || this.audio?.page !== page) throw new Error('Audioanfrage wurde beendet.');
    this.log(`Direkter MP3-Livestream zum Receiver: ${name}`);
    await direct.start(endpoint, stream.mediaUrl);
    this.log(`Receiver spielt direkten Musikstream: ${name}`);
  }

  suspendSystemAudio() {
    const audio = this.audio;
    if (!audio || audio.suspended) return;
    audio.suspended = true;
    audio.stream.close(); audio.volume.close();
    void audio.page.close().catch(() => {});
  }
  releaseSystemAudio() {
    const audio = this.audio;
    this.audio = undefined;
    audio?.stream.close();
    audio?.volume.close();
    if (audio) void audio.direct.stop().catch(() => audio.direct.close());
    if (audio) void audio.page.close().catch(() => {});
  }
  dispose() { this.disposed = true; this.releaseSystemAudio(); }

}
