// Local storage for MyNotes, built on IndexedDB.
// Everything here lives only on this device.

const DB_NAME = 'mynotes';
const DB_VERSION = 3;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('notebooks')) {
        const s = db.createObjectStore('notebooks', { keyPath: 'id' });
        s.createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains('pages')) {
        const s = db.createObjectStore('pages', { keyPath: 'id' });
        s.createIndex('notebookId', 'notebookId');
      }
      if (!db.objectStoreNames.contains('folders')) {
        db.createObjectStore('folders', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('blobs')) {
        db.createObjectStore('blobs', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(storeNames, mode, fn) {
  const db = await openDb();
  const t = db.transaction(storeNames, mode);
  const stores = Array.isArray(storeNames)
    ? storeNames.map((n) => t.objectStore(n))
    : [t.objectStore(storeNames)];
  const result = await fn(...stores);
  await new Promise((resolve, reject) => {
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
  return result;
}

export function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// ---------- Folders ----------

export async function listFolders() {
  const all = await tx('folders', 'readonly', (s) => promisify(s.getAll()));
  return all.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
}

export async function getFolder(id) {
  return tx('folders', 'readonly', (s) => promisify(s.get(id)));
}

export async function createFolder({ name, parentId = null, color }) {
  const now = Date.now();
  const folder = { id: newId(), name: name || 'New folder', parentId, color, createdAt: now, updatedAt: now };
  await tx('folders', 'readwrite', (s) => s.put(folder));
  return folder;
}

export async function updateFolder(id, changes) {
  return tx('folders', 'readwrite', async (s) => {
    const f = await promisify(s.get(id));
    if (!f) return null;
    Object.assign(f, changes, { updatedAt: Date.now() });
    s.put(f);
    return f;
  });
}

// Deletes a folder together with everything inside it.
export async function deleteFolderDeep(id) {
  const folders = await listFolders();
  const notebooks = await listNotebooks();
  const doomed = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (f.parentId && doomed.has(f.parentId) && !doomed.has(f.id)) { doomed.add(f.id); grew = true; }
    }
  }
  const doomedNotebooks = notebooks.filter((n) => n.folderId && doomed.has(n.folderId));
  for (const nb of doomedNotebooks) await deleteNotebook(nb.id);
  await tx('folders', 'readwrite', (s) => { doomed.forEach((fid) => s.delete(fid)); });
}

// ---------- Notebooks ----------

export async function listNotebooks() {
  const all = await tx('notebooks', 'readonly', (s) => promisify(s.getAll()));
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getNotebook(id) {
  return tx('notebooks', 'readonly', (s) => promisify(s.get(id)));
}

export function blankPage(notebookId, paper, paperColor = 'cream') {
  const now = Date.now();
  return { id: newId(), notebookId, paper, paperColor, strokes: [], createdAt: now, updatedAt: now };
}

export function coverPage(notebookId) {
  const now = Date.now();
  return { id: newId(), notebookId, kind: 'cover', paper: 'blank', strokes: [], createdAt: now, updatedAt: now };
}

export async function getPage(id) {
  return tx('pages', 'readonly', (s) => promisify(s.get(id)));
}

export async function savePages(list) {
  const now = Date.now();
  await tx('pages', 'readwrite', (s) => { list.forEach((pg) => { pg.updatedAt = now; s.put(pg); }); });
}

export async function createNotebook({ title, cover, paper, folderId = null }) {
  const now = Date.now();
  const notebook = {
    id: newId(),
    title: title || 'Untitled',
    cover,
    paper,
    folderId,
    createdAt: now,
    updatedAt: now,
    pageIds: [],
  };
  const coverPg = coverPage(notebook.id);
  const firstPage = blankPage(notebook.id, paper);
  notebook.pageIds.push(coverPg.id, firstPage.id);
  await tx(['notebooks', 'pages'], 'readwrite', (nb, pg) => {
    nb.put(notebook);
    pg.put(coverPg);
    pg.put(firstPage);
  });
  return notebook;
}

export async function updateNotebook(id, changes, { touch = true } = {}) {
  return tx('notebooks', 'readwrite', async (s) => {
    const nb = await promisify(s.get(id));
    if (!nb) return null;
    Object.assign(nb, changes);
    if (touch) nb.updatedAt = Date.now();
    s.put(nb);
    return nb;
  });
}

export async function deleteNotebook(id) {
  await tx(['notebooks', 'pages'], 'readwrite', async (nb, pg) => {
    const keys = await promisify(pg.index('notebookId').getAllKeys(id));
    keys.forEach((k) => pg.delete(k));
    nb.delete(id);
  });
}

// ---------- Pages ----------

export async function getPages(notebookId) {
  return tx('pages', 'readonly', (s) => promisify(s.index('notebookId').getAll(notebookId)));
}

export async function savePage(page) {
  page.updatedAt = Date.now();
  await tx('pages', 'readwrite', (s) => s.put(page));
}

export async function addPageToNotebook(notebookId, page, index) {
  await tx(['notebooks', 'pages'], 'readwrite', async (nbStore, pgStore) => {
    const nb = await promisify(nbStore.get(notebookId));
    if (!nb) return;
    const at = index == null ? nb.pageIds.length : index;
    nb.pageIds.splice(at, 0, page.id);
    nb.updatedAt = Date.now();
    nbStore.put(nb);
    pgStore.put(page);
  });
}

export async function removePageFromNotebook(notebookId, pageId) {
  await tx(['notebooks', 'pages'], 'readwrite', async (nbStore, pgStore) => {
    const nb = await promisify(nbStore.get(notebookId));
    if (!nb) return;
    nb.pageIds = nb.pageIds.filter((id) => id !== pageId);
    nb.updatedAt = Date.now();
    nbStore.put(nb);
    pgStore.delete(pageId);
  });
}

// ---------- Images and other binary data ----------

export async function putBlob(blob) {
  const rec = { id: newId(), blob, type: blob.type, createdAt: Date.now() };
  await tx('blobs', 'readwrite', (s) => s.put(rec));
  return rec.id;
}

export async function getBlob(id) {
  const rec = await tx('blobs', 'readonly', (s) => promisify(s.get(id)));
  return rec ? rec.blob : null;
}

// Ask the browser to protect our storage from automatic clean-up.
export async function requestPersistentStorage() {
  try {
    if (!navigator.storage || !navigator.storage.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

// ---------- Backup and restore ----------

export async function putBlobWithId(id, blob) {
  await tx('blobs', 'readwrite', (s) => s.put({ id, blob, type: blob.type, createdAt: Date.now() }));
}

// Saves an imported notebook under fresh ids so it never overwrites anything.
export async function importNotebook(nb, pageList, folderId = null) {
  const now = Date.now();
  const idMap = new Map();
  const notebook = { ...nb, id: newId(), folderId, updatedAt: now, trashedAt: undefined };
  delete notebook.trashedAt;
  const newPages = pageList.map((pg) => {
    const id = newId();
    idMap.set(pg.id, id);
    return { ...pg, id, notebookId: notebook.id };
  });
  notebook.pageIds = (nb.pageIds || []).map((id) => idMap.get(id)).filter(Boolean);
  for (const pg of newPages) if (!notebook.pageIds.includes(pg.id)) notebook.pageIds.push(pg.id);
  await tx(['notebooks', 'pages'], 'readwrite', (nbs, pgs) => {
    nbs.put(notebook);
    newPages.forEach((pg) => pgs.put(pg));
  });
  return notebook;
}
