import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  CreatorCollapsedPanelHeader,
  CreatorPanelCollapseButton,
} from "./CreatorPanelChrome";

describe("creator panel chrome", () => {
  it("keeps a compact labelled header when a panel is collapsed", () => {
    const html = renderToString(
      <CreatorCollapsedPanelHeader
        label="Components"
        summary="3 included"
        onExpand={() => undefined}
      />,
    );

    expect(html).toContain("Components");
    expect(html).toContain("3 included");
    expect(html).toContain('aria-label="Expand components"');
  });

  it("uses only vertical chevrons for integrated collapse controls", () => {
    const up = renderToString(
      <CreatorPanelCollapseButton
        label="components"
        expanded
        collapseDirection="up"
        onExpandedChange={() => undefined}
      />,
    );
    const down = renderToString(
      <CreatorPanelCollapseButton
        label="timeline"
        expanded
        collapseDirection="down"
        onExpandedChange={() => undefined}
      />,
    );

    expect(up).toContain('aria-label="Collapse components"');
    expect(down).toContain('aria-label="Collapse timeline"');
  });
});
