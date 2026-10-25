/**
 * STRATEGOS PPTX Master Template
 *
 * Shared layout module for all PowerPoint exports.
 * CommonJS — runs in the sandboxed /tmp/ execution environment.
 *
 * Usage:
 *   const master = require('./pptx-master.js');
 *   const pres = master.createPresentation();
 *   master.addTitleSlide(pres, { title, subtitle, date, competitors, logoPath });
 *   master.addDividerSlide(pres, { sectionName, framingText, slideNumber });
 *   master.addContentSlide(pres, { title, bodyElements, slideNumber, logoPath });
 *   master.addTableSlide(pres, { title, tableData, options, slideNumber, logoPath });
 */

const pptxgen = require('pptxgenjs');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// A) BRAND CONSTANTS
// ---------------------------------------------------------------------------

const BRAND = {
  colors: {
    blue:       '4C7DF0',
    green:      '2DBE8C',
    magenta:    'C651C9',
    darkBlue:   '1C2340',
    darkGrey:   '3B3F4A',
    white:      'FFFFFF',
    lightGrey:  'F5F5F5',
    mediumGrey: 'E0E0E0',
    cardBg:     'F3F4F9',
    navy:       '242B55',
    muted:      '5B6275',
  },
  fonts: {
    heading: 'Arial',
    body:    'Arial',
  },
  sizes: {
    title:    28,
    subtitle: 18,
    h1:       24,
    h2:       20,
    h3:       16,
    body:     11,
    small:     9,
  },
};

// ---------------------------------------------------------------------------
// LAYOUT CONSTANTS
// ---------------------------------------------------------------------------

const SLIDE_W = 10;
const SLIDE_H = 5.625;
const MARGIN = 0.5;
const CONTENT_W = SLIDE_W - 2 * MARGIN;
const TITLE_BAR_H = 0.06;
const FOOTER_H = 0.35;

// ---------------------------------------------------------------------------
// UTILITY: Shadow factory (never reuse shadow objects)
// ---------------------------------------------------------------------------

function makeShadow(opts) {
  return Object.assign(
    { type: 'outer', blur: 6, offset: 2, angle: 135, color: '000000', opacity: 0.15 },
    opts || {}
  );
}

// ---------------------------------------------------------------------------
// UTILITY: Card pattern
// ---------------------------------------------------------------------------

function addCard(slide, pres, opts) {
  var x = opts.x, y = opts.y, w = opts.w, h = opts.h;
  var accentColor = opts.accentColor || BRAND.colors.blue;
  var title = opts.title || '';
  var body = opts.body || '';

  // Card background
  slide.addShape(pres.shapes.RECTANGLE, {
    x: x, y: y, w: w, h: h,
    fill: { color: BRAND.colors.white },
    shadow: makeShadow(),
    rectRadius: 0.05,
  });

  // Left accent bar
  slide.addShape(pres.shapes.RECTANGLE, {
    x: x, y: y, w: 0.06, h: h,
    fill: { color: accentColor },
  });

  // Title text
  if (title) {
    slide.addText(title, {
      x: x + 0.2, y: y + 0.08, w: w - 0.3, h: 0.35,
      fontSize: 13, bold: true, color: BRAND.colors.darkBlue,
      fontFace: BRAND.fonts.heading, valign: 'middle',
    });
  }

  // Body text
  if (body) {
    var bodyY = title ? y + 0.42 : y + 0.1;
    var bodyH = title ? h - 0.52 : h - 0.2;
    slide.addText(body, {
      x: x + 0.2, y: bodyY, w: w - 0.3, h: bodyH,
      fontSize: BRAND.sizes.body, color: BRAND.colors.darkGrey,
      fontFace: BRAND.fonts.body, valign: 'top',
    });
  }
}

// ---------------------------------------------------------------------------
// C) UTILITY: Footer
// ---------------------------------------------------------------------------

