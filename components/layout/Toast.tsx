"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

// Hand-built toast system. Actions push a transient acknowledgement instead of
// narrating status inline on the page. Bottom-right stack, auto-dismiss 4s.
export type ToastVariant = "ok" | "warn" | "danger" | "info";
type ToastItem = { id: number; message: string; variant: ToastVariant };
type PushToast = (message: string, variant?: ToastVariant) => void;

const ToastContext = createContext<PushToast>(() => {});

export function useToast(): PushToast {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const push = useCallback<PushToast>((message, variant = "info") => {
    if (!message) return;
    const id = ++idRef.current;
    setToasts((current) => [...current, { id, message, variant }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4000);
  }, []);

  const dismiss = (id: number) => setToasts((current) => current.filter((toast) => toast.id !== id));

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toastViewport" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <button
            key={toast.id}
            className={`toast toast-${toast.variant}`}
            onClick={() => dismiss(toast.id)}
            title="Dismiss"
          >
            <span className="toastDot" aria-hidden />
            <span className="toastBody">{toast.message}</span>
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
