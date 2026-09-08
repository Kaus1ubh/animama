export type WhisperFeatureExtractorConfig = {
  chunk_length: number;
  feature_extractor_type: string;
  feature_size: number;
  hop_length: number;
  n_fft: number;
  n_samples: number;
  nb_max_frames: number;
  padding_side: string;
  padding_value: number;
  processor_class: string;
  return_attention_mask: boolean;
  sampling_rate: number;
  mel_filters?: ReadonlyArray<ReadonlyArray<number>>;
};

export type SmartTurnAudioWindow = {
  normalizedAudio: Float32Array;
  paddedLeadingSamples: number;
  truncatedLeadingSamples: number;
};

export type LocalFeatureTensor = {
  data: Float32Array;
  dims: [number, number, number];
};

export type LocalWhisperFeatureExtractor = {
  config: WhisperFeatureExtractorConfig;
  extract: (
    audio: Float32Array | Float64Array,
    options?: { maxLength?: number },
  ) => Promise<LocalFeatureTensor>;
};

export const DEFAULT_WHISPER_TINY_EN_CONFIG: Readonly<WhisperFeatureExtractorConfig>;
export const TARGET_SMART_TURN_SAMPLES: number;

export function normalizeWaveform(
  audio: Float32Array,
  eps?: number,
): Float32Array;

export function prepareSmartTurnAudioWindow(
  audio: Float32Array,
  targetSamples?: number,
): SmartTurnAudioWindow;

export function createLocalWhisperFeatureExtractor(
  config?: Partial<WhisperFeatureExtractorConfig>,
): LocalWhisperFeatureExtractor;