function addFooter(slide, opts) {
  var slideNumber = (opts && opts.slideNumber) || '';
  var logoPath = (opts && opts.logoPath) || '';

  // Thin separator line
  slide.addShape('line', {
    x: MARGIN, y: SLIDE_H - FOOTER_H - 0.02, w: CONTENT_W, h: 0,
    line: { color: BRAND.colors.mediumGrey, width: 0.5 },
  });

  // Page number right
  if (slideNumber) {
    slide.addText(String(slideNumber), {
      x: SLIDE_W - MARGIN - 0.6, y: SLIDE_H - FOOTER_H, w: 0.6, h: FOOTER_H,
      fontSize: BRAND.sizes.small, color: BRAND.colors.muted,
      fontFace: BRAND.fonts.body, align: 'right', valign: 'middle',
    });
  }

  // Logo left (if file exists)
  if (logoPath && fs.existsSync(logoPath)) {
    slide.addImage({
      path: logoPath,
      x: MARGIN, y: SLIDE_H - FOOTER_H + 0.04,
      w: 0.65, h: 0.25,
    });
  }

  // "STRATEGOS" text as fallback / always present
  slide.addText('STRATEGOS', {
    x: MARGIN + 0.7, y: SLIDE_H - FOOTER_H, w: 1.5, h: FOOTER_H,
    fontSize: BRAND.sizes.small, color: BRAND.colors.muted,
    fontFace: BRAND.fonts.body, bold: true, valign: 'middle',
  });
}

// ---------------------------------------------------------------------------
// B) MASTER LAYOUT HELPERS
// ---------------------------------------------------------------------------

/**
 * 1. createPresentation()
 *    Initialises a pptxgenjs instance with brand defaults.
 */
function createPresentation() {
  var pres = new pptxgen();
  pres.layout = 'LAYOUT_16x9';
  pres.author = 'STRATEGOS';

  return pres;
}

/**
 * 2. addTitleSlide()
 *    Dark blue background, centred title, subtitle, date, competitors list, logo.
 */
function addTitleSlide(pres, opts) {
  var title = opts.title || 'Untitled';
  var subtitle = opts.subtitle || '';
  var date = opts.date || '';
  var competitors = opts.competitors || '';
  var logoPath = opts.logoPath || '';

  var slide = pres.addSlide();
  slide.background = { fill: BRAND.colors.darkBlue };

  // Title
  slide.addText(title, {
    x: MARGIN, y: 1.2, w: CONTENT_W, h: 1.2,
    fontSize: BRAND.sizes.title + 8, bold: true, color: BRAND.colors.white,
    fontFace: BRAND.fonts.heading, align: 'center', valign: 'middle',
  });

  // Subtitle
  if (subtitle) {
    slide.addText(subtitle, {
      x: MARGIN, y: 2.4, w: CONTENT_W, h: 0.6,
      fontSize: BRAND.sizes.subtitle, color: BRAND.colors.blue,
      fontFace: BRAND.fonts.body, align: 'center', valign: 'middle',
    });
  }

  // Competitors line
  if (competitors) {
    slide.addText(competitors, {
      x: MARGIN, y: 3.05, w: CONTENT_W, h: 0.4,
      fontSize: 12, color: BRAND.colors.white,
      fontFace: BRAND.fonts.body, align: 'center', valign: 'middle',
      italic: true,
    });
  }

  // Accent bar
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 3.5, y: 3.6, w: 3.0, h: 0.04,
    fill: { color: BRAND.colors.blue },
  });

  // Date bottom-left
  if (date) {
    slide.addText(date, {
      x: MARGIN, y: SLIDE_H - 0.55, w: 3, h: 0.35,
      fontSize: 10, color: BRAND.colors.white,
      fontFace: BRAND.fonts.body, align: 'left', valign: 'middle',
    });
  }

  // Logo bottom-right
  if (logoPath && fs.existsSync(logoPath)) {
    slide.addImage({
      path: logoPath,
      x: SLIDE_W - MARGIN - 1.0, y: SLIDE_H - 0.55,
      w: 0.9, h: 0.35,
    });
  }

  return slide;
}

