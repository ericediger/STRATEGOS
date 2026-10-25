import { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircle,
  Loader2,
  MessageSquare,
  FileText,
  Sparkles,
  Eye,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Upload,
} from 'lucide-react';
import { sanitizeContent } from '../../lib/sanitize';
import { BriefEditor } from '../BriefEditor';
import { PhaseErrorCard } from './PhaseErrorCard';
import type { CollaborationPanelProps } from './types';

export function CollaborationPanel({
  projectId,
  status,
  messageCount,
  briefGenerated,
  briefApproved,
  briefData,
  briefLoading: _briefLoading,
  onApproveBrief,
  isApprovingBrief,
  onUpdateBrief,
  isUpdatingBrief,
  errorMessage,
  onRetrySynthesis,
  isRetryingSynthesis,
  onImport,
  isImporting,
  onRerun,
}: CollaborationPanelProps) {
  const [briefExpanded, setBriefExpanded] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const byobRef = useRef<HTMLInputElement>(null);
  const isFailed = status === 'brief_generation_failed';
  const isActive = ['not_started', 'collaborating', 'brief_generated'].includes(status);
  const isComplete = !['not_started', 'collaborating', 'brief_generated', 'brief_generation_failed'].includes(status);
  const showByob = (status === 'not_started' || status === 'collaborating') && !briefGenerated;

  return (
    <section className={`p-5 rounded-lg border transition-colors ${
      isComplete
        ? 'bg-status-complete-bg/10 border-status-complete-fg/20'
        : isActive
        ? 'bg-surface-raised border-status-running-border'
        : 'bg-surface-raised border-surface-border'
    }`}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          {isComplete ? (
            <CheckCircle className="w-5 h-5 text-status-complete-fg" />
          ) : (
            <MessageSquare className="w-5 h-5 text-status-running-fg" />
          )}
          <div>
            <h2 className="text-xl font-display font-semibold text-text-heading">Research Scoping</h2>
            <p className="text-sm text-text-muted mt-0.5">
              Define your competitive analysis scope through AI-guided conversation
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isComplete && (
            <button
              onClick={onRerun}
              className="flex items-center gap-1 px-2 py-1 text-xs font-medium border border-surface-border rounded text-text-muted hover:bg-surface-overlay transition-colors"
              title="Re-run this phase"
            >
              <RotateCcw className="w-3 h-3" />
              Re-run
            </button>
          )}
          {messageCount > 0 && (
            <span className="px-2 py-1 text-xs font-medium bg-surface border border-surface-border rounded text-text-muted">
              {messageCount} messages
            </span>
          )}
          {briefGenerated && !briefApproved && (
            <span className="px-2 py-1 text-xs font-medium bg-status-attention-bg text-status-attention-fg rounded">
              Research Brief ready for review
            </span>
          )}
          {briefApproved && (
            <span className="px-2 py-1 text-xs font-medium bg-status-complete-bg text-status-complete-fg rounded">
              Research Brief approved
            </span>
          )}
        </div>
      </div>

      {/* Dual-path layout: Collaborate with AI | Upload Your Own Brief */}
      {showByob && (
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="p-4 rounded-lg border border-surface-border bg-surface hover:bg-surface-overlay transition-colors">
            <div className="flex items-center gap-2 mb-2">
              <MessageSquare className="w-4 h-4 text-status-running-fg" />
              <h3 className="text-sm font-medium text-text-heading">Collaborate with AI</h3>
            </div>
            <p className="text-xs text-text-muted mb-3">
              Chat with an AI collaborator to define your research scope and competitive landscape.
            </p>
            <Link
              to={`/project/${projectId}/collaborate`}
              className="flex items-center gap-2 px-4 py-2 bg-interactive hover:bg-interactive-hover rounded text-sm font-medium text-text transition-colors w-fit"
            >
              <Sparkles className="w-4 h-4" />
              {status === 'not_started' ? 'Start Collaboration' : 'Continue Collaboration'}
            </Link>
          </div>
          <div className="p-4 rounded-lg border border-surface-border bg-surface hover:bg-surface-overlay transition-colors">
            <div className="flex items-center gap-2 mb-2">
              <Upload className="w-4 h-4 text-status-running-fg" />
              <h3 className="text-sm font-medium text-text-heading">Upload Your Own Brief</h3>
            </div>
            <p className="text-xs text-text-muted mb-3">
              Already have a strategy document? Upload it to skip straight to research.
            </p>
            <input
              ref={byobRef}
              type="file"
              accept=".md,.txt"
              className="hidden"
              onChange={(e) => e.target.files && onImport(e.target.files)}
            />
            <button
              onClick={() => byobRef.current?.click()}
              disabled={isImporting}
              className="flex items-center gap-2 px-4 py-2 border border-surface-border hover:bg-surface-overlay rounded text-sm font-medium text-text-muted transition-colors disabled:opacity-50"
            >
              {isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              Upload Brief
            </button>
          </div>
        </div>
      )}

      {/* Action buttons for states after dual-path */}
      <div className="flex items-center gap-3">
        {/* Continue collaboration when brief exists but no dual-path shown */}
        {(status === 'not_started' || status === 'collaborating') && briefGenerated && (
          <Link
            to={`/project/${projectId}/collaborate`}
            className="flex items-center gap-2 px-4 py-2 bg-interactive hover:bg-interactive-hover rounded text-sm font-medium text-text transition-colors"
          >
            <Sparkles className="w-4 h-4" />
            Continue Collaboration
          </Link>
        )}

        {/* Import Brief button — shown when brief exists but not yet approved */}
        {briefGenerated && !briefApproved && (
          <>
            <input
              ref={importRef}
              type="file"
              accept=".md,.txt"
              className="hidden"
              onChange={(e) => e.target.files && onImport(e.target.files)}
            />
            <button
              onClick={() => importRef.current?.click()}
              disabled={isImporting}
              className="flex items-center gap-2 px-4 py-2 border border-surface-border hover:bg-surface-overlay rounded text-sm font-medium text-text-muted transition-colors disabled:opacity-50"
            >
              {isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              Import Brief
            </button>
          </>
        )}

        {status === 'brief_generated' && (
          <>
            <Link
              to={`/project/${projectId}/collaborate`}
              className="flex items-center gap-2 px-4 py-2 bg-surface border border-surface-border hover:bg-surface-overlay rounded text-sm font-medium text-text transition-colors"
            >
              <MessageSquare className="w-4 h-4" />
              Continue Chat
            </Link>
            <div className="flex flex-col">
              <button
                onClick={onApproveBrief}
                disabled={isApprovingBrief}
                className="flex items-center gap-2 px-4 py-2 bg-status-complete-bg text-status-complete-fg hover:opacity-90 rounded text-sm font-medium disabled:opacity-50"
              >
                {isApprovingBrief ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle className="w-4 h-4" />
                )}
                Approve Brief & Start Research
              </button>
              <p className="text-xs text-text-subtle mt-1">Approving will start deep research (typically 2-4 hours)</p>
            </div>
          </>
        )}

        {isComplete && (
          <Link
            to={`/project/${projectId}/collaborate`}
            className="flex items-center gap-2 px-3 py-1.5 bg-surface border border-surface-border hover:bg-surface-overlay rounded text-sm text-text-muted transition-colors"
          >
            <Eye className="w-4 h-4" />
            View Chat
          </Link>
        )}
      </div>

      {isFailed && (
        <PhaseErrorCard
          title="Brief Generation Failed"
          errorMessage={errorMessage}
          onRetry={onRetrySynthesis}
          isRetrying={isRetryingSynthesis}
        />
      )}

      {briefGenerated && briefData && (
        <div className="mt-4 bg-surface rounded-lg border border-surface-border">
          <div className="flex items-center justify-between p-4">
            <button
              onClick={() => setBriefExpanded(!briefExpanded)}
              className="flex items-center gap-2 hover:bg-surface-overlay rounded-lg px-2 py-1 -ml-2 transition-colors"
            >
              <FileText className="w-4 h-4 text-status-running-fg" />
              <h3 className="text-sm font-medium text-text-heading">Research Brief</h3>
              <span className="text-xs text-text-subtle">{briefData.wordCount?.toLocaleString()} words</span>
              <span className="text-xs text-text-muted ml-1">{briefExpanded ? 'Collapse' : 'View Full Brief'}</span>
              {briefExpanded ? (
                <ChevronUp className="w-4 h-4 text-text-muted" />
              ) : (
                <ChevronDown className="w-4 h-4 text-text-muted" />
              )}
            </button>
            <BriefEditor
              content={briefData.content || ''}
              projectStatus={status}
              onSave={onUpdateBrief}
              isSaving={isUpdatingBrief}
            />
          </div>

          {!briefExpanded && (
            <div className="px-4 pb-4 text-sm text-text-muted line-clamp-3 whitespace-pre-wrap">
              {sanitizeContent(briefData.content?.slice(0, 300) || '')}...
            </div>
          )}

          {briefExpanded && (
            <div className="px-4 pb-4 max-h-[70vh] overflow-y-auto scrollbar-thin">
              <div className="prose prose-invert prose-sm max-w-none text-text whitespace-pre-wrap text-sm leading-relaxed">
                {sanitizeContent(briefData.content || '')}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
