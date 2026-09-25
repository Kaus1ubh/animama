import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import {
  MIC_SENSITIVITIES,
  openSelectedMicrophone,
  readSelectedMicrophoneId,
  subscribeSelectedMicrophoneId,
  toMicSensitivity,
  writeSelectedMicrophoneId,
  type MicSensitivity,
} from "@/lib/voice/microphone-preferences";
import { Button } from "@/ui/components/button";
import { LiveWaveform } from "@/ui/components/live-waveform";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/select";
import { SettingsRow } from "@/ui/settings/SettingsLayout";
import { useSettings } from "@/ui/settings/SettingsProvider";

const SYSTEM_DEFAULT = "__system_default__";
/**
 * Browsers reveal device names only after microphone access is granted and do
 * not reliably fire `devicechange` then, so the test meter announces it.
 */
const MICROPHONE_ACCESS_EVENT = "animama:microphone-access-granted";
const SELECT_TRIGGER_CLASS_NAME = "w-56";

const SENSITIVITY_LABELS: Record<MicSensitivity, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
};

const SENSITIVITY_DESCRIPTIONS: Record<MicSensitivity, string> = {
  low: "Ignores quieter sounds; useful in noisy rooms.",
  normal: "Balanced speech detection.",
  high: "Picks up quieter or shorter speech.",
};

/** The remembered device ID for this machine, kept in sync across tabs. */
export function useSelectedMicrophoneId(): string | null {
  return useSyncExternalStore(
    subscribeSelectedMicrophoneId,
    readSelectedMicrophoneId,
    () => null,
  );
}

/** Available audio inputs, refreshed when devices are plugged or unplugged. */
function useAudioInputs() {
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  // Until the first enumeration finishes, a remembered device is not "missing".
  const [loaded, setLoaded] = useState(false);
  const refresh = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setInputs(devices.filter((device) => device.kind === "audioinput"));
      setLoaded(true);
    } catch {
      setInputs([]);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const mediaDevices = navigator.mediaDevices;
    mediaDevices?.addEventListener?.("devicechange", refresh);
    window.addEventListener(MICROPHONE_ACCESS_EVENT, refresh);
    return () => {
      mediaDevices?.removeEventListener?.("devicechange", refresh);
      window.removeEventListener(MICROPHONE_ACCESS_EVENT, refresh);
    };
  }, [refresh]);
  return { inputs, loaded, refresh };
}

/**
 * Input device picker. Before microphone permission is granted, browsers hide
 * device names, so the row offers to request access instead of listing blanks.
 */
export function MicrophoneDeviceSetting({
  usesSystemRecognizer,
}: {
  /** Browser speech recognition always listens on the system default input. */
  usesSystemRecognizer: boolean;
}) {
  const selectedId = useSelectedMicrophoneId();
  const { inputs, loaded, refresh } = useAudioInputs();
  // "default"/"communications" are browser aliases for the OS default device.
  const devices = inputs.filter(
    (device) =>
      device.deviceId &&
      device.deviceId !== "default" &&
      device.deviceId !== "communications",
  );
  const needsPermission =
    inputs.length > 0 && inputs.every((device) => !device.label);
  const selectedMissing =
    Boolean(selectedId) &&
    loaded &&
    !needsPermission &&
    !devices.some((device) => device.deviceId === selectedId);

  const requestAccess = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      await refresh();
    } catch {
      toast.error(
        "Microphone access was not granted. Allow it in your browser or system settings.",
      );
    }
  };

  return (
    <SettingsRow
      label="Input device"
      description={
        selectedMissing
          ? "The selected microphone isn't connected; using the system default."
          : usesSystemRecognizer
            ? "Browser speech recognition always uses the system default microphone."
            : "Used for dictation, Voice Mode and press to talk."
      }
      control={
        needsPermission ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => void requestAccess()}
          >
            Allow microphone access
          </Button>
        ) : (
          <Select
            value={selectedId && !selectedMissing ? selectedId : SYSTEM_DEFAULT}
            onValueChange={(value) =>
              writeSelectedMicrophoneId(value === SYSTEM_DEFAULT ? null : value)
            }
          >
            <SelectTrigger
              className={SELECT_TRIGGER_CLASS_NAME}
              aria-label="Microphone input device"
            >
              <SelectValue placeholder="System default" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SYSTEM_DEFAULT}>System default</SelectItem>
              {devices.map((device, index) => (
                <SelectItem key={device.deviceId} value={device.deviceId}>
                  {device.label || `Microphone ${index + 1}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      }
    />
  );
}

/** Low / Normal / High voice-detection sensitivity, saved in app preferences. */
export function MicrophoneSensitivitySetting({
  disabled,
}: {
  disabled: boolean;
}) {
  const { userPreferences, updateUserPreferences } = useSettings();
  const saved = toMicSensitivity(userPreferences?.speech?.mic_sensitivity);
  const [value, setValue] = useState<MicSensitivity>(saved);
  useEffect(() => setValue(saved), [saved]);

  return (
    <SettingsRow
      label="Sensitivity"
      description={`${SENSITIVITY_DESCRIPTIONS[value]} Applies from the next listening session.`}
      control={
        <Select
          value={value}
          disabled={disabled}
          onValueChange={(next) => {
            const sensitivity = toMicSensitivity(next);
            setValue(sensitivity);
            void updateUserPreferences({
              speech: { mic_sensitivity: sensitivity },
            }).catch(() => {
              setValue(saved);
              toast.error("Failed to update microphone sensitivity.");
            });
          }}
        >
          <SelectTrigger
            className={SELECT_TRIGGER_CLASS_NAME}
            aria-label="Microphone sensitivity"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MIC_SENSITIVITIES.map((option) => (
              <SelectItem key={option} value={option}>
                {SENSITIVITY_LABELS[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    />
  );
}

/**
 * Opt-in level meter for the selected microphone. The stream is released when
 * testing stops, the device changes, or the row unmounts (section or modal
 * closed), so the microphone indicator never stays on.
 */
export function MicrophoneTestSetting() {
  const selectedId = useSelectedMicrophoneId();
  const [testing, setTesting] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    if (!testing) return;
    let cancelled = false;
    let opened: MediaStream | null = null;
    void openSelectedMicrophone()
      .then((next) => {
        if (cancelled) {
          next.getTracks().forEach((track) => track.stop());
          return;
        }
        opened = next;
        setStream(next);
        window.dispatchEvent(new Event(MICROPHONE_ACCESS_EVENT));
      })
      .catch(() => {
        if (cancelled) return;
        setTesting(false);
        toast.error("Could not open the microphone.");
      });
    return () => {
      cancelled = true;
      opened?.getTracks().forEach((track) => track.stop());
      setStream(null);
    };
  }, [testing, selectedId]);

  return (
    <SettingsRow
      label="Test microphone"
      description={
        testing ? "Speak to see the input level." : "Check your input level."
      }
      control={
        <div className="flex items-center gap-3">
          {testing ? (
            <div role="img" aria-label="Microphone input level">
              <LiveWaveform
                active={Boolean(stream)}
                processing={!stream}
                stream={stream ?? undefined}
                mode="static"
                height={32}
                className="text-primary w-24"
              />
            </div>
          ) : null}
          <Button
            type="button"
            variant={testing ? "default" : "outline"}
            onClick={() => setTesting((value) => !value)}
          >
            {testing ? "Stop" : "Test"}
          </Button>
        </div>
      }
    />
  );
}
