import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SceneCameraPresetControl } from "./SceneCameraPresetControl";

describe("camera preset dropdown", () => {
  it("offers all presets directly and shows the active selection", () => {
    const html = renderToStaticMarkup(
      <SceneCameraPresetControl preset="portrait" onApplyPreset={vi.fn()} />,
    );
    expect(html).toContain('aria-label="Camera preset"');
    expect(html.match(/<option /g)).toHaveLength(4);
    expect(html).toContain('value="portrait" selected=""');
    expect(html).not.toContain("Previous camera preset");
    expect(html).not.toContain("Next camera preset");
  });

  it("represents a custom camera without making Custom an applicable preset", () => {
    const html = renderToStaticMarkup(
      <SceneCameraPresetControl preset={null} onApplyPreset={vi.fn()} />,
    );
    expect(html).toContain('value="custom" disabled="" selected=""');
    expect(html).toContain("Full body (close)");
    expect(html).toContain("Portrait (close)");
  });
});
