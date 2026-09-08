import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PoseCreatorExpressionSection } from "./PoseCreatorExpressionSection";

describe("PoseCreatorExpressionSection", () => {
  it("renders reusable expression controls without duplicate panel chrome", () => {
    const html = renderToString(
      <PoseCreatorExpressionSection variant="mobile" embedded />,
    );

    expect(html).toContain('aria-label="Search expressions"');
    expect(html).not.toContain("<h2");
  });
});
