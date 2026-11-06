import { ChevronDownIcon, XIcon } from "lucide-react";
import { useEffect, useId } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/components/dropdown-menu";
import {
  HAND_ADJUSTMENT_LIMITS,
  HAND_PRESETS,
  HAND_SEGMENTS,
  type HandAdjustment,
  type HandSegment,
} from "@/lib/avatar/poses/anatomy/handPresets";
import type { PoseCreatorHands } from "./usePoseCreatorHands";
import {
  handPresetLabel,
  handSegmentLabel,
  sidedHandSegmentLabel,
} from "./poseLabels";

function targetLabel(
  t: TFunction<"pose">,
  target: PoseCreatorHands["target"],
): string {
  switch (target) {
    case "left":
      return t("hands.targets.left");
    case "right":
      return t("hands.targets.right");
    case "both":
      return t("hands.targets.both");
  }
}
const digits = {
  little: { x: 30, y: 72 },
  ring: { x: 66, y: 39 },
  middle: { x: 102, y: 23 },
  index: { x: 138, y: 40 },
};
/** The thumb metacarpal stays part of the palm, outside the helper's controls. */
function segmentPosition(segment: HandSegment) {
  if (segment.digit === "thumb") {
    const index = ["proximal", "distal"].indexOf(segment.segment);
    return { x: 169 + index * 19, y: 163 - index * 24, angle: 38 };
  }
  const digit = digits[segment.digit];
  const index = ["distal", "intermediate", "proximal"].indexOf(segment.segment);
  return { x: digit.x, y: digit.y + index * 34, angle: 0 };
}
const rangeKeys = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

export function HandAdjustmentControl({
  hands,
  adjustment,
}: {
  hands: PoseCreatorHands;
  adjustment: HandAdjustment;
}) {
  const { t } = useTranslation("pose");
  const descriptionId = useId();
  const isSpread = adjustment === "spread";
  const eligible = hands.selectedAvailable.filter(
    (bone) => !isSpread || bone.segment.spread,
  );
  const disabled = !hands.canEdit || eligible.length === 0;
  const reason = !hands.canEdit
    ? t("hands.adjust.waiting")
    : eligible.length === 0
      ? isSpread
        ? t("hands.adjust.selectSpread")
        : t("hands.adjust.selectCurl")
      : isSpread
        ? t("hands.adjust.spreadEligible", { count: eligible.length })
        : t("hands.adjust.release");
  const adjustmentName = isSpread
    ? t("hands.adjust.spread")
    : t("hands.adjust.curl");
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "w-12 shrink-0 text-xs font-medium",
            disabled && "text-muted-foreground",
          )}
        >
          {adjustmentName}
        </span>
        <input
          type="range"
          aria-label={
            isSpread
              ? t("hands.adjust.spreadLabel")
              : t("hands.adjust.curlLabel")
          }
          aria-describedby={descriptionId}
          disabled={disabled}
          min={-HAND_ADJUSTMENT_LIMITS[adjustment]}
          max={HAND_ADJUSTMENT_LIMITS[adjustment]}
          step={1}
          value={hands.adjustment === adjustment ? hands.value : 0}
          className="accent-primary focus-visible:outline-primary h-5 min-w-0 flex-1 cursor-pointer disabled:cursor-default disabled:opacity-40"
          onPointerDown={(event) => {
            if (hands.begin(adjustment))
              event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onChange={(event) => {
            // Only an explicit pointer/key start may create an interaction.
            // Late input samples after history/session changes stay inert.
            hands.update(Number(event.currentTarget.value));
          }}
          onPointerUp={hands.end}
          onPointerCancel={hands.end}
          onLostPointerCapture={hands.end}
          onKeyDown={(event) => {
            if (rangeKeys.has(event.key) && !event.repeat)
              hands.begin(adjustment);
          }}
          onKeyUp={(event) => {
            if (rangeKeys.has(event.key)) hands.end();
          }}
          onBlur={hands.end}
        />
      </div>
      <div className="text-muted-foreground text-2xs ml-15 flex justify-between">
        <span>
          {isSpread
            ? t("hands.adjust.bringTogether")
            : t("hands.adjust.straighten")}
        </span>
        <span>{hands.adjustment === adjustment ? `${hands.value}°` : "0"}</span>
        <span>{adjustmentName}</span>
      </div>
      <p id={descriptionId} className="text-muted-foreground text-2xs min-h-4">
        {reason}
      </p>
    </div>
  );
}

