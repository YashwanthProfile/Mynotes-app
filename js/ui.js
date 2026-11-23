// Small UI helpers: toast, action menu, confirm and text prompt sheets.

let toastTimer = null;
export function showToast(message, action) {
  const el = document.getElementById('toast');
  el.textContent = message;
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = action.label;
    b.addEventListener('click', () => { el.hidden = true; action.onClick(); });
    el.appendChild(b);
  }
  el.hidden = false;
  clearTimeout(toastTimer);
  if (!action) toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

function makeSheet(className = 'sheet sheet-small') {
  const d = document.createElement('dialog');
  d.className = className;
  document.body.appendChild(d);
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  d.addEventListener('close', () => setTimeout(() => d.remove(), 0));
  return d;
}

// items: [{ label, icon?, danger?, onClick } | { sep: true }]
// With an anchor element the menu drops down from it; otherwise it is a sheet.
export function openMenu(title, items, anchor) {
  const d = makeSheet(anchor ? 'menu-pop' : 'sheet sheet-small menu-sheet');
  if (title && !anchor) {
    const h = document.createElement('h2');
    h.textContent = title;
    d.appendChild(h);
  } else if (title) {
    const h = document.createElement('div');
    h.className = 'menu-title';
    h.textContent = title;
    d.appendChild(h);
  }
  const list = document.createElement('div');
  list.className = 'menu-list';
  for (const it of items) {
    if (it.sep) { const s = document.createElement('div'); s.className = 'menu-sep'; list.appendChild(s); continue; }
    if (it.hidden) continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'menu-item' + (it.danger ? ' danger' : '') + (it.checked ? ' checked' : '');
    b.innerHTML = `<span class="menu-icon">${it.icon || ''}</span><span class="menu-label"></span>`;
    b.querySelector('.menu-label').textContent = it.label;
    b.addEventListener('click', () => { d.close(); it.onClick(); });
    list.appendChild(b);
  }
  d.appendChild(list);
  d.showModal();
  if (anchor) {
    const r = anchor.getBoundingClientRect();
    const w = d.offsetWidth, h = d.offsetHeight;
    const left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    d.style.left = `${left}px`;
    d.style.top = `${top}px`;
  }
  return d;
}

export function confirmSheet(title, text, okLabel = 'Delete') {
  return new Promise((resolve) => {
    const d = makeSheet();
    let result = false;
    d.innerHTML = `<h2></h2><p class="sheet-text"></p>
      <div class="actions"><button type="button" class="btn btn-ghost" data-cancel>Cancel</button>
      <button type="button" class="btn btn-danger" data-ok></button></div>`;
    d.querySelector('h2').textContent = title;
    d.querySelector('p').textContent = text;
    d.querySelector('[data-ok]').textContent = okLabel;
    d.querySelector('[data-cancel]').addEventListener('click', () => d.close());
    d.querySelector('[data-ok]').addEventListener('click', () => { result = true; d.close(); });
    d.addEventListener('close', () => resolve(result));
    d.showModal();
  });
}

export function promptSheet(title, { value = '', placeholder = '', okLabel = 'Save' } = {}) {
  return new Promise((resolve) => {
    const d = makeSheet();
    let result = null;
    d.innerHTML = `<form method="dialog"><h2></h2>
      <label class="field"><input type="text" maxlength="80" autocomplete="off"></label>
      <div class="actions"><button type="button" class="btn btn-ghost" data-cancel>Cancel</button>
      <button type="submit" class="btn btn-primary" data-ok></button></div></form>`;
    d.querySelector('h2').textContent = title;
    const input = d.querySelector('input');
    input.value = value;
    input.placeholder = placeholder;
    d.querySelector('[data-ok]').textContent = okLabel;
    d.querySelector('[data-cancel]').addEventListener('click', () => d.close());
    d.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      result = input.value.trim() || placeholder || value;
      d.close();
    });
    d.addEventListener('close', () => resolve(result));
    d.showModal();
    input.focus();
    input.select();
  });
}

// options: [{ id, label, depth, disabled }]
export function pickSheet(title, options) {
  return new Promise((resolve) => {
    const d = makeSheet();
    let result;
    const h = document.createElement('h2');
    h.textContent = title;
    const list = document.createElement('div');
    list.className = 'pick-list';
    for (const o of options) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pick-item';
      b.disabled = !!o.disabled;
      b.style.paddingLeft = `${14 + (o.depth || 0) * 22}px`;
      b.innerHTML = `<span class="pick-icon" aria-hidden="true"></span><span></span>`;
      b.lastChild.textContent = o.label;
      if (o.root) b.firstChild.classList.add('pick-root');
      b.addEventListener('click', () => { result = o.id; d.close(); });
      list.appendChild(b);
    }
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn-block btn-ghost';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => d.close());
    d.append(h, list, cancel);
    d.addEventListener('close', () => resolve(result));
    d.showModal();
  });
}

