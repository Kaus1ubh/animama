import { encodeGlb } from "./glb";

/** Variants of {@link dummyThumbVrmBytes}. */
export type DummyThumbVrmOptions = {
  /** VRM 1.0 (`VRMC_vrm`, the default) or VRM 0.x (`VRM`). */
  vrm?: 0 | 1;
  /**
   * The skinned thumb beside the dummies: a full three-bone chain (the
   * default), a two-bone chain too short to take the humanoid thumb, or none.
   */
  counterpart?: "chain" | "short" | "none";
};

type Bone = {
  name: string;
  humanoid?: string;
  parent?: string;
  /** Offset from the parent (m). */
  at: [number, number, number];
  /** Whether the body mesh skins a vertex to it. */
  weighted: boolean;
};

const BODY: Bone[] = [
  { name: "Hips", humanoid: "hips", at: [0, 1, 0], weighted: true },
  {
    name: "Spine",
    humanoid: "spine",
    parent: "Hips",
    at: [0, 0.1, 0],
    weighted: true,
  },
  {
    name: "Head",
    humanoid: "head",
    parent: "Spine",
    at: [0, 0.4, 0],
    weighted: true,
  },
  {
    name: "UpperLeg_L",
    humanoid: "leftUpperLeg",
    parent: "Hips",
    at: [0.1, -0.05, 0],
    weighted: true,
  },
  {
    name: "LowerLeg_L",
    humanoid: "leftLowerLeg",
    parent: "UpperLeg_L",
    at: [0, -0.45, 0],
    weighted: true,
  },
  {
    name: "Foot_L",
    humanoid: "leftFoot",
    parent: "LowerLeg_L",
    at: [0, -0.45, 0],
    weighted: true,
  },
  {
    name: "UpperLeg_R",
    humanoid: "rightUpperLeg",
    parent: "Hips",
    at: [-0.1, -0.05, 0],
    weighted: true,
  },
  {
    name: "LowerLeg_R",
    humanoid: "rightLowerLeg",
    parent: "UpperLeg_R",
    at: [0, -0.45, 0],
    weighted: true,
  },
  {
    name: "Foot_R",
    humanoid: "rightFoot",
    parent: "LowerLeg_R",
    at: [0, -0.45, 0],
    weighted: true,
  },
  {
    name: "UpperArm_L",
    humanoid: "leftUpperArm",
    parent: "Spine",
    at: [0.15, 0.3, 0],
    weighted: true,
  },
  {
    name: "LowerArm_L",
    humanoid: "leftLowerArm",
    parent: "UpperArm_L",
    at: [0.25, 0, 0],
    weighted: true,
  },
  {
    name: "Hand_L",
    humanoid: "leftHand",
    parent: "LowerArm_L",
    at: [0.25, 0, 0],
    weighted: true,
  },
  {
    name: "UpperArm_R",
    humanoid: "rightUpperArm",
    parent: "Spine",
    at: [-0.15, 0.3, 0],
    weighted: true,
  },
  {
    name: "LowerArm_R",
    humanoid: "rightLowerArm",
    parent: "UpperArm_R",
    at: [-0.25, 0, 0],
    weighted: true,
  },
  {
    name: "Hand_R",
    humanoid: "rightHand",
    parent: "LowerArm_R",
    at: [-0.25, 0, 0],
    weighted: true,
  },
];

/** VRM 0.x names the thumb's three bones one step further out. */
const VRM0_THUMB_NAMES: Record<string, string> = {
  leftThumbMetacarpal: "leftThumbProximal",
  leftThumbProximal: "leftThumbIntermediate",
};

const DUMMIES: Bone[] = [
  {
    name: "Thumb1Dummy_L",
    humanoid: "leftThumbMetacarpal",
    parent: "Hand_L",
    at: [0.019, 0, 0.015],
    weighted: false,
  },
  {
    name: "Thumb2Dummy_L",
    humanoid: "leftThumbProximal",
    parent: "Thumb1Dummy_L",
    at: [0.03, 0, 0.012],
    weighted: false,
  },
  {
    name: "Thumb3Dummy_L",
    humanoid: "leftThumbDistal",
    parent: "Thumb2Dummy_L",
    at: [0.02, 0, 0.006],
    weighted: false,
  },
];

/** The skinned thumb, about a millimetre from the dummies and slightly bent. */
const REAL_THUMB: Bone[] = [
  {
    name: "Thumb1_L",
    parent: "Hand_L",
    at: [0.018, 0.001, 0.016],
    weighted: true,
  },
  {
    name: "Thumb2_L",
    parent: "Thumb1_L",
    at: [0.03, -0.002, 0.011],
    weighted: true,
  },
  {
    name: "Thumb3_L",
    parent: "Thumb2_L",
    at: [0.02, -0.002, 0.005],
    weighted: true,
  },
];

