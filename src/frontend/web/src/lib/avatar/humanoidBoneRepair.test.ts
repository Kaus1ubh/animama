import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyHumanoidBoneRepair,
  humanBoneNodes,
  nodesMovingTheMesh,
  planHumanoidBoneRepair,
  type SkinAccessor,
} from "./humanoidBoneRepair";
import { loadHeadlessVrm } from "./motion-authoring/headlessVrm";
import { dummyThumbVrmBytes } from "./testing/dummyThumbVrm";

type NodeSpec = {
  name: string;
  parent?: string;
  at: [number, number, number];
  humanoid?: string;
  /** Skinned geometry on the node itself. */
  carries?: boolean;
  /** An unskinned mesh attached to the node. */
  rigid?: boolean;
};

/**
 * A glTF JSON with these nodes (each offset from its parent), mapped as VRM
 * 1.0 or 0.x, and which nodes carry skin weight.
 */
function rig(specs: NodeSpec[], vrm: 0 | 1 = 1) {
  const index = new Map(specs.map((spec, i) => [spec.name, i]));
  const nodes: Record<string, unknown>[] = specs.map((spec) => ({
    name: spec.name,
    translation: spec.at,
    ...(spec.rigid ? { mesh: 0 } : {}),
  }));
  specs.forEach((spec) => {
    if (!spec.parent) return;
    const parent = nodes[index.get(spec.parent)!]!;
    parent.children = [
      ...((parent.children as number[]) ?? []),
      index.get(spec.name)!,
    ];
  });
  const mapped = specs.filter((spec) => spec.humanoid);
  const json = {
    nodes,
    extensions:
      vrm === 1
        ? {
            VRMC_vrm: {
              humanoid: {
                humanBones: Object.fromEntries(
                  mapped.map((spec) => [
                    spec.humanoid,
                    { node: index.get(spec.name) },
                  ]),
                ),
              },
            },
          }
        : {
            VRM: {
              humanoid: {
                humanBones: mapped.map((spec) => ({
                  bone: spec.humanoid,
                  node: index.get(spec.name),
                })),
              },
            },
          },
  };
  const carries = specs.map((spec) => Boolean(spec.carries || spec.rigid));
  return { json, carries, index };
}

const HAND: NodeSpec[] = [
  { name: "Hips", at: [0, 1, 0], humanoid: "hips", carries: true },
  {
    name: "Hand_L",
    parent: "Hips",
    at: [0.6, 0.4, 0],
    humanoid: "leftHand",
    carries: true,
  },
  {
    name: "Index1_L",
    parent: "Hand_L",
    at: [0.06, 0, 0.01],
    humanoid: "leftIndexProximal",
    carries: true,
  },
];

const DUMMY_THUMB: NodeSpec[] = [
  {
    name: "Thumb1Dummy_L",
    parent: "Hand_L",
    at: [0.019, 0, 0.015],
    humanoid: "leftThumbMetacarpal",
  },
  {
    name: "Thumb2Dummy_L",
    parent: "Thumb1Dummy_L",
    at: [0.03, 0, 0.012],
    humanoid: "leftThumbProximal",
  },
  {
    name: "Thumb3Dummy_L",
    parent: "Thumb2Dummy_L",
    at: [0.02, 0, 0.006],
    humanoid: "leftThumbDistal",
  },
];

const REAL_THUMB: NodeSpec[] = [
  {
    name: "Thumb1_L",
    parent: "Hand_L",
    at: [0.018, 0.001, 0.016],
    carries: true,
  },
  {
    name: "Thumb2_L",
    parent: "Thumb1_L",
    at: [0.03, -0.002, 0.011],
    carries: true,
  },
  {
    name: "Thumb3_L",
    parent: "Thumb2_L",
    at: [0.02, -0.002, 0.005],
    carries: true,
  },
];

/** Each remap as humanoid bone → node names. */
function named(
  plan: ReturnType<typeof planHumanoidBoneRepair>,
  specs: NodeSpec[],
) {
  return plan.remaps.map(
    ({ bone, from, to }) =>
      `${bone}: ${specs[from]!.name} -> ${specs[to]!.name}`,
  );
}

