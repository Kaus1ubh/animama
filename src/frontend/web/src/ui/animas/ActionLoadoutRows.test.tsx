import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ActionLoadoutRow,
  ActionRowIdentity,
  ReactionIntensityBadge,
  reactionIntensityLabel,
} from "./ActionLoadoutRows";

describe("shared Action loadout presentation", () => {
  it("uses the same selected treatment, compact identity, and intensity language", () => {
    const html = renderToStaticMarkup(
      <ActionLoadoutRow selected role="listitem">
        <ActionRowIdentity name="Wave" description="Friendly greeting" />
        <ReactionIntensityBadge intensity={2} />
      </ActionLoadoutRow>,
    );
    expect(html).toContain("border-l-primary");
    expect(html).toContain("Wave");
    expect(html).toContain("Friendly greeting");
    expect(html).toContain("Moderate");
    expect(reactionIntensityLabel(1)).toBe("Mild");
    expect(reactionIntensityLabel("3")).toBe("Strong");
  });
});
