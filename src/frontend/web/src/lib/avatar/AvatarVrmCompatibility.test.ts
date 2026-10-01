import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AnimationClip,
  PerspectiveCamera,
  Quaternion,
  QuaternionKeyframeTrack,
} from "three";

import { Avatar } from "./Avatar";
import { RELAXED_REST_POSE_ID, getResolvedAvatarPose } from "./poses/catalog";
import { retargetPoseForVrm0 } from "./poses/poseRetargeting";
import { preparedModelUrlResolver } from "./preparedModelResources";

class TestProgressEvent extends Event {
  readonly lengthComputable = true;
  readonly loaded: number;
  readonly total: number;

  constructor(type: string, init: { loaded?: number; total?: number } = {}) {
    super(type);
    this.loaded = init.loaded ?? 0;
    this.total = init.total ?? 0;
  }
}

const REQUIRED_BONES = [
  "hips",
  "spine",
  "head",
  "leftUpperLeg",
  "leftLowerLeg",
  "leftFoot",
  "rightUpperLeg",
  "rightLowerLeg",
  "rightFoot",
  "leftUpperArm",
  "leftLowerArm",
  "leftHand",
  "rightUpperArm",
  "rightLowerArm",
  "rightHand",
] as const;

function createMinimalVrm(version: 0 | 1 = 1): Uint8Array {
  const document = {
    asset: { version: "2.0" },
    extensionsUsed: ["VRMC_vrm"],
    extensions: {
      VRMC_vrm: {
        specVersion: "1.0",
        meta: {
          name: "Compatibility Fixture",
          version: "1.0",
          authors: ["Animama"],
          licenseUrl: "https://vrm.dev/licenses/1.0/",
        },
        humanoid: {
          humanBones: Object.fromEntries(
            REQUIRED_BONES.map((bone, node) => [bone, { node }]),
          ),
        },
      },
    },
    nodes: REQUIRED_BONES.map((name) => ({ name })),
    scenes: [{ nodes: REQUIRED_BONES.map((_, index) => index) }],
    scene: 0,
  };
  if (version === 0) {
    document.extensionsUsed = ["VRM"];
    (document as unknown as { extensions: object }).extensions = {
      VRM: {
        specVersion: "0.0",
        meta: {
          title: "Compatibility Fixture",
          version: "1.0",
          author: "Animama",
          licenseName: "CC0",
        },
        humanoid: {
          humanBones: REQUIRED_BONES.map((bone, node) => ({
            bone,
            node,
            useDefaultValues: true,
          })),
        },
        firstPerson: { firstPersonBone: REQUIRED_BONES.indexOf("head") },
        // VRoid exports VRM1-only presets such as surprised as custom groups.
        blendShapeMaster: {
          blendShapeGroups: [
            { name: "Joy", presetName: "joy", binds: [] },
            { name: "Surprised", presetName: "unknown", binds: [] },
          ],
        },
        materialProperties: [],
      },
    };
  }
  const encoded = new TextEncoder().encode(JSON.stringify(document));
  const paddedLength = Math.ceil(encoded.byteLength / 4) * 4;
  const output = new Uint8Array(12 + 8 + paddedLength);
  const view = new DataView(output.buffer);
  output.set(new TextEncoder().encode("glTF"), 0);
  view.setUint32(4, 2, true);
  view.setUint32(8, output.byteLength, true);
  view.setUint32(12, paddedLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  output.fill(0x20, 20);
  output.set(encoded, 20);
  return output;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Avatar VRM compatibility", () => {
  it.each([0, 1] as const)(
    "initializes a VRM %s rig in canonical relaxed-rest before it can be revealed",
    async (version) => {
      const content = createMinimalVrm(version);
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(content.buffer as ArrayBuffer)),
      );
      vi.stubGlobal("ProgressEvent", TestProgressEvent);
      vi.stubGlobal("self", globalThis);
      const avatar = new Avatar(new PerspectiveCamera());
      try {
        await avatar.load({
          filePath: `https://assets.local/pose-${version}.vrm`,
        });
        avatar.prepareFirstFrame();
        const resolved = getResolvedAvatarPose(RELAXED_REST_POSE_ID);
        const expected =
          version === 0 ? retargetPoseForVrm0(resolved) : resolved;
        for (const bone of ["leftUpperArm", "rightUpperArm"] as const) {
          const rotation =
            avatar.vrm!.humanoid.getNormalizedBoneNode(bone)!.quaternion;
          expect(rotation.angleTo(new Quaternion())).toBeGreaterThan(0.3);
          expect(
            rotation.angleTo(
              new Quaternion(...expected.humanoid![bone]!.rotation!),
            ),
          ).toBeLessThan(0.0001);
        }
        expect(avatar.isPoseActive(RELAXED_REST_POSE_ID)).toBe(true);

        // Exercise the real mixer's first fade on the posed rig. A decoded
        // optional idle must blend from rest, including its zero-weight frame.
        const arms = (["leftUpperArm", "rightUpperArm"] as const).map(
          (bone) => avatar.vrm!.humanoid.getNormalizedBoneNode(bone)!,
        );
        const resting = arms.map((arm) => arm.quaternion.clone());
        const tracks = arms.map((arm, index) => {
          const target = resting[index]!.clone().multiply(
            new Quaternion(0, Math.sin(0.1), 0, Math.cos(0.1)),
          );
          return new QuaternionKeyframeTrack(
            `${arm.uuid}.quaternion`,
            [0, 1],
            [...target.toArray(), ...target.toArray()],
          );
        });
        const manager = avatar.animationManager!;
        vi.spyOn(
          manager as unknown as { _loadClip: () => Promise<AnimationClip> },
          "_loadClip",
        ).mockResolvedValue(new AnimationClip("prepared-idle", 1, tracks));
        await manager.playLoop("blob:prepared-idle", "prepared-idle", {
          fadeDuration: 0.5,
        });
        manager.update(0);
        arms.forEach((arm, index) =>
          expect(arm.quaternion.angleTo(resting[index]!)).toBeLessThan(0.0001),
        );
        for (const delta of [0.001, 0.1, 0.2, 0.2]) {
          manager.update(delta);
          arms.forEach((arm) =>
            expect(arm.quaternion.angleTo(new Quaternion())).toBeGreaterThan(
              0.3,
            ),
          );
        }
        // Clearing pose application must never permit an unposed fallback frame.
        avatar.poseController!.setPoseEnabled(RELAXED_REST_POSE_ID, false);
        avatar.poseController!.applyDefaultPoses();
        expect(() => avatar.prepareFirstFrame()).toThrow("relaxed-rest");
      } finally {
        avatar.dispose();
      }
    },
  );

  it("exposes a VRM0 custom Surprised expression as the surprised preset", async () => {
    const content = createMinimalVrm(0);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(content.buffer as ArrayBuffer)),
    );
    vi.stubGlobal("ProgressEvent", TestProgressEvent);
    vi.stubGlobal("self", globalThis);
    const avatar = new Avatar(new PerspectiveCamera());
    try {
      await avatar.load({ filePath: "https://assets.local/expressions-0.vrm" });
      const expressions = avatar.expressionController!;
      expect(expressions.getAvailableExpressions()).toEqual(
        expect.arrayContaining(["happy", "surprised"]),
      );
      expect(expressions.getAvailableExpressions()).not.toContain("Surprised");

      expressions.setValue("surprised", 0.6);
      expect(avatar.vrm!.expressionManager!.getValue("surprised")).toBe(0.6);
    } finally {
      avatar.dispose();
    }
  });

  it("maps external model dependencies to verified blobs and rejects unissued HTTP fetches", () => {
    const resolve = preparedModelUrlResolver("blob:http://localhost/model", {
      "textures/body.png": "blob:verified-texture",
    });
    expect(resolve("blob:http://localhost/textures/body.png")).toBe(
      "blob:verified-texture",
    );
    expect(resolve("data:application/octet-stream;base64,AA==")).toContain(
      "data:",
    );
    expect(() => resolve("https://unissued.example/body.png")).toThrow(
      "verified closure",
    );
    expect(() =>
      preparedModelUrlResolver("blob:model", {
        "body.png": "/raw-private-bytes",
      }),
    ).toThrow("verified Blob");
  });

  it("loads a complete VRM without browser identity headers", async () => {
    const content = createMinimalVrm();
    const nativeFetch = globalThis.fetch;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      if (request.url.startsWith("data:")) {
        return nativeFetch(request);
      }
      expect(request.headers.get("Authorization")).toBeNull();
      return new Response(content.buffer as ArrayBuffer, {
        headers: {
          "Content-Length": String(content.byteLength),
          "Content-Type": "model/gltf-binary",
        },
      });
    });
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("ProgressEvent", TestProgressEvent);
    vi.stubGlobal("self", globalThis);

    await expect(
      Avatar.preloadVrm("https://assets.local/avatar.vrm"),
    ).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalled();
  });
});
