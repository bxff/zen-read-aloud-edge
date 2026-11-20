/* UTF-16 offsets are shared by DOM ranges and speech boundary events. */
const readerText = (() => {
  const excluded = 'script,style,noscript,template,textarea,input,select,button,svg,canvas,video,audio,iframe,[hidden],[inert],[aria-hidden="true"],[contenteditable]:not([contenteditable="false"]),[data-edge-read-aloud-ui]';

  function pointAt(x, y) {
    const caret = document.caretPositionFromPoint(x, y);
    if (caret?.offsetNode.nodeType !== Node.TEXT_NODE) return null;
    const node = caret.offsetNode;
    if (node.parentElement.closest(excluded)) return null;
    for (const i of [caret.offset, caret.offset - 1]) {
      if (i < 0 || i >= node.length) continue;
      const range = document.createRange();
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      if (Array.from(range.getClientRects()).some(r => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)) {
        return {node, offset: i};
      }
    }
    return null;
  }

  function collect(root, selection) {
    const blocks = [];
    let block;
    let owner;
    function visit(element, parentBlock) {
      if (element.matches(excluded) || (selection && !selection.intersectsNode(element))) return;
      const style = getComputedStyle(element);
      if (style.display === "none" || style.contentVisibility === "hidden") return;
      if (element.tagName === "BR") { owner = null; return; }
      const inline = ["inline", "contents", "inline-block", "ruby", "ruby-text"].includes(style.display);
      const group = inline ? parentBlock : element;
      for (const node of element.childNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (element.tagName === "DETAILS" && !element.open && node.tagName !== "SUMMARY") continue;
          visit(node, group);
        } else if (node.nodeType === Node.TEXT_NODE && style.visibility === "visible" && node.length) {
          if (selection && !selection.intersectsNode(node)) continue;
          const start = selection?.startContainer === node ? selection.startOffset : 0;
          const end = selection?.endContainer === node ? selection.endOffset : node.length;
          if (end <= start) continue;
          if (group !== owner || !block) {
            block = {text: "", parts: [], element: group};
            owner = group;
            blocks.push(block);
          }
          block.parts.push({node, start, at: block.text.length, end});
          block.text += node.data.slice(start, end);
        }
      }
    }
    visit(root, root);
    return blocks.filter(b => b.text.trim());
  }

  function rangeFor(block, start, end) {
    const first = block.parts.find(p => p.at + p.end - p.start > start);
    const last = block.parts.find(p => p.at + p.end - p.start >= end);
    if (!first?.node.isConnected || !last?.node.isConnected || end <= start) return null;
    const range = document.createRange();
    range.setStart(first.node, Math.min(first.node.length, first.start + start - first.at));
    range.setEnd(last.node, Math.min(last.node.length, last.start + end - last.at));
    return range;
  }

  function words(block, lang) {
    if (block.words) return block.words;
    let segmenter;
    try { segmenter = new Intl.Segmenter(lang, {granularity: "word"}); }
    catch { segmenter = new Intl.Segmenter(undefined, {granularity: "word"}); }
    block.words = Array.from(segmenter.segment(block.text), s => ({start: s.index, end: s.index + s.segment.length, text: s.segment}));
    return block.words;
  }
  function locate(blocks, point, lang) {
    for (let i = 0; point && i < blocks.length; i++) {
      const b = blocks[i];
      const part = b.parts.find(p => p.node === point.node && point.offset >= p.start && point.offset <= p.end);
      if (!part) continue;
      const offset = part.at + point.offset - part.start;
      const word = words(b, lang).find(w => w.end > offset && w.text.trim());
      return [i, word?.start ?? offset];
    }
    return [0, 0];
  }

  function lineRange(block, start, end, wordBox, lang) {
    const tokens = words(block, lang);
    const index = tokens.findIndex(t => t.end > start);
    const across = (token, backwards) => {
      const rects = rangeFor(block, token.start, token.end)?.getClientRects();
      if (!rects?.length) return false;
      const r = rects[backwards ? 0 : rects.length - 1];
      const mid = r.top + r.height / 2;
      return mid >= wordBox.top && mid <= wordBox.bottom;
    };
    let left = index;
    let right = index;
    while (left > 0 && across(tokens[left - 1], true)) left--;
    while (right + 1 < tokens.length && across(tokens[right + 1], false)) right++;
    return rangeFor(block, Math.min(start, tokens[left]?.start ?? start), Math.max(end, tokens[right]?.end ?? end));
  }
  return {pointAt, collect, rangeFor, words, locate, lineRange};
})();
