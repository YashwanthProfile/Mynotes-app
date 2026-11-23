// Ink geometry and rendering. All coordinates are in page units:
// a page is PAGE_W wide and PAGE_H tall, whatever its size on screen.

export const PAGE_W = 1000;
export const PAGE_H = 1414;

// Pressure -> radius factor. Keeps thin strokes visible and full pressure bold.
function pressureFactor(p) {
  const c = Math.min(1, Math.max(0, p));
  return 0.35 + 0.9 * Math.pow(c, 0.75);
}

export function computeBBox(stroke) {
  const pts = stroke.points;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < pts.length; i += 3) {
    const x = pts[i], y = pts[i + 1];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const pad = stroke.size;
  stroke.bbox = [minX - pad, minY - pad, maxX + pad, maxY + pad];
  return stroke.bbox;
}

// Builds a filled outline for a variable width pen stroke.
function penPath(ctx, pts, size, scale) {
  const n = pts.length / 3;
  if (n === 0) return;
  const X = (i) => pts[i * 3] * scale;
  const Y = (i) => pts[i * 3 + 1] * scale;
  const R = (i) => (size / 2) * pressureFactor(pts[i * 3 + 2]) * scale;

  if (n === 1 || (n === 2 && Math.hypot(X(1) - X(0), Y(1) - Y(0)) < 0.5)) {
    ctx.moveTo(X(0) + R(0), Y(0));
    ctx.arc(X(0), Y(0), Math.max(R(0), 0.6), 0, Math.PI * 2);
    return;
  }

  const left = [], right = [];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    let dx = X(b) - X(a), dy = Y(b) - Y(a);
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const r = R(i);
    left.push([X(i) - dy * r, Y(i) + dx * r]);
    right.push([X(i) + dy * r, Y(i) - dx * r]);
  }

  const curve = (arr) => {
    for (let i = 1; i < arr.length - 1; i++) {
      const mx = (arr[i][0] + arr[i + 1][0]) / 2, my = (arr[i][1] + arr[i + 1][1]) / 2;
      ctx.quadraticCurveTo(arr[i][0], arr[i][1], mx, my);
    }
    const last = arr[arr.length - 1];
    ctx.lineTo(last[0], last[1]);
  };

  // forward along the left edge
  ctx.moveTo(left[0][0], left[0][1]);
  curve(left);
  // end cap
  const e = n - 1;
  const ea = Math.atan2(left[e][1] - Y(e), left[e][0] - X(e));
  ctx.arc(X(e), Y(e), R(e), ea, ea - Math.PI, true);
  // back along the right edge
  const rev = right.slice().reverse();
  ctx.lineTo(rev[0][0], rev[0][1]);
  curve(rev);
  // start cap
  const sa = Math.atan2(right[0][1] - Y(0), right[0][0] - X(0));
  ctx.arc(X(0), Y(0), R(0), sa, sa - Math.PI, true);
  ctx.closePath();
}

function linePath(ctx, pts, scale) {
  const n = pts.length / 3;
  ctx.moveTo(pts[0] * scale, pts[1] * scale);
  if (n === 1) { ctx.lineTo(pts[0] * scale + 0.01, pts[1] * scale); return; }
  for (let i = 1; i < n - 1; i++) {
    const x = pts[i * 3] * scale, y = pts[i * 3 + 1] * scale;
    const nx = pts[(i + 1) * 3] * scale, ny = pts[(i + 1) * 3 + 1] * scale;
    ctx.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
  }
  ctx.lineTo(pts[(n - 1) * 3] * scale, pts[(n - 1) * 3 + 1] * scale);
}

export function drawStroke(ctx, stroke, scale) {
  if (!stroke.points.length) return;
  ctx.save();
  if (stroke.tool === 'highlighter') {
    ctx.globalAlpha = 0.38;
    ctx.globalCompositeOperation = 'multiply';
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.size * scale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    linePath(ctx, stroke.points, scale);
    ctx.stroke();
  } else {
    ctx.fillStyle = stroke.color;
    ctx.beginPath();
    penPath(ctx, stroke.points, stroke.size, scale);
    ctx.fill('nonzero');
  }
  ctx.restore();
}

// Highlighters sit underneath pen ink so writing stays crisp.
export function drawStrokes(ctx, strokes, scale) {
  for (const s of strokes) if (s.tool === 'highlighter') drawStroke(ctx, s, scale);
  for (const s of strokes) if (s.tool !== 'highlighter') drawStroke(ctx, s, scale);
}

function distToSegmentSq(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  let t = len ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx - px, cy = ay + t * dy - py;
  return cx * cx + cy * cy;
}

// True if the eraser circle at (x, y) touches the stroke.
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
