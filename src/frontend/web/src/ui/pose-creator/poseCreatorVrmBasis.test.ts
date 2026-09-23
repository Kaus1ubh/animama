import { afterEach, describe, expect, it, vi } from "vitest";
import { Euler, MathUtils, Object3D, Quaternion } from "three";
import type { Avatar } from "@/lib/avatar";
import { retargetPoseForVrm0 } from "@/lib/avatar/poses/poseRetargeting";
import { usePoseCreatorStore } from "@/stores/pose-creator-store";
import {
  applyBoneDraft,
  buildPoseCreatorAnimaPose,
  captureBoneBaseQuaternion,
  readPoseCreatorBoneRotationDegrees,
  restoreBoneBaseQuaternion,
} from "./poseCreatorAuthoring";
import { createHandInteractionController } from "./poseCreatorHandInteraction";

const canonical = new Quaternion().setFromEuler(new Euler(0.3, 0.2, -0.4));
function runtimeQuaternion(version: "0" | "1", value: Quaternion) {
  return version === "0"
    ? new Quaternion(-value.x, value.y, -value.z, value.w)
    : value.clone();
}
afterEach(() => usePoseCreatorStore.getState().resetWorkspace());
describe.each(["0", "1"] as const)("VRM%s authoring basis", (version) => {
  function fixture() {
    const node = new Object3D();
    node.quaternion.copy(runtimeQuaternion(version, canonical));
    const avatar = {
      vrm: {
        meta: { metaVersion: version },
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
      boneDrafts: {},
    });
    return { node, avatar };
  }
  it("captures and restores the inherited rotation in canonical coordinates", () => {
    const { avatar, node } = fixture();
    const base = captureBoneBaseQuaternion(avatar, "leftIndexProximal")!;
    expect(new Quaternion(...base).angleTo(canonical)).toBeLessThan(0.0001);
    const degrees = readPoseCreatorBoneRotationDegrees(
      avatar,
      "leftIndexProximal",
    )!;
    expect(degrees.x).toBeCloseTo(MathUtils.radToDeg(0.3));
    node.quaternion.identity();
    restoreBoneBaseQuaternion(avatar, "leftIndexProximal", {
      baseQuaternion: base,
      rotationDegrees: degrees,
    });
    expect(
      node.quaternion.angleTo(runtimeQuaternion(version, canonical)),
    ).toBeLessThan(0.0001);
  });
  it("keeps draft preview and saved-runtime playback in the same basis", () => {
    const { avatar, node } = fixture();
    const draft = {
      baseQuaternion: [0, 0, 0, 1] as [number, number, number, number],
      rotationDegrees: { x: 25, y: 12, z: -35 },
      position: [0.1, 0.2, 0.3] as [number, number, number],
    };
    applyBoneDraft(avatar, "leftIndexProximal", draft);
    const pose = buildPoseCreatorAnimaPose({ leftIndexProximal: draft }, {})!;
    const playback = version === "0" ? retargetPoseForVrm0(pose) : pose;
    expect(
      node.quaternion.angleTo(
        new Quaternion(...playback.humanoid!.leftIndexProximal!.rotation!),
      ),
    ).toBeLessThan(0.0001);
    expect(pose.humanoid!.leftIndexProximal!.position).toEqual([0.1, 0.2, 0.3]);
  });
  it("relative hand changes and Undo/Redo agree with canonical playback", () => {
    const { node } = fixture();
    const controller = createHandInteractionController();
    try {
      controller.begin("left", ["indexProximal"], "curl");
      controller.update(20);
      controller.end();
      const store = usePoseCreatorStore.getState();
      const pose = buildPoseCreatorAnimaPose(store.boneDrafts, {})!;
      const playback = version === "0" ? retargetPoseForVrm0(pose) : pose;
      const expected = new Quaternion(
        ...playback.humanoid!.leftIndexProximal!.rotation!,
      );
      expect(node.quaternion.angleTo(expected)).toBeLessThan(0.0001);
      store.undoPose();
      expect(
        node.quaternion.angleTo(runtimeQuaternion(version, canonical)),
      ).toBeLessThan(0.0001);
      store.redoPose();
      expect(node.quaternion.angleTo(expected)).toBeLessThan(0.0001);
    } finally {
      controller.dispose();
    }
  });
});
