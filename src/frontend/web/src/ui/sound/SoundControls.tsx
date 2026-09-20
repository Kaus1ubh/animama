"use client";

import { FastForward, ListMusic, Pause, Play, Square } from "lucide-react";
import { motion } from "motion/react";

import { useSoundController } from "@/hooks/use-sound-controller";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/components/button";
import { Checkbox } from "@/ui/components/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/ui/components/dropdown-menu";
import { Slider } from "@/ui/components/slider";

type VolumeControlRowProps = {
  label: "TTS" | "SFX" | "BGM";
  value: number;
  muted: boolean;
  disabled: boolean;
  muteDisabled?: boolean;
  sliderAriaLabel: string;
  muteAriaLabel: string;
  onValueChange: (value: number) => void;
  onMutedChange: (muted: boolean) => void;
  detail?: string | null;
};

type AudioVolumePanelProps = {
  disabled?: boolean;
  showTitle?: boolean;
  showBgmDetail?: boolean;
  className?: string;
  volumeCardClassName?: string;
};

type BgmTransportRowProps = {
  portalContainer?: HTMLElement | null;
  className?: string;
};

const WAVEFORM_BAR_ANIMATIONS = [
  [5, 12, 7, 14, 6],
  [5, 16, 9, 12, 7],
  [5, 10, 15, 8, 6],
  [5, 14, 8, 16, 7],
] as const;

function VolumeControlRow({
  label,
  value,
  muted,
  disabled,
  muteDisabled = false,
  sliderAriaLabel,
  muteAriaLabel,
  onValueChange,
  onMutedChange,
  detail,
}: VolumeControlRowProps) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-16 shrink-0">
        <p
          className={cn(
            "text-foreground text-sm font-medium",
            muted && "opacity-60",
          )}
        >
          {label}
        </p>
        {detail ? (
          <p className="text-muted-foreground truncate text-[11px]">{detail}</p>
        ) : null}
      </div>
      <label
        className={cn(
          "text-foreground flex shrink-0 items-center gap-2 text-xs",
          muteDisabled && "opacity-60",
        )}
      >
        <Checkbox
          checked={muted}
          onCheckedChange={(checked) => onMutedChange(checked === true)}
          disabled={disabled || muteDisabled}
          aria-label={muteAriaLabel}
        />
        <span>Mute</span>
      </label>
      <Slider
        className="flex-1"
        aria-label={sliderAriaLabel}
        value={[value]}
        min={0}
        max={1}
        step={0.01}
        disabled={disabled}
        onValueChange={(values) => {
          const [nextValue] = values;
          if (typeof nextValue === "number") {
            onValueChange(nextValue);
          }
        }}
      />
    </div>
  );
}

function BgmWaveform({ active }: { active: boolean }) {
  return (
    <div aria-hidden="true" className="flex h-5 shrink-0 items-end gap-1">
      {WAVEFORM_BAR_ANIMATIONS.map((heights, index) => (
        <motion.span
          key={index}
          className="bg-foreground/75 block w-1 rounded-full"
          initial={false}
          animate={{
            height: active ? [...heights] : 4,
            opacity: active ? [0.5, 0.95, 0.65, 0.95, 0.5] : 0.45,
          }}
          transition={
            active
              ? {
                  duration: 1.05,
                  ease: "easeInOut",
                  repeat: Infinity,
                  delay: index * 0.08,
                }
              : {
                  duration: 0.18,
                  ease: "easeOut",
                }
          }
        />
      ))}
    </div>
  );
}

