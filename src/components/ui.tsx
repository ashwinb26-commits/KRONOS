/**
 * Shared interface primitives.
 *
 * The rules they enforce, so individual screens do not have to remember them:
 *   - Every input has a visible label bound to it. Placeholders only ever show
 *     a format, never the field's name.
 *   - Validation waits for the first blur, and clears the moment the analyst
 *     comes back to fix it.
 *   - Submit controls are never disabled. A click with invalid data surfaces
 *     the problem instead of doing nothing.
 *   - Icon-only buttons carry a real tooltip on hover and on keyboard focus,
 *     plus a separate accessible name.
 *   - Helper text and error text share one slot, so an error never pushes the
 *     rest of the form down.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert, Check, Copy, Info } from './icons';
import { copyText, useDelayedFlag, useFocusTrap } from '../lib/hooks';

/* --- Tooltip ------------------------------------------------------------- */

export function Tooltip({
  label,
  shortcut,
  children,
}: {
  label: string;
  shortcut?: string;
  children: (props: { 'aria-describedby': string }) => ReactNode;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);

  return (
    <span
      className="tooltip-host"
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children({ 'aria-describedby': id })}
      <span className="tooltip" role="tooltip" id={id} data-open={open ? 'true' : 'false'}>
        {label}
        {shortcut ? <kbd>{shortcut}</kbd> : null}
      </span>
    </span>
  );
}

/** Platform-aware modifier so the tooltip shows the shortcut that actually works. */
export function modifierKey(): string {
  if (typeof navigator === 'undefined') return 'Ctrl';
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl';
}

export function IconButton({
  label,
  shortcut,
  icon,
  onClick,
  pressed,
}: {
  label: string;
  shortcut?: string;
  icon: ReactNode;
  onClick: () => void;
  pressed?: boolean;
}) {
  return (
    <Tooltip label={label} shortcut={shortcut}>
      {(described) => (
        <button
          type="button"
          className="icon-btn"
          aria-label={label}
          aria-pressed={pressed}
          onClick={onClick}
          {...described}
        >
          {icon}
        </button>
      )}
    </Tooltip>
  );
}

/* --- Buttons ------------------------------------------------------------- */

export function Button({
  children,
  onClick,
  variant = 'secondary',
  busy = false,
  busyLabel,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  busy?: boolean;
  busyLabel?: string;
  type?: 'button' | 'submit';
}) {
  // Loaders wait 100ms so a fast action never flashes a spinner.
  const showSpinner = useDelayedFlag(busy);

  return (
    <button
      type={type}
      className={`btn btn-${variant}`}
      onClick={onClick}
      aria-busy={busy ? 'true' : undefined}
    >
      {showSpinner ? <span className="spinner" aria-hidden="true" /> : null}
      {busy && busyLabel ? busyLabel : children}
    </button>
  );
}

export function CopyButton({ text, label = 'Copy error details' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      className="btn btn-secondary"
      onClick={async () => setCopied(await copyText(text))}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? 'Copied' : label}
    </button>
  );
}

/* --- Fields -------------------------------------------------------------- */

type Validator = (value: string) => string | null;

interface FieldShellProps {
  id: string;
  label: string;
  hint?: string;
  error: string | null;
  required?: boolean;
  children: ReactNode;
}

function FieldShell({ id, label, hint, error, required, children }: FieldShellProps) {
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required ? null : <span className="field-required"> (optional)</span>}
      </label>
      {children}
      <p className="field-note" id={`${id}-note`} data-error={error ? 'true' : 'false'} role={error ? 'alert' : undefined}>
        {error ?? hint ?? ''}
      </p>
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  hint,
  placeholder,
  validate,
  required,
  maxLength,
  inputMode,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  /** A format example only, for example FY2024-25. Never the field name. */
  placeholder?: string;
  validate?: Validator;
  required?: boolean;
  maxLength?: number;
  inputMode?: 'text' | 'numeric' | 'decimal' | 'url';
  autoComplete?: string;
}) {
  const id = useId();
  const [error, setError] = useState<string | null>(null);

  return (
    <FieldShell id={id} label={label} hint={hint} error={error} required={required}>
      <input
        id={id}
        type="text"
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        inputMode={inputMode}
        autoComplete={autoComplete}
        required={required}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={`${id}-note`}
        onChange={(event) => {
          if (error) setError(null);
          onChange(event.target.value);
        }}
        onFocus={() => setError(null)}
        onBlur={(event) => setError(validate ? validate(event.target.value) : null)}
      />
    </FieldShell>
  );
}

