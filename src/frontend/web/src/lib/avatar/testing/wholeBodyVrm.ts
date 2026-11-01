import type { Avatar } from "../Avatar";
import { loadHeadlessVrmWithGltf } from "../motion-authoring/headlessVrm";
import { encodeGlb } from "./glb";
import { prepareTestAvatar } from "./loadedTestAvatar";

/** Variants of the whole-body Avatar ({@link loadWholeBodyAvatar}). */
export type WholeBodyOptions = {
  /**
   * `neck` skins the head to the neck bone too, as a rig whose mesh never
   * uses its head bone: then no forward-facing part of the body primitive is
   * skinned to the head.
   */
  headBone?: "head" | "neck";
  /**
   * VRM 0 stores the same model facing -z (turned half a turn about y), as
   * VRM 0 files do; VRM 1 (the default) faces +z.
   */
  vrm?: 0 | 1;
  /**
   * What marks the eyes: `blink` lowering the eye strokes (the default), or
   * humanoid eye bones behind them, with a `blink` that moves nothing.
   */
  eyes?: "blink" | "bones";
  /**
   * With eye bones, a second mesh of iris discs over the eye strokes, each
   * skinned to its eye bone, as a model with separate eyes keeps them.
   */
  irises?: boolean;
  /**
   * A second mesh of eye cards instead: one four-vertex quad behind each eye
   * stroke, skinned to the head and a little larger than the stroke and the
   * lid blink closes, as low-poly Avatars model eyes.
   */
  eyeCards?: boolean;
  /** `blink` and `aa` stay bound to the body but move nothing. */
  still?: boolean;
  /**
   * How `aa` opens the mouth: `morph` lowers the face's vertices at the mouth
   * (the default); `materials` shows a separate mouth quad in front of the
   * face by its material's colour (VRM 1 `materialColorBinds`, VRM 0
   * `materialValues` on `_Color`), as Avatars that swap mouth meshes do, and
   * the body has no `aa` morph target at all.
   */
  visemes?: "morph" | "materials";
  /** The one material's name (default "Body"). */
  materialName?: string;
  /**
   * Scale the head, its face, eyes, mouth, fringe and eye parts about the
   * head bone (default 1). At 2 the head is about twice the adult share of
   * the Avatar's height, as on chibi Avatars.
   */
  headScale?: number;
  /**
   * Scale the body (its bones, neck and torso) about the origin, the head
   * keeping its size on the moved head bone (default 1). With `headScale`, a
   * body of 0.4 and a head of 2 make a short chibi Avatar.
   */
  bodyScale?: number;
  /**
   * A hat of this height (m) on top of the head, skinned to the head and on
   * its own UV island, as an accessory the head mesh carries (none by
   * default).
   */
  hat?: number;
  /**
   * Subdivisions of each torso face (default 6). Fewer leave less of the
   * primitive's skin weight below the neck: 2 keeps it under a third, with
   * most of the weight on the head, as on a one-mesh chibi; 3 just over it.
   */
  torsoSegments?: number;
};

/**
 * A synthetic low-poly Avatar whose whole body is one skinned primitive on
 * one material and one texture, its face painted on, as 100Avatars-style
 * models are built: a head box skinned to the head bone, a neck to the neck
 * bone and a torso to the chest, so under half of the skin weight is on the
 * head. Two eye strokes lie on the face, each its own island, and a fringe
 * of hair sticks out 3 cm in front of the forehead, wider than the face; both
 * are skinned to the head. VRM 1.0, facing +z, without eye bones, unless
 * `options` say otherwise. `blink` lowers the eye strokes and `aa` lowers the
 * face's vertices at the mouth.
 *
 * Every part has its own UV island ({@link WHOLE_BODY_UV}). The neck and the
 * eye strokes come first in the index buffer, so the face's triangles do not
 * start the primitive.
 */
export async function loadWholeBodyAvatar(
  options: WholeBodyOptions = {},
): Promise<Avatar> {
  const bytes = wholeBodyVrmBytes(options);
  const { vrm, gltf } = await loadHeadlessVrmWithGltf(
    bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer,
    { removeUnnecessaryVertices: true },
  );
  return prepareTestAvatar(vrm, gltf, "d".repeat(64));
}

