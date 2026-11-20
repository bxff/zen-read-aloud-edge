// A definition contains data only. User-supplied code is never evaluated.
function validateSpeechService(definition) {
  const obj = typeof definition === "string" ? {endpoint:definition} : definition;
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw Error("Enter a URL or a JSON provider definition.");
  const allowed = ["version","name","endpoint","voice","voices","language","headers","request","response"];
  for (const field of Object.keys(obj)) {
    if (!allowed.includes(field)) throw Error("Unknown provider field: " + field);
  }
  if (obj.version !== undefined && obj.version !== 1) throw Error("Unsupported provider definition version.");
  for (const field of ["name","endpoint","voice","language"]) {
    if (obj[field] !== undefined && typeof obj[field] !== "string") throw Error(field + " must be text.");
  }
  let url;
  try {url = new URL(obj.endpoint);} catch {throw Error("Enter a complete provider URL.");}
  if (url.username || url.password || url.hash) throw Error("Remove embedded account credentials and fragments.");
  const native = url.protocol === "native:";
  if (native) {
    if (!/^[a-z0-9_]+(?:\.[a-z0-9_]+)*$/.test(url.hostname) || !["","/"].includes(url.pathname) || url.port || url.search)
      throw Error("Enter a valid native messaging host name.");
    if (obj.headers || obj.request || obj.response || obj.voices !== undefined)
      throw Error("Request mappings and voice lists apply to HTTP providers.");
  } else {
    const loopback = ["localhost","127.0.0.1","[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(loopback && url.protocol === "http:"))
      throw Error("Use an HTTPS speech API, a loopback HTTP service, or an installed native connector.");
  }
  const result = {format:native ? "native" : "timed-json",endpoint:url.href,voice:obj.voice || "",language:obj.language || navigator.language};
  try {result.language = Intl.getCanonicalLocales(result.language)[0];} catch {throw Error("Enter a valid language tag.");}
  if (obj.voices !== undefined) {
    if (!Array.isArray(obj.voices) || !obj.voices.length) throw Error("List at least one provider voice.");
    const ids = new Set();
    result.voices = obj.voices.map(voice => {
      if (!voice || typeof voice.id !== "string" || !voice.id.trim() || !voice.id.isWellFormed() ||
          ids.has(voice.id) || typeof voice.name !== "string" || !voice.name.trim() ||
          typeof voice.lang !== "string" || !voice.lang.trim())
        throw Error("Each provider voice needs a unique ID, a name, and a language tag.");
      let lang;
      try { [lang] = Intl.getCanonicalLocales(voice.lang); }
      catch { throw Error("Enter a valid language tag for " + voice.name + "."); }
      ids.add(voice.id);
      return {id:voice.id,name:voice.name.trim(),lang};
    });
    if (result.voice && !ids.has(result.voice)) throw Error("The default voice must match an ID in the voice list.");
  }
  if (obj.name?.trim()) result.name = obj.name.trim();
  for (const field of ["headers","request","response"]) {
    if (obj[field] === undefined) continue;
    if (!obj[field] || typeof obj[field] !== "object" || Array.isArray(obj[field])) throw Error(field + " must be a JSON object.");
    result[field] = obj[field];
  }
  for (const [header,value] of Object.entries(result.headers || {})) {
    if (!/^[a-z0-9-]+$/i.test(header) || /^(cookie|host|origin|referer|proxy-|sec-)/i.test(header) ||
        typeof value !== "string" || /[\r\n]/.test(value))
      throw Error("Unsupported HTTP header in provider definition.");
  }
  if (result.request && !JSON.stringify(result.request).includes('"{{text}}"')) throw Error("The request must include {{text}} as a field value.");
  for (const [key,path] of Object.entries(result.response || {})) {
    if (!["audio","words","startChar","endChar","startSec"].includes(key) || typeof path !== "string" || !path.split(".").every(p => /^[\w-]+$/.test(p)))
      throw Error("Use dot-separated field names in the response mapping.");
  }
  return result;
}
function editableDefinition(service, selectedId) {
  const result = {version:1};
  for (const field of ["name","endpoint","language","voice","headers","request","response"]) {
    if (service[field]) result[field] = service[field];
  }
  if (service.format === "native") {
    const active = service.voices?.find(v => providerVoiceId(service,v) === selectedId);
    if (active) result.voice = active.id;
  }
  if (service.format === "timed-json" && service.voices) {
    result.voices = service.voices;
    const active = service.voices.find(v => providerVoiceId(service,v) === selectedId);
    if (active) result.voice = active.id;
  }
  return result;
}
