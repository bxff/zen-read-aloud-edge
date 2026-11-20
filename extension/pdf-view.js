// PDF.js owns the canvases, text layers, navigation and zoom. Only the two
// speech highlights are added to the page, using PDF-space word coordinates.
const pdfView = (() => {
  let pages = [], blocks = [], marks, active, ready = false;
  const viewer = () => window.PDFViewerApplication.pdfViewer;

  function reset() {
    clear();
    pages = [];
    blocks = [];
    ready = false;
  }
  function addPage(data) {
    const page = {number: pages.length + 1, ...data, blocks: []};
    pages.push(page);
    for (const lines of data.blocks) {
      const block = {text: "", tokens: [], page, index: blocks.length};
      for (const line of lines) {
        const lineTokens = [];
        for (const [text, ...rect] of line) {
          if (!lineTokens.length && /\p{L}[-\u00ad]$/u.test(block.text) && /^\p{Ll}/u.test(text)) {
            block.text = block.text.slice(0, -1);
            block.tokens.at(-1).end--;
          } else if (block.tokens.length) {
            block.text += " ";
          }
          const start = block.text.length;
          block.text += text;
          const token = {start, end: block.text.length, rect, line: lineTokens, block};
          lineTokens.push(token);
          block.tokens.push(token);
        }
      }
      if (block.text) { blocks.push(block); page.blocks.push(block); }
    }
  }
  function geometry(page) {
    const view = viewer().getPageView(page.number - 1);
    if (!view) return null;
    const rotation = (viewer().pagesRotation + 360) % 360;
    const el = view.div;
    const box = el.getBoundingClientRect();
    return {el, rotation, left: box.left + el.clientLeft, top: box.top + el.clientTop,
      width: el.clientWidth, height: el.clientHeight};
  }
  function rotate(x, y, angle) {
    if (angle === 90) return [1 - y, x];
    if (angle === 180) return [1 - x, 1 - y];
    if (angle === 270) return [y, 1 - x];
    return [x, y];
  }
  function point(x, y) {
    const target = document.elementFromPoint(x, y);
    if (target?.closest("a,button,input,textarea,select,.annotationEditorLayer .editing")) return null;
    const page = pages[Number(target?.closest(".page")?.dataset.pageNumber) - 1];
    if (!page) return null;
    const g = geometry(page);
    if (!g?.width || !g.height) return null;
    const [u,v] = rotate((x-g.left)/g.width, (y-g.top)/g.height, (360-g.rotation)%360);
    const px = u*page.width, py = v*page.height;
    for (const block of page.blocks) {
      const token = block.tokens.find(({rect:[l,t,r,b]}) => px >= l-0.4 && px <= r+0.4 && py >= t-0.5 && py <= b+0.5);
      if (token) return token;
    }
    return null;
  }
  function selectedRange(text, anchor) {
    if (!text?.trim()) return null;
    const flat = blocks.map(b => b.text).join(" ");
    const needle = text.trim().replace(/\s+/g, " ");
    const offsets = [];
    let total = 0;
    for (const b of blocks) { offsets.push(total); total += b.text.length + 1; }
    const near = anchor ? offsets[anchor.block.index] + anchor.start : 0;
    let at = flat.indexOf(needle, Math.max(0, near - 1));
    if (at < 0) at = flat.indexOf(needle);
    let end = at + needle.length;
    if (at < 0) {
      // PDF.js selections may omit spaces between glyph runs or keep line-end hyphens.
      const positions = [];
      const compact = value => value.replace(/[-\s\u00ad]+/gu, "");
      let haystack = "";
      for (let i=0; i<flat.length; i++) {
        if (compact(flat[i])) { haystack += flat[i]; positions.push(i); }
      }
      const key = compact(needle);
      const index = key && haystack.indexOf(key);
      if (!key || index < 0) return [{text: text.trim(), tokens: []}];
      at = positions[index];
      end = positions[index+key.length-1]+1;
    }
    return blocks.flatMap((b,i) => {
      const shift = Math.max(0, at-offsets[i]), limit = Math.min(b.text.length, end-offsets[i]);
      return shift < limit ? [{...b, shift, text:b.text.slice(shift,limit)}] : [];
    });
  }
  function model(pointAt, range) {
    let selection;
    if (range) {
      const rect = range.getClientRects()[0];
      selection = selectedRange(range.toString(), rect && point(rect.left+1, rect.top+rect.height/2));
    } else if (pointAt?.selection) selection = selectedRange(pointAt.selection);
    else if (pointAt?.fromSelection) {
      const selected = pointAt.fromSelection;
      const rect = selected.getClientRects()[0];
      selection = selectedRange(selected.toString(), rect && point(rect.left+1, rect.top+rect.height/2));
      const first = selection?.[0];
      if (first?.index !== undefined) return {blocks, location:[first.index, first.shift]};
    }
    if (selection?.length) return {blocks:selection, location:[0,0]};
    const fallback = pages.slice(viewer().currentPageNumber-1).find(p=>p.blocks.length);
    const token = pointAt?.block ? pointAt : fallback?.blocks[0].tokens[0];
    return {blocks, location:[token?.block.index || 0, token?.start || 0]};
  }
  function clear() { marks?.remove(); marks = null; active = null; }
  function redraw(scroll = false) {
    if (!active) return;
    const {page, tokens} = active;
    const g = geometry(page);
    if (!g) return;
    marks?.remove();
    marks = document.createElement("div");
    marks.className = "readAloudPdfMarks";
    marks.setAttribute("aria-hidden","true");
    function add([l,t,r,b], word) {
      const [x,y] = rotate(l/page.width,t/page.height,g.rotation);
      const [u,v] = rotate(r/page.width,b/page.height,g.rotation);
      const el = document.createElement("div");
      if (word) el.className = "spokenWord";
      Object.assign(el.style, {left: 100*Math.min(x,u)+"%", top: 100*Math.min(y,v)+"%",
        width: 100*Math.abs(u-x)+"%", height: 100*Math.abs(v-y)+"%"});
      marks.append(el);
      return el;
    }
    for (const line of new Set(tokens.map(t=>t.line))) {
      const boxes = line.map(t=>t.rect);
      add([Math.min(...boxes.map(b=>b[0])),Math.min(...boxes.map(b=>b[1])),
        Math.max(...boxes.map(b=>b[2])),Math.max(...boxes.map(b=>b[3]))],false);
    }
    const first = tokens.map(t=>add(t.rect,true))[0];
    g.el.append(marks);
    if (scroll) {
      const word = first.getBoundingClientRect();
      const area = document.getElementById("viewerContainer").getBoundingClientRect();
      if (word.top < area.top || word.bottom > area.bottom || word.left < area.left || word.right > area.right)
        first.scrollIntoView({block:"center",inline:"nearest",behavior:"instant"});
    }
  }
  function paint(block,start,end) {
    const shift = block.shift || 0;
    const tokens = block.tokens.filter(t=>t.start < end+shift && t.end > start+shift);
    if (tokens.length) { active = {page:block.page, tokens}; redraw(true); }
  }
  return {reset, addPage, point, model, clear, paint, redraw,
    finish() { ready = true; return blocks.length > 0; }, get ready() {return ready;}};
})();
