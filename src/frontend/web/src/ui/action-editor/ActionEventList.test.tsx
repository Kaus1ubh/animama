import { renderToString } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { usePoseCreatorStore } from "@/stores/pose-creator-store";
import { ActionEventList } from "./ActionEventList";

vi.mock("@/stores/pose-creator-store", async (original) => {
  const actual = await original<typeof import("@/stores/pose-creator-store")>();
  return {
    ...actual,
    usePoseCreatorStore: Object.assign(
      (
        selector: (
          state: ReturnType<typeof actual.usePoseCreatorStore.getState>,
        ) => unknown,
      ) => selector(actual.usePoseCreatorStore.getState()),
      actual.usePoseCreatorStore,
    ),
  };
});
vi.mock("./ActionEditorWorkspaceContext", () => ({
  useActionEditorWorkspace: () => ({
    document: { intent: "reaction", dependencies: [] },
    dependencySections: [],
  }),
}));
beforeEach(() => usePoseCreatorStore.getState().resetWorkspace());

it("does not show an empty timeline list", () => {
  expect(renderToString(<ActionEventList />)).toBe("");
});
it("lists individual events and keyframes in chronological order with selection", () => {
  usePoseCreatorStore.setState((state) => ({
    clipDraft: {
      ...state.clipDraft,
      events: [
        { id: "later", kind: "avatar_vfx", effectId: "eyes", time: 1 },
        { id: "first", kind: "avatar_vfx", effectId: "eyes", time: 0 },
      ],
      keyframes: [{ id: "expression", pose: "smile", time: 0.5 }],
      selectedEventId: "later",
    },
  }));
  const html = renderToString(<ActionEventList />).replace(/<!--.*?-->/g, "");
  expect(html.indexOf("0.00s")).toBeLessThan(html.indexOf("0.50s"));
  expect(html.indexOf("0.50s")).toBeLessThan(html.indexOf("1.00s"));
  expect(html.match(/<li>/g)).toHaveLength(3);
  expect(html).toContain('aria-pressed="true"');
  expect(html).toContain("Expression");
});