/**
 * 3. addDividerSlide()
 *    Section divider: dark blue background, section name, framing text.
 */
function addDividerSlide(pres, opts) {
  var sectionName = opts.sectionName || '';
  var framingText = opts.framingText || '';
  var slideNumber = opts.slideNumber || '';

  var slide = pres.addSlide();
  slide.background = { fill: BRAND.colors.darkBlue };

  // Section heading
  slide.addText(sectionName, {
    x: MARGIN, y: 1.6, w: CONTENT_W, h: 1.0,
    fontSize: BRAND.sizes.h1 + 4, bold: true, color: BRAND.colors.white,
    fontFace: BRAND.fonts.heading, align: 'center', valign: 'middle',
  });

  // Accent bar below heading
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 3.5, y: 2.7, w: 3.0, h: 0.04,
    fill: { color: BRAND.colors.blue },
  });

  // Framing text
  if (framingText) {
    slide.addText(framingText, {
      x: 1.5, y: 3.0, w: 7.0, h: 0.6,
      fontSize: 14, color: BRAND.colors.white,
      fontFace: BRAND.fonts.body, align: 'center', valign: 'middle',
      italic: true,
    });
  }

  // Slide number bottom-right
  if (slideNumber) {
    slide.addText(String(slideNumber), {
      x: SLIDE_W - MARGIN - 0.6, y: SLIDE_H - 0.45, w: 0.6, h: 0.35,
      fontSize: BRAND.sizes.small, color: BRAND.colors.white,
      fontFace: BRAND.fonts.body, align: 'right', valign: 'middle',
    });
  }

  return slide;
}

/**
 * 4. addContentSlide()
 *    White background with brand-blue accent title bar, body area, footer.
 *
 *    bodyElements: string | array
 *      - If string, rendered as a single text block
 *      - If array, each element is an object:
 *        { type: 'text' | 'bullets' | 'cards', content: ... }
 */
function addContentSlide(pres, opts) {
  var title = opts.title || '';
  var bodyElements = opts.bodyElements || '';
  var slideNumber = opts.slideNumber || '';
  var logoPath = opts.logoPath || '';

  var slide = pres.addSlide();
  slide.background = { fill: BRAND.colors.white };

  // Title bar accent stripe
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: SLIDE_W, h: TITLE_BAR_H,
    fill: { color: BRAND.colors.blue },
  });

  // Title text
  if (title) {
    slide.addText(title, {
      x: MARGIN, y: 0.15, w: CONTENT_W, h: 0.55,
      fontSize: BRAND.sizes.h2, bold: true, color: BRAND.colors.darkBlue,
      fontFace: BRAND.fonts.heading, valign: 'middle',
    });
  }

  // Body area
  var bodyY = 0.8;
  var bodyH = SLIDE_H - bodyY - FOOTER_H - 0.15;

  if (typeof bodyElements === 'string') {
    slide.addText(bodyElements, {
      x: MARGIN, y: bodyY, w: CONTENT_W, h: bodyH,
      fontSize: BRAND.sizes.body, color: BRAND.colors.darkGrey,
      fontFace: BRAND.fonts.body, valign: 'top',
    });
  } else if (Array.isArray(bodyElements)) {
    // Render each element in sequence
    var curY = bodyY;
    for (var i = 0; i < bodyElements.length; i++) {
      var el = bodyElements[i];
      if (!el) continue;

      if (el.type === 'text') {
        var textH = el.h || 0.35;
        slide.addText(el.content || '', {
          x: MARGIN, y: curY, w: CONTENT_W, h: textH,
          fontSize: el.fontSize || BRAND.sizes.body,
          bold: el.bold || false,
          color: el.color || BRAND.colors.darkGrey,
          fontFace: BRAND.fonts.body, valign: 'top',
        });
        curY += textH + 0.1;
      } else if (el.type === 'bullets') {
        var items = el.content || [];
        var bulletH = Math.min(items.length * 0.32, bodyH - (curY - bodyY));
        var bulletTextArray = items.map(function(item, idx) {
          var obj = {
            text: item,
            options: {
              fontSize: BRAND.sizes.body,
              color: BRAND.colors.darkGrey,
              fontFace: BRAND.fonts.body,
              bullet: true,
              paraSpaceAfter: 6,
            },
          };
          if (idx < items.length - 1) {
            obj.options.breakLine = true;
          }
          return obj;
        });
        slide.addText(bulletTextArray, {
          x: MARGIN, y: curY, w: CONTENT_W, h: bulletH,
          valign: 'top',
        });
        curY += bulletH + 0.1;
      } else if (el.type === 'cards') {
        var cards = el.content || [];
        var cols = el.columns || 2;
        var cardW = (CONTENT_W - (cols - 1) * 0.2) / cols;
        var cardH = el.cardHeight || 1.2;
        for (var ci = 0; ci < cards.length; ci++) {
          var col = ci % cols;
          var row = Math.floor(ci / cols);
          var cx = MARGIN + col * (cardW + 0.2);
          var cy = curY + row * (cardH + 0.15);
          addCard(slide, pres, {
            x: cx, y: cy, w: cardW, h: cardH,
            accentColor: cards[ci].accentColor || BRAND.colors.blue,
            title: cards[ci].title || '',
            body: cards[ci].body || '',
          });
        }
        var totalRows = Math.ceil(cards.length / cols);
        curY += totalRows * (cardH + 0.15) + 0.1;
      }
    }
  }

  // Footer
  addFooter(slide, { slideNumber: slideNumber, logoPath: logoPath });

  return slide;
}

