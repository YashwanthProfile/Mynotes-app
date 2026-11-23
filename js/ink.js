// Ink geometry and rendering. All coordinates are in page units:
// a page is PAGE_W wide and PAGE_H tall, whatever its size on screen.
// Callers set the canvas transform so one unit maps to the right pixels.

export const PAGE_W = 1000;
export const PAGE_H = 1414;

export const PEN_TYPES = [
  { id: 'fountain', label: 'Fountain' },
  { id: 'ball', label: 'Ballpoint' },
  { id: 'brush', label: 'Brush' },
];
export const LINE_STYLES = [
  { id: 'solid', label: 'Solid' },
  { id: 'dash', label: 'Dashed' },
  { id: 'dot', label: 'Dotted' },
];

const NIB_X = Math.cos(-Math.PI / 4), NIB_Y = Math.sin(-Math.PI / 4);

export function computeBBox(stroke) {
  const pts = stroke.points;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < pts.length; i += 3) {
    const x = pts[i], y = pts[i + 1];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const pad = stroke.tool === 'fill' ? 1 : stroke.size * 1.2;
  stroke.bbox = [minX - pad, minY - pad, maxX + pad, maxY + pad];
  return stroke.bbox;
}

// Radius (half width) at every point, depending on the pen type.
function radii(stroke) {
  const pts = stroke.points;
  const n = pts.length / 3;
  const half = stroke.size / 2;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const p = Math.min(1, Math.max(0, pts[i * 3 + 2]));
    let f;
    switch (stroke.pen) {
      case 'ball':
        f = 0.9 + 0.2 * p;
        break;
      case 'brush': {
        f = 0.15 + 1.7 * Math.pow(p, 1.35);
        const edge = Math.min(i, n - 1 - i);
        f *= Math.min(1, (edge + 1) / 7);
        break;
      }
      case 'fountain': {
        const a = Math.max(0, i - 2), b = Math.min(n - 1, i + 2);
        let dx = pts[b * 3] - pts[a * 3], dy = pts[b * 3 + 1] - pts[a * 3 + 1];
        const len = Math.hypot(dx, dy);
        let nib = 0.8;
        if (len > 0.01) { dx /= len; dy /= len; nib = 0.35 + 0.9 * Math.abs(dx * NIB_Y - dy * NIB_X); }
        f = (0.5 + 0.7 * Math.pow(p, 0.8)) * nib;
        break;
      }
      default: // strokes from before pen types existed
        f = 0.35 + 0.9 * Math.pow(p, 0.75);
    }
    out[i] = half * f;
  }
  // light smoothing so width changes flow
  if (n > 2) {
    const s = out.slice();
    for (let i = 1; i < n - 1; i++) s[i] = (out[i - 1] + 2 * out[i] + out[i + 1]) / 4;
    return s;
  }
  return out;
}

// ---------- Pen geometry ----------
// A stroke is drawn as one filled shape: a quad between every pair of
// neighbouring samples plus round ends. Live drawing and the saved page use
// the same geometry, so nothing shifts when the Pencil lifts.

const SUB = 2.2; // longest gap (page units) between samples before curving in extra ones

// Calls emit(x, y, r) for every sample of original segments [from, to),
// adding Catmull-Rom points where the Pencil moved fast.
function forSamples(pts, R, from, to, emit) {
  const n = pts.length / 3;
  const X = (i) => pts[Math.max(0, Math.min(n - 1, i)) * 3];
  const Y = (i) => pts[Math.max(0, Math.min(n - 1, i)) * 3 + 1];
  for (let i = from; i < to; i++) {
    const x0 = X(i), y0 = Y(i), x1 = X(i + 1), y1 = Y(i + 1);
    const len = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.min(24, Math.max(1, Math.ceil(len / SUB)));
    const xa = X(i - 1), ya = Y(i - 1), xb = X(i + 2), yb = Y(i + 2);
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      if (k === 0) { emit(x0, y0, R[i]); continue; }
      const t2 = t * t, t3 = t2 * t;
      const x = 0.5 * (2 * x0 + (-xa + x1) * t + (2 * xa - 5 * x0 + 4 * x1 - xb) * t2 + (-xa + 3 * x0 - 3 * x1 + xb) * t3);
      const y = 0.5 * (2 * y0 + (-ya + y1) * t + (2 * ya - 5 * y0 + 4 * y1 - yb) * t2 + (-ya + 3 * y0 - 3 * y1 + yb) * t3);
      emit(x, y, R[i] + (R[i + 1] - R[i]) * t);
    }
  }
  emit(X(to), Y(to), R[Math.max(0, Math.min(to, n - 1))]);
}

