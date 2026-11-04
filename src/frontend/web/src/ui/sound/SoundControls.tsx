import { useTranslation } from "react-i18next";

import { useSoundController } from "@/hooks/useSoundController";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/ui/components/checkbox";
import { Slider } from "@/ui/components/slider";

type VolumeControlRowProps = {
  label: string;
  value: number;
  muted: boolean;
  disabled: boolean;
  muteDisabled?: boolean;
  sliderAriaLabel: string;
  muteAriaLabel: string;
  onValueChange: (value: number) => void;
  onMutedChange: (muted: boolean) => void;
};

type AudioVolumePanelProps = {
  disabled?: boolean;
  showTitle?: boolean;
  className?: string;
  volumeCardClassName?: string;
};

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
}: VolumeControlRowProps) {
  const { t } = useTranslation("sound");
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
        <span>{t("volume.mute")}</span>
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

export function AudioVolumePanel({
  disabled = false,
  showTitle = true,
  className,
  volumeCardClassName,
}: AudioVolumePanelProps) {
  const {
    masterMuted,
    sfxMuted,
    ttsMuted,
    sfxVolume,
    ttsVolume,
    setMasterMuted,
    setSfxMuted,
    setSfxVolume,
    setTtsMuted,
    setTtsVolume,
  } = useSoundController();
  const { t } = useTranslation("sound");

  const sfxEffectiveMuted = masterMuted || sfxMuted;
  const ttsEffectiveMuted = masterMuted || ttsMuted;
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
              <p className="text-foreground text-sm font-semibold">
                {t("volume.title")}
              </p>
            ) : null}
            <label className="text-foreground ml-auto flex items-center gap-2 text-xs font-medium">
              <Checkbox
                checked={masterMuted}
                onCheckedChange={(checked) => setMasterMuted(checked === true)}
                disabled={disabled}
                aria-label={t("volume.muteAllLabel")}
              />
              <span>{t("volume.muteAll")}</span>
            </label>
          </div>
          <VolumeControlRow
            label={t("volume.tts.label")}
            value={ttsVolume}
            muted={ttsEffectiveMuted}
            disabled={disabled}
            muteDisabled={masterMuted}
            sliderAriaLabel={t("volume.tts.slider")}
            muteAriaLabel={t("volume.tts.mute")}
            onValueChange={setTtsVolume}
            onMutedChange={setTtsMuted}
          />
          <VolumeControlRow
            label={t("volume.sfx.label")}
            value={sfxVolume}
            muted={sfxEffectiveMuted}
            disabled={disabled}
            muteDisabled={masterMuted}
            sliderAriaLabel={t("volume.sfx.slider")}
            muteAriaLabel={t("volume.sfx.mute")}
            onValueChange={setSfxVolume}
            onMutedChange={setSfxMuted}
          />
        </div>
      </div>
    </div>
  );
}
