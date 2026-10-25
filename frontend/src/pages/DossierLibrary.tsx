/**
 * Dossier Library Page
 *
 * Shows all competitor dossiers with search, status filtering,
 * staleness badges, and confidence ratings. Cards link to detail page.
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, Loader2, BookOpen, FileText, BarChart3, Archive, ArchiveRestore } from 'lucide-react';
import { useDossiers, useUpdateDossier } from '../hooks/useDossiers';
import { useToast } from '../hooks/useToast';
import { StalenessBadge } from '../components/StalenessBadge';
import { ConfidenceBadge } from '../components/ConfidenceBadge';
import { ConfirmDialog } from '../components/ConfirmDialog';
import type { DossierRecord, StalenessLevel, DossierSortKey } from '../types';

function formatRelativeTime(dateString: string | null): string {
  if (!dateString) return 'never';
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

function computeStaleness(lastRefreshedAt: string | null): StalenessLevel {
  if (!lastRefreshedAt) return 'never_refreshed';
  const daysSince = (Date.now() - new Date(lastRefreshedAt).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince <= 30) return 'fresh';
  if (daysSince <= 90) return 'aging';
  return 'stale';
}

const SORT_OPTIONS: { value: DossierSortKey; label: string }[] = [
  { value: 'competitorName', label: 'Name (A-Z)' },
  { value: 'createdAt', label: 'Date Created' },
  { value: 'lastRefreshedAt', label: 'Last Refreshed' },
  { value: 'confidenceRating', label: 'Confidence' },
  { value: 'staleness', label: 'Staleness' },
];

const CONFIDENCE_WEIGHT: Record<string, number> = { High: 3, Medium: 2, Low: 1 };
const STALENESS_WEIGHT: Record<string, number> = { fresh: 1, aging: 2, stale: 3 };

function sortDossiers(dossiers: DossierRecord[], sortKey: DossierSortKey): DossierRecord[] {
  return [...dossiers].sort((a, b) => {
    switch (sortKey) {
      case 'competitorName':
        return a.competitorName.localeCompare(b.competitorName);

      case 'createdAt':
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

      case 'lastRefreshedAt': {
        if (!a.lastRefreshedAt && !b.lastRefreshedAt) return 0;
        if (!a.lastRefreshedAt) return 1;
        if (!b.lastRefreshedAt) return -1;
        return new Date(b.lastRefreshedAt).getTime() - new Date(a.lastRefreshedAt).getTime();
      }

      case 'confidenceRating': {
        const wa = CONFIDENCE_WEIGHT[a.confidenceRating ?? ''] ?? 0;
        const wb = CONFIDENCE_WEIGHT[b.confidenceRating ?? ''] ?? 0;
        return wb - wa;
      }

      case 'staleness': {
        const sa = computeStaleness(a.lastRefreshedAt);
        const sb = computeStaleness(b.lastRefreshedAt);
        const wa = STALENESS_WEIGHT[sa] ?? 4;
        const wb = STALENESS_WEIGHT[sb] ?? 4;
        return wa - wb;
      }

      default:
        return 0;
    }
  });
}

export function DossierLibrary() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'active' | 'archived'>('active');
  const [sortKey, setSortKey] = useState<DossierSortKey>('createdAt');
  const [archiveTarget, setArchiveTarget] = useState<DossierRecord | null>(null);

  const updateDossier = useUpdateDossier();
  const { showToast } = useToast();

  // Debounce search input (300ms)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading, error } = useDossiers({
    status: statusFilter,
    search: debouncedSearch || undefined,
  });

  const handleArchive = () => {
    if (!archiveTarget) return;
    const name = archiveTarget.competitorName;
    updateDossier.mutate(
      { id: archiveTarget.id, body: { status: 'archived' } },
      {
        onSuccess: () => {
          showToast(`${name} archived`, 'success');
          setArchiveTarget(null);
        },
      }
    );
  };

  const handleUnarchive = (dossier: DossierRecord) => {
    updateDossier.mutate(
      { id: dossier.id, body: { status: 'active' } },
      {
        onSuccess: () => showToast(`${dossier.competitorName} restored`, 'success'),
      }
    );
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
          <p className="text-text-muted">Failed to load dossiers</p>
          <p className="text-sm text-text-subtle mt-1">{(error as Error).message}</p>
        </div>
      </div>
    );
  }

  const dossiers = sortDossiers(data?.dossiers || [], sortKey);

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-display font-bold text-text-heading">Competitor Dossier Library</h1>
          <p className="text-text-muted mt-1">Saved competitive intelligence across projects</p>
        </div>

        {/* Search + Filters + Sort */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mb-6">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by competitor name..."
            className="flex-1 w-full sm:w-auto px-3 py-2 bg-surface border border-surface-border rounded text-text placeholder:text-text-subtle focus:outline-none focus:border-interactive-border"
          />
          <div className="flex gap-1">
            <button
              onClick={() => setStatusFilter('active')}
              className={`px-3 py-1.5 text-sm font-medium rounded transition-colors ${
                statusFilter === 'active'
                  ? 'bg-brand-blue text-white'
                  : 'bg-surface-raised text-text-muted hover:text-text border border-surface-border'
              }`}
            >
              Active
            </button>
            <button
              onClick={() => setStatusFilter('archived')}
              className={`px-3 py-1.5 text-sm font-medium rounded transition-colors ${
                statusFilter === 'archived'
                  ? 'bg-brand-blue text-white'
                  : 'bg-surface-raised text-text-muted hover:text-text border border-surface-border'
              }`}
            >
              Archived
            </button>
          </div>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as DossierSortKey)}
            className="px-3 py-2 bg-surface border border-surface-border rounded text-text text-sm focus:outline-none focus:border-interactive-border"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Dossier Grid */}
        {dossiers.length === 0 ? (
          <div className="py-12">
            <div className="max-w-lg mx-auto text-center">
              <BookOpen className="w-12 h-12 mx-auto mb-4 text-brand-blue" />
              <h2 className="text-2xl font-display font-semibold text-text-heading mb-3">
                {debouncedSearch ? 'No Matching Dossiers' : 'No Dossiers Yet'}
              </h2>
              <p className="text-sm text-text-muted mb-6 leading-relaxed">
                {debouncedSearch
                  ? `No dossiers match "${debouncedSearch}". Try a different search term.`
                  : 'Complete a project and save it as a dossier to build your competitor intelligence library.'}
              </p>
              {!debouncedSearch && (
                <Link
                  to="/"
                  className="inline-flex items-center gap-2 px-6 py-2.5 bg-brand-blue hover:bg-brand-blue-hover text-white rounded font-medium transition-colors"
                >
                  View Projects
                </Link>
              )}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {dossiers.map((dossier) => (
              <DossierCard
                key={dossier.id}
                dossier={dossier}
                onArchive={setArchiveTarget}
                onUnarchive={handleUnarchive}
                isUpdating={updateDossier.isPending}
              />
            ))}
          </div>
        )}
      </div>

      {/* Archive Confirmation */}
      <ConfirmDialog
        isOpen={!!archiveTarget}
        onClose={() => setArchiveTarget(null)}
        onConfirm={handleArchive}
        isConfirming={updateDossier.isPending}
        title="Archive Dossier"
        message={archiveTarget ? `Archive "${archiveTarget.competitorName}"? You can unarchive it later from the library.` : ''}
        confirmLabel="Archive"
      />
    </div>
  );
}