export function AudioVolumePanel({
  disabled = false,
  showTitle = true,
  showBgmDetail = false,
  className,
  volumeCardClassName,
}: AudioVolumePanelProps) {
  const {
    masterMuted,
    bgmRuntimeId,
    bgmTracks,
    bgmMuted,
    sfxMuted,
    ttsMuted,
    bgmVolume,
    sfxVolume,
    ttsVolume,
    setMasterMuted,
    setBgmMuted,
    setSfxMuted,
    setBgmVolume,
    setSfxVolume,
    setTtsMuted,
    setTtsVolume,
  } = useSoundController();

  const bgmEffectiveMuted = masterMuted || bgmMuted;
  const sfxEffectiveMuted = masterMuted || sfxMuted;
  const ttsEffectiveMuted = masterMuted || ttsMuted;
  const bgmTrackName =
    bgmTracks.find((track) => track.runtimeId === bgmRuntimeId)?.label ??
    "No track";

  return (
    <div className={cn("space-y-4", className)}>
      <div
        className={cn(
          "border-border/70 bg-background/50 rounded-lg border px-3 py-3",
          volumeCardClassName,
        )}
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {showTitle ? (
              <p className="text-foreground text-sm font-semibold">Volume</p>
            ) : null}
            <label className="text-foreground ml-auto flex items-center gap-2 text-xs font-medium">
              <Checkbox
                checked={masterMuted}
                onCheckedChange={(checked) => setMasterMuted(checked === true)}
                disabled={disabled}
                aria-label="Mute all audio"
              />
              <span>Mute all</span>
            </label>
          </div>
          <VolumeControlRow
            label="TTS"
            value={ttsVolume}
            muted={ttsEffectiveMuted}
            disabled={disabled}
            muteDisabled={masterMuted}
            sliderAriaLabel="Text-to-speech volume"
            muteAriaLabel="Mute text-to-speech"
            onValueChange={setTtsVolume}
            onMutedChange={setTtsMuted}
          />
          <VolumeControlRow
            label="SFX"
            value={sfxVolume}
            muted={sfxEffectiveMuted}
            disabled={disabled}
            muteDisabled={masterMuted}
            sliderAriaLabel="Sound effects volume"
            muteAriaLabel="Mute sound effects"
            onValueChange={setSfxVolume}
            onMutedChange={setSfxMuted}
          />
          <VolumeControlRow
            label="BGM"
            value={bgmVolume}
            muted={bgmEffectiveMuted}
            disabled={disabled}
            muteDisabled={masterMuted}
            sliderAriaLabel="Background music volume"
            muteAriaLabel="Mute background music"
            onValueChange={setBgmVolume}
            onMutedChange={setBgmMuted}
            detail={showBgmDetail ? bgmTrackName : null}
          />
        </div>
      </div>
    </div>
  );
}

export function BgmTransportRow({
  className,
  portalContainer,
}: BgmTransportRowProps) {
  const {
    bgmState,
    bgmRuntimeId,
    bgmTracks,
    playBgm,
    playBgmTrack,
    playNextBgmTrack,
    preloadBgm,
    pauseBgm,
    stopBgm,
  } = useSoundController();

  const bgmTrackName =
    bgmTracks.find((track) => track.runtimeId === bgmRuntimeId)?.label ??
    "No track";
  const bgmIsActive = bgmState === "loading" || bgmState === "playing";
  const bgmIsPlaying = bgmState === "playing";

  const handleBgmPrimaryAction = () => {
    if (bgmIsActive) {
      pauseBgm();
      return;
    }
    void playBgm();
  };

  return (
    <div
      className={cn(
        "border-border/70 bg-background/50 flex items-center justify-between rounded-lg border px-3 py-2.5",
        className,
      )}
    >
      <div className="min-w-0">
        <p className="text-foreground text-sm font-medium">BGM</p>
        <p className="text-muted-foreground truncate text-[11px]">
          {bgmTrackName}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <BgmWaveform active={bgmIsPlaying} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="Choose background music track"
            >
              <ListMusic className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            side="bottom"
            className="w-52"
            portalContainer={portalContainer}
          >
            <DropdownMenuLabel className="text-muted-foreground text-xs">
              Tracks
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup value={bgmRuntimeId ?? ""}>
              {bgmTracks.map((track) => (
                <DropdownMenuRadioItem
                  key={track.runtimeId}
                  value={track.runtimeId}
                  onSelect={() => {
                    void playBgmTrack(track.runtimeId);
                  }}
                >
                  {track.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void playNextBgmTrack();
          }}
          disabled={bgmTracks.length === 0}
          aria-label="Play next background music track"
        >
          <FastForward className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleBgmPrimaryAction}
          onPointerEnter={preloadBgm}
          onFocus={preloadBgm}
          aria-label={
            bgmIsActive ? "Pause background music" : "Play background music"
          }
        >
          {bgmIsActive ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={stopBgm}
          aria-label="Stop background music"
        >
          <Square className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
