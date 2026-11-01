import {
  VRMExpression,
  VRMExpressionMaterialColorBind,
  VRMExpressionMorphTargetBind,
  VRMExpressionTextureTransformBind,
  type VRM,
} from "@pixiv/three-vrm";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { ARKIT_BLENDSHAPES } from "./arkit";
import { ARKIT_VOWEL_MIXES, type ArkitMix } from "./arkitFaceCompositions";
import { ExpressionController } from "./ExpressionController";
import {
  FACE_SIGNAL_PRESETS,
  expressionPlaysSomething,
  faceSignalSourceOf,
  registerFaceSignals,
  type FaceSignalPreset,
  type FaceSignalSource,
} from "./faceSignals";
import {
  VRM0_FIXTURE_ID,
  loadTestAvatar,
  type TestAvatarId,
} from "./motion-authoring/testing/includedAvatars";
import { prepareLoadedVrm } from "./prepareLoadedVrm";
import { morphInfluence, syntheticFaceVrm } from "./testing/syntheticFaceVrm";

/** ARKit shapes under the `_L`/`_R` spelling converters often use. */
const arkitSpelling = (shape: string) =>
  shape.replace(/Left$/, "_L").replace(/Right$/, "_R");
const ARKIT = ARKIT_BLENDSHAPES.map(arkitSpelling);
/** MMD's standard blink and vowel morphs. */
const MMD = [
  "まばたき",
  "ウィンク",
  "ウィンク右",
  "あ",
  "い",
  "う",
  "え",
  "お",
];
/** VRChat's eyelid and viseme shapes. */
const VRCHAT = [
  "vrc.blink_left",
  "vrc.blink_right",
  "vrc.v_aa",
  "vrc.v_ih",
  "vrc.v_ou",
  "vrc.v_e",
  "vrc.v_oh",
];

/** Every signal from one source. */
const all = (source: FaceSignalSource) =>
  Object.fromEntries(FACE_SIGNAL_PRESETS.map((preset) => [preset, source]));

/** The morph names an expression binds on the synthetic face, with weights. */
function boundMorphs(
  vrm: VRM,
  mesh: THREE.Mesh,
  name: string,
): Record<string, number> {
  const names = Object.fromEntries(
    Object.entries(mesh.morphTargetDictionary!).map(([morph, index]) => [
      index,
      morph,
    ]),
  );
  const bound: Record<string, number> = {};
  for (const bind of vrm.expressionManager!.getExpression(name)?.binds ?? []) {
    if (!(bind instanceof VRMExpressionMorphTargetBind)) continue;
    const morph = names[bind.index]!;
    bound[morph] = (bound[morph] ?? 0) + bind.weight;
  }
  return bound;
}

/** An ARKit mix under the synthetic face's `_L`/`_R` spelling. */
const spelledMix = (mix: ArkitMix) =>
  Object.fromEntries(
    Object.entries(mix).map(([shape, weight]) => [
      arkitSpelling(shape),
      weight,
    ]),
  );

