import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import { createFixtureAdapter, failOnceReassessor, noFurtherReviewReassessor, syntheticReassessor } from './data/fixture-adapter';
import { createLiveAdapter } from './live/live-adapter';

// Explicit single mode, never a silent fallback from live to sample data.
//   Live:    ?data=live (or VITE_DATA_MODE=live). Optional ?as=lead (a separate person per name), ?name=Cameron, ?incident=2, ?fresh=1.
//   Fixture: default. Demo switch for the synthetic reassessor: ?reassess=none or ?reassess=fail-once.
const params = new URLSearchParams(location.search);
const join = params.get('join') ?? undefined;
// An invite link only needs a name: each name is its own person in this browser.
const needsName = join && !params.get('name');
const live = params.get('data') === 'live' || (import.meta.env.VITE_DATA_MODE === 'live' && params.get('data') !== 'fixture');
const mode = params.get('reassess');
const data = live
  ? createLiveAdapter({
    // Same address as the page; vite.config.ts passes /v1 through to SpacetimeDB.
    uri: import.meta.env.VITE_SPACETIME_URI || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`,
    dbName: import.meta.env.VITE_SPACETIME_DB_NAME || 'clean-room',
    incidentId: params.get('incident') ?? undefined,
    freshIdentity: params.get('fresh') === '1',
    joinCode: join,
    displayName: params.get('name') ?? params.get('as') ?? undefined,
    profile: params.get('as') ?? (join ? params.get('name')?.toLowerCase().replace(/[^a-z0-9]+/g, '-') : undefined) ?? undefined,
  })
  : createFixtureAdapter({ reassess: mode === 'none' ? noFurtherReviewReassessor : mode === 'fail-once' ? failOnceReassessor() : syntheticReassessor });
function JoinGate() {
  const [name, setName] = React.useState('');
  return <main id="main" className="loading join-gate">
    <h1>Join the incident</h1>
    <p>You were invited to Clean Room. Enter the name your team will see.</p>
    <form onSubmit={e => { e.preventDefault(); const next = new URLSearchParams(location.search); next.set('name', name.trim()); location.search = next.toString(); }}>
      <label htmlFor="join-name">Your name</label>
      <input id="join-name" autoFocus required maxLength={64} value={name} onChange={e => setName(e.target.value)} placeholder="Sam" />
      <button className="primary" disabled={!name.trim()}>Join</button>
    </form>
  </main>;
}
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode>{needsName ? <JoinGate /> : <App adapter={data} />}</React.StrictMode>);
