import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CreateAnimaStepNav } from "./CreateAnimaStepNav";

describe("Anima creation progress", () => {
  it("uses styling instead of visible attention copy and joins completed steps in blue", () => {
    const html = renderToStaticMarkup(
      <CreateAnimaStepNav
        step={2}
        disabled={false}
        attention={[1]}
        onStep={vi.fn()}
      />,
    );

    expect(html).not.toContain("Needs attention");
    expect(html).toContain('aria-label="Identity, needs attention"');
    expect(html).toContain("border-destructive text-destructive");
    expect(html).toContain('aria-label="Avatar, completed"');
    expect(html).toContain("gap-0");
    expect(html).toContain("border-primary");
    expect(html).toContain("bg-primary/15");
    expect(html).not.toContain("emerald");
  });
});
