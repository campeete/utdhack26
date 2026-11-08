// IP lookups Nora uses as clues: AbuseIPDB (how often an IP is reported for abuse)
// and IPinfo Lite (which network owns it, and its country).
//
// Keys come from the server's environment only. A lookup that fails, times out or
// has no key returns nothing: a missing clue never stops Nora from writing a finding.
// Error messages never include a key or a full response.

import type { Fetch } from '../nemotron/client.ts';

export interface IpFacts {
  abuseScore?: number; // 0-100, AbuseIPDB confidence of abuse
  networkOwner?: string; // e.g. "Example Hosting LLC"
  country?: string; // two-letter code only, never a city or coordinates
}

export interface EnrichConfig {
  abuseIpDbKey?: string;
  ipInfoToken?: string;
  timeoutMs: number;
}

export function enrichConfigFromEnv(env: Record<string, string | undefined> = process.env): EnrichConfig {
  return {
    abuseIpDbKey: env.ABUSEIPDB_API_KEY?.trim() || undefined,
    ipInfoToken: env.IPINFO_TOKEN?.trim() || undefined,
    timeoutMs: Number(env.LOOKUP_TIMEOUT_MS) > 0 ? Number(env.LOOKUP_TIMEOUT_MS) : 5000,
  };
}

/**
 * True for addresses a public lookup can say nothing about: private, loopback,
 * link-local, carrier NAT, and the documentation ranges used in seeded demo data.
 */
export function isPublicIp(ip: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) {
    const [a, b, c] = v4.slice(1, 4).map(Number);
    if (a === 10 || a === 127 || a === 0 || a >= 224) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 169 && b === 254) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if ((a === 192 && b === 0 && c === 2) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113)) return false;
    return true;
  }
  const lower = ip.toLowerCase();
  if (!lower.includes(':')) return false;
  return !(lower === '::1' || lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('2001:db8:'));
}

async function getJson(url: string, headers: Record<string, string>, timeoutMs: number, fetchImpl: Fetch): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { headers: { Accept: 'application/json', ...headers }, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export interface Enricher {
  lookup(ip: string): Promise<IpFacts>;
}

/** Looks each IP up once per run and remembers the answer (AbuseIPDB allows 1,000 checks a day). */
export function createEnricher(config: EnrichConfig, fetchImpl: Fetch = fetch, log: (msg: string) => void = () => {}): Enricher {
  const cache = new Map<string, Promise<IpFacts>>();

  async function abuse(ip: string): Promise<number | undefined> {
    if (!config.abuseIpDbKey) return undefined;
    try {
      const body = await getJson(
        `https://api.abuseipdb.com/api/v2/check?ipAddress=${encodeURIComponent(ip)}&maxAgeInDays=90`,
        { Key: config.abuseIpDbKey }, config.timeoutMs, fetchImpl,
      ) as { data?: { abuseConfidenceScore?: unknown } };
      const n = body.data?.abuseConfidenceScore;
      return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 100 ? n : undefined;
    } catch (e) {
      log(`AbuseIPDB lookup failed (${(e as Error).message}); continuing without it.`);
      return undefined;
    }
  }

  async function ipinfo(ip: string): Promise<Pick<IpFacts, 'networkOwner' | 'country'>> {
    if (!config.ipInfoToken) return {};
    try {
      const body = await getJson(
        `https://api.ipinfo.io/lite/${encodeURIComponent(ip)}`,
        { Authorization: `Bearer ${config.ipInfoToken}` }, config.timeoutMs, fetchImpl,
      ) as { as_name?: unknown; country_code?: unknown };
      const out: Pick<IpFacts, 'networkOwner' | 'country'> = {};
      if (typeof body.as_name === 'string' && body.as_name.trim()) out.networkOwner = body.as_name.trim().slice(0, 120);
      if (typeof body.country_code === 'string' && /^[A-Z]{2}$/.test(body.country_code)) out.country = body.country_code;
      return out;
    } catch (e) {
      log(`IPinfo lookup failed (${(e as Error).message}); continuing without it.`);
      return {};
    }
  }

  return {
    lookup(ip: string) {
      if (!isPublicIp(ip)) return Promise.resolve({});
      let hit = cache.get(ip);
      if (!hit) {
        hit = Promise.all([abuse(ip), ipinfo(ip)]).then(([abuseScore, info]) => ({
          ...(abuseScore === undefined ? {} : { abuseScore }), ...info,
        }));
        cache.set(ip, hit);
      }
      return hit;
    },
  };
}
