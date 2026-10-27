/**
 * Selecting text across a formula. KaTeX builds a formula from many nested spans, each with its own font, size and
 * vertical offset, so the browser painted a selection box per piece at a different height and the highlight jumped up
 * and down along the line. The pieces' own highlight is hidden (src/chat/chat.css) and any formula the selection
 * touches is marked `data-selected`, which paints one band over the whole formula, level with the text around it.
 */
let marked = new Set<HTMLElement>();
let pending = 0;

/** Where the line box around an inline formula starts (`top`) or ends (`bottom`): a zero-size probe aligned to it. */
function lineEdge(formula: HTMLElement, align: 'top' | 'bottom') {
  const probe = document.createElement('span');
  probe.style.cssText = `display:inline-block;width:0;height:0;vertical-align:${align}`;
  formula.before(probe);
  const y = probe.getBoundingClientRect().top;
  probe.remove();
  return y;
}

/** Text is highlighted over its whole line box; an inline formula's band is padded out to the same height. */
function mark(formula: HTMLElement) {
  formula.setAttribute('data-selected', '');
  if (formula.parentElement?.classList.contains('katex-display')) return;
  const boxes = formula.getClientRects();
  if (boxes.length !== 1) return; // a formula wrapped over two lines keeps its own height
  const top = lineEdge(formula, 'top'), bottom = lineEdge(formula, 'bottom');
  formula.style.paddingTop = Math.max(0, boxes[0].top - top) + 'px';
  formula.style.paddingBottom = Math.max(0, bottom - boxes[0].bottom) + 'px';
}

function unmark(formula: HTMLElement) {
  formula.removeAttribute('data-selected');
  formula.style.removeProperty('padding-top');
  formula.style.removeProperty('padding-bottom');
}

function update() {
  pending = 0;
  const selection = document.getSelection();
  const next = new Set<HTMLElement>();
  if (selection && !selection.isCollapsed) {
    for (let i = 0; i < selection.rangeCount; i++) {
      const range = selection.getRangeAt(i);
      const common = range.commonAncestorContainer;
      const scope = common instanceof Element ? common : common.parentElement;
      if (!scope) continue;
      const within = scope.closest<HTMLElement>('.katex');
      if (within) { next.add(within); continue; }
      for (const formula of scope.querySelectorAll<HTMLElement>('.katex')) if (range.intersectsNode(formula)) next.add(formula);
    }
  }
  for (const formula of marked) if (!next.has(formula)) unmark(formula);
  for (const formula of next) if (!marked.has(formula)) mark(formula);
  marked = next;
}

document.addEventListener('selectionchange', () => { if (!pending) pending = requestAnimationFrame(update); });
