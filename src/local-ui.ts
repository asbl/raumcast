import { fileURLToPath } from 'node:url';

// Chromium may serialize file URLs differently from Node (e.g. drive-letter
// casing and percent escapes). Compare decoded paths, keeping the allowlist exact.
export function sameLocalFile(actual: string, expected: string, windows = process.platform === 'win32'): boolean {
  try {
    const a = new URL(actual);
    const b = new URL(expected);
    if (a.protocol !== 'file:' || b.protocol !== 'file:' || a.search || a.hash || b.search || b.hash) return false;
    const left = fileURLToPath(a, { windows });
    const right = fileURLToPath(b, { windows });
    return windows ? left.toLowerCase() === right.toLowerCase() : left === right;
  } catch { return false; }
}
