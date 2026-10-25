/**
 * Save as Dossier Dialog
 *
 * Modal dialog for creating a competitor dossier from a completed project.
 * Follows the ConfirmDialog pattern for overlay, focus trap, escape/backdrop close.
 */

import { useState, useEffect, useRef } from 'react';
import { X, BookmarkPlus } from 'lucide-react';
import { useCreateDossierFromProject } from '../hooks/useDossiers';

interface SaveAsDossierDialogProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
}

export function SaveAsDossierDialog({
  isOpen,
  onClose,
  projectId,
  projectName,
}: SaveAsDossierDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const createDossier = useCreateDossierFromProject();

  const [competitorName, setCompetitorName] = useState('');
  const [industry, setIndustry] = useState('');
  const [description, setDescription] = useState('');

  // Pre-populate competitor name from project name on open
  useEffect(() => {
    if (isOpen) {
      setCompetitorName(projectName || '');
      setIndustry('');
      setDescription('');
      // Focus the name input when dialog opens
      setTimeout(() => nameInputRef.current?.focus(), 50);
    }
  }, [isOpen, projectName]);

  // Focus management and keyboard handling
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !dialogRef.current) return;

      const focusableElements = dialogRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (e.shiftKey && document.activeElement === firstElement) {
        e.preventDefault();
        lastElement.focus();
      } else if (!e.shiftKey && document.activeElement === lastElement) {
        e.preventDefault();
        firstElement.focus();
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!competitorName.trim()) return;

    createDossier.mutate(
      {
        projectId,
        body: {
          competitorName: competitorName.trim(),
          industry: industry.trim() || undefined,
          description: description.trim() || undefined,
        },
      },
      { onSuccess: () => onClose() }
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-brand-dark-blue/80 backdrop-blur-sm"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="dossier-dialog-title"
    >
      <div
        ref={dialogRef}
        className="bg-white rounded-lg shadow-2xl max-w-md w-full mx-4 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <BookmarkPlus className="w-5 h-5 text-brand-blue" />
            <h2 id="dossier-dialog-title" className="text-lg font-display font-semibold text-brand-dark-blue">
              Save as Dossier
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
        <form onSubmit={handleSubmit}>
          <div className="px-6 py-4 space-y-4">
            <div>
              <label htmlFor="dossier-name" className="block text-sm font-medium text-gray-700 mb-1">
                Competitor Name <span className="text-brand-magenta">*</span>
              </label>
              <input
                ref={nameInputRef}
                id="dossier-name"
                type="text"
                value={competitorName}
                onChange={(e) => setCompetitorName(e.target.value)}
                placeholder="e.g., Acme Corp"
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-brand-blue focus:ring-1 focus:ring-brand-blue"
                required
              />
            </div>

            <div>
              <label htmlFor="dossier-industry" className="block text-sm font-medium text-gray-700 mb-1">
                Industry
              </label>
              <input
                id="dossier-industry"
                type="text"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                placeholder="e.g., Enterprise SaaS"
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-brand-blue focus:ring-1 focus:ring-brand-blue"
              />
            </div>

            <div>
              <label htmlFor="dossier-description" className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <textarea
                id="dossier-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief notes about this competitor..."
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-brand-blue focus:ring-1 focus:ring-brand-blue resize-none"
              />
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 bg-gray-50 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              disabled={createDossier.isPending}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!competitorName.trim() || createDossier.isPending}
              className="px-4 py-2 text-sm font-medium text-white bg-brand-blue hover:bg-brand-blue-hover rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {createDossier.isPending ? 'Saving...' : 'Save Dossier'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
