import type { TaskState, VerifyUnitRequest, QualityGate } from './types.js';
import { CONFIG } from './config.js';
import { saveIntermediate, saveOutput } from './utils/files.js';
import { runConsolidateStep } from './steps/consolidate.js';
import { runExtractStep } from './steps/extract.js';
import { runInvestigateStep } from './steps/investigate.js';
import { runAdjudicateStep } from './steps/adjudicate.js';
import { runReportStep } from './steps/report.js';
import { runConsensusStep } from './steps/consensus.js';
import { runSizingStep } from './steps/sizing.js';
import { setTokenLogContext, clearTokenLogContext } from './utils/token-logger.js';

/** In-memory task store. */
export const verificationTasks = new Map<string, TaskState>();

/**
 * Run the full verification + optional sizing pipeline.
 * Called fire-and-forget from the API handler.
 */
export async function runVerificationPipeline(
  taskId: string,
  request: VerifyUnitRequest,
): Promise<void> {
  const task = verificationTasks.get(taskId);
  if (!task) return;

  task.status = 'running';

  const timeoutMs = parseInt(process.env.VERIFICATION_TIMEOUT_MS || '3600000', 10);
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Verification pipeline exceeded timeout (' + Math.round(timeoutMs / 60000) + ' minutes)')), timeoutMs);
  });

  try {
    await Promise.race([
      runPipelineSteps(task, request),
      timeoutPromise,
    ]);
  } catch (err) {
    task.status = 'failed';
    task.error = err instanceof Error ? err.message : String(err);
    console.error(`[pipeline] Verification failed:`, err);
  }
}

/**
 * Inner pipeline steps, extracted so the outer function can race against a timeout.
 */
async function runPipelineSteps(
  task: TaskState,
  request: VerifyUnitRequest,
): Promise<void> {
  const { project_id, unit_number } = request;
  const unitTitle = request.unit_title || `Unit ${unit_number}`;
  const chStr = String(unit_number).padStart(2, '0');

  // Set context for token logging
  setTokenLogContext(project_id, unit_number);

  // Step 0: Consolidate (10%)
  updateTask(task, 'consolidate', 10);
  const consolidated = await runConsolidateStep(project_id, unit_number, request.files);
  await saveIntermediate(project_id, unit_number, `ch${chStr}_consolidated.md`, consolidated);

  // Step 1: Extract claims (20%)
  updateTask(task, 'extract', 20);
  const claims = await runExtractStep(consolidated);
  await saveIntermediate(project_id, unit_number, `ch${chStr}_claims.json`, claims);

  // Step 2: Investigate (40%)
  updateTask(task, 'investigate', 30);
  const investigations = await runInvestigateStep(claims, (done, total) => {
    task.progress = 30 + Math.round((done / total) * 20);
  });
  await saveIntermediate(project_id, unit_number, `ch${chStr}_sources.json`, investigations);

  // Step 3: Adjudicate (60%)
  updateTask(task, 'adjudicate', 55);
  const adjudication = await runAdjudicateStep(claims, investigations);
  await saveIntermediate(project_id, unit_number, `ch${chStr}_adjudication.json`, adjudication);

  // Step 3.5: Consensus (optional)
  let consensus;
  if (CONFIG.enableConsensus) {
    updateTask(task, 'consensus', 62);
    consensus = await runConsensusStep(claims, adjudication);
    await saveIntermediate(project_id, unit_number, `ch${chStr}_consensus.json`, consensus);
  }

  // Step 4: Report (80%)
  updateTask(task, 'report', 75);
  const { report, qualityGate } = await runReportStep(claims, adjudication, unitTitle, unit_number, consensus);
  await saveIntermediate(project_id, unit_number, `ch${chStr}_verification_report.md`, report);
  const reportPath = await saveOutput(project_id, `ch${chStr}_verification_report.md`, report);

  // Step 5: Sizing (95%) — skipped by default in STRATEGOS
  let sizingReportPath: string | undefined;
  if (!request.skip_sizing && CONFIG.autoSizingEnabled) {
    updateTask(task, 'sizing', 90);
    const sizingParams = request.sizing_params || {
      reading_time: CONFIG.defaultReadingTime,
      complexity: CONFIG.defaultComplexity as 'Low' | 'Medium' | 'High',
      style: CONFIG.defaultStyle as 'Punchy' | 'Balanced' | 'Narrative',
    };

    const sizingResult = await runSizingStep(
      project_id, unit_number, unitTitle,
      request.unit_context || '',
      sizingParams,
      undefined,  // outlineFile
      undefined,  // specFile
      request.spec_content,
    );
    await saveIntermediate(project_id, unit_number, `ch${chStr}_sizing.json`, sizingResult);
    sizingReportPath = await saveOutput(project_id, `ch${chStr}_sizing_report.md`, sizingResult.report);
  }

  // Complete
  const primaryGate = consensus ? consensus.consensus_quality_gate : qualityGate;
  task.status = 'completed';
  task.progress = 100;
  task.current_step = 'done';
  task.completed_at = new Date().toISOString();
  task.result = {
    verification_report_path: reportPath,
    sizing_report_path: sizingReportPath,
    quality_gate: primaryGate,
  };

  clearTokenLogContext();
  console.log(`[pipeline] Verification complete — ${primaryGate.status}`);
}

function updateTask(task: TaskState, step: string, progress: number): void {
  task.current_step = step;
  task.progress = progress;
  console.log(`[pipeline] Step: ${step} (${progress}%)`);
}
