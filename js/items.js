// Page items: text boxes, images and sticky notes.
// Items live in page units. x, y is the top-left of the unrotated box;
// rot (radians) turns the box around its centre.
import { getBlob, putBlob, newId } from './db.js';

export const STICKY_COLORS = ['#fff1a1', '#ffc8dc', '#c6e4ff', '#cdf3c4', '#ffd9a8'];
export const TEXT_SIZES = [
  { id: 's', label: 'S', v: 22 },
  { id: 'm', label: 'M', v: 30 },
  { id: 'l', label: 'L', v: 44 },
  { id: 'xl', label: 'XL', v: 64 },
];
export const TEXT_COLORS = ['#1d1d1f', '#2456c9', '#d33a2c', '#1f8a5b', '#8a4fd6', '#ffffff'];

// ---------- Geometry ----------

// 2D affine matrix [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f
export function selectionMatrix(cx, cy, tx, ty, s, r) {
  const cos = Math.cos(r) * s, sin = Math.sin(r) * s;
  return [cos, sin, -sin, cos, cx + tx - (cos * cx - sin * cy), cy + ty - (sin * cx + cos * cy)];
}
export function applyM(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function itemCenter(it) { return [it.x + it.w / 2, it.y + it.h / 2]; }

export function itemCorners(it) {
  const [cx, cy] = itemCenter(it);
  const c = Math.cos(it.rot || 0), s = Math.sin(it.rot || 0);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
    const lx = (sx * it.w) / 2, ly = (sy * it.h) / 2;
    return [cx + lx * c - ly * s, cy + lx * s + ly * c];
  });
}