/**
 * 5. addTableSlide()
 *    White background with branded table: header row in brand blue.
 *
 *    tableData: {
 *      headers: string[],
 *      rows: string[][]
 *    }
 *    options: { colWidths?: number[], fontSize?: number }
 */
function addTableSlide(pres, opts) {
  var title = opts.title || '';
  var tableData = opts.tableData || { headers: [], rows: [] };
  var options = opts.options || {};
  var slideNumber = opts.slideNumber || '';
  var logoPath = opts.logoPath || '';

  var slide = pres.addSlide();
  slide.background = { fill: BRAND.colors.white };

  // Title bar accent stripe
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: SLIDE_W, h: TITLE_BAR_H,
    fill: { color: BRAND.colors.blue },
  });

  // Title
  if (title) {
    slide.addText(title, {
      x: MARGIN, y: 0.15, w: CONTENT_W, h: 0.55,
      fontSize: BRAND.sizes.h2, bold: true, color: BRAND.colors.darkBlue,
      fontFace: BRAND.fonts.heading, valign: 'middle',
    });
  }

  // Build table rows
  var rows = [];
  var headers = tableData.headers || [];
  var bodyRows = tableData.rows || [];
  var numCols = headers.length || (bodyRows[0] ? bodyRows[0].length : 1);
  var fontSize = options.fontSize || 10;

  // Default column widths: evenly distributed
  var colWidths = options.colWidths;
  if (!colWidths) {
    var cw = CONTENT_W / numCols;
    colWidths = [];
    for (var c = 0; c < numCols; c++) colWidths.push(cw);
  }

  // Header row
  if (headers.length > 0) {
    var headerRow = headers.map(function(h) {
      return {
        text: h,
        options: {
          fill: { color: BRAND.colors.navy },
          color: BRAND.colors.white,
          bold: true,
          fontSize: fontSize,
          fontFace: BRAND.fonts.body,
          align: 'left',
          valign: 'middle',
          margin: [4, 6, 4, 6],
        },
      };
    });
    rows.push(headerRow);
  }

  // Body rows with alternating shading
  for (var r = 0; r < bodyRows.length; r++) {
    var fillColor = r % 2 === 0 ? BRAND.colors.white : BRAND.colors.lightGrey;
    var dataRow = bodyRows[r].map(function(cell) {
      return {
        text: cell,
        options: {
          fill: { color: fillColor },
          color: BRAND.colors.darkGrey,
          fontSize: fontSize,
          fontFace: BRAND.fonts.body,
          align: 'left',
          valign: 'middle',
          margin: [3, 6, 3, 6],
        },
      };
    });
    rows.push(dataRow);
  }

  // Table position
  var tableY = title ? 0.8 : 0.5;
  var tableH = SLIDE_H - tableY - FOOTER_H - 0.15;

  if (rows.length > 0) {
    slide.addTable(rows, {
      x: MARGIN, y: tableY, w: CONTENT_W,
      colW: colWidths,
      border: { type: 'solid', pt: 0.5, color: BRAND.colors.mediumGrey },
      autoPage: false,
    });
  }

  // Footer
  addFooter(slide, { slideNumber: slideNumber, logoPath: logoPath });

  return slide;
}

