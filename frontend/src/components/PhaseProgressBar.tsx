/**
 * Phase Progress Bar with Sub-Step Milestone Markers
 *
 * Shows 5 phase segments with icons (checkmark for complete, spinner for active,
 * lock for future, X for failed). The active phase displays sub-step dots showing
 * granular progress within that phase.
 */

import {
  CheckCircle,
  Loader2,
  XCircle,
  MessageSquare,
  Search,
  ShieldCheck,
  Brain,
  FileText,
} from 'lucide-react';
import type { Phase, ProviderStatus, SelectedArtifact, DashboardData } from '../types';

const PHASE_ICONS: Record<string, React.ReactNode> = {
  MessageSquare: <MessageSquare className="w-4 h-4" />,
  Search: <Search className="w-4 h-4" />,
  ShieldCheck: <ShieldCheck className="w-4 h-4" />,
  Brain: <Brain className="w-4 h-4" />,
  FileText: <FileText className="w-4 h-4" />,
};

const PHASES: { key: Phase; label: string; icon: string }[] = [
  { key: 'collaboration', label: 'Define Scope', icon: 'MessageSquare' },
  { key: 'research', label: 'Research', icon: 'Search' },
  { key: 'verification', label: 'Verify Sources', icon: 'ShieldCheck' },
  { key: 'analysis', label: 'Analyze', icon: 'Brain' },
  { key: 'artifacts', label: 'Deliverables', icon: 'FileText' },
];

// Sub-step status for rendering dots
type SubStepStatus = 'complete' | 'active' | 'pending' | 'failed';

interface SubStep {
  key: string;
  label: string;
  status: SubStepStatus;
}

interface PhaseProgressBarProps {
  currentPhase: Phase;
  status: string;
  research: Record<string, ProviderStatus>;
  verification: DashboardData['verification'];
  artifacts: SelectedArtifact[];
  collaboration: DashboardData['collaboration'];
}

