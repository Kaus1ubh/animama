import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ActionEditorClipInspector } from "./ActionEditorPrimitives";

describe("ActionEditorClipInspector capabilities", () => {
  it("retains humanoid clip controls for Gestures", () => {
    const html = renderToString(<ActionEditorClipInspector allowHumanoid />);

    expect(html).toContain("Clip base pose");
    expect(html).toContain('aria-label="Start base"');
    expect(html).toContain('aria-label="End base"');
    expect(html).not.toContain("Return to base");
  });

  it("keeps endpoint toggles in the settings section", () => {
    const settings = renderToString(
      <ActionEditorClipInspector section="settings" />,
    );
    const selectedItem = renderToString(
      <ActionEditorClipInspector section="inspector" />,
    );
    expect(settings).toContain('aria-label="Start base"');
    expect(settings).toContain('aria-label="End base"');
    expect(selectedItem).not.toContain("Start base");
    expect(selectedItem).not.toContain("End base");
  });

  it("removes humanoid clip settings from Reactions", () => {
    const html = renderToString(
      <ActionEditorClipInspector allowHumanoid={false} />,
    );

    expect(html).not.toContain("Return to base");
    expect(html).not.toContain("Clip base pose");
    expect(html).not.toContain("Start base");
    expect(html).not.toContain("End base");
  });
});
