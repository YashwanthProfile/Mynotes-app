// The notebook editor: pages, Pencil input, tools, undo and saving.
import {
  getNotebook, getPages, savePage, updateNotebook, blankPage, addPageToNotebook, removePageFromNotebook, newId,
} from './db.js';
import { PAGE_W, PAGE_H, drawStroke, drawStrokes, computeBBox, hitStroke } from './ink.js';
import { getSettings, onSettingsChange } from './settings.js';
import { openMenu, confirmSheet, promptSheet, showToast, ICONS } from './ui.js';

const PALETTES = {
  pen: ['#1d1d1f', '#2456c9', '#d33a2c', '#1f8a5b', '#8a4fd6'],
  highlighter: ['#ffd93b', '#7be08a', '#ff8fc7', '#78c3ff', '#ffab4d'],
};
const SIZES = {
  pen: [2, 3.5, 6],
  highlighter: [14, 22, 34],
  eraser: [10, 22, 44],
};
const PAPER_GAP = { lined: 36, grid: 30, dotted: 30, blank: 30 };
const TOOLS_KEY = 'mynotes-tools';

const DEFAULT_TOOLS = {
  tool: 'pen',
  pen: { color: PALETTES.pen[0], size: SIZES.pen[1], custom: '#e05a00' },
  highlighter: { color: PALETTES.highlighter[0], size: SIZES.highlighter[1], custom: '#c9a0ff' },
  eraser: { size: SIZES.eraser[1] },
};

function loadTools() {
  try {
    const saved = JSON.parse(localStorage.getItem(TOOLS_KEY) || 'null');
    if (saved && saved.pen && saved.highlighter && saved.eraser) return saved;
  } catch { /* ignore */ }
  return structuredClone(DEFAULT_TOOLS);
}
function saveTools() {
  try { localStorage.setItem(TOOLS_KEY, JSON.stringify(tools)); } catch { /* ignore */ }
}

let tools = loadTools();
let els = null;
let onCloseCb = null;

// Open notebook state
let notebook = null;
let pages = new Map();      // pageId -> page record
let views = new Map();      // pageId -> { wrap, ink, live, visible, rendered }
let undoStack = [];
let redoStack = [];
let dirty = new Set();
let saveTimer = null;
let scale = 1;
let observer = null;
let active = null;          // current pointer interaction
let penSeen = false;

const dpr = () => Math.min(window.devicePixelRatio || 1, 2);

// ---------- Setup ----------

export function initEditor({ onClose }) {
  onCloseCb = onClose;
  els = {
    view: document.getElementById('notebook-view'),
    back: document.getElementById('back-btn'),
    title: document.getElementById('notebook-title'),
    pageIndicator: document.getElementById('page-indicator'),
    undo: document.getElementById('undo-btn'),
    redo: document.getElementById('redo-btn'),
    addPage: document.getElementById('add-page-btn'),
    toolbar: document.getElementById('toolbar'),
    pages: document.getElementById('pages'),
    colorInput: document.getElementById('custom-color'),
  };
  els.undo.innerHTML = ICONS.undo;
  els.redo.innerHTML = ICONS.redo;
  els.addPage.innerHTML = ICONS.addPage;

  els.back.addEventListener('click', () => onCloseCb && onCloseCb());
  els.undo.addEventListener('click', undo);
  els.redo.addEventListener('click', redo);
  els.addPage.addEventListener('click', () => addPageAfter(currentPageIndex()));
  els.title.addEventListener('click', renameNotebook);
  els.colorInput.addEventListener('input', () => {
    const t = tools.tool;
    if (t === 'eraser') return;
    tools[t].custom = els.colorInput.value;
    tools[t].color = els.colorInput.value;
    saveTools();
    renderToolbar();
  });

  const p = els.pages;
  p.addEventListener('pointerdown', onPointerDown);
  p.addEventListener('pointermove', onPointerMove);
  p.addEventListener('pointerup', onPointerUp);
  p.addEventListener('pointercancel', onPointerUp);
  // Stop the Pencil from scrolling the page while fingers still scroll.
  const stylusGuard = (e) => {
    for (const t of e.touches) {
      if (t.touchType === 'stylus') { e.preventDefault(); return; }
    }
  };
  p.addEventListener('touchstart', stylusGuard, { passive: false });
  p.addEventListener('touchmove', stylusGuard, { passive: false });
  p.addEventListener('scroll', updatePageIndicator, { passive: true });

  window.addEventListener('resize', () => { if (notebook) layout(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSaves(); });
  window.addEventListener('pagehide', flushSaves);
  document.addEventListener('keydown', (e) => {
    if (!notebook) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
    }
  });
  onSettingsChange(applyFingerMode);
  applyFingerMode();
  renderToolbar();
}

