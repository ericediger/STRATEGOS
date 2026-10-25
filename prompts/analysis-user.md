# Competitive Analysis Phase 3: Strategic Analysis — User Prompt Template

> **Source of truth:** `backend/src/services/analysis.ts`
> **Model:** TBD (same as system prompt)
> **Populated from:** Research Brief (Phase 0) + Research Documents (Phase 1) + Verification Report (Phase 2)
> **Note:** Template variables `{{VAR}}` are filled at runtime by `buildAnalysisUserPrompt()`

---

# Strategic Analysis Assignment

**Project:** {{PROJECT_TITLE}}
**Date:** {{DATE}}
**Research Type:** {{RESEARCH_TYPE}}

---

## Research Brief (Approved Scope)

{{RESEARCH_BRIEF}}

---

## Research Documents

{{RESEARCH_DOCUMENTS}}

---

## Citation Verification Report

{{VERIFICATION_REPORT}}

---

## Instructions

1. Process all research documents using the Claim Ledger and Conflict Resolution protocols defined in your system prompt.
2. Integrate the Verification Report — upgrade confidence for VERIFIED claims, flag or exclude Unsupported Claim claims, handle Conflicting Evidence claims explicitly.
3. Produce the Unified Strategic Intelligence Assessment (Chapters 1-5) addressing the Key Questions from the Research Brief.
4. Produce the Audit Tables (Top Claims, Risk Register, Watchlist, Evidence Gaps).
5. Produce the Artifact Recommendation Menu with rationale based on findings and the strategic context from the Research Brief.

**Key Questions That MUST Be Answered:**

{{KEY_QUESTIONS}}

**Decision Context:** {{DECISION_CONTEXT}}

Every chapter of the assessment should ultimately serve this decision context. If a finding doesn't connect to the decision, deprioritize it.
