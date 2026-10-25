import { useState, useRef } from 'react';
import {
  CheckCircle,
  Loader2,
  Search,
  ChevronDown,
  ChevronUp,
  XCircle,
  AlertCircle,
  RotateCcw,
  Upload,
  Square,
  StopCircle,
} from 'lucide-react';
import { sanitizeContent } from '../../lib/sanitize';
import { PhaseErrorCard } from './PhaseErrorCard';
import type { ResearchPanelProps, Phase, ProviderStatus } from './types';

export function ResearchPanel({ research, currentPhase, projectStatus, projectId: _projectId, onStartResearch, isStartingResearch, errorMessage, onRetryResearch, isRetryingResearch, onImport, isImporting, onRerun, onRerunProvider, isRerunningProvider, onStopAll, onStopProvider, isStopping }: ResearchPanelProps) {
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const phaseOrder: Phase[] = ['collaboration', 'research', 'verification', 'analysis', 'artifacts'];
  const phaseIndex = phaseOrder.indexOf('research');
  const currentIndex = phaseOrder.indexOf(currentPhase);
  const isLocked = phaseIndex > currentIndex;
  const isCurrent = currentPhase === 'research';
  const isComplete = phaseIndex < currentIndex;
  const isFailed = projectStatus === 'research_failed';

  // Dynamic research providers — support both standard (kimi/gemini/edr) and imported files
  const researchKeys = Object.keys(research);
  const providers = researchKeys.map(key => {
    const defaultLabels: Record<string, { label: string; description: string }> = {
      kimi: { label: 'Research Team A', description: 'Comprehensive web research and competitive analysis' },
      gemini: { label: 'Research Team B', description: 'Industry analysis and market dynamics research' },
      edr: { label: 'Research Team C', description: 'Cross-source investigation and deep-dive research' },
    };
    return {
      key,
      label: defaultLabels[key]?.label || key.charAt(0).toUpperCase() + key.slice(1),
      description: defaultLabels[key]?.description || 'Imported research document',
    };
  });

  const allComplete = researchKeys.length > 0 && researchKeys.every(k => research[k]?.status === 'complete');
  const anyRunning = researchKeys.some(k => research[k]?.status === 'running');
  const completedCount = researchKeys.filter(k => research[k]?.status === 'complete').length;
  const totalCount = researchKeys.length || 3;

  const toggleProvider = (key: string) => {
    setExpandedProvider(prev => prev === key ? null : key);
  };

  const anyFailed = researchKeys.some(k => research[k]?.status === 'failed');
  const anyStopped = researchKeys.some(k => research[k]?.status === 'stopped');
  const allStoppedOrComplete = researchKeys.length > 0 && researchKeys.every(k => ['stopped', 'complete'].includes(research[k]?.status));
  const hasCompletedAndStopped = anyStopped && completedCount > 0 && allStoppedOrComplete;
  const failedProviderLabels = providers.filter(p => research[p.key]?.status === 'failed').map(p => p.label);
  const isDegradedComplete = (isComplete || allComplete) && anyFailed && completedCount > 0;

  const statusBadge = (status: ProviderStatus['status']) => {
    const styles: Record<string, string> = {
      pending: 'bg-surface border border-surface-border text-text-subtle',
      running: 'bg-status-running-bg text-status-running-fg',
      complete: 'bg-status-complete-bg text-status-complete-fg',
      failed: 'bg-status-blocked-bg text-status-blocked-fg',
      stopped: 'bg-amber-100 text-amber-700 border border-amber-300',
    };
    const labels: Record<string, string> = {
      pending: 'Pending',
      running: 'Running',
      complete: 'Complete',
      failed: 'Failed',
      stopped: 'Stopped',
    };
    return (
      <span className={`px-2 py-0.5 text-xs font-medium rounded ${styles[status] || styles.pending}`}>
        {labels[status] || status}
      </span>
    );
  };

  return (
    <section className={`p-5 rounded-lg border transition-colors ${
      isComplete || allComplete
        ? 'bg-status-complete-bg/10 border-status-complete-fg/20'
        : isCurrent
        ? 'bg-surface-raised border-status-running-border'
        : 'bg-surface-raised border-surface-border opacity-60'
    }`}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          {isComplete || allComplete ? (
            <CheckCircle className="w-5 h-5 text-status-complete-fg" />
          ) : anyRunning ? (
            <Loader2 className="w-5 h-5 animate-spin text-status-running-fg" />
          ) : (
            <Search className={`w-5 h-5 ${isLocked ? 'text-text-subtle' : 'text-status-running-fg'}`} />
          )}
          <div>
            <h2 className={`text-xl font-display font-semibold ${isLocked ? 'text-text-muted' : 'text-text-heading'}`}>
              Deep Research
            </h2>
            <p className="text-sm text-text-muted mt-0.5">
              Three independent research teams investigate simultaneously — Deep research typically takes 2-4 hours
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {(isComplete || allComplete) && (
            <button
              onClick={onRerun}
              className="flex items-center gap-1 px-2 py-1 text-xs font-medium border border-surface-border rounded text-text-muted hover:bg-surface-overlay transition-colors"
              title="Re-run this phase"
            >
              <RotateCcw className="w-3 h-3" />
              Re-run
            </button>
          )}
          {projectStatus === 'researching' && (
            <button
              onClick={onStopAll}
              disabled={isStopping}
              className="flex items-center gap-1 px-2 py-1 text-xs font-medium border border-brand-magenta/50 rounded text-brand-magenta hover:bg-brand-magenta/10 transition-colors disabled:opacity-50"
              title="Stop all research"
            >
              {isStopping ? <Loader2 className="w-3 h-3 animate-spin" /> : <Square className="w-3 h-3" />}
              Stop All
            </button>
          )}
          {!isLocked && (
            <span className="px-2 py-1 text-xs font-medium bg-surface border border-surface-border rounded text-text-muted">
              {completedCount}/{totalCount} complete
            </span>
          )}
          {isLocked && (
            <span className="px-2 py-1 text-xs font-medium bg-surface border border-surface-border rounded text-text-subtle" title="Complete the research scoping phase to unlock">
              Locked
            </span>
          )}
          {projectStatus === 'researching' && (
            <span className="px-2 py-1 text-xs font-medium bg-status-running-bg text-status-running-fg rounded">
              In Process
            </span>
          )}
        </div>
      </div>

      {/* Start Research / Import Research Buttons */}
      {projectStatus === 'brief_approved' && (
        <div className="mb-4 flex items-center gap-3">
          <button
            onClick={onStartResearch}
            disabled={isStartingResearch}
            className="flex items-center gap-2 px-4 py-2 bg-status-running-bg text-status-running-fg hover:opacity-90 rounded text-sm font-medium disabled:opacity-50 transition-colors"
          >
            {isStartingResearch ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Search className="w-4 h-4" />
            )}
            {isStartingResearch ? 'Starting Research...' : 'Start Deep Research'}
          </button>
          <input
            ref={importRef}
            type="file"
            accept=".md,.txt"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && onImport(e.target.files)}
          />
          <button
            onClick={() => importRef.current?.click()}
            disabled={isImporting}
            className="flex items-center gap-2 px-4 py-2 border border-surface-border hover:bg-surface-overlay rounded text-sm font-medium text-text-muted transition-colors disabled:opacity-50"
          >
            {isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            Import Research
          </button>
        </div>
      )}

      {/* Error State */}
      {isFailed && (
        <PhaseErrorCard
          title="Research Failed"
          errorMessage={errorMessage}
          onRetry={onRetryResearch}
          isRetrying={isRetryingResearch}
        />
      )}

      {/* Stale state: project says researching but no providers are running */}
      {projectStatus === 'researching' && !anyRunning && !allComplete && !isFailed && researchKeys.every(k => research[k]?.status === 'pending') && (
        <div className="mb-4 p-4 bg-status-attention-bg/10 border border-status-attention-fg/20 rounded-lg">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-status-attention-fg flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-text-heading">Research may have stalled</p>
              <p className="text-sm text-text-muted mt-1">
                The research service appears to have lost track of these tasks. This can happen if the service was restarted. You can retry to start a fresh research run.
              </p>
              <button
                onClick={onRetryResearch}
                disabled={isRetryingResearch}
                className="mt-3 flex items-center gap-2 px-3 py-1.5 bg-status-running-bg text-status-running-fg hover:opacity-90 rounded text-sm font-medium disabled:opacity-50 transition-colors"
              >
                {isRetryingResearch ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                Retry Research
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Degraded completion banner */}
      {isDegradedComplete && (
        <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-800">
                Research completed with {completedCount} of {totalCount} providers.
              </p>
              <p className="text-sm text-amber-700 mt-1">
                {failedProviderLabels.join(', ')} failed. Results may have reduced coverage.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Provider Cards */}
      {!isLocked && (
        <div className="space-y-3">
          <p className="text-sm text-text-muted leading-relaxed">
            Three independent research teams investigate your competitive landscape simultaneously. Using different sources and approaches, they ensure comprehensive coverage and cross-validation of findings.
          </p>
          <div className="space-y-2">
            {providers.map(({ key, label, description }) => {
            const provider = research[key];
            const isExpanded = expandedProvider === key;
            const hasContent = provider.status === 'complete' && provider.content;
            const isRunningOrPending = provider.status === 'pending' || provider.status === 'running';
            const isStopped = provider.status === 'stopped';

            return (
              <div key={key} className={`bg-surface rounded-lg border ${isStopped ? 'border-amber-300' : 'border-surface-border'}`}>
                <div className="flex items-center justify-between p-3">
                  <button
                    onClick={() => hasContent && toggleProvider(key)}
                    className={`flex items-center gap-3 flex-1 min-w-0 ${
                      hasContent ? 'hover:opacity-80 cursor-pointer' : 'cursor-default'
                    }`}
                  >
                    {isRunningOrPending && (
                      <Loader2 className="w-4 h-4 animate-spin text-status-running-fg flex-shrink-0" />
                    )}
                    {provider.status === 'complete' && (
                      <CheckCircle className="w-4 h-4 text-status-complete-fg flex-shrink-0" />
                    )}
                    {provider.status === 'failed' && (
                      <XCircle className="w-4 h-4 text-brand-magenta flex-shrink-0" />
                    )}
                    {isStopped && (
                      <StopCircle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                    )}
                    <div className="text-left">
                      <span className="text-sm font-medium text-text">{label}</span>
                      <span className="text-xs text-text-subtle ml-2">{description}</span>
                    </div>
                  </button>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {provider.wordCount && (
                      <span className="text-xs text-text-subtle">
                        {provider.wordCount.toLocaleString()} words
                      </span>
                    )}
                    {statusBadge(provider.status)}
                    {/* Per-provider stop button (visible when running/pending) */}
                    {isRunningOrPending && projectStatus === 'researching' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onStopProvider(key, label); }}
                        disabled={isStopping}
                        className="p-1 text-brand-magenta hover:bg-brand-magenta/10 rounded transition-colors disabled:opacity-50"
                        title={`Stop ${label}`}
                      >
                        <Square className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {/* Per-provider re-run button (visible when complete) */}
                    {provider.status === 'complete' && !anyRunning && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onRerunProvider(key, label); }}
                        disabled={isRerunningProvider}
                        className="p-1 text-text-muted hover:bg-surface-overlay rounded transition-colors disabled:opacity-50"
                        title={`Re-run ${label}`}
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {/* Per-provider re-run button for stopped providers */}
                    {isStopped && !anyRunning && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onRerunProvider(key, label); }}
                        disabled={isRerunningProvider}
                        className="p-1 text-amber-600 hover:bg-amber-50 rounded transition-colors disabled:opacity-50"
                        title={`Re-run ${label}`}
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {hasContent && (
                      <button onClick={() => toggleProvider(key)} className="p-1 text-text-muted hover:bg-surface-overlay rounded transition-colors">
                        {isExpanded
                          ? <ChevronUp className="w-4 h-4" />
                          : <ChevronDown className="w-4 h-4" />
                        }
                      </button>
                    )}
                  </div>
                </div>

                {isExpanded && hasContent && (
                  <div className="px-3 pb-3">
                    <div className="p-3 bg-surface-raised rounded border border-surface-border-subtle max-h-[60vh] overflow-y-auto scrollbar-thin">
                      <div className="text-sm text-text whitespace-pre-wrap leading-relaxed">
                        {sanitizeContent(provider.content || '')}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          </div>

          {/* Decision buttons for mixed stopped/complete state */}
          {hasCompletedAndStopped && !anyRunning && (
            <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-sm text-amber-800 mb-3">
                Some research providers were stopped. You can continue with the completed research or re-run the stopped providers.
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={onRerun}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-status-running-bg text-status-running-fg rounded hover:opacity-90 transition-colors"
                >
                  <CheckCircle className="w-3.5 h-3.5" />
                  Continue with completed research
                </button>
                <button
                  onClick={() => {
                    const stoppedKeys = researchKeys.filter(k => research[k]?.status === 'stopped');
                    stoppedKeys.forEach(k => {
                      const p = providers.find(p => p.key === k);
                      if (p) onRerunProvider(k, p.label);
                    });
                  }}
                  disabled={isRerunningProvider}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium border border-amber-300 text-amber-700 rounded hover:bg-amber-100 transition-colors disabled:opacity-50"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Re-run stopped
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
