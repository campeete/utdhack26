import type { Snapshot } from '../../shared/contracts';
export interface IncidentData {
  readonly mode: 'fixture' | 'live';
  load(): Promise<Snapshot>;
  confirm(proposalId: string, reason: string): Promise<Snapshot>;
  dismiss(proposalId: string, reason: string): Promise<Snapshot>;
  sendMessage(text: string): Promise<Snapshot>;
}
