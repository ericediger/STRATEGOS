# STRATEGOS Brand Configuration

## Theme Colors

All hex values are 6-char, no `#` prefix.

| Token | Name | Hex | Usage |
|-------|------|-----|-------|
| dk1 | Dark Grey | `3B3F4A` | Dark theme base |
| Primary text | Near-black | `1E2230` | Body text, default document font color |
| Blue accent | Blue | `4C7DF0` | Cover category line, cover tagline, accent shapes |
| Green accent | Green | `2DBE8C` | Cover title, cover subtitle, callout box left+top border, positive indicators |
| Magenta | Magenta | `C651C9` | Callouts, warnings, highlight boxes |
| Dark blue | Dark Blue | `1C2340` | Deep accent, dark slide backgrounds, footer bars |
| Navy | Navy | `242B55` | H1 headings, table header fill |
| Medium blue | Medium Blue | `3A55B4` | H2 headings |
| Violet | Violet | `7A4FC0` | H3 headings |
| Muted | Muted Grey | `5B6275` | Page header text, page footer text |
| Card bg | Card Background | `F3F4F9` | Callout box fill, card backgrounds |
| Alt row | Alternating Row | `F8F9FD` | Odd table body rows |
| Subtle border | Subtle Border | `DFE2EC` | Callout box right+bottom border |
| White | White | `FFFFFF` | Page/slide backgrounds, even table rows, text on dark fills |

## Typography (Word Documents)

| Element | Font | Fallback | Size | Weight | Color | Spacing |
|---------|------|----------|------|--------|-------|---------|
| Cover category | Arial | Helvetica | 12pt | Bold | `4C7DF0` | charSpacing 200 |
| Cover title | Arial | Helvetica | 28pt | Bold | `2DBE8C` | |
| Cover subtitle | Arial | Helvetica | 28pt | Normal | `2DBE8C` | |
| Cover tagline | Arial | Helvetica | 14pt | Italic | `4C7DF0` | |
| H1 | Arial | | 18pt | Bold | `242B55` | before 360 / after 200 |
| H2 | Arial | | 14pt | Bold | `3A55B4` | before 280 / after 160 |
| H3 | Arial | | 12pt | Bold | `7A4FC0` | before 200 / after 120 |
| Body text | Arial | | 11pt | Normal | `1E2230` | |
| Table header | Arial | | 10pt | Bold | `FFFFFF` (on `242B55`) | |
| Table body | Arial | | 10pt | Normal | `1E2230` | |
| Header text | Arial | | 8pt | Italic | `5B6275` | |
| Footer text | Arial | | 8pt | Normal | `5B6275` | |

## Typography (PowerPoint)

| Element | Font | Size | Weight | Color |
|---------|------|------|--------|-------|
| Slide title | Arial | 36pt | Bold | `1C2340` |
| Section header | Arial | 20-24pt | Bold | `4C7DF0` |
| Body text | Arial | 14-16pt | Normal | `1E2230` |
| Caption | Arial | 10-12pt | Normal | `5B6275` |

## Logo

- File: `logo.png` (white logo, for use on dark backgrounds)
- Placement: Cover page bottom-right, slide footer, document header
- When used on light backgrounds: use Dark Blue (`1C2340`) text "STRATEGOS" as fallback

## Page Setup (Word Documents)

- Page size: US Letter (width 12240, height 15840 DXA)
- Margins: 1 inch all sides (1440 DXA)
- Header margin: 0.49 inch (708 DXA)
- Footer margin: 0.49 inch (708 DXA)
- Content width: 9360 DXA

## Cover Page (Word Documents)

Left-aligned, manual formatting. Do NOT use built-in Word cover page styles.

- **Category line:** Arial 12pt bold `4C7DF0`, charSpacing 200 (e.g. "STRATEGIC ADVISORY")
- **Title:** Arial 28pt bold `2DBE8C`
- **Subtitle:** Arial 28pt normal `2DBE8C`
- **Tagline:** Arial 14pt italic `4C7DF0`

## Headers & Footers (Word Documents)

- **Header:** Right-aligned, 8pt italic `5B6275`, text: "STRATEGOS: {{PROJECT_TITLE}}  |  CONFIDENTIAL"
- **Footer:** Centered, 8pt `5B6275`, text: "Page [n]"

## Table Styling (Word Documents)

Borderless with alternating row shading. Full width 9360 DXA.

- Header row: fill `242B55`, text `FFFFFF` 10pt bold, vAlign center
- Odd body rows: fill `F8F9FD`, text `1E2230` 10pt
- Even body rows: fill `FFFFFF`, text `1E2230` 10pt
- Borders: all none
- Cell margins: top/bottom 80 DXA, left/right 120 DXA

## Callout Box (Word Documents)

Single-cell table used for key insights and highlights.

- Width: 9360 DXA (full content width)
- Fill: `F3F4F9`
- Left + top border: 4pt solid `2DBE8C`
- Right + bottom border: 2pt solid `DFE2EC`
- Padding: top/bottom 120 DXA, left/right 200 DXA

## Bullet Lists (Word Documents)

- Level 0: Filled circle
- Level 1: Open circle

## Page Layout (PowerPoint)

- Layout: 16:9 (10" x 5.625")
- Slide margins: 0.5" minimum from all edges
- Content block gaps: 0.3-0.5"
- Title area: top 0.5-1.0"

## Document Structure (Word Documents)

1. Cover page (left-aligned, manual formatting per spec above)
2. Table of contents (auto-generated from heading styles)
3. Content sections (page break before each H1)
4. Headers: right-aligned, "STRATEGOS: {{PROJECT_TITLE}}  |  CONFIDENTIAL"
5. Footers: centered, "Page [n]"
