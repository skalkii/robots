import { useCallback, useState } from 'react';
import type { Toast, ToastKind } from './Toast';

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