type UvRect = { u0: number; v0: number; u1: number; v1: number };

/** Where each part of the whole-body Avatar lies on its texture. */
export const WHOLE_BODY_UV = {
  face: { u0: 0.02, v0: 0.02, u1: 0.48, v1: 0.48 },
  headBack: { u0: 0.52, v0: 0.02, u1: 0.72, v1: 0.22 },
  headRight: { u0: 0.76, v0: 0.02, u1: 0.96, v1: 0.22 },
  headLeft: { u0: 0.52, v0: 0.26, u1: 0.72, v1: 0.46 },
  headTop: { u0: 0.76, v0: 0.26, u1: 0.96, v1: 0.46 },
  headBottom: { u0: 0.52, v0: 0.48, u1: 0.62, v1: 0.5 },
  fringe: { u0: 0.76, v0: 0.48, u1: 0.96, v1: 0.5 },
  eyeStrokes: { u0: 0.2, v0: 0.52, u1: 0.3, v1: 0.56 },
  mouth: { u0: 0.14, v0: 0.52, u1: 0.18, v1: 0.56 },
  hat: { u0: 0.36, v0: 0.52, u1: 0.46, v1: 0.58 },
  irises: { u0: 0.2, v0: 0.58, u1: 0.24, v1: 0.6 },
  neck: { u0: 0.02, v0: 0.52, u1: 0.12, v1: 0.58 },
  torsoFront: { u0: 0.02, v0: 0.62, u1: 0.32, v1: 0.98 },
  torsoBack: { u0: 0.36, v0: 0.62, u1: 0.66, v1: 0.98 },
  torsoSides: { u0: 0.7, v0: 0.62, u1: 0.98, v1: 0.98 },
} as const satisfies Record<string, UvRect>;

/** The head box: centre and half sizes (m); the face is its +z side. */
export const WHOLE_BODY_HEAD = {
  center: [0, 1.6, 0],
  half: [0.1, 0.15, 0.1],
} as const;
/**
 * Eye centres (x, y) on the face, where its eye strokes lie, in the VRM 1
 * layout (a VRM 0 file has x negated).
 */
export const WHOLE_BODY_EYES = [
  [0.05, 1.645],
  [-0.05, 1.645],
] as const;
/**
 * The mouth centre (x, y); `aa` lowers the vertices around it, or shows the
 * mouth quad there.
 */
const MOUTH = [0, 1.51] as const;
/** Subdivisions of the face. */
const FACE_SEGMENTS = 10;
/** Eye bones, when there are any, sit this deep inside the face (m). */
const EYE_BONE_DEPTH = 0.04;

/** Humanoid bones: name, parent, local translation. */
const BONES: readonly [string, string | null, [number, number, number]][] = [
  ["hips", null, [0, 0.9, 0]],
  ["spine", "hips", [0, 0.1, 0]],
  ["chest", "spine", [0, 0.15, 0]],
  ["neck", "chest", [0, 0.25, 0]],
  ["head", "neck", [0, 0.1, 0]],
  ["leftUpperArm", "chest", [0.18, 0.2, 0]],
  ["leftLowerArm", "leftUpperArm", [0.25, 0, 0]],
  ["leftHand", "leftLowerArm", [0.25, 0, 0]],
  ["rightUpperArm", "chest", [-0.18, 0.2, 0]],
  ["rightLowerArm", "rightUpperArm", [-0.25, 0, 0]],
  ["rightHand", "rightLowerArm", [-0.25, 0, 0]],
  ["leftUpperLeg", "hips", [0.1, -0.05, 0]],
  ["leftLowerLeg", "leftUpperLeg", [0, -0.4, 0]],
  ["leftFoot", "leftLowerLeg", [0, -0.4, 0]],
  ["rightUpperLeg", "hips", [-0.1, -0.05, 0]],
  ["rightLowerLeg", "rightUpperLeg", [0, -0.4, 0]],
  ["rightFoot", "rightLowerLeg", [0, -0.4, 0]],
];
/**
 * The skin's joints, in JOINTS_0 order; the eye bones join only when the
 * model has them.
 */
const JOINTS = ["chest", "neck", "head", "leftEye", "rightEye"] as const;
type Joint = (typeof JOINTS)[number];

