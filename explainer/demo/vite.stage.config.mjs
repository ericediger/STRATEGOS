/**
 * Vite config for the explainer's stage: the real frontend, built into explainer/demo/stage/.
 * It imports only Node built-ins, because Vite resolves a config's imports from the config's own folder,
 * which has no node_modules. JSX is compiled by Vite's esbuild (automatic runtime) instead of @vitejs/plugin-react.
 * Run through build-stage.mjs, which starts Vite from frontend/ so Tailwind finds its content globs.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const frontend = path.resolve(here, '../../frontend');

export default {
  root: frontend,
  esbuild: { jsx: 'automatic' },
  resolve: { alias: { '@': path.join(frontend, 'src') } },
  logLevel: 'warn',
  build: { outDir: path.join(here, 'stage'), emptyOutDir: true, chunkSizeWarningLimit: 2000 },
};
