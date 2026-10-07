"use client";

import { ChevronDownIcon, XIcon } from "lucide-react";
import { useEffect, useId } from "react";
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

const label = (value: string) => value[0].toUpperCase() + value.slice(1);
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
  const descriptionId = useId();
  const isSpread = adjustment === "spread";
  const eligible = hands.selectedAvailable.filter(
    (bone) => !isSpread || bone.segment.spread,
  );
  const disabled = !hands.canEdit || eligible.length === 0;
  const reason = !hands.canEdit
    ? "Waiting for an editable Avatar."
    : eligible.length === 0
      ? isSpread
        ? "Select base segments to adjust spread."
        : "Select segments on the hand to adjust curl."
      : isSpread
        ? `${eligible.length} selected base ${eligible.length === 1 ? "bone" : "bones"} only.`
        : "Release to recenter; the pose keeps your changes.";
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "w-12 shrink-0 text-xs font-medium",
            disabled && "text-muted-foreground",
          )}
        >
          {label(adjustment)}
        </span>
        <input
          type="range"
          aria-label={
            isSpread ? "Spread selected base bones" : "Curl selected bones"
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
        <span>{isSpread ? "Bring together" : "Straighten"}</span>
        <span>{hands.adjustment === adjustment ? `${hands.value}°` : "0"}</span>
        <span>{label(adjustment)}</span>
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
  const { end } = hands;
  useEffect(() => () => end(), [end]);
  const sideLabel = label(hands.target);
  const selectedSegments = HAND_SEGMENTS.filter((segment) =>
    hands.selected.includes(segment.id),
  );
  return (
    <section aria-label="Hands" className="space-y-2 p-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Hands</h2>
        <button
          type="button"
          aria-label="Close Hands"
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
        aria-label="Target hands"
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
            {label(target)}
          </button>
        ))}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={!hands.canEdit || hands.available.length === 0}
            aria-label="Hand presets"
            title={`Replace available finger rotations on ${hands.target === "both" ? "both hands" : `the ${hands.target} hand`}.`}
            className="border-border hover:bg-muted/60 focus-visible:ring-ring flex w-full items-center justify-between rounded-lg border px-3 py-2 text-xs focus-visible:ring-2 disabled:opacity-40"
          >
            Hand presets
            <ChevronDownIcon className="size-4" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {HAND_PRESETS.map((preset) => (
            <DropdownMenuItem
              key={preset.id}
              onSelect={() => hands.preset(preset.id)}
            >
              {preset.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="border-border/70 border-t pt-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs font-medium">Select bones</span>
          <span className="text-muted-foreground text-2xs">
            {sideLabel}
            {hands.target === "both" ? " · matching segments" : " hand"}
          </span>
        </div>
        <svg
          viewBox="0 0 235 250"
          className="mx-auto h-48 w-full max-w-60"
          aria-label={`${sideLabel} hand bone selection`}
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
                  aria-label={`${sideLabel} ${segment.label.toLowerCase()}`}
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
                    {`${segment.label}${!available ? " — unavailable" : ""}`}
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
          {hands.selectedAvailable.length}{" "}
          {hands.selectedAvailable.length === 1 ? "bone" : "bones"} selected
        </p>
        <p className="text-muted-foreground text-2xs mt-1 leading-relaxed">
          {selectedSegments.length
            ? selectedSegments.map((segment) => segment.label).join(" · ")
            : "Click individual segments to select."}
        </p>
        {hands.unavailable.length ? (
          <p className="text-muted-foreground text-2xs mt-1">
            Unavailable:{" "}
            {hands.unavailable
              .map(
                (bone) =>
                  `${label(bone.side)} ${bone.segment.label.toLowerCase()}`,
              )
              .join(", ")}
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
