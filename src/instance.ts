import { createHash } from 'node:crypto';
import { createServer, createConnection, type Server, type Socket } from 'node:net';
import { realpath } from 'node:fs/promises';
import { execFile } from 'node:child_process';

type Reply = { key:string; browserPid?:number; ok:boolean; error?:string };
const protocol = 'raumcast-instance-v1';

async function request(port: number, key: string, action: 'probe' | 'activate'): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host:'127.0.0.1', port });
    let buffer = '';
    socket.setEncoding('utf8');
    socket.setTimeout(3000, () => socket.destroy(new Error('Die laufende Raumcast-Instanz antwortet nicht.')));
    socket.once('connect', () => socket.write(JSON.stringify({ protocol, key, action }) + '\n'));
    socket.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 4096) { socket.destroy(new Error('Ungültige Instanzantwort.')); return; }
      if (!buffer.includes('\n')) return;
      try {
        const reply = JSON.parse(buffer.slice(0, buffer.indexOf('\n')));
        if (reply.protocol !== protocol || typeof reply.key !== 'string' || typeof reply.ok !== 'boolean') throw new Error('Der Raumcast-Steueranschluss ist durch ein anderes Programm belegt.');
        resolve(reply); socket.destroy();
      } catch (error) { socket.destroy(error as Error); }
    });
    socket.once('error', reject);
    socket.once('end', () => { if (!buffer.includes('\n')) reject(new Error('Unvollständige Instanzantwort.')); });
  });
}

// The second, user-launched process can pass foreground permission to Chrome.
// Restoring the actual window is done by the existing instance through CDP.
async function allowWindowsForeground(pid: number | undefined) {
  if (process.platform !== 'win32' || !Number.isSafeInteger(pid) || pid! <= 0) return;
  const script = `Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class RaumcastForeground { [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(uint pid); }'; [RaumcastForeground]::AllowSetForegroundWindow(${pid}) | Out-Null`;
  await new Promise<void>(resolve => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide:true, timeout:3000 }, () => resolve()));
}

export class AppInstance {
  private server?: Server;
  private sockets = new Set<Socket>();
  constructor(private activate: () => Promise<void>, private browserPid: () => number | undefined = () => undefined) {}
  async acquire(directory: string): Promise<'primary' | 'activated'> {
    let canonical = await realpath(directory);
    if (process.platform === 'win32') canonical = canonical.toLowerCase();
    const key = createHash('sha256').update(canonical).digest('hex');
    const base = Number.parseInt(key.slice(0, 8), 16);
    const port = 20000 + base % 40000;
    const server = createServer(socket => {
      this.sockets.add(socket);
      socket.once('close', () => this.sockets.delete(socket));
      socket.on('error', () => {});
      socket.setTimeout(3000, () => socket.destroy());
      socket.setEncoding('utf8');
      let buffer = '', handled = false;
      socket.on('data', chunk => {
        buffer += chunk;
        if (buffer.length > 4096) { socket.destroy(); return; }
        if (handled || !buffer.includes('\n')) return;
        handled = true;
        void (async () => {
          try {
            const message = JSON.parse(buffer.slice(0, buffer.indexOf('\n')));
            if (message.protocol !== protocol) { socket.destroy(); return; }
            if (message.key === key && message.action === 'activate') await this.activate();
            else if (message.action !== 'probe') throw new Error('Unbekannter Instanzbefehl.');
            socket.end(JSON.stringify({ protocol, key, ok:true, browserPid:this.browserPid() }) + '\n');
          } catch (error) {
            socket.end(JSON.stringify({ protocol, key, ok:false, error:String(error) }) + '\n');
          }
        })();
      });
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen({ host:'127.0.0.1', port, exclusive:true }, () => { server.removeListener('error', reject); resolve(); });
      });
      this.server = server;
      return 'primary';
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
      let reply: Reply;
      try { reply = await request(port, key, 'probe'); }
      catch (error) {
        // Never try a second lock after an ambiguous/unresponsive owner.
        throw new Error(`Raumcast konnte die laufende Instanz nicht prüfen: ${String(error)}`);
      }
      // Switching ports could create two owners after the blocking profile exits.
      if (reply.key !== key) throw new Error('Ein anderes Raumcast-Profil belegt den Steueranschluss. Bitte dieses Profil zuerst schließen.');
      await allowWindowsForeground(reply.browserPid);
      reply = await request(port, key, 'activate');
      if (!reply.ok || reply.key !== key) throw new Error(reply.error || 'Das vorhandene Fenster konnte nicht aktiviert werden.');
      return 'activated';
    }
  }
  async close() {
    for (const socket of this.sockets) socket.destroy();
    const server = this.server;
    this.server = undefined;
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
