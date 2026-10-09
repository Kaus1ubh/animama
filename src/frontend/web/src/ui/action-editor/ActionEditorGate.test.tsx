import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { renderToStaticMarkup } from "@/test/runtime-markup";

const action = vi.hoisted(() => ({
  current: { isPending: false, data: undefined as unknown },
}));
vi.mock("@/query/hooks/useActions", () => ({
  useAction: () => action.current,
}));
vi.mock("@/ui/content-preview/ContentPreviewDockProvider", () => ({
  useContentPreviewDock: () => ({ openPreview: vi.fn() }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

import { ActionEditorGate } from "./ActionEditorGate";

const render = (itemId?: string) =>
  renderToStaticMarkup(
    <ActionEditorGate intent="gesture" itemId={itemId}>
      <p>editor</p>
    </ActionEditorGate>,
  );

describe("ActionEditorGate", () => {
  it("opens new and portable items in the editor", () => {
    action.current = { isPending: false, data: undefined };
    expect(render()).toContain("editor");
    action.current = {
      isPending: false,
      data: { name: "Wave", description: null, portability: "portable" },
    };
    expect(render("wave")).toContain("editor");
  });

  it("shows a non-portable item for preview only, never in the editor", () => {
    action.current = {
      isPending: false,
      data: {
        name: "Sway",
        description: "Gentle",
        portability: "non-portable",
      },
    };
    const page = render("sway");
    expect(page).not.toContain("editor");
    expect(page).toContain("Preview only");
    expect(page).toContain("Sway");
    expect(page).toContain("use here only");
    expect(page).toContain("Preview");
  });

  it("falls through to the editor when the item cannot be loaded", () => {
    action.current = { isPending: false, data: undefined };
    expect(render("missing")).toContain("editor");
  });

  it("gates Reactions the same way", () => {
    action.current = {
      isPending: false,
      data: { name: "Gasp", description: null, portability: "non-portable" },
    };
    const page = renderToStaticMarkup(
      <ActionEditorGate intent="reaction" itemId="gasp">
        <p>editor</p>
      </ActionEditorGate>,
    );
    expect(page).toContain("Preview only");
    expect(page).not.toContain("editor");
  });

  it("shows a loading status while the item loads", () => {
    action.current = { isPending: true, data: undefined };
    expect(render("sway")).toContain("Loading");
  });
});
