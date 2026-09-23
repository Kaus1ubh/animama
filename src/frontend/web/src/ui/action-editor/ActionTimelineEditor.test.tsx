import { parseAnimaPoseClip } from "@/lib/avatar/poses/animaPoseClip";
import { usePoseCreatorStore } from "@/stores/pose-creator-store";
import { shouldShowPoseCreatorBoneGizmo } from "@/ui/pose-creator/poseCreatorBoneGizmoVisibility";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  isEmptyActionTimeline,
  ActionTimelineDocumentSync,
  ActionTimelineEditor,
  shouldPreserveTimelinePlayhead,
  shouldHydrateActionTimeline,
  shouldSkipActionTimelineEmission,
  syncActionTimelineMetadata,
} from "./ActionTimelineEditor";

let timelineProps: Record<string, unknown> | null = null;

vi.mock("@/ui/pose-creator/PoseCreatorClipTimeline", () => ({
  PoseCreatorClipTimeline: (props: Record<string, unknown>) => {
    timelineProps = props;
    return <div data-testid="timeline" />;
  },
}));

describe("ActionTimelineEditor", () => {
  it("keeps the active pose, selected bone, and gizmo when a document is renamed", () => {
    const sequence = {
      schema: "animaPoseClip/1.0",
      id: "original",
      name: "Original",
      duration: 1,
      poses: {
        start: { humanoid: { leftUpperArm: { rotation: [0, 0, 0, 1] } } },
      },
      poseKeyframes: [{ time: 0, pose: "start" }],
    };
    const store = usePoseCreatorStore.getState();
    store.resetWorkspace();
    store.hydrateClipDocument(parseAnimaPoseClip(sequence));
    const hydrated = usePoseCreatorStore.getState();
    store.beginClipInlinePoseEdit({
      alias: "start",
      keyframeId: hydrated.clipDraft.keyframes[0]!.id,
      originalPose: hydrated.clipDraft.poses.start!,
      boneDrafts: {},
      expressionDrafts: {},
      draftName: "Editing start",
    });
    store.setSelectedBone("head");
    store.setBoneDraft("head", {
      baseQuaternion: [0, 0, 0, 1],
      rotationDegrees: { x: 0, y: 25, z: 0 },
    });
    const before = usePoseCreatorStore.getState();

    expect(
      syncActionTimelineMetadata(
        { ...sequence, id: "renamed", name: "Renamed" },
        sequence,
      ),
    ).toBe(true);
    const after = usePoseCreatorStore.getState();
    expect(after.clipDraft.name).toBe("Renamed");
    expect(after.clipDraft.id).toBe("renamed");
    expect(after.clipInlineEdit).toBe(before.clipInlineEdit);
    expect(after.boneDrafts).toBe(before.boneDrafts);
    expect(after.inlinePoseUndoHistory).toBe(before.inlinePoseUndoHistory);
    expect(after.selectedBone).toBe("head");
    expect(
      shouldShowPoseCreatorBoneGizmo({
        boneHelperNodesVisible: true,
        authoringMode: after.authoringMode,
        hasClipInlineEdit: Boolean(after.clipInlineEdit),
        clipPlaybackPlaying: after.clipPlaybackPlaying,
      }),
    ).toBe(true);
    // Actual timeline changes still require hydration, even when also renamed.
    expect(
      syncActionTimelineMetadata(
        { ...sequence, name: "Replaced", duration: 2 },
        sequence,
      ),
    ).toBe(false);
    expect(usePoseCreatorStore.getState().clipDraft.name).toBe("Renamed");
    store.resetWorkspace();
  });

  it("recognizes a deliberately blank action timeline as a store reset", () => {
    expect(isEmptyActionTimeline({ poses: {}, poseKeyframes: [] })).toBe(true);
    expect(
      isEmptyActionTimeline({
        poses: { expression: {} },
        poseKeyframes: [{ time: 0, pose: "expression" }],
      }),
    ).toBe(false);
    expect(
      isEmptyActionTimeline({
        poses: {},
        poseKeyframes: [],
        events: [
          {
            id: "sparkles",
            time: 0.4,
            kind: "particle_vfx",
            effectId: "sparkles",
          },
        ],
      }),
    ).toBe(false);
  });

  it("preserves seek state for edits but resets it for another document session", () => {
    expect(shouldPreserveTimelinePlayhead(null, 0)).toBe(false);
    expect(shouldPreserveTimelinePlayhead(0, 0)).toBe(true);
    expect(shouldPreserveTimelinePlayhead(0, 1)).toBe(false);
  });

  it("does not overwrite a store-only keyframe edit with an unchanged document", () => {
    const serialized = JSON.stringify({ poses: { expression: 0.65 } });

    expect(shouldHydrateActionTimeline(serialized, serialized)).toBe(false);
    expect(
      shouldHydrateActionTimeline(
        JSON.stringify({ poses: { expression: 0.2 } }),
        serialized,
      ),
    ).toBe(true);
  });

  it("suppresses only the exact stale draft captured before hydration", () => {
    const stale = { events: [{ id: "old" }] };
    const edited = { events: [] };

    expect(shouldSkipActionTimelineEmission(stale, stale)).toBe(true);
    expect(shouldSkipActionTimelineEmission(edited, stale)).toBe(false);
  });

  it("renders without the legacy PoseCreatorAssetSaveProvider", () => {
    expect(() =>
      renderToString(<ActionTimelineEditor reaction={false} isBusy={false} />),
    ).not.toThrow();
  });

  it("keeps timeline transport local while forwarding editor controls", () => {
    const onExpandedChange = () => undefined;
    renderToString(
      <ActionTimelineEditor
        reaction
        isBusy={false}
        playbackPending
        expanded={false}
        onExpandedChange={onExpandedChange}
      />,
    );

    expect(timelineProps?.onPreparePreview).toBeUndefined();
    expect(timelineProps?.playbackPending).toBe(true);
    expect(timelineProps?.expanded).toBe(false);
    expect(timelineProps?.onExpandedChange).toBe(onExpandedChange);
  });

  it("mounts document synchronization independently from responsive timeline views", () => {
    expect(() =>
      renderToString(
        <ActionTimelineDocumentSync
          sequence={{ schema: "animaPoseClip/1.0" }}
          session={0}
          reaction
          onChange={() => undefined}
        />,
      ),
    ).not.toThrow();
  });
});
