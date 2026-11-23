// Hold-to-snap shape recognition.
// Takes a hand-drawn stroke (flat [x, y, p, ...] in page units) and returns a
// neater version that keeps the drawing's own position, size, rotation and
// skew: a straight line, an open polyline, a triangle, a parallelogram /
// rectangle / square, a general polygon, or an ellipse / circle.

const N = 72;

function resample(pts) {
  const n = pts.length / 3;
  const src = [];
  for (let i = 0; i < n; i++) src.push([pts[i * 3], pts[i * 3 + 1]]);
  let total = 0;
  for (let i = 1; i < n; i++) total += Math.hypot(src[i][0] - src[i - 1][0], src[i][1] - src[i - 1][1]);
  if (total < 1e-6) return { out: src.slice(0, 1), total };
  const step = total / (N - 1);
  const out = [src[0]];
  let acc = 0;
  for (let i = 1; i < n; i++) {
    let [px, py] = src[i - 1];
    const [qx, qy] = src[i];
    let d = Math.hypot(qx - px, qy - py);
    while (acc + d >= step && out.length < N) {
      const t = (step - acc) / d;
      px += (qx - px) * t; py += (qy - py) * t;
      out.push([px, py]);
      d = Math.hypot(qx - px, qy - py);
      acc = 0;
    }
    acc += d;
  }
  while (out.length < N) out.push(src[n - 1]);
  return { out, total };
}

function distToSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
}

// Douglas-Peucker: indexes of the kept points.
function simplify(pts, eps, lo = 0, hi = pts.length - 1, out = null) {
  out = out || [lo];
  let best = -1, bestD = 0;
  for (let i = lo + 1; i < hi; i++) {
    const d = distToSeg(pts[i], pts[lo], pts[hi]);
    if (d > bestD) { bestD = d; best = i; }
  }
  if (bestD > eps && best > 0) { simplify(pts, eps, lo, best, out); simplify(pts, eps, best, hi, out); }
  else out.push(hi);
  return out;
}

// Least squares line through points: [cx, cy, dx, dy]
function fitLine(pts) {
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p[0]; cy += p[1]; }
  cx /= pts.length; cy /= pts.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) { const x = p[0] - cx, y = p[1] - cy; sxx += x * x; syy += y * y; sxy += x * y; }
  const a = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return [cx, cy, Math.cos(a), Math.sin(a)];
}

function intersect(l1, l2) {
  const [x1, y1, dx1, dy1] = l1, [x2, y2, dx2, dy2] = l2;
  const den = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(den) < 1e-6) return null;
  const t = ((x2 - x1) * dy2 - (y2 - y1) * dx2) / den;
  return [x1 + dx1 * t, y1 + dy1 * t];
}

function angleBetween(u, v) {
  const c = (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v) || 1);
  return Math.acos(Math.max(-1, Math.min(1, c)));
}

function polyError(pts, poly, closed) {
  let sum = 0;
  for (const p of pts) {
    let best = Infinity;
    const m = closed ? poly.length : poly.length - 1;
    for (let i = 0; i < m; i++) best = Math.min(best, distToSeg(p, poly[i], poly[(i + 1) % poly.length]));
    sum += best;
  }
  return sum / pts.length;
}

