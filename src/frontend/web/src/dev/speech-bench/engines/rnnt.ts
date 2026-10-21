/**
 * Engine-independent pieces of Nemotron's cache-aware streaming RNNT: mel
 * chunk slicing with the pre-encode cache, greedy transducer decoding and
 * SentencePiece detokenization. Pure functions, so they can be tested without
 * ONNX sessions.
 */

/** Frames of encoder look-back kept before each chunk (NeMo's pre-encode cache). */
export const PRE_ENCODE_FRAMES = 9;

/**
 * Mel frames `[start, start + width)` for one encoder chunk. Frames before 0
 * are zeros, as NeMo pads the first chunk's pre-encode cache, and so are frames
 * not yet available. `timeMajor` lays the chunk out as `[width × bins]` instead
 * of `[bins × width]`.
 */
export function melChunk(
  frames: readonly Float32Array[],
  bins: number,
  start: number,
  width: number,
  timeMajor: boolean,
): Float32Array {
  const chunk = new Float32Array(bins * width);
  for (let offset = 0; offset < width; offset += 1) {
    const frame = frames[start + offset];
    if (start + offset < 0 || !frame) continue;
    for (let bin = 0; bin < bins; bin += 1) {
      chunk[timeMajor ? offset * bins + bin : bin * width + offset] =
        frame[bin];
    }
  }
  return chunk;
}

export type RnntStep = {
  /** Log-probabilities over the vocabulary for one encoder frame and the current prediction. */
  joint: (frame: number) => Promise<Float32Array>;
  /** Advance the prediction network with an emitted token. */
  emit: (token: number) => Promise<void>;
};

/** Greedy RNNT over `frameCount` encoder frames, at most `maxSymbols` tokens per frame. */
export async function greedyRnnt(
  frameCount: number,
  blank: number,
  step: RnntStep,
  maxSymbols = 10,
): Promise<number[]> {
  const tokens: number[] = [];
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let symbol = 0; symbol < maxSymbols; symbol += 1) {
      const scores = await step.joint(frame);
      let best = 0;
      for (let id = 1; id < scores.length; id += 1) {
        if (scores[id] > scores[best]) best = id;
      }
      if (best === blank) break;
      tokens.push(best);
      await step.emit(best);
    }
  }
  return tokens;
}

const LANGUAGE_TAG = /^<[a-z]{2,3}(-[A-Za-z]{2,4})?>$/;

/** Join SentencePiece pieces, dropping `<unk>`, blank and language tags. */
export function detokenize(
  ids: readonly number[],
  tokens: readonly string[],
): string {
  return ids
    .map((id) => tokens[id] ?? "")
    .filter(
      (piece) =>
        piece !== "<unk>" && piece !== "<blk>" && !LANGUAGE_TAG.test(piece),
    )
    .join("")
    .replace(/▁/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
