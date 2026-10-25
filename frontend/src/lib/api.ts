/**
 * API client for STRATEGOS backend
 */

const API_BASE = '/api';

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;

  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

// =============================================================================
// HEALTH
// =============================================================================

export const healthApi = {
  check: () => request<{
    status: string;
    service: string;
    apiKeys: Record<string, boolean>;
  }>('/health'),
};

// =============================================================================
// PROJECTS
// =============================================================================

export const projectsApi = {
  list: () => request<{ projects: import('../types').ProjectSummary[] }>('/projects'),

  get: (id: string) => request<import('../types').DashboardData>(`/projects/${id}`),

  create: (name: string) =>
    request<{ project: import('../types').Project }>('/projects', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  delete: (id: string) =>
    request<{ success: boolean }>(`/projects/${id}`, {
      method: 'DELETE',
    }),
};

// =============================================================================
// COLLABORATION (Phase 0: Chat + Brief)
// =============================================================================

export const collaborationApi = {
  getChatHistory: (projectId: string) =>
    request<{ messages: import('../types').ChatMessage[] }>(
      `/collaboration/${projectId}/history`
    ),

  sendChat: (projectId: string, message: string) =>
    request<{ reply: string; messageCount: number }>(
      `/collaboration/${projectId}/chat`,
      { method: 'POST', body: JSON.stringify({ message }) }
    ),

  synthesizeBrief: (projectId: string) =>
    request<{ success: boolean; wordCount: number }>(
      `/collaboration/${projectId}/synthesize`,
      { method: 'POST' }
    ),

  getBrief: (projectId: string) =>
    request<{ content: string; wordCount: number; status: string }>(
      `/collaboration/${projectId}/brief`
    ),

  approveBrief: (projectId: string) =>
    request<{ success: boolean }>(
      `/collaboration/${projectId}/brief/approve`,
      { method: 'POST' }
    ),
};

// =============================================================================
// BRIEF EDITING
// =============================================================================

export const briefApi = {
  updateBrief: (projectId: string, content: string) =>
    request<{ success: boolean; updatedAt: string }>(
      `/collaboration/${projectId}/brief`,
      { method: 'PUT', body: JSON.stringify({ content }) }
    ),
};

// =============================================================================
// RESEARCH (Phase 1: Deep Research)
// =============================================================================

export const researchApi = {
  startResearch: (projectId: string) =>
    request<{ success: boolean; researcherProjectId: number }>(
      `/collaboration/${projectId}/research/start`,
      { method: 'POST' }
    ),

  getStatus: (projectId: string) =>
    request<Record<string, import('../types').ProviderStatus>>(
      `/collaboration/${projectId}/research/status`
    ),
};

// =============================================================================
// VERIFICATION (Phase 2: Source Verification)
// =============================================================================

export const verificationApi = {
  startVerification: (projectId: string) =>
    request<{ success: boolean; taskId: string }>(
      `/collaboration/${projectId}/verification/start`,
      { method: 'POST' }
    ),
};

// =============================================================================
// ANALYSIS (Phase 3: Strategic Analysis)
// =============================================================================

export const analysisApi = {
  startAnalysis: (projectId: string) =>
    request<{ success: boolean }>(
      `/collaboration/${projectId}/analysis/start`,
      { method: 'POST' }
    ),
};

// =============================================================================
// ARTIFACTS (Phase 4: Deliverable Generation)
// =============================================================================

export const artifactsApi = {
  selectArtifacts: (projectId: string, types: string[]) =>
    request<{ success: boolean; types: string[] }>(
      `/collaboration/${projectId}/artifacts/select`,
      { method: 'POST', body: JSON.stringify({ types }) }
    ),

  getArtifact: (projectId: string, type: string) =>
    request<{ content: string; wordCount: number }>(
      `/collaboration/${projectId}/artifacts/${type}`
    ),
};

// =============================================================================
// IMPORT (External Document Import)
// =============================================================================

export const importApi = {
  importDocument: (projectId: string, phase: string, files: Array<{ name: string; content: string }>) =>
    request<{ success: boolean }>(`/collaboration/${projectId}/import-document`, {
      method: 'POST',
      body: JSON.stringify({ phase, files }),
    }),
};

// =============================================================================
// RE-RUN (Phase Reset)
// =============================================================================

export const rerunApi = {
  rerunPhase: (projectId: string, phase: string) =>
    request<{ success: boolean }>(`/collaboration/${projectId}/rerun`, {
      method: 'POST',
      body: JSON.stringify({ phase }),
    }),
};

// =============================================================================
// RESEARCH CONTROL (Per-Provider Re-Run + Stop)
// =============================================================================

export const researchControlApi = {
  rerunProvider: (projectId: string, provider: string) =>
    request<{ success: boolean; provider: string }>(
      `/collaboration/${projectId}/rerun-provider`,
      { method: 'POST', body: JSON.stringify({ provider }) }
    ),

  stopResearch: (projectId: string, providers?: string[]) =>
    request<{ success: boolean; providerStatuses: Record<string, string>; allStopped: boolean; anyComplete: boolean }>(
      `/collaboration/${projectId}/stop-research`,
      { method: 'POST', body: JSON.stringify({ providers }) }
    ),
};

// =============================================================================
// EXPORT (Document Export)
// =============================================================================

export const exportApi = {
  generate: (projectId: string, artifactType: string, format: 'docx' | 'pptx') =>
    fetch(`${API_BASE}/projects/${projectId}/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artifactType, format }),
    }).then(res => {
      if (!res.ok) throw new Error(`Export failed: ${res.statusText}`);
      return res.json() as Promise<{ status: string; filename: string }>;
    }),

  generatePacket: (projectId: string, options?: { customerReady?: boolean; excludeSections?: string[]; includeWarnings?: boolean }) =>
    fetch(`${API_BASE}/projects/${projectId}/export/packet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options ?? {}),
    }).then(async (res) => {
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error || `Export failed: ${res.statusText}`);
      }
      return res.json() as Promise<{ status: string; filename: string }>;
    }),

  downloadUrl: (projectId: string, filename: string) =>
    `${API_BASE}/projects/${projectId}/exports/${filename}`,
};

