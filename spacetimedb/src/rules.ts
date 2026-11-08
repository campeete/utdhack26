// Pure rules for the Clean Room module: allowed values, limits, and the checks
// that decide whether an action is permitted. No SpacetimeDB imports, so the
// tests can call these directly and the reducers in index.ts stay short.
//
// The review and reassessment rules here are ports of shared/review.ts and
// shared/reassessment.ts (which run in the browser on snapshots with text ids)
// to the module's tables with numeric ids. Behaviour is meant to be identical;
// test/clean-room.test.ts checks the same cases as shared/*.test.ts.

// ---------- incident records ----------

export const TRUST = ['trusted', 'under_review', 'untrusted'] as const;
export const STANDING = ['confirmed', 'under_review', 'disputed'] as const;
export const DECISION_STATES = ['draft', 'approved', 'needs_review', 'superseded'] as const;
export const TEAM_UPDATE_STATES = ['current', 'outdated', 'reviewed'] as const;
export const SUGGESTION_STATES = ['pending', 'accepted', 'dismissed', 'stale'] as const;
export const SUGGESTION_ORIGINS = ['synthetic', 'human', 'nora'] as const;
export const REASSESS_STATES = ['requested', 'revised', 'no_further_review', 'failed'] as const;
export const TASK_STATES = ['open', 'accepted', 'resolved'] as const;

export const FEEDBACK_MAX = 2000;
export const REASON_MIN = 8;
export const REASON_MAX = 2000;
export const EXPLANATION_MAX = 2000;
export const VERIFICATION_MAX = 500;

/** Whitespace-only feedback counts as no feedback: the dismissal never involves Nora. */
export const normalizeFeedback = (feedback: string) => feedback.trim();
export const requestIdFor = (suggestionId: bigint, attempt: number) => `${suggestionId}:attempt-${attempt}`;

export type ReassessmentResult =
  | { kind: 'revision'; excerpt: string; explanation: string; verification: string }
  | { kind: 'no_further_review'; note: string }
  | { kind: 'error'; message: string };

const text = (value: unknown, max: number) =>
  typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : null;

/** Accepts only the shapes above; anything else from the model counts as a failure. */
export function parseReassessmentResult(raw: unknown): ReassessmentResult {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw); } catch { return { kind: 'error', message: 'Nora returned an unreadable result.' }; }
  }
  if (!value || typeof value !== 'object') return { kind: 'error', message: 'Nora returned an unreadable result.' };
  const r = value as Record<string, unknown>;
  if (r.kind === 'no_further_review') return { kind: 'no_further_review', note: text(r.note, EXPLANATION_MAX) ?? '' };
  if (r.kind === 'error') return { kind: 'error', message: text(r.message, 300) ?? 'Reassessment failed.' };
  if (r.kind === 'revision') {
    const excerpt = text(r.excerpt, EXPLANATION_MAX);
    const explanation = text(r.explanation, EXPLANATION_MAX);
    const verification = text(r.verification, VERIFICATION_MAX);
    if (excerpt && explanation && verification) return { kind: 'revision', excerpt, explanation, verification };
  }
  return { kind: 'error', message: 'Nora returned a result in an unexpected format.' };
}

// ---------- Northstar side ----------

export const LOGIN_METHODS = ['password_2fa', 'password_only'] as const;
export const LOGIN_OUTCOMES = ['success', 'failed_password', 'failed_2fa'] as const;
export const LOGIN_ORIGINS = ['seeded', 'live_phone'] as const;
export const SMS_DIRECTIONS = ['to_contact', 'from_contact'] as const;
export const SMS_MAX = 640;

/** An IPv4 or IPv6 address, nothing else (no hostnames, no ports). */
export function isIpAddress(ip: string): boolean {
  const v4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
  if (v4.test(ip)) return true;
  return ip.length <= 45 && ip.includes(':') && /^[0-9a-fA-F:.]+$/.test(ip);
}

// ---------- Nora ----------

export const SERVICE_KINDS = ['nora', 'login_gateway'] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];
export const FINDING_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export const FINDING_QUEUES = ['needs_human', 'low_severity'] as const;
export const FINDING_STATES = ['open', 'approved', 'dismissed', 'auto_fixed', 'undone'] as const;

/** What each action does to a Northstar account's status. `monitor_only` changes nothing. */
export const ACTION_EFFECTS = {
  disable_account: 'disabled',
  force_password_reset: 'password reset required',
  monitor_only: null,
} as const satisfies Record<string, string | null>;
export type ProposedAction = keyof typeof ACTION_EFFECTS;
export const PROPOSED_ACTIONS = Object.keys(ACTION_EFFECTS) as ProposedAction[];

/** Format check only. The worker checks the id against the local ATT&CK list before calling. */
export const isAttackTechniqueId = (id: string) => /^T\d{4}(\.\d{3})?$/.test(id);

export const CLUES_MAX = 2048;
const CLUE_KEYS = ['breached_password', 'ip_abuse_score', 'network_owner', 'country', 'new_device', 'new_network'] as const;

/**
 * Validates the clues object and returns it re-serialized with only the known
 * keys, so nothing extra (such as a password or a full lookup response) can
 * ride along into the database.
 */
export function cleanClues(json: string): string {
  if (json.length > CLUES_MAX) throw new Error('Clues are too large');
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { throw new Error('Clues must be JSON'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Clues must be a JSON object');
  const src = parsed as Record<string, unknown>;
  for (const key of Object.keys(src)) {
    if (!(CLUE_KEYS as readonly string[]).includes(key)) throw new Error(`Unknown clue: ${key}`);
  }
  const out: Record<string, unknown> = {};
  for (const key of ['breached_password', 'new_device', 'new_network'] as const) {
    if (src[key] === undefined) continue;
    if (typeof src[key] !== 'boolean') throw new Error(`${key} must be true or false`);
    out[key] = src[key];
  }
  if (src.ip_abuse_score !== undefined) {
    const n = src.ip_abuse_score;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 100) throw new Error('ip_abuse_score must be 0-100');
    out.ip_abuse_score = n;
  }
  if (src.network_owner !== undefined) {
    if (typeof src.network_owner !== 'string' || src.network_owner.length > 120) throw new Error('network_owner must be text up to 120 characters');
    out.network_owner = src.network_owner;
  }
  if (src.country !== undefined) {
    // Country only: a two-letter code. No city, coordinates or postcode.
    if (typeof src.country !== 'string' || !/^[A-Z]{2}$/.test(src.country)) throw new Error('country must be a two-letter code');
    out.country = src.country;
  }
  return JSON.stringify(out);
}

export interface AutoFixInput {
  queue: string;
  severity: string;
  proposedAction: string;
  rule: { enabled: boolean; allowed_action: string } | undefined;
}

/**
 * The only path to an automatic fix: a low-severity finding in the low-severity
 * queue, naming an enabled admin rule whose single allowed action is exactly
 * the proposed one. Returns the reason it was refused, or null if allowed.
 */
export function autoFixRefusal(i: AutoFixInput): string | null {
  if (i.queue !== 'low_severity') return 'Only low-severity queue findings can be fixed automatically';
  if (i.severity !== 'low') return 'Only low-severity findings can be fixed automatically';
  if (!i.rule) return 'No such low-severity rule';
  if (!i.rule.enabled) return 'That low-severity rule is turned off';
  if (i.rule.allowed_action !== i.proposedAction) return "The proposed action is not the rule's allowed action";
  return null;
}
