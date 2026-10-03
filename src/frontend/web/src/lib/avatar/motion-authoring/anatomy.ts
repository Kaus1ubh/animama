import type { VRMHumanBoneName } from "@pixiv/three-vrm";
import { Euler, MathUtils, Quaternion, type EulerOrder } from "three";

/**
 * Anatomical joint model for agent-authored motion.
 *
 * Values are clinical-style angles in degrees, converted to rotations in
 * Animama's canonical pose basis (the VRM 1 normalized T-pose: the Avatar faces
 * +Z, its own left is +X and up is +Y). Each joint is defined for the Avatar's
 * left side; right-side rotations are the mirror image across the sagittal
 * plane. Axial joints (pelvis, spine, neck, head, eyes) are not mirrored.
 *
 * Every joint is an Euler composition, so values decompose back exactly
 * (away from gimbal singularities), which is how base-pose values are read.
 */

export type JointComponentDefinition = {
  /** Euler axis that carries this component in the left-side definition. */
  axis: "x" | "y" | "z";
  /** Euler angle = sign * value + offset (degrees). */
  sign: 1 | -1;
  offset?: number;
  /** Plausible range for natural motion; values outside are reported. */
  soft: [number, number];
  /** Anatomical limit; values outside fail the motion checks. */
  hard: [number, number];
  description: string;
};

export type JointDefinition = {
  order: EulerOrder;
  /** Mirrored joints exist per side; axial joints have one instance. */
  sided: boolean;
  /** Humanoid bones written by this joint (both eyes share one definition). */
  components: Record<string, JointComponentDefinition>;
};

const axial = (
  limits: Record<"flexion" | "lateralFlexion" | "rotation", [number, number]>,
): JointDefinition => ({
  order: "YXZ",
  sided: false,
  components: {
    flexion: {
      axis: "x",
      sign: 1,
      soft: scale(limits.flexion, 0.8),
      hard: limits.flexion,
      description: "Bend forward (+) or back (−).",
    },
    lateralFlexion: {
      axis: "z",
      sign: -1,
      soft: scale(limits.lateralFlexion, 0.8),
      hard: limits.lateralFlexion,
      description: "Bend toward the Avatar's own left (+) or right (−).",
    },
    rotation: {
      axis: "y",
      sign: 1,
      soft: scale(limits.rotation, 0.8),
      hard: limits.rotation,
      description: "Turn toward the Avatar's own left (+) or right (−).",
    },
  },
});

function scale(range: [number, number], factor: number): [number, number] {
  return [range[0] * factor, range[1] * factor];
}

/**
 * Joint definitions and range-of-motion limits.
 *
 * Limits summarize public adult normative ranges (American Academy of
 * Orthopaedic Surgeons, *Joint Motion: Method of Measuring and Recording*;
 * Soucie et al., "Range of motion measurements: reference values and a
 * database for comparison studies", Haemophilia 17(3), 2011). Spinal and
 * cervical totals are distributed across Animama's rig segments, so per-bone
 * limits are Animama's own allocation rather than clinical values.
 */
