/**
 * Project List Page
 *
 * Shows all strategic analysis projects with status.
 * Allows creating new projects.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Target, AlertCircle, CheckCircle, Loader2, FileText, Search, ShieldCheck, BarChart3, Trash2, XCircle } from 'lucide-react';
import { useProjects, useCreateProject, useDeleteProject } from '../hooks/useProjects';
import { ConfirmDialog } from '../components/ConfirmDialog';
import type { ProjectSummary } from '../types';

export function ProjectList() {
  const { data, isLoading, error } = useProjects();
  const createProject = useCreateProject();
  const [newName, setNewName] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    await createProject.mutateAsync(newName.trim());
    setNewName('');
    setShowCreate(false);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-text-muted" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 mx-auto mb-4 text-status-blocked-fg" />
          <p className="text-text-muted">Failed to load projects</p>
          <p className="text-sm text-text-subtle mt-1">{(error as Error).message}</p>
        </div>
      </div>
    );
  }

  const projects = data?.projects || [];

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-display font-bold text-text-heading">Projects</h1>
            <p className="text-text-muted mt-1">Competitive Intelligence Research</p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 bg-interactive hover:bg-interactive-hover rounded border border-interactive-border text-text transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Project
          </button>
        </div>

        {/* Create Project Form */}
        {showCreate && (
          <div className="mb-6 p-4 bg-surface-raised rounded-lg border border-surface-border">
            <p className="text-xs text-text-subtle mb-3">Deep competitive intelligence research</p>
            <form onSubmit={handleCreate} className="flex flex-col gap-3">
              <div>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder='Enter project name (e.g., "Stripe Competitive Landscape")...'
                  className="w-full px-3 py-2 bg-surface border border-surface-border rounded text-text placeholder:text-text-subtle focus:outline-none focus:border-interactive-border"
                  autoFocus
                />
                <p className="text-xs text-text-subtle mt-1.5">You'll start by chatting with an AI research collaborator to define your research scope.</p>
              </div>
              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={!newName.trim() || createProject.isPending}
                  className="px-4 py-2 bg-status-complete-bg text-status-complete-fg rounded font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {createProject.isPending ? 'Creating...' : 'Create'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowCreate(false);
                    setNewName('');
                  }}
                  className="px-4 py-2 text-text-muted hover:text-text"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Project List */}
        {projects.length === 0 ? (
          <div className="py-12">
            <div className="max-w-lg mx-auto text-center">
              <Target className="w-12 h-12 mx-auto mb-4 text-brand-blue" />
              <h2 className="text-2xl font-display font-semibold text-text-heading mb-3">Competitive Intelligence in Five Steps</h2>
              <p className="text-sm text-text-muted mb-6 leading-relaxed">
                Define your research scope, and STRATEGOS will investigate your competitive landscape, verify sources, analyze strategic positioning, and produce executive-ready deliverables — all powered by AI.
              </p>

              <div className="text-left space-y-3 mb-6">
                <h3 className="text-xs font-semibold text-text-subtle uppercase tracking-wide">What you'll get</h3>
                <div className="space-y-2">
                  <div className="flex items-start gap-3">
                    <FileText className="w-4 h-4 text-brand-blue mt-0.5 flex-shrink-0" />
                    <span className="text-sm text-text">Research briefs synthesized from your strategic context</span>
                  </div>
                  <div className="flex items-start gap-3">
                    <Search className="w-4 h-4 text-brand-blue mt-0.5 flex-shrink-0" />
                    <span className="text-sm text-text">Multi-source competitive research from three independent teams</span>
                  </div>
                  <div className="flex items-start gap-3">
                    <ShieldCheck className="w-4 h-4 text-brand-blue mt-0.5 flex-shrink-0" />
                    <span className="text-sm text-text">Source-verified findings with confidence scores</span>
                  </div>
                  <div className="flex items-start gap-3">
                    <BarChart3 className="w-4 h-4 text-brand-blue mt-0.5 flex-shrink-0" />
                    <span className="text-sm text-text">Board-ready deliverables: SWOT, PESTLE, Porter's Five Forces, Executive Summary</span>
                  </div>
                </div>
              </div>

              <p className="text-xs text-text-subtle mb-6">
                A typical project takes 4-8 hours from start to finish. Most of that time is automated research — you'll spend about 10 minutes defining scope and reviewing results.
              </p>

              <button
                onClick={() => setShowCreate(true)}
                className="inline-flex items-center gap-2 px-6 py-2.5 bg-brand-blue hover:bg-brand-blue-hover text-white rounded font-medium transition-colors"
              >
                <Plus className="w-4 h-4" />
                New Project
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ProjectCard({ project }: { project: ProjectSummary }) {
  const deleteProject = useDeleteProject();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const getActionLabel = (status: string): string => {
    const labels: Record<string, string> = {
      not_started: 'Start Scoping',
      collaborating: 'Continue Scoping',
      brief_generated: 'Review Research Brief',
      brief_generation_failed: 'Review Error',
      brief_approved: 'View Research',
      researching: 'View Research Progress',
      research_complete: 'View Verification',
      research_failed: 'Review Error',
      verifying: 'View Verification',
      verification_complete: 'View Analysis',
      verification_failed: 'Review Error',
      analyzing: 'View Analysis',
      analysis_complete: 'Select Deliverables',
      analysis_failed: 'Review Error',
      generating_artifacts: 'View Deliverables',
      artifacts_failed: 'Review Error',
      complete: 'View Results',
    };
    return labels[status] || 'Open';
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setConfirmDelete(true);
  };

  return (
    <>
      <Link
        to={`/project/${project.id}`}
        className="block p-4 bg-surface-raised hover:bg-surface-overlay rounded-lg border border-surface-border transition-colors group"
      >
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h3 className="font-display text-lg text-text-heading">{project.name}</h3>
            <div className="flex items-center gap-4 mt-2 text-sm text-text-muted">
              <StatusBadge status={project.status} />
              {project.currentPhaseLabel && (
                <span>{project.currentPhaseLabel}</span>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-subtle">
                Updated {formatRelativeTime(project.updatedAt)}
              </span>
              <button
                onClick={handleDelete}
                className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-brand-magenta/10 text-text-subtle hover:text-brand-magenta transition-all"
                title="Delete project"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            <span className="px-3 py-1 text-sm font-medium text-status-running-fg bg-status-running-bg/50 rounded opacity-0 group-hover:opacity-100 transition-opacity">
              {getActionLabel(project.status)} &rarr;
            </span>
          </div>
        </div>
      </Link>

      <ConfirmDialog
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          deleteProject.mutate(project.id, {
            onSuccess: () => setConfirmDelete(false),
          });
        }}
        title="Delete Project"
        message={`Are you sure you want to delete "${project.name}"?\n\nThis will permanently remove all research data, analysis, and deliverables associated with this project. This action cannot be undone.`}
        confirmLabel="Delete Project"
        confirmVariant="danger"
        isConfirming={deleteProject.isPending}
      />
    </>
  );
}

function StatusBadge({ status }: { status: string }) {
  const configs: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
    not_started: { label: 'Not Started', className: 'bg-surface border-surface-border text-text-muted', icon: null },
    collaborating: { label: 'Scoping', className: 'bg-status-running-bg border-status-running-border text-status-running-fg', icon: <Loader2 className="w-3 h-3 animate-spin" /> },
    brief_generated: { label: 'Brief Ready', className: 'bg-status-attention-bg text-status-attention-fg', icon: <AlertCircle className="w-3 h-3" /> },
    brief_generation_failed: { label: 'Scoping Error', className: 'bg-brand-magenta/10 border-brand-magenta/30 text-brand-magenta', icon: <XCircle className="w-3 h-3" /> },
    brief_approved: { label: 'Brief Approved', className: 'bg-status-complete-bg text-status-complete-fg', icon: <CheckCircle className="w-3 h-3" /> },
    researching: { label: 'Researching', className: 'bg-status-running-bg border-status-running-border text-status-running-fg', icon: <Loader2 className="w-3 h-3 animate-spin" /> },
    research_complete: { label: 'Research Done', className: 'bg-status-complete-bg text-status-complete-fg', icon: <CheckCircle className="w-3 h-3" /> },
    research_failed: { label: 'Research Error', className: 'bg-brand-magenta/10 border-brand-magenta/30 text-brand-magenta', icon: <XCircle className="w-3 h-3" /> },
    verifying: { label: 'Verifying', className: 'bg-status-running-bg border-status-running-border text-status-running-fg', icon: <Loader2 className="w-3 h-3 animate-spin" /> },
    verification_complete: { label: 'Verified', className: 'bg-status-complete-bg text-status-complete-fg', icon: <CheckCircle className="w-3 h-3" /> },
    verification_failed: { label: 'Verification Error', className: 'bg-brand-magenta/10 border-brand-magenta/30 text-brand-magenta', icon: <XCircle className="w-3 h-3" /> },
    analyzing: { label: 'Analyzing', className: 'bg-status-running-bg border-status-running-border text-status-running-fg', icon: <Loader2 className="w-3 h-3 animate-spin" /> },
    analysis_complete: { label: 'Analysis Done', className: 'bg-status-complete-bg text-status-complete-fg', icon: <CheckCircle className="w-3 h-3" /> },
    analysis_failed: { label: 'Analysis Error', className: 'bg-brand-magenta/10 border-brand-magenta/30 text-brand-magenta', icon: <XCircle className="w-3 h-3" /> },
    generating_artifacts: { label: 'Generating', className: 'bg-status-running-bg border-status-running-border text-status-running-fg', icon: <Loader2 className="w-3 h-3 animate-spin" /> },
    artifacts_failed: { label: 'Generation Error', className: 'bg-brand-magenta/10 border-brand-magenta/30 text-brand-magenta', icon: <XCircle className="w-3 h-3" /> },
    complete: { label: 'Complete', className: 'bg-status-complete-bg text-status-complete-fg', icon: <CheckCircle className="w-3 h-3" /> },
  };
  const config = configs[status] || configs.not_started;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium border ${config.className}`}>
      {config.icon}
      {config.label}
    </span>
  );
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}
