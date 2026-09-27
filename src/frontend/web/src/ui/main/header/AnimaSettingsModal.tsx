"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ChangeEvent,
} from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";

import { usePocketTtsRuntime } from "@/hooks/use-pocket-tts-runtime";
import {
  animaBehaviorOverride,
  appBehaviorEnabled,
  behaviorPatch,
  effectiveBehaviorEnabled,
  type BehaviorFlag,
  type BehaviorOverride,
} from "@/lib/settings/behavior-defaults";
import { toTtsProvider } from "@/lib/speech/tts-provider";
import {
  POCKET_TTS_CUSTOM_VOICE,
  hasPocketAnimaVoiceOverride,
  isPocketCustomVoice,
  resolvePocketVoicePreference,
  toPocketVoicePreference,
} from "@/lib/speech/pocket/voice-preferences";
import {
  groupPocketVoices,
  pocketVoiceLabel,
} from "@/lib/speech/pocket/voice-groups";
import type { PocketVoiceAvailability } from "@/lib/speech/pocket/voice-preferences";
import { usePocketVoiceDownloads } from "@/hooks/use-pocket-voice-downloads";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/components/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/ui/components/tooltip";
import { useSettings } from "@/ui/settings/SettingsProvider";

type InheritableSettingRowProps = {
  label: string;
  description: string;
  tooltip: string;
  value: BehaviorOverride;
  /** The App Settings value shown for "Use app default". */
  appEnabled: boolean;
  disabled?: boolean;
  onChange: (value: BehaviorOverride) => void;
};

const ANIMAMA_DEFAULT_VOICE_VALUE = "__anima_default__";

/**
 * A memory/emotion behaviour that follows App Settings unless this Anima sets
 * its own value.
 */
function InheritableSettingRow({
  label,
  description,
  tooltip,
  value,
  appEnabled,
  disabled,
  onChange,
}: InheritableSettingRowProps) {
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
          <Select
            value={value}
            disabled={disabled}
            onValueChange={(next) => onChange(next as BehaviorOverride)}
          >
            <SelectTrigger className="w-48 shrink-0" aria-label={label}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="inherit">
                App default ({appEnabled ? "On" : "Off"})
              </SelectItem>
              <SelectItem value="on">On</SelectItem>
              <SelectItem value="off">Off</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </TooltipTrigger>
      <TooltipContent sideOffset={6}>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

/**
 * A subtle status mark for downloadable voices: a download glyph until the
 * voice is installed, and a small progress ring while it downloads.
 */
function PocketVoiceDownloadIcon({
  availability,
}: {
  availability: PocketVoiceAvailability | null;
}) {
  if (!availability || availability.status === "installed") return null;
  if (availability.status === "downloading") {
    const progress = availability.progress ?? 0;
    const circumference = 2 * Math.PI * 5;
    return (
      <svg
        viewBox="0 0 14 14"
        className="size-3.5 -rotate-90"
        role="img"
        aria-label={`Downloading ${Math.round(progress * 100)}%`}
      >
        <circle
          cx="7"
          cy="7"
          r="5"
          fill="none"
          strokeWidth="2"
          className="stroke-muted-foreground/25"
        />
        <circle
          cx="7"
          cy="7"
          r="5"
          fill="none"
          strokeWidth="2"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress)}
          className="stroke-muted-foreground transition-[stroke-dashoffset]"
        />
      </svg>
    );
  }
  return (
    <Download
      className="size-3.5"
      role="img"
      aria-label={
        availability.status === "failed"
          ? "Download failed; select to retry"
          : "Downloads when selected"
      }
    />
  );
}

