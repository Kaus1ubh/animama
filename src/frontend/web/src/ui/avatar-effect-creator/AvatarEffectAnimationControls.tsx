import type {
  AvatarEffectKeyframe,
  AvatarEffectMotion,
} from "@animama/runtime-contracts/api-types";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useId } from "react";

import { cn } from "@/lib/utils";
import {
  CreatorField as Field,
  CreatorNumberField as NumberField,
  CreatorToggleRow as Toggle,
} from "@/ui/content-creator";
import { Button } from "@/ui/components/button";
import { Input } from "@/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/select";
import {
  MAX_AVATAR_EFFECT_KEYFRAMES,
  addAvatarEffectKeyframe,
  avatarEffectKeyframeOrderError,
  resolvedAvatarEffectMotion,
  toggleAvatarEffectMotion,
  updateAvatarEffectKeyframe,
} from "./animationControls";
import type { PlacementUnit } from "./avatarEffectPlacement";

/** Edit the effect's own motion: presets and keyframes, as playback reads them. */
export function AvatarEffectAnimationControls({
  motion,
  offsetUnit,
  invalidField,
  onChange,
}: {
  motion: AvatarEffectMotion;
  /** Units of the attachment's offset, for keyframe moves. */
  offsetUnit: PlacementUnit;
  /** A failed Save's definition path, to highlight its control. */
  invalidField?: string | null;
  onChange: (motion: AvatarEffectMotion) => void;
}) {
  const resolved = resolvedAvatarEffectMotion(motion);
  const patch = <K extends "pulse" | "spin" | "drift">(
    preset: K,
    values: NonNullable<AvatarEffectMotion[K]>,
  ) => onChange({ ...motion, [preset]: { ...motion[preset], ...values } });
  return (
    <>
      <Toggle
        label="Pulse"
        description="Grow and shrink in a loop."
        checked={resolved.pulse.enabled}
        onChecked={(enabled) =>
          onChange(toggleAvatarEffectMotion(motion, "pulse", enabled))
        }
      />
      {resolved.pulse.enabled && (
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="Smallest size (×)"
            value={resolved.pulse.scaleMin}
            min={0.01}
            step={0.05}
            decimalPlaces={2}
            onChange={(value) =>
              patch("pulse", {
                scaleMin: Math.max(
                  0.01,
                  Math.min(value, resolved.pulse.scaleMax),
                ),
              })
            }
          />
          <NumberField
            label="Largest size (×)"
            value={resolved.pulse.scaleMax}
            min={resolved.pulse.scaleMin}
            max={20}
            step={0.05}
            decimalPlaces={2}
            onChange={(value) =>
              patch("pulse", {
                scaleMax: Math.min(
                  20,
                  Math.max(resolved.pulse.scaleMin, value),
                ),
              })
            }
          />
          <NumberField
            label="Pulses per second"
            value={resolved.pulse.cyclesPerSecond}
            min={0}
            max={30}
            step={0.1}
            decimalPlaces={1}
            onChange={(value) =>
              patch("pulse", {
                cyclesPerSecond: Math.min(30, Math.max(0, value)),
              })
            }
          />
        </div>
      )}
      <Toggle
        label="Spin"
        description="Turn continuously, or rock back and forth."
        checked={resolved.spin.enabled}
        onChecked={(enabled) =>
          onChange(toggleAvatarEffectMotion(motion, "spin", enabled))
        }
      />
      {resolved.spin.enabled && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="Speed (°/s)"
              value={resolved.spin.degreesPerSecond}
              min={0}
              max={36000}
              step={5}
              decimalPlaces={0}
              onChange={(value) =>
                patch("spin", {
                  degreesPerSecond: Math.min(36000, Math.max(0, value)),
                })
              }
            />
            <NumberField
              label="Range (turns)"
              value={resolved.spin.amountTurns}
              min={0}
              max={1}
              step={0.05}
              decimalPlaces={2}
              onChange={(value) =>
                patch("spin", { amountTurns: Math.min(1, Math.max(0, value)) })
              }
            />
          </div>
          <Field label="Direction">
            <Select
              value={resolved.spin.direction}
              onValueChange={(value) =>
                patch("spin", {
                  direction: value as "clockwise" | "counterclockwise",
                })
              }
            >
              <SelectTrigger
                size="sm"
                className="w-full text-xs"
                aria-label="Spin direction"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="clockwise">Clockwise</SelectItem>
                <SelectItem value="counterclockwise">
                  Counterclockwise
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <p className="text-muted-foreground text-xs">
            Below one turn, the art rocks back and forth. One turn spins
            continuously.
          </p>
        </div>
      )}
      <Toggle
        label="Drift"
        description="Keep moving in one direction."
        checked={resolved.drift.enabled}
        onChecked={(enabled) =>
          onChange(toggleAvatarEffectMotion(motion, "drift", enabled))
        }
      />
      {resolved.drift.enabled && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="Sideways (art widths/s)"
              value={resolved.drift.x}
              min={-10}
              max={10}
              step={0.01}
              decimalPlaces={2}
              onChange={(value) => patch("drift", { x: value })}
            />
            <NumberField
              label="Up/down (art heights/s)"
              value={resolved.drift.y}
              min={-10}
              max={10}
              step={0.01}
              decimalPlaces={2}
              onChange={(value) => patch("drift", { y: value })}
            />
          </div>
        </div>
      )}
      <AvatarEffectKeyframeList
        motion={motion}
        offsetUnit={offsetUnit}
        invalid={Boolean(invalidField?.startsWith("motion.keyframes"))}
        onChange={onChange}
      />
    </>
  );
}