// Adds the outline pieces of original segments [from, to) to the current path.
function addPenShape(ctx, pts, R, from, to) {
  const xs = [], ys = [], rs = [];
  forSamples(pts, R, from, to, (x, y, r) => {
    const m = xs.length;
    if (m && Math.abs(xs[m - 1] - x) < 0.05 && Math.abs(ys[m - 1] - y) < 0.05) { rs[m - 1] = Math.max(rs[m - 1], r); return; }
    xs.push(x); ys.push(y); rs.push(Math.max(r, 0.25));
  });
  const m = xs.length;
  if (!m) return;
  const circle = (i) => { ctx.moveTo(xs[i] + rs[i], ys[i]); ctx.arc(xs[i], ys[i], rs[i], 0, Math.PI * 2); };
  circle(0);
  if (m === 1) return;
  // Normal at each sample, averaged from its two segments so neighbouring quads share edges.
  const nx = new Float64Array(m), ny = new Float64Array(m);
  const dx = new Float64Array(m - 1), dy = new Float64Array(m - 1);
  for (let i = 0; i < m - 1; i++) {
    const ex = xs[i + 1] - xs[i], ey = ys[i + 1] - ys[i];
    const l = Math.hypot(ex, ey) || 1;
    dx[i] = ex / l; dy[i] = ey / l;
  }
  for (let i = 0; i < m; i++) {
    const a = Math.max(0, i - 1), b = Math.min(m - 2, i);
    let tx = dx[a] + dx[b], ty = dy[a] + dy[b];
    const l = Math.hypot(tx, ty);
    if (l < 0.3) { tx = dx[b]; ty = dy[b]; } else { tx /= l; ty /= l; }
    nx[i] = -ty; ny[i] = tx;
    // Sharp turns pinch the averaged normal, so a round joint fills them in.
    if (i > 0 && i < m - 1 && dx[i - 1] * dx[i] + dy[i - 1] * dy[i] < 0.8) circle(i);
  }
  for (let i = 0; i < m - 1; i++) {
    const ax = xs[i] + nx[i] * rs[i], ay = ys[i] + ny[i] * rs[i];
    const bx = xs[i + 1] + nx[i + 1] * rs[i + 1], by = ys[i + 1] + ny[i + 1] * rs[i + 1];
    const cx = xs[i + 1] - nx[i + 1] * rs[i + 1], cy = ys[i + 1] - ny[i + 1] * rs[i + 1];
    const qx = xs[i] - nx[i] * rs[i], qy = ys[i] - ny[i] * rs[i];
    // Same winding as arc() so the nonzero fill joins everything into one shape.
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    ctx.moveTo(ax, ay);
    if (area >= 0) { ctx.lineTo(bx, by); ctx.lineTo(cx, cy); ctx.lineTo(qx, qy); }
    else { ctx.lineTo(qx, qy); ctx.lineTo(cx, cy); ctx.lineTo(bx, by); }
    ctx.closePath();
  }
  circle(m - 1);
}

function linePath(ctx, pts) {
  const n = pts.length / 3;
  ctx.moveTo(pts[0], pts[1]);
  if (n === 1) { ctx.lineTo(pts[0] + 0.01, pts[1]); return; }
  for (let i = 1; i < n - 1; i++) {
    const x = pts[i * 3], y = pts[i * 3 + 1];
    ctx.quadraticCurveTo(x, y, (x + pts[(i + 1) * 3]) / 2, (y + pts[(i + 1) * 3 + 1]) / 2);
  }
  ctx.lineTo(pts[(n - 1) * 3], pts[(n - 1) * 3 + 1]);
}

export const isSolidPen = (s) => s.tool === 'pen' && s.dash !== 'dash' && s.dash !== 'dot';
export function strokeRadii(stroke) { return radii(stroke); }
// How many trailing points can still change shape as more points arrive.
export function liveLag(stroke) { return stroke.pen === 'brush' ? 8 : 4; }

// Draws original segments [from, to) of a solid pen stroke (used while writing).
export function drawPenRange(ctx, stroke, R, from, to) {
  ctx.fillStyle = stroke.color;
  ctx.beginPath();
  addPenShape(ctx, stroke.points, R, from, to);
  ctx.fill('nonzero');
}

