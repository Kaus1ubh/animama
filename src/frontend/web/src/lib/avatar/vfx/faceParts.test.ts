import type { VRM } from "@pixiv/three-vrm";
import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";

import {
  VRM0_FIXTURE_ID,
  loadTestAvatarWithGltf,
  type TestAvatarId,
} from "../motion-authoring/testing/includedAvatars";
import {
  AVATAR_FACE_PART_ROLES,
  AVATAR_FACE_PARTS_SCHEMA,
  detectAvatarFaceParts,
  detectAvatarFacePartsByName,
  resolveFacePartTargetRole,
  type AvatarFacePartCorrections,
} from "./faceParts";

const DIGEST = "a".repeat(64);

/**
 * Name-free detection on the Included Avatars and the VRM 0 fixture must agree with what material
 * names find, so converted effects keep rendering on the same primitives.
 */
const EXPECTED: Record<
  TestAvatarId,
  Record<(typeof AVATAR_FACE_PART_ROLES)[number], string[]>
> = {
  AvatarSample_A_1_New: {
    face_skin: ["91:0:3"],
    eye_left: ["91:0:1"],
    eye_right: ["91:0:1"],
    eye_highlight: ["91:0:2"],
    eyeline: ["91:0:6"],
    eyelash: [],
    hair: ["93:2:0", "93:2:1", "93:2:2", "93:2:3"],
  },
  AvatarSample_Y_0: {
    face_skin: ["143:0:3"],
    eye_left: ["143:0:1"],
    eye_right: ["143:0:1"],
    eye_highlight: ["143:0:2"],
    eyeline: ["143:0:7"],
    eyelash: ["143:0:6"],
    hair: ["145:2:0", "145:2:1"],
  },
  Andrew: {
    face_skin: ["144:0:3"],
    eye_left: ["144:0:1"],
    eye_right: ["144:0:1"],
    eye_highlight: ["144:0:2"],
    eyeline: ["144:0:7"],
    eyelash: ["144:0:6"],
    hair: ["146:2:0"],
  },
};

describe.each(Object.keys(EXPECTED) as TestAvatarId[])(
  "detectAvatarFaceParts on %s",
  (id) => {
    it("finds face skin and both eyes from spec signals alone", async () => {
      const { vrm, gltf } = await loadTestAvatarWithGltf(id);
      const map = detectAvatarFaceParts(vrm, gltf, { names: false });

      for (const role of ["face_skin", "eye_left", "eye_right"] as const) {
        expect(map.parts[role].source, role).toBe("signals");
        expect(map.parts[role].confidence, role).toBeGreaterThanOrEqual(0.6);
      }
      const found = Object.fromEntries(
        AVATAR_FACE_PART_ROLES.map((role) => [role, map.parts[role].bindings]),
      );
      expect(found).toEqual(EXPECTED[id]);
      // Eye whites are skinned to the head on these Avatars, not the eye bones.
      expect(map.eyeWhite).toEqual([]);
    });

    it("agrees with material-name detection for every role names find", async () => {
      const { vrm, gltf } = await loadTestAvatarWithGltf(id);
      const signals = detectAvatarFaceParts(vrm, gltf, { names: false });
      const namesOnly = detectAvatarFacePartsByName(vrm, gltf);
      for (const role of AVATAR_FACE_PART_ROLES) {
        if (namesOnly[role].length === 0) continue;
        expect(signals.parts[role].bindings, role).toEqual(namesOnly[role]);
      }
    });

    it("applies a correction for the same VRM bytes and ignores others", async () => {
      const { vrm, gltf } = await loadTestAvatarWithGltf(id);
      const detected = detectAvatarFaceParts(vrm, gltf, { names: false });
      const eyeKey = EXPECTED[id].eye_left[0];
      const corrections: AvatarFacePartCorrections = {
        schema: AVATAR_FACE_PARTS_SCHEMA,
        vrm_sha256: DIGEST,
        parts: {
          face_skin: EXPECTED[id].face_skin,
          eye_left: [eyeKey],
          eye_right: [eyeKey],
          eye_highlight: [],
          hair: ["99:99:99"],
        },
      };

      const corrected = detectAvatarFaceParts(vrm, gltf, {
        names: false,
        corrections,
        vrmSha256: DIGEST.toUpperCase(),
      });
      expect(corrected.parts.face_skin.source).toBe("corrected");
      expect(corrected.parts.face_skin.confidence).toBe(1);
      // An explicitly empty optional part is absent, not re-detected.
      expect(corrected.parts.eye_highlight).toMatchObject({
        bindings: [],
        source: "corrected",
      });
      // Unknown keys are dropped; the role keeps its detection.
      expect(corrected.parts.hair).toEqual(detected.parts.hair);
      expect(corrected.diagnostics.join(" ")).toContain("99:99:99");
      expect(
        resolveFacePartTargetRole(corrected, EXPECTED[id].eye_highlight[0]),
      ).toBeNull();

      const stale = detectAvatarFaceParts(vrm, gltf, {
        names: false,
        corrections,
        vrmSha256: "b".repeat(64),
      });
      expect(stale.parts).toEqual(detected.parts);
      expect(stale.diagnostics).toContain(
        "Ignored face part corrections made for different VRM bytes.",
      );
    });
  },
);

