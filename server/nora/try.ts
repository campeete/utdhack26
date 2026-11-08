// Shows Nora's triage of one attacker sign-in with the real Nemotron API, without a
// database. Nothing is written anywhere.
//
//   npm run nora:try
//   npm run nora:try -- --ip 185.220.101.1      (a public IP, to see the lookups too)

import { createBrain, loadAttackIds } from './brain.ts';
import { createEnricher, enrichConfigFromEnv } from './enrich.ts';
import { attentionReasons, computeClues, FINDING_SYSTEM_PROMPT, findingPrompt, parseFinding, severityFloor, type AccountFacts, type LoginFacts, type TriageInput } from './triage.ts';

try { process.loadEnvFile('.env'); } catch { /* use the shell environment */ }

const ipArg = process.argv.indexOf('--ip');
const ip = ipArg > 0 ? process.argv[ipArg + 1] : '203.0.113.66';

// Invented data: the systems administrator whose leaked password the attacker uses.
const account: AccountFacts = {
  accountRef: 'NSR-1004', name: 'Carolyn Hawkins', department: 'IT', jobTitle: 'Systems Administrator',
  privileged: true, mfa: 'none', inCredentialLeak: true, status: 'active',
  usualDevices: ['Laptop / Windows / Edge'], usualNetworks: ['198.51.100.'],
};
const login: LoginFacts = {
  id: 1n, incidentId: 1n, method: 'password_only', outcome: 'success', ip,
  deviceType: 'Phone', os: 'iOS', browser: 'Safari', passwordBreached: true, origin: 'live_phone',
};

const brain = createBrain();
const attackIds = await loadAttackIds();
const facts = await createEnricher(enrichConfigFromEnv(), fetch, console.log).lookup(ip);
const clues = computeClues(login, account, facts);
const input: TriageInput = {
  login, account, clues, reasons: attentionReasons(login, account, clues),
  rules: [{ id: 1n, situation: 'Known device, new network, MFA passed', allowedAction: 'force_password_reset', enabled: true }],
  memory: [],
};

console.log(`Model: ${brain.model}\nSign-in: ${account.accountRef} from ${ip}, ${login.method}, ${login.deviceType}/${login.os}/${login.browser}`);
console.log(`Clues: ${JSON.stringify(clues)}\nFlagged because: ${input.reasons.join('; ')}\nSeverity floor from the facts: ${severityFloor(login, account, clues)}\nAsking Nora (Nemotron)...\n`);
const started = Date.now();
const raw = await brain.finding(FINDING_SYSTEM_PROMPT, findingPrompt(input));
console.log(`Raw answer (${((Date.now() - started) / 1000).toFixed(1)} s):\n${JSON.stringify(raw, null, 2)}\n`);
const draft = parseFinding(raw, input, attackIds, brain.model);
console.log(`Finding Nora would write (after hard rules):\n${JSON.stringify(draft, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2)}`);
