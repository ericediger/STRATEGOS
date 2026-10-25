/**
 * Dossier Service — CRUD operations for Competitor Dossier Library
 *
 * Manages dossier lifecycle: creation, updates, archival, project linking,
 * staleness computation, and cached metric updates.
 */

import { randomUUID } from 'crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import path from 'path';
import { join, resolve } from 'path';
import { prepare } from '../db/index.js';
import { parseVerificationReport, calculateConfidence } from './confidence.js';
import { logEvent } from './event-logger.js';

// =============================================================================
// TYPES
// =============================================================================

export interface CreateDossierParams {
  competitorName: string;
  industry?: string;
  description?: string;
  sourceProjectId?: string;
}

export interface UpdateDossierParams {
  competitorName?: string;
  industry?: string;
  description?: string;
  status?: 'active' | 'archived';
}

export interface DossierRecord {
  id: string;
  competitorName: string;
  industry: string | null;
  description: string | null;
  sourceProjectId: string | null;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
  lastRefreshedAt: string | null;
  confidenceRating: string | null;
  researchWordCount: number;
  artifactCount: number;
  rootPath: string;
  changeLog: ChangeLogEntry[];
}

export interface ChangeLogEntry {
  date: string;
  type: 'created' | 'refreshed' | 'artifacts_generated' | 'metadata_updated' | 'archived' | 'unarchived';
  summary: string;
  sourceProjectId?: string;
}

export type StalenessLevel = 'fresh' | 'aging' | 'stale' | 'never_refreshed';

export interface DossierFilters {
  status?: 'active' | 'archived';
  search?: string;
}

export interface DossierFileEntry {
  name: string;
  path: string;
  wordCount: number;
  isMarkdown: boolean;
  sizeBytes: number;
}

export interface DossierFileSection {
  label: string;
  directory: string;
  files: DossierFileEntry[];
}

export interface DossierFileManifest {
  sections: DossierFileSection[];
}

export interface DossierWithLinkedProjects extends DossierRecord {
  linkedProjects: Array<{ projectId: string; projectName: string; relationship: string; linkedAt: string }>;
  staleness: StalenessLevel;
}

export interface DossierFileContentResult {
  content: string;
  name: string;
  path: string;
}

export const STALENESS_THRESHOLDS = {
  fresh: 30,   // days
  aging: 90,   // days
  stale: 90    // > this = stale
};

// =============================================================================
// HELPERS
// =============================================================================

function ensureDossierDirectory(dossierId: string): string {
  const projectsRoot = process.env.PROJECTS_ROOT || './projects';
  const root = resolve(projectsRoot, '..', 'dossiers', dossierId);
  for (const sub of ['research', 'verification', 'analysis', 'artifacts', 'artifacts/exports']) {
    mkdirSync(join(root, sub), { recursive: true });
  }
  return root;
}

function mapRow(row: any): DossierRecord {
  return {
    id: row.id,
    competitorName: row.competitor_name,
    industry: row.industry ?? null,
    description: row.description ?? null,
    sourceProjectId: row.source_project_id ?? null,
    status: row.status as 'active' | 'archived',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastRefreshedAt: row.last_refreshed_at ?? null,
    confidenceRating: row.confidence_rating ?? null,
    researchWordCount: row.research_word_count ?? 0,
    artifactCount: row.artifact_count ?? 0,
    rootPath: row.root_path,
    changeLog: row.change_log ? JSON.parse(row.change_log) : [],
  };
}

// =============================================================================
// CRUD OPERATIONS
// =============================================================================

