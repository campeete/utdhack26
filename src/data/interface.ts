import type { Role, Snapshot } from '../../shared/contracts';
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

  // ---- Team actions (the module enforces the tier for each) ----
  /** Tier 3: let someone in by the ID their browser shows. */
  admitMember(memberId: string, tier: Role): Promise<Snapshot>;
  /** Tier 3: change someone's tier. */
  setMemberTier(memberId: string, tier: Role): Promise<Snapshot>;
  /** Tier 3: remove someone from the incident. */
  revokeMember(memberId: string): Promise<Snapshot>;
  /** Tier 1: record new evidence. Nora (Nemotron) reads it. */
  addEvidence(input: { title: string; source: string; text: string }): Promise<Snapshot>;
  /** Tier 1: record a proposed decision and the assumption it rests on. */
  recordDecision(input: { title: string; assumption: string; evidenceIds: string[] }): Promise<Snapshot>;
  /** Tier 2: approve a decision. */
  approveDecision(decisionId: string): Promise<Snapshot>;
  /** Tier 2: assign verification work on a decision to a teammate. */
  assignTask(decisionId: string, memberId: string, title: string): Promise<Snapshot>;
  /** The assignee only. */
  acceptTask(taskId: string): Promise<Snapshot>;
  resolveTask(taskId: string): Promise<Snapshot>;
}
