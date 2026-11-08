import { useRef, useState, type RefObject } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  FileText,
  History,
} from "lucide-react";
import type { Snapshot } from "../../shared/contracts";
import type { IncidentData } from "../data/interface";
import type { Selection } from "./Decisions";
import { focusContext, Modal, Status, utc } from "../components/ui";
import { ReviewComposer, type ReviewAction } from "./ReviewDetails";
import { SupportingRecords, type RecordView } from "./SupportingRecords";

type Step = 1 | 2 | 3;
export function IncidentStory({
  data,
  adapter,
  onUpdate,
  selection,
  headingRef,
  onOverview,
}: {
  data: Snapshot;
  adapter: IncidentData;
  onUpdate: (next: Snapshot) => void;
  selection: Selection;
  headingRef: RefObject<HTMLHeadingElement>;
  onOverview: () => void;
}) {
  const evidence = data.evidence.find((e) => e.id === selection.evidenceId);
  const source = data.sources.find((s) => s.id === evidence?.sourceId);
  const decision = data.decisions.find((d) => d.id === selection.decisionId);
  const proposal = data.proposals.find(
    (p) =>
      p.evidenceId === evidence?.id &&
      (!decision || p.decisionVersions[decision.id] !== undefined),
  );
  const task = data.tasks.find(
    (t) => t.proposalId === proposal?.id && t.decisionId === decision?.id,
  );
  const briefings = data.briefings.filter((b) =>
    proposal
      ? Object.prototype.hasOwnProperty.call(proposal.briefingVersions, b.id)
      : decision && b.decisionIds.includes(decision.id),
  );
  const [step, setStep] = useState<Step>(task ? 3 : 1);
  const [record, setRecord] = useState<RecordView | null>(null);
  const [composer, setComposer] = useState<ReviewAction | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
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
  const titles = [
    "Read the update",
    "Review the decision",
    "Independent verification",
  ];
  const summaries = [
    evidence?.title ?? "No report linked",
    decision?.title ?? "No decision linked",
    task ? `Assigned to ${task.owner}` : "No task assigned",
  ];
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
                        ? number === 1
                          ? (source?.label ?? "Original evidence")
                          : number === 2
                            ? "Check the reason behind the recorded decision"
                            : "Human verification, assigned separately"
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
                            {source?.trust === "under_review" && (
                              <Status value="under_review" />
                            )}
                            <span className="procedure-report-time">
                              {evidence.id} · {utc(evidence.recordedAt)} UTC
                            </span>
                          </div>
                          {source?.trust === "under_review" && (
                            <p className="procedure-concern">
                              {source.reason.split(/(?<=[.!?])\s/)[0]}
                            </p>
                          )}
                          <blockquote className="procedure-excerpt">
                            “{proposal?.excerpt ?? evidence.text}”
                          </blockquote>
                          <p className="procedure-note">
                            {source?.trust === "under_review"
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
                          {!!briefings.length && (
                            <button
                              className="procedure-related"
                              onClick={() => setRecord("briefings")}
                            >
                              <FileText size={16} />
                              <span>
                                {briefings.length} team update
                                {briefings.length === 1 ? "" : "s"} use
                                {briefings.length === 1 ? "s" : ""} this
                                decision
                              </span>
                              {briefings.some((b) => b.state === "outdated") ? (
                                <Status value="outdated" />
                              ) : (
                                <ArrowRight size={15} />
                              )}
                            </button>
                          )}
                        </>
                      ) : (
                        <p className="procedure-summary">
                          No decision depends on this report. It does not
                          trigger a decision review.
                        </p>
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
                              onClick={() => setComposer("dismiss")}
                            >
                              Dismiss suggestion
                            </button>
                          </div>
                          <p className="procedure-note">
                            You will review the changes before confirming. No
                            operational action is approved or reversed.
                          </p>
                        </>
                      ) : (
                        <p className="procedure-summary" role="status">
                          {proposal?.state === "dismissed"
                            ? "Suggestion dismissed. Decision and team update unchanged."
                            : proposal?.state === "stale"
                              ? "This suggestion is outdated. Refresh the linked records before reviewing."
                              : "No decision review is currently suggested."}
                        </p>
                      )}
                      {decision && (
                        <button
                          className="text-button procedure-record-link"
                          onClick={() => setRecord("decision")}
                        >
                          Decision record & suggestion details
                        </button>
                      )}
                    </>
                  ) : task ? (
                    <>
                      <p className="procedure-summary task-summary">
                        {task.title}
                      </p>
                      <div className="procedure-assignee">
                        <span className="avatar">
                          {task.owner
                            .split(" ")
                            .map((s) => s[0])
                            .join("")}
                        </span>
                        <span>
                          <strong>{task.owner}</strong>
                          <small>Verification owner</small>
                        </span>
                        <Status value={task.state} />
                      </div>
                      <p className="procedure-note">
                        Task completion awaits backend integration. This
                        assignment does not confirm the evidence is true.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="procedure-summary">
                        {proposal?.state === "dismissed"
                          ? "No verification task was created. The suggestion was dismissed."
                          : "No verification task is assigned yet. A confirmed review request creates one for the decision owner."}
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
          {adapter.mode === "fixture" && (
            <span>Synthetic incident · Local changes last until reload</span>
          )}
        </div>
      </article>
      {record && (
        <SupportingRecords
          view={record}
          data={data}
          evidence={evidence}
          decision={decision}
          proposal={proposal}
          briefings={briefings}
          onChange={setRecord}
          onClose={() => setRecord(null)}
        />
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
