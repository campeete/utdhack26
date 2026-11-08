import { KeyRound, ShieldAlert, UserRound } from "lucide-react";
import type { Account, Evidence } from "../../shared/contracts";
import { label } from "../components/ui";

/** Accounts a report names, matched by name or job title in the report text. No other link is assumed. */
export function accountsNamedIn(evidence: Evidence | undefined, accounts: Account[] | undefined): Account[] {
  if (!evidence || !accounts?.length) return [];
  const text = evidence.text.toLowerCase();
  return accounts.filter(
    (a) => [a.name, a.jobTitle].some((term) => term.length >= 8 && text.includes(term.toLowerCase())),
  );
}

const when = (iso: string) => new Date(iso).toISOString().replace("T", " ").replace(":00.000Z", " UTC");

export function AccountsNamed({ accounts }: { accounts: Account[] }) {
  if (!accounts.length) return null;
  return (
    <section className="accounts-named" aria-label="Accounts named in this report">
      <h4>
        <KeyRound size={14} aria-hidden="true" />
        {accounts.length === 1 ? "Account named in this report" : `${accounts.length} accounts named in this report`}
      </h4>
      <ul>
        {accounts.map((a) => (
          <li key={a.id} className={a.usedByAttacker ? "hot" : ""}>
            <span className="avatar" aria-hidden="true">{a.privileged ? <ShieldAlert size={15} /> : <UserRound size={15} />}</span>
            <div className="account-main">
              <strong>{a.name}</strong>
              <small>{a.jobTitle} · {a.department} · {a.id}</small>
              <div className="account-tags">
                {a.privileged && <span className="tag warn">Privileged</span>}
                {a.mfa === "none" && <span className="tag warn">No MFA</span>}
                {a.inCredentialLeak && <span className="tag warn">In leaked credentials</span>}
                {a.usedByAttacker && <span className="tag bad">Used by attacker</span>}
                <span className="tag">{label(a.status)}</span>
              </div>
              <small>Last login {when(a.lastLogin)}</small>
            </div>
          </li>
        ))}
      </ul>
      <p className="procedure-note">Matched by name or title in the report text. Account details come from the directory fixture.</p>
    </section>
  );
}
