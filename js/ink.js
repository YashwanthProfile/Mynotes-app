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
  const pad = stroke.size * 1.2;
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

function penPath(ctx, stroke) {
  const pts = stroke.points;
  const n = pts.length / 3;
  if (n === 0) return;
  const R = radii(stroke);
  const X = (i) => pts[i * 3], Y = (i) => pts[i * 3 + 1];

  if (n === 1 || (n === 2 && Math.hypot(X(1) - X(0), Y(1) - Y(0)) < 0.3)) {
    const r = Math.max(R[0], 0.3);
    ctx.moveTo(X(0) + r, Y(0));
    ctx.arc(X(0), Y(0), r, 0, Math.PI * 2);
    return;
  }

  const left = [], right = [];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    let dx = X(b) - X(a), dy = Y(b) - Y(a);
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    left.push([X(i) - dy * R[i], Y(i) + dx * R[i]]);
    right.push([X(i) + dy * R[i], Y(i) - dx * R[i]]);
  }
  const curve = (arr) => {
    for (let i = 1; i < arr.length - 1; i++) {
      ctx.quadraticCurveTo(arr[i][0], arr[i][1], (arr[i][0] + arr[i + 1][0]) / 2, (arr[i][1] + arr[i + 1][1]) / 2);
    }
    const last = arr[arr.length - 1];
    ctx.lineTo(last[0], last[1]);
  };
  ctx.moveTo(left[0][0], left[0][1]);
  curve(left);
  const e = n - 1;
  const ea = Math.atan2(left[e][1] - Y(e), left[e][0] - X(e));
  ctx.arc(X(e), Y(e), Math.max(R[e], 0.01), ea, ea - Math.PI, true);
  const rev = right.slice().reverse();
  ctx.lineTo(rev[0][0], rev[0][1]);
  curve(rev);
  const sa = Math.atan2(right[0][1] - Y(0), right[0][0] - X(0));
  ctx.arc(X(0), Y(0), Math.max(R[0], 0.01), sa, sa - Math.PI, true);
  ctx.closePath();
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

export function drawStroke(ctx, stroke) {
  if (!stroke.points.length) return;
  ctx.save();
  if (stroke.tool === 'highlighter') {
    ctx.globalAlpha = 0.38;
    ctx.globalCompositeOperation = 'multiply';
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    linePath(ctx, stroke.points);
    ctx.stroke();
  } else if (stroke.dash === 'dash' || stroke.dash === 'dot') {
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.size * 0.9;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash(stroke.dash === 'dash' ? [stroke.size * 3.2, stroke.size * 2.6] : [0.001, stroke.size * 2.2]);
    ctx.beginPath();
    linePath(ctx, stroke.points);
    ctx.stroke();
  } else {
    ctx.fillStyle = stroke.color;
    ctx.beginPath();
    penPath(ctx, stroke);
    ctx.fill('nonzero');
  }
  ctx.restore();
}

// Highlighters sit underneath pen ink so writing stays crisp.
export function drawStrokes(ctx, strokes, clip) {
  const visible = clip ? strokes.filter((s) => {
    const b = s.bbox || computeBBox(s);
    return !(b[2] < clip[0] || b[0] > clip[2] || b[3] < clip[1] || b[1] > clip[3]);
  }) : strokes;
  for (const s of visible) if (s.tool === 'highlighter') drawStroke(ctx, s);
  for (const s of visible) if (s.tool !== 'highlighter') drawStroke(ctx, s);
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
  const r = radius + stroke.size / 2;
  const r2 = r * r;
  const n = pts.length / 3;
  if (n === 1) return (pts[0] - x) ** 2 + (pts[1] - y) ** 2 <= r2;
  for (let i = 0; i < n - 1; i++) {
    if (distToSegmentSq(x, y, pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 3], pts[i * 3 + 4]) <= r2) return true;
  }
  return false;
}

// Laser pointer: a glowing trail that fades out. trail = [{x, y, t}]
export const LASER_LIFE = 900;
export function drawLaser(ctx, trail, now) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const layers = [
    { w: 16, c: [255, 40, 40], a: 0.18 },
    { w: 8, c: [255, 60, 60], a: 0.45 },
    { w: 3.2, c: [255, 210, 210], a: 1 },
  ];
  // Group segments into a few age buckets so each bucket is one smooth path.
  const BUCKETS = 8;
  for (const L of layers) {
    ctx.lineWidth = L.w;
    for (let b = 0; b < BUCKETS; b++) {
      const lo = (LASER_LIFE * b) / BUCKETS, hi = (LASER_LIFE * (b + 1)) / BUCKETS;
      let started = false;
      ctx.beginPath();
      for (let i = 1; i < trail.length; i++) {
        const age = now - trail[i].t;
        if (age < lo || age >= hi) { started = false; continue; }
        if (!started) { ctx.moveTo(trail[i - 1].x, trail[i - 1].y); started = true; }
        ctx.lineTo(trail[i].x, trail[i].y);
      }
      const alpha = Math.max(0, 1 - (lo + hi) / 2 / LASER_LIFE) * L.a;
      ctx.strokeStyle = `rgba(${L.c[0]},${L.c[1]},${L.c[2]},${alpha})`;
      ctx.stroke();
    }
  }
  const last = trail[trail.length - 1];
  if (last && now - last.t < LASER_LIFE) {
    const alpha = 1 - (now - last.t) / LASER_LIFE;
    ctx.fillStyle = `rgba(255,50,50,${0.9 * alpha})`;
    ctx.shadowColor = 'rgba(255,0,0,0.8)';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(last.x, last.y, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
