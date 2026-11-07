import { useEffect, useId, useRef, type ReactNode } from 'react';
import { AlertTriangle, Check, CheckCheck, CircleHelp, Clock3, FileWarning, X } from 'lucide-react';

export const label = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
export const utc = (s: string) => new Date(s).toLocaleTimeString('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' });

export function focusContext(element: HTMLElement | null) {
  if (!element) return;
  element.focus({ preventScroll: true });
  element.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'amber' | 'green' }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
const statuses = {
  needs_review: { text: 'Needs review', Icon: AlertTriangle, tone: 'review' },
  pending: { text: 'Review proposed', Icon: AlertTriangle, tone: 'review' },
  under_review: { text: 'Trust under review', Icon: AlertTriangle, tone: 'review' },
  disputed: { text: 'Disputed', Icon: AlertTriangle, tone: 'disputed' },
  corroborated: { text: 'Corroborated', Icon: CheckCheck, tone: 'corroborated' },
  unknown: { text: 'Unknown', Icon: CircleHelp, tone: 'unknown' },
  outdated: { text: 'Outdated', Icon: FileWarning, tone: 'outdated' },
  reported: { text: 'Reported', Icon: FileWarning, tone: 'routine' },
  approved: { text: 'Approved', Icon: Check, tone: 'approved' },
  reviewed: { text: 'Reviewed', Icon: Check, tone: 'approved' },
  open: { text: 'Open', Icon: Clock3, tone: 'routine' },
  dismissed: { text: 'Dismissed', Icon: Check, tone: 'routine' },
  accepted: { text: 'Review confirmed', Icon: Check, tone: 'approved' },
  stale: { text: 'Stale proposal', Icon: Clock3, tone: 'outdated' },
};
export function Status({ value, emphasis = false }: { value: string; emphasis?: boolean }) {
  const spec = statuses[value as keyof typeof statuses];
  const Icon = spec?.Icon;
  return <span className={`status-tag ${spec?.tone ?? 'routine'} ${emphasis ? 'emphasis' : ''}`}>
    {Icon && <Icon size={emphasis ? 18 : 15} aria-hidden="true" />}{spec?.text ?? label(value)}
  </span>;
}
export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const el = ref.current!;
    const trigger = document.activeElement as HTMLElement | null;
    el.showModal();
    return () => { el.close(); trigger?.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={ref} onCancel={e => { e.preventDefault(); onClose(); }} aria-labelledby={id} onKeyDown={event => {
    if (event.key !== 'Tab') return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [tabindex="0"]')].filter(el => el.getClientRects().length > 0);
    const first = controls[0]; const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }}>
    <div className="modal-heading"><h2 id={id}>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={20} /></button></div>{children}
  </dialog>;
}
