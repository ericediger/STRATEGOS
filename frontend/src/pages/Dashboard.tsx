/**
 * Project Dashboard Page
 *
 * Main dashboard for strategic analysis projects.
 * Orchestrates 5-phase progress bar and per-phase panel components.
 * Phase 0: Collaboration (chat + brief synthesis + approval)
 * Phase 1: Deep Research (3-provider concurrent)
 * Phase 2: Source Verification (7-step pipeline)
 * Phase 3: Strategic Analysis
 * Phase 4: Artifact Generation (SWOT, PESTLE, Five Forces, etc.)
 */

import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  AlertCircle,
  CheckCircle,
  Loader2,
  FileText,
  Sparkles,
  BookmarkPlus,
  BookOpen,
  RefreshCw,
} from 'lucide-react';
import { useProject, useCollaborationBrief, useApproveBrief, useUpdateBrief, useStartResearch, useStartVerification, useStartAnalysis, useSelectArtifacts, useImportDocument, useRerunPhase, useRerunProvider, useStopResearch, useRetrySynthesis, useRetryResearch, useRetryVerification, useRetryAnalysis, useRetryArtifacts, useRetryArtifact, useStopArtifacts } from '../hooks/useProjects';
import { ErrorBoundary, PanelErrorFallback } from '../components/ErrorBoundary';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { PhaseProgressBar } from '../components/PhaseProgressBar';
import { CollaborationPanel, ResearchPanel, VerificationPanel, AnalysisPanel, ArtifactsPanel, ARTIFACT_TYPE_DEFS } from '../components/panels';
import { SaveAsDossierDialog } from '../components/SaveAsDossierDialog';
import { useUpdateDossierFromProject } from '../hooks/useDossiers';
import { useToast } from '../hooks/useToast';
import type { DashboardData } from '../types';

