import {
  listNotebooks, getNotebook, createNotebook, updateNotebook, deleteNotebook, requestPersistentStorage,
  listFolders, getFolder, createFolder, updateFolder, deleteFolderDeep,
} from './db.js';
import { getSettings, setSetting, applyTheme } from './settings.js';
import { showToast, openMenu, confirmSheet, promptSheet, pickSheet, ICONS } from './ui.js';
import { initEditor, openEditor, closeEditor } from './editor.js';

const COVERS = ['#2f6fdf', '#1f9d8b', '#e0a526', '#d9503f', '#8a5cd6', '#3d4a5c', '#c46a9b', '#6a9f3a'];
const PAPERS = [
  { id: 'blank', label: 'Blank' },
  { id: 'lined', label: 'Lined' },
  { id: 'grid', label: 'Grid' },
  { id: 'dotted', label: 'Dotted' },
];

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
  editorSettingsBtn: $('editor-settings-btn'),
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
  settingsStorage: $('settings-storage'),
  settingsVersion: $('settings-version'),
};

const state = {
  folderId: null,    // folder being shown in the library (null = top level)
  editingId: null,   // notebook being edited in the dialog
  cover: COVERS[0],
  paper: 'lined',
  version: '',
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

async function renderLibrary() {
  const [folders, notebooks] = await Promise.all([listFolders(), listNotebooks()]);
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

  els.grid.replaceChildren();
  const empty = subfolders.length === 0 && books.length === 0;
  els.empty.hidden = !empty;
  if (empty) {
    els.emptyTitle.textContent = state.folderId ? 'This folder is empty' : 'No notebooks yet';
    els.emptyText.textContent = 'Create a notebook or a folder to get started.';
  }

  for (const f of subfolders) {
    const count = folders.filter((x) => x.parentId === f.id).length + notebooks.filter((n) => n.folderId === f.id).length;
    els.grid.appendChild(card({
      kind: 'folder',
      title: f.name,
      sub: count === 1 ? '1 item' : `${count} items`,
      color: f.color,
      onOpen: () => goToFolder(f.id),
      onMore: () => folderActions(f, folders),
    }));
  }
  for (const nb of books) {
    els.grid.appendChild(card({
      kind: 'notebook',
      title: nb.title,
      sub: formatDate(nb.updatedAt),
      color: nb.cover,
      onOpen: () => openNotebook(nb.id),
      onMore: () => notebookActions(nb, folders),
    }));
  }
}

function card({ kind, title, sub, color, onOpen, onMore }) {
  const li = document.createElement('li');
  li.className = `card card-${kind}`;
  const open = document.createElement('button');
  open.type = 'button';
  open.className = kind === 'folder' ? 'folder-art' : 'cover';
  open.style.setProperty('--c', color);
  open.setAttribute('aria-label', `Open ${title}`);
  open.addEventListener('click', onOpen);

  const meta = document.createElement('div');
  meta.className = 'card-meta';
  const text = document.createElement('div');
  text.className = 'card-text';
  const t = document.createElement('div');
  t.className = 'card-title';
  t.textContent = title;
  const s = document.createElement('div');
  s.className = 'card-date';
  s.textContent = sub;
  text.append(t, s);
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'icon-btn small';
  more.innerHTML = ICONS.more;
  more.setAttribute('aria-label', `Options for ${title}`);
  more.addEventListener('click', onMore);
  meta.append(text, more);
  li.append(open, meta);
  return li;
}

function goToFolder(id, { push = true } = {}) {
  state.folderId = id;
  if (push) history.pushState({ folder: id }, '');
  renderLibrary();
}

// ---------- Actions ----------

function newMenu() {
  openMenu('Create', [
    { label: 'New notebook', onClick: openCreateDialog },
    { label: 'New folder', onClick: newFolder },
  ]);
}

async function newFolder() {
  const name = await promptSheet('New folder', { placeholder: 'New folder', okLabel: 'Create' });
  if (!name) return;
  await createFolder({ name, parentId: state.folderId, color: COVERS[Math.floor(Math.random() * COVERS.length)] });
  renderLibrary();
}

function notebookActions(nb, folders) {
  openMenu(nb.title, [
    { label: 'Rename or change cover', onClick: () => openEditDialog(nb) },
    { label: 'Move to folder', onClick: () => moveNotebook(nb, folders) },
    {
      label: 'Delete notebook', danger: true,
      onClick: async () => {
        const ok = await confirmSheet(`Delete “${nb.title}”?`, 'This removes the notebook and all its pages from this iPad.');
        if (!ok) return;
        await deleteNotebook(nb.id);
        showToast('Notebook deleted');
        renderLibrary();
      },
    },
  ]);
}

async function moveNotebook(nb, folders) {
  const target = await pickSheet(`Move “${nb.title}” to`, folderTreeOptions(folders));
  if (target === undefined) return;
  await updateNotebook(nb.id, { folderId: target }, { touch: false });
  showToast('Moved');
  renderLibrary();
}

function folderActions(f, folders) {
  openMenu(f.name, [
    {
      label: 'Rename folder',
      onClick: async () => {
        const name = await promptSheet('Rename folder', { value: f.name, okLabel: 'Rename' });
        if (!name) return;
        await updateFolder(f.id, { name });
        renderLibrary();
      },
    },
    {
      label: 'Move to folder',
      onClick: async () => {
        const target = await pickSheet(`Move “${f.name}” to`, folderTreeOptions(folders, descendantsOf(folders, f.id)));
        if (target === undefined) return;
        await updateFolder(f.id, { parentId: target });
        showToast('Moved');
        renderLibrary();
      },
    },
    {
      label: 'Delete folder', danger: true,
      onClick: async () => {
        const ok = await confirmSheet(`Delete “${f.name}”?`, 'This deletes the folder and every notebook and folder inside it.');
        if (!ok) return;
        await deleteFolderDeep(f.id);
        showToast('Folder deleted');
        renderLibrary();
      },
    },
  ]);
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
    sw.className = `paper-swatch paper-${p.id}`;
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
    await updateNotebook(state.editingId, { title, cover: state.cover });
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
els.editorSettingsBtn.innerHTML = ICONS.gear;
[els.nbDialog, els.settingsDialog].forEach(wireDialog);
els.newBtn.addEventListener('click', newMenu);
els.emptyCreateBtn.addEventListener('click', openCreateDialog);
els.folderBack.addEventListener('click', () => history.back());
els.settingsBtn.addEventListener('click', openSettings);
els.editorSettingsBtn.addEventListener('click', openSettings);

initEditor({ onClose: () => history.back() });
history.replaceState({ folder: null }, '');
renderLibrary();
initStorage();
initServiceWorker();
