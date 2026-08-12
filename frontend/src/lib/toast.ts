/**
 * Toast emitter API — fire toasts from anywhere (FR-033 denial feedback).
 * Rendered by <ToastHost /> mounted at the app root.
 */

type ToastVariant = "denied" | "error" | "success" | "info";

export interface Toast {
  id: number;
  variant: ToastVariant;
  message: string;
}

type Listener = (toast: Toast) => void;

let nextId = 1;
const listeners = new Set<Listener>();

function emit(variant: ToastVariant, message: string) {
  const toast = { id: nextId++, variant, message };
  listeners.forEach((listener) => listener(toast));
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const toast = {
  denied(message = "Anda tidak memiliki izin untuk melakukan tindakan ini.") {
    emit("denied", message);
  },
  error(message: string) {
    emit("error", message);
  },
  success(message: string) {
    emit("success", message);
  },
  info(message: string) {
    emit("info", message);
  },
};
