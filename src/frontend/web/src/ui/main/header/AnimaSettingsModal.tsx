"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ChangeEvent,
} from "react";
import { toast } from "sonner";

import { usePocketTtsRuntime } from "@/hooks/use-pocket-tts-runtime";
import { toTtsProvider } from "@/lib/speech/tts-provider";
import {
  POCKET_TTS_CUSTOM_VOICE,
  hasPocketAnimaVoiceOverride,
  isPocketCustomVoice,
  resolvePocketVoicePreference,
  toPocketVoicePreference,
} from "@/lib/speech/pocket/voice-preferences";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/select";
import { Switch } from "@/ui/components/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/ui/components/tooltip";
import { useSettings } from "@/ui/settings/SettingsProvider";

type SettingRowProps = {
  label: string;
  description: string;
  tooltip: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
};

const ANIMAMA_DEFAULT_VOICE_VALUE = "__anima_default__";

function SettingRow({
  label,
  description,
  tooltip,
  checked,
  disabled,
  onChange,
}: SettingRowProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "border-border/60 bg-background flex items-center justify-between gap-4 rounded-lg border px-4 py-3",
            disabled && "opacity-70",
          )}
        >
          <div>
            <p className="text-foreground text-sm font-medium">{label}</p>
            <p className="text-muted-foreground text-xs">{description}</p>
          </div>
          <Switch
            checked={checked}
            disabled={disabled}
            onCheckedChange={onChange}
          />
        </div>
      </TooltipTrigger>
      <TooltipContent sideOffset={6}>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

