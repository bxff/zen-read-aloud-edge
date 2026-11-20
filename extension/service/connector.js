// The native host speaks the reader's existing command and word-boundary protocol.
function openSpeechConnector(endpoint, preferred, onEvent, onFailure) {
  const host = new URL(endpoint).hostname;
  const port = browser.runtime.connectNative(host);
  const ready = Promise.withResolvers();
  let closed = false;
  const timer = setTimeout(() => fail(preferred ? "The speech connector did not offer the requested voice." : "The speech connector did not return its voices."), 15000);
  function close() {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    ready.reject(Error("Speech connector closed."));
    port.disconnect();
  }
  function fail(message) {
    if (closed) return;
    ready.reject(Error(message));
    close();
    onFailure?.(message);
  }
  port.onDisconnect.addListener(() => fail("The speech connector is unavailable on this device."));
  port.onMessage.addListener(event => {
    if (closed) return;
    if (event.kind === "failure") return fail(event.message);
    if (event.kind !== "voices") return onEvent?.(event);
    const voices = event.voices.filter(v => typeof v.id === "string" && v.name && v.lang);
    if (voices.length && (!preferred || voices.some(v => v.id === preferred || v.name === preferred))) {
      clearTimeout(timer);
      ready.resolve(voices);
    }
  });
  return {ready:ready.promise, close, post(command) { if (!closed) port.postMessage(command); }};
}
function providerVoiceId(service, voice) {
  return "remote/" + service.id + "/" + encodeURIComponent(voice.id);
}
