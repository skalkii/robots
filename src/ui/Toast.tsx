import { useCallback, useState } from 'react';

export type ToastKind = 'info' | 'success' | 'warn' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  ttl?: number;
}

let nextId = 1;

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const push = useCallback((kind: ToastKind, message: string, ttl = 3500) => {
    const t: Toast = { id: nextId++, kind, message, ttl };
    setToasts(prev => [...prev, t]);
    if (ttl > 0) window.setTimeout(() => dismiss(t.id), ttl);
  }, [dismiss]);

  return { toasts, push, dismiss };
}

export function ToastStack({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map(t => (
        <button
          key={t.id}
          type="button"
          className={`toast toast-${t.kind}`}
          onClick={() => onDismiss(t.id)}
          aria-label={`Dismiss ${t.kind} message`}
        >
          {t.message}
        </button>
      ))}
    </div>
  );
}
