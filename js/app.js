import {
  listNotebooks, getNotebook, createNotebook, updateNotebook, deleteNotebook, requestPersistentStorage,
  listFolders, getFolder, createFolder, updateFolder, deleteFolderDeep,
} from './db.js';
import { getSettings, setSetting, applyTheme } from './settings.js';
import { showToast, openMenu, confirmSheet, promptSheet, pickSheet, ICONS } from './ui.js';
import { initEditor, openEditor, closeEditor, renderCoverThumb } from './editor.js';
import { TEMPLATES, applyPaper } from './templates.js';
import { getPage } from './db.js';

const COVERS = ['#2f6fdf', '#1f9d8b', '#e0a526', '#d9503f', '#8a5cd6', '#3d4a5c', '#c46a9b', '#6a9f3a', '#1c1c1e', '#b0743c'];
const FOLDER_COLORS = ['#5b9df9', '#4cc3d9', '#55c27a', '#f5c33b', '#f59a3b', '#ef6461', '#e86fae', '#9b7bf0', '#8e8e93', '#3d4a5c'];
const PAPERS = TEMPLATES;

const $ = (id) => document.getElementById(id);
const els = {
  libraryView: $('library-view'),
  notebookView: $('notebook-view'),
  grid: $('item-grid'),
  empty: $('empty-state'),
  emptyTitle: $('empty-title'),
  emptyText: $('empty-text'),
  emptyCreateBtn: $('empty-create-btn'),
  newBtn: $('new-btn'),
  folderBack: $('folder-back-btn'),
  breadcrumb: $('breadcrumb'),
  settingsBtn: $('settings-btn'),
  selectBtn: $('select-btn'),
  trashBtn: $('trash-btn'),
  selectBar: $('select-bar'),
  selectCount: $('select-count'),
  selectAll: $('select-all-btn'),
  selectMove: $('select-move-btn'),
  selectTrash: $('select-trash-btn'),
  selectDone: $('select-done-btn'),
  trashDialog: $('trash-dialog'),
  trashList: $('trash-list'),
  emptyTrashBtn: $('empty-trash-btn'),
  darkPagesOptions: $('dark-pages-options'),
  storageStatus: $('storage-status'),
  versionLabel: $('version-label'),
  nbDialog: $('notebook-dialog'),
  nbForm: $('notebook-form'),
  nbDialogTitle: $('notebook-dialog-title'),
  nbTitle: $('nb-title'),
  nbSubmit: $('nb-submit'),
  coverOptions: $('cover-options'),
  paperOptions: $('paper-options'),
  paperFieldset: $('paper-fieldset'),
  settingsDialog: $('settings-dialog'),
  themeOptions: $('theme-options'),
  fingerToggle: $('finger-toggle'),
  openModeOptions: $('open-mode-options'),
  settingsStorage: $('settings-storage'),
  settingsVersion: $('settings-version'),
};

const state = {
  folderId: null,    // folder being shown in the library (null = top level)
  editingId: null,   // notebook being edited in the dialog
  cover: COVERS[0],
  paper: 'lined',
  version: '',
  selecting: false,
  selected: new Set(),
  visible: [],
};

// ---------- Helpers ----------

function formatDate(ts) {
  const d = new Date(ts);
  if (d.toDateString() === new Date().toDateString()) {
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function wireDialog(dialog) {
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  dialog.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dialog.close()));
}

function folderPath(folders, id) {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path = [];
  let cur = byId.get(id);
  while (cur) { path.unshift(cur); cur = cur.parentId ? byId.get(cur.parentId) : null; }
  return path;
}

function descendantsOf(folders, id) {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) if (f.parentId && out.has(f.parentId) && !out.has(f.id)) { out.add(f.id); grew = true; }
  }
  return out;
}