/**
 * Keyframes on the effect's own timeline. An empty channel is interpolated
 * from its neighbours; scale and opacity multiply the presets, rotation and
 * position add to them.
 */
function AvatarEffectKeyframeList({
  motion,
  offsetUnit,
  invalid,
  onChange,
}: {
  motion: AvatarEffectMotion;
  offsetUnit: PlacementUnit;
  invalid: boolean;
  onChange: (motion: AvatarEffectMotion) => void;
}) {
  const frames = motion.keyframes?.frames ?? [];
  const orderError = avatarEffectKeyframeOrderError(motion);
  return (
    <section
      aria-label="Keyframes"
      className={cn(
        "space-y-2 border-t pt-3",
        invalid && "ring-destructive/40 rounded-lg p-2 ring-1",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-medium">Keyframes</h3>
          <p className="text-muted-foreground text-xs">
            Change size, turn, position or opacity over time. Leave a value
            empty to blend from the neighbours.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={frames.length >= MAX_AVATAR_EFFECT_KEYFRAMES}
          onClick={() => onChange(addAvatarEffectKeyframe(motion))}
        >
          <PlusIcon /> Add
        </Button>
      </div>
      {frames.length ? (
        <>
          <Toggle
            label="Repeat the keyframes"
            checked={Boolean(motion.keyframes?.loop)}
            onChecked={(loop) =>
              onChange({
                ...motion,
                keyframes: { frames, loop },
              })
            }
          />
          <ol className="space-y-2">
            {frames.map((frame, index) => (
              <KeyframeRow
                key={index}
                index={index}
                frame={frame}
                offsetUnit={offsetUnit}
                outOfOrder={index === orderError}
                onChange={(next) =>
                  onChange(updateAvatarEffectKeyframe(motion, index, next))
                }
              />
            ))}
          </ol>
          {orderError >= 0 ? (
            <p className="text-destructive text-xs" role="alert">
              Keyframe {orderError + 1} must come after keyframe {orderError}.
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function KeyframeRow({
  index,
  frame,
  offsetUnit,
  outOfOrder,
  onChange,
}: {
  index: number;
  frame: AvatarEffectKeyframe;
  offsetUnit: PlacementUnit;
  outOfOrder: boolean;
  onChange: (frame: AvatarEffectKeyframe | null) => void;
}) {
  const label = `Keyframe ${index + 1}`;
  const setOffset = (axis: "x" | "y", value: number | null) => {
    const offset = { x: frame.offset?.x ?? 0, y: frame.offset?.y ?? 0 };
    if (value === null && (frame.offset?.[axis === "x" ? "y" : "x"] ?? 0) === 0)
      return onChange({ ...frame, offset: null });
    onChange({ ...frame, offset: { ...offset, [axis]: value ?? 0 } });
  };
  return (
    <li
      aria-label={label}
      className={cn(
        "border-border/70 rounded-lg border p-2",
        outOfOrder && "border-destructive",
      )}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium">{label}</span>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={`Remove ${label.toLowerCase()}`}
          onClick={() => onChange(null)}
        >
          <Trash2Icon />
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <OptionalNumber
          label="Time (s)"
          value={frame.t}
          required
          min={0}
          max={600}
          step={0.1}
          onChange={(value) => onChange({ ...frame, t: value ?? 0 })}
        />
        <OptionalNumber
          label="Opacity (%)"
          value={frame.opacity == null ? null : frame.opacity * 100}
          min={0}
          max={100}
          step={5}
          onChange={(value) =>
            onChange({
              ...frame,
              opacity:
                value === null ? null : Math.min(1, Math.max(0, value / 100)),
            })
          }
        />
        <OptionalNumber
          label="Size (×)"
          value={frame.scale ?? null}
          min={0.01}
          max={20}
          step={0.05}
          onChange={(value) =>
            onChange({
              ...frame,
              scale:
                value === null ? null : Math.min(20, Math.max(0.01, value)),
            })
          }
        />
        <OptionalNumber
          label="Turn (°)"
          value={frame.rotationDeg ?? null}
          min={-3600}
          max={3600}
          step={5}
          onChange={(value) => onChange({ ...frame, rotationDeg: value })}
        />
        <OptionalNumber
          label={`Move X (${offsetUnit.label})`}
          value={
            frame.offset ? (frame.offset.x ?? 0) * offsetUnit.factor : null
          }
          step={offsetUnit.step}
          onChange={(value) =>
            setOffset("x", value === null ? null : value / offsetUnit.factor)
          }
        />
        <OptionalNumber
          label={`Move Y (${offsetUnit.label})`}
          value={
            frame.offset ? (frame.offset.y ?? 0) * offsetUnit.factor : null
          }
          step={offsetUnit.step}
          onChange={(value) =>
            setOffset("y", value === null ? null : value / offsetUnit.factor)
          }
        />
      </div>
    </li>
  );
}

/** A number input that may be left empty (the channel is then unset). */
function OptionalNumber({
  label,
  value,
  required = false,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number | null;
  required?: boolean;
  min?: number;
  max?: number;
  step: number;
  onChange: (value: number | null) => void;
}) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id} labelClassName="text-[11px]">
      <Input
        id={id}
        className="h-8 px-2 text-xs"
        type="number"
        aria-label={label}
        placeholder={required ? undefined : "—"}
        value={value === null ? "" : Number(value.toFixed(3))}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === "") {
            if (!required) onChange(null);
            return;
          }
          const next = event.target.valueAsNumber;
          if (Number.isFinite(next)) onChange(next);
        }}
      />
    </Field>
  );
}