export function createDossier(params: CreateDossierParams): DossierRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  const rootPath = ensureDossierDirectory(id);

  const changeLog: ChangeLogEntry[] = [{
    date: now,
    type: 'created',
    summary: `Dossier created for ${params.competitorName}`,
    sourceProjectId: params.sourceProjectId,
  }];

  prepare(`
    INSERT INTO dossiers (id, competitor_name, industry, description, source_project_id, status, created_at, updated_at, root_path, change_log)
    VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
  `).run(
    id,
    params.competitorName,
    params.industry ?? null,
    params.description ?? null,
    params.sourceProjectId ?? null,
    now,
    now,
    rootPath,
    JSON.stringify(changeLog),
  );

  // Non-blocking event logging (Rule 11)
  try {
    logEvent('dossier_created', params.sourceProjectId ?? null, {
      dossierId: id,
      competitorName: params.competitorName,
      sourceProjectId: params.sourceProjectId ?? null,
    });
  } catch { /* event logging never blocks primary operation */ }

  return {
    id,
    competitorName: params.competitorName,
    industry: params.industry ?? null,
    description: params.description ?? null,
    sourceProjectId: params.sourceProjectId ?? null,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    lastRefreshedAt: null,
    confidenceRating: null,
    researchWordCount: 0,
    artifactCount: 0,
    rootPath,
    changeLog,
  };
}

export function getDossier(id: string): DossierRecord | null {
  const row = prepare(`
    SELECT * FROM dossiers WHERE id = ?
  `).get(id) as any | undefined;

  if (!row) return null;
  return mapRow(row);
}

