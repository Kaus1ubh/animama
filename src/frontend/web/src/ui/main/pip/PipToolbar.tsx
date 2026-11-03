import { Loader2, Mic, MicOff, Phone } from "lucide-react";
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";

import type {
  DesktopPipVoiceCommand,
  DesktopPipVoiceState,
} from "@/hooks/useDesktopPipVoice";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/components/button";
import { SyntheticWaveform } from "@/ui/components/live-waveform";

type PipToolbarIcon = ComponentType<{
  "aria-hidden"?: boolean | "true" | "false";
  className?: string;
}>;

/**
 * The toolbar is a size container. These widths are where its optional parts
 * stop fitting beside the 20 px buttons, so they give way to the voice
 * controls in a small PiP window.
 */
export const PIP_TOOLBAR_FIT = {
  /** Waveform beside the voice controls and every other button. */
  waveform: "@max-[145px]:hidden",
  /** Camera beside the active voice controls. */
  cameraBesideActiveVoice: "@max-[125px]:hidden",
  /** Camera beside the voice-mode button; separator beside active voice. */
  besideVoiceButton: "@max-[105px]:hidden",
} as const;

/** The chat input's square stop icon. */
function StopIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <rect x="6" y="6" width="12" height="12" />
    </svg>
  );
}

/**
 * An icon button in the hover toolbar. The label doubles as a native tooltip,
 * which the OS draws outside the small PiP window.
 */
export function PipToolbarButton({
  className,
  icon: Icon,
  label,
  pressed,
  onClick,
}: {
  className?: string;
  icon: PipToolbarIcon;
  label: string;
  /** Set for toggles; leave undefined for plain actions. */
  pressed?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      onClick={onClick}
      className={cn(
        "anima-pip-no-drag text-foreground/80 aria-pressed:bg-accent aria-pressed:text-accent-foreground size-5 shrink-0 rounded-sm",
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3.5" />
    </Button>
  );
}

/**
 * The chat input's voice controls for the main window's session: the
 * voice-mode button while the microphone is idle, then the speaking waveform,
 * mute toggle and stop. Dictation can only be stopped here, since PiP has no
 * text field. Renders nothing until the main window reports its state.
 */
export function PipVoiceControls({
  onCommand,
  voice,
}: {
  onCommand: (command: DesktopPipVoiceCommand) => void;
  voice: DesktopPipVoiceState | null;
}) {
  const { t } = useTranslation("chat");
  const { t: tApp } = useTranslation("app");
  if (!voice) return null;

  if (!voice.activeMode) {
    return voice.canStartVoice ? (
      <PipToolbarButton
        icon={Phone}
        label={tApp("pip.voiceMode")}
        onClick={() => onCommand("start-voice-mode")}
      />
    ) : null;
  }

  const isVoiceMode = voice.activeMode === "voice";
  const muted = voice.isVoiceMicMuted;
  return (
    <>
      {voice.isDictationPreparing ? (
        <span
          aria-hidden="true"
          className={cn(
            "text-muted-foreground flex size-5 shrink-0 items-center justify-center",
            PIP_TOOLBAR_FIT.waveform,
          )}
        >
          <Loader2 className="size-3.5 animate-spin" />
        </span>
      ) : (
        <SyntheticWaveform
          active={voice.isUserSpeaking && voice.isMicCaptureActive && !muted}
          muted={!voice.isMicCaptureActive || muted}
          height={16}
          barCount={4}
          className={cn(
            "text-muted-foreground w-5 shrink-0 gap-0.5",
            PIP_TOOLBAR_FIT.waveform,
          )}
        />
      )}
      {isVoiceMode ? (
        <PipToolbarButton
          icon={muted ? MicOff : Mic}
          label={
            muted
              ? t("composer.dictation.unmute")
              : t("composer.dictation.mute")
          }
          onClick={() => onCommand("toggle-voice-mute")}
          className={cn(
            muted &&
              "bg-red-500/10 text-red-500 hover:bg-red-500/15 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300",
          )}
        />
      ) : null}
      <PipToolbarButton
        icon={StopIcon}
        label={
          isVoiceMode ? tApp("pip.stopVoiceMode") : t("composer.dictation.stop")
        }
        onClick={() => onCommand("stop-mic-session")}
      />
    </>
  );
}
