import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { PyReaction } from "@/lib/content/catalogTypes";
import { ReactionChoice } from "./ReactionLoadoutGrid";

vi.mock("@/ui/components/command", () => ({
  CommandItem: ({
    children,
    value,
  }: {
    children: React.ReactNode;
    value: string;
  }) => <div data-value={value}>{children}</div>,
}));

function renderChoice(
  emotion: string | null,
  intensity: PyReaction["intensity"],
) {
  const reaction: PyReaction = {
    name: "Custom reaction",
    item_id: "reaction-test",
    description: null,
    origin: "owned",
    source: {
      type: "catalog",
      catalog_item_id: "reaction-test",
      logical_key: "local:reaction:test",
    },
    state: "ready",
    created_at: null,
    updated_at: null,
    emotion,
    intensity,
  };
  return renderToString(
    <ReactionChoice
      reaction={reaction}
      selected={false}
      disabled={false}
      onSelect={() => undefined}
      onPreview={() => undefined}
    />,
  );
}

it("does not invent a mild suggestion for unassigned reaction choices", () => {
  const html = renderChoice(null, null);
  expect(html).toContain("Custom reaction");
  expect(html).not.toContain("Mild");
  expect(html).not.toContain("null");
  expect(html).not.toContain(" · ");
});
it("preserves the suggested placement context for assigned reactions", () => {
  expect(renderChoice("joy", 2)).toContain("joy · Moderate");
});
