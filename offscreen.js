// Hidden audio page for the ambient focus sounds. A popup closes the moment
// you click away, which would cut the sound off — this page lives in the
// background instead (chrome.offscreen) so it keeps playing. Everything is
// generated locally with the Web Audio API: no files, no network.
let ctx = null, gain = null, source = null, extraNodes = [];

function makeNoiseBuffer(kind) {
  const len = ctx.sampleRate * 4;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  if (kind === "brown") {
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
  } else if (kind === "pink") {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520; b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  } else { // white (also the raw material for rain)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  return buf;
}

function stop() {
  try { if (source) source.stop(); } catch {}
  [source, ...extraNodes].forEach(n => { try { n && n.disconnect(); } catch {} });
  source = null; extraNodes = [];
}

async function play(sound, volume) {
  stop();
  if (!ctx) { ctx = new AudioContext(); gain = ctx.createGain(); gain.connect(ctx.destination); }
  if (ctx.state === "suspended") { try { await ctx.resume(); } catch {} }
  gain.gain.value = Math.min(1, Math.max(0, volume));

  // Binaural beat: two nearby sine tones, one per stereo channel.
  // The beat frequency is the difference between left and right tones.
  const binaural = { "binaural-delta": 2, "binaural-theta": 6, "binaural-alpha": 10, "binaural-beta": 18, "binaural-gamma": 40 };
  if (Object.prototype.hasOwnProperty.call(binaural, sound)) {
    const merger = ctx.createChannelMerger(2);
    const left = ctx.createOscillator();
    const right = ctx.createOscillator();
    const leftGain = ctx.createGain();
    const rightGain = ctx.createGain();
    left.type = right.type = "sine";
    left.frequency.value = 200;
    right.frequency.value = 200 + binaural[sound];
    leftGain.gain.value = rightGain.gain.value = 0.5;
    left.connect(leftGain); leftGain.connect(merger, 0, 0);
    right.connect(rightGain); rightGain.connect(merger, 0, 1);
    merger.connect(gain);
    left.start(); right.start();
    source = left;
    extraNodes = [right, leftGain, rightGain, merger];
    return;
  }

  if (sound === "om" || sound === "tone-528") {
    source = ctx.createOscillator();
    source.type = "sine";
    source.frequency.value = sound === "om" ? 136.1 : 528;
    source.connect(gain);
    source.start();
    return;
  }

  source = ctx.createBufferSource();
  source.loop = true;
  if (sound === "rain") {
    source.buffer = makeNoiseBuffer("white");
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 900;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass";  lp.frequency.value = 8000;
    source.connect(hp); hp.connect(lp); lp.connect(gain);
    extraNodes = [hp, lp];
  } else {
    source.buffer = makeNoiseBuffer(sound === "brown" || sound === "pink" ? sound : "white");
    source.connect(gain);
  }
  source.start();
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.target !== "offscreen") return;
  if (msg.type === "AMBIENT_PLAY") play(msg.sound, msg.volume);
  else if (msg.type === "AMBIENT_VOLUME" && gain) gain.gain.value = Math.min(1, Math.max(0, msg.volume));
  else if (msg.type === "AMBIENT_STOP") stop();
});
