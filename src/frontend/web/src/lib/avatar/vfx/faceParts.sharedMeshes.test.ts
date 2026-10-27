import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Avatar } from "../Avatar";
import { appendTriangle } from "../testing/appendTriangle";
import { loadedTestAvatar } from "../testing/loadedTestAvatar";
import { buildRuntimePrimitiveBindings } from "../vrmEditorInspection";
import type { RuntimePrimitiveBindingEntry } from "./avatarPrimitiveUtils";
import { PrimitiveRegionHider } from "./primitiveRegionHiding";

const unique = <T>(values: readonly T[]) => Array.from(new Set(values));

/**
 * Face parts on models built unlike VRoid exports, made from the Included
 * Avatars with synthetic additions: lashes and lines inside the face mesh, a
 * face skinned partly to the neck, no eye bones.
 */

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

function headOf(avatar: Avatar): THREE.Object3D {
  return avatar.vrm!.humanoid.getNormalizedBoneNode("head")!;
}

function entryOf(avatar: Avatar, key: string): RuntimePrimitiveBindingEntry {
  return buildRuntimePrimitiveBindings(avatar).entries.find(
    (entry) => entry.bindingKey === key,
  )!;
}

/** The morph targets `blink` drives on a mesh. */
function blinkTargets(avatar: Avatar, mesh: THREE.Object3D): number[] {
  const binds = avatar.vrm!.expressionManager!.getExpression("blink")!
    .binds as unknown as { primitives?: THREE.Object3D[]; index?: number }[];
  return binds
    .filter((bind) => bind.primitives?.includes(mesh))
    .map((bind) => bind.index!);
}

/**
 * A strand `above` an eye, inside the face mesh, that blink lowers as far as
 * the lid: `width` across, a thin sliver tall.
 */
function addBlinkStrand(
  avatar: Avatar,
  face: RuntimePrimitiveBindingEntry,
  eye: THREE.Vector3,
  width: number,
  above = 0.012,
): void {
  const y = eye.y + above;
  const z = eye.z + 0.004;
  appendTriangle({
    avatar,
    binding: face,
    anchor: headOf(avatar),
    corners: [
      new THREE.Vector3(eye.x - width / 2, y, z),
      new THREE.Vector3(eye.x + width / 2, y, z),
      new THREE.Vector3(eye.x, y + 0.002, z),
    ],
    uv: [
      [0.1, 0.1],
      [0.12, 0.1],
      [0.11, 0.12],
    ],
    morph: {
      targets: blinkTargets(avatar, face.object),
      offset: new THREE.Vector3(0, -0.02, 0),
    },
  });
}

function eyeCenters(avatar: Avatar): THREE.Vector3[] {
  const { left, right } = avatar.getFaceLandmarksSnapshot()!.eyes;
  return [left!, right!].map((eye) =>
    new THREE.Vector3().copy(eye.centerLocal),
  );
}

