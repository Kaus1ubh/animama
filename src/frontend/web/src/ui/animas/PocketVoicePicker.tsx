import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  Download,
  ListFilter,
  LoaderCircle,
  Play,
  Square,
  Trash2,
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
  type VoiceSampleState,
  type VoiceSampleSource,
} from "@/lib/speech/pocket/voice-sample-player";
import { cn } from "@/lib/utils";
import { formatFileSize } from "@/lib/user-files/uploads";
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
  disabled: boolean;
  availability: (id: string) => PocketVoiceAvailability | null;
  onDownload: (assetId: string) => void;
  onRemove?: (assetId: string) => void;
  downloadBusy?: boolean;
  downloadBlockedReason?: string | null;
  downloadError?: string | null;
  retryAssetIds?: ReadonlySet<string>;
} & (
  | {
      downloadOnly?: false;
      value: string;
      hasCustomVoice: boolean;
      clones?: VoiceSampleSource[];
      unavailableSelection?: string;
      onSelect: (id: string) => Promise<void>;
      onDeleteClone?: (id: string) => void;
    }
  | {
      downloadOnly: true;
      value?: never;
      hasCustomVoice?: never;
      clones?: never;
      unavailableSelection?: never;
      onSelect?: never;
      onDeleteClone?: never;
    }
);

type VoiceSamplePlayback = {
  sample: VoiceSampleState;
  player: ReturnType<typeof createVoiceSamplePlayer>;
};