function folderTreeOptions(folders, exclude = new Set()) {
  const opts = [{ id: null, label: 'Library (top level)', depth: 0, root: true }];
  const walk = (parentId, depth) => {
    for (const f of folders.filter((x) => (x.parentId || null) === parentId)) {
      if (exclude.has(f.id)) continue;
      opts.push({ id: f.id, label: f.name, depth: depth + 1 });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return opts;
}

// ---------- Library ----------

const TRASH_DAYS = 30;
const live = (x) => !x.trashedAt;

async function renderLibrary() {
  const [allFolders, allNotebooks] = await Promise.all([listFolders(), listNotebooks()]);
  const folders = allFolders.filter(live);
  const notebooks = allNotebooks.filter(live);
  if (state.folderId && !folders.some((f) => f.id === state.folderId)) state.folderId = null;

  // Breadcrumb
  const path = state.folderId ? folderPath(folders, state.folderId) : [];
  els.breadcrumb.replaceChildren();
  const crumbs = [{ id: null, name: 'MyNotes' }, ...path];
  crumbs.forEach((c, i) => {
    const last = i === crumbs.length - 1;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'crumb' + (last ? ' current' : '') + (i === 0 ? ' brand' : '');
    b.textContent = c.name;
    if (!last) b.addEventListener('click', () => goToFolder(c.id));
    els.breadcrumb.appendChild(b);
    if (!last) {
      const sep = document.createElement('span');
      sep.className = 'crumb-sep';
      sep.textContent = '›';
      els.breadcrumb.appendChild(sep);
    }
  });
  els.folderBack.hidden = !state.folderId;

  const here = (x) => (x || null) === state.folderId;
  const subfolders = folders.filter((f) => here(f.parentId));
  const books = notebooks.filter((n) => here(n.folderId));
  state.visible = [...subfolders.map((f) => `f:${f.id}`), ...books.map((n) => `n:${n.id}`)];
  for (const k of [...state.selected]) if (!state.visible.includes(k)) state.selected.delete(k);

  els.grid.replaceChildren();
  els.grid.classList.toggle('selecting', state.selecting);
  const empty = subfolders.length === 0 && books.length === 0;
  els.empty.hidden = !empty;
  if (empty) {
    els.emptyTitle.textContent = state.folderId ? 'This folder is empty' : 'No notebooks yet';
    els.emptyText.textContent = 'Tap + to create a notebook or a folder.';
  }

  for (const f of subfolders) {
    const count = folders.filter((x) => x.parentId === f.id).length + notebooks.filter((n) => n.folderId === f.id).length;
    els.grid.appendChild(card({
      key: `f:${f.id}`,
      kind: 'folder',
      title: f.name,
      sub: count === 1 ? '1 item' : `${count} items`,
      color: f.color,
      onOpen: () => goToFolder(f.id),
      onMore: (anchor) => folderActions(f, folders, anchor),
    }));
  }
  for (const nb of books) {
    els.grid.appendChild(card({
      key: `n:${nb.id}`,
      kind: 'notebook',
      title: nb.title,
      sub: formatDate(nb.updatedAt),
      color: nb.cover,
      thumb: nb.thumb,
      onOpen: () => openNotebook(nb.id),
      onMore: (anchor) => notebookActions(nb, folders, anchor),
    }));
  }
  updateSelectBar();
  updateTrashButton(allFolders, allNotebooks);
}

function card({ key, kind, title, sub, color, thumb, onOpen, onMore }) {
  const li = document.createElement('li');
  li.className = `card card-${kind}` + (state.selected.has(key) ? ' picked' : '');
  li.dataset.key = key;
  const open = document.createElement('button');
  open.type = 'button';
  open.className = kind === 'folder' ? 'folder-art' : 'cover';
  open.style.setProperty('--c', color);
  if (thumb) {
    open.classList.add('has-thumb');
    open.style.backgroundImage = `url("${thumb}")`;
  }
  open.setAttribute('aria-label', `Open ${title}`);
  open.addEventListener('click', () => {
    if (state.selecting) { toggleSelected(key); return; }
    onOpen();
  });
  const check = document.createElement('span');
  check.className = 'pick-check';
  check.innerHTML = ICONS.check;

  const meta = document.createElement('button');
  meta.type = 'button';
  meta.className = 'card-meta';
  meta.setAttribute('aria-label', `Options for ${title}`);
  const t = document.createElement('span');
  t.className = 'card-title';
  t.textContent = title;
  const chev = document.createElement('span');
  chev.className = 'card-chev';
  chev.setAttribute('aria-hidden', 'true');
  const s = document.createElement('span');
  s.className = 'card-date';
  s.textContent = sub;
  meta.append(t, chev, s);
  meta.addEventListener('click', () => {
    if (state.selecting) { toggleSelected(key); return; }
    onMore(meta);
  });
  const art = document.createElement('div');
  art.className = 'card-art';
  art.append(open, check);
  li.append(art, meta);
  return li;
}

function goToFolder(id, { push = true } = {}) {
  state.folderId = id;
  state.selected.clear();
  if (push) history.pushState({ folder: id }, '');
  renderLibrary();
}

// ---------- Select mode ----------

function setSelecting(on) {
  state.selecting = on;
  state.selected.clear();
  els.selectBtn.hidden = on;
  els.selectBar.hidden = !on;
  els.newBtn.disabled = on;
  renderLibrary();
}

function toggleSelected(key) {
  if (state.selected.has(key)) state.selected.delete(key); else state.selected.add(key);
  const li = els.grid.querySelector(`[data-key="${key}"]`);
  if (li) li.classList.toggle('picked', state.selected.has(key));
  updateSelectBar();
}

function updateSelectBar() {
  const n = state.selected.size;
  els.selectCount.textContent = n === 1 ? '1 selected' : `${n} selected`;
  els.selectMove.disabled = !n;
  els.selectTrash.disabled = !n;
  const all = state.visible.length && state.visible.every((k) => state.selected.has(k));
  els.selectAll.textContent = all ? 'Deselect all' : 'Select all';
}

function selectedIds() {
  const folders = [], notebooks = [];
  for (const k of state.selected) (k.startsWith('f:') ? folders : notebooks).push(k.slice(2));
  return { folders, notebooks };
}

async function moveSelected() {
  const { folders: fIds, notebooks: nIds } = selectedIds();
  const folders = (await listFolders()).filter(live);
  const exclude = new Set();
  for (const id of fIds) for (const d of descendantsOf(folders, id)) exclude.add(d);
  const n = fIds.length + nIds.length;
  const target = await pickSheet(n === 1 ? 'Move 1 item to' : `Move ${n} items to`, folderTreeOptions(folders, exclude));
  if (target === undefined) return;
  for (const id of nIds) await updateNotebook(id, { folderId: target }, { touch: false });
  for (const id of fIds) await updateFolder(id, { parentId: target });
  showToast('Moved');
  setSelecting(false);
}

async function trashSelected() {
  const { folders: fIds, notebooks: nIds } = selectedIds();
  const now = Date.now();
  for (const id of nIds) await updateNotebook(id, { trashedAt: now }, { touch: false });
  for (const id of fIds) await updateFolder(id, { trashedAt: now });
  const n = fIds.length + nIds.length;
  showToast(n === 1 ? 'Moved to Trash' : `${n} items moved to Trash`, {
    label: 'Undo',
    onClick: async () => {
      for (const id of nIds) await updateNotebook(id, { trashedAt: null }, { touch: false });
      for (const id of fIds) await updateFolder(id, { trashedAt: null });
      renderLibrary();
    },
  });
  setSelecting(false);
}

// ---------- Actions ----------

function newMenu() {
  openMenu('', [
    { icon: ICONS.cover, label: 'Notebook', onClick: openCreateDialog },
    { icon: ICONS.folder, label: 'Folder', onClick: newFolder },
  ], els.newBtn);
}

async function newFolder() {
  const name = await promptSheet('New folder', { placeholder: 'New folder', okLabel: 'Create' });
  if (!name) return;
  await createFolder({ name, parentId: state.folderId, color: FOLDER_COLORS[Math.floor(Math.random() * FOLDER_COLORS.length)] });
  renderLibrary();
}

async function moveToTrash(kind, item) {
  if (kind === 'notebook') await updateNotebook(item.id, { trashedAt: Date.now() }, { touch: false });
  else await updateFolder(item.id, { trashedAt: Date.now() });
  showToast('Moved to Trash', {
    label: 'Undo',
    onClick: async () => {
      if (kind === 'notebook') await updateNotebook(item.id, { trashedAt: null }, { touch: false });
      else await updateFolder(item.id, { trashedAt: null });
      renderLibrary();
    },
  });
  renderLibrary();
}

function notebookActions(nb, folders, anchor) {
  openMenu('', [
    {
      icon: ICONS.rename, label: 'Rename',
      onClick: async () => {
        const name = await promptSheet('Rename notebook', { value: nb.title, okLabel: 'Rename' });
        if (!name) return;
        await updateNotebook(nb.id, { title: name }, { touch: false });
        renderLibrary();
      },
    },
    { icon: ICONS.cover, label: 'Change cover', onClick: () => openEditDialog(nb) },
    { icon: ICONS.move, label: 'Move', onClick: () => moveNotebook(nb, folders) },
    { sep: true },
    { icon: ICONS.trash, label: 'Move to Trash', danger: true, onClick: () => moveToTrash('notebook', nb) },
  ], anchor);
}

async function moveNotebook(nb, folders) {
  const target = await pickSheet(`Move “${nb.title}” to`, folderTreeOptions(folders));
  if (target === undefined) return;
  await updateNotebook(nb.id, { folderId: target }, { touch: false });
  showToast('Moved');
  renderLibrary();
}

function colorSheet(title, colors, current) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'sheet sheet-small';
    document.body.appendChild(d);
    let result = null;
    const h = document.createElement('h2');
    h.textContent = title;
    const row = document.createElement('div');
    row.className = 'swatches';
    for (const c of colors) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.style.background = c;
      b.setAttribute('aria-label', c);
      b.setAttribute('aria-checked', String(c === current));
      b.addEventListener('click', () => { result = c; d.close(); });
      row.appendChild(b);
    }
    d.append(h, row);
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
    d.addEventListener('close', () => { resolve(result); setTimeout(() => d.remove(), 0); });
    d.showModal();
  });
}

