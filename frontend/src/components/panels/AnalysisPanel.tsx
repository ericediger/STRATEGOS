import { useState, useRef } from 'react';
import {
  CheckCircle,
  Loader2,
  Brain,
  FileText,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  RotateCcw,
  Upload,
} from 'lucide-react';
import { sanitizeContent } from '../../lib/sanitize';
import { PhaseErrorCard } from './PhaseErrorCard';
import type { AnalysisPanelProps, Phase } from './types';

export function AnalysisPanel({
  analysis,
  currentPhase,
  projectStatus,
  projectId: _projectId,
  onStartAnalysis,
  isStartingAnalysis,
  errorMessage,
  onRetryAnalysis,
  isRetryingAnalysis,
  onImport,
  isImporting,
  onRerun,
}: AnalysisPanelProps) {
  const [assessmentExpanded, setAssessmentExpanded] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  const phaseOrder: Phase[] = ['collaboration', 'research', 'verification', 'analysis', 'artifacts'];
  const phaseIndex = phaseOrder.indexOf('analysis');
  const currentIndex = phaseOrder.indexOf(currentPhase);
  const isLocked = phaseIndex > currentIndex;
  const isCurrent = currentPhase === 'analysis';
  const isComplete = analysis.completed;
  const isRunning = analysis.status === 'running';
  const isFailed = analysis.status === 'failed' || projectStatus === 'analysis_failed';
  const canStart = projectStatus === 'verification_complete';

  return (
    <section className={`p-5 rounded-lg border transition-colors ${
      isComplete
        ? 'bg-status-complete-bg/10 border-status-complete-fg/20'
        : isCurrent
        ? 'bg-surface-raised border-status-running-border'
        : 'bg-surface-raised border-surface-border opacity-60'
    }`}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          {isComplete ? (
            <CheckCircle className="w-5 h-5 text-status-complete-fg" />
          ) : isRunning ? (
            <Loader2 className="w-5 h-5 animate-spin text-status-running-fg" />
          ) : isFailed ? (
            <AlertCircle className="w-5 h-5 text-status-blocked-fg" />
          ) : (
            <Brain className={`w-5 h-5 ${isLocked ? 'text-text-subtle' : 'text-status-running-fg'}`} />
          )}
          <div>
            <h2 className={`text-xl font-display font-semibold ${isLocked ? 'text-text-muted' : 'text-text-heading'}`}>
              Strategic Analysis
            </h2>
            <p className="text-sm text-text-muted mt-0.5">
              AI-powered competitive analysis and insight synthesis — Strategic analysis typically takes 2-5 minutes
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
          {isLocked && (
            <span className="px-2 py-1 text-xs font-medium bg-surface border border-surface-border rounded text-text-subtle" title="Source verification must complete before analysis can begin">
              Locked
            </span>
          )}
          {isRunning && (
            <span className="px-2 py-1 text-xs font-medium bg-status-running-bg text-status-running-fg rounded">
              Analyzing
            </span>
          )}
          {isComplete && analysis.wordCount && (
            <span className="px-2 py-1 text-xs font-medium bg-status-complete-bg text-status-complete-fg rounded">
              {analysis.wordCount.toLocaleString()} words
            </span>
          )}
          {isFailed && (
            <span className="px-2 py-1 text-xs font-medium bg-status-blocked-bg text-status-blocked-fg rounded">
              Failed
            </span>
          )}
        </div>
      </div>

      {/* Start Analysis / Import Assessment Buttons */}
      {canStart && !isRunning && !isComplete && (
        <div className="mb-4 flex items-center gap-3">
          <button
            onClick={onStartAnalysis}
            disabled={isStartingAnalysis}
            className="flex items-center gap-2 px-4 py-2 bg-status-running-bg text-status-running-fg hover:opacity-90 rounded text-sm font-medium disabled:opacity-50 transition-colors"
          >
            {isStartingAnalysis ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Brain className="w-4 h-4" />
            )}
            {isStartingAnalysis ? 'Starting Analysis...' : 'Start Strategic Analysis'}
          </button>
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
            Import Assessment
          </button>
        </div>
      )}

      {/* Running state */}
      {isRunning && (
        <div className="mb-4 p-4 bg-surface rounded-lg border border-surface-border">
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 animate-spin text-status-running-fg" />
            <div>
              <p className="text-sm font-medium text-text">Synthesizing strategic assessment...</p>
              <p className="text-xs text-text-muted mt-1">
                Analyzing research from 3 providers with verification data. This typically takes 2-5 minutes.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Error State */}
      {isFailed && (
        <PhaseErrorCard
          title="Analysis Failed"
          errorMessage={errorMessage}
          onRetry={onRetryAnalysis}
          isRetrying={isRetryingAnalysis}
        />
      )}

      {/* Expandable Assessment (when complete) */}
      {isComplete && analysis.assessmentContent && (
        <div className="bg-surface rounded-lg border border-surface-border">
          <button
            onClick={() => setAssessmentExpanded(!assessmentExpanded)}
            className="w-full flex items-center justify-between p-4 hover:bg-surface-overlay rounded-lg transition-colors"
          >
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-status-running-fg" />
              <h3 className="text-sm font-medium text-text-heading">Strategic Assessment</h3>
              <span className="text-xs text-text-subtle">{analysis.wordCount?.toLocaleString()} words</span>
            </div>
            <div className="flex items-center gap-2 text-text-muted">
              <span className="text-xs">{assessmentExpanded ? 'Collapse' : 'View Full Assessment'}</span>
              {assessmentExpanded ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </div>
          </button>

          {!assessmentExpanded && (
            <div className="px-4 pb-4 text-sm text-text-muted line-clamp-3 whitespace-pre-wrap">
              {sanitizeContent(analysis.assessmentContent.slice(0, 300))}...
            </div>
          )}

          {assessmentExpanded && (
            <div className="px-4 pb-4 max-h-[70vh] overflow-y-auto scrollbar-thin">
              <div className="prose prose-invert prose-sm max-w-none text-text whitespace-pre-wrap text-sm leading-relaxed">
                {sanitizeContent(analysis.assessmentContent)}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
