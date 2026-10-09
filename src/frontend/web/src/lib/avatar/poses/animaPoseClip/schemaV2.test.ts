import { describe, expect, it } from "vitest";

import {
  ANIMA_POSE_CLIP_DECIMALS,
  serializeAnimaPoseClipFile,
} from "./clipVocabulary";
import compatibilityClip from "./fixtures/compatibility-valid-v2.json";
import contactCases from "./fixtures/contacts-v2.json";
import handKeys from "./fixtures/hand-keys-v2.json";
import {
  ANIMA_POSE_CLIP_V2_LIMITS,
  ANIMA_POSE_CLIP_V2_MIN_SPACING,
  parseAnimaPoseClipV2,
  validateAnimaPoseClipV2,
  type AnimaPoseClipContact,
  type AnimaPoseClipV2,
} from "./schemaV2";

/** A small valid clip: raise the right arm at "raise", lower it at "settle". */
const clip = (): AnimaPoseClipV2 => ({
  schema: "animaPoseClip/2.0",
  id: "wave",
  name: "Wave",
  duration: 2,
  basePose: "relaxedRest",
  plantFeet: true,
  beats: [
    { id: "start", label: "Start", time: 0 },
    { id: "raise", label: "Raise", time: 0.5 },
    { id: "settle", label: "Settle", time: 1.8, ease: "easeInOutSine" },
  ],
  joints: {
    rightUpperArm: {
      elevation: [
        { beat: "start", v: "base" },
        { beat: "raise", dt: 0.05, v: 108 },
        { beat: "raise", dt: 0.3, v: 100, tangent: "flat" },
        { beat: "settle", v: "base" },
      ],
    },
  },
  rotations: { jaw: [{ beat: "raise", q: [0.05, 0, 0, 1] }] },
  hipsPosition: { x: [{ beat: "raise", v: 0.015, ease: "linear" }] },
  hands: {
    right: [
      { beat: "start", preset: "relaxed" },
      { beat: "raise", dt: -0.05, preset: "open-together", spread: 8 },
    ],
  },
  expressions: {
    happy: [
      { beat: "raise", v: 0.7 },
      { beat: "settle", v: 0 },
    ],
  },
  contacts: [
    { bone: "rightHand", target: "head", beat: "raise", from: 0, to: 0.2 },
  ],
  events: [{ id: "sparkle", time: 0.5, kind: "sfx", cueId: "sparkle" }],
});

const issuesOf = (value: unknown) => {
  const result = validateAnimaPoseClipV2(value);
  if (result.ok) throw new Error("expected issues");
  return result.issues.map(({ path }) => path);
};