/** A compact selected voice opens a keyboard-accessible list with independent actions. */
export function PocketVoicePicker(props: PocketVoicePickerProps) {
  const [open, setOpen] = useState(false);
  const [sample, setSample] = useState(IDLE_VOICE_SAMPLE);
  const player = useMemo(() => createVoiceSamplePlayer(setSample), []);
  useEffect(() => () => player.dispose(), [player]);
  useEffect(() => player.stop(), [player, props.value]);
  const voice =
    props.clones?.find((item) => item.id === props.value) ??
    POCKET_VOICES.find((item) => item.id === props.value);
  const selectedName =
    voice?.name ??
    props.unavailableSelection ??
    pocketVoiceLabel(props.value ?? "");
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
            aria-label={
              props.downloadOnly
                ? "Browse PocketTTS voices"
                : `PocketTTS voice: ${selectedName}`
            }
          >
            <span className="truncate">
              {props.downloadOnly ? "Browse voices" : selectedName}
            </span>
            <ChevronDown className="size-4 shrink-0 opacity-60" />
          </Button>
        </PopoverTrigger>
        {!props.downloadOnly ? (
          <VoiceSampleButton voice={voice} sample={sample} player={player} />
        ) : null}
        {voice &&
        props.clones?.some((clone) => clone.id === voice.id) &&
        props.onDeleteClone ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-destructive hover:text-destructive"
            aria-label={`Delete ${voice.name}`}
            disabled={props.disabled}
            onClick={() => {
              player.stop();
              props.onDeleteClone?.(voice.id);
            }}
          >
            <Trash2 className="size-4" />
          </Button>
        ) : null}
      </div>
      {!open && voice && "sampleUnavailable" in voice ? (
        <p className="text-muted-foreground text-xs">
          {voice.sampleUnavailable}
        </p>
      ) : null}
      {!open && sample.error ? (
        <p role="alert" className="text-destructive text-xs">
          {sample.error}
        </p>
      ) : null}
      <PopoverContent
        align="start"
        className="flex max-h-[var(--radix-popover-content-available-height)] w-[min(30rem,var(--radix-popover-content-available-width))] flex-col p-0"
        aria-label="PocketTTS voices"
      >
        {open ? (
          <PocketVoiceList
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

/** The selected voice and list share one player, owned by the picker. */
export function PocketVoiceList({
  value,
  downloadOnly,
  disabled,
  hasCustomVoice,
  clones = [],
  onSelect,
  availability,
  onDownload,
  onRemove,
  downloadBusy,
  downloadBlockedReason,
  downloadError,
  retryAssetIds,
  onDeleteClone,
  onSelected,
  sample,
  player,
}: PocketVoicePickerProps & VoiceSamplePlayback & { onSelected: () => void }) {
  const [gender, setGender] = useState<VoiceFilter["gender"]>("any");
  const [recommended, setRecommended] = useState(false);
  const [search, setSearch] = useState("");
  const voices = filteredPocketVoices({ gender, recommended, search });
  const matchingClones =
    gender === "any" && !recommended
      ? clones.filter((clone) =>
          clone.name
            .toLocaleLowerCase()
            .includes(search.trim().toLocaleLowerCase()),
        )
      : [];
  const count = voices.length + matchingClones.length;
  const choose = async (id: string) => {
    if (!onSelect) return;
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
          {count} {count === 1 ? "voice" : "voices"}
        </span>
      </div>
      <div
        className="max-h-[min(22rem,45dvh)] min-h-0 overflow-y-auto overscroll-contain px-2 pb-2"
        role="list"
        aria-label="Available PocketTTS voices"
      >
        {matchingClones.length ? (
          <p className="text-muted-foreground px-3 py-2 text-xs font-semibold">
            Your voice clones
          </p>
        ) : null}
        {matchingClones.map((clone) => (
          <div
            key={clone.id}
            role="listitem"
            className={cn(
              "flex items-center gap-1 rounded-lg px-1",
              value === clone.id && "bg-muted/60",
            )}
          >
            <button
              type="button"
              disabled={disabled}
              onClick={() => void choose(clone.id)}
              aria-label={`Select ${clone.name}`}
              aria-pressed={value === clone.id}
              className="hover:bg-muted/40 focus-visible:ring-ring flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2.5 text-left outline-none focus-visible:ring-2 disabled:opacity-50"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {clone.name}
                </span>
                {"sampleUnavailable" in clone ? (
                  <span className="text-muted-foreground block text-xs">
                    {clone.sampleUnavailable}
                  </span>
                ) : null}
              </span>
              {value === clone.id ? (
                <Check className="size-4 shrink-0" />
              ) : null}
            </button>
            <VoiceSampleButton
              voice={clone}
              sample={sample}
              player={player}
              compact
            />
            {onDeleteClone ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-destructive hover:text-destructive shrink-0"
                aria-label={`Delete ${clone.name}`}
                disabled={disabled}
                onClick={() => {
                  player.stop();
                  onSelected();
                  onDeleteClone(clone.id);
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            ) : (
              <div className="w-8 shrink-0" />
            )}
          </div>
        ))}
        {matchingClones.length && voices.length ? (
          <p className="text-muted-foreground px-3 py-2 text-xs font-semibold">
            PocketTTS voices
          </p>
        ) : null}
        {voices.map((voice) => {
          const download = availability(voice.id);
          const label = (
            <>
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
            </>
          );
          return (
            <div
              key={voice.id}
              role="listitem"
              className={cn(
                "rounded-lg px-1 py-1",
                value === voice.id && "bg-muted/60",
              )}
            >
              <div className="flex items-center gap-1">
                {downloadOnly ? (
                  <div className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2.5">
                    {label}
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => void choose(voice.id)}
                    aria-label={`Select ${voice.name}`}
                    aria-pressed={value === voice.id}
                    className="hover:bg-muted/40 focus-visible:ring-ring flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2.5 text-left outline-none focus-visible:ring-2 disabled:opacity-50"
                  >
                    {label}
                  </button>
                )}
                <VoiceSampleButton
                  voice={voice}
                  sample={sample}
                  player={player}
                  compact
                />
                {!download ? (
                  <span className="text-muted-foreground px-2 text-xs">
                    Included
                  </span>
                ) : null}
              </div>
              {download ? (
                <PocketVoiceDownload
                  name={voice.name}
                  sizeBytes={voice.sizeBytes}
                  state={download}
                  busy={Boolean(
                    disabled || downloadBusy || downloadBlockedReason,
                  )}
                  retry={retryAssetIds?.has(download.assetId) ?? false}
                  onDownload={onDownload}
                  onRemove={onRemove}
                />
              ) : null}
            </div>
          );
        })}
        {!count ? (
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
      {downloadBlockedReason || downloadError ? (
        <p
          role="status"
          className="text-muted-foreground shrink-0 border-t px-4 py-3 text-xs"
        >
          {downloadBlockedReason || downloadError}
        </p>
      ) : null}
      {sample.error ? (
        <p
          role="alert"
          className="text-destructive shrink-0 border-t px-4 py-3 text-xs"
        >
          {sample.error}
        </p>
      ) : null}
    </div>
  );
}

/** Download actions never call the picker selection callback or change its saved value. */
function PocketVoiceDownload({
  name,
  sizeBytes,
  state,
  busy,
  retry,
  onDownload,
  onRemove,
}: {
  name: string;
  sizeBytes: number;
  state: PocketVoiceAvailability;
  busy: boolean;
  retry: boolean;
  onDownload: (id: string) => void;
  onRemove?: (id: string) => void;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const downloading = state.status === "downloading";
  const installed = state.status === "installed";
  const failed = state.status === "failed" || retry;
  return (
    <div className="flex flex-wrap items-center gap-2 px-2 pb-2">
      <span className="text-muted-foreground flex-1 text-xs" role="status">
        {installed
          ? "Installed"
          : downloading
            ? state.progress === 1
              ? "Verifying…"
              : `Downloading ${Math.round((state.progress ?? 0) * 100)}%`
            : state.status === "unknown"
              ? "Checking download…"
              : `${formatFileSize(sizeBytes)}${failed ? " · Retry available" : " download"}`}
      </span>
      {downloading ? (
        <progress
          className="h-1.5 w-20"
          max={1}
          value={state.progress ?? undefined}
          aria-label={`${name} download progress`}
        />
      ) : null}
      {!installed && !downloading ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy || state.status === "unknown"}
          aria-label={`${failed ? "Retry download" : "Download"} ${name}`}
          onClick={() => onDownload(state.assetId)}
        >
          {state.status === "unknown" ? (
            <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" />
          ) : (
            <Download className="size-3" />
          )}
          {failed ? "Retry" : "Download"}
        </Button>
      ) : null}
      {onRemove && (installed || downloading) ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={installed && busy}
          aria-label={`${downloading ? "Cancel download" : confirmRemove ? "Confirm removal of" : "Remove"} ${name}`}
          onClick={() => {
            if (installed && !confirmRemove) setConfirmRemove(true);
            else {
              setConfirmRemove(false);
              onRemove(state.assetId);
            }
          }}
        >
          {downloading
            ? "Cancel"
            : confirmRemove
              ? "Confirm removal"
              : "Remove"}
        </Button>
      ) : null}
    </div>
  );
}

/** Keep play/stop feedback identical beside the selection and in each list row. */
function VoiceSampleButton({
  voice,
  sample,
  player,
  compact = false,
}: VoiceSamplePlayback & {
  voice: VoiceSampleSource | undefined;
  compact?: boolean;
}) {
  const active =
    sample.voiceId === voice?.id &&
    (sample.status === "playing" || sample.status === "loading");
  const unavailable =
    voice && "sampleUnavailable" in voice ? voice.sampleUnavailable : null;
  const label = unavailable
    ? `${voice!.name}: ${unavailable}`
    : voice
      ? `${active ? "Stop" : "Play"} ${voice.name} sample`
      : "No sample available for this voice";
  return (
    <Button
      type="button"
      variant={compact ? "ghost" : "outline"}
      size={compact ? "icon-sm" : "icon"}
      disabled={!voice || Boolean(unavailable)}
      className="shrink-0"
      aria-label={label}
      title={label}
      onClick={() => voice && !unavailable && void player.play(voice)}
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
  );
}
