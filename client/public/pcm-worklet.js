// Convierte el audio del micrófono a PCM de 16 bits y 16 kHz, mono, en bloques de unos 100 ms.
class PcmWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.position = 0;
    this.buffer = new Int16Array(1600);
    this.length = 0;
  }

  process(inputs) {
    const channel = inputs[0][0];
    if (!channel) return true;
    for (; this.position < channel.length; this.position += this.ratio) {
      const sample = Math.max(-1, Math.min(1, channel[Math.floor(this.position)]));
      this.buffer[this.length++] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      if (this.length === this.buffer.length) {
        this.port.postMessage(this.buffer.buffer.slice(0));
        this.length = 0;
      }
    }
    this.position -= channel.length;
    return true;
  }
}

registerProcessor('pcm-worklet', PcmWorklet);
