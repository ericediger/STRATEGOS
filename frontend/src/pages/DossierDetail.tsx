/**
 * Dossier Detail Page
 *
 * Shows full dossier details: header with badges, metadata,
 * content browser, linked projects, and change log.
 * Supports archive/unarchive actions.
 */

import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft,
  AlertCircle,
  Loader2,
  Calendar,
  RefreshCw,
  FileText,
  BarChart3,
  Archive,
  ArchiveRestore,
  ExternalLink,
  Clock,
} from 'lucide-react';
import { useDossier, useDossierFiles, useUpdateDossier, useRefreshDossier } from '../hooks/useDossiers';
import { useToast } from '../hooks/useToast';
import { StalenessBadge } from '../components/StalenessBadge';
import { ConfidenceBadge } from '../components/ConfidenceBadge';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ContentBrowser } from '../components/ContentBrowser';
import type { StalenessLevel } from '../types';

function computeStaleness(lastRefreshedAt: string | null): StalenessLevel {
  if (!lastRefreshedAt) return 'never_refreshed';
  const daysSince = (Date.now() - new Date(lastRefreshedAt).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince <= 30) return 'fresh';
  if (daysSince <= 90) return 'aging';
  return 'stale';
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
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
  return formatDate(dateString);
}

const STATUS_BADGE_COLORS: Record<string, string> = {
  complete: 'bg-brand-green text-white',
  researching: 'bg-brand-blue text-white',
  analyzing: 'bg-brand-blue text-white',
  generating_artifacts: 'bg-brand-blue text-white',
  research_failed: 'bg-brand-magenta text-white',
  analysis_failed: 'bg-brand-magenta text-white',
  verification_failed: 'bg-brand-magenta text-white',
  artifacts_failed: 'bg-brand-magenta text-white',
};

function getStatusColor(status: string): string {
  return STATUS_BADGE_COLORS[status] || 'bg-surface-overlay text-text-muted';
}