export function itemBBox(it) {
  const pts = itemCorners(it);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

// Point in the item's own (unrotated) frame, relative to its top-left.
export function toItemLocal(it, x, y) {
  const [cx, cy] = itemCenter(it);
  const c = Math.cos(-(it.rot || 0)), s = Math.sin(-(it.rot || 0));
  const dx = x - cx, dy = y - cy;
  return [dx * c - dy * s + it.w / 2, dx * s + dy * c + it.h / 2];
}

export function hitItem(it, x, y, pad = 0) {
  const [lx, ly] = toItemLocal(it, x, y);
  return lx >= -pad && ly >= -pad && lx <= it.w + pad && ly <= it.h + pad;
}

// Returns a transformed copy of the item (uniform scale + rotation + move).
export function transformItem(it, m) {
  const s = Math.hypot(m[0], m[1]);
  const r = Math.atan2(m[1], m[0]);
  const [cx, cy] = itemCenter(it);
  const [ncx, ncy] = applyM(m, cx, cy);
  const n = { ...it, w: it.w * s, h: it.h * s, rot: (it.rot || 0) + r };
  n.x = ncx - n.w / 2;
  n.y = ncy - n.h / 2;
  if (n.fontSize) n.fontSize = it.fontSize * s;
  return n;
}

// ---------- Creation ----------

export function newTextItem(x, y) {
  return { id: newId(), type: 'text', x, y, w: 420, h: 50, rot: 0, text: '', fontSize: 30, color: '#1d1d1f' };
}

export function newStickyItem(x, y) {
  return { id: newId(), type: 'sticky', x: x - 110, y: y - 110, w: 220, h: 220, rot: 0, text: '', fontSize: 24, color: STICKY_COLORS[0] };
}

// Downscales a picked image file and stores it. Returns an image item.
export async function imageItemFromFile(file, centerX, centerY, maxW) {
  const bmp = await loadBitmap(file);
  const MAX = 2048;
  const k = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
  const cw = Math.round(bmp.width * k), ch = Math.round(bmp.height * k);
  const c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  c.getContext('2d').drawImage(bmp, 0, 0, cw, ch);
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise((res) => c.toBlob(res, type, 0.9));
  const blobId = await putBlob(blob);
  const w = Math.min(maxW, cw), h = (w * ch) / cw;
  return { id: newId(), type: 'image', blobId, x: centerX - w / 2, y: centerY - h / 2, w, h, rot: 0, crop: { x: 0, y: 0, w: 1, h: 1 } };
}

function loadBitmap(file) {
  if (window.createImageBitmap) return createImageBitmap(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// ---------- Image cache ----------

const urlCache = new Map();
const imgCache = new Map();

export async function blobUrl(id) {
  if (urlCache.has(id)) return urlCache.get(id);
  const blob = await getBlob(id);
  if (!blob) return '';
  const url = URL.createObjectURL(blob);
  urlCache.set(id, url);
  return url;
}

async function loadedImage(id) {
  if (imgCache.has(id)) return imgCache.get(id);
  const url = await blobUrl(id);
  const img = await new Promise((resolve) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = url;
  });
  imgCache.set(id, img);
  return img;
}

// ---------- DOM rendering ----------

export function renderItem(it, el) {
  if (!el) {
    el = document.createElement('div');
    el.dataset.itemId = it.id;
  }
  el.className = `item item-${it.type}`;
  el.style.left = `${it.x}px`;
  el.style.top = `${it.y}px`;
  el.style.width = `${it.w}px`;
  el.style.height = it.type === 'text' ? 'auto' : `${it.h}px`;
  el.style.minHeight = it.type === 'text' ? `${it.h}px` : '';
  el.style.transform = it.rot ? `rotate(${it.rot}rad)` : '';
  if (it.type === 'text' || it.type === 'sticky') {
    let body = el.querySelector('.item-body');
    if (!body) {
      body = document.createElement('div');
      body.className = 'item-body';
      el.appendChild(body);
    }
    if (body.contentEditable !== 'true') body.textContent = it.text;
    body.style.fontSize = `${it.fontSize}px`;
    if (it.type === 'text') body.style.color = it.color;
    else el.style.background = it.color;
  } else if (it.type === 'image') {
    let img = el.querySelector('img.item-img');
    if (!img) {
      img = document.createElement('img');
      img.className = 'item-img';
      img.alt = '';
      img.draggable = false;
      el.appendChild(img);
      blobUrl(it.blobId).then((u) => { img.src = u; });
    }
    const cr = it.crop || { x: 0, y: 0, w: 1, h: 1 };
    const fw = it.w / cr.w, fh = it.h / cr.h;
    img.style.width = `${fw}px`;
    img.style.height = `${fh}px`;
    img.style.left = `${-cr.x * fw}px`;
    img.style.top = `${-cr.y * fh}px`;
  }
  return el;
}

// ---------- Canvas rendering (thumbnails, covers) ----------

function wrapLines(ctx, text, maxW) {
  const out = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      const test = line + word;
      if (ctx.measureText(test).width > maxW && line) { out.push(line); line = word.trimStart(); }
      else line = test;
    }
    out.push(line);
  }
  return out;
}

export async function drawItems(ctx, items) {
  for (const it of items || []) {
    const [cx, cy] = itemCenter(it);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(it.rot || 0);
    ctx.translate(-it.w / 2, -it.h / 2);
    if (it.type === 'image') {
      const img = await loadedImage(it.blobId);
      if (img) {
        const cr = it.crop || { x: 0, y: 0, w: 1, h: 1 };
        ctx.drawImage(img, cr.x * img.width, cr.y * img.height, cr.w * img.width, cr.h * img.height, 0, 0, it.w, it.h);
      }
    } else {
      if (it.type === 'sticky') {
        ctx.fillStyle = it.color;
        ctx.fillRect(0, 0, it.w, it.h);
      }
      const pad = it.type === 'sticky' ? 16 : 4;
      ctx.fillStyle = it.type === 'sticky' ? '#2b2b2b' : it.color;
      ctx.font = `${it.fontSize}px -apple-system, "Segoe UI", sans-serif`;
      ctx.textBaseline = 'top';
      const lines = wrapLines(ctx, it.text || '', it.w - pad * 2);
      lines.forEach((ln, i) => ctx.fillText(ln, pad, pad + i * it.fontSize * 1.3));
    }
    ctx.restore();
  }
}
