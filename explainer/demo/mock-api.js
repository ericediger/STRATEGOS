/**
 * Stage backend for the STRATEGOS explainer. Loaded before the app bundle, it answers the frontend's /api calls
 * with fictional projects, so the real UI runs without the backend, its database or any LLM call.
 * Every company and figure below is invented.
 *
 * The recorder opens index.html#<route>. A route is an app path, optionally with @<preset>:
 *   #/                              the project list
 *   #/project/nordics/collaborate   the scoping chat (3 messages so far)
 *   #/project/nordics@brief         the dashboard with the Research Brief ready for approval
 *   #/project/routewell             a finished project
 * State lives in memory for one page load; each scene starts fresh.
 *
 * Endpoints faked (frontend/src/lib/api.ts), everything under /api:
 *   GET  /projects                                  the project list
 *   POST /projects                                  create a project
 *   GET  /projects/:id                              a project's dashboard
 *   GET  /collaboration/:id/history                 chat history
 *   GET  /collaboration/:id/brief                   the Research Brief
 *   POST /collaboration/:id/chat                    one scripted collaborator reply
 *   POST /collaboration/:id/synthesize              never answers (synthesis runs past the scene)
 *   POST /collaboration/:id/brief/approve           approve: research starts
 *   GET  /collaboration/:id/artifacts/:type         a deliverable's text
 *   any  …/export…                                  never answers (a download would leave the page)
 * Any other /api call is an error: it is logged and shown in a red bar across the page, so a frontend that grew a
 * new endpoint breaks the recording visibly instead of filming an empty panel. Add the endpoint here.
 *
 * The page is laid out as it would be at 1280 x 720 and drawn twice as large (CSS zoom on <html>), so the
 * recorder's 2560 x 1440 clips have two video pixels per CSS pixel and camera zooms stay sharp.
 */
