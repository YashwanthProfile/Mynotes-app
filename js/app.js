import {
  listNotebooks, getNotebook, createNotebook, updateNotebook, deleteNotebook, requestPersistentStorage,
} from './db.js';

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
  grid: $('notebook-grid'),
  empty: $('empty-state'),
  newBtn: $('new-notebook-btn'),
  emptyCreateBtn: $('empty-create-btn'),
  storageStatus: $('storage-status'),
  versionLabel: $('version-label'),
  backBtn: $('back-btn'),
  notebookTitle: $('notebook-title'),
  pagePreview: $('page-preview'),
  nbDialog: $('notebook-dialog'),
  nbForm: $('notebook-form'),
  nbDialogTitle: $('notebook-dialog-title'),
  nbTitle: $('nb-title'),
  nbSubmit: $('nb-submit'),
  coverOptions: $('cover-options'),
  paperOptions: $('paper-options'),
  paperFieldset: $('paper-fieldset'),
  actionsDialog: $('actions-dialog'),
  actionsTitle: $('actions-title'),
  actionEdit: $('action-edit'),
  actionDelete: $('action-delete'),
  confirmDialog: $('confirm-dialog'),
  confirmTitle: $('confirm-title'),
  confirmText: $('confirm-text'),
  confirmOk: $('confirm-ok'),
  toast: $('toast'),
};

const state = {
  editingId: null,   // notebook being edited in the dialog, or null when creating
  actionsId: null,   // notebook whose action sheet is open
  cover: COVERS[0],
  paper: 'lined',
};

// ---------- Helpers ----------

function formatDate(ts) {
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

let toastTimer = null;
function showToast(message, action) {
  els.toast.textContent = message;
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = action.label;
    b.addEventListener('click', action.onClick);
    els.toast.appendChild(b);
  }
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  if (!action) toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2500);
}

function closeOnBackdrop(dialog) {
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  dialog.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dialog.close()));
}

// ---------- Library ----------

async function renderLibrary() {
  const notebooks = await listNotebooks();
  els.grid.replaceChildren();
  els.empty.hidden = notebooks.length > 0;

  for (const nb of notebooks) {
    const li = document.createElement('li');
    li.className = 'card';

    const cover = document.createElement('button');
    cover.type = 'button';
    cover.className = 'cover';
    cover.style.background = nb.cover;
    cover.setAttribute('aria-label', `Open ${nb.title}`);
    cover.addEventListener('click', () => openNotebook(nb.id));

    const meta = document.createElement('div');
    meta.className = 'card-meta';
    const text = document.createElement('div');
    text.className = 'card-text';
    const title = document.createElement('div');
    title.className = 'card-title';
    title.textContent = nb.title;
    const date = document.createElement('div');
    date.className = 'card-date';
    date.textContent = formatDate(nb.updatedAt);
    text.append(title, date);

    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'more-btn';
    more.textContent = '⋯';
    more.setAttribute('aria-label', `Options for ${nb.title}`);
    more.addEventListener('click', () => openActions(nb));

    meta.append(text, more);
    li.append(cover, meta);
    els.grid.appendChild(li);
  }
}

// ---------- Create / edit dialog ----------

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
  els.paperFieldset.hidden = true; // paper is per page; changing it comes later
  renderPickers();
  els.nbDialog.showModal();
}

els.nbForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = els.nbTitle.value.trim() || 'Untitled';
  if (state.editingId) {
    await updateNotebook(state.editingId, { title, cover: state.cover });
  } else {
    await createNotebook({ title, cover: state.cover, paper: state.paper });
    showToast('Notebook created');
  }
  els.nbDialog.close();
  renderLibrary();
});

// ---------- Actions sheet ----------

function openActions(nb) {
  state.actionsId = nb.id;
  els.actionsTitle.textContent = nb.title;
  els.actionsDialog.showModal();
}

els.actionEdit.addEventListener('click', async () => {
  els.actionsDialog.close();
  const nb = await getNotebook(state.actionsId);
  if (nb) openEditDialog(nb);
});

els.actionDelete.addEventListener('click', async () => {
  els.actionsDialog.close();
  const nb = await getNotebook(state.actionsId);
  if (!nb) return;
  els.confirmTitle.textContent = `Delete “${nb.title}”?`;
  els.confirmText.textContent = 'This removes the notebook and all its pages from this iPad.';
  els.confirmDialog.showModal();
});

els.confirmOk.addEventListener('click', async () => {
  await deleteNotebook(state.actionsId);
  els.confirmDialog.close();
  showToast('Notebook deleted');
  renderLibrary();
});

// ---------- Notebook view ----------

async function openNotebook(id) {
  const nb = await getNotebook(id);
  if (!nb) return;
  els.notebookTitle.textContent = nb.title;
  els.pagePreview.className = `page paper-${nb.paper}`;
  els.libraryView.hidden = true;
  els.notebookView.hidden = false;
  history.pushState({ notebook: id }, '', `#notebook/${id}`);
}

function showLibrary() {
  els.notebookView.hidden = true;
  els.libraryView.hidden = false;
  renderLibrary();
}

els.backBtn.addEventListener('click', () => {
  if (history.state && history.state.notebook) history.back();
  else { history.replaceState(null, '', location.pathname); showLibrary(); }
});
window.addEventListener('popstate', (e) => {
  if (e.state && e.state.notebook) openNotebook(e.state.notebook);
  else showLibrary();
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
    if (e.data && e.data.version) els.versionLabel.textContent = `v${e.data.version}`;
  });
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const askVersion = () => reg.active && reg.active.postMessage('version');
    askVersion();
    navigator.serviceWorker.ready.then(askVersion);

    const promptUpdate = (worker) => {
      showToast('A new version of MyNotes is ready.', {
        label: 'Update',
        onClick: () => worker.postMessage('skip-waiting'),
      });
    };
    if (reg.waiting && navigator.serviceWorker.controller) promptUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (!w) return;
      w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) promptUpdate(w);
      });
    });
    // Check for updates whenever the app comes back to the foreground.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  }).catch(() => { /* offline support unavailable, app still works */ });
}

// ---------- Start ----------

[els.nbDialog, els.actionsDialog, els.confirmDialog].forEach(closeOnBackdrop);
els.newBtn.addEventListener('click', openCreateDialog);
els.emptyCreateBtn.addEventListener('click', openCreateDialog);

history.replaceState(null, '', location.pathname);
renderLibrary();
initStorage();
initServiceWorker();
