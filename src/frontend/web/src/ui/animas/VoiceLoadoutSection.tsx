import { useProductApiClient } from "@animama/product-ui";
import { useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import type { PyVoiceContent } from "@animama/runtime-contracts/api-types";

import { usePocketTtsRuntime } from "@/hooks/use-pocket-tts-runtime";
import { usePocketVoiceDownloads } from "@/hooks/use-pocket-voice-downloads";
import { DEFAULT_POCKET_VOICE } from "@/lib/speech/pocket/voice-catalog";
import { pocketVoiceLabel } from "@/lib/speech/pocket/voice-groups";
import {
  isPocketCustomVoice,
  resolvePocketVoicePreference,
} from "@/lib/speech/pocket/voice-preferences";
import { voiceCloneSampleSource } from "@/lib/speech/pocket/voice-clones";
import {
  geminiVoiceSampleSource,
  type GeminiVoice,
} from "@/lib/speech/gemini-voices";
import {
  DEFAULT_GEMINI_TTS_MODEL_ID,
  toGeminiTtsModelId,
} from "@/lib/settings/preferences";
import { useAnimaLoadout } from "@/query/hooks/useAnimaLoadout";
import { useRuntimeCapabilities } from "@/query/hooks/useRuntimeCapabilities";
import { useVoiceClones } from "@/query/hooks/useVoiceClones";
import { useVoiceSelection } from "@/query/mutations/useVoiceSelection";
import { VoiceCloneLibrary } from "@/ui/animas/VoiceCloneLibrary";
import { toTtsProvider } from "@/lib/speech/tts-provider";
import { LoadoutSectionDisclosure } from "@/ui/animas/LoadoutSectionDisclosure";
import { GeminiVoicePicker } from "@/ui/animas/GeminiVoicePicker";
import {
  PocketVoicePicker,
  pocketVoiceNotProvided,
} from "@/ui/animas/PocketVoicePicker";
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

/** The Anima's saved Gemini prebuilt voice, if any. */
export function geminiVoice(
  speech: { [key: string]: unknown } | undefined,
): string | null {
  const profile = speech?.gemini;
  if (!profile || typeof profile !== "object" || !("voice" in profile))
    return null;
  return typeof profile.voice === "string" ? profile.voice : null;
}

/** Persist choices independently of which provider is currently used for replies. */
export function AnimaVoicesEditor() {
  const apiClient = useProductApiClient();

  const {
    animaId,
    effectivePreferences,
    animaPreferences,
    updateAnimaPreferences,
    isLoading,
    isUpdating,
  } = useSettings();
  const runtime = usePocketTtsRuntime();
  const geminiTts = useRuntimeCapabilities().data?.gemini_tts ?? null;
  const downloads = usePocketVoiceDownloads({ enabled: true });
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [deletingClone, setDeletingClone] = useState<PyVoiceContent | null>(
    null,
  );
  const disabled = isLoading || isUpdating || saving || cloning || !animaId;
  const savedProvider = toTtsProvider(animaPreferences?.speech?.tts_provider);
  const configuredProvider = toTtsProvider(
    effectivePreferences.speech?.tts_provider,
  );
  const providerLabel =
    configuredProvider === "pocket_tts"
      ? "PocketTTS"
      : configuredProvider === "elevenlabs"
        ? "ElevenLabs"
        : configuredProvider === "gemini"
          ? "Gemini"
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
  // An unknown saved name is spoken with the default voice, so show that one.
  const savedGeminiVoice = geminiVoice(animaPreferences?.speech);
  const selectedGeminiVoice = geminiTts
    ? (geminiTts.voices.find((voice) => voice === savedGeminiVoice) ??
      geminiTts.default_voice)
    : null;
  // Samples use the model replies are spoken with.
  const geminiModelId =
    toGeminiTtsModelId(effectivePreferences.speech?.tts_gemini_model_id) ??
    DEFAULT_GEMINI_TTS_MODEL_ID;
  const loadout = useAnimaLoadout(animaId);
  const library = useVoiceClones({
    enabled: configuredProvider === "pocket_tts",
  });
  const selectVoice = useVoiceSelection(animaId ?? "");
  const clones = library.data ?? [];
  const selectedCloneId = loadout.data?.voice_source?.catalog_item_id ?? null;
  const selectedClone = clones.find(
    (clone) => clone.item_id === selectedCloneId,
  );
  const pocketDisabled =
    disabled ||
    !loadout.data ||
    loadout.isError ||
    library.isPending ||
    library.isError;
  const selectedVoice = selectedCloneId
    ? `clone:${selectedCloneId}`
    : pocketVoice;

  const saveGeminiVoice = async (voice: GeminiVoice) => {
    if (disabled || pending.current) throw new Error("Voice settings busy");
    pending.current = true;
    setSaving(true);
    try {
      await updateAnimaPreferences({ speech: { gemini: { voice } } });
      toast.success("Gemini voice saved.");
    } catch (error) {
      toast.error("Failed to save Gemini voice. Try again.");
      throw error;
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };

  const saveProvider = async (provider: string) => {
    if (
      provider !== "pocket_tts" &&
      provider !== "elevenlabs" &&
      !(provider === "gemini" && geminiTts)
    )
      return;
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
    if (
      pocketDisabled ||
      pending.current ||
      runtime.isEncodingVoice ||
      !loadout.data
    )
      throw new Error("Voice settings busy");
    pending.current = true;
    setSaving(true);
    try {
      if (voice.startsWith("clone:")) {
        const clone = clones.find((item) => `clone:${item.item_id}` === voice);
        if (!clone)
          throw new Error(
            "This saved voice is unavailable. Refresh the library.",
          );
        await selectVoice.mutateAsync({
          clone,
          expectedRevision: loadout.data.revision,
        });
      } else {
        // Save the fallback before removing the catalog: on failure the visible
        // clone binding still wins, so we never claim a preset is selected early.
        await updateAnimaPreferences({
          speech: {
            tts_pocket_anima_voice: voice,
            tts_pocket_anima_custom_voice_available: isPocketCustomVoice(voice),
          },
        });
        if (selectedCloneId) {
          await selectVoice.mutateAsync({
            clone: null,
            expectedRevision: loadout.data.revision,
          });
        }
        const state = downloads.availability(voice);
        if (state?.status === "not_installed" || state?.status === "failed")
          downloads.install(state.assetId);
      }
    } catch (error) {
      toast.error("Failed to select PocketTTS voice. Refresh and try again.");
      throw error;
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 px-3">
      <section className="space-y-2" aria-label="Voice provider">
        <div className="flex items-center justify-between gap-4">
          <label
            htmlFor="anima-tts-provider"
            className="shrink-0 text-sm font-semibold"
          >
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
              className="w-48 min-w-0"
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
              {geminiTts ? (
                <SelectItem value="gemini">Gemini</SelectItem>
              ) : null}
            </SelectContent>
          </Select>
        </div>
        {effectivePreferences.speech?.tts_enabled !== true ? (
          <p className="text-muted-foreground text-xs">
            Speech is off in application settings.
          </p>
        ) : null}
      </section>
      {configuredProvider === "pocket_tts" ? (
        <section className="space-y-3" aria-label="PocketTTS voice">
          <ProviderHeading
            name="PocketTTS"
            active={activeProvider === "pocket_tts"}
          />
          <PocketVoicePicker
            value={selectedVoice}
            disabled={pocketDisabled || runtime.isEncodingVoice}
            unavailableSelection={
              selectedCloneId && !selectedClone
                ? "Saved voice unavailable"
                : undefined
            }
            onDeleteClone={(id) =>
              setDeletingClone(
                clones.find((clone) => `clone:${clone.item_id}` === id) ?? null,
              )
            }
            clones={clones.map(voiceCloneSampleSource.bind(null, apiClient))}
            hasCustomVoice={runtime.hasCustomVoice}
            onSelect={savePocketVoice}
            availability={downloads.availability}
            onDownload={downloads.install}
            onRemove={downloads.remove}
            downloadBusy={downloads.busy}
            downloadBlockedReason={downloads.blockedReason}
            downloadError={downloads.error}
            retryAssetIds={downloads.retryAssetIds}
            operatorManaged={downloads.operatorManaged}
          />
          {!selectedCloneId &&
          pocketVoiceNotProvided(download, downloads.operatorManaged) ? (
            // Speech falls back to the default voice; nothing installs it here.
            <p role="status" className="text-muted-foreground text-xs">
              {pocketVoiceLabel(pocketVoice)} is not available here, so replies
              use the default voice.
            </p>
          ) : !selectedCloneId && download?.status === "downloading" ? (
            <p role="status" className="text-muted-foreground text-xs">
              Downloading {pocketVoiceLabel(pocketVoice)}…{" "}
              {Math.round((download.progress ?? 0) * 100)}%
            </p>
          ) : !selectedCloneId && download?.status === "failed" ? (
            <p role="alert" className="text-destructive text-xs">
              {pocketVoiceLabel(pocketVoice)} could not be downloaded. Open the
              voice list to retry.
            </p>
          ) : null}
          {library.isError || loadout.isError ? (
            <div role="alert" className="space-y-2 text-xs">
              <p className="text-destructive">
                Saved voices could not be loaded.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  void library.refetch();
                  void loadout.refetch();
                }}
              >
                Retry
              </Button>
            </div>
          ) : null}
          {selectedCloneId &&
          !selectedClone &&
          !library.isPending &&
          !library.isError ? (
            <p role="alert" className="text-destructive text-xs">
              This saved voice is unavailable. Choose another voice.
            </p>
          ) : null}
          <VoiceCloneLibrary
            deleting={deletingClone}
            onDeleteClose={() => setDeletingClone(null)}
            disabled={
              isLoading || isUpdating || saving || !animaId || library.isError
            }
            onBusyChange={setCloning}
          />
        </section>
      ) : null}
      {configuredProvider === "elevenlabs" ? (
        <section className="space-y-3" aria-label="ElevenLabs voice">
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
      ) : null}
      {configuredProvider === "gemini" && geminiTts ? (
        <section className="space-y-3" aria-label="Gemini voice">
          <ProviderHeading name="Gemini" active={activeProvider === "gemini"} />
          <GeminiVoicePicker
            value={selectedGeminiVoice ?? geminiTts.default_voice}
            voices={geminiTts.voices}
            modelId={geminiModelId}
            disabled={disabled}
            sampleSource={(voice) =>
              geminiVoiceSampleSource(apiClient, geminiModelId, voice)
            }
            onSelect={saveGeminiVoice}
          />
        </section>
      ) : null}
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