describe("eye details inside the face mesh", () => {
  it("finds lash strands blink moves as regions of the face skin", async () => {
    const avatar = await loadedTestAvatar("AvatarSample_A_1_New");
    const before = avatar.facePartMap!.parts;
    const face = entryOf(avatar, before.face_skin.bindings[0]!);
    const firstNew = face.object.geometry.getIndex()!.count / 3;
    for (const eye of eyeCenters(avatar))
      addBlinkStrand(avatar, face, eye, 0.01);
    await avatar.setFacePartCorrections(null);

    const parts = avatar.facePartMap!.parts;
    expect(parts.eyelash).toMatchObject({
      source: "signals",
      bindings: [],
      regions: [
        { bindingKey: face.bindingKey, triangles: [firstNew, firstNew + 1] },
      ],
    });
    // The eye line keeps its own mesh; nothing else changes.
    expect(parts.eyeline.bindings).toEqual(before.eyeline.bindings);
    expect(parts.eyeline.regions).toBeUndefined();
    expect(parts.face_skin.bindings).toEqual(before.face_skin.bindings);
  });

  it("finds the regions again while an effect has them hidden", async () => {
    const avatar = await loadedTestAvatar("AvatarSample_A_1_New");
    const face = entryOf(
      avatar,
      avatar.facePartMap!.parts.face_skin.bindings[0]!,
    );
    for (const eye of eyeCenters(avatar))
      addBlinkStrand(avatar, face, eye, 0.01);
    await avatar.setFacePartCorrections(null);
    const regions = avatar.facePartMap!.parts.eyelash.regions!;

    // An eye effect is hiding the strands when a correction is saved.
    const hider = new PrimitiveRegionHider();
    hider.hide("effect", face.object.geometry, regions[0]!.triangles);
    avatar.vfxController = {
      restoreHiddenRegions: () => hider.restoreAll(),
      refreshFaceParts: async () => {},
    } as unknown as Avatar["vfxController"];
    await avatar.setFacePartCorrections(null);

    expect(avatar.facePartMap!.parts.eyelash.regions).toEqual(regions);
  });

  it("finds regions in an unindexed face mesh", async () => {
    const avatar = await loadedTestAvatar("AvatarSample_A_1_New");
    const face = entryOf(
      avatar,
      avatar.facePartMap!.parts.face_skin.bindings[0]!,
    );
    for (const eye of eyeCenters(avatar))
      addBlinkStrand(avatar, face, eye, 0.01);
    face.object.geometry = face.object.geometry.toNonIndexed();
    await avatar.setFacePartCorrections(null);

    const triangles = face.object.geometry.getAttribute("position").count / 3;
    expect(avatar.facePartMap!.parts.eyelash.regions).toEqual([
      {
        bindingKey: face.bindingKey,
        triangles: [triangles - 2, triangles - 1],
      },
    ]);
  });

  it("takes each eye's largest region as its line when no line mesh exists", async () => {
    const avatar = await loadedTestAvatar("AvatarSample_A_1_New");
    const before = avatar.facePartMap!.parts;
    const face = entryOf(avatar, before.face_skin.bindings[0]!);
    // Detach the eye-line mesh from blink, as if the model had none.
    const line = entryOf(avatar, before.eyeline.bindings[0]!).object;
    for (const bind of avatar.vrm!.expressionManager!.getExpression("blink")!
      .binds as unknown as { primitives?: THREE.Object3D[] }[]) {
      bind.primitives = bind.primitives?.filter((mesh) => mesh !== line);
    }
    const firstNew = face.object.geometry.getIndex()!.count / 3;
    for (const eye of eyeCenters(avatar)) {
      addBlinkStrand(avatar, face, eye, 0.02); // the line
      addBlinkStrand(avatar, face, eye, 0.006, 0.016); // a lash above it
    }
    await avatar.setFacePartCorrections(null);

    const parts = avatar.facePartMap!.parts;
    expect(parts.eyeline.regions).toEqual([
      { bindingKey: face.bindingKey, triangles: [firstNew, firstNew + 2] },
    ]);
    expect(parts.eyelash.regions).toEqual([
      { bindingKey: face.bindingKey, triangles: [firstNew + 1, firstNew + 3] },
    ]);
  });
});

