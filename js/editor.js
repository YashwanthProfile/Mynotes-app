// The notebook editor: pages, zoom, Pencil input, tools, selection, items, modes, undo and saving.
import {
  getNotebook, getPages, savePage, savePages, updateNotebook, blankPage, coverPage,
  addPageToNotebook, removePageFromNotebook, newId,
} from './db.js';
import {
  PAGE_W, PAGE_H, PEN_TYPES, LINE_STYLES, drawStroke, drawStrokes, computeBBox, hitStroke, drawLaser, drawLaserDot,
  LASER_LIFE, isSolidPen, strokeRadii, liveLag, drawPenRange,
} from './ink.js';
import { recognize, toFlat } from './shapes.js';
import { findFillArea } from './fill.js';
import {
  STICKY_COLORS, TEXT_SIZES, TEXT_COLORS, selectionMatrix, applyM, itemBBox, itemCenter, hitItem, toItemLocal,
  transformItem, newTextItem, newStickyItem, imageItemFromFile, renderItem, drawItems, blobUrl,
} from './items.js';
import { TEMPLATES, PAPER_COLORS, applyPaper } from './templates.js';
import { getSettings, setSetting, onSettingsChange } from './settings.js';
import { openMenu, confirmSheet, promptSheet, showToast, ICONS } from './ui.js';

// ---------- Tool configuration ----------

// Colour grid: neutrals, then deep, standard and light rows of the same hues.
export const PALETTE = [
  '#000000', '#3a3a3c', '#6e6e73', '#aeaeb2', '#d1d1d6', '#ffffff', '#5b3a1e', '#8b5a2b', '#c8a27a',
  '#0b3d91', '#005f73', '#1b5e20', '#8d6e00', '#b34700', '#9b1c1c', '#8e1450', '#4a148c', '#1a237e',
  '#1f5bd8', '#0a9396', '#2e9e4f', '#e9b10c', '#f57c00', '#e53935', '#e91e63', '#8e44d9', '#3949ab',
  '#6ea8fe', '#64d2c8', '#8bd17c', '#ffe066', '#ffb562', '#ff8a80', '#f48fb1', '#c39bf0', '#9fa8da',
];
const SLOT_TOOLS = ['pen', 'highlighter', 'fill'];
const SIZES = {
  pen: [2, 3.5, 6],
  highlighter: [14, 22, 34],
  eraser: [10, 22, 44],
};
const ALL_TOOLS = ['lasso', 'pen', 'highlighter', 'eraser', 'fill', 'laser', 'text', 'sticky'];
const TOOL_NAMES = {
  lasso: 'Lasso select', pen: 'Pen', highlighter: 'Highlighter', eraser: 'Eraser', fill: 'Fill', laser: 'Laser pointer',
  text: 'Text', sticky: 'Sticky note', image: 'Insert image',
};
const TOOLS_KEY = 'mynotes-tools';
const DEFAULT_TOOLS = {
  tool: 'pen',
  recent: [],
  pen: { slots: ['#000000', '#1f5bd8', '#e53935'], slot: 0, color: '#000000', size: SIZES.pen[1], type: 'fountain', dash: 'solid', stab: 0 },
  highlighter: { slots: ['#ffe066', '#8bd17c', '#f48fb1'], slot: 0, color: '#ffe066', size: SIZES.highlighter[1] },
  fill: { slots: ['#6ea8fe', '#ffe066', '#ff8a80'], slot: 0, color: '#6ea8fe' },
  eraser: { size: SIZES.eraser[1] },
  laser: { mode: 'trail' },
  text: { size: 30, color: TEXT_COLORS[0] },
  sticky: { color: STICKY_COLORS[0] },
};

function loadTools() {
  const t = structuredClone(DEFAULT_TOOLS);
  try {
    const saved = JSON.parse(localStorage.getItem(TOOLS_KEY) || 'null');
    if (saved) {
      for (const k of Object.keys(DEFAULT_TOOLS)) {
        if (k !== 'tool' && saved[k] && typeof saved[k] === 'object') Object.assign(t[k], saved[k]);
      }
      if (ALL_TOOLS.includes(saved.tool)) t.tool = saved.tool;
      if (Array.isArray(saved.recent)) t.recent = saved.recent.slice(0, 9);
    }
  } catch { /* ignore */ }
  for (const k of SLOT_TOOLS) {
    const cfg = t[k];
    if (!Array.isArray(cfg.slots) || cfg.slots.length !== 3) cfg.slots = DEFAULT_TOOLS[k].slots.slice();
    cfg.slot = Math.max(0, Math.min(2, cfg.slot | 0));
    cfg.color = cfg.slots[cfg.slot];
  }
  return t;
}
function saveTools() {
  try { localStorage.setItem(TOOLS_KEY, JSON.stringify(tools)); } catch { /* ignore */ }
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 6;
const LOW_CAP = 2048;          // max pixel width of a whole-page canvas
const PAGE_GAP_TOP = 6;
const PULL_DISTANCE = 110;

let tools = loadTools();
let els = null;
let onCloseCb = null;

// ---------- Open notebook state ----------

let notebook = null;
let pages = new Map();       // pageId -> page record
let views = new Map();       // pageId -> view
let undoStack = [];
let redoStack = [];
let dirty = new Set();
let saveTimer = null;
let zoom = 1;
let scale = 1;               // CSS px per page unit
let observer = null;
let thumbObserver = null;
let thumbFilter = 'all';
let active = null;           // current pointer interaction
let mode = 'read';           // 'read' | 'edit'
let presenting = false;
let savedBeforePresent = null;
let hiTimer = null;
let pinch = null;
let pull = null;
let laserTrail = [];
let laserFrame = 0;
let laserPageId = null;
let laserUp = 0;
let sel = null;              // current selection
let clipboard = null;        // { strokes, items }
let editing = null;          // text or sticky being typed in
let cropping = null;         // image being cropped
let hiScrollTimer = null;

const dpr = () => Math.min(window.devicePixelRatio || 1, 2);
const isCover = (pg) => !!pg && pg.kind === 'cover';
const clone = (o) => JSON.parse(JSON.stringify(o));

// ---------- Setup ----------

export function initEditor({ onClose }) {
  onCloseCb = onClose;
  const $ = (id) => document.getElementById(id);
  els = {
    view: $('notebook-view'),
    back: $('back-btn'),
    thumbsBtn: $('thumbs-btn'),
    title: $('notebook-title'),
    pageIndicator: $('page-indicator'),
    undo: $('undo-btn'),
    redo: $('redo-btn'),
    modeBtn: $('mode-btn'),
    presentBtn: $('present-btn'),
    moreBtn: $('editor-more-btn'),
    toolbar: $('toolbar'),
    stage: $('stage'),
    thumbs: $('thumbs'),
    pages: $('pages'),
    inner: $('pages-inner'),
    pullHint: $('pull-hint'),
    zoomBadge: $('zoom-badge'),
    presentBar: $('present-bar'),
    popover: $('pen-popover'),
    imageInput: $('image-input'),
    wet: $('ink-wet'),
    searchBtn: $('search-btn'),
    searchPanel: $('search-panel'),
    searchInput: $('search-input'),
    searchResults: $('search-results'),
    tail: $('ink-tail'),
  };
  els.undo.innerHTML = ICONS.undo;
  els.redo.innerHTML = ICONS.redo;
  els.thumbsBtn.innerHTML = ICONS.pages;
  els.presentBtn.innerHTML = ICONS.present;
  els.moreBtn.innerHTML = ICONS.more;
  els.searchBtn.innerHTML = ICONS.search;
  els.back.innerHTML = ICONS.back;
  els.searchBtn.addEventListener('click', toggleSearch);
  els.searchInput.addEventListener('input', renderSearch);
  els.searchInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSearch(); });
  els.presentBar.addEventListener('pointerdown', () => pokePresentBar(true));

  els.back.addEventListener('click', () => onCloseCb && onCloseCb());
  els.undo.addEventListener('click', undo);
  els.redo.addEventListener('click', redo);
  els.thumbsBtn.addEventListener('click', toggleThumbs);
  els.pageIndicator.addEventListener('click', toggleThumbs);
  els.modeBtn.addEventListener('click', () => setMode(mode === 'edit' ? 'read' : 'edit'));
  els.presentBtn.addEventListener('click', enterPresent);
  els.moreBtn.addEventListener('click', notebookMenu);
  els.title.addEventListener('click', renameNotebook);
  els.imageInput.addEventListener('change', onImagePicked);

  const p = els.pages;
  p.addEventListener('pointerdown', onPointerDown);
  p.addEventListener('pointermove', onPointerMove);
  p.addEventListener('pointerup', onPointerUp);
  p.addEventListener('pointercancel', onPointerUp);
  p.addEventListener('touchstart', onTouchStart, { passive: false });
  p.addEventListener('touchmove', onTouchMove, { passive: false });
  p.addEventListener('touchend', onTouchEnd);
  p.addEventListener('touchcancel', onTouchEnd);
  p.addEventListener('scroll', onScroll, { passive: true });
  p.addEventListener('wheel', onWheel, { passive: false });
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((n) => p.addEventListener(n, (e) => e.preventDefault()));

  document.addEventListener('pointerdown', (e) => {
    if (!els.popover.hidden && !els.popover.contains(e.target) && !e.target.closest('.tool-btn, .style-btn, .sel-style')) els.popover.hidden = true;
  });
  window.addEventListener('resize', () => {
    if (!notebook) return;
    if (presenting) zoom = fitHeightZoom();
    relayout();
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSaves(); });
  window.addEventListener('pagehide', flushSaves);
  document.addEventListener('keydown', (e) => {
    if (!notebook) return;
    if (editing) { if (e.key === 'Escape') finishEditing(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
    } else if (sel && (e.key === 'Delete' || e.key === 'Backspace')) deleteSelection();
    else if (e.key === 'Escape' && presenting) exitPresent();
    else if (e.key === 'Escape' && sel) clearSelection();
    else if (presenting && ['ArrowRight', 'ArrowDown', 'PageDown'].includes(e.key)) goToPage(currentPageIndex() + 1);
    else if (presenting && ['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) goToPage(currentPageIndex() - 1);
  });
  onSettingsChange(applyFingerMode);
  onSettingsChange(() => { if (notebook) applyDarkPages(); });
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (notebook) applyDarkPages(); });
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
  nb.pageIds = nb.pageIds.filter((id) => pages.has(id));
  if (!nb.pageIds.length || !isCover(pages.get(nb.pageIds[0]))) {
    const cover = coverPage(nb.id);
    await addPageToNotebook(nb.id, cover, 0);
    nb.pageIds.unshift(cover.id);
    pages.set(cover.id, cover);
  }
  if (nb.pageIds.length < 2) {
    const pg = blankPage(nb.id, nb.paper || 'lined');
    await addPageToNotebook(nb.id, pg);
    nb.pageIds.push(pg.id);
    pages.set(pg.id, pg);
  }
  for (const pg of pages.values()) {
    if (!pg.items) pg.items = [];
    for (const s of pg.strokes) if (!s.bbox) computeBBox(s);
  }
  undoStack = [];
  redoStack = [];
  zoom = 1;
  sel = editing = cropping = null;
  els.title.textContent = nb.title;
  els.thumbs.hidden = true;
  els.thumbsBtn.classList.remove('active');
  closeSearch();
  applyDarkPages();
  setMode(getSettings().openMode === 'edit' ? 'edit' : 'read', { quiet: true });
  buildPages();
  updateUndoButtons();
  goToPage(1, { smooth: false });
  updatePageIndicator();
  return true;
}

