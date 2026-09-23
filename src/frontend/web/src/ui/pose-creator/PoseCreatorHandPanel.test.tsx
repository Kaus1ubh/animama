import {
  isValidElement,
  type ReactNode,
  type ReactElement,
  type InputHTMLAttributes,
  type ChangeEvent,
  type PointerEvent,
} from "react";
import { Object3D } from "three";
import type { Avatar } from "@/lib/avatar";
import { usePoseCreatorStore } from "@/stores/pose-creator-store";
import { createHandInteractionController } from "./poseCreatorHandInteraction";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HAND_SEGMENTS } from "./poseCreatorHandAuthoring";
import {
  HandAdjustmentControl,
  PoseCreatorHandPanel,
} from "./PoseCreatorHandPanel";
import type { PoseCreatorHands } from "./usePoseCreatorHands";
function model(): PoseCreatorHands {
  const available = HAND_SEGMENTS.map((segment) => ({
    boneName: `left${segment.id}`,
    side: "left" as const,
    segment,
  }));
  return {
    open: true,
    target: "left",
    selected: ["indexIntermediate", "indexDistal"],
    canEdit: true,
    error: null,
    value: 0,
    adjustment: null,
    available,
    unavailable: [],
    selectedAvailable: available.filter((bone) =>
      ["indexIntermediate", "indexDistal"].includes(bone.segment.id),
    ),
    setOpen: vi.fn(),
    setTarget: vi.fn(),
    toggleSegment: vi.fn(),
    begin: vi.fn(),
    update: vi.fn(),
    end: vi.fn(),
    preset: vi.fn(),
  };
}
describe("Hands panel", () => {
  it("exposes 14 segment buttons without the thumb metacarpal or shortcuts", () => {
    const html = renderToStaticMarkup(
      <PoseCreatorHandPanel hands={model()} onClose={() => {}} />,
    );
    expect(html.match(/role="button"/g)).toHaveLength(14);
    expect(html).not.toContain('aria-label="Left thumb metacarpal"');
    expect(html).toContain('aria-label="Left thumb proximal"');
    expect(html).toContain('aria-label="Left index distal"');
    expect(html).toContain("2 bones selected");
    expect(html).not.toMatch(/>Apply<|>Clear<|>All fingers</);
  });
  it("disables spread without bases and identifies unavailable counterparts", () => {
    const hands = model();
    hands.target = "both";
    hands.unavailable = [
      {
        ...hands.available[0],
        side: "right",
        boneName: "rightThumbProximal",
      },
    ];
    const html = renderToStaticMarkup(
      <PoseCreatorHandPanel hands={hands} onClose={() => {}} />,
    );
    expect(html).toContain('aria-label="Spread selected base bones"');
    expect(html).toMatch(
      /aria-label="Spread selected base bones"[^>]*disabled=""/,
    );
    expect(html).toContain("Right thumb proximal");
    expect(html).not.toContain("Changes update the pose immediately.");
  });
});

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useId: () => "hand-adjustment-description",
}));

function findRange(
  node: ReactNode,
): ReactElement<InputHTMLAttributes<HTMLInputElement>> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const result = findRange(child);
      if (result) return result;
    }
  }
  if (!isValidElement<{ children?: ReactNode }>(node)) return null;
  if (node.type === "input")
    return node as ReactElement<InputHTMLAttributes<HTMLInputElement>>;
  return findRange(node.props.children);
}

it("a late slider change after Undo cannot restart the invalidated drag", () => {
  usePoseCreatorStore.getState().resetWorkspace();
  const node = new Object3D();
  const avatar = {
    vrm: {
      humanoid: {
        getNormalizedBoneNode: (name: string) =>
          name === "leftIndexProximal" ? node : null,
      },
      update: vi.fn(),
    },
  } as unknown as Avatar;
  usePoseCreatorStore.setState({
    activeAvatar: avatar,
    loadStatus: "ready",
    authoringMode: "pose",
  });
  const controller = createHandInteractionController();
  const hands = model();
  hands.begin = (adjustment) =>
    controller.begin("left", ["indexProximal"], adjustment);
  hands.update = (value) => {
    controller.update(value);
  };
  hands.end = controller.end;
  const range = findRange(
    HandAdjustmentControl({ hands, adjustment: "curl" }),
  )!;
  const change = (value: number) =>
    range.props.onChange!({
      currentTarget: { value: String(value) },
    } as ChangeEvent<HTMLInputElement>);
  try {
    range.props.onPointerDown!({
      currentTarget: { setPointerCapture: vi.fn() },
      pointerId: 1,
    } as unknown as PointerEvent<HTMLInputElement>);
    change(20);
    expect(Object.keys(usePoseCreatorStore.getState().boneDrafts)).toEqual([
      "leftIndexProximal",
    ]);
    usePoseCreatorStore.getState().undoPose();
    expect(usePoseCreatorStore.getState().boneDrafts).toEqual({});
    change(40);
    expect(usePoseCreatorStore.getState().boneDrafts).toEqual({});
    expect(usePoseCreatorStore.getState().undoGroup).toBeNull();
  } finally {
    controller.dispose();
    usePoseCreatorStore.getState().resetWorkspace();
  }
});
