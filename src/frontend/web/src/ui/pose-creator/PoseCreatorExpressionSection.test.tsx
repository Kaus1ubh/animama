import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Avatar } from "@/lib/avatar";
import { usePoseCreatorStore } from "@/stores/pose-creator-store";
import { PoseCreatorExpressionSection } from "./PoseCreatorExpressionSection";

vi.mock("@/stores/pose-creator-store", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/stores/pose-creator-store")>();
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
beforeEach(() => usePoseCreatorStore.getState().resetWorkspace());

describe("PoseCreatorExpressionSection", () => {
  it("renders reusable expression controls without duplicate panel chrome", () => {
    const html = renderToStaticMarkup(
      <PoseCreatorExpressionSection variant="mobile" embedded />,
    );

    expect(html).toContain('aria-label="Search expressions"');
    expect(html).not.toContain("<h2");
  });

  it("keeps expression drafts and controlled timeline values live", () => {
    usePoseCreatorStore.setState({
      activeAvatar: {
        getAvailableExpressions: () => ["happy"],
        getExpressionValue: () => 0,
      } as unknown as Avatar,
    });
    let html = renderToStaticMarkup(
      <PoseCreatorExpressionSection variant="workspace" />,
    );
    expect(html).toContain(">0%<");
    usePoseCreatorStore
      .getState()
      .setExpressionDraft("happy", { baseValue: 0, value: 0.75 });
    html = renderToStaticMarkup(
      <PoseCreatorExpressionSection variant="workspace" />,
    );
    expect(html).toContain(">75%<");
    html = renderToStaticMarkup(
      <PoseCreatorExpressionSection
        variant="workspace"
        timelineValues={{ happy: 0.25 }}
      />,
    );
    expect(html).toContain(">25%<");
    expect(html).not.toContain(">75%<");
  });
});