export async function closeEditor() {
  if (!notebook) return;
  if (presenting) exitPresent();
  finishEditing();
  finishCrop(false);
  clearSelection();
  finishInteraction();
  await flushSaves();
  await updateCoverThumb();
  if (observer) observer.disconnect();
  if (thumbObserver) thumbObserver.disconnect();
  observer = thumbObserver = null;
  for (const v of views.values()) releaseCanvases(v);
  views.clear();
  els.inner.replaceChildren();
  els.thumbs.replaceChildren();
  els.popover.hidden = true;
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

function notebookMenu() {
  const idx = currentPageIndex();
  const pageId = notebook.pageIds[idx];
  const dark = darkPagesOn();
  openMenu(pageLabel(idx), [
    ...pageMenuItems(pageId),
    { sep: true },
    { icon: ICONS.template, label: 'Template for all pages', onClick: () => templateSheet(null) },
    { icon: ICONS.moon, label: dark ? 'Light pages' : 'Dark pages', onClick: () => setSetting('darkPages', dark ? 'off' : 'on') },
    { icon: ICONS.present, label: 'Present', onClick: enterPresent },
    { icon: ICONS.rename, label: 'Rename notebook', onClick: renameNotebook },
  ], els.moreBtn);
}

function darkPagesOn() {
  const d = getSettings().darkPages;
  if (d === 'on') return true;
  if (d !== 'auto') return false;
  const t = document.documentElement.dataset.theme;
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyDarkPages() {
  const on = darkPagesOn();
  els.view.classList.toggle('dark-pages', on);
  if (!els.thumbs.hidden && notebook) buildThumbs();
}

// ---------- Search ----------

function toggleSearch() {
  if (!els.searchPanel.hidden) { closeSearch(); return; }
  els.searchPanel.hidden = false;
  els.searchBtn.classList.add('active');
  els.searchInput.value = '';
  renderSearch();
  els.searchInput.focus();
}

function closeSearch() {
  els.searchPanel.hidden = true;
  els.searchBtn.classList.remove('active');
  els.searchInput.blur();
}

function renderSearch() {
  const q = els.searchInput.value.trim().toLowerCase();
  const out = els.searchResults;
  out.replaceChildren();
  if (!q) {
    const p = document.createElement('p');
    p.className = 'search-note';
    p.textContent = 'Finds typed text and sticky notes. Handwriting is not searchable yet.';
    out.appendChild(p);
    return;
  }
  let count = 0;
  notebook.pageIds.forEach((id, i) => {
    const pg = pages.get(id);
    for (const it of pg.items || []) {
      if (!it.text) continue;
      const lower = it.text.toLowerCase();
      const at = lower.indexOf(q);
      if (at < 0) continue;
      count++;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'search-hit';
      const where = document.createElement('span');
      where.className = 'search-where';
      where.textContent = pageLabel(i);
      const snip = document.createElement('span');
      snip.className = 'search-snip';
      const from = Math.max(0, at - 30);
      const pre = (from > 0 ? '…' : '') + it.text.slice(from, at);
      const mark = document.createElement('mark');
      mark.textContent = it.text.slice(at, at + q.length);
      snip.append(document.createTextNode(pre), mark, document.createTextNode(it.text.slice(at + q.length, at + q.length + 60)));
      b.append(where, snip);
      b.addEventListener('click', () => {
        goToPage(i);
        setTimeout(() => {
          const el = itemEl(id, it.id);
          if (el) { el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600); }
        }, 350);
      });
      out.appendChild(b);
    }
  });
  if (!count) {
    const p = document.createElement('p');
    p.className = 'search-note';
    p.textContent = 'No matches.';
    out.appendChild(p);
  }
}

// ---------- Presentation bar ----------
// The bar fades away while presenting so the audience only sees the page.
// A finger tap brings it back for a few seconds.

let presentBarTimer = 0;
function pokePresentBar(show = true) {
  if (!presenting) return;
  if (show) els.presentBar.classList.remove('faded');
  clearTimeout(presentBarTimer);
  presentBarTimer = setTimeout(hidePresentBar, 2600);
}
function hidePresentBar() {
  clearTimeout(presentBarTimer);
  els.presentBar.classList.add('faded');
}

// ---------- Modes ----------

function setMode(m, { quiet = false } = {}) {
  mode = m;
  const editingMode = mode === 'edit';
  els.view.classList.toggle('mode-edit', editingMode);
  els.view.classList.toggle('mode-read', !editingMode);
  els.modeBtn.innerHTML = `${ICONS.edit}<span>${editingMode ? 'Done' : 'Edit'}</span>`;
  els.modeBtn.classList.toggle('active', editingMode);
  els.modeBtn.setAttribute('aria-pressed', String(editingMode));
  els.popover.hidden = true;
  if (!editingMode) {
    finishInteraction();
    finishEditing();
    finishCrop(false);
    clearSelection();
  }
  if (!quiet) showToast(editingMode ? 'Editing' : 'Read only');
  if (notebook) requestAnimationFrame(() => relayout());
}

function enterPresent() {
  if (presenting || !notebook) return;
  finishEditing();
  finishCrop(false);
  clearSelection();
  savedBeforePresent = { zoom, mode, thumbs: !els.thumbs.hidden, tool: tools.tool };
  const idx = currentPageIndex();
  presenting = true;
  els.thumbs.hidden = true;
  document.body.classList.add('presenting');
  mode = 'edit';
  els.view.classList.add('mode-edit');
  els.view.classList.remove('mode-read');
  if (!['pen', 'highlighter', 'laser', 'eraser'].includes(tools.tool)) tools.tool = 'laser';
  renderToolbar();
  renderPresentBar();
  els.presentBar.hidden = false;
  closeSearch();
  pokePresentBar(true);
  showToast('Tap with a finger to show the tools');
  try {
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req && !(document.fullscreenElement || document.webkitFullscreenElement)) {
      const r = req.call(el);
      if (r && r.catch) r.catch(() => {});
    }
  } catch { /* not supported */ }
  requestAnimationFrame(() => {
    zoom = fitHeightZoom();
    relayout({ keepIndex: idx });
  });
}

function exitPresent() {
  if (!presenting) return;
  const idx = currentPageIndex();
  presenting = false;
  document.body.classList.remove('presenting');
  els.presentBar.hidden = true;
  els.presentBar.classList.remove('faded');
  clearTimeout(presentBarTimer);
  zoom = savedBeforePresent ? savedBeforePresent.zoom : 1;
  if (savedBeforePresent) { tools.tool = savedBeforePresent.tool; renderToolbar(); }
  setMode(savedBeforePresent ? savedBeforePresent.mode : 'read', { quiet: true });
  if (savedBeforePresent && savedBeforePresent.thumbs) { els.thumbs.hidden = false; buildThumbs(); }
  try {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if ((document.fullscreenElement || document.webkitFullscreenElement) && exit) exit.call(document);
  } catch { /* ignore */ }
  requestAnimationFrame(() => relayout({ keepIndex: idx }));
}

function renderPresentBar() {
  const bar = els.presentBar;
  bar.replaceChildren();
  const btn = (icon, label, onClick, on) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'icon-btn' + (on ? ' active' : '');
    b.innerHTML = icon;
    b.setAttribute('aria-label', label);
    b.addEventListener('click', onClick);
    bar.appendChild(b);
    return b;
  };
  const sep = () => { const s = document.createElement('span'); s.className = 'bar-sep'; bar.appendChild(s); };
  for (const t of ['pen', 'highlighter', 'laser', 'eraser']) {
    btn(ICONS[t], TOOL_NAMES[t], () => { tools.tool = t; saveTools(); renderToolbar(); renderPresentBar(); }, tools.tool === t);
  }
  if (tools.tool === 'laser') {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'bar-chip';
    chip.textContent = tools.laser.mode === 'dot' ? 'Dot' : 'Trail';
    chip.setAttribute('aria-label', 'Switch laser between trail and dot');
    chip.addEventListener('click', () => {
      tools.laser.mode = tools.laser.mode === 'dot' ? 'trail' : 'dot';
      saveTools(); renderToolbar(); renderPresentBar();
    });
    bar.appendChild(chip);
  }
  sep();
  tools.pen.slots.forEach((c, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'color-btn' + (tools.pen.slot === i && tools.tool === 'pen' ? ' active' : '');
    b.style.setProperty('--c', c);
    b.setAttribute('aria-label', `Pen colour ${c}`);
    b.addEventListener('click', () => { tools.pen.slot = i; tools.pen.color = c; tools.tool = 'pen'; saveTools(); renderToolbar(); renderPresentBar(); });
    bar.appendChild(b);
  });
  sep();
  btn(ICONS.undo, 'Undo', undo);
  btn(ICONS.prev, 'Previous page', () => goToPage(currentPageIndex() - 1));
  const label = document.createElement('span');
  label.className = 'bar-label';
  label.id = 'present-page-label';
  bar.appendChild(label);
  btn(ICONS.next, 'Next page', () => goToPage(currentPageIndex() + 1));
  sep();
  btn(ICONS.close, 'Exit presentation', exitPresent);
  updatePageIndicator();
}

// ---------- Layout ----------

function baseWidth() {
  const avail = els.pages.clientWidth - 12;
  return Math.max(280, Math.min(avail, 980));
}

function fitHeightZoom() {
  const h = els.pages.clientHeight - 24;
  const w = h * (PAGE_W / PAGE_H);
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, w / baseWidth()));
}

function pageLabel(i) {
  return i === 0 ? 'Cover' : `Page ${i}`;
}

function buildPages() {
  if (observer) observer.disconnect();
  clearSelection();
  views.clear();
  els.inner.replaceChildren();
  observer = new IntersectionObserver(onIntersect, { root: els.pages, rootMargin: '600px 600px' });
  notebook.pageIds.forEach((id, i) => {
    const pg = pages.get(id);
    const wrap = document.createElement('div');
    wrap.className = 'page-wrap' + (isCover(pg) ? ' is-cover' : '');
    wrap.dataset.pageId = id;
    const itemsLayer = document.createElement('div');
    itemsLayer.className = 'items-layer';
    const low = document.createElement('canvas');
    low.className = 'ink low';
    const hi = document.createElement('canvas');
    hi.className = 'ink hi';
    hi.hidden = true;
    const uiLayer = document.createElement('div');
    uiLayer.className = 'ui-layer';
    wrap.append(itemsLayer, low, hi, uiLayer);

    const ribbon = document.createElement('span');
    ribbon.className = 'page-ribbon';
    ribbon.innerHTML = ICONS.bookmark;
    ribbon.hidden = !pg.bookmarked;
    wrap.appendChild(ribbon);

    els.inner.append(wrap);
    views.set(id, { wrap, itemsLayer, low, hi, uiLayer, ribbon, visible: false, lowScale: 0, hiShown: false, hiRegion: null });
    renderItems(id);
    observer.observe(wrap);
  });
  const pullSpace = document.createElement('div');
  pullSpace.className = 'pull-space';
  pullSpace.setAttribute('aria-hidden', 'true');
  els.inner.appendChild(pullSpace);
  relayout({ keepScroll: true });
  if (!els.thumbs.hidden) buildThumbs();
}

function relayout({ keepIndex = null, anchor = null, keepScroll = false } = {}) {
  if (!notebook) return;
  let idx = null, offsetWithin = 0;
  if (!anchor && !keepScroll) {
    idx = keepIndex != null ? keepIndex : currentPageIndex();
    if (keepIndex == null) {
      const v = views.get(notebook.pageIds[idx]);
      if (v) offsetWithin = (els.pages.scrollTop - v.wrap.offsetTop) / (scale || 1);
    }
  }
  const w = baseWidth() * zoom;
  scale = w / PAGE_W;
  const h = PAGE_H * scale;
  els.inner.style.width = `${Math.max(els.pages.clientWidth, w + 12)}px`;
  for (const [id, v] of views) {
    const pg = pages.get(id);
    v.wrap.style.width = `${w}px`;
    v.wrap.style.height = `${h}px`;
    v.itemsLayer.style.transform = `scale(${scale})`;
    applyPaper(v.wrap, pg, notebook, scale);
    v.lowScale = 0;
    hideHi(v);
    if (v.visible) renderLow(id);
  }
  if (anchor) {
    const v = views.get(anchor.pageId);
    if (v) {
      els.pages.scrollLeft = v.wrap.offsetLeft + anchor.px * scale - anchor.clientX;
      els.pages.scrollTop = v.wrap.offsetTop + anchor.py * scale - anchor.clientY;
    }
  } else if (idx != null) {
    const v = views.get(notebook.pageIds[idx]);
    if (v) {
      if (keepIndex != null) {
        els.pages.scrollTop = presenting
          ? v.wrap.offsetTop - Math.max(0, (els.pages.clientHeight - h) / 2)
          : v.wrap.offsetTop - PAGE_GAP_TOP;
      } else {
        els.pages.scrollTop = v.wrap.offsetTop + offsetWithin * scale;
      }
    }
    if (zoom <= 1) els.pages.scrollLeft = 0;
  }
  if (sel) buildSelUI();
  if (cropping) renderCropUI();
  scheduleHi();
  updatePageIndicator();
}

function onIntersect(entries) {
  for (const e of entries) {
    const v = views.get(e.target.dataset.pageId);
    if (!v) continue;
    v.visible = e.isIntersecting;
    if (v.visible && !v.lowScale) renderLow(e.target.dataset.pageId);
    if (!v.visible) releaseCanvases(v);
  }
}

function releaseCanvases(v) {
  if (active && views.get(active.pageId) === v) return;
  v.low.width = 0; v.low.height = 0;
  v.hi.width = 0; v.hi.height = 0;
  v.lowScale = 0;
  hideHi(v);
}

// Strokes to draw on the page canvas (selected strokes are drawn on the selection layer).
function pageStrokes(id) {
  const pg = pages.get(id);
  if (sel && sel.pageId === id && sel.strokeIds.size) return pg.strokes.filter((s) => !sel.strokeIds.has(s.id));
  return pg.strokes;
}

function renderLow(id) {
  const v = views.get(id);
  const pg = pages.get(id);
  if (!v || !pg) return;
  const cssW = PAGE_W * scale;
  const pw = Math.max(1, Math.min(Math.round(cssW * dpr()), LOW_CAP));
  const k = pw / PAGE_W;
  const ph = Math.round(PAGE_H * k);
  if (v.low.width !== pw || v.low.height !== ph) { v.low.width = pw; v.low.height = ph; }
  const ctx = v.low.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, pw, ph);
  ctx.setTransform(k, 0, 0, k, 0, 0);
  drawStrokes(ctx, pageStrokes(id));
  v.lowScale = k;
}

function needsHi() {
  return PAGE_W * scale * dpr() > LOW_CAP + 1;
}

function visibleRegion(v) {
  const pr = els.pages.getBoundingClientRect();
  const wr = v.wrap.getBoundingClientRect();
  const x0 = Math.max(pr.left, wr.left), y0 = Math.max(pr.top, wr.top);
  const x1 = Math.min(pr.right, wr.right), y1 = Math.min(pr.bottom, wr.bottom);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0 - wr.left, y: y0 - wr.top, w: x1 - x0, h: y1 - y0 };
}

