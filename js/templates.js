// Page templates and paper colours.
// Patterns are drawn as vector art in page units (1000 x 1414), so lines and
// dots keep the same look and the same gaps at every zoom level, and the very
// same geometry is used for export.
const PAGE_W = 1000, PAGE_H = 1414;

export const TEMPLATES = [
  { id: 'blank', label: 'Blank' },
  { id: 'lined', label: 'Ruled' },
  { id: 'plain', label: 'Lines' },
  { id: 'grid', label: 'Grid' },
  { id: 'dotted', label: 'Dots' },
  { id: 'cornell', label: 'Cornell' },
];

export const SPACINGS = [
  { id: 's', label: 'Small' },
  { id: 'm', label: 'Medium' },
  { id: 'l', label: 'Large' },
];

// Gaps in page units (1 unit is about 0.21 mm on A4).
const GAPS = {
  lined: { s: 30, m: 36, l: 44 },
  plain: { s: 30, m: 36, l: 44 },
  cornell: { s: 30, m: 36, l: 44 },
  grid: { s: 19, m: 24, l: 33 },
  dotted: { s: 19, m: 24, l: 33 },
};

const LINE = '#d6deea';
const MARGIN = '#f0cdc9';
const DOT = '#bfc7d3';
const RULE = '#b9c6d8';

export const PAPER_COLORS = [
  { id: 'cream', label: 'Cream', value: '#fffdf8' },
  { id: 'white', label: 'White', value: '#ffffff' },
  { id: 'yellow', label: 'Yellow', value: '#fdf5d3' },
  { id: 'gray', label: 'Grey', value: '#f1f1ef' },
];

export function paperColorValue(id) {
  const c = PAPER_COLORS.find((x) => x.id === id);
  return c ? c.value : PAPER_COLORS[0].value;
}

// Old pages used 'narrow' for tight ruling.
export function normPaper(page) {
  let paper = page.paper || 'blank';
  let spacing = page.spacing || 'm';
  if (paper === 'narrow') { paper = 'lined'; if (!page.spacing) spacing = 's'; }
  return { paper, spacing };
}

export function hasSpacing(paper) {
  return !!GAPS[paper === 'narrow' ? 'lined' : paper];
}

// Geometry of a template: straight lines and dots, in page units.
function geometry(paper, spacing) {
  const g = GAPS[paper] ? GAPS[paper][spacing] || GAPS[paper].m : 0;
  const lines = []; // [x1, y1, x2, y2, colour, width]
  let dots = null;
  if (paper === 'lined' || paper === 'plain' || paper === 'cornell') {
    const top = paper === 'cornell' ? 150 : 110;
    const bottom = paper === 'cornell' ? 1130 : PAGE_H - 40;
    const left = paper === 'cornell' ? 260 : 0;
    for (let y = top; y <= bottom; y += g) lines.push([left, y, PAGE_W, y, LINE, 1.2]);
    if (paper === 'lined') lines.push([112, 0, 112, PAGE_H, MARGIN, 1.2]);
    if (paper === 'cornell') {
      lines.push([0, 120, PAGE_W, 120, RULE, 1.6]);
      lines.push([260, 120, 260, 1150, RULE, 1.6]);
      lines.push([0, 1150, PAGE_W, 1150, RULE, 1.6]);
    }
  } else if (paper === 'grid') {
    const ox = (PAGE_W % g) / 2, oy = (PAGE_H % g) / 2;
    for (let x = ox; x <= PAGE_W; x += g) lines.push([x, 0, x, PAGE_H, LINE, 1]);
    for (let y = oy; y <= PAGE_H; y += g) lines.push([0, y, PAGE_W, y, LINE, 1]);
  } else if (paper === 'dotted') {
    const ox = (PAGE_W % g) / 2 || g / 2, oy = (PAGE_H % g) / 2 || g / 2;
    const pts = [];
    for (let y = oy; y < PAGE_H; y += g) for (let x = ox; x < PAGE_W; x += g) pts.push(x, y);
    dots = { pts, r: spacing === 'l' ? 1.7 : 1.45, color: DOT };
  }
  return { lines, dots };
}

const svgCache = new Map();
function svgUrl(paper, spacing, weight = 1) {
  const key = paper + spacing + weight;
  if (svgCache.has(key)) return svgCache.get(key);
  const { lines, dots } = geometry(paper, spacing);
  const r = (n) => Math.round(n * 100) / 100;
  let body = '';
  const byStyle = new Map();
  for (const [x1, y1, x2, y2, c, w] of lines) {
    const k = c + '|' + w;
    byStyle.set(k, (byStyle.get(k) || '') + `M${r(x1)} ${r(y1)}L${r(x2)} ${r(y2)}`);
  }
  for (const [k, d] of byStyle) {
    const [c, w] = k.split('|');
    body += `<path d="${d}" stroke="${c}" stroke-width="${w * weight}" fill="none"/>`;
  }
  if (dots) {
    let d = '';
    for (let i = 0; i < dots.pts.length; i += 2) d += `M${r(dots.pts[i])} ${r(dots.pts[i + 1])}h0`;
    body += `<path d="${d}" stroke="${dots.color}" stroke-width="${dots.r * 2 * Math.min(weight, 2.2)}" stroke-linecap="round" fill="none"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PAGE_W} ${PAGE_H}" preserveAspectRatio="none">${body}</svg>`;
  const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  svgCache.set(key, url);
  return url;
}

// Applies the paper to an element (page, thumbnail or swatch).
// weight > 1 thickens lines for tiny previews.
export function applyPaper(el, page, notebook, weight = 1) {
  if (page.kind === 'cover') {
    el.dataset.paper = 'cover';
    el.style.backgroundColor = notebook.cover;
    el.style.backgroundImage = '';
    el.style.backgroundSize = '';
    return;
  }
  const { paper, spacing } = normPaper(page);
  el.dataset.paper = paper;
  el.style.backgroundColor = paperColorValue(page.paperColor);
  el.style.backgroundImage = hasSpacing(paper) ? svgUrl(paper, spacing, weight) : 'none';
  el.style.backgroundSize = '100% 100%';
  el.style.backgroundRepeat = 'no-repeat';
}

// Draws paper colour and pattern on a canvas already scaled to page units.
export function drawPaper(ctx, page, notebook) {
  if (page.kind === 'cover') {
    ctx.fillStyle = notebook.cover;
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    return;
  }
  const { paper, spacing } = normPaper(page);
  ctx.fillStyle = paperColorValue(page.paperColor);
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  const { lines, dots } = geometry(paper, spacing);
  ctx.save();
  for (const [x1, y1, x2, y2, c, w] of lines) {
    ctx.strokeStyle = c; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
  if (dots) {
    ctx.fillStyle = dots.color;
    ctx.beginPath();
    for (let i = 0; i < dots.pts.length; i += 2) {
      ctx.moveTo(dots.pts[i] + dots.r, dots.pts[i + 1]);
      ctx.arc(dots.pts[i], dots.pts[i + 1], dots.r, 0, Math.PI * 2);
    }
    ctx.fill();
  }
  ctx.restore();
}