type Vec3 = readonly [number, number, number];

/** The humanoid bones, with eye bones behind the eye strokes when asked. */
function humanoidBones(options: WholeBodyOptions): (typeof BONES)[number][] {
  const body = options.bodyScale ?? 1;
  const bones = BONES.map(
    ([name, parent, [x, y, z]]): (typeof BONES)[number] => [
      name,
      parent,
      [x * body, y * body, z * body],
    ],
  );
  if (options.eyes !== "bones") return bones;
  const head = boneWorldPositions(BONES).get("head")!;
  const z = WHOLE_BODY_HEAD.half[2] - EYE_BONE_DEPTH;
  const scale = options.headScale ?? 1;
  return [
    ...bones,
    ...WHOLE_BODY_EYES.map(([x, y], at): (typeof BONES)[number] => [
      at === 0 ? "leftEye" : "rightEye",
      "head",
      [(x - head[0]) * scale, (y - head[1]) * scale, (z - head[2]) * scale],
    ]),
  ];
}

/** Each bone's position at rest, from the chain of local translations. */
function boneWorldPositions(
  bones: readonly (typeof BONES)[number][],
): Map<string, Vec3> {
  const world = new Map<string, Vec3>();
  for (const [name, parent, [x, y, z]] of bones) {
    const base = parent ? world.get(parent)! : [0, 0, 0];
    world.set(name, [base[0] + x, base[1] + y, base[2] + z]);
  }
  return world;
}

/** Geometry being built: one primitive, two morph targets (blink, aa). */
class PrimitiveBuilder {
  positions: number[] = [];
  uvs: number[] = [];
  joints: number[] = [];
  weights: number[] = [];
  blink: number[] = [];
  aa: number[] = [];
  indices: number[] = [];

  /**
   * A grid of `segments` × `segments` quads from `origin` along `u` and `v`,
   * wound to face `u × v`, mapped onto `uv`, skinned wholly to `joint`.
   */
  grid(args: {
    origin: Vec3;
    u: Vec3;
    v: Vec3;
    uv: UvRect;
    joint: Joint;
    segments?: number;
    morph?: (point: Vec3) => { blink?: number; aa?: number };
  }): void {
    const segments = args.segments ?? 1;
    const first = this.positions.length / 3;
    for (let row = 0; row <= segments; row += 1) {
      for (let column = 0; column <= segments; column += 1) {
        const s = column / segments;
        const t = row / segments;
        const point: Vec3 = [0, 1, 2].map(
          (axis) => args.origin[axis]! + args.u[axis]! * s + args.v[axis]! * t,
        ) as unknown as Vec3;
        this.positions.push(...point);
        this.uvs.push(
          args.uv.u0 + (args.uv.u1 - args.uv.u0) * s,
          args.uv.v0 + (args.uv.v1 - args.uv.v0) * t,
        );
        this.joints.push(JOINTS.indexOf(args.joint), 0, 0, 0);
        this.weights.push(1, 0, 0, 0);
        const moved = args.morph?.(point) ?? {};
        this.blink.push(0, -(moved.blink ?? 0), 0);
        this.aa.push(0, -(moved.aa ?? 0), 0);
      }
    }
    const at = (row: number, column: number) =>
      first + row * (segments + 1) + column;
    for (let row = 0; row < segments; row += 1) {
      for (let column = 0; column < segments; column += 1) {
        const a = at(row, column);
        const b = at(row, column + 1);
        const c = at(row + 1, column + 1);
        const d = at(row + 1, column);
        this.indices.push(a, b, c, a, c, d);
      }
    }
  }

  /**
   * Scale the vertices from index `first` on (and their morph movement)
   * about `pivot` by `scale`.
   */
  scaleFrom(first: number, pivot: Vec3, scale: number, end?: number): void {
    if (scale === 1) return;
    const last = end === undefined ? this.positions.length : end * 3;
    for (let at = first * 3; at < last; at += 1) {
      const axis = at % 3;
      this.positions[at] =
        pivot[axis]! + (this.positions[at]! - pivot[axis]!) * scale;
      this.blink[at] = this.blink[at]! * scale;
      this.aa[at] = this.aa[at]! * scale;
    }
  }

