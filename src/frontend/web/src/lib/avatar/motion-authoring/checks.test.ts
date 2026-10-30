import type { VRM } from "@pixiv/three-vrm";
import { Quaternion, Vector3 } from "three";
import { beforeAll, describe, expect, it } from "vitest";

import {
  parseAnimaPoseClip,
  type AnimaPoseClipContact,
  type AnimaPoseClipEase,
  type AnimaPoseClipV2,
} from "../poses/animaPoseClip";
import { createAnimaPoseClipProgram } from "../poses/animaPoseClip/program";
import {
  angularDistanceDegrees,
  composeJointRotation,
  resolveJoint,
} from "../poses/anatomy/anatomy";
import { CanonicalSkeleton, avatarScale } from "../poses/anatomy/arms";
import { HAND_PRESETS } from "../poses/anatomy/handPresetIds";
import {
  MOTION_CHECK_THRESHOLDS,
  checkIntersections,
  checkMotion,
  checkOscillation,
  checkParity,
  segmentDistance,
  type Capsule,
  type MotionCheckContact,
  type MotionCheckFinding,
  type TouchingContact,
} from "./checks";
import armsCrossed from "../../../../../../../content/included/gestures/arms-crossed/arms-crossed.json";
import excitedTripleClap from "../../../../../../../content/included/gestures/excited-triple-clap/excited-triple-clap.json";
import wave from "../../../../../../../content/included/gestures/wave-hello/wave-hello.json";
import { getAvatarPoseClip, getResolvedAvatarPose } from "../poses/catalog";
import { loadTestAvatar, loadVrm0Fixture } from "./testing/includedAvatars";
// The laughs as Included on main at bfc0de4f, before their #314 revision.
import heartyLaugh from "./testing/laughs-bfc0de4f/hearty-laugh.json";
import mediumLaugh from "./testing/laughs-bfc0de4f/medium-laugh.json";
// The owner-authored clip as Included at bfc0de4f, before its #314
// re-animation: its hand rests on the face with no declared contact.
import legacyThinkingHandOnChin from "./testing/owner-clips-bfc0de4f/thinking-hand-on-chin-hold.json";

/** The VRM 0 test fixture and Annie (VRM 1.0), for the VRM 0/1 conversion. */
let vrm0: VRM;
let vrm1: VRM;
const avatars = () => [
  { id: "AvatarSample_Y_0", vrm: vrm0 },
  { id: "Annie", vrm: vrm1 },
];

beforeAll(async () => {
  vrm0 = await loadVrm0Fixture();
  vrm1 = await loadTestAvatar("Annie");
});

type Key = {
  t: number;
  v: number | "base";
  ease?: AnimaPoseClipEase;
  tangent?: "flat";
};

/** A one-beat 2.0 clip whose keys sit at `t` seconds; feet planted by default. */
const motion = ({
  joints = { head: { flexion: [{ t: 0, v: "base" }] } },
  contacts,
  plantFeet = true,
}: {
  joints?: Record<string, Record<string, Key[]>>;
  contacts?: MotionCheckContact[];
  plantFeet?: boolean;
}): AnimaPoseClipV2 => ({
  schema: "animaPoseClip/2.0",
  id: "probe",
  name: "Probe",
  duration: 1,
  basePose: "relaxedRest",
  ...(plantFeet ? { plantFeet } : {}),
  beats: [{ id: "start", label: "Start", time: 0 }],
  joints: Object.fromEntries(
    Object.entries(joints).map(([joint, components]) => [
      joint,
      Object.fromEntries(
        Object.entries(components).map(([name, keys]) => [
          name,
          keys.map(({ t, ...key }) => ({ beat: "start", dt: t, ...key })),
        ]),
      ),
    ]),
  ),
  ...(contacts
    ? { contacts: contacts.map((contact) => ({ ...contact, beat: "start" })) }
    : {}),
});

const check = (clip: AnimaPoseClipV2) => checkMotion(clip, avatars());

const failures = (findings: MotionCheckFinding[], category: string) =>
  findings.filter((f) => f.category === category && f.severity === "fail");

/** A 2.0 clip that rotates bones through `poses`, one evenly spaced beat each. */
const rotationClip = (
  poses: Partial<Record<string, { rotation: number[] }>>[],
  loop = false,
): AnimaPoseClipV2 => {
  const beats = poses.map((_, index) => ({
    id: `b${index}`,
    label: `Beat ${index}`,
    time: index / (poses.length - 1),
    ease: "linear" as const,
  }));
  const bones = [...new Set(poses.flatMap((pose) => Object.keys(pose)))];
  return {
    schema: "animaPoseClip/2.0",
    id: "raw",
    name: "raw",
    duration: 1,
    ...(loop ? { loop: true } : {}),
    basePose: "relaxedRest",
    beats,
    rotations: Object.fromEntries(
      bones.map((bone) => [
        bone,
        poses.map((pose, index) => ({
          beat: beats[index].id,
          q: pose[bone]!.rotation as [number, number, number, number],
        })),
      ]),
    ),
  };
};

