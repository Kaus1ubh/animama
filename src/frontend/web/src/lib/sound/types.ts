export type SoundControllerBgmState =
  | "stopped"
  | "loading"
  | "playing"
  | "paused"
  | "blocked";

export type SoundPlaybackId = string;
export type SoundCueId = string;

export type SoundCue = {
  id: SoundCueId;
  assetPath: string;
  kind: "sfx" | "bgm";
  defaultVolume: number;
};

export type SoundControllerSnapshot = {
  bgmState: SoundControllerBgmState;
  bgmTrackUrl: string | null;
  pendingAutoplayRetry: boolean;
  masterMuted: boolean;
  bgmMuted: boolean;
  sfxMuted: boolean;
  ttsMuted: boolean;
  bgmVolume: number;
  sfxVolume: number;
  ttsVolume: number;
};

export type PlaySfxOptions = {
  /** Cancels only audio owned by this occurrence, including pending delivery. */
  signal?: AbortSignal;
  loop?: boolean;
  volume?: number;
};

export type PlayBgmOptions = {
  trackUrl?: string | null;
  loop?: boolean;
  volume?: number;
};

export type PreloadBgmOptions = {
  trackUrl?: string | null;
};

export type SoundControllerSubscriber = () => void;

export const DEFAULT_SOUND_CONTROLLER_SNAPSHOT: SoundControllerSnapshot = {
  bgmState: "stopped",
  bgmTrackUrl: null,
  pendingAutoplayRetry: false,
  masterMuted: false,
  bgmMuted: false,
  sfxMuted: false,
  ttsMuted: false,
  bgmVolume: 0.3,
  sfxVolume: 0.5,
  ttsVolume: 0.5,
};