/** Compact Hands tool content. The workspace owns surface placement and height. */
export function PoseCreatorHandPanel({
  hands,
  onClose,
}: {
  hands: PoseCreatorHands;
  onClose: () => void;
}) {
  const { t } = useTranslation("pose");
  const { end } = hands;
  useEffect(() => () => end(), [end]);
  const selectedSegments = HAND_SEGMENTS.filter((segment) =>
    hands.selected.includes(segment.id),
  );
  return (
    <section aria-label={t("hands.title")} className="space-y-2 p-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{t("hands.title")}</h2>
        <button
          type="button"
          aria-label={t("hands.close")}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded p-1 focus-visible:ring-2"
          onClick={() => {
            hands.end();
            onClose();
          }}
        >
          <XIcon className="size-4" aria-hidden="true" />
        </button>
      </div>
      <div
        role="group"
        aria-label={t("hands.targets.label")}
        className="border-border flex overflow-hidden rounded-lg border"
      >
        {(["left", "right", "both"] as const).map((target) => (
          <button
            key={target}
            type="button"
            aria-pressed={hands.target === target}
            onClick={() => hands.setTarget(target)}
            className={cn(
              "focus-visible:ring-ring flex-1 px-2 py-1.5 text-xs focus-visible:ring-2 focus-visible:ring-inset",
              hands.target === target
                ? "bg-primary/15 text-primary font-medium"
                : "hover:bg-muted/70 text-muted-foreground",
            )}
          >
            {targetLabel(t, target)}
          </button>
        ))}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={!hands.canEdit || hands.available.length === 0}
            aria-label={t("hands.presets")}
            title={
              hands.target === "both"
                ? t("hands.presetsHint.both")
                : hands.target === "left"
                  ? t("hands.presetsHint.left")
                  : t("hands.presetsHint.right")
            }
            className="border-border hover:bg-muted/60 focus-visible:ring-ring flex w-full items-center justify-between rounded-lg border px-3 py-2 text-xs focus-visible:ring-2 disabled:opacity-40"
          >
            {t("hands.presets")}
            <ChevronDownIcon className="size-4" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          // Twelve presets can outgrow a short window; scroll within it.
          className="max-h-(--radix-dropdown-menu-content-available-height) w-56 overflow-y-auto overscroll-contain"
        >
          {HAND_PRESETS.map((preset) => (
            <DropdownMenuItem
              key={preset.id}
              onSelect={() => hands.preset(preset.id)}
            >
              {handPresetLabel(t, preset.id)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="border-border/70 border-t pt-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs font-medium">{t("hands.selectBones")}</span>
          <span className="text-muted-foreground text-2xs">
            {hands.target === "both"
              ? t("hands.scope.both")
              : hands.target === "left"
                ? t("hands.scope.left")
                : t("hands.scope.right")}
          </span>
        </div>
        <svg
          viewBox="0 0 235 250"
          className="mx-auto h-48 w-full max-w-60"
          aria-label={
            hands.target === "both"
              ? t("hands.selectionLabel.both")
              : hands.target === "left"
                ? t("hands.selectionLabel.left")
                : t("hands.selectionLabel.right")
          }
        >
          <g
            transform={
              hands.target === "right"
                ? "translate(235 0) scale(-1 1)"
                : undefined
            }
          >
            <path
              d="M39 167 Q80 135 149 142 L166 184 Q180 208 148 235 L76 238 Q44 217 39 167Z"
              className="fill-muted/30 stroke-border"
              strokeWidth="1.5"
            />
            {HAND_SEGMENTS.map((segment) => {
              const available = hands.available.some(
                (bone) => bone.segment.id === segment.id,
              );
              const disabled = !hands.canEdit || !available;
              const selected = available && hands.selected.includes(segment.id);
              const position = segmentPosition(segment);
              return (
                <g
                  key={segment.id}
                  role="button"
                  tabIndex={disabled ? -1 : 0}
                  aria-label={sidedHandSegmentLabel(
                    t,
                    hands.target,
                    segment.id,
                  )}
                  aria-pressed={selected}
                  aria-disabled={disabled}
                  transform={`translate(${position.x} ${position.y}) rotate(${position.angle} 11 16)`}
                  className={cn(
                    "group focus:outline-none",
                    disabled ? "opacity-30" : "cursor-pointer",
                  )}
                  onClick={() => {
                    if (!disabled) hands.toggleSegment(segment.id);
                  }}
                  onKeyDown={(event) => {
                    if (
                      !disabled &&
                      (event.key === " " || event.key === "Enter")
                    ) {
                      event.preventDefault();
                      if (!event.repeat) hands.toggleSegment(segment.id);
                    }
                  }}
                >
                  <title>
                    {available
                      ? handSegmentLabel(t, segment.id)
                      : t("hands.segmentUnavailable", {
                          segment: handSegmentLabel(t, segment.id),
                        })}
                  </title>
                  <rect
                    x="-3"
                    y="-2"
                    width="29"
                    height="35"
                    rx="8"
                    fill="transparent"
                  />
                  <rect
                    width="23"
                    height="29"
                    rx="8"
                    className={cn(
                      "group-focus-visible:stroke-foreground group-focus-visible:[stroke-width:3]",
                      selected
                        ? "fill-primary/25 stroke-primary"
                        : "fill-background stroke-muted-foreground/70",
                    )}
                    strokeWidth={selected ? 2.5 : 1.2}
                  />
                  {selected ? (
                    <circle
                      cx="11.5"
                      cy="14.5"
                      r="3"
                      className="fill-primary"
                    />
                  ) : null}
                </g>
              );
            })}
          </g>
        </svg>
        <p className="text-xs font-medium" aria-live="polite">
          {t("hands.selectedCount", {
            count: hands.selectedAvailable.length,
          })}
        </p>
        <p className="text-muted-foreground text-2xs mt-1 leading-relaxed">
          {selectedSegments.length
            ? selectedSegments
                .map((segment) => handSegmentLabel(t, segment.id))
                .join(" · ")
            : t("hands.clickSegments")}
        </p>
        {hands.unavailable.length ? (
          <p className="text-muted-foreground text-2xs mt-1">
            {t("hands.unavailable", {
              bones: hands.unavailable.map((bone) =>
                sidedHandSegmentLabel(t, bone.side, bone.segment.id),
              ),
            })}
          </p>
        ) : null}
      </div>
      <div className="border-border/70 space-y-2 border-t pt-2">
        <HandAdjustmentControl hands={hands} adjustment="curl" />
        <HandAdjustmentControl hands={hands} adjustment="spread" />
      </div>
      {hands.error ? (
        <p role="alert" className="text-destructive text-xs">
          {hands.error}
        </p>
      ) : null}
    </section>
  );
}
