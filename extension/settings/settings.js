const form = document.querySelector("form");
const input = document.getElementById("endpoint");
const key = document.getElementById("key");
const file = document.getElementById("file");
const status = document.getElementById("status");
const remove = document.getElementById("remove");
let saved, selectedId, credentialEndpoint, busy = false;

function parse() {
  const raw = input.value.trim();
  if (raw.length > 65536) throw Error("Provider definitions must fit in 64 KiB.");
  if (!raw.startsWith("{")) return validateSpeechService(raw);
  let def;
  try {def = JSON.parse(raw);} catch {throw Error("The provider definition must be valid JSON.");}
  return validateSpeechService(def);
}
function preview() {
  let message = "";
  try {
    const config = parse();
    const host = new URL(config.endpoint).host;
    const native = config.format === "native";
    message = native ? "Passages go to the installed connector “" + host + "”. Online voices send them to their speech service." :
      "When you read with this provider, passages go to " + host + ".";
    document.getElementById("advanced").hidden = native;
    if (credentialEndpoint && credentialEndpoint !== config.endpoint) key.value = "";
    credentialEndpoint = config.endpoint;
  } catch {document.getElementById("advanced").hidden = false;}
  document.getElementById("destination").textContent = message;
}
async function load() {
  const data = await browser.storage.local.get(["speechService","voice"]);
  saved = data.speechService;
  selectedId = data.voice;
  if (saved) {
    input.value = JSON.stringify(editableDefinition(saved,selectedId), null, 2);
    credentialEndpoint = saved.endpoint;
    key.value = saved.key || "";
    if (!["native","timed-json"].includes(saved.format)) status.textContent = "This service requires an external provider adapter. Import its definition to update it.";
  }
  remove.disabled = !saved;
  preview();
}
input.oninput = preview;
file.onchange = async () => {
  const source = file.files[0];
  if (!source) return;
  try {
    if (source.size > 65536) throw Error("Provider definitions must fit in 64 KiB.");
    input.value = await source.text();
    key.value = "";
    preview();
    parse();
    status.textContent = "Review the destination, then save the provider.";
  } catch (error) {status.textContent = error.message;}
  file.value = "";
};
function lock(value) {
  busy = value;
  for (const el of [input,key,file,form.querySelector('[type="submit"]')]) el.disabled = value;
  remove.disabled = value || !saved;
}
form.onsubmit = async event => {
  event.preventDefault();
  if (busy) return;
  lock(true);
  try {
    const service = {...parse(),id:crypto.randomUUID()};
    let next = "remote/"+service.id;
    if (service.format === "native") {
      status.textContent = "Checking the connector’s voices…";
      const port = openSpeechConnector(service.endpoint,service.voice);
      try {service.voices = await port.ready;} finally {port.close();}
      const voices = service.voices;
      const previous = saved?.endpoint === service.endpoint && saved?.voices?.find(v => providerVoiceId(saved,v) === selectedId);
      const voice = service.voice ? voices.find(v => v.id === service.voice || v.name === service.voice) :
        voices.find(v => v.id === previous?.id) || voices.find(v => v.lang === service.language) || voices[0];
      if (!voice) throw Error("The installed connector does not offer the requested voice.");
      next = providerVoiceId(service,voice);
    } else {
      service.key = key.value.trim();
      if (service.voices) {
        const voice = service.voices.find(v => v.id === service.voice) ||
          service.voices.find(v => v.lang === service.language) || service.voices[0];
        next = providerVoiceId(service,voice);
      }
    }
    await browser.storage.local.set({speechService:service,voice:next});
    saved = service;
    selectedId = next;
    status.textContent = "Saved. Your next reading session will use " + new URL(service.endpoint).host + ".";
  } catch (error) {status.textContent = error.message;}
  finally {lock(false);}
};
remove.onclick = async () => {
  if (busy || !saved) return;
  lock(true);
  try {
    const {voice} = await browser.storage.local.get("voice");
    const id = "remote/"+saved.id;
    await browser.storage.local.remove(voice === id || voice?.startsWith(id+"/") ? ["speechService","voice"] : "speechService");
    saved = null;
    form.reset();
    preview();
    status.textContent = "Speech provider removed.";
  } finally {lock(false);}
};
load();
