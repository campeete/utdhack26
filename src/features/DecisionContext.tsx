import { useState } from "react";
import { ArrowDown, Check, Copy, MessageSquare } from "lucide-react";
import type {
  Briefing,
  Decision,
  Evidence,
  Proposal,
  Snapshot,
  Source,
} from "../../shared/contracts";
import { localTime, Status } from "../components/ui";

/** Source → evidence → assumption → decision → team updates, with the weak link highlighted. */
export function DecisionTrail({
  data,
  source,
  evidence,
  decision,
  proposal,
  briefings,
  onDiscuss,
}: {
  data: Snapshot;
  source?: Source;
  evidence?: Evidence;
  decision: Decision;
  proposal?: Proposal;
  briefings: Briefing[];
  onDiscuss: (text: string) => void;
}) {
  const shaky = source?.trust === "under_review";
  const otherEvidence = decision.evidenceIds
    .filter((id) => id !== evidence?.id)
    .map((id) => data.evidence.find((e) => e.id === id))
    .filter((e): e is Evidence => !!e);
  const nodes = [
    source && {
      kind: "Source",
      title: source.label,
      status: source.trust,
      weak: shaky,
    },
    evidence && {
      kind: `Evidence ${evidence.id}`,
      title: evidence.title,
      status: evidence.standing,
      weak: false,
    },
    {
      kind: "Assumption",
      title: decision.assumption,
      status: shaky ? "in_question" : undefined,
      weak: shaky,
    },
    {
      kind: `Decision ${decision.id}`,
      title: `${decision.title} · ${decision.owner}${decision.approvedAt ? ` · approved ${localTime(decision.approvedAt)}` : ""}`,
      status: decision.state,
      weak: false,
    },
    ...briefings.map((b) => ({
      kind: `Team update ${b.id}`,
      title: b.title,
      status: b.state,
      weak: false,
    })),
  ].filter(Boolean) as {
    kind: string;
    title: string;
    status?: string;
    weak: boolean;
  }[];
  return (
    <div className="context-panel" id="decision-trail">
      <p className="context-lead">
        {shaky
          ? "The decision rests on one assumption, and the source behind it is under review. Everything below it inherits that doubt."
          : "How this decision connects to the evidence and to what the team is being told."}
      </p>
      <ol className="trail">
        {nodes.map((node, i) => (
          <li key={node.kind} className={node.weak ? "weak" : ""}>
            <div className="trail-node">
              <small>{node.kind}</small>
              <strong>{node.title}</strong>
              {node.status && <Status value={node.status} />}
            </div>
            {i < nodes.length - 1 && (
              <ArrowDown className="trail-arrow" size={14} aria-hidden="true" />
            )}
          </li>
        ))}
      </ol>
      {!!otherEvidence.length && (
        <p className="procedure-note">
          Also supported by{" "}
          {otherEvidence.map((e) => `${e.id} (${e.title})`).join(", ")}.
        </p>
      )}
      <dl className="context-facts">
        <div>
          <dt>Original reasoning</dt>
          <dd>{decision.rationale}</dd>
        </div>
        {proposal && (
          <div>
            <dt>Why a review was suggested</dt>
            <dd>
              {proposal.explanation}
              <small>
                {proposal.origin === "nemotron"
                  ? "Suggested by Nora (Nemotron)"
                  : proposal.origin === "human"
                    ? "Suggested by a responder"
                    : "Demo suggestion · Nora (Nemotron) not connected"}{" "}
                · based on {proposal.evidenceId} v{proposal.evidenceVersion},
                source v{proposal.sourceVersion}
              </small>
            </dd>
          </div>
        )}
      </dl>
      <button
        className="text-button context-discuss"
        onClick={() =>
          onDiscuss(
            `${decision.id} “${decision.title}” relies on: ${decision.assumption}${shaky && source ? ` The source (${source.label}) is under review.` : ""} Can we confirm before acting on it?`,
          )
        }
      >
        <MessageSquare size={14} />
        Discuss this decision
      </button>
    </div>
  );
}

/** What the team is being told, what a review request would do to it, and quick ways to use it. */
export function TeamUpdates({
  briefings,
  proposal,
  onDiscuss,
}: {
  briefings: Briefing[];
  proposal?: Proposal;
  onDiscuss: (text: string) => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  return (
    <div className="context-panel" id="team-updates">
      {briefings.map((b) => {
        const affected =
          proposal?.state === "pending" &&
          Object.prototype.hasOwnProperty.call(proposal.briefingVersions, b.id);
        return (
          <article key={b.id} className="team-update">
            <header>
              <div>
                <small>{b.id} · version {b.version}</small>
                <strong>{b.title}</strong>
              </div>
              <Status value={b.state} />
            </header>
            <blockquote>{b.text}</blockquote>
            {b.state === "outdated" ? (
              <p className="context-callout warn">
                A decision this update depends on is under review. Check it
                before sharing it again.
              </p>
            ) : affected ? (
              <p className="context-callout">
                If you request a review, this update becomes{" "}
                <Status value="outdated" /> so nobody re-shares it unchecked.
                The text itself is kept.
              </p>
            ) : null}
            <div className="context-actions">
              <button
                className="text-button"
                onClick={() => {
                  void navigator.clipboard?.writeText(b.text).then(() => {
                    setCopied(b.id);
                    setTimeout(() => setCopied(null), 1600);
                  });
                }}
              >
                {copied === b.id ? <Check size={14} /> : <Copy size={14} />}
                {copied === b.id ? "Copied" : "Copy text"}
              </button>
              <button
                className="text-button"
                onClick={() =>
                  onDiscuss(
                    `About ${b.id} “${b.title}”${b.state === "outdated" ? " (now outdated)" : ""}: `,
                  )
                }
              >
                <MessageSquare size={14} />
                Discuss this update
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
