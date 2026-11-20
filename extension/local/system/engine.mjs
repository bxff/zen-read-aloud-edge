export async function createEngine() {
  const synth=window.speechSynthesis;
  if(!synth.getVoices().length) await new Promise(resolve=>{
    const done=()=>{clearTimeout(timeout);synth.removeEventListener("voiceschanged",done);resolve();};
    const timeout=setTimeout(done,2500);synth.addEventListener("voiceschanged",done);
  });
  const local=synth.getVoices().filter(v=>v.localService);
  local.sort((a,b)=>Number(b.lang.startsWith("en"))-Number(a.lang.startsWith("en")) || Number(b.name==="Samantha")-Number(a.name==="Samantha"));
  if(!local.length) throw Error("Zen did not expose any installed local system voices.");
  return {voices:local.map(v=>({id:v.voiceURI,name:v.name,lang:v.lang,local:true})),speak(cmd,control,send){
    const u=new SpeechSynthesisUtterance(cmd.text);
    u.voice=local.find(v=>v.voiceURI===cmd.voice);u.rate=cmd.rate;u.lang=u.voice.lang;
    control.pause=()=>synth.pause();control.resume=()=>synth.resume();
    control.signal.addEventListener("abort",()=>synth.cancel(),{once:true});
    u.onstart=()=>send({kind:"start"});u.onend=()=>send({kind:"end"});
    u.onerror=e=>send({kind:"error",message:e.error});
    u.onboundary=e=>{if(e.name==="word") send({kind:"boundary",boundary:"word",offset:e.charIndex,length:e.charLength||cmd.text.slice(e.charIndex).match(/^\S+/u)?.[0]?.length||1});};
    synth.speak(u);
  }};
}
