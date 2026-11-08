import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import type {
  Briefing as BriefingRecord,
  Decision,
  Evidence,
  Proposal,
  Snapshot,
} from "../../shared/contracts";
import { Status } from "../components/ui";
import { Activity, Briefing } from "./IncidentPages";
import { EvidenceReport } from "./ReviewDetails";
export type RecordView = "evidence" | "decision" | "briefings" | "activity";
const names: Record<RecordView, string> = {
  evidence: "Evidence",
  decision: "Decision",
  briefings: "Team update",
  activity: "Activity",
};
export function SupportingRecords({
  view,
  data,
  evidence,
  decision,
  proposal,
  briefings,
  onClose,
}: {
  view: RecordView;
  data: Snapshot;
  evidence?: Evidence;
  decision?: Decision;
  proposal?: Proposal;
  briefings: BriefingRecord[];
  onClose: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    heading.current?.focus({ preventScroll: true });
    return () => {
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);
  return (
    <aside
      className="supporting-drawer"
      role="dialog"
      aria-modal="false"
      aria-label="Supporting records"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header>
        <div>
          <span>Supporting records</span>
          <h2 ref={heading} tabIndex={-1}>
            {names[view]}
          </h2>
        </div>
        <button
          className="icon-button"
          aria-label="Close supporting records"
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </header>
      <div
        className="supporting-record-body"
        key={view}
        tabIndex={0}
        role="region"
        aria-label={`${names[view]} record`}
      >
        {view === "evidence" && evidence ? (
          <>
            <h3>{evidence.title}</h3>
            <EvidenceReport evidence={evidence} data={data} />
          </>
        ) : view === "decision" && decision ? (
          <>
            <h3>{decision.title}</h3>
            <Status value={decision.state} />
            <dl className="metadata">
              <dt>Owner</dt>
              <dd>{decision.owner}</dd>
              <dt>Relies on</dt>
              <dd>{decision.assumption}</dd>
              <dt>Original approval</dt>
              <dd>
                {decision.approvedAt
                  ? new Date(decision.approvedAt)
                      .toISOString()
                      .replace("T", " ")
                  : "Draft · not approved"}
              </dd>
              <dt>Record</dt>
              <dd>
                {decision.id} · Version {decision.version}
              </dd>
            </dl>
            <p>{decision.rationale}</p>
            {proposal && (
              <div className="supporting-suggestion">
                <h3>Why a review was suggested</h3>
                <p>{proposal.explanation}</p>
                <small>
                  {proposal.origin === "synthetic"
                    ? "Pre-authored synthetic suggestion. Nemotron analysis is not connected in this browser checkout."
                    : proposal.origin === "nemotron"
                      ? "Suggested by Nora (Nemotron) after investigating the evidence. Requires human review."
                      : "Suggested by a responder."}
                </small>
                <small>
                  {proposal.sourceVersion > 0 ? `Source ${proposal.sourceId} · v${proposal.sourceVersion} / ` : ''}
                  Evidence {proposal.evidenceId} · v{proposal.evidenceVersion}
                </small>
              </div>
            )}
          </>
        ) : view === "briefings" ? (
          <>
            <p className="drawer-explanation">
              A team update is a written incident summary. If its supporting
              decision needs review, the summary is marked Outdated so the team
              knows to check it before sharing.
            </p>
            {briefings.map((b) => (
              <div className="supporting-briefing" key={b.id}>
                <Status value={b.state} />
                <Briefing briefing={b} />
              </div>
            ))}
          </>
        ) : view === "activity" ? (
          <>
            <Activity data={data} />
            <p className="small muted">
              Audit receipts and hashes are not connected to this fixture view.
            </p>
          </>
        ) : (
          <p>No record available for the current selection.</p>
        )}
      </div>
    </aside>
  );
}