function folderActions(f, folders, anchor) {
  openMenu('', [
    {
      icon: ICONS.rename, label: 'Rename',
      onClick: async () => {
        const name = await promptSheet('Rename folder', { value: f.name, okLabel: 'Rename' });
        if (!name) return;
        await updateFolder(f.id, { name });
        renderLibrary();
      },
    },
    {
      icon: ICONS.palette, label: 'Colour',
      onClick: async () => {
        const c = await colorSheet('Folder colour', FOLDER_COLORS, f.color);
        if (!c) return;
        await updateFolder(f.id, { color: c });
        renderLibrary();
      },
    },
    {
      icon: ICONS.move, label: 'Move',
      onClick: async () => {
        const target = await pickSheet(`Move “${f.name}” to`, folderTreeOptions(folders, descendantsOf(folders, f.id)));
        if (target === undefined) return;
        await updateFolder(f.id, { parentId: target });
        showToast('Moved');
        renderLibrary();
      },
    },
    { sep: true },
    { icon: ICONS.trash, label: 'Move to Trash', danger: true, onClick: () => moveToTrash('folder', f) },
  ], anchor);
}

// ---------- Trash ----------

function updateTrashButton(folders, notebooks) {
  const n = folders.filter((f) => f.trashedAt).length + notebooks.filter((x) => x.trashedAt).length;
  els.trashBtn.classList.toggle('has-items', n > 0);
}