function regionCanvas(canvas, region) {
  const r = dpr();
  const pw = Math.max(1, Math.ceil(region.w * r)), ph = Math.max(1, Math.ceil(region.h * r));
  if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
  canvas.style.left = `${region.x}px`;
  canvas.style.top = `${region.y}px`;
  canvas.style.width = `${region.w}px`;
  canvas.style.height = `${region.h}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, pw, ph);
  ctx.setTransform(r * scale, 0, 0, r * scale, -region.x * r, -region.y * r);
  return ctx;
}

// When zoomed in, a sharp canvas covers the visible area plus a margin; the
// whole-page canvas stays underneath (with a hole cut out) so nothing ever
// disappears while scrolling or pinching.
function renderHi(id) {
  const v = views.get(id);
  const pg = pages.get(id);
  if (!v || !pg) return;
  if (!needsHi()) { hideHi(v); return; }
  const vis = visibleRegion(v);
  if (!vis) { hideHi(v); return; }
  const W = PAGE_W * scale, H = PAGE_H * scale;
  const r = dpr();
  let mx = els.pages.clientWidth * 0.3, my = els.pages.clientHeight * 0.3;
  const budget = 9e6; // device pixels
  while (mx > 0 && (vis.w + 2 * mx) * (vis.h + 2 * my) * r * r > budget) { mx *= 0.7; my *= 0.7; if (mx < 8) { mx = my = 0; } }
  const x0 = Math.floor(Math.max(0, vis.x - mx)), y0 = Math.floor(Math.max(0, vis.y - my));
  const x1 = Math.ceil(Math.min(W, vis.x + vis.w + mx)), y1 = Math.ceil(Math.min(H, vis.y + vis.h + my));
  const region = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  const ctx = regionCanvas(v.hi, region);
  const clip = [region.x / scale, region.y / scale, (region.x + region.w) / scale, (region.y + region.h) / scale];
  drawStrokes(ctx, pageStrokes(id), clip);
  v.hi.hidden = false;
  v.hiRegion = region;
  v.hiShown = true;
  v.low.style.clipPath = `polygon(evenodd, 0 0, ${W}px 0, ${W}px ${H}px, 0 ${H}px, 0 0, ${x0}px ${y0}px, ${x1}px ${y0}px, ${x1}px ${y1}px, ${x0}px ${y1}px, ${x0}px ${y0}px)`;
}

function hideHi(v) {
  if (!v.hiShown && v.hi.hidden) return;
  v.hi.hidden = true;
  v.low.style.clipPath = '';
  v.hiShown = false;
  v.hiRegion = null;
}

function hiCovers(v) {
  if (!v.hiShown || !v.hiRegion) return false;
  const vis = visibleRegion(v);
  if (!vis) return true;
  const r = v.hiRegion;
  return vis.x >= r.x - 1 && vis.y >= r.y - 1 && vis.x + vis.w <= r.x + r.w + 1 && vis.y + vis.h <= r.y + r.h + 1;
}

function scheduleHi(delay = 120) {
  clearTimeout(hiTimer);
  if (!needsHi()) return;
  hiTimer = setTimeout(() => {
    if (active || pinch) { scheduleHi(); return; }
    for (const [id, v] of views) if (v.visible && !hiCovers(v)) renderHi(id);
  }, delay);
}

function rerenderPage(id) {
  const v = views.get(id);
  if (!v || !v.visible) return;
  renderLow(id);
  if (v.hiShown) renderHi(id);
}

// Redraws only part of a page (page units), e.g. after erasing.
function redrawArea(id, box) {
  const v = views.get(id);
  if (!v || !v.visible || !v.lowScale) return;
  const b = [box[0] - 2, box[1] - 2, box[2] + 2, box[3] + 2];
  const paint = (ctx) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(b[0], b[1], b[2] - b[0], b[3] - b[1]);
    ctx.clip();
    ctx.clearRect(b[0], b[1], b[2] - b[0], b[3] - b[1]);
    drawStrokes(ctx, pageStrokes(id), b);
    ctx.restore();
  };
  const lctx = v.low.getContext('2d');
  lctx.setTransform(v.lowScale, 0, 0, v.lowScale, 0, 0);
  paint(lctx);
  if (v.hiShown) paint(hiContext(v));
}

function hiContext(v) {
  const r = dpr();
  const ctx = v.hi.getContext('2d');
  ctx.setTransform(r * scale, 0, 0, r * scale, -v.hiRegion.x * r, -v.hiRegion.y * r);
  return ctx;
}

// Draws one new stroke onto the page canvases without redrawing the rest.
function paintStroke(id, stroke) {
  const v = views.get(id);
  if (!v || !v.lowScale) return;
  if (stroke.tool === 'highlighter' || stroke.tool === 'fill') { redrawArea(id, stroke.bbox || computeBBox(stroke)); return; }
  const lctx = v.low.getContext('2d');
  lctx.setTransform(v.lowScale, 0, 0, v.lowScale, 0, 0);
  drawStroke(lctx, stroke);
  if (v.hiShown) drawStroke(hiContext(v), stroke);
}

// ---------- Live ink overlay ----------
// Two screen-sized canvases above the pages: "wet" keeps the finished part of
// the stroke being written, "tail" holds the last few points (which may still
// change) plus the predicted points. Each frame only the new bits are drawn.

function syncOverlay() {
  const p = els.pages;
  const w = p.clientWidth, h = p.clientHeight;
  const r = dpr();
  for (const c of [els.wet, els.tail]) {
    c.style.left = `${p.offsetLeft}px`;
    c.style.top = `${p.offsetTop}px`;
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    const pw = Math.round(w * r), ph = Math.round(h * r);
    if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
  }
}

function overlayCtx(canvas, wrap) {
  const r = dpr();
  const ctx = canvas.getContext('2d');
  if (wrap) {
    const pr = els.pages.getBoundingClientRect();
    const wr = wrap.getBoundingClientRect();
    ctx.setTransform(r * scale, 0, 0, r * scale, (wr.left - pr.left) * r, (wr.top - pr.top) * r);
  } else {
    ctx.setTransform(r, 0, 0, r, 0, 0);
  }
  return ctx;
}

function clearOverlay(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function renderItems(id) {
  const v = views.get(id);
  const pg = pages.get(id);
  if (!v || !pg) return;
  const existing = new Map([...v.itemsLayer.children].map((el) => [el.dataset.itemId, el]));
  const keep = new Set();
  for (const it of pg.items || []) {
    const el = renderItem(it, existing.get(it.id));
    keep.add(it.id);
    v.itemsLayer.appendChild(el); // keeps z-order in array order
  }
  for (const [itemId, el] of existing) if (!keep.has(itemId)) el.remove();
}

function itemEl(pageId, itemId) {
  const v = views.get(pageId);
  return v ? v.itemsLayer.querySelector(`[data-item-id="${itemId}"]`) : null;
}

function onScroll() {
  if (needsHi() && !active) scheduleHi(90);
  updatePageIndicator();
  if (presenting) pokePresentBar(false);
}

function currentPageIndex() {
  if (!notebook) return 0;
  const box = els.pages.getBoundingClientRect();
  const mid = box.top + box.height / 2;
  let best = 0, bestDist = Infinity;
  notebook.pageIds.forEach((id, i) => {
    const v = views.get(id);
    if (!v) return;
    const r = v.wrap.getBoundingClientRect();
    const d = mid < r.top ? r.top - mid : mid > r.bottom ? mid - r.bottom : 0;
    if (d < bestDist) { bestDist = d; best = i; }
  });
  return best;
}

function updatePageIndicator() {
  if (!notebook) return;
  const i = currentPageIndex();
  const total = notebook.pageIds.length - 1;
  els.pageIndicator.textContent = i === 0 ? `Cover · ${total} pages` : `${i} / ${total}`;
  const pl = document.getElementById('present-page-label');
  if (pl) pl.textContent = i === 0 ? 'Cover' : `${i} / ${total}`;
  if (!els.thumbs.hidden) {
    const curId = notebook.pageIds[i];
    els.thumbs.querySelectorAll('.thumb').forEach((t) => t.classList.toggle('current', t.dataset.pageId === curId));
  }
}

function goToPage(i, { smooth = true } = {}) {
  if (!notebook) return;
  const idx = Math.max(0, Math.min(notebook.pageIds.length - 1, i));
  const v = views.get(notebook.pageIds[idx]);
  if (!v) return;
  const h = PAGE_H * scale;
  const top = presenting
    ? v.wrap.offsetTop - Math.max(0, (els.pages.clientHeight - h) / 2)
    : v.wrap.offsetTop - PAGE_GAP_TOP;
  els.pages.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
  if (!smooth) updatePageIndicator();
}

// ---------- Zoom ----------

function showZoomBadge(z) {
  els.zoomBadge.textContent = `${Math.round(z * 100)}%`;
  els.zoomBadge.hidden = false;
  clearTimeout(showZoomBadge.t);
  showZoomBadge.t = setTimeout(() => { els.zoomBadge.hidden = true; }, 900);
}

function anchorAt(clientX, clientY) {
  const pr = els.pages.getBoundingClientRect();
  let best = null, bestD = Infinity;
  for (const [id, v] of views) {
    const r = v.wrap.getBoundingClientRect();
    const d = clientY < r.top ? r.top - clientY : clientY > r.bottom ? clientY - r.bottom : 0;
    if (d < bestD) { bestD = d; best = { id, r }; }
  }
  if (!best) return null;
  return {
    pageId: best.id,
    px: (clientX - best.r.left) / scale,
    py: (clientY - best.r.top) / scale,
    clientX: clientX - pr.left,
    clientY: clientY - pr.top,
  };
}

function clampZoom(z) {
  const c = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
  return Math.abs(c - 1) < 0.06 ? 1 : c;
}

function onWheel(e) {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  const anchor = anchorAt(e.clientX, e.clientY);
  zoom = clampZoom(zoom * Math.exp(-e.deltaY * 0.01));
  relayout({ anchor });
  showZoomBadge(zoom);
}

function touchDist(t) { return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY); }
function touchMid(t) { return { x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 }; }

// Taps on buttons and text being typed must still work with the Pencil.
function isInteractiveTarget(t) {
  return !!(t && t.closest && t.closest('button, input, [contenteditable="true"], .sel-bar, .crop-bar'));
}

function onTouchStart(e) {
  const touches = [...e.touches];
  if (mode === 'edit' && touches.some((t) => t.touchType === 'stylus')) {
    if (!isInteractiveTarget(e.target)) e.preventDefault();
    return;
  }
  if (e.target.closest && e.target.closest('.sel-box, .crop-frame')) { e.preventDefault(); return; }
  const fingers = touches.filter((t) => t.touchType !== 'stylus');
  if (fingers.length === 2) {
    e.preventDefault();
    if (active && active.pointerType === 'touch') cancelInteraction();
    pull = null;
    hidePull();
    const mid = touchMid(fingers);
    const pr = els.pages.getBoundingClientRect();
    pinch = {
      d0: touchDist(fingers), mid0: mid, mid, zoom0: zoom, ratio: 1,
      originX: mid.x - pr.left + els.pages.scrollLeft,
      originY: mid.y - pr.top + els.pages.scrollTop,
    };
    els.inner.style.transformOrigin = `${pinch.originX}px ${pinch.originY}px`;
    els.inner.classList.add('pinching');
  } else if (fingers.length === 1 && !pinch && mode === 'edit' && !presenting) {
    pull = { baseY: null, dy: 0 };
  }
}

function onTouchMove(e) {
  const touches = [...e.touches];
  if (mode === 'edit' && touches.some((t) => t.touchType === 'stylus')) {
    if (!isInteractiveTarget(e.target)) e.preventDefault();
    return;
  }
  if (active && (active.kind === 'sel' || active.kind === 'crop')) { e.preventDefault(); return; }
  if (pinch) {
    const fingers = touches.filter((t) => t.touchType !== 'stylus');
    if (fingers.length < 2) return;
    e.preventDefault();
    const target = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pinch.zoom0 * touchDist(fingers) / pinch.d0));
    pinch.ratio = target / pinch.zoom0;
    pinch.mid = touchMid(fingers);
    const tx = pinch.mid.x - pinch.mid0.x, ty = pinch.mid.y - pinch.mid0.y;
    els.inner.style.transform = `translate(${tx}px, ${ty}px) scale(${pinch.ratio})`;
    showZoomBadge(target);
    return;
  }
  if (pull && touches.length === 1 && !(active && active.pointerType === 'touch')) {
    const y = touches[0].clientY;
    const p = els.pages;
    const atBottom = p.scrollTop + p.clientHeight >= p.scrollHeight - 2;
    if (atBottom) {
      if (pull.baseY == null) pull.baseY = y;
      pull.dy = Math.max(0, pull.baseY - y);
      showPull(pull.dy);
    } else {
      pull.baseY = null;
      pull.dy = 0;
      hidePull();
    }
  }
}

function onTouchEnd(e) {
  if (pinch && e.touches.length < 2) {
    const p = pinch;
    pinch = null;
    els.inner.style.transform = '';
    els.inner.classList.remove('pinching');
    const pr = els.pages.getBoundingClientRect();
    const anchor = anchorAt(p.mid0.x, p.mid0.y);
    if (anchor) {
      anchor.clientX = p.mid.x - pr.left;
      anchor.clientY = p.mid.y - pr.top;
    }
    zoom = clampZoom(p.zoom0 * p.ratio);
    relayout({ anchor });
    showZoomBadge(zoom);
    return;
  }
  if (pull && e.touches.length === 0) {
    const ready = pull.dy > PULL_DISTANCE;
    pull = null;
    hidePull();
    if (ready && mode === 'edit') addPageAfter(notebook.pageIds.length - 1);
  }
}

function showPull(dy) {
  const progress = Math.min(1, dy / PULL_DISTANCE);
  els.pullHint.hidden = false;
  els.pullHint.style.setProperty('--progress', progress);
  els.pullHint.classList.toggle('ready', progress >= 1);
  els.pullHint.querySelector('.pull-text').textContent = progress >= 1 ? 'Release to add a page' : 'Pull up to add a page';
}
function hidePull() { els.pullHint.hidden = true; }

// ---------- Pages panel ----------

function toggleThumbs() {
  if (presenting) return;
  const show = els.thumbs.hidden;
  els.thumbs.hidden = !show;
  els.thumbsBtn.classList.toggle('active', show);
  if (show) buildThumbs();
  else if (thumbObserver) { thumbObserver.disconnect(); els.thumbs.replaceChildren(); }
  relayout();
}

function buildThumbs() {
  if (thumbObserver) thumbObserver.disconnect();
  els.thumbs.replaceChildren();

  const head = document.createElement('div');
  head.className = 'thumbs-head';
  const seg = document.createElement('div');
  seg.className = 'segmented segmented-2';
  for (const [id, label] of [['all', 'All pages'], ['bookmarked', 'Bookmarked']]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.setAttribute('aria-checked', String(thumbFilter === id));
    b.addEventListener('click', () => { thumbFilter = id; buildThumbs(); });
    seg.appendChild(b);
  }
  head.appendChild(seg);
  const grid = document.createElement('div');
  grid.className = 'thumbs-grid';
  els.thumbs.append(head, grid);

  thumbObserver = new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) renderThumb(en.target.dataset.pageId);
  }, { root: els.thumbs, rootMargin: '300px 0px' });
  const currentId = notebook.pageIds[currentPageIndex()];
  let shown = 0;
  notebook.pageIds.forEach((id, i) => {
    const pg = pages.get(id);
    if (thumbFilter === 'bookmarked' && !pg.bookmarked) return;
    shown++;
    const b = document.createElement('div');
    b.className = 'thumb' + (id === currentId ? ' current' : '');
    b.dataset.pageId = id;
    const paper = document.createElement('button');
    paper.type = 'button';
    paper.className = 'thumb-paper';
    paper.setAttribute('aria-label', `Go to ${pageLabel(i).toLowerCase()}`);
    paper.appendChild(document.createElement('canvas'));
    paper.addEventListener('click', () => goToPage(notebook.pageIds.indexOf(id)));
    const mark = document.createElement('button');
    mark.type = 'button';
    mark.className = 'thumb-mark' + (pg.bookmarked ? ' on' : '');
    mark.innerHTML = ICONS.bookmark;
    mark.setAttribute('aria-label', pg.bookmarked ? 'Remove bookmark' : 'Bookmark page');
    mark.addEventListener('click', () => toggleBookmark(id));
    if (isCover(pg)) paper.classList.add('is-cover');
    const foot = document.createElement('div');
    foot.className = 'thumb-foot';
    const label = document.createElement('span');
    label.textContent = i === 0 ? 'Cover' : String(i);
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'thumb-more';
    more.innerHTML = ICONS.more;
    more.setAttribute('aria-label', `${pageLabel(i)} options`);
    more.addEventListener('click', () => pageMenu(id, more));
    foot.append(label, more);
    b.append(paper, mark, foot);
    grid.appendChild(b);
    thumbObserver.observe(b);
  });
  if (!shown) {
    const empty = document.createElement('p');
    empty.className = 'thumbs-empty';
    empty.textContent = 'No bookmarked pages yet. Tap the ribbon on a page to bookmark it.';
    grid.appendChild(empty);
  }
}

async function toggleBookmark(pageId) {
  const pg = pages.get(pageId);
  pg.bookmarked = !pg.bookmarked;
  await savePage(pg);
  const v = views.get(pageId);
  if (v) v.ribbon.hidden = !pg.bookmarked;
  if (!els.thumbs.hidden) buildThumbs();
  showToast(pg.bookmarked ? 'Bookmarked' : 'Bookmark removed');
}

async function renderThumb(id) {
  const b = els.thumbs.querySelector(`.thumb[data-page-id="${id}"]`);
  const pg = pages.get(id);
  if (!b || !pg) return;
  const paper = b.querySelector('.thumb-paper');
  const cssW = paper.clientWidth || 110;
  const s = cssW / PAGE_W;
  applyPaper(paper, pg, notebook, s);
  const c = paper.querySelector('canvas');
  const off = document.createElement('canvas');
  const r = dpr();
  off.width = Math.round(cssW * r);
  off.height = Math.round(PAGE_H * s * r);
  const ctx = off.getContext('2d');
  ctx.setTransform(s * r, 0, 0, s * r, 0, 0);
  await drawItems(ctx, pg.items);
  drawStrokes(ctx, pg.strokes);
  c.width = off.width; c.height = off.height;
  c.getContext('2d').drawImage(off, 0, 0);
}

// ---------- Toolbar ----------

function setTool(t) {
  if (t !== 'lasso') clearSelection();
  finishEditing();
  finishCrop(true);
  tools.tool = t;
  saveTools();
  els.popover.hidden = true;
  renderToolbar();
  if (presenting) renderPresentBar();
}

function renderToolbar() {
  const tb = els.toolbar;
  tb.replaceChildren();
  const group = (cls) => { const g = document.createElement('div'); g.className = `tool-group ${cls}`; tb.appendChild(g); return g; };
  const toolBtn = (g, t, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'icon-btn tool-btn' + (tools.tool === t ? ' active' : '');
    b.innerHTML = ICONS[t];
    b.setAttribute('aria-label', TOOL_NAMES[t]);
    b.setAttribute('aria-pressed', String(tools.tool === t));
    b.addEventListener('click', onClick || (() => {
      if (tools.tool === t && t === 'pen') { togglePenPopover(b); return; }
      if (tools.tool === t && SLOT_TOOLS.includes(t)) {
        const cfg = tools[t];
        openColorPopover(b, cfg.color, (nc) => { cfg.slots[cfg.slot] = nc; cfg.color = nc; saveTools(); renderToolbar(); });
        return;
      }
      setTool(t);
    }));
    g.appendChild(b);
    return b;
  };

  const drawGroup = group('tools');
  for (const t of ['lasso', 'pen', 'highlighter', 'eraser', 'fill', 'laser']) toolBtn(drawGroup, t);
  const insertGroup = group('tools insert');
  toolBtn(insertGroup, 'text');
  const imgBtn = toolBtn(insertGroup, 'image', () => { finishEditing(); els.imageInput.value = ''; els.imageInput.click(); });
  imgBtn.classList.remove('active');
  toolBtn(insertGroup, 'sticky');

  const t = tools.tool;
  if (t === 'pen') {
    const styleBtn = document.createElement('button');
    styleBtn.type = 'button';
    styleBtn.className = 'style-btn';
    styleBtn.textContent = penStyleLabel();
    styleBtn.setAttribute('aria-label', 'Pen style');
    styleBtn.addEventListener('click', () => togglePenPopover(styleBtn));
    group('style').appendChild(styleBtn);
  }
  if (SLOT_TOOLS.includes(t)) {
    const colorGroup = group('colors');
    const cfg = tools[t];
    cfg.slots.forEach((c, i) => {
      const b = colorButton(c, cfg.slot === i, false, () => {
        if (cfg.slot === i) {
          openColorPopover(b, cfg.color, (nc) => { cfg.slots[i] = nc; cfg.color = nc; saveTools(); renderToolbar(); });
          return;
        }
        cfg.slot = i; cfg.color = c; saveTools(); renderToolbar();
      });
      b.classList.add('slot');
      colorGroup.appendChild(b);
    });
  }
  if (SIZES[t]) {
    const sizeGroup = group('sizes');
    SIZES[t].forEach((s, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'size-btn' + (tools[t].size === s ? ' active' : '');
      b.setAttribute('aria-label', ['Thin', 'Medium', 'Thick'][i]);
      const dot = document.createElement('span');
      dot.style.width = dot.style.height = `${[6, 10, 16][i]}px`;
      if (t !== 'eraser') dot.style.background = tools[t].color === '#ffffff' ? '#bbb' : tools[t].color;
      b.appendChild(dot);
      b.addEventListener('click', () => { tools[t].size = s; saveTools(); renderToolbar(); });
      sizeGroup.appendChild(b);
    });
  }
  if (t === 'laser') {
    const g = group('laser-mode');
    g.appendChild(segmented([['trail', 'Trail'], ['dot', 'Dot']], tools.laser.mode, (v) => {
      tools.laser.mode = v; saveTools(); renderToolbar();
    }));
  }
  if (t === 'text') {
    const g = group('text-opts');
    g.appendChild(segmented(TEXT_SIZES.map((x) => [x.v, x.label]), tools.text.size, (v) => {
      tools.text.size = v; saveTools(); renderToolbar();
      if (editing && editing.type === 'text') updateEditingItem({ fontSize: v });
    }));
    const cg = group('colors');
    for (const c of TEXT_COLORS) {
      cg.appendChild(colorButton(c, tools.text.color === c, false, () => {
        tools.text.color = c; saveTools(); renderToolbar();
        if (editing && editing.type === 'text') updateEditingItem({ color: c });
      }));
    }
  }
  if (t === 'sticky') {
    const cg = group('colors');
    for (const c of STICKY_COLORS) {
      cg.appendChild(colorButton(c, tools.sticky.color === c, false, () => {
        tools.sticky.color = c; saveTools(); renderToolbar();
        if (editing && editing.type === 'sticky') updateEditingItem({ color: c });
      }));
    }
  }
  if (t === 'lasso') {
    const g = group('hint');
    if (clipboard) {
      const paste = document.createElement('button');
      paste.type = 'button';
      paste.className = 'style-btn';
      paste.textContent = 'Paste';
      paste.addEventListener('click', pasteClipboard);
      g.appendChild(paste);
    }
    const hint = document.createElement('span');
    hint.className = 'tool-hint';
    hint.textContent = 'Circle anything to select it, or tap an item.';
    g.appendChild(hint);
  }
  if (t === 'text' || t === 'sticky') {
    const hint = document.createElement('span');
    hint.className = 'tool-hint';
    hint.textContent = t === 'text' ? 'Tap the page to type.' : 'Tap the page to add a note.';
    group('hint').appendChild(hint);
  }
}

function colorButton(c, isActive, isCustom, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'color-btn' + (isActive ? ' active' : '') + (isCustom ? ' custom' : '');
  b.style.setProperty('--c', c);
  b.setAttribute('aria-label', isCustom ? 'Custom colour' : `Colour ${c}`);
  b.addEventListener('click', onClick);
  return b;
}

// ---------- Colour picker ----------

function hexToRgb(h) {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}
function hsvToRgb(h, s, v) {
  const f = (n) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5) * 255, f(3) * 255, f(1) * 255];
}
function rgbToHsv([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, mx ? d / mx : 0, mx];
}

function openColorPopover(anchor, current, onPick) {
  const pop = els.popover;
  pop.replaceChildren();
  pop.className = 'popover color-pop';
  const pick = (c, close = true) => {
    onPick(c);
    if (!PALETTE.includes(c)) {
      tools.recent = [c, ...tools.recent.filter((x) => x !== c)].slice(0, 9);
      saveTools();
    }
    if (close) pop.hidden = true;
  };
  const grid = document.createElement('div');
  grid.className = 'palette-grid';
  for (const c of PALETTE) {
    const b = colorButton(c, c.toLowerCase() === (current || '').toLowerCase(), false, () => pick(c));
    grid.appendChild(b);
  }
  pop.appendChild(grid);
  if (tools.recent.length) {
    const t = document.createElement('div');
    t.className = 'pop-title';
    t.textContent = 'Recent';
    const row = document.createElement('div');
    row.className = 'palette-grid';
    for (const c of tools.recent) row.appendChild(colorButton(c, c === current, false, () => pick(c)));
    pop.append(t, row);
  }
  const t2 = document.createElement('div');
  t2.className = 'pop-title';
  t2.textContent = 'Custom';
  pop.appendChild(t2);

  let [h, sv, vv] = rgbToHsv(hexToRgb(current || '#1f5bd8') || [31, 91, 216]);
  const area = document.createElement('div');
  area.className = 'sv-area';
  const knob = document.createElement('div');
  knob.className = 'sv-knob';
  area.appendChild(knob);
  const hue = document.createElement('div');
  hue.className = 'hue-bar';
  const hk = document.createElement('div');
  hk.className = 'hue-knob';
  hue.appendChild(hk);
  const row = document.createElement('div');
  row.className = 'custom-row';
  const swatch = document.createElement('span');
  swatch.className = 'custom-swatch';
  const hex = document.createElement('input');
  hex.type = 'text';
  hex.className = 'hex-input';
  hex.maxLength = 7;
  hex.autocomplete = 'off';
  hex.spellcheck = false;
  const use = document.createElement('button');
  use.type = 'button';
  use.className = 'btn btn-primary btn-small';
  use.textContent = 'Use';
  row.append(swatch, hex, use);
  pop.append(area, hue, row);

  const cur = () => rgbToHex(hsvToRgb(h, sv, vv));
  const paint = (fromHex = false) => {
    area.style.setProperty('--hue', `hsl(${h}, 100%, 50%)`);
    knob.style.left = `${sv * 100}%`;
    knob.style.top = `${(1 - vv) * 100}%`;
    hk.style.left = `${(h / 360) * 100}%`;
    swatch.style.background = cur();
    if (!fromHex) hex.value = cur();
  };
  const drag = (el, fn) => {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const move = (ev) => { const r = el.getBoundingClientRect(); fn(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height))); paint(); };
      move(e);
      const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
  };
  drag(area, (x, y) => { sv = x; vv = 1 - y; });
  drag(hue, (x) => { h = x * 359.9; });
  hex.addEventListener('input', () => {
    const rgb = hexToRgb(hex.value.startsWith('#') ? hex.value : `#${hex.value}`);
    if (rgb) { [h, sv, vv] = rgbToHsv(rgb); paint(true); }
  });
  use.addEventListener('click', () => pick(cur()));
  paint();
  pop.hidden = false;
  positionPopover(anchor);
}