  /** Move vertices `first` up to `end` (default all) by `offset`. */
  moveBy(first: number, offset: Vec3, end?: number): void {
    const last = end === undefined ? this.positions.length : end * 3;
    for (let at = first * 3; at < last; at += 1)
      this.positions[at] = this.positions[at]! + offset[at % 3]!;
  }

  /** The six faces of a box, each a grid of its own on its own UV island. */
  box(args: {
    center: Vec3;
    half: Vec3;
    joint: Joint;
    uv: Record<"front" | "back" | "right" | "left" | "top" | "bottom", UvRect>;
    frontSegments?: number;
    segments?: number;
    morph?: (point: Vec3) => { blink?: number; aa?: number };
    omit?: readonly ("top" | "bottom")[];
  }): void {
    const [cx, cy, cz] = args.center;
    const [hx, hy, hz] = args.half;
    const segments = args.segments ?? 1;
    const faces: [keyof typeof args.uv, Vec3, Vec3, Vec3][] = [
      ["front", [cx - hx, cy - hy, cz + hz], [2 * hx, 0, 0], [0, 2 * hy, 0]],
      ["back", [cx + hx, cy - hy, cz - hz], [-2 * hx, 0, 0], [0, 2 * hy, 0]],
      ["right", [cx + hx, cy - hy, cz + hz], [0, 0, -2 * hz], [0, 2 * hy, 0]],
      ["left", [cx - hx, cy - hy, cz - hz], [0, 0, 2 * hz], [0, 2 * hy, 0]],
      ["top", [cx - hx, cy + hy, cz + hz], [2 * hx, 0, 0], [0, 0, -2 * hz]],
      ["bottom", [cx - hx, cy - hy, cz - hz], [2 * hx, 0, 0], [0, 0, 2 * hz]],
    ];
    for (const [side, origin, u, v] of faces) {
      if ((args.omit as readonly string[] | undefined)?.includes(side)) {
        continue;
      }
      this.grid({
        origin,
        u,
        v,
        uv: args.uv[side],
        joint: args.joint,
        segments:
          side === "front" ? (args.frontSegments ?? segments) : segments,
        ...(side === "front" && args.morph ? { morph: args.morph } : {}),
      });
    }
  }
}

/** The face's `aa` movement at a point on it. */
function faceMorph(point: Vec3): { aa?: number } {
  const [x, y] = point;
  return {
    aa:
      Math.abs(x - MOUTH[0]) <= 0.021 && Math.abs(y - MOUTH[1]) <= 0.016
        ? 0.01
        : 0,
  };
}

