// Signs in to SpacetimeDB as the platform admin: the identity the CLI published the
// module with, read from ~/.config/spacetime/cli.toml or SPACETIME_ADMIN_TOKEN. The
// token is used only to connect and is never printed.

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DbConnection } from './bindings.ts';
import { spacetimeConfigFromEnv } from '../nora/spacetime.ts';

async function adminToken(): Promise<string> {
  const fromEnv = process.env.SPACETIME_ADMIN_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const path = join(homedir(), '.config', 'spacetime', 'cli.toml');
  let text: string;
  try { text = await readFile(path, 'utf8'); } catch { throw new Error(`No SpacetimeDB CLI config at ${path}. Publish the module with the CLI first, or set SPACETIME_ADMIN_TOKEN.`); }
  const m = /^\s*spacetimedb_token\s*=\s*"([^"]+)"/m.exec(text);
  if (!m) throw new Error(`No spacetimedb_token in ${path}. Run "spacetime login" (or publish once) and try again.`);
  return m[1];
}

export async function connectAdmin(): Promise<DbConnection> {
  try { process.loadEnvFile('.env'); } catch { /* use the shell environment */ }
  const { uri, dbName } = spacetimeConfigFromEnv();
  const token = await adminToken();
  const conn = await new Promise<DbConnection>((resolve, reject) => {
    DbConnection.builder()
      .withUri(uri).withDatabaseName(dbName).withToken(token)
      .onConnect(c => resolve(c))
      .onConnectError((_ctx, e) => reject(new Error(`Could not connect to ${uri} (${dbName}): ${e.message || 'is "spacetime start" running and the module published?'}`)))
      .build();
  });
  await new Promise<void>((resolve, reject) => conn.subscriptionBuilder()
    .onApplied(() => resolve()).onError(() => reject(new Error('Subscription failed.')))
    .subscribe(['SELECT * FROM my_incidents', 'SELECT * FROM low_severity_rules']));
  return conn;
}

/** Runs one step, prints ✔ or ✘, and exits on failure. */
export async function step(conn: DbConnection, label: string, run: () => Promise<void>) {
  try { await run(); console.log(`✔ ${label}`); }
  catch (e) { console.error(`✘ ${label}: ${(e as Error).message}`); conn.disconnect(); process.exit(1); }
}

export const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
