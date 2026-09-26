import type { MicSensitivity } from "@/lib/voice/microphone-preferences";
import type { AppearanceOverrides } from "@/lib/theme/appearance-overrides";
import {
  DEFAULT_DESKTOP_SHORTCUTS,
  type DesktopShortcut,
  type DesktopShortcutAction,
} from "@/lib/settings/desktop-shortcuts";

export type PreferenceToggleSection = {
  disable_influence?: boolean;
  disable_updates?: boolean;
  [key: string]: unknown;
};

export type MemoryPreferences = PreferenceToggleSection & {
  manager_model?: string | null;
};

export type SttProviderPreference =
  | "parakeet"
  | "browser_external"
  | "browser_local";

export type TtsProviderPreference = "browser" | "pocket_tts" | "elevenlabs";

export type ElevenLabsRealtimeTtsModelId =
  | "eleven_flash_v2_5"
  | "eleven_multilingual_v2";
export type ElevenLabsFinalizedTtsModelId = "eleven_v3";
export type ElevenLabsTtsModelId =
  | ElevenLabsRealtimeTtsModelId
  | ElevenLabsFinalizedTtsModelId;
export type ElevenLabsV3FinalizedChunking = "sentence" | "paragraph";

export const DEFAULT_ELEVENLABS_REALTIME_TTS_MODEL_ID =
  "eleven_flash_v2_5" satisfies ElevenLabsRealtimeTtsModelId;
export const DEFAULT_ELEVENLABS_TTS_MODEL_ID =
  DEFAULT_ELEVENLABS_REALTIME_TTS_MODEL_ID satisfies ElevenLabsTtsModelId;
export const DEFAULT_ELEVENLABS_V3_FINALIZED_CHUNKING =
  "paragraph" satisfies ElevenLabsV3FinalizedChunking;

export const ELEVENLABS_TTS_MODEL_OPTIONS: Array<{
  id: ElevenLabsTtsModelId;
  label: string;
  description: string;
  capability: "realtime" | "finalized";
}> = [
  {
    id: "eleven_flash_v2_5",
    label: "Flash v2.5",
    description: "Lower-latency realtime ElevenLabs speech.",
    capability: "realtime",
  },
  {
    id: "eleven_multilingual_v2",
    label: "Multilingual v2",
    description: "The established multilingual realtime model.",
    capability: "realtime",
  },
  {
    id: "eleven_v3",
    label: "Eleven v3",
    description: "Expressive speech generated after the response is complete.",
    capability: "finalized",
  },
];

export const ELEVENLABS_REALTIME_TTS_MODEL_OPTIONS =
  ELEVENLABS_TTS_MODEL_OPTIONS.filter(
    (
      option,
    ): option is {
      id: ElevenLabsRealtimeTtsModelId;
      label: string;
      description: string;
      capability: "realtime";
    } => option.capability === "realtime",
  );

export const ELEVENLABS_V3_FINALIZED_CHUNKING_OPTIONS: Array<{
  id: ElevenLabsV3FinalizedChunking;
  label: string;
  description: string;
}> = [
  {
    id: "sentence",
    label: "Sentence",
    description: "Fastest start with one finalized request per sentence.",
  },
  {
    id: "paragraph",
    label: "Paragraph",
    description: "Smoother long-form audio with paragraph-sized requests.",
  },
];

export type SpeechPreferences = {
  stt_provider?: SttProviderPreference;
  /** Experimental: run local Parakeet on WebGPU when available (default off). */
  stt_parakeet_webgpu?: boolean;
  tts_enabled?: boolean;
  tts_provider?: TtsProviderPreference;
  tts_stream_chunks?: boolean;
  tts_elevenlabs_model_id?: ElevenLabsTtsModelId;
  tts_elevenlabs_v3_finalized_chunking?: ElevenLabsV3FinalizedChunking;
  desktop_shortcuts?: Partial<Record<DesktopShortcutAction, DesktopShortcut>>;
  tts_pocket_voice?: string;
  tts_pocket_anima_voice?: string;
  tts_pocket_custom_voice_available?: boolean;
  tts_pocket_anima_custom_voice_available?: boolean;
  /** Voice-detection sensitivity; see `lib/voice/microphone-preferences.ts`. */
  mic_sensitivity?: MicSensitivity;
  [key: string]: unknown;
};

