import { readFile } from 'fs/promises';
import { basename, resolve } from 'path';
import { existsSync } from 'fs';
import { detectUnitFiles } from '../utils/files.js';

/**
 * Validate that a file path is safe to read:
 * - Must be an absolute path
 * - Must resolve without traversal escaping
 * - Must end with .md
 * - Must actually exist on disk
 */
function validateFilePath(fp: string): void {
  const resolved = resolve(fp);
  if (resolved !== fp) {
    throw new Error(`Path validation failed: path contains traversal (${basename(fp)})`);
  }
  if (!fp.endsWith('.md')) {
    throw new Error(`Path validation failed: not a markdown file (${basename(fp)})`);
  }
  if (!existsSync(resolved)) {
    throw new Error(`Path validation failed: file does not exist (${basename(fp)})`);
  }
}

/**
 * Step 0: Consolidate
 * Merge 3 provider markdown files into one document with SOURCE markers.
 */
export async function runConsolidateStep(
  projectId: number,
  unitNumber: number,
  files?: string[],
): Promise<string> {
  const filePaths = files?.length
    ? files
    : await detectUnitFiles(projectId, unitNumber);

  if (filePaths.length === 0) {
    throw new Error(`No research files found for project ${projectId}, unit ${unitNumber}`);
  }

  // Validate all file paths before reading
  for (const fp of filePaths) {
    validateFilePath(fp);
  }

  console.log(`  [consolidate] Merging ${filePaths.length} files`);

  const sections: string[] = [];
  for (const fp of filePaths) {
    const content = await readFile(fp, 'utf-8');
    const filename = basename(fp);
    const provider = filename.replace(/\.md$/, '');
    sections.push(`<!-- SOURCE: ${filename} | provider: ${provider} -->\n\n${content}`);
  }

  return sections.join('\n\n---\n\n');
}