function applyFingerMode() {
  document.body.classList.toggle('finger-draw', !!getSettings().fingerDraw);
}

// ---------- Open / close ----------

export async function openEditor(notebookId) {
  await closeEditor();
  const nb = await getNotebook(notebookId);
  if (!nb) return false;
  notebook = nb;
  const list = await getPages(nb.id);
  pages = new Map(list.map((pg) => [pg.id, pg]));
  // Repair: make sure every listed page exists.
  nb.pageIds = nb.pageIds.filter((id) => pages.has(id));
  if (nb.pageIds.length === 0) {
    const pg = blankPage(nb.id, nb.paper);
    await addPageToNotebook(nb.id, pg);
    nb.pageIds.push(pg.id);
    pages.set(pg.id, pg);
  }
  for (const pg of pages.values()) for (const s of pg.strokes) if (!s.bbox) computeBBox(s);
  undoStack = [];
  redoStack = [];
  els.title.textContent = nb.title;
  buildPages();
  updateUndoButtons();
  els.pages.scrollTop = 0;
  return true;
}

export async function closeEditor() {
  if (!notebook) return;
  finishInteraction();
  await flushSaves();
  if (observer) observer.disconnect();
  observer = null;
  for (const v of views.values()) releaseCanvas(v);
  views.clear();
  els.pages.replaceChildren();
  notebook = null;
  pages.clear();
}

async function renameNotebook() {
  if (!notebook) return;
  const name = await promptSheet('Rename notebook', { value: notebook.title, placeholder: 'Untitled', okLabel: 'Rename' });
  if (!name) return;
  notebook.title = name;
  els.title.textContent = name;
  await updateNotebook(notebook.id, { title: name });
}

// ---------- Layout and rendering ----------

function pageCssWidth() {
  const avail = els.pages.clientWidth - 32;
  return Math.max(280, Math.min(avail, 920));
}

function buildPages() {
  if (observer) observer.disconnect();
  views.clear();
  els.pages.replaceChildren();
  observer = new IntersectionObserver(onIntersect, { root: els.pages, rootMargin: '800px 0px' });
  notebook.pageIds.forEach((id, i) => {
    const pg = pages.get(id);
    const wrap = document.createElement('div');
    wrap.className = 'page-wrap';
    wrap.dataset.pageId = id;
    const paper = document.createElement('div');
    paper.className = `page-paper paper-${pg.paper || 'blank'}`;
    const ink = document.createElement('canvas');
    ink.className = 'ink';
    const live = document.createElement('canvas');
    live.className = 'live';
    wrap.append(paper, ink, live);

    const footer = document.createElement('div');
    footer.className = 'page-footer';
    const label = document.createElement('span');
    label.textContent = `Page ${i + 1}`;
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'icon-btn small';
    more.innerHTML = ICONS.more;
    more.setAttribute('aria-label', `Page ${i + 1} options`);
    more.addEventListener('click', () => pageMenu(id));
    footer.append(label, more);

    els.pages.append(wrap, footer);
    views.set(id, { wrap, paper, ink, live, visible: false, rendered: false });
    observer.observe(wrap);
  });
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'add-page-tile';
  addBtn.innerHTML = `${ICONS.plus}<span>Add page</span>`;
  addBtn.addEventListener('click', () => addPageAfter(notebook.pageIds.length - 1));
  els.pages.appendChild(addBtn);
  layout();
}

function layout() {
  const w = pageCssWidth();
  scale = w / PAGE_W;
  const h = PAGE_H * scale;
  for (const [id, v] of views) {
    const pg = pages.get(id);
    v.wrap.style.width = `${w}px`;
    v.wrap.style.height = `${h}px`;
    v.wrap.style.setProperty('--gap', `${(PAPER_GAP[pg.paper] || 30) * scale}px`);
    v.rendered = false;
    if (v.visible) renderPage(id);
  }
  updatePageIndicator();
}

function onIntersect(entries) {
  for (const e of entries) {
    const id = e.target.dataset.pageId;
    const v = views.get(id);
    if (!v) continue;
    v.visible = e.isIntersecting;
    if (v.visible && !v.rendered) renderPage(id);
    if (!v.visible) releaseCanvas(v);
  }
}

function sizeCanvas(c, w, h) {
  const r = dpr();
  const pw = Math.round(w * r), ph = Math.round(h * r);
  if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
  const ctx = c.getContext('2d');
  ctx.setTransform(r, 0, 0, r, 0, 0);
  return ctx;
}

