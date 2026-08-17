/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

export interface ConfirmOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export interface PromptOptions {
  title?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

export type ToastType = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

interface DialogsContextValue {
  /** Styled, accessible replacement for window.confirm(). */
  confirm: (message: string, options?: ConfirmOptions) => Promise<boolean>;
  /** Styled, accessible replacement for window.prompt(). Resolves null on cancel. */
  promptText: (message: string, defaultValue?: string, options?: PromptOptions) => Promise<string | null>;
  /** Styled, non-blocking replacement for window.alert() / ad-hoc status banners. */
  toast: (message: string, type?: ToastType) => void;
}

const DialogsContext = createContext<DialogsContextValue | null>(null);

export function useDialogs(): DialogsContextValue {
  const ctx = useContext(DialogsContext);
  if (!ctx) {
    throw new Error('useDialogs must be used within a DialogProvider');
  }
  return ctx;
}

interface ConfirmState {
  message: string;
  options: ConfirmOptions;
  resolve: (value: boolean) => void;
}

interface PromptState {
  message: string;
  defaultValue: string;
  options: PromptOptions;
  resolve: (value: string | null) => void;
}

// Shared focus trap + Escape-to-close for the two dialog types below. Traps
// Tab within the dialog's own focusable elements and calls onClose on
// Escape, matching baseline modal accessibility expectations that the
// original window.confirm/prompt calls never had to worry about.
function useDialogA11y(containerRef: React.RefObject<HTMLElement>, onClose: () => void) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const focusable = container.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    focusable[0]?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        const items: HTMLElement[] = Array.from(
          container.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          )
        );
        if (items.length === 0) return;
        const first: HTMLElement = items[0];
        const last: HTMLElement = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [containerRef, onClose]);
}

const ConfirmDialogUI: React.FC<{ state: ConfirmState; onClose: () => void }> = ({ state, onClose }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  useDialogA11y(containerRef, () => {
    state.resolve(false);
    onClose();
  });

  const destructive = !!state.options.destructive;

  return (
    <div
      className="fixed inset-0 z-[9990] flex items-center justify-center bg-ink/60 backdrop-blur-sm p-4 gl-animate-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          state.resolve(false);
          onClose();
        }
      }}
    >
      <div
        ref={containerRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="gl-confirm-title"
        aria-describedby="gl-confirm-message"
        className="bg-surface rounded-2xl border border-line shadow-2xl w-full max-w-sm p-6 gl-animate-dialog"
      >
        <h3 id="gl-confirm-title" className="text-sm font-black uppercase tracking-wider text-ink mb-3">
          {state.options.title || (destructive ? 'Confirm Deletion' : 'Please Confirm')}
        </h3>
        <p id="gl-confirm-message" className="text-xs text-ink-soft leading-relaxed mb-6 whitespace-pre-line">
          {state.message}
        </p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              state.resolve(false);
              onClose();
            }}
            className="flex-1 py-2.5 bg-surface hover:bg-paper text-ink-soft hover:text-ink rounded-xl text-xs font-bold uppercase tracking-wider transition-colors border border-line cursor-pointer"
          >
            {state.options.cancelLabel || 'Cancel'}
          </button>
          <button
            type="button"
            onClick={() => {
              state.resolve(true);
              onClose();
            }}
            className={`flex-1 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-lg cursor-pointer ${
              destructive
                ? 'bg-red-500 hover:bg-red-600 text-white shadow-red-500/15'
                : 'bg-gold hover:bg-gold-hover text-ink shadow-gold/15'
            }`}
          >
            {state.options.confirmLabel || 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
};

const PromptDialogUI: React.FC<{ state: PromptState; onClose: () => void }> = ({ state, onClose }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState(state.defaultValue);

  const submit = () => {
    // Match native prompt() semantics: only Cancel/Escape resolves null.
    // Submitting an empty value is a deliberate "clear this field" action,
    // not a cancellation.
    state.resolve(value);
    onClose();
  };
  const cancel = () => {
    state.resolve(null);
    onClose();
  };

  useDialogA11y(containerRef, cancel);

  return (
    <div
      className="fixed inset-0 z-[9990] flex items-center justify-center bg-ink/60 backdrop-blur-sm p-4 gl-animate-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) cancel();
      }}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="gl-prompt-title"
        className="bg-surface rounded-2xl border border-line shadow-2xl w-full max-w-sm p-6 gl-animate-dialog"
      >
        <h3 id="gl-prompt-title" className="text-sm font-black uppercase tracking-wider text-ink mb-3">
          {state.options.title || state.message}
        </h3>
        {state.options.title && (
          <p className="text-xs text-ink-soft leading-relaxed mb-3">{state.message}</p>
        )}
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={state.options.placeholder}
          autoFocus
          className="w-full bg-paper border border-line rounded-lg px-3 py-2.5 text-sm text-ink focus:border-gold outline-none transition-all font-semibold mb-6"
        />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={cancel}
            className="flex-1 py-2.5 bg-surface hover:bg-paper text-ink-soft hover:text-ink rounded-xl text-xs font-bold uppercase tracking-wider transition-colors border border-line cursor-pointer"
          >
            {state.options.cancelLabel || 'Cancel'}
          </button>
          <button
            type="button"
            onClick={submit}
            className="flex-1 py-2.5 bg-gold hover:bg-gold-hover text-ink rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-lg shadow-gold/15 cursor-pointer"
          >
            {state.options.confirmLabel || 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

const TOAST_ICONS: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />,
  error: <AlertTriangle size={16} className="text-red-500 shrink-0" />,
  info: <Info size={16} className="text-gold shrink-0" />,
};

const ToastStack: React.FC<{ toasts: ToastItem[]; onDismiss: (id: number) => void }> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 w-full max-w-xs pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className="gl-animate-toast pointer-events-auto bg-surface border border-line shadow-2xl rounded-xl px-4 py-3 flex items-start gap-2.5 cursor-pointer"
          onClick={() => onDismiss(t.id)}
        >
          {TOAST_ICONS[t.type]}
          <span className="text-xs font-semibold text-ink leading-snug flex-1">{t.message}</span>
          <X size={13} className="text-ink-soft hover:text-ink shrink-0 mt-0.5" />
        </div>
      ))}
    </div>
  );
};

let toastIdCounter = 0;

export const DialogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [promptState, setPromptState] = useState<PromptState | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const confirm = useCallback((message: string, options: ConfirmOptions = {}) => {
    return new Promise<boolean>((resolve) => {
      setConfirmState({ message, options, resolve });
    });
  }, []);

  const promptText = useCallback((message: string, defaultValue = '', options: PromptOptions = {}) => {
    return new Promise<string | null>((resolve) => {
      setPromptState({ message, defaultValue, options, resolve });
    });
  }, []);

  const toast = useCallback((message: string, type: ToastType = 'info') => {
    const id = ++toastIdCounter;
    setToasts((prev) => [...prev, { id, message, type }]);
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      timersRef.current.delete(id);
    }, 4000);
    timersRef.current.set(id, timer);
  }, []);

  return (
    <DialogsContext.Provider value={{ confirm, promptText, toast }}>
      {children}
      {confirmState && <ConfirmDialogUI state={confirmState} onClose={() => setConfirmState(null)} />}
      {promptState && <PromptDialogUI state={promptState} onClose={() => setPromptState(null)} />}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </DialogsContext.Provider>
  );
};
