import type { Snapshot } from '../../shared/contracts';
export interface IncidentData {
  readonly mode: 'fixture' | 'live';
  /** Live mode: the browser's identity, so an admin can admit it. */
  readonly identityHex?: string;
  readonly identity: {
    readonly name: string;
    readonly roles: readonly string[];
    readonly authenticated: boolean;
  } | null;
  load(): Promise<Snapshot>;
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
  /** Runs the finding's proposed action. Tier 2 and up. */
  approveFinding(findingId: string): Promise<Snapshot>;
  /** Marks a false alarm (Tier 1 and up). Optional feedback is saved to Nora's memory. */
  dismissFinding(findingId: string, feedback: string): Promise<Snapshot>;
  /** Reverses one of Nora's automatic fixes. Tier 2 and up. */
  undoFinding(findingId: string): Promise<Snapshot>;
}