describe("registerFaceSignals", () => {
  it("keeps every preset a file binds and registers nothing", () => {
    const { vrm } = syntheticFaceVrm({
      morphs: [...FACE_SIGNAL_PRESETS, ...ARKIT, ...MMD, ...VRCHAT],
      presets: FACE_SIGNAL_PRESETS,
    });
    const manager = vrm.expressionManager!;
    const before = [...manager.expressions];

    expect(registerFaceSignals(vrm)).toEqual(all("preset"));
    expect(manager.expressions).toHaveLength(before.length);
    for (const expression of before) {
      expect(manager.getExpression(expression.expressionName)).toBe(expression);
      expect(faceSignalSourceOf(expression)).toBeNull();
    }
  });

  it("plays the file's left and right blinks together as blink", () => {
    const { vrm, mesh } = syntheticFaceVrm({
      morphs: ["Close_L", "Close_R", "Mouth_A", ...MMD],
      presetBinds: {
        blinkLeft: ["Close_L"],
        blinkRight: ["Close_R"],
        aa: ["Mouth_A"],
      },
    });

    const sources = registerFaceSignals(vrm);
    expect(sources).toMatchObject({
      blink: "left_right",
      blinkLeft: "preset",
      blinkRight: "preset",
      aa: "preset",
    });
    expect(boundMorphs(vrm, mesh, "blink")).toEqual({
      Close_L: 1,
      Close_R: 1,
    });
    const manager = vrm.expressionManager!;
    manager.setValue("blink", 1);
    manager.update();
    expect(morphInfluence(mesh, "Close_L")).toBeCloseTo(1, 5);
    expect(morphInfluence(mesh, "Close_R")).toBeCloseTo(1, 5);
    expect(morphInfluence(mesh, "まばたき")).toBe(0);
  });

  it("binds a morph both side blinks share once", () => {
    // A converter that maps both winks onto one eyes-closed shape, and one
    // side that also moves a separate lid morph at a lower weight.
    const { vrm, mesh } = syntheticFaceVrm({
      morphs: ["Blink", "Lid_R"],
      presetBinds: { blinkLeft: ["Blink"], blinkRight: ["Blink", "Lid_R"] },
    });
    const manager = vrm.expressionManager!;
    const tint = new VRMExpressionMaterialColorBind({
      material: new THREE.MeshBasicMaterial(),
      type: "color",
      targetValue: new THREE.Color(1, 0, 0),
    });
    manager.getExpression("blinkLeft")!.addBind(tint);

    expect(registerFaceSignals(vrm).blink).toBe("left_right");
    expect(boundMorphs(vrm, mesh, "blink")).toEqual({ Blink: 1, Lid_R: 1 });
    // Only morph binds join; the side's colour change stays with the side.
    expect(manager.getExpression("blink")!.binds).not.toContain(tint);
    manager.setValue("blink", 1);
    manager.update();
    expect(morphInfluence(mesh, "Blink")).toBeCloseTo(1, 5);
  });

  it("fills blink and visemes from ARKit shapes", () => {
    const { vrm, mesh } = syntheticFaceVrm({ morphs: ARKIT });

    expect(registerFaceSignals(vrm)).toEqual(all("arkit"));
    expect(boundMorphs(vrm, mesh, "blink")).toEqual({
      eyeBlink_L: 1,
      eyeBlink_R: 1,
    });
    expect(boundMorphs(vrm, mesh, "blinkLeft")).toEqual({ eyeBlink_L: 1 });
    expect(boundMorphs(vrm, mesh, "blinkRight")).toEqual({ eyeBlink_R: 1 });
    expect(boundMorphs(vrm, mesh, "aa")).toEqual(
      spelledMix(ARKIT_VOWEL_MIXES.A),
    );
    expect(boundMorphs(vrm, mesh, "ih")).toEqual(
      spelledMix(ARKIT_VOWEL_MIXES.I),
    );
    expect(boundMorphs(vrm, mesh, "ou")).toEqual(
      spelledMix(ARKIT_VOWEL_MIXES.U),
    );
    expect(boundMorphs(vrm, mesh, "ee")).toEqual(
      spelledMix(ARKIT_VOWEL_MIXES.E),
    );
    expect(boundMorphs(vrm, mesh, "oh")).toEqual(
      spelledMix(ARKIT_VOWEL_MIXES.O),
    );
  });

  it("leaves a viseme whose ARKit mix is incomplete unfilled", () => {
    const { vrm } = syntheticFaceVrm({
      morphs: ARKIT.filter((shape) => shape !== "mouthPucker"),
    });
    const sources = registerFaceSignals(vrm);
    // U's mix uses mouthPucker; the other vowels do not.
    expect(sources.ou).toBe("none");
    expect(sources.aa).toBe("arkit");
    expect(vrm.expressionManager!.getExpression("ou")).toBeNull();
  });

  it("fills blink and visemes from MMD's standard morphs", () => {
    const { vrm, mesh } = syntheticFaceVrm({ morphs: MMD });

    expect(registerFaceSignals(vrm)).toEqual(all("mmd"));
    const expected: Record<FaceSignalPreset, Record<string, number>> = {
      blink: { まばたき: 1 },
      blinkLeft: { ウィンク: 1 },
      blinkRight: { ウィンク右: 1 },
      aa: { あ: 1 },
      ih: { い: 1 },
      ou: { う: 1 },
      ee: { え: 1 },
      oh: { お: 1 },
    };
    for (const preset of FACE_SIGNAL_PRESETS) {
      expect(boundMorphs(vrm, mesh, preset), preset).toEqual(expected[preset]);
    }
  });

  it("fills blink and visemes from VRChat shapes, however they are spelled", () => {
    const morphs = [
      "vrc.blink_left",
      "VRC_Blink_R",
      "vrc.v_aa",
      "VRC.V_IH",
      "vrc_v_ou",
      "vrc.v_e",
      "Vrc.V_Oh",
    ];
    const { vrm, mesh } = syntheticFaceVrm({ morphs });

    expect(registerFaceSignals(vrm)).toEqual(all("vrchat"));
    expect(boundMorphs(vrm, mesh, "blink")).toEqual({
      "vrc.blink_left": 1,
      VRC_Blink_R: 1,
    });
    expect(boundMorphs(vrm, mesh, "blinkLeft")).toEqual({
      "vrc.blink_left": 1,
    });
    expect(boundMorphs(vrm, mesh, "blinkRight")).toEqual({ VRC_Blink_R: 1 });
    expect(boundMorphs(vrm, mesh, "ih")).toEqual({ "VRC.V_IH": 1 });
    expect(boundMorphs(vrm, mesh, "ou")).toEqual({ vrc_v_ou: 1 });
    expect(boundMorphs(vrm, mesh, "ee")).toEqual({ "vrc.v_e": 1 });
    expect(boundMorphs(vrm, mesh, "oh")).toEqual({ "Vrc.V_Oh": 1 });
  });

  it("treats presets that bind nothing, at weight 0 or no shape, as missing", () => {
    const { vrm, mesh } = syntheticFaceVrm({
      morphs: VRCHAT,
      // As a VRM 0 file's unbound preset clips load.
      presetBinds: { blink: [], aa: [] },
    });
    const manager = vrm.expressionManager!;
    const atZero = new VRMExpression("blinkLeft");
    atZero.addBind(
      new VRMExpressionMorphTargetBind({
        primitives: [mesh],
        index: mesh.morphTargetDictionary!["vrc.blink_left"]!,
        weight: 0,
      }),
    );
    manager.registerExpression(atZero);
    const noShape = new VRMExpression("blinkRight");
    noShape.addBind(
      new VRMExpressionMorphTargetBind({
        primitives: [mesh],
        index: 99,
        weight: 1,
      }),
    );
    manager.registerExpression(noShape);

    // The file's left and right blinks play nothing, so blink is VRChat's.
    expect(registerFaceSignals(vrm)).toEqual(all("vrchat"));
    expect(manager.getExpression("blinkLeft")).not.toBe(atZero);
    expect(manager.getExpression("blinkRight")).not.toBe(noShape);
    manager.setValue("blinkLeft", 1);
    manager.update();
    expect(morphInfluence(mesh, "vrc.blink_left")).toBeCloseTo(1, 5);
  });

  it("tries the file's winks, then MMD, then ARKit, then VRChat for blinks", () => {
    const everything = syntheticFaceVrm({
      morphs: [...VRCHAT, ...ARKIT, ...MMD],
    });
    expect(registerFaceSignals(everything.vrm)).toEqual(all("mmd"));

    const noMmd = syntheticFaceVrm({ morphs: [...VRCHAT, ...ARKIT] });
    expect(registerFaceSignals(noMmd.vrm)).toMatchObject({
      blink: "arkit",
      blinkLeft: "arkit",
      blinkRight: "arkit",
    });

    const winks = syntheticFaceVrm({
      morphs: ["Close_L", "Close_R", ...MMD],
      presetBinds: { blinkLeft: ["Close_L"], blinkRight: ["Close_R"] },
    });
    expect(registerFaceSignals(winks.vrm).blink).toBe("left_right");

    // VRChat's both-eyes blink comes before its two sides.
    const vrcBlink = syntheticFaceVrm({ morphs: ["vrc.blink", ...VRCHAT] });
    registerFaceSignals(vrcBlink.vrm);
    expect(boundMorphs(vrcBlink.vrm, vrcBlink.mesh, "blink")).toEqual({
      "vrc.blink": 1,
    });
  });

  it("prefers authored vowel shapes to ARKit's vowel mixes", () => {
    const { vrm, mesh } = syntheticFaceVrm({ morphs: [...VRCHAT, ...ARKIT] });
    const sources = registerFaceSignals(vrm);
    for (const vowel of ["aa", "ih", "ou", "ee", "oh"] as const) {
      expect(sources[vowel], vowel).toBe("vrchat");
    }
    expect(boundMorphs(vrm, mesh, "aa")).toEqual({ "vrc.v_aa": 1 });
  });

  it("keeps its expressions when called again", () => {
    const { vrm } = syntheticFaceVrm({ morphs: VRCHAT });
    const manager = vrm.expressionManager!;
    const first = registerFaceSignals(vrm);
    const registered = FACE_SIGNAL_PRESETS.map((preset) =>
      manager.getExpression(preset),
    );
    const count = manager.expressions.length;

    expect(registerFaceSignals(vrm)).toEqual(first);
    // The whole load-time path again, as ExpressionController repeats it.
    prepareLoadedVrm(vrm, { vrmSha256: null });
    new ExpressionController(vrm).dispose();
    FACE_SIGNAL_PRESETS.forEach((preset, index) => {
      const expression = manager.getExpression(preset);
      expect(expression, preset).toBe(registered[index]);
      expect(faceSignalSourceOf(expression!)).toBe("vrchat");
    });
    expect(manager.expressions.length).toBeGreaterThanOrEqual(count);
    expect(
      manager.expressions.filter((expression) =>
        (FACE_SIGNAL_PRESETS as readonly string[]).includes(
          expression.expressionName,
        ),
      ),
    ).toHaveLength(FACE_SIGNAL_PRESETS.length);
  });

  it.each<TestAvatarId>(["Andrew", "Annie", VRM0_FIXTURE_ID])(
    "leaves %s's own presets in place",
    async (id) => {
      const vrm = await loadTestAvatar(id);
      const manager = vrm.expressionManager!;
      const before = [...manager.expressions];
      expect(registerFaceSignals(vrm)).toEqual(all("preset"));
      expect([...manager.expressions]).toEqual(before);
    },
  );
});

