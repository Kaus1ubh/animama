import { BinaryBuilder, writeGlb } from "../vrm-optimize/glb.mjs";

const VERTICES = 4;

/** The bones three-vrm requires; each is a child of hips in the fixture. */
const REQUIRED_BONES = [
  "hips",
  "spine",
  "head",
  ...["left", "right"].flatMap((side) =>
    ["UpperLeg", "LowerLeg", "Foot", "UpperArm", "LowerArm", "Hand"].map(
      (bone) => `${side}${bone}`,
    ),
  ),
];

/**
 * A minimal VRM 1.0 GLB that three-vrm loads, for VRM script tests. Each mesh
 * has one primitive whose morph targets all share one displacement; `names`
 * are stored at mesh level (as three.js reads them) unless `perPrimitive`
 * stores them on the primitive instead (or, given a list, stores that list,
 * to model one that disagrees with the targets).
 *
 * @param options.meshes Mesh name, morph-target names and name storage.
 * @param options.json Extra top-level JSON merged over the defaults; its
 *   `extensions` are added beside `VRMC_vrm`.
 * @param options.vrm Fields merged into the `VRMC_vrm` extension.
 * @returns The GLB bytes and the node index of the first mesh.
 */
export function faceFixtureVrm({ meshes, json: extra = {}, vrm = {} }) {
  const builder = new BinaryBuilder();
  const floats = (values) => Buffer.from(new Float32Array(values).buffer);
  const position = builder.add(floats(new Array(VERTICES * 3).fill(0)));
  const target = builder.add(
    floats([0, 0.01, 0, ...new Array((VERTICES - 1) * 3).fill(0)]),
  );
  const vec3 = (bufferView, fields = {}) => ({
    bufferView,
    componentType: 5126,
    count: VERTICES,
    type: "VEC3",
    ...fields,
  });
  const meshNode = REQUIRED_BONES.length;
  const vrmExtension = {
    specVersion: "1.0",
    meta: {
      name: "Fixture",
      authors: ["Animama"],
      licenseUrl: "https://vrm.dev/licenses/1.0/",
    },
    humanoid: {
      humanBones: Object.fromEntries(
        REQUIRED_BONES.map((bone, node) => [bone, { node }]),
      ),
    },
    ...vrm,
  };
  const json = {
    asset: { version: "2.0" },
    extensionsUsed: ["VRMC_vrm"],
    nodes: [
      ...REQUIRED_BONES.map((name, index) =>
        index === 0
          ? {
              name,
              // Every other bone, then the mesh nodes.
              children: Array.from(
                { length: REQUIRED_BONES.length - 1 + meshes.length },
                (_, child) => child + 1,
              ),
            }
          : { name },
      ),
      ...meshes.map((_, index) => ({ mesh: index })),
    ],
    scenes: [{ nodes: [0] }],
    meshes: meshes.map(({ name, names, perPrimitive = false }) => ({
      name,
      primitives: [
        {
          attributes: { POSITION: 0 },
          targets: names.map(() => ({ POSITION: 1 })),
          ...(perPrimitive
            ? {
                extras: {
                  targetNames: Array.isArray(perPrimitive)
                    ? perPrimitive
                    : names,
                },
              }
            : {}),
        },
      ],
      ...(perPrimitive ? {} : { extras: { targetNames: names } }),
    })),
    accessors: [
      vec3(position, { min: [0, 0, 0], max: [0, 0, 0] }),
      vec3(target),
    ],
    ...extra,
  };
  json.extensions = { ...extra.extensions, VRMC_vrm: vrmExtension };
  json.bufferViews = builder.views;
  const bin = builder.toBuffer();
  json.buffers = [{ byteLength: bin.length + (-bin.length & 3) }];
  return { bytes: new Uint8Array(writeGlb(json, bin)), meshNode };
}
