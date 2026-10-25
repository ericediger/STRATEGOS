/**
 * Recorder choreography: one action per footage scene in script.ts, keyed by scene id. Each action drives the
 * STRATEGOS stage (the real frontend over mock-api.js), glides the cursor, clicks, types, spotlights, and leaves
 * zoom cues that the render turns into camera moves.
 *
 * Times are seconds since the page was ready. Narration starts at leadInSec (0.6 s on every footage scene here),
 * so T(narr, f) is the moment a fraction f of the line has been spoken: each beat hangs on the words it illustrates.
 *
 * The app has no ids or data-* attributes, so selectors lean on its structure: the dashboard's <main> holds one
 * <section> per phase, in order (1 scoping, 2 research, 3 verification, 4 analysis, 5 deliverables), and lucide
 * icons carry classes such as `lucide-plus`.
 *
 * The stage draws the page at CSS zoom 2 (demo/mock-api.js), and rectangles are measured in screen pixels, so every
 * padding goes through px(): the same framing as on a 1280 x 720 page.
 */
import type { SceneAction, SceneRecorder } from '@explainer/scripts/lib/recorder';

const T = (narr: number, f: number): number => 0.6 + f * narr;

const PHASE = (n: number) => `main > section:nth-of-type(${n})`;

/** A padding in the page's CSS pixels, as screen pixels of the zoomed stage. */
const px = (n: number): number => n * 2;

/**
 * Wait until the page has stopped scrolling. scrollTo allows a fixed 0.65 s, and a smooth scroll across the doubled
 * stage can take longer; a zoom cue measured before it ends frames the wrong place.
 * A string, not a function: tsx wraps named inner functions in a __name() helper that doesn't exist in the page.
 */
const settle = (r: SceneRecorder) =>
  r.eval(`new Promise((done) => {
    let last = -1;
    const tick = () => { if (scrollY === last) return done(); last = scrollY; setTimeout(tick, 100); };
    tick();
  })`);

export const actions: Record<string, SceneAction> = {
  // The shortest line in the video for the longest action: start at once, and keep the last glide short
  // (cursor glides take up to 0.9 s, and the zoomed stage doubles every distance).
  'new-project': async (r, narr) => {
    await r.until(0.1);
    await r.click('button:has(svg.lucide-plus)');
    // The header and the form that just opened; after Create, the new card takes the form's place.
    await r.zoomUnion(['.max-w-4xl > .mb-8', '.max-w-4xl > .mb-6'], px(20));
    await r.type('form input[type="text"]', 'Field-Service Scheduling Landscape', { cps: 24 });
    await r.until(T(narr, 0.75));
    await r.click('form button[type="submit"]');
    await r.wait(0.45);
    // Hold on the new card to the cut: a camera reset this late would still be moving when the scene ends.
    await r.moveTo('.space-y-3 > a:first-child', { at: [0.55, 0.5], ms: 450 });
  },

  scoping: async (r, narr) => {
    await r.until(0.4);
    await r.moveTo('textarea', { at: [0.3, 0.5] });
    // The collaborator's question and the reply box under it.
    await r.until(T(narr, 0.2));
    await r.zoomUnion(['main .space-y-6 > div:nth-last-child(2)', 'footer .flex.gap-3'], px(16));
    await r.until(T(narr, 0.3));
    await r.type('textarea', 'Both. It decides our launch pricing.', { cps: 14 });
    await r.press('Enter');
    // The page scrolls as the reply arrives; go wide before pointing at the header.
    await r.until(T(narr, 0.72));
    r.zoomReset();
    await r.until(T(narr, 0.8));
    await r.spot('header button:has(svg.lucide-file-text)', px(6));
    await r.until(T(narr, 0.9));
    await r.click('header button:has(svg.lucide-file-text)');
    await r.unspot();
  },

  research: async (r, narr) => {
    await r.until(0.3);
    await r.click(`${PHASE(1)} button:has(svg.lucide-check-circle)`);
    await r.wait(0.4);
    await r.click('[role="dialog"] .bg-gray-50 button:last-child');
    await r.wait(0.5);
    await r.scrollTo(PHASE(2), 'start');
    await settle(r);
    await r.zoom(`${PHASE(2)} .space-y-3`, px(20));
    await r.until(T(narr, 0.6));
    await r.spot(`${PHASE(2)} .space-y-2`, px(8));
    await r.until(T(narr, 1.0));
    await r.unspot();
    r.zoomReset();
  },

  verify: async (r, narr) => {
    // A beat on the phase bar (all five phases done), then down to Source Verification.
    await r.until(T(narr, 0.08));
    await r.scrollTo(PHASE(3), 'start');
    await settle(r);
    await r.zoom(PHASE(3), px(16));
    await r.until(T(narr, 0.45));
    await r.zoomUnion([`${PHASE(3)} .space-y-3 > div:first-child`, `${PHASE(3)} .grid-cols-3`], px(16));
    await r.until(T(narr, 0.72));
    await r.spot(`${PHASE(3)} .grid-cols-3 > div:nth-child(3)`, px(6));
    await r.until(T(narr, 1.0));
    await r.unspot();
    r.zoomReset();
  },

  deliverables: async (r, narr) => {
    await r.until(0.3);
    await r.scrollTo(PHASE(5), 'start');
    await settle(r);
    await r.zoom(PHASE(5), px(12));
    await r.until(T(narr, 0.44));
    // The first deliverable's name, confidence badge and verification date.
    await r.spot(`${PHASE(5)} .space-y-2 > div:first-child .flex.flex-col`, px(10));
    await r.until(T(narr, 0.6));
    await r.unspot();
    await r.click(`${PHASE(5)} button:has(svg.lucide-download)`);
    await r.wait(0.3);
    await r.zoomUnion([`${PHASE(5)} button:has(svg.lucide-download)`, `${PHASE(5)} .absolute.top-full`], px(20));
    await r.until(T(narr, 1.0) + 0.2);
    r.zoomReset();
  },
};
