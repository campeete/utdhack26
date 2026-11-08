// Connects Nora's worker to SpacetimeDB and exposes her views as a NoraStore.
//
// Nora signs in with her own identity. The token that proves it is saved to
// .spacetime/nora-token (gitignored, readable only by you) so she keeps the same
// identity across restarts; a platform admin registers that identity once with
// set_service_account. Delete the file only if you mean to give Nora a new identity.

import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Identity } from 'spacetimedb';
import { DbConnection } from './bindings.ts';
import type { NoraStore } from './watcher.ts';

export interface SpacetimeConfig {
  uri: string;
  dbName: string;
  tokenPath: string;
}

export function spacetimeConfigFromEnv(env: Record<string, string | undefined> = process.env): SpacetimeConfig {
  const uri = env.SPACETIME_URI?.trim() || env.VITE_SPACETIME_URI?.trim() || 'ws://127.0.0.1:3000';
  const dbName = env.SPACETIME_DB_NAME?.trim() || env.VITE_SPACETIME_DB_NAME?.trim();
  if (!dbName) throw new Error('Set SPACETIME_DB_NAME in .env to the database name you published the module as.');
  return { uri, dbName, tokenPath: env.NORA_TOKEN_PATH?.trim() || '.spacetime/nora-token' };
}

const VIEWS = [
  'incident_logins', 'incident_accounts', 'incident_findings', 'low_severity_rules', 'nora_memory_feed',
  'nora_reassessment_queue', 'incident_suggestions', 'incident_evidence', 'incident_sources',
  'incident_decisions', 'incident_team_updates', 'my_incidents', 'incident_members', 'incident_messages',
  'incident_tasks', 'incident_evidence_reviews',
];

async function loadToken(path: string): Promise<string | undefined> {
  try { return (await readFile(path, 'utf8')).trim() || undefined; } catch { return undefined; }
}

async function saveToken(path: string, token: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, token, { mode: 0o600 });
  await chmod(path, 0o600);
}

export interface NoraConnection {
  store: NoraStore;
  identity: Identity;
  disconnect(): void;
}

export async function connectNora(config: SpacetimeConfig, log: (msg: string) => void): Promise<NoraConnection> {
  const saved = await loadToken(config.tokenPath);

  const { conn, identity } = await new Promise<{ conn: DbConnection; identity: Identity }>((resolve, reject) => {
    DbConnection.builder()
      .withUri(config.uri)
      .withDatabaseName(config.dbName)
      .withToken(saved)
      .onConnect((c, id, token) => {
        if (token && token !== saved) saveToken(config.tokenPath, token).catch(e => log(`Could not save Nora's token: ${(e as Error).message}`));
        resolve({ conn: c, identity: id });
      })
      .onConnectError((_ctx, error) => reject(new Error(`Could not connect to SpacetimeDB at ${config.uri} (${config.dbName}): ${error.message}`)))
      .onDisconnect((_ctx, error) => log(`Disconnected from SpacetimeDB${error ? `: ${error.message}` : ''}.`))
      .build();
  });

  await new Promise<void>((resolve, reject) => {
    conn.subscriptionBuilder()
      .onApplied(() => resolve())
      .onError(ctx => reject(new Error(`Subscription failed: ${String((ctx as { event?: unknown }).event ?? 'unknown error')}`)))
      .subscribe(VIEWS.map(v => `SELECT * FROM ${v}`));
  });

  const db = conn.db;
  const store: NoraStore = {
    logins: () => [...db.incidentLogins.iter()],
    accounts: () => [...db.incidentAccounts.iter()],
    findings: () => [...db.incidentFindings.iter()],
    rules: () => [...db.lowSeverityRules.iter()],
    memory: () => [...db.noraMemoryFeed.iter()],
    requests: () => [...db.noraReassessmentQueue.iter()],
    suggestions: () => [...db.incidentSuggestions.iter()],
    evidence: () => [...db.incidentEvidence.iter()],
    sources: () => [...db.incidentSources.iter()],
    decisions: () => [...db.incidentDecisions.iter()],
    teamUpdates: () => [...db.incidentTeamUpdates.iter()],
    incidents: () => [...db.myIncidents.iter()],
    members: () => [...db.incidentMembers.iter()],
    messages: () => [...db.incidentMessages.iter()],
    tasks: () => [...db.incidentTasks.iter()],
    evidenceReviews: () => [...db.incidentEvidenceReviews.iter()],
    self: identity,
    onLogin: cb => db.incidentLogins.onInsert((_ctx, row) => cb(row)),
    onRequest: cb => db.noraReassessmentQueue.onInsert((_ctx, row) => cb(row)),
    onEvidence: cb => db.incidentEvidence.onInsert((_ctx, row) => cb(row)),
    createFinding: call => conn.reducers.createFinding(call),
    completeReassessment: (requestId, resultJson) => conn.reducers.completeReassessment({ requestId, resultJson }),
    recordEvidenceReview: call => conn.reducers.recordEvidenceReview(call),
    flagDecision: call => conn.reducers.noraFlagDecision(call),
    post: call => conn.reducers.noraPost(call),
  };
  return { store, identity, disconnect: () => conn.disconnect() };
}
