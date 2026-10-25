# STRATEGOS

Strategic competitive intelligence research platform. An AI-guided workflow that takes a business question from scoping through multi-provider deep research, citation verification, strategic analysis, and finished deliverables exported to Word and PowerPoint.

## What It Does

STRATEGOS guides a business user through a 5-phase strategic analysis workflow:

1. **Define Scope** -- Chat with an AI research collaborator to define scope, competitors, and key questions. The conversation is synthesized into a structured Research Brief. Users can also upload their own brief or edit the generated one.
2. **Research** -- Three deep-research providers investigate the brief concurrently, or you can import external research documents. Each provider can be stopped or re-run individually.
3. **Verify Sources** -- A 7-step citation verification pipeline extracts claims, checks them against their sources, and produces a verification report with a quality gate (Strong Source Quality / Review Recommended).
4. **Analyze** -- Strategic analysis synthesizes all verified research into a unified assessment.
5. **Deliverables** -- Generate from 7 artifact types: SWOT, Positioning, Pricing, Executive Summary, Battle Card, PESTLE, and Five Forces. Export individual artifacts as Word (.docx) or PowerPoint (.pptx), or assemble them into a single branded Competitive Packet deck.

Completed analyses can be saved to a **Competitor Dossier Library** and refreshed later.

## Architecture

```
Frontend (5174) --> Backend API (4000) --> SQLite
                         |
                    Research Engine (4456) --> EDR (9001)
                         |
                    Citation Verifier (9002)
```

Five services, all running locally. All project data (briefs, research, analysis, exports) stays on your machine in SQLite and the `projects/` folder.

| Directory | Service |
|-----------|---------|
| `frontend/` | React + Vite UI |
| `backend/` | Express API, workflow orchestration, analysis, export |
| `research/` | Research engine (provider orchestration) |
| `research/edr-node/` | EDR deep-research provider |
| `research/citation-verifier/` | Citation verification pipeline |
| `prompts/` | Prompt templates (markdown with template variables) |

## Tech Stack

- **Backend:** Express + TypeScript, SQLite (better-sqlite3)
- **Frontend:** React, Vite, Tailwind CSS, React Query
- **AI Models:** Claude Opus 4.6 (chat, brief synthesis, artifact generation, document export), OpenAI GPT-5.2 (strategic analysis)
- **Research Providers:** Kimi K2 Thinking, Gemini Deep Research, EDR (DeepSeek + Tavily)
- **Verification:** Kimi K2.5 + Tavily
- **Export:** pptxgenjs (PPTX), docx (Word), sandboxed script execution

## Requirements

- Node.js 22
- API keys for Anthropic, OpenAI, Google Gemini, Kimi (Moonshot AI), DeepSeek, and Tavily

## Quick Start

```bash
# Install dependencies
(cd backend && npm install)
(cd frontend && npm install)
(cd research && npm install)
(cd research/edr-node && npm install)
(cd research/citation-verifier && npm install)

# Configure API keys
cp backend/.env.example backend/.env
cp research/.env.example research/.env
# then edit both files and add your keys

# Launch all services (macOS: opens one Terminal window per service)
./start-all.command
```

Open http://localhost:5174

On other platforms, start each service in its own terminal:

```bash
(cd research/edr-node && npx tsx src/index.ts)
(cd research && npm run dev)
(cd research/citation-verifier && npx tsx src/index.ts)
(cd backend && npm run dev)
(cd frontend && npm run dev)
```

## Environment Variables

See `backend/.env.example` and `research/.env.example` for the full list.

```bash
# backend/.env
ANTHROPIC_API_KEY=...        # Scoping chat, brief synthesis, artifacts, export
OPENAI_API_KEY=...           # Strategic analysis

# research/.env
GEMINI_API_KEY=...           # Gemini Deep Research
DEEPSEEK_API_KEY=...         # EDR research provider
TAVILY_API_KEY=...           # EDR + verification source checks
KIMI_API_KEY=...             # Kimi research + verification
```

## Testing

```bash
(cd backend && npm test)
```

## License

[MIT](LICENSE)
