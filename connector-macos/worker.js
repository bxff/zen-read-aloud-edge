/* Runs only in the isolated Edge process. */
(async () => {
  const headers = { "X-Reader": location.hash.slice(1) };
  history.replaceState(null, "", "/");
  const synth = window.speechSynthesis;
  let output = Promise.resolve();
  let current = null;
  function send(event) {
    output = output.then(() => fetch("/event", {
      method: "POST", headers, body: JSON.stringify(event)
    }));
  }
  function voices() {
    send({ kind: "voices", voices: synth.getVoices().map(v => ({
      name: v.name, lang: v.lang, id: v.voiceURI, local: v.localService
    })) });
  }
  synth.onvoiceschanged = voices;
  voices();
  while (true) {
    const cmd = await (await fetch("/next", { method: "POST", headers })).json();
    if (cmd.type === "cancel" || cmd.type === "speak") {
      current = null;
      synth.cancel();
    }
    if (cmd.type === "pause") synth.pause();
    if (cmd.type === "resume") synth.resume();
    if (cmd.type !== "speak") continue;
    if (synth.paused) synth.resume();
    const utterance = new SpeechSynthesisUtterance(cmd.text);
    const voice = synth.getVoices().find(v => v.voiceURI === cmd.voice);
    if (!voice) {
      send({kind: "error", id: cmd.id, message: "That Edge voice is unavailable."});
      continue;
    }
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.rate = cmd.rate;
    current = utterance;
    for (const kind of ["start", "boundary", "end", "error"]) {
      utterance["on" + kind] = e => {
        if (current === utterance) send({
          kind, id: cmd.id, offset: e.charIndex, length: e.charLength,
          boundary: e.name, message: e.error
        });
      };
    }
    synth.speak(utterance);
  }
})();