describe("animaPoseClip/2.0 validation", () => {
  it("accepts a valid clip and keeps unknown top-level fields", () => {
    const result = validateAnimaPoseClipV2({ ...clip(), generator: { v: 2 } });
    expect(result.ok).toBe(true);
    expect(result.ok && result.clip).toMatchObject({
      ...clip(),
      generator: { v: 2 },
    });
  });

  it("reports structural problems with their paths", () => {
    // A loosely typed copy, to write invalid values.
    const value = JSON.parse(JSON.stringify(clip()));
    value.joints.rightUpperArm.elevation[1].beat = "missing";
    value.joints.rightUpperArm.elevation[2].v = Number.NaN;
    value.joints.leftKnee = { flexion: [{ beat: "raise", v: 1 }] };
    value.joints.head = { wobble: [{ beat: "raise", v: 1 }] };
    value.rotations.tail = [{ beat: "raise", q: [0, 0, 0, 1] }];
    value.rotations.rightUpperArm = [{ beat: "raise", q: [0, 0, 0, 1] }];
    value.rotations.jaw[0].q = [0, 0, 0, 0];
    value.hands.right[1].preset = "claw";
    value.expressions.happy[0].v = 1.5;
    expect(issuesOf(value)).toEqual(
      expect.arrayContaining([
        "joints.rightUpperArm.elevation[1].beat",
        "joints.rightUpperArm.elevation[2].v",
        "joints.leftKnee",
        "joints.head.wobble",
        "rotations.tail",
        "rotations.rightUpperArm",
        "rotations.jaw[0].q",
        "hands.right[1].preset",
        "expressions.happy[0].v",
      ]),
    );
  });

  it("requires ordered keys inside their beat's neighbours", () => {
    const outside = clip();
    outside.joints!.rightUpperArm.elevation[1].dt = 1.4; // past "settle"
    expect(issuesOf(outside)).toContain("joints.rightUpperArm.elevation[1].dt");

    const misordered = clip();
    misordered.joints!.rightUpperArm.elevation[2].dt = 0.01; // before dt 0.05
    expect(issuesOf(misordered)).toContain(
      "joints.rightUpperArm.elevation[2].dt",
    );

    const early = clip();
    early.hands!.right![0].dt = -0.1; // before 0
    expect(issuesOf(early)).toContain("hands.right[0].dt");
  });

  it("requires unique, ordered beats within the clip", () => {
    const value = clip();
    value.beats[2] = { id: "raise", label: "Again", time: 0.4 };
    expect(issuesOf(value)).toEqual(
      expect.arrayContaining(["beats[2].id", "beats[2].time"]),
    );
    expect(issuesOf({ ...clip(), duration: 0 })).toContain("duration");
  });

  it("solves legs instead of accepting leg tracks while feet are planted", () => {
    const value = clip();
    value.joints!.leftLowerLeg = { flexion: [{ beat: "raise", v: 10 }] };
    value.rotations!.rightFoot = [{ beat: "raise", q: [0, 0, 0, 1] }];
    expect(issuesOf(value)).toEqual(
      expect.arrayContaining(["joints.leftLowerLeg", "rotations.rightFoot"]),
    );
    expect(validateAnimaPoseClipV2({ ...value, plantFeet: false }).ok).toBe(
      true,
    );
  });

  it("bounds the number of keys", () => {
    const keys = Array.from(
      { length: ANIMA_POSE_CLIP_V2_LIMITS.keys + 1 },
      (_, index) => ({ beat: "only", dt: index * 1e-5, v: 0 }),
    );
    expect(
      issuesOf({
        ...clip(),
        beats: [{ id: "only", label: "Only", time: 0 }],
        joints: { head: { flexion: keys } },
        rotations: undefined,
        hipsPosition: undefined,
        hands: undefined,
        expressions: undefined,
        contacts: undefined,
      }),
    ).toContain("$");
  });

  it("throws a readable error from parse", () => {
    expect(() => parseAnimaPoseClipV2({ schema: "animaPoseClip/2.0" })).toThrow(
      /id: Expected a non-empty id/,
    );
  });

  it("rejects names inherited from Object.prototype instead of throwing", () => {
    const value = JSON.parse(JSON.stringify(clip()));
    value.joints.toString = { flexion: [{ beat: "raise", v: 0 }] };
    value.joints.constructor = {};
    value.joints.head = { constructor: [{ beat: "raise", v: 0 }] };
    const raw = JSON.stringify(value).replace(
      '"expressions":{',
      '"expressions":{"__proto__":[{"beat":"raise","v":0.5}],',
    );
    expect(issuesOf(JSON.parse(raw))).toEqual(
      expect.arrayContaining([
        "joints.toString",
        "joints.constructor",
        "joints.head.constructor",
        "expressions.__proto__",
      ]),
    );
  });

  it("keeps saved times apart so a valid clip stays valid once rounded", () => {
    const value = clip();
    value.beats[1].time = 0.0003; // 0.3 ms after "start"
    expect(issuesOf(value)).toContain("beats[1].time");
  });

  it("checks contact bones and keeps contacts inside the clip", () => {
    const value = clip();
    value.contacts = [
      { bone: "rightPalm", target: "head", beat: "raise", from: 0, to: 0.1 },
      { bone: "rightHand", target: "head", beat: "settle", from: 0, to: 0.5 },
    ];
    expect(issuesOf(value)).toEqual(["contacts[0]", "contacts[1]"]);
  });

  it("names the length limit of a long beat label", () => {
    const value = clip();
    value.beats[0].label = "x".repeat(81);
    const result = validateAnimaPoseClipV2(value);
    expect(!result.ok && result.issues[0].message).toMatch(/at most 80/);
  });

  it("stays valid after saving at the minimum spacing", () => {
    const value = clip();
    // The closest a key may sit to "settle", its beat's next neighbour.
    value.joints!.rightUpperArm.elevation[2].dt =
      1.3 - ANIMA_POSE_CLIP_V2_MIN_SPACING + 0.00004;
    expect(validateAnimaPoseClipV2(value).ok).toBe(true);
    const saved = JSON.parse(serializeAnimaPoseClipFile(value));
    expect(validateAnimaPoseClipV2(saved).ok).toBe(true);
  });
});