async function purgeOldTrash() {
  const limit = Date.now() - TRASH_DAYS * 864e5;
  for (const nb of await listNotebooks()) if (nb.trashedAt && nb.trashedAt < limit) await deleteNotebook(nb.id);
  for (const f of await listFolders()) if (f.trashedAt && f.trashedAt < limit) await deleteFolderDeep(f.id);
}

async function renderTrash() {
  const [folders, notebooks] = await Promise.all([listFolders(), listNotebooks()]);
  const list = els.trashList;
  list.replaceChildren();
  const rows = [
    ...folders.filter((f) => f.trashedAt).map((f) => ({ kind: 'folder', item: f, title: f.name, color: f.color })),
    ...notebooks.filter((n) => n.trashedAt).map((n) => ({ kind: 'notebook', item: n, title: n.title, color: n.cover, thumb: n.thumb })),
  ].sort((a, b) => b.item.trashedAt - a.item.trashedAt);
  els.emptyTrashBtn.disabled = !rows.length;
  if (!rows.length) {
    const li = document.createElement('li');
    li.className = 'trash-empty';
    li.textContent = 'Trash is empty.';
    list.appendChild(li);
    return;
  }
  for (const r of rows) {
    const li = document.createElement('li');
    li.className = 'trash-row';
    const art = document.createElement('span');
    art.className = r.kind === 'folder' ? 'trash-art folder' : 'trash-art';
    art.style.setProperty('--c', r.color);
    if (r.thumb) art.style.backgroundImage = `url("${r.thumb}")`;
    const text = document.createElement('span');
    text.className = 'trash-text';
    const t = document.createElement('strong');
    t.textContent = r.title;
    const days = Math.max(0, TRASH_DAYS - Math.floor((Date.now() - r.item.trashedAt) / 864e5));
    const sub = document.createElement('small');
    sub.textContent = days === 1 ? 'Deleted in 1 day' : `Deleted in ${days} days`;
    text.append(t, sub);
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'icon-btn small';
    restore.innerHTML = ICONS.restore;
    restore.setAttribute('aria-label', `Restore ${r.title}`);
    restore.addEventListener('click', async () => {
      if (r.kind === 'folder') await updateFolder(r.item.id, { trashedAt: null });
      else {
        // Restore to the top level if its folder is gone.
        const parentOk = !r.item.folderId || folders.some((f) => f.id === r.item.folderId && !f.trashedAt);
        await updateNotebook(r.item.id, { trashedAt: null, ...(parentOk ? {} : { folderId: null }) }, { touch: false });
      }
      renderTrash();
      renderLibrary();
    });
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'icon-btn small danger';
    del.innerHTML = ICONS.trash;
    del.setAttribute('aria-label', `Delete ${r.title} for good`);
    del.addEventListener('click', async () => {
      const ok = await confirmSheet(`Delete “${r.title}” for good?`, 'This cannot be undone.');
      if (!ok) return;
      if (r.kind === 'folder') await deleteFolderDeep(r.item.id); else await deleteNotebook(r.item.id);
      renderTrash();
      renderLibrary();
    });
    li.append(art, text, restore, del);
    list.appendChild(li);
  }
}