export function listDossiers(filters?: DossierFilters): DossierRecord[] {
  let sql = 'SELECT * FROM dossiers';
  const conditions: string[] = [];
  const params: any[] = [];

  if (filters?.status) {
    conditions.push('status = ?');
    params.push(filters.status);
  }

  if (filters?.search) {
    conditions.push('(competitor_name LIKE ? OR industry LIKE ? OR description LIKE ?)');
    const term = `%${filters.search}%`;
    params.push(term, term, term);
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  sql += ' ORDER BY updated_at DESC';

  const rows = prepare(sql).all(...params) as any[];
  return rows.map(mapRow);
}

export function updateDossier(id: string, updates: UpdateDossierParams): DossierRecord | null {
  const existing = getDossier(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const setClauses: string[] = ['updated_at = ?'];
  const params: any[] = [now];

  if (updates.competitorName !== undefined) {
    setClauses.push('competitor_name = ?');
    params.push(updates.competitorName);
  }
  if (updates.industry !== undefined) {
    setClauses.push('industry = ?');
    params.push(updates.industry);
  }
  if (updates.description !== undefined) {
    setClauses.push('description = ?');
    params.push(updates.description);
  }

  // Append metadata_updated to change_log
  const changeLog = [...existing.changeLog, {
    date: now,
    type: 'metadata_updated' as const,
    summary: 'Dossier metadata updated',
  }];
  setClauses.push('change_log = ?');
  params.push(JSON.stringify(changeLog));

  params.push(id);

  prepare(`UPDATE dossiers SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);

  return getDossier(id);
}

export function archiveDossier(id: string): DossierRecord | null {
  const existing = getDossier(id);
  if (!existing) return null;

  const competitorName = existing.competitorName;
  const now = new Date().toISOString();
  prepare(`UPDATE dossiers SET status = 'archived', updated_at = ? WHERE id = ?`).run(now, id);

  // Non-blocking event logging (Rule 11)
  try {
    logEvent('dossier_archived', null, { dossierId: id, competitorName });
  } catch { /* event logging never blocks primary operation */ }

  return getDossier(id);
}

// =============================================================================
// PROJECT LINKING
// =============================================================================

export function linkProject(dossierId: string, projectId: string, relationship: string = 'source'): void {
  const now = new Date().toISOString();
  prepare(`
    INSERT OR IGNORE INTO dossier_projects (dossier_id, project_id, relationship, linked_at)
    VALUES (?, ?, ?, ?)
  `).run(dossierId, projectId, relationship, now);
}

export function getLinkedProjects(dossierId: string): Array<{ projectId: string; projectName: string; relationship: string; linkedAt: string }> {
  const rows = prepare(`
    SELECT dp.project_id, p.name AS project_name, dp.relationship, dp.linked_at
    FROM dossier_projects dp
    JOIN projects p ON p.id = dp.project_id
    WHERE dp.dossier_id = ?
    ORDER BY dp.linked_at DESC
  `).all(dossierId) as any[];

  return rows.map(r => ({
    projectId: r.project_id,
    projectName: r.project_name,
    relationship: r.relationship,
    linkedAt: r.linked_at,
  }));
}

export function getDossierForProject(projectId: string): DossierRecord | null {
  const row = prepare(`
    SELECT d.* FROM dossiers d
    JOIN dossier_projects dp ON dp.dossier_id = d.id
    WHERE dp.project_id = ?
    LIMIT 1
  `).get(projectId) as any | undefined;

  if (!row) return null;
  return mapRow(row);
}

// =============================================================================
// CACHED METRICS
// =============================================================================

export function updateCachedMetrics(dossierId: string): void {
  const dossier = getDossier(dossierId);
  if (!dossier) return;

  let wordCount = 0;
  let artifactCount = 0;

  const researchDir = join(dossier.rootPath, 'research');
  if (existsSync(researchDir)) {
    try {
      const files = readdirSync(researchDir);
      for (const file of files) {
        const filePath = join(researchDir, file);
        if (statSync(filePath).isFile()) {
          const content = readFileSync(filePath, 'utf-8');
          wordCount += content.split(/\s+/).filter(Boolean).length;
        }
      }
    } catch { /* ignore read errors */ }
  }

  const artifactsDir = join(dossier.rootPath, 'artifacts');
  if (existsSync(artifactsDir)) {
    try {
      const files = readdirSync(artifactsDir);
      artifactCount = files.filter(f => {
        const filePath = join(artifactsDir, f);
        return statSync(filePath).isFile();
      }).length;
    } catch { /* ignore read errors */ }
  }

  prepare(`
    UPDATE dossiers SET research_word_count = ?, artifact_count = ?, updated_at = ? WHERE id = ?
  `).run(wordCount, artifactCount, new Date().toISOString(), dossierId);
}

// =============================================================================
// STALENESS
// =============================================================================

export function computeStaleness(dossier: Pick<DossierRecord, 'lastRefreshedAt'>, now?: Date): StalenessLevel {
  if (!dossier.lastRefreshedAt) return 'never_refreshed';

  const reference = now ?? new Date();
  const refreshedAt = new Date(dossier.lastRefreshedAt);
  const daysSinceRefresh = Math.floor((reference.getTime() - refreshedAt.getTime()) / (1000 * 60 * 60 * 24));

  if (daysSinceRefresh <= STALENESS_THRESHOLDS.fresh) return 'fresh';
  if (daysSinceRefresh <= STALENESS_THRESHOLDS.aging) return 'aging';
  return 'stale';
}

// =============================================================================
// FILE COPY HELPER
// =============================================================================

function copyDirectoryContents(srcDir: string, destDir: string): { copied: string[]; warnings: string[] } {
  const copied: string[] = [];
  const warnings: string[] = [];

  if (!existsSync(srcDir)) {
    warnings.push(`Source directory not found: ${path.basename(srcDir)}`);
    return { copied, warnings };
  }

  mkdirSync(destDir, { recursive: true });

  const entries = readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);
    try {
      if (entry.isDirectory()) {
        const sub = copyDirectoryContents(srcPath, destPath);
        copied.push(...sub.copied);
        warnings.push(...sub.warnings);
      } else {
        copyFileSync(srcPath, destPath);
        copied.push(entry.name);
      }
    } catch (err) {
      warnings.push(`Failed to copy ${entry.name}: ${(err as Error).message}`);
    }
  }
  return { copied, warnings };
}

// =============================================================================
// CREATE DOSSIER FROM PROJECT
// =============================================================================

export interface CreateDossierFromProjectResult {
  dossier: DossierRecord;
  filesCopied: string[];
  warnings: string[];
}

const PERMISSIVE_COMPLETE_STATUSES = [
  'complete',
  'analysis_complete',
  'generating_artifacts',
];

export function createDossierFromProject(
  projectId: string,
  params: { competitorName: string; industry?: string; description?: string },
): CreateDossierFromProjectResult {
  // 1. Look up project
  const project = prepare(
    'SELECT id, name, root_path, status FROM projects WHERE id = ?'
  ).get(projectId) as { id: string; name: string; root_path: string; status: string } | undefined;

  if (!project) {
    throw Object.assign(new Error('Project not found'), { statusCode: 404 });
  }

  if (!PERMISSIVE_COMPLETE_STATUSES.includes(project.status)) {
    throw Object.assign(
      new Error(`Project is not complete (current status: ${project.status})`),
      { statusCode: 400 },
    );
  }

  // 2. Check for existing dossier link
  const existingDossier = getDossierForProject(projectId);
  if (existingDossier) {
    throw Object.assign(
      new Error('A dossier already exists for this project'),
      { statusCode: 409, dossierId: existingDossier.id },
    );
  }

  // 3. Create dossier record
  const dossier = createDossier({
    competitorName: params.competitorName,
    industry: params.industry,
    description: params.description,
    sourceProjectId: projectId,
  });

  // 4. Copy directories from project root to dossier root
  const projectRoot = resolve(project.root_path);
  const dossierRoot = dossier.rootPath;
  const allCopied: string[] = [];
  const allWarnings: string[] = [];

  const dirsToSync = ['collaboration', 'research', 'verification', 'analysis', 'artifacts'];
  for (const dir of dirsToSync) {
    const srcDir = join(projectRoot, dir);
    const destDir = join(dossierRoot, dir);
    const result = copyDirectoryContents(srcDir, destDir);
    allCopied.push(...result.copied);
    allWarnings.push(...result.warnings);
  }

  // 5. Link project to dossier
  linkProject(dossier.id, projectId, 'source');

  // 6. Update cached metrics
  updateCachedMetrics(dossier.id);

  // 7. Set last_refreshed_at
  const now = new Date().toISOString();
  prepare(`UPDATE dossiers SET last_refreshed_at = ?, updated_at = ? WHERE id = ?`).run(now, now, dossier.id);

  // 8. Parse confidence from verification report if it exists
  const verificationReportPath = join(dossierRoot, 'verification', 'verification_report.md');
  let confidenceRating: string | null = null;
  if (existsSync(verificationReportPath)) {
    try {
      const reportContent = readFileSync(verificationReportPath, 'utf-8');
      // Look for quality gate pattern: **Status** | **PASSED** or **REVIEW_RECOMMENDED**
      const statusMatch = reportContent.match(/\*\*Status\*\*\s*\|\s*\*\*(.*?)\*\*/);
      if (statusMatch) {
        const raw = statusMatch[1].trim();
        confidenceRating = raw === 'PASSED' ? 'High' : 'Medium';
      }
    } catch { /* ignore parse errors */ }
  }
  if (confidenceRating) {
    prepare(`UPDATE dossiers SET confidence_rating = ? WHERE id = ?`).run(confidenceRating, dossier.id);
  }

  // 10. Return final state
  const finalDossier = getDossier(dossier.id)!;
  return { dossier: finalDossier, filesCopied: allCopied, warnings: allWarnings };
}

// =============================================================================
// ENRICHED DETAIL
// =============================================================================

const SECTION_CONFIG: Array<{ directory: string; label: string }> = [
  { directory: 'research', label: 'Research Reports' },
  { directory: 'verification', label: 'Source Verification' },
  { directory: 'analysis', label: 'Strategic Assessment' },
  { directory: 'artifacts', label: 'Deliverables' },
];

export function getDossierWithLinkedProjects(id: string): DossierWithLinkedProjects | null {
  const dossier = getDossier(id);
  if (!dossier) return null;

  const linkedProjects = getLinkedProjects(id);
  const staleness = computeStaleness(dossier);

  return {
    ...dossier,
    linkedProjects,
    staleness,
  };
}

// =============================================================================
// FILE MANIFEST
// =============================================================================

function scanDirectory(dirPath: string, basePath: string): DossierFileEntry[] {
  const entries: DossierFileEntry[] = [];

  if (!existsSync(dirPath)) return entries;

  let items: import('fs').Dirent[];
  try {
    items = readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return entries;
  }

  for (const item of items) {
    const fullPath = join(dirPath, item.name);
    if (item.isDirectory()) {
      const subEntries = scanDirectory(fullPath, basePath);
      entries.push(...subEntries);
    } else if (item.isFile()) {
      const relativePath = path.relative(basePath, fullPath);
      const isMarkdown = item.name.endsWith('.md');
      let wordCount = 0;
      let sizeBytes = 0;
      try {
        sizeBytes = statSync(fullPath).size;
      } catch { /* ignore stat errors */ }
      if (isMarkdown) {
        try {
          const content = readFileSync(fullPath, 'utf-8');
          wordCount = content.split(/\s+/).filter(Boolean).length;
        } catch { /* ignore read errors */ }
      }
      entries.push({
        name: item.name,
        path: relativePath,
        wordCount,
        isMarkdown,
        sizeBytes,
      });
    }
  }

  return entries;
}

export function getDossierFileManifest(id: string): DossierFileManifest | null {
  const dossier = getDossier(id);
  if (!dossier) return null;

  const sections: DossierFileSection[] = [];

  for (const cfg of SECTION_CONFIG) {
    const dirPath = join(dossier.rootPath, cfg.directory);
    const files = scanDirectory(dirPath, dossier.rootPath);
    sections.push({
      label: cfg.label,
      directory: cfg.directory,
      files,
    });
  }

  return { sections };
}

// =============================================================================
// FILE CONTENT (with path traversal prevention)
// =============================================================================

export function getDossierFileContent(
  id: string,
  filePath: string,
): { type: 'markdown'; content: string; name: string; path: string } | { type: 'binary'; filePath: string; name: string } | { type: 'error'; status: number; message: string } {
  const dossier = getDossier(id);
  if (!dossier) {
    return { type: 'error', status: 404, message: 'Dossier not found' };
  }

  // CRITICAL: path traversal prevention
  const dossierRoot = resolve(dossier.rootPath);
  const resolved = resolve(dossierRoot, filePath);

  if (!resolved.startsWith(dossierRoot + path.sep) && resolved !== dossierRoot) {
    return { type: 'error', status: 403, message: 'Path traversal denied' };
  }

  // Reject null bytes
  if (filePath.includes('\0')) {
    return { type: 'error', status: 403, message: 'Path traversal denied' };
  }

  if (!existsSync(resolved)) {
    return { type: 'error', status: 404, message: 'File not found' };
  }

  const name = path.basename(resolved);
  const relativePath = path.relative(dossierRoot, resolved);

  if (name.endsWith('.md')) {
    try {
      const content = readFileSync(resolved, 'utf-8');
      return { type: 'markdown', content, name, path: relativePath };
    } catch {
      return { type: 'error', status: 500, message: 'Failed to read file' };
    }
  }

  return { type: 'binary', filePath: resolved, name };
}

// =============================================================================
// UPDATE WITH STATUS CHANGE LOG
// =============================================================================

// =============================================================================
// REFRESH FLOW
// =============================================================================

export function createRefreshProject(dossierId: string): { projectId: string; projectName: string } {
  const dossier = getDossier(dossierId);
  if (!dossier) {
    throw Object.assign(new Error('Dossier not found'), { statusCode: 404 });
  }
  if (dossier.status !== 'active') {
    throw Object.assign(new Error('Cannot refresh an archived dossier'), { statusCode: 400 });
  }

  const briefPath = join(dossier.rootPath, 'collaboration', 'research-brief.md');
  if (!existsSync(briefPath)) {
    throw Object.assign(new Error('No research brief found in dossier'), { statusCode: 400 });
  }
  const briefContent = readFileSync(briefPath, 'utf-8');

  const projectId = randomUUID();
  const today = new Date().toISOString().split('T')[0];
  const projectName = `${dossier.competitorName} Refresh - ${today}`;
  const projectsRoot = process.env.PROJECTS_ROOT || './projects';
  const projectRootPath = resolve(projectsRoot, projectId);

  for (const sub of ['collaboration', 'research', 'verification', 'analysis', 'artifacts']) {
    mkdirSync(join(projectRootPath, sub), { recursive: true });
  }

  const newBriefPath = join(projectRootPath, 'collaboration', 'research-brief.md');
  writeFileSync(newBriefPath, briefContent, 'utf-8');

  prepare(`
    INSERT INTO projects (id, name, root_path, status, research_brief_path)
    VALUES (?, ?, ?, 'brief_approved', ?)
  `).run(projectId, projectName, projectRootPath, newBriefPath);

  try {
    const briefId = randomUUID();
    prepare(`
      INSERT OR REPLACE INTO research_briefs (id, project_id, file_path, status, approved_at)
      VALUES (?, ?, ?, 'approved', datetime('now'))
    `).run(briefId, projectId, newBriefPath);
  } catch { /* persistence is best-effort */ }

  linkProject(dossierId, projectId, 'refresh');

  // Non-blocking event logging (Rule 11)
  try {
    logEvent('dossier_refresh_started', projectId, {
      dossierId,
      competitorName: dossier.competitorName,
      refreshProjectId: projectId,
    });
  } catch { /* event logging never blocks primary operation */ }

  return { projectId, projectName };
}

export function updateDossierFromProject(
  dossierId: string,
  projectId: string,
): { success: true; changeLogEntry: ChangeLogEntry } {
  const dossier = getDossier(dossierId);
  if (!dossier) {
    throw Object.assign(new Error('Dossier not found'), { statusCode: 404 });
  }

  const project = prepare('SELECT id, name, root_path, status FROM projects WHERE id = ?')
    .get(projectId) as { id: string; name: string; root_path: string; status: string } | undefined;
  if (!project) {
    throw Object.assign(new Error('Project not found'), { statusCode: 404 });
  }

  const link = prepare('SELECT 1 FROM dossier_projects WHERE dossier_id = ? AND project_id = ?')
    .get(dossierId, projectId);
  if (!link) {
    throw Object.assign(new Error('Project is not linked to this dossier'), { statusCode: 400 });
  }

  if (project.status !== 'complete') {
    throw Object.assign(new Error('Project is not complete'), { statusCode: 400 });
  }

  // BEFORE copy: compute word counts
  const dossierRoot = dossier.rootPath;
  const beforeResearchEntries = scanDirectory(join(dossierRoot, 'research'), dossierRoot);
  const beforeAllEntries = [
    ...beforeResearchEntries,
    ...scanDirectory(join(dossierRoot, 'verification'), dossierRoot),
    ...scanDirectory(join(dossierRoot, 'analysis'), dossierRoot),
    ...scanDirectory(join(dossierRoot, 'artifacts'), dossierRoot),
  ];
  const beforeResearchWc = beforeResearchEntries.reduce((sum, e) => sum + e.wordCount, 0);
  const beforeTotalWc = beforeAllEntries.reduce((sum, e) => sum + e.wordCount, 0);

  // Copy directories from project to dossier
  const projectRoot = resolve(project.root_path);
  const dirsToSync = ['research', 'verification', 'analysis', 'artifacts'];
  for (const dir of dirsToSync) {
    copyDirectoryContents(join(projectRoot, dir), join(dossierRoot, dir));
  }

  // Copy collaboration brief
  const projectBriefPath = join(projectRoot, 'collaboration', 'research-brief.md');
  if (existsSync(projectBriefPath)) {
    mkdirSync(join(dossierRoot, 'collaboration'), { recursive: true });
    copyFileSync(projectBriefPath, join(dossierRoot, 'collaboration', 'research-brief.md'));
  }

  // AFTER copy: compute word counts
  const afterResearchEntries = scanDirectory(join(dossierRoot, 'research'), dossierRoot);
  const afterAllEntries = [
    ...afterResearchEntries,
    ...scanDirectory(join(dossierRoot, 'verification'), dossierRoot),
    ...scanDirectory(join(dossierRoot, 'analysis'), dossierRoot),
    ...scanDirectory(join(dossierRoot, 'artifacts'), dossierRoot),
  ];
  const afterResearchWc = afterResearchEntries.reduce((sum, e) => sum + e.wordCount, 0);
  const afterTotalWc = afterAllEntries.reduce((sum, e) => sum + e.wordCount, 0);

  // Count artifacts
  let artifactCount = 0;
  const artifactsDir = join(dossierRoot, 'artifacts');
  if (existsSync(artifactsDir)) {
    try {
      const files = readdirSync(artifactsDir);
      artifactCount = files.filter(f => statSync(join(artifactsDir, f)).isFile()).length;
    } catch { /* ignore */ }
  }

  // Recalculate confidence
  let confidenceRating: string | null = dossier.confidenceRating;
  const verificationReportPath = join(dossierRoot, 'verification', 'verification_report.md');
  if (existsSync(verificationReportPath)) {
    try {
      const reportContent = readFileSync(verificationReportPath, 'utf-8');
      const parsed = parseVerificationReport(reportContent);
      const confidence = calculateConfidence(parsed, new Date());
      confidenceRating = confidence.rating;
    } catch { /* keep existing rating */ }
  }

  // Build change log entry
  const now = new Date().toISOString();
  const changeLogEntry: ChangeLogEntry = {
    date: now,
    type: 'refreshed',
    summary: `Dossier refreshed from project. Research: ${beforeResearchWc} → ${afterResearchWc} words. Total: ${beforeTotalWc} → ${afterTotalWc} words.`,
    sourceProjectId: projectId,
  };

  const changeLog = [...dossier.changeLog, changeLogEntry];

  prepare(`
    UPDATE dossiers
    SET research_word_count = ?, artifact_count = ?, last_refreshed_at = ?,
        updated_at = ?, confidence_rating = ?, change_log = ?
    WHERE id = ?
  `).run(afterResearchWc, artifactCount, now, now, confidenceRating, JSON.stringify(changeLog), dossierId);

  // Non-blocking event logging (Rule 11)
  const wordCountDelta = afterTotalWc - beforeTotalWc;
  try {
    logEvent('dossier_updated_from_project', projectId, {
      dossierId,
      competitorName: dossier.competitorName,
      sourceProjectId: projectId,
      wordCountDelta,
    });
  } catch { /* event logging never blocks primary operation */ }

  return { success: true, changeLogEntry };
}

export function getDossierLinkForProject(projectId: string): { dossierId: string; competitorName: string } | null {
  const row = prepare(`
    SELECT d.id, d.competitor_name
    FROM dossier_projects dp
    JOIN dossiers d ON d.id = dp.dossier_id
    WHERE dp.project_id = ?
    LIMIT 1
  `).get(projectId) as { id: string; competitor_name: string } | undefined;

  if (!row) return null;
  return { dossierId: row.id, competitorName: row.competitor_name };
}

// =============================================================================
// UPDATE WITH STATUS CHANGE LOG
// =============================================================================

export function updateDossierWithStatus(id: string, updates: UpdateDossierParams): DossierRecord | null {
  const existing = getDossier(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const setClauses: string[] = ['updated_at = ?'];
  const params: any[] = [now];

  if (updates.competitorName !== undefined) {
    setClauses.push('competitor_name = ?');
    params.push(updates.competitorName);
  }
  if (updates.industry !== undefined) {
    setClauses.push('industry = ?');
    params.push(updates.industry);
  }
  if (updates.description !== undefined) {
    setClauses.push('description = ?');
    params.push(updates.description);
  }

  // Build change log entries
  const changeLog = [...existing.changeLog];

  // Check for status change
  if (updates.status !== undefined && updates.status !== existing.status) {
    setClauses.push('status = ?');
    params.push(updates.status);

    if (updates.status === 'archived') {
      changeLog.push({
        date: now,
        type: 'archived',
        summary: `Dossier archived for ${existing.competitorName}`,
      });
    } else if (updates.status === 'active') {
      changeLog.push({
        date: now,
        type: 'unarchived',
        summary: `Dossier reactivated for ${existing.competitorName}`,
      });
    }
  }

  // Always append metadata_updated if non-status fields changed
  const hasMetadataChanges = updates.competitorName !== undefined ||
    updates.industry !== undefined ||
    updates.description !== undefined;
  if (hasMetadataChanges) {
    changeLog.push({
      date: now,
      type: 'metadata_updated',
      summary: 'Dossier metadata updated',
    });
  }

  setClauses.push('change_log = ?');
  params.push(JSON.stringify(changeLog));

  params.push(id);

  prepare(`UPDATE dossiers SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);

  // Non-blocking event logging for status changes (Rule 11)
  if (updates.status !== undefined && updates.status !== existing.status) {
    try {
      if (updates.status === 'archived') {
        logEvent('dossier_archived', null, { dossierId: id, competitorName: existing.competitorName });
      } else if (updates.status === 'active') {
        logEvent('dossier_unarchived', null, { dossierId: id, competitorName: existing.competitorName });
      }
    } catch { /* event logging never blocks primary operation */ }
  }

  return getDossier(id);
}