// The backend validator reads the same fixtures (tests/test_pose_clip_v2.py).
describe("animaPoseClip/2.0 shared fixtures", () => {
  it("accepts the shared compatibility clip", () => {
    expect(validateAnimaPoseClipV2(compatibilityClip).ok).toBe(true);
  });

  const withHands = (hands: unknown) => ({ ...handKeys.clip, hands });

  it.each(handKeys.valid.map((entry) => [entry.name, entry] as const))(
    "accepts hand keys: %s",
    (_, { hands, parsed }) => {
      const result = validateAnimaPoseClipV2(withHands(hands));
      expect(result.ok && result.clip.hands).toEqual(parsed);
    },
  );

  it.each(handKeys.invalid.map((entry) => [entry.name, entry] as const))(
    "rejects hand keys: %s",
    (_, { hands, path }) => {
      expect(issuesOf(withHands(hands))).toEqual([path]);
    },
  );

  const withContacts = (contacts: unknown) => ({
    ...contactCases.clip,
    contacts,
  });

  it.each(contactCases.valid.map((entry) => [entry.name, entry] as const))(
    "accepts contacts: %s",
    (_, { contacts, parsed }) => {
      const result = validateAnimaPoseClipV2(withContacts(contacts));
      expect(result.ok && result.clip.contacts).toEqual(parsed);
    },
  );

  it.each(contactCases.invalid.map((entry) => [entry.name, entry] as const))(
    "rejects contacts: %s",
    (_, { contacts, path, loop }) => {
      const value = withContacts(contacts);
      expect(issuesOf(loop ? { ...value, loop } : value)).toEqual([path]);
    },
  );
});

describe("animaPoseClip/2.0 contact fields", () => {
  const withContacts = (contacts: unknown) => ({
    ...contactCases.clip,
    contacts,
  });
  /** A solved palm-to-chin contact with the given blends. */
  const chin = (
    solve: AnimaPoseClipContact["solve"] = { blendIn: 0.25 },
  ): AnimaPoseClipContact => ({
    bone: "rightHand",
    point: "palm",
    target: "head",
    offset: [0, -0.06, 0.09],
    beat: "touch",
    from: 0,
    to: 0.4,
    facing: true,
    solve,
  });

  it("keeps the new fields through a saved file and adds no defaults", () => {
    const result = validateAnimaPoseClipV2(withContacts([chin()]));
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const saved = JSON.parse(serializeAnimaPoseClipFile(result.clip));
    expect(saved.contacts).toEqual([chin()]);
    const reread = validateAnimaPoseClipV2(saved);
    expect(reread.ok && reread.clip.contacts).toEqual([chin()]);
    // An older contact stays exactly as written.
    const plain = validateAnimaPoseClipV2(clip());
    expect(plain.ok && plain.clip.contacts).toEqual(clip().contacts);
  });

  it("saves blends at time precision", () => {
    const result = validateAnimaPoseClipV2(
      withContacts([chin({ blendIn: 0.123456, blendOut: 1.99996 })]),
    );
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const rounded = { blendIn: 0.1235, blendOut: 2 };
    expect(result.clip.contacts![0].solve).toEqual(rounded);
    expect(
      JSON.parse(serializeAnimaPoseClipFile(result.clip)).contacts[0].solve,
    ).toEqual(rounded);
  });

  it("reports every problem of a contact in one run", () => {
    const result = validateAnimaPoseClipV2(
      withContacts([
        {
          bone: "head",
          point: "palm",
          target: "leftHand",
          targetPoint: "tip",
          beat: "touch",
          from: 0,
          to: 0.1,
          facing: true,
          solve: { blendIn: 3, mode: "offset" },
        },
      ]),
    );
    expect(!result.ok && result.issues).toEqual([
      {
        path: "contacts[0].point",
        message: '"palm" applies only to a hand bone, not head.',
      },
      {
        path: "contacts[0].targetPoint",
        message: '"tip" applies only to a finger bone, not leftHand.',
      },
      {
        path: "contacts[0].facing",
        message: "Palm facing applies only to a hand or finger bone, not head.",
      },
      {
        path: "contacts[0].solve.blendIn",
        message: "Expected seconds from 0 to 2.",
      },
      {
        path: "contacts[0].solve.mode",
        message: "Unknown field. solve accepts: blendIn, blendOut.",
      },
      {
        path: "contacts[0].bone",
        message: "A solved contact moves a hand or finger bone, not head.",
      },
    ]);
  });

  it("names the window a solved contact overlaps", () => {
    const value = withContacts([
      {
        bone: "leftHand",
        target: "head",
        beat: "touch",
        from: 0,
        to: 0.6,
        solve: {},
      },
      {
        bone: "rightHand",
        target: "head",
        beat: "touch",
        from: 0,
        to: 0.6,
        solve: {},
      },
      {
        bone: "leftThumbDistal",
        point: "tip",
        target: "head",
        beat: "clap",
        from: 0,
        to: 0.1,
        solve: {},
      },
    ]);
    const result = validateAnimaPoseClipV2(value);
    expect(!result.ok && result.issues).toEqual([
      {
        path: "contacts[2].solve",
        message:
          "Overlaps the solved window of contacts[0]; solved contacts on the left arm must not overlap in time.",
      },
    ]);
  });
});

