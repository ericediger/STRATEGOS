/**
 * Toast Notification System
 *
 * Lightweight toast notifications without third-party dependencies.
 * Features: Auto-dismiss, close button, stacking, 3 variants (success, error, info).
 */

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { CheckCircle, XCircle, Info, X } from 'lucide-react';

export type ToastVariant = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  showToast: (message: string, variant: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, variant: ToastVariant) => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    const newToast: Toast = { id, message, variant };

    setToasts((prev) => [...prev, newToast]);

    // Auto-dismiss after 5 seconds
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

function ToastContainer({ toasts, onRemove }: { toasts: Toast[]; onRemove: (id: string) => void }) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onRemove={onRemove} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: string) => void }) {
  const config = {
    success: {
      icon: <CheckCircle className="w-5 h-5 flex-shrink-0" />,
      bgColor: 'bg-brand-green',
      textColor: 'text-white',
    },
    error: {
      icon: <XCircle className="w-5 h-5 flex-shrink-0" />,
      bgColor: 'bg-brand-magenta',
      textColor: 'text-white',
    },
    info: {
      icon: <Info className="w-5 h-5 flex-shrink-0" />,
      bgColor: 'bg-brand-blue',
      textColor: 'text-white',
    },
  };

  const { icon, bgColor, textColor } = config[toast.variant];

  return (
    <div
      className={`${bgColor} ${textColor} rounded-lg shadow-lg px-4 py-3 flex items-center gap-3 min-w-[320px] max-w-md pointer-events-auto animate-slide-in-right`}
      role="alert"
      aria-live="polite"
    >
      {icon}
      <p className="flex-1 text-sm font-medium leading-snug">{toast.message}</p>
      <button
        onClick={() => onRemove(toast.id)}
        className="p-0.5 hover:bg-white/20 rounded transition-colors"
        aria-label="Close notification"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