function releaseCanvas(v) {
  if (active && views.get(active.pageId) === v) return;
  v.ink.width = 0; v.ink.height = 0;
  v.live.width = 0; v.live.height = 0;
  v.rendered = false;
}

function renderPage(id) {
  const v = views.get(id);
  const pg = pages.get(id);
  if (!v || !pg) return;
  const w = PAGE_W * scale, h = PAGE_H * scale;
  const ctx = sizeCanvas(v.ink, w, h);
  ctx.clearRect(0, 0, w, h);
  drawStrokes(ctx, pg.strokes, scale);
  sizeCanvas(v.live, w, h).clearRect(0, 0, w, h);
  v.rendered = true;
}

function currentPageIndex() {
  const box = els.pages.getBoundingClientRect();
  const mid = box.top + box.height / 2;
  let best = 0, bestDist = Infinity;
  notebook.pageIds.forEach((id, i) => {
    const r = views.get(id).wrap.getBoundingClientRect();
    const d = mid < r.top ? r.top - mid : mid > r.bottom ? mid - r.bottom : 0;
    if (d < bestDist) { bestDist = d; best = i; }
  });
  return best;
}

function updatePageIndicator() {
  if (!notebook) return;
  els.pageIndicator.textContent = `${currentPageIndex() + 1} / ${notebook.pageIds.length}`;
}

// ---------- Toolbar ----------

function renderToolbar() {
  const tb = els.toolbar;
  tb.replaceChildren();
  const group = (cls) => { const g = document.createElement('div'); g.className = `tool-group ${cls}`; tb.appendChild(g); return g; };

  const toolGroup = group('tools');
  for (const t of ['pen', 'highlighter', 'eraser']) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'icon-btn tool-btn' + (tools.tool === t ? ' active' : '');
    b.innerHTML = ICONS[t];
    b.setAttribute('aria-label', t[0].toUpperCase() + t.slice(1));
    b.setAttribute('aria-pressed', String(tools.tool === t));
    b.addEventListener('click', () => { tools.tool = t; saveTools(); renderToolbar(); });
    toolGroup.appendChild(b);
  }

  const t = tools.tool;
  if (t !== 'eraser') {
    const colorGroup = group('colors');
    const all = [...PALETTES[t], tools[t].custom];
    all.forEach((c, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      const isCustom = i === all.length - 1;
      b.className = 'color-btn' + (tools[t].color === c ? ' active' : '') + (isCustom ? ' custom' : '');
      b.style.setProperty('--c', c);
      b.setAttribute('aria-label', isCustom ? 'Custom colour' : `Colour ${c}`);
      b.addEventListener('click', () => {
        if (isCustom && tools[t].color === c) {
          els.colorInput.value = c;
          els.colorInput.click();
          return;
        }
        tools[t].color = c; saveTools(); renderToolbar();
      });
      colorGroup.appendChild(b);
    });
  }

  const sizeGroup = group('sizes');
  SIZES[t].forEach((s, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'size-btn' + (tools[t].size === s ? ' active' : '');
    b.setAttribute('aria-label', ['Thin', 'Medium', 'Thick'][i]);
    const dot = document.createElement('span');
    dot.style.width = dot.style.height = `${[6, 10, 16][i]}px`;
    if (t !== 'eraser') dot.style.background = tools[t].color;
    b.appendChild(dot);
    b.addEventListener('click', () => { tools[t].size = s; saveTools(); renderToolbar(); });
    sizeGroup.appendChild(b);
  });
}

// ---------- Input ----------

function toPage(e, rect) {
  return [(e.clientX - rect.left) / scale, (e.clientY - rect.top) / scale];
}

function pressureOf(e) {
  if (e.pointerType === 'pen') return e.pressure > 0 ? e.pressure : 0.2;
  return 0.5;
}

function onPointerDown(e) {
  if (!notebook || active) return;
  const wrap = e.target.closest('.page-wrap');
  if (!wrap) return;
  if (e.pointerType === 'pen') penSeen = true;
  if (e.pointerType === 'touch' && !getSettings().fingerDraw) return; // fingers scroll
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  e.preventDefault();

  const pageId = wrap.dataset.pageId;
  const v = views.get(pageId);
  if (!v.rendered) renderPage(pageId);
  const rect = wrap.getBoundingClientRect();
  els.pages.setPointerCapture(e.pointerId);

  if (tools.tool === 'eraser') {
    active = { kind: 'erase', pointerId: e.pointerId, pageId, rect, removed: [], last: null };
    eraseAt(toPage(e, rect));
    drawEraserCursor(toPage(e, rect));
  } else {
    const cfg = tools[tools.tool];
    const stroke = { id: newId(), tool: tools.tool, color: cfg.color, size: cfg.size, points: [] };
    active = { kind: 'draw', pointerId: e.pointerId, pageId, rect, stroke, predicted: [], frame: 0 };
    addPoint(stroke, toPage(e, rect), pressureOf(e));
    scheduleLive();
  }
}

