# Competitive Analysis: Delta Research Refresh -- User Prompt Template

> **Models:** Kimi K2 Thinking / Gemini Deep Research / EDR (3 providers in parallel)
> **Paired with:** `research-system.md` (system prompt)
> **Purpose:** Targeted intelligence refresh for existing dossiers. Focuses exclusively on new developments since the reference date.
> **Note:** Template variables `{{VAR}}` are filled at runtime by `buildResearchPrompts()` in delta mode.

---

## RESEARCH ASSIGNMENT

**Project:** {{PROJECT_TITLE}}
**Type:** Delta Intelligence Refresh
**Reference Date:** {{REFERENCE_DATE}}

This is a targeted intelligence refresh. Focus exclusively on developments published or announced since {{REFERENCE_DATE}}. Do not reproduce baseline research that already exists for this subject.

---

## STRATEGIC CONTEXT

- **Primary Target:** {{PRIMARY_TARGET}}
- **Industry:** {{INDUSTRY}}
- **Decision being informed:** {{DECISION_CONTEXT}}

---

## COMPETITIVE SET

{{COMPETITIVE_SET}}

---

## KEY INTELLIGENCE QUESTIONS

{{KEY_QUESTIONS}}

---

## EXISTING RESEARCH BRIEF

The following brief summarizes research already completed for this subject. Use it as context to avoid duplicating known information and to identify where the intelligence picture may have changed.

{{RESEARCH_BRIEF}}

---

## PRIORITIZED SIGNAL LIST

Focus your investigation on the following signal categories, in priority order:

1. **Release notes and product updates** -- new features shipped, version upgrades, deprecations, platform changes, and changelog entries since {{REFERENCE_DATE}}.
2. **Pricing or packaging changes** -- new tiers, price adjustments, bundling changes, free-to-paid conversions, or packaging restructures.
3. **Leadership and organizational changes** -- executive hires, departures, reorgs, layoffs, team expansions, and board appointments.
4. **New partnerships, customers, or integrations** -- announced partnerships, customer wins, ecosystem integrations, marketplace listings, and co-marketing activity.
5. **Competitive responses to market events** -- reactions to competitor launches, regulatory changes, market shifts, or industry trends.
6. **M&A or funding activity** -- acquisitions, mergers, investment rounds, valuations, and strategic investments.

If a signal category has no new developments since {{REFERENCE_DATE}}, state that explicitly rather than omitting the category.

---

## RECENCY DISCIPLINE

Every finding you report must include a publication date or event date. Findings without dates will be rejected.

- Only include developments from after {{REFERENCE_DATE}}.
- Do not re-research well-established background information.
- Do not repeat company histories or founding narratives.
- If a development straddles the reference date (e.g., announced before but shipped after), include it with clear date context.

---

## RESEARCH DEPTH REMINDER

Include everything relevant. Do not summarize or omit findings to save space. If a development is significant, include full context and detail. Your output will be consumed by a downstream analysis agent that needs rich, dated, evidence-backed material to work with.

Do not use em-dashes anywhere in your output. Use commas, semicolons, colons, or separate sentences instead.

---

## ACCEPTANCE CHECKLIST

Your delta research output is complete when ALL of the following are true:

- [ ] Every finding includes a publication date or event date
- [ ] All developments are from after {{REFERENCE_DATE}}
- [ ] No baseline or historical information has been re-researched
- [ ] Every signal category in the Prioritized Signal List has been addressed (even if the finding is "no new developments")
- [ ] All factual claims include inline citations in `[Source Name -- Date]` format
- [ ] Key Intelligence Questions have been re-evaluated against new evidence
- [ ] The output is comprehensive; nothing relevant has been omitted for brevity

---

**BEGIN DELTA RESEARCH.**
