import { useRef, useState } from "react";
import { ArrowRight, Check, ChevronDown, Plus } from "lucide-react";
import type { Snapshot } from "../../shared/contracts";
import type { IncidentData } from "../data/interface";
import { focusContext, Status, label, utc } from "../components/ui";
import { Activity } from "./IncidentPages";
import { IncidentStory } from "./IncidentStory";
import { EvidenceIntake } from "./EvidenceIntake";
export interface Selection {
  evidenceId: string | null;
  decisionId: string | null;
}

export function Decisions({
  data,
  adapter,
  onUpdate,
  selection,
  onSelect,
}: {
  data: Snapshot;
  adapter: IncidentData;
  onUpdate: (data: Snapshot) => void;
  selection: Selection;
  onSelect: (selection: Selection) => void;
}) {
  const [open, setOpen] = useState(true);
  const [filter, setFilter] = useState<"all" | "attention">("all");
  const [intakeOpen, setIntakeOpen] = useState(false);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const uncertainSystems = data.scope
    .filter((s) => s.exfiltration === "unknown")
    .map((s) => s.system);
  const pending = data.proposals.filter(
    (p) => p.state === "pending" || p.state === "stale",
  );
  function select(evidenceId: string | null, decisionId: string | null) {
    onSelect({ evidenceId, decisionId });
    setOpen(true);
    requestAnimationFrame(() => focusContext(heading.current));
  }
  function close() {
    setOpen(false);
    requestAnimationFrame(() => focusContext(listHeading.current));
  }
  return (
    <div className="item-workspace">
      <aside className="incident-item-list" aria-label="Incident updates">
        <div className="item-list-heading">
          <div>
            <span className="section-kicker">{data.incident.title}</span>
            <h2 ref={listHeading} tabIndex={-1}>
              Incident updates
            </h2>
          </div>
          <span className="muted small">{data.evidence.length}</span>
        </div>
        <div className="item-filters" aria-label="Filter incident updates">
          <button
            aria-pressed={filter === "all"}
            onClick={() => setFilter("all")}
          >
            All updates
          </button>
          <button
            aria-pressed={filter === "attention"}
            onClick={() => setFilter("attention")}
          >
            Needs attention
          </button>
        </div>
        <div className="incident-items">
          {data.evidence
            .filter(
              (e) =>
                filter === "all" ||
                data.proposals.some(
                  (p) =>
                    p.evidenceId === e.id &&
                    (p.state === "pending" ||
                      p.state === "stale" ||
                      data.tasks.some(
                        (t) => t.proposalId === p.id && t.state === "open",
                      )),
                ),
            )
            .map((e) => {
              const linked = data.decisions.find((d) =>
                d.evidenceIds.includes(e.id),
              );
              const source = data.sources.find((s) => s.id === e.sourceId);
              const review = data.proposals.find((p) => p.evidenceId === e.id);
              const state =
                review?.state === "accepted" ? "needs_review" : review?.state;
              return (
                <button
                  className={`incident-item ${open && selection.evidenceId === e.id ? "selected" : ""}`}
                  key={e.id}
                  aria-pressed={open && selection.evidenceId === e.id}
                  aria-controls="selected-update"
                  onClick={() => select(e.id, linked?.id ?? null)}
                >
                  <span className="item-meta">
                    {e.id}
                    <time>{utc(e.recordedAt)} UTC</time>
                  </span>
                  <strong>
                    {source?.trust === "under_review"
                      ? "Recovery source under review"
                      : e.title}
                  </strong>
                  <span className="item-source">{source?.label}</span>
                  <span className="item-bottom">
                    {state ? (
                      <Status value={state} />
                    ) : (
                      <span className="routine-text">
                        {linked ? "Decision linked" : "No linked decision"}
                      </span>
                    )}
                    <ArrowRight size={15} />
                  </span>
                </button>
              );
            })}
        </div>
        {filter === "attention" &&
          !data.evidence.some((e) =>
            data.proposals.some(
              (p) =>
                p.evidenceId === e.id &&
                (p.state === "pending" ||
                  p.state === "stale" ||
                  data.tasks.some(
                    (t) => t.proposalId === p.id && t.state === "open",
                  )),
            ),
          ) && <p className="quiet-empty">No updates need attention.</p>}
        <button
          className={`overview-link ${!open ? "selected" : ""}`}
          onClick={close}
        >
          Incident overview
          <ArrowRight size={15} />
        </button>
        <button
          className="secondary add-item-evidence"
          onClick={() => setIntakeOpen(true)}
        >
          <Plus size={16} />
          Add evidence
        </button>
      </aside>
      <div className="item-information">
        {!open ? (
          <div className="incident-overview">
            <section className="situation" aria-labelledby="situation-heading">
              <div className="situation-top">
                <div>
                  <span className="section-kicker">
                    {data.incident.status} · {data.incident.severity} severity
                  </span>
                  <h1 id="situation-heading">Current situation</h1>
                </div>
                <button
                  className="secondary"
                  onClick={() => setIntakeOpen(true)}
                >
                  <Plus size={16} />
                  Add evidence
                </button>
              </div>
              <p className="situation-summary">{data.incident.summary}</p>
              <p className="commander">
                Commander <strong>{data.incident.commander}</strong>
              </p>
              <dl className="situation-facts">
                <div>
                  <dt>Confirmed</dt>
                  <dd>
                    {data.scope
                      .filter((s) => s.encryption === "confirmed")
                      .map((s) => `${s.system}: encryption confirmed`)
                      .join("; ") || "No confirmed encryption recorded."}
                  </dd>
                </div>
                <div>
                  <dt>Still uncertain</dt>
                  <dd>
                    {uncertainSystems.length
                      ? `${uncertainSystems.join(", ")}: data exfiltration unknown.`
                      : "No unknown exfiltration findings recorded."}
                  </dd>
                </div>
              </dl>
              <p className="affected-inline">
                {data.scope.map((s) => s.system).join(" · ")}
              </p>
              <details className="affected-summary">
                <summary>
                  Affected systems & data{" "}
                  <span>
                    <ChevronDown size={15} />
                  </span>
                </summary>
                <ul>
                  {data.scope.map((s) => (
                    <li key={s.id}>
                      <strong>{s.system}</strong>
                      <span>
                        {s.data} · {s.extent}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            </section>
            <section
              className="attention-section"
              aria-labelledby="attention-heading"
            >
              <div className="section-heading">
                <h2 id="attention-heading">Needs attention</h2>
                <span className="muted small">
                  {pending.length} suggested ·{" "}
                  {data.tasks.filter((t) => t.state === "open").length} open
                  actions
                </span>
              </div>
              {pending.map((p) => {
                const d = data.decisions.find(
                  (d) => p.decisionVersions[d.id] !== undefined,
                );
                return (
                  <article className="attention-row" key={p.id}>
                    <div>
                      <Status value={p.state} emphasis />
                      <h3>{d?.title ?? "Review source evidence"}</h3>
                      <p>
                        {data.sources.find((s) => s.id === p.sourceId)
                          ?.trust === "under_review"
                          ? "Source trust needs independent verification."
                          : p.explanation.split(/(?<=[.!?])\s/)[0]}
                      </p>
                      <small>
                        {d?.owner ?? "Unassigned"} ·{" "}
                        {p.origin === "synthetic"
                          ? "Synthetic suggestion"
                          : `${label(p.origin)} suggestion`}
                      </small>
                    </div>
                    <button
                      className="primary"
                      onClick={() => select(p.evidenceId, d?.id ?? null)}
                    >
                      Review evidence
                      <ArrowRight size={16} />
                    </button>
                  </article>
                );
              })}
              {data.tasks
                .filter((t) => t.state === "open")
                .map((t) => (
                  <article className="attention-row task-row" key={t.id}>
                    <div>
                      <Status value="needs_review" />
                      <h3>{t.title}</h3>
                      <small>{t.owner} · Next action</small>
                    </div>
                    <button
                      className="secondary"
                      onClick={() => {
                        const p = data.proposals.find(
                          (p) => p.id === t.proposalId,
                        );
                        select(p?.evidenceId ?? null, t.decisionId);
                      }}
                    >
                      View next action
                      <ArrowRight size={16} />
                    </button>
                  </article>
                ))}
              {!pending.length &&
                !data.tasks.some((t) => t.state === "open") && (
                  <p className="quiet-empty">
                    <Check size={18} />
                    No pending review suggestions.
                  </p>
                )}
            </section>
            <section
              className="recent-section"
              aria-labelledby="recent-heading"
            >
              <div className="section-heading">
                <h2 id="recent-heading">Recent changes</h2>
                <span className="muted small">UTC</span>
              </div>
              <ol className="compact-timeline">
                {data.activity.slice(0, 3).map((a) => (
                  <li key={a.id}>
                    <time>{utc(a.at)}</time>
                    <div>
                      <p>{a.text}</p>
                      <small>{a.actor}</small>
                    </div>
                  </li>
                ))}
              </ol>
              <details className="context-details">
                <summary>
                  Full activity & history
                  <ChevronDown size={16} />
                </summary>
                <div className="detail-content">
                  <Activity data={data} />
                  <p className="small muted">
                    Audit receipts and hashes are not connected to this fixture
                    view.
                  </p>
                </div>
              </details>
            </section>
            <details className="context-details record-library">
              <summary>
                Decisions & evidence
                <ChevronDown size={16} />
              </summary>
              <div className="detail-content">
                {data.decisions.map((d) => (
                  <button
                    className="record-link"
                    key={d.id}
                    onClick={() => select(d.evidenceIds[0] ?? null, d.id)}
                  >
                    <span>{d.title}</span>
                    <Status value={d.state} />
                  </button>
                ))}
                {data.evidence.map((e) => (
                  <button
                    className="record-link"
                    key={e.id}
                    onClick={() =>
                      select(
                        e.id,
                        data.decisions.find((d) => d.evidenceIds.includes(e.id))
                          ?.id ?? null,
                      )
                    }
                  >
                    <span>{e.title}</span>
                    <Status value={e.standing} />
                  </button>
                ))}
              </div>
            </details>
          </div>
        ) : (
          <IncidentStory
            key={`${selection.evidenceId}:${selection.decisionId}`}
            data={data}
            adapter={adapter}
            onUpdate={onUpdate}
            selection={selection}
            headingRef={heading}
            onOverview={close}
          />
        )}
      </div>
      <EvidenceIntake
        open={intakeOpen}
        onClose={() => setIntakeOpen(false)}
        mode={adapter.mode}
      />
    </div>
  );
}