function segmented(options, value, onPick) {
  const seg = document.createElement('div');
  seg.className = 'segmented mini';
  seg.style.gridTemplateColumns = `repeat(${options.length}, auto)`;
  for (const [v, label] of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.setAttribute('aria-checked', String(v === value));
    b.addEventListener('click', () => onPick(v));
    seg.appendChild(b);
  }
  return seg;
}

function penStyleLabel() {
  const pt = PEN_TYPES.find((x) => x.id === tools.pen.type) || PEN_TYPES[0];
  const ls = LINE_STYLES.find((x) => x.id === tools.pen.dash) || LINE_STYLES[0];
  return ls.id === 'solid' ? `${pt.label} ▾` : `${pt.label} · ${ls.label} ▾`;
}

function positionPopover(anchor) {
  const pop = els.popover;
  const ar = anchor.getBoundingClientRect();
  const vr = els.view.getBoundingClientRect();
  pop.style.top = `${ar.bottom - vr.top + 8}px`;
  pop.style.left = `${Math.max(8, Math.min(ar.left - vr.left, vr.width - pop.offsetWidth - 8))}px`;
}

// opts: { values: {type, dash}, onChange(key, value), showStab }
function stylePopover(anchor, { values, onChange, showStab, color }) {
  const pop = els.popover;
  pop.replaceChildren();
  pop.className = 'popover';
  const preview = document.createElement('canvas');
  preview.className = 'pen-preview';
  const drawPreview = () => {
    const w = 260, h = 70, r = dpr();
    preview.width = w * r; preview.height = h * r;
    const ctx = preview.getContext('2d');
    ctx.setTransform(r, 0, 0, r, 0, 0);
    const pts = [];
    for (let i = 0; i <= 60; i++) {
      const u = i / 60;
      pts.push(14 + u * 232, 35 - Math.sin(u * Math.PI * 2.2) * 18, 0.25 + 0.75 * Math.sin(u * Math.PI));
    }
    const c = !color || color === '#ffffff' ? '#1d1d1f' : color;
    drawStroke(ctx, { tool: 'pen', pen: values.type, dash: values.dash, color: c, size: 5, points: pts });
  };
  const section = (title, items, key) => {
    const h = document.createElement('div');
    h.className = 'pop-title';
    h.textContent = title;
    const seg = document.createElement('div');
    seg.className = 'segmented';
    for (const it of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = it.label;
      b.setAttribute('aria-checked', String(values[key] === it.id));
      b.addEventListener('click', () => {
        values[key] = it.id;
        onChange(key, it.id);
        seg.querySelectorAll('button').forEach((x, j) => x.setAttribute('aria-checked', String(items[j].id === it.id)));
        drawPreview();
      });
      seg.appendChild(b);
    }
    pop.append(h, seg);
  };
  pop.appendChild(preview);
  section('Pen type', PEN_TYPES, 'type');
  section('Line style', LINE_STYLES, 'dash');
  if (showStab) {
    const h = document.createElement('div');
    h.className = 'pop-title pop-row';
    const label = document.createElement('span');
    label.textContent = 'Stroke stabilization';
    const val = document.createElement('span');
    val.textContent = `${Math.round(tools.pen.stab * 100)}%`;
    h.append(label, val);
    const range = document.createElement('input');
    range.type = 'range';
    range.min = '0'; range.max = '100'; range.step = '5';
    range.value = String(Math.round(tools.pen.stab * 100));
    range.className = 'range';
    range.addEventListener('input', () => {
      tools.pen.stab = Number(range.value) / 100;
      val.textContent = `${range.value}%`;
      saveTools();
    });
    const note = document.createElement('p');
    note.className = 'pop-note';
    note.textContent = 'Smooths shaky lines. Higher values feel slightly slower.';
    pop.append(h, range, note);
  }
  pop.hidden = false;
  drawPreview();
  positionPopover(anchor);
}

