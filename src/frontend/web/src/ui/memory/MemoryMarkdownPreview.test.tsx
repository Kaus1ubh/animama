import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MemoryMarkdownPreview } from "./MemoryMarkdownPreview";

describe("MemoryMarkdownPreview identity heading presentation", () => {
  it("preserves the leading H1 and its inline formatting", () => {
    const html = renderToStaticMarkup(
      <MemoryMarkdownPreview
        value={
          "# **Annie** &amp; [Ray](https://example.com)\n\nA companion.\n\n# Annie & Ray"
        }
      />,
    );
    expect(html).toContain("<h1><strong>Annie</strong>");
    expect(html).toContain("<p>A companion.</p>");
    expect(html).toContain("<h1>Annie &amp; Ray</h1>");
  });

  it("supports a leading setext heading and keeps sanitized content", () => {
    const value =
      "  \nAnnie\n=====\n\n<script>alert('bad')</script>\n\n[unsafe](javascript:alert)\n\n![portrait](https://example.com/a.png)";
    const html = renderToStaticMarkup(
      <MemoryMarkdownPreview value={value} allowImages={false} />,
    );
    expect(html).toContain("<h1>Annie</h1>");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain("[Image: portrait]");
    expect(value).toContain("Annie\n=====");
  });
});
