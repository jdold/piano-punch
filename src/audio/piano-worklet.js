class PianoInputProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(4096);
    this.offset = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    let read = 0;
    while (read < channel.length) {
      const count = Math.min(this.buffer.length - this.offset, channel.length - read);
      this.buffer.set(channel.subarray(read, read + count), this.offset);
      this.offset += count;
      read += count;
      if (this.offset === this.buffer.length) {
        const frame = this.buffer.slice();
        this.port.postMessage({ type: 'frame', sampleRate, samples: frame.buffer }, [frame.buffer]);
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor('piano-input', PianoInputProcessor);
