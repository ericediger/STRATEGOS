/**
 * CustomerReadyDialog — Shown when Customer-Ready export is selected
 * and one or more sections fall below the confidence threshold (rating === 'Low').
 *
 * Follows the ConfirmDialog pattern: Dark Blue overlay, focus trap, Escape to close.
 */

import { useEffect, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { ConfidenceBadge } from './ConfidenceBadge';
import type { ConfidenceData } from '../types';

interface CustomerReadyDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onExclude: (excludeSections: string[]) => void;
  onIncludeWithWarnings: () => void;
  confidence: ConfidenceData;
  sectionLabels: Record<string, string>;
}

export function CustomerReadyDialog({
  isOpen,
  onClose,
  onExclude,
  onIncludeWithWarnings,
  confidence,
  sectionLabels,
}: CustomerReadyDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  const flaggedSections = Object.entries(confidence.perSection)
    .filter(([, data]) => data.rating === 'Low')
    .map(([key, data]) => ({ key, label: sectionLabels[key] || key, rating: data.rating }));

  useEffect(() => {
    if (!isOpen) return;

    cancelButtonRef.current?.focus();

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !dialogRef.current) return;

      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleEscape);
    document.addEventListener('keydown', handleTab);
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.removeEventListener('keydown', handleTab);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-brand-dark-blue/80 backdrop-blur-sm"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="customer-ready-dialog-title"
    >
      <div
        ref={dialogRef}
        className="bg-white rounded-lg shadow-2xl max-w-md w-full mx-4 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5" style={{ color: '#C651C9' }} />
            <h2
              id="customer-ready-dialog-title"
              className="text-lg font-display font-semibold"
              style={{ color: '#1C2340' }}
            >
              Below Customer-Ready Threshold
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded transition-colors"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4">
          <p className="text-sm text-gray-700 mb-3">
            Some sections do not meet the Customer-Ready threshold:
          </p>
          <ul className="space-y-2">
            {flaggedSections.map(({ key, label, rating }) => (
              <li key={key} className="flex items-center gap-2 text-sm text-gray-800">
                <ConfidenceBadge rating={rating} />
                <span>{label}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Footer */}
        <div className="flex flex-col gap-2 px-6 py-4 bg-gray-50 border-t border-gray-200">
          <button
            onClick={() => onExclude(flaggedSections.map(s => s.key))}
            className="w-full px-4 py-2 text-sm font-medium text-white rounded transition-colors"
            style={{ backgroundColor: '#4C7DF0' }}
          >
            Exclude Low-Confidence Sections
          </button>
          <button
            onClick={onIncludeWithWarnings}
            className="w-full px-4 py-2 text-sm font-medium rounded border transition-colors"
            style={{ borderColor: '#4C7DF0', color: '#4C7DF0' }}
          >
            Include with Warnings
          </button>
          <button
            ref={cancelButtonRef}
            onClick={onClose}
            className="w-full px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
