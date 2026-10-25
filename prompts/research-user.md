# Competitive Analysis Phase 1: Deep Research — User Prompt Template (v2)

> **Source of truth:** `platform/backend/src/routes/foundation.ts` (future — via project_type lookup)
> **Models:** Kimi K2 Thinking / Gemini Deep Research / EDR (3 providers in parallel)
> **Populated from:** Research Brief (Phase 0 output)
> **Change from v1:** Acceptance checklist updated to match v2 system prompt depth expectations. Dossier phase references removed (formatting is handled by the Analysis phase).
> **Note:** Template variables `{{VAR}}` are filled at runtime by `buildResearchUserPrompt()`

---

## RESEARCH ASSIGNMENT

**Project:** {{PROJECT_TITLE}}
**Type:** {{RESEARCH_TYPE}}
**Date Issued:** {{DATE}}

---

## STRATEGIC CONTEXT

The research you produce will directly inform the following decision and audience. Weight your investigation, signal detection, and evidence gathering to serve this context.

- **Decision being informed:** {{DECISION_CONTEXT}}
- **Timeline:** {{TIMELINE}}
- **Stakeholders:** {{STAKEHOLDERS}}

---

## PRIMARY TARGET

- **Entity:** {{PRIMARY_TARGET}}
- **Focus areas:** {{FOCUS_AREAS}}

This is the central subject of the research. Investigate this entity with the greatest depth — every focus area listed above should receive thorough, evidence-backed coverage. Your research on the primary target should be the most comprehensive section of your output. Cover every focus area with specific evidence, data points, and citations. Depth here matters most.

---

## COMPETITIVE SET

The following competitors have been scoped for this research. Investigate each at the depth warranted by their inclusion rationale. Do not add competitors beyond this set unless you discover a material emerging threat — in which case, flag it explicitly as a new entrant signal rather than silently expanding scope.

{{COMPETITIVE_SET_TABLE}}

**Depth guidance by tier:**
- **Direct / primary competitors:** Full evidence coverage — investigate with comparable depth to the primary target. Every signal category should be covered.
- **Adjacent / secondary competitors:** Focus on the most strategically relevant signals. Cover what matters for the decision context; depth should be proportional to what the evidence reveals.
- **Emerging / watchlist entities:** Cover what makes them noteworthy, what to monitor, and why they're on the radar. Brief is fine if evidence is thin; thorough if evidence is rich.

---

## GEOGRAPHIC SCOPE

{{GEOGRAPHIC_SCOPE}}

Constrain evidence gathering and market analysis to the regions specified above. When global data is cited, note which regions it applies to. When a signal is region-specific, tag it accordingly.

---

## TIMEFRAME

{{TEMPORAL_SCOPE}}

Apply recency discipline within this window:
- **Last 90 days:** Treat as the "current delta" — all material changes in this window must be surfaced prominently and clearly dated.
- **Beyond 90 days (within timeframe):** Use for trend analysis, baseline comparisons, and strategic trajectory.
- **Beyond timeframe:** Cite only if essential for historical context (e.g., founding, pivotal events). Label as historical context, not current intelligence.

---

## KEY INTELLIGENCE QUESTIONS

The following questions MUST be answered. They are ranked by importance to the stakeholder decision. Structure your research to ensure every question receives a direct, evidence-backed answer.

If a question cannot be fully answered due to insufficient evidence, state that explicitly with a confidence assessment and recommend the next evidence to seek.

{{KEY_QUESTIONS}}

---

## EXCLUSIONS

The following topics, entities, or areas are explicitly OUT OF SCOPE. Do not investigate or report on these unless they become directly relevant to answering a Key Intelligence Question — in which case, note the scope exception and the reason for it.

{{EXCLUSIONS}}

---

## SOURCE RULES

Apply these constraints in addition to the source hierarchy defined in the system prompt:

1. **Recency:** Prioritize sources from within the timeframe defined above. For "recent changes" content, only use sources dated within 90 days of the research date ({{DATE}}). Flag any claim that relies on evidence older than the timeframe.

2. **Geographic emphasis:** When multiple sources cover the same claim, prefer sources relevant to the geographic scope. Global sources are acceptable when region-specific sources are unavailable.

3. **Source diversity:** For any critical claim (threat assessment, strategic forecast, recommended action), seek evidence from at least 2 independent sources at different levels of the source hierarchy. Single-source critical claims must be labeled `[Single Source / Low Confidence]`.

4. **Primary over secondary:** Prefer company-published documents (pricing pages, changelogs, SEC filings, blog posts, job postings) over analyst commentary or news coverage. When using secondary sources, note the primary source they reference if identifiable.

5. **Competitor parity:** Apply comparable investigative depth across all entities at the same tier in the competitive set. Do not produce substantially more coverage for one entity than another at the same tier unless evidence availability genuinely differs — in which case, note the gap.

---

## RESEARCH DEPTH REMINDER

Your output will be consumed by a downstream analysis agent that synthesizes research from multiple providers into structured deliverables. That agent needs rich, comprehensive raw material to work with.

**Do not summarize. Do not compress. Do not write an executive brief.**

Write a thorough analyst report. Include specific numbers, dates, names, URLs, quotes, and evidence throughout. When you find something interesting, explore it. When sources conflict, present both sides with evidence. When you identify a gap, note what evidence would fill it.

The single most common failure mode is producing a thin, high-level summary instead of deep research. Resist this. Depth wins.

---

## ACCEPTANCE CHECKLIST

Your research output is complete when ALL of the following are true:

- [ ] Every Key Intelligence Question has a direct, evidence-backed answer or an explicit "Insufficient evidence" finding with confidence score and next-evidence recommendation
- [ ] The Primary Target has been researched comprehensively: company overview, financials, product landscape, GTM, strategic signals, weaknesses, recent changes, and forward-looking assessment
- [ ] Every competitor in the Competitive Set has been investigated at the depth warranted by their tier and inclusion rationale
- [ ] All factual claims include inline citations in `[Source Name — Date]` format
- [ ] Every statement is labeled as FACT, INFERENCE, or HYPOTHESIS per the system prompt rules
- [ ] Every INFERENCE and HYPOTHESIS includes Confidence (1–5), Disconfirm test, and Next evidence to seek
- [ ] Critical claims cite 2+ independent sources, or are labeled `[Single Source / Low Confidence]`
- [ ] Recent changes (last 90 days) have been specifically investigated and clearly dated
- [ ] Negative signals (risks, weaknesses, complaints, churn indicators) have been actively investigated — not just positive narrative
- [ ] The output addresses the Decision Context and is weighted toward the Stakeholder audience
- [ ] Geographic and Timeframe constraints have been respected throughout
- [ ] No excluded topics appear in the output unless a scope exception is noted and justified
- [ ] Research depth is proportional to strategic importance — the primary target receives the deepest coverage, competitors are investigated with appropriate thoroughness for their tier

---

**BEGIN RESEARCH.**
