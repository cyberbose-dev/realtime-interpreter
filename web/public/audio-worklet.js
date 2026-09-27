// Mixes all inputs to mono, downsamples to 16 kHz and emits 100 ms chunks of 16-bit PCM.
const TARGET_RATE = 16000;
const CHUNK = 1600; // 100 ms

class PcmWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / TARGET_RATE; // input samples per output sample
    this.acc = 0;
    this.accCount = 0;
    this.phase = 0;
    this.out = new Int16Array(CHUNK);
    this.len = 0;
    this.sumSq = 0;
    this.muted = false;
    this.port.onmessage = (e) => {
      if (typeof e.data?.muted === 'boolean') this.muted = e.data.muted;
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channels = input.length;
    const frames = input[0].length;
    for (let i = 0; i < frames; i++) {
      let s = 0;
      for (let c = 0; c < channels; c++) s += input[c][i];
      this.acc += s / channels;
      this.accCount++;
      this.phase += 1;
      if (this.phase >= this.step) {
        this.phase -= this.step;
        // Averaging the window is a crude low-pass filter; good enough for speech.
        let v = this.muted ? 0 : this.acc / this.accCount;
        this.acc = 0;
        this.accCount = 0;
        v = Math.max(-1, Math.min(1, v));
        this.sumSq += v * v;
        this.out[this.len++] = v < 0 ? v * 0x8000 : v * 0x7fff;
        if (this.len === CHUNK) {
          const level = Math.sqrt(this.sumSq / CHUNK);
          this.port.postMessage({ pcm: this.out.buffer, level }, [this.out.buffer]);
          this.out = new Int16Array(CHUNK);
          this.len = 0;
          this.sumSq = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('pcm-worklet', PcmWorklet);
