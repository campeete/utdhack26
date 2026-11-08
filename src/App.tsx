import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CircleDot, Layers2, Moon, Settings2, Sun, UserRound } from 'lucide-react';
import { roleLabel, type Snapshot } from '../shared/contracts';
import type { IncidentData } from './data/interface';
import { label, Modal } from './components/ui';
import { Decisions, type Selection } from './features/Decisions';
import { Scope } from './features/IncidentPages';
import { Monitor } from './features/Monitor';
import { TeamAccess } from './features/TeamActions';

type View = 'workspace' | 'monitor' | 'scope';
const views: { id: View; label: string }[] = [
  { id: 'workspace', label: 'Workspace' }, { id: 'monitor', label: 'Monitor' }, { id: 'scope', label: 'Scope' },
];
export default function App({ adapter }: { adapter: IncidentData }) {
  const [view, setView] = useState<View>('workspace');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [data, setData] = useState<Snapshot | null>(null);
  const [selection, setSelection] = useState<Selection>({ evidenceId: null, decisionId: null });
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [message, setMessage] = useState('');
  const [adminOpen, setAdminOpen] = useState(false);
  const scrollPositions = useRef<Record<View, number>>({ workspace: 0, monitor: 0, scope: 0 });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [theme]);
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
      const decision = next.decisions.find(d => first && d.evidenceIds.includes(first.id)) ?? next.decisions.find(d => d.state !== 'closed');
      setSelection({ evidenceId: first && (!decision || decision.evidenceIds.includes(first.id)) ? first.id : decision?.evidenceIds[0] ?? null, decisionId: decision?.id ?? null });
    }).catch(e => { if (active) setError((e as Error).message); });
    return () => { active = false; };
  }, [adapter, retry]);
  // Results that arrive later, such as a finished Nemotron reassessment.
  useEffect(() => adapter.subscribe(next => { setData(next); setMessage(adapter.mode === 'live' ? 'Workspace updated live.' : 'Reassessment update received.'); }), [adapter]);
  function update(next: Snapshot) {
    setData(next);
    setMessage(adapter.mode === 'fixture' ? 'Local fixture updated. Changes last until reload.' : 'Workspace updated.');
  }
  function switchView(next: View) {
    if (next === view) return;
    scrollPositions.current[view] = window.scrollY;
    setView(next);
  }
  return <div className="app-shell" data-theme={theme}>
    <a className="skip-link" href="#main">Skip to workspace</a>
    <div className="persistent-header">
    <header className="app-header">
      <a className="brand" href="#main" onClick={() => switchView('workspace')} aria-label="Clean Room workspace"><Layers2 size={26} /><span>Clean Room</span></a>
      <div className="header-incident"><strong>{data?.incident.title ?? 'Incident workspace'}</strong><span><CircleDot size={12} />{data ? label(data.incident.status) : 'Opening'}<span className="severity-dot" />{data ? label(data.incident.severity) : '—'} severity</span></div>
      <nav aria-label="Incident views">{views.map(item => <button key={item.id} onClick={() => switchView(item.id)} aria-current={view === item.id ? 'page' : undefined}>{item.label}</button>)}</nav>
      {adapter.identity ? <div className="session-indicator" aria-label={`${adapter.identity.authenticated ? 'Signed in' : 'Demo identity'}: ${adapter.identity.name}, ${adapter.identity.roles.map(roleLabel).join(', ')}`}>
        <span className="session-avatar"><UserRound size={17} /></span>
        <span className="session-copy"><strong>{adapter.identity.name}</strong><small>{adapter.identity.roles.map(roleLabel).join(' · ')}</small></span>
      </div> : <div className="session-indicator"><span className="session-avatar"><UserRound size={17} /></span><span className="session-copy"><strong>No session</strong><small>Identity unavailable</small></span></div>}
      <button className="admin-button" aria-label="Administration" onClick={() => setAdminOpen(true)}><Settings2 size={17} /><span>Administration</span></button>
      <div className="theme-switch" role="group" aria-label="Color theme"><button type="button" aria-pressed={theme === 'light'} onClick={() => setTheme('light')}><Sun size={13} />Light</button><button type="button" aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}><Moon size={13} />Dark</button></div>
    </header>
    </div>
    {data ? <main id="main" tabIndex={-1}>
      <p className="sr-only" role="status">{message}</p>
      <section className="view" hidden={view !== 'workspace'} aria-label="Incident workspace"><Decisions data={data} adapter={adapter} onUpdate={update} selection={selection} onSelect={setSelection} /></section>
      <section className="view secondary-view" hidden={view !== 'monitor'} aria-label="Monitor"><Monitor data={data} adapter={adapter} onUpdate={update} /></section>
      <section className="view secondary-view" hidden={view !== 'scope'} aria-label="Incident scope"><div className="view-heading"><h1>Scope of the incident</h1><p>What is affected, and what remains uncertain.</p></div><Scope data={data} /></section>
      <footer><span>{data.incident.summary} <span className="footer-dot">·</span> Lead: {data.incident.commander}</span><span>{adapter.mode === 'live' ? 'Live · SpacetimeDB · Nora (Nemotron) by NVIDIA' : 'Demo data · Sign-in, live sync and Nora (Nemotron)’s analysis are not connected'}</span></footer>
    </main> : <main id="main" className="loading" aria-live="polite">{error ? <><h1>Couldn’t open the workspace.</h1><p role="alert">{error}</p><button className="primary" onClick={() => setRetry(v => v + 1)}>Try again</button></> : <><h1>Opening the workspace…</h1><p>Loading incident records.</p></>}</main>}
    {adminOpen && <Modal title="Access & administration" onClose={() => setAdminOpen(false)}>{data ? <TeamAccess data={data} adapter={adapter} onUpdate={update} /> : <p>Incident membership is unavailable while the workspace loads.</p>}</Modal>}
  </div>;
}
