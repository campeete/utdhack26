import { useState, useRef, useEffect } from "react";
import { FileText, Plus } from "lucide-react";
import { Modal, focusContext } from "../components/ui";

// Frontend-only drafts. These are never inserted into the authoritative Snapshot.
// Replace this boundary with the incident-authorized evidence/analysis adapter.
export type AnalysisState =
  | "Not analyzed"
  | "Analyzing"
  | "Suggested review"
  | "No related conflict"
  | "Analysis failed";
interface EvidenceDraft {
  id: string;
  title: string;
  source: string;
  text: string;
  analysis: AnalysisState;
}
export function EvidenceIntake({
  open,
  onClose,
  mode,
}: {
  open: boolean;
  onClose: () => void;
  mode: "fixture" | "live";
}) {
  const [drafts, setDrafts] = useState<EvidenceDraft[]>([]);
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("");
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const savedHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (open && !editing) focusContext(savedHeading.current);
  }, [open, editing, selectedId]);
  const selected = drafts.find((d) => d.id === selectedId);
  return open ? (
    <Modal title="Add evidence" onClose={onClose}>
      <p className="notice">
        Development intake · Drafts stay in this tab until reload. They are not
        saved to the incident backend.
      </p>
      {mode === "live" ? (
        <p role="alert" className="error">
          Evidence intake is unavailable: the authorized evidence-save API is
          not connected.
        </p>
      ) : editing ? (
        <form
          className="intake-form"
          onSubmit={(event) => {
            event.preventDefault();
            const draft: EvidenceDraft = {
              id: crypto.randomUUID(),
              title: title.trim(),
              source: source.trim(),
              text: text.trim(),
              analysis: "Not analyzed",
            };
            if (!draft.title || !draft.source || !draft.text) return;
            setDrafts((items) => [...items, draft]);
            setSelectedId(draft.id);
            setEditing(false);
            setTitle("");
            setSource("");
            setText("");
          }}
        >
          <label htmlFor="evidence-title">Evidence title</label>
          <input
            id="evidence-title"
            required
            maxLength={160}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
          <label htmlFor="evidence-source">Source</label>
          <input
            id="evidence-source"
            required
            maxLength={200}
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
          <label htmlFor="evidence-excerpt">Report or source excerpt</label>
          <textarea
            id="evidence-excerpt"
            required
            maxLength={20000}
            rows={5}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button className="primary">
            Save local draft
            <FileText size={16} />
          </button>
        </form>
      ) : selected ? (
        <section className="saved-evidence" aria-label="Saved local evidence">
          <p className="recorded-label" role="status">
            Local draft saved
          </p>
          <h3 ref={savedHeading} tabIndex={-1}>
            {selected.title}
          </h3>
          <small>{selected.source} · Local draft</small>
          <blockquote className="source-quote">{selected.text}</blockquote>
          <p className="analysis-state" role="status">
            {selected.analysis}
          </p>
          {selected.analysis === "Analysis failed" ? (
            <p role="alert" className="error">
              Nemotron analysis is not connected. No request was sent and no
              findings were generated. Your local draft is still available.
            </p>
          ) : (
            <p className="small muted">
              Nemotron is not connected. Analysis cannot run in this development
              workspace.
            </p>
          )}
          <button
            className="primary"
            onClick={() =>
              setDrafts((items) =>
                items.map((d) =>
                  d.id === selected.id
                    ? { ...d, analysis: "Analysis failed" }
                    : d,
                ),
              )
            }
          >
            {selected.analysis === "Analysis failed"
              ? "Check analysis availability"
              : "Analyze evidence"}
          </button>
          <button className="text-button" onClick={() => setEditing(true)}>
            <Plus size={15} />
            Add another draft
          </button>
        </section>
      ) : null}
      {!!drafts.length && (
        <details className="context-details">
          <summary>Local drafts ({drafts.length})</summary>
          <div className="detail-content">
            {drafts.map((d) => (
              <button
                className="record-link"
                key={d.id}
                onClick={() => {
                  setSelectedId(d.id);
                  setEditing(false);
                }}
              >
                <span>{d.title}</span>
                <small>{d.analysis}</small>
              </button>
            ))}
          </div>
        </details>
      )}
    </Modal>
  ) : null;
}
