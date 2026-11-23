// Page templates and paper colours.
export const TEMPLATES = [
  { id: 'blank', label: 'Blank', gap: 30 },
  { id: 'lined', label: 'Lined', gap: 36 },
  { id: 'narrow', label: 'Narrow', gap: 26 },
  { id: 'grid', label: 'Grid', gap: 30 },
  { id: 'dotted', label: 'Dotted', gap: 30 },
  { id: 'cornell', label: 'Cornell', gap: 32 },
];

export const PAPER_COLORS = [
  { id: 'cream', label: 'Cream', value: '#fffdf8' },
  { id: 'white', label: 'White', value: '#ffffff' },
  { id: 'yellow', label: 'Yellow', value: '#fdf5d3' },
  { id: 'gray', label: 'Grey', value: '#f1f1ef' },
];

export function templateGap(id) {
  const t = TEMPLATES.find((x) => x.id === id);
  return t ? t.gap : 30;
}

export function paperColorValue(id) {
  const c = PAPER_COLORS.find((x) => x.id === id);
  return c ? c.value : PAPER_COLORS[0].value;
}

// Applies template classes and variables to an element.
export function applyPaper(el, page, notebook, scale) {
  if (page.kind === 'cover') {
    el.dataset.paper = 'cover';
    el.style.backgroundColor = notebook.cover;
    return;
  }
  el.dataset.paper = page.paper || 'blank';
  el.style.backgroundColor = paperColorValue(page.paperColor);
  el.style.setProperty('--gap', `${templateGap(page.paper) * scale}px`);
}
