import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { TFunction } from "i18next";
import { getI18n, useTranslation } from "react-i18next";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/select";
import { MicrophoneLevelMeter } from "@/ui/settings/MicrophoneLevelMeter";
import { SettingsRow } from "@/ui/settings/SettingsLayout";
import { useSettings } from "@/ui/settings/SettingsProvider";

const SYSTEM_DEFAULT = "__system_default__";
/**
 * Browsers reveal device names only after microphone access is granted and do
 * not reliably fire `devicechange` then, so the test meter announces it.
 */
const MICROPHONE_ACCESS_EVENT = "animama:microphone-access-granted";
const SELECT_TRIGGER_CLASS_NAME = "w-56";

/** Display name for a saved sensitivity level. */
function sensitivityLabel(
  t: TFunction<"voice">,
  sensitivity: MicSensitivity,
): string {
  switch (sensitivity) {
    case "low":
      return t("microphone.sensitivity.levels.low.label");
    case "normal":
      return t("microphone.sensitivity.levels.normal.label");
    case "high":
      return t("microphone.sensitivity.levels.high.label");
  }
}

/** What a sensitivity level does, including when the change applies. */
function sensitivityDescription(
  t: TFunction<"voice">,
  sensitivity: MicSensitivity,
): string {
  switch (sensitivity) {
    case "low":
      return t("microphone.sensitivity.levels.low.description");
    case "normal":
      return t("microphone.sensitivity.levels.normal.description");
    case "high":
      return t("microphone.sensitivity.levels.high.description");
  }
}

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
  const { t } = useTranslation("voice");
  const selectedId = useSelectedMicrophoneId();
  const { inputs, loaded, refresh } = useAudioInputs();
  // "default"/"communications" are browser aliases for the OS default device.
  const devices = inputs.filter(
    (device) =>
      device.deviceId &&
      device.deviceId !== "default" &&
      device.deviceId !== "communications",
  );
  // Chromium lists the OS default as a "default" alias labelled
  // "Default - <device name>"; show which device that currently is.
  const systemDefaultName =
    inputs
      .find((device) => device.deviceId === "default")
      ?.label.replace(/^Default\s*-\s*/, "")
      .trim() || null;
  const systemDefaultLabel = systemDefaultName
    ? t("microphone.device.systemDefaultNamed", { name: systemDefaultName })
    : t("microphone.device.systemDefault");
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
      toast.error(t("microphone.device.accessDenied"));
    }
  };

  return (
    <SettingsRow
      label={t("microphone.device.label")}
      description={
        selectedMissing
          ? t("microphone.device.missing")
          : usesSystemRecognizer
            ? systemDefaultName
              ? t("microphone.device.systemRecognizerNamed", {
                  name: systemDefaultName,
                })
              : t("microphone.device.systemRecognizer")
            : undefined
      }
      control={
        needsPermission ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => void requestAccess()}
          >
            {t("microphone.device.allowAccess")}
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
              aria-label={t("microphone.device.selectLabel")}
            >
              <SelectValue placeholder={t("microphone.device.systemDefault")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SYSTEM_DEFAULT}>
                {systemDefaultLabel}
              </SelectItem>
              {devices.map((device, index) => (
                <SelectItem key={device.deviceId} value={device.deviceId}>
                  {device.label ||
                    t("microphone.device.unnamed", { number: index + 1 })}
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
  const { t } = useTranslation("voice");
  const { userPreferences, updateUserPreferences } = useSettings();
  const saved = toMicSensitivity(userPreferences?.speech?.mic_sensitivity);
  const [value, setValue] = useState<MicSensitivity>(saved);
  useEffect(() => setValue(saved), [saved]);

  return (
    <SettingsRow
      label={t("microphone.sensitivity.label")}
      description={sensitivityDescription(t, value)}
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
              toast.error(t("microphone.sensitivity.saveFailed"));
            });
          }}
        >
          <SelectTrigger
            className={SELECT_TRIGGER_CLASS_NAME}
            aria-label={t("microphone.sensitivity.selectLabel")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MIC_SENSITIVITIES.map((option) => (
              <SelectItem key={option} value={option}>
                {sensitivityLabel(t, option)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    />
  );
}

/** Worded when it happens, so the test effect does not depend on the UI Locale. */
function microphoneOpenFailedText(): string {
  const t = getI18n().getFixedT(null, "voice");
  return t("microphone.test.openFailed");
}

/**
 * Opt-in level meter for the selected microphone. The stream is released when
 * testing stops, the device changes, or the row unmounts (section or modal
 * closed), so the microphone indicator never stays on.
 */
export function MicrophoneTestSetting() {
  const { t } = useTranslation("voice");
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
        toast.error(microphoneOpenFailedText());
      });
    return () => {
      cancelled = true;
      opened?.getTracks().forEach((track) => track.stop());
      setStream(null);
    };
  }, [testing, selectedId]);

  return (
    <SettingsRow
      label={t("microphone.test.label")}
      description={
        testing ? t("microphone.test.active") : t("microphone.test.idle")
      }
      control={
        <div className="flex items-center gap-3">
          {testing ? <MicrophoneLevelMeter stream={stream} /> : null}
          <Button
            type="button"
            variant={testing ? "default" : "outline"}
            onClick={() => setTesting((value) => !value)}
          >
            {testing ? t("microphone.test.stop") : t("microphone.test.start")}
          </Button>
        </div>
      }
    />
  );
}