/**
 * A VRM whose left humanoid thumb maps to dummy bones that skin no vertices,
 * as some VRChat Avatars are rigged, while the body mesh follows the thumb
 * chain beside them. Every other humanoid bone and the real thumb carry one
 * vertex of the body's skin each.
 */
export function dummyThumbVrmBytes(
  options: DummyThumbVrmOptions = {},
): Uint8Array {
  const { vrm = 1, counterpart = "chain" } = options;
  const real =
    counterpart === "none"
      ? []
      : REAL_THUMB.slice(0, counterpart === "short" ? 2 : 3);
  const bones = [...BODY, ...DUMMIES, ...real];
  const index = new Map(bones.map((bone, i) => [bone.name, i]));
  const nodes: Record<string, unknown>[] = bones.map((bone) => ({
    name: bone.name,
    translation: bone.at,
  }));
  bones.forEach((bone) => {
    if (!bone.parent) return;
    const parent = nodes[index.get(bone.parent)!]!;
    parent.children = [
      ...((parent.children as number[]) ?? []),
      index.get(bone.name)!,
    ];
  });
  const bodyNode = nodes.length;
  nodes.push({ name: "Body", mesh: 0, skin: 0 });

  // One vertex per weighted bone, padded to whole triangles.
  const weightedJoints = bones.flatMap((bone, i) => (bone.weighted ? [i] : []));
  const vertexCount = Math.ceil(weightedJoints.length / 3) * 3;
  const positions = new Float32Array(vertexCount * 3);
  const joints = new Uint16Array(vertexCount * 4);
  const weights = new Float32Array(vertexCount * 4);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const joint = weightedJoints[vertex % weightedJoints.length]!;
    positions.set([vertex * 0.01, 1, 0], vertex * 3);
    joints[vertex * 4] = joint;
    weights[vertex * 4] = 1;
  }
  const bin = new Uint8Array(
    positions.byteLength + joints.byteLength + weights.byteLength,
  );
  bin.set(new Uint8Array(positions.buffer), 0);
  bin.set(new Uint8Array(joints.buffer), positions.byteLength);
  bin.set(
    new Uint8Array(weights.buffer),
    positions.byteLength + joints.byteLength,
  );

  const humanBones = bones.filter((bone) => bone.humanoid);
  const extension =
    vrm === 1
      ? {
          VRMC_vrm: {
            specVersion: "1.0",
            meta: {
              name: "Dummy thumb fixture",
              authors: ["Animama"],
              licenseUrl: "https://vrm.dev/licenses/1.0/",
            },
            humanoid: {
              humanBones: Object.fromEntries(
                humanBones.map((bone) => [
                  bone.humanoid,
                  { node: index.get(bone.name) },
                ]),
              ),
            },
          },
        }
      : {
          VRM: {
            specVersion: "0.0",
            meta: { title: "Dummy thumb fixture" },
            humanoid: {
              humanBones: humanBones.map((bone) => ({
                bone: VRM0_THUMB_NAMES[bone.humanoid!] ?? bone.humanoid,
                node: index.get(bone.name),
                useDefaultValues: true,
              })),
            },
          },
        };
  return encodeGlb(
    {
      asset: { version: "2.0" },
      extensionsUsed: [vrm === 1 ? "VRMC_vrm" : "VRM"],
      extensions: extension,
      scenes: [{ nodes: [index.get("Hips"), bodyNode] }],
      scene: 0,
      nodes,
      skins: [{ joints: bones.map((_, i) => i) }],
      meshes: [
        {
          primitives: [
            { attributes: { POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2 } },
          ],
        },
      ],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: vertexCount,
          type: "VEC3",
          min: [0, 1, 0],
          max: [(vertexCount - 1) * 0.01, 1, 0],
        },
        {
          bufferView: 1,
          componentType: 5123,
          count: vertexCount,
          type: "VEC4",
        },
        {
          bufferView: 2,
          componentType: 5126,
          count: vertexCount,
          type: "VEC4",
        },
      ],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
        {
          buffer: 0,
          byteOffset: positions.byteLength,
          byteLength: joints.byteLength,
        },
        {
          buffer: 0,
          byteOffset: positions.byteLength + joints.byteLength,
          byteLength: weights.byteLength,
        },
      ],
      buffers: [{ byteLength: bin.byteLength }],
    },
    bin,
  );
}
