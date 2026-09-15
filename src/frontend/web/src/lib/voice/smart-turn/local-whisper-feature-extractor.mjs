/*
 * Local Whisper feature extraction utilities for Smart-Turn.
 * Modified for Animama by Raymond Van; local integrations differ from upstream.
 * P2FFT also derives from fft.js (MIT, Copyright Fedor Indutny, 2017).
 * Full terms and modification record: licenses/third-party/code-and-models.md.
 *
 * Portions are adapted from Transformers.js (Apache-2.0), pinned to tag 3.8.1:
 * - Whisper feature-extractor flow:
 *   https://github.com/huggingface/transformers.js/blob/3.8.1/src/models/whisper/feature_extraction_whisper.js#L6-L91
 * - Audio feature math (mel filter bank, spectrogram, windowing):
 *   https://github.com/huggingface/transformers.js/blob/3.8.1/src/utils/audio.js#L114-L738
 * - FFT/maths primitives used by audio feature extraction:
 *   https://github.com/huggingface/transformers.js/blob/3.8.1/src/utils/maths.js#L260-L909
 */

const NORMALIZATION_EPS = 1e-7;

export const DEFAULT_WHISPER_TINY_EN_CONFIG = Object.freeze({
  chunk_length: 30,
  feature_extractor_type: "WhisperFeatureExtractor",
  feature_size: 80,
  hop_length: 160,
  n_fft: 400,
  n_samples: 480000,
  nb_max_frames: 3000,
  padding_side: "right",
  padding_value: 0.0,
  processor_class: "WhisperProcessor",
  return_attention_mask: false,
  sampling_rate: 16000,
});

export const TARGET_SMART_TURN_SAMPLES = 16000 * 8;

export function normalizeWaveform(audio, eps = NORMALIZATION_EPS) {
  if (audio.length === 0) {
    return audio;
  }

  let mean = 0;
  for (let i = 0; i < audio.length; i += 1) {
    mean += audio[i] ?? 0;
  }
  mean /= audio.length;

  let variance = 0;
  for (let i = 0; i < audio.length; i += 1) {
    const centered = (audio[i] ?? 0) - mean;
    variance += centered * centered;
  }
  variance /= audio.length;

  const std = Math.sqrt(variance + eps);
  if (!Number.isFinite(std) || std <= 0) {
    return audio;
  }

  const output = new Float32Array(audio.length);
  for (let i = 0; i < audio.length; i += 1) {
    output[i] = ((audio[i] ?? 0) - mean) / std;
  }

  return output;
}

export function prepareSmartTurnAudioWindow(
  audio,
  targetSamples = TARGET_SMART_TURN_SAMPLES,
) {
  let paddedLeadingSamples = 0;
  let truncatedLeadingSamples = 0;
  let windowed;

  if (audio.length > targetSamples) {
    truncatedLeadingSamples = audio.length - targetSamples;
    windowed = audio.slice(truncatedLeadingSamples);
  } else if (audio.length < targetSamples) {
    paddedLeadingSamples = targetSamples - audio.length;
    windowed = new Float32Array(targetSamples);
    windowed.set(audio, paddedLeadingSamples);
  } else {
    windowed = audio;
  }

  return {
    normalizedAudio: normalizeWaveform(windowed),
    paddedLeadingSamples,
    truncatedLeadingSamples,
  };
}

