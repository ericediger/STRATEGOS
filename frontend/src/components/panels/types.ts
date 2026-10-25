/**
 * Shared types for Dashboard panel components
 */

import type { DashboardData, Phase, ProviderStatus, SelectedArtifact, ConfidenceData } from '../../types';

// Re-export for convenience in panel files
export type { DashboardData, Phase, ProviderStatus, SelectedArtifact, ConfidenceData };

export interface CollaborationPanelProps {
  projectId: string;
  status: string;
  messageCount: number;
  briefGenerated: boolean;
  briefApproved: boolean;
  briefData: { content: string; wordCount: number; status: string } | undefined;
  briefLoading: boolean;
  onApproveBrief: () => void;
  isApprovingBrief: boolean;
  onUpdateBrief: (content: string) => void;
  isUpdatingBrief: boolean;
  errorMessage: string | null;
  onRetrySynthesis: () => void;
  isRetryingSynthesis: boolean;
  onImport: (files: FileList) => void;
  isImporting: boolean;
  onRerun: () => void;
}

export interface ResearchPanelProps {
  research: Record<string, ProviderStatus>;
  currentPhase: Phase;
  projectStatus: string;
  projectId: string;
  onStartResearch: () => void;
  isStartingResearch: boolean;
  errorMessage: string | null;
  onRetryResearch: () => void;
  isRetryingResearch: boolean;
  onImport: (files: FileList) => void;
  isImporting: boolean;
  onRerun: () => void;
  onRerunProvider: (key: string, label: string) => void;
  isRerunningProvider: boolean;
  onStopAll: () => void;
  onStopProvider: (key: string, label: string) => void;
  isStopping: boolean;
}

export interface VerificationPanelProps {
  verification: DashboardData['verification'];
  currentPhase: Phase;
  projectStatus: string;
  projectId: string;
  onStartVerification: () => void;
  isStartingVerification: boolean;
  errorMessage: string | null;
  onRetryVerification: () => void;
  isRetryingVerification: boolean;
  onImport: (files: FileList) => void;
  isImporting: boolean;
  onRerun: () => void;
}

export interface AnalysisPanelProps {
  analysis: DashboardData['analysis'];
  currentPhase: Phase;
  projectStatus: string;
  projectId: string;
  onStartAnalysis: () => void;
  isStartingAnalysis: boolean;
  errorMessage: string | null;
  onRetryAnalysis: () => void;
  isRetryingAnalysis: boolean;
  onImport: (files: FileList) => void;
  isImporting: boolean;
  onRerun: () => void;
}

export interface ArtifactsPanelProps {
  artifacts: SelectedArtifact[];
  analysis: DashboardData['analysis'];
  currentPhase: Phase;
  projectStatus: string;
  projectId: string;
  confidence?: ConfidenceData;
  onSelectArtifacts: (types: string[]) => void;
  isSelectingArtifacts: boolean;
  errorMessage: string | null;
  onRetryArtifacts: () => void;
  isRetryingArtifacts: boolean;
  onRerun: () => void;
  onRetryArtifact: (artifactType: string) => void;
  isRetryingArtifact: boolean;
  onStopArtifacts: () => void;
}

export type ArtifactTier = 'default' | 'additional';

export const ARTIFACT_TYPE_DEFS: { key: string; label: string; description: string; tier: ArtifactTier }[] = [
  { key: 'swot', label: 'SWOT Analysis', description: 'Strengths, weaknesses, opportunities, threats', tier: 'default' },
  { key: 'pestle', label: 'PESTLE Analysis', description: 'Political, economic, social, tech, legal, environmental', tier: 'additional' },
  { key: 'five-forces', label: "Porter's Five Forces", description: 'Competitive force structure analysis', tier: 'additional' },
  { key: 'positioning', label: 'Positioning Matrix', description: 'Competitive positioning and strategic groups', tier: 'default' },
  { key: 'pricing', label: 'Pricing Comparison', description: 'Pricing structures and feature comparison', tier: 'default' },
  { key: 'executive-summary', label: 'Executive Summary', description: 'One-page decision-ready summary', tier: 'default' },
  { key: 'battle-card', label: 'Battle Card', description: 'Competitor-specific quick-reference sheets for sales', tier: 'default' },
];