async function openTrash() {
  await renderTrash();
  els.trashDialog.showModal();
}

async function emptyTrash() {
  const ok = await confirmSheet('Empty Trash?', 'Everything in the Trash will be deleted for good.', 'Empty Trash');
  if (!ok) return;
  for (const nb of await listNotebooks()) if (nb.trashedAt) await deleteNotebook(nb.id);
  for (const f of await listFolders()) if (f.trashedAt) await deleteFolderDeep(f.id);
  renderTrash();
  renderLibrary();
}

// ---------- Create / edit notebook dialog ----------

function renderPickers() {
  els.coverOptions.replaceChildren();
  for (const c of COVERS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.style.background = c;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', `Cover colour ${c}`);
    b.setAttribute('aria-checked', String(c === state.cover));
    b.addEventListener('click', () => { state.cover = c; renderPickers(); });
    els.coverOptions.appendChild(b);
  }
  els.paperOptions.replaceChildren();
  for (const p of PAPERS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'paper-option';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(p.id === state.paper));
    const sw = document.createElement('span');
    sw.className = 'paper-swatch';
    applyPaper(sw, { paper: p.id, paperColor: 'cream' }, null, 0.09);
    b.append(sw, document.createTextNode(p.label));
    b.addEventListener('click', () => { state.paper = p.id; renderPickers(); });
    els.paperOptions.appendChild(b);
  }
}

function openCreateDialog() {
  state.editingId = null;
  state.cover = COVERS[Math.floor(Math.random() * COVERS.length)];
  state.paper = 'lined';
  els.nbDialogTitle.textContent = 'New notebook';
  els.nbSubmit.textContent = 'Create';
  els.nbTitle.value = '';
  els.paperFieldset.hidden = false;
  renderPickers();
  els.nbDialog.showModal();
}

function openEditDialog(nb) {
  state.editingId = nb.id;
  state.cover = nb.cover;
  state.paper = nb.paper;
  els.nbDialogTitle.textContent = 'Edit notebook';
  els.nbSubmit.textContent = 'Save';
  els.nbTitle.value = nb.title;
  els.paperFieldset.hidden = true;
  renderPickers();
  els.nbDialog.showModal();
}

els.nbForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = els.nbTitle.value.trim() || 'Untitled';
  els.nbDialog.close();
  if (state.editingId) {
    const nb = await updateNotebook(state.editingId, { title, cover: state.cover });
    if (nb && nb.thumb && nb.pageIds.length) {
      const cover = await getPage(nb.pageIds[0]);
      if (cover && cover.kind === 'cover') await updateNotebook(nb.id, { thumb: await renderCoverThumb(nb, cover) }, { touch: false });
    }
    renderLibrary();
  } else {
    const nb = await createNotebook({ title, cover: state.cover, paper: state.paper, folderId: state.folderId });
    renderLibrary();
    openNotebook(nb.id);
  }
});

// ---------- Settings ----------