function togglePenPopover(anchor) {
  if (!els.popover.hidden) { els.popover.hidden = true; return; }
  stylePopover(anchor, {
    values: { type: tools.pen.type, dash: tools.pen.dash },
    color: tools.pen.color,
    showStab: true,
    onChange: (key, v) => {
      tools.pen[key] = v;
      saveTools();
      const b = els.toolbar.querySelector('.style-btn');
      if (b) b.textContent = penStyleLabel();
    },
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
  // A Pencil lift that Safari never reported must not block the next stroke.
  if (active && e.pointerType === 'pen' && e.pointerId !== active.pointerId) finishInteraction();
  if (presenting && e.pointerType === 'touch' && !e.target.closest('.present-bar')) pokePresentBar(true);
  if (!notebook || active || pinch) return;
  if (mode !== 'edit') return;
  const target = e.target;

  // Image cropping takes over input until done.
  if (cropping) {
    const handle = target.closest('.crop-frame');
    if (handle) { startCropDrag(e, target.closest('[data-edge]')); return; }
    if (target.closest('.crop-bar')) return;
    finishCrop(true);
    return;
  }
  // Typing: taps inside the box move the caret; taps elsewhere end typing.
  if (editing) {
    if (target.closest('[contenteditable="true"]')) return;
    finishEditing();
    e.preventDefault();
    return;
  }
  if (target.closest('.sel-bar')) return;
  if (sel && target.closest('.sel-box')) { startSelTransform(e, target); return; }

  const wrap = target.closest('.page-wrap');
  if (!wrap) { clearSelection(); return; }
  if (e.pointerType === 'touch' && !getSettings().fingerDraw) return; // fingers scroll
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  e.preventDefault();
  els.popover.hidden = true;

  const pageId = wrap.dataset.pageId;
  const v = views.get(pageId);
  if (!v.lowScale) renderLow(pageId);
  const rect = wrap.getBoundingClientRect();
  const [px, py] = toPage(e, rect);
  const pg = pages.get(pageId);

  if (tools.tool === 'text' || tools.tool === 'sticky') {
    const type = tools.tool;
    const hit = [...pg.items].reverse().find((it) => it.type === type && hitItem(it, px, py, 6));
    if (hit) { startEditing(pageId, hit, false); return; }
    const before = snapshot(pg);
    let item;
    if (type === 'text') {
      item = newTextItem(px - 4, py - tools.text.size * 0.7);
      item.fontSize = tools.text.size;
      item.color = tools.text.color;
    } else {
      item = newStickyItem(px, py);
      item.color = tools.sticky.color;
    }
    pg.items.push(item);
    renderItems(pageId);
    startEditing(pageId, item, true, before);
    return;
  }

  if (tools.tool === 'fill') { clearSelection(); fillAt(pageId, px, py); return; }

  clearSelection();
  try { els.pages.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  syncOverlay();
  clearOverlay(els.wet);
  clearOverlay(els.tail);
  const darkInk = darkPagesOn() && !isCover(pg);
  els.wet.classList.toggle('dark-ink', darkInk);
  els.tail.classList.toggle('dark-ink', darkInk && tools.tool !== 'laser');
  els.wet.classList.toggle('hl', tools.tool === 'highlighter');
  const base = {
    pointerId: e.pointerId, pointerType: e.pointerType, pageId, rect, wrap,
    wetCtx: overlayCtx(els.wet, wrap), tailCtx: overlayCtx(els.tail, wrap),
  };
  if (tools.tool === 'lasso') {
    active = { ...base, kind: 'lasso', pts: [[px, py]] };
  } else if (tools.tool === 'eraser') {
    active = { ...base, kind: 'erase', removed: [], last: null };
    eraseAt([px, py]);
    drawEraserCursor([px, py]);
  } else if (tools.tool === 'laser') {
    active = { ...base, kind: 'laser' };
    if (presenting) hidePresentBar();
    addLaserPoint(e);
    startLaserLoop();
  } else {
    const cfg = tools[tools.tool];
    const stroke = { id: newId(), tool: tools.tool, color: cfg.color, size: cfg.size, points: [] };
    if (tools.tool === 'pen') { stroke.pen = cfg.type; stroke.dash = cfg.dash; }
    active = {
      ...base, kind: 'draw', stroke, predicted: [], frame: 0, committed: 0,
      stab: tools.tool === 'pen' ? tools.pen.stab : 0, raw: null, snapped: null, holdAt: null, holdTimer: 0,
    };
    if (presenting) hidePresentBar();
    addPoint(stroke, [px, py], pressureOf(e));
    armHold(px, py);
    scheduleLive();
  }
}

// ---------- Hold to snap ----------

function armHold(x, y) {
  const a = active;
  a.holdAt = [x, y];
  clearTimeout(a.holdTimer);
  a.holdTimer = setTimeout(() => trySnap(a), 520);
}

function trySnap(a) {
  if (active !== a || a.snapped) return;
  const s = a.stroke;
  const res = recognize(s.points, { lineOnly: s.tool === 'highlighter' });
  if (!res) return;
  const ps = [];
  for (let i = 2; i < s.points.length; i += 3) ps.push(s.points[i]);
  ps.sort((x, y) => x - y);
  const p = ps[Math.floor(ps.length / 2)] || 0.5;
  let cx = 0, cy = 0;
  for (const q of res.points) { cx += q[0]; cy += q[1]; }
  cx /= res.points.length; cy /= res.points.length;
  const pen = a.raw ? [a.raw[0], a.raw[1]] : a.holdAt;
  a.snapped = { kind: res.kind, base: res.points, c: [cx, cy], pen, p };
  s.points = toFlat(res.points, p);
  s.shape = res.kind;
  clearOverlay(els.wet);
  a.committed = 0;
  scheduleLive();
}

// While still holding after a snap, moving the Pencil resizes the shape
// (a line's end follows the Pencil).
function moveSnapped(a, x, y) {
  const sn = a.snapped;
  let list;
  if (sn.kind === 'line') {
    const [x0, y0] = sn.base[0];
    const len = Math.hypot(x - x0, y - y0);
    const k = Math.max(1, Math.ceil(len / 3));
    list = [];
    for (let i = 0; i <= k; i++) list.push([x0 + ((x - x0) * i) / k, y0 + ((y - y0) * i) / k]);
  } else {
    const d0 = Math.hypot(sn.pen[0] - sn.c[0], sn.pen[1] - sn.c[1]);
    const d1 = Math.hypot(x - sn.c[0], y - sn.c[1]);
    const f = d0 > 8 ? Math.max(0.1, d1 / d0) : 1;
    list = sn.base.map(([px, py]) => [sn.c[0] + (px - sn.c[0]) * f, sn.c[1] + (py - sn.c[1]) * f]);
  }
  a.stroke.points = toFlat(list, sn.p);
}

// ---------- Fill ----------

function fillAt(pageId, x, y) {
  const pg = pages.get(pageId);
  const res = findFillArea(pg.strokes, x, y);
  if (res.error) {
    showToast(res.error === 'line' ? 'Tap inside a shape to fill it.' : 'That area is not closed. Close the outline and try again.');
    return;
  }
  const stroke = { id: newId(), tool: 'fill', color: tools.fill.color, size: 0, points: res.points, loops: res.loops };
  computeBBox(stroke);
  pg.strokes.push(stroke);
  paintStroke(pageId, stroke);
  pushUndo({ type: 'add', pageId, stroke });
  markDirty(pageId);
}

function addPoint(stroke, [x, y], p) {
  const pts = stroke.points;
  const n = pts.length;
  if (n >= 3) {
    const dx = x - pts[n - 3], dy = y - pts[n - 2];
    if (dx * dx + dy * dy < 0.25) { pts[n - 1] = Math.max(pts[n - 1], p); return; }
  }
  pts.push(Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(p * 100) / 100);
}

// Stroke stabilization: each point moves only part of the way towards the Pencil.
function stabilized(a, x, y) {
  const pts = a.stroke.points;
  if (!a.stab || pts.length < 3) return [x, y];
  const k = a.stab * 0.85;
  const lx = pts[pts.length - 3], ly = pts[pts.length - 2];
  return [lx + (x - lx) * (1 - k), ly + (y - ly) * (1 - k)];
}

function onPointerMove(e) {
  if (!active || e.pointerId !== active.pointerId) return;
  e.preventDefault();
  const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
  const list = events.length ? events : [e];
  if (active.kind === 'draw') {
    const a = active;
    if (a.snapped) {
      const [x, y] = toPage(e, a.rect);
      moveSnapped(a, x, y);
      scheduleLive();
      return;
    }
    for (const ev of list) {
      const [x, y] = toPage(ev, a.rect);
      a.raw = [x, y, pressureOf(ev)];
      addPoint(a.stroke, stabilized(a, x, y), pressureOf(ev));
    }
    const [hx, hy] = a.raw;
    if (Math.hypot(hx - a.holdAt[0], hy - a.holdAt[1]) > 3.5 / scale) armHold(hx, hy);
    const pred = !a.stab && e.getPredictedEvents ? e.getPredictedEvents() : [];
    a.predicted = pred.slice(0, 3).map((ev) => toPage(ev, a.rect));
    scheduleLive();
  } else if (active.kind === 'erase') {
    for (const ev of list) eraseAt(toPage(ev, active.rect));
    drawEraserCursor(toPage(e, active.rect));
  } else if (active.kind === 'laser') {
    for (const ev of list) addLaserPoint(ev);
  } else if (active.kind === 'lasso') {
    for (const ev of list) active.pts.push(toPage(ev, active.rect));
    drawLassoPath();
  } else if (active.kind === 'sel') {
    moveSelTransform(e);
  } else if (active.kind === 'crop') {
    moveCropDrag(e);
  }
}

function onPointerUp(e) {
  if (!active || e.pointerId !== active.pointerId) return;
  finishInteraction();
}

function cancelInteraction() {
  if (!active) return;
  const a = active;
  active = null;
  if (a.frame) cancelAnimationFrame(a.frame);
  clearTimeout(a.holdTimer);
  if (a.kind === 'erase' && a.removed.length) {
    pushUndo({ type: 'erase', pageId: a.pageId, removed: a.removed });
    markDirty(a.pageId);
  }
  if (a.kind !== 'laser') clearLive();
}

function finishInteraction() {
  if (!active) return;
  const a = active;
  active = null;
  try { els.pages.releasePointerCapture(a.pointerId); } catch { /* ignore */ }
  if (a.kind === 'laser') { laserUp = performance.now(); return; }
  if (a.kind === 'sel') { endSelTransform(a); return; }
  if (a.kind === 'crop') return;
  clearTimeout(a.holdTimer);
  const pg = pages.get(a.pageId);
  if (!pg) { clearLive(); return; }
  if (a.kind === 'lasso') { clearLive(); finishLasso(a); return; }
  if (a.kind === 'draw') {
    if (a.frame) cancelAnimationFrame(a.frame);
    if (!a.stroke.points.length) { clearLive(); return; }
    if (a.stab && a.raw && !a.snapped) addPoint(a.stroke, [a.raw[0], a.raw[1]], a.raw[2]);
    computeBBox(a.stroke);
    pg.strokes.push(a.stroke);
    // Paint the finished stroke and drop the overlay in the same frame.
    paintStroke(a.pageId, a.stroke);
    clearLive();
    pushUndo({ type: 'add', pageId: a.pageId, stroke: a.stroke });
    markDirty(a.pageId);
  } else {
    clearLive();
    if (a.removed && a.removed.length) {
      pushUndo({ type: 'erase', pageId: a.pageId, removed: a.removed });
      markDirty(a.pageId);
    }
  }
  scheduleHi();
}

function clearCanvas(c) {
  const ctx = c.getContext('2d');
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.restore();
}
function clearLive() {
  clearOverlay(els.wet);
  clearOverlay(els.tail);
  els.wet.classList.remove('hl');
}

function scheduleLive() {
  if (!active || active.frame) return;
  active.frame = requestAnimationFrame(renderLive);
}

function renderLive() {
  const a = active;
  if (!a || a.kind !== 'draw') return;
  a.frame = 0;
  const s = a.stroke;
  const n = s.points.length / 3;
  if (!n) return;
  clearOverlay(els.tail);
  const wet = a.wetCtx, tail = a.tailCtx;
  if (s.tool === 'highlighter') {
    // Opaque on the overlay; the overlay itself is see-through and multiplied.
    if (a.snapped) {
      clearOverlay(els.wet);
      drawStroke(wet, s, s.color);
      return;
    }
    if (n - 1 > a.committed || n === 1) {
      wet.save();
      wet.strokeStyle = s.color;
      wet.lineWidth = s.size;
      wet.lineCap = 'round';
      wet.lineJoin = 'round';
      wet.beginPath();
      const i0 = a.committed;
      wet.moveTo(s.points[i0 * 3], s.points[i0 * 3 + 1]);
      if (n === 1) wet.lineTo(s.points[0] + 0.01, s.points[1]);
      for (let i = i0 + 1; i < n; i++) wet.lineTo(s.points[i * 3], s.points[i * 3 + 1]);
      wet.stroke();
      wet.restore();
      a.committed = n - 1;
    }
    return;
  }
  if (!isSolidPen(s) || a.snapped) {
    drawStroke(tail, s);
    return;
  }
  // Solid pen: commit settled segments to "wet", redraw only the tail.
  const R = strokeRadii(s);
  const settled = Math.max(0, n - 1 - liveLag(s));
  if (settled > a.committed) {
    drawPenRange(wet, s, R, Math.max(0, a.committed - 1), settled);
    a.committed = settled;
  }
  let show = s;
  if (a.predicted.length) {
    const pts = s.points.slice();
    const lastP = pts[pts.length - 1];
    for (const [x, y] of a.predicted) pts.push(x, y, lastP);
    show = { ...s, points: pts };
  }
  const m = show.points.length / 3;
  drawPenRange(tail, show, show === s ? R : strokeRadii(show), Math.max(0, a.committed - 1), m - 1);
}

// ---------- Laser ----------

function addLaserPoint(ev) {
  const pr = els.pages.getBoundingClientRect();
  const t = ev.timeStamp > 0 && Math.abs(ev.timeStamp - performance.now()) < 1000 ? ev.timeStamp : performance.now();
  laserTrail.push({ x: ev.clientX - pr.left, y: ev.clientY - pr.top, t });
}

function startLaserLoop() {
  if (laserFrame) return;
  const tick = () => {
    const now = performance.now();
    const ctx = overlayCtx(els.tail, null);
    clearOverlay(els.tail);
    const pressing = !!(active && active.kind === 'laser');
    let alive;
    if (tools.laser.mode === 'dot') {
      const last = laserTrail[laserTrail.length - 1];
      const fade = pressing ? 1 : Math.max(0, 1 - (now - laserUp) / 220);
      if (last && fade > 0) drawLaserDot(ctx, last.x, last.y, fade);
      laserTrail = last ? [last] : [];
      alive = pressing || fade > 0;
      if (!alive) laserTrail = [];
    } else {
      // Keep the newest point while the Pencil rests, so the head stays lit.
      laserTrail = laserTrail.filter((p, i) => now - p.t < LASER_LIFE || (pressing && i === laserTrail.length - 1));
      if (pressing && laserTrail.length) laserTrail[laserTrail.length - 1].t = Math.max(laserTrail[laserTrail.length - 1].t, now - 30);
      if (laserTrail.length) drawLaser(ctx, laserTrail, now, pressing);
      alive = laserTrail.length || pressing;
    }
    if (alive) laserFrame = requestAnimationFrame(tick);
    else { laserFrame = 0; clearOverlay(els.tail); }
  };
  laserFrame = requestAnimationFrame(tick);
}

function eraseAt([x, y]) {
  const pg = pages.get(active.pageId);
  const r = tools.eraser.size / 2;
  const samples = [];
  if (active.last) {
    const [lx, ly] = active.last;
    const dist = Math.hypot(x - lx, y - ly);
    const steps = Math.max(1, Math.ceil(dist / (r * 0.8)));
    for (let i = 1; i <= steps; i++) samples.push([lx + ((x - lx) * i) / steps, ly + ((y - ly) * i) / steps]);
  } else samples.push([x, y]);
  active.last = [x, y];
  let changed = false;
  const changedBox = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [sx, sy] of samples) {
    let hitInk = false;
    for (let i = pg.strokes.length - 1; i >= 0; i--) {
      const st = pg.strokes[i];
      // Fills are only erased where no ink is being erased at the same spot.
      if (st.tool === 'fill') continue;
      if (hitStroke(st, sx, sy, r)) { removeForErase(pg, i, changedBox); hitInk = true; changed = true; }
    }
    if (!hitInk) {
      for (let i = pg.strokes.length - 1; i >= 0; i--) {
        if (pg.strokes[i].tool === 'fill' && hitStroke(pg.strokes[i], sx, sy, r)) { removeForErase(pg, i, changedBox); changed = true; break; }
      }
    }
  }
  if (changed) redrawArea(active.pageId, changedBox);
}

function removeForErase(pg, i, box) {
  const st = pg.strokes[i];
  const b = st.bbox || computeBBox(st);
  box[0] = Math.min(box[0], b[0]); box[1] = Math.min(box[1], b[1]);
  box[2] = Math.max(box[2], b[2]); box[3] = Math.max(box[3], b[3]);
  active.removed.push({ stroke: st, index: i });
  pg.strokes.splice(i, 1);
}

function drawEraserCursor([x, y]) {
  clearOverlay(els.tail);
  const ctx = active.tailCtx;
  ctx.beginPath();
  ctx.arc(x, y, tools.eraser.size / 2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(120,120,130,0.15)';
  ctx.strokeStyle = 'rgba(90,90,100,0.6)';
  ctx.lineWidth = 1 / scale;
  ctx.fill();
  ctx.stroke();
}

// ---------- Lasso ----------

function drawLassoPath() {
  clearOverlay(els.tail);
  const ctx = active.tailCtx;
  const pts = active.pts;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts) ctx.lineTo(x, y);
  ctx.fillStyle = 'rgba(47,111,223,0.06)';
  ctx.fill();
  ctx.setLineDash([6 / scale, 5 / scale]);
  ctx.strokeStyle = '#2f6fdf';
  ctx.lineWidth = 1.5 / scale;
  ctx.stroke();
  ctx.restore();
}

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function finishLasso(a) {
  const pg = pages.get(a.pageId);
  const pts = a.pts;
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  const strokeIds = new Set(), itemIds = new Set();
  if (len < 10) {
    // A tap: pick the topmost item or stroke under it.
    const [x, y] = pts[0];
    const item = [...pg.items].reverse().find((it) => hitItem(it, x, y, 4));
    if (item) itemIds.add(item.id);
    else {
      const st = [...pg.strokes].reverse().find((s) => hitStroke(s, x, y, 8));
      if (st) strokeIds.add(st.id);
    }
  } else {
    for (const s of pg.strokes) {
      const p = s.points;
      const n = p.length / 3;
      let inside = 0;
      for (let i = 0; i < n; i++) if (pointInPoly(p[i * 3], p[i * 3 + 1], pts)) inside++;
      if (inside / n >= 0.5) strokeIds.add(s.id);
    }
    for (const it of pg.items) {
      const [cx, cy] = itemCenter(it);
      if (pointInPoly(cx, cy, pts)) itemIds.add(it.id);
    }
  }
  makeSelection(a.pageId, strokeIds, itemIds);
}

// ---------- Selection ----------

function selectedObjects() {
  const pg = pages.get(sel.pageId);
  return {
    strokes: pg.strokes.filter((s) => sel.strokeIds.has(s.id)),
    items: pg.items.filter((it) => sel.itemIds.has(it.id)),
  };
}

function boundsOf(strokes, items) {
  let b = [Infinity, Infinity, -Infinity, -Infinity];
  const grow = (bb) => { b = [Math.min(b[0], bb[0]), Math.min(b[1], bb[1]), Math.max(b[2], bb[2]), Math.max(b[3], bb[3])]; };
  strokes.forEach((s) => grow(s.bbox || computeBBox(s)));
  items.forEach((it) => grow(itemBBox(it)));
  return b;
}

function makeSelection(pageId, strokeIds, itemIds) {
  clearSelection();
  if (!strokeIds.size && !itemIds.size) return;
  sel = { pageId, strokeIds, itemIds, tx: 0, ty: 0, s: 1, r: 0 };
  const { strokes, items } = selectedObjects();
  sel.bounds = boundsOf(strokes, items);
  rerenderPage(pageId);
  buildSelUI();
}

function clearSelection() {
  if (!sel) return;
  const s = sel;
  sel = null;
  if (s.box) s.box.remove();
  if (s.bar) s.bar.remove();
  els.popover.hidden = true;
  rerenderPage(s.pageId);
  renderItems(s.pageId);
}

function buildSelUI() {
  const v = views.get(sel.pageId);
  if (!v) return;
  if (sel.box) sel.box.remove();
  if (sel.bar) sel.bar.remove();
  const [x0, y0, x1, y1] = sel.bounds;
  const pad = 6;
  const box = document.createElement('div');
  box.className = 'sel-box';
  box.style.left = `${x0 * scale - pad}px`;
  box.style.top = `${y0 * scale - pad}px`;
  box.style.width = `${(x1 - x0) * scale + pad * 2}px`;
  box.style.height = `${(y1 - y0) * scale + pad * 2}px`;

  // Selected strokes are drawn once here; moving them only changes CSS.
  const { strokes } = selectedObjects();
  if (strokes.length) {
    const c = document.createElement('canvas');
    c.className = 'sel-ink';
    const cssW = (x1 - x0) * scale, cssH = (y1 - y0) * scale;
    const k = Math.min(dpr(), 4096 / Math.max(1, cssW), 4096 / Math.max(1, cssH));
    c.width = Math.max(1, Math.round(cssW * k));
    c.height = Math.max(1, Math.round(cssH * k));
    c.style.left = `${pad}px`;
    c.style.top = `${pad}px`;
    c.style.width = `${cssW}px`;
    c.style.height = `${cssH}px`;
    const ctx = c.getContext('2d');
    ctx.setTransform(k * scale, 0, 0, k * scale, -x0 * k * scale, -y0 * k * scale);
    drawStrokes(ctx, strokes);
    box.appendChild(c);
  }
  for (const h of ['nw', 'ne', 'se', 'sw']) {
    const el = document.createElement('div');
    el.className = `sel-handle h-${h}`;
    el.dataset.handle = 'scale';
    box.appendChild(el);
  }
  const rot = document.createElement('div');
  rot.className = 'sel-rotate';
  rot.dataset.handle = 'rotate';
  box.appendChild(rot);
  v.uiLayer.appendChild(box);
  sel.box = box;
  applySelCSS();

  const bar = buildSelBar();
  v.uiLayer.appendChild(bar);
  sel.bar = bar;
  const bw = bar.offsetWidth, bh = bar.offsetHeight;
  const cx = ((x0 + x1) / 2) * scale;
  let top = y0 * scale - pad - bh - 40;
  if (top < 4) top = y1 * scale + pad + 14;
  bar.style.left = `${Math.max(4, Math.min(cx - bw / 2, PAGE_W * scale - bw - 4))}px`;
  bar.style.top = `${top}px`;
}

function applySelCSS() {
  if (!sel || !sel.box) return;
  sel.box.style.transform = `translate(${sel.tx * scale}px, ${sel.ty * scale}px) rotate(${sel.r}rad) scale(${sel.s})`;
  sel.box.style.setProperty('--inv', String(1 / sel.s));
}

function selCenter() {
  const [x0, y0, x1, y1] = sel.bounds;
  return [(x0 + x1) / 2, (y0 + y1) / 2];
}

function currentSelMatrix() {
  const [cx, cy] = selCenter();
  return selectionMatrix(cx, cy, sel.tx, sel.ty, sel.s, sel.r);
}

function startSelTransform(e, target) {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  e.preventDefault();
  const v = views.get(sel.pageId);
  const rect = v.wrap.getBoundingClientRect();
  const handle = target.closest('[data-handle]');
  const how = handle ? handle.dataset.handle : 'move';
  const start = toPage(e, rect);
  const [cx, cy] = selCenter();
  const c0 = [cx + sel.tx, cy + sel.ty];
  const { items } = selectedObjects();
  active = {
    kind: 'sel', how, pointerId: e.pointerId, pointerType: e.pointerType, pageId: sel.pageId, rect, start, c0,
    t0: { tx: sel.tx, ty: sel.ty, s: sel.s, r: sel.r }, items: items.map((it) => ({ ...it })), moved: false,
  };
  try { els.pages.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  if (sel.bar) sel.bar.hidden = true;
}

function moveSelTransform(e) {
  const a = active;
  const [x, y] = toPage(e, a.rect);
  const [sx, sy] = a.start;
  if (Math.hypot(x - sx, y - sy) > 2) a.moved = true;
  if (a.how === 'move') {
    sel.tx = a.t0.tx + (x - sx);
    sel.ty = a.t0.ty + (y - sy);
  } else if (a.how === 'scale') {
    const d0 = Math.hypot(sx - a.c0[0], sy - a.c0[1]) || 1;
    const d1 = Math.hypot(x - a.c0[0], y - a.c0[1]);
    sel.s = Math.max(0.1, Math.min(10, a.t0.s * (d1 / d0)));
  } else if (a.how === 'rotate') {
    const a0 = Math.atan2(sy - a.c0[1], sx - a.c0[0]);
    const a1 = Math.atan2(y - a.c0[1], x - a.c0[0]);
    let r = a.t0.r + (a1 - a0);
    const q = Math.PI / 2;
    const snapped = Math.round(r / q) * q;
    if (Math.abs(r - snapped) < 0.06) r = snapped;
    sel.r = r;
  }
  applySelCSS();
  const m = currentSelMatrix();
  for (const it of a.items) {
    const el = itemEl(sel.pageId, it.id);
    if (el) renderItem(transformItem(it, m), el);
  }
}

function endSelTransform(a) {
  if (!sel) return;
  if (!a.moved) {
    sel.tx = a.t0.tx; sel.ty = a.t0.ty; sel.s = a.t0.s; sel.r = a.t0.r;
    applySelCSS();
    if (sel.bar) sel.bar.hidden = false;
    // A second tap on a single text box or note starts typing.
    const { strokes, items } = selectedObjects();
    if (!strokes.length && items.length === 1 && (items[0].type === 'text' || items[0].type === 'sticky')) {
      const it = items[0];
      const pageId = sel.pageId;
      clearSelection();
      startEditing(pageId, it, false);
    }
    return;
  }
  commitSelTransform();
}

function transformStroke(s, m, k) {
  const pts = s.points.slice();
  for (let i = 0; i < pts.length; i += 3) {
    const [x, y] = applyM(m, pts[i], pts[i + 1]);
    pts[i] = Math.round(x * 10) / 10;
    pts[i + 1] = Math.round(y * 10) / 10;
  }
  const n = { ...s, points: pts, size: s.size * k };
  computeBBox(n);
  return n;
}

// Replaces selected objects with edited copies, as one undo step.
function editSelection(fnStroke, fnItem) {
  const pg = pages.get(sel.pageId);
  const before = snapshot(pg);
  pg.strokes = pg.strokes.map((s) => (sel.strokeIds.has(s.id) && fnStroke ? fnStroke(s) : s));
  pg.items = pg.items.map((it) => (sel.itemIds.has(it.id) && fnItem ? fnItem(it) : it));
  pushUndo({ type: 'snap', pageId: sel.pageId, before, after: snapshot(pg) });
  markDirty(sel.pageId);
  refreshSelection();
}

function refreshSelection() {
  const { strokes, items } = selectedObjects();
  sel.tx = sel.ty = sel.r = 0;
  sel.s = 1;
  sel.bounds = boundsOf(strokes, items);
  renderItems(sel.pageId);
  rerenderPage(sel.pageId);
  buildSelUI();
}

function commitSelTransform() {
  const m = currentSelMatrix();
  const k = sel.s;
  editSelection((s) => transformStroke(s, m, k), (it) => transformItem(it, m));
}

function buildSelBar() {
  const bar = document.createElement('div');
  bar.className = 'sel-bar';
  const { strokes, items } = selectedObjects();
  const add = (label, onClick, cls = '') => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `sel-btn ${cls}`;
    b.textContent = label;
    b.addEventListener('click', onClick);
    bar.appendChild(b);
    return b;
  };
  const sep = () => { const s = document.createElement('span'); s.className = 'sel-sep'; bar.appendChild(s); };
  const onlyItem = !strokes.length && items.length === 1 ? items[0] : null;

  if (strokes.length || (onlyItem && onlyItem.type === 'text')) {
    const recolor = (c) => editSelection(
      (s) => ({ ...s, color: c }),
      (it) => (it.type === 'text' ? { ...it, color: c } : it),
    );
    const palette = strokes.length && strokes.every((s) => s.tool === 'highlighter') ? tools.highlighter.slots : tools.pen.slots;
    for (const c of palette) {
      const b = colorButton(c, false, false, () => recolor(c));
      b.classList.add('small');
      bar.appendChild(b);
    }
    const more = colorButton('#888', false, true, () => openColorPopover(more, palette[0], recolor));
    more.classList.add('small');
    bar.appendChild(more);
    sep();
  }
  if (strokes.length) {
    add('Thinner', () => editSelection((s) => { const n = { ...s, size: Math.max(0.8, s.size * 0.75) }; computeBBox(n); return n; }));
    add('Thicker', () => editSelection((s) => { const n = { ...s, size: Math.min(80, s.size * 1.33) }; computeBBox(n); return n; }));
    if (strokes.some((s) => s.tool === 'pen')) {
      const styleBtn = add('Style ▾', () => {
        if (!els.popover.hidden) { els.popover.hidden = true; return; }
        const firstPen = strokes.find((s) => s.tool === 'pen');
        stylePopover(styleBtn, {
          values: { type: firstPen.pen || 'fountain', dash: firstPen.dash || 'solid' },
          color: firstPen.color,
          showStab: false,
          onChange: (key, v) => editSelection((s) => (s.tool === 'pen' ? { ...s, [key === 'type' ? 'pen' : 'dash']: v } : s)),
        });
      }, 'sel-style');
    }
    sep();
  }
  if (onlyItem && onlyItem.type === 'text') {
    for (const sz of TEXT_SIZES) add(sz.label, () => editSelection(null, (it) => ({ ...it, fontSize: sz.v })));
    add('Edit', () => { const pageId = sel.pageId; clearSelection(); startEditing(pageId, onlyItem, false); });
    sep();
  }
  if (onlyItem && onlyItem.type === 'sticky') {
    for (const c of STICKY_COLORS) {
      const b = colorButton(c, onlyItem.color === c, false, () => editSelection(null, (it) => ({ ...it, color: c })));
      b.classList.add('small');
      bar.appendChild(b);
    }
    add('Edit', () => { const pageId = sel.pageId; clearSelection(); startEditing(pageId, onlyItem, false); });
    sep();
  }
  if (onlyItem && onlyItem.type === 'image') {
    add('Crop', () => { const pageId = sel.pageId; clearSelection(); startCrop(pageId, onlyItem); });
    sep();
  }
  add('Copy', copySelection);
  add('Duplicate', duplicateSelection);
  add('Delete', deleteSelection, 'danger');
  return bar;
}

function copySelection() {
  const { strokes, items } = selectedObjects();
  clipboard = { strokes: clone(strokes), items: clone(items), from: sel.pageId };
  showToast('Copied. Use Paste with the lasso tool.');
  if (tools.tool === 'lasso') renderToolbar();
}

function pasteObjects(pageId, strokes, items, dx, dy) {
  const pg = pages.get(pageId);
  const before = snapshot(pg);
  const ns = strokes.map((s) => {
    const n = transformStroke({ ...s, id: newId() }, [1, 0, 0, 1, dx, dy], 1);
    return n;
  });
  const ni = items.map((it) => ({ ...it, id: newId(), x: it.x + dx, y: it.y + dy }));
  pg.strokes.push(...ns);
  pg.items.push(...ni);
  pushUndo({ type: 'snap', pageId, before, after: snapshot(pg) });
  markDirty(pageId);
  renderItems(pageId);
  makeSelection(pageId, new Set(ns.map((s) => s.id)), new Set(ni.map((i) => i.id)));
}

function duplicateSelection() {
  const { strokes, items } = selectedObjects();
  const pageId = sel.pageId;
  clearSelection();
  pasteObjects(pageId, clone(strokes), clone(items), 24, 24);
}

function pasteClipboard() {
  if (!clipboard) return;
  const pageId = notebook.pageIds[currentPageIndex()];
  const v = views.get(pageId);
  const b = boundsOf(clipboard.strokes, clipboard.items);
  let dx = 24, dy = 24;
  if (pageId !== clipboard.from && v) {
    const region = visibleRegion(v);
    const cx = region ? (region.x + region.w / 2) / scale : PAGE_W / 2;
    const cy = region ? (region.y + region.h / 2) / scale : PAGE_H / 2;
    dx = cx - (b[0] + b[2]) / 2;
    dy = cy - (b[1] + b[3]) / 2;
  }
  pasteObjects(pageId, clone(clipboard.strokes), clone(clipboard.items), dx, dy);
}

function deleteSelection() {
  if (!sel) return;
  const pg = pages.get(sel.pageId);
  const before = snapshot(pg);
  pg.strokes = pg.strokes.filter((s) => !sel.strokeIds.has(s.id));
  pg.items = pg.items.filter((it) => !sel.itemIds.has(it.id));
  const pageId = sel.pageId;
  pushUndo({ type: 'snap', pageId, before, after: snapshot(pg) });
  markDirty(pageId);
  clearSelection();
}

// ---------- Text boxes and sticky notes ----------

function startEditing(pageId, item, isNew, before) {
  const pg = pages.get(pageId);
  const el = itemEl(pageId, item.id);
  if (!el) return;
  const body = el.querySelector('.item-body');
  editing = { pageId, id: item.id, type: item.type, isNew, before: before || snapshot(pg), el, body };
  el.classList.add('editing');
  body.contentEditable = 'true';
  body.spellcheck = true;
  body.focus();
  const range = document.createRange();
  range.selectNodeContents(body);
  range.collapse(false);
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(range);
  body.addEventListener('blur', onEditBlur);
}

function onEditBlur() {
  // Let taps on toolbar options (size, colour) keep the box open.
  setTimeout(() => {
    if (editing && document.activeElement !== editing.body && !els.toolbar.contains(document.activeElement)) finishEditing();
  }, 0);
}

function updateEditingItem(changes) {
  if (!editing) return;
  const pg = pages.get(editing.pageId);
  pg.items = pg.items.map((it) => (it.id === editing.id ? { ...it, ...changes } : it));
  const it = pg.items.find((x) => x.id === editing.id);
  renderItem(it, editing.el);
  editing.body.focus();
}

function finishEditing() {
  if (!editing) return;
  const ed = editing;
  editing = null;
  ed.body.removeEventListener('blur', onEditBlur);
  const text = ed.body.innerText.replace(/\n+$/, '');
  ed.body.contentEditable = 'false';
  ed.el.classList.remove('editing');
  if (document.activeElement === ed.body) ed.body.blur();
  const pg = pages.get(ed.pageId);
  if (!pg) return;
  if (!text.trim()) {
    pg.items = pg.items.filter((it) => it.id !== ed.id);
  } else {
    pg.items = pg.items.map((it) => {
      if (it.id !== ed.id) return it;
      const n = { ...it, text };
      if (it.type === 'text') n.h = Math.max(it.fontSize * 1.4, ed.el.offsetHeight);
      return n;
    });
  }
  renderItems(ed.pageId);
  const after = snapshot(pg);
  if (JSON.stringify(after) !== JSON.stringify(ed.before)) {
    pushUndo({ type: 'snap', pageId: ed.pageId, before: ed.before, after });
    markDirty(ed.pageId);
  }
}

// ---------- Images ----------

async function onImagePicked() {
  const file = els.imageInput.files && els.imageInput.files[0];
  if (!file || !notebook) return;
  if (mode !== 'edit') setMode('edit', { quiet: true });
  const pageId = notebook.pageIds[currentPageIndex()];
  const v = views.get(pageId);
  const region = v ? visibleRegion(v) : null;
  const cx = region ? (region.x + region.w / 2) / scale : PAGE_W / 2;
  const cy = region ? (region.y + region.h / 2) / scale : PAGE_H / 2;
  try {
    showToast('Adding image…');
    const item = await imageItemFromFile(file, cx, cy, 600);
    const pg = pages.get(pageId);
    const before = snapshot(pg);
    pg.items.push(item);
    pushUndo({ type: 'snap', pageId, before, after: snapshot(pg) });
    markDirty(pageId);
    renderItems(pageId);
    tools.tool = 'lasso';
    saveTools();
    renderToolbar();
    makeSelection(pageId, new Set(), new Set([item.id]));
    showToast('Image added. Drag to move, use the corners to resize.');
  } catch (err) {
    showToast('That image could not be opened.');
  }
}

function startCrop(pageId, item) {
  const cr = item.crop || { x: 0, y: 0, w: 1, h: 1 };
  const fw = item.w / cr.w, fh = item.h / cr.h;
  cropping = {
    pageId, id: item.id, item,
    full: [-cr.x * fw, -cr.y * fh, -cr.x * fw + fw, -cr.y * fh + fh],
    rect: [0, 0, item.w, item.h],
  };
  renderCropUI();
}

function renderCropUI() {
  const c = cropping;
  const el = itemEl(c.pageId, c.id);
  if (!el) return;
  el.classList.add('cropping');
  let ui = el.querySelector('.crop-ui');
  if (!ui) {
    ui = document.createElement('div');
    ui.className = 'crop-ui';
    const ghost = document.createElement('img');
    ghost.className = 'crop-ghost';
    ghost.alt = '';
    blobUrl(c.item.blobId).then((u) => { ghost.src = u; });
    const frame = document.createElement('div');
    frame.className = 'crop-frame';
    for (const edge of ['n', 's', 'e', 'w', 'nw', 'ne', 'se', 'sw']) {
      const h = document.createElement('div');
      h.className = `crop-h ch-${edge}`;
      h.dataset.edge = edge;
      frame.appendChild(h);
    }
    const move = document.createElement('div');
    move.className = 'crop-move';
    move.dataset.edge = 'move';
    frame.appendChild(move);
    ui.append(ghost, frame);
    el.appendChild(ui);
    const v = views.get(c.pageId);
    const bar = document.createElement('div');
    bar.className = 'crop-bar sel-bar';
    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'sel-btn';
    done.textContent = 'Done';
    done.addEventListener('click', () => finishCrop(true));
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'sel-btn';
    reset.textContent = 'Reset';
    reset.addEventListener('click', () => { c.rect = c.full.slice(); renderCropUI(); });
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'sel-btn';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => finishCrop(false));
    bar.append(cancel, reset, done);
    v.uiLayer.appendChild(bar);
    c.bar = bar;
  }
  const [fl, ft, fr, fb] = c.full;
  const ghost = ui.querySelector('.crop-ghost');
  Object.assign(ghost.style, { left: `${fl}px`, top: `${ft}px`, width: `${fr - fl}px`, height: `${fb - ft}px` });
  const [l, t, r, b] = c.rect;
  const frame = ui.querySelector('.crop-frame');
  Object.assign(frame.style, { left: `${l}px`, top: `${t}px`, width: `${r - l}px`, height: `${b - t}px` });
  frame.style.setProperty('--inv', String(1 / scale));
  const img = el.querySelector('img.item-img');
  img.style.clipPath = `inset(${t - ft}px ${fr - r}px ${fb - b}px ${l - fl}px)`;
  const bb = itemBBox(c.item);
  c.bar.style.left = `${((bb[0] + bb[2]) / 2) * scale - c.bar.offsetWidth / 2}px`;
  c.bar.style.top = `${Math.max(4, bb[1] * scale - c.bar.offsetHeight - 16)}px`;
}

function startCropDrag(e, handle) {
  e.preventDefault();
  const c = cropping;
  const v = views.get(c.pageId);
  const rect = v.wrap.getBoundingClientRect();
  active = {
    kind: 'crop', pointerId: e.pointerId, pointerType: e.pointerType, pageId: c.pageId, rect,
    edge: handle ? handle.dataset.edge : 'move', start: toItemLocal(c.item, ...toPage(e, rect)), r0: c.rect.slice(),
  };
  try { els.pages.setPointerCapture(e.pointerId); } catch { /* ignore */ }
}

function moveCropDrag(e) {
  const c = cropping;
  const a = active;
  const [lx, ly] = toItemLocal(c.item, ...toPage(e, a.rect));
  const dx = lx - a.start[0], dy = ly - a.start[1];
  const [fl, ft, fr, fb] = c.full;
  let [l, t, r, b] = a.r0;
  const MIN = 20;
  if (a.edge === 'move') {
    const w = r - l, h = b - t;
    l = Math.max(fl, Math.min(fr - w, l + dx));
    t = Math.max(ft, Math.min(fb - h, t + dy));
    r = l + w; b = t + h;
  } else {
    if (a.edge.includes('w')) l = Math.max(fl, Math.min(r - MIN, l + dx));
    if (a.edge.includes('e')) r = Math.min(fr, Math.max(l + MIN, r + dx));
    if (a.edge.includes('n')) t = Math.max(ft, Math.min(b - MIN, t + dy));
    if (a.edge.includes('s')) b = Math.min(fb, Math.max(t + MIN, b + dy));
  }
  c.rect = [l, t, r, b];
  renderCropUI();
}

function finishCrop(apply) {
  if (!cropping) return;
  const c = cropping;
  cropping = null;
  if (c.bar) c.bar.remove();
  const el = itemEl(c.pageId, c.id);
  if (el) {
    el.classList.remove('cropping');
    const ui = el.querySelector('.crop-ui');
    if (ui) ui.remove();
    const img = el.querySelector('img.item-img');
    if (img) img.style.clipPath = '';
  }
  const [l, t, r, b] = c.rect;
  const changed = l !== 0 || t !== 0 || r !== c.item.w || b !== c.item.h;
  if (!apply || !changed) { renderItems(c.pageId); return; }
  const pg = pages.get(c.pageId);
  const before = snapshot(pg);
  const it = c.item;
  const [fl, ft, fr, fb] = c.full;
  const fw = fr - fl, fh = fb - ft;
  const nw = r - l, nh = b - t;
  // Keep the visible part where it was, accounting for rotation.
  const dxl = (l + r) / 2 - it.w / 2, dyl = (t + b) / 2 - it.h / 2;
  const cos = Math.cos(it.rot || 0), sin = Math.sin(it.rot || 0);
  const [cx, cy] = itemCenter(it);
  const ncx = cx + dxl * cos - dyl * sin, ncy = cy + dxl * sin + dyl * cos;
  const n = {
    ...it, w: nw, h: nh, x: ncx - nw / 2, y: ncy - nh / 2,
    crop: { x: (l - fl) / fw, y: (t - ft) / fh, w: nw / fw, h: nh / fh },
  };
  pg.items = pg.items.map((x) => (x.id === it.id ? n : x));
  pushUndo({ type: 'snap', pageId: c.pageId, before, after: snapshot(pg) });
  markDirty(c.pageId);
  renderItems(c.pageId);
}

// ---------- Undo / redo ----------

function snapshot(pg) {
  return { strokes: pg.strokes.slice(), items: (pg.items || []).slice() };
}

function pushUndo(op) {
  undoStack.push(op);
  if (undoStack.length > 300) undoStack.shift();
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
  } else if (op.type === 'snap') {
    const src = reverse ? op.before : op.after;
    pg.strokes = src.strokes.slice();
    pg.items = src.items.slice();
    renderItems(op.pageId);
  }
  rerenderPage(op.pageId);
  markDirty(op.pageId);
}

