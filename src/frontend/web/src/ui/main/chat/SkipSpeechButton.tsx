import { FastForward } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipLabel,
  TooltipTrigger,
} from "@/ui/components/tooltip";

/**
 * Small icon below the reply being spoken that stops its speech playback,
 * like the Skip TTS shortcut. Sits beside the reply's memory cue.
 */
export function SkipSpeechButton({
  shortcut,
  onSkip,
}: {
  /** Keycap text of the desktop Skip TTS shortcut, if there is one. */
  shortcut?: string | null;
  onSkip: () => void;
}) {
  const { t } = useTranslation("chat");
  const label = t("speech.skip");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          className="text-muted-foreground hover:text-foreground size-7"
          onClick={onSkip}
        >
          <FastForward aria-hidden="true" className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <TooltipLabel label={label} shortcut={shortcut} />
      </TooltipContent>
    </Tooltip>
  );
}
