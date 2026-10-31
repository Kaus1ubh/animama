import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { prepareLoadedVrm } from "./prepareLoadedVrm";
import { morphInfluence, syntheticFaceVrm } from "./testing/syntheticFaceVrm";

/**
 * A converted-VRChat-style face playing MMD's standard morphs: one eyelid
 * vertex that blink and 笑い (Joy eyes) close fully and なごみ (Fun eyes) 80% as
 * far (still shut, by the blink correction's calibration),
 * and one mouth corner that にっこり (Joy and Fun mouths) pulls out and up.
 * The `ih` viseme pulls the corner out (most of the smile's motion), `aa`
 * pulls it down (none of it). With `eyeMesh`, 笑い and なごみ also move a
 * vertex of a separate eye mesh, as a converter binds each mesh separately.
 */
function mmdFace(options: { eyeMesh?: boolean } = {}) {
  const { vrm, mesh } = syntheticFaceVrm({
    morphs: [
      "にこり",
      "笑い",
      "なごみ",
      "にっこり",
      "Blink_Authored",
      "Viseme_A",
      "Viseme_I",
    ],
    presetBinds: {
      blink: ["Blink_Authored"],
      aa: ["Viseme_A"],
      ih: ["Viseme_I"],
    },
  });
  const index = (morph: string) => mesh.morphTargetDictionary![morph]!;
  const targets = mesh.geometry.morphAttributes.position!;
  const lid = index("Blink_Authored");
  const corner = index("にっこり");
  /** Make `morph` move only `vertex`, by `motion`. */
  const move = (morph: string, vertex: number, motion: number[]) => {
    const target = targets[index(morph)]!;
    for (let at = 0; at < target.count; at += 1) target.setXYZ(at, 0, 0, 0);
    target.setXYZ(vertex, motion[0]!, motion[1]!, motion[2]!);
  };
  move("笑い", lid, [0, 0.01, 0]);
  move("なごみ", lid, [0, 0.008, 0]);
  move("にっこり", corner, [0.004, 0.002, 0]);
  move("Viseme_I", corner, [0.004, 0, 0]);
  move("Viseme_A", corner, [0, -0.004, 0]);
  const eyes = options.eyeMesh ? eyeMesh() : null;
  if (eyes) vrm.scene.add(eyes);
  prepareLoadedVrm(vrm, { vrmSha256: null });
  return { vrm, mesh, eyes };
}

/** An eye mesh whose one vertex 笑い and なごみ each move sideways. */
function eyeMesh(): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0, 0, 0], 3),
  );
  geometry.morphAttributes.position = [0, 1].map(
    () => new THREE.Float32BufferAttribute([0.003, 0, 0], 3),
  );
  geometry.morphTargetsRelative = true;
  const mesh = new THREE.Mesh(geometry);
  mesh.name = "Eyes";
  mesh.updateMorphTargets();
  mesh.morphTargetDictionary = { 笑い: 0, なごみ: 1 };
  return mesh;
}

/** Apply exactly these expression weights and update once. */
function play(
  face: { vrm: ReturnType<typeof mmdFace>["vrm"] },
  weights: Record<string, number>,
) {
  const manager = face.vrm.expressionManager!;
  for (const expression of manager.expressions) expression.weight = 0;
  for (const [name, weight] of Object.entries(weights)) {
    manager.setValue(name, weight);
  }
  manager.update();
}

const influence = (mesh: THREE.Mesh, morph: string) =>
  morphInfluence(mesh, morph);