/** The whole-body Avatar's GLB bytes ({@link loadWholeBodyAvatar}). */
export function wholeBodyVrmBytes(options: WholeBodyOptions = {}): Uint8Array {
  if (options.irises && options.eyes !== "bones") {
    throw new Error('Irises need eye bones (eyes: "bones")');
  }
  if (options.irises && options.eyeCards) {
    throw new Error("Irises and eye cards are alternatives");
  }
  const headJoint: Joint = options.headBone ?? "head";
  const mesh = new PrimitiveBuilder();
  const uv = WHOLE_BODY_UV;
  mesh.box({
    center: [0, 1.42, 0],
    half: [0.04, 0.03, 0.04],
    joint: "neck",
    uv: {
      front: uv.neck,
      back: uv.neck,
      right: uv.neck,
      left: uv.neck,
      top: uv.neck,
      bottom: uv.neck,
    },
    omit: ["top", "bottom"],
  });
  const headStart = mesh.positions.length / 3;
  // Painted eye strokes just in front of the face, which blink lowers.
  for (const [x, y] of WHOLE_BODY_EYES) {
    mesh.grid({
      origin: [x - 0.015, y - 0.005, WHOLE_BODY_HEAD.half[2] + 0.0005],
      u: [0.03, 0, 0],
      v: [0, 0.01, 0],
      uv: uv.eyeStrokes,
      joint: headJoint,
      morph: () => ({
        blink: options.eyes === "bones" || options.still ? 0 : 0.004,
      }),
    });
  }
  mesh.box({
    center: WHOLE_BODY_HEAD.center,
    half: WHOLE_BODY_HEAD.half,
    joint: headJoint,
    uv: {
      front: uv.face,
      back: uv.headBack,
      right: uv.headRight,
      left: uv.headLeft,
      top: uv.headTop,
      bottom: uv.headBottom,
    },
    frontSegments: FACE_SEGMENTS,
    ...(options.still ? {} : { morph: faceMorph }),
  });
  // A fringe of hair over the forehead, wider than the face, in front of it.
  mesh.grid({
    origin: [-0.11, 1.7, 0.13],
    u: [0.22, 0, 0],
    v: [0, 0.06, 0],
    uv: uv.fringe,
    joint: headJoint,
  });
  if (options.hat) {
    const top = WHOLE_BODY_HEAD.center[1] + WHOLE_BODY_HEAD.half[1];
    mesh.box({
      center: [0, top + options.hat / 2, 0],
      half: [0.08, options.hat / 2, 0.08],
      joint: headJoint,
      uv: {
        front: uv.hat,
        back: uv.hat,
        right: uv.hat,
        left: uv.hat,
        top: uv.hat,
        bottom: uv.hat,
      },
      omit: ["bottom"],
    });
  }
  const headScale = options.headScale ?? 1;
  const headBone = boneWorldPositions(BONES).get("head")!;
  mesh.scaleFrom(headStart, headBone, headScale);
  const torsoStart = mesh.positions.length / 3;
  mesh.box({
    center: [0, 1.15, 0],
    half: [0.15, 0.25, 0.1],
    joint: "chest",
    uv: {
      front: uv.torsoFront,
      back: uv.torsoBack,
      right: uv.torsoSides,
      left: uv.torsoSides,
      top: uv.torsoSides,
      bottom: uv.torsoSides,
    },
    segments: options.torsoSegments ?? 6,
  });
  const irises = options.irises ? new PrimitiveBuilder() : null;
  WHOLE_BODY_EYES.forEach(([x, y], at) => {
    irises?.grid({
      origin: [x - 0.01, y - 0.01, WHOLE_BODY_HEAD.half[2] + 0.002],
      u: [0.02, 0, 0],
      v: [0, 0.02, 0],
      uv: uv.irises,
      joint: at === 0 ? "leftEye" : "rightEye",
    });
  });
  const cards = options.eyeCards ? new PrimitiveBuilder() : null;
  for (const [x, y] of WHOLE_BODY_EYES) {
    // 2 mm wider than the stroke on each side, 1 mm above it and below where
    // blink lowers it, between the face and the stroke.
    cards?.grid({
      origin: [x - 0.017, y - 0.01, WHOLE_BODY_HEAD.half[2] + 0.0002],
      u: [0.034, 0, 0],
      v: [0, 0.016, 0],
      uv: uv.irises,
      joint: headJoint,
    });
  }
  // A mouth quad just in front of the face, shown by `aa`'s material bind.
  const mouth = options.visemes === "materials" ? new PrimitiveBuilder() : null;
  mouth?.grid({
    origin: [
      MOUTH[0] - 0.02,
      MOUTH[1] - 0.012,
      WHOLE_BODY_HEAD.half[2] + 0.001,
    ],
    u: [0.04, 0, 0],
    v: [0, 0.024, 0],
    uv: uv.mouth,
    joint: headJoint,
  });
  irises?.scaleFrom(0, headBone, headScale);
  cards?.scaleFrom(0, headBone, headScale);
  mouth?.scaleFrom(0, headBone, headScale);
  const bodyScale = options.bodyScale ?? 1;
  if (bodyScale !== 1) {
    // The neck and torso scale about the origin; the head rides the head bone.
    const origin: Vec3 = [0, 0, 0];
    const lift: Vec3 = [0, headBone[1] * (bodyScale - 1), 0];
    mesh.scaleFrom(0, origin, bodyScale, headStart);
    mesh.scaleFrom(torsoStart, origin, bodyScale);
    mesh.moveBy(headStart, lift, torsoStart);
    irises?.moveBy(0, lift);
    cards?.moveBy(0, lift);
    mouth?.moveBy(0, lift);
  }
  return encodeWholeBodyGlb(mesh, irises ?? cards, mouth, options);
}

