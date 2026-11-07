import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CircleDot, Info, Layers2, Settings2, WifiOff } from 'lucide-react';
import type { Snapshot } from '../shared/contracts';
import type { IncidentData } from './data/interface';
import { Modal } from './components/ui';
import { Decisions, type Selection } from './features/Decisions';
import { Administration, Scope, TeamChat } from './features/IncidentPages';

type View = 'workspace' | 'scope' | 'communications';
const views: { id: View; label: string }[] = [
  { id: 'workspace', label: 'Workspace' }, { id: 'scope', label: 'Scope' }, { id: 'communications', label: 'Communications' },
];
export default function App({ adapter }: { adapter: IncidentData }) {
  const [view, setView] = useState<View>('workspace');
  const [data, setData] = useState<Snapshot | null>(null);
  const [selection, setSelection] = useState<Selection>({ evidenceId: null, decisionId: null });
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [message, setMessage] = useState('');
  const [adminOpen, setAdminOpen] = useState(false);
  const scrollPositions = useRef<Record<View, number>>({ workspace: 0, scope: 0, communications: 0 });
  useLayoutEffect(() => {
    // Restore only after the target panel is visible and has its final height.
    window.scrollTo({ top: scrollPositions.current[view], behavior: 'auto' });
  }, [view]);
  useEffect(() => {
    let active = true;
    setError('');
    adapter.load().then(next => {
      if (!active) return;
      setData(next);
      const first = next.evidence.find(e => next.proposals.some(p => p.evidenceId === e.id && p.state === 'pending')) ?? next.evidence[0];
      const decision = next.decisions.find(d => first && d.evidenceIds.includes(first.id));
      setSelection({ evidenceId: first?.id ?? null, decisionId: decision?.id ?? null });
    }).catch(e => { if (active) setError((e as Error).message); });
    return () => { active = false; };
  }, [adapter, retry]);
  function update(next: Snapshot) {
    setData(next);
    setMessage(adapter.mode === 'fixture' ? 'Local fixture updated. Changes last until reload.' : 'Workspace updated.');
  }
  function switchView(next: View) {
    if (next === view) return;
    scrollPositions.current[view] = window.scrollY;
    setView(next);
  }
  return <div className="app-shell">
    <a className="skip-link" href="#main">Skip to workspace</a>
    <div className="persistent-header">
    <header className="app-header">
      <a className="brand" href="#main" onClick={() => switchView('workspace')} aria-label="Clean Room workspace"><Layers2 size={26} /><span>Clean Room</span></a>
      <div className="header-incident"><strong>{data?.incident.title ?? 'Incident workspace'}</strong><span><CircleDot size={12} />{data?.incident.status ?? 'Opening'}<span className="severity-dot" />{data?.incident.severity ?? '—'} severity</span></div>
      <nav aria-label="Incident views">{views.map(item => <button key={item.id} onClick={() => switchView(item.id)} aria-current={view === item.id ? 'page' : undefined}>{item.label}</button>)}</nav>
      <button className="admin-button" aria-label="Administration" onClick={() => setAdminOpen(true)}><Settings2 size={17} /><span>Administration</span></button>
    </header>
    <div className="environment-bar"><div><Info size={15} /><span>{adapter.mode === 'fixture' ? 'Synthetic training incident' : 'Incident workspace'}</span><span className="environment-divider" /><span className="connection"><WifiOff size={14} />{adapter.mode === 'fixture' ? 'No live connection' : 'Connection status unavailable'}</span></div><span>{adapter.mode === 'fixture' ? 'Morgan Patel · Analyst fixture' : 'Access status requires integration'}</span></div>
    </div>
    {data ? <main id="main" tabIndex={-1}>
      <p className="sr-only" role="status">{message}</p>
      <section className="view" hidden={view !== 'workspace'} aria-label="Incident workspace"><Decisions data={data} adapter={adapter} onUpdate={update} selection={selection} onSelect={setSelection} /></section>
      <section className="view secondary-view" hidden={view !== 'scope'} aria-label="Incident scope"><div className="view-heading"><h1>Scope of the incident</h1><p>What is affected, and what remains uncertain.</p></div><Scope data={data} /></section>
      <section className="view secondary-view" hidden={view !== 'communications'} aria-label="Incident communications"><div className="view-heading"><h1>Keep the response connected.</h1><p>Briefings and conversations for {data.incident.title}.</p></div><TeamChat data={data} adapter={adapter} onUpdate={update} /></section>
      <footer><span>{data.incident.summary} <span className="footer-dot">·</span> Commander: {data.incident.commander}</span><span>Local fixtures · Authentication, live sync & Nemotron not connected</span></footer>
    </main> : <main id="main" className="loading" aria-live="polite">{error ? <><h1>Couldn’t open the workspace.</h1><p role="alert">{error}</p><button className="primary" onClick={() => setRetry(v => v + 1)}>Try again</button></> : <><h1>Opening the workspace…</h1><p>Loading incident records.</p></>}</main>}
    {adminOpen && <Modal title="Access & administration" onClose={() => setAdminOpen(false)}>{data ? <Administration data={data} /> : <p>Incident membership is unavailable while the workspace loads.</p>}</Modal>}
  </div>;
}
