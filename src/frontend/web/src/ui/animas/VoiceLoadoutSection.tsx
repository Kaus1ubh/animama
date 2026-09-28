import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { toast } from "sonner";

import { usePocketTtsRuntime } from "@/hooks/use-pocket-tts-runtime";
import { usePocketVoiceDownloads } from "@/hooks/use-pocket-voice-downloads";
import { DEFAULT_POCKET_VOICE } from "@/lib/speech/pocket/voice-catalog";
import { pocketVoiceLabel } from "@/lib/speech/pocket/voice-groups";
import {
  isPocketCustomVoice,
  resolvePocketVoicePreference,
} from "@/lib/speech/pocket/voice-preferences";
import { toTtsProvider } from "@/lib/speech/tts-provider";
import { LoadoutSectionDisclosure } from "@/ui/animas/LoadoutSectionDisclosure";
import { PocketVoicePicker } from "@/ui/animas/PocketVoicePicker";
import { Button } from "@/ui/components/button";
import { Input } from "@/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/select";
import { useSettings } from "@/ui/settings/SettingsProvider";

/** Voice authoring belongs with the rest of an Anima's Loadout. */
export function VoiceLoadoutSection() {
  const [expanded, setExpanded] = useState(false);
  return (
    <LoadoutSectionDisclosure
      title="Voices"
      headingId="voice-loadout-heading"
      contentId="voice-loadout-content"
      expanded={expanded}
      onToggle={() => setExpanded((current) => !current)}
    >
      <AnimaVoicesEditor />
    </LoadoutSectionDisclosure>
  );
}

/** Read the existing flexible settings contract without discarding other voice fields. */
export function elevenLabsVoiceId(
  speech: { [key: string]: unknown } | undefined,
): string {
  const profile = speech?.elevenlabs;
  if (!profile || typeof profile !== "object" || !("primary_voice" in profile))
    return "";
  const voice = profile.primary_voice;
  return voice &&
    typeof voice === "object" &&
    "voice_id" in voice &&
    typeof voice.voice_id === "string"
    ? voice.voice_id
    : "";
}

