import type { IncidentData } from './interface';
import { createFixture } from './fixtures';
import { confirmReview } from '../../shared/review';

export function createFixtureAdapter(): IncidentData {
  let data = createFixture();
  const copy = () => structuredClone(data);
  return {
    mode: 'fixture',
    identity: { name: 'Morgan Patel', roles: ['analyst'], authenticated: false },
    async load() { return copy(); },
    async confirm(id, reason) { data = confirmReview(data, id, reason, 'Morgan Patel (fixture)', new Date().toISOString()); return copy(); },
    async dismiss(id, reason) {
      if (reason.trim().length < 8) throw new Error('Add a reason of at least 8 characters.');
      const p = data.proposals.find(p => p.id === id);
      if (!p || p.state !== 'pending') throw new Error('Proposal is no longer pending.');
      data = { ...data, proposals: data.proposals.map(p => p.id === id ? { ...p, state: 'dismissed', version: p.version + 1 } : p), activity: [{ id: `dismiss:${id}`, incidentId: data.incident.id, version: 1, text: `Proposal dismissed. ${reason}`, actor: 'Morgan Patel (fixture)', at: new Date().toISOString() }, ...data.activity] };
      return copy();
    },
    async sendMessage(evidenceId, text) {
      if (!text.trim() || text.length > 2000) throw new Error('Use 1–2,000 characters.');
      if (!data.evidence.some(e => e.id === evidenceId)) throw new Error('Select an existing evidence item before sending a message.');
      data = { ...data, messages: [...data.messages, { id: crypto.randomUUID(), incidentId: data.incident.id, evidenceId, version: 1, author: 'Morgan Patel (fixture)', text: text.trim(), at: new Date().toISOString() }] };
      return copy();
    },
  };
}
