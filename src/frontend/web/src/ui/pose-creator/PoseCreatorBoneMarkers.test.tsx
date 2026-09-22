import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { createPortal } from "@react-three/fiber";
import { Object3D } from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Avatar } from "@/lib/avatar";
import { usePoseCreatorStore } from "@/stores/pose-creator-store";
import { PoseCreatorBoneMarkers } from "./PoseCreatorBoneMarkers";

vi.mock("@react-three/fiber", () => ({
  createPortal: vi.fn(() => null),
}));
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

describe("Memoized bone markers", () => {
  it("keeps selection and helper visibility connected to their own store subscriptions", () => {
    const bones: Record<string, Object3D> = {
      leftUpperArm: new Object3D(),
      head: new Object3D(),
    };
    const avatar = {
      vrm: {
        humanoid: {
          getNormalizedBoneNode: (name: string) => bones[name] ?? null,
        },
      },
    } as unknown as Avatar;
    const render = () => {
      vi.mocked(createPortal).mockClear();
      renderToString(<PoseCreatorBoneMarkers avatar={avatar} />);
      return vi.mocked(createPortal).mock.calls.map(([element, target]) => ({
        ...(
          element as ReactElement<{
            boneName: string;
            isSelected: boolean;
            onSelect: (name: string) => void;
          }>
        ).props,
        target,
      }));
    };

    let markers = render();
    expect(markers).toHaveLength(2);
    expect(markers.find((marker) => marker.isSelected)?.target).toBe(
      bones.leftUpperArm,
    );
    markers.find((marker) => marker.boneName === "head")!.onSelect("head");
    markers = render();
    expect(markers.find((marker) => marker.isSelected)?.target).toBe(
      bones.head,
    );
    usePoseCreatorStore.getState().setBoneHelperNodesVisible(false);
    expect(render()).toEqual([]);
    usePoseCreatorStore.getState().setBoneHelperNodesVisible(true);
    expect(render().find((marker) => marker.isSelected)?.target).toBe(
      bones.head,
    );
  });
});
