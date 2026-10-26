import { describe, expect, it } from "vitest";

import {
  DEFAULT_PIP_SCENE_CAMERA_PRESET,
  isSceneCameraPreset,
} from "./sceneCameraPresets";

describe("scene camera presets", () => {
  it("frames PiP close on the face by default", () => {
    expect(DEFAULT_PIP_SCENE_CAMERA_PRESET).toBe("portrait-close");
  });

  it("accepts only chat presets from untrusted input", () => {
    expect(isSceneCameraPreset("portrait")).toBe(true);
    expect(isSceneCameraPreset("portrait-three-quarter")).toBe(false);
    expect(isSceneCameraPreset({ preset: "portrait" })).toBe(false);
  });
});
