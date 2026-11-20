const readerSpeed = {
  min: 0.5,
  max: 2,
  step: 0.25,
  nearest(rate) {
    if (!Number.isFinite(rate)) return 1;
    return Math.min(this.max, Math.max(this.min, Math.round(rate / this.step) * this.step));
  }
};

// Used both inside the reader toolbar and while PDF.js opens the document.
const readerStateStyle = `
  .reader-state {display:flex;align-items:center;gap:8px;min-width:0;
    font:menu;font-size:12px;font-weight:500;line-height:1.4;color:inherit}
  .reader-state[hidden]{display:none!important}
  .state-text {white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .state-mark {display:block;flex:0 0 auto;width:13px;height:13px;border-radius:50%;
    border:1.5px solid color-mix(in srgb,currentColor 23%,transparent);
    border-top-color:currentColor;animation:reader-spin .9s linear infinite}
  .reader-state[data-error] .state-mark {border:1px solid currentColor;animation:none;
    font:600 10px/12px system-ui;text-align:center}
  .reader-state[data-error] .state-text {white-space:normal;overflow-wrap:anywhere}
  .state-live {position:absolute;width:1px;height:1px;clip-path:inset(50%);overflow:hidden}
  @keyframes reader-spin {to{transform:rotate(1turn)}}
  @media(prefers-reduced-motion:reduce){.state-mark{animation:none}}
  @media(forced-colors:active){.state-mark{border-color:GrayText;border-top-color:CanvasText}}
`;
function createReaderState(parent) {
  const row = document.createElement("div");
  row.className = "reader-state";
  const mark = document.createElement("span"), label = document.createElement("span");
  mark.className = "state-mark"; mark.setAttribute("aria-hidden","true"); label.className = "state-text";
  row.append(mark,label); row.hidden = true;
  const live = document.createElement("span");
  live.className = "state-live"; live.setAttribute("role","status");
  parent.append(row,live);
  return (text, busy = false) => {
    row.hidden = !text;
    row.toggleAttribute("data-error",!busy && !!text);
    mark.textContent = busy ? "" : "!";
    label.textContent = text; row.title = text;
    // Announce the download once; byte counts remain available in the toolbar.
    const stage = text.split(" · ")[0];
    if (live.textContent !== stage) live.textContent = stage;
  };
}

