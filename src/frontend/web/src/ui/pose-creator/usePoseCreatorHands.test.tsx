import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Avatar } from "@/lib/avatar";
import { usePoseCreatorStore } from "@/stores/pose-creator-store";
import { usePoseCreatorHands } from "./usePoseCreatorHands";
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
function Eligibility({ enabled }: { enabled: boolean }) {
  const hands = usePoseCreatorHands(enabled);
  return <output>{String(hands.canEdit)}</output>;
}
afterEach(() => usePoseCreatorStore.getState().resetWorkspace());
describe("Hands workspace eligibility", () => {
  it("permits active inline keyframes in Clip mode but excludes ordinary clip playback and other routes", () => {
    usePoseCreatorStore.setState({
      authoringMode: "clip",
      loadStatus: "ready",
      activeAvatar: {
        vrm: { humanoid: { getNormalizedBoneNode: () => null } },
      } as unknown as Avatar,
    });
    expect(renderToStaticMarkup(<Eligibility enabled />)).toContain(">false<");
    usePoseCreatorStore
      .getState()
      .beginClipInlinePoseEdit({
        alias: "hand",
        keyframeId: "frame",
        originalPose: { humanoid: {} },
        boneDrafts: {},
        expressionDrafts: {},
        draftName: "Hand",
      });
    expect(usePoseCreatorStore.getState().authoringMode).toBe("clip");
    expect(renderToStaticMarkup(<Eligibility enabled />)).toContain(">true<");
    expect(renderToStaticMarkup(<Eligibility enabled={false} />)).toContain(
      ">false<",
    );
  });
});