(() => {
  const [route, preset] = decodeURIComponent(location.hash.slice(1)).split('@');
  history.replaceState(null, '', route || '/');

  const STAGE_ZOOM = 2;
  document.documentElement.style.zoom = String(STAGE_ZOOM);
  // Two things CSS zoom doesn't scale the way this stage needs:
  // - Viewport units ignore it, so `100vh` would be 1440 CSS px of layout (twice the screen) and the chat page would
  //   scroll its conversation off the top. The app's full-screen heights are divided by the zoom.
  // - The recorder draws its cursor, click ripple and spotlight as fixed elements at getBoundingClientRect
  //   coordinates, which are already zoomed; inside a zoomed <html> they would land at twice those. A counter-zoom
  //   puts them back at zoom 1, and their sizes are scaled up instead, so they look as they do on a 1280 x 720 page.
  //   The cursor's tip sits at (6, 3) of its 28 px icon; the margin keeps it on the point the recorder aims at.
  // The app's stylesheet and the recorder's load after this <style>, so every rule carries an extra `html` to win.
  const Z = STAGE_ZOOM;
  const css = document.createElement('style');
  css.textContent = `
    html .min-h-screen { min-height: calc(100vh / ${Z}); }
    html .h-screen { height: calc(100vh / ${Z}); }
    html #__cursor, html #__ripple, html #__spot { zoom: ${1 / Z}; }
    html #__cursor svg { display: block; zoom: ${Z}; margin: ${(-3 * (Z - 1)) / Z}px 0 0 ${(-6 * (Z - 1)) / Z}px; }
    html #__ripple { width: ${44 * Z}px; height: ${44 * Z}px; margin: ${-22 * Z}px 0 0 ${-22 * Z}px; border-width: ${3 * Z}px; }
    html #__spot { outline-width: ${2 * Z}px; border-radius: ${10 * Z}px; }
  `;
  document.head.appendChild(css);

  const NOW = Date.now();
  const ago = (min) => new Date(NOW - min * 60000).toISOString();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const PHASE_LABEL = {
    not_started: 'Not Started', collaborating: 'Collaboration', brief_generated: 'Brief Ready', researching: 'Research',
    verifying: 'Verification', analysis_complete: 'Analysis Done', complete: 'Complete',
  };
  const PHASE = {
    not_started: 'collaboration', collaborating: 'collaboration', brief_generated: 'collaboration', researching: 'research',
    verifying: 'verification', analysis_complete: 'artifacts', complete: 'artifacts',
  };

  // ---------------------------------------------------------------------------------------------------------------
  // Content (fictional)
  // ---------------------------------------------------------------------------------------------------------------

  const NORDICS_BRIEF = `# Research Brief: Nordics Expansion, Field-Service Scheduling Tools

Decision: set launch pricing and packaging for a Nordics entry next year. Competitive set: Orbitask, the regional leader in mid-market scheduling; Crewlyst, mobile-first and aggressive on price; and the three largest local schedulers in Sweden, Norway and Denmark.

## Research questions
1. How does each rival price per technician, and what sits in each tier?
2. Which integrations do Nordic buyers treat as table stakes?
3. Where are Orbitask and Crewlyst weakest in customer reviews?
4. How long are sales cycles, and who signs off?`;

  const ROUTEWELL_BRIEF = `# Research Brief: Routewell Pricing Teardown

Decision: whether to match Routewell's per-route pricing or hold our per-technician model. Competitive set: Routewell, Orbitask and Crewlyst in UK mid-market field service.`;

  const ASSESSMENT = `Routewell's per-route pricing wins small fleets but gets expensive past 40 technicians, where our per-technician model is 18–24% cheaper. Its weakest point is dispatch on mobile: 31% of negative reviews cite it. Recommendation: hold per-technician pricing and lead mid-market campaigns with the fleet-size cost comparison.`;

  const EXEC_SUMMARY = `# Executive Summary: Routewell Pricing Teardown

**Bottom line:** hold per-technician pricing. Above 40 technicians we are 18–24% cheaper than Routewell, and that is where 70% of our pipeline sits.

**What Routewell does well:** simple per-route pricing, fast onboarding, strong route optimisation.

**Where it is exposed:** mobile dispatch (31% of negative reviews), no native payroll integration, price jumps at the 50-route tier.

**Recommended moves:**
1. Publish a fleet-size cost calculator for 40+ technician prospects.
2. Arm sales with the Routewell battle card before Q1 renewals.
3. Re-check pricing in 90 days; Routewell changed tiers twice this year.`;

  const REPORT = `# Verification Report

214 claims extracted from three research streams. 201 verified against primary sources (pricing pages, filings, release notes). 13 rely on indirect evidence and are flagged in the deliverables.`;

  const WELCOME = (name) => `Welcome to the Strategic Analysis collaboration for "${name}".

I'll help you define the scope and objectives for your competitive research. Let's start by understanding your competitive landscape.

**Some questions to consider:**
- What market or industry are you analyzing?
- Who are the key competitors you want to investigate?
- What specific aspects matter most? (pricing, features, market positioning, technology, go-to-market strategy, etc.)
- What decisions will this analysis inform?

Share whatever you know so far, and I'll help you refine the research scope into a comprehensive Research Brief.`;

  const CHAT_REPLY = `That's enough to scope it. I'll focus the research on Orbitask, Crewlyst and the three largest local schedulers, with launch pricing and packaging as the lens.

Create the Research Brief when you're ready.`;

  // ---------------------------------------------------------------------------------------------------------------
  // Projects
  // ---------------------------------------------------------------------------------------------------------------

  const provider = (status, wordCount, startedMin, doneMin) => ({
    status,
    wordCount: status === 'complete' ? wordCount : null,
    startedAt: status === 'pending' ? null : ago(startedMin),
    completedAt: status === 'complete' ? ago(doneMin) : null,
    content: status === 'complete' ? `Research stream (${wordCount.toLocaleString()} words). Sample content for the explainer.` : null,
  });
  const research = (status) => ({
    kimi: provider(status, 9412, 300, 170),
    gemini: provider(status, 7986, 300, 200),
    edr: provider(status, 11203, 300, 150),
  });
  const PENDING_VERIFICATION = { completed: false, status: 'pending', progress: 0, currentStep: null, claimCount: null, issueRate: null, gateStatus: null, reportContent: null, error: null };
  const PENDING_ANALYSIS = { completed: false, status: 'pending', assessmentContent: null, wordCount: null, error: null };

  const DELIVERABLES = [
    ['swot', 'SWOT Analysis', 'High', 95, 5],
    ['positioning', 'Positioning Matrix', 'High', 92, 8],
    ['pricing', 'Pricing Comparison', 'Medium', 81, 19],
    ['executive-summary', 'Executive Summary', 'High', 94, 6],
    ['battle-card', 'Battle Card', 'Medium', 86, 14],
  ];

  const projects = {
    nordics: {
      name: 'Nordics Expansion: Scheduling Tools',
      status: preset === 'brief' ? 'brief_generated' : 'collaborating',
      updated: 8,
      messages: [
        { role: 'assistant', content: WELCOME('Nordics Expansion: Scheduling Tools'), timestamp: ago(14) },
        {
          role: 'user',
          content: 'We sell field-service scheduling software in the UK and are weighing a Nordics launch next year. The rivals there are Orbitask and Crewlyst, plus a few local tools.',
          timestamp: ago(12),
        },
        {
          role: 'assistant',
          content: `Helpful. Two questions before I draft the scope:

- Which rivals matter most: Orbitask and Crewlyst, or the local schedulers too?
- What decision will this research inform: whether to enter, or how to price and position at launch?`,
          timestamp: ago(12),
        },
      ],
      brief: NORDICS_BRIEF,
      briefWords: 1846,
    },
    crewlyst: { name: 'Crewlyst Battle Card Refresh', status: 'researching', updated: 25, messages: [], brief: '', briefWords: 1210 },
    orbitask: { name: 'Orbitask Roadmap Signals', status: 'verifying', updated: 50, messages: [], brief: '', briefWords: 1534 },
    routewell: { name: 'Routewell Pricing Teardown', status: 'complete', updated: 130, messages: [], brief: ROUTEWELL_BRIEF, briefWords: 1692 },
  };

  function dashboard(id) {
    const p = projects[id];
    const s = p.status;
    const done = s === 'complete';
    const briefApproved = !['not_started', 'collaborating', 'brief_generated'].includes(s);
    return {
      project: { id, name: p.name, rootPath: '', status: s, researchBriefPath: null, error_message: null, createdAt: ago(p.updated + 600), updatedAt: ago(p.updated) },
      collaboration: { messageCount: done ? 9 : p.messages.length, briefGenerated: s !== 'not_started' && s !== 'collaborating', briefApproved },
      research: research(done ? 'complete' : s === 'researching' ? 'running' : 'pending'),
      verification: done
        ? { completed: true, status: 'complete', progress: 100, currentStep: null, claimCount: 214, issueRate: 0.061, gateStatus: 'PASSED', reportContent: REPORT, error: null }
        : PENDING_VERIFICATION,
      analysis: done ? { completed: true, status: 'complete', assessmentContent: ASSESSMENT, wordCount: 4382, error: null } : PENDING_ANALYSIS,
      artifacts: done
        ? DELIVERABLES.map(([type, label], i) => ({
            id: `${id}-${type}`, projectId: id, artifactType: type, label, status: 'complete', outputPath: null,
            createdAt: ago(150), completedAt: ago(140 - i * 2), lastExportedAt: null, availableExports: [],
          }))
        : [],
      confidence: done
        ? {
            overall: { rating: 'High', verifiedPercent: 94, issueRate: 6.1, recencyDays: 2, factors: [] },
            perSection: Object.fromEntries(DELIVERABLES.map(([type, , rating, verifiedPercent, issueRate]) => [type, { rating, verifiedPercent, issueRate, recencyDays: 2, factors: [] }])),
            verificationDate: ago(2 * 24 * 60),
          }
        : undefined,
      currentPhase: PHASE[s] || 'collaboration',
      attention: [],
      activity: [],
      linkedDossier: null,
    };
  }

  const summary = (id) => ({ id, name: projects[id].name, status: projects[id].status, currentPhaseLabel: PHASE_LABEL[projects[id].status] || '', updatedAt: ago(projects[id].updated) });

  // ---------------------------------------------------------------------------------------------------------------
  // Routes
  // ---------------------------------------------------------------------------------------------------------------

  async function handle(method, path, body) {
    let m;
    if (method === 'GET' && path === '/projects') {
      const ids = Object.keys(projects).sort((a, b) => projects[a].updated - projects[b].updated);
      return { body: { projects: ids.map(summary) } };
    }
    if (method === 'POST' && path === '/projects') {
      const id = body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      projects[id] = { name: body.name, status: 'not_started', updated: 0, messages: [], brief: '', briefWords: 0 };
      return { delay: 450, body: { project: dashboard(id).project } };
    }
    if ((m = /^\/projects\/([^/]+)$/.exec(path)) && projects[m[1]]) {
      return { body: dashboard(m[1]) };
    }
    if ((m = /^\/collaboration\/([^/]+)\/(.+)$/.exec(path)) && projects[m[1]]) {
      const p = projects[m[1]];
      const [, , what] = m;
      if (what === 'history') return { body: { messages: p.messages } };
      if (what === 'brief') return { body: { content: p.brief, wordCount: p.briefWords, status: p.status } };
      if (what === 'chat') {
        p.messages.push({ role: 'user', content: body.message, timestamp: new Date().toISOString() });
        p.messages.push({ role: 'assistant', content: CHAT_REPLY, timestamp: new Date().toISOString() });
        return { delay: 1400, body: { reply: CHAT_REPLY, messageCount: p.messages.length } };
      }
      // Real brief synthesis takes about a minute; the scene ends while it runs.
      if (what === 'synthesize') return { delay: 120000, body: { success: true, wordCount: p.briefWords } };
      if (what === 'brief/approve') {
        p.status = 'researching';
        p.updated = 0;
        return { delay: 350, body: { success: true } };
      }
      if ((m = /^artifacts\/(.+)$/.exec(what))) {
        const content = m[1] === 'executive-summary' ? EXEC_SUMMARY : `Sample ${m[1]} deliverable for the explainer.`;
        return { delay: 250, body: { content, wordCount: content.split(/\s+/).length } };
      }
    }
    // Downloads would navigate the page away from the recorder's overlays; never answer them.
    if (/\/export/.test(path)) return { delay: 120000, body: { status: 'ok', filename: 'packet.pptx' } };
    return unstaged(method, path);
  }

  // A call this stage doesn't fake: log it and put it in a red bar across the page, which the recording will show.
  function unstaged(method, path) {
    const msg = `Stage mock: no fake for ${method} /api${path}. Add it to explainer/demo/mock-api.js.`;
    console.error(`[stage] ${msg}`);
    const show = () => {
      let bar = document.getElementById('stage-mock-error');
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'stage-mock-error';
        bar.style.cssText =
          'position:fixed;left:0;right:0;top:0;z-index:2147483647;padding:10px 16px;background:#b00020;color:#fff;font:600 14px/1.4 -apple-system,sans-serif;white-space:pre-line';
        document.body.appendChild(bar);
      }
      bar.textContent += (bar.textContent ? '\n' : '') + msg;
    };
    if (document.body) show();
    else document.addEventListener('DOMContentLoaded', show);
    return { status: 501, body: { error: msg } };
  }

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return realFetch(input, init);
    const method = (init.method || 'GET').toUpperCase();
    const body = typeof init.body === 'string' && init.body ? JSON.parse(init.body) : undefined;
    const res = await handle(method, url.pathname.slice(4), body);
    await sleep(res.delay ?? 30);
    return new Response(JSON.stringify(res.body), { status: res.status ?? 200, headers: { 'content-type': 'application/json' } });
  };
})();
