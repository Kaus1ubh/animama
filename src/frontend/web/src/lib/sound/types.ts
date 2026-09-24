export type SoundPlaybackId = string;
export type SoundCueId = string;

export type SoundCue = {
  id: SoundCueId;
  assetPath: string;
  kind: "sfx";
  defaultVolume: number;
};

export type SoundControllerSnapshot = {
  masterMuted: boolean;
  sfxMuted: boolean;
  ttsMuted: boolean;
  sfxVolume: number;
  ttsVolume: number;
};

export type PlaySfxOptions = {
  /** Cancels only audio owned by this occurrence, including pending delivery. */
  signal?: AbortSignal;
  loop?: boolean;
  volume?: number;
};

export type SoundControllerSubscriber = () => void;

export const DEFAULT_SOUND_CONTROLLER_SNAPSHOT: SoundControllerSnapshot = {
  masterMuted: false,
  sfxMuted: false,
  ttsMuted: false,
  sfxVolume: 0.5,
  ttsVolume: 0.5,
};
