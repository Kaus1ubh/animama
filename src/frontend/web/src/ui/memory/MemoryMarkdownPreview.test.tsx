import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MemoryMarkdownPreview } from "./MemoryMarkdownPreview";

describe("MemoryMarkdownPreview identity heading presentation", () => {
  it("hides only the leading H1 matching its rendered display name", () => {
    const html = renderToStaticMarkup(
      <MemoryMarkdownPreview
        value={
          "# **Annie** &amp; [Ray](https://example.com)\n\nA companion.\n\n# Annie & Ray"
        }
        hideLeadingHeading="Annie & Ray"
      />,
    );
    expect(html).not.toContain("<strong>Annie</strong>");
    expect(html).toContain("<p>A companion.</p>");
    expect(html).toContain("<h1>Annie &amp; Ray</h1>");
  });

  it.each([
    ["# Annie", undefined],
    ["# Annie's story", "Annie"],
    ["# annie", "Annie"],
    ["An introduction.\n\n# Annie", "Annie"],
    ["## Annie", "Annie"],
  ])("keeps a meaningful heading in %s", (value, hideLeadingHeading) => {
    const html = renderToStaticMarkup(
      <MemoryMarkdownPreview
        value={value}
        hideLeadingHeading={hideLeadingHeading}
      />,
    );
    expect(html).toMatch(/<h[12]>/);
  });

  it("supports a leading setext heading and keeps sanitized content", () => {
    const value =
      "  \nAnnie\n=====\n\n<script>alert('bad')</script>\n\n[unsafe](javascript:alert)\n\n![portrait](https://example.com/a.png)";
    const html = renderToStaticMarkup(
      <MemoryMarkdownPreview
        value={value}
        hideLeadingHeading="Annie"
        allowImages={false}
      />,
    );
    expect(html).not.toContain("<h1>");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain("[Image: portrait]");
    expect(value).toContain("Annie\n=====");
  });
});
