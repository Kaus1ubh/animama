import type {
  AvatarEffectKeyframe,
  AvatarEffectMotion,
} from "@animama/runtime-contracts/api-types";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";

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
import {
  placementUnitLabel,
  type PlacementUnit,
} from "./avatarEffectPlacement";

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
  const { t } = useTranslation("effects");
  const resolved = resolvedAvatarEffectMotion(motion);
  const patch = <K extends "pulse" | "spin" | "drift">(
    preset: K,
    values: NonNullable<AvatarEffectMotion[K]>,
  ) => onChange({ ...motion, [preset]: { ...motion[preset], ...values } });
  return (
    <>
      <Toggle
        label={t("avatar.motion.pulse")}
        description={t("avatar.motion.pulseHint")}
        checked={resolved.pulse.enabled}
        onChecked={(enabled) =>
          onChange(toggleAvatarEffectMotion(motion, "pulse", enabled))
        }
      />
      {resolved.pulse.enabled && (
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label={t("avatar.motion.smallest")}
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
            label={t("avatar.motion.largest")}
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
            label={t("avatar.motion.pulsesPerSecond")}
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
        label={t("avatar.motion.spin")}
        description={t("avatar.motion.spinHint")}
        checked={resolved.spin.enabled}
        onChecked={(enabled) =>
          onChange(toggleAvatarEffectMotion(motion, "spin", enabled))
        }
      />
      {resolved.spin.enabled && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label={t("avatar.motion.spinSpeed")}
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
              label={t("avatar.motion.spinRange")}
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
          <Field label={t("avatar.motion.direction")}>
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
                aria-label={t("avatar.motion.spinDirection")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="clockwise">
                  {t("avatar.motion.clockwise")}
                </SelectItem>
                <SelectItem value="counterclockwise">
                  {t("avatar.motion.counterclockwise")}
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <p className="text-muted-foreground text-xs">
            {t("avatar.motion.spinRangeHint")}
          </p>
        </div>
      )}
      <Toggle
        label={t("avatar.motion.drift")}
        description={t("avatar.motion.driftHint")}
        checked={resolved.drift.enabled}
        onChecked={(enabled) =>
          onChange(toggleAvatarEffectMotion(motion, "drift", enabled))
        }
      />
      {resolved.drift.enabled && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label={t("avatar.motion.driftX")}
              value={resolved.drift.x}
              min={-10}
              max={10}
              step={0.01}
              decimalPlaces={2}
              onChange={(value) => patch("drift", { x: value })}
            />
            <NumberField
              label={t("avatar.motion.driftY")}
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
  const { t } = useTranslation("effects");
  const frames = motion.keyframes?.frames ?? [];
  const orderError = avatarEffectKeyframeOrderError(motion);
  return (
    <section
      aria-label={t("avatar.keyframes.title")}
      className={cn(
        "space-y-2 border-t pt-3",
        invalid && "ring-destructive/40 rounded-lg p-2 ring-1",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-medium">{t("avatar.keyframes.title")}</h3>
          <p className="text-muted-foreground text-xs">
            {t("avatar.keyframes.help")}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={frames.length >= MAX_AVATAR_EFFECT_KEYFRAMES}
          onClick={() => onChange(addAvatarEffectKeyframe(motion))}
        >
          <PlusIcon /> {t("avatar.keyframes.add")}
        </Button>
      </div>
      {frames.length ? (
        <>
          <Toggle
            label={t("avatar.keyframes.repeat")}
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
              {t("avatar.keyframes.order", {
                index: orderError + 1,
                previous: orderError,
              })}
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
  const { t } = useTranslation("effects");
  const label = t("avatar.keyframes.label", { index: index + 1 });
  const unit = placementUnitLabel(t, offsetUnit);
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
          aria-label={t("avatar.keyframes.remove", { index: index + 1 })}
          onClick={() => onChange(null)}
        >
          <Trash2Icon />
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <OptionalNumber
          label={t("avatar.keyframes.time")}
          value={frame.t}
          required
          min={0}
          max={600}
          step={0.1}
          onChange={(value) => onChange({ ...frame, t: value ?? 0 })}
        />
        <OptionalNumber
          label={t("avatar.keyframes.opacity")}
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
          label={t("avatar.keyframes.scale")}
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
          label={t("avatar.keyframes.turn")}
          value={frame.rotationDeg ?? null}
          min={-3600}
          max={3600}
          step={5}
          onChange={(value) => onChange({ ...frame, rotationDeg: value })}
        />
        <OptionalNumber
          label={t("avatar.keyframes.moveX", { unit })}
          value={
            frame.offset ? (frame.offset.x ?? 0) * offsetUnit.factor : null
          }
          step={offsetUnit.step}
          onChange={(value) =>
            setOffset("x", value === null ? null : value / offsetUnit.factor)
          }
        />
        <OptionalNumber
          label={t("avatar.keyframes.moveY", { unit })}
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
