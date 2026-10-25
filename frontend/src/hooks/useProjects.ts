/**
 * React Query hooks for STRATEGOS data
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { projectsApi, collaborationApi, researchApi, verificationApi, analysisApi, artifactsApi, importApi, rerunApi, retryApi, briefApi, researchControlApi, exportApi } from '../lib/api';
import { useToast } from './useToast';
import { friendlyErrorMessage } from '../lib/errors';

// =============================================================================
// PROJECTS
// =============================================================================

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: projectsApi.list,
  });
}

export function useProject(projectId: string | undefined) {
  return useQuery({
    queryKey: ['project', projectId],
    queryFn: () => projectsApi.get(projectId!),
    enabled: !!projectId,
    refetchInterval: 5000,
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  return useMutation({
    mutationFn: (name: string) => projectsApi.create(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      showToast('Project created successfully', 'success');
    },
    onError: (error) => {
      showToast(friendlyErrorMessage((error as Error).message), 'error');
    },
  });
}

export function useDeleteProject() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  return useMutation({
    mutationFn: (id: string) => projectsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      showToast('Project deleted successfully', 'success');
    },
    onError: (error) => {
      showToast(friendlyErrorMessage((error as Error).message), 'error');
    },
  });
}

// =============================================================================
// COLLABORATION (Phase 0: Chat + Brief)
// =============================================================================

export function useCollaborationChat(projectId: string | undefined) {
  return useQuery({
    queryKey: ['collaboration', 'chat', projectId],
    queryFn: () => collaborationApi.getChatHistory(projectId!),
    enabled: !!projectId,
  });
}

export function useSendCollaborationChat() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ projectId, message }: { projectId: string; message: string }) =>
      collaborationApi.sendChat(projectId, message),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: ['collaboration', 'chat', projectId] });
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    },
  });
}

export function useSynthesizeBrief() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  return useMutation({
    mutationFn: (projectId: string) => collaborationApi.synthesizeBrief(projectId),
    onSuccess: (_, projectId) => {
      queryClient.invalidateQueries({ queryKey: ['collaboration', 'brief', projectId] });
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      showToast('Research brief created successfully', 'success');
    },
    onError: (error) => {
      showToast(friendlyErrorMessage((error as Error).message), 'error');
    },
  });
}

export function useCollaborationBrief(projectId: string | undefined, briefGenerated?: boolean) {
  return useQuery({
    queryKey: ['collaboration', 'brief', projectId],
    queryFn: () => collaborationApi.getBrief(projectId!),
    enabled: !!projectId && briefGenerated === true,
    retry: false,
  });
}

export function useApproveBrief() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  return useMutation({
    mutationFn: (projectId: string) => collaborationApi.approveBrief(projectId),
    onSuccess: (_, projectId) => {
      queryClient.invalidateQueries({ queryKey: ['collaboration', 'brief', projectId] });
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      showToast('Research brief approved — Deep research started', 'success');
    },
    onError: (error) => {
      showToast(friendlyErrorMessage((error as Error).message), 'error');
    },
  });
}

// =============================================================================
// BRIEF EDITING
// =============================================================================

export function useUpdateBrief() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  return useMutation({
    mutationFn: ({ projectId, content }: { projectId: string; content: string }) =>
      briefApi.updateBrief(projectId, content),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: ['collaboration', 'brief', projectId] });
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      showToast('Research Brief updated', 'success');
    },
    onError: (error) => {
      showToast(friendlyErrorMessage((error as Error).message), 'error');
    },
  });
}

// =============================================================================
// RESEARCH (Phase 1: Deep Research)
// =============================================================================

export function useStartResearch() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  return useMutation({
    mutationFn: (projectId: string) => researchApi.startResearch(projectId),
    onSuccess: (_, projectId) => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      showToast('Deep research started', 'info');
    },
    onError: (error) => {
      showToast(friendlyErrorMessage((error as Error).message), 'error');
    },
  });
}

// =============================================================================
// VERIFICATION (Phase 2: Source Verification)
// =============================================================================

export function useStartVerification() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  return useMutation({
    mutationFn: (projectId: string) => verificationApi.startVerification(projectId),
    onSuccess: (_, projectId) => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      showToast('Source verification started', 'info');
    },
    onError: (error) => {
      showToast(friendlyErrorMessage((error as Error).message), 'error');
    },
  });
}

// =============================================================================
// ANALYSIS (Phase 3: Strategic Analysis)
// =============================================================================

export function useStartAnalysis() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  return useMutation({
    mutationFn: (projectId: string) => analysisApi.startAnalysis(projectId),
    onSuccess: (_, projectId) => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      showToast('Strategic analysis started', 'info');
    },
    onError: (error) => {
      showToast(friendlyErrorMessage((error as Error).message), 'error');
    },
  });
}

// =============================================================================
// ARTIFACTS (Phase 4: Deliverable Generation)
// =============================================================================

export function useSelectArtifacts() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ projectId, types }: { projectId: string; types: string[] }) =>
      artifactsApi.selectArtifacts(projectId, types),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    },
  });
}

// =============================================================================
// IMPORT DOCUMENT (External Document Import)
// =============================================================================

export function useImportDocument() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  return useMutation({
    mutationFn: ({ projectId, phase, files }: { projectId: string; phase: string; files: Array<{ name: string; content: string }> }) =>
      importApi.importDocument(projectId, phase, files),
    onSuccess: (_, { projectId, phase }) => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      queryClient.invalidateQueries({ queryKey: ['collaboration', 'brief', projectId] });
      showToast(`Imported ${phase} document(s) successfully`, 'success');
    },
    onError: (error) => {
      showToast(friendlyErrorMessage((error as Error).message), 'error');
    },
  });
}

// =============================================================================
// RE-RUN PHASE (Reset + Re-run)
// =============================================================================

export function useRerunPhase() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  return useMutation({
    mutationFn: ({ projectId, phase }: { projectId: string; phase: string }) =>
      rerunApi.rerunPhase(projectId, phase),
    onSuccess: (_, { projectId, phase }) => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      queryClient.invalidateQueries({ queryKey: ['collaboration', 'brief', projectId] });
      showToast(`Reset ${phase} — ready to re-run`, 'success');
    },
    onError: (error) => {
      showToast(friendlyErrorMessage((error as Error).message), 'error');
    },
  });
}

// =============================================================================
// RESEARCH CONTROL (Per-Provider Re-Run + Stop)
// =============================================================================

export function useRerunProvider() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  return useMutation({
    mutationFn: ({ projectId, provider }: { projectId: string; provider: string }) =>
      researchControlApi.rerunProvider(projectId, provider),
    onSuccess: (_, { projectId, provider }) => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      showToast(`Re-running research provider: ${provider}`, 'info');
    },
    onError: (error) => {
      showToast(friendlyErrorMessage((error as Error).message), 'error');
    },
  });
}

export function useStopResearch() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  return useMutation({
    mutationFn: ({ projectId, providers }: { projectId: string; providers?: string[] }) =>
      researchControlApi.stopResearch(projectId, providers),
    onSuccess: (data, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      if (data.allStopped) {
        showToast('All research stopped', 'info');
      } else if (data.anyComplete) {
        showToast('Research stopped — some providers completed', 'info');
      } else {
        showToast('Research stopped', 'info');
      }
    },
    onError: (error) => {
      showToast(friendlyErrorMessage((error as Error).message), 'error');
    },
  });
}

// =============================================================================
// RETRY MUTATIONS (Failure Recovery)
// =============================================================================

export function useRetrySynthesis(projectId: string) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  return useMutation({
    mutationFn: () => retryApi.retrySynthesis(projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      queryClient.invalidateQueries({ queryKey: ['collaboration', 'brief', projectId] });
    },
    onError: (error) => {
      showToast(friendlyErrorMessage((error as Error).message), 'error');
    },
  });
}

export function useRetryResearch(projectId: string) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  return useMutation({
    mutationFn: () => retryApi.retryResearch(projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    },
    onError: (error) => {
      showToast(friendlyErrorMessage((error as Error).message), 'error');
    },
  });
}

export function useRetryVerification(projectId: string) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  return useMutation({
    mutationFn: () => retryApi.retryVerification(projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    },
    onError: (error) => {
      showToast(friendlyErrorMessage((error as Error).message), 'error');
    },
  });
}

export function useRetryAnalysis(projectId: string) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  return useMutation({
    mutationFn: () => retryApi.retryAnalysis(projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    },
    onError: (error) => {
      showToast(friendlyErrorMessage((error as Error).message), 'error');
    },
  });
}

export function useRetryArtifacts(projectId: string) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  return useMutation({
    mutationFn: () => retryApi.retryArtifacts(projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    },
    onError: (error) => {
      showToast(friendlyErrorMessage((error as Error).message), 'error');
    },
  });
}

// =============================================================================
// ITEM-LEVEL RETRY + STOP (Artifact Control)
// =============================================================================

export function useRetryArtifact(projectId: string) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  return useMutation({
    mutationFn: (artifactType: string) =>
      retryApi.retryArtifact(projectId, artifactType),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    },
    onError: (error: Error) => {
      showToast(friendlyErrorMessage(error.message), 'error');
    },
  });
}

export function useStopArtifacts(projectId: string) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  return useMutation({
    mutationFn: () =>
      retryApi.stopArtifacts(projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      showToast('Generation stopped — completed deliverables are preserved', 'info');
    },
    onError: (error: Error) => {
      showToast(friendlyErrorMessage(error.message), 'error');
    },
  });
}

// =============================================================================
// EXPORT (Document Export)
// =============================================================================

export function useExportArtifact(projectId: string) {
  const { showToast } = useToast();

  return useMutation({
    mutationFn: ({ artifactType, format }: { artifactType: string; format: 'docx' | 'pptx' }) =>
      exportApi.generate(projectId, artifactType, format),
    onSuccess: (data) => {
      window.location.href = exportApi.downloadUrl(projectId, data.filename);
      showToast('Document generated -- downloading now', 'success');
    },
    onError: (error: Error) => {
      showToast(friendlyErrorMessage(error.message), 'error');
    },
  });
}

export function useExportPacket(projectId: string) {
  const { showToast } = useToast();

  return useMutation({
    mutationFn: (options?: { customerReady?: boolean; excludeSections?: string[]; includeWarnings?: boolean }) =>
      exportApi.generatePacket(projectId, options),
    onSuccess: (data) => {
      window.location.href = exportApi.downloadUrl(projectId, data.filename);
      showToast('Competitive Packet generated -- downloading now', 'success');
    },
    onError: (error: Error) => {
      showToast(friendlyErrorMessage(error.message), 'error');
    },
  });
}