export function DossierDetail() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error } = useDossier(id);
  const { data: filesData, isLoading: filesLoading } = useDossierFiles(id);
  const updateDossier = useUpdateDossier();
  const refreshDossier = useRefreshDossier();
  const { showToast } = useToast();

  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmRefresh, setConfirmRefresh] = useState(false);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-text-muted" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 mx-auto mb-4 text-status-blocked-fg" />
          <p className="text-text-muted">Dossier not found</p>
          <Link to="/dossiers" className="text-status-running-fg hover:underline mt-4 inline-block">
            Back to Library
          </Link>
        </div>
      </div>
    );
  }

  const { dossier, linkedProjects } = data;
  const staleness = computeStaleness(dossier.lastRefreshedAt);
  const isArchived = dossier.status === 'archived';

  const handleArchive = () => {
    updateDossier.mutate(
      { id: dossier.id, body: { status: 'archived' } },
      {
        onSuccess: () => {
          showToast(`${dossier.competitorName} archived`, 'success');
          setConfirmArchive(false);
        },
      }
    );
  };

  const handleUnarchive = () => {
    updateDossier.mutate(
      { id: dossier.id, body: { status: 'active' } },
      {
        onSuccess: () => showToast(`${dossier.competitorName} restored`, 'success'),
      }
    );
  };

  const handleRefresh = () => {
    refreshDossier.mutate({ id: dossier.id });
    setConfirmRefresh(false);
  };

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-5xl mx-auto">
        {/* Back link */}
        <Link
          to="/dossiers"
          className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Library
        </Link>

        {/* Archived banner */}
        {isArchived && (
          <div className="mb-4 px-4 py-2.5 rounded-lg bg-amber-100 border border-amber-300 text-amber-800 text-sm font-medium">
            This dossier is archived
          </div>
        )}

        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-3xl font-display font-bold text-text-heading">
                {dossier.competitorName}
              </h1>
              <StalenessBadge level={staleness} />
              {dossier.confidenceRating && (
                <ConfidenceBadge
                  rating={dossier.confidenceRating as 'High' | 'Medium' | 'Low'}
                  tooltip="Overall confidence from verification"
                />
              )}
            </div>
            {dossier.industry && (
              <p className="text-text-muted">{dossier.industry}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isArchived ? (
              <button
                onClick={handleUnarchive}
                disabled={updateDossier.isPending}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium border border-surface-border rounded text-text-muted hover:bg-surface-overlay transition-colors disabled:opacity-50"
              >
                <ArchiveRestore className="w-4 h-4" />
                Unarchive
              </button>
            ) : (
              <>
                <button
                  onClick={() => setConfirmRefresh(true)}
                  disabled={refreshDossier.isPending}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-brand-blue text-white rounded hover:bg-brand-blue-hover transition-colors disabled:opacity-50"
                >
                  {refreshDossier.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4" />
                  )}
                  Refresh Research
                </button>
                <button
                  onClick={() => setConfirmArchive(true)}
                  disabled={updateDossier.isPending}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium border border-surface-border rounded text-text-muted hover:bg-surface-overlay transition-colors disabled:opacity-50"
                >
                  <Archive className="w-4 h-4" />
                  Archive
                </button>
              </>
            )}
          </div>
        </div>

        {/* Metadata row */}
        <div className="flex flex-wrap items-center gap-6 text-sm text-text-subtle mb-8 pb-6 border-b border-surface-border">
          <span className="flex items-center gap-1.5">
            <Calendar className="w-4 h-4" />
            Created {formatDate(dossier.createdAt)}
          </span>
          <span className="flex items-center gap-1.5">
            <RefreshCw className="w-4 h-4" />
            Refreshed {dossier.lastRefreshedAt ? formatRelativeTime(dossier.lastRefreshedAt) : 'never'}
          </span>
          <span className="flex items-center gap-1.5">
            <FileText className="w-4 h-4" />
            {dossier.researchWordCount.toLocaleString()} words
          </span>
          <span className="flex items-center gap-1.5">
            <BarChart3 className="w-4 h-4" />
            {dossier.artifactCount} deliverable{dossier.artifactCount !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Content Browser */}
        <section className="mb-8">
          <h2 className="text-xl font-display font-semibold text-text-heading mb-4">Content</h2>
          <ContentBrowser
            dossierId={dossier.id}
            manifest={filesData ?? null}
            isLoading={filesLoading}
          />
        </section>

        {/* Linked Projects */}
        {linkedProjects.length > 0 && (
          <section className="mb-8">
            <h2 className="text-xl font-display font-semibold text-text-heading mb-4">Linked Projects</h2>
            <div className="space-y-3">
              {linkedProjects.map((lp) => (
                <div
                  key={lp.projectId}
                  className="flex items-center justify-between p-4 bg-surface-raised rounded-lg border border-surface-border"
                >
                  <div>
                    <p className="font-medium text-text-heading">{lp.projectName}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold rounded leading-none ${getStatusColor('complete')}`}>
                        {lp.relationship.charAt(0).toUpperCase() + lp.relationship.slice(1)}
                      </span>
                      <span className="text-xs text-text-subtle">
                        Linked {formatRelativeTime(lp.linkedAt)}
                      </span>
                    </div>
                  </div>
                  <Link
                    to={`/project/${lp.projectId}`}
                    className="flex items-center gap-1.5 text-sm text-brand-blue hover:underline"
                  >
                    View Project
                    <ExternalLink className="w-3.5 h-3.5" />
                  </Link>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Change Log */}
        {dossier.changeLog.length > 0 && (
          <section className="mb-8">
            <h2 className="text-xl font-display font-semibold text-text-heading mb-4">Change Log</h2>
            <div className="space-y-3">
              {dossier.changeLog.slice().reverse().map((entry, i) => (
                <div key={i} className="flex items-start gap-3">
                  <Clock className="w-4 h-4 text-text-subtle mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm text-text">{entry.summary}</p>
                    <p className="text-xs text-text-subtle mt-0.5">{formatRelativeTime(entry.date)}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Archive Confirmation */}
      <ConfirmDialog
        isOpen={confirmArchive}
        onClose={() => setConfirmArchive(false)}
        onConfirm={handleArchive}
        isConfirming={updateDossier.isPending}
        title="Archive Dossier"
        message={`Archive "${dossier.competitorName}"? You can unarchive it later from the library.`}
        confirmLabel="Archive"
      />

      {/* Refresh Confirmation */}
      <ConfirmDialog
        isOpen={confirmRefresh}
        onClose={() => setConfirmRefresh(false)}
        onConfirm={handleRefresh}
        isConfirming={refreshDossier.isPending}
        title="Refresh Research"
        message={`Re-run the full research pipeline for ${dossier.competitorName}, focusing on changes since ${formatDate(dossier.lastRefreshedAt ?? dossier.createdAt)}. Estimated time: 10-30 minutes.`}
        confirmLabel="Start Refresh"
      />
    </div>
  );
}
