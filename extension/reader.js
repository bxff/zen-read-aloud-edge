const readerController = (() => {
  const pdf = typeof pdfView === "undefined" ? null : pdfView;
  const pointAt = pdf ? pdf.point : readerText.pointAt;
  let lastPoint, menuPoint, bar, port, timer;
  let blocks = [], voices = [], blockIndex = 0, position = 0;
  let generation = 0, base = 0, limit = 0, wordEnd = 0;
  let playing = false, speaking = false;
  let stream, primed;
  let voiceId = "", preferred = "", rate = 1;
  const lang = document.documentElement.lang || navigator.language;
  const lineKey = "read-aloud-edge-line", wordKey = "read-aloud-edge-word";

  function refresh() {
    bar?.setState(playing, blockIndex > 0 || position > 0, blockIndex + 1 < blocks.length);
  }
  function stopTimer() {clearTimeout(timer);}
  function clearMarks() {
    if (pdf) {pdf.clear(); return;}
    CSS.highlights.delete(lineKey);
    CSS.highlights.delete(wordKey);
  }
  function prime() {
    if (primed) return;
    const opening = browser.runtime.connect({name:"read-aloud"});
    primed = opening;
    opening.onDisconnect.addListener(() => {if (primed === opening) primed = null;});
    opening.postMessage({type:"warm"});
  }
  function close() {
    if (primed) {primed.disconnect(); primed = null;}
    stopTimer();
    if (port) { const old = port; port = null; old.disconnect(); }
    bar?.remove();
    bar = null; blocks = []; voices = []; playing = speaking = false;
    generation++;
    clearMarks();
  }
  function fail(message) {
    cancel();
    playing = false;
    bar?.message(message);
    refresh();
  }
  function revealWordHorizontally(word) {
    const parent = word.startContainer.parentElement;
    const cell = parent.closest("th, td");
    for (let pane = parent; pane; pane = pane.parentElement) {
      if (pane.scrollWidth <= pane.clientWidth || !pane.clientWidth) continue;
      const viewport = pane === document.scrollingElement;
      if (!viewport && !["auto", "scroll"].includes(getComputedStyle(pane).overflowX)) continue;
      const left = viewport ? 0 : pane.getBoundingClientRect().left + pane.clientLeft;
      const right = left + pane.clientWidth;
      const spoken = word.getBoundingClientRect();
      if (spoken.left >= left && spoken.right <= right) continue;
      // Reveal the whole cell when it fits, so subsequent words do not keep nudging the table.
      const bounds = cell?.getBoundingClientRect();
      const target = bounds && bounds.width <= pane.clientWidth ? bounds : spoken;
      const delta = target.left < left ? target.left - left : target.right - right;
      pane.scrollBy({left: delta, behavior: "instant"});
    }
  }
  function paint(start, end) {
    const block = blocks[blockIndex];
    if (!block) return;
    if (pdf) {pdf.paint(block,start,end); return;}
    const word = readerText.rangeFor(block, start, end);
    const box = word?.getBoundingClientRect();
    if (!box?.height) return;
    const line = readerText.lineRange(block, start, end, box, lang);
    if (line) CSS.highlights.set(lineKey, new Highlight(line));
    const active = new Highlight(word);
    active.priority = 1;
    CSS.highlights.set(wordKey, active);
    if (box.top < 45 || box.bottom > innerHeight - 8) {
      word.startContainer.parentElement.scrollIntoView({block: "nearest", inline: "nearest"});
      const y = word.getBoundingClientRect().top;
      if (y < 45 || y > innerHeight - 28) window.scrollBy(0, y - innerHeight * .42);
    }
    revealWordHorizontally(word);
  }
  function cancel() {
    generation++; stream = null; stopTimer();
    speaking = false;
    if (port) { try { port.postMessage({type: "cancel"}); } catch {} }
  }
  function finishBlock() {
    if (blockIndex + 1 < blocks.length) {
      blockIndex++; position = 0; speak();
    } else {
      playing = false; speaking = false; position = blocks[blockIndex].text.length;
      clearMarks(); refresh();
    }
  }
  // Only request more source text when the audio queue has room.
  function passage(index, start) {
    for (; index < blocks.length; index++, start = 0) {
      const text = blocks[index].text;
      while (start < text.length && /\s/u.test(text[start])) start++;
      if (start === text.length) continue;
      let end = Math.min(text.length, start + 900);
      if (end < text.length) {
        const chunk = text.slice(start,end);
        const space = [...chunk.matchAll(/\s+/gu)].at(-1);
        if (space) end = start + space.index + space[0].length;
        else if (/[\uD800-\uDBFF]/.test(text[end-1])) end--;
      }
      return {block:index,start,end};
    }
    return null;
  }
  function supplyNext() {
    const previous = stream.tail;
    const next = passage(previous.block, previous.end);
    let part = null;
    if (next) {
      stream.tail = next;
      stream.parts.set(++stream.serial,next);
      part = {index:stream.serial,text:blocks[next.block].text.slice(next.start,next.end)};
    }
    port.postMessage({type:"supply",id:generation,part});
  }
  function speak() {
    if (!bar || !playing || !voiceId || !port || !blocks.length) return;
    const first = passage(blockIndex, position);
    if (!first) {finishBlock(); return;}
    blockIndex = first.block; base = position = first.start; limit = first.end;
    const continuous = voiceId.startsWith("local/") && !voiceId.startsWith("local/system/");
    stream = continuous ? {parts:new Map([[0, first]]), tail:first, serial:0} : null;
    speaking = false;
    const id = ++generation;
    port.postMessage({type:"speak", id, text:blocks[blockIndex].text.slice(base,limit), voice:voiceId, rate, continuous});
    stopTimer();
    if (!voiceId.startsWith("local/")) timer = setTimeout(() => fail("The speech service took too long to respond. Check its settings and try again."), 20000);
    refresh();
  }
  function chooseVoice(list) {
    const locale = lang.toLowerCase();
    const primary = locale.split("-")[0];
    const system = list.filter(v=>v.provider === "System");
    return list.find(v=>v.id === preferred) ||
      system.find(v=>v.lang.toLowerCase() === locale && v.name === "Samantha") ||
      system.find(v=>v.lang.toLowerCase() === locale) ||
      system.find(v=>v.lang.toLowerCase().split("-")[0] === primary) || system[0];
  }
  function received(event) {
    if (!bar) return;
    if (event.kind === "failure") {
      voiceId = "";
      fail(event.message);
      return;
    }
    if (event.kind === "voices") {
      voices = event.voices;
      const selected = chooseVoice(voices);
      if (!selected && !voices.some(v=>v.id === voiceId)) {
        bar.setVoices(voices, "", rate);
        stopTimer(); voiceId = ""; bar.message("Choose a voice or configure a speech service in Voice Options.");
        return;
      }
      if (voiceId && !voices.some(v=>v.id === voiceId)) {
        cancel(); clearMarks(); playing = false; refresh();
      }
      const first = !voiceId;
      if (first || !voices.some(v => v.id === voiceId)) voiceId = selected?.id || "";
      bar.setVoices(voices, voiceId, rate);
      if (first && voiceId) {stopTimer(); bar.message(""); speak();}
      return;
    }
    if (event.id !== generation) return;
    if (event.kind === "need" && stream) {supplyNext(); return;}
    if (event.kind === "progress") {bar.message(event.message,true); return;}
    if (event.kind === "buffering" && playing) {bar.message("Preparing next passage…",true); return;}
    if (event.kind === "buffered") {bar.message(""); return;}
    if (event.kind === "start") {
      speaking = true; stopTimer(); bar.message("");
    } else if (event.kind === "boundary" && event.boundary === "word" && playing) {
      if (stream) {
        const part = stream.parts.get(event.part);
        if (!part) return;
        if (blockIndex !== part.block) { blockIndex = part.block; refresh(); }
        base = part.start; limit = part.end;
        for (const index of stream.parts.keys()) {
          if (index >= event.part) break;
          stream.parts.delete(index);
        }
      }
      position = base + event.offset;
      const block = blocks[blockIndex];
      const fallback = () => readerText.words(block, lang).find(w => w.end > position)?.end || position + 1;
      wordEnd = Math.min(limit, event.length > 0 ? position + event.length : fallback());
      paint(position, wordEnd);
    } else if (event.kind === "end") {
      bar.message("");
      speaking = false;
      if (stream) {
        blockIndex = stream.tail.block; limit = stream.tail.end; stream = null;
      }
      position = limit;
      if (playing) speak();
    } else if (event.kind === "error") fail(event.message + " Press Play to retry or choose another voice.");
  }
  function toggle() {
    if (!blocks.length) return;
    if (playing) {
      playing = false; bar.message("");
      if (speaking) port.postMessage({type: "pause"});
      else cancel();
    } else {
      if (!port || !voiceId) { start(lastPoint); return; }
      playing = true;
      bar.message("");
      if (speaking) port.postMessage({type: "resume"});
      else {
        if (position >= blocks[blockIndex].text.length && blockIndex === blocks.length - 1) {blockIndex = 0; position = 0;}
        speak();
      }
    }
    refresh();
  }

  function jump(i, offset) {
    cancel(); clearMarks();
    blockIndex = i; position = offset; wordEnd = offset;
    playing = true; bar.message(""); speak(); refresh();
  }
  function change(settings) {
    if ("rate" in settings) rate = settings.rate;
    if ("voice" in settings) preferred = voiceId = settings.voice;
    if ("voice" in settings) clearMarks();
    browser.storage.local.set(settings);
    bar?.message("");
    cancel();
    if (playing) speak();
  }
  function build(point, selection) {
    if (pdf) {
      const result = pdf.model(point,selection);
      blocks = result.blocks;
      [blockIndex, position] = result.location;
      wordEnd = position;
      return;
    }
    const root = selection || point ? document.body :
      document.querySelector("article,main,[role=main]") || document.body;
    blocks = readerText.collect(root, selection);
    [blockIndex, position] = readerText.locate(blocks, point, lang);
    wordEnd = position;
  }
  async function start(point, selection = null) {
    const opening = primed;
    primed = null;
    close();
    port = opening;
    build(point, selection);
    if (selection) getSelection().removeAllRanges();
    bar = readerToolbar({
      close, toggle, prev: () => jump(Math.max(0, blockIndex - 1), 0),
      next: () => jump(Math.min(blocks.length - 1, blockIndex + 1), 0),
      rate: rate => change({rate}), voice: voice => change({voice})
    });
    if (!blocks.length) {bar.message("No readable text here."); refresh(); return;}
    const instance = bar;
    playing = true; voiceId = ""; refresh();
    bar.message("Loading voices…",true);
    const settings = await browser.storage.local.get(["rate", "voice"]);
    if (bar !== instance) return;
    rate = readerSpeed.nearest(settings.rate); preferred = settings.voice || "";
    port ||= browser.runtime.connect({name: "read-aloud"});
    port.onMessage.addListener(received);
    port.onDisconnect.addListener(disconnected => {
      if (bar === instance && port === disconnected) close();
    });
    if (opening) {
      try {port.postMessage({type:"catalog"});}
      catch {port = null; start(point,selection); return;}
    }
    timer = setTimeout(() => fail("Choose a voice in Voice Options, then press Play."), 20000);
  }

  function selectionRange() {
    const selection = getSelection();
    return selection?.rangeCount && !selection.isCollapsed ? selection.getRangeAt(0).cloneRange() : null;
  }
  function selectionPoint(range) {
    if (range.startContainer.nodeType === Node.TEXT_NODE)
      return {node:range.startContainer, offset:range.startOffset};
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const contents = document.createRange();
      contents.selectNodeContents(node);
      if (contents.compareBoundaryPoints(Range.END_TO_START, range) > 0)
        return {node, offset:0};
    }
    return null;
  }
  const interactiveClick = 'a[href],area[href],button,input,select,textarea,option,summary,label,[contenteditable]:not([contenteditable="false"]),[tabindex]:not([tabindex="-1"]),[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="switch"],[role="tab"],[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],[role="option"],[role="combobox"],[role="textbox"],[role="slider"],[role="spinbutton"],[role="treeitem"]';
  function isInteractiveClick(event) {
    return event.composedPath().some(node => node instanceof Element &&
      node !== document.body && node !== document.documentElement &&
      (node.matches(interactiveClick) || typeof node.onclick === "function" ||
       getComputedStyle(node).cursor === "pointer"));
  }
  document.addEventListener("pointerdown", event => {
    if (!event.isTrusted || event.target === bar?.host || event.target === hostedToolbar?.el) return;
    lastPoint = pointAt(event.clientX, event.clientY);
    browser.runtime.sendMessage({type: "frame"}).catch(() => {});
  }, true);
  document.addEventListener("contextmenu", event => {
    if (!event.isTrusted || event.target === bar?.host || event.target === hostedToolbar?.el) return;
    menuPoint = pointAt(event.clientX, event.clientY);
  }, true);
  document.addEventListener("click", event => {
    if (!bar || !event.isTrusted || event.composedPath().includes(bar.host) || event.button || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || selectionRange() || isInteractiveClick(event)) return;
    const point = pointAt(event.clientX, event.clientY);
    if (!point) return;
    build(point, null);
    if (blocks.length) jump(blockIndex, position);
  });
  document.addEventListener("keydown", event => {
    if (bar && event.key === "Escape") {
      if (!bar.dismissOptions()) close();
      event.stopPropagation();
    }
  }, true);
  window.addEventListener("pagehide", close);
  window.addEventListener("resize", () => {
    if (bar && wordEnd > position) paint(position, wordEnd);
  });
  function activate(message) {
    if (message.type === "toggle") {
      const selected = selectionRange();
      if (selected) {
        const point = pdf ? {fromSelection:selected} : selectionPoint(selected);
        if (point) {
          getSelection().removeAllRanges();
          start(point);
          return;
        }
      }
    }
    if (message.type === "toggle" && bar) toggle();
    else if (["toggle", "read-here", "read-selection"].includes(message.type)) {
      const selected = message.type === "read-here" ? null : selectionRange();
      start(selected ? null : message.type === "read-here" ? menuPoint : lastPoint, selected);
    }
  }
  if (!pdf) browser.runtime.onMessage.addListener(activate);
  return {activate, close, start, prime};
})();
