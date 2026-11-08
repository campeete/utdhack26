// Server-side client for NVIDIA's hosted Nemotron API (OpenAI-compatible).
// The API key is read from the environment on the server only. It must never be
// bundled into the browser, logged, or committed.

export interface NemotronConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
  /** Nemotron 3's reasoning mode. Off by default: slower, and we only need the JSON answer. */
  thinking: boolean;
}

// Ultra answered in about 2 s in testing; Super returned 404 on our free endpoint.
export const DEFAULT_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b';
export const DEFAULT_BASE_URL = 'https://integrate.api.nvidia.com/v1';

export function configFromEnv(env: Record<string, string | undefined> = process.env): NemotronConfig {
  const apiKey = env.NVIDIA_API_KEY?.trim();
  if (!apiKey) throw new Error('NVIDIA_API_KEY is not set. Put it in .env on the server; never in the browser or the repo.');
  const baseUrl = (env.NEMOTRON_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');
  if (!baseUrl.startsWith('https://')) throw new Error('NEMOTRON_BASE_URL must use HTTPS so the key is never sent in clear text.');
  return {
    apiKey, baseUrl,
    model: env.NEMOTRON_MODEL?.trim() || DEFAULT_MODEL,
    timeoutMs: Number(env.NEMOTRON_TIMEOUT_MS) > 0 ? Number(env.NEMOTRON_TIMEOUT_MS) : 60_000,
    thinking: env.NEMOTRON_THINKING === 'true',
  };
}

export type Fetch = typeof fetch;

/**
 * Sends one chat request and returns the model's answer parsed as JSON.
 * Throws on timeouts, HTTP errors and answers that contain no JSON object.
 * Error messages never include the key or the request body.
 */
export async function chatJson(config: NemotronConfig, system: string, user: string, fetchImpl: Fetch = fetch): Promise<unknown> {
  // The free endpoint rate-limits bursts (HTTP 429): wait and try again a few times.
  for (let attempt = 0; ; attempt++) {
    try { return await chatJsonOnce(config, system, user, fetchImpl); }
    catch (e) {
      if (!/HTTP 429/.test((e as Error).message) || attempt >= 3) throw e;
      await new Promise(r => setTimeout(r, 1500 * 2 ** attempt));
    }
  }
}

async function chatJsonOnce(config: NemotronConfig, system: string, user: string, fetchImpl: Fetch): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        temperature: 0.2, top_p: 0.95, max_tokens: 2048, stream: false,
        chat_template_kwargs: { enable_thinking: config.thinking },
      }),
    });
  } catch (e) {
    throw new Error(controller.signal.aborted ? `Nemotron did not answer within ${Math.round(config.timeoutMs / 1000)} s.` : `Could not reach Nemotron: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`Nemotron request failed with HTTP ${response.status}${response.status === 401 || response.status === 403 ? ' (check NVIDIA_API_KEY)' : response.status === 429 ? ' (rate limited, try again shortly)' : ''}.`);
  const body = await response.json() as { choices?: { message?: { content?: string | null } }[] };
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('Nemotron returned an empty answer.');
  return extractJson(content);
}

/** Pulls the JSON object out of an answer, ignoring any reasoning text or code fences around it. */
export function extractJson(content: string): unknown {
  const cleaned = content.replace(/<think>[\s\S]*?<\/think>/g, '');
  const start = cleaned.indexOf('{'); const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Nemotron did not return JSON.');
  try { return JSON.parse(cleaned.slice(start, end + 1)); }
  catch { throw new Error('Nemotron returned malformed JSON.'); }
}
