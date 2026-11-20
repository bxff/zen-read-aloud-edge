import {playChunks} from "../local/playback.mjs";

function readField(object, path) {
  let value = object;
  for (const part of path.split(".")) {
    if (!value || !Object.hasOwn(value,part)) return undefined;
    value = value[part];
  }
  return value;
}
function requestBody(config,text) {
  const template = config.request || {text:"{{text}}",voice:"{{voice}}",language:"{{language}}"};
  const values = {"{{text}}":text,"{{voice}}":config.voice,"{{language}}":config.language};
  return JSON.stringify(template, (_,v) => typeof v === "string" && Object.hasOwn(values,v) ? values[v] : v);
}
async function custom(config,text,signal) {
  const headers = new Headers({"Content-Type":"application/json",Accept:"application/json"});
  let usesKey = false;
  for (const [name,value] of Object.entries(config.headers || {})) {
    if (value.includes("{{key}}")) {
      if (!config.key) throw Error("Enter this provider’s API key in Connection options.");
      usesKey = true;
    }
    headers.set(name,value.replaceAll("{{key}}", () => config.key || ""));
  }
  if (config.key && !usesKey && !headers.has("Authorization")) headers.set("Authorization","Bearer " + config.key);
  const reply = await fetch(config.endpoint,{method:"POST",headers,body:requestBody(config,text),signal,credentials:"omit",redirect:"error",referrerPolicy:"no-referrer",cache:"no-store"});
  if (!reply.ok) throw Error("The configured speech service returned HTTP " + reply.status + ".");
  const result = await reply.json();
  const mapping = config.response || {};
  const audio = readField(result,mapping.audio || "audio");
  const timings = readField(result,mapping.words || "words");
  if (typeof audio !== "string" || !audio.length) throw Error("The service response is missing base64 audio.");
  if (!Array.isArray(timings)) throw Error("The speech API response is missing word timings.");
  const words = timings.map(word => ({
    startChar:readField(word,mapping.startChar || "startChar"),
    endChar:readField(word,mapping.endChar || "endChar"),
    startSec:readField(word,mapping.startSec || "startSec")
  }));
  return {audio:Uint8Array.from(atob(audio),c=>c.charCodeAt(0)).buffer,words};
}
export async function playService(config,cmd,control,send) {
  async function* generate() {
    if (config.format !== "timed-json") throw Error("This provider needs an external adapter. Open Configure speech API and import its current definition.");
    const response = await custom(config,cmd.text,control.signal);
    control.signal.throwIfAborted();
    const audio = await new OfflineAudioContext(1,1,24000).decodeAudioData(response.audio);
    const words = response.words;
    if (!Array.isArray(words) || (!words.length && /[\p{L}\p{N}]/u.test(cmd.text)) || words.some((w,i)=>
      !Number.isInteger(w?.startChar) || !Number.isInteger(w.endChar) || w.startChar<0 || w.endChar<=w.startChar ||
      w.endChar>cmd.text.length || !Number.isFinite(w.startSec) || w.startSec<0 || w.startSec>audio.duration ||
      (i && (w.startChar<words[i-1].endChar || w.startSec<words[i-1].startSec))))
      throw Error("The speech service returned missing or invalid word timings.");
    yield {samples:audio.getChannelData(0),sampleRateHz:audio.sampleRate,wordTimestamps:words};
  }
  return playChunks(generate(),cmd,control,send);
}
