import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CreateAnimaNamePlate } from "./CreateAnimaNamePlate";

describe("global Anima name plate", () => {
  it("renders a larger field, counts Unicode code points, and links its error", () => {
    const html = renderToStaticMarkup(
      <CreateAnimaNamePlate
        value={`Ren ${"😀".repeat(36)}`}
        limit={40}
        invalid
        readOnly={false}
        onChange={vi.fn()}
      />,
    );
    expect(html.match(/<input/g)).toHaveLength(1);
    expect(html).toContain('id="creation-display-name"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("40 / 40");
    expect(html).toContain("w-[min(92%,520px)]");
    expect(html).toContain("Use 1–40 characters without control characters.");
  });

  it("shows a direct visible error when the required name is missing", () => {
    const html = renderToStaticMarkup(
      <CreateAnimaNamePlate
        value=""
        limit={40}
        invalid
        readOnly={false}
        onChange={vi.fn()}
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("Enter a name to continue.");
    expect(html).toContain('placeholder="Enter a name"');
    expect(html).toContain("ring-destructive/20");
  });
});