export function createLocalWhisperFeatureExtractor(
  config = DEFAULT_WHISPER_TINY_EN_CONFIG,
) {
  const finalConfig = {
    ...DEFAULT_WHISPER_TINY_EN_CONFIG,
    ...config,
  };

  const melFilters =
    finalConfig.mel_filters ??
    melFilterBank(
      Math.floor(1 + finalConfig.n_fft / 2),
      finalConfig.feature_size,
      0.0,
      8000.0,
      finalConfig.sampling_rate,
      "slaney",
      "slaney",
    );

  const window = windowFunction(finalConfig.n_fft, "hann");

  async function extractFbankFeatures(waveform) {
    const maxNumFrames = Math.min(
      Math.floor(waveform.length / finalConfig.hop_length),
      finalConfig.nb_max_frames,
    );

    const features = spectrogram(
      waveform,
      window,
      finalConfig.n_fft,
      finalConfig.hop_length,
      {
        power: 2.0,
        melFilters,
        logMel: "log10",
        maxNumFrames,
      },
    );

    const data = features.data;
    const maxValue = max(data);

    for (let i = 0; i < data.length; i += 1) {
      data[i] = (Math.max(data[i], maxValue - 8.0) + 4.0) / 4.0;
    }

    return features;
  }

  async function extract(audio, options = {}) {
    if (!(audio instanceof Float32Array || audio instanceof Float64Array)) {
      throw new Error(
        `LocalWhisperFeatureExtractor expects Float32Array/Float64Array, got ${audio?.constructor?.name ?? typeof audio}`,
      );
    }

    const length = options.maxLength ?? finalConfig.n_samples;
    let waveform;

    if (audio.length > length) {
      waveform = audio.slice(0, length);
    } else {
      waveform = new Float32Array(length);
      waveform.set(audio);
    }

    const features = await extractFbankFeatures(waveform);
    return {
      data: features.data,
      dims: [1, features.dims[0], features.dims[1]],
    };
  }

  return {
    config: finalConfig,
    extract,
  };
}

function max(arr) {
  if (arr.length === 0) {
    throw new Error("Array must not be empty");
  }

  let maxValue = arr[0];
  for (let i = 1; i < arr.length; i += 1) {
    if (arr[i] > maxValue) {
      maxValue = arr[i];
    }
  }
  return maxValue;
}

function isPowerOfTwo(number) {
  return number > 0 && (number & (number - 1)) === 0;
}

class P2FFT {
  constructor(size) {
    this.size = size | 0;
    if (this.size <= 1 || !isPowerOfTwo(this.size)) {
      throw new Error("FFT size must be a power of two larger than 1");
    }

    this._csize = size << 1;
    this.table = new Float64Array(this.size * 2);
    for (let i = 0; i < this.table.length; i += 2) {
      const angle = (Math.PI * i) / this.size;
      this.table[i] = Math.cos(angle);
      this.table[i + 1] = -Math.sin(angle);
    }

    let power = 0;
    for (let t = 1; this.size > t; t <<= 1) {
      power += 1;
    }

    this._width = power % 2 === 0 ? power - 1 : power;
    this._bitrev = new Int32Array(1 << this._width);

    for (let j = 0; j < this._bitrev.length; j += 1) {
      this._bitrev[j] = 0;
      for (let shift = 0; shift < this._width; shift += 2) {
        const revShift = this._width - shift - 2;
        this._bitrev[j] |= ((j >>> shift) & 3) << revShift;
      }
    }
  }

  transform(out, data) {
    if (out === data) {
      throw new Error("Input and output buffers must be different");
    }
    this._transform4(out, data, 1);
  }

  realTransform(out, data) {
    if (out === data) {
      throw new Error("Input and output buffers must be different");
    }
    this._realTransform4(out, data, 1);
  }

  inverseTransform(out, data) {
    if (out === data) {
      throw new Error("Input and output buffers must be different");
    }

    this._transform4(out, data, -1);
    for (let i = 0; i < out.length; i += 1) {
      out[i] /= this.size;
    }
  }

