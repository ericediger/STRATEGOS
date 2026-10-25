/**
 * STRATEGOS frontend types
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
  | 'brief_generation_failed'
  | 'researching'
  | 'research_complete'
  | 'research_failed'
  | 'verifying'
  | 'verification_complete'
  | 'verification_failed'
  | 'analyzing'
  | 'analysis_complete'
  | 'analysis_failed'
  | 'generating_artifacts'
  | 'artifacts_failed'
  | 'complete';

export interface Project {
  id: string;
  name: string;
  rootPath: string;
  status: string;
  researchBriefPath: string | null;
  error_message: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  status: string;
  currentPhaseLabel: string;
  updatedAt: string;
}

export interface ProviderStatus {
  status: 'pending' | 'running' | 'complete' | 'failed' | 'stopped';
  wordCount: number | null;
  startedAt: string | null;
  completedAt: string | null;
  content: string | null;
}

export interface SelectedArtifact {
  id: string;
  projectId: string;
  artifactType: string;
  label: string;
  status: 'selected' | 'generating' | 'complete' | 'failed';
  outputPath: string | null;
  createdAt: string;
  completedAt: string | null;
  lastExportedAt: string | null;
  availableExports: string[];
}

export interface DashboardData {
  project: Project;
  collaboration: {
    messageCount: number;
    briefGenerated: boolean;
    briefApproved: boolean;
  };
  research: Record<string, ProviderStatus>;
  verification: {
    completed: boolean;
    status: 'pending' | 'running' | 'complete' | 'failed';
    progress: number;
    currentStep: string | null;
    claimCount: number | null;
    issueRate: number | null;
    gateStatus: 'PASSED' | 'REVIEW_RECOMMENDED' | null;
    reportContent: string | null;
    error: string | null;
  };
  analysis: {
    completed: boolean;
    status: 'pending' | 'running' | 'complete' | 'failed';
    assessmentContent: string | null;
    wordCount: number | null;
    error: string | null;
  };
  artifacts: SelectedArtifact[];
  confidence?: ConfidenceData;
  currentPhase: Phase;
  attention: any[];
  activity: any[];
  linkedDossier: { dossierId: string; competitorName: string } | null;
}

export interface SectionConfidence {
  rating: 'High' | 'Medium' | 'Low';
  verifiedPercent: number;
  issueRate: number;
  recencyDays: number;
  factors: string[];
}

export interface ConfidenceData {
  overall: SectionConfidence;
  perSection: Record<string, SectionConfidence>;
  verificationDate: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

// =============================================================================
// DOSSIER TYPES
// =============================================================================

export type StalenessLevel = 'fresh' | 'aging' | 'stale' | 'never_refreshed';

export type DossierSortKey = 'competitorName' | 'createdAt' | 'lastRefreshedAt' | 'confidenceRating' | 'staleness';

export interface DossierRecord {
  id: string;
  competitorName: string;
  industry: string | null;
  description: string | null;
  sourceProjectId: string;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
  lastRefreshedAt: string | null;
  confidenceRating: 'High' | 'Medium' | 'Low' | null;
  researchWordCount: number;
  artifactCount: number;
  rootPath: string;
  changeLog: Array<{ date: string; type: string; summary: string }>;
}

export interface DossierFilters {
  status?: string;
  search?: string;
}

export interface CreateDossierFromProjectResponse {
  dossier: DossierRecord;
  filesCopied: string[];
  warnings: string[];
}

export interface LinkedProject {
  projectId: string;
  projectName: string;
  relationship: string;
  linkedAt: string;
}

export interface DossierDetailResponse {
  dossier: DossierRecord;
  linkedProjects: LinkedProject[];
}

export interface DossierFile {
  name: string;
  path: string;
  wordCount: number;
  isMarkdown: boolean;
  sizeBytes: number;
}

export interface DossierSection {
  label: string;
  directory: string;
  files: DossierFile[];
}

export interface DossierFileManifest {
  sections: DossierSection[];
}

export interface ChangeLogEntry {
  date: string;
  type: string;
  summary: string;
  sourceProjectId?: string;
}

export interface RefreshDossierResponse {
  dossierId: string;
  status: string;
}

export interface UpdateFromProjectResponse {
  success: boolean;
  changeLogEntry: ChangeLogEntry;
}

// Phase definitions for the progress bar
export const PHASES: { key: Phase; label: string; icon: string }[] = [
  { key: 'collaboration', label: 'Define Scope', icon: 'MessageSquare' },
  { key: 'research', label: 'Research', icon: 'Search' },
  { key: 'verification', label: 'Verify Sources', icon: 'ShieldCheck' },
  { key: 'analysis', label: 'Analyze', icon: 'Brain' },
  { key: 'artifacts', label: 'Deliverables', icon: 'FileText' },
];

// Map status to phase for progress bar
export function getPhaseFromStatus(status: string): Phase {
  const map: Record<string, Phase> = {
    not_started: 'collaboration',
    collaborating: 'collaboration',
    brief_generated: 'collaboration',
    brief_generation_failed: 'collaboration',
    brief_approved: 'research',
    researching: 'research',
    research_complete: 'verification',
    research_failed: 'research',
    verifying: 'verification',
    verification_complete: 'analysis',
    verification_failed: 'verification',
    analyzing: 'analysis',
    analysis_complete: 'artifacts',
    analysis_failed: 'analysis',
    generating_artifacts: 'artifacts',
    artifacts_failed: 'artifacts',
    complete: 'artifacts',
  };
  return map[status] || 'collaboration';
}
