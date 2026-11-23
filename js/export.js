// Export: PDF (whole notebook or one page), PNG image, and .mynotes backup files.
// Everything is made on the device; nothing is uploaded anywhere.
import { PAGE_W, PAGE_H, drawStrokes } from './ink.js';
import { drawItems } from './items.js';
import { drawPaper } from './templates.js';
import { getNotebook, getPages, getBlob, putBlobWithId, importNotebook } from './db.js';

// Renders a page (paper, items, ink) to a canvas `px` pixels wide.
export async function renderPageCanvas(page, notebook, px = 1600) {
  const k = px / PAGE_W;
  const c = document.createElement('canvas');
  c.width = Math.round(PAGE_W * k);
  c.height = Math.round(PAGE_H * k);
  const ctx = c.getContext('2d');
  ctx.setTransform(k, 0, 0, k, 0, 0);
  drawPaper(ctx, page, notebook);
  await drawItems(ctx, page.items);
  drawStrokes(ctx, page.strokes || []);
  return c;
}

function canvasBlob(c, type, q) {
  return new Promise((res) => c.toBlob(res, type, q));
}

// ---------- Minimal PDF writer (one JPEG image per A4 page) ----------

async function buildPdf(jpegs) {
  const enc = new TextEncoder();
  const parts = [];
  let length = 0;
  const offsets = [];
  const push = (chunk) => {
    const b = typeof chunk === 'string' ? enc.encode(chunk) : chunk;
    parts.push(b);
    length += b.length;
  };
  const W = 595.28, H = 841.89;
  const n = jpegs.length;
  // Objects: 1 catalog, 2 pages, then per page: page, content, image.
  const pageObj = (i) => 3 + i * 3;
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const obj = (num, body) => { offsets[num] = length; push(`${num} 0 obj\n`); body(); push('\nendobj\n'); };
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Count ${n} /Kids [${jpegs.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] >>`));
  for (let i = 0; i < n; i++) {
    const { bytes, w, h } = jpegs[i];
    const p = pageObj(i);
    obj(p, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im${i} ${p + 2} 0 R >> >> /Contents ${p + 1} 0 R >>`));
    const content = `q ${W} 0 0 ${H} 0 0 cm /Im${i} Do Q`;
    obj(p + 1, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
    obj(p + 2, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>\nstream\n`);
      push(bytes);
      push('\nendstream');
    });
  }
  const total = 3 + n * 3;
  const xref = length;
  let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) x += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  push(x);
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}

export async function exportPdf(notebook, pageList, onProgress) {
  const jpegs = [];
  for (let i = 0; i < pageList.length; i++) {
    if (onProgress) onProgress(i, pageList.length);
    const c = await renderPageCanvas(pageList[i], notebook, 1654); // about 200 dpi on A4
    const blob = await canvasBlob(c, 'image/jpeg', 0.9);
    jpegs.push({ bytes: new Uint8Array(await blob.arrayBuffer()), w: c.width, h: c.height });
    c.width = c.height = 0;
  }
  return buildPdf(jpegs);
}

export async function exportPng(notebook, page) {
  const c = await renderPageCanvas(page, notebook, 2000);
  return canvasBlob(c, 'image/png');
}

// ---------- Backup ----------

function blobToDataUrl(b) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
}

export async function exportBackup(notebookId) {
  const nb = await getNotebook(notebookId);
  const pageList = await getPages(notebookId);
  const blobs = {};
  for (const pg of pageList) {
    for (const it of pg.items || []) {
      if (it.blobId && !blobs[it.blobId]) {
        const b = await getBlob(it.blobId);
        if (b) blobs[it.blobId] = await blobToDataUrl(b);
      }
    }
  }
  const data = { format: 'mynotes', version: 1, exportedAt: Date.now(), notebook: nb, pages: pageList, blobs };
  return new Blob([JSON.stringify(data)], { type: 'application/json' });
}

export async function importBackup(file, folderId = null) {
  const data = JSON.parse(await file.text());
  if (!data || data.format !== 'mynotes' || !data.notebook || !Array.isArray(data.pages)) throw new Error('Not a MyNotes backup');
  for (const [id, url] of Object.entries(data.blobs || {})) {
    const blob = await (await fetch(url)).blob();
    await putBlobWithId(id, blob);
  }
  return importNotebook(data.notebook, data.pages, folderId);
}

// ---------- Saving ----------

export function safeName(s) {
  return (s || 'Notes').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'Notes';
}

// Uses the share sheet where it can take files (iPad), else downloads.
export async function saveFile(blob, filename, opts = {}) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
      // Took too long since the tap: the caller asks for one more tap.
      if (e && e.name === 'NotAllowedError' && !opts.fallback) return 'needs-tap';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return 'downloaded';
}