describe("stacked eye shapes on a face Animama builds", () => {
  it("close the lids once when Joy and Fun eyes stack", () => {
    const face = mmdFace();
    play(face, { Fcl_EYE_Joy: 1, Fcl_EYE_Fun: 0.55 });
    // The stronger shape keeps its look; the weaker one has no room left.
    expect(influence(face.mesh, "笑い")).toBeCloseTo(1, 5);
    expect(influence(face.mesh, "なごみ")).toBeCloseTo(0, 5);
  });

  it("give way on every mesh the weaker shape moves", () => {
    const face = mmdFace({ eyeMesh: true });
    play(face, { Fcl_EYE_Joy: 1, Fcl_EYE_Fun: 0.55 });
    // なごみ moves the eye mesh without closing anything there; it still
    // gives way with its lids, or the eye would show half moved.
    expect(influence(face.eyes!, "なごみ")).toBeCloseTo(0, 5);
    expect(influence(face.eyes!, "笑い")).toBeCloseTo(1, 5);
    expect(influence(face.mesh, "なごみ")).toBeCloseTo(0, 5);
  });

  it("keep the shape that closes furthest when both close the lids fully", () => {
    const face = mmdFace();
    // Both count as one closure; なごみ registers first, yet 笑い closes
    // further, so it keeps its shape.
    play(face, { Fcl_EYE_Fun: 1, Fcl_ALL_Joy: 1 });
    expect(influence(face.mesh, "笑い")).toBeCloseTo(1, 5);
    expect(influence(face.mesh, "なごみ")).toBeCloseTo(0, 5);
  });

  it("let the weaker shape keep what is left of one closure", () => {
    const face = mmdFace();
    play(face, { Fcl_EYE_Joy: 0.7, Fcl_EYE_Fun: 0.6 });
    expect(influence(face.mesh, "笑い")).toBeCloseTo(0.7, 5);
    expect(influence(face.mesh, "なごみ")).toBeCloseTo(0.3, 5);
  });

  it("leave single shapes and stacks within one closure as authored", () => {
    const face = mmdFace();
    play(face, { Fcl_EYE_Fun: 1 });
    expect(influence(face.mesh, "なごみ")).toBeCloseTo(1, 5);
    play(face, { Fcl_EYE_Joy: 0.4, Fcl_EYE_Fun: 0.5 });
    expect(influence(face.mesh, "笑い")).toBeCloseTo(0.4, 5);
    expect(influence(face.mesh, "なごみ")).toBeCloseTo(0.5, 5);
  });

  it("trim only the eyes of stacked whole-face moods", () => {
    const face = mmdFace();
    play(face, { happy: 1, relaxed: 0.5 });
    expect(influence(face.mesh, "笑い")).toBeCloseTo(1, 5);
    expect(influence(face.mesh, "なごみ")).toBeCloseTo(0, 5);
    // Brows and mouth keep both moods, up to one expression's reach.
    expect(influence(face.mesh, "にこり")).toBeCloseTo(1, 5);
    expect(influence(face.mesh, "にっこり")).toBeCloseTo(1, 5);
  });
});

describe("a morph shared by stacked expressions", () => {
  it("moves no further than one expression takes it", () => {
    const face = mmdFace();
    play(face, { Fcl_BRW_Joy: 1, Fcl_BRW_Fun: 0.55 });
    expect(influence(face.mesh, "にこり")).toBeCloseTo(1, 5);
    play(face, { Fcl_BRW_Joy: 0.3, Fcl_BRW_Fun: 0.4 });
    expect(influence(face.mesh, "にこり")).toBeCloseTo(0.7, 5);
  });
});

describe("a mood's mouth under speech", () => {
  it("eases back by how much of its motion the speech shape makes", () => {
    const face = mmdFace();
    // ih repeats 80% of the smile's motion at the corner.
    play(face, { Fcl_MTH_Joy: 1, ih: 1 });
    expect(influence(face.mesh, "にっこり")).toBeCloseTo(0.2, 5);
    expect(influence(face.mesh, "Viseme_I")).toBeCloseTo(1, 5);
    play(face, { Fcl_MTH_Joy: 1, ih: 0.5 });
    expect(influence(face.mesh, "にっこり")).toBeCloseTo(0.6, 5);
  });

  it("keeps the smile under a speech shape that moves elsewhere", () => {
    const face = mmdFace();
    play(face, { Fcl_MTH_Joy: 1, aa: 1 });
    expect(influence(face.mesh, "にっこり")).toBeCloseTo(1, 5);
    expect(influence(face.mesh, "Viseme_A")).toBeCloseTo(1, 5);
  });
});

describe("a VRoid face", () => {
  it("plays its own stacked parts as authored", () => {
    const { vrm, mesh } = syntheticFaceVrm({
      morphs: ["Fcl_EYE_Joy", "Fcl_EYE_Fun", "Fcl_MTH_Joy", "Blink", "Aa"],
      presets: ["Fcl_EYE_Joy", "Fcl_EYE_Fun", "Fcl_MTH_Joy"],
      presetBinds: { blink: ["Blink"], aa: ["Aa"] },
    });
    prepareLoadedVrm(vrm, { vrmSha256: null });
    play({ vrm }, { Fcl_EYE_Joy: 1, Fcl_EYE_Fun: 0.55, Fcl_MTH_Joy: 1, aa: 1 });
    expect(influence(mesh, "Fcl_EYE_Joy")).toBeCloseTo(1, 5);
    expect(influence(mesh, "Fcl_EYE_Fun")).toBeCloseTo(0.55, 5);
    expect(influence(mesh, "Fcl_MTH_Joy")).toBeCloseTo(1, 5);
  });
});