describe("planHumanoidBoneRepair", () => {
  it("moves a dummy thumb chain to the skinned chain beside it", () => {
    const specs = [...HAND, ...DUMMY_THUMB, ...REAL_THUMB];
    const { json, carries } = rig(specs);
    const plan = planHumanoidBoneRepair(json, carries);
    expect(named(plan, specs)).toEqual([
      "leftThumbMetacarpal: Thumb1Dummy_L -> Thumb1_L",
      "leftThumbProximal: Thumb2Dummy_L -> Thumb2_L",
      "leftThumbDistal: Thumb3Dummy_L -> Thumb3_L",
    ]);
    expect(plan.unweighted).toEqual([]);
  });

  it("reads a VRM 0.x mapping the same way", () => {
    const specs = [...HAND, ...DUMMY_THUMB, ...REAL_THUMB];
    const { json, carries } = rig(specs, 0);
    expect(named(planHumanoidBoneRepair(json, carries), specs)).toHaveLength(3);
  });

  it("leaves a clean rig alone", () => {
    const specs = [
      ...HAND,
      ...REAL_THUMB.map((spec, i) => ({
        ...spec,
        humanoid: DUMMY_THUMB[i]!.humanoid,
      })),
    ];
    const { json, carries } = rig(specs);
    expect(planHumanoidBoneRepair(json, carries)).toEqual({
      remaps: [],
      unweighted: [],
    });
  });

  it("reports a dead bone with no counterpart and keeps it", () => {
    const specs = [
      ...HAND,
      {
        name: "Index2_L",
        parent: "Index1_L",
        at: [0.03, 0, 0],
        humanoid: "leftIndexIntermediate",
        carries: true,
      },
      {
        name: "Index3_L",
        parent: "Index2_L",
        at: [0.02, 0, 0],
        humanoid: "leftIndexDistal",
      },
    ] satisfies NodeSpec[];
    const { json, carries } = rig(specs);
    expect(planHumanoidBoneRepair(json, carries)).toEqual({
      remaps: [],
      unweighted: ["leftIndexDistal"],
    });
  });

  it("does not take a sibling farther than a quarter of the bone's offset", () => {
    const far = REAL_THUMB.map((spec, i) =>
      i === 0
        ? { ...spec, at: [0.03, 0.01, 0.02] as [number, number, number] }
        : spec,
    );
    const { json, carries } = rig([...HAND, ...DUMMY_THUMB, ...far]);
    const plan = planHumanoidBoneRepair(json, carries);
    expect(plan.remaps).toEqual([]);
    expect(plan.unweighted).toEqual([
      "leftThumbMetacarpal",
      "leftThumbProximal",
      "leftThumbDistal",
    ]);
  });

  it("never takes a bone another humanoid bone already uses", () => {
    // The index finger lies where the dead bone is, but it is the index.
    const specs = [
      ...HAND,
      {
        name: "IndexDummy_L",
        parent: "Hand_L",
        at: [0.06, 0, 0.011],
        humanoid: "leftMiddleProximal",
      },
    ] satisfies NodeSpec[];
    const { json, carries } = rig(specs);
    expect(planHumanoidBoneRepair(json, carries)).toEqual({
      remaps: [],
      unweighted: ["leftMiddleProximal"],
    });
  });

  it("leaves the whole chain when the counterpart is too short", () => {
    const { json, carries } = rig([
      ...HAND,
      ...DUMMY_THUMB,
      ...REAL_THUMB.slice(0, 2),
    ]);
    const plan = planHumanoidBoneRepair(json, carries);
    expect(plan.remaps).toEqual([]);
    expect(plan.unweighted).toEqual([
      "leftThumbMetacarpal",
      "leftThumbProximal",
      "leftThumbDistal",
    ]);
  });

  it("never gives two runs the same bone", () => {
    const specs = [
      ...HAND,
      {
        name: "DummyA_L",
        parent: "Hand_L",
        at: [0.03, 0.02, 0.02],
        humanoid: "leftThumbMetacarpal",
      },
      {
        name: "DummyB_L",
        parent: "Hand_L",
        at: [0.03, 0.02, 0.021],
        humanoid: "leftLittleProximal",
      },
      {
        name: "Real_L",
        parent: "Hand_L",
        at: [0.031, 0.02, 0.02],
        carries: true,
      },
    ] satisfies NodeSpec[];
    const { json, carries } = rig(specs);
    const plan = planHumanoidBoneRepair(json, carries);
    expect(named(plan, specs)).toEqual([
      "leftLittleProximal: DummyB_L -> Real_L",
    ]);
    expect(plan.unweighted).toEqual(["leftThumbMetacarpal"]);
  });

  it("keeps a dummy chain that drives the skinned chain through a constraint", () => {
    const specs = [...HAND, ...DUMMY_THUMB, ...REAL_THUMB];
    const { json, index } = rig(specs);
    // The skinned thumb follows the dummies, as a VRM 1.0 rotation constraint.
    REAL_THUMB.forEach((spec, i) => {
      (
        json.nodes[index.get(spec.name)!] as Record<string, unknown>
      ).extensions = {
        VRMC_node_constraint: {
          constraint: {
            rotation: { source: index.get(DUMMY_THUMB[i]!.name) },
          },
        },
      };
    });
    const carries = nodesMovingTheMesh(json, () => null)!;
    specs.forEach((spec, i) => {
      if (spec.carries) carries[i] = true;
    });
    expect(planHumanoidBoneRepair(json, carries)).toEqual({
      remaps: [],
      unweighted: [],
    });
  });

  it("counts an unskinned mesh under a bone as moving it", () => {
    const specs = [
      ...HAND,
      {
        name: "Index2_L",
        parent: "Index1_L",
        at: [0.03, 0, 0],
        humanoid: "leftIndexIntermediate",
        rigid: true,
      },
    ] satisfies NodeSpec[];
    const { json, carries } = rig(specs);
    expect(planHumanoidBoneRepair(json, carries).unweighted).toEqual([]);
  });

  it("ignores eyes, jaw and toes, which models often leave unweighted", () => {
    const specs = [
      ...HAND,
      {
        name: "Eye_L",
        parent: "Hips",
        at: [0.03, 0.6, 0.1],
        humanoid: "leftEye",
      },
      { name: "Jaw", parent: "Hips", at: [0, 0.55, 0.05], humanoid: "jaw" },
      {
        name: "Toes_L",
        parent: "Hips",
        at: [0.1, -0.9, 0.1],
        humanoid: "leftToes",
      },
    ] satisfies NodeSpec[];
    const { json, carries } = rig(specs);
    expect(planHumanoidBoneRepair(json, carries)).toEqual({
      remaps: [],
      unweighted: [],
    });
  });
});