function undo() {
  if (active) return;
  finishEditing();
  finishCrop(false);
  clearSelection();
  const op = undoStack.pop();
  if (!op) return;
  applyOp(op, true);
  redoStack.push(op);
  updateUndoButtons();
}

function redo() {
  if (active) return;
  finishEditing();
  finishCrop(false);
  clearSelection();
  const op = redoStack.pop();
  if (!op) return;
  applyOp(op, false);
  undoStack.push(op);
  updateUndoButtons();
}

// ---------- Pages ----------

async function addPageAfter(index) {
  await flushSaves();
  let ref = pages.get(notebook.pageIds[index]);
  if (isCover(ref)) ref = pages.get(notebook.pageIds[1]);
  ref = ref || {};
  const pg = blankPage(notebook.id, ref.paper || notebook.paper || 'lined', ref.paperColor || 'cream');
  pg.items = [];
  await addPageToNotebook(notebook.id, pg, index + 1);
  notebook.pageIds.splice(index + 1, 0, pg.id);
  pages.set(pg.id, pg);
  buildPages();
  goToPage(index + 1, { smooth: false });
  showToast(`Page ${index + 1} added`);
}

function pageMenuItems(pageId) {
  const index = notebook.pageIds.indexOf(pageId);
  const pg = pages.get(pageId);
  const cover = isCover(pg);
  return [
    { icon: ICONS.bookmark, label: pg.bookmarked ? 'Remove bookmark' : 'Bookmark', onClick: () => toggleBookmark(pageId) },
    { icon: ICONS.template, label: 'Template', onClick: () => templateSheet(pageId), hidden: cover },
    { icon: ICONS.addPage, label: 'Add page after', onClick: () => addPageAfter(index) },
    { icon: ICONS.clear, label: cover ? 'Clear cover' : 'Clear page', danger: true, onClick: () => clearPage(pageId) },
    { icon: ICONS.trash, label: 'Delete page', danger: true, onClick: () => deletePage(pageId), hidden: cover },
  ];
}