describe("expressionPlaysSomething", () => {
  const { mesh } = syntheticFaceVrm({ morphs: ["Shape"] });
  const withBind = (bind: VRMExpression["binds"][number]) => {
    const expression = new VRMExpression("custom");
    expression.addBind(bind);
    return expression;
  };

  it("counts material and texture binds as playing", () => {
    const material = new THREE.MeshBasicMaterial();
    expect(
      expressionPlaysSomething(
        withBind(
          new VRMExpressionMaterialColorBind({
            material,
            type: "color",
            targetValue: new THREE.Color(1, 0, 0),
          }),
        ),
      ),
    ).toBe(true);
    expect(
      expressionPlaysSomething(
        withBind(
          new VRMExpressionTextureTransformBind({
            material,
            scale: new THREE.Vector2(1, 1),
            offset: new THREE.Vector2(0.25, 0),
          }),
        ),
      ),
    ).toBe(true);
  });

  it("counts morph binds only at a weight above 0 on a shape the mesh has", () => {
    const morph = (index: number, weight: number) =>
      withBind(
        new VRMExpressionMorphTargetBind({
          primitives: [mesh],
          index,
          weight,
        }),
      );
    expect(expressionPlaysSomething(morph(0, 1))).toBe(true);
    expect(expressionPlaysSomething(morph(0, 0))).toBe(false);
    expect(expressionPlaysSomething(morph(5, 1))).toBe(false);
    expect(expressionPlaysSomething(new VRMExpression("empty"))).toBe(false);
    expect(expressionPlaysSomething(null)).toBe(false);
  });

  it("makes a preset bound at weight 0 an expression the Avatar lacks", () => {
    const { vrm } = syntheticFaceVrm({ morphs: ["Smile"] });
    const happy = new VRMExpression("happy");
    happy.addBind(
      new VRMExpressionMorphTargetBind({
        primitives: [vrm.scene.children[0] as THREE.Mesh],
        index: 0,
        weight: 0,
      }),
    );
    vrm.expressionManager!.registerExpression(happy);
    const controller = new ExpressionController(vrm);

    controller.setExpressionOverlay("reaction", { happy: 1 });
    expect(controller.unresolvedExpressionNames).toEqual(["happy"]);
    controller.dispose();
  });
});

