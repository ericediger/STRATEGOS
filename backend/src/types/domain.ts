/**
 * STRATEGOS domain types
 */

export interface Project {
  id: string;
  name: string;
  rootPath: string;
  status: string;
  researchBriefPath: string | null;
  researcherProjectId: number | null;
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

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface ResearchBrief {
  id: string;
  projectId: string;
  filePath: string;
  status: 'draft' | 'approved';
  approvedAt: string | null;
  createdAt: string;
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
}

export interface ProviderStatus {
  status: 'pending' | 'running' | 'complete' | 'failed';
  wordCount: number | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface DashboardData {
  project: Project;
  collaboration: {
    messageCount: number;
    briefGenerated: boolean;
    briefApproved: boolean;
  };
  research: {
    kimi: ProviderStatus;
    gemini: ProviderStatus;
    edr: ProviderStatus;
  };
  verification: {
    completed: boolean;
    claimCount: number | null;
    issueRate: number | null;
    gateStatus: string | null;
  };
  analysis: {
    completed: boolean;
    artifactMenuShown: boolean;
  };
  artifacts: SelectedArtifact[];
  currentPhase: string;
  attention: any[];
  activity: any[];
}

export interface WorkflowAction {
  id: string;
  projectId: string;
  phase: string;
  stepType: string;
  status: string;
  agentId: string | null;
  inputPaths: string | null;
  outputPath: string | null;
  tokensInput: number | null;
  tokensOutput: number | null;
  cost: number | null;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  createdAt: string;
}
