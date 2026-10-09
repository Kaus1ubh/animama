import { useProductApiClient } from "@animama/product-ui";
import type { PyVoiceContent } from "@animama/runtime-contracts/api-types";
import { useEffect, useState } from "react";

import { usePocketVoiceDownloads } from "@/hooks/use-pocket-voice-downloads";
import {
  DEFAULT_POCKET_VOICE,
  POCKET_VOICES,
} from "@/lib/speech/pocket/voice-catalog";
import { voiceCloneSampleSource } from "@/lib/speech/pocket/voice-clones";
import { resolvePocketVoicePreference } from "@/lib/speech/pocket/voice-preferences";
import { useVoiceClones } from "@/query/hooks/useVoiceClones";
import { PocketVoicePicker } from "@/ui/animas/PocketVoicePicker";
import { VoiceCloneLibrary } from "@/ui/animas/VoiceCloneLibrary";
import { elevenLabsVoiceId } from "@/ui/animas/VoiceLoadoutSection";
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
import type { CreateAnimaDraft, DraftEdit } from "./createAnimaDraft";

/** Shared library writes are explicit; provider/voice selection only edits this draft. */
export function CreateAnimaVoiceStep({
  draft,
  onChange,
  disabled,
  onBusyChange,
}: {
  draft: CreateAnimaDraft;
  onChange: (patch: DraftEdit) => void;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const apiClient = useProductApiClient();

  const { effectivePreferences, isLoading } = useSettings();
  const voice = draft.voice;
  const library = useVoiceClones({ enabled: voice?.provider === "pocket_tts" });
  const downloads = usePocketVoiceDownloads({
    enabled: voice?.provider === "pocket_tts",
  });
  const [cloning, setCloning] = useState(false);
  const [deleting, setDeleting] = useState<PyVoiceContent | null>(null);
  useEffect(() => {
    if (voice || isLoading || disabled) return;
    const speech = effectivePreferences.speech;
    const preset = resolvePocketVoicePreference(speech);
    onChange({
      voice: {
        provider:
          speech?.tts_provider === "elevenlabs" ? "elevenlabs" : "pocket_tts",
        pocket: {
          type: "preset",
          voice_id: POCKET_VOICES.some((item) => item.id === preset)
            ? preset!
            : DEFAULT_POCKET_VOICE,
        },
        elevenlabs_voice_id: elevenLabsVoiceId(speech) || null,
      },
    });
  }, [voice, isLoading, disabled, effectivePreferences.speech, onChange]);
  if (!voice) return <p role="status">Loading voice defaults…</p>;
  const clones = library.data ?? [];
  const selectedId =
    voice.pocket.type === "clone" ? voice.pocket.source.item_id : null;
  const selected = selectedId
    ? `clone:${selectedId}`
    : voice.pocket.type === "preset"
      ? voice.pocket.voice_id
      : DEFAULT_POCKET_VOICE;
  const select = async (id: string) => {
    if (disabled || cloning) throw new Error("Voice settings are busy.");
    if (id.startsWith("clone:")) {
      const clone = clones.find((item) => `clone:${item.item_id}` === id);
      if (!clone)
        throw new Error(
          "This saved voice is unavailable. Refresh the library.",
        );
      onChange({
        voice: {
          ...voice,
          pocket: {
            type: "clone",
            source: {
              item_id: clone.item_id,
              revision_sha256: clone.revision_sha256,
            },
          },
        },
        evidence: Object.fromEntries(
          Object.entries(draft.evidence).filter(([id]) => id !== clone.item_id),
        ),
      });
    } else {
      onChange({
        voice: { ...voice, pocket: { type: "preset", voice_id: id } },
      });
      const state = downloads.availability(id);
      if (state?.status === "not_installed" || state?.status === "failed")
        downloads.install(state.assetId);
    }
  };
  return (
    <section
      id="creation-voice"
      tabIndex={-1}
      className="space-y-6"
      aria-label="Voice configuration"
    >
      <div className="flex items-center justify-between gap-4">
        <label
          htmlFor="creation-tts-provider"
          className="text-sm font-semibold"
        >
          TTS Provider
        </label>
        <Select
          value={voice.provider}
          disabled={disabled}
          onValueChange={(provider) => {
            if (provider === "pocket_tts" || provider === "elevenlabs")
              onChange({ voice: { ...voice, provider } });
          }}
        >
          <SelectTrigger
            id="creation-tts-provider"
            aria-label="TTS Provider"
            className="w-48 min-w-0"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pocket_tts">PocketTTS</SelectItem>
            <SelectItem value="elevenlabs">ElevenLabs</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {voice.provider === "pocket_tts" ? (
        <div className="space-y-6">
          <div className="space-y-3">
            <h2 className="text-sm font-semibold">PocketTTS voice</h2>
            <PocketVoicePicker
              value={selected}
              disabled={disabled || library.isPending || library.isError}
              hasCustomVoice={false}
              clones={clones.map(voiceCloneSampleSource.bind(null, apiClient))}
              unavailableSelection={
                selectedId &&
                !clones.some((clone) => clone.item_id === selectedId)
                  ? "Saved voice unavailable"
                  : undefined
              }
              onDeleteClone={(id) =>
                setDeleting(
                  clones.find((clone) => `clone:${clone.item_id}` === id) ??
                    null,
                )
              }
              onSelect={select}
              availability={downloads.availability}
              onDownload={downloads.install}
              onRemove={downloads.remove}
              downloadBusy={downloads.busy}
              downloadBlockedReason={downloads.blockedReason}
              downloadError={downloads.error}
              retryAssetIds={downloads.retryAssetIds}
              operatorManaged={downloads.operatorManaged}
            />
            {selectedId &&
            !library.isPending &&
            !library.isError &&
            !clones.some((clone) => clone.item_id === selectedId) ? (
              <p role="alert" className="text-destructive text-sm">
                This saved voice is unavailable. Choose another voice.
              </p>
            ) : null}
            {library.isError ? (
              <div role="alert" className="space-y-2 text-sm">
                <p>Saved voices could not be loaded.</p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void library.refetch()}
                >
                  Retry saved voices
                </Button>
              </div>
            ) : null}
          </div>
          <VoiceCloneLibrary
            deleting={deleting}
            onDeleteClose={() => setDeleting(null)}
            disabled={(disabled && !cloning) || library.isError}
            onBusyChange={(busy) => {
              setCloning(busy);
              onBusyChange(busy);
            }}
          />
        </div>
      ) : (
        <div className="space-y-2">
          <label
            htmlFor="creation-elevenlabs-id"
            className="text-sm font-semibold"
          >
            ElevenLabs voice ID
          </label>
          <Input
            id="creation-elevenlabs-id"
            placeholder="Enter voice ID"
            autoComplete="off"
            spellCheck={false}
            value={voice.elevenlabs_voice_id ?? ""}
            disabled={disabled}
            onChange={(event) =>
              onChange({
                voice: {
                  ...voice,
                  elevenlabs_voice_id: event.target.value.trim() || null,
                },
              })
            }
          />
        </div>
      )}
    </section>
  );
}
