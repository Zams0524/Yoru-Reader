/**
 * Helpers over the reader's rendered text. Offsets count the text the reader shows,
 * without furigana (<rt>/<rp>), which is also what search, read aloud and highlights use.
 */

export const READER_BLOCK_SELECTOR = 'p.chapter-content, h1.chapter-content-h1, h2.chapter-content-h2, h3.chapter-content-h3';

export function textNodesOf(block: Element): { node: Text; start: number }[] {
  const nodes: { node: Text; start: number }[] = [];
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement?.closest('rt, rp') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  let offset = 0;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    nodes.push({ node, start: offset });
    offset += node.data.length;
  }
  return nodes;
}

export function blockText(block: Element): string {
  return textNodesOf(block).map(({ node }) => node.data).join('');
}

/** A DOM range over [start, end) of a block's visible text. */
export function rangeForOffsets(block: Element, start: number, end: number): Range | null {
  const nodes = textNodesOf(block);
  const locate = (offset: number, isEnd: boolean) => {
    for (const { node, start: nodeStart } of nodes) {
      const nodeEnd = nodeStart + node.data.length;
      if (offset < nodeEnd || (isEnd && offset === nodeEnd)) return { node, offset: offset - nodeStart };
    }
    const last = nodes[nodes.length - 1];
    return last ? { node: last.node, offset: last.node.data.length } : null;
  };
  const from = locate(start, false);
  const to = locate(end, true);
  if (!from || !to) return null;
  const range = document.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  return range;
}

/** Offsets of a DOM point inside a block's visible text (-1 when outside or inside furigana). */
export function offsetInBlock(block: Element, node: Node, offset: number): number {
  for (const item of textNodesOf(block)) {
    if (item.node === node) return item.start + offset;
  }
  if (node.nodeType === Node.ELEMENT_NODE) {
    // Point between children: use the text that comes before it.
    const probe = document.createRange();
    probe.setStart(block, 0);
    probe.setEnd(node, offset);
    const container = document.createElement('div');
    container.appendChild(probe.cloneContents());
    container.querySelectorAll('rt, rp').forEach((element) => element.remove());
    return container.textContent?.length ?? -1;
  }
  return -1;
}

/**
 * Katakana → hiragana, full-width letters and digits → ASCII (ＢＤ finds BD), ideographic space → space
 * and lower case, one character for one character (offsets stay valid).
 */
export function normalizeForSearch(text: string): string {
  return text
    .replace(/[ァ-ヶ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60))
    .replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
    .replace(/　/g, ' ')
    .toLowerCase();
}

/** Sets (or clears, with null) a named CSS custom highlight. */
export function setNamedHighlight(name: string, ranges: Range[] | Range | null) {
  const registry = (CSS as any)?.highlights;
  const HighlightCtor = (window as any).Highlight;
  if (!registry || !HighlightCtor) return;
  const list = ranges ? (Array.isArray(ranges) ? ranges : [ranges]) : [];
  if (list.length) registry.set(name, new HighlightCtor(...list));
  else registry.delete(name);
}