function DossierCard({
  dossier,
  onArchive,
  onUnarchive,
  isUpdating,
}: {
  dossier: DossierRecord;
  onArchive: (dossier: DossierRecord) => void;
  onUnarchive: (dossier: DossierRecord) => void;
  isUpdating: boolean;
}) {
  const staleness = computeStaleness(dossier.lastRefreshedAt);
  const isArchived = dossier.status === 'archived';

  return (
    <Link to={`/dossiers/${dossier.id}`} className="block">
      <div className="relative p-4 bg-surface-raised rounded-lg border border-surface-border hover:bg-surface-overlay transition-colors">
        {/* Archive/Unarchive button */}
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (isArchived) {
              onUnarchive(dossier);
            } else {
              onArchive(dossier);
            }
          }}
          disabled={isUpdating}
          className="absolute top-3 right-3 p-1.5 text-text-subtle hover:text-text-muted hover:bg-surface transition-colors rounded disabled:opacity-50"
          title={isArchived ? 'Unarchive' : 'Archive'}
        >
          {isArchived ? (
            <ArchiveRestore className="w-4 h-4" />
          ) : (
            <Archive className="w-4 h-4" />
          )}
        </button>

        {/* Header */}
        <div className="flex items-start justify-between mb-3 pr-8">
          <h3 className="font-display text-lg text-text-heading leading-tight">{dossier.competitorName}</h3>
          <StalenessBadge level={staleness} />
        </div>

        {/* Industry */}
        {dossier.industry && (
          <p className="text-xs text-text-muted mb-3">{dossier.industry}</p>
        )}

        {/* Badges */}
        <div className="flex items-center gap-2 mb-3">
          {dossier.confidenceRating && (
            <ConfidenceBadge rating={dossier.confidenceRating} tooltip="Overall confidence from verification" />
          )}
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 text-xs text-text-subtle">
          <span className="flex items-center gap-1">
            <FileText className="w-3 h-3" />
            {dossier.researchWordCount.toLocaleString()} words
          </span>
          <span className="flex items-center gap-1">
            <BarChart3 className="w-3 h-3" />
            {dossier.artifactCount} deliverable{dossier.artifactCount !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Last refreshed */}
        <p className="text-xs text-text-subtle mt-3">
          Refreshed {formatRelativeTime(dossier.lastRefreshedAt)}
        </p>
      </div>
    </Link>
  );
}
