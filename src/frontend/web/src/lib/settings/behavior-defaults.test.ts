import { describe, expect, it } from "vitest";

import {
  animaBehaviorOverride,
  appBehaviorEnabled,
  behaviorPatch,
  effectiveBehaviorEnabled,
} from "./behavior-defaults";
import { mergePreferences } from "./preferences";

describe("memory and emotion behaviour defaults", () => {
  it("defaults to enabled when nothing is stored", () => {
    expect(appBehaviorEnabled({}, "memory_influence")).toBe(true);
    expect(animaBehaviorOverride({}, "emotion_updates")).toBe("inherit");
  });

  it("follows the App Settings value until an Anima overrides it", () => {
    const app = { memory: { disable_updates: true } };
    expect(effectiveBehaviorEnabled(app, {}, "memory_updates")).toBe(false);
    expect(
      effectiveBehaviorEnabled(
        app,
        { memory: { disable_updates: false } },
        "memory_updates",
      ),
    ).toBe(true);
  });

  it("removes the Anima value when switching back to the app default", () => {
    const anima = mergePreferences(
      { memory: { disable_influence: true, disable_updates: true } },
      behaviorPatch("memory_influence", "inherit"),
    );
    const stored = JSON.parse(JSON.stringify(anima));
    expect(animaBehaviorOverride(stored, "memory_influence")).toBe("inherit");
    // Updates keep their own explicit value.
    expect(animaBehaviorOverride(stored, "memory_updates")).toBe("off");
  });

  it("turns memory updates off with memory influence", () => {
    expect(behaviorPatch("memory_influence", "off")).toEqual({
      memory: { disable_influence: true, disable_updates: true },
    });
    expect(behaviorPatch("memory_influence", "on")).toEqual({
      memory: { disable_influence: false },
    });
  });
});
