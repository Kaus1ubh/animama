import type { ComponentProps, MouseEvent, ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { Object3D } from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Avatar } from "@/lib/avatar";
import { usePoseCreatorStore } from "@/stores/pose-creator-store";
import { PoseCreatorBoneSection } from "./PoseCreatorBoneSection";

const harness = vi.hoisted(() => ({ reset: null as (() => void) | null }));
let bones: Record<string, Object3D>;
vi.mock("@/ui/components/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: ReactNode }) => children,
  TooltipContent: () => null,
}));
vi.mock("@/ui/components/button", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/ui/components/button")>();
  return {
    ...actual,
    Button: (props: ComponentProps<typeof actual.Button>) => {
      if (props["aria-label"] === "Reset all bone changes") {
        harness.reset = () =>
          props.onClick?.({} as MouseEvent<HTMLButtonElement>);
      }
      return <actual.Button {...props} />;
    },
  };
});

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

beforeEach(() => {
  usePoseCreatorStore.getState().resetWorkspace();
  harness.reset = null;
  const arm = new Object3D();
  arm.name = "Arm";
  const head = new Object3D();
  head.name = "Head";
  bones = { leftUpperArm: arm, head };
  usePoseCreatorStore.setState({
    activeAvatar: {
      vrm: {
        update: () => undefined,
        humanoid: {
          getRawBoneNode: (name: string) => bones[name] ?? null,
          getNormalizedBoneNode: (name: string) => bones[name] ?? null,
        },
      },
    } as unknown as Avatar,
  });
});

describe("Bone browser and live rotation controls", () => {
  it("resets the latest bones even when the cached browser has not rendered again", () => {
    usePoseCreatorStore.getState().setBoneDraft("head", {
      baseQuaternion: [0, 0, 0, 1],
      rotationDegrees: { x: 10, y: 0, z: 0 },
    });
    renderToString(<PoseCreatorBoneSection variant="workspace" />);
    usePoseCreatorStore.getState().setBoneDraft("leftUpperArm", {
      baseQuaternion: [0, 0, 0, 1],
      rotationDegrees: { x: 90, y: 0, z: 0 },
    });
    bones.leftUpperArm.quaternion.set(Math.SQRT1_2, 0, 0, Math.SQRT1_2);
    harness.reset!();
    expect(bones.leftUpperArm.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    expect(usePoseCreatorStore.getState().boneDrafts).toEqual({});
  });

  it.each(["workspace", "mobile"] as const)(
    "keeps %s rotation fields and selection live",
    (variant) => {
      usePoseCreatorStore.getState().setBoneDraft("leftUpperArm", {
        baseQuaternion: [0, 0, 0, 1],
        rotationDegrees: { x: 10, y: 0, z: 0 },
      });
      let html = renderToString(<PoseCreatorBoneSection variant={variant} />);
      expect(html).toMatch(/aria-label="X rotation degrees"[^>]*value="10.0"/);
      usePoseCreatorStore.getState().setBoneDraft("leftUpperArm", {
        baseQuaternion: [0, 0, 0, 1],
        rotationDegrees: { x: 45, y: 0, z: 0 },
      });
      html = renderToString(<PoseCreatorBoneSection variant={variant} />);
      expect(html).toMatch(/aria-label="X rotation degrees"[^>]*value="45.0"/);
      usePoseCreatorStore.getState().setSelectedBone("head");
      html = renderToString(<PoseCreatorBoneSection variant={variant} />);
      expect(html).toMatch(/aria-label="X rotation degrees"[^>]*value="0.0"/);
      expect(html).toContain("Head");
    },
  );
});