/**
 * addClosingSlide()
 *    Dark blue background, STRATEGOS centred, project title below.
 */
function addClosingSlide(pres, opts) {
  var projectTitle = (opts && opts.projectTitle) || '';
  var logoPath = (opts && opts.logoPath) || '';

  var slide = pres.addSlide();
  slide.background = { fill: BRAND.colors.darkBlue };

  // STRATEGOS title
  slide.addText('STRATEGOS', {
    x: MARGIN, y: 1.8, w: CONTENT_W, h: 0.8,
    fontSize: 36, bold: true, color: BRAND.colors.white,
    fontFace: BRAND.fonts.heading, align: 'center', valign: 'middle',
    charSpacing: 4,
  });

  // Accent bar
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 3.5, y: 2.7, w: 3.0, h: 0.04,
    fill: { color: BRAND.colors.blue },
  });

  // Project title
  if (projectTitle) {
    slide.addText(projectTitle, {
      x: 1.5, y: 2.9, w: 7.0, h: 0.5,
      fontSize: 16, color: BRAND.colors.white,
      fontFace: BRAND.fonts.body, align: 'center', valign: 'middle',
    });
  }

  // Logo bottom-center
  if (logoPath && fs.existsSync(logoPath)) {
    slide.addImage({
      path: logoPath,
      x: SLIDE_W / 2 - 0.5, y: SLIDE_H - 0.7,
      w: 1.0, h: 0.4,
    });
  }

  return slide;
}

// ---------------------------------------------------------------------------
// H) CITATION FOOTNOTE UTILITIES
// ---------------------------------------------------------------------------

/**
 * Parse the ## Sources section from artifact markdown content.
 * Returns an object mapping source number to description string.
 * Example: { 1: "Monday.com Q4 Earnings - Verified: GRP-069", 2: "..." }
 */
function parseSources(content) {
  const match = content.match(/## Sources\n([\s\S]*?)$/);
  if (!match) return {};
  const sources = {};
  for (const line of match[1].trim().split('\n')) {
    const m = line.match(/^\[(\d+)\]\s*(.+)/);
    if (m) sources[parseInt(m[1])] = m[2].trim();
  }
  return sources;
}

/**
 * Extract unique citation numbers [1], [2] etc. from text.
 * Returns sorted array of integers.
 */
function extractCitations(text) {
  const nums = new Set();
  const re = /\[(\d+)\]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const n = parseInt(m[1]);
    if (n >= 1 && n <= 50) nums.add(n);
  }
  return Array.from(nums).sort(function(a, b) { return a - b; });
}

/**
 * Strip [N] citation markers from text for slide display.
 */
function stripCitations(text) {
  return text.replace(/\s*\[\d+\]/g, '').replace(/\[\d+\]\s*/g, '');
}

/**
 * Add a footnote area at the bottom of a slide, above the footer.
 * @param {object} slide - The pptxgenjs slide object
 * @param {number[]} citationNums - Array of citation numbers used on this slide
 * @param {object} sources - Map from number to source description string
 */