function pageMenu(pageId, anchor) {
  const index = notebook.pageIds.indexOf(pageId);
  openMenu(pageLabel(index), pageMenuItems(pageId), anchor);
}

function clearPage(pageId) {
  const pg = pages.get(pageId);
  if (!pg.strokes.length && !pg.items.length) return;
  if (sel && sel.pageId === pageId) clearSelection();
  const before = snapshot(pg);
  pg.strokes = [];
  pg.items = [];
  pushUndo({ type: 'snap', pageId, before, after: snapshot(pg) });
  renderItems(pageId);
  rerenderPage(pageId);
  markDirty(pageId);
}

async function deletePage(pageId) {
  const index = notebook.pageIds.indexOf(pageId);
  const ok = await confirmSheet(`Delete ${pageLabel(index).toLowerCase()}?`, 'This page and its writing will be removed.');
  if (!ok) return;
  await flushSaves();
  await removePageFromNotebook(notebook.id, pageId);
  notebook.pageIds.splice(index, 1);
  pages.delete(pageId);
  undoStack = undoStack.filter((op) => op.pageId !== pageId);
  redoStack = redoStack.filter((op) => op.pageId !== pageId);
  if (notebook.pageIds.length < 2) {
    const pg = blankPage(notebook.id, notebook.paper || 'lined');
    pg.items = [];
    await addPageToNotebook(notebook.id, pg);
    notebook.pageIds.push(pg.id);
    pages.set(pg.id, pg);
  }
  updateUndoButtons();
  const top = els.pages.scrollTop;
  buildPages();
  els.pages.scrollTop = top;
}

