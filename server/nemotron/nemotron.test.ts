import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixture } from '../../src/data/fixtures.ts';
import { buildReassessmentRequest, dismissProposal, recordReassessment } from '../../shared/reassessment.ts';
import { chatJson, configFromEnv, extractJson, type Fetch } from './client.ts';
import { reassess, reassessUserPrompt } from './reassess.ts';

const config = configFromEnv({ NVIDIA_API_KEY: 'test-key' });
const answer = (content: string, status = 200): Fetch => async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status });
const request = () => {
  const data = dismissProposal(createFixture(), 'P-001', 'Vendor confirmed timing.', 'Reviewer', '2026-11-07T23:40:00Z');
  return { data, request: buildReassessmentRequest(data, 'P-001') };
};

test('config needs a key, defaults to Nemotron 3 Super, and refuses plain HTTP', () => {
  assert.throws(() => configFromEnv({}), /NVIDIA_API_KEY/);
  assert.equal(config.model, 'nvidia/nemotron-3-super-120b-a12b');
  assert.equal(config.thinking, false);
  assert.throws(() => configFromEnv({ NVIDIA_API_KEY: 'k', NEMOTRON_BASE_URL: 'http://example.com' }), /HTTPS/);
});

test('sends a bearer token and the model, and parses JSON out of fences and reasoning', async () => {
  let sent: { url: string; init: RequestInit } | undefined;
  const fetchImpl: Fetch = async (url, init) => { sent = { url: String(url), init: init! }; return answer('<think>hmm</think>```json\n{"kind":"no_further_review","note":"ok"}\n```')(url, init); };
  assert.deepEqual(await chatJson(config, 'sys', 'user', fetchImpl), { kind: 'no_further_review', note: 'ok' });
  assert.equal(sent!.url, 'https://integrate.api.nvidia.com/v1/chat/completions');
  assert.equal((sent!.init.headers as Record<string, string>).Authorization, 'Bearer test-key');
  assert.equal(JSON.parse(String(sent!.init.body)).model, config.model);
});

test('HTTP errors, empty answers and missing JSON become errors without leaking the key', async () => {
  await assert.rejects(chatJson(config, 's', 'u', answer('x', 401)), e => /HTTP 401/.test((e as Error).message) && !(e as Error).message.includes('test-key'));
  await assert.rejects(chatJson(config, 's', 'u', answer('')), /empty/);
  assert.throws(() => extractJson('no json here'), /did not return JSON/);
  assert.throws(() => extractJson('{"kind": }'), /malformed/);
});

test('a timeout is reported as an error', async () => {
  const hang: Fetch = (_url, init) => new Promise((_, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('aborted'))));
  await assert.rejects(chatJson({ ...config, timeoutMs: 20 }, 's', 'u', hang), /did not answer/);
});

test('evidence and feedback go in the user message as data, never in the system prompt', () => {
  const { request: r } = request();
  const prompt = reassessUserPrompt(r);
  assert.match(prompt, /^INPUT JSON:/);
  assert.ok(prompt.includes(r.evidence!.text));
  assert.ok(!prompt.includes('"instructions"'));
});

test('a real-shaped revision flows through to a linked suggestion', async () => {
  const { data, request: r } = request();
  const excerpt = 'The test did not assess whether the backup predates initial access or contains compromised artifacts.';
  const raw = await reassess(config, r, answer(JSON.stringify({ kind: 'revision', excerpt, explanation: 'Timing is still unverified.', verification: 'Check the backup timestamp against first access.' })));
  const next = recordReassessment(data, 'P-001', r.requestId, raw, 'Nemotron', '2026-11-07T23:41:00Z');
  assert.equal(next.proposals[0].reassessment?.state, 'revised');
  assert.equal(next.proposals[1].excerpt, excerpt);
});

test('API failures and invented quotes end as a failed reassessment the reviewer can retry', async () => {
  const { data, request: r } = request();
  for (const fetchImpl of [answer('x', 503), answer(JSON.stringify({ kind: 'revision', excerpt: 'The backup is definitely compromised.', explanation: 'x', verification: 'y' }))]) {
    const raw = await reassess(config, r, fetchImpl);
    const next = recordReassessment(data, 'P-001', r.requestId, raw, 'Nemotron', '2026-11-07T23:41:00Z');
    assert.equal(next.proposals[0].reassessment?.state, 'failed');
    assert.equal(next.proposals[0].state, 'dismissed');
  }
});
