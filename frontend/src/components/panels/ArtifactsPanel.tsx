import { useState, useRef, useEffect } from 'react';
import {
  CheckCircle,
  Loader2,
  FileText,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Sparkles,
  RotateCcw,
  StopCircle,
  Plus,
  Download,
} from 'lucide-react';
import { artifactsApi } from '../../lib/api';
import { sanitizeContent } from '../../lib/sanitize';
import { ExportButton } from '../ExportButton';
import { ConfidenceBadge } from '../ConfidenceBadge';
import { CustomerReadyDialog } from '../CustomerReadyDialog';
import { PhaseErrorCard } from './PhaseErrorCard';
import { useExportPacket } from '../../hooks/useProjects';
import type { ArtifactsPanelProps, Phase, SelectedArtifact } from './types';
import { ARTIFACT_TYPE_DEFS } from './types';

export function ArtifactsPanel({
  artifacts,
  analysis,
  currentPhase,
  projectStatus,
  projectId,
  confidence,
  errorMessage,
  onRetryArtifacts,
  isRetryingArtifacts,
  onSelectArtifacts,
  isSelectingArtifacts,
  onRerun,
  onRetryArtifact,
  isRetryingArtifact,
  onStopArtifacts,
}: ArtifactsPanelProps) {
  const defaultDefs = ARTIFACT_TYPE_DEFS.filter(d => d.tier === 'default');
  const additionalDefs = ARTIFACT_TYPE_DEFS.filter(d => d.tier === 'additional');

  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(
    () => new Set(defaultDefs.map(d => d.key))
  );
  const [showAdditionalFrameworks, setShowAdditionalFrameworks] = useState(false);
  const [expandedArtifact, setExpandedArtifact] = useState<string | null>(null);
  const [artifactContent, setArtifactContent] = useState<Record<string, { content: string; wordCount: number }>>({});
  const [loadingArtifact, setLoadingArtifact] = useState<string | null>(null);

  const phaseOrder: Phase[] = ['collaboration', 'research', 'verification', 'analysis', 'artifacts'];
  const phaseIndex = phaseOrder.indexOf('artifacts');
  const currentIndex = phaseOrder.indexOf(currentPhase);
  const isLocked = phaseIndex > currentIndex;
  const isCurrent = currentPhase === 'artifacts';
  const allComplete = projectStatus === 'complete';
  const isFailed = projectStatus === 'artifacts_failed';
  const hasArtifacts = artifacts.length > 0;
  const canSelect = analysis.completed && projectStatus === 'analysis_complete' && !hasArtifacts;
  const existingTypes = new Set(artifacts.map(a => a.artifactType));
  const additionalTypes = ARTIFACT_TYPE_DEFS.filter(d => !existingTypes.has(d.key));
  const canAddMore = allComplete && additionalTypes.length > 0;
  const [showAddMore, setShowAddMore] = useState(false);

  const completedCount = artifacts.filter(a => a.status === 'complete').length;
  const anyGenerating = artifacts.some(a => a.status === 'generating');

  // Export flow state
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showCustomerReadyDialog, setShowCustomerReadyDialog] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  // Packet export
  const packetMutation = useExportPacket(projectId);
  const isExportingPacket = packetMutation.isPending;

  // Check if all 5 default-tier artifacts are complete
  const defaultTierKeys = defaultDefs.map(d => d.key);
  const completedTypes = new Set(
    artifacts.filter(a => a.status === 'complete').map(a => a.artifactType)
  );
  const allDefaultComplete = defaultTierKeys.every(key => completedTypes.has(key));
  const missingDefaults = defaultDefs.filter(d => !completedTypes.has(d.key));
  const packetTooltip = allDefaultComplete
    ? 'Generate a complete branded competitive deck from all deliverables'
    : `Generate ${missingDefaults.map(d => d.label).join(' and ')} to enable packet export`;


  // Build section label lookup from ARTIFACT_TYPE_DEFS
  const sectionLabels: Record<string, string> = Object.fromEntries(
    ARTIFACT_TYPE_DEFS.map(d => [d.key, d.label])
  );

  // Close export menu on outside click
  useEffect(() => {
    if (!showExportMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showExportMenu]);

  // Format verification date for freshness display
  const formatVerificationDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  };

  // Check if any sections are low-confidence (for customer-ready gating)
  const hasLowConfidence = confidence
    ? Object.values(confidence.perSection).some(s => s.rating === 'Low')
    : false;

  const handleStandardExport = () => {
    setShowExportMenu(false);
    packetMutation.mutate(undefined);
  };

  const handleCustomerReadyExport = () => {
    setShowExportMenu(false);
    if (hasLowConfidence) {
      setShowCustomerReadyDialog(true);
    } else {
      packetMutation.mutate({ customerReady: true });
    }
  };

  const toggleType = (type: string) => {
    setSelectedTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  const handleGenerate = () => {
    if (selectedTypes.size > 0) {
      onSelectArtifacts(Array.from(selectedTypes));
    }
  };

  const loadArtifactContent = async (type: string) => {
    if (artifactContent[type]) {
      setExpandedArtifact(prev => prev === type ? null : type);
      return;
    }

    setLoadingArtifact(type);
    try {
      const result = await artifactsApi.getArtifact(projectId, type);
      setArtifactContent(prev => ({ ...prev, [type]: result }));
      setExpandedArtifact(type);
    } catch (err) {
      console.error(`Failed to load artifact ${type}:`, err);
    } finally {
      setLoadingArtifact(null);
    }
  };

  const statusBadge = (status: SelectedArtifact['status']) => {
    const styles: Record<string, string> = {
      selected: 'bg-surface border border-surface-border text-text-subtle',
      generating: 'bg-status-running-bg text-status-running-fg',
      complete: 'bg-status-complete-bg text-status-complete-fg',
      failed: 'bg-status-blocked-bg text-status-blocked-fg',
    };
    const labels: Record<string, string> = {
      selected: 'Queued',
      generating: 'Generating',
      complete: 'Complete',
      failed: 'Failed',
    };
    return (
      <span className={`px-2 py-0.5 text-xs font-medium rounded ${styles[status]}`}>
        {labels[status]}
      </span>
    );
  };

  return (
    <section className={`p-5 rounded-lg border transition-colors ${
      allComplete
        ? 'bg-status-complete-bg/10 border-status-complete-fg/20'
        : isCurrent
        ? 'bg-surface-raised border-status-running-border'
        : 'bg-surface-raised border-surface-border opacity-60'
    }`}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          {allComplete ? (
            <CheckCircle className="w-5 h-5 text-status-complete-fg" />
          ) : anyGenerating ? (
            <Loader2 className="w-5 h-5 animate-spin text-status-running-fg" />
          ) : (
            <FileText className={`w-5 h-5 ${isLocked ? 'text-text-subtle' : 'text-status-running-fg'}`} />
          )}
          <div>
            <h2 className={`text-xl font-display font-semibold ${isLocked ? 'text-text-muted' : 'text-text-heading'}`}>
              Strategic Deliverables
            </h2>
            <p className="text-sm text-text-muted mt-0.5">
              Generate strategic analysis deliverables
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {anyGenerating && (
            <button
              onClick={onStopArtifacts}
              className="flex items-center gap-1 px-2 py-1 text-xs font-medium border border-brand-magenta/40 rounded text-brand-magenta hover:bg-brand-magenta/10 transition-colors"
              title="Stop all in-progress generation"
            >
              <StopCircle className="w-3 h-3" />
              Stop
            </button>
          )}
          {(allComplete || projectStatus === 'artifacts_failed') && (
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
            <span className="px-2 py-1 text-xs font-medium bg-surface border border-surface-border rounded text-text-subtle" title="Strategic analysis must complete before generating deliverables">
              Locked
            </span>
          )}
          {hasArtifacts && !allComplete && (
            <span className="px-2 py-1 text-xs font-medium bg-status-running-bg text-status-running-fg rounded">
              {completedCount}/{artifacts.length} complete
            </span>
          )}
          {allComplete && (
            <span className="px-2 py-1 text-xs font-medium bg-status-complete-bg text-status-complete-fg rounded">
              All Complete
            </span>
          )}
        </div>
      </div>

      {/* Artifact Selection Grid — Two-Tier Layout */}
      {canSelect && (
        <div className="space-y-4">
          {/* Default Tier */}
          <div className="grid grid-cols-2 gap-2">
            {defaultDefs.map(({ key, label, description }) => {
              const isSelected = selectedTypes.has(key);
              return (
                <button
                  key={key}
                  onClick={() => toggleType(key)}
                  className={`p-3 rounded-lg border text-left transition-colors ${
                    isSelected
                      ? 'bg-status-running-bg/20 border-status-running-border'
                      : 'bg-surface border-surface-border hover:bg-surface-overlay'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                      isSelected
                        ? 'bg-status-running-fg border-status-running-fg'
                        : 'border-surface-border'
                    }`}>
                      {isSelected && <CheckCircle className="w-3 h-3 text-surface" />}
                    </div>
                    <span className="text-sm font-medium text-text">{label}</span>
                  </div>
                  <p className="text-xs text-text-muted mt-1 ml-6">{description}</p>
                </button>
              );
            })}
          </div>

          {/* Additional Frameworks Toggle */}
          <button
            onClick={() => setShowAdditionalFrameworks(prev => !prev)}
            className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text transition-colors"
          >
            {showAdditionalFrameworks ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
            {showAdditionalFrameworks ? 'Hide Additional Frameworks' : 'Show Additional Frameworks'}
          </button>

          {/* Additional Tier */}
          {showAdditionalFrameworks && (
            <div className="grid grid-cols-2 gap-2">
              {additionalDefs.map(({ key, label, description }) => {
                const isSelected = selectedTypes.has(key);
                return (
                  <button
                    key={key}
                    onClick={() => toggleType(key)}
                    className={`p-3 rounded-lg border text-left transition-colors ${
                      isSelected
                        ? 'bg-status-running-bg/20 border-status-running-border'
                        : 'bg-surface border-surface-border hover:bg-surface-overlay'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                        isSelected
                          ? 'bg-status-running-fg border-status-running-fg'
                          : 'border-surface-border'
                      }`}>
                        {isSelected && <CheckCircle className="w-3 h-3 text-surface" />}
                      </div>
                      <span className="text-sm font-medium text-text">{label}</span>
                    </div>
                    <p className="text-xs text-text-muted mt-1 ml-6">{description}</p>
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex flex-col">
            <button
              onClick={handleGenerate}
              disabled={selectedTypes.size === 0 || isSelectingArtifacts}
              className="flex items-center gap-2 px-4 py-2 bg-status-running-bg text-status-running-fg hover:opacity-90 rounded text-sm font-medium disabled:opacity-50 transition-colors"
            >
              {isSelectingArtifacts ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              {isSelectingArtifacts
                ? 'Starting Generation...'
                : `Generate ${selectedTypes.size} Artifact${selectedTypes.size !== 1 ? 's' : ''}`}
            </button>
            {selectedTypes.size > 0 && (
              <p className="text-xs text-text-subtle mt-1">
                Generating {selectedTypes.size} deliverable{selectedTypes.size !== 1 ? 's' : ''} (estimated {selectedTypes.size * 2}-{selectedTypes.size * 3} minutes)
              </p>
            )}
          </div>
        </div>
      )}

      {/* Error State */}
      {isFailed && (
        <PhaseErrorCard
          title="Artifact Generation Failed"
          errorMessage={errorMessage}
          onRetry={onRetryArtifacts}
          isRetrying={isRetryingArtifacts}
        />
      )}

      {/* Export Competitive Packet Button */}
      {hasArtifacts && !anyGenerating && (
        <div className="mb-3 relative" ref={exportMenuRef}>
          {isExportingPacket ? (
            <div className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-brand-blue text-white">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Generating Competitive Packet...</span>
              <span className="text-xs opacity-75 ml-1">(this may take 1-2 minutes)</span>
            </div>
          ) : (
            <button
              onClick={() => setShowExportMenu(prev => !prev)}
              disabled={!allDefaultComplete}
              title={packetTooltip}
              className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                allDefaultComplete
                  ? 'bg-brand-blue text-white hover:opacity-90'
                  : 'bg-surface border border-surface-border text-text-muted cursor-not-allowed opacity-60'
              }`}
            >
              <Download className="w-4 h-4" />
              <span>Export Competitive Packet</span>
              <ChevronDown className="w-3.5 h-3.5 ml-1" />
            </button>
          )}
          {showExportMenu && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 z-20 overflow-hidden">
              <p className="px-4 py-2 text-xs text-gray-500 border-b border-gray-100">
                Choose export mode
              </p>
              <button
                onClick={handleStandardExport}
                className="w-full text-left px-4 py-2.5 text-sm font-medium text-gray-800 hover:bg-gray-50 transition-colors"
              >
                Standard Export
                <span className="block text-xs font-normal text-gray-500 mt-0.5">
                  Full packet with confidence data included
                </span>
              </button>
              <button
                onClick={handleCustomerReadyExport}
                className="w-full text-left px-4 py-2.5 text-sm font-medium hover:bg-gray-50 transition-colors border-t border-gray-100"
                style={{ color: '#1C2340' }}
              >
                Customer-Ready Export
                <span className="block text-xs font-normal text-gray-500 mt-0.5">
                  Quality threshold enforced for external sharing
                </span>
              </button>
            </div>
          )}
          {!allDefaultComplete && missingDefaults.length > 0 && (
            <p className="text-xs text-text-subtle mt-1 text-center">
              Generate {missingDefaults.map(d => d.label).join(', ')} to enable
            </p>
          )}
        </div>
      )}

      {/* Artifact Cards (when generating or complete) */}
      {hasArtifacts && (
        <div className="space-y-2">
          {artifacts.map((artifact) => {
            const isExpanded = expandedArtifact === artifact.artifactType;
            const isLoading = loadingArtifact === artifact.artifactType;
            const content = artifactContent[artifact.artifactType];
            const isClickable = artifact.status === 'complete';
            const isStaleExport = artifact.lastExportedAt && artifact.completedAt
              && new Date(artifact.completedAt) > new Date(artifact.lastExportedAt);

            return (
              <div key={artifact.id} className="bg-surface rounded-lg border border-surface-border">
                <div
                  role="button"
                  tabIndex={isClickable ? 0 : undefined}
                  onClick={() => isClickable && loadArtifactContent(artifact.artifactType)}
                  onKeyDown={(e) => { if (isClickable && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); loadArtifactContent(artifact.artifactType); } }}
                  className={`w-full flex items-center justify-between p-3 rounded-lg transition-colors ${
                    isClickable ? 'hover:bg-surface-overlay cursor-pointer' : 'cursor-default'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {artifact.status === 'generating' && (
                      <Loader2 className="w-4 h-4 animate-spin text-status-running-fg flex-shrink-0" />
                    )}
                    {artifact.status === 'complete' && (
                      <CheckCircle className="w-4 h-4 text-status-complete-fg flex-shrink-0" />
                    )}
                    {artifact.status === 'selected' && (
                      <div className="w-4 h-4 rounded-full border border-surface-border flex-shrink-0" />
                    )}
                    {artifact.status === 'failed' && (
                      <AlertCircle className="w-4 h-4 text-status-blocked-fg flex-shrink-0" />
                    )}
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-text">{artifact.label}</span>
                        {confidence?.perSection[artifact.artifactType] && (
                          <ConfidenceBadge
                            rating={confidence.perSection[artifact.artifactType].rating}
                            tooltip={`${confidence.perSection[artifact.artifactType].verifiedPercent}% verified, ${confidence.perSection[artifact.artifactType].issueRate}% issue rate`}
                          />
                        )}
                        {isStaleExport && (
                          <span className="px-1.5 py-0.5 text-[10px] font-medium bg-amber-100 text-amber-700 rounded">
                            Updated since last download
                          </span>
                        )}
                      </div>
                      {confidence?.verificationDate && artifact.status === 'complete' && (
                        <span className="text-[11px] text-gray-400 mt-0.5">
                          Data verified: {formatVerificationDate(confidence.verificationDate)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {content && (
                      <span className="text-xs text-text-subtle">
                        {content.wordCount.toLocaleString()} words
                      </span>
                    )}
                    {isLoading && <Loader2 className="w-3 h-3 animate-spin text-text-muted" />}
                    {artifact.status === 'failed' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onRetryArtifact(artifact.artifactType);
                        }}
                        disabled={isRetryingArtifact}
                        className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-brand-blue border border-brand-blue/30 rounded hover:bg-brand-blue/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isRetryingArtifact ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <RotateCcw className="w-3 h-3" />
                        )}
                        Retry
                      </button>
                    )}
                    {artifact.status === 'complete' && (
                      <ExportButton
                        projectId={projectId}
                        artifactType={artifact.artifactType}
                        availableExports={artifact.availableExports}
                        lastExportedAt={artifact.lastExportedAt}
                      />
                    )}
                    {statusBadge(artifact.status)}
                    {isClickable && (
                      isExpanded
                        ? <ChevronUp className="w-4 h-4 text-text-muted" />
                        : <ChevronDown className="w-4 h-4 text-text-muted" />
                    )}
                  </div>
                </div>

                {isExpanded && content && (
                  <div className="px-3 pb-3">
                    <div className="p-3 bg-surface-raised rounded border border-surface-border max-h-[60vh] overflow-y-auto scrollbar-thin">
                      <div className="text-sm text-text whitespace-pre-wrap leading-relaxed">
                        {sanitizeContent(content.content)}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Customer-Ready Export Dialog */}
      {confidence && (
        <CustomerReadyDialog
          isOpen={showCustomerReadyDialog}
          onClose={() => setShowCustomerReadyDialog(false)}
          onExclude={(excludeSections) => {
            setShowCustomerReadyDialog(false);
            packetMutation.mutate({ customerReady: true, excludeSections });
          }}
          onIncludeWithWarnings={() => {
            setShowCustomerReadyDialog(false);
            packetMutation.mutate({ customerReady: true, includeWarnings: true });
          }}
          confidence={confidence}
          sectionLabels={sectionLabels}
        />
      )}

      {/* Generate Additional Deliverables */}
      {canAddMore && (
        <div className="mt-4">
          {!showAddMore ? (
            <button
              onClick={() => setShowAddMore(true)}
              className="flex items-center gap-2 px-4 py-2 bg-surface border border-surface-border hover:bg-surface-overlay rounded text-sm font-medium text-text transition-colors"
            >
              <Plus className="w-4 h-4" />
              Generate Additional Deliverables
            </button>
          ) : (
            <div className="space-y-4 p-4 bg-surface rounded-lg border border-surface-border">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-text">Select additional deliverables</span>
                <button onClick={() => setShowAddMore(false)} className="text-xs text-text-muted hover:text-text">Cancel</button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {additionalTypes.map(({ key, label, description }) => {
                  const isSelected = selectedTypes.has(key);
                  return (
                    <button
                      key={key}
                      onClick={() => toggleType(key)}
                      className={`p-3 rounded-lg border text-left transition-colors ${
                        isSelected
                          ? 'bg-status-running-bg/20 border-status-running-border'
                          : 'bg-surface border-surface-border hover:bg-surface-overlay'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                          isSelected
                            ? 'bg-status-running-fg border-status-running-fg'
                            : 'border-surface-border'
                        }`}>
                          {isSelected && <CheckCircle className="w-3 h-3 text-surface" />}
                        </div>
                        <span className="text-sm font-medium text-text">{label}</span>
                      </div>
                      <p className="text-xs text-text-muted mt-1 ml-6">{description}</p>
                    </button>
                  );
                })}
              </div>
              <button
                onClick={handleGenerate}
                disabled={selectedTypes.size === 0 || isSelectingArtifacts}
                className="flex items-center gap-2 px-4 py-2 bg-status-running-bg text-status-running-fg hover:opacity-90 rounded text-sm font-medium disabled:opacity-50 transition-colors"
              >
                {isSelectingArtifacts ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                {isSelectingArtifacts
                  ? 'Starting Generation...'
                  : `Generate ${selectedTypes.size} Artifact${selectedTypes.size !== 1 ? 's' : ''}`}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
