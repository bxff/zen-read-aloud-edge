const builtInVoiceList = Object.entries(localProviders).flatMap(([key, spec]) =>
  (spec.voices || []).map(([id, name, lang]) => ({
    id: "local/" + key + "/" + id, name, lang, local: true, provider: spec.provider, download: spec.download
  }))
);

// Retain one fully loaded engine briefly when a reader closes. A frame is
// always leased to a single reader, including when two tabs speak concurrently.
let idleEngine, idleTimer;
function discardIdle() {
  clearTimeout(idleTimer);
  idleEngine?.frame.remove();
  idleEngine = null;
}

function openVoiceSession(client) {
  const cacheScope = [client.sender.tab?.id,client.sender.frameId,client.sender.url].join("|");
  let closed = false, runtime, current, service, catalogReady = false, configVersion = 0;
  let connector;
  const send = message => { if (!closed) client.postMessage(message); };

  function publish() {
    if (!catalogReady || closed) return;
    const systemVoices = speechSynthesis.getVoices().filter(v => v.localService);
    const system = systemVoices.map(v => ({
      id: "local/system/" + v.voiceURI, name: v.name, lang: v.lang, local: true, provider: "System"
    }));
    const online = service?.voices && ["native","timed-json"].includes(service.format) ? service.voices.map(v => ({
      id:providerVoiceId(service,v),name:v.name,lang:v.lang,provider:service.name || "Speech API",
      local:service.format === "native" && Boolean(v.local)
    })) : service ? [{id:"remote/"+service.id,name:service.voice || new URL(service.endpoint).hostname,lang:service.language,
      provider:service.name || "Speech API",local:false}] : [];
    send({kind:"voices",voices:[...system,...online,...builtInVoiceList]});
  }
  function releaseRuntime(keepWarm = false) {
    if (!runtime) return;
    if (keepWarm && runtime.engine && !runtime.engine.busy && runtime.key !== "system") {
      discardIdle();
      idleEngine = runtime;
      idleEngine.progress = null;
      idleTimer = setTimeout(discardIdle, 45000);
    } else {
      runtime.reject(Error("Voice engine closed."));
      runtime.frame.remove();
    }
    runtime = null;
  }
  function cancel() {
    current?.control.abort();
    current = null;
  }
  function close() {
    if (closed) return;
    closed = true;
    cancel();
    releaseRuntime(true);
    connector?.close();
    browser.storage.onChanged.removeListener(settingsChanged);
    speechSynthesis.removeEventListener("voiceschanged", publish);
  }
  function settingsChanged(changes,area) {
    if (area !== "local") return;
    if (!changes.speechService) return;
    configVersion++;
    service = changes.speechService.newValue;
    if (current?.remote) {
      const id = current.id;
      cancel();
      send({kind:"error",id,message:"The speech service settings changed."});
    }
    connector?.close();
    connector = null;
    publish();
  }
  function engineFor(key) {
    if (runtime?.key === key) return runtime.promise;
    releaseRuntime();
    const progress = message => {
      if (current?.local) send({kind:"progress",id:current.id,message});
    };
    if (idleEngine?.key === key) {
      clearTimeout(idleTimer);
      runtime = idleEngine;
      idleEngine = null;
      runtime.progress = progress;
      return runtime.promise;
    }
    discardIdle();
    const spec = localProviders[key];
    const frame = document.createElement("iframe");
    frame.hidden = true;
    const ready = Promise.withResolvers();
    const slot = {key, frame, reject: ready.reject, promise: ready.promise, progress, engine:null};
    runtime = slot;
    frame.onload = async () => {
      if (runtime !== slot) return;
      frame.onload = null;
      try {
        const engine = await frame.contentWindow.loadVoiceEngine(spec, message => {
          slot.progress?.(message);
        });
        slot.engine = engine;
        ready.resolve(engine);
      } catch (err) {
        ready.reject(err);
        if (runtime === slot) releaseRuntime();
      }
    };
    frame.src = browser.runtime.getURL("local/runtime.html");
    document.body.append(frame);
    return slot.promise;
  }
  async function handle(command) {
    if (closed) return;
    if (command.type === "catalog") {publish(); return;}
    if (command.type === "warm") {
      const {voice} = await browser.storage.local.get("voice");
      const key = /^local\/([^/]+)\//.exec(voice)?.[1];
      if (!closed && !current && !runtime && key && Object.hasOwn(localProviders,key)) {
        // Start the selected engine while PDF.js and the helper index the file.
        // A normal speak request reports initialization errors and permits retry.
        engineFor(key).catch(()=>{});
      }
      return;
    }
    if (command.type === "cancel") { cancel(); return; }
    if (command.type === "pause" || command.type === "resume") {
      current?.control[command.type]?.();
      return;
    }
    if (command.type === "supply") {
      if (current?.id === command.id) current.resolvePart?.(command.part);
      return;
    }
    if (command.type !== "speak") return;
    // Synchronous WASM inference may still be running after cancellation.
    // Keep a new seek or reader from queuing behind that abandoned work.
    const busy = runtime?.engine?.busy;
    cancel();
    if (busy) releaseRuntime();
    const match = /^local\/([^/]+)\/(.+)$/.exec(command.voice);
    const control = new AbortController();
    if (!match && service?.format === "native") {
      releaseRuntime();
      current = {id:command.id,control,remote:true};
      try {
        const voice = service.voices.find(v => providerVoiceId(service,v) === command.voice);
        if (!voice) throw Error("Choose an available connector voice.");
        connector ||= openSpeechConnector(service.endpoint, voice.id, event => {
          if (current?.remote && current.id === event.id) send(event);
        }, message => {
          connector = null;
          if (current?.remote) send({kind:"error",id:current.id,message});
        });
        const session = connector;
        const voices = await session.ready;
        if (control.signal.aborted) return;
        if (!voices.some(v => v.id === voice.id)) throw Error("This voice is unavailable. Save the API again to refresh the voice list.");
        control.signal.addEventListener("abort", () => session.post({type:"cancel"}), {once:true});
        control.pause = () => session.post({type:"pause"});
        control.resume = () => session.post({type:"resume"});
        session.post({...command,voice:voice.id});
      } catch (error) {
        if (!control.signal.aborted) send({kind:"error",id:command.id,message:error.message});
      }
      return;
    }
    connector?.close();
    connector = null;
    if (!match) {
      releaseRuntime();
      current = {id:command.id,control,remote:true};
      try {
        if (!service) throw Error("Choose a configured speech service.");
        let config = service;
        if (service.format === "timed-json" && service.voices) {
          const voice = service.voices.find(v => providerVoiceId(service,v) === command.voice);
          if (!voice) throw Error("Choose an available provider voice.");
          config = {...service,voice:voice.id,language:voice.lang};
        } else if (command.voice !== "remote/" + service.id) {
          throw Error("Choose a configured speech service.");
        }
        const {playService} = await import(browser.runtime.getURL("service/engine.mjs"));
        if (!control.signal.aborted) await playService(config,command,control,event=>{
          if (!control.signal.aborted) send({...event,id:command.id});
        });
      } catch (err) {
        if (!control.signal.aborted) send({kind:"error",id:command.id,message:err.message});
      }
      return;
    }
    const [,key,voice] = match;
    const request = {id:command.id,local:true,control};
    current = request;
    if (command.continuous) {
      control.nextPart = () => {
        if (control.signal.aborted) return Promise.resolve(null);
        const reply = Promise.withResolvers();
        request.resolvePart = reply.resolve;
        send({kind:"need", id:command.id});
        return reply.promise;
      };
      control.signal.addEventListener("abort", () => request.resolvePart?.(null), {once:true});
    }
    try {
      if (!Object.hasOwn(localProviders,key)) throw Error("Unknown voice engine.");
      send({kind:"progress", id:command.id, message:"Preparing " + localProviders[key].provider + "…"});
      const engine = await engineFor(key);
      if (control.signal.aborted) return;
      if (!engine.voices.some(v => v.id === voice)) throw Error("This voice is unavailable.");
      await engine.speak({...command, voice, cacheScope}, control, event => {
        if (!control.signal.aborted) send({...event, id:command.id});
      });
    } catch (err) {
      if (!control.signal.aborted) send({kind:"error", id:command.id, message:String(err)});
    }
  }
  client.onMessage.addListener(handle);
  speechSynthesis.addEventListener("voiceschanged", publish);
  browser.storage.onChanged.addListener(settingsChanged);
  browser.storage.local.get("speechService").then(settings=>{
    if (closed) return;
    if (!configVersion) service = settings.speechService;
    catalogReady = true;
    publish();
  });
  return close;
}
