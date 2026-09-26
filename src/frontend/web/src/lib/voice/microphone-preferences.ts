/**
 * Microphone input preferences shared by dictation, Voice Mode and the
 * App Settings microphone test.
 *
 * - The selected input device is remembered per machine/browser in local
 *   storage, because device IDs are only meaningful on the device that issued
 *   them. It is never synced through app preferences.
 * - Sensitivity is an app preference (`speech.mic_sensitivity`) that selects
 *   voice-activity-detection thresholds. "normal" preserves the original
 *   hard-coded values.
 */

const DEVICE_STORAGE_KEY = "animama.microphone.deviceId";
const DEVICE_CHANGE_EVENT = "animama:microphone-device-change";

export const MIC_SENSITIVITIES = ["low", "normal", "high"] as const;
export type MicSensitivity = (typeof MIC_SENSITIVITIES)[number];
export const DEFAULT_MIC_SENSITIVITY: MicSensitivity = "normal";

export type VadThresholds = {
  positiveSpeechThreshold: number;
  negativeSpeechThreshold: number;
  minSpeechMs: number;
};

/**
 * Voice-activity thresholds per sensitivity. Higher sensitivity starts speech
 * on lower model confidence and shorter sounds; lower sensitivity ignores
 * quieter or briefer input such as background noise. Normal must stay equal to
 * the values used before this setting existed.
 */
const VAD_THRESHOLDS: Record<MicSensitivity, VadThresholds> = {
  low: {
    positiveSpeechThreshold: 0.5,
    negativeSpeechThreshold: 0.35,
    minSpeechMs: 250,
  },
  normal: {
    positiveSpeechThreshold: 0.3,
    negativeSpeechThreshold: 0.25,
    minSpeechMs: 180,
  },
  high: {
    positiveSpeechThreshold: 0.2,
    negativeSpeechThreshold: 0.15,
    minSpeechMs: 120,
  },
};

export function toMicSensitivity(value: unknown): MicSensitivity {
  return MIC_SENSITIVITIES.includes(value as MicSensitivity)
    ? (value as MicSensitivity)
    : DEFAULT_MIC_SENSITIVITY;
}

export function vadThresholdsForSensitivity(value: unknown): VadThresholds {
  return VAD_THRESHOLDS[toMicSensitivity(value)];
}

/** The remembered input device ID, or null for the system default. */
export function readSelectedMicrophoneId(): string | null {
  try {
    return window.localStorage.getItem(DEVICE_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

/** Remember (or clear, with null) the input device for this machine. */
export function writeSelectedMicrophoneId(deviceId: string | null): void {
  try {
    if (deviceId) window.localStorage.setItem(DEVICE_STORAGE_KEY, deviceId);
    else window.localStorage.removeItem(DEVICE_STORAGE_KEY);
  } catch {
    // Storage can be unavailable (private mode, blocked site data); the
    // system default microphone still works.
  }
  window.dispatchEvent(new Event(DEVICE_CHANGE_EVENT));
}

/** Subscribe to device selection changes in this and other tabs. */
export function subscribeSelectedMicrophoneId(
  onChange: () => void,
): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === DEVICE_STORAGE_KEY) onChange();
  };
  window.addEventListener(DEVICE_CHANGE_EVENT, onChange);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(DEVICE_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", handleStorage);
  };
}

/**
 * Audio constraints for capture. A remembered device is requested as `ideal`,
 * not `exact`, so an unplugged device falls back to the system default instead
 * of failing dictation or Voice Mode.
 */
export function microphoneAudioConstraints(
  deviceId: string | null,
): MediaTrackConstraints {
  return {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    ...(deviceId ? { deviceId: { ideal: deviceId } } : {}),
  };
}

/** Open the selected (or default) microphone. */
export function openSelectedMicrophone(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: microphoneAudioConstraints(readSelectedMicrophoneId()),
  });
}