describe("a face skinned partly to the neck", () => {
  it("is still the face skin, with bounds from its head vertices", async () => {
    const avatar = await loadedTestAvatar("Andrew");
    const before = avatar.facePartMap!.parts.face_skin;
    const bounds = avatar.getFaceLandmarksSnapshot()!.faceBoundsLocal!;
    const face = entryOf(avatar, before.bindings[0]!);
    const mesh = face.object as THREE.SkinnedMesh;
    const neck = mesh.skeleton.bones.indexOf(
      avatar.vrm!.humanoid.getRawBoneNode("neck")! as THREE.Bone,
    );
    expect(neck).toBeGreaterThanOrEqual(0);

    // A neck below the chin in the same primitive...
    const chin = bounds.min.y;
    appendTriangle({
      avatar,
      binding: face,
      anchor: headOf(avatar),
      corners: [
        new THREE.Vector3(-0.06, chin - 0.12, 0),
        new THREE.Vector3(0.06, chin - 0.12, 0),
        new THREE.Vector3(0, chin - 0.01, 0),
      ],
      uv: [
        [0.2, 0.9],
        [0.3, 0.9],
        [0.25, 0.8],
      ],
      joint: neck,
    });
    // ...and enough neck-weighted vertices that under 90% of the weight is
    // on the head: the old rule found no face here.
    const skinIndex = mesh.geometry.getAttribute("skinIndex");
    const skinWeight = mesh.geometry.getAttribute("skinWeight");
    const reweighted = Math.ceil(skinIndex.count * 0.2);
    for (let vertex = 0; vertex < reweighted; vertex += 1) {
      skinIndex.setXYZW(vertex, neck, 0, 0, 0);
      skinWeight.setXYZW(vertex, 1, 0, 0, 0);
    }
    await avatar.setFacePartCorrections(null);

    expect(avatar.facePartMap!.parts.face_skin).toMatchObject({
      source: "signals",
      bindings: before.bindings,
    });
    const after = avatar.getFaceLandmarksSnapshot()!;
    expect(after.status).toBe("ready");
    // The neck triangle does not stretch the face down.
    expect(after.faceBoundsLocal!.min.y).toBeGreaterThan(chin - 0.005);
    expect(after.faceBoundsLocal!.max.y).toBeCloseTo(bounds.max.y, 4);
  });
});

describe("hair merged into the face mesh", () => {
  it("never becomes the face skin", async () => {
    for (const id of ["Andrew", "AvatarSample_A_1_New"] as const) {
      const avatar = await loadedTestAvatar(id);
      const before = avatar.facePartMap!.parts;
      // A merged mesh binds blink and aa to every primitive, hair included.
      const hair = before.hair.bindings.map(
        (key) => entryOf(avatar, key).object,
      );
      for (const name of ["blink", "aa"]) {
        for (const bind of avatar.vrm!.expressionManager!.getExpression(name)!
          .binds as unknown as { primitives?: THREE.Object3D[] }[]) {
          bind.primitives?.push(...hair);
        }
      }
      await avatar.setFacePartCorrections(null);
      expect(avatar.facePartMap!.parts.face_skin.bindings).toEqual(
        before.face_skin.bindings,
      );
    }
  });
});

/** Remove the humanoid's eye bones, as a model rigged without them. */
function removeEyeBones(avatar: Avatar): void {
  const humanoid = avatar.vrm!.humanoid as unknown as {
    _rawHumanBones: { humanBones: Record<string, unknown> };
    _normalizedHumanBones: { humanBones: Record<string, unknown> };
  };
  for (const rig of [humanoid._rawHumanBones, humanoid._normalizedHumanBones]) {
    delete rig.humanBones.leftEye;
    delete rig.humanBones.rightEye;
  }
}

describe("a model without eye bones", () => {
  it("finds the eyes when blink moves only the upper lids", async () => {
    const avatar = await loadedTestAvatar("AvatarSample_A_1_New");
    const before = avatar.facePartMap!.parts;
    const eyeY = eyeCenters(avatar)[0]!.y;
    removeEyeBones(avatar);
    // Blink leaves everything below the eyes still: the upper lid closes
    // onto a lower lid that does not move.
    const face = entryOf(avatar, before.face_skin.bindings[0]!);
    const mesh = face.object;
    const position = mesh.geometry.getAttribute("position");
    const anchor = headOf(avatar);
    mesh.updateWorldMatrix(true, false);
    anchor.updateWorldMatrix(true, false);
    const point = new THREE.Vector3();
    for (const index of blinkTargets(avatar, mesh)) {
      const target = mesh.geometry.morphAttributes.position![index]!;
      for (let vertex = 0; vertex < position.count; vertex += 1) {
        point.fromBufferAttribute(position, vertex);
        anchor.worldToLocal(mesh.localToWorld(point));
        if (point.y < eyeY) target.setXYZ(vertex, 0, 0, 0);
      }
    }
    await avatar.setFacePartCorrections(null);

    const parts = avatar.facePartMap!.parts;
    for (const role of ["eye_left", "eye_right", "eye_highlight"] as const) {
      expect(parts[role].bindings).toEqual(before[role].bindings);
    }
  });

  it("finds each eye from where blink moves the face", async () => {
    const avatar = await loadedTestAvatar("AvatarSample_A_1_New");
    const before = avatar.facePartMap!.parts;
    removeEyeBones(avatar);
    expect(avatar.vrm!.humanoid.getRawBoneNode("leftEye")).toBeNull();
    await avatar.setFacePartCorrections(null);

    const parts = avatar.facePartMap!.parts;
    for (const role of ["eye_left", "eye_right", "eye_highlight"] as const) {
      expect(parts[role]).toMatchObject({
        source: "signals",
        bindings: before[role].bindings,
      });
    }
    expect(parts.face_skin.bindings).toEqual(before.face_skin.bindings);
    expect(avatar.getFaceLandmarksSnapshot()?.eyes.left).not.toBeNull();
  });
});

