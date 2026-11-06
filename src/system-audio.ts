import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { isIP } from 'node:net';
import { promisify } from 'node:util';
import { createServer, type ServerResponse } from 'node:http';
import { prefillAudio } from './audio-buffer.js';
import { audioControls, audioControlsCss } from './audio-controls.js';
import { randomBytes } from 'node:crypto';

const run = promisify(execFile);
export async function checkSystemAudio() {
  if (process.platform !== 'linux') throw new Error('Computerton wird derzeit unter Linux mit PulseAudio oder PipeWire unterstützt.');
  try {
    await Promise.all([
      run('parec', ['--version'], { timeout: 3000 }),
      run('ffmpeg', ['-version'], { timeout: 3000 }),
    ]);
    const { stdout } = await run('pactl', ['get-default-sink'], { timeout: 3000 });
    const sink = stdout.trim();
    if (!sink || /[\r\n]/.test(sink)) throw new Error('Keine Audioausgabe gefunden.');
    return `${sink}.monitor`;
  } catch (error) {
    throw new Error(`Computerton benötigt ffmpeg und pulseaudio-utils (unter Manjaro: libpulse) sowie eine laufende Audioausgabe. ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function audioClientAllowed(remoteAddress: string | undefined, receiver?: { host: string; localAddress: string }): boolean {
  const remote = remoteAddress?.replace(/^::ffff:/, '');
  return remote === '127.0.0.1' || remote === '::1' || !!receiver && (remote === receiver.host || remote === receiver.localAddress);
}

// Audio controls stay on loopback. A direct music stream additionally permits
// the selected receiver address. Capture begins on GET and stops on disconnect.
export async function serveSystemAudio(source: string, onError: (message: string) => void, receiver?: { host: string; localAddress: string }) {
  const token = randomBytes(24).toString('hex');
  const audioPath = `/${token}/audio.${receiver ? 'mp3' : 'wav'}`;
  let children: ChildProcess[] = [];
  let response: ServerResponse | undefined;
  let closed = false;
  function stopCapture() {
    const processes = children;
    children = [];
    for (const child of processes) {
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 1000);
      timer.unref();
      child.once('exit', () => clearTimeout(timer));
    }
    response?.destroy();
    response = undefined;
  }
  const server = createServer((req, res) => {
    if (!audioClientAllowed(req.socket.remoteAddress, receiver)) { res.writeHead(403).end(); return; }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; media-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    if (req.url === `/${token}/controls.css` && req.method === 'GET') {
      res.setHeader('Content-Type', 'text/css; charset=utf-8'); res.end(audioControlsCss); return;
    }
    if (req.url === `/${token}/controls.js` && req.method === 'GET') {
      res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); res.end(audioControls); return;
    }
    if (req.url === `/${token}/` && req.method === 'GET') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(`<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Raumcast – Computerton</title><link rel="stylesheet" href="controls.css"><script src="controls.js" defer></script></head><body><main><h1>Raumcast – Computerton</h1><p>Zum Beenden der Übertragung Raumcast verwenden.</p><section class="volume-panel" aria-label="Receiver-Lautstärke"><label for="receiver-volume">Receiver-Lautstärke</label><output id="volume-value" for="receiver-volume">Wird abgefragt …</output><input id="receiver-volume" type="range" min="0" max="40" step="0.1" value="0" aria-describedby="volume-help" disabled><div id="volume-ticks" aria-hidden="true"></div><div class="volume-actions"><button id="volume-down" aria-label="Um einen halben Prozentpunkt leiser" disabled>−0,5 %</button><button id="volume-up" aria-label="Um einen halben Prozentpunkt lauter" disabled>+0,5 %</button><button id="receiver-mute" disabled aria-pressed="false">Stumm</button></div><p id="volume-help">Fein einstellen: Pfeiltasten ändern um 0,1 %, die Tasten um 0,5 %.</p><button id="volume-range" aria-pressed="false">Gesamten Bereich 0–100 % anzeigen</button><p id="volume-error" role="status"></p></section><audio src="${audioPath}" preload="none"></audio></main></body></html>`);
      return;
    }
    if (req.url !== audioPath || req.method !== 'GET' || closed) { res.writeHead(404).end(); return; }
    stopCapture();
    response = res;
    const recorder = spawn('parec', ['--device', source, '--format=s16le', '--rate=48000', '--channels=2', '--latency-msec=200', '--client-name=Raumcast', '--raw'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const encoder = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-thread_queue_size', '1024', '-f', 's16le', '-ar', '48000', '-ac', '2', '-probesize', '32', '-analyzeduration', '0', '-i', 'pipe:0', ...(receiver ? ['-c:a', 'libmp3lame', '-b:a', '320k', '-f', 'mp3', '-write_xing', '0'] : ['-c:a', 'pcm_s16le', '-f', 'wav']), '-flush_packets', '1', 'pipe:1'], { stdio: ['pipe', 'pipe', 'pipe'] });
    children = [recorder, encoder];
    let diagnostic = '';
    let failed = false;
    const fail = (message: string) => {
      if (failed || closed || response !== res) return;
      failed = true;
      stopCapture();
      onError(`Audioaufnahme beendet: ${message}`);
    };
    for (const child of children) {
      child.stderr!.on('data', chunk => { diagnostic = (diagnostic + chunk.toString()).slice(-1500); });
      child.on('error', error => fail(error.message));
      child.on('exit', (code, signal) => {
        if (response === res) fail(diagnostic || `Audioprozess beendet (${code ?? signal}).`);
      });
    }
    recorder.stdout!.on('error', error => fail(error.message));
    encoder.stdin!.on('error', error => fail(error.message));
    encoder.stdout!.on('error', error => fail(error.message));
    recorder.stdout!.pipe(encoder.stdin!);
    res.writeHead(200, { 'Content-Type': receiver ? 'audio/mpeg' : 'audio/wav', 'Accept-Ranges': 'none' });
    if (receiver) encoder.stdout!.pipe(prefillAudio()).pipe(res);
    else encoder.stdout!.pipe(res);
    res.on('close', () => { if (response === res) stopCapture(); });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, receiver ? (isIP(receiver.localAddress) === 6 ? '::' : '0.0.0.0') : '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  });
  server.on('error', error => { if (!closed) onError(error.message); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Audio-Endpunkt konnte nicht gestartet werden.');
  return {
    url: `http://127.0.0.1:${address.port}/${token}/`,
    mediaUrl: `http://${receiver && isIP(receiver.localAddress) === 6 ? `[${receiver.localAddress}]` : receiver?.localAddress || '127.0.0.1'}:${address.port}${audioPath}`,
    close() {
      if (closed) return;
      closed = true;
      stopCapture();
      server.closeAllConnections();
      server.close();
    },
  };
}
