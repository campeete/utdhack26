import type { Snapshot } from '../../shared/contracts';
export interface IncidentData {
  readonly mode: 'fixture' | 'live';
  readonly identity: {
    readonly name: string;
    readonly roles: readonly string[];
    readonly authenticated: boolean;
  } | null;
  load(): Promise<Snapshot>;
  resolveDecision(decisionId: string): Promise<Snapshot>;
  confirm(proposalId: string, reason: string): Promise<Snapshot>;
  /**
   * Dismisses a suggestion. Empty or whitespace feedback dismisses without AI.
   * Non-empty feedback also asks the backend for a Nemotron reassessment; the
   * result arrives later through `subscribe`, never from the browser.
   */
  dismiss(proposalId: string, feedback: string): Promise<Snapshot>;
  /** Re-requests a failed reassessment. The dismissal is unaffected. */
  retryReassessment(proposalId: string): Promise<Snapshot>;
  /** Pushes snapshots that change without a local action, such as a finished reassessment. */
  subscribe(listener: (data: Snapshot) => void): () => void;
  sendMessage(evidenceId: string, recipientId: string, text: string): Promise<Snapshot>;
}
