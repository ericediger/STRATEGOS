/**
 * Build the stage the explainer films: the real STRATEGOS frontend with its /api calls answered by mock-api.js.
 *
 *   node explainer/demo/build-stage.mjs
 *
 * Output: explainer/demo/stage/ (gitignored). spec.record serves that folder, so re-run this after a frontend change.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const frontend = path.resolve(here, '../../frontend');
const stage = path.join(here, 'stage');
const vite = path.join(frontend, 'node_modules', '.bin', 'vite');

if (!fs.existsSync(vite)) throw new Error(`No Vite at ${vite}. Install the frontend's packages first (cd frontend && npm install).`);

// Run Vite on the CPU that frontend/node_modules was installed for: its native Rollup package says which
// (@rollup/rollup-darwin-arm64 or -x64). On a Mac, a universal Node runs either one: `arch -x86_64 node …` uses
// Rosetta for an Intel install, `arch -arm64 node …` runs an Apple Silicon one natively.
const ARCH_FLAG = { x64: '-x86_64', arm64: '-arm64' };
const rollupDir = path.join(frontend, 'node_modules', '@rollup');
const installed = fs.existsSync(rollupDir)
  ? fs.readdirSync(rollupDir).flatMap((d) => (/^rollup-darwin-(x64|arm64)$/.exec(d) ? [d.slice('rollup-darwin-'.length)] : []))
  : [];
const target = process.platform !== 'darwin' || !installed.length || installed.includes(process.arch) ? process.arch : installed[0];
const [cmd, args] = target === process.arch ? [vite, []] : ['arch', [ARCH_FLAG[target], process.execPath, vite]];
console.log(`Rollup installed for: ${installed.join(', ') || 'none found'} · running Vite as ${target}${target === process.arch ? '' : ' (arch ' + ARCH_FLAG[target] + ')'}`);

const res = spawnSync(cmd, [...args, 'build', '--config', path.join(here, 'vite.stage.config.mjs')], { cwd: frontend, stdio: 'inherit' });
if (res.status !== 0) process.exit(res.status ?? 1);

// The mock must patch fetch before the app's module script runs, so it goes in <head> as a classic script.
fs.copyFileSync(path.join(here, 'mock-api.js'), path.join(stage, 'mock-api.js'));
const index = path.join(stage, 'index.html');
const html = fs.readFileSync(index, 'utf8').replace('<head>', '<head>\n    <script src="/mock-api.js"></script>');
fs.writeFileSync(index, html);
console.log(`Stage ready → ${path.relative(process.cwd(), stage) || '.'}`);