  _transform4(out, data, inv) {
    const size = this._csize;
    const width = this._width;
    let step = 1 << width;
    let len = (size / step) << 1;

    let outOff;
    let t;
    const bitrev = this._bitrev;
    if (len === 4) {
      for (outOff = 0, t = 0; outOff < size; outOff += len, t += 1) {
        const off = bitrev[t];
        this._singleTransform2(data, out, outOff, off, step);
      }
    } else {
      for (outOff = 0, t = 0; outOff < size; outOff += len, t += 1) {
        const off = bitrev[t];
        this._singleTransform4(data, out, outOff, off, step, inv);
      }
    }

    const table = this.table;
    for (step >>= 2; step >= 2; step >>= 2) {
      len = (size / step) << 1;
      const quarterLen = len >>> 2;

      for (outOff = 0; outOff < size; outOff += len) {
        const limit = outOff + quarterLen - 1;
        for (let i = outOff, k = 0; i < limit; i += 2, k += step) {
          const A = i;
          const B = A + quarterLen;
          const C = B + quarterLen;
          const D = C + quarterLen;

          const Ar = out[A];
          const Ai = out[A + 1];
          const Br = out[B];
          const Bi = out[B + 1];
          const Cr = out[C];
          const Ci = out[C + 1];
          const Dr = out[D];
          const Di = out[D + 1];

          const tableBr = table[k];
          const tableBi = inv * table[k + 1];
          const MBr = Br * tableBr - Bi * tableBi;
          const MBi = Br * tableBi + Bi * tableBr;

          const tableCr = table[2 * k];
          const tableCi = inv * table[2 * k + 1];
          const MCr = Cr * tableCr - Ci * tableCi;
          const MCi = Cr * tableCi + Ci * tableCr;

          const tableDr = table[3 * k];
          const tableDi = inv * table[3 * k + 1];
          const MDr = Dr * tableDr - Di * tableDi;
          const MDi = Dr * tableDi + Di * tableDr;

          const T0r = Ar + MCr;
          const T0i = Ai + MCi;
          const T1r = Ar - MCr;
          const T1i = Ai - MCi;
          const T2r = MBr + MDr;
          const T2i = MBi + MDi;
          const T3r = inv * (MBr - MDr);
          const T3i = inv * (MBi - MDi);

          out[A] = T0r + T2r;
          out[A + 1] = T0i + T2i;
          out[B] = T1r + T3i;
          out[B + 1] = T1i - T3r;
          out[C] = T0r - T2r;
          out[C + 1] = T0i - T2i;
          out[D] = T1r - T3i;
          out[D + 1] = T1i + T3r;
        }
      }
    }
  }

  _singleTransform2(data, out, outOff, off, step) {
    const evenR = data[off];
    const evenI = data[off + 1];
    const oddR = data[off + step];
    const oddI = data[off + step + 1];

    out[outOff] = evenR + oddR;
    out[outOff + 1] = evenI + oddI;
    out[outOff + 2] = evenR - oddR;
    out[outOff + 3] = evenI - oddI;
  }

  _singleTransform4(data, out, outOff, off, step, inv) {
    const step2 = step * 2;
    const step3 = step * 3;

    const Ar = data[off];
    const Ai = data[off + 1];
    const Br = data[off + step];
    const Bi = data[off + step + 1];
    const Cr = data[off + step2];
    const Ci = data[off + step2 + 1];
    const Dr = data[off + step3];
    const Di = data[off + step3 + 1];

    const T0r = Ar + Cr;
    const T0i = Ai + Ci;
    const T1r = Ar - Cr;
    const T1i = Ai - Ci;
    const T2r = Br + Dr;
    const T2i = Bi + Di;
    const T3r = inv * (Br - Dr);
    const T3i = inv * (Bi - Di);

    out[outOff] = T0r + T2r;
    out[outOff + 1] = T0i + T2i;
    out[outOff + 2] = T1r + T3i;
    out[outOff + 3] = T1i - T3r;
    out[outOff + 4] = T0r - T2r;
    out[outOff + 5] = T0i - T2i;
    out[outOff + 6] = T1r - T3i;
    out[outOff + 7] = T1i + T3r;
  }

