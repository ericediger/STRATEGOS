import { z } from 'zod';

// --- Request Schemas ---

export const SizingParamsSchema = z.object({
  reading_time: z.number().default(12),
  complexity: z.enum(['Low', 'Medium', 'High']).default('Medium'),
  style: z.enum(['Punchy', 'Balanced', 'Narrative']).default('Balanced'),
});

export const VerifyUnitRequestSchema = z.object({
  project_id: z.number(),
  unit_number: z.number(),
  unit_title: z.string().optional(),
  unit_context: z.string().optional(),
  spec_content: z.string().optional(),
  files: z.array(
    z.string()
      .refine(val => val.startsWith('/'), 'File path must be absolute')
      .refine(val => !val.includes('..'), 'File path must not contain traversal')
      .refine(val => val.endsWith('.md'), 'File must be a markdown file'),
  ).optional(),
  sizing_params: SizingParamsSchema.optional(),
  skip_sizing: z.boolean().default(false),
});

export const SizingUnitRequestSchema = z.object({
  project_id: z.number(),
  unit_number: z.number(),
  unit_title: z.string(),
  outline_file: z.string(),
  spec_file: z.string(),
  sizing_params: SizingParamsSchema,
});

export type VerifyUnitRequest = z.infer<typeof VerifyUnitRequestSchema>;
export type SizingUnitRequest = z.infer<typeof SizingUnitRequestSchema>;
export type SizingParams = z.infer<typeof SizingParamsSchema>;

// --- Domain Types ---

export type Verdict = 'Verified' | 'Conflicting Evidence' | 'Unsupported Claim' | 'Insufficient Evidence';

export interface Claim {
  id: string;           // EDR-001, GEM-001, OAI-001
  statement: string;
  citation: string;     // The cited source (URL, author, etc.)
  source_doc: string;   // Which provider doc it came from
  location: string;     // Where in the doc
}

export interface InvestigationResult {
  claim_id: string;
  query: string;
  sources: TavilySource[];
}

export interface TavilySource {
  title: string;
  url: string;
  content: string;
  raw_content?: string;
  score: number;
}

export interface ClaimVerdict {
  claim_id: string;
  verdict: Verdict;
  confidence: number;   // 0-1
  reasoning: string;
  evidence_summary: string;
  sources_checked: string[];
}

export interface AdjudicationResult {
  verdicts: ClaimVerdict[];
  summary: string;
}

export interface QualityGate {
  status: 'PASSED' | 'REVIEW_RECOMMENDED';
  total_claims: number;
  verified: number;
  discrepancy: number;
  hallucination: number;
  unverifiable: number;
  failure_rate: number;  // (hallucination + discrepancy) / (total - unverifiable)
}

export interface VerificationTaskResult {
  verification_report_path: string;
  sizing_report_path?: string;
  quality_gate: QualityGate;
}

export interface TaskState {
  task_id: string;
  type: 'verification' | 'sizing';
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress: number;
  current_step: string;
  project_id: number;
  unit_number: number;
  created_at: string;
  completed_at?: string;
  error?: string;
  result?: VerificationTaskResult;
}

export interface LLMResponse {
  content: string;
  reasoning?: string;
  input_tokens: number;
  output_tokens: number;
}

// --- Consensus Types ---

export type ConsensusVerdict = Verdict | 'REVIEW';

export interface GroupedClaim {
  claim: Claim;
  verdict: ClaimVerdict;
}

export interface ClaimGroup {
  group_id: string;
  claims: GroupedClaim[];
  common_topic: string;
  consensus_verdict: ConsensusVerdict;
  consensus_confidence: number;
  consensus_reasoning: string;
  agreement_level: 'unanimous' | 'majority' | 'mixed' | 'single-provider';
}

export interface SystematicIssue {
  issue_type: 'source_access' | 'fact_dispute' | 'citation_format';
  affected_groups: string[];
  description: string;
  severity: 'low' | 'medium' | 'high';
}

export interface ConsensusResult {
  claim_groups: ClaimGroup[];
  consensus_quality_gate: QualityGate;
  high_confidence_claims: string[];
  review_needed_claims: string[];
  single_provider_claims: string[];
  systematic_issues: SystematicIssue[];
}