export type AvatarBackgroundPreferences = {
  background_id?: string;
  focal_x?: number;
  focal_y?: number;
  zoom?: number;
  [key: string]: unknown;
};

export type PresentationPreferences = {
  enable_avatar_transform_controls?: boolean;
  /** Render assistant replies as Markdown (default on). */
  render_markdown?: boolean;
  disable_animation?: boolean;
  disable_vfx?: boolean;
  avatar_background?: AvatarBackgroundPreferences | null;
  [key: string]: unknown;
};

export type SettingsPreferences = {
  /** Keeps first-message suggestions dismissed across chats and deleted history. */
  has_sent_chat_message?: boolean;
  /** App-wide startup and model defaults chosen in App Settings → General. */
  startup?: { default_anima_id?: string | null };
  chat?: { default_model_provider_id?: string | null };
  /** Per-mode colour overrides; see `lib/theme/appearance-overrides.ts`. */
  appearance?: AppearanceOverrides;
  memory?: MemoryPreferences;
  emotion?: PreferenceToggleSection;
  presentation?: PresentationPreferences;
  speech?: SpeechPreferences;
  [key: string]: unknown;
};

export const DEFAULT_ANIMAMA_PREFERENCES: SettingsPreferences = {
  memory: { disable_influence: false, disable_updates: false },
  emotion: { disable_influence: false, disable_updates: false },
  speech: {
    tts_enabled: false,
    tts_provider: "elevenlabs",
    tts_elevenlabs_model_id: DEFAULT_ELEVENLABS_TTS_MODEL_ID,
    tts_elevenlabs_v3_finalized_chunking:
      DEFAULT_ELEVENLABS_V3_FINALIZED_CHUNKING,
    tts_stream_chunks: true,
    desktop_shortcuts: DEFAULT_DESKTOP_SHORTCUTS,
  },
  presentation: {
    enable_avatar_transform_controls: false,
    disable_animation: false,
    disable_vfx: false,
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeSection(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const baseSection = isRecord(base[key])
    ? (base[key] as Record<string, unknown>)
    : undefined;
  const patchSection = isRecord(patch[key])
    ? (patch[key] as Record<string, unknown>)
    : undefined;
  if (!baseSection && !patchSection) return undefined;
  return { ...(baseSection ?? {}), ...(patchSection ?? {}) };
}

function mergeNestedRecord(
  base: Record<string, unknown> | undefined,
  patch: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  const baseValue = base && isRecord(base[key]) ? base[key] : undefined;
  const patchValue = patch && isRecord(patch[key]) ? patch[key] : undefined;
  if (!baseValue && !patchValue) return undefined;
  return {
    ...((baseValue as Record<string, unknown> | undefined) ?? {}),
    ...((patchValue as Record<string, unknown> | undefined) ?? {}),
  };
}

export function mergePreferences(
  base?: SettingsPreferences | null,
  patch?: SettingsPreferences | null,
): SettingsPreferences {
  const baseObj = isRecord(base) ? base : {};
  const patchObj = isRecord(patch) ? patch : {};
  const merged: SettingsPreferences = { ...baseObj, ...patchObj };

  const memory = mergeSection(baseObj, patchObj, "memory");
  const emotion = mergeSection(baseObj, patchObj, "emotion");
  const presentation = mergeSection(baseObj, patchObj, "presentation");
  const speech = mergeSection(baseObj, patchObj, "speech");
  const appearance = mergeSection(baseObj, patchObj, "appearance");
  const startup = mergeSection(baseObj, patchObj, "startup");
  const chat = mergeSection(baseObj, patchObj, "chat");
  if (startup) merged.startup = startup as SettingsPreferences["startup"];
  if (chat) merged.chat = chat as SettingsPreferences["chat"];

  if (memory) merged.memory = memory as PreferenceToggleSection;
  if (emotion) merged.emotion = emotion as PreferenceToggleSection;
  if (presentation)
    merged.presentation = presentation as PresentationPreferences;
  if (appearance) {
    // Merge each mode separately so editing one colour keeps the others.
    const baseAppearance = isRecord(baseObj.appearance)
      ? (baseObj.appearance as Record<string, unknown>)
      : undefined;
    const patchAppearance = isRecord(patchObj.appearance)
      ? (patchObj.appearance as Record<string, unknown>)
      : undefined;
    for (const mode of ["light", "dark"]) {
      const modeValue = mergeNestedRecord(
        baseAppearance,
        patchAppearance,
        mode,
      );
      if (modeValue) appearance[mode] = modeValue;
    }
    merged.appearance = appearance as AppearanceOverrides;
  }
  if (speech) {
    const baseSpeech = isRecord(baseObj.speech)
      ? (baseObj.speech as Record<string, unknown>)
      : undefined;
    const patchSpeech = isRecord(patchObj.speech)
      ? (patchObj.speech as Record<string, unknown>)
      : undefined;
    const desktopShortcuts = mergeNestedRecord(
      baseSpeech,
      patchSpeech,
      "desktop_shortcuts",
    );
    if (desktopShortcuts) {
      speech.desktop_shortcuts = desktopShortcuts;
    }
    merged.speech = speech as SpeechPreferences;
  }

  return merged;
}

/** The pinned startup Anima ID, or null for "Last opened". */
export function readDefaultAnimaId(preferences: unknown): string | null {
  if (!isRecord(preferences) || !isRecord(preferences.startup)) return null;
  const value = preferences.startup.default_anima_id;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** The owner's default chat model for new Animas, or null for the system default. */
export function readDefaultChatModelId(preferences: unknown): string | null {
  if (!isRecord(preferences) || !isRecord(preferences.chat)) return null;
  const value = preferences.chat.default_model_provider_id;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function resolvePreferences(
  userPrefs?: SettingsPreferences | null,
  animaPrefs?: SettingsPreferences | null,
): SettingsPreferences {
  const withUser = mergePreferences(DEFAULT_ANIMAMA_PREFERENCES, userPrefs);
  return mergePreferences(withUser, animaPrefs);
}

/**
 * Map a stored theme to a supported mode. Retired values (`custom`/`anima`,
 * the backend default) fall back to light.
 */
export function normalizeThemeSetting(
  theme?: string | null,
): "system" | "light" | "dark" | null {
  if (theme === "system" || theme === "light" || theme === "dark") {
    return theme;
  }
  if (theme === "custom" || theme === "anima") return "light";
  return null;
}

export function themesEquivalent(
  stored?: string | null,
  current?: string | null,
): boolean {
  const storedNormalized = normalizeThemeSetting(stored);
  const currentNormalized = normalizeThemeSetting(current);
  if (!storedNormalized || !currentNormalized) return false;
  return storedNormalized === currentNormalized;
}

export function toElevenLabsRealtimeTtsModelId(
  value: unknown,
): ElevenLabsRealtimeTtsModelId | null {
  return value === "eleven_flash_v2_5" || value === "eleven_multilingual_v2"
    ? value
    : null;
}

export function toElevenLabsTtsModelId(
  value: unknown,
): ElevenLabsTtsModelId | null {
  return value === "eleven_flash_v2_5" ||
    value === "eleven_multilingual_v2" ||
    value === "eleven_v3"
    ? value
    : null;
}

export function isElevenLabsRealtimeTtsModelId(
  value: unknown,
): value is ElevenLabsRealtimeTtsModelId {
  return toElevenLabsRealtimeTtsModelId(value) !== null;
}

export function isElevenLabsFinalizedTtsModelId(
  value: unknown,
): value is ElevenLabsFinalizedTtsModelId {
  return value === "eleven_v3";
}

export function toElevenLabsV3FinalizedChunking(
  value: unknown,
): ElevenLabsV3FinalizedChunking | null {
  return value === "sentence" || value === "paragraph" ? value : null;
}

export function resolveElevenLabsV3FinalizedChunking(
  value: unknown,
): ElevenLabsV3FinalizedChunking {
  return (
    toElevenLabsV3FinalizedChunking(value) ??
    DEFAULT_ELEVENLABS_V3_FINALIZED_CHUNKING
  );
}

/**
 * The experimental WebGPU speech setting is opt-in: absent, `false` or any
 * non-boolean value means off.
 */
export function isParakeetWebgpuPreferred(
  preferences: SettingsPreferences | null | undefined,
): boolean {
  return preferences?.speech?.stt_parakeet_webgpu === true;
}