const headTurn = (degrees: number) => ({
  head: {
    rotation: new Quaternion()
      .setFromAxisAngle(new Vector3(0, 1, 0), (degrees * Math.PI) / 180)
      .toArray(),
  },
});

describe("checkMotion", () => {
  it("passes an Included Gesture on both Avatars", () => {
    const report = checkMotion(wave, avatars());
    expect(report.findings.filter((f) => f.severity === "fail")).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("reports joints beyond their anatomical limit", () => {
    const report = checkMotion(
      rotationClip([headTurn(0), headTurn(60)]),
      avatars(),
    );
    const [finding] = failures(report.findings, "range");
    expect(finding.subject).toBe("head.rotation");
    expect(finding.value).toBeGreaterThan(55);
    expect(finding.from).toBeGreaterThan(0.6);
  });

  it("reports a pop as a discontinuity on the stepped bone", () => {
    const report = check(
      motion({
        joints: {
          rightLowerArm: {
            flexion: [
              { t: 0, v: 10 },
              { t: 0.5, v: 100, ease: "hold" },
            ],
          },
        },
      }),
    );
    const pops = failures(report.findings, "smoothness").filter(
      (f) => f.detail === "discontinuity (pop)",
    );
    expect(pops).toHaveLength(1);
    expect(pops[0]).toMatchObject({ subject: "rightLowerArm", avatar: null });
    expect(pops[0].from).toBeCloseTo(0.483, 2);
  });

  it("reports a direction reversal as an acceleration spike", () => {
    const report = check(
      motion({
        joints: {
          rightLowerArm: {
            flexion: [
              { t: 0, v: 10 },
              { t: 0.3, v: 100, ease: "linear" },
              { t: 0.6, v: 10, ease: "linear" },
            ],
          },
        },
      }),
    );
    const [spike] = failures(report.findings, "smoothness").filter(
      (f) => f.detail === "angular acceleration spike",
    );
    expect(spike.subject).toBe("rightLowerArm");
    expect(spike.from).toBeCloseTo(0.3, 1);
  });

  it("warns about a stall in the middle of a motion", () => {
    const report = check(
      motion({
        joints: {
          rightUpperArm: {
            elevation: [
              { t: 0, v: 20 },
              { t: 0.3, v: 50, tangent: "flat" },
              { t: 0.5, v: 50, tangent: "flat" },
              { t: 0.8, v: 80 },
            ],
          },
        },
      }),
    );
    const stall = report.findings.find(
      (f) => f.subject === "rightUpperArm" && f.detail.startsWith("stops"),
    );
    expect(stall).toMatchObject({ severity: "warn" });
    expect(stall!.from).toBeGreaterThan(0.25);
    expect(stall!.to).toBeLessThan(0.55);
  });

  it("reports a hand passing into the body on each Avatar", () => {
    const report = check(
      motion({
        joints: {
          rightUpperArm: {
            elevation: [
              { t: 0, v: "base" },
              { t: 0.6, v: 35 },
            ],
            planeOfElevation: [
              { t: 0, v: "base" },
              { t: 0.6, v: 110 },
            ],
          },
          rightLowerArm: {
            flexion: [
              { t: 0, v: "base" },
              { t: 0.6, v: 135 },
            ],
          },
        },
      }),
    );
    for (const avatar of ["AvatarSample_Y_0", "Annie"]) {
      const hand = failures(report.findings, "intersection").find(
        (f) => f.avatar === avatar && f.subject === "rightHand/torso",
      );
      expect(hand, avatar).toBeDefined();
      expect(hand!.from).toBeGreaterThan(0.2);
      expect(hand!.to).toBeCloseTo(1, 1);
    }
  });

  it("lets a declared contact touch the face without an intersection", () => {
    const clip = legacyThinkingHandOnChin;
    const contact = [
      { bone: "leftHand", target: "head", from: 0, to: 1, tolerance: 0.2 },
    ];
    const without = checkMotion(clip, avatars());
    const withContact = checkMotion(clip, avatars(), { contacts: contact });
    expect(failures(without.findings, "intersection").length).toBeGreaterThan(
      0,
    );
    expect(failures(withContact.findings, "intersection")).toEqual([]);
  });

  it("reports a declared contact that is never reached", () => {
    const report = check(
      motion({
        contacts: [
          { bone: "rightIndexDistal", target: "head", from: 0.4, to: 0.8 },
        ],
      }),
    );
    const contacts = failures(report.findings, "contact");
    expect(contacts.map((f) => f.avatar).sort()).toEqual([
      "Annie",
      "AvatarSample_Y_0",
    ]);
    expect(contacts[0]).toMatchObject({ subject: "rightIndexDistal→head" });
    // The hand hangs well below the head, so the reported offset points down.
    expect(contacts[0].actualOffset![1]).toBeLessThan(-0.5);
    // Feeding the reported offset back as the contact's offset satisfies it.
    const fixed = check(
      motion({
        contacts: [
          {
            bone: "rightIndexDistal",
            target: "head",
            from: 0.4,
            to: 0.4,
            offset: report.findings.find(
              (f) => f.category === "contact" && f.avatar === "Annie",
            )!.actualOffset,
            tolerance: 0.005,
          },
        ],
      }),
    );
    expect(
      failures(fixed.findings, "contact").filter((f) => f.avatar === "Annie"),
    ).toEqual([]);
    expect(contacts[0].from).toBeCloseTo(0.4, 1);
    expect(contacts[0].to).toBeCloseTo(0.8, 1);
  });

  it("reports feet that leave their planted positions on each Avatar", () => {
    const clip = motion({
      plantFeet: false,
      joints: {
        leftUpperLeg: {
          flexion: [
            { t: 0, v: 0 },
            { t: 1, v: 40 },
          ],
        },
      },
    });
    // The clip moves its legs itself; ask for the feet checks anyway.
    const report = checkMotion(clip, avatars(), { plantFeet: true });
    const feet = failures(report.findings, "feet");
    for (const avatar of ["AvatarSample_Y_0", "Annie"]) {
      const lifted = feet.find(
        (f) => f.avatar === avatar && f.subject === "leftFoot lifts",
      );
      expect(lifted, avatar).toBeDefined();
      expect(lifted!.from).toBeGreaterThan(0.2);
      expect(lifted!.to).toBe(1);
    }
    expect(feet.every((f) => !f.subject.startsWith("right"))).toBe(true);
  });

  it("checks feet of a 2.0 clip that neither plants them nor keys the legs", () => {
    const clip = {
      ...motion({ plantFeet: false }),
      hipsPosition: {
        x: [
          { beat: "start", v: 0 },
          { beat: "start", dt: 0.8, v: 0.06 },
        ],
      },
    };
    const slides = failures(checkMotion(clip, avatars()).findings, "feet");
    expect(slides.map((f) => f.avatar)).toEqual(
      expect.arrayContaining(["AvatarSample_Y_0", "Annie"]),
    );
    // Planted, the same shift keeps the feet still.
    const planted = { ...clip, plantFeet: true };
    expect(failures(checkMotion(planted, avatars()).findings, "feet")).toEqual(
      [],
    );
  });

  it("reports a 2.0 loop whose end does not meet its start", () => {
    const clip = {
      ...motion({
        joints: {
          head: {
            rotation: [
              { t: 0, v: 0 },
              { t: 1, v: 20 },
            ],
          },
        },
      }),
      loop: true,
    };
    const [seam] = failures(checkMotion(clip, avatars()).findings, "loopSeam");
    expect(seam.subject).toBe("head");
    expect(seam.value).toBeCloseTo(20, 0);
  });

  it("reports a rotation-track loop whose end does not meet its start", () => {
    const report = checkMotion(
      rotationClip([headTurn(0), headTurn(10), headTurn(20)], true),
      avatars(),
    );
    const [seam] = failures(report.findings, "loopSeam");
    expect(seam.subject).toBe("head");
    expect(seam.value).toBeCloseTo(20, 0);
  });

  it("reports pose references missing from the catalog", () => {
    const clip = { ...motion({}), basePose: "no-such-pose" };
    const report = checkMotion(clip, avatars());
    expect(failures(report.findings, "pose")).toMatchObject([
      { subject: "no-such-pose" },
    ]);
    // Catalog references resolve, so a shipped clip has no false pops.
    const facePalm = checkMotion(
      getAvatarPoseClip("right-face-palm"),
      avatars(),
    );
    expect(failures(facePalm.findings, "pose")).toEqual([]);
    expect(
      facePalm.findings.filter((f) => f.detail === "discontinuity (pop)"),
    ).toEqual([]);
  });
});

describe("checkParity", () => {
  it("reports a bone turning differently on two Avatars", () => {
    const turn = (degrees: number) =>
      new Quaternion().setFromAxisAngle(
        new Vector3(0, 1, 0),
        (degrees * Math.PI) / 180,
      );
    const findings = checkParity([0, 0.5], {
      a: [new Map([["head", turn(0)]]), new Map([["head", turn(30)]])],
      b: [new Map([["head", turn(0)]]), new Map([["head", turn(-30)]])],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      subject: "head",
      avatar: "a↔b",
      from: 0.5,
    });
    expect(findings[0].value).toBeCloseTo(60, 0);
  });
});

describe("segmentDistance", () => {
  it("measures skew, parallel and degenerate segments", () => {
    const v = (x: number, y: number, z: number) => new Vector3(x, y, z);
    expect(
      segmentDistance(v(0, 0, 0), v(1, 0, 0), v(0.5, 1, -1), v(0.5, 1, 1)),
    ).toBeCloseTo(1);
    expect(
      segmentDistance(v(0, 0, 0), v(1, 0, 0), v(2, 0, 0), v(3, 0, 0)),
    ).toBeCloseTo(1);
    expect(
      segmentDistance(v(0, 0, 0), v(0, 0, 0), v(0, 2, 0), v(0, 2, 0)),
    ).toBeCloseTo(2);
  });
});

const AVATAR_IDS = ["AvatarSample_Y_0", "Annie"];
const LIVE_HEAD_LAYERS = [
  "sway",
  "bounce",
  "headNod",
  "headSideTilt",
  "cursorLookAt",
  "emotionPosture",
] as const;

type ClipContact = Omit<AnimaPoseClipContact, "beat" | "from" | "to"> &
  Partial<Pick<AnimaPoseClipContact, "from" | "to">>;

/**
 * A one-second 2.0 clip holding joint values (degrees) and hand presets, with
 * live head layers muted and contacts over the whole clip unless they say
 * otherwise.
 */
const held = ({
  joints = { head: { flexion: 0 } },
  contacts,
  hands,
  muted = LIVE_HEAD_LAYERS,
}: {
  joints?: Record<string, Record<string, number>>;
  contacts?: ClipContact[];
  hands?: Partial<Record<"left" | "right", Record<string, unknown>>>;
  muted?: readonly string[];
}) => ({
  schema: "animaPoseClip/2.0",
  id: "held",
  name: "Held",
  duration: 1,
  basePose: "relaxedRest",
  plantFeet: true,
  ...(muted.length > 0 ? { mutedProceduralLayers: muted } : {}),
  beats: [{ id: "start", label: "Start", time: 0 }],
  joints: Object.fromEntries(
    Object.entries(joints).map(([joint, values]) => [
      joint,
      Object.fromEntries(
        Object.entries(values).map(([name, v]) => [
          name,
          [{ beat: "start", v }],
        ]),
      ),
    ]),
  ),
  ...(hands
    ? {
        hands: Object.fromEntries(
          Object.entries(hands).map(([side, key]) => [
            side,
            [{ beat: "start", ...key }],
          ]),
        ),
      }
    : {}),
  ...(contacts
    ? {
        contacts: contacts.map((contact) => ({
          beat: "start",
          from: 0,
          to: 1,
          ...contact,
        })),
      }
    : {}),
});

const ofCategory = (findings: MotionCheckFinding[], category: string) =>
  findings.filter((f) => f.category === category);

/** The right palm held under the chin, 2–3 cm from it on both Avatars. */
const CHIN = {
  rightUpperArm: { elevation: 65, planeOfElevation: 90, rotation: 60 },
  rightLowerArm: { flexion: 140 },
};
const PALM_ON_CHIN: ClipContact = {
  bone: "rightHand",
  point: "palm",
  target: "head",
  offset: [0, 0, 0.08],
};

describe("contacts", () => {
  it("measures a contact at its point and reports offsets at the reference height", () => {
    // The hanging right palm, about 55 cm below the head.
    const clip = held({});
    const report = checkMotion(clip, avatars(), {
      contacts: [
        {
          bone: "rightHand",
          point: "palm",
          target: "head",
          from: 0,
          to: 1,
          tolerance: 0.001,
        },
      ],
    });
    for (const { id, vrm } of avatars()) {
      // Expected from canonical forward kinematics: the palm point relative
      // to the head in its rest-aligned frame, over the Avatar's scale.
      const skeleton = new CanonicalSkeleton(vrm);
      const pose = createAnimaPoseClipProgram(parseAnimaPoseClip(clip), {
        vrm,
        resolvePose: getResolvedAvatarPose,
      }).sample(0.5).sample.humanoid!;
      const frames = skeleton.frames(pose, ["rightHand", "head"]);
      const hand = frames.get("rightHand")!;
      const head = frames.get("head")!;
      const expected = skeleton
        .pointOffset("rightHand", "palm")!
        .clone()
        .applyQuaternion(hand.rotation)
        .add(hand.position)
        .sub(head.position)
        .applyQuaternion(head.rotation.clone().invert())
        .divideScalar(avatarScale(skeleton));
      const finding = ofCategory(report.findings, "contact").find(
        (f) => f.avatar === id,
      );
      expect(finding, id).toBeDefined();
      expect(finding!.actualOffset![1], id).toBeLessThan(-0.4);
      finding!.actualOffset!.forEach((value, axis) =>
        expect(
          Math.abs(value - expected.getComponent(axis)),
          `${id} axis ${axis}`,
        ).toBeLessThanOrEqual(0.0011),
      );
    }
  });

  it("holds a solved contact to 1.5 cm and lands it on both Avatars", () => {
    const unsolved = checkMotion(
      held({ joints: CHIN, contacts: [{ ...PALM_ON_CHIN, tolerance: 0.015 }] }),
      avatars(),
    );
    expect(
      failures(unsolved.findings, "contact")
        .map((f) => f.avatar)
        .sort(),
    ).toEqual([...AVATAR_IDS].sort());
    const solved = checkMotion(
      held({ joints: CHIN, contacts: [{ ...PALM_ON_CHIN, solve: {} }] }),
      avatars(),
    );
    expect(ofCategory(solved.findings, "contact")).toEqual([]);
    // The canonical pass covers the first Avatar's solve; the others report
    // their own solved arms (A_1's longer forearm folds past 140°).
    expect(
      solved.findings.filter(
        (f) => f.category === "range" && f.avatar === "Annie",
      ),
    ).toMatchObject([{ subject: "rightLowerArm.flexion", severity: "warn" }]);
  });

  it("reports a solved contact that an Avatar cannot reach", () => {
    const report = checkMotion(
      held({
        joints: {
          rightUpperArm: { elevation: 80, planeOfElevation: 90 },
          rightLowerArm: { flexion: 30 },
        },
        contacts: [
          {
            bone: "rightHand",
            point: "palm",
            target: "chest",
            offset: [-0.15, 0.1, 0.45],
            solve: {},
          },
        ],
      }),
      avatars(),
    );
    // A_1's arm is 6 cm longer and reaches the target.
    expect(failures(report.findings, "contact")).toMatchObject([
      {
        avatar: "AvatarSample_Y_0",
        subject: "rightHand→chest",
        detail: expect.stringContaining("unreachable on this Avatar"),
        limit: 0.015,
      },
    ]);
  });

  it("warns when a solved contact's authored arm is far from its target", () => {
    const report = checkMotion(
      held({ contacts: [{ ...PALM_ON_CHIN, from: 0.3, to: 0.7, solve: {} }] }),
      avatars(),
    );
    const warnings = ofCategory(report.findings, "contact").filter((f) =>
      f.detail.startsWith("the authored arm is far"),
    );
    expect(warnings.map((f) => f.avatar).sort()).toEqual(
      [...AVATAR_IDS].sort(),
    );
    for (const warning of warnings) {
      expect(warning.severity).toBe("warn");
      // The hanging hand is about 55 cm below the chin.
      expect(warning.value).toBeGreaterThan(0.5);
      expect(warning.actualOffset![1]).toBeLessThan(-0.4);
    }
    // Near the target (the chin pose), the solver only corrects: no warning.
    const near = checkMotion(
      held({ joints: CHIN, contacts: [{ ...PALM_ON_CHIN, solve: {} }] }),
      avatars(),
    );
    expect(ofCategory(near.findings, "contact")).toEqual([]);
  });

  it("checks the smoothness of solved arms on every Avatar", () => {
    // A hanging arm solved onto the chin: the 0.15 s ramps swing it fast.
    const reach = held({
      contacts: [{ ...PALM_ON_CHIN, from: 0.3, to: 0.7, solve: {} }],
    });
    // The canonical pass plays the first Avatar's solve; each later Avatar
    // reports its own solved arms.
    for (const order of [avatars(), [...avatars()].reverse()]) {
      const later = order[1].id;
      const jumps = failures(
        checkMotion(reach, order).findings,
        "smoothness",
      ).filter((f) => f.avatar === later);
      expect(new Set(jumps.map((f) => f.subject)), later).toEqual(
        new Set(["rightUpperArm", "rightLowerArm"]),
      );
    }
  });

  it("measures parity on the authored arms, before each Avatar's solve", () => {
    // A target near the full reach of Y_0's shorter arm: A_1 bends its elbow.
    const clip = held({
      joints: {
        rightUpperArm: { elevation: 80, planeOfElevation: 90 },
        rightLowerArm: { flexion: 30 },
      },
      contacts: [
        {
          bone: "rightHand",
          point: "palm",
          target: "chest",
          offset: [-0.15, 0.1, 0.4],
          solve: {},
        },
      ],
    });
    // The solved forearms turn differently on the two rigs…
    const [solved0, solved1] = avatars().map(({ vrm }) => {
      const pose = createAnimaPoseClipProgram(parseAnimaPoseClip(clip), {
        vrm,
        resolvePose: getResolvedAvatarPose,
      }).sample(0.5).sample.humanoid!;
      return new CanonicalSkeleton(vrm)
        .frames(pose, ["rightLowerArm"])
        .get("rightLowerArm")!.rotation;
    });
    expect(angularDistanceDegrees(solved0, solved1)).toBeGreaterThan(
      MOTION_CHECK_THRESHOLDS.parityDegrees,
    );
    // …which is not a conversion error.
    const report = checkMotion(clip, avatars());
    expect(ofCategory(report.findings, "parity")).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("warns about a palm that does not face its target, on either hand", () => {
    // Arms forward, elbows nearly straight; supination turns the palms.
    const arms = (supination: number) =>
      Object.fromEntries(
        (["left", "right"] as const).flatMap((side) => [
          [`${side}UpperArm`, { elevation: 80, planeOfElevation: 80 }],
          [`${side}LowerArm`, { flexion: 10, supination }],
        ]),
      );
    const facing: ClipContact[] = [
      {
        bone: "leftHand",
        point: "palm",
        target: "rightHand",
        targetPoint: "palm",
        facing: true,
        tolerance: 1,
      },
      {
        bone: "rightHand",
        point: "palm",
        target: "leftHand",
        targetPoint: "palm",
        facing: true,
        tolerance: 1,
      },
    ];
    const toward = checkMotion(
      held({ joints: arms(80), contacts: facing }),
      avatars(),
    );
    expect(ofCategory(toward.findings, "contact")).toEqual([]);
    const away = checkMotion(
      held({ joints: arms(-75), contacts: facing }),
      avatars(),
    );
    const turned = ofCategory(away.findings, "contact");
    expect(turned.map((f) => `${f.avatar} ${f.subject}`).sort()).toEqual(
      AVATAR_IDS.flatMap((id) => [
        `${id} leftHand→rightHand`,
        `${id} rightHand→leftHand`,
      ]).sort(),
    );
    for (const finding of turned) {
      expect(finding).toMatchObject({ severity: "warn", limit: 45 });
      expect(finding.value).toBeGreaterThan(135);
    }
  });

  it("aims a palm resting on a forearm at the forearm, not at its elbow", () => {
    // The left palm solved onto the middle of the right forearm.
    const resting = (supination: number) =>
      held({
        joints: {
          rightUpperArm: {
            elevation: 25,
            planeOfElevation: 100,
            rotation: -70,
          },
          rightLowerArm: { flexion: 115 },
          leftUpperArm: { elevation: 45, planeOfElevation: 70, rotation: -60 },
          leftLowerArm: { flexion: 125, supination },
          leftHand: { flexion: -50, deviation: 20 },
        },
        contacts: [
          {
            bone: "leftHand",
            point: "palm",
            target: "rightLowerArm",
            offset: [-0.12, 0.03, 0],
            facing: true,
            solve: {},
          },
        ],
      });
    const facingFindings = (clip: object) =>
      ofCategory(checkMotion(clip, avatars()).findings, "contact").filter(
        (f) => f.detail === "the palm does not face the target",
      );
    // Toward the elbow this palm is 80–90° off; toward the forearm 25–40°.
    expect(facingFindings(resting(-75))).toEqual([]);
    expect(
      facingFindings(resting(40))
        .map((f) => f.avatar)
        .sort(),
    ).toEqual([...AVATAR_IDS].sort());
  });

  it("warns about a solved head contact while live head layers run", () => {
    const solved = { ...PALM_ON_CHIN, solve: {} };
    const live = checkMotion(
      held({ joints: CHIN, contacts: [solved], muted: ["breathing"] }),
      avatars(),
    );
    expect(ofCategory(live.findings, "contact")).toMatchObject([
      {
        severity: "warn",
        avatar: null,
        subject: "rightHand→head",
        detail: expect.stringMatching(
          /; mute sway, bounce, headNod, headSideTilt, cursorLookAt, emotionPosture$/,
        ),
      },
    ]);
    // Bounce nods the head and neck too.
    const bouncing = checkMotion(
      held({
        joints: CHIN,
        contacts: [solved],
        muted: LIVE_HEAD_LAYERS.filter((layer) => layer !== "bounce"),
      }),
      avatars(),
    );
    expect(ofCategory(bouncing.findings, "contact")).toMatchObject([
      { detail: expect.stringMatching(/; mute bounce$/) },
    ]);
    // Muted, or unsolved, there is nothing to drift.
    for (const clip of [
      held({ joints: CHIN, contacts: [solved] }),
      held({ joints: CHIN, contacts: [PALM_ON_CHIN], muted: [] }),
    ])
      expect(
        ofCategory(checkMotion(clip, avatars()).findings, "contact"),
      ).toEqual([]);
  });
});

describe("palm-to-palm contact", () => {
  it("lets the clap's pressed palms pass with only its solved contacts", () => {
    const clip = parseAnimaPoseClip(excitedTripleClap) as AnimaPoseClipV2;
    const report = check({
      ...clip,
      contacts: (clip.contacts ?? []).filter((contact) => contact.solve),
    });
    expect(failures(report.findings, "intersection")).toEqual([]);
    expect(failures(report.findings, "contact")).toEqual([]);
    // The fingers may touch through the solve ramps too.
    expect(ofCategory(report.findings, "fingers")).toEqual([]);
  });

  it("still reports a hand resting on the other forearm during a hand-to-hand contact", () => {
    // Arms Crossed rests the right palm on the left forearm, well up from its
    // wrist. Retargeting that touch to the left hand keeps a hand-to-hand
    // contact active while the overlap stays on the forearm itself.
    const clip = parseAnimaPoseClip(armsCrossed) as AnimaPoseClipV2;
    const report = check({
      ...clip,
      contacts: (clip.contacts ?? []).map((contact) =>
        contact.target === "leftLowerArm"
          ? { ...contact, target: "leftHand" }
          : contact,
      ),
    });
    for (const avatar of ["AvatarSample_Y_0", "Annie"])
      expect(
        failures(report.findings, "intersection").some(
          (f) => f.avatar === avatar && f.subject === "rightHand/leftForearm",
        ),
        avatar,
      ).toBe(true);
  });

  // Synthetic capsules in metres: the left forearm runs along x from the
  // elbow at the origin to the wrist at 0.25, with a palm length of 0.08.
  const capsule = (
    a: [number, number, number],
    b: [number, number, number],
    radius: number,
  ): Capsule => ({ a: new Vector3(...a), b: new Vector3(...b), radius });
  const far = capsule([-5, 0, 0], [-5, 0.1, 0], 0.05);
  const pressedPalms = {
    torso: far,
    neck: far,
    head: far,
    leftForearm: capsule([0, 0, 0], [0.25, 0, 0], 0.035),
    leftForearmProximal: capsule([0, 0, 0], [0.17, 0, 0], 0.035),
    leftHand: capsule([0.25, 0, 0], [0.43, 0, 0], 0.03),
    // The right hand lies along the left one, wrists 3.2 cm apart; its
    // forearm runs back from its wrist.
    rightHand: capsule([0.25, 0.032, 0], [0.43, 0.032, 0], 0.03),
    rightForearm: capsule([0.25, 0.032, -0.25], [0.25, 0.032, 0], 0.035),
    rightForearmProximal: capsule(
      [0.25, 0.032, -0.25],
      [0.25, 0.032, -0.08],
      0.035,
    ),
  };
  const handToHand = [
    { bone: "rightHand", target: "leftHand", from: 0, to: 1 },
  ];
  const subjects = (
    frame: Record<string, Capsule>,
    contacts: TouchingContact[],
  ) =>
    checkIntersections("probe", [0.5], [frame], new Map(), contacts, {
      duration: 1,
      loop: false,
    }).map((finding) => finding.subject);

  it("measures each hand against the other forearm short of a palm length from its wrist", () => {
    expect(subjects(pressedPalms, handToHand)).toEqual([]);
    expect(subjects(pressedPalms, []).sort()).toEqual([
      "leftHand/rightForearm",
      "leftHand/rightHand",
      "rightHand/leftForearm",
    ]);
  });

  it("still reports a hand pressed into the middle of the other forearm", () => {
    const acrossForearm = {
      ...pressedPalms,
      rightHand: capsule([0.12, 0.03, -0.09], [0.12, 0.03, 0.09], 0.03),
    };
    expect(subjects(acrossForearm, handToHand)).toEqual([
      "rightHand/leftForearm",
    ]);
  });

  it("allows a solved contact's touch through its blend ramps", () => {
    const later = [
      { bone: "rightHand", target: "leftHand", from: 0.55, to: 1 },
    ];
    expect(subjects(pressedPalms, later)).toHaveLength(3);
    expect(
      subjects(pressedPalms, [{ ...later[0], blendIn: 0.1, blendOut: 0.1 }]),
    ).toEqual([]);
  });
});

describe("oscillation", () => {
  /** Chest flexion pulsing between `low` and `high` at `hertz` for a second. */
  const pulse = (hertz: number, low: number, high: number) =>
    motion({
      joints: {
        chest: {
          flexion: [
            { t: 0, v: 0 },
            ...Array.from({ length: Math.floor(2 * hertz) }, (_, index) => ({
              t: Math.round(((index + 1) / (2 * hertz)) * 1e4) / 1e4,
              v: index % 2 === 0 ? high : low,
            })),
          ],
        },
      },
    });

  it("does not warn about a 3 Hz bounce or the wave", () => {
    expect(ofCategory(check(pulse(3, -2, 4)).findings, "oscillation")).toEqual(
      [],
    );
    expect(
      ofCategory(checkMotion(wave, avatars()).findings, "oscillation"),
    ).toEqual([]);
  });

  it("warns about swings faster than 4 Hz above a small amplitude", () => {
    const [shake] = ofCategory(check(pulse(5, -2, 4)).findings, "oscillation");
    expect(shake).toMatchObject({
      severity: "warn",
      avatar: null,
      subject: "chest.flexion",
      limit: 4,
    });
    expect(shake.value).toBeCloseTo(5, 0);
    expect(shake.to - shake.from).toBeGreaterThan(0.5);
    // A 1° tremor is below the amplitude floor.
    expect(
      ofCategory(check(pulse(5, -0.5, 0.5)).findings, "oscillation"),
    ).toEqual([]);
  });

  /** 60 Hz samples of chest flexion `degrees(t)` over `seconds`. */
  const chestSamples = (seconds: number, degrees: (time: number) => number) => {
    const chest = resolveJoint("chest")!;
    const times = Array.from(
      { length: Math.round(seconds * 60) + 1 },
      (_, index) => index / 60,
    );
    const poses = times.map((time) => ({
      chest: {
        rotation: composeJointRotation(chest, {
          flexion: degrees(time),
        }).toArray() as [number, number, number, number],
      },
    }));
    return { times, poses };
  };

  it("warns from three cycles, not two", () => {
    for (const hertz of [4.5, 5])
      for (const cycles of [2, 2.5, 3]) {
        // A burst of `cycles` cycles from rest, starting at 0.2 s.
        const { times, poses } = chestSamples(2, (time) => {
          const phase = time - 0.2;
          return phase > 0 && phase < cycles / hertz
            ? 3 * Math.sin(2 * Math.PI * hertz * phase)
            : 0;
        });
        const findings = checkOscillation(times, poses);
        if (cycles < 3) expect(findings, `${hertz} Hz × ${cycles}`).toEqual([]);
        else
          expect(findings, `${hertz} Hz × ${cycles}`).toMatchObject([
            {
              subject: "chest.flexion",
              detail:
                "3 cycles back and forth (6 reversals) faster than 4 Hz (rapid oscillation)",
            },
          ]);
      }
  });

  it("rates an uneven pulse at its cycle rate", () => {
    /** Four pulses from rest: an eased `rise` to 4° and an eased `fall` back. */
    const pulses = (rise: number, fall: number) =>
      chestSamples(2, (time) => {
        const phase = time - 0.2;
        if (phase <= 0 || phase >= 4 * (rise + fall)) return 0;
        const into = phase % (rise + fall);
        return into < rise
          ? 2 * (1 - Math.cos((Math.PI * into) / rise))
          : 2 * (1 + Math.cos((Math.PI * (into - rise)) / fall));
      });
    // A 0.04 s rise and a 0.23 s fall: 3.7 Hz, though half its swings are fast.
    const calm = pulses(0.04, 0.23);
    expect(checkOscillation(calm.times, calm.poses)).toEqual([]);
    const quick = pulses(0.04, 1 / 4.5 - 0.04);
    const [finding] = checkOscillation(quick.times, quick.poses);
    expect(finding).toMatchObject({ subject: "chest.flexion", value: 4.5 });
  });

  it("times reversals between frames", () => {
    // A 4.5 Hz swing whose first peak falls `offset` frames after a sample:
    // the finding starts at that peak to the millisecond, not at a frame.
    for (let offset = 0.1; offset < 1; offset += 0.2) {
      const peak = (4 + offset) / 60;
      const { times, poses } = chestSamples(
        1.2,
        (time) => 3 * Math.cos(2 * Math.PI * 4.5 * (time - peak)),
      );
      const [swing] = checkOscillation(times, poses);
      expect(swing, `offset ${offset.toFixed(1)} frames`).toMatchObject({
        subject: "chest.flexion",
        value: 4.5,
      });
      expect(swing.from, `offset ${offset.toFixed(1)} frames`).toBeCloseTo(
        peak,
        3,
      );
    }
  });

  it("warns about the laughs' 4.5–5.5 Hz pulses before their revision", () => {
    for (const laugh of [heartyLaugh, mediumLaugh]) {
      const pulses = ofCategory(
        checkMotion(laugh, avatars()).findings,
        "oscillation",
      );
      expect(pulses.length, laugh.id).toBeGreaterThan(0);
      expect(pulses.map((f) => f.subject)).toEqual(
        expect.arrayContaining(["chest.flexion", "rightShoulder.elevation"]),
      );
      for (const finding of pulses) {
        expect(finding.severity).toBe("warn");
        expect(finding.value).toBeGreaterThan(4);
      }
    }
  });
});

describe("finger collisions", () => {
  const bothHands = (key: Record<string, unknown>) => ({
    left: key,
    right: key,
  });

  it("passes every hand preset on both Avatars", () => {
    for (const { id } of HAND_PRESETS) {
      const report = checkMotion(
        held({ hands: bothHands({ preset: id }) }),
        avatars(),
      );
      expect(ofCategory(report.findings, "fingers"), id).toEqual([]);
    }
  });

  it("fails fingers squeezed through each other unless a contact declares it", () => {
    const squeezed = { right: { preset: "open-together", spread: -30 } };
    const report = checkMotion(held({ hands: squeezed }), avatars());
    for (const avatar of AVATAR_IDS)
      expect(
        failures(report.findings, "fingers").find(
          (f) => f.avatar === avatar && f.subject === "rightMiddle/rightRing",
        ),
        avatar,
      ).toMatchObject({
        detail: "fingers pass through each other (finger capsules)",
      });
    const declared = checkMotion(
      held({
        hands: squeezed,
        contacts: [
          {
            bone: "rightMiddleDistal",
            target: "rightRingDistal",
            tolerance: 1,
          },
        ],
      }),
      avatars(),
    );
    expect(
      ofCategory(declared.findings, "fingers").filter(
        (f) => f.subject === "rightMiddle/rightRing",
      ),
    ).toEqual([]);
  });

  it("warns about fingers through the other hand unless the hands touch by contact", () => {
    // Arms forward and crossing inward, palms toward each other: the open
    // hands pass into each other.
    const joints = Object.fromEntries(
      (["left", "right"] as const).flatMap((side) => [
        [`${side}UpperArm`, { elevation: 75, planeOfElevation: 95 }],
        [`${side}LowerArm`, { flexion: 10, supination: 80 }],
      ]),
    );
    const hands = bothHands({ preset: "open-together" });
    const crossed = ofCategory(
      checkMotion(held({ joints, hands }), avatars()).findings,
      "fingers",
    );
    expect(crossed.length).toBeGreaterThan(0);
    for (const finding of crossed)
      expect(finding).toMatchObject({
        severity: "warn",
        detail: "a finger passes through the other hand (finger capsules)",
      });
    const clasped = checkMotion(
      held({
        joints,
        hands,
        contacts: [{ bone: "leftHand", target: "rightHand", tolerance: 1 }],
      }),
      avatars(),
    );
    expect(ofCategory(clasped.findings, "fingers")).toEqual([]);
  });
});