  _realTransform4(out, data, inv) {
    const size = this._csize;
    const width = this._width;
    let step = 1 << width;
    let len = (size / step) << 1;

    let outOff;
    let t;
    const bitrev = this._bitrev;
    if (len === 4) {
      for (outOff = 0, t = 0; outOff < size; outOff += len, t += 1) {
        const off = bitrev[t];
        this._singleRealTransform2(data, out, outOff, off >>> 1, step >>> 1);
      }
    } else {
      for (outOff = 0, t = 0; outOff < size; outOff += len, t += 1) {
        const off = bitrev[t];
        this._singleRealTransform4(
          data,
          out,
          outOff,
          off >>> 1,
          step >>> 1,
          inv,
        );
      }
    }

    const table = this.table;
    for (step >>= 2; step >= 2; step >>= 2) {
      len = (size / step) << 1;
      const halfLen = len >>> 1;
      const quarterLen = halfLen >>> 1;
      const hquarterLen = quarterLen >>> 1;

      for (outOff = 0; outOff < size; outOff += len) {
        for (let i = 0, k = 0; i <= hquarterLen; i += 2, k += step) {
          const A = outOff + i;
          const B = A + quarterLen;
          const C = B + quarterLen;
          const D = C + quarterLen;

          const Ar = out[A];
          const Ai = out[A + 1];
          const Br = out[B];
          const Bi = out[B + 1];
          const Cr = out[C];
          const Ci = out[C + 1];
          const Dr = out[D];
          const Di = out[D + 1];

          const MAr = Ar;
          const MAi = Ai;

          const tableBr = table[k];
          const tableBi = inv * table[k + 1];
          const MBr = Br * tableBr - Bi * tableBi;
          const MBi = Br * tableBi + Bi * tableBr;

          const tableCr = table[2 * k];
          const tableCi = inv * table[2 * k + 1];
          const MCr = Cr * tableCr - Ci * tableCi;
          const MCi = Cr * tableCi + Ci * tableCr;

          const tableDr = table[3 * k];
          const tableDi = inv * table[3 * k + 1];
          const MDr = Dr * tableDr - Di * tableDi;
          const MDi = Dr * tableDi + Di * tableDr;

          const T0r = MAr + MCr;
          const T0i = MAi + MCi;
          const T1r = MAr - MCr;
          const T1i = MAi - MCi;
          const T2r = MBr + MDr;
          const T2i = MBi + MDi;
          const T3r = inv * (MBr - MDr);
          const T3i = inv * (MBi - MDi);

          out[A] = T0r + T2r;
          out[A + 1] = T0i + T2i;
          out[B] = T1r + T3i;
          out[B + 1] = T1i - T3r;

          if (i === 0) {
            out[C] = T0r - T2r;
            out[C + 1] = T0i - T2i;
            continue;
          }

          if (i === hquarterLen) {
            continue;
          }

          const SA = outOff + quarterLen - i;
          const SB = outOff + halfLen - i;

          out[SA] = T1r - inv * T3i;
          out[SA + 1] = -T1i - inv * T3r;
          out[SB] = T0r - inv * T2r;
          out[SB + 1] = -T0i + inv * T2i;
        }
      }
    }

    const half = size >>> 1;
    for (let i = 2; i < half; i += 2) {
      out[size - i] = out[i];
      out[size - i + 1] = -out[i + 1];
    }
  }

  _singleRealTransform2(data, out, outOff, off, step) {
    const evenR = data[off];
    const oddR = data[off + step];

    out[outOff] = evenR + oddR;
    out[outOff + 1] = 0;
    out[outOff + 2] = evenR - oddR;
    out[outOff + 3] = 0;
  }

  _singleRealTransform4(data, out, outOff, off, step, inv) {
    const step2 = step * 2;
    const step3 = step * 3;

    const Ar = data[off];
    const Br = data[off + step];
    const Cr = data[off + step2];
    const Dr = data[off + step3];

    const T0r = Ar + Cr;
    const T1r = Ar - Cr;
    const T2r = Br + Dr;
    const T3r = inv * (Br - Dr);

    out[outOff] = T0r + T2r;
    out[outOff + 1] = 0;
    out[outOff + 2] = T1r;
    out[outOff + 3] = -T3r;
    out[outOff + 4] = T0r - T2r;
    out[outOff + 5] = 0;
    out[outOff + 6] = T1r;
    out[outOff + 7] = T3r;
  }
}

class NP2FFT {
  constructor(fftLength) {
    const a = 2 * (fftLength - 1);
    const b = 2 * (2 * fftLength - 1);
    const nextP2 = 2 ** Math.ceil(Math.log2(b));

    this.bufferSize = nextP2;
    this._a = a;

    const chirp = new Float64Array(b);
    const ichirp = new Float64Array(nextP2);
    this._chirpBuffer = new Float64Array(nextP2);
    this._buffer1 = new Float64Array(nextP2);
    this._buffer2 = new Float64Array(nextP2);
    this._outBuffer1 = new Float64Array(nextP2);
    this._outBuffer2 = new Float64Array(nextP2);

    const theta = (-2 * Math.PI) / fftLength;
    const baseR = Math.cos(theta);
    const baseI = Math.sin(theta);

    for (let i = 0; i < b >> 1; i += 1) {
      const e = (i + 1 - fftLength) ** 2 / 2.0;
      const resultMod = Math.sqrt(baseR ** 2 + baseI ** 2) ** e;
      const resultArg = e * Math.atan2(baseI, baseR);

      const i2 = 2 * i;
      chirp[i2] = resultMod * Math.cos(resultArg);
      chirp[i2 + 1] = resultMod * Math.sin(resultArg);

      ichirp[i2] = chirp[i2];
      ichirp[i2 + 1] = -chirp[i2 + 1];
    }

    this._slicedChirpBuffer = chirp.subarray(a, b);
    this._f = new P2FFT(nextP2 >> 1);
    this._f.transform(this._chirpBuffer, ichirp);
  }