function createReaderBar(actions) {
  const host = document.createElement("div");
  host.dataset.edgeReadAloudUi = "";
  host.style.cssText = "all:initial!important;display:block!important;position:fixed!important;inset:0 0 auto!important;z-index:2147483647!important;";
  const root = host.attachShadow({mode: "closed"});
  const style = document.createElement("style");
  style.textContent = `
    :host{color-scheme:light dark}
    *{box-sizing:border-box}
    .bar,.panel{--bg:#f5f5f5;--fg:#222;--hover:#0001;--border:#0002;font:14px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--fg);background:var(--bg)}
    @media(prefers-color-scheme:dark){.bar,.panel{--bg:#333;--fg:#f4f4f4;--hover:#fff2;--border:#fff3}}
    .bar{height:40px;display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;padding:0 8px 0 25px;border-bottom:1px solid var(--border)}
    .title,.group,.side{display:flex;align-items:center;gap:2px}
    .title{font-weight:650;gap:12px;overflow:hidden;white-space:nowrap}.side{justify-self:end}
    button{background:transparent;color:inherit;border:0;cursor:pointer;font:inherit;height:32px;min-width:34px;border-radius:4px;display:inline-flex;gap:7px;align-items:center;justify-content:center}
    button:hover,button[aria-expanded=true]{background:var(--hover)}button:disabled{opacity:.35;cursor:default}
    button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid Highlight;outline-offset:-2px}
    svg{width:18px;height:18px;flex:none} .voice{padding:0 8px;max-width:100%}.side{min-width:0;max-width:100%}.voice span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.voice svg:last-child{width:12px}
    .panel {
      color-scheme:light dark; font:menu;
      --surface:light-dark(#f4f4f4,#1f1f1f); --fg:MenuText;
      --muted:color-mix(in srgb, var(--fg) 72%, var(--surface));
      --line:color-mix(in srgb, var(--fg) 15%, transparent);
      --track:color-mix(in srgb, var(--fg) 19%, var(--surface));
      --filled:var(--fg); --knob:var(--surface);
      position:absolute; inset:46px 8px auto auto; width:min(316px, calc(100vw - 16px));
      max-height:calc(100dvh - 54px); overflow:auto; overscroll-behavior:contain;
      padding:4px 0; border:1px solid var(--line); border-radius:10px;
      box-shadow:0 4px 16px #0003; background:var(--surface); color:var(--fg);
      text-align:left; direction:ltr;
    }
    .speed-section {padding:8px 18px}
    [hidden]{display:none!important}
    .speed-head {display:flex; align-items:center; justify-content:space-between}
    .speed-head label {font-size:13px; font-weight:600}
    .speed-head output {font-size:12px; font-variant-numeric:tabular-nums; color:var(--muted)}
    .speed-control {position:relative; height:32px; margin:4px 0}
    .rail, .ticks {position:absolute; top:50%; transform:translateY(-50%); pointer-events:none}
    .rail {
      inset-inline:0; height:3px; border-radius:3px;
      background:linear-gradient(to right, var(--filled) var(--center), var(--track) var(--center));
    }
    .ticks {inset-inline:9px; height:6px; display:flex; justify-content:space-between}
    .tick {width:1px; background:var(--track)}
    #speed {
      appearance:none; margin:0; width:100%; height:100%; position:relative;
      background:transparent; display:block; cursor:pointer;
    }
    #speed::-moz-range-track, #speed::-moz-range-progress {height:3px; background:transparent}
    #speed::-moz-range-thumb {
      box-sizing:border-box; width:18px; height:18px; border:1px solid var(--filled);
      border-radius:50%; background:var(--knob); box-shadow:0 1px 3px #0003;
    }
    #speed:focus-visible {outline:none}
    #speed:focus-visible::-moz-range-thumb {outline:2px solid Highlight; outline-offset:2px}
    .scale {position:relative; display:flex; justify-content:space-between; color:var(--muted); font-size:11px; line-height:14px}
    .scale span:nth-child(2) {position:absolute; left:calc(100% / 3 + 3px); transform:translateX(-50%)}
    .filters {margin-top:2px; padding-top:2px; border-top:1px solid var(--line)}
    .configure {margin:4px 12px;padding:4px 8px;font:menu}
    .voice-download {margin:6px 18px; font-size:12px; color:var(--muted)}
    .filter-row {position:relative; margin:2px 4px; border-radius:5px}
    .filter-row:hover:has(select:enabled), .filter-row:focus-within {
      background:color-mix(in srgb, var(--fg) 8%, transparent)
    }
    .filter-row label {position:absolute; inset-inline-start:14px; top:50%;
      transform:translateY(-50%); pointer-events:none}
    .voice-field svg {position:absolute; width:12px; height:12px; right:14px;
      top:50%; transform:translateY(-50%); color:var(--muted); pointer-events:none}
    .voice-field select {appearance:none; display:block; width:100%; min-height:32px;
      margin:0; padding:8px 33px 8px 88px; border:0; border-radius:5px; font:inherit;
      text-align:end; text-overflow:ellipsis; color:var(--muted); background:transparent}
    .voice-field select:disabled {opacity:.65}
    .voice-field option {color:CanvasText; background:Canvas}
    @media(forced-colors:active) {
      .rail {background:CanvasText} .tick {background:CanvasText}
      #speed::-moz-range-thumb {border-color:ButtonText; background:ButtonFace}
    }
    ${readerStateStyle}
    .bar {color-scheme:light dark;--bg:light-dark(#f4f4f4,#1f1f1f);--fg:MenuText;font:menu}
    .title {min-width:0}
    .title .reader-state{color:color-mix(in srgb,var(--fg) 78%,var(--bg))}
    .bar:has(.reader-state:not([hidden])) .brand {display:none}
    .brand{display:inline-flex;align-items:center;gap:9px}
    .bar:has(.reader-state[data-error]:not([hidden])){height:auto;min-height:40px;row-gap:3px;padding-block:3px}
    .bar:has(.reader-state[data-error]:not([hidden])) .title{grid-column:1/-1;white-space:normal}
    .bar:has(.reader-state[data-error]:not([hidden])) .group{grid-column:2}
    @media(max-width:520px){.bar{padding-left:8px}.title{gap:4px}.voice span{display:none}.voice{padding:0}.group{gap:0}}
  `;
  root.append(style);
  const paths = {
    sound: "M3 5v14m5-9v4m5-7v10m5-6v2",
    prev: "M4 4v16M20 4 8 12l12 8z", next: "M20 4v16M4 4l12 8-12 8z",
    play: "M6 3.5 20 12 6 20.5z", pause: "M5 3h5v18H5zM15 3h5v18h-5z",
    voice: "M11 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM3 15q8-4 15 0v2q-6 7-15 0zM18 4q3 3 0 6M21 2q4 5 0 10",
    down: "m4 9 8 8 8-8", close: "M5 5l14 14M19 5 5 19"
  };
  function icon(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const path = document.createElementNS(svg.namespaceURI, "path");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    path.setAttribute("d", paths[name]);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.5");
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("stroke-linecap", "round");
    svg.append(path);
    return svg;
  }
  function add(tag, parent, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text) el.textContent = text;
    parent.append(el);
    return el;
  }
  function button(parent, label, image, callback) {
    const el = add("button", parent);
    el.title = label;
    el.setAttribute("aria-label", label);
    el.append(icon(image));
    el.onclick = callback;
    return el;
  }
  const bar = add("div", root, "bar");
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Read Aloud");
  const title = add("div", bar, "title");
  const brand = add("span",title,"brand");
  brand.append(icon("sound"), document.createTextNode("Read Aloud"));
  const showState = createReaderState(title);
  let stateTimer, visibleState = false;
  const group = add("div", bar, "group");
  const prev = button(group, "Read previous paragraph", "prev", actions.prev);
  const play = button(group, "Pause Read Aloud", "pause", actions.toggle);
  const next = button(group, "Read next paragraph", "next", actions.next);
  const side = add("div", bar, "side");
  const options = button(side, "Voice Options", "voice", () => showOptions(panel.hidden));
  options.className = "voice";
  const optionsLabel = add("span", options, "", "Voice Options");
  options.append(icon("down"));
  options.setAttribute("aria-expanded", "false");
  button(side, "Close Read Aloud", "close", actions.close);
  const panel = add("div", root, "panel");
  panel.hidden = true;
  panel.tabIndex = -1;
  panel.setAttribute("role", "group");
  panel.setAttribute("aria-label", "Voice Options");
  function showOptions(open) {
    panel.hidden = !open;
    options.setAttribute("aria-expanded", String(open));
    if (open) panel.focus({preventScroll:true});
  }
  function dismissOutside(event) {
    if (!panel.hidden && !event.composedPath().includes(host)) showOptions(false);
  }
  document.addEventListener("pointerdown", dismissOutside, true);
  const speedSection = add("div", panel, "speed-section");
  const speedHead = add("div", speedSection, "speed-head");
  const label = add("label", speedHead, "", "Speed");
  const speedValue = add("output", speedHead);
  speedValue.setAttribute("for", "speed");
  label.htmlFor = "speed";
  const control = add("div", speedSection, "speed-control");
  const rail = add("div", control, "rail");
  const ticks = add("div", control, "ticks");
  ticks.setAttribute("aria-hidden", "true");
  for (let value = readerSpeed.min; value <= readerSpeed.max; value += readerSpeed.step) {
    add("span", ticks, "tick");
  }
  const speed = add("input", control);
  speed.id = "speed";
  speed.type = "range";
  speed.min = readerSpeed.min;
  speed.max = readerSpeed.max;
  speed.step = readerSpeed.step;
  function paintSpeed() {
    const fraction = (speed.valueAsNumber - readerSpeed.min) / (readerSpeed.max - readerSpeed.min);
    // The thumb's center travels between its radius and the far edge minus its radius.
    rail.style.setProperty("--center", `calc(${fraction * 100}% + ${9 - 18 * fraction}px)`);
    speedValue.value = speed.value + "×";
    speed.setAttribute("aria-valuetext", speedValue.value);
  }
  speed.oninput = paintSpeed;
  speed.onchange = () => actions.rate(speed.valueAsNumber);
  speed.value = 1;
  paintSpeed();
  const scale = add("div", speedSection, "scale");
  for (const s of ["Slow", "Normal", "Fast"]) add("span", scale, "", s);
  const filters = add("div", panel, "filters");
  function dropdown(id, caption) {
    const row = add("div", filters, "filter-row");
    add("label", row, "", caption).htmlFor = id;
    const field = add("div", row, "voice-field");
    const select = add("select", field);
    select.id = id;
    select.disabled = true;
    select.add(new Option("Loading…", ""));
    field.append(icon("down"));
    return select;
  }
  const provider = dropdown("provider", "Provider");
  const language = dropdown("language", "Language");
  const voice = dropdown("voice", "Voice");
  const download = add("p", panel, "voice-download");
  download.hidden = true;
  const configure = add("button", panel, "configure", "Configure speech API…");
  configure.onclick = () => browser.runtime.sendMessage({type:"speech-settings"});
  const names = new Intl.DisplayNames(navigator.languages, {type:"language"});
  const byLabel = new Intl.Collator(navigator.languages, {sensitivity:"base", numeric:true});
  let catalog = [], currentVoice = "";
  function entry(v) {
    const provider = v.provider || (v.local ? "System" : "Speech API");
    let locale = (v.lang || "").replaceAll("_", "-"), language = locale;
    try {
      locale = Intl.getCanonicalLocales(locale)[0];
      language = names.of(locale);
    } catch { /* Keep unrecognized tags as received from the speech engine. */ }
    return {id:v.id, provider, download:v.download, locale:locale || "und", language:language || "Unspecified", name:v.name};
  }
  function choices(select, labels, selected) {
    const items = [...labels].sort((a,b) => byLabel.compare(a[1],b[1]));
    select.replaceChildren(...items.map(([value,label]) => new Option(label,value)));
    if (labels.has(selected)) select.value = selected;
    select.disabled = items.length < 2;
  }
  function updateVoices() {
    const matches = catalog.filter(v => v.provider === provider.value && v.locale === language.value);
    download.textContent = matches[0]?.download || "";
    download.hidden = !download.textContent;
    const active = matches.some(v => v.id === currentVoice);
    choices(voice, new Map(matches.map(v => [v.id,v.name])), currentVoice);
    if (!active) {
      const prompt = new Option("Choose a voice…", "");
      prompt.disabled = true;
      voice.prepend(prompt);
      voice.value = "";
      voice.disabled = !matches.length;
    }
  }
  function updateLanguages(preferred) {
    const available = catalog.filter(v => v.provider === provider.value);
    const labels = new Map(available.map(v => [v.locale,v.language]));
    const related = available.find(v => v.locale.split("-")[0] === preferred.split("-")[0]);
    choices(language, labels, labels.has(preferred) ? preferred : related?.locale);
    updateVoices();
  }
  const remembered = new Map();
  function describe(active) {
    if (!active) return;
    optionsLabel.textContent = active.provider + " · " + active.name;
    options.title = "Voice Options — " + optionsLabel.textContent;
    remembered.set(active.provider + "/" + active.locale, active.id);
  }
  function applyVoice(id) {
    const active = catalog.find(v => v.id === id);
    if (!active) return;
    currentVoice = id;
    updateVoices();
    describe(active);
    actions.voice(id);
  }
  function applyFilter() {
    const matches = catalog.filter(v => v.provider === provider.value && v.locale === language.value);
    const last = remembered.get(provider.value + "/" + language.value);
    const choice = matches.find(v => v.id === last) || matches[0];
    if (choice && choice.id !== currentVoice) applyVoice(choice.id);
  }
  provider.onchange = () => {updateLanguages(language.value); applyFilter();};
  language.onchange = () => {updateVoices(); applyFilter();};
  voice.onchange = () => applyVoice(voice.value);
  const spacer = document.createElement("div");
  spacer.dataset.edgeReadAloudUi = "";
  spacer.style.cssText = "all:initial!important;display:block!important;height:40px!important;pointer-events:none!important;";
  document.body.before(spacer);
  document.documentElement.append(host);
  return {
    host,
    setState(playing, before, after) {
      const name = playing ? "Pause Read Aloud" : "Continue to Read Aloud";
      play.title = name; play.setAttribute("aria-label", name);
      play.replaceChildren(icon(playing ? "pause" : "play"));
      prev.disabled = !before; next.disabled = !after;
    },
    setVoices(voices, chosen, rate) {
      const reset = currentVoice !== chosen || !catalog.length;
      catalog = voices.map(entry);
      currentVoice = chosen;
      const active = catalog.find(v => v.id === chosen);
      describe(active);
      const source = reset ? active?.provider : provider.value;
      const locale = (reset ? active?.locale : language.value) || navigator.language;
      choices(provider, new Map(catalog.map(v => [v.provider,v.provider])), source);
      updateLanguages(locale);
      speed.value = readerSpeed.nearest(rate);
      paintSpeed();
    },
    message(text, busy = false) {
      clearTimeout(stateTimer);
      const apply = () => { visibleState = !!text; showState(text,busy); };
      if (text && busy && !visibleState) stateTimer = setTimeout(apply,160);
      else apply();
    },
    dismissOptions() { if (!panel.hidden) {showOptions(false); options.focus(); return true;} return false; },
    remove() {
      document.removeEventListener("pointerdown", dismissOutside, true);
      clearTimeout(stateTimer); host.remove(); spacer.remove();
    }
  };
}
