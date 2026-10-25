import type { VideoSpec } from '@explainer/src/spec';

/**
 * Storyboard for the STRATEGOS explainer. Each scene is one idea: its words (`narration`, which the captions
 * show) and either an animated component (`kind: 'animated'`) or a page of the app to film (`kind: 'footage'`).
 * A scene lasts leadInSec + its narration + tailSec, so the voice sets the pace and record.ts paces the footage to it.
 *
 * The footage is the real STRATEGOS frontend, built into explainer/demo/stage/ and served without a backend:
 * explainer/demo/mock-api.js answers its /api calls with fictional projects, so no client research is ever filmed.
 * A route is `<app path>` or `<app path>@<preset>`; the preset picks the mock's starting state (see mock-api.js).
 * Rebuild the stage after a frontend change: node explainer/demo/build-stage.mjs
 *
 * Re-run from the app's folder after any edit: npm --prefix <engine> run build
 */
export const spec: VideoSpec = {
  id: 'strategos',
  name: 'STRATEGOS',
  fps: 30,
  // The kit is laid out for 1920x1080: keep these.
  width: 1920,
  height: 1080,
  // The outro shows this as the place to find the code.
  repoUrl: 'github.com/ericediger/STRATEGOS',
  // The address the app really runs at (frontend dev server).
  demoUrl: 'localhost:5174',
  record: {
    appDir: 'explainer/demo/stage',
    page: 'index.html',
    // The clip is the viewport's size whatever dpr is, so the stage lays the app out at 1280 x 720 (its 1024 px
    // content column fills the frame) and draws it twice as large with CSS zoom (mock-api.js): 2560 x 1440 clips with
    // two video pixels per CSS pixel, so camera zooms stay sharp.
    viewport: { width: 2560, height: 1440 },
    dpr: 1,
    // The loading spinner has no heading; every page the video opens does.
    readySelector: '#root h1',
  },
  // ElevenLabs narrates with the engine's default voice (shared in the ElevenLabs Voice Library), set here so it wins
  // over ELEVENLABS_VOICE_ID in the engine's .env; `say` is only the offline fallback.
  voice: { say: 'Samantha', rate: 175, elevenlabs: 'G3qIj1Lb0GkRqMWsPD2C' },
  // The app's own palette (frontend/tailwind.config.ts): indigo-slate surfaces, brand blue, emerald and orchid.
  theme: {
    bg0: '#0E1220',
    bg1: '#131827',
    panel: '#161B2E',
    panel2: '#1C2340',
    line: '#2A3352',
    ink: '#F3F5FA',
    muted: '#98A2BC',
    accent: '#4C7DF0',
    accentDeep: '#3A69D8',
    blue: '#8AA8F5',
    warm: '#2DBE8C',
    red: '#C651C9',
    violet: '#9D8CF0',
    glowA: '#1A2A5C',
    glowB: '#0F3A2E',
    grid: '#18203A',
    font: 'Inter, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif',
    display: 'Inter, -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, sans-serif',
    captionBg: 'rgba(14,18,32,.86)',
    captionInk: '#F3F5FA',
  },
  style: { frame: 'mac', captions: 'bar', lowerThird: 'chapter-card', background: 'mesh', transition: 'zoom-through' },
  // Deliverables, zoomed and settled before the spotlight: five deliverables with their confidence badges.
  poster: { atSec: 52.0 },
  music: { file: 'music/product-groove.mp3', volume: 0.2, duckTo: 0.06, fadeOutSec: 3 },
  // Bring the finished mix up to the level web players expect (one gain for voice and music together).
  loudness: { lufs: -16 },
  scenes: [
    {
      id: 'intro',
      kind: 'animated',
      component: 'Opener',
      // Empty title: no lower third over the opening card.
      title: '',
      narration:
        'Competitive research takes weeks, and its sources rarely get checked. STRATEGOS turns one question into verified, board-ready deliverables.',
      spoken:
        'Competitive research takes weeks, and its sources rarely get checked. Strategos turns one question into verified, board-ready deliverables.',
      leadInSec: 0.8,
    },
    {
      id: 'new-project',
      kind: 'footage',
      route: '/',
      title: 'Start a project',
      narration: 'Every analysis starts as a project. Name it after the question you need answered.',
      note: 'Sample data. All companies shown are fictional.',
      // A short line for a longer action: hold until the new project's card has landed.
      tailSec: 1.8,
    },
    {
      id: 'scoping',
      kind: 'footage',
      route: '/project/nordics/collaborate',
      title: 'Define scope',
      narration:
        'Then scope it with an AI research collaborator. It asks which rivals matter and what decision the research should inform. When you are ready, it writes the Research Brief.',
      note: 'Fictional companies. The collaborator’s replies are scripted.',
    },
    {
      id: 'research',
      kind: 'footage',
      route: '/project/nordics@brief',
      title: 'Deep research',
      narration:
        'Approve the brief, and three independent research teams investigate at once. Each uses different sources, so their findings cross-check.',
      note: 'Staged: real research runs for two to four hours.',
    },
    {
      id: 'verify',
      kind: 'footage',
      route: '/project/routewell',
      title: 'Verify sources',
      narration:
        'Next, every claim is checked against its original source. You see how many held up before anyone builds a strategy on them.',
      note: 'Sample data. All companies shown are fictional.',
    },
    {
      id: 'deliverables',
      kind: 'footage',
      route: '/project/routewell',
      title: 'Deliverables',
      narration:
        'Finally, STRATEGOS writes the deliverables, from a SWOT to a sales battle card. Each one carries a confidence rating. Export them together as one Competitive Packet.',
      spoken:
        'Finally, Strategos writes the deliverables, from a swot to a sales battle card. Each one carries a confidence rating. Export them together as one Competitive Packet.',
      note: 'Sample data. Deliverable text is staged.',
    },
    {
      id: 'outro',
      kind: 'animated',
      component: 'Outro',
      title: '',
      narration:
        'Ten minutes of your time to scope and review. Three research teams do the reading. Every claim is checked against its source. That is STRATEGOS.',
      spoken:
        'Ten minutes of your time to scope and review. Three research teams do the reading. Every claim is checked against its source. That is Strategos.',
      leadInSec: 0.8,
      tailSec: 2.6,
    },
  ],
};
