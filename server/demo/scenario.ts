// Builds the demo's Northstar accounts and the seeded weekend of sign-ins from
// demo-data/people.json. Pure and deterministic: the same file gives the same weekend.
//
// Only allow-listed fields are copied. Passwords, hashes, salts, 2FA secrets,
// usernames and emails in the dataset never leave this function.
//
// The weekend (Fri 6 Nov 17:00 to Sun 8 Nov 05:00, Central):
//   - Ordinary staff sign in from their usual device and network: Nora stays quiet.
//   - Each person whose password is in the leak signs in once, normally: Nora flags a
//     low-severity "reset the password" case, which the starter rule lets her fix alone.
//   - Early Saturday the attacker sprays passwords at four accounts (failed sign-ins),
//     then gets in to the systems administrator (NSR-1004) and the backup service
//     account (NSR-SVC-01) with leaked passwords from a machine they have never used.
// All IPs are from documentation ranges, so no real network is implicated.

export interface Person {
  employee_id: string;
  first_name: string;
  last_name: string;
  department: string;
  job_title: string;
  privileged_access: boolean;
  mfa_type: string;
  credential_in_leak: boolean;
  used_by_attacker: boolean;
}

export interface SeedAccount {
  account_ref: string;
  name: string;
  department: string;
  job_title: string;
  privileged: boolean;
  mfa: string;
  in_credential_leak: boolean;
  used_by_attacker: boolean;
  status: string;
  usual_devices: string[];
  usual_networks: string[];
}

export interface SeedLogin {
  account_ref: string;
  occurred_at: Date;
  method: 'password_2fa' | 'password_only';
  outcome: 'success' | 'failed_password' | 'failed_2fa';
  ip: string;
  device_type: string;
  os: string;
  browser: string;
  password_breached: boolean | undefined;
}

export const HQ_NETWORK = '198.51.100.';
export const STORE_NETWORK = '192.0.2.';
export const ATTACKER_IP = '203.0.113.66';
export const ATTACKER_DEVICE = { device_type: 'Desktop', os: 'Linux', browser: 'Firefox' };
const WEEKEND_START = Date.parse('2026-11-06T23:00:00Z'); // Fri 17:00 Central
const WEEKEND_HOURS = 36;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function usualDevice(p: Person) {
  if (p.employee_id.includes('SVC')) return { device_type: 'Server', os: 'Linux', browser: 'backup-agent' };
  if (p.department === 'IT' || p.department === 'Security' || p.department === 'E-commerce') return { device_type: 'Laptop', os: 'macOS', browser: 'Chrome' };
  if (p.department === 'Store Operations' || p.department === 'Warehouse') return { device_type: 'Tablet', os: 'Android', browser: 'Chrome' };
  return { device_type: 'Laptop', os: 'Windows', browser: 'Edge' };
}
const label = (d: { device_type: string; os: string; browser: string }) => `${d.device_type} / ${d.os} / ${d.browser}`;
const networkOf = (p: Person) => (p.department === 'Store Operations' || p.department === 'Warehouse' ? STORE_NETWORK : HQ_NETWORK);
const mfaOf = (p: Person) => (p.mfa_type === 'none' ? 'none' : p.mfa_type.toUpperCase());

export function buildScenario(people: Person[], seed = 2026): { accounts: SeedAccount[]; logins: SeedLogin[] } {
  const rand = rng(seed);
  const at = (hoursIn: number) => new Date(WEEKEND_START + Math.round(hoursIn * 3600_000));

  const accounts: SeedAccount[] = people.map(p => ({
    account_ref: p.employee_id,
    name: `${p.first_name} ${p.last_name}`,
    department: p.department,
    job_title: p.job_title,
    privileged: p.privileged_access,
    mfa: mfaOf(p),
    in_credential_leak: p.credential_in_leak,
    used_by_attacker: p.used_by_attacker,
    status: 'active', // the weekend starts before anyone has responded
    usual_devices: [label(usualDevice(p))],
    usual_networks: [networkOf(p)],
  }));

  const logins: SeedLogin[] = [];
  const normal = (p: Person, hoursIn: number) => {
    const d = usualDevice(p);
    const ip = `${networkOf(p)}${10 + Math.floor(rand() * 200)}`;
    logins.push({
      account_ref: p.employee_id, occurred_at: at(hoursIn), method: p.mfa_type === 'none' ? 'password_only' : 'password_2fa',
      outcome: 'success', ip, ...d, password_breached: p.credential_in_leak,
    });
  };

  for (const p of people) {
    if (p.employee_id.includes('SVC')) {
      normal(p, 8); // nightly backup, Sat 01:00
      normal(p, 32); // Sun 01:00
      continue;
    }
    if (p.used_by_attacker) { normal(p, 1 + rand() * 4); continue; }
    const count = p.credential_in_leak ? 1 : 1 + Math.floor(rand() * 3);
    for (let i = 0; i < count; i++) normal(p, rand() * WEEKEND_HOURS);
  }

  // Saturday 02:30-02:40: password spray from the attacker's machine.
  const sprayTargets = people.filter(p => !p.credential_in_leak && !p.used_by_attacker && !p.employee_id.includes('SVC')).slice(0, 4);
  sprayTargets.forEach((p, i) => logins.push({
    account_ref: p.employee_id, occurred_at: at(9.5 + i * 0.05), method: 'password_only', outcome: 'failed_password',
    ip: ATTACKER_IP, ...ATTACKER_DEVICE, password_breached: undefined,
  }));

  // Saturday 02:43-03:05: the leaked passwords work.
  for (const [i, p] of people.filter(x => x.used_by_attacker).entries()) {
    if (!p.employee_id.includes('SVC')) {
      logins.push({ account_ref: p.employee_id, occurred_at: at(9.72), method: 'password_only', outcome: 'failed_password', ip: ATTACKER_IP, ...ATTACKER_DEVICE, password_breached: undefined });
    }
    logins.push({
      account_ref: p.employee_id, occurred_at: at(9.78 + i * 0.3), method: 'password_only', outcome: 'success',
      ip: ATTACKER_IP, ...ATTACKER_DEVICE, password_breached: true,
    });
  }

  logins.sort((a, b) => a.occurred_at.getTime() - b.occurred_at.getTime());
  return { accounts, logins };
}

/** The low-severity rule the demo starts with: Nora may reset a leaked password on her own. */
export const STARTER_RULE = {
  situation: 'Password found in a breach, but the sign-in came from the usual device and network',
  allowed_action: 'force_password_reset',
};
