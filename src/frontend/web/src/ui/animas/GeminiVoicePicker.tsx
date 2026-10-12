import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import {
  filteredGeminiVoices,
  GEMINI_VOICE_DETAILS,
  type GeminiVoice,
  type GeminiVoiceFilter,
} from "@/lib/speech/gemini-voices";
import {
  createVoiceSamplePlayer,
  IDLE_VOICE_SAMPLE,
  type VoiceSampleSource,
} from "@/lib/speech/pocket/voice-sample-player";
import type { GeminiTtsModelId } from "@/lib/settings/preferences";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/components/button";
import { Input } from "@/ui/components/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/ui/components/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/components/tabs";
import {
  VoiceSampleButton,
  type VoiceSamplePlayback,
} from "./VoiceSampleButton";

export const GEMINI_SAMPLE_NOTE =
  "The first play of each voice uses your Gemini API key; the sample is then kept.";

type GeminiVoicePickerProps = {
  /** The voice replies are spoken in: the saved voice, or the default. */
  value: GeminiVoice;
  voices: readonly GeminiVoice[];
  /** Samples are spoken with the model replies use. */
  modelId: GeminiTtsModelId;
  disabled: boolean;
  sampleSource: (voice: GeminiVoice) => VoiceSampleSource;
  /** Rejects when the choice is not saved, so the list stays open to retry. */
  onSelect: (voice: GeminiVoice) => Promise<void>;
};

/** Gemini's prebuilt voices in the PocketTTS picker's layout, with a sample on every voice. */
export function GeminiVoicePicker(props: GeminiVoicePickerProps) {
  const [open, setOpen] = useState(false);
  const [sample, setSample] = useState(IDLE_VOICE_SAMPLE);
  const player = useMemo(() => createVoiceSamplePlayer(setSample), []);
  useEffect(() => () => player.dispose(), [player]);
  useEffect(() => player.stop(), [player, props.value, props.modelId]);
  const changeOpen = (next: boolean) => {
    player.stop();
    setOpen(next);
  };
  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <div className="flex items-center gap-2">
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            disabled={props.disabled}
            className="min-w-0 flex-1 justify-between"
            aria-label={`Gemini voice: ${props.value}`}
          >
            <span className="truncate">{props.value}</span>
            <ChevronDown className="size-4 shrink-0 opacity-60" />
          </Button>
        </PopoverTrigger>
        <VoiceSampleButton
          voice={props.sampleSource(props.value)}
          sample={sample}
          player={player}
        />
      </div>
      {!open && sample.error ? (
        <p role="alert" className="text-destructive text-xs">
          {sample.error}
        </p>
      ) : null}
      <PopoverContent
        align="start"
        className="flex max-h-[var(--radix-popover-content-available-height)] w-[min(30rem,var(--radix-popover-content-available-width))] flex-col p-0"
        aria-label="Gemini voices"
      >
        {open ? (
          <GeminiVoiceList
            {...props}
            sample={sample}
            player={player}
            onSelected={() => changeOpen(false)}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/** The voice list: search and gender tabs, then a select and a sample button per voice. */
export function GeminiVoiceList({
  value,
  voices,
  disabled,
  sampleSource,
  onSelect,
  onSelected,
  sample,
  player,
}: GeminiVoicePickerProps & VoiceSamplePlayback & { onSelected: () => void }) {
  const [gender, setGender] = useState<GeminiVoiceFilter["gender"]>("any");
  const [search, setSearch] = useState("");
  const shown = filteredGeminiVoices(voices, { gender, search });
  const choose = async (voice: GeminiVoice) => {
    try {
      await onSelect(voice);
      onSelected();
    } catch {
      // The owner reports persistence errors; keep the picker available to retry.
    }
  };
  return (
    <Tabs
      value={gender}
      onValueChange={(next) => {
        player.stop();
        setGender(next as GeminiVoiceFilter["gender"]);
      }}
      className="flex min-h-0 flex-col"
    >
      <div className="flex shrink-0 flex-col gap-3 border-b p-3">
        <Input
          aria-label="Search Gemini voices"
          placeholder="Search voices"
          value={search}
          onChange={(event) => {
            player.stop();
            setSearch(event.target.value);
          }}
        />
        <TabsList className="grid w-full grid-cols-3" aria-label="Voice gender">
          <TabsTrigger value="any">All</TabsTrigger>
          <TabsTrigger value="female">Female</TabsTrigger>
          <TabsTrigger value="male">Male</TabsTrigger>
        </TabsList>
      </div>
      <div
        className="text-muted-foreground flex shrink-0 items-center justify-between px-4 py-2 text-xs"
        aria-live="polite"
      >
        <span>
          {gender === "any"
            ? "All voices"
            : gender === "female"
              ? "Female voices"
              : "Male voices"}
        </span>
        <span>
          {shown.length} {shown.length === 1 ? "voice" : "voices"}
        </span>
      </div>
      <TabsContent value={gender} className="mt-0 min-h-0 overflow-y-auto">
        <div
          className="max-h-[min(22rem,45dvh)] min-h-0 overflow-y-auto overscroll-contain px-2 pb-2"
          role="list"
          aria-label="Available Gemini voices"
        >
          {shown.map((voice) => (
            <div
              key={voice}
              role="listitem"
              className={cn(
                "flex items-center gap-1 rounded-lg px-1",
                value === voice && "bg-muted/60",
              )}
            >
              <button
                type="button"
                disabled={disabled}
                onClick={() => void choose(voice)}
                aria-label={`Select ${voice}`}
                aria-pressed={value === voice}
                className="hover:bg-muted/40 focus-visible:ring-ring flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2.5 text-left outline-none focus-visible:ring-2 disabled:opacity-50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{voice}</p>
                  {GEMINI_VOICE_DETAILS[voice]?.description ? (
                    <p className="text-muted-foreground text-xs">
                      {GEMINI_VOICE_DETAILS[voice]?.description}
                    </p>
                  ) : null}
                </div>
                {value === voice ? <Check className="size-4 shrink-0" /> : null}
              </button>
              <VoiceSampleButton
                voice={sampleSource(voice)}
                sample={sample}
                player={player}
                compact
              />
            </div>
          ))}
          {!shown.length ? (
            <p className="text-muted-foreground px-3 py-5 text-sm">
              No voices match these filters.
            </p>
          ) : null}
        </div>
      </TabsContent>
      <p
        role="status"
        className="text-muted-foreground shrink-0 border-t px-4 py-3 text-xs"
      >
        {GEMINI_SAMPLE_NOTE}
      </p>
      {sample.error ? (
        <p
          role="alert"
          className="text-destructive shrink-0 border-t px-4 py-3 text-xs"
        >
          {sample.error}
        </p>
      ) : null}
    </Tabs>
  );
}
