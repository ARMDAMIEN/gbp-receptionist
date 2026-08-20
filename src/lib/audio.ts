const MULAW_BIAS = 0x84;
const MULAW_CLIP = 32635;

export function muLawDecode(mu: number): number {
  mu = ~mu & 0xff;
  const sign = mu & 0x80;
  const exponent = (mu >> 4) & 0x07;
  const mantissa = mu & 0x0f;
  let sample = ((mantissa << 3) + MULAW_BIAS) << exponent;
  sample -= MULAW_BIAS;
  return sign ? -sample : sample;
}

export function muLawEncode(pcm: number): number {
  let sign = 0;
  if (pcm < 0) {
    pcm = -pcm;
    sign = 0x80;
  }
  if (pcm > MULAW_CLIP) pcm = MULAW_CLIP;
  pcm += MULAW_BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (pcm & mask) === 0 && exponent > 0; mask >>= 1) {
    exponent--;
  }
  const mantissa = (pcm >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

export function muLawBufferToPcm16(mu: Buffer): Buffer {
  const out = Buffer.alloc(mu.length * 2);
  for (let i = 0; i < mu.length; i++) {
    out.writeInt16LE(muLawDecode(mu[i]!), i * 2);
  }
  return out;
}

export function pcm16ToMuLawBuffer(pcm: Buffer): Buffer {
  const samples = pcm.length / 2;
  const out = Buffer.alloc(samples);
  for (let i = 0; i < samples; i++) {
    out[i] = muLawEncode(pcm.readInt16LE(i * 2));
  }
  return out;
}

// Convert little-endian float32 PCM in [-1, 1] → int16 PCM.
export function float32ToPcm16(f32: Buffer): Buffer {
  const samples = Math.floor(f32.length / 4);
  const out = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    let s = f32.readFloatLE(i * 4);
    if (s > 1) s = 1;
    else if (s < -1) s = -1;
    out.writeInt16LE(Math.round(s * 32767), i * 2);
  }
  return out;
}

// Linear downsample from srcRate to dstRate (dstRate must divide cleanly).
// Used to bring Voxtral PCM (24 kHz) down to Twilio's 8 kHz.
export function downsamplePcm16(
  pcm: Buffer,
  srcRate: number,
  dstRate: number
): Buffer {
  if (srcRate === dstRate) return pcm;
  const srcSamples = pcm.length / 2;
  const ratio = srcRate / dstRate;
  const dstSamples = Math.floor(srcSamples / ratio);
  const out = Buffer.alloc(dstSamples * 2);
  for (let i = 0; i < dstSamples; i++) {
    const srcIdx = Math.floor(i * ratio);
    out.writeInt16LE(pcm.readInt16LE(srcIdx * 2), i * 2);
  }
  return out;
}

// Chunk a μ-law buffer into 20 ms frames (160 bytes at 8 kHz) for Twilio.
export function chunkMuLawFrames(mu: Buffer, frameBytes = 160): Buffer[] {
  const frames: Buffer[] = [];
  for (let i = 0; i < mu.length; i += frameBytes) {
    const slice = mu.subarray(i, Math.min(i + frameBytes, mu.length));
    if (slice.length === frameBytes) frames.push(slice);
    else {
      const padded = Buffer.alloc(frameBytes, 0xff);
      slice.copy(padded);
      frames.push(padded);
    }
  }
  return frames;
}
