class PCMProcessor extends AudioWorkletProcessor {
  constructor() { super(); this.buffer = new Int16Array(2400); this.count = 0; this.phase = 0; this.sum = 0; this.samples = 0; }
  process(inputs) {
    const channel = inputs[0]?.[0]; if (!channel) return true;
    for (const value of channel) {
      this.sum += value; this.samples++; this.phase += 24000;
      if (this.phase >= sampleRate) {
        this.phase -= sampleRate;
        const v = Math.max(-1, Math.min(1, this.sum / this.samples));
        this.buffer[this.count++] = v < 0 ? v * 32768 : v * 32767;
        this.sum = 0; this.samples = 0;
        if (this.count === 2400) {
          this.port.postMessage(this.buffer.buffer, [this.buffer.buffer]);
          this.buffer = new Int16Array(2400); this.count = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('pcm-capture', PCMProcessor);
