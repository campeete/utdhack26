// Wires Nora's two kinds of question to NVIDIA's hosted Nemotron. The key stays in
// the server's environment (see ../nemotron/client.ts).

import { readFile } from 'node:fs/promises';
import { chatJson, configFromEnv, type Fetch } from '../nemotron/client.ts';
import { reassess } from '../nemotron/reassess.ts';
import type { NoraBrain } from './watcher.ts';

export function createBrain(env: Record<string, string | undefined> = process.env, fetchImpl?: Fetch): NoraBrain {
  const config = configFromEnv(env);
  return {
    model: config.model,
    finding: (system, user) => chatJson(config, system, user, fetchImpl),
    reassess: request => reassess(config, request, fetchImpl),
  };
}

/**
 * The ATT&CK technique ids Nora may cite, from the file `npm run intel:fetch` saves.
 * Without it Nora still runs, but every technique id is dropped rather than guessed.
 */
export async function loadAttackIds(path = 'data/threat-intel/attack-techniques.json', log: (m: string) => void = console.log): Promise<Set<string>> {
  try {
    const list = JSON.parse(await readFile(path, 'utf8')) as { id?: unknown }[];
    const ids = new Set(list.map(t => t.id).filter((id): id is string => typeof id === 'string' && /^T\d{4}(\.\d{3})?$/.test(id)));
    if (ids.size < 200) throw new Error('file looks incomplete');
    return ids;
  } catch (e) {
    log(`ATT&CK list not loaded (${(e as Error).message}). Run "npm run intel:fetch" so Nora can cite techniques.`);
    return new Set();
  }
}