function fitEllipse(pts) {
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p[0]; cy += p[1]; }
  cx /= pts.length; cy /= pts.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) { const x = p[0] - cx, y = p[1] - cy; sxx += x * x; syy += y * y; sxy += x * y; }
  sxx /= pts.length; syy /= pts.length; sxy /= pts.length;
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const tr = sxx + syy, det = sxx * syy - sxy * sxy;
  const disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
  let a = Math.sqrt(2 * (tr / 2 + disc)), b = Math.sqrt(2 * Math.max(0, tr / 2 - disc));
  // Refine the radii: least squares fit of A u^2 + B v^2 = 1 in the axis frame.
  const c = Math.cos(ang), s = Math.sin(ang);
  let s40 = 0, s04 = 0, s22 = 0, s20 = 0, s02 = 0;
  for (const p of pts) {
    const x = p[0] - cx, y = p[1] - cy;
    const u2 = (x * c + y * s) ** 2, v2 = (-x * s + y * c) ** 2;
    s40 += u2 * u2; s04 += v2 * v2; s22 += u2 * v2; s20 += u2; s02 += v2;
  }
  const det2 = s40 * s04 - s22 * s22;
  if (Math.abs(det2) > 1e-9) {
    const A = (s20 * s04 - s02 * s22) / det2, B = (s02 * s40 - s20 * s22) / det2;
    if (A > 0 && B > 0) { a = 1 / Math.sqrt(A); b = 1 / Math.sqrt(B); }
  }
  let err = 0;
  for (const p of pts) {
    const x = p[0] - cx, y = p[1] - cy;
    const u = (x * c + y * s) / (a || 1), v = (-x * s + y * c) / (b || 1);
    const r = Math.hypot(u, v);
    err += Math.abs(r - 1) * ((a + b) / 2);
  }
  return { cx, cy, a, b, ang, err: err / pts.length };
}

function densify(poly, closed, step = 3) {
  const out = [];
  const m = closed ? poly.length : poly.length - 1;
  for (let i = 0; i < m; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const k = Math.max(1, Math.ceil(len / step));
    for (let j = 0; j < k; j++) out.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
  }
  out.push(closed ? poly[0].slice() : poly[poly.length - 1].slice());
  return out;
}

function ellipsePoints(e) {
  const out = [];
  const c = Math.cos(e.ang), s = Math.sin(e.ang);
  const steps = Math.max(48, Math.min(180, Math.round((e.a + e.b) * 0.8)));
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const x = e.a * Math.cos(t), y = e.b * Math.sin(t);
    out.push([e.cx + x * c - y * s, e.cy + x * s + y * c]);
  }
  return out;
}

// Makes near-parallelograms exact, near-rectangles square-cornered and
// near-squares equal-sided, all without changing the overall rotation.
function tidyQuad(q) {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const s01 = sub(q[1], q[0]), s32 = sub(q[2], q[3]), s03 = sub(q[3], q[0]), s12 = sub(q[2], q[1]);
  const par1 = angleBetween(s01, s32) < 0.2 && Math.abs(Math.hypot(...s01) / Math.hypot(...s32) - 1) < 0.25;
  const par2 = angleBetween(s03, s12) < 0.2 && Math.abs(Math.hypot(...s03) / Math.hypot(...s12) - 1) < 0.25;
  if (!(par1 && par2)) return { poly: q, kind: 'quad' };
  const cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, cy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
  let u = [(s01[0] + s32[0]) / 2, (s01[1] + s32[1]) / 2];
  let w = [(s03[0] + s12[0]) / 2, (s03[1] + s12[1]) / 2];
  let kind = 'parallelogram';
  if (Math.abs(angleBetween(u, w) - Math.PI / 2) < 0.16) {
    kind = 'rectangle';
    const lu = Math.hypot(...u), lw = Math.hypot(...w);
    const sign = Math.sign(u[0] * w[1] - u[1] * w[0]) || 1;
    let nl = lw;
    if (Math.abs(lu / lw - 1) < 0.12) { kind = 'square'; nl = (lu + lw) / 2; u = [(u[0] / lu) * nl, (u[1] / lu) * nl]; }
    const un = Math.hypot(...u);
    w = [(-u[1] / un) * nl * sign, (u[0] / un) * nl * sign];
  }
  const p0 = [cx - (u[0] + w[0]) / 2, cy - (u[1] + w[1]) / 2];
  return {
    kind,
    poly: [p0, [p0[0] + u[0], p0[1] + u[1]], [p0[0] + u[0] + w[0], p0[1] + u[1] + w[1]], [p0[0] + w[0], p0[1] + w[1]]],
  };
}

