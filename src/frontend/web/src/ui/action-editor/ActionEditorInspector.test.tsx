import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ActionEditorClipInspector } from "./ActionEditorPrimitives";

describe("ActionEditorClipInspector capabilities", () => {
  it("retains humanoid clip controls for Gestures", () => {
    const html = renderToString(<ActionEditorClipInspector allowHumanoid />);

    expect(html).toContain("Clip base pose");
    expect(html).not.toContain("Return to base");
  });

  it("removes humanoid clip settings from Reactions", () => {
    const html = renderToString(
      <ActionEditorClipInspector allowHumanoid={false} />,
    );

    expect(html).not.toContain("Return to base");
    expect(html).not.toContain("Clip base pose");
  });
});
