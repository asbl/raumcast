import { readFile, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

export type SettingsRecovery = { filename:string; backup:string; message:string };
export async function loadSettings<T>(filename: string, validate: (value:unknown) => T, defaults: () => T): Promise<{ value:T; recovery?:SettingsRecovery }> {
  let source: string;
  try { source = await readFile(filename, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { value:defaults() };
    throw error; // Permissions and filesystem errors must never overwrite data.
  }
  try { return { value:validate(JSON.parse(source)) }; }
  catch (error) {
    const backup = `${filename}.damaged-${Date.now()}-${randomUUID()}.bak`;
    // If preservation fails, stop rather than allowing a later write to destroy it.
    await rename(filename, backup);
    return { value:defaults(), recovery:{ filename, backup, message:`Beschädigte Einstellungen wurden gesichert: ${backup}. Raumcast verwendet dafür die Standardwerte.` } };
  }
}
