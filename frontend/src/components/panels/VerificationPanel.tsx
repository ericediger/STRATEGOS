import { useState, useRef } from 'react';
import {
  CheckCircle,
  Loader2,
  ShieldCheck,
  FileText,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  RotateCcw,
  Upload,
} from 'lucide-react';
import { sanitizeContent } from '../../lib/sanitize';
import { PhaseErrorCard } from './PhaseErrorCard';
import type { VerificationPanelProps, Phase } from './types';

function getStepStatus(
  stepKey: string,
  currentStep: string | null,
  progress: number,
): 'pending' | 'current' | 'complete' {
  const stepOrder = ['consolidate', 'extract', 'investigate', 'adjudicate', 'consensus', 'report'];
  const stepIndex = stepOrder.indexOf(stepKey);
  const currentStepLower = (currentStep || '').toLowerCase();

  // Map the display name back to key
  const currentKey = stepOrder.find(s =>
    currentStepLower.includes(s)
  ) || currentStepLower;

  const currentIndex = stepOrder.indexOf(currentKey);

  if (currentIndex < 0) return progress >= 100 ? 'complete' : 'pending';
  if (stepIndex < currentIndex) return 'complete';
  if (stepIndex === currentIndex) return 'current';
  return 'pending';
}

export function VerificationPanel({
  verification,
  currentPhase,
  projectStatus,
  projectId: _projectId,
  onStartVerification,
  isStartingVerification,
  errorMessage,
  onRetryVerification,
  isRetryingVerification,
  onImport,
  isImporting,
  onRerun,
}: VerificationPanelProps) {
  const [reportExpanded, setReportExpanded] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  const phaseOrder: Phase[] = ['collaboration', 'research', 'verification', 'analysis', 'artifacts'];
  const phaseIndex = phaseOrder.indexOf('verification');
  const currentIndex = phaseOrder.indexOf(currentPhase);
  const isLocked = phaseIndex > currentIndex;
  const isCurrent = currentPhase === 'verification';
  const isComplete = phaseIndex < currentIndex || verification.completed;
  const isRunning = verification.status === 'running';
  const isFailed = verification.status === 'failed' || projectStatus === 'verification_failed';
  const canStart = projectStatus === 'research_complete' && verification.status === 'pending';

  const PIPELINE_STEPS = [
    { key: 'consolidate', label: 'Collecting research' },
    { key: 'extract', label: 'Identifying claims' },
    { key: 'investigate', label: 'Checking sources' },
    { key: 'adjudicate', label: 'Evaluating evidence' },
    { key: 'consensus', label: 'Cross-validating' },
    { key: 'report', label: 'Writing report' },
  ];

  const gateColor = verification.gateStatus === 'PASSED'
    ? 'text-status-complete-fg bg-status-complete-bg'
    : 'text-status-blocked-fg bg-status-blocked-bg';

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
            <ShieldCheck className={`w-5 h-5 ${isLocked ? 'text-text-subtle' : 'text-status-running-fg'}`} />
          )}
          <div>
            <h2 className={`text-xl font-display font-semibold ${isLocked ? 'text-text-muted' : 'text-text-heading'}`}>
              Source Verification
            </h2>
            <p className="text-sm text-text-muted mt-0.5">
              Verifying research claims against original sources — Source verification typically takes 15-30 minutes
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
            <span className="px-2 py-1 text-xs font-medium bg-surface border border-surface-border rounded text-text-subtle" title="All research teams must complete before verification can begin">
              Locked
            </span>
          )}
          {isRunning && (
            <span className="px-2 py-1 text-xs font-medium bg-status-running-bg text-status-running-fg rounded">
              Verifying
            </span>
          )}
          {isComplete && verification.gateStatus && (
            <span className={`px-2 py-1 text-xs font-medium rounded ${gateColor}`}>
              {verification.gateStatus === 'PASSED' ? 'Strong Source Quality' : 'Review Recommended'}
            </span>
          )}
          {isFailed && (
            <span className="px-2 py-1 text-xs font-medium bg-status-blocked-bg text-status-blocked-fg rounded">
              Failed
            </span>
          )}
        </div>
      </div>

      {/* Start Verification / Import Report Buttons */}
      {canStart && (
        <div className="mb-4 flex items-center gap-3">
          <button
            onClick={onStartVerification}
            disabled={isStartingVerification}
            className="flex items-center gap-2 px-4 py-2 bg-status-running-bg text-status-running-fg hover:opacity-90 rounded text-sm font-medium disabled:opacity-50 transition-colors"
          >
            {isStartingVerification ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ShieldCheck className="w-4 h-4" />
            )}
            {isStartingVerification ? 'Starting Verification...' : 'Start Verification'}
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
            Import Report
          </button>
        </div>
      )}

      {/* Error State */}
      {isFailed && projectStatus === 'verification_failed' && (
        <PhaseErrorCard
          title="Verification Failed"
          errorMessage={errorMessage}
          onRetry={onRetryVerification}
          isRetrying={isRetryingVerification}
        />
      )}

      {/* Stale state: project says verifying but verification service has no progress */}
      {projectStatus === 'verifying' && !isRunning && !isComplete && !isFailed && (
        <div className="mb-4 p-4 bg-status-attention-bg/10 border border-status-attention-fg/20 rounded-lg">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-status-attention-fg flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-text-heading">Verification may have stalled</p>
              <p className="text-sm text-text-muted mt-1">
                The verification service appears to have lost track of this task. This can happen if the service was restarted. You can retry to start a fresh verification run.
              </p>
              <button
                onClick={onRetryVerification}
                disabled={isRetryingVerification}
                className="mt-3 flex items-center gap-2 px-3 py-1.5 bg-status-running-bg text-status-running-fg hover:opacity-90 rounded text-sm font-medium disabled:opacity-50 transition-colors"
              >
                {isRetryingVerification ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                Retry Verification
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Progress Bar + Current Step (when running) */}
      {isRunning && (
        <div className="mb-4 space-y-3">
          <div className="w-full bg-surface-overlay rounded-full h-2">
            <div
              className="bg-status-running-fg h-2 rounded-full transition-all duration-500"
              style={{ width: `${verification.progress}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-text-muted">
            <span>{verification.currentStep || 'Starting...'}</span>
            <span>{verification.progress}%</span>
          </div>
          <div className="flex gap-1">
            {PIPELINE_STEPS.map((step) => {
              const stepProgress = getStepStatus(step.key, verification.currentStep, verification.progress);
              return (
                <div
                  key={step.key}
                  className={`flex-1 px-2 py-1 rounded text-center text-xs transition-colors ${
                    stepProgress === 'complete'
                      ? 'bg-status-complete-bg/30 text-status-complete-fg'
                      : stepProgress === 'current'
                      ? 'bg-status-running-bg/30 text-status-running-fg border border-status-running-border'
                      : 'bg-surface-overlay text-text-subtle'
                  }`}
                >
                  {step.label}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Error Display */}
      {isFailed && verification.error && (
        <div className="mb-4 p-3 bg-status-blocked-bg/20 border border-status-blocked-fg/20 rounded">
          <p className="text-sm text-status-blocked-fg">{verification.error}</p>
        </div>
      )}

      {/* Quality Gate Results (when complete) */}
      {isComplete && verification.gateStatus && (
        <div className="space-y-3">
          {/* Plain-language summary */}
          <div className={`p-3 rounded-lg border ${
            verification.gateStatus === 'PASSED'
              ? 'bg-status-complete-bg/10 border-status-complete-fg/20'
              : 'bg-status-attention-bg/10 border-status-attention-fg/20'
          }`}>
            <p className="text-sm text-text leading-relaxed">
              {verification.gateStatus === 'PASSED'
                ? `This research has strong source quality. ${verification.issueRate != null ? `${(100 - verification.issueRate * 100).toFixed(0)}%` : 'Most'} of claims are verified from primary sources. Safe to proceed with strategic analysis.`
                : `This research contains ${verification.claimCount ?? 'multiple'} claims. ${verification.issueRate != null ? `${(100 - verification.issueRate * 100).toFixed(0)}%` : 'Most'} are fully verified from primary sources. ${verification.issueRate != null ? `${(verification.issueRate * 100).toFixed(0)}%` : 'Some'} rely on indirect evidence, which is typical for competitive intelligence research. The findings are suitable for strategic planning with appropriate caveats.`
              }
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 bg-surface rounded border border-surface-border text-center">
              <div className="text-lg font-bold text-text-heading">{verification.claimCount ?? '—'}</div>
              <div className="text-xs text-text-muted">Total Claims Analyzed</div>
            </div>
            <div className="p-3 bg-surface rounded border border-surface-border text-center">
              <div className="text-lg font-bold text-text-heading">
                {verification.issueRate != null ? `${(verification.issueRate * 100).toFixed(1)}%` : '—'}
              </div>
              <div className="text-xs text-text-muted">Claims Requiring Additional Evidence</div>
            </div>
            <div className={`p-3 rounded border text-center ${
              verification.gateStatus === 'PASSED'
                ? 'bg-status-complete-bg/20 border-status-complete-fg/20'
                : 'bg-status-blocked-bg/20 border-status-blocked-fg/20'
            }`}>
              <div className={`text-lg font-bold ${
                verification.gateStatus === 'PASSED' ? 'text-status-complete-fg' : 'text-status-blocked-fg'
              }`}>
                {verification.gateStatus === 'PASSED' ? 'Strong' : 'Review Needed'}
              </div>
              <div className="text-xs text-text-muted">Source Quality</div>
            </div>
          </div>

          {/* Expandable Report */}
          {verification.reportContent && (
            <div className="bg-surface rounded-lg border border-surface-border">
              <button
                onClick={() => setReportExpanded(!reportExpanded)}
                className="w-full flex items-center justify-between p-4 hover:bg-surface-overlay rounded-lg transition-colors"
              >
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-status-running-fg" />
                  <h3 className="text-sm font-medium text-text-heading">Verification Report</h3>
                </div>
                <div className="flex items-center gap-2 text-text-muted">
                  <span className="text-xs">{reportExpanded ? 'Collapse' : 'View Full Report'}</span>
                  {reportExpanded ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </div>
              </button>

              {reportExpanded && (
                <div className="px-4 pb-4 max-h-[70vh] overflow-y-auto scrollbar-thin">
                  <div className="prose prose-invert prose-sm max-w-none text-text whitespace-pre-wrap text-sm leading-relaxed">
                    {sanitizeContent(verification.reportContent || '')}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
