import { EventEmitter } from 'node:events';
import type { CastTransport, Sink } from './controller.js';

// Deliberately opt-in: demo devices are never mixed with real discovery.
export class DemoTransport extends EventEmitter implements CastTransport {
  sinks: Sink[] = ['CWSR122PCWB', 'CWSR205PCWB', 'CWSR208PCWB', 'CWSD32PCWB', 'CWSG15PCWB', 'CWSG01PCWB', 'CWSE01PCWB'].map(name => ({ id: name, name }));
  async send(method: string, params?: Record<string, unknown>) {
    if (method === 'Cast.startDesktopMirroring') {
      await new Promise(resolve => setTimeout(resolve, 500));
      const sink = this.sinks.find(s => s.name === params?.sinkName);
      if (sink) sink.session = 'Demo-Bildschirmübertragung';
    }
    if (method === 'Cast.stopCasting') {
      const sink = this.sinks.find(s => s.name === params?.sinkName);
      if (sink) delete sink.session;
    }
    this.emit('Cast.sinksUpdated', { sinks: structuredClone(this.sinks) });
  }
}
