class ContextHaloAudioCaptureProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        const requested = Number(options?.processorOptions?.samplesPerChunk);
        this.samplesPerChunk = Number.isFinite(requested) && requested > 0 ? Math.max(128, Math.round(requested)) : 2400;
        this.pending = new Float32Array(this.samplesPerChunk);
        this.offset = 0;
        this.sequence = 0;
        this.inFlight = new Set();
        this.port.onmessage = event => {
            const ack = event.data?.ack;
            if (Number.isSafeInteger(ack)) this.inFlight.delete(ack);
        };
    }

    flush() {
        if (this.inFlight.size >= 4) { this.offset = 0; return; }
        const pcm = new Int16Array(this.samplesPerChunk);
        for (let i = 0; i < this.samplesPerChunk; i++) {
            const sample = Math.max(-1, Math.min(1, this.pending[i]));
            pcm[i] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
        }
        const sequence = ++this.sequence;
        this.inFlight.add(sequence);
        this.port.postMessage({ pcm: pcm.buffer, sequence, audioTime: currentTime }, [pcm.buffer]);
        this.offset = 0;
    }

    process(inputs, outputs) {
        const input = inputs?.[0]?.[0];
        if (input?.length) {
            let index = 0;
            while (index < input.length) {
                const available = this.samplesPerChunk - this.offset;
                const count = Math.min(available, input.length - index);
                this.pending.set(input.subarray(index, index + count), this.offset);
                this.offset += count;
                index += count;
                if (this.offset === this.samplesPerChunk) this.flush();
            }
        }
        const output = outputs?.[0]?.[0];
        if (output) output.fill(0);
        return true;
    }
}

registerProcessor('context-halo-audio-capture', ContextHaloAudioCaptureProcessor);
