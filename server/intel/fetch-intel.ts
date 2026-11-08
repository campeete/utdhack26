// Downloads the CISA KEV catalogue and MITRE ATT&CK techniques into
// data/threat-intel/ so the demo works without venue Wi-Fi. Each file is
// validated before it replaces the previous copy; a failed download keeps
// the old one. The folder is git-ignored.
//
//   npm run intel:fetch

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ATTACK_URL, KEV_URL, parseAttack, parseKev } from './parse.ts';

const OUT = join(process.cwd(), 'data', 'threat-intel');
const TIMEOUT_MS = 60_000;

async function download(url: string): Promise<{ json: unknown; sha256: string; bytes: number }> {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  return { json: JSON.parse(text), sha256: createHash('sha256').update(text).digest('hex'), bytes: Buffer.byteLength(text) };
}

// Write to a temporary name, then rename, so a crash never leaves half a file.
async function save(name: string, data: unknown) {
  const path = join(OUT, name);
  await writeFile(`${path}.tmp`, JSON.stringify(data, null, 1));
  await rename(`${path}.tmp`, path);
}

await mkdir(OUT, { recursive: true });
const fetchedAt = new Date().toISOString();
const sources = [
  { name: 'CISA KEV', url: KEV_URL, file: 'kev.json', parse: parseKev },
  { name: 'MITRE ATT&CK', url: ATTACK_URL, file: 'attack-techniques.json', parse: parseAttack },
] as const;

let failed = 0;
// Keep earlier entries so a failed source still shows when it was last fetched.
const manifest: Record<string, unknown> = await readFile(join(OUT, 'manifest.json'), 'utf8').then(JSON.parse, () => ({}));
for (const source of sources) {
  try {
    const { json, sha256, bytes } = await download(source.url);
    const entries = source.parse(json);
    await save(source.file, entries);
    manifest[source.file] = { source: source.url, fetchedAt, entries: entries.length, sha256, bytes };
    console.log(`✔ ${source.name}: ${entries.length} entries saved to data/threat-intel/${source.file}`);
  } catch (e) {
    failed++;
    console.error(`✘ ${source.name}: ${(e as Error).message}. Kept any previous copy.`);
  }
}
if (Object.keys(manifest).length) await save('manifest.json', manifest);
process.exitCode = failed ? 1 : 0;