// =============================================================================
// DOSSIERS (Competitor Dossier Library)
// =============================================================================

export const dossierApi = {
  list: (params?: { status?: string; search?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    if (params?.search) searchParams.set('search', params.search);
    const qs = searchParams.toString();
    return request<{ dossiers: import('../types').DossierRecord[] }>(
      `/dossiers${qs ? `?${qs}` : ''}`
    );
  },

  createFromProject: (projectId: string, body: { competitorName: string; industry?: string; description?: string }) =>
    request<import('../types').CreateDossierFromProjectResponse>(
      `/dossiers/from-project/${projectId}`,
      { method: 'POST', body: JSON.stringify(body) }
    ),

  get: (dossierId: string) =>
    request<import('../types').DossierDetailResponse>(`/dossiers/${dossierId}`),

  update: (dossierId: string, body: { competitorName?: string; industry?: string; description?: string; status?: 'active' | 'archived' }) =>
    request<{ dossier: import('../types').DossierRecord }>(`/dossiers/${dossierId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  getFiles: (dossierId: string) =>
    request<import('../types').DossierFileManifest>(`/dossiers/${dossierId}/files`),

  getFileContent: (dossierId: string, filePath: string) =>
    request<{ content: string; name: string; path: string }>(
      `/dossiers/${dossierId}/files/${encodeURIComponent(filePath)}`
    ),

  getFileDownloadUrl: (dossierId: string, filePath: string) =>
    `${API_BASE}/dossiers/${dossierId}/files/${encodeURIComponent(filePath)}?download=true`,

  staleness: (dossierId: string) =>
    request<{ level: import('../types').StalenessLevel; daysSinceRefresh: number | null }>(
      `/dossiers/${dossierId}/staleness`
    ),

  refresh: (dossierId: string, body?: { regenerateArtifacts?: boolean }) =>
    request<import('../types').RefreshDossierResponse>(
      `/dossiers/${dossierId}/refresh`,
      { method: 'POST', body: JSON.stringify(body ?? {}) }
    ),

  updateFromProject: (dossierId: string, projectId: string) =>
    request<import('../types').UpdateFromProjectResponse>(
      `/dossiers/${dossierId}/update-from-project`,
      { method: 'POST', body: JSON.stringify({ projectId }) }
    ),
};

// =============================================================================
// RETRY ENDPOINTS (Failure Recovery)
// =============================================================================

export const retryApi = {
  retrySynthesis: (projectId: string) =>
    request<{ success: boolean }>(
      `/collaboration/${projectId}/retry-synthesis`,
      { method: 'POST' }
    ),

  retryResearch: (projectId: string) =>
    request<{ success: boolean }>(
      `/collaboration/${projectId}/retry-research`,
      { method: 'POST' }
    ),

  retryVerification: (projectId: string) =>
    request<{ success: boolean }>(
      `/collaboration/${projectId}/retry-verification`,
      { method: 'POST' }
    ),

  retryAnalysis: (projectId: string) =>
    request<{ success: boolean }>(
      `/collaboration/${projectId}/retry-analysis`,
      { method: 'POST' }
    ),

  retryArtifacts: (projectId: string) =>
    request<{ success: boolean }>(
      `/collaboration/${projectId}/retry-artifacts`,
      { method: 'POST' }
    ),

  retryArtifact: (projectId: string, artifactType: string) =>
    request<{ success: boolean }>(
      `/collaboration/${projectId}/retry-artifact`,
      { method: 'POST', body: JSON.stringify({ artifactType }) }
    ),

  stopArtifacts: (projectId: string) =>
    request<{ success: boolean }>(
      `/collaboration/${projectId}/stop-artifacts`,
      { method: 'POST' }
    ),
};
