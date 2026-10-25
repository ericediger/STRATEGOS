import { config as dotenvConfig } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env from research/ root (one level up from citation-verifier)
const parentEnv = resolve(__dirname, '../../.env');
if (existsSync(parentEnv)) {
  dotenvConfig({ path: parentEnv });
} else {
  dotenvConfig();
}

export const CONFIG = {
  port: Number(process.env.VERIFIER_PORT || 9002),
  kimiApiKey: process.env.KIMI_API_KEY || '',
  tavilyApiKey: process.env.TAVILY_API_KEY || '',
  mainServerUrl: process.env.MAIN_SERVER_URL || 'http://localhost:4000',
  autoSizingEnabled: process.env.AUTO_SIZING_ENABLED === 'true',
  enableRemediation: process.env.ENABLE_REMEDIATION === 'true',
  enableConsensus: process.env.ENABLE_CONSENSUS !== 'false',
  defaultReadingTime: Number(process.env.DEFAULT_READING_TIME || 12),
  defaultComplexity: process.env.DEFAULT_COMPLEXITY || 'Medium',
  defaultStyle: process.env.DEFAULT_STYLE || 'Balanced',

  // Paths relative to research/ root
  rootDir: resolve(__dirname, '../..'),
  get outputsDir() { return resolve(this.rootDir, 'outputs'); },
  get intermediateDir() { return resolve(__dirname, '..', 'intermediate'); },
  get cacheDir() { return resolve(__dirname, '..', 'cache', 'tavily'); },
  get promptsDir() { return resolve(__dirname, '..', 'prompts'); },

  // API endpoints
  kimiBaseUrl: process.env.KIMI_URL || 'https://api.moonshot.ai/v1',
  tavilyBaseUrl: 'https://api.tavily.com',

  // Quality gate
  qualityGateThreshold: 0.15,
} as const;