// Corners of a closed drawing, refined by fitting a straight line to each side.
function closedPolygon(pts, D) {
  // Start the loop at the point farthest from the centre so a corner is not split.
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p[0]; cy += p[1]; }
  cx /= pts.length; cy /= pts.length;
  let far = 0, farD = -1;
  for (let i = 0; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - cx, pts[i][1] - cy); if (d > farD) { farD = d; far = i; } }
  const loop = pts.slice(0, pts.length - 1);
  const rot = loop.slice(far).concat(loop.slice(0, far));
  rot.push(rot[0]);
  const idx = simplify(rot, D * 0.07);
  let corners = idx.slice(0, -1);
  if (corners.length < 3 || corners.length > 8) return null;
  // Fit each side and intersect neighbours.
  const lines = [];
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i], b = i + 1 < corners.length ? corners[i + 1] : rot.length - 1;
    const span = rot.slice(a, b + 1);
    const trim = Math.floor(span.length * 0.15);
    const core = span.length > 6 ? span.slice(trim, span.length - trim) : span;
    lines.push(fitLine(core));
  }
  const poly = [];
  for (let i = 0; i < lines.length; i++) {
    const p = intersect(lines[(i + lines.length - 1) % lines.length], lines[i]);
    if (!p) return null;
    poly.push(p);
  }
  // Reject corners that shot far away (nearly parallel neighbours).
  for (const p of poly) if (Math.hypot(p[0] - cx, p[1] - cy) > farD * 1.8) return null;
  return poly;
}

export function recognize(points, { lineOnly = false } = {}) {
  const n = points.length / 3;
  if (n < 4) return null;
  const { out: pts, total } = resample(points);
  if (total < 18) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
  const D = Math.hypot(maxX - minX, maxY - minY);
  const a = pts[0], b = pts[pts.length - 1];
  const chord = Math.hypot(b[0] - a[0], b[1] - a[1]);

  // Straight line
  let maxDev = 0, sumDev = 0;
  for (const p of pts) { const d = distToSeg(p, a, b); maxDev = Math.max(maxDev, d); sumDev += d; }
  if (chord > 0.7 * total && maxDev < Math.max(4, chord * 0.12) && sumDev / pts.length < Math.max(2, chord * 0.05)) {
    return { kind: 'line', points: densify([a, b], false) };
  }
  if (lineOnly) {
    // Highlighters: snap a roughly straight swipe even if it wobbles a bit more.
    if (chord > 0.6 * total && maxDev < Math.max(8, chord * 0.18)) return { kind: 'line', points: densify([a, b], false) };
    return null;
  }

  const closed = chord < Math.max(0.22 * D, 12);
  if (closed) {
    const loopPts = pts.slice();
    loopPts[loopPts.length - 1] = loopPts[0];
    const ell = fitEllipse(loopPts);
    const poly = closedPolygon(loopPts, D);
    const ellErr = ell.err / D;
    const polyErr = poly ? polyError(loopPts, poly, true) / D : Infinity;
    // Many-sided polygons can mimic an ellipse, so they must win clearly.
    const need = poly && poly.length >= 5 ? (ellErr < 0.03 ? 0.4 : 0.7) : 0.85;
    if (poly && polyErr < 0.035 && polyErr < ellErr * need) {
      let shape = { poly, kind: poly.length === 3 ? 'triangle' : 'polygon' };
      if (poly.length === 4) shape = tidyQuad(poly);
      return { kind: shape.kind, points: densify(shape.poly, true) };
    }
    if (ellErr < 0.05) {
      const e = { ...ell };
      if (Math.abs(e.a / e.b - 1) < 0.14) { e.a = e.b = (e.a + e.b) / 2; return { kind: 'circle', points: ellipsePoints(e) }; }
      return { kind: 'ellipse', points: ellipsePoints(e) };
    }
    return null;
  }

  // Open polyline: an angle, a zig-zag, or an arrow-like corner.
  const idx = simplify(pts, D * 0.06);
  if (idx.length >= 3 && idx.length <= 5) {
    const poly = idx.map((i) => pts[i]);
    if (polyError(pts, poly, false) / D < 0.025) return { kind: 'polyline', points: densify(poly, false) };
  }
  return null;
}

// Flat [x, y, p, ...] from [[x, y], ...] with one pressure.
export function toFlat(list, p) {
  const out = [];
  for (const [x, y] of list) out.push(Math.round(x * 10) / 10, Math.round(y * 10) / 10, p);
  return out;
}
