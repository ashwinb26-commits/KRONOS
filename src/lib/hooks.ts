/**
 * Small hooks shared by the views.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * True only once an operation has been running for `delayMs`.
 *
 * Fast responses therefore show no loader at all, which is the point: a
 * spinner that appears and vanishes inside 100ms reads as a glitch and makes
 * the app feel slower than doing nothing.
 */
export function useDelayedFlag(active: boolean, delayMs = 100): boolean {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!active) {
      setShown(false);
      return;
    }
    const timer = window.setTimeout(() => setShown(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [active, delayMs]);

  return shown;
}

/**
 * Trap Tab inside an element while it is open, close on Escape, and return
 * focus to whatever opened it.
 */
export function useFocusTrap(open: boolean, onClose: () => void) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    triggerRef.current = document.activeElement;
    const container = containerRef.current;
    if (!container) return;

    const focusable = () =>
      Array.from(
        container.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null || element === document.activeElement);

    // Default focus goes to the cancelling control, so Enter never confirms
    // something destructive by accident.
    const initial = container.querySelector<HTMLElement>('[data-autofocus]') ?? focusable()[0];
    initial?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    container.addEventListener('keydown', onKeyDown);
    return () => {
      container.removeEventListener('keydown', onKeyDown);
      (triggerRef.current as HTMLElement | null)?.focus?.();
    };
  }, [open, onClose]);

  return containerRef;
}

/** Close a popover on Escape or on a click outside it, restoring focus. */
export function useDismissable(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, onClose]);

  return ref;
}

export interface DraftState<T> {
  value: T;
  setValue: (next: T | ((current: T) => T)) => void;
  restoredAt: string | null;
  discard: () => void;
  clear: () => void;
}

/**
 * Form state that survives a refresh, a closed tab or a stray navigation.
 *
 * Only the snapshot being edited is kept, which is public financial data by
 * definition: it is on its way to a public JSON file in a public repository.
 * No credential, session or token is ever written here.
 */
export function useDraft<T>(key: string, initial: T, enabled = true): DraftState<T> {
  const storageKey = `dcf-lab-draft:${key}`;
  const [restoredAt, setRestoredAt] = useState<string | null>(null);
  const [value, setValueRaw] = useState<T>(() => {
    if (!enabled) return initial;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return initial;
      const parsed = JSON.parse(raw) as { data: T; updatedAt: string };
      if (!parsed || typeof parsed !== 'object' || !('data' in parsed)) return initial;
      return parsed.data;
    } catch {
      return initial;
    }
  });

  // Reported separately from the initial read so the banner only shows when a
  // draft was actually recovered.
  useEffect(() => {
    if (!enabled) return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { updatedAt?: string };
      if (parsed?.updatedAt) setRestoredAt(parsed.updatedAt);
    } catch {
      /* Storage can be unavailable in a private window. Carry on without it. */
    }
  }, [storageKey, enabled]);

  const persist = useCallback(
    (next: T) => {
      if (!enabled) return;
      try {
        window.localStorage.setItem(
          storageKey,
          JSON.stringify({ data: next, updatedAt: new Date().toISOString() }),
        );
      } catch {
        /* Quota or private mode. The edit still works, it just will not survive a reload. */
      }
    },
    [storageKey, enabled],
  );

  const setValue = useCallback(
    (next: T | ((current: T) => T)) => {
      setValueRaw((current) => {
        const resolved = typeof next === 'function' ? (next as (c: T) => T)(current) : next;
        persist(resolved);
        return resolved;
      });
    },
    [persist],
  );

  const clear = useCallback(() => {
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      /* Nothing to clean up if storage is unavailable. */
    }
    setRestoredAt(null);
  }, [storageKey]);

  const discard = useCallback(() => {
    clear();
    setValueRaw(initial);
  }, [clear, initial]);

  return { value, setValue, restoredAt, discard, clear };
}

/** Copy text to the clipboard, reporting whether it worked. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