export const ICONS = {
  pen: '<svg viewBox="0 0 24 24"><path d="M15.2 4.8l4 4L9 19l-5 1 1-5z"/><path d="M13 7l4 4"/><path class="tip" d="M5 15.2l3.8 3.8L4 20z"/></svg>',
  highlighter: '<svg viewBox="0 0 24 24"><path d="M14.5 3l6.5 6.5-7.5 7.5-6.5-6.5z"/><path d="M7 10.5l-1.5 5 3 3 5-1.5"/><path class="tip" d="M5.5 15.5L3 21h3.5l2-2.5z"/></svg>',
  eraser: '<svg viewBox="0 0 24 24"><path d="M16.2 3.9l3.9 3.9a1.8 1.8 0 0 1 0 2.5L11 19.4H7.4l-3.5-3.5a1.8 1.8 0 0 1 0-2.5l9.8-9.5a1.8 1.8 0 0 1 2.5 0z"/><path d="M8.6 9l6.4 6.4"/><path d="M11 19.4h9"/></svg>',
  undo: '<svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
  redo: '<svg viewBox="0 0 24 24"><path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg>',
  addPage: '<svg viewBox="0 0 24 24"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M12 12v6M9 15h6"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  pages: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="9" rx="1.5"/><rect x="3" y="15" width="7" height="6" rx="1.5"/><rect x="14" y="15" width="7" height="6" rx="1.5"/></svg>',
  present: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M12 16v4M8 20h8"/></svg>',
  laser: '<svg viewBox="0 0 24 24"><path d="M13.6 10.4L4 20"/><circle class="tip" cx="15.6" cy="8.4" r="2.3"/><path d="M15.6 2.6v1.3M21.4 8.4h-1.3M19.7 4.3l-.9.9M19.7 12.5l-.9-.9M11.5 4.3l.9.9"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  prev: '<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
  template: '<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
  lasso: '<svg viewBox="0 0 24 24"><path d="M12 4.5c4.7 0 8.5 2.5 8.5 5.6s-3.8 5.6-8.5 5.6c-1 0-2-.1-2.9-.4" stroke-dasharray="2.4 2.4"/><path d="M6.2 14.6C4.4 13.6 3.5 12 3.5 10.1c0-3.1 3.8-5.6 8.5-5.6" stroke-dasharray="2.4 2.4"/><circle cx="7.6" cy="16.6" r="1.7"/><path d="M7 18.2c-.4 1.3-1.3 2.1-2.6 2.5"/></svg>',
  text: '<svg viewBox="0 0 24 24"><path d="M5 7.5V5h14v2.5"/><path d="M12 5v14"/><path d="M9 19h6"/></svg>',
  image: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-8 9"/></svg>',
  sticky: '<svg viewBox="0 0 24 24"><path d="M5 4h14a1 1 0 0 1 1 1v9.5L14.5 20H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/><path d="M14.5 20v-4.5a1 1 0 0 1 1-1H20"/></svg>',
  bookmark: '<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4.5L6 21z"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/></svg>',
  fill: '<svg viewBox="0 0 24 24"><path d="M4.8 11.7L11.5 5l7 7-6.7 6.7a2 2 0 0 1-2.8 0l-4.2-4.2a2 2 0 0 1 0-2.8z"/><path d="M8.5 3.5l3 3"/><path d="M4.5 12.5h13.5"/><path class="tip" d="M20.2 14.8s1.9 2.4 1.9 3.6a1.9 1.9 0 0 1-3.8 0c0-1.2 1.9-3.6 1.9-3.6z"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M9 7V4.5h6V7"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  rename: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>',
  palette: '<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.8-1.7 0-1.3-1.1-1.6-1.1-2.8 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z"/><circle cx="7.5" cy="11" r="1.2"/><circle cx="10" cy="7" r="1.2"/><circle cx="15" cy="7.5" r="1.2"/></svg>',
  moon: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/></svg>',
  restore: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v4h4"/></svg>',
  move: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M10 13h6M13.5 10.5L16 13l-2.5 2.5"/></svg>',
  duplicate: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  select: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.2l2.4 2.4 4.6-4.8"/></svg>',
  clear: '<svg viewBox="0 0 24 24"><path d="M4 7h16"/><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 11l6 6M15 11l-6 6"/></svg>',
  cover: '<svg viewBox="0 0 24 24"><path d="M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M8 3v18"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path d="M12 3.5v11"/><path d="M8 7.5l4-4 4 4"/><path d="M6.5 11H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5"/></svg>',
  pdf: '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M8.5 13h7M8.5 16.5h5"/></svg>',
  page: '<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6"/></svg>',
  backup: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9"/><path d="M10 13h4"/></svg>',
  importFile: '<svg viewBox="0 0 24 24"><path d="M12 3.5v11"/><path d="M8 10.5l4 4 4-4"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/></svg>',
  nib_fountain: '<svg viewBox="0 0 24 24"><path d="M12 21l-4.5-8L12 3l4.5 10z"/><path d="M12 21v-7"/><circle cx="12" cy="12.5" r="1.3"/></svg>',
  nib_ball: '<svg viewBox="0 0 24 24"><path d="M9 3h6v11l-3 6-3-6z"/><path d="M9 14h6"/></svg>',
  nib_brush: '<svg viewBox="0 0 24 24"><path d="M10 3h4v8h-4z"/><path d="M10 11c-1 3-1 6 2 10 3-4 3-7 2-10"/></svg>',
  line_solid: '<svg viewBox="0 0 24 24"><path d="M4 12h16" stroke-width="2.4"/></svg>',
  line_dash: '<svg viewBox="0 0 24 24"><path d="M3 12h4M10 12h4M17 12h4" stroke-width="2.2" stroke-linecap="butt"/></svg>',
  line_dot: '<svg viewBox="0 0 24 24"><path d="M4.5 12h0M9.5 12h0M14.5 12h0M19.5 12h0" stroke-width="2.8"/></svg>',
  snap: '<svg viewBox="0 0 24 24"><path d="M6 4v7a6 6 0 0 0 12 0V4"/><path d="M6 8h4M14 8h4"/></svg>',
  group: '<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="17" rx="2.5" stroke-dasharray="2.5 2.5"/><rect x="7" y="7" width="5.5" height="5.5" rx="1"/><circle cx="14.5" cy="14.5" r="2.8"/></svg>',
};