export function TextAreaField({
  label,
  value,
  onChange,
  hint,
  maxLength,
  rows,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  maxLength?: number;
  rows?: number;
}) {
  const id = useId();
  const remaining = maxLength ? maxLength - value.length : null;

  return (
    <FieldShell
      id={id}
      label={label}
      hint={remaining !== null ? `${hint ?? ''}${hint ? ' ' : ''}${remaining} characters left.` : hint}
      error={null}
    >
      <textarea
        id={id}
        value={value}
        rows={rows}
        maxLength={maxLength}
        aria-describedby={`${id}-note`}
        onChange={(event) => onChange(event.target.value)}
      />
    </FieldShell>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  hint?: string;
}) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint} error={null} required>
      {/* Always pre-selected. There is no empty first option, because a
          default is always knowable here. */}
      <select id={id} value={value} aria-describedby={`${id}-note`} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  hint,
  min,
  max,
  step,
  unit,
  allowEmpty = false,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  hint?: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  allowEmpty?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState(value === null ? '' : String(value));
  const [error, setError] = useState<string | null>(null);

  // Keep in step with the model when it changes from elsewhere, for example a
  // scenario switch or a restored draft, without fighting the analyst's typing.
  const lastExternal = useRef(value);
  useEffect(() => {
    if (lastExternal.current !== value) {
      lastExternal.current = value;
      setText(value === null ? '' : String(value));
    }
  }, [value]);

  const commit = useCallback(
    (raw: string) => {
      const trimmed = raw.trim();
      if (trimmed === '') {
        if (allowEmpty) {
          lastExternal.current = null;
          onChange(null);
          setError(null);
        } else {
          setError(`Enter a figure for ${label.toLowerCase()}.`);
        }
        return;
      }
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed)) {
        setError('Enter a number, for example 1250.5');
        return;
      }
      if (min !== undefined && parsed < min) {
        setError(`Enter ${min} or more.`);
        return;
      }
      if (max !== undefined && parsed > max) {
        setError(`Enter ${max} or less.`);
        return;
      }
      setError(null);
      lastExternal.current = parsed;
      onChange(parsed);
    },
    [allowEmpty, label, max, min, onChange],
  );

  return (
    <FieldShell id={id} label={unit ? `${label} (${unit})` : label} hint={hint} error={error} required={!allowEmpty}>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        data-numeric="true"
        value={text}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={`${id}-note`}
        onChange={(event) => {
          if (error) setError(null);
          setText(event.target.value);
        }}
        onFocus={() => setError(null)}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit((event.target as HTMLInputElement).value);
          if (step && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
            event.preventDefault();
            const current = Number(text || '0');
            if (!Number.isFinite(current)) return;
            const next = Math.round((current + (event.key === 'ArrowUp' ? step : -step)) * 10000) / 10000;
            setText(String(next));
            commit(String(next));
          }
        }}
      />
    </FieldShell>
  );
}

export function CheckboxField({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="check">
      <input id={id} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <label className="check-text" htmlFor={id}>
        {label}
        {hint ? <span>{hint}</span> : null}
      </label>
    </div>
  );
}