export function Dashboard() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data, isLoading, error } = useProject(projectId);
  const brief = useCollaborationBrief(projectId, data?.collaboration?.briefGenerated);
  const approveBrief = useApproveBrief();
  const updateBrief = useUpdateBrief();
  const startResearch = useStartResearch();
  const startVerification = useStartVerification();
  const startAnalysis = useStartAnalysis();
  const selectArtifacts = useSelectArtifacts();
  const importDocument = useImportDocument();
  const rerunPhase = useRerunPhase();
  const rerunProvider = useRerunProvider();
  const stopResearch = useStopResearch();
  const retrySynthesis = useRetrySynthesis(projectId!);
  const retryResearch = useRetryResearch(projectId!);
  const retryVerification = useRetryVerification(projectId!);
  const retryAnalysis = useRetryAnalysis(projectId!);
  const retryArtifacts = useRetryArtifacts(projectId!);
  const retryArtifact = useRetryArtifact(projectId!);
  const stopArtifacts = useStopArtifacts(projectId!);
  const navigate = useNavigate();
  const updateDossierFromProject = useUpdateDossierFromProject();
  const { showToast } = useToast();

  // Confirmation dialog states
  const [confirmApproveBrief, setConfirmApproveBrief] = useState(false);
  const [confirmStartResearch, setConfirmStartResearch] = useState(false);
  const [confirmStartVerification, setConfirmStartVerification] = useState(false);
  const [confirmStartAnalysis, setConfirmStartAnalysis] = useState(false);
  const [confirmGenerateArtifacts, setConfirmGenerateArtifacts] = useState<string[] | null>(null);
  const [confirmRerun, setConfirmRerun] = useState<string | null>(null);
  const [confirmRerunProvider, setConfirmRerunProvider] = useState<{ key: string; label: string } | null>(null);
  const [confirmStopResearch, setConfirmStopResearch] = useState<{ providers?: string[]; label: string } | null>(null);
  const [confirmStopArtifacts, setConfirmStopArtifacts] = useState(false);
  const [showSaveDossier, setShowSaveDossier] = useState(false);
  const [confirmUpdateDossier, setConfirmUpdateDossier] = useState(false);

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
          <p className="text-text-muted">Failed to load project</p>
          <Link to="/" className="text-status-running-fg hover:underline mt-4 inline-block">
            Back to projects
          </Link>
        </div>
      </div>
    );
  }

  const dashboard = data as DashboardData;
  const { project, collaboration, research, currentPhase } = dashboard;

  const handleApproveBrief = () => {
    approveBrief.mutate(project.id);
    setConfirmApproveBrief(false);
  };

  const handleStartResearch = () => {
    startResearch.mutate(project.id);
    setConfirmStartResearch(false);
  };

  const handleStartVerification = () => {
    startVerification.mutate(project.id);
    setConfirmStartVerification(false);
  };

  const handleStartAnalysis = () => {
    startAnalysis.mutate(project.id);
    setConfirmStartAnalysis(false);
  };

  const handleGenerateArtifacts = () => {
    if (confirmGenerateArtifacts) {
      selectArtifacts.mutate({ projectId: project.id, types: confirmGenerateArtifacts });
      setConfirmGenerateArtifacts(null);
    }
  };

  const handleRerun = () => {
    if (confirmRerun) {
      rerunPhase.mutate({ projectId: project.id, phase: confirmRerun });
      setConfirmRerun(null);
    }
  };

  const handleRerunProvider = () => {
    if (confirmRerunProvider) {
      rerunProvider.mutate({ projectId: project.id, provider: confirmRerunProvider.key });
      setConfirmRerunProvider(null);
    }
  };

  const handleStopResearch = () => {
    if (confirmStopResearch) {
      stopResearch.mutate({ projectId: project.id, providers: confirmStopResearch.providers });
      setConfirmStopResearch(null);
    }
  };

  const handleStopArtifacts = () => {
    stopArtifacts.mutate();
    setConfirmStopArtifacts(false);
  };

  const handleUpdateDossier = () => {
    const linked = dashboard.linkedDossier;
    if (!linked) return;
    updateDossierFromProject.mutate(
      { dossierId: linked.dossierId, projectId: project.id },
      {
        onSuccess: () => {
          showToast('Dossier updated with new research.', 'success');
          setConfirmUpdateDossier(false);
          navigate(`/dossiers/${linked.dossierId}`);
        },
        onError: (err) => {
          showToast((err as Error).message || 'Failed to update dossier', 'error');
          setConfirmUpdateDossier(false);
        },
      }
    );
  };

  const handleImportFiles = (phase: string, fileList: FileList) => {
    const readPromises = Array.from(fileList).map(file =>
      new Promise<{ name: string; content: string }>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve({ name: file.name, content: reader.result as string });
        reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
        reader.readAsText(file);
      })
    );
    Promise.all(readPromises).then(files => {
      importDocument.mutate({ projectId: project.id, phase, files });
    });
  };

  const rerunDownstreamPhases: Record<string, string> = {
    collaboration: 'research, verification, analysis, and deliverables',
    research: 'verification, analysis, and deliverables',
    verification: 'analysis and deliverables',
    analysis: 'deliverables',
    artifacts: '',
  };

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-surface-border bg-surface-raised">
        <div className="max-w-5xl mx-auto px-6 py-4">
          <div className="flex items-center gap-4">
            <Link to="/" className="p-2 hover:bg-interactive rounded transition-colors">
              <ArrowLeft className="w-5 h-5 text-text-muted" />
            </Link>
            <div className="flex-1">
              <h1 className="text-2xl font-display font-semibold text-text-heading">{project.name}</h1>
              <p className="text-sm text-text-muted mt-1">Strategic Analysis</p>
            </div>
          </div>
        </div>
      </header>

      {/* Phase Progress Bar */}
      <div className="border-b border-surface-border bg-surface">
        <div className="max-w-5xl mx-auto px-6 py-3">
          <PhaseProgressBar
            currentPhase={currentPhase}
            status={project.status}
            research={research}
            verification={dashboard.verification}
            artifacts={dashboard.artifacts}
            collaboration={collaboration}
          />
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        {/* Phase 0: Collaboration */}
        <ErrorBoundary fallback={<PanelErrorFallback phase="Collaboration" />}>
          <CollaborationPanel
            projectId={project.id}
            status={project.status}
            messageCount={collaboration.messageCount}
            briefGenerated={collaboration.briefGenerated}
            briefApproved={collaboration.briefApproved}
            briefData={brief.data}
            briefLoading={brief.isLoading}
            onApproveBrief={() => setConfirmApproveBrief(true)}
            isApprovingBrief={approveBrief.isPending}
            onUpdateBrief={(content) => updateBrief.mutate({ projectId: project.id, content })}
            isUpdatingBrief={updateBrief.isPending}
            errorMessage={project.error_message}
            onRetrySynthesis={() => retrySynthesis.mutate()}
            isRetryingSynthesis={retrySynthesis.isPending}
            onImport={(files) => handleImportFiles('collaboration', files)}
            isImporting={importDocument.isPending}
            onRerun={() => setConfirmRerun('collaboration')}
          />
        </ErrorBoundary>

        {/* Phase 1: Research */}
        <ErrorBoundary fallback={<PanelErrorFallback phase="Research" />}>
          <ResearchPanel
            research={research}
            currentPhase={currentPhase}
            projectStatus={project.status}
            projectId={project.id}
            onStartResearch={() => setConfirmStartResearch(true)}
            isStartingResearch={startResearch.isPending}
            errorMessage={project.error_message}
            onRetryResearch={() => retryResearch.mutate()}
            isRetryingResearch={retryResearch.isPending}
            onImport={(files) => handleImportFiles('research', files)}
            isImporting={importDocument.isPending}
            onRerun={() => setConfirmRerun('research')}
            onRerunProvider={(key, label) => setConfirmRerunProvider({ key, label })}
            isRerunningProvider={rerunProvider.isPending}
            onStopAll={() => setConfirmStopResearch({ label: 'All Research' })}
            onStopProvider={(key, label) => setConfirmStopResearch({ providers: [key], label })}
            isStopping={stopResearch.isPending}
          />
        </ErrorBoundary>

        {/* Phase 2: Verification */}
        <ErrorBoundary fallback={<PanelErrorFallback phase="Verification" />}>
          <VerificationPanel
            verification={dashboard.verification}
            currentPhase={currentPhase}
            projectStatus={project.status}
            projectId={project.id}
            onStartVerification={() => setConfirmStartVerification(true)}
            isStartingVerification={startVerification.isPending}
            errorMessage={project.error_message}
            onRetryVerification={() => retryVerification.mutate()}
            isRetryingVerification={retryVerification.isPending}
            onImport={(files) => handleImportFiles('verification', files)}
            isImporting={importDocument.isPending}
            onRerun={() => setConfirmRerun('verification')}
          />
        </ErrorBoundary>

        {/* Phase 3: Analysis */}
        <ErrorBoundary fallback={<PanelErrorFallback phase="Analysis" />}>
          <AnalysisPanel
            analysis={dashboard.analysis}
            currentPhase={currentPhase}
            projectStatus={project.status}
            projectId={project.id}
            onStartAnalysis={() => setConfirmStartAnalysis(true)}
            isStartingAnalysis={startAnalysis.isPending}
            errorMessage={project.error_message}
            onRetryAnalysis={() => retryAnalysis.mutate()}
            isRetryingAnalysis={retryAnalysis.isPending}
            onImport={(files) => handleImportFiles('analysis', files)}
            isImporting={importDocument.isPending}
            onRerun={() => setConfirmRerun('analysis')}
          />
        </ErrorBoundary>

        {/* Phase 4: Artifacts */}
        <ErrorBoundary fallback={<PanelErrorFallback phase="Deliverables" />}>
          <ArtifactsPanel
            artifacts={dashboard.artifacts}
            analysis={dashboard.analysis}
            currentPhase={currentPhase}
            projectStatus={project.status}
            projectId={project.id}
            confidence={dashboard.confidence}
            onSelectArtifacts={(types) => setConfirmGenerateArtifacts(types)}
            isSelectingArtifacts={selectArtifacts.isPending}
            errorMessage={project.error_message}
            onRetryArtifacts={() => retryArtifacts.mutate()}
            isRetryingArtifacts={retryArtifacts.isPending}
            onRerun={() => setConfirmRerun('artifacts')}
            onRetryArtifact={(artifactType) => retryArtifact.mutate(artifactType)}
            isRetryingArtifact={retryArtifact.isPending}
            onStopArtifacts={() => setConfirmStopArtifacts(true)}
          />
        </ErrorBoundary>

        {/* Post-Completion: What's Next? */}
        {project.status === 'complete' && (
          <section className="p-5 rounded-lg border bg-surface-raised border-status-complete-fg/20">
            <div className="flex items-center gap-3 mb-3">
              <CheckCircle className="w-5 h-5 text-status-complete-fg" />
              <h2 className="text-xl font-display font-semibold text-text-heading">Project Complete</h2>
            </div>
            <p className="text-sm text-text-muted mb-4">
              Your competitive intelligence analysis is finished. Here's what you can do next:
            </p>
            <ul className="space-y-2 text-sm text-text">
              <li className="flex items-start gap-2">
                <FileText className="w-4 h-4 text-status-running-fg mt-0.5 flex-shrink-0" />
                <span><strong>Review your deliverables</strong> — Expand each one above to read the full analysis</span>
              </li>
              <li className="flex items-start gap-2">
                {(dashboard.project as any).dossier_id ? (
                  <>
                    <BookOpen className="w-4 h-4 text-status-complete-fg mt-0.5 flex-shrink-0" />
                    <span><strong>Dossier saved</strong> — <Link to="/dossiers" className="text-status-running-fg hover:underline">View Dossier Library</Link></span>
                  </>
                ) : (
                  <>
                    <BookmarkPlus className="w-4 h-4 text-status-running-fg mt-0.5 flex-shrink-0" />
                    <span>
                      <strong>Save as Dossier</strong> —{' '}
                      <button
                        onClick={() => setShowSaveDossier(true)}
                        className="text-status-running-fg hover:underline"
                      >
                        Add to your competitor library
                      </button>
                    </span>
                  </>
                )}
              </li>
              {dashboard.linkedDossier && (
                <li className="flex items-start gap-2">
                  <RefreshCw className="w-4 h-4 text-brand-green mt-0.5 flex-shrink-0" />
                  <span>
                    <strong>Update dossier</strong> —{' '}
                    <button
                      onClick={() => setConfirmUpdateDossier(true)}
                      disabled={updateDossierFromProject.isPending}
                      className="inline-flex items-center gap-1.5 px-3 py-1 text-sm font-medium bg-brand-green text-white rounded hover:opacity-90 transition-opacity disabled:opacity-50"
                    >
                      {updateDossierFromProject.isPending ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5" />
                      )}
                      Update {dashboard.linkedDossier.competitorName} Dossier
                    </button>
                  </span>
                </li>
              )}
              <li className="flex items-start gap-2">
                <Sparkles className="w-4 h-4 text-status-running-fg mt-0.5 flex-shrink-0" />
                <span><strong>Start a new project</strong> — <Link to="/" className="text-status-running-fg hover:underline">Return to project list</Link></span>
              </li>
            </ul>
            <p className="text-xs text-text-subtle mt-4 italic">
              Export to PDF and team sharing are coming soon.
            </p>
          </section>
        )}
      </main>

      {/* Confirmation Dialogs */}
      <ConfirmDialog
        isOpen={confirmApproveBrief}
        onClose={() => setConfirmApproveBrief(false)}
        onConfirm={handleApproveBrief}
        isConfirming={approveBrief.isPending}
        title="Approve Research Brief"
        message="This will finalize the brief and start deep research across three independent teams. Research typically takes 2-4 hours."
        confirmLabel="Start Research"
      />

      <ConfirmDialog
        isOpen={confirmStartResearch}
        onClose={() => setConfirmStartResearch(false)}
        onConfirm={handleStartResearch}
        isConfirming={startResearch.isPending}
        title="Start Deep Research"
        message="Deep research runs across three independent research teams and typically takes 2-4 hours. You can stop individual providers or all research from the dashboard."
        confirmLabel="Start Research"
      />

      <ConfirmDialog
        isOpen={confirmStartVerification}
        onClose={() => setConfirmStartVerification(false)}
        onConfirm={handleStartVerification}
        isConfirming={startVerification.isPending}
        title="Start Source Verification"
        message="Source verification typically takes 15-30 minutes."
        confirmLabel="Start Verification"
      />

      <ConfirmDialog
        isOpen={confirmStartAnalysis}
        onClose={() => setConfirmStartAnalysis(false)}
        onConfirm={handleStartAnalysis}
        isConfirming={startAnalysis.isPending}
        title="Start Strategic Analysis"
        message="Strategic analysis typically takes 2-5 minutes."
        confirmLabel="Start Analysis"
      />

      <ConfirmDialog
        isOpen={!!confirmGenerateArtifacts}
        onClose={() => setConfirmGenerateArtifacts(null)}
        onConfirm={handleGenerateArtifacts}
        isConfirming={selectArtifacts.isPending}
        title="Generate Deliverables"
        message={confirmGenerateArtifacts ? `You are about to generate ${confirmGenerateArtifacts.length} deliverable${confirmGenerateArtifacts.length !== 1 ? 's' : ''}:\n\n${confirmGenerateArtifacts.map(type => `• ${ARTIFACT_TYPE_DEFS.find(d => d.key === type)?.label || type}`).join('\n')}\n\nEstimated time: ${confirmGenerateArtifacts.length * 2}-${confirmGenerateArtifacts.length * 3} minutes` : ''}
        confirmLabel="Generate"
      />

      <ConfirmDialog
        isOpen={!!confirmRerun}
        onClose={() => setConfirmRerun(null)}
        onConfirm={handleRerun}
        isConfirming={rerunPhase.isPending}
        title={`Re-run ${confirmRerun ? confirmRerun.charAt(0).toUpperCase() + confirmRerun.slice(1) : ''}`}
        message={confirmRerun ? `This will reset ${confirmRerun}${rerunDownstreamPhases[confirmRerun] ? ` and clear all downstream results (${rerunDownstreamPhases[confirmRerun]})` : ''}. You'll need to re-run those phases after.` : ''}
        confirmLabel="Reset & Re-run"
        confirmVariant="danger"
      />

      <ConfirmDialog
        isOpen={!!confirmRerunProvider}
        onClose={() => setConfirmRerunProvider(null)}
        onConfirm={handleRerunProvider}
        isConfirming={rerunProvider.isPending}
        title={`Re-run ${confirmRerunProvider?.label || 'Provider'}?`}
        message={`This will replace the current output for this provider. Downstream phases (Verify Sources, Analysis, Deliverables) were built using this research and may need to be re-run from the dashboard.\n\nTime estimate: 30 minutes – 4 hours depending on the provider.`}
        confirmLabel="Re-run"
        confirmVariant="danger"
      />

      <ConfirmDialog
        isOpen={!!confirmStopResearch}
        onClose={() => setConfirmStopResearch(null)}
        onConfirm={handleStopResearch}
        isConfirming={stopResearch.isPending}
        title={confirmStopResearch?.providers ? `Stop ${confirmStopResearch.label}?` : 'Stop All Research?'}
        message={confirmStopResearch?.providers
          ? `Any work in progress for ${confirmStopResearch.label} will be discarded.`
          : 'All research in progress will be stopped and any partial work will be discarded.'
        }
        confirmLabel="Stop"
        confirmVariant="danger"
      />

      <ConfirmDialog
        isOpen={confirmStopArtifacts}
        onClose={() => setConfirmStopArtifacts(false)}
        onConfirm={handleStopArtifacts}
        isConfirming={stopArtifacts.isPending}
        title="Stop Generation?"
        message="This will cancel all in-progress deliverables. Completed deliverables are preserved."
        confirmLabel="Stop Generation"
        confirmVariant="danger"
      />

      <SaveAsDossierDialog
        isOpen={showSaveDossier}
        onClose={() => setShowSaveDossier(false)}
        projectId={project.id}
        projectName={project.name}
      />

      <ConfirmDialog
        isOpen={confirmUpdateDossier}
        onClose={() => setConfirmUpdateDossier(false)}
        onConfirm={handleUpdateDossier}
        isConfirming={updateDossierFromProject.isPending}
        title="Update Dossier"
        message="This will overwrite the dossier's current content with this project's outputs. This action cannot be undone."
        confirmLabel="Update Dossier"
        confirmVariant="danger"
      />
    </div>
  );
}