export function AnimaSettingsModal() {
  const {
    effectivePreferences,
    animaPreferences,
    updateAnimaPreferences,
    isLoading,
    isUpdating,
  } = useSettings();
  const {
    ready: pocketReady,
    phase: pocketPhase,
    voices: pocketVoices,
    hasCustomVoice,
    isEncodingVoice,
    voiceUploadStatus,
    error: pocketError,
    crossOriginIsolated,
    warmup: warmupPocket,
    setVoice: setPocketVoice,
    encodeVoiceFromFile,
  } = usePocketTtsRuntime();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isBusy = isLoading || isUpdating;

  const emotionEnabled = !effectivePreferences.emotion?.disable_influence;
  const emotionUpdatesEnabled = !effectivePreferences.emotion?.disable_updates;
  const memoryEnabled = !effectivePreferences.memory?.disable_influence;
  const memoryUpdatesEnabled = !effectivePreferences.memory?.disable_updates;

  const activeProvider = toTtsProvider(
    effectivePreferences.speech?.tts_provider,
  );
  const ttsEnabled = effectivePreferences.speech?.tts_enabled === true;
  const pocketProviderEnabled = ttsEnabled && activeProvider === "pocket_tts";

  const effectivePocketVoice = resolvePocketVoicePreference(
    effectivePreferences.speech,
  );
  const animaHasPocketOverride = hasPocketAnimaVoiceOverride(
    animaPreferences?.speech,
  );
  const animaOverrideVoice = toPocketVoicePreference(
    animaPreferences?.speech?.tts_pocket_anima_voice,
  );

  const selectedPocketVoice = animaHasPocketOverride
    ? (animaOverrideVoice ?? ANIMAMA_DEFAULT_VOICE_VALUE)
    : ANIMAMA_DEFAULT_VOICE_VALUE;

  const canEditPocketSettings = pocketProviderEnabled && !isBusy;

  useEffect(() => {
    if (!pocketProviderEnabled) return;
    void warmupPocket().catch(() => {
      // surfaced via runtime state + toasts elsewhere
    });
  }, [pocketProviderEnabled, warmupPocket]);

  const handleEmotionEnabled = useCallback(
    (checked: boolean) => {
      if (isBusy) return;
      const disableUpdates = !checked;
      void updateAnimaPreferences({
        emotion: {
          disable_influence: !checked,
          ...(disableUpdates ? { disable_updates: true } : {}),
        },
      }).catch(() => toast("Failed to update emotion settings."));
    },
    [isBusy, updateAnimaPreferences],
  );

  const handleEmotionUpdates = useCallback(
    (checked: boolean) => {
      if (isBusy) return;
      if (!emotionEnabled && checked) {
        toast("Enable emotion first to allow updates.");
        return;
      }
      void updateAnimaPreferences({
        emotion: { disable_updates: !checked },
      }).catch(() => toast("Failed to update emotion settings."));
    },
    [emotionEnabled, isBusy, updateAnimaPreferences],
  );

  const handleMemoryEnabled = useCallback(
    (checked: boolean) => {
      if (isBusy) return;
      const disableUpdates = !checked;
      void updateAnimaPreferences({
        memory: {
          disable_influence: !checked,
          ...(disableUpdates ? { disable_updates: true } : {}),
        },
      }).catch(() => toast("Failed to update memory settings."));
    },
    [isBusy, updateAnimaPreferences],
  );

  const handleMemoryUpdates = useCallback(
    (checked: boolean) => {
      if (isBusy) return;
      if (!memoryEnabled && checked) {
        toast("Enable memory first to allow updates.");
        return;
      }
      void updateAnimaPreferences({
        memory: { disable_updates: !checked },
      }).catch(() => toast("Failed to update memory settings."));
    },
    [isBusy, memoryEnabled, updateAnimaPreferences],
  );

  const persistAnimaPocketVoice = useCallback(
    async (voice: string | null) => {
      if (voice) {
        await updateAnimaPreferences({
          speech: {
            tts_pocket_anima_voice: voice,
            tts_pocket_anima_custom_voice_available: isPocketCustomVoice(voice),
          },
        });
        return;
      }

      await updateAnimaPreferences({
        speech: {
          tts_pocket_anima_voice: "",
          tts_pocket_anima_custom_voice_available: false,
        },
      });
    },
    [updateAnimaPreferences],
  );

  const handlePocketVoiceChange = useCallback(
    (value: string) => {
      if (!canEditPocketSettings || isEncodingVoice) return;

      if (value === ANIMAMA_DEFAULT_VOICE_VALUE) {
        void persistAnimaPocketVoice(null)
          .then(() => {
            toast.success("Using application Pocket voice for this anima.");
          })
          .catch(() => {
            toast.error("Failed to clear anima Pocket voice override.");
          });
        return;
      }

      if (isPocketCustomVoice(value) && !hasCustomVoice) {
        toast.error("Upload and encode a custom voice before selecting it.");
        return;
      }

      void (async () => {
        await setPocketVoice(value);
        await persistAnimaPocketVoice(value);
      })().catch(() => {
        toast.error("Failed to update anima Pocket voice.");
      });
    },
    [
      canEditPocketSettings,
      hasCustomVoice,
      isEncodingVoice,
      persistAnimaPocketVoice,
      setPocketVoice,
    ],
  );

  const handleUploadClick = useCallback(() => {
    if (!canEditPocketSettings || isEncodingVoice) return;
    fileInputRef.current?.click();
  }, [canEditPocketSettings, isEncodingVoice]);

  const handleVoiceFileSelected = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const input = event.currentTarget;
      const file = input.files?.[0] ?? null;
      input.value = "";
      if (!file) return;

      if (!canEditPocketSettings) {
        toast.error(
          "Enable PocketTTS in application settings before uploading a voice.",
        );
        return;
      }

      void (async () => {
        const encoded = await encodeVoiceFromFile(file);
        await setPocketVoice(encoded.voiceName);
        await persistAnimaPocketVoice(encoded.voiceName);
        toast.success("Custom Pocket voice ready for this anima.");
      })().catch(() => {
        toast.error("Failed to encode custom voice.");
      });
    },
    [
      canEditPocketSettings,
      encodeVoiceFromFile,
      persistAnimaPocketVoice,
      setPocketVoice,
    ],
  );

  const pocketStatusCopy = useMemo(() => {
    if (!ttsEnabled) {
      return "Enable TTS in application settings to configure Pocket voice options.";
    }
    if (activeProvider !== "pocket_tts") {
      return "Select PocketTTS as the active provider in application settings to edit anima voice options.";
    }
    if (!pocketReady && pocketPhase === "loading") {
      return "Loading PocketTTS runtime...";
    }
    if (!pocketReady && pocketPhase === "error") {
      return "PocketTTS failed to initialize for this route.";
    }
    if (animaHasPocketOverride && animaOverrideVoice) {
      return `Anima override is active: ${animaOverrideVoice}.`;
    }
    if (effectivePocketVoice) {
      return `Using application fallback voice: ${effectivePocketVoice}.`;
    }
    return "Using PocketTTS default voice.";
  }, [
    activeProvider,
    effectivePocketVoice,
    animaHasPocketOverride,
    animaOverrideVoice,
    pocketPhase,
    pocketReady,
    ttsEnabled,
  ]);

  return (
    <div className="border-border/60 bg-muted/10 flex flex-1 flex-col gap-6 rounded-xl border p-6">
      <div>
        <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
          Emotion
        </p>
        <div className="mt-3 grid gap-3">
          <SettingRow
            label="Enable emotion"
            description="Allow the anima to express emotions."
            tooltip="Toggles emotional state tracking."
            checked={emotionEnabled}
            disabled={isBusy}
            onChange={handleEmotionEnabled}
          />
          <SettingRow
            label="Enable emotion updates"
            description="Allow changes to emotional state over time."
            tooltip="Lets emotions update from interactions."
            checked={emotionUpdatesEnabled}
            disabled={!emotionEnabled || isBusy}
            onChange={handleEmotionUpdates}
          />
        </div>
      </div>

      <div>
        <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
          Memory
        </p>
        <div className="mt-3 grid gap-3">
          <SettingRow
            label="Enable memory"
            description="Allow the anima to read from memory."
            tooltip="Controls memory access."
            checked={memoryEnabled}
            disabled={isBusy}
            onChange={handleMemoryEnabled}
          />
          <SettingRow
            label="Enable memory updates"
            description="Allow writing new information to memory."
            tooltip="Controls memory updates and persistence."
            checked={memoryUpdatesEnabled}
            disabled={!memoryEnabled || isBusy}
            onChange={handleMemoryUpdates}
          />
        </div>
      </div>

      <div>
        <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
          Voice Output
        </p>
        <div className="mt-3 grid gap-3">
          <div className="border-border/60 bg-background rounded-lg border px-4 py-3">
            <p className="text-foreground text-sm font-medium">
              PocketTTS status
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              {pocketStatusCopy}
            </p>
            {pocketProviderEnabled ? (
              <p className="text-muted-foreground mt-2 text-xs">
                Runtime phase:{" "}
                <span className="font-medium">{pocketPhase}</span>
              </p>
            ) : null}
            {pocketProviderEnabled && !crossOriginIsolated ? (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-500">
                Cross-origin isolation is disabled on this route. PocketTTS will
                run in reduced threading mode.
              </p>
            ) : null}
            {pocketError ? (
              <p className="text-destructive mt-2 text-xs">{pocketError}</p>
            ) : null}
          </div>

          <div className="border-border/60 bg-background rounded-lg border px-4 py-3">
            <p className="text-foreground text-sm font-medium">
              Anima Pocket voice
            </p>
            <p className="text-muted-foreground mt-2 text-xs">
              Override the application Pocket voice for this anima.
            </p>
            <div className="mt-3">
              <Select
                value={selectedPocketVoice}
                onValueChange={handlePocketVoiceChange}
                disabled={!canEditPocketSettings || isEncodingVoice}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select voice" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANIMAMA_DEFAULT_VOICE_VALUE}>
                    Use application default
                  </SelectItem>
                  {pocketVoices.map((voiceName) => (
                    <SelectItem key={voiceName} value={voiceName}>
                      {voiceName}
                    </SelectItem>
                  ))}
                  <SelectItem
                    value={POCKET_TTS_CUSTOM_VOICE}
                    disabled={!hasCustomVoice}
                  >
                    Custom (uploaded)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {!hasCustomVoice ? (
              <p className="text-muted-foreground mt-2 text-xs">
                Upload a sample to enable the custom Pocket voice option.
              </p>
            ) : null}
          </div>

          <div className="border-border/60 bg-background rounded-lg border px-4 py-3">
            <p className="text-foreground text-sm font-medium">
              Custom voice cloning
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              Upload an audio sample to encode a anima-specific custom voice.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleUploadClick}
                disabled={!canEditPocketSettings || isEncodingVoice}
              >
                {isEncodingVoice ? "Encoding..." : "Upload voice sample"}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={handleVoiceFileSelected}
              />
            </div>
            {voiceUploadStatus ? (
              <p className="text-muted-foreground mt-2 text-xs">
                {voiceUploadStatus}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
