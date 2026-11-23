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

// items: [{ label, danger?, onClick }]
export function openMenu(title, items) {
  const d = makeSheet();
  const h = document.createElement('h2');
  h.textContent = title;
  const list = document.createElement('div');
  list.className = 'action-list';
  for (const it of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-block' + (it.danger ? ' btn-danger' : '');
    b.textContent = it.label;
    b.addEventListener('click', () => { d.close(); it.onClick(); });
    list.appendChild(b);
  }
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn-block btn-ghost';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => d.close());
  list.appendChild(cancel);
  d.append(h, list);
  d.showModal();
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
  pen: '<svg viewBox="0 0 24 24"><path d="M4 20l1.2-4.6L15.8 4.8a2 2 0 0 1 2.8 0l.6.6a2 2 0 0 1 0 2.8L8.6 18.8z"/><path d="M14 6.5l3.5 3.5"/></svg>',
  highlighter: '<svg viewBox="0 0 24 24"><path d="M9 15l-3 3v2h4l3-3"/><path d="M9 15l7.5-11 3.5 3.5L13 15z"/><path d="M9 15l4 0"/></svg>',
  eraser: '<svg viewBox="0 0 24 24"><path d="M8 20h12"/><path d="M3.5 14.5l9-9a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8L11 19H8l-4.5-4.5z"/><path d="M8.5 9.5l6 6"/></svg>',
  undo: '<svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
  redo: '<svg viewBox="0 0 24 24"><path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg>',
  addPage: '<svg viewBox="0 0 24 24"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M12 12v6M9 15h6"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  pages: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="9" rx="1.5"/><rect x="3" y="15" width="7" height="6" rx="1.5"/><rect x="14" y="15" width="7" height="6" rx="1.5"/></svg>',
  present: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M12 16v4M8 20h8"/></svg>',
  laser: '<svg viewBox="0 0 24 24"><path d="M4 20l9-9"/><circle cx="16.5" cy="7.5" r="2.5"/><path d="M16.5 2v1.5M22 7.5h-1.5M20.4 3.6l-1 1M20.4 11.4l-1-1"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  prev: '<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
  template: '<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
  lasso: '<svg viewBox="0 0 24 24"><path d="M7 15.5C4.5 14.3 3 12.4 3 10.3 3 6.3 7 3.5 12 3.5s9 2.8 9 6.8-4 6.8-9 6.8c-1 0-2-.1-2.9-.3" stroke-dasharray="2.5 2.5"/><path d="M7 15.5c-.8 1.6-.3 3.4 1.2 4.3 1 .6 2.2.2 2.2-1 0-1.6-1.8-2.6-3.4-3.3z"/></svg>',
  text: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 8h8M12 8v9"/></svg>',
  image: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-8 9"/></svg>',
  sticky: '<svg viewBox="0 0 24 24"><path d="M4 4h16v10l-6 6H4z"/><path d="M14 20v-6h6"/></svg>',
  bookmark: '<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4.5L6 21z"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/></svg>',
};
