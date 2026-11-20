// All start, word and end cues run on the same audio graph as the PCM.
// Suspending that graph pauses both sound and cues, including during a gap.
export async function playPassages(generate, cmd, control, send) {
  async function* chunks() {
    let part = {text:cmd.text, index:0};
    while (part && !control.signal.aborted) {
      for await (const chunk of generate({...cmd,text:part.text,streamHead:!part.index || control.secondsAhead() < 3},control)) {
        yield {...chunk,part:part.index};
      }
      part = await control.nextPart?.();
    }
  }
  return playChunks(chunks(),cmd,control,send);
}

export async function playChunks(chunks, cmd, control, send) {
  if (control.publish) {
    for await (const chunk of chunks) {
      if (control.signal.aborted) break;
      await control.publish(chunk);
    }
    return;
  }
  const ctx = new AudioContext(), signal = control.signal;
  const silence = ctx.createBuffer(1, 1, ctx.sampleRate);
  let cursor = 0, started = false, lastSource;
  let unblock, bufferTimer, buffering = false, inputFinished = false;
  const abort = () => {
    clearTimeout(bufferTimer);
    unblock?.();
    if (ctx.state !== "closed") ctx.close().catch(()=>{});
  };
  signal.addEventListener("abort",abort,{once:true});
  control.secondsAhead = () => Math.max(0,cursor-ctx.currentTime);
  control.pause = () => ctx.suspend();
  control.resume = () => ctx.resume();

  function cue(when, action) {
    const marker = ctx.createBufferSource();
    marker.buffer = silence;
    marker.connect(ctx.destination);
    marker.onended = () => {
      marker.disconnect();
      if (!signal.aborted) action();
    };
    marker.start(when);
  }

  try {
    await ctx.resume();
    for await (const chunk of chunks) {
      if (signal.aborted) return;
      if (!chunk.samples?.length) continue;
      const sound=ctx.createBuffer(1,chunk.samples.length,chunk.sampleRateHz);
      sound.copyToChannel(chunk.samples,0);
      const source = ctx.createBufferSource();
      source.buffer = sound;
      source.playbackRate.value = cmd.rate;
      source.connect(ctx.destination);
      const when = Math.max(ctx.currentTime + 0.02, cursor);
      clearTimeout(bufferTimer);
      if (!started || buffering) {
        const kind = started ? "buffered" : "start";
        buffering = false; started = true;
        cue(when,()=>send({kind}));
      }
      for (const m of chunk.wordTimestamps || []) {
        if (Number.isFinite(m.startSec) && Number.isInteger(m.startChar) && m.endChar > m.startChar) {
          cue(when + Math.min(sound.duration,Math.max(0,m.startSec)) / cmd.rate,
            ()=>send({kind:"boundary", boundary:"word", part:chunk.part, offset:m.startChar, length:m.endChar-m.startChar}));
        }
      }
      const ended = Promise.withResolvers();
      source.onended = () => {
        source.disconnect(); ended.resolve();
        if (ended !== lastSource || inputFinished || signal.aborted) return;
        bufferTimer = setTimeout(() => {
          if (ended === lastSource && !inputFinished && !signal.aborted) {
            buffering = true; send({kind:"buffering"});
          }
        },250);
      };
      source.start(when);
      cursor = when + sound.duration / cmd.rate;
      lastSource = ended;
      // Bound lookahead even while the user has paused. Graph time stops on pause.
      if (cursor - ctx.currentTime > 8) {
        const ready = Promise.withResolvers();
        cue(cursor - 6,ready.resolve);
        unblock = ready.resolve;
        await ready.promise;
        unblock = null;
      }
    }
    inputFinished = true; clearTimeout(bufferTimer);
    if (lastSource && !signal.aborted) {
      unblock = lastSource.resolve;
      await lastSource.promise;
    }
    if (!signal.aborted) {
      if (!started) throw Error("The voice returned no audio.");
      send({kind:"end"});
    }
  } finally {signal.removeEventListener("abort",abort);abort();}
}
