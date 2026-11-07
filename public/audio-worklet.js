class PCMProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(); this.rate = options?.processorOptions?.rate || 24000; this.size = this.rate / 10; // 100 ms frames
    this.buffer = new Int16Array(this.size); this.count = 0; this.phase = 0; this.sum = 0; this.samples = 0; }
  process(inputs) {
    const channel = inputs[0]?.[0]; if (!channel) return true;
    for (const value of channel) {
      this.sum += value; this.samples++; this.phase += this.rate;
      if (this.phase >= sampleRate) {
        this.phase -= sampleRate;
        const v = Math.max(-1, Math.min(1, this.sum / this.samples));
        this.buffer[this.count++] = v < 0 ? v * 32768 : v * 32767;
        this.sum = 0; this.samples = 0;
        if (this.count === this.size) {
          this.port.postMessage(this.buffer.buffer, [this.buffer.buffer]);
          this.buffer = new Int16Array(this.size); this.count = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('pcm-capture', PCMProcessor);
