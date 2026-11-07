import { useId, useState } from 'react';
import { ChevronDown, Send, ShieldOff } from 'lucide-react';
import type { Briefing as BriefingRecord, Snapshot } from '../../shared/contracts';
import type { IncidentData } from '../data/interface';
import { label, Status, utc } from '../components/ui';

export function Activity({ data }: { data: Snapshot }) {
  return <section className="activity" aria-label="Incident activity"><ol>{data.activity.map(a => <li key={a.id}><time>{utc(a.at)} UTC</time><div><p>{a.text}</p><small>{a.actor}</small></div></li>)}</ol></section>;
}
export function Briefing({ briefing }: { briefing: BriefingRecord }) {
  return <><div className="briefing-heading"><h3>{briefing.title}</h3></div>{briefing.state === 'outdated' && <p className="notice">A supporting decision needs review. Verify this briefing before sharing.</p>}<p className="briefing-copy">{briefing.text}</p><small className="muted">Depends on {briefing.decisionIds.join(', ')} · Original text retained</small></>;
}
export function Scope({ data }: { data: Snapshot }) {
  return <section className="scope-section"><p className="scope-notice">Encryption and exfiltration are separate findings. “Not observed” is not proof of absence.</p><div className="table-scroll" tabIndex={0} role="region" aria-label="Scrollable affected systems table"><table><caption className="sr-only">Affected systems and data scope</caption><thead><tr><th>System / data</th><th>Affected extent</th><th>Encryption</th><th>Exfiltration</th><th>Owner</th></tr></thead><tbody>{data.scope.map(s => <tr key={s.id}><td><strong>{s.system}</strong><small>{s.data}</small></td><td>{s.extent}</td><td><Status value={s.encryption} /></td><td><Status value={s.exfiltration} /></td><td>{s.owner}</td></tr>)}</tbody></table></div><small className="integration-note">Synthetic scope records · Updates and evidence linking await backend integration.</small></section>;
}
export function Administration({ data }: { data: Snapshot }) {
  return <><div className="access-notice"><ShieldOff size={22} /><div><h3>Access controls are not connected.</h3><p>These are synthetic memberships. Sign-in, admission, and revocation are unavailable in fixture mode.</p></div></div><div className="member-list">{data.members.map(m => <div className="member" key={m.id}><span className="avatar">{m.name.split(' ').map(s => s[0]).join('')}</span><div><strong>{m.name}</strong><small>{m.roles.map(label).join(', ')}</small></div><span className="routine-text">{m.active ? 'Active fixture' : 'Inactive fixture'}</span></div>)}</div><details className="context-details"><summary><span>Integration boundary</span><ChevronDown size={16} /></summary><div className="detail-content"><p>Spacetime stores membership privately. Its live read gate remains closed until independent identity, authorized reads, and subscription revocation pass verification.</p><p>Administrator membership does not grant decision approval authority.</p></div></details></>;
}
export function IncidentConversation({ evidenceId, data, adapter, onUpdate }: { evidenceId: string; data: Snapshot; adapter: IncidentData; onUpdate: (data: Snapshot) => void }) {
  const id = useId();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const messages = data.messages.filter(message => message.evidenceId === evidenceId);
  const evidence = data.evidence.find(item => item.id === evidenceId);
  return <section className="chat change-conversation" aria-labelledby={`${id}-heading`}>
    <div className="section-heading"><h3 id={`${id}-heading`}>Change discussion</h3><span className="local-label">Linked to {evidenceId}</span></div>
    <p className="conversation-note">Messages here are attached to “{evidence?.title ?? evidenceId}” and stay separate from other changes.</p>
    <div className="messages" role="log" aria-live="polite">{messages.length ? messages.map(m => <article key={m.id}><div><strong>{m.author}</strong><time>{utc(m.at)} UTC</time></div><p>{m.text}</p></article>) : <p className="empty">No messages on this change yet.</p>}</div>
    <form onSubmit={async e => { e.preventDefault(); if (busy) return; setBusy(true); setError(''); try { onUpdate(await adapter.sendMessage(evidenceId, text)); setText(''); } catch (err) { setError((err as Error).message); } finally { setBusy(false); } }} aria-busy={busy}>
      <label htmlFor={`${id}-message`}>Send a message</label>
      <textarea id={`${id}-message`} required maxLength={2000} rows={3} value={text} onChange={e => setText(e.target.value)} placeholder="Add context to this change…" />
      <div className="chat-actions"><small className="muted">Local demo · Threaded under {evidenceId}</small><button className="primary" disabled={busy || !text.trim()}>{busy ? 'Sending…' : 'Send message'}<Send size={16} /></button></div>
      {error && <p role="alert" className="error">{error}</p>}
    </form>
  </section>;
}