describe("face signals at runtime", () => {
  it("blinks idly through VRChat's left and right shapes", () => {
    const { vrm, mesh } = syntheticFaceVrm({ morphs: VRCHAT });
    const controller = new ExpressionController(vrm);
    let left = 0;
    let right = 0;
    // The longest wait before a blink is 5 s.
    for (let frame = 0; frame < 12 * 60; frame += 1) {
      controller.update(1 / 60);
      left = Math.max(left, morphInfluence(mesh, "vrc.blink_left"));
      right = Math.max(right, morphInfluence(mesh, "vrc.blink_right"));
    }
    expect(left).toBeGreaterThan(0.5);
    expect(right).toBeCloseTo(left, 5);
    controller.dispose();
  });

  it("closes both eyes when a Gesture keys blink", () => {
    const { vrm, mesh } = syntheticFaceVrm({ morphs: ARKIT });
    prepareLoadedVrm(vrm, { vrmSha256: null });
    const manager = vrm.expressionManager!;
    manager.setValue("blink", 1);
    manager.update();
    expect(morphInfluence(mesh, "eyeBlink_L")).toBeCloseTo(1, 5);
    expect(morphInfluence(mesh, "eyeBlink_R")).toBeCloseTo(1, 5);
  });

  it.each([
    ["MMD", MMD, "あ", "お"],
    ["VRChat", VRCHAT, "vrc.v_aa", "vrc.v_oh"],
  ])(
    "moves the mouth through %s vowels while speaking",
    (_scheme, morphs, aShape, oShape) => {
      const { vrm, mesh } = syntheticFaceVrm({ morphs });
      const controller = new ExpressionController(vrm);
      const clock = { currentTime: 0 };
      controller.setAudioContext(clock as unknown as AudioContext);
      controller.initLipSyncSegment({
        segment_id: "seg",
        run_id: "run",
        duration_seconds: 2,
        format: "vowel5",
      });
      // [A, E, I, O, U]: "A" for the first second, then "O".
      for (const [time, values] of [
        [0, [1, 0, 0, 0, 0]],
        [0.9, [1, 0, 0, 0, 0]],
        [1, [0, 0, 0, 1, 0]],
        [2, [0, 0, 0, 1, 0]],
      ] as const) {
        controller.registerLipSyncFrame({
          segment_id: "seg",
          time_sec: time,
          values: [...values],
          format: "vowel5",
        });
      }
      controller.onSegmentAudioStarted("seg", 0);

      clock.currentTime = 0.5;
      controller.update(1 / 60);
      expect(morphInfluence(mesh, aShape)).toBeGreaterThan(0.5);
      clock.currentTime = 1.5;
      controller.update(1 / 60);
      expect(morphInfluence(mesh, oShape)).toBeGreaterThan(0.5);
      expect(morphInfluence(mesh, aShape)).toBe(0);
      controller.dispose();
    },
  );
});
