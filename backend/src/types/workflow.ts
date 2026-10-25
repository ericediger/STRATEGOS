/**
 * STRATEGOS workflow definitions
 *
 * Single project type: strategic analysis.
 * 5-phase workflow hardcoded (no registry needed).
 */

export type Phase =
  | 'collaboration'
  | 'research'
  | 'verification'
  | 'analysis'
  | 'artifacts';

export type ProjectStatus =
  | 'not_started'
  | 'collaborating'
  | 'brief_generated'
  | 'brief_approved'
  | 'researching'
  | 'research_complete'
  | 'verifying'
  | 'verification_complete'
  | 'analyzing'
  | 'analysis_complete'
  | 'generating_artifacts'
  | 'complete'
  | 'brief_generation_failed'
  | 'research_failed'
  | 'verification_failed'
  | 'analysis_failed'
  | 'artifacts_failed';

export const PHASES: { key: Phase; label: string }[] = [
  { key: 'collaboration', label: 'Collaborate' },
  { key: 'research', label: 'Research' },
  { key: 'verification', label: 'Verify' },
  { key: 'analysis', label: 'Analyze' },
  { key: 'artifacts', label: 'Artifacts' },
];

export function getPhaseFromStatus(status: string): Phase {
  const map: Record<string, Phase> = {
    not_started: 'collaboration',
    collaborating: 'collaboration',
    brief_generated: 'collaboration',
    brief_generation_failed: 'collaboration',
    brief_approved: 'research',
    researching: 'research',
    research_failed: 'research',
    research_complete: 'verification',
    verifying: 'verification',
    verification_failed: 'verification',
    verification_complete: 'analysis',
    analyzing: 'analysis',
    analysis_failed: 'analysis',
    analysis_complete: 'artifacts',
    generating_artifacts: 'artifacts',
    artifacts_failed: 'artifacts',
    complete: 'artifacts',
  };
  return map[status] || 'collaboration';
}

export function getPhaseLabel(status: string): string {
  const labels: Record<string, string> = {
    not_started: 'Not Started',
    collaborating: 'Collaboration',
    brief_generated: 'Brief Ready',
    brief_generation_failed: 'Brief Generation Failed',
    brief_approved: 'Brief Approved',
    researching: 'Research',
    research_failed: 'Research Failed',
    research_complete: 'Research Done',
    verifying: 'Verification',
    verification_failed: 'Verification Failed',
    verification_complete: 'Verified',
    analyzing: 'Analysis',
    analysis_failed: 'Analysis Failed',
    analysis_complete: 'Analysis Done',
    generating_artifacts: 'Generating Artifacts',
    artifacts_failed: 'Artifacts Failed',
    complete: 'Complete',
  };
  return labels[status] || status;
}