function addPoint(stroke, [x, y], p) {
  const pts = stroke.points;
  const n = pts.length;
  if (n >= 3) {
    const dx = x - pts[n - 3], dy = y - pts[n - 2];
    if (dx * dx + dy * dy < 0.36) { pts[n - 1] = Math.max(pts[n - 1], p); return; }
  }
  pts.push(Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(p * 100) / 100);
}

function onPointerMove(e) {
  if (!active || e.pointerId !== active.pointerId) return;
  e.preventDefault();
  const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
  const list = events.length ? events : [e];
  if (active.kind === 'draw') {
    for (const ev of list) addPoint(active.stroke, toPage(ev, active.rect), pressureOf(ev));
    const pred = e.getPredictedEvents ? e.getPredictedEvents() : [];
    active.predicted = pred.slice(0, 2).map((ev) => toPage(ev, active.rect));
    scheduleLive();
  } else {
    for (const ev of list) eraseAt(toPage(ev, active.rect));
    drawEraserCursor(toPage(e, active.rect));
  }
}

function onPointerUp(e) {
  if (!active || e.pointerId !== active.pointerId) return;
  finishInteraction();
}

function finishInteraction() {
  if (!active) return;
  const a = active;
  active = null;
  try { els.pages.releasePointerCapture(a.pointerId); } catch { /* ignore */ }
  const v = views.get(a.pageId);
  if (v) clearLive(v);
  const pg = pages.get(a.pageId);
  if (!pg) return;
  if (a.kind === 'draw') {
    if (a.frame) cancelAnimationFrame(a.frame);
    if (!a.stroke.points.length) return;
    computeBBox(a.stroke);
    pg.strokes.push(a.stroke);
    if (v && v.rendered) {
      if (a.stroke.tool === 'highlighter') renderPage(a.pageId);
      else drawStroke(v.ink.getContext('2d'), a.stroke, scale);
    }
    pushUndo({ type: 'add', pageId: a.pageId, stroke: a.stroke });
    markDirty(a.pageId);
  } else if (a.removed.length) {
    pushUndo({ type: 'erase', pageId: a.pageId, removed: a.removed });
    markDirty(a.pageId);
  }
}

function clearLive(v) {
  const ctx = v.live.getContext('2d');
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, v.live.width, v.live.height);
  ctx.restore();
}

function scheduleLive() {
  if (!active || active.frame) return;
  active.frame = requestAnimationFrame(() => {
    if (!active || active.kind !== 'draw') return;
    active.frame = 0;
    const v = views.get(active.pageId);
    clearLive(v);
    const s = active.stroke;
    let show = s;
    if (active.predicted.length && s.points.length) {
      const pts = s.points.slice();
      const lastP = pts[pts.length - 1];
      for (const [x, y] of active.predicted) pts.push(x, y, lastP);
      show = { ...s, points: pts };
    }
    drawStroke(v.live.getContext('2d'), show, scale);
  });
}

function eraseAt([x, y]) {
  const pg = pages.get(active.pageId);
  const r = tools.eraser.size / 2;
  // Interpolate between samples so fast swipes don't skip strokes.
  const samples = [];
  if (active.last) {
    const [lx, ly] = active.last;
    const dist = Math.hypot(x - lx, y - ly);
    const steps = Math.ceil(dist / (r * 0.8));
    for (let i = 1; i <= steps; i++) samples.push([lx + ((x - lx) * i) / steps, ly + ((y - ly) * i) / steps]);
  } else samples.push([x, y]);
  active.last = [x, y];

  let changed = false;
  for (const [sx, sy] of samples) {
    for (let i = pg.strokes.length - 1; i >= 0; i--) {
      if (hitStroke(pg.strokes[i], sx, sy, r)) {
        active.removed.push({ stroke: pg.strokes[i], index: i });
        pg.strokes.splice(i, 1);
        changed = true;
      }
    }
  }
  if (changed) renderPage(active.pageId);
}

