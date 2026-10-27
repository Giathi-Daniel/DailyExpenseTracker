import { useEffect, useId, useRef, type ReactNode } from 'react';
import { formatMoney, formatPct } from '../../core/money';
import { Icon } from './Icon';

export function Money({
  value,
  currency,
  compact,
  whole,
  signed,
  className,
}: {
  value: number;
  currency: string;
  compact?: boolean;
  /** Drop minor units; for large headline figures. */
  whole?: boolean;
  signed?: boolean;
  className?: string;
}) {
  const text = formatMoney(Math.abs(value), currency, { compact, whole });
  const sign = signed ? (value > 0 ? '+' : value < 0 ? '−' : '') : value < 0 ? '−' : '';
  return <span className={`num ${className ?? ''}`}>{sign + text}</span>;
}

export function Delta({ ratio, goodWhen }: { ratio: number | null; goodWhen: 'up' | 'down' }) {
  if (ratio === null || !Number.isFinite(ratio)) return <span className="subtle">No prior data</span>;
  if (Math.abs(ratio) < 0.005) return <span className="delta muted">No change</span>;
  const up = ratio > 0;
  const good = (up && goodWhen === 'up') || (!up && goodWhen === 'down');
  return (
    <span className={`delta ${good ? 'pos' : 'neg'}`}>
      <Icon name={up ? 'arrowUp' : 'arrowDown'} size={14} />
      {formatPct(Math.abs(ratio))}
      <span className="sr-only">{good ? '(better)' : '(worse)'}</span>
    </span>
  );
}

export function Progress({ value, max, state }: { value: number; max: number; state?: 'good' | 'warning' | 'critical' }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div
      className="progress"
      data-state={state}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
    >
      <div style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Accessible modal built on the native <dialog> element (focus trap and Esc for free). */
export function Dialog({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`dialog ${wide ? 'wide' : ''}`}
      aria-labelledby={open ? titleId : undefined}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      {open && (
        <div className="dialog-body">
          <div className="card-header dialog-header">
            <h2 className="dialog-title" id={titleId}>
              {title}
            </h2>
            <button type="button" className="btn btn-subtle btn-icon" onClick={onClose} aria-label="Close">
              <Icon name="close" />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <div className="muted">{body}</div>
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={`btn btn-primary ${danger ? 'btn-danger' : ''}`}
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}

export function Card({
  title,
  action,
  children,
  flush,
  className,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  className?: string;
}) {
  return (
    <section className={`card ${flush ? 'card-flush' : ''} ${className ?? ''}`}>
      {(title || action) && (
        <div className="card-header">
          {typeof title === 'string' ? <h2>{title}</h2> : title}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Kpi({ label, value, foot }: { label: string; value: ReactNode; foot?: ReactNode }) {
  return (
    <div className="card kpi">
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {foot && <span className="kpi-foot">{foot}</span>}
    </div>
  );
}

export function MessageBar({
  intent = 'info',
  children,
}: {
  intent?: 'info' | 'warning' | 'critical' | 'good';
  children: ReactNode;
}) {
  const icon = intent === 'good' ? 'positive' : intent;
  return (
    <div className="message-bar" data-intent={intent} role={intent === 'critical' ? 'alert' : 'status'}>
      <Icon name={icon} />
      <div>{children}</div>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Trigger a client-side download without any network request. */
export function downloadFile(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
