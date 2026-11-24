let sound;

export async function setAmbience(enabled) {
  if (!enabled && !sound) return;
  if (!sound) {
    const context = new AudioContext();
    const master = context.createGain();
    master.gain.value = 0;
    master.connect(context.destination);

    const buffer = context.createBuffer(1, context.sampleRate * 7, context.sampleRate);
    const samples = buffer.getChannelData(0);
    // A loop of low-passed noise provides the current underneath the tones.
    let current = 0;
    for (let i = 0; i < samples.length; i++) {
      current = .982 * current + .036 * (Math.random() * 2 - 1);
      const edge = Math.min(i, samples.length - i - 1, 1800) / 1800;
      samples[i] = current * edge;
    }
    const noise = context.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const filter = context.createBiquadFilter();
    filter.frequency.value = 390;
    filter.Q.value = .28;
    noise.connect(filter).connect(master);
    noise.start();

    for (const [frequency, gain, pace] of [[47, .13, .09], [72, .08, .12], [142, .016, .15], [214, .01, .113]]) {
      const voice = context.createOscillator();
      voice.frequency.value = frequency;
      const level = context.createGain();
      level.gain.value = gain * .5;
      const modulation = context.createOscillator();
      modulation.frequency.value = pace;
      const modulationLevel = context.createGain();
      modulationLevel.gain.value = gain * .49;
      modulation.connect(modulationLevel).connect(level.gain);
      voice.connect(level).connect(master);
      voice.start();
      modulation.start();
    }
    sound = { context, master };
  }

  const { context, master } = sound;
  if (enabled) await context.resume();
  master.gain.setTargetAtTime(enabled ? .24 : 0, context.currentTime, .12);
}
