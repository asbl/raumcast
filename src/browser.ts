import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, join } from 'node:path';

export function browserGraphicsArgs(platform: NodeJS.Platform = process.platform, args: readonly string[] = process.argv): string[] {
  // Some Windows drivers leave an app window blank even though its DOM and
  // hit-testing work. Use Chromium's software rendering path on Windows.
  return args.includes('--disable-gpu') || (platform === 'win32' && !args.includes('--enable-gpu'))
    ? ['--disable-gpu'] : [];
}

export async function findBrowser(): Promise<string> {
  const override = process.env.RAUMCAST_BROWSER;
  const candidates = override ? [override] : process.platform === 'darwin' ? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ] : process.platform === 'win32' ? [
    ...[process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
      .filter((p): p is string => !!p).map(p => join(p, 'Google', 'Chrome', 'Application', 'chrome.exe')),
  ] : ['chromium', 'chromium-browser', 'google-chrome-stable', 'google-chrome'];
  for (const candidate of candidates) {
    const paths = /[/\\]/.test(candidate) ? [candidate] : (process.env.PATH || '').split(delimiter).map(p => join(p, candidate));
    for (const path of paths) {
      try { await access(path, constants.X_OK); return path; } catch {}
    }
  }
  throw new Error('Chrome/Chromium nicht gefunden. RAUMCAST_BROWSER auf die Browserdatei setzen.');
}
