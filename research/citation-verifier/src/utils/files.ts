import { mkdir, readFile, writeFile, readdir } from 'fs/promises';
import { join, resolve } from 'path';
import { existsSync } from 'fs';
import { CONFIG } from '../config.js';

/** Ensure directory exists, create recursively if not. */
export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

/** Get intermediate directory for a unit: intermediate/project-{id}/ch{NN}/ */
export function intermediateDir(projectId: number, unitNumber: number): string {
  const chStr = String(unitNumber).padStart(2, '0');
  return join(CONFIG.intermediateDir, `project-${projectId}`, `ch${chStr}`);
}

/** Get outputs directory for a project: outputs/project-{id}/ */
export function outputDir(projectId: number): string {
  return join(CONFIG.outputsDir, `project-${projectId}`);
}

/** Save intermediate step result as JSON. */
export async function saveIntermediate(
  projectId: number,
  unitNumber: number,
  filename: string,
  data: unknown,
): Promise<string> {
  const dir = intermediateDir(projectId, unitNumber);
  await ensureDir(dir);
  const filepath = join(dir, filename);
  const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  await writeFile(filepath, content, 'utf-8');
  console.log(`  [intermediate] ${filepath}`);
  return filepath;
}

/** Save output file (verification/sizing report) to verification/ subfolder. */
export async function saveOutput(
  projectId: number,
  filename: string,
  content: string,
): Promise<string> {
  const dir = join(outputDir(projectId), 'verification');
  await ensureDir(dir);
  const filepath = join(dir, filename);
  await writeFile(filepath, content, 'utf-8');
  console.log(`  [output] ${filepath}`);
  return filepath;
}

/** Read intermediate file. */
export async function readIntermediate(
  projectId: number,
  unitNumber: number,
  filename: string,
): Promise<string> {
  const filepath = join(intermediateDir(projectId, unitNumber), filename);
  return readFile(filepath, 'utf-8');
}

/** Auto-detect research files for a unit from outputs/research/ or flat outputs/ directory. */
export async function detectUnitFiles(
  projectId: number,
  unitNumber: number,
): Promise<string[]> {
  const chPrefix = `ch${String(unitNumber).padStart(2, '0')}-`;

  // Try research/ subfolder first (new hierarchy)
  const researchDir = join(outputDir(projectId), 'research');
  if (existsSync(researchDir)) {
    const files = await readdir(researchDir);
    const matched = files
      .filter(f => f.startsWith(chPrefix) && f.endsWith('.md'))
      .map(f => join(researchDir, f));
    if (matched.length > 0) return matched;
  }

  // Fallback to flat project directory (legacy)
  const flatDir = outputDir(projectId);
  if (!existsSync(flatDir)) return [];
  const files = await readdir(flatDir);
  return files
    .filter(f => f.startsWith(chPrefix) && f.endsWith('.md'))
    .map(f => join(flatDir, f));
}

/** Read a prompt file from prompts/ directory. */
export async function readPrompt(filename: string): Promise<string> {
  const filepath = join(CONFIG.promptsDir, filename);
  return readFile(filepath, 'utf-8');
}