export function AnimaSettingsModal() {
  const {
    effectivePreferences,
    userPreferences,
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

  const memoryEnabled = effectiveBehaviorEnabled(
    userPreferences,
    animaPreferences,
    "memory_influence",
  );

  const activeProvider = toTtsProvider(
    effectivePreferences.speech?.tts_provider,
  );
  const ttsEnabled = effectivePreferences.speech?.tts_enabled === true;
  const pocketProviderEnabled = ttsEnabled && activeProvider === "pocket_tts";

  const pocketVoiceGroups = useMemo(
    () => groupPocketVoices(pocketVoices),
    [pocketVoices],
  );
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
  const pocketVoiceDownloads = usePocketVoiceDownloads({
    enabled: pocketProviderEnabled,
  });

  useEffect(() => {
    if (!pocketProviderEnabled) return;
    void warmupPocket().catch(() => {
      // surfaced via runtime state + toasts elsewhere
    });
  }, [pocketProviderEnabled, warmupPocket]);

  const handleBehaviorChange = useCallback(
    (flag: BehaviorFlag, choice: BehaviorOverride) => {
      if (isBusy) return;
      void updateAnimaPreferences(behaviorPatch(flag, choice)).catch(() =>
        toast(
          flag === "emotion_updates"
            ? "Failed to update emotion settings."
            : "Failed to update memory settings.",
        ),
      );
    },
    [isBusy, updateAnimaPreferences],
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

      // A downloadable voice that isn't installed is saved and installed; replies
      // use the default voice until the download finishes.
      const download = pocketVoiceDownloads.availability(value);
      if (download && download.status !== "installed") {
        void persistAnimaPocketVoice(value)
          .then(() => {
            if (download.status !== "downloading") {
              pocketVoiceDownloads.install(download.assetId);
            }
          })
          .catch(() => {
            toast.error("Failed to update anima Pocket voice.");
          });
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
      pocketVoiceDownloads,
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
      return `Anima override is active: ${pocketVoiceLabel(animaOverrideVoice)}.`;
    }
    if (effectivePocketVoice) {
      return `Using application fallback voice: ${pocketVoiceLabel(effectivePocketVoice)}.`;
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
          <InheritableSettingRow
            label="Emotion updates"
            description="Update emotional state during chat. When off, new emotion reactions stop; gestures still play."
            tooltip="When off, the existing mood is preserved and gestures still play."
            value={animaBehaviorOverride(animaPreferences, "emotion_updates")}
            appEnabled={appBehaviorEnabled(userPreferences, "emotion_updates")}
            disabled={isBusy}
            onChange={(choice) =>
              handleBehaviorChange("emotion_updates", choice)
            }
          />
        </div>
      </div>

      <div>
        <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
          Memory
        </p>
        <div className="mt-3 grid gap-3">
          <InheritableSettingRow
            label="Memory"
            description="Read saved memories during chat. IDENTITY.md and conversation history remain active when off."
            tooltip="Turning this off also turns memory updates off; existing memories are not deleted."
            value={animaBehaviorOverride(animaPreferences, "memory_influence")}
            appEnabled={appBehaviorEnabled(userPreferences, "memory_influence")}
            disabled={isBusy}
            onChange={(choice) =>
              handleBehaviorChange("memory_influence", choice)
            }
          />
          <InheritableSettingRow
            label="Memory updates"
            description={
              memoryEnabled
                ? "Save new memories during chat. Turning this off does not stop chat history from being saved."
                : "Off while memory is off for this Anima."
            }
            tooltip="Memory updates require memory to be on."
            value={animaBehaviorOverride(animaPreferences, "memory_updates")}
            appEnabled={appBehaviorEnabled(userPreferences, "memory_updates")}
            disabled={!memoryEnabled || isBusy}
            onChange={(choice) =>
              handleBehaviorChange("memory_updates", choice)
            }
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
                  {pocketVoiceGroups.map((group) => (
                    <SelectGroup key={group.label}>
                      <SelectSeparator />
                      <SelectLabel>{group.label}</SelectLabel>
                      {group.voices.map((voice) => (
                        <SelectItem
                          key={voice.id}
                          value={voice.id}
                          hint={
                            <>
                              {[
                                voice.recommended ? "Recommended" : null,
                                voice.accent,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                              <PocketVoiceDownloadIcon
                                availability={pocketVoiceDownloads.availability(
                                  voice.id,
                                )}
                              />
                            </>
                          }
                        >
                          {voice.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                  <SelectSeparator />
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