  _transform(output, input, real) {
    const ib1 = this._buffer1;
    const ib2 = this._buffer2;
    const ob2 = this._outBuffer1;
    const ob3 = this._outBuffer2;
    const cb = this._chirpBuffer;
    const sb = this._slicedChirpBuffer;
    const a = this._a;

    if (real) {
      for (let j = 0; j < sb.length; j += 2) {
        const j2 = j + 1;
        const j3 = j >> 1;
        const aReal = input[j3];
        ib1[j] = aReal * sb[j];
        ib1[j2] = aReal * sb[j2];
      }
    } else {
      for (let j = 0; j < sb.length; j += 2) {
        const j2 = j + 1;
        ib1[j] = input[j] * sb[j] - input[j2] * sb[j2];
        ib1[j2] = input[j] * sb[j2] + input[j2] * sb[j];
      }
    }

    this._f.transform(ob2, ib1);

    for (let j = 0; j < cb.length; j += 2) {
      const j2 = j + 1;
      ib2[j] = ob2[j] * cb[j] - ob2[j2] * cb[j2];
      ib2[j2] = ob2[j] * cb[j2] + ob2[j2] * cb[j];
    }

    this._f.inverseTransform(ob3, ib2);

    for (let j = 0; j < ob3.length; j += 2) {
      const aReal = ob3[j + a];
      const aImag = ob3[j + a + 1];
      const bReal = sb[j];
      const bImag = sb[j + 1];

      output[j] = aReal * bReal - aImag * bImag;
      output[j + 1] = aReal * bImag + aImag * bReal;
    }
  }

  transform(output, input) {
    this._transform(output, input, false);
  }

  realTransform(output, input) {
    this._transform(output, input, true);
  }
}

class FFT {
  constructor(fftLength) {
    this.fftLength = fftLength;
    this.isPowerOfTwo = isPowerOfTwo(fftLength);

    if (this.isPowerOfTwo) {
      this.fft = new P2FFT(fftLength);
      this.outputBufferSize = 2 * fftLength;
    } else {
      this.fft = new NP2FFT(fftLength);
      this.outputBufferSize = this.fft.bufferSize;
    }
  }

  realTransform(out, input) {
    this.fft.realTransform(out, input);
  }
}

function generalizedCosineWindow(M, a0) {
  if (M < 1) {
    return new Float64Array();
  }
  if (M === 1) {
    return new Float64Array([1]);
  }

  const a1 = 1 - a0;
  const factor = (2 * Math.PI) / (M - 1);
  const values = new Float64Array(M);
  for (let i = 0; i < M; i += 1) {
    values[i] = a0 - a1 * Math.cos(i * factor);
  }
  return values;
}

function hanning(M) {
  return generalizedCosineWindow(M, 0.5);
}

function windowFunction(windowLength, name, { periodic = true } = {}) {
  const length = periodic ? windowLength + 1 : windowLength;
  let window;

  switch (name) {
    case "hann":
    case "hann_window":
      window = hanning(length);
      break;
    default:
      throw new Error(`Unknown window type ${name}`);
  }

  if (periodic) {
    window = window.subarray(0, windowLength);
  }

  return window;
}

const HERTZ_TO_MEL_MAPPING = {
  htk: (freq) => 2595.0 * Math.log10(1.0 + freq / 700.0),
  kaldi: (freq) => 1127.0 * Math.log(1.0 + freq / 700.0),
  slaney: (
    freq,
    minLogHertz = 1000.0,
    minLogMel = 15.0,
    logstep = 27.0 / Math.log(6.4),
  ) =>
    freq >= minLogHertz
      ? minLogMel + Math.log(freq / minLogHertz) * logstep
      : (3.0 * freq) / 200.0,
};

