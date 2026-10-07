import type { VRM } from "@pixiv/three-vrm";
import { Quaternion, Vector3 } from "three";
import { beforeAll, describe, expect, it } from "vitest";

import type {
  AnimaPoseClipEase,
  AnimaPoseClipV2,
} from "../poses/animaPoseClip";
import {
  checkMotion,
  checkParity,
  segmentDistance,
  type MotionCheckContact,
  type MotionCheckFinding,
} from "./checks";
import wave from "../../../../../../../content/included/gestures/wave-hello/wave-hello.json";
import { getAvatarPoseClip } from "../poses/catalog";
import { loadTestAvatar } from "./testing/includedAvatars";

let vrm0: VRM;
let vrm1: VRM;
const avatars = () => [
  { id: "AvatarSample_Y_0", vrm: vrm0 },
  { id: "AvatarSample_A_1_New", vrm: vrm1 },
];

beforeAll(async () => {
  vrm0 = await loadTestAvatar("AvatarSample_Y_0");
  vrm1 = await loadTestAvatar("AvatarSample_A_1_New");
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

const rawClip = (poses: Record<string, unknown>[], loop = false) => ({
  schema: "animaPoseClip/1.0",
  id: "raw",
  name: "raw",
  duration: 1,
  ...(loop ? { loop: true } : {}),
  basePose: "relaxedRest",
  defaultTransition: { easing: "linear" },
  poses: Object.fromEntries(poses.map((pose, index) => [`p${index}`, pose])),
  poseKeyframes: poses.map((_, index) => ({
    time: index / (poses.length - 1),
    pose: `p${index}`,
  })),
});

const headTurn = (degrees: number) => ({
  humanoid: {
    head: {
      rotation: new Quaternion()
        .setFromAxisAngle(new Vector3(0, 1, 0), (degrees * Math.PI) / 180)
        .toArray(),
    },
  },
});

describe("checkMotion", () => {
  it("passes an Included Gesture on both Avatars", () => {
    const report = checkMotion(wave, avatars());
    expect(report.findings.filter((f) => f.severity === "fail")).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("reports joints beyond their anatomical limit", () => {
    const report = checkMotion(rawClip([headTurn(0), headTurn(60)]), avatars());
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
    for (const avatar of ["AvatarSample_Y_0", "AvatarSample_A_1_New"]) {
      const hand = failures(report.findings, "intersection").find(
        (f) => f.avatar === avatar && f.subject === "rightHand/torso",
      );
      expect(hand, avatar).toBeDefined();
      expect(hand!.from).toBeGreaterThan(0.2);
      expect(hand!.to).toBeCloseTo(1, 1);
    }
  });

  it("lets a declared contact touch the face without an intersection", () => {
    const clip = getAvatarPoseClip("thinking-hand-on-chin-hold");
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
      "AvatarSample_A_1_New",
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
              (f) =>
                f.category === "contact" && f.avatar === "AvatarSample_A_1_New",
            )!.actualOffset,
            tolerance: 0.005,
          },
        ],
      }),
    );
    expect(
      failures(fixed.findings, "contact").filter(
        (f) => f.avatar === "AvatarSample_A_1_New",
      ),
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
    for (const avatar of ["AvatarSample_Y_0", "AvatarSample_A_1_New"]) {
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
      expect.arrayContaining(["AvatarSample_Y_0", "AvatarSample_A_1_New"]),
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

  it("reports a loop whose end does not meet its start", () => {
    const report = checkMotion(
      rawClip([headTurn(0), headTurn(10), headTurn(20)], true),
      avatars(),
    );
    const [seam] = failures(report.findings, "loopSeam");
    expect(seam.subject).toBe("head");
    expect(seam.value).toBeCloseTo(20, 0);
  });

  it("reports pose references missing from the catalog", () => {
    const clip = rawClip([headTurn(0), headTurn(10)]);
    clip.poses.p1 = { ref: "no-such-pose" };
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
