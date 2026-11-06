import { EventEmitter } from 'node:events';
import type { CastTransport, Sink } from './controller.js';

// Deliberately opt-in: demo devices are never mixed with real discovery.
export class DemoTransport extends EventEmitter implements CastTransport {
  sinks: Sink[] = ['CWSR122PCWB', 'CWSR205PCWB', 'CWSR208PCWB', 'CWSD32PCWB', 'CWSG15PCWB', 'CWSG01PCWB', 'CWSE01PCWB'].map(name => ({ id: name, name }));
  async selectMode(sink: Sink): Promise<'desktop' | 'audio'> { return sink.id.startsWith('audio:') ? 'audio' : 'desktop'; }
  async assertSystemAudioSupported() {}
  async send(method: string, params?: Record<string, unknown>) {
    if (method === 'Cast.startDesktopMirroring' || method === 'Raumcast.startSystemAudio') {
      await new Promise(resolve => setTimeout(resolve, 500));
      const sink = this.sinks.find(s => s.name === params?.sinkName);
      if (sink) sink.session = 'Demo-Bildschirmübertragung';
      if (method === 'Raumcast.startSystemAudio') this.emit('Raumcast.audioState', { requestId:params?.requestId, state:'active' });
    }
    if (method === 'Cast.stopCasting' || method === 'Raumcast.stopSystemAudio') {
      const sink = this.sinks.find(s => s.name === params?.sinkName);
      if (sink) delete sink.session;
    }
    this.emit('Cast.sinksUpdated', { sinks: structuredClone(this.sinks) });
  }
}
