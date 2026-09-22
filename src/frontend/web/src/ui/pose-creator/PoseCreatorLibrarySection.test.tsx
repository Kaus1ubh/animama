import type { FormEvent, ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePoseCreatorStore } from "@/stores/pose-creator-store";
import { PoseCreatorLibrarySection } from "./PoseCreatorLibrarySection";
import { buildPoseCreatorAnimaPoseForExport } from "./poseCreatorAuthoring";

type State = ReturnType<typeof usePoseCreatorStore.getState>;
const harness = vi.hoisted(() => ({
  selectors: [] as Array<(state: State) => unknown>,
  submit: null as ((event: FormEvent) => void) | null,
}));

// SSR supplies the actual component selectors and event closures; the live
// store lets us check which subscriptions would invalidate a mounted toolbar.
vi.mock("@/stores/pose-creator-store", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/stores/pose-creator-store")>();
  return {
    ...actual,
    usePoseCreatorStore: Object.assign(
      (selector: (state: State) => unknown) => {
        harness.selectors.push(selector);
        return selector(actual.usePoseCreatorStore.getState());
      },
      actual.usePoseCreatorStore,
    ),
  };
});
vi.mock("@/ui/content-creator/CreatorHeaderDocument", () => ({
  CreatorHeaderDocument: ({
    children,
  }: {
    children: ReactElement<{ onSubmit: (event: FormEvent) => void }>;
  }) => {
    harness.submit = children.props.onSubmit;
    return children;
  },
}));
vi.mock("./poseCreatorAuthoring", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./poseCreatorAuthoring")>();
  return {
    ...actual,
    buildPoseCreatorAnimaPoseForExport: vi.fn(
      actual.buildPoseCreatorAnimaPoseForExport,
    ),
  };
});

const armDraft = (x: number) => ({
  baseQuaternion: [0, 0, 0, 1] as [number, number, number, number],
  rotationDegrees: { x, y: 0, z: 0 },
});

beforeEach(() => {
  usePoseCreatorStore.getState().resetWorkspace();
  usePoseCreatorStore.setState({ savedDrafts: [] });
  usePoseCreatorStore.getState().setBoneDraft("leftUpperArm", armDraft(10));
  usePoseCreatorStore.getState().beginPoseUndoGroup();
  harness.selectors = [];
  harness.submit = null;
});

describe("Pose toolbar during bone rotation", () => {
  it.each(["standalone", "inline"])(
    "keeps subscriptions stable during %s edits with the JSON view closed",
    (mode) => {
      if (mode === "inline") {
        usePoseCreatorStore.getState().beginClipInlinePoseEdit({
          alias: "wave",
          keyframeId: "keyframe-1",
          originalPose: {
            humanoid: { leftUpperArm: { rotation: [0, 0, 0, 1] } },
          },
          boneDrafts: { leftUpperArm: armDraft(10) },
          expressionDrafts: {},
          draftName: "Wave",
        });
        usePoseCreatorStore.getState().beginClipUndoGroup();
      }
      const html = renderToString(
        <PoseCreatorLibrarySection variant="toolbar" />,
      );
      const before = usePoseCreatorStore.getState();
      const values = harness.selectors.map((select) => select(before));

      for (let x = 11; x <= 20; x++) {
        usePoseCreatorStore
          .getState()
          .setBoneDraft("leftUpperArm", armDraft(x));
        const after = usePoseCreatorStore.getState();
        expect(harness.selectors.map((select) => select(after))).toEqual(
          values,
        );
        expect(
          harness.selectors.every((select, index) =>
            Object.is(select(after), values[index]),
          ),
        ).toBe(true);
      }

      expect(html).toContain('aria-label="View pose JSON"');
      expect(buildPoseCreatorAnimaPoseForExport).not.toHaveBeenCalled();
    },
  );

  it("saves the latest rotation even when the toolbar has not rendered again", () => {
    usePoseCreatorStore.setState({
      selectedSource: {
        key: "test-avatar",
        sourceType: "resolved_entry",
        animaId: "test-anima",
        effectiveRevision: "runtime-1",
        contentRevision: "model-1",
        displayName: "Test avatar",
        versionLabel: "Built-in v1",
        sourceLabel: "Preview Anima",
        runtimeId: "primary",
        configSchemaVersion: 1,
        config: {},
      },
    });
    renderToString(<PoseCreatorLibrarySection variant="toolbar" />);
    usePoseCreatorStore.getState().setBoneDraft("leftUpperArm", armDraft(90));
    harness.submit!({
      preventDefault: () => undefined,
      nativeEvent: {},
    } as FormEvent);

    const pose = usePoseCreatorStore.getState().savedDrafts.at(-1)?.pose;
    expect(pose?.humanoid?.leftUpperArm?.rotation?.[0]).toBeCloseTo(
      Math.SQRT1_2,
    );
    expect(pose?.humanoid?.leftUpperArm?.rotation?.[3]).toBeCloseTo(
      Math.SQRT1_2,
    );
  });

  it("retains JSON generation for the explicit data panel", () => {
    renderToString(<PoseCreatorLibrarySection variant="panel" />);
    expect(buildPoseCreatorAnimaPoseForExport).toHaveBeenCalledOnce();
  });
});
