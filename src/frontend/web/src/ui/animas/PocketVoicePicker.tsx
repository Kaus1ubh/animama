import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  Download,
  ListFilter,
  LoaderCircle,
  Play,
  Square,
} from "lucide-react";

import {
  POCKET_VOICES,
  type PocketVoiceGender,
} from "@/lib/speech/pocket/voice-catalog";
import { pocketVoiceLabel } from "@/lib/speech/pocket/voice-groups";
import type { PocketVoiceAvailability } from "@/lib/speech/pocket/voice-preferences";
import {
  createVoiceSamplePlayer,
  IDLE_VOICE_SAMPLE,
} from "@/lib/speech/pocket/voice-sample-player";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/components/button";
import { Input } from "@/ui/components/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/ui/components/popover";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/components/dropdown-menu";

type VoiceFilter = {
  gender: "any" | PocketVoiceGender;
  recommended: boolean;
  search: string;
};

/** The list is metadata-only: browsing never initializes the speech engine. */
export function filteredPocketVoices({
  gender,
  recommended,
  search,
}: VoiceFilter) {
  const query = search.trim().toLocaleLowerCase();
  return POCKET_VOICES.filter(
    (voice) =>
      (gender === "any" || voice.gender === gender) &&
      (!recommended || voice.recommended) &&
      `${voice.name} ${voice.accent ?? ""}`.toLocaleLowerCase().includes(query),
  );
}

type PocketVoicePickerProps = {
  value: string;
  disabled: boolean;
  hasCustomVoice: boolean;
  onSelect: (id: string) => Promise<void>;
  availability: (id: string) => PocketVoiceAvailability | null;
  onDownload: (assetId: string) => void;
};