function fillPath(ctx, stroke) {
  const pts = stroke.points;
  const lens = stroke.loops || [pts.length / 3];
  let o = 0;
  for (const len of lens) {
    for (let i = 0; i < len; i++) {
      const x = pts[(o + i) * 3], y = pts[(o + i) * 3 + 1];
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    o += len;
  }
}

export function setDash(ctx, stroke) {
  ctx.setLineDash(stroke.dash === 'dash' ? [stroke.size * 3.2, stroke.size * 2.6] : [0.001, stroke.size * 2.2]);
}

export function drawStroke(ctx, stroke, color) {
  if (!stroke.points.length) return;
  const c = color || stroke.color;
  ctx.save();
  if (stroke.tool === 'fill') {
    ctx.fillStyle = c;
    ctx.beginPath();
    fillPath(ctx, stroke);
    ctx.fill('evenodd');
  } else if (stroke.tool === 'highlighter') {
    if (!color) { ctx.globalAlpha = 0.38; ctx.globalCompositeOperation = 'multiply'; }
    ctx.strokeStyle = c;
    ctx.lineWidth = stroke.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    linePath(ctx, stroke.points);
    ctx.stroke();
  } else if (stroke.dash === 'dash' || stroke.dash === 'dot') {
    ctx.strokeStyle = c;
    ctx.lineWidth = stroke.size * 0.9;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (!color) setDash(ctx, stroke);
    ctx.beginPath();
    linePath(ctx, stroke.points);
    ctx.stroke();
  } else {
    ctx.fillStyle = c;
    ctx.beginPath();
    addPenShape(ctx, stroke.points, radii(stroke), 0, Math.max(0, stroke.points.length / 3 - 1));
    ctx.fill('nonzero');
  }
  ctx.restore();
}

// Fills sit at the bottom, then highlighters, then pen ink, so writing stays crisp.
export function drawStrokes(ctx, strokes, clip) {
  const visible = clip ? strokes.filter((s) => {
    const b = s.bbox || computeBBox(s);
    return !(b[2] < clip[0] || b[0] > clip[2] || b[3] < clip[1] || b[1] > clip[3]);
  }) : strokes;
  for (const s of visible) if (s.tool === 'fill') drawStroke(ctx, s);
  for (const s of visible) if (s.tool === 'highlighter') drawStroke(ctx, s);
  for (const s of visible) if (s.tool !== 'highlighter' && s.tool !== 'fill') drawStroke(ctx, s);
}

function distToSegmentSq(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  let t = len ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx - px, cy = ay + t * dy - py;
  return cx * cx + cy * cy;
}

export function hitStroke(stroke, x, y, radius) {
  const b = stroke.bbox || computeBBox(stroke);
  if (x < b[0] - radius || x > b[2] + radius || y < b[1] - radius || y > b[3] + radius) return false;
  const pts = stroke.points;
  if (stroke.tool === 'fill') return pointInFill(stroke, x, y);
  const r = radius + stroke.size / 2;
  const r2 = r * r;
  const n = pts.length / 3;
  if (n === 1) return (pts[0] - x) ** 2 + (pts[1] - y) ** 2 <= r2;
  for (let i = 0; i < n - 1; i++) {
    if (distToSegmentSq(x, y, pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 3], pts[i * 3 + 4]) <= r2) return true;
  }
  return false;
}

export function pointInFill(stroke, x, y) {
  const pts = stroke.points;
  const lens = stroke.loops || [pts.length / 3];
  let inside = false, o = 0;
  for (const len of lens) {
    for (let i = 0, j = len - 1; i < len; j = i++) {
      const xi = pts[(o + i) * 3], yi = pts[(o + i) * 3 + 1], xj = pts[(o + j) * 3], yj = pts[(o + j) * 3 + 1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    o += len;
  }
  return inside;
}

// ---------- Laser pointer ----------
// trail = [{x, y, t}] in screen pixels. The line thins away from its tail
// and is drawn as three soft layers (glow, red body, bright core).
export const LASER_LIFE = 650;
const LASER_LAYERS = [
  { r: 7.5, color: 'rgba(255,40,30,0.22)' },
  { r: 3.4, color: 'rgba(255,50,40,0.95)' },
  { r: 1.3, color: 'rgba(255,236,230,1)' },
];
export function drawLaser(ctx, trail, now, pressing) {
  const n = trail.length;
  if (!n) return null;
  const xs = [], ys = [], fs = [];
  for (let i = 0; i < n; i++) {
    const f = 1 - (now - trail[i].t) / LASER_LIFE;
    xs.push(trail[i].x); ys.push(trail[i].y); fs.push(Math.max(0, f));
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    if (xs[i] < minX) minX = xs[i]; if (xs[i] > maxX) maxX = xs[i];
    if (ys[i] < minY) minY = ys[i]; if (ys[i] > maxY) maxY = ys[i];
  }
  const pts = [];
  for (let i = 0; i < n; i++) pts.push(xs[i], ys[i], 0);
  for (const L of LASER_LAYERS) {
    // Ease so the trail stays full for most of its life and then narrows quickly.
    const R = fs.map((f) => L.r * Math.sqrt(f));
    if (n > 1) {
      ctx.fillStyle = L.color;
      ctx.beginPath();
      addPenShape(ctx, pts, R, 0, n - 1);
      ctx.fill('nonzero');
    }
  }
  const last = trail[n - 1];
  const head = pressing ? 1 : fs[n - 1];
  if (head > 0) {
    const g = ctx.createRadialGradient(last.x, last.y, 0, last.x, last.y, 14);
    g.addColorStop(0, `rgba(255,245,240,${head})`);
    g.addColorStop(0.25, `rgba(255,60,45,${0.95 * head})`);
    g.addColorStop(1, 'rgba(255,40,30,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(last.x, last.y, 14, 0, Math.PI * 2);
    ctx.fill();
  }
  return [minX - 16, minY - 16, maxX + 16, maxY + 16];
}

export function drawLaserDot(ctx, x, y, alpha) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, 18);
  g.addColorStop(0, `rgba(255,250,248,${alpha})`);
  g.addColorStop(0.18, `rgba(255,70,55,${alpha})`);
  g.addColorStop(0.45, `rgba(255,40,30,${0.35 * alpha})`);
  g.addColorStop(1, 'rgba(255,40,30,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, 18, 0, Math.PI * 2);
  ctx.fill();
  return [x - 20, y - 20, x + 20, y + 20];
}
