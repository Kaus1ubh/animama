import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useFormatters } from "@animama/product-ui/i18n";

import { cn } from "@/lib/utils";
import type { PocketVoiceAvailability } from "@/lib/speech/pocket/voice-preferences";

/**
 * A subtle status mark for downloadable Pocket voices in the voice picker: a
 * download glyph until the voice is installed (tinted after a failure), and a
 * small progress ring while it downloads. Installed, core and not-yet-known
 * voices show nothing.
 */
export function PocketVoiceDownloadIcon({
  availability,
}: {
  availability: PocketVoiceAvailability | null;
}) {
  const { t } = useTranslation("chat");
  const formatters = useFormatters();
  if (
    !availability ||
    availability.status === "installed" ||
    availability.status === "unknown"
  )
    return null;
  if (availability.status === "downloading") {
    const progress = availability.progress ?? 0;
    const circumference = 2 * Math.PI * 5;
    return (
      <svg
        viewBox="0 0 14 14"
        className="size-3.5 -rotate-90"
        role="img"
        aria-label={t("header.voiceDownload.downloading", {
          percent: formatters.number(progress, {
            style: "percent",
            maximumFractionDigits: 0,
          }),
        })}
        data-state="downloading"
      >
        <circle
          cx="7"
          cy="7"
          r="5"
          fill="none"
          strokeWidth="2"
          className="stroke-muted-foreground/25"
        />
        <circle
          cx="7"
          cy="7"
          r="5"
          fill="none"
          strokeWidth="2"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress)}
          className="stroke-muted-foreground transition-[stroke-dashoffset] motion-reduce:transition-none"
        />
      </svg>
    );
  }
  const failed = availability.status === "failed";
  return (
    <Download
      className={cn("size-3.5", failed && "text-destructive/70")}
      role="img"
      data-state={availability.status}
      aria-label={
        failed
          ? t("header.voiceDownload.failed")
          : t("header.voiceDownload.whenSelected")
      }
    />
  );
}