/** A compact selected voice opens a keyboard-accessible list with independent actions. */
export function PocketVoicePicker(props: PocketVoicePickerProps) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={props.disabled}
          className="w-full justify-between"
          aria-label={`PocketTTS voice: ${pocketVoiceLabel(props.value)}`}
        >
          <span className="truncate">{pocketVoiceLabel(props.value)}</span>
          <ChevronDown className="size-4 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="flex max-h-[var(--radix-popover-content-available-height)] w-[min(30rem,var(--radix-popover-content-available-width))] flex-col p-0"
        aria-label="PocketTTS voices"
      >
        {open ? (
          <PocketVoiceList {...props} onSelected={() => setOpen(false)} />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/** Unmounting the list also releases its preview audio and pending network request. */
export function PocketVoiceList({
  value,
  disabled,
  hasCustomVoice,
  onSelect,
  availability,
  onDownload,
  onSelected,
}: PocketVoicePickerProps & { onSelected: () => void }) {
  const [gender, setGender] = useState<VoiceFilter["gender"]>("any");
  const [recommended, setRecommended] = useState(false);
  const [search, setSearch] = useState("");
  const [sample, setSample] = useState(IDLE_VOICE_SAMPLE);
  const player = useMemo(() => createVoiceSamplePlayer(setSample), []);
  useEffect(() => () => player.dispose(), [player]);
  const voices = filteredPocketVoices({ gender, recommended, search });
  const choose = async (id: string) => {
    try {
      await onSelect(id);
      onSelected();
    } catch {
      // The owner reports persistence errors; keep the picker available to retry.
    }
  };
  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b p-3">
        <Input
          aria-label="Search PocketTTS voices"
          placeholder="Search voices"
          value={search}
          onChange={(event) => {
            player.stop();
            setSearch(event.target.value);
          }}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant={
                gender !== "any" || recommended ? "secondary" : "outline"
              }
              size="icon-sm"
              aria-label="Filter voices"
            >
              <ListFilter />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Voice</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={gender}
              onValueChange={(next) => {
                player.stop();
                setGender(next as VoiceFilter["gender"]);
              }}
            >
              <DropdownMenuRadioItem value="any">Any</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="female">
                Female
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="male">Male</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={recommended}
              onCheckedChange={(checked) => {
                player.stop();
                setRecommended(checked === true);
              }}
            >
              Recommended only
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
          {recommended ? " · Recommended" : ""}
        </span>
        <span>
          {voices.length} {voices.length === 1 ? "voice" : "voices"}
        </span>
      </div>
      <div
        className="max-h-[min(22rem,45dvh)] min-h-0 overflow-y-auto overscroll-contain px-2 pb-2"
        role="list"
        aria-label="Available PocketTTS voices"
      >
        {voices.map((voice) => {
          const download = availability(voice.id);
          const downloading = download?.status === "downloading";
          const needsDownload = download && download.status !== "installed";
          const active =
            sample.voiceId === voice.id &&
            (sample.status === "playing" || sample.status === "loading");
          return (
            <div
              key={voice.id}
              role="listitem"
              className={cn(
                "flex items-center gap-1 rounded-lg px-1",
                value === voice.id && "bg-muted/60",
              )}
            >
              <button
                type="button"
                disabled={disabled}
                onClick={() => void choose(voice.id)}
                aria-label={`Select ${voice.name}`}
                aria-pressed={value === voice.id}
                className="hover:bg-muted/40 focus-visible:ring-ring flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2.5 text-left outline-none focus-visible:ring-2 disabled:opacity-50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{voice.name}</p>
                  <p className="text-muted-foreground text-xs">
                    {[voice.accent, voice.recommended ? "Recommended" : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                {value === voice.id ? (
                  <Check className="size-4 shrink-0" />
                ) : null}
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`${active ? "Stop" : "Play"} ${voice.name} sample`}
                title={`${active ? "Stop" : "Play"} ${voice.name} sample`}
                onClick={() => void player.play(voice)}
              >
                {active ? (
                  sample.status === "loading" ? (
                    <LoaderCircle className="animate-spin motion-reduce:animate-none" />
                  ) : (
                    <Square />
                  )
                ) : (
                  <Play />
                )}
              </Button>
              <div className="flex w-8 shrink-0 justify-center">
                {needsDownload ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={
                      disabled || downloading || download.status === "unknown"
                    }
                    aria-label={
                      downloading
                        ? `Downloading ${voice.name} ${Math.round((download.progress ?? 0) * 100)}%`
                        : download.status === "failed"
                          ? `Retry download ${voice.name}`
                          : `Download ${voice.name}`
                    }
                    title={
                      downloading
                        ? `Downloading ${Math.round((download.progress ?? 0) * 100)}%`
                        : `Download ${voice.name}`
                    }
                    onClick={() => onDownload(download.assetId)}
                  >
                    {downloading || download.status === "unknown" ? (
                      <LoaderCircle className="animate-spin motion-reduce:animate-none" />
                    ) : (
                      <Download
                        className={
                          download.status === "failed"
                            ? "text-destructive"
                            : undefined
                        }
                      />
                    )}
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
        {!voices.length ? (
          <p className="text-muted-foreground px-3 py-5 text-sm">
            No voices match these filters.
          </p>
        ) : null}
        {hasCustomVoice ? (
          <Button
            variant="ghost"
            className="w-full justify-start"
            disabled={disabled}
            onClick={() => void choose("custom")}
          >
            Custom (uploaded){value === "custom" ? <Check /> : null}
          </Button>
        ) : null}
      </div>
      <div className="text-muted-foreground shrink-0 space-y-1 border-t px-4 py-3 text-xs">
        {sample.error ? (
          <p role="alert" className="text-destructive">
            {sample.error}
          </p>
        ) : null}
        <p>
          Samples are source recordings and require internet. PocketTTS speech
          may sound different.{" "}
          <a
            className="underline"
            href="https://huggingface.co/kyutai/tts-voices/blob/323332d33f997de8394f24a193e1a76df720e01a/README.md"
            target="_blank"
            rel="noreferrer"
          >
            Sample sources
          </a>
        </p>
      </div>
    </div>
  );
}