/** Persist choices independently of which provider is currently used for replies. */
export function AnimaVoicesEditor() {
  const {
    animaId,
    effectivePreferences,
    animaPreferences,
    updateAnimaPreferences,
    isLoading,
    isUpdating,
  } = useSettings();
  const runtime = usePocketTtsRuntime();
  const downloads = usePocketVoiceDownloads({ enabled: true });
  const fileInput = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);
  const disabled = isLoading || isUpdating || saving || !animaId;
  const savedProvider = toTtsProvider(animaPreferences?.speech?.tts_provider);
  const configuredProvider = toTtsProvider(
    effectivePreferences.speech?.tts_provider,
  );
  const providerLabel =
    configuredProvider === "pocket_tts"
      ? "PocketTTS"
      : configuredProvider === "elevenlabs"
        ? "ElevenLabs"
        : configuredProvider === "browser"
          ? "Browser"
          : null;
  const activeProvider = effectivePreferences.speech?.tts_enabled
    ? configuredProvider
    : null;
  // Legacy Animas retain the voice they already resolve, without a default row.
  const pocketVoice =
    resolvePocketVoicePreference(effectivePreferences.speech) ??
    DEFAULT_POCKET_VOICE;
  const download = downloads.availability(pocketVoice);
  const savedElevenLabs = elevenLabsVoiceId(animaPreferences?.speech);

  const saveProvider = async (provider: string) => {
    if (provider !== "pocket_tts" && provider !== "elevenlabs") return;
    if (disabled || pending.current) return;
    pending.current = true;
    setSaving(true);
    try {
      // Loadout is outside the chat route; the next chat mount reads this override.
      // Never copy the app's enable flag or the other provider's voice settings.
      await updateAnimaPreferences({ speech: { tts_provider: provider } });
      toast.success("TTS provider saved.");
    } catch {
      toast.error("Failed to save TTS provider. Try again.");
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };

  const savePocketVoice = async (voice: string) => {
    if (disabled || pending.current || runtime.isEncodingVoice)
      throw new Error("Voice settings busy");
    pending.current = true;
    setSaving(true);
    try {
      await updateAnimaPreferences({
        speech: {
          tts_pocket_anima_voice: voice,
          tts_pocket_anima_custom_voice_available: isPocketCustomVoice(voice),
        },
      });
      const state = downloads.availability(voice);
      if (state?.status === "not_installed" || state?.status === "failed")
        downloads.install(state.assetId);
    } catch (error) {
      toast.error("Failed to save PocketTTS voice. Try again.");
      throw error;
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };

  const uploadVoice = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || disabled || pending.current || runtime.isEncodingVoice) return;
    pending.current = true;
    setSaving(true);
    try {
      const encoded = await runtime.encodeVoiceFromFile(file);
      await updateAnimaPreferences({
        speech: {
          tts_pocket_anima_voice: encoded.voiceName,
          tts_pocket_anima_custom_voice_available: true,
        },
      });
      toast.success("Custom Pocket voice ready for this session.");
    } catch {
      toast.error("Failed to prepare custom voice. Try again.");
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="divide-y rounded-xl border">
      <section className="space-y-3 p-4" aria-label="Voice provider">
        <label htmlFor="anima-tts-provider" className="text-sm font-semibold">
          TTS Provider
        </label>
        <Select
          // An inherited value stays unselected so choosing that same provider
          // still pins it to this Anima. Legacy Browser remains visible only.
          value={savedProvider === "browser" ? "" : (savedProvider ?? "")}
          onValueChange={(provider) => void saveProvider(provider)}
          disabled={disabled}
        >
          <SelectTrigger
            id="anima-tts-provider"
            aria-label="TTS Provider"
            className="w-full"
          >
            <SelectValue
              placeholder={
                providerLabel
                  ? `${providerLabel}${savedProvider ? "" : " (app)"}`
                  : "Choose provider"
              }
            >
              {savedProvider ? providerLabel : undefined}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pocket_tts">PocketTTS</SelectItem>
            <SelectItem value="elevenlabs">ElevenLabs</SelectItem>
          </SelectContent>
        </Select>
        {effectivePreferences.speech?.tts_enabled !== true ? (
          <p className="text-muted-foreground text-xs">
            Speech is off in application settings.
          </p>
        ) : null}
      </section>
      <section className="space-y-3 p-4" aria-label="PocketTTS voice">
        <ProviderHeading
          name="PocketTTS"
          active={activeProvider === "pocket_tts"}
        />
        <PocketVoicePicker
          value={pocketVoice}
          disabled={disabled || runtime.isEncodingVoice}
          hasCustomVoice={runtime.hasCustomVoice}
          onSelect={savePocketVoice}
          availability={downloads.availability}
          onDownload={downloads.install}
        />
        {download?.status === "downloading" ? (
          <p role="status" className="text-muted-foreground text-xs">
            Downloading {pocketVoiceLabel(pocketVoice)}…{" "}
            {Math.round((download.progress ?? 0) * 100)}%
          </p>
        ) : download?.status === "failed" ? (
          <p role="alert" className="text-destructive text-xs">
            {pocketVoiceLabel(pocketVoice)} could not be downloaded. Open the
            voice list to retry.
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={disabled || runtime.isEncodingVoice}
            onClick={() => fileInput.current?.click()}
          >
            {runtime.isEncodingVoice ? "Encoding…" : "Upload voice sample"}
          </Button>
          <span className="text-muted-foreground text-xs">
            Custom voice for this session
          </span>
          <input
            ref={fileInput}
            type="file"
            accept="audio/*"
            className="hidden"
            aria-label="Upload custom voice sample"
            onChange={(event) => void uploadVoice(event)}
          />
        </div>
        {runtime.voiceUploadStatus ? (
          <p role="status" className="text-muted-foreground text-xs">
            {runtime.voiceUploadStatus}
          </p>
        ) : null}
        {isPocketCustomVoice(pocketVoice) && !runtime.hasCustomVoice ? (
          <p className="text-muted-foreground text-xs">
            Upload the sample again to use this custom voice in this session.
          </p>
        ) : null}
      </section>
      <section className="space-y-3 p-4" aria-label="ElevenLabs voice">
        <ProviderHeading
          name="ElevenLabs"
          active={activeProvider === "elevenlabs"}
        />
        <ElevenLabsVoiceForm
          key={`${animaId}:${savedElevenLabs}`}
          savedVoiceId={savedElevenLabs}
          disabled={disabled}
          onSave={async (voiceId) => {
            if (disabled || pending.current) return;
            pending.current = true;
            setSaving(true);
            try {
              await updateAnimaPreferences({
                speech: {
                  elevenlabs: { primary_voice: { voice_id: voiceId } },
                },
              });
              toast.success("ElevenLabs voice saved.");
            } finally {
              pending.current = false;
              setSaving(false);
            }
          }}
        />
      </section>
    </div>
  );
}

function ProviderHeading({ name, active }: { name: string; active: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-sm font-semibold">{name}</h3>
      {active ? (
        <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">
          Active provider
        </span>
      ) : null}
    </div>
  );
}

/** A keyed draft follows persisted changes while ordinary rerenders preserve typing. */
function ElevenLabsVoiceForm({
  savedVoiceId,
  disabled,
  onSave,
}: {
  savedVoiceId: string;
  disabled: boolean;
  onSave: (id: string) => Promise<void>;
}) {
  const [value, setValue] = useState(savedVoiceId);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (disabled) return;
    const id = value.trim();
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
      setError(
        "Enter a voice ID using letters, numbers, underscores or hyphens.",
      );
      return;
    }
    setError(null);
    try {
      await onSave(id);
    } catch {
      setError("Voice ID could not be saved. Try again.");
    }
  };
  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-2">
      <label
        htmlFor="anima-elevenlabs-voice"
        className="text-muted-foreground text-xs"
      >
        Voice ID
      </label>
      <div className="flex items-center gap-2">
        <Input
          id="anima-elevenlabs-voice"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          disabled={disabled}
          placeholder="Enter voice ID"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "anima-elevenlabs-error" : undefined}
        />
        <Button
          type="submit"
          variant="outline"
          disabled={disabled || value.trim() === savedVoiceId}
        >
          Save
        </Button>
      </div>
      {error ? (
        <p
          id="anima-elevenlabs-error"
          role="alert"
          className="text-destructive text-xs"
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}