describe("animaPoseClip/2.0 per-finger offsets", () => {
  const withFingers = (fingers: unknown) => ({
    ...handKeys.clip,
    hands: { right: [{ beat: "start", preset: "pinch", fingers }] },
  });

  it("rejects offsets that are not finite", () => {
    expect(
      issuesOf(
        withFingers({
          index: { curl: [1, Number.NaN, 2] },
          thumb: { twist: Number.POSITIVE_INFINITY },
        }),
      ),
    ).toEqual([
      "hands.right[0].fingers.index.curl",
      "hands.right[0].fingers.thumb.twist",
    ]);
  });

  it("reports every problem of a hand key in one run", () => {
    const value = withFingers({
      pinky: { curl: 1 },
      thumb: { splay: 1, curl: [1, 2, 3] },
    });
    value.hands.right[0].preset = "claw";
    const result = validateAnimaPoseClipV2(value);
    expect(!result.ok && result.issues).toEqual([
      {
        path: "hands.right[0].preset",
        message: expect.stringMatching(/^Unknown preset. Use one of: .*\bok\b/),
      },
      {
        path: "hands.right[0].fingers.pinky",
        message:
          "Unknown digit. Use one of: thumb, index, middle, ring, little.",
      },
      {
        path: "hands.right[0].fingers.thumb.splay",
        message: "Unknown offset. thumb accepts: curl, palmarAbduction, twist.",
      },
      {
        path: "hands.right[0].fingers.thumb.curl",
        message:
          "Expected degrees from −90 to 90, or one value per segment (proximal, distal).",
      },
    ]);
  });

  it("copies per-segment curls instead of sharing the input arrays", () => {
    const curl = [10, 20, 30];
    const result = validateAnimaPoseClipV2(withFingers({ index: { curl } }));
    curl[0] = 0;
    expect(result.ok && result.clip.hands?.right?.[0].fingers).toEqual({
      index: { curl: [10, 20, 30] },
    });
  });

  it("saves offsets at the precision of joint degrees and reads them back", () => {
    expect(ANIMA_POSE_CLIP_DECIMALS.other).toBe(5);
    const result = validateAnimaPoseClipV2(
      withFingers({
        thumb: { curl: [4.123456789, -6], twist: 0.333333333 },
        index: { splay: -2.000004 },
      }),
    );
    if (!result.ok) throw new Error("expected a valid clip");
    const saved = JSON.parse(serializeAnimaPoseClipFile(result.clip));
    const fingers = {
      thumb: { curl: [4.12346, -6], twist: 0.33333 },
      index: { splay: -2 },
    };
    expect(saved.hands.right[0].fingers).toEqual(fingers);
    const reread = validateAnimaPoseClipV2(saved);
    expect(reread.ok && reread.clip.hands?.right?.[0].fingers).toEqual(fingers);
  });
});