/** A driver with a number box and a slider, both bound to the same value. */
export function DriverControl({
  label,
  value,
  onChange,
  min,
  max,
  step,
  unit,
  hint,
  note,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  unit: string;
  hint: string;
  /** Shown under the hint, for example when year overrides make this unused. */
  note?: ReactNode;
}) {
  const id = useId();
  const [text, setText] = useState(String(value));
  const lastExternal = useRef(value);

  useEffect(() => {
    if (lastExternal.current !== value) {
      lastExternal.current = value;
      setText(String(value));
    }
  }, [value]);

  const commit = (raw: string) => {
    const parsed = Number(raw.trim());
    if (!Number.isFinite(parsed)) {
      setText(String(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    setText(String(clamped));
    lastExternal.current = clamped;
    onChange(clamped);
  };

  return (
    <div className="driver">
      <div className="driver-top">
        <label htmlFor={id}>{label}</label>
        <span className="driver-input">
          <input
            id={id}
            type="text"
            inputMode="decimal"
            value={text}
            aria-describedby={`${id}-hint`}
            onChange={(event) => setText(event.target.value)}
            onBlur={(event) => commit(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commit((event.target as HTMLInputElement).value);
            }}
          />
          <span className="driver-unit" aria-hidden="true">{unit}</span>
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={`${label} slider`}
        onChange={(event) => {
          const next = Number(event.target.value);
          lastExternal.current = next;
          setText(String(next));
          onChange(next);
        }}
      />
      <p className="driver-hint" id={`${id}-hint`}>{hint}</p>
      {note ? <div className="driver-note">{note}</div> : null}
    </div>
  );
}

/* --- Banners and dialogs ------------------------------------------------- */

export function Banner({
  tone,
  title,
  children,
  actions,
}: {
  tone: 'warn' | 'error' | 'ok' | 'neutral';
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  const mark = tone === 'ok' ? <Check /> : tone === 'neutral' ? <Info /> : <Alert />;
  return (
    <div
      className={`banner${tone === 'neutral' ? '' : ` banner-${tone}`}`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <span className="banner-mark" aria-hidden="true">{mark}</span>
      <div className="banner-body stack-3">
        <div>
          <h4>{title}</h4>
          {children ? <p>{children}</p> : null}
        </div>
        {actions ? <div className="btn-row">{actions}</div> : null}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'primary',
  busy = false,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  /** Names the exact thing being changed, for example the snapshot id. */
  title: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  const ref = useFocusTrap(open, onCancel);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="dialog-scrim" data-open="true" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <h3 id={titleId}>{title}</h3>
        <div className="stack-4" style={{ marginTop: 'var(--space-4)' }}>{children}</div>
        <div className="dialog-actions">
          {/* Cancel takes focus, so Enter never publishes by accident. */}
          <button type="button" className="btn btn-secondary" data-autofocus onClick={onCancel}>
            {cancelLabel}
          </button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} busy={busy} busyLabel="Publishing" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* --- Loading and empty --------------------------------------------------- */

export function Skeleton({ height, width }: { height: number; width?: string }) {
  return <div className="skeleton" style={{ height, width: width ?? '100%' }} aria-hidden="true" />;
}

/**
 * A skeleton shaped like the dashboard it is standing in for, rather than a
 * centred spinner on an empty page.
 */
export function DashboardSkeleton() {
  return (
    <div className="skeleton-page" aria-busy="true" aria-live="polite">
      <span className="visually-hidden">Loading the published valuation.</span>
      <Skeleton height={52} />
      <div className="headline">
        <Skeleton height={168} />
        <div className="metric-grid">
          <Skeleton height={76} />
          <Skeleton height={76} />
          <Skeleton height={76} />
          <Skeleton height={76} />
        </div>
      </div>
      <Skeleton height={28} width="38%" />
      <Skeleton height={260} />
      <Skeleton height={28} width="30%" />
      <Skeleton height={320} />
    </div>
  );
}

export function EmptyState({
  title,
  children,
  actions,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <p>{children}</p>
      {actions ? <div className="btn-row">{actions}</div> : null}
    </div>
  );
}

/* --- Tables -------------------------------------------------------------- */

export function TableFrame({
  title,
  unit,
  actions,
  footnote,
  children,
}: {
  title: string;
  unit?: string;
  actions?: ReactNode;
  footnote?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="table-frame">
      <div className="table-caption-row">
        <h3>{title}</h3>
        {actions ?? (unit ? <span className="text-meta">{unit}</span> : null)}
      </div>
      <div className="table-scroll">{children}</div>
      {footnote ? <div className="table-foot-note">{footnote}</div> : null}
    </div>
  );
}

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="segmented">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
