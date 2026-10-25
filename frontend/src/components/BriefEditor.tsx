/**
 * BriefEditor — Side-by-side markdown editor with live preview.
 *
 * Used in the CollaborationPanel for editing Research Briefs.
 * Left pane: monospace textarea for markdown source.
 * Right pane: rendered markdown preview (react-markdown + remark-gfm).
 */

import { useState, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Pencil, Save, X, Upload, Loader2 } from 'lucide-react';
import { ConfirmDialog } from './ConfirmDialog';

interface BriefEditorProps {
  content: string;
  projectStatus: string;
  onSave: (content: string) => void;
  isSaving: boolean;
  onUploadReplacement?: (content: string, fileName: string) => void;
}

export function BriefEditor({
  content,
  projectStatus,
  onSave,
  isSaving,
  onUploadReplacement,
}: BriefEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(content);
  const [showPostApprovalWarning, setShowPostApprovalWarning] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);

  const isPastApproval = !['not_started', 'collaborating', 'brief_generated'].includes(projectStatus);

  const handleEdit = () => {
    setEditContent(content);
    setIsEditing(true);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditContent(content);
  };

  const handleSave = useCallback(() => {
    if (isPastApproval) {
      setShowPostApprovalWarning(true);
    } else {
      onSave(editContent);
      setIsEditing(false);
    }
  }, [isPastApproval, editContent, onSave]);

  const handleConfirmSave = () => {
    onSave(editContent);
    setShowPostApprovalWarning(false);
    setIsEditing(false);
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const fileContent = reader.result as string;
      if (isEditing) {
        // In edit mode: replace textarea content (user must click Save)
        setEditContent(fileContent);
      } else if (onUploadReplacement) {
        onUploadReplacement(fileContent, file.name);
      }
    };
    reader.readAsText(file);

    // Reset input so the same file can be re-selected
    e.target.value = '';
  };

  const editWordCount = editContent.split(/\s+/).filter(Boolean).length;

  if (!isEditing) {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={handleEdit}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border border-surface-border rounded text-text-muted hover:bg-surface-overlay transition-colors"
        >
          <Pencil className="w-3.5 h-3.5" />
          Edit Brief
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="mt-4 bg-surface rounded-lg border border-surface-border overflow-hidden">
        {/* Editor toolbar */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-surface-border bg-surface-raised">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-text-heading">Edit Research Brief</span>
            <span className="text-xs text-text-subtle">{editWordCount.toLocaleString()} words</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={uploadRef}
              type="file"
              accept=".md,.txt"
              className="hidden"
              onChange={handleUpload}
            />
            <button
              onClick={() => uploadRef.current?.click()}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border border-surface-border rounded text-text-muted hover:bg-surface-overlay transition-colors"
              title="Upload a file to replace editor content"
            >
              <Upload className="w-3 h-3" />
              Upload
            </button>
            <button
              onClick={handleCancel}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border border-surface-border rounded text-text-muted hover:bg-surface-overlay transition-colors"
            >
              <X className="w-3 h-3" />
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving || editContent === content}
              className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-status-complete-bg text-status-complete-fg rounded hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSaving ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Save className="w-3 h-3" />
              )}
              Save
            </button>
          </div>
        </div>

        {/* Side-by-side editor + preview */}
        <div className="grid grid-cols-2 divide-x divide-brand-blue/30 min-h-[400px]">
          {/* Left: Markdown source */}
          <div className="relative">
            <div className="absolute top-2 left-3 text-[10px] uppercase tracking-wider text-text-subtle font-medium">
              Markdown
            </div>
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="w-full h-full min-h-[400px] p-4 pt-7 bg-brand-dark-blue text-gray-100 font-mono text-sm leading-relaxed resize-y outline-none placeholder:text-text-subtle"
              placeholder="Enter your research brief in Markdown..."
              spellCheck={false}
            />
          </div>

          {/* Right: Rendered preview */}
          <div className="relative overflow-y-auto max-h-[70vh]">
            <div className="absolute top-2 left-3 text-[10px] uppercase tracking-wider text-text-subtle font-medium z-10">
              Preview
            </div>
            <div className="p-4 pt-7 prose prose-sm max-w-none text-text leading-relaxed
              prose-headings:text-text-heading prose-headings:font-display
              prose-h1:text-lg prose-h2:text-base prose-h3:text-sm
              prose-p:text-text prose-p:text-sm
              prose-strong:text-text-heading
              prose-li:text-text prose-li:text-sm
              prose-a:text-brand-blue
              prose-code:text-brand-green prose-code:bg-surface-overlay prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs
              prose-pre:bg-surface-overlay prose-pre:rounded-lg
              prose-table:text-sm prose-th:text-text-heading prose-td:text-text
              prose-blockquote:border-brand-blue prose-blockquote:text-text-muted
              prose-hr:border-surface-border
            ">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {editContent}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      </div>

      {/* Post-approval save warning */}
      <ConfirmDialog
        isOpen={showPostApprovalWarning}
        onClose={() => setShowPostApprovalWarning(false)}
        onConfirm={handleConfirmSave}
        isConfirming={isSaving}
        title="Edit Brief After Approval"
        message="You've edited the brief after approval. Downstream phases (Research, Verification, Analysis, Deliverables) were built from the original brief. You can re-run them from the dashboard when ready."
        confirmLabel="Save Changes"
      />
    </>
  );
}