export const JOINT_DEFINITIONS = {
  hips: axial({
    flexion: [-20, 30],
    lateralFlexion: [-20, 20],
    rotation: [-30, 30],
  }),
  spine: axial({
    flexion: [-15, 30],
    lateralFlexion: [-15, 15],
    rotation: [-15, 15],
  }),
  chest: axial({
    flexion: [-10, 25],
    lateralFlexion: [-15, 15],
    rotation: [-15, 15],
  }),
  upperChest: axial({
    flexion: [-10, 20],
    lateralFlexion: [-10, 10],
    rotation: [-15, 15],
  }),
  neck: axial({
    flexion: [-30, 25],
    lateralFlexion: [-25, 25],
    rotation: [-40, 40],
  }),
  head: axial({
    flexion: [-30, 25],
    lateralFlexion: [-20, 20],
    rotation: [-40, 40],
  }),
  eyes: {
    order: "YXZ",
    sided: false,
    components: {
      yaw: {
        axis: "y",
        sign: 1,
        soft: [-15, 15],
        hard: [-25, 25],
        description: "Look toward the Avatar's own left (+) or right (−).",
      },
      pitch: {
        axis: "x",
        sign: -1,
        soft: [-12, 12],
        hard: [-20, 20],
        description: "Look up (+) or down (−).",
      },
    },
  },
  shoulder: {
    order: "ZYX",
    sided: true,
    components: {
      elevation: {
        axis: "z",
        sign: 1,
        soft: [-10, 25],
        // Shipped thinking poses depress the shoulder to about −14°.
        hard: [-15, 35],
        description: "Shrug the shoulder girdle up (+) or depress it (−).",
      },
      protraction: {
        axis: "y",
        sign: -1,
        soft: [-15, 15],
        hard: [-20, 20],
        description: "Round the shoulder forward (+) or pull it back (−).",
      },
    },
  },
  upperArm: {
    order: "YZX",
    sided: true,
    components: {
      elevation: {
        axis: "z",
        sign: 1,
        offset: -90,
        soft: [0, 170],
        hard: [0, 180],
        description:
          "Raise the arm away from the body: 0 hangs down, 90 is horizontal, 180 is overhead.",
      },
      planeOfElevation: {
        axis: "y",
        sign: -1,
        soft: [-60, 120],
        hard: [-90, 140],
        description:
          "Direction of the raise: 0 out to the side, 90 straight forward, above 90 across the body, below 0 behind.",
      },
      rotation: {
        axis: "x",
        sign: -1,
        // Shipped salutes and thumbs-up reach about 90° external rotation.
        soft: [-75, 90],
        hard: [-95, 105],
        description:
          "Axial rotation: external (+) turns the palm forward from the hanging, palm-in position; internal (−).",
      },
    },
  },
  lowerArm: {
    order: "YXZ",
    sided: true,
    components: {
      flexion: {
        axis: "y",
        sign: -1,
        soft: [0, 140],
        hard: [-5, 150],
        description: "Bend the elbow (+).",
      },
      supination: {
        axis: "x",
        sign: -1,
        soft: [-75, 80],
        hard: [-85, 90],
        description:
          "Forearm rotation: supination (+) turns the palm up or forward; pronation (−) turns it down or back.",
      },
    },
  },
  hand: {
    order: "ZYX",
    sided: true,
    components: {
      flexion: {
        axis: "z",
        sign: -1,
        soft: [-60, 70],
        hard: [-70, 80],
        description: "Bend the wrist toward the palm (+) or back (−).",
      },
      deviation: {
        axis: "y",
        sign: -1,
        soft: [-30, 20],
        hard: [-40, 25],
        description: "Tilt the hand toward the thumb (+) or little finger (−).",
      },
    },
  },
  upperLeg: {
    order: "XZY",
    sided: true,
    components: {
      flexion: {
        axis: "x",
        sign: -1,
        soft: [-15, 100],
        hard: [-20, 120],
        description: "Swing the thigh forward (+) or back (−).",
      },
      abduction: {
        axis: "z",
        sign: 1,
        soft: [-20, 35],
        hard: [-25, 45],
        description: "Swing the thigh outward (+) or across the midline (−).",
      },
      rotation: {
        axis: "y",
        sign: 1,
        soft: [-30, 35],
        hard: [-40, 45],
        description: "Turn the knee and toes outward (+) or inward (−).",
      },
    },
  },
  lowerLeg: {
    order: "XYZ",
    sided: true,
    components: {
      flexion: {
        axis: "x",
        sign: 1,
        // The planted-leg solver leaves nearly straight knees near −1°.
        soft: [-3, 120],
        hard: [-5, 140],
        description: "Bend the knee (+).",
      },
    },
  },
  foot: {
    order: "XZY",
    sided: true,
    components: {
      dorsiflexion: {
        axis: "x",
        sign: -1,
        soft: [-40, 15],
        hard: [-50, 20],
        description: "Lift the toes (+) or point the foot (−).",
      },
      inversion: {
        axis: "z",
        sign: -1,
        soft: [-15, 25],
        hard: [-20, 35],
        description: "Turn the sole inward (+) or outward (−).",
      },
    },
  },
  toes: {
    order: "XYZ",
    sided: true,
    components: {
      flexion: {
        axis: "x",
        sign: 1,
        soft: [-30, 30],
        hard: [-40, 40],
        description: "Curl the toes down (+) or lift them (−).",
      },
    },
  },
  /**
   * Index, middle, ring and little segments. Axes and composition order match
   * the creator Hands tool's Curl and Spread (`adjustHandQuaternion`).
   */
  finger: {
    order: "ZYX",
    sided: true,
    components: {
      curl: {
        axis: "z",
        sign: -1,
        soft: [-5, 90],
        hard: [-20, 100],
        description: "Bend the segment toward the palm (+) or back (−).",
      },
      splay: {
        axis: "y",
        sign: -1,
        soft: [-15, 15],
        hard: [-30, 30],
        description:
          "Fan the segment toward the thumb side (+) or the little-finger side (−); use on proximal segments.",
      },
    },
  },
  /**
   * Thumb proximal and distal segments; the metacarpal is left at base. Curl
   * matches the Hands tool's thumb Curl when abduction and twist are zero; with
   * those present, curl turns about a slightly different axis. The extra
   * components let base and fitted thumbs round-trip exactly.
   */
  thumb: {
    order: "YXZ",
    sided: true,
    components: {
      curl: {
        axis: "y",
        sign: 1,
        soft: [-50, 70],
        hard: [-60, 80],
        description:
          "Fold the thumb across the palm (+) or extend it away (−), as the Hands tool's thumb Curl.",
      },
      palmarAbduction: {
        axis: "z",
        sign: -1,
        // The Hands tool's fitted open presets reach about −31°.
        soft: [-35, 40],
        hard: [-45, 50],
        description:
          "Lift the thumb out of the hand's plane toward the palm side (+) or back (−).",
      },
      twist: {
        axis: "x",
        sign: 1,
        soft: [-30, 30],
        hard: [-45, 45],
        description: "Roll the thumb about its own length.",
      },
    },
  },
} as const satisfies Record<string, JointDefinition>;