function hertzToMel(freq, melScale = "htk") {
  const fn = HERTZ_TO_MEL_MAPPING[melScale];
  if (!fn) {
    throw new Error('melScale should be one of "htk", "slaney" or "kaldi"');
  }
  return typeof freq === "number" ? fn(freq) : freq.map((x) => fn(x));
}

const MEL_TO_HERTZ_MAPPING = {
  htk: (mels) => 700.0 * (10.0 ** (mels / 2595.0) - 1.0),
  kaldi: (mels) => 700.0 * (Math.exp(mels / 1127.0) - 1.0),
  slaney: (
    mels,
    minLogHertz = 1000.0,
    minLogMel = 15.0,
    logstep = Math.log(6.4) / 27.0,
  ) =>
    mels >= minLogMel
      ? minLogHertz * Math.exp(logstep * (mels - minLogMel))
      : (200.0 * mels) / 3.0,
};

function melToHertz(mels, melScale = "htk") {
  const fn = MEL_TO_HERTZ_MAPPING[melScale];
  if (!fn) {
    throw new Error('melScale should be one of "htk", "slaney" or "kaldi"');
  }
  return typeof mels === "number" ? fn(mels) : mels.map((x) => fn(x));
}

function linspace(start, end, num) {
  const step = (end - start) / (num - 1);
  return Float64Array.from({ length: num }, (_, i) => start + step * i);
}

function createTriangularFilterBank(fftFreqs, filterFreqs) {
  const numMels = filterFreqs.length - 2;
  const output = Array.from(
    { length: numMels },
    () => new Float32Array(fftFreqs.length),
  );

  const filterDiff = new Float64Array(filterFreqs.length - 1);
  for (let i = 0; i < filterDiff.length; i += 1) {
    filterDiff[i] = filterFreqs[i + 1] - filterFreqs[i];
  }

  for (let j = 0; j < fftFreqs.length; j += 1) {
    const freq = fftFreqs[j];
    for (let i = 0; i < numMels; i += 1) {
      const down = (freq - filterFreqs[i]) / filterDiff[i];
      const up = (filterFreqs[i + 2] - freq) / filterDiff[i + 1];
      output[i][j] = Math.max(0, Math.min(down, up));
    }
  }

  return output;
}

function melFilterBank(
  numFrequencyBins,
  numMelFilters,
  minFrequency,
  maxFrequency,
  samplingRate,
  norm = null,
  melScale = "htk",
  triangularizeInMelSpace = false,
) {
  if (norm !== null && norm !== "slaney") {
    throw new Error('norm must be null or "slaney"');
  }

  const melMin = hertzToMel(minFrequency, melScale);
  const melMax = hertzToMel(maxFrequency, melScale);
  const melFreqs = linspace(melMin, melMax, numMelFilters + 2);

  let filterFreqs = melToHertz(melFreqs, melScale);
  let fftFreqs;

  if (triangularizeInMelSpace) {
    const fftBinWidth = samplingRate / ((numFrequencyBins - 1) * 2);
    fftFreqs = hertzToMel(
      Float64Array.from(
        { length: numFrequencyBins },
        (_, i) => i * fftBinWidth,
      ),
      melScale,
    );
    filterFreqs = melFreqs;
  } else {
    fftFreqs = linspace(0, Math.floor(samplingRate / 2), numFrequencyBins);
  }

  const melFilters = createTriangularFilterBank(fftFreqs, filterFreqs);

  if (norm === "slaney") {
    for (let i = 0; i < numMelFilters; i += 1) {
      const filter = melFilters[i];
      const enorm = 2.0 / (filterFreqs[i + 2] - filterFreqs[i]);
      for (let j = 0; j < numFrequencyBins; j += 1) {
        filter[j] *= enorm;
      }
    }
  }

  return melFilters;
}

function calculateReflectOffset(i, w) {
  return Math.abs(((i + w) % (2 * w)) - w);
}