function templateSheet(pageId) {
  const targetPages = pageId ? [pages.get(pageId)] : notebook.pageIds.map((id) => pages.get(id)).filter((p) => !isCover(p));
  const first = targetPages[0];
  let chosen = first.paper || 'lined';
  let color = first.paperColor || 'cream';

  const d = document.createElement('dialog');
  d.className = 'sheet';
  d.innerHTML = `<h2></h2>
    <div class="field"><span>Template</span><div class="papers papers-6"></div></div>
    <div class="field"><span>Paper colour</span><div class="swatches paper-colors"></div></div>
    <div class="actions"><button type="button" class="btn btn-ghost" data-cancel>Cancel</button>
    <button type="button" class="btn btn-primary" data-ok>Apply</button></div>`;
  d.querySelector('h2').textContent = pageId
    ? `Template for ${pageLabel(notebook.pageIds.indexOf(pageId)).toLowerCase()}`
    : 'Template for all pages';
  const grid = d.querySelector('.papers');
  const colors = d.querySelector('.paper-colors');
  const render = () => {
    grid.replaceChildren();
    for (const t of TEMPLATES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'paper-option';
      b.setAttribute('aria-checked', String(t.id === chosen));
      const sw = document.createElement('span');
      sw.className = 'paper-swatch';
      applyPaper(sw, { paper: t.id, paperColor: color }, notebook, 0.09);
      b.append(sw, document.createTextNode(t.label));
      b.addEventListener('click', () => { chosen = t.id; render(); });
      grid.appendChild(b);
    }
    colors.replaceChildren();
    for (const c of PAPER_COLORS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.style.background = c.value;
      b.setAttribute('aria-label', c.label);
      b.setAttribute('aria-checked', String(c.id === color));
      b.addEventListener('click', () => { color = c.id; render(); });
      colors.appendChild(b);
    }
  };
  render();
  document.body.appendChild(d);
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  d.addEventListener('close', () => setTimeout(() => d.remove(), 0));
  d.querySelector('[data-cancel]').addEventListener('click', () => d.close());
  d.querySelector('[data-ok]').addEventListener('click', async () => {
    d.close();
    for (const pg of targetPages) { pg.paper = chosen; pg.paperColor = color; }
    if (!pageId) await updateNotebook(notebook.id, { paper: chosen }, { touch: false });
    await savePages(targetPages);
    relayout();
    if (!els.thumbs.hidden) buildThumbs();
    showToast(pageId ? 'Template changed' : 'Template changed for all pages');
  });
  d.showModal();
}

// ---------- Cover thumbnail for the library ----------

export async function renderCoverThumb(nb, cover) {
  const w = 300, h = Math.round(w * PAGE_H / PAGE_W);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = nb.cover;
  ctx.fillRect(0, 0, w, h);
  ctx.setTransform(w / PAGE_W, 0, 0, w / PAGE_W, 0, 0);
  await drawItems(ctx, cover.items);
  drawStrokes(ctx, cover.strokes);
  return c.toDataURL('image/jpeg', 0.85);
}

async function updateCoverThumb() {
  if (!notebook) return;
  const cover = pages.get(notebook.pageIds[0]);
  if (!isCover(cover)) return;
  const has = cover.strokes.length || (cover.items && cover.items.length);
  const thumb = has ? await renderCoverThumb(notebook, cover) : null;
  if (thumb !== (notebook.thumb || null)) {
    notebook.thumb = thumb;
    await updateNotebook(notebook.id, { thumb }, { touch: false });
  }
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
    if (!els.thumbs.hidden) ids.forEach(renderThumb);
  } catch (err) {
    ids.forEach((id) => dirty.add(id));
    showToast('Could not save. Check free space on your iPad.');
  }
}
