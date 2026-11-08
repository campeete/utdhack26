// Validates and trims the two downloaded threat-intel files. A file that fails
// these checks is never saved, so Nora cannot be fed a truncated or swapped download.

export const KEV_URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';
export const ATTACK_URL = 'https://raw.githubusercontent.com/mitre-attack/attack-stix-data/master/enterprise-attack/enterprise-attack.json';

export interface KevEntry { cveID: string; vendorProject: string; product: string; vulnerabilityName: string; dateAdded: string; knownRansomwareCampaignUse: string }
export interface Technique { id: string; name: string; tactics: string[]; url: string }

const CVE = /^CVE-\d{4}-\d{4,}$/;
const TECHNIQUE = /^T\d{4}(\.\d{3})?$/;

/** CISA KEV: keeps only the fields Nora uses. Throws unless it looks like the real catalogue. */
export function parseKev(raw: unknown): KevEntry[] {
  const v = (raw as { vulnerabilities?: unknown })?.vulnerabilities;
  if (!Array.isArray(v) || v.length < 100) throw new Error('CISA KEV file is missing its vulnerability list or is suspiciously short.');
  const entries = v.flatMap(e => {
    const r = e as Record<string, unknown>;
    if (typeof r.cveID !== 'string' || !CVE.test(r.cveID)) return [];
    const s = (k: string) => typeof r[k] === 'string' ? r[k] as string : '';
    return [{ cveID: r.cveID, vendorProject: s('vendorProject'), product: s('product'), vulnerabilityName: s('vulnerabilityName'), dateAdded: s('dateAdded'), knownRansomwareCampaignUse: s('knownRansomwareCampaignUse') }];
  });
  if (entries.length < v.length * 0.95) throw new Error('Too many CISA KEV entries are malformed.');
  return entries;
}

/** MITRE ATT&CK STIX bundle: keeps current techniques as id, name, tactics and link. */
export function parseAttack(raw: unknown): Technique[] {
  const b = raw as { type?: unknown; objects?: unknown };
  if (b?.type !== 'bundle' || !Array.isArray(b.objects)) throw new Error('ATT&CK file is not a STIX bundle.');
  const techniques = b.objects.flatMap(o => {
    const r = o as Record<string, unknown>;
    if (r.type !== 'attack-pattern' || r.revoked === true || r.x_mitre_deprecated === true) return [];
    const ref = (Array.isArray(r.external_references) ? r.external_references : []).find(x => (x as Record<string, unknown>).source_name === 'mitre-attack') as Record<string, unknown> | undefined;
    const id = ref?.external_id;
    if (typeof id !== 'string' || !TECHNIQUE.test(id) || typeof r.name !== 'string') return [];
    const tactics = (Array.isArray(r.kill_chain_phases) ? r.kill_chain_phases : [])
      .filter(p => (p as Record<string, unknown>).kill_chain_name === 'mitre-attack')
      .map(p => String((p as Record<string, unknown>).phase_name));
    return [{ id, name: r.name, tactics, url: typeof ref?.url === 'string' ? ref.url : '' }];
  });
  if (techniques.length < 200) throw new Error('ATT&CK file has far fewer techniques than expected.');
  return techniques.sort((a, b) => a.id.localeCompare(b.id));
}
