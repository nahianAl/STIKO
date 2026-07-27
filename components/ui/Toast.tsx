'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

/**
 * Toasts (08). Bottom-left, auto-dismiss after 5s.
 *
 * "Anything reversible offers Undo for the toast's lifetime instead of a
 * confirmation dialog up front" — so the action here is the mechanism that lets
 * archive/publish/role-change skip a confirm.
 */

export interface ToastAction {
  label: string;
  onClick: () => void;
}

interface Toast {
  id: number;
  message: string;
  action?: ToastAction;
}

interface ToastContextValue {
  toast: (message: string, action?: ToastAction) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const LIFETIME_MS = 5000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((message: string, action?: ToastAction) => {
    // Date.now() alone collides when two toasts fire in the same millisecond.
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, action }]);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 left-4 z-[80] flex flex-col gap-2">
        {toasts.map((t) => (
          <ToastRow key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastRow({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  useEffect(() => {
    const id = setTimeout(onDismiss, LIFETIME_MS);
    return () => clearTimeout(id);
  }, [onDismiss]);

  return (
    <div className="pointer-events-auto flex items-center gap-4 rounded-inset bg-white px-4 py-3 shadow-stiko-popover">
      <span className="text-[13px] text-stiko-ink">{toast.message}</span>
      {toast.action && (
        <button
          onClick={() => {
            toast.action?.onClick();
            onDismiss();
          }}
          className="text-[12.5px] font-bold text-stiko-primary hover:text-stiko-primary-hover"
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}

/**
 * Returns a no-op outside a provider rather than throwing — a missing toast
 * should never take a screen down with it.
 */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  return ctx ?? { toast: () => {} };
}