describe("lashes painted into the face texture", () => {
  it("widens eye cleanup to the eyelids blink moves", async () => {
    const avatar = await loadedTestAvatar("AvatarSample_A_1_New");
    const before = avatar.getFaceTextureAnchorsSnapshot()!.flatten.eyes.left!;
    // With the eye-line mesh out of blink and its material unnamed, the model
    // has no line or lash geometry, as one whose lashes are painted on the face.
    const parts = avatar.facePartMap!.parts;
    const line = entryOf(avatar, parts.eyeline.bindings[0]!).object;
    for (const material of [line.material].flat()) material.name = "Material";
    for (const bind of avatar.vrm!.expressionManager!.getExpression("blink")!
      .binds as unknown as { primitives?: THREE.Object3D[] }[]) {
      bind.primitives = bind.primitives?.filter((mesh) => mesh !== line);
    }
    await avatar.setFacePartCorrections(null);
    expect(avatar.facePartMap!.parts.eyeline.source).toBe("missing");

    const after = avatar.getFaceTextureAnchorsSnapshot()!.flatten.eyes.left!;
    expect(after.referenceSizeLocal.width).toBeGreaterThan(
      before.referenceSizeLocal.width,
    );
    expect(after.referenceSizeLocal.height).toBeGreaterThan(
      before.referenceSizeLocal.height,
    );
  });
});

describe("eye layers found without eye bones", () => {
  it("never takes a primitive reaching past the eyes as one", async () => {
    const avatar = await loadedTestAvatar("AvatarSample_A_1_New");
    const before = avatar.facePartMap!.parts;
    removeEyeBones(avatar);
    // No eye layers to find (eyes painted on the face), and the mouth
    // primitive gains a wide triangle across both eyes, as glasses or a
    // fringe drawn in another primitive would reach over them.
    for (const key of unique([
      ...before.eye_left.bindings,
      ...before.eye_highlight.bindings,
      ...avatar.facePartMap!.eyeWhite,
    ])) {
      entryOf(avatar, key).object.removeFromParent();
    }
    const target = buildRuntimePrimitiveBindings(avatar).entries.find((entry) =>
      entry.materialName?.includes("FaceMouth"),
    )!;
    const [left, right] = eyeCenters(avatar);
    appendTriangle({
      avatar,
      binding: target,
      anchor: headOf(avatar),
      corners: [
        new THREE.Vector3(left!.x + 0.03, left!.y - 0.01, left!.z + 0.01),
        new THREE.Vector3(right!.x - 0.03, right!.y - 0.01, right!.z + 0.01),
        new THREE.Vector3(0, left!.y + 0.02, left!.z + 0.01),
      ],
      uv: [
        [0.5, 0.5],
        [0.6, 0.5],
        [0.55, 0.6],
      ],
    });
    await avatar.setFacePartCorrections(null);

    const parts = avatar.facePartMap!.parts;
    for (const role of ["eye_left", "eye_right", "eye_highlight"] as const) {
      expect(parts[role].bindings).not.toContain(target.bindingKey);
    }
    expect(avatar.facePartMap!.eyeWhite).not.toContain(target.bindingKey);
  });
});
