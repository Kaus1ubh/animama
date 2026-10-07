import { describe, expect, it } from "vitest";

import {
  avatarEffectDefinition,
  createDefaultAvatarEffectDocument,
} from "@/lib/avatar/vfx/editor";
import {
  addAvatarEffectKeyframe,
  avatarEffectKeyframeOrderError,
  resolvedAvatarEffectMotion,
  toggleAvatarEffectMotion,
  updateAvatarEffectKeyframe,
} from "./animationControls";

describe("Avatar Effect motion controls", () => {
  it("combines presets and disables only the selected one", () => {
    const pulse = { pulse: { scaleMin: 0.7, scaleMax: 1.3 } };
    const all = toggleAvatarEffectMotion(
      toggleAvatarEffectMotion(pulse, "spin", true),
      "drift",
      true,
    );
    expect(all.pulse).toEqual(pulse.pulse);
    expect(Object.keys(all).sort()).toEqual(["drift", "pulse", "spin"]);
    const withoutPulse = toggleAvatarEffectMotion(all, "pulse", false);
    expect(withoutPulse).not.toHaveProperty("pulse");
    expect(withoutPulse).toHaveProperty("spin");
    // Re-enabling keeps nothing from before; turning on adds starting values.
    expect(
      toggleAvatarEffectMotion(
        toggleAvatarEffectMotion(withoutPulse, "spin", false),
        "drift",
        false,
      ),
    ).toEqual({});
  });

  it("shows playback defaults for preset values the definition leaves out", () => {
    const resolved = resolvedAvatarEffectMotion({ spin: { amountTurns: 0.2 } });
    expect(resolved.spin).toMatchObject({
      enabled: true,
      amountTurns: 0.2,
      direction: "counterclockwise",
    });
    expect(resolved.spin.degreesPerSecond).toBeCloseTo(68.75, 1);
    expect(resolved.pulse.enabled).toBe(false);
  });

  it("adds, edits and removes keyframes, saving only the channels set", () => {
    let motion = addAvatarEffectKeyframe({});
    motion = addAvatarEffectKeyframe(motion);
    motion = updateAvatarEffectKeyframe(motion, 1, {
      t: 0.5,
      scale: 1.5,
      opacity: null,
    });
    const document = {
      ...createDefaultAvatarEffectDocument(),
      motion,
    };
    expect(avatarEffectDefinition(document).motion).toEqual({
      keyframes: {
        frames: [
          { t: 0, opacity: 1 },
          { t: 0.5, scale: 1.5 },
        ],
      },
    });
    expect(avatarEffectKeyframeOrderError(motion)).toBe(-1);
    const unordered = updateAvatarEffectKeyframe(motion, 1, { t: 0 });
    expect(avatarEffectKeyframeOrderError(unordered)).toBe(1);
    expect(
      updateAvatarEffectKeyframe(
        updateAvatarEffectKeyframe(motion, 1, null),
        0,
        null,
      ),
    ).toEqual({});
  });
});
