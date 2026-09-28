/** Small, dependency-free helpers for the development Parakeet benchmark. */

export function median(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Word-level Levenshtein distance divided by the reference word count. */
export function wordErrorRate(reference: string, hypothesis: string): number {
  const ref = normalizeWords(reference);
  const hyp = normalizeWords(hypothesis);
  if (ref.length === 0) return hyp.length === 0 ? 0 : 1;
  let previous = Array.from({ length: hyp.length + 1 }, (_, index) => index);
  for (let i = 1; i <= ref.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= hyp.length; j += 1) {
      const substitution =
        previous[j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1);
      current.push(Math.min(previous[j] + 1, current[j - 1] + 1, substitution));
    }
    previous = current;
  }
  return previous[hyp.length] / ref.length;
}

/**
 * Decode a mono 16-bit PCM WAV file at the expected sample rate. The benchmark
 * generates its clips in exactly this format, so other layouts are rejected.
 */
export function decodePcm16Wav(
  buffer: ArrayBuffer,
  expectedSampleRate: number,
): Float32Array {
  const view = new DataView(buffer);
  const tag = (offset: number) =>
    String.fromCharCode(...new Uint8Array(buffer, offset, 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") {
    throw new Error("Expected a RIFF/WAVE file");
  }
  let offset = 12;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  while (offset + 8 <= buffer.byteLength) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bitsPerSample = view.getUint16(body + 14, true);
    } else if (id === "data") {
      if (channels !== 1 || bitsPerSample !== 16) {
        throw new Error(
          `Expected mono 16-bit PCM, got ${channels} channel(s) at ${bitsPerSample} bits`,
        );
      }
      if (sampleRate !== expectedSampleRate) {
        throw new Error(
          `Expected ${expectedSampleRate} Hz audio, got ${sampleRate} Hz`,
        );
      }
      const samples = new Float32Array(size / 2);
      for (let index = 0; index < samples.length; index += 1) {
        samples[index] = view.getInt16(body + index * 2, true) / 32768;
      }
      return samples;
    }
    offset = body + size + (size % 2);
  }
  throw new Error("WAV file has no data chunk");
}
