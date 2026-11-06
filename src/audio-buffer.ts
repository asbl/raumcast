import { Transform } from 'node:stream';

// Build a small lead before handing a realtime source to a media receiver.
// 80 kB is about two seconds of the fixed 320 kbit/s MP3 stream.
export function prefillAudio(minimumBytes = 80_000): Transform {
  let chunks: Buffer[] = [];
  let size = 0;
  let ready = false;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      if (ready) { callback(null, chunk); return; }
      chunks.push(chunk); size += chunk.length;
      if (size >= minimumBytes) {
        ready = true;
        for (const part of chunks) this.push(part);
        chunks = [];
      }
      callback();
    },
    flush(callback) {
      for (const part of chunks) this.push(part);
      chunks = [];
      callback();
    },
  });
}
