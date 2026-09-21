import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SceneCameraPanel } from "./SceneCameraPanel";
import { buildSceneCameraPreset } from "./sceneCameraPresets";

describe("fine-tune camera controls", () => {
  it("keeps numeric controls and fullscreen-safe bone choices without duplicating presets", () => {
    const state = buildSceneCameraPreset("full-body");
    const html = renderToStaticMarkup(
      <SceneCameraPanel
        {...state}
        onOrbitTargetYBoneChange={vi.fn()}
        onFovChange={vi.fn()}
        onPositionChange={vi.fn()}
        onPositionYBoneChange={vi.fn()}
        onReset={vi.fn()}
        onTargetChange={vi.fn()}
      />,
    );
    expect(html).toContain("Reset");
    expect(html).toContain('aria-label="Camera field of view"');
    expect(html).toContain("Camera Position");
    expect(html).toContain("Orbit Target");
    expect(html.match(/<select/g)).toHaveLength(2);
    expect(html.match(/<option/g)).toHaveLength(8);
    expect(html).not.toContain("Scene Camera");
    expect(html).not.toContain("Presets");
    expect(html).not.toContain("Full body");
  });
});