describe("applyHumanoidBoneRepair", () => {
  it.each([1, 0] as const)("rewrites the VRM %s mapping", (vrm) => {
    const specs = [...HAND, ...DUMMY_THUMB, ...REAL_THUMB];
    const { json, carries, index } = rig(specs, vrm);
    applyHumanoidBoneRepair(json, planHumanoidBoneRepair(json, carries).remaps);
    const bones = humanBoneNodes(json);
    expect(bones.get("leftThumbMetacarpal")).toBe(index.get("Thumb1_L"));
    expect(bones.get("leftThumbDistal")).toBe(index.get("Thumb3_L"));
    expect(bones.get("leftIndexProximal")).toBe(index.get("Index1_L"));
  });
});

describe("nodesMovingTheMesh", () => {
  const accessor = (values: number[][]): SkinAccessor => ({
    count: values.length,
    itemSize: 4,
    get: (index, component) => values[index]![component]!,
  });
  const json = {
    nodes: [
      { name: "A" },
      { name: "B" },
      { name: "C" },
      { mesh: 0, skin: 0 },
      { mesh: 1 },
    ],
    skins: [{ joints: [0, 1, 2] }],
    meshes: [
      { primitives: [{ attributes: { JOINTS_0: 0, WEIGHTS_0: 1 } }] },
      { primitives: [{ attributes: { POSITION: 2 } }] },
    ],
  };

  it("marks joints with weight and unskinned mesh nodes", () => {
    const read = (index: number) =>
      index === 0
        ? accessor([[0, 1, 2, 0]])
        : index === 1
          ? accessor([[0.6, 0.4, 0, 0]])
          : null;
    expect(nodesMovingTheMesh(json, read)).toEqual([
      true,
      true,
      false,
      false,
      true,
    ]);
  });

  it("marks VRM 1.0 node constraint sources, whose destinations follow them", () => {
    const constrained = structuredClone(json);
    (constrained.nodes[2] as Record<string, unknown>).extensions = {
      VRMC_node_constraint: { constraint: { rotation: { source: 1 } } },
    };
    const read = (index: number) =>
      index === 0
        ? accessor([[2, 0, 0, 0]])
        : index === 1
          ? accessor([[1, 0, 0, 0]])
          : null;
    expect(nodesMovingTheMesh(constrained, read)).toEqual([
      false,
      true,
      true,
      false,
      true,
    ]);
  });

  it("returns null when a skin accessor cannot be read", () => {
    expect(nodesMovingTheMesh(json, () => null)).toBeNull();
  });
});

describe("HumanoidBoneRepairPlugin", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  it.each([1, 0] as const)(
    "loads a VRM %s file's dummy thumb on the skinned chain",
    async (vrm) => {
      const bytes = dummyThumbVrmBytes({ vrm });
      const loaded = await loadHeadlessVrm(bytes.slice().buffer);
      const name = (
        bone: "leftThumbMetacarpal" | "leftThumbProximal" | "leftThumbDistal",
      ) => loaded.humanoid.getRawBoneNode(bone)?.name;
      expect([
        name("leftThumbMetacarpal"),
        name("leftThumbProximal"),
        name("leftThumbDistal"),
      ]).toEqual(["Thumb1_L", "Thumb2_L", "Thumb3_L"]);
    },
  );

  it("keeps the authored mapping when no counterpart exists", async () => {
    const bytes = dummyThumbVrmBytes({ counterpart: "short" });
    const loaded = await loadHeadlessVrm(bytes.slice().buffer);
    expect(loaded.humanoid.getRawBoneNode("leftThumbProximal")?.name).toBe(
      "Thumb2Dummy_L",
    );
  });
});