export type JointType = keyof typeof JOINT_DEFINITIONS;
export type Side = "left" | "right";

/** Description-level joint identifiers, for example `leftUpperArm` or `head`. */
export type JointId =
  | "hips"
  | "spine"
  | "chest"
  | "upperChest"
  | "neck"
  | "head"
  | "eyes"
  | `${Side}${"Shoulder" | "UpperArm" | "LowerArm" | "Hand" | "UpperLeg" | "LowerLeg" | "Foot" | "Toes"}`
  | `${Side}${"Index" | "Middle" | "Ring" | "Little"}${"Proximal" | "Intermediate" | "Distal"}`
  | `${Side}Thumb${"Proximal" | "Distal"}`;

export type ResolvedJoint = {
  id: JointId;
  type: JointType;
  side: Side | null;
  bones: VRMHumanBoneName[];
};

const SIDED_TYPES: Record<string, JointType> = {
  Shoulder: "shoulder",
  UpperArm: "upperArm",
  LowerArm: "lowerArm",
  Hand: "hand",
  UpperLeg: "upperLeg",
  LowerLeg: "lowerLeg",
  Foot: "foot",
  Toes: "toes",
  ...Object.fromEntries(
    ["Index", "Middle", "Ring", "Little"].flatMap((digit) =>
      ["Proximal", "Intermediate", "Distal"].map((segment) => [
        `${digit}${segment}`,
        "finger" as const,
      ]),
    ),
  ),
  ThumbProximal: "thumb",
  ThumbDistal: "thumb",
};

export function resolveJoint(id: string): ResolvedJoint | null {
  if (id === "eyes")
    return { id, type: "eyes", side: null, bones: ["leftEye", "rightEye"] };
  if (id in JOINT_DEFINITIONS && !JOINT_DEFINITIONS[id as JointType].sided)
    return {
      id: id as JointId,
      type: id as JointType,
      side: null,
      bones: [id as VRMHumanBoneName],
    };
  const match = /^(left|right)([A-Z][A-Za-z]+)$/.exec(id);
  const type = match ? SIDED_TYPES[match[2]] : undefined;
  if (!match || !type) return null;
  return {
    id: id as JointId,
    type,
    side: match[1] as Side,
    bones: [id as VRMHumanBoneName],
  };
}

export const JOINT_IDS: readonly JointId[] = [
  "hips",
  "spine",
  "chest",
  "upperChest",
  "neck",
  "head",
  "eyes",
  ...(["left", "right"] as const).flatMap((side) =>
    Object.keys(SIDED_TYPES).map((suffix) => `${side}${suffix}` as JointId),
  ),
];

/** Mirror a rotation across the sagittal (x = 0) plane. */
export function mirrorQuaternion(q: Quaternion): Quaternion {
  return new Quaternion(q.x, -q.y, -q.z, q.w);
}

/** Compose anatomical values (degrees) into a canonical-basis rotation. */
export function composeJointRotation(
  joint: ResolvedJoint,
  values: Readonly<Record<string, number>>,
): Quaternion {
  const definition: JointDefinition = JOINT_DEFINITIONS[joint.type];
  const angles = { x: 0, y: 0, z: 0 };
  for (const [name, component] of Object.entries(definition.components)) {
    const value = values[name] ?? 0;
    angles[component.axis] += component.sign * value + (component.offset ?? 0);
  }
  const q = new Quaternion().setFromEuler(
    new Euler(
      MathUtils.degToRad(angles.x),
      MathUtils.degToRad(angles.y),
      MathUtils.degToRad(angles.z),
      definition.order,
    ),
  );
  return joint.side === "right" ? mirrorQuaternion(q) : q;
}

/** Read anatomical values (degrees) from a canonical-basis rotation. */
export function decomposeJointRotation(
  joint: ResolvedJoint,
  rotation: Quaternion,
): Record<string, number> {
  const definition: JointDefinition = JOINT_DEFINITIONS[joint.type];
  const local =
    joint.side === "right" ? mirrorQuaternion(rotation) : rotation.clone();
  const euler = new Euler().setFromQuaternion(
    local.normalize(),
    definition.order,
  );
  const values: Record<string, number> = {};
  for (const [name, component] of Object.entries(definition.components)) {
    const angle = MathUtils.radToDeg(euler[component.axis]);
    values[name] = (angle - (component.offset ?? 0)) / component.sign;
  }
  return values;
}

/**
 * Angular distance between two rotations in degrees. Inputs are normalized and
 * the angle is taken from the relative rotation's vector part, which stays
 * accurate for nearly equal rotations (unlike `acos` of the dot product).
 */
export function angularDistanceDegrees(a: Quaternion, b: Quaternion): number {
  const relative = a
    .clone()
    .normalize()
    .invert()
    .multiply(b.clone().normalize());
  const sine = Math.hypot(relative.x, relative.y, relative.z);
  return MathUtils.radToDeg(2 * Math.atan2(sine, Math.abs(relative.w)));
}