export function PhaseProgressBar({
  currentPhase,
  status,
  research,
  verification,
  artifacts,
  collaboration,
}: PhaseProgressBarProps) {
  const currentIndex = PHASES.findIndex(p => p.key === currentPhase);

  const isPhaseComplete = (phaseKey: Phase): boolean => {
    const completionMap: Record<Phase, string[]> = {
      collaboration: ['brief_approved', 'researching', 'research_complete', 'verifying', 'verification_complete', 'analyzing', 'analysis_complete', 'generating_artifacts', 'complete'],
      research: ['research_complete', 'verifying', 'verification_complete', 'analyzing', 'analysis_complete', 'generating_artifacts', 'complete'],
      verification: ['verification_complete', 'analyzing', 'analysis_complete', 'generating_artifacts', 'complete'],
      analysis: ['analysis_complete', 'generating_artifacts', 'complete'],
      artifacts: ['complete'],
    };
    return completionMap[phaseKey]?.includes(status) || false;
  };

  const isPhaseFailed = (phaseKey: Phase): boolean => {
    const failureMap: Record<Phase, string[]> = {
      collaboration: ['brief_generation_failed'],
      research: ['research_failed'],
      verification: ['verification_failed'],
      analysis: ['analysis_failed'],
      artifacts: ['artifacts_failed'],
    };
    return failureMap[phaseKey]?.includes(status) || false;
  };

  const isPhaseRunning = (phaseKey: Phase): boolean => {
    const runningMap: Record<Phase, string[]> = {
      collaboration: ['collaborating', 'brief_generated', 'brief_generating'],
      research: ['researching'],
      verification: ['verifying'],
      analysis: ['analyzing'],
      artifacts: ['generating_artifacts'],
    };
    return runningMap[phaseKey]?.includes(status) || false;
  };

  const getSubSteps = (phaseKey: Phase): SubStep[] | null => {
    if (!isPhaseRunning(phaseKey)) return null;

    switch (phaseKey) {
      case 'collaboration':
        return getCollaborationSubSteps();
      case 'research':
        return getResearchSubSteps();
      case 'verification':
        return getVerificationSubSteps();
      case 'analysis':
        return getAnalysisSubSteps();
      case 'artifacts':
        return getArtifactSubSteps();
      default:
        return null;
    }
  };

  const getCollaborationSubSteps = (): SubStep[] => {
    const steps: SubStep[] = [
      { key: 'chat', label: 'Chat', status: 'pending' },
      { key: 'brief', label: 'Brief', status: 'pending' },
      { key: 'approve', label: 'Approve', status: 'pending' },
    ];

    if (status === 'collaborating') {
      steps[0].status = collaboration.messageCount > 0 ? 'active' : 'pending';
    }
    if (status === 'brief_generated' || status === 'brief_generating') {
      steps[0].status = 'complete';
      steps[1].status = collaboration.briefGenerated ? 'complete' : 'active';
    }
    if (collaboration.briefApproved) {
      steps[0].status = 'complete';
      steps[1].status = 'complete';
      steps[2].status = 'complete';
    }

    return steps;
  };

  const getResearchSubSteps = (): SubStep[] => {
    const providerLabels: Record<string, string> = {
      kimi: 'A',
      gemini: 'B',
      edr: 'C',
    };

    return Object.keys(research).map(key => {
      const provider = research[key];
      let stepStatus: SubStepStatus = 'pending';

      if (provider.status === 'complete') stepStatus = 'complete';
      else if (provider.status === 'running') stepStatus = 'active';
      else if (provider.status === 'failed' || provider.status === 'stopped') stepStatus = 'failed';

      return {
        key,
        label: providerLabels[key] || key.charAt(0).toUpperCase(),
        status: stepStatus,
      };
    });
  };

  const getVerificationSubSteps = (): SubStep[] => {
    const PIPELINE_STEPS = [
      { key: 'consolidate', label: 'Collect' },
      { key: 'extract', label: 'Claims' },
      { key: 'investigate', label: 'Sources' },
      { key: 'adjudicate', label: 'Evaluate' },
      { key: 'consensus', label: 'Validate' },
      { key: 'report', label: 'Report' },
    ];

    const currentStep = verification.currentStep?.toLowerCase() || '';

    // Map currentStep label to pipeline index
    const stepLabelMap: Record<string, number> = {
      'collecting research': 0,
      'identifying claims': 1,
      'checking sources': 2,
      'evaluating evidence': 3,
      'cross-validating': 4,
      'writing report': 5,
    };

    let activeIndex = -1;
    for (const [label, idx] of Object.entries(stepLabelMap)) {
      if (currentStep.includes(label.toLowerCase()) || currentStep.includes(PIPELINE_STEPS[idx].key)) {
        activeIndex = idx;
        break;
      }
    }

    // Also try matching just the step key
    if (activeIndex === -1) {
      activeIndex = PIPELINE_STEPS.findIndex(s => currentStep.includes(s.key));
    }

    return PIPELINE_STEPS.map((step, i) => ({
      key: step.key,
      label: step.label,
      status: i < activeIndex ? 'complete' as SubStepStatus
        : i === activeIndex ? 'active' as SubStepStatus
        : 'pending' as SubStepStatus,
    }));
  };

  const getAnalysisSubSteps = (): SubStep[] => {
    return [{ key: 'analyzing', label: 'Analysis', status: 'active' as SubStepStatus }];
  };

  const getArtifactSubSteps = (): SubStep[] => {
    if (artifacts.length === 0) return [];

    const labelMap: Record<string, string> = {
      swot: 'SWOT',
      pestle: 'PESTLE',
      five_forces: 'Forces',
      positioning: 'Position',
      pricing: 'Pricing',
      executive_summary: 'Summary',
    };

    return artifacts.map(a => {
      let stepStatus: SubStepStatus = 'pending';
      if (a.status === 'complete') stepStatus = 'complete';
      else if (a.status === 'generating') stepStatus = 'active';
      else if (a.status === 'failed') stepStatus = 'failed';

      return {
        key: a.artifactType,
        label: labelMap[a.artifactType] || a.artifactType,
        status: stepStatus,
      };
    });
  };

  return (
    <div className="flex items-center gap-1">
      {PHASES.map((phase, index) => {
        const isComplete = isPhaseComplete(phase.key);
        const isFailed = isPhaseFailed(phase.key);
        const isRunning = isPhaseRunning(phase.key);
        const isPast = index < currentIndex;
        const subSteps = isRunning ? getSubSteps(phase.key) : null;

        return (
          <div key={phase.key} className="flex items-center flex-1">
            <div className="flex-1">
              <div
                className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
                  isFailed
                    ? 'bg-brand-magenta/20 text-brand-magenta border border-brand-magenta'
                    : isComplete
                    ? 'bg-status-complete-bg/30 text-status-complete-fg'
                    : isRunning
                    ? 'bg-status-running-bg/30 text-status-running-fg border border-status-running-border'
                    : 'bg-surface-overlay text-text-subtle'
                }`}
              >
                {isFailed ? (
                  <XCircle className="w-4 h-4 flex-shrink-0" />
                ) : isComplete ? (
                  <CheckCircle className="w-4 h-4 flex-shrink-0" />
                ) : isRunning ? (
                  <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
                ) : (
                  <div className="w-4 h-4 flex-shrink-0">{PHASE_ICONS[phase.icon]}</div>
                )}
                <span className="text-xs font-medium truncate">{phase.label}</span>
              </div>

              {/* Sub-step dots — only for running phase */}
              {subSteps && subSteps.length > 0 && (
                <div className="flex items-center gap-1.5 px-3 mt-1.5">
                  {subSteps.map(step => (
                    <div key={step.key} className="flex flex-col items-center gap-0.5">
                      <div
                        className={`w-2 h-2 rounded-full transition-colors ${
                          step.status === 'complete'
                            ? 'bg-status-complete-fg'
                            : step.status === 'active'
                            ? 'bg-brand-blue animate-pulse-slow'
                            : step.status === 'failed'
                            ? 'bg-brand-magenta'
                            : 'bg-text-subtle/40'
                        }`}
                        title={step.label}
                      />
                      <span className="text-2xs text-text-subtle truncate max-w-[3rem]">
                        {step.label}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {index < PHASES.length - 1 && (
              <div className={`w-4 h-0.5 flex-shrink-0 ${isPast || isComplete ? 'bg-status-complete-fg/30' : 'bg-surface-border'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