function encodeWholeBodyGlb(
  mesh: PrimitiveBuilder,
  eyes: PrimitiveBuilder | null,
  mouth: PrimitiveBuilder | null,
  options: WholeBodyOptions,
): Uint8Array {
  // A VRM 0 file holds the model turned half a turn about y, facing -z.
  const turn = options.vrm === 0 ? -1 : 1;
  const turned = (values: number[]) =>
    values.map((value, at) => (at % 3 === 1 ? value : value * turn));
  const bones = humanoidBones(options).map(
    ([name, parent, [x, y, z]]): (typeof BONES)[number] => [
      name,
      parent,
      [x * turn, y, z * turn],
    ],
  );
  const chunks: Uint8Array[] = [];
  const bufferViews: { buffer: 0; byteOffset: number; byteLength: number }[] =
    [];
  let byteLength = 0;
  const addView = (bytes: Uint8Array): number => {
    const padding = (4 - (byteLength % 4)) % 4;
    if (padding) chunks.push(new Uint8Array(padding));
    byteLength += padding;
    bufferViews.push({
      buffer: 0,
      byteOffset: byteLength,
      byteLength: bytes.length,
    });
    chunks.push(bytes);
    byteLength += bytes.length;
    return bufferViews.length - 1;
  };
  const floats = (values: number[]) =>
    new Uint8Array(new Float32Array(values).buffer);

  // World positions of the bones, for the inverse bind matrices.
  const world = boneWorldPositions(bones);
  const joints = JOINTS.filter((joint) => world.has(joint));
  const inverseBind = joints.flatMap((joint) => {
    const [x, y, z] = world.get(joint)!;
    // Column-major translation by minus the joint's bind position.
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1];
  });

  const accessors: object[] = [];
  const accessor = (fields: object): number => {
    accessors.push(fields);
    return accessors.length - 1;
  };
  const bounds = (values: number[]) => {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let at = 0; at < values.length; at += 3) {
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis]!, values[at + axis]!);
        max[axis] = Math.max(max[axis]!, values[at + axis]!);
      }
    }
    return { min, max };
  };
  const vec3 = (values: number[], count: number) =>
    accessor({
      bufferView: addView(floats(turned(values))),
      componentType: 5126,
      count,
      type: "VEC3",
      ...bounds(turned(values)),
    });
  const materialVisemes = options.visemes === "materials";
  /**
   * One primitive's accessors; `morphs` adds the blink target and, unless
   * `aa` switches a material, the aa target.
   */
  const primitive = (
    builder: PrimitiveBuilder,
    material: number,
    morphs: boolean,
  ) => {
    const count = builder.positions.length / 3;
    return {
      attributes: {
        POSITION: vec3(builder.positions, count),
        TEXCOORD_0: accessor({
          bufferView: addView(floats(builder.uvs)),
          componentType: 5126,
          count,
          type: "VEC2",
        }),
        JOINTS_0: accessor({
          bufferView: addView(
            new Uint8Array(new Uint16Array(builder.joints).buffer),
          ),
          componentType: 5123,
          count,
          type: "VEC4",
        }),
        WEIGHTS_0: accessor({
          bufferView: addView(floats(builder.weights)),
          componentType: 5126,
          count,
          type: "VEC4",
        }),
      },
      ...(morphs
        ? {
            targets: [
              { POSITION: vec3(builder.blink, count) },
              ...(materialVisemes
                ? []
                : [{ POSITION: vec3(builder.aa, count) }]),
            ],
          }
        : {}),
      indices: accessor({
        bufferView: addView(
          new Uint8Array(new Uint16Array(builder.indices).buffer),
        ),
        componentType: 5123,
        count: builder.indices.length,
        type: "SCALAR",
      }),
      material,
    };
  };
  const meshes = [
    {
      name: "Body",
      primitives: [primitive(mesh, 0, true)],
      extras: { targetNames: materialVisemes ? ["blink"] : ["blink", "aa"] },
    },
    ...(eyes
      ? [{ name: "Eyes", primitives: [primitive(eyes, 1, false)] }]
      : []),
    ...(mouth
      ? [{ name: "Mouth", primitives: [primitive(mouth, 2, false)] }]
      : []),
  ];
  const inverseBindMatrices = accessor({
    bufferView: addView(floats(inverseBind)),
    componentType: 5126,
    count: joints.length,
    type: "MAT4",
  });
  // A 1 × 1 PNG; headless loads replace every texture with a placeholder.
  const image = addView(
    Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
      ),
      (character) => character.charCodeAt(0),
    ),
  );

  const boneIndex = new Map(bones.map(([name], index) => [name, index]));
  const meshNode = bones.length;
  const nodes = [
    ...bones.map(([name, , translation]) => {
      const children = bones
        .filter(([, parent]) => parent === name)
        .map(([child]) => boneIndex.get(child)!);
      return {
        name,
        translation,
        ...(children.length > 0 ? { children } : {}),
      };
    }),
    { name: "Body", mesh: 0, skin: 0 },
    ...(eyes ? [{ name: "Eyes", mesh: 1, skin: 0 }] : []),
    ...(mouth ? [{ name: "Mouth", mesh: eyes ? 2 : 1, skin: 0 }] : []),
  ];
  const morphBind = (index: number) => ({
    morphTargetBinds: [{ node: meshNode, index, weight: 1 }],
  });
  const vrm1 = {
    VRMC_vrm: {
      specVersion: "1.0",
      meta: {
        name: "Whole body",
        authors: ["Animama"],
        licenseUrl: "https://vrm.dev/licenses/1.0/",
      },
      humanoid: {
        humanBones: Object.fromEntries(
          bones.map(([name], index) => [name, { node: index }]),
        ),
      },
      expressions: {
        preset: {
          blink: morphBind(0),
          aa: materialVisemes
            ? {
                materialColorBinds: [
                  { material: 2, type: "color", targetValue: [1, 1, 1, 1] },
                ],
              }
            : morphBind(1),
        },
      },
    },
  };
  // VRM 0 binds morphs by mesh with weights out of 100; `a` is its `aa`.
  const group = (presetName: string, index: number) => ({
    name: presetName,
    presetName,
    binds: [{ mesh: 0, index, weight: 100 }],
    materialValues: [],
  });
  const mouthGroup = {
    name: "a",
    presetName: "a",
    binds: [],
    materialValues: [
      {
        materialName: "Mouth",
        propertyName: "_Color",
        targetValue: [1, 1, 1, 1],
      },
    ],
  };
  const vrm0 = {
    VRM: {
      specVersion: "0.0",
      meta: {
        title: "Whole body",
        version: "1.0",
        author: "Animama",
        licenseName: "CC0",
      },
      humanoid: {
        humanBones: bones.map(([bone], node) => ({
          bone,
          node,
          useDefaultValues: true,
        })),
      },
      firstPerson: { firstPersonBone: boneIndex.get("head")! },
      blendShapeMaster: {
        blendShapeGroups: [
          group("blink", 0),
          materialVisemes ? mouthGroup : group("a", 1),
        ],
      },
      materialProperties: [],
    },
  };
  const json = {
    asset: { version: "2.0" },
    extensionsUsed: [options.vrm === 0 ? "VRM" : "VRMC_vrm"],
    scene: 0,
    scenes: [
      {
        nodes: [
          boneIndex.get("hips")!,
          ...nodes.flatMap((node, index) => ("mesh" in node ? [index] : [])),
        ],
      },
    ],
    nodes,
    skins: [
      {
        joints: joints.map((joint) => boneIndex.get(joint)!),
        inverseBindMatrices,
      },
    ],
    meshes,
    materials: [
      {
        name: options.materialName ?? "Body",
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0 },
          metallicFactor: 0,
        },
      },
      { name: "Eyes", pbrMetallicRoughness: { metallicFactor: 0 } },
      { name: "Mouth", pbrMetallicRoughness: { metallicFactor: 0 } },
    ],
    textures: [{ source: 0 }],
    images: [{ bufferView: image, mimeType: "image/png" }],
    accessors,
    bufferViews,
    buffers: [{ byteLength }],
    extensions: options.vrm === 0 ? vrm0 : vrm1,
  };
  const bin = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bin.set(chunk, offset);
    offset += chunk.length;
  }
  return encodeGlb(json, bin);
}