function renderSettings() {
  const s = getSettings();
  els.themeOptions.querySelectorAll('button').forEach((b) => {
    b.setAttribute('aria-checked', String(b.dataset.themeValue === s.theme));
  });
  els.fingerToggle.checked = !!s.fingerDraw;
  els.openModeOptions.querySelectorAll('button').forEach((b) => {
    b.setAttribute('aria-checked', String(b.dataset.openMode === s.openMode));
  });
  els.darkPagesOptions.querySelectorAll('button').forEach((b) => {
    b.setAttribute('aria-checked', String(b.dataset.darkPages === s.darkPages));
  });
  els.settingsVersion.textContent = state.version ? `MyNotes v${state.version}` : 'MyNotes';
}

function openSettings() {
  renderSettings();
  els.settingsStorage.textContent = els.storageStatus.textContent;
  els.settingsDialog.showModal();
}

els.themeOptions.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  setSetting('theme', b.dataset.themeValue);
  renderSettings();
});
els.openModeOptions.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  setSetting('openMode', b.dataset.openMode);
  renderSettings();
});
els.darkPagesOptions.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  setSetting('darkPages', b.dataset.darkPages);
  renderSettings();
});
els.fingerToggle.addEventListener('change', () => setSetting('fingerDraw', els.fingerToggle.checked));

// ---------- Navigation ----------

async function openNotebook(id, { push = true } = {}) {
  const ok = await openEditorView(id);
  if (ok && push) history.pushState({ folder: state.folderId, notebook: id }, '');
}

async function openEditorView(id) {
  els.libraryView.hidden = true;
  els.notebookView.hidden = false;
  const ok = await openEditor(id);
  if (!ok) { await showLibrary(); return false; }
  return true;
}

async function showLibrary() {
  await closeEditor();
  els.notebookView.hidden = true;
  els.libraryView.hidden = false;
  renderLibrary();
}

window.addEventListener('popstate', async (e) => {
  const st = e.state || {};
  state.folderId = st.folder || null;
  if (st.notebook) await openEditorView(st.notebook);
  else await showLibrary();
});

// ---------- Storage + offline ----------

async function initStorage() {
  const persisted = await requestPersistentStorage();
  let text = persisted ? 'Notes saved on this device (protected)' : 'Notes saved on this device';
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const { usage } = await navigator.storage.estimate();
      if (usage != null) text += ` · ${(usage / 1024 / 1024).toFixed(1)} MB used`;
    }
  } catch { /* ignore */ }
  els.storageStatus.textContent = text;
}

function initServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.version) {
      state.version = e.data.version;
      els.versionLabel.textContent = `v${e.data.version}`;
    }
  });
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const askVersion = () => reg.active && reg.active.postMessage('version');
    askVersion();
    navigator.serviceWorker.ready.then(askVersion);
    const promptUpdate = (worker) => {
      showToast('A new version of MyNotes is ready.', { label: 'Update', onClick: () => worker.postMessage('skip-waiting') });
    };
    if (reg.waiting && navigator.serviceWorker.controller) promptUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (!w) return;
      w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) promptUpdate(w);
      });
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  }).catch(() => { /* offline support unavailable */ });
}

// ---------- Start ----------

applyTheme();
els.settingsBtn.innerHTML = ICONS.gear;
els.trashBtn.innerHTML = ICONS.trash;
els.newBtn.innerHTML = ICONS.plus;
els.folderBack.innerHTML = ICONS.back;
els.selectMove.innerHTML = `${ICONS.move}<span>Move</span>`;
els.selectTrash.innerHTML = `${ICONS.trash}<span>Trash</span>`;
[els.nbDialog, els.settingsDialog, els.trashDialog].forEach(wireDialog);
els.newBtn.addEventListener('click', newMenu);
els.selectBtn.addEventListener('click', () => setSelecting(true));
els.selectDone.addEventListener('click', () => setSelecting(false));
els.selectAll.addEventListener('click', () => {
  const all = state.visible.length && state.visible.every((k) => state.selected.has(k));
  state.selected = new Set(all ? [] : state.visible);
  renderLibrary();
});
els.selectMove.addEventListener('click', moveSelected);
els.selectTrash.addEventListener('click', trashSelected);
els.trashBtn.addEventListener('click', openTrash);
els.emptyTrashBtn.addEventListener('click', emptyTrash);
els.emptyCreateBtn.addEventListener('click', openCreateDialog);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.selecting) setSelecting(false); });
els.folderBack.addEventListener('click', () => history.back());
els.settingsBtn.addEventListener('click', openSettings);

initEditor({ onClose: () => history.back() });
history.replaceState({ folder: null }, '');
purgeOldTrash().catch(() => {}).then(renderLibrary);
initStorage();
initServiceWorker();
