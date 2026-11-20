// The frame owns all workers, GPU resources and playback for one selected engine.
async function loadVoiceEngine(spec, progress) {
  const module = await import("./" + spec.path + "/engine.mjs");
  return module.createEngine(spec, progress);
}
