/**
 * Export Button Component
 *
 * Dropdown button for generating artifacts as Word (.docx) or PowerPoint (.pptx).
 * States: default, generating (spinner), error (toast), success (browser download).
 * Shows instant "Re-download" links when exports already exist.
 * Confirm dialog when generating with an existing export.
 */

import { useState, useRef, useEffect } from 'react';
import { Sparkles, ChevronDown, Loader2, FileText, Presentation, Download } from 'lucide-react';
import { useExportArtifact } from '../hooks/useProjects';
import { exportApi } from '../lib/api';
import { ConfirmDialog } from './ConfirmDialog';

interface ExportButtonProps {
  projectId: string;
  artifactType: string;
  availableExports?: string[];
  lastExportedAt?: string | null;
}

export function ExportButton({ projectId, artifactType, availableExports = [], lastExportedAt }: ExportButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const exportMutation = useExportArtifact(projectId);

  const isGenerating = exportMutation.isPending;
  const [generatingFormat, setGeneratingFormat] = useState<'docx' | 'pptx' | null>(null);
  const [confirmGenerate, setConfirmGenerate] = useState<'docx' | 'pptx' | null>(null);

  const hasExistingExports = availableExports.length > 0;

  // Close dropdown on outside click
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Reset generating format when mutation settles
  useEffect(() => {
    if (!exportMutation.isPending) {
      setGeneratingFormat(null);
    }
  }, [exportMutation.isPending]);

  const doExport = (format: 'docx' | 'pptx') => {
    setGeneratingFormat(format);
    exportMutation.mutate({ artifactType, format });
  };

  const handleExport = (format: 'docx' | 'pptx') => {
    setIsOpen(false);
    if (hasExistingExports) {
      setConfirmGenerate(format);
    } else {
      doExport(format);
    }
  };

  const handleConfirmGenerate = () => {
    if (confirmGenerate) {
      doExport(confirmGenerate);
      setConfirmGenerate(null);
    }
  };

  const formatLabel = generatingFormat === 'pptx' ? 'Presentation' : 'Word Document';

  const exportDate = lastExportedAt
    ? new Date(lastExportedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null;

  return (
    <div ref={dropdownRef} className="relative flex items-center gap-1.5">
      {/* Re-download links for existing exports */}
      {availableExports.map((filename) => (
        <a
          key={filename}
          href={exportApi.downloadUrl(projectId, filename)}
          onClick={(e) => e.stopPropagation()}
          className="flex items-center gap-1 px-1.5 py-1 text-xs text-brand-blue hover:text-brand-blue-hover transition-colors"
          title={`Re-download ${filename}`}
        >
          <Download className="w-3 h-3" />
          <span>{filename.endsWith('.pptx') ? '.pptx' : '.docx'}</span>
        </a>
      ))}

      {/* Generate button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (!isGenerating) setIsOpen(!isOpen);
        }}
        disabled={isGenerating}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-text-muted border border-surface-border rounded hover:bg-surface-overlay hover:text-text transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {isGenerating ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Generating {formatLabel}...</span>
          </>
        ) : (
          <>
            <Sparkles className="w-3.5 h-3.5" />
            <span>Generate</span>
            <ChevronDown className="w-3 h-3" />
          </>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-1 z-20 w-52 bg-surface-raised border border-surface-border rounded-lg shadow-lg overflow-hidden animate-fade-in">
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleExport('docx');
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-text hover:bg-surface-overlay transition-colors"
          >
            <FileText className="w-4 h-4 text-brand-blue" />
            Generate Word Document
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleExport('pptx');
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-text hover:bg-surface-overlay transition-colors border-t border-surface-border-subtle"
          >
            <Presentation className="w-4 h-4 text-brand-magenta" />
            Generate Presentation
          </button>
        </div>
      )}

      <ConfirmDialog
        isOpen={!!confirmGenerate}
        onClose={() => setConfirmGenerate(null)}
        onConfirm={handleConfirmGenerate}
        title="Re-generate Export?"
        message={exportDate
          ? `You previously exported this deliverable on ${exportDate}. Generating again will create a new file from the current content.`
          : `An export already exists for this deliverable. Generating again will create a new file from the current content.`
        }
        confirmLabel={`Generate ${confirmGenerate === 'pptx' ? 'Presentation' : 'Word Document'}`}
      />
    </div>
  );
}
