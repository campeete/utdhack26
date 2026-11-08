import { useRef, useState, useEffect } from "react";
import { Check } from "lucide-react";
import type { Evidence, Proposal, Snapshot } from "../../shared/contracts";
import type { IncidentData } from "../data/interface";
import { previewImpact } from "../../shared/review";
import { Status } from "../components/ui";
export type ReviewAction = "confirm" | "dismiss";

export function EvidenceReport({
  evidence,
  data,
}: {
  evidence: Evidence;
  data: Snapshot;
}) {
  const source = data.sources.find((s) => s.id === evidence.sourceId);
  return (
    <>
      <p className="report-text">{evidence.text}</p>
      <div className="report-status">
        <Status value={evidence.standing} />
        {source?.trust === "under_review" && <Status value="under_review" />}
      </div>
      <dl className="metadata">
        <dt>Source</dt>
        <dd>{source?.label ?? "Unknown source"}</dd>
        <dt>Event time</dt>
        <dd>
          {new Date(evidence.eventTime)
            .toISOString()
            .replace("T", " ")
            .replace(".000Z", " UTC")}
        </dd>
        <dt>Recorded</dt>
        <dd>
          {new Date(evidence.recordedAt)
            .toISOString()
            .replace("T", " ")
            .replace(".000Z", " UTC")}
        </dd>
        <dt>Record</dt>
        <dd>
          {evidence.id} · Version {evidence.version}
        </dd>
      </dl>
      <p className="source-note">{source?.reason}</p>
    </>
  );
}

export function ReviewComposer({
  action,
  proposal,
  data,
  adapter,
  onCancel,
  onComplete,
  inDialog = false,
  onBusyChange,
}: {
  action: ReviewAction;
  proposal: Proposal;
  data: Snapshot;
  adapter: IncidentData;
  onCancel: () => void;
  onComplete: (next: Snapshot) => void;
  inDialog?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  let impact;
  let stale = "";
  try {
    impact = previewImpact(data, proposal);
  } catch (e) {
    stale = (e as Error).message;
  }
  useEffect(() => {
    if (inDialog) return;
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({
      block: "start",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }, [inDialog]);
  return (
    <div
      className="review-composer"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !busy) {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      {!inDialog && (
        <h4 ref={heading} tabIndex={-1}>
          {action === "confirm"
            ? "Confirm review request"
            : "Dismiss suggestion"}
        </h4>
      )}
      {action === "confirm" ? (
        <>
          <p className="small muted">
            Nothing changes until you confirm. This request will:
          </p>
          <ul className="impact-list">
            {impact?.decisionIds.map((id) => (
              <li key={id}>
                <span>
                  <small>Flag this decision for a recheck</small>
                  <strong>
                    {data.decisions.find((d) => d.id === id)?.title}
                  </strong>
                </span>
                <Status value="needs_review" />
              </li>
            ))}
            {impact?.briefingIds.map((id) => (
              <li key={id}>
                <span>
                  <small>Mark this team update for checking</small>
                  <strong>
                    {data.briefings.find((b) => b.id === id)?.title}
                  </strong>
                </span>
                <Status value="outdated" />
              </li>
            ))}
            {impact?.decisionIds.map((id) => (
              <li key={`task:${id}`}>
                <span>
                  <small>Create an independent verification task</small>
                  <strong>
                    Assigned to {data.decisions.find((d) => d.id === id)?.owner}
                  </strong>
                </span>
                <Status value="open" />
              </li>
            ))}
          </ul>
          <p className="preservation-note">
            <Check size={17} />
            <span>
              This requests human review. It does not approve or reverse an
              operational action, or confirm the evidence is true.
            </span>
          </p>
        </>
      ) : (
        <p>Record why this suggestion does not require a decision review.</p>
      )}
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          onBusyChange?.(true);
          setError("");
          try {
            onComplete(await adapter[action](proposal.id, reason));
          } catch (err) {
            setError((err as Error).message);
            setBusy(false);
            onBusyChange?.(false);
          }
        }}
        aria-busy={busy}
      >
        <label htmlFor="review-reason">
          {action === "confirm"
            ? "Why should this decision be checked?"
            : "Reason for dismissal"}
        </label>
        <textarea
          id="review-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
          minLength={8}
          maxLength={2000}
          rows={3}
          placeholder="What needs independent verification?"
          aria-describedby="reason-hint"
        />
        <small id="reason-hint" className="muted">
          Required · 8–2,000 characters ·{" "}
          {adapter.mode === "fixture"
            ? "Local fixture action"
            : "Incident review record"}
        </small>
        {(error || stale) && (
          <p role="alert" className="error">
            {error || stale}
          </p>
        )}
        <div className="action-row">
          <button
            className="primary"
            disabled={busy || (action === "confirm" && !!stale)}
          >
            {busy
              ? "Recording…"
              : action === "confirm"
                ? "Flag decision for review"
                : "Dismiss suggestion"}
            <Check size={16} />
          </button>
          <button
            type="button"
            className="secondary"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
