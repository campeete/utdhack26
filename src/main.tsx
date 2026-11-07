import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import { createFixtureAdapter, failOnceReassessor, noFurtherReviewReassessor, syntheticReassessor } from './data/fixture-adapter';

// Explicit single mode. No anonymous backend connection or mock-to-live fallback.
// Demo switch for the synthetic reassessor: ?reassess=none or ?reassess=fail-once.
const mode = new URLSearchParams(location.search).get('reassess');
const data = createFixtureAdapter({ reassess: mode === 'none' ? noFurtherReviewReassessor : mode === 'fail-once' ? failOnceReassessor() : syntheticReassessor });
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App adapter={data} /></React.StrictMode>);
