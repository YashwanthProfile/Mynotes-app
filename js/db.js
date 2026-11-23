// Local storage for MyNotes, built on IndexedDB.
// Everything here lives only on this device.

const DB_NAME = 'mynotes';
const DB_VERSION = 1;

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

export async function listNotebooks() {
  const all = await tx('notebooks', 'readonly', (s) => promisify(s.getAll()));
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getNotebook(id) {
  return tx('notebooks', 'readonly', (s) => promisify(s.get(id)));
}

export async function createNotebook({ title, cover, paper }) {
  const now = Date.now();
  const notebook = {
    id: newId(),
    title: title || 'Untitled',
    cover,
    paper,
    createdAt: now,
    updatedAt: now,
    pageIds: [],
  };
  const firstPage = { id: newId(), notebookId: notebook.id, paper, strokes: [], createdAt: now, updatedAt: now };
  notebook.pageIds.push(firstPage.id);
  await tx(['notebooks', 'pages'], 'readwrite', (nb, pg) => {
    nb.put(notebook);
    pg.put(firstPage);
  });
  return notebook;
}

export async function updateNotebook(id, changes) {
  return tx('notebooks', 'readwrite', async (s) => {
    const nb = await promisify(s.get(id));
    if (!nb) return null;
    Object.assign(nb, changes, { updatedAt: Date.now() });
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
