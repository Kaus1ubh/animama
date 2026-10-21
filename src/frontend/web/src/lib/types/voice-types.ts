export type RuntimeTurnId = string;
export type RuntimeRunId = string;
export type RuntimeJobId = string;

export type InputMode = "typed" | "dictation" | "voice";

export type AvatarInteractionPhase =
  | "idle"
  | "user_typing"
  | "listening"
  | "user_speaking"
  | "semantic_check"
  | "submitting"
  | "thinking"
  | "responding_no_tts"
  | "talking";

export type PcmFormat = {
  sampleRateHz: 16000;
  channels: 1;
  encoding: "f32";
};

export type TurnAudioSliceRef = {
  turnId: RuntimeTurnId;
  startSample: number;
  endSample: number;
  format: PcmFormat;
};

export type TurnAudioChunk = {
  turnId: RuntimeTurnId;
  chunkId: string;
  startedAtMs: number;
  endedAtMs: number;
  format: PcmFormat;
  samples: Float32Array;
};

export type TurnAudioBufferState = {
  turnId: RuntimeTurnId;
  chunks: TurnAudioChunk[];
  totalSamples: number;
  lastAudioAtMs: number | null;
  maxSilenceMs: number;
};

/** Which recognizer produced a segment; the offline engines name themselves. */
export type SttSegmentSource = "browser_web_speech" | "parakeet" | "sensevoice";

export type SttSegment = {
  turnId: RuntimeTurnId;
  source: SttSegmentSource;
  text: string;
  isFinal: boolean;
  createdAtMs: number;
  audioRef?: TurnAudioSliceRef | null;
};

export type AcousticVadEvent =
  | { turnId: RuntimeTurnId; type: "speech_start"; createdAtMs: number }
  | { turnId: RuntimeTurnId; type: "speech_real_start"; createdAtMs: number }
  | {
      turnId: RuntimeTurnId;
      type: "speech_end";
      createdAtMs: number;
      audioRef?: TurnAudioSliceRef | null;
    }
  | { turnId: RuntimeTurnId; type: "misfire"; createdAtMs: number };

export type SmartTurnJob = {
  jobId: RuntimeJobId;
  turnId: RuntimeTurnId;
  startedAtMs: number;
  status: "queued" | "running" | "completed" | "superseded" | "error";
  inputRef: TurnAudioSliceRef;
  paddedLeadingSamples: number;
  truncatedLeadingSamples: number;
  inputSamples: number;
};

export type SemanticVadDecision = {
  turnId: RuntimeTurnId;
  jobId: RuntimeJobId;
  decision: "end_turn" | "continue";
  score: number | null;
  latencyMs: number | null;
  createdAtMs: number;
};

export type VoiceSubmitReason =
  | "manual"
  | "semantic_end_turn"
  | "silence_timeout";

export type VoiceTurnState = {
  turnId: RuntimeTurnId;
  mode: InputMode;
  startedAtMs: number;
  lastSpeechAtMs: number | null;
  transcriptCommitted: string;
  transcriptTentative: string;
  audio: TurnAudioBufferState;
  latestSemanticDecision: SemanticVadDecision | null;
  activeSmartTurnJob: SmartTurnJob | null;
};
