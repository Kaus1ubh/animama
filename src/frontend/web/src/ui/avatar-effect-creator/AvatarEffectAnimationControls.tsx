import { resolveAvatarVFXAnimationConfig } from "@/lib/avatar/vfx/animation";
import type { AvatarVFXAnimationConfig } from "@/lib/avatar/vfx/types";
import {
  CreatorField as Field,
  CreatorNumberField as NumberField,
  CreatorToggleRow as Toggle,
} from "@/ui/content-creator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/select";
import { toggleAvatarEffectAnimation } from "./animationControls";

/** Edit independent motion parameters using the same defaults as playback. */
export function AvatarEffectAnimationControls({
  config,
  onChange,
}: {
  config: AvatarVFXAnimationConfig | null;
  onChange: (config: AvatarVFXAnimationConfig | null) => void;
}) {
  const resolved = resolveAvatarVFXAnimationConfig(config);
  const patch = (values: Partial<AvatarVFXAnimationConfig>) =>
    onChange({ ...config, ...values });
  return (
    <>
      <Toggle
        label="Pulse"
        checked={resolved.pulseEnabled}
        onChecked={(enabled) =>
          onChange(toggleAvatarEffectAnimation(config, "pulse", enabled))
        }
      />
      {resolved.pulseEnabled && (
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="Minimum scale"
            value={resolved.pulseScaleMin}
            min={0.001}
            step={0.05}
            decimalPlaces={3}
            onChange={(value) =>
              patch({
                pulseScaleMin: Math.max(
                  0.001,
                  Math.min(value, resolved.pulseScaleMax),
                ),
              })
            }
          />
          <NumberField
            label="Maximum scale"
            value={resolved.pulseScaleMax}
            min={resolved.pulseScaleMin}
            step={0.05}
            decimalPlaces={3}
            onChange={(value) =>
              patch({ pulseScaleMax: Math.max(resolved.pulseScaleMin, value) })
            }
          />
          <NumberField
            label="Pulse speed (cycles/s)"
            value={resolved.pulseCyclesPerSecond}
            min={0}
            step={0.1}
            decimalPlaces={1}
            onChange={(value) =>
              patch({ pulseCyclesPerSecond: Math.max(0, value) })
            }
          />
        </div>
      )}
      <Toggle
        label="Spin"
        checked={resolved.spinEnabled}
        onChecked={(enabled) =>
          onChange(toggleAvatarEffectAnimation(config, "spin", enabled))
        }
      />
      {resolved.spinEnabled && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="Spin speed (turns/s)"
              value={resolved.rotationRadiansPerSecond / (2 * Math.PI)}
              min={0}
              step={0.05}
              decimalPlaces={2}
              onChange={(value) =>
                patch({
                  rotationRadiansPerSecond: Math.max(0, value) * 2 * Math.PI,
                })
              }
            />
            <NumberField
              label="Rotation range (turns)"
              value={resolved.rotationAmountTurns}
              min={0}
              max={1}
              step={0.05}
              decimalPlaces={2}
              onChange={(value) =>
                patch({ rotationAmountTurns: Math.min(1, Math.max(0, value)) })
              }
            />
          </div>
          <Field label="Spin direction">
            <Select
              value={resolved.rotationDirection}
              onValueChange={(value) =>
                patch({
                  rotationDirection: value as "clockwise" | "counterclockwise",
                })
              }
            >
              <SelectTrigger size="sm" className="w-full text-xs">
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
            Below one turn, rotation rocks back and forth. One turn spins
            continuously.
          </p>
        </div>
      )}
      <Toggle
        label="Drift"
        checked={resolved.driftEnabled}
        onChecked={(enabled) =>
          onChange(toggleAvatarEffectAnimation(config, "drift", enabled))
        }
      />
      {resolved.driftEnabled && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="Drift X per second"
              value={resolved.driftPerSecond.x}
              step={0.01}
              decimalPlaces={2}
              onChange={(value) =>
                patch({
                  driftPerSecond: { ...resolved.driftPerSecond, x: value },
                })
              }
            />
            <NumberField
              label="Drift Y per second"
              value={resolved.driftPerSecond.y}
              step={0.01}
              decimalPlaces={2}
              onChange={(value) =>
                patch({
                  driftPerSecond: { ...resolved.driftPerSecond, y: value },
                })
              }
            />
          </div>
          <p className="text-muted-foreground text-xs">
            Continuous movement from the starting position. Negative values
            reverse direction; visible distance depends on the effect type.
          </p>
        </div>
      )}
    </>
  );
}
