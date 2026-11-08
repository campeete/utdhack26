import { useRef, useState, type RefObject } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  FileText,
  GitBranch,
  History,
  Sparkles,
} from "lucide-react";
import type { EvidenceReview, Proposal, Snapshot } from "../../shared/contracts";
import type { IncidentData } from "../data/interface";
import type { Selection } from "./Decisions";
import { focusContext, localTime, Modal, Status } from "../components/ui";
import { ReviewComposer, type ReviewAction } from "./ReviewDetails";
import { SupportingRecords, type RecordView } from "./SupportingRecords";
import { proposalForEvidence } from "../../shared/reassessment";
import { DismissalRecord, DismissDialog } from "./DismissDialog";
import { DecisionTrail, TeamUpdates } from "./DecisionContext";
import { AccountsNamed, accountsNamedIn } from "./AccountContext";
import { DecisionActions, DecisionTasks } from "./TeamActions";

type Step = 1 | 2 | 3;
export function IncidentStory({
  data,
  adapter,
  onUpdate,
  selection,
  headingRef,
  onOverview,
  onSelectProposal,
  onDiscuss,
}: {
  data: Snapshot;
  adapter: IncidentData;
  onUpdate: (next: Snapshot) => void;
  selection: Selection;
  headingRef: RefObject<HTMLHeadingElement>;
  onOverview: () => void;
  /** Shows a specific suggestion, such as Nora (Nemotron)'s revision or the original it revises. */
  onSelectProposal: (proposalId: string) => void;
  /** Hands a drafted message to the discussion below. */
  onDiscuss: (text: string) => void;
}) {
  const evidence = data.evidence.find((e) => e.id === selection.evidenceId);
  const source = data.sources.find((s) => s.id === evidence?.sourceId);
  const decision = data.decisions.find((d) => d.id === selection.decisionId);
  // An explicitly opened suggestion wins; otherwise an open one, then the newest
  // (so Nora (Nemotron)'s revision shows after a dismissal with feedback).
  const selectedProposal =
    (selection.proposalId
      ? data.proposals.find(
          (p) => p.id === selection.proposalId && p.evidenceId === evidence?.id,
        )
      : undefined) ?? proposalForEvidence(data, evidence?.id, decision?.id);
  const proposal = decision?.state === "closed" && selectedProposal?.state === "pending"
    ? undefined
    : selectedProposal;
  const task =
    data.tasks.find((t) => t.proposalId === proposal?.id && t.decisionId === decision?.id) ??
    data.tasks.find((t) => t.decisionId === decision?.id && t.state !== "resolved") ??
    data.tasks.find((t) => t.decisionId === decision?.id);
  const briefings = data.briefings.filter((b) =>
    proposal
      ? Object.prototype.hasOwnProperty.call(proposal.briefingVersions, b.id)
      : decision && b.decisionIds.includes(decision.id),
  );
  // Nora (Nemotron)'s verdict on this evidence, or the newest one she reached about this decision.
  const reviews = data.evidenceReviews ?? [];
  const noraReview =
    reviews.find(
      (r) => r.evidenceId === evidence?.id && (!decision || !r.decisionId || r.decisionId === decision.id),
    ) ??
    (decision
      ? [...reviews].filter((r) => r.decisionId === decision.id).sort((a, b) => (a.at < b.at ? 1 : -1))[0]
      : undefined);
  const noraProposal =
    proposal?.origin === "nemotron"
      ? proposal
      : data.proposals.find((p) => p.id === noraReview?.proposalId);
  const [step, setStep] = useState<Step>(task ? 3 : 1);
  const [record, setRecord] = useState<RecordView | null>(null);
  const [composer, setComposer] = useState<ReviewAction | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [dismissOpen, setDismissOpen] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState("");
  const [resolveConfirmOpen, setResolveConfirmOpen] = useState(false);
  const [detail, setDetail] = useState<"trail" | "updates" | null>(null);
  const stepHeadings = useRef<(HTMLButtonElement | null)[]>([]);
  function showStep(next: Step) {
    setStep(next);
    requestAnimationFrame(() => focusContext(stepHeadings.current[next - 1]));
  }
  function finish(next: Snapshot) {
    onUpdate(next);
    setReviewBusy(false);
    setComposer(null);
    showStep(next.tasks.some((t) => t.proposalId === proposal?.id) ? 3 : 2);
  }
  async function resolve(): Promise<boolean> {
    if (!decision || decision.state === "closed" || resolving) return false;
    setResolving(true);
    setResolveError("");
    try {
      onUpdate(await adapter.resolveDecision(decision.id));
      return true;
    } catch (error) {
      setResolveError((error as Error).message);
      return false;
    } finally {
      setResolving(false);
    }
  }
  const titles = [
    "Read the update",
    "Review the decision",
    "Independent verification",
  ];
  const purposes = [
    `What came in from ${source?.label ?? "the original source"}, and how far to trust it`,
    "Does the recorded decision still hold, given this evidence?",
    "A named person, not the analysis, confirms the facts",
  ];
  const summaries = [
    evidence?.title ?? "No report linked",
    decision?.title ?? "No decision linked",
    task ? `Assigned to ${task.owner}` : "No task assigned",
  ];
  if (!evidence && !decision) {
    return (
      <article className="review-panel workflow-workbench" aria-label="Getting started">
        <header className="workbench-header"><div><h1 ref={headingRef} tabIndex={-1}>Nothing to review yet</h1></div></header>
        <p className="procedure-summary">Every issue starts as a decision. Press <strong>Record a decision</strong> on the left (for example “Restore the portal from Monday’s backup”, resting on “Monday’s backup predates the intrusion”), or <strong>Add evidence</strong>. The issue opens here with its own discussion, and Nora (Nemotron) reviews new evidence against it.</p>
      </article>
    );
  }
  return (
    <>
      <article
        id="selected-update"
        className="review-panel workflow-workbench"
        aria-label="Evidence review"
      >
        <header className="workbench-header">
          <div>
            <h1 ref={headingRef} tabIndex={-1}>
              {decision?.title ?? evidence?.title ?? "Select an update"}
            </h1>
          </div>
          <button className="text-button" onClick={onOverview}>
            Overview
          </button>
        </header>
        <ol className="response-procedure" aria-label="Review workflow steps">
          {([1, 2, 3] as Step[]).map((number) => (
            <li
              className={`procedure-step ${step === number ? "active" : ""}`}
              key={number}
            >
              <span
                className={`procedure-marker ${number === 3 && task ? "assigned" : ""}`}
              >
                {number === 3 && task?.state === "resolved" ? (
                  <Check size={15} />
                ) : (
                  number
                )}
              </span>
              <div className="procedure-step-content">
                <button
                  ref={(el) => {
                    stepHeadings.current[number - 1] = el;
                  }}
                  className="procedure-heading"
                  aria-current={step === number ? "step" : undefined}
                  aria-expanded={step === number}
                  aria-controls={`procedure-panel-${number}`}
                  onClick={() => setStep(number)}
                >
                  <span>
                    <strong>{titles[number - 1]}</strong>
                    <small>
                      {step === number
                        ? purposes[number - 1]
                        : summaries[number - 1]}
                    </small>
                  </span>
                  {number === 2 && decision && (
                    <span className="procedure-step-status">
                      <Status value={decision.state} />
                    </span>
                  )}
                  <ChevronDown size={17} />
                </button>
                <div
                  id={`procedure-panel-${number}`}
                  className="procedure-panel"
                  hidden={step !== number}
                >
                  {number === 1 ? (
                    <>
                      {evidence ? (
                        <>
                          <div className="procedure-evidence-meta">
                            <Status value={evidence.standing} />
                            {decision?.state !== "closed" && source?.trust === "under_review" && (
                              <Status value="under_review" />
                            )}
                            <span className="procedure-report-time">
                              {evidence.id} · {localTime(evidence.recordedAt)}
                            </span>
                          </div>
                          {decision?.state !== "closed" && source?.trust === "under_review" && (
                            <p className="procedure-concern">
                              {source.reason.split(/(?<=[.!?])\s/)[0]}
                            </p>
                          )}
                          <blockquote className="procedure-excerpt">
                            “{proposal?.excerpt ?? evidence.text}”
                          </blockquote>
                          <AccountsNamed accounts={accountsNamedIn(evidence, data.accounts)} />
                          <p className="procedure-note">
                            {decision?.state !== "closed" && source?.trust === "under_review"
                              ? "Source trust is under review. The report has not been declared false."
                              : "This is the original report, not a confirmed analysis finding."}
                          </p>
                          <div className="procedure-actions">
                            <button
                              className="primary"
                              onClick={() => showStep(2)}
                            >
                              Continue to decision
                              <ArrowRight size={16} />
                            </button>
                            <button
                              className="text-button"
                              onClick={() => setRecord("evidence")}
                            >
                              Open full report
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="procedure-summary">
                            No evidence is linked to this decision.
                          </p>
                          <button
                            className="secondary"
                            onClick={() => showStep(2)}
                          >
                            View decision
                            <ArrowRight size={16} />
                          </button>
                        </>
                      )}
                    </>
                  ) : number === 2 ? (
                    <>
                      {decision ? (
                        <>
                          <dl className="procedure-decision">
                            <div>
                              <dt>Current decision</dt>
                              <dd>
                                {decision.title}
                                <span className="procedure-owner">
                                  Owner: {decision.owner}
                                </span>
                              </dd>
                            </div>
                            <div>
                              <dt>This relies on</dt>
                              <dd>{decision.assumption}</dd>
                            </div>
                          </dl>
                          <NoraAssessment review={noraReview} proposal={noraProposal} live={adapter.mode === "live"} hasEvidence={!!evidence} currentEvidenceId={evidence?.id} />
                          <DecisionActions decision={decision} data={data} adapter={adapter} onUpdate={onUpdate} />
                          <div className="context-toggles" role="group" aria-label="More about this decision">
                            <button
                              aria-expanded={detail === "trail"}
                              aria-controls="decision-trail"
                              onClick={() => setDetail(detail === "trail" ? null : "trail")}
                            >
                              <GitBranch size={15} />
                              Decision trail
                              {decision?.state !== "closed" && source?.trust === "under_review" && <span className="toggle-flag">Weak link</span>}
                              <ChevronDown size={14} />
                            </button>
                            {!!briefings.length && (
                              <button
                                aria-expanded={detail === "updates"}
                                aria-controls="team-updates"
                                onClick={() => setDetail(detail === "updates" ? null : "updates")}
                              >
                                <FileText size={15} />
                                {briefings.length === 1 ? "Team update" : `${briefings.length} team updates`}
                                {briefings.some((b) => b.state === "outdated") && <span className="toggle-flag">Outdated</span>}
                                <ChevronDown size={14} />
                              </button>
                            )}
                          </div>
                          {detail === "trail" && (
                            <DecisionTrail data={data} source={source} evidence={evidence} decision={decision} proposal={proposal} briefings={briefings} onDiscuss={onDiscuss} />
                          )}
                          {detail === "updates" && (
                            <TeamUpdates briefings={briefings} proposal={proposal} onDiscuss={onDiscuss} />
                          )}
                        </>
                      ) : (
                        <>
                          <NoraAssessment review={noraReview} proposal={noraProposal} live={adapter.mode === "live"} hasEvidence={!!evidence} currentEvidenceId={evidence?.id} />
                        <p className="procedure-summary">
                          No decision depends on this report. It does not
                          trigger a decision review.
                        </p>
                        </>
                      )}
                      {task ? (
                        <>
                          <p className="procedure-summary">
                            A review has been requested. Independent
                            verification is assigned to {task.owner}.
                          </p>
                          <button
                            className="primary"
                            onClick={() => showStep(3)}
                          >
                            View next action
                            <ArrowRight size={16} />
                          </button>
                        </>
                      ) : proposal?.state === "pending" ? (
                        <>
                          <p className="procedure-recommendation">
                            <span>Suggested next step</span>
                            {proposal.verification}
                          </p>
                          {proposal.revisionOf && (
                            <p className="procedure-note">
                              Nora (Nemotron) revised this after a reviewer dismissed{" "}
                              <button
                                className="text-button inline"
                                onClick={() => onSelectProposal(proposal.revisionOf!)}
                              >
                                {proposal.revisionOf}
                              </button>
                              . It still needs a human decision.
                            </p>
                          )}
                          <div className="procedure-actions">
                            <button
                              className="primary"
                              onClick={() => setComposer("confirm")}
                            >
                              Request decision review
                              <ArrowRight size={16} />
                            </button>
                            <button
                              className="text-button"
                              onClick={() => setDismissOpen(true)}
                              aria-haspopup="dialog"
                            >
                              Dismiss suggestion
                            </button>
                          </div>
                          <p className="procedure-note">
                            You will review the changes before confirming. No
                            operational action is approved or reversed.
                          </p>
                        </>
                      ) : proposal?.state === "dismissed" ? (
                        <DismissalRecord
                          proposal={proposal}
                          data={data}
                          adapter={adapter}
                          onUpdate={onUpdate}
                          onOpenRevision={onSelectProposal}
                        />
                      ) : (
                        <p className="procedure-summary" role="status">
                          {proposal?.state === "stale"
                              ? "This suggestion is outdated. Refresh the linked records before reviewing."
                              : "No decision review is currently suggested."}
                        </p>
                      )}
                    </>
                  ) : task && decision ? (
                    <>
                      <DecisionTasks decisionId={decision.id} data={data} adapter={adapter} onUpdate={onUpdate} />
                      <p className="procedure-note">
                        Findings are saved as evidence; Nora (Nemotron) checks
                        them against the decision. An assignment does not
                        confirm the evidence is true.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="procedure-summary">
                        {proposal?.state === "dismissed"
                          ? "No verification task was created. The suggestion was dismissed."
                          : "No verification task is assigned yet. A Tier 2 assigns one in Review the decision, or a confirmed review request creates one."}
                      </p>
                      {decision && (
                        <button
                          className="secondary"
                          onClick={() => showStep(2)}
                        >
                          Back to decision review
                          <ArrowRight size={16} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
        <div className="workbench-bottom">
          <button className="text-button" onClick={() => setRecord("activity")}>
            <History size={14} />
            History
          </button>
          {decision && (decision.state === "closed" ? (
            <span className="resolve-complete" role="status">Resolved</span>
          ) : (
            <button
              className="primary"
              onClick={() => {
                if (decision.state === "needs_review" || source?.trust === "under_review" || proposal?.state === "pending") {
                  setResolveConfirmOpen(true);
                } else {
                  void resolve();
                }
              }}
              disabled={resolving}
            >
              Resolve
              <Check size={16} />
            </button>
          ))}
        </div>
        {resolveError && <p className="error" role="alert">{resolveError}</p>}
      </article>
      {record && (
        <SupportingRecords
          view={record}
          data={data}
          evidence={evidence}
          decision={decision}
          proposal={proposal}
          briefings={briefings}
          onClose={() => setRecord(null)}
        />
      )}
      {dismissOpen && proposal?.state === "pending" && (
        <DismissDialog
          proposal={proposal}
          adapter={adapter}
          onClose={() => setDismissOpen(false)}
          onComplete={(next) => {
            onUpdate(next);
            setDismissOpen(false);
            onSelectProposal(proposal.id);
          }}
        />
      )}
      {resolveConfirmOpen && decision && (
        <Modal
          title="Resolve an issue under review?"
          onClose={() => {
            if (!resolving) setResolveConfirmOpen(false);
          }}
          closeDisabled={resolving}
        >
          <div className="dismiss-dialog">
            <p>This issue is still under review. Resolving it will remove it from the active review list, but it does not verify the evidence or clear the source concerns. Are you sure you want to continue?</p>
            {resolveError && <p className="error" role="alert">{resolveError}</p>}
            <div className="action-row">
              <button
                className="primary"
                onClick={async () => {
                  if (await resolve()) setResolveConfirmOpen(false);
                }}
                disabled={resolving}
              >
                {resolving ? "Resolving…" : "Resolve anyway"}
                <Check size={16} />
              </button>
              <button className="secondary" onClick={() => setResolveConfirmOpen(false)} disabled={resolving}>Cancel</button>
            </div>
          </div>
        </Modal>
      )}
      {composer && proposal && (
        <Modal
          title={
            composer === "confirm"
              ? "Confirm review request"
              : "Dismiss suggestion"
          }
          onClose={() => {
            if (!reviewBusy) setComposer(null);
          }}
          closeDisabled={reviewBusy}
        >
          <ReviewComposer
            inDialog
            action={composer}
            proposal={proposal}
            data={data}
            adapter={adapter}
            onBusyChange={setReviewBusy}
            onCancel={() => setComposer(null)}
            onComplete={finish}
          />
        </Modal>
      )}
    </>
  );
}

/** Nora (Nemotron)'s verdict, shown where the decision is reviewed. Advice only: a person decides. */
function NoraAssessment({
  review,
  proposal,
  live,
  hasEvidence,
  currentEvidenceId,
}: {
  currentEvidenceId?: string;
  review?: EvidenceReview;
  proposal?: Proposal;
  live: boolean;
  hasEvidence: boolean;
}) {
  if (!review && !proposal) {
    if (!live || !hasEvidence) return null;
    return (
      <section className="nora-assessment pending" aria-label="Nora (Nemotron) assessment" aria-live="polite">
        <header><Sparkles size={15} aria-hidden="true" /><strong>Nora (Nemotron)</strong><span className="nora-verdict pending">Reviewing…</span></header>
        <p>Nora is reading this evidence against the open decisions. Her verdict appears here in a few seconds.</p>
      </section>
    );
  }
  const outcome = review?.outcome ?? (proposal?.urgent ? "urgent" : "conflict");
  const verdict =
    outcome === "urgent" ? { text: `URGENT · challenges ${review?.decisionId ?? "this decision"}`, tone: "urgent" }
    : outcome === "conflict" ? { text: `Challenges ${review?.decisionId ?? "this decision"}`, tone: "conflict" }
    : outcome === "supports" ? { text: `Supports ${review?.decisionId ?? "this decision"}`, tone: "ok" }
    : outcome === "no_impact" ? { text: "No decision affected", tone: "quiet" }
    : { text: "Could not finish", tone: "quiet" };
  const why = proposal?.explanation || review?.summary;
  return (
    <section className={`nora-assessment ${verdict.tone}`} aria-label="Nora (Nemotron) assessment">
      <header>
        <Sparkles size={15} aria-hidden="true" />
        <strong>Nora (Nemotron)</strong>
        <span className={`nora-verdict ${verdict.tone}`}>{verdict.text}</span>
        {review && review.evidenceId !== currentEvidenceId && <span className="nora-about">about {review.evidenceId}</span>}
        {review && <time dateTime={review.at}>{localTime(review.at)}</time>}
      </header>
      {why && <p>{why}</p>}
      {proposal?.excerpt && (outcome === "conflict" || outcome === "urgent") && (
        <blockquote className="procedure-excerpt">“{proposal.excerpt}”</blockquote>
      )}
      {outcome === "urgent" && <p className="nora-escalate">Nora recommends escalating now and has messaged the incident lead. A person must confirm.</p>}
      {outcome === "supports" && <p className="procedure-note">The findings back the decision. A Tier 2 can re-approve it.</p>}
      {outcome === "failed" && <p className="procedure-note">Nemotron was unavailable or its answer failed the checks. Review this evidence by hand.</p>}
      <p className="procedure-note">Advice only. Nora never changes the plan; a person decides below.</p>
    </section>
  );
}
