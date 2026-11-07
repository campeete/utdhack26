// End-to-end check against the real NVIDIA API, no database needed:
// dismisses the demo suggestion P-001 with your feedback, sends the request
// to Nemotron, and runs the result through the same rules the server uses.
//
//   npm run nemotron:try -- "Vendor confirmed the backup predates initial access."

import { createFixture } from '../../src/data/fixtures.ts';
import { buildReassessmentRequest, dismissProposal, recordReassessment } from '../../shared/reassessment.ts';
import { configFromEnv } from './client.ts';
import { reassess } from './reassess.ts';

try { process.loadEnvFile('.env'); } catch { /* no .env file: fall back to the shell environment */ }

const feedback = process.argv.slice(2).join(' ').trim() || 'The vendor confirmed the Monday backup was taken before initial access.';
const config = configFromEnv();
const at = new Date().toISOString();
const dismissed = dismissProposal(createFixture(), 'P-001', feedback, 'Demo reviewer', at);
const request = buildReassessmentRequest(dismissed, 'P-001');

console.log(`Model: ${config.model}\nFeedback: ${feedback}\nAsking Nemotron…\n`);
const started = Date.now();
const raw = await reassess(config, request);
const seconds = ((Date.now() - started) / 1000).toFixed(1);
const after = recordReassessment(dismissed, 'P-001', request.requestId, raw, 'Nemotron', new Date().toISOString());
const outcome = after.proposals[0].reassessment!;

console.log(`Raw answer (${seconds} s):\n${JSON.stringify(raw, null, 2)}\n`);
if (outcome.state === 'revised') {
  const revision = after.proposals.find(p => p.id === outcome.revisionId)!;
  console.log(`Result: revised suggestion ${revision.id}, pending human review.\n  Quote: ${revision.excerpt}\n  Why: ${revision.explanation}\n  Check: ${revision.verification}`);
} else if (outcome.state === 'no_further_review') {
  console.log(`Result: no further review suggested. ${outcome.note ?? ''}`);
} else {
  console.log(`Result: failed and would show Retry. ${outcome.error ?? ''}`);
  process.exitCode = 1;
}
