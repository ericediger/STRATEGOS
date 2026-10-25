-- STRATEGOS — Strategic Analysis Platform Schema

-- =============================================================================
-- PROJECTS
-- =============================================================================
-- Status values include both success and failure states:
-- - Success flow: not_started → collaborating → brief_generated → brief_approved →
--                 researching → research_complete → verifying → verification_complete →
--                 analyzing → analysis_complete → generating_artifacts → complete
-- - Failure states: brief_generation_failed, research_failed, verification_failed,
--                   analysis_failed, artifacts_failed
-- When in a failure state, error_message column contains human-readable error details.

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_started',
  research_brief_path TEXT,
  researcher_project_id INTEGER,
  verifier_task_id TEXT,
  error_message TEXT DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);

-- =============================================================================
-- COLLABORATION SESSIONS (Phase 0 conversation history)
-- =============================================================================

CREATE TABLE IF NOT EXISTS collaboration_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL UNIQUE,
  messages TEXT NOT NULL,             -- JSON array of {role, content, timestamp}
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_collaboration_project ON collaboration_sessions(project_id);

-- =============================================================================
-- RESEARCH BRIEFS
-- =============================================================================

CREATE TABLE IF NOT EXISTS research_briefs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved')),
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_briefs_project ON research_briefs(project_id);

-- =============================================================================
-- SELECTED ARTIFACTS (Phase 4)
-- =============================================================================

CREATE TABLE IF NOT EXISTS selected_artifacts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'selected'
    CHECK (status IN ('selected', 'generating', 'complete', 'failed')),
  output_path TEXT,
  last_error TEXT DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_artifacts_project ON selected_artifacts(project_id);

-- =============================================================================
-- WORKFLOW ACTIONS
-- =============================================================================

CREATE TABLE IF NOT EXISTS workflow_actions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  phase TEXT NOT NULL
    CHECK (phase IN ('collaboration', 'research', 'verification', 'analysis', 'artifacts')),
  step_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'queued', 'running', 'complete', 'failed')),
  agent_id TEXT,
  input_paths TEXT,
  output_path TEXT,
  tokens_input INTEGER,
  tokens_output INTEGER,
  cost_usd REAL,
  started_at TEXT,
  completed_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_actions_project ON workflow_actions(project_id);
CREATE INDEX IF NOT EXISTS idx_actions_status ON workflow_actions(status);
CREATE INDEX IF NOT EXISTS idx_actions_phase ON workflow_actions(phase);

-- =============================================================================
-- QUALITY GATES
-- =============================================================================

CREATE TABLE IF NOT EXISTS quality_gates (
  id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL,
  gate_type TEXT NOT NULL
    CHECK (gate_type IN ('brief_approval', 'verification_threshold', 'author_approval')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'passed', 'failed', 'approved', 'rejected')),
  threshold_value TEXT,
  actual_value TEXT,
  decision TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (action_id) REFERENCES workflow_actions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_gates_action ON quality_gates(action_id);
CREATE INDEX IF NOT EXISTS idx_gates_status ON quality_gates(status);

-- =============================================================================
-- LLM CALL LOG
-- =============================================================================

CREATE TABLE IF NOT EXISTS llm_calls (
  id TEXT PRIMARY KEY,
  action_id TEXT,
  project_id TEXT,
  phase TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  cost_usd REAL,
  latency_ms INTEGER,
  status TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (action_id) REFERENCES workflow_actions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_llm_calls_action ON llm_calls(action_id);
CREATE INDEX IF NOT EXISTS idx_llm_calls_provider ON llm_calls(provider);

-- =============================================================================
-- TRIGGERS
-- =============================================================================

CREATE TRIGGER IF NOT EXISTS projects_updated
AFTER UPDATE ON projects
BEGIN
  UPDATE projects SET updated_at = datetime('now') WHERE id = NEW.id;
END;