function padReflect(array, left, right) {
  const padded = new array.constructor(array.length + left + right);
  const w = array.length - 1;

  for (let i = 0; i < array.length; i += 1) {
    padded[left + i] = array[i];
  }

  for (let i = 1; i <= left; i += 1) {
    padded[left - i] = array[calculateReflectOffset(i, w)];
  }

  for (let i = 1; i <= right; i += 1) {
    padded[w + left + i] = array[calculateReflectOffset(w - i, w)];
  }

  return padded;
}

function spectrogram(
  waveform,
  window,
  frameLength,
  hopLength,
  {
    fftLength = null,
    power = 2.0,
    melFilters,
    melFloor = 1e-10,
    logMel = "log10",
    maxNumFrames = null,
    doPad = true,
  } = {},
) {
  if (fftLength === null) {
    fftLength = frameLength;
  }

  if (window.length !== frameLength) {
    throw new Error(
      `Length of the window (${window.length}) must equal frameLength (${frameLength})`,
    );
  }

  if (!melFilters) {
    throw new Error("melFilters must be provided");
  }

  const halfWindow = Math.floor((fftLength - 1) / 2) + 1;
  waveform = padReflect(waveform, halfWindow, halfWindow);

  let numFrames = Math.floor(
    1 + Math.floor((waveform.length - frameLength) / hopLength),
  );
  const numFrequencyBins = Math.floor(fftLength / 2) + 1;

  let d1 = numFrames;
  let d1Max = numFrames;

  if (maxNumFrames !== null) {
    if (maxNumFrames > numFrames) {
      if (doPad) {
        d1Max = maxNumFrames;
      }
    } else {
      d1Max = d1 = maxNumFrames;
    }
  }

  const fft = new FFT(fftLength);
  const inputBuffer = new Float64Array(fftLength);
  const outputBuffer = new Float64Array(fft.outputBufferSize);
  const transposedMagnitudeData = new Float32Array(numFrequencyBins * d1Max);

  for (let i = 0; i < d1; i += 1) {
    const offset = i * hopLength;
    const bufferSize = Math.min(waveform.length - offset, frameLength);
    if (bufferSize !== frameLength) {
      inputBuffer.fill(0, 0, frameLength);
    }

    for (let j = 0; j < bufferSize; j += 1) {
      inputBuffer[j] = waveform[offset + j];
    }

    for (let j = 0; j < window.length; j += 1) {
      inputBuffer[j] *= window[j];
    }

    fft.realTransform(outputBuffer, inputBuffer);

    for (let j = 0; j < numFrequencyBins; j += 1) {
      const j2 = j << 1;
      transposedMagnitudeData[j * d1Max + i] =
        outputBuffer[j2] ** 2 + outputBuffer[j2 + 1] ** 2;
    }
  }

  if (power !== null && power !== 2) {
    const pow = power / 2;
    for (let i = 0; i < transposedMagnitudeData.length; i += 1) {
      transposedMagnitudeData[i] **= pow;
    }
  }

  const numMelFilters = melFilters.length;
  const melSpecData = new Float32Array(numMelFilters * d1Max);

  for (let mel = 0; mel < numMelFilters; mel += 1) {
    const filter = melFilters[mel];
    const rowOffset = mel * d1Max;

    for (let frame = 0; frame < d1Max; frame += 1) {
      let sum = 0;
      for (let freq = 0; freq < numFrequencyBins; freq += 1) {
        sum += filter[freq] * transposedMagnitudeData[freq * d1Max + frame];
      }
      melSpecData[rowOffset + frame] = Math.max(melFloor, sum);
    }
  }

  if (power !== null && logMel !== null) {
    const limit = Math.min(melSpecData.length, d1 * numMelFilters);
    if (logMel === "log10") {
      for (let i = 0; i < limit; i += 1) {
        melSpecData[i] = Math.log10(melSpecData[i]);
      }
    } else if (logMel === "log") {
      for (let i = 0; i < limit; i += 1) {
        melSpecData[i] = Math.log(melSpecData[i]);
      }
    } else {
      throw new Error(`Unsupported logMel mode: ${logMel}`);
    }
  }

  return {
    data: melSpecData,
    dims: [numMelFilters, d1Max],
  };
}