function drawEraserCursor([x, y]) {
  const v = views.get(active.pageId);
  clearLive(v);
  const ctx = v.live.getContext('2d');
  ctx.save();
  ctx.beginPath();
  ctx.arc(x * scale, y * scale, (tools.eraser.size / 2) * scale, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(120,120,130,0.15)';
  ctx.strokeStyle = 'rgba(90,90,100,0.6)';
  ctx.lineWidth = 1;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// ---------- Undo / redo ----------

function pushUndo(op) {
  undoStack.push(op);
  if (undoStack.length > 200) undoStack.shift();
  redoStack = [];
  updateUndoButtons();
}

function updateUndoButtons() {
  els.undo.disabled = undoStack.length === 0;
  els.redo.disabled = redoStack.length === 0;
}

function applyOp(op, reverse) {
  const pg = pages.get(op.pageId);
  if (!pg) return;
  if (op.type === 'add') {
    if (reverse) pg.strokes = pg.strokes.filter((s) => s.id !== op.stroke.id);
    else pg.strokes.push(op.stroke);
  } else if (op.type === 'erase') {
    if (reverse) {
      for (let i = op.removed.length - 1; i >= 0; i--) {
        const { stroke, index } = op.removed[i];
        pg.strokes.splice(Math.min(index, pg.strokes.length), 0, stroke);
      }
    } else {
      const ids = new Set(op.removed.map((r) => r.stroke.id));
      pg.strokes = pg.strokes.filter((s) => !ids.has(s.id));
    }
  }
  const v = views.get(op.pageId);
  if (v && v.visible) renderPage(op.pageId);
  markDirty(op.pageId);
}

function undo() {
  if (active) return;
  const op = undoStack.pop();
  if (!op) return;
  applyOp(op, true);
  redoStack.push(op);
  updateUndoButtons();
}

function redo() {
  if (active) return;
  const op = redoStack.pop();
  if (!op) return;
  applyOp(op, false);
  undoStack.push(op);
  updateUndoButtons();
}

// ---------- Pages ----------

async function addPageAfter(index) {
  await flushSaves();
  const ref = pages.get(notebook.pageIds[index]) || {};
  const pg = blankPage(notebook.id, ref.paper || notebook.paper);
  await addPageToNotebook(notebook.id, pg, index + 1);
  notebook.pageIds.splice(index + 1, 0, pg.id);
  pages.set(pg.id, pg);
  buildPages();
  const v = views.get(pg.id);
  els.pages.scrollTop = v.wrap.offsetTop - 16;
  updatePageIndicator();
  showToast(`Page ${index + 2} added`);
}

function pageMenu(pageId) {
  const index = notebook.pageIds.indexOf(pageId);
  openMenu(`Page ${index + 1}`, [
    { label: 'Add page after', onClick: () => addPageAfter(index) },
    { label: 'Clear page', danger: true, onClick: () => clearPage(pageId) },
    { label: 'Delete page', danger: true, onClick: () => deletePage(pageId) },
  ]);
}

async function clearPage(pageId) {
  const pg = pages.get(pageId);
  if (!pg.strokes.length) return;
  const removed = pg.strokes.map((stroke, index) => ({ stroke, index }));
  pg.strokes = [];
  renderPage(pageId);
  pushUndo({ type: 'erase', pageId, removed });
  markDirty(pageId);
}

async function deletePage(pageId) {
  const index = notebook.pageIds.indexOf(pageId);
  const ok = await confirmSheet(`Delete page ${index + 1}?`, 'This page and its writing will be removed.');
  if (!ok) return;
  await flushSaves();
  await removePageFromNotebook(notebook.id, pageId);
  notebook.pageIds.splice(index, 1);
  pages.delete(pageId);
  undoStack = undoStack.filter((op) => op.pageId !== pageId);
  redoStack = redoStack.filter((op) => op.pageId !== pageId);
  if (notebook.pageIds.length === 0) {
    const pg = blankPage(notebook.id, notebook.paper);
    await addPageToNotebook(notebook.id, pg);
    notebook.pageIds.push(pg.id);
    pages.set(pg.id, pg);
  }
  updateUndoButtons();
  const top = els.pages.scrollTop;
  buildPages();
  els.pages.scrollTop = top;
}

// ---------- Saving ----------

function markDirty(pageId) {
  dirty.add(pageId);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSaves, 600);
}

async function flushSaves() {
  clearTimeout(saveTimer);
  if (!dirty.size || !notebook) return;
  const ids = [...dirty];
  dirty.clear();
  try {
    for (const id of ids) {
      const pg = pages.get(id);
      if (pg) await savePage(pg);
    }
    await updateNotebook(notebook.id, {});
  } catch (err) {
    ids.forEach((id) => dirty.add(id));
    showToast('Could not save. Check free space on your iPad.');
  }
}
