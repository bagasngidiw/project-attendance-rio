/**
 * ToastHost — renders toasts fired via the `toast` emitter (FR-033 denial
 * and error feedback). Mounted once at the app root.
 */

import { useCallback, useEffect, useState, type ReactElement } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";

import { subscribeToasts, type Toast } from "@/lib/toast";

type ToastVariant = Toast["variant"];

const STYLES: Record<ToastVariant, { container: string; icon: ReactElement }> = {
  denied: {
    container: "border-red-200 bg-red-50 text-red-800",
    icon: <AlertTriangle size={18} />,
  },
  error: {
    container: "border-red-200 bg-red-50 text-red-800",
    icon: <AlertTriangle size={18} />,
  },
  success: {
    container: "border-green-200 bg-green-50 text-green-800",
    icon: <CheckCircle2 size={18} />,
  },
  info: {
    container: "border-slate-200 bg-[var(--brand-surface)] text-slate-800",
    icon: <Info size={18} />,
  },
};

export function ToastHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const unsubscribe = subscribeToasts((toastItem) => {
      setToasts((prev) => [...prev, toastItem]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toastItem.id));
      }, 5000);
    });
    return unsubscribe;
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <div
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`flex items-start gap-2 rounded-lg border p-3 text-sm shadow-lg ${STYLES[t.variant].container}`}
        >
          <span className="mt-0.5 shrink-0">{STYLES[t.variant].icon}</span>
          <p className="flex-1">{t.message}</p>
          <button
            onClick={() => dismiss(t.id)}
            aria-label="Abaikan"
            className="shrink-0 rounded p-0.5 hover:opacity-70"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
