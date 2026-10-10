import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useFormatters } from "@animama/product-ui/i18n";

import { cn } from "@/lib/utils";
import {
  METER_MIN_DB,
  litSegments,
  rmsDbfs,
  segmentZone,
} from "@/lib/voice/level-meter";

const SEGMENTS = 24;
/** Peak display decays so brief sounds remain visible. */
const DECAY_DB_PER_FRAME = 1.2;

const ZONE_CLASSES = {
  green: "bg-emerald-500",
  yellow: "bg-amber-400",
  red: "bg-red-500",
} as const;

/**
 * Horizontal segmented input meter (green → yellow → red) for a live stream.
 * Segments are updated directly on animation frames to avoid re-rendering.
 */
export function MicrophoneLevelMeter({
  stream,
  className,
}: {
  stream: MediaStream | null;
  className?: string;
}) {
  const { t } = useTranslation("voice");
  const { number } = useFormatters();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!stream || !container) return;
    const segments = Array.from(container.children) as HTMLElement[];
    const AudioContextConstructor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const audioContext = new AudioContextConstructor();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    let displayed = METER_MIN_DB;
    let lastReported = -1;
    let frame = 0;

    const draw = () => {
      analyser.getFloatTimeDomainData(samples);
      const level = rmsDbfs(samples);
      displayed = Math.max(
        Number.isFinite(level) ? level : METER_MIN_DB,
        displayed - DECAY_DB_PER_FRAME,
      );
      const lit = litSegments(displayed, SEGMENTS);
      segments.forEach((segment, index) => {
        segment.style.opacity = index < lit ? "1" : "0.18";
      });
      // Keep the accessible value coarse so screen readers aren't flooded.
      const rounded = Math.round(displayed / 6) * 6;
      if (rounded !== lastReported) {
        lastReported = rounded;
        container.setAttribute("aria-valuenow", String(rounded));
        container.setAttribute(
          "aria-valuetext",
          t("microphone.meter.value", { level: number(rounded) }),
        );
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      source.disconnect();
      void audioContext.close();
      segments.forEach((segment) => {
        segment.style.opacity = "0.18";
      });
    };
    // A UI Locale change restarts the meter so its spoken value follows it.
  }, [stream, t, number]);

  return (
    <div
      ref={containerRef}
      role="meter"
      aria-label={t("microphone.meter.label")}
      aria-valuemin={METER_MIN_DB}
      aria-valuemax={0}
      aria-valuenow={METER_MIN_DB}
      aria-valuetext={t("microphone.meter.value", {
        level: number(METER_MIN_DB),
      })}
      className={cn("flex h-3 items-stretch gap-[2px]", className)}
    >
      {Array.from({ length: SEGMENTS }, (_, index) => (
        <span
          key={index}
          className={cn(
            "w-1.5 rounded-[1px] opacity-20",
            ZONE_CLASSES[segmentZone(index, SEGMENTS)],
          )}
        />
      ))}
    </div>
  );
}
