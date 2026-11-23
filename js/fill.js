// Colour fill: finds the closed area around a tapped point and returns it as
// outline loops (page units), so the fill stays sharp at any zoom.
import { PAGE_W, PAGE_H, drawStroke } from './ink.js';

const K = 2; // raster pixels per page unit (fine enough that edges hide under the ink)

export function findFillArea(strokes, x, y) {
  const W = Math.ceil(PAGE_W * K), H = Math.ceil(PAGE_H * K);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.setTransform(K, 0, 0, K, 0, 0);
  for (const s of strokes) {
    if (s.tool === 'fill' || s.tool === 'highlighter') continue;
    // Thicker and solid, so small gaps in a hand-drawn outline still close.
    const wall = { ...s, dash: 'solid', size: s.size + 0.8, pen: 'ball' };
    drawStroke(ctx, wall, '#000');
  }
  const data = ctx.getImageData(0, 0, W, H).data;
  const wall = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) wall[i] = data[i * 4 + 3] > 40 ? 1 : 0;

  const sx = Math.floor(x * K), sy = Math.floor(y * K);
  if (sx < 0 || sy < 0 || sx >= W || sy >= H || wall[sy * W + sx]) return { error: 'line' };

  // Scanline flood fill.
  const region = new Uint8Array(W * H);
  const stack = [sx, sy];
  let area = 0;
  while (stack.length) {
    const py = stack.pop(), px0 = stack.pop();
    let px = px0;
    const row = py * W;
    if (region[row + px] || wall[row + px]) continue;
    while (px > 0 && !wall[row + px - 1] && !region[row + px - 1]) px--;
    let upOpen = false, downOpen = false;
    for (; px < W && !wall[row + px] && !region[row + px]; px++) {
      region[row + px] = 1;
      area++;
      if (py > 0) {
        const free = !wall[row - W + px] && !region[row - W + px];
        if (free && !upOpen) { stack.push(px, py - 1); upOpen = true; } else if (!free) upOpen = false;
      }
      if (py < H - 1) {
        const free = !wall[row + W + px] && !region[row + W + px];
        if (free && !downOpen) { stack.push(px, py + 1); downOpen = true; } else if (!free) downOpen = false;
      }
    }
  }
  if (area > W * H * 0.8) return { error: 'open' };

  // Bounding box of the region, so the remaining passes only touch that area.
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let py = 0; py < H; py++) {
    const row = py * W;
    for (let px = 0; px < W; px++) if (region[row + px]) { if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py; }
  }
  const PAD = 4;
  x0 = Math.max(0, x0 - PAD); y0 = Math.max(0, y0 - PAD);
  x1 = Math.min(W - 1, x1 + PAD); y1 = Math.min(H - 1, y1 + PAD);
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  let grown = new Uint8Array(bw * bh);
  for (let py = 0; py < bh; py++) for (let px = 0; px < bw; px++) grown[py * bw + px] = region[(py + y0) * W + px + x0];
  // Grow about one page unit so the fill tucks under the ink, but only into
  // ink pixels, never past the outline.
  for (let pass = 0; pass < 3; pass++) {
    const src = grown;
    grown = src.slice();
    for (let py = 0; py < bh; py++) {
      for (let px = 0; px < bw; px++) {
        const i = py * bw + px;
        if (src[i] || !wall[(py + y0) * W + px + x0]) continue;
        if ((px > 0 && src[i - 1]) || (px < bw - 1 && src[i + 1]) || (py > 0 && src[i - bw]) || (py < bh - 1 && src[i + bw])) grown[i] = 1;
      }
    }
  }
  const loops = traceLoops(grown, bw, bh)
    .map((l) => smoothLoop(simplifyLoop(l, 0.8)))
    .filter((l) => l.length >= 3 && Math.abs(loopArea(l)) > 30);
  if (!loops.length) return { error: 'open' };
  const points = [];
  const lens = [];
  for (const l of loops) {
    lens.push(l.length);
    for (const [px, py] of l) points.push(Math.round(((px + x0) / K) * 10) / 10, Math.round(((py + y0) / K) * 10) / 10, 1);
  }
  return { points, loops: lens };
}

// Marching squares over the mask; returns closed loops of [x, y] in pixel units.
function traceLoops(mask, W, H) {
  const at = (x, y) => (x >= 0 && y >= 0 && x < W && y < H ? mask[y * W + x] : 0);
  // Directed edges with the region on the left, keyed by start point.
  const next = new Map();
  const key = (x, y) => x * 8192 + y;
  const add = (x0, y0, x1, y1) => {
    const k = key(x0, y0);
    const list = next.get(k);
    if (list) list.push([x1, y1]); else next.set(k, [[x1, y1]]);
  };
  // Pixel edges between region and outside, as unit steps along pixel borders
  // (coordinates doubled so midpoints stay integers).
  for (let y = 0; y <= H; y++) {
    for (let x = 0; x <= W; x++) {
      const cur = at(x, y);
      if (cur !== at(x, y - 1)) {
        // horizontal border at top of pixel (x, y)
        if (cur) add(x * 2 + 2, y * 2, x * 2, y * 2); else add(x * 2, y * 2, x * 2 + 2, y * 2);
      }
      if (cur !== at(x - 1, y)) {
        // vertical border at left of pixel (x, y)
        if (cur) add(x * 2, y * 2, x * 2, y * 2 + 2); else add(x * 2, y * 2 + 2, x * 2, y * 2);
      }
    }
  }
  const loops = [];
  for (const [k0, list0] of next) {
    while (list0.length) {
      const loop = [];
      let kx = Math.floor(k0 / 8192), ky = k0 % 8192;
      const sxk = kx, syk = ky;
      let guard = 0;
      do {
        loop.push([kx / 2, ky / 2]);
        const list = next.get(key(kx, ky));
        if (!list || !list.length) break;
        const [nx, ny] = list.pop();
        kx = nx; ky = ny;
      } while ((kx !== sxk || ky !== syk) && ++guard < 2000000);
      if (loop.length > 2) loops.push(loop);
    }
  }
  return loops;
}

function loopArea(l) {
  let a = 0;
  for (let i = 0, j = l.length - 1; i < l.length; j = i++) a += (l[j][0] + l[i][0]) * (l[j][1] - l[i][1]);
  return a / 2;
}

function simplifyLoop(l, eps) {
  if (l.length < 8) return l;
  const pts = l.concat([l[0]]);
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop();
    const [ax, ay] = pts[lo], [bx, by] = pts[hi];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy);
    let best = -1, bestD = 0;
    for (let i = lo + 1; i < hi; i++) {
      const d = len < 1e-9 ? Math.hypot(pts[i][0] - ax, pts[i][1] - ay) : Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best > 0 && bestD > eps) { keep[best] = 1; stack.push([lo, best], [best, hi]); }
  }
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

// One round of Chaikin corner cutting: removes the pixel staircase.
function smoothLoop(l) {
  if (l.length < 4) return l;
  const out = [];
  for (let i = 0; i < l.length; i++) {
    const a = l[i], b = l[(i + 1) % l.length];
    out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
  }
  return out;
}
