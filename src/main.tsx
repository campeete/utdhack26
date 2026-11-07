import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import { createFixtureAdapter } from './data/fixture-adapter';

// Explicit single mode. No anonymous backend connection or mock-to-live fallback.
const data = createFixtureAdapter();
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App adapter={data} /></React.StrictMode>);