function addFootnoteArea(slide, citationNums, sources) {
  if (!citationNums || citationNums.length === 0) return;
  var parts = [];
  for (var i = 0; i < citationNums.length; i++) {
    var n = citationNums[i];
    if (sources[n]) {
      // Take the brief description (first part before first " - ")
      var desc = sources[n].split(' - ')[0];
      // Truncate long descriptions
      if (desc.length > 60) desc = desc.substring(0, 57) + '...';
      parts.push('[' + n + '] ' + desc);
    }
  }
  if (parts.length === 0) return;
  var footnoteText = parts.join('  ');
  slide.addText(footnoteText, {
    x: MARGIN,
    y: SLIDE_H - FOOTER_H - 0.4,
    w: CONTENT_W,
    h: 0.35,
    fontSize: 8,
    fontFace: BRAND.fonts.body,
    color: '6B7280',
    valign: 'top',
    wrap: true,
  });
}

// ---------------------------------------------------------------------------
// I) CONFIDENCE & FRESHNESS UTILITIES
// ---------------------------------------------------------------------------

/**
 * Add a confidence indicator badge to a slide.
 * @param {object} slide - The pptxgenjs slide object
 * @param {object} opts - { rating: 'High'|'Medium'|'Low', x?, y?, w?, h? }
 */
function addConfidenceIndicator(slide, opts) {
  var rating = (opts && opts.rating) || 'Medium';
  var x = (opts && opts.x) || 8.0;
  var y = (opts && opts.y) || 0.15;
  var w = (opts && opts.w) || 1.5;
  var h = (opts && opts.h) || 0.3;

  var colorMap = {
    High: BRAND.colors.green,     // #2DBE8C
    Medium: BRAND.colors.blue,    // #4C7DF0
    Low: BRAND.colors.magenta,    // #C651C9
  };
  var bgColor = colorMap[rating] || BRAND.colors.blue;

  slide.addShape('rect', {
    x: x, y: y, w: w, h: h,
    fill: { color: bgColor },
    rectRadius: 0.05,
  });

  slide.addText('Confidence: ' + rating, {
    x: x, y: y, w: w, h: h,
    fontSize: 9,
    bold: true,
    color: BRAND.colors.white,
    fontFace: BRAND.fonts.body,
    align: 'center',
    valign: 'middle',
  });
}

/**
 * Add a freshness footer showing source recency.
 * @param {object} slide - The pptxgenjs slide object
 * @param {object} opts - { date: string (e.g. "February 15, 2026"), x?, y?, w?, h? }
 */
function addFreshnessFooter(slide, opts) {
  var dateStr = (opts && opts.date) || '';
  if (!dateStr) return;

  var x = (opts && opts.x) || 5.5;
  var y = (opts && opts.y) || (SLIDE_H - FOOTER_H - 0.02);
  var w = (opts && opts.w) || 4.0;
  var h = (opts && opts.h) || 0.25;

  slide.addText('Sources as of: ' + dateStr, {
    x: x, y: y, w: w, h: h,
    fontSize: 8,
    color: BRAND.colors.muted,
    fontFace: BRAND.fonts.body,
    align: 'right',
    valign: 'middle',
  });
}

// ---------------------------------------------------------------------------
// EXPORTS
// ---------------------------------------------------------------------------

module.exports = {
  BRAND: BRAND,
  SLIDE_W: SLIDE_W,
  SLIDE_H: SLIDE_H,
  MARGIN: MARGIN,
  CONTENT_W: CONTENT_W,
  FOOTER_H: FOOTER_H,

  // Master layout helpers
  createPresentation: createPresentation,
  addTitleSlide: addTitleSlide,
  addDividerSlide: addDividerSlide,
  addContentSlide: addContentSlide,
  addTableSlide: addTableSlide,
  addClosingSlide: addClosingSlide,

  // Utilities
  addFooter: addFooter,
  addCard: addCard,
  makeShadow: makeShadow,

  // Citation utilities
  parseSources: parseSources,
  extractCitations: extractCitations,
  stripCitations: stripCitations,
  addFootnoteArea: addFootnoteArea,

  // Confidence & freshness utilities
  addConfidenceIndicator: addConfidenceIndicator,
  addFreshnessFooter: addFreshnessFooter,
};