describe("detectAvatarFaceParts world matrices", () => {
  it("never writes a raw bone or mesh world matrix", async () => {
    // Before the first frame a VRM 0 scene's raw bones hold pre-rotation
    // matrices that its bind matrices agree with; landmarks read them next.
    const { vrm, gltf } = await loadTestAvatarWithGltf(VRM0_FIXTURE_ID);
    const normalizedRoot = vrm.humanoid.normalizedHumanBonesRoot;
    const sentinel = new THREE.Matrix4().makeScale(2, 3, 4);
    const watched: THREE.Object3D[] = [];
    vrm.scene.traverse((object) => {
      let node: THREE.Object3D | null = object;
      while (node && node !== normalizedRoot) node = node.parent;
      if (node || object === vrm.scene) return;
      object.matrixWorld.copy(sentinel);
      watched.push(object);
    });

    detectAvatarFaceParts(vrm, gltf, { names: false });

    const changed = watched.filter(
      (object) => !object.matrixWorld.equals(sentinel),
    );
    expect(changed.map((object) => object.name)).toEqual([]);
  });
});

/**
 * A minimal VRM with one iris and one highlight mesh per eye, each skinned to
 * its own eye bone (no VRoid-style shared primitive), and neutral names.
 */
function perEyeModel(): { vrm: VRM; gltf: GLTF } {
  const scene = new THREE.Group();
  const head = new THREE.Bone();
  head.position.set(0, 1.5, 0);
  const leftEye = new THREE.Bone();
  leftEye.position.set(0.03, 0.05, 0.05);
  const rightEye = new THREE.Bone();
  rightEye.position.set(-0.03, 0.05, 0.05);
  head.add(leftEye, rightEye);
  scene.add(head);
  scene.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton([head, leftEye, rightEye]);
  const associations = new Map<object, object>();
  const nodes: { name: string; mesh: number }[] = [];
  const quad = (bone: number, x: number, z: number, size: number) => {
    const index = nodes.length;
    const geometry = new THREE.PlaneGeometry(size, size);
    geometry.translate(x, 1.55, z);
    const count = geometry.getAttribute("position").count;
    const skinIndex = new Uint16Array(count * 4);
    const skinWeight = new Float32Array(count * 4);
    for (let vertex = 0; vertex < count; vertex += 1) {
      skinIndex[vertex * 4] = bone;
      skinWeight[vertex * 4] = 1;
    }
    geometry.setAttribute("skinIndex", new THREE.BufferAttribute(skinIndex, 4));
    geometry.setAttribute(
      "skinWeight",
      new THREE.BufferAttribute(skinWeight, 4),
    );
    const material = new THREE.MeshBasicMaterial({ name: `m${index}` });
    const mesh = new THREE.SkinnedMesh(geometry, material);
    scene.add(mesh);
    mesh.updateMatrixWorld(true);
    mesh.bind(skeleton);
    associations.set(mesh, { meshes: index, primitives: 0, nodes: index });
    nodes.push({ name: `n${index}`, mesh: index });
  };
  quad(1, 0.03, 0.06, 0.02); // 0:0:0 left iris
  quad(1, 0.032, 0.065, 0.006); // 1:1:0 left highlight
  quad(2, -0.03, 0.06, 0.02); // 2:2:0 right iris
  quad(2, -0.028, 0.065, 0.006); // 3:3:0 right highlight
  const bones: Record<string, THREE.Object3D> = { head, leftEye, rightEye };
  const vrm = {
    scene,
    meta: { metaVersion: "1" },
    humanoid: {
      getNormalizedBoneNode: (name: string) => bones[name] ?? null,
      getRawBoneNode: (name: string) => bones[name] ?? null,
    },
    expressionManager: null,
    springBoneManager: null,
  } as unknown as VRM;
  const gltf = {
    parser: { associations, json: { nodes } },
  } as unknown as GLTF;
  return { vrm, gltf };
}

describe("detectAvatarFaceParts with one iris mesh per eye", () => {
  it("finds an iris and a highlight for each eye", () => {
    const { vrm, gltf } = perEyeModel();
    const map = detectAvatarFaceParts(vrm, gltf, { names: false });

    expect(map.parts.eye_left).toMatchObject({
      bindings: ["0:0:0"],
      source: "signals",
    });
    expect(map.parts.eye_right).toMatchObject({
      bindings: ["2:2:0"],
      source: "signals",
    });
    expect([...map.parts.eye_highlight.bindings].sort()).toEqual([
      "1:1:0",
      "3:3:0",
    ]);
  });
});

describe("resolveFacePartTargetRole", () => {
  it("maps parts to VFX target roles with detail roles first", async () => {
    const { vrm, gltf } = await loadTestAvatarWithGltf(VRM0_FIXTURE_ID);
    const map = detectAvatarFaceParts(vrm, gltf);
    expect(resolveFacePartTargetRole(map, "143:0:3")).toBe("face_skin");
    expect(resolveFacePartTargetRole(map, "143:0:1")).toBe("eye_iris");
    expect(resolveFacePartTargetRole(map, "143:0:2")).toBe("eye_highlight");
    expect(resolveFacePartTargetRole(map, "143:0:6")).toBe("eyelash");
    expect(resolveFacePartTargetRole(map, "143:0:7")).toBe("eyeline");
    expect(resolveFacePartTargetRole(map, "145:2:0")).toBeNull();
    expect(resolveFacePartTargetRole(null, "143:0:3")).toBeNull();
  });
});
