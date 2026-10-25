/**
 * React Query hooks for Dossier Library
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { dossierApi } from '../lib/api';
import { useToast } from './useToast';
import { friendlyErrorMessage } from '../lib/errors';
import type { DossierFilters } from '../types';

export function useDossiers(filters?: DossierFilters) {
  return useQuery({
    queryKey: ['dossiers', filters?.status, filters?.search],
    queryFn: () => dossierApi.list(filters),
    refetchInterval: 30000,
  });
}

export function useDossier(id: string | undefined) {
  return useQuery({
    queryKey: ['dossier', id],
    queryFn: () => dossierApi.get(id!),
    enabled: !!id,
    refetchInterval: 30000,
  });
}

export function useDossierFiles(id: string | undefined) {
  return useQuery({
    queryKey: ['dossier-files', id],
    queryFn: () => dossierApi.getFiles(id!),
    enabled: !!id,
  });
}

export function useUpdateDossier() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  return useMutation({
    mutationFn: ({ id, body }: {
      id: string;
      body: { competitorName?: string; industry?: string; description?: string; status?: 'active' | 'archived' };
    }) => dossierApi.update(id, body),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['dossiers'] });
      queryClient.invalidateQueries({ queryKey: ['dossier', variables.id] });
    },
    onError: (error) => {
      showToast(friendlyErrorMessage((error as Error).message), 'error');
    },
  });
}

export function useRefreshDossier() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  return useMutation({
    mutationFn: ({ id, regenerateArtifacts }: { id: string; regenerateArtifacts?: boolean }) =>
      dossierApi.refresh(id, { regenerateArtifacts }),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['dossier', id] });
      queryClient.invalidateQueries({ queryKey: ['dossiers'] });
      showToast('Refresh started. This will take 10-30 minutes.', 'info');
    },
    onError: (error) => {
      const msg = (error as Error).message;
      const message = msg.includes('423')
        ? 'A refresh is already in progress.'
        : msg.includes('409')
        ? 'Cannot refresh an archived dossier.'
        : 'Failed to start refresh. Please try again.';
      showToast(message, 'error');
    },
  });
}

export function useUpdateDossierFromProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ dossierId, projectId }: { dossierId: string; projectId: string }) =>
      dossierApi.updateFromProject(dossierId, projectId),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['dossier', variables.dossierId] });
      queryClient.invalidateQueries({ queryKey: ['dossiers'] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

export function useCreateDossierFromProject() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  return useMutation({
    mutationFn: ({ projectId, body }: {
      projectId: string;
      body: { competitorName: string; industry?: string; description?: string };
    }) => dossierApi.createFromProject(projectId, body),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['dossiers'] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      showToast(`Dossier created for ${data.dossier.competitorName}`, 'success');
    },
    onError: (error) => {
      const msg = (error as Error).message;
      if (msg.includes('409') || msg.toLowerCase().includes('already exists') || msg.toLowerCase().includes('conflict')) {
        showToast('A dossier already exists for this project', 'info');
      } else {
        showToast(friendlyErrorMessage(msg), 'error');
      }
    },
  });
}
