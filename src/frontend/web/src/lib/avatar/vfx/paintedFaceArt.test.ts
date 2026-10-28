import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Avatar } from "../Avatar";
import { appendTriangle } from "../testing/appendTriangle";
import { blinkTargets } from "../testing/blinkStrand";
import { loadedTestAvatar } from "../testing/loadedTestAvatar";
import { StubCanvas, stubCanvasOf } from "../testing/stubCanvas";
import { loadWholeBodyAvatar } from "../testing/wholeBodyVrm";
import { buildRuntimePrimitiveBindings } from "../vrmEditorInspection";
import { AvatarVFXController } from "./AvatarVFXController";
import type { RuntimePrimitiveBindingEntry } from "./avatarPrimitiveUtils";
import { parseAvatarEffectDefinition } from "./definition";
import { loadEffectImage } from "./effect-image";
import { applyAvatarVFXEffectById } from "./runtime";
import { AvatarFaceTextureAnchors } from "./AvatarFaceTextureAnchors";
import type {
  AvatarFaceTextureAnchorSnapshot,
  AvatarFaceTextureAnchorsSnapshot,
} from "./texture-anchor-types";
import { baseTextureOf } from "./textureUvMapping";

vi.mock("./effect-image", () => ({ loadEffectImage: vi.fn() }));

/**
 * Art painted on the face skin lands where the face shows, or the effect is
 * skipped with a Diagnostics finding that says why. Made from the synthetic
 * whole-body Avatar (`testing/wholeBodyVrm.ts`), whose eyes are strokes
 * painted on its face, with shapes modelled over the face added to its mesh
 * as low-poly and chibi Avatars build eyes, eye dots and noses.
 */

/** A `Path2D` that accepts the clip paths whole-body faces draw through. */
class StubPath {
  moveTo() {}
  lineTo() {}
  closePath() {}
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubGlobal("HTMLCanvasElement", StubCanvas);
  vi.stubGlobal("Path2D", StubPath);
  vi.stubGlobal("document", { createElement: () => new StubCanvas() });
  vi.mocked(loadEffectImage).mockImplementation(
    async () => new StubCanvas() as unknown as HTMLCanvasElement,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The fixture's skin joint for the head bone (chest, neck, head, …). */
const HEAD_JOINT = 2;

function faceEntry(avatar: Avatar): RuntimePrimitiveBindingEntry {
  const key = avatar.facePartMap!.parts.face_skin.bindings[0]!;
  return buildRuntimePrimitiveBindings(avatar).entries.find(
    (entry) => entry.bindingKey === key,
  )!;
}

/**
 * Add a shape to the face primitive just in front of the face, covering the
 * square of half-size `half` (m) around `centre` (head space): one triangle,
 * its own UV island, skinned to the head and still in every expression, or,
 * with `blinks`, lowered by blink as far as the painted eyes, as an eye line
 * drawn as geometry in the face mesh.
 */
function addShapeOver(
  avatar: Avatar,
  centre: THREE.Vector3Like,
  half: number,
  blinks = false,
): void {
  const landmarks = avatar.getFaceLandmarksSnapshot()!;
  const bounds = landmarks.faceBoundsLocal!;
  const front = landmarks.frontZLocal!;
  // A millimetre in front of the face, toward the side it faces.
  const z = front + (Math.abs(front - bounds.min.z) < 1e-6 ? -0.001 : 0.001);
  const { x, y } = centre;
  appendTriangle({
    avatar,
    binding: faceEntry(avatar),
    anchor: avatar.vrm!.humanoid.getNormalizedBoneNode("head")!,
    corners: [
      new THREE.Vector3(x - 2 * half, y - half, z),
      new THREE.Vector3(x + 2 * half, y - half, z),
      new THREE.Vector3(x, y + 3 * half, z),
    ],
    uv: [
      [0.97, 0.97],
      [0.99, 0.97],
      [0.98, 0.99],
    ],
    joint: HEAD_JOINT,
    ...(blinks
      ? {
          morph: {
            targets: blinkTargets(avatar, faceEntry(avatar).object),
            offset: new THREE.Vector3(0, -0.004, 0),
          },
        }
      : {}),
  });
}

/** Eye shapes modelled over each painted eye, `half` (m) about its centre. */
async function addEyeShapes(avatar: Avatar, half: number): Promise<void> {
  const { left, right } = avatar.getFaceLandmarksSnapshot()!.eyes;
  for (const eye of [left!, right!])
    addShapeOver(avatar, eye.centerLocal, half);
  await avatar.setFacePartCorrections(null);
}

const effect = (
  id: string,
  attachment: object,
  options: { appearance?: object; region?: string } = {},
) =>
  parseAvatarEffectDefinition(
    {
      schema: "animama/avatar-effect/2",
      region: options.region ?? id,
      attachment,
      art: { image: `${id}.png` },
      ...(options.appearance ? { appearance: options.appearance } : {}),
    },
    { id, label: id, description: "", assetPath: `blob:${id}` },
  );

const BLUSH = effect("blush", {
  kind: "face_surface",
  area: "blush",
  layout: "single",
  mirror: true,
  part: "face_skin",
  side: "right",
});
const UNDER_EYE = effect("undereye", {
  kind: "face_surface",
  area: "undereye",
  layout: "single",
  mirror: true,
  part: "face_skin",
  side: "right",
});
const MOUTH = effect("mouth", {
  kind: "face_surface",
  area: "mouth",
  part: "face_skin",
});
/** Under-eye art blended like Included `shiver_undereye`. */
const SHADOW = effect(
  "shadow",
  {
    kind: "face_surface",
    area: "undereye",
    layout: "single",
    mirror: true,
    part: "face_skin",
    side: "right",
  },
  { appearance: { opacity: 0.45, blend: "multiply" }, region: "undereye" },
);
const FULL_FACE = effect("full_face", {
  kind: "face_surface",
  area: "full",
  part: "face_skin",
});

/**
 * Apply `effects` through the runtime path, with a drawable face texture;
 * returns the controller and the effects it holds active afterwards.
 */
async function applyAll(
  avatar: Avatar,
  effects: readonly ReturnType<typeof effect>[],
  faceColor: readonly [number, number, number] = [200, 200, 200],
): Promise<{ controller: AvatarVFXController; active: string[] }> {
  baseTextureOf(faceEntry(avatar).object)!.image = stubCanvasOf(faceColor);
  const controller = new AvatarVFXController(avatar);
  avatar.vfxController = controller;
  for (const entry of effects) {
    await applyAvatarVFXEffectById({
      avatar,
      effectId: entry.id,
      effectEntry: entry,
    });
  }
  const active = controller
    .getSnapshot()
    .activeEffects.map((entry) => entry.appliedEffectId)
    .sort();
  return { controller, active };
}

/** The under-eye and cheek anchors, both sides, of an Avatar or a snapshot. */
function cheekAnchors(
  source: Avatar | AvatarFaceTextureAnchorsSnapshot,
): AvatarFaceTextureAnchorSnapshot[] {
  const { undereye, blush } = (
    "anchors" in source ? source : source.getFaceTextureAnchorsSnapshot()!
  ).anchors;
  return [undereye.left!, undereye.right!, blush.left!, blush.right!];
}

describe.each([1, 0] as const)(
  "painted art on a VRM %s face with shapes modelled over it",
  (vrm) => {
    it("moves under-eye and cheek art below eye shapes that cover it", async () => {
      const avatar = await loadWholeBodyAvatar({ vrm });
      const eyeY = avatar.getFaceLandmarksSnapshot()!.eyes.left!.centerLocal.y;
      // Eye shapes 4 cm across, larger than the eyes estimated from the
      // painted strokes blink lowers, as on Polybot and Maromage.
      await addEyeShapes(avatar, 0.02);

      for (const anchor of cheekAnchors(avatar)) {
        expect(anchor.covered).toBeUndefined();
        expect(anchor.localPoint.y).toBeLessThan(eyeY - 0.02);
      }
      const { controller, active } = await applyAll(avatar, [BLUSH, UNDER_EYE]);
      expect(controller.getSnapshot().warnings).toEqual([]);
      expect(active).toEqual(["blush", "undereye"]);
    });

    it("keeps cheek art below under-eye art when shapes push both down", async () => {
      const avatar = await loadWholeBodyAvatar({ vrm });
      // Shapes reaching 4.5 cm below the eyes cover both anchors' seeds.
      await addEyeShapes(avatar, 0.045);

      // The cheek moves down as far as the under-eye art did, so the two
      // stay apart rather than meeting at the first uncovered spot.
      const { undereye, blush } =
        avatar.getFaceTextureAnchorsSnapshot()!.anchors;
      for (const side of ["left", "right"] as const) {
        const under = undereye[side]!;
        expect(under.covered).toBeUndefined();
        expect(blush[side]!.covered).toBeUndefined();
        expect(blush[side]!.localPoint.y).toBeLessThan(
          under.localPoint.y - under.referenceSizeLocal.height,
        );
      }
    });

    it("skips under-eye and cheek art covered too far down, saying why", async () => {
      const avatar = await loadWholeBodyAvatar({ vrm });
      // Shapes reaching 10 cm below the eyes, further than the art may move
      // (half the 10 cm eye spacing below eyes estimated 3 cm high).
      await addEyeShapes(avatar, 0.1);

      for (const anchor of cheekAnchors(avatar)) {
        expect(anchor.covered).toBe(true);
      }
      const { controller, active } = await applyAll(avatar, [BLUSH, UNDER_EYE]);
      expect(active).toEqual([]);
      expect(controller.getSnapshot().issues).toEqual([
        { code: "effect_anchor_covered", params: { effectId: "blush" } },
        { code: "effect_anchor_covered", params: { effectId: "undereye" } },
      ]);
      expect(controller.getSnapshot().warnings[0]).toMatch(
        /^Skipped "blush": the blush texture anchor lies under other parts/,
      );
    });
  },
);

describe("mouth art under a shape modelled over the mouth", () => {
  it("still draws when a nose covers only the mouth's centre", async () => {
    const avatar = await loadWholeBodyAvatar();
    const mouth = avatar.getFaceTextureAnchorsSnapshot()!.anchors.mouth.center!;
    addShapeOver(avatar, mouth.localPoint, 0.003);
    await avatar.setFacePartCorrections(null);

    expect(
      avatar.getFaceTextureAnchorsSnapshot()!.anchors.mouth.center!.covered,
    ).toBeUndefined();
    const { controller, active } = await applyAll(avatar, [MOUTH]);
    expect(controller.getSnapshot().warnings).toEqual([]);
    expect(active).toEqual(["mouth"]);
  });

  it("is skipped when the shape covers the whole mouth", async () => {
    const avatar = await loadWholeBodyAvatar();
    const mouth = avatar.getFaceTextureAnchorsSnapshot()!.anchors.mouth.center!;
    addShapeOver(avatar, mouth.localPoint, 0.04);
    await avatar.setFacePartCorrections(null);

    const { controller, active } = await applyAll(avatar, [MOUTH]);
    expect(active).toEqual([]);
    expect(controller.getSnapshot().issues).toEqual([
      { code: "effect_anchor_covered", params: { effectId: "mouth" } },
    ]);
  });
});

describe("a face material that shows no paintable base color texture", () => {
  it("skips painted face art, saying the art would not show", async () => {
    const avatar = await loadWholeBodyAvatar();
    // The face's texture is read through a second UV set, which face
    // anchors and clips do not measure.
    baseTextureOf(faceEntry(avatar).object)!.channel = 1;

    const { controller, active } = await applyAll(avatar, [BLUSH, FULL_FACE]);
    expect(active).toEqual([]);
    expect(controller.getSnapshot().issues).toEqual([
      { code: "effect_face_texture_hidden", params: { effectId: "blush" } },
      {
        code: "effect_face_texture_hidden",
        params: { effectId: "full_face" },
      },
    ]);
  });
});

describe("multiply-blended art on a dark face", () => {
  /** Icy-blue art like Included `shiver_undereye`'s mean colour. */
  const ICY_BLUE = [177, 216, 249] as const;

  beforeEach(() => {
    vi.mocked(loadEffectImage).mockImplementation(
      async () => stubCanvasOf(ICY_BLUE) as unknown as HTMLCanvasElement,
    );
  });

  it("is drawn on a light face, where the darkening shows", async () => {
    const avatar = await loadWholeBodyAvatar();
    const { controller, active } = await applyAll(
      avatar,
      [SHADOW],
      [245, 204, 191],
    );
    expect(controller.getSnapshot().warnings).toEqual([]);
    expect(active).toEqual(["shadow"]);
  });

  it("is drawn on dark brown skin, whose red channel still changes", async () => {
    const avatar = await loadWholeBodyAvatar();
    // Red changes by 0.45 × 110 × (1 − 177/255) ≈ 15/255; the luminance of
    // surface and art together would have suggested about 6/255.
    const { controller, active } = await applyAll(
      avatar,
      [SHADOW],
      [110, 75, 55],
    );
    expect(controller.getSnapshot().warnings).toEqual([]);
    expect(active).toEqual(["shadow"]);
  });

  it("is skipped where the face is too dark for it to change", async () => {
    const avatar = await loadWholeBodyAvatar();
    // A near-black face: red, the channel it changes most, by about 3/255.
    const { controller, active } = await applyAll(
      avatar,
      [SHADOW],
      [20, 20, 20],
    );
    expect(active).toEqual([]);
    expect(controller.getSnapshot().issues).toEqual([
      { code: "effect_surface_too_dark", params: { effectId: "shadow" } },
    ]);
    expect(controller.getSnapshot().warnings).toEqual([
      'Skipped "shadow": it darkens the face where it is painted, and the face there is too dark for the change to show.',
    ]);
  });

  it("is drawn in normal blending on the same dark face", async () => {
    const avatar = await loadWholeBodyAvatar();
    const { controller, active } = await applyAll(
      avatar,
      [UNDER_EYE],
      [20, 20, 20],
    );
    expect(controller.getSnapshot().warnings).toEqual([]);
    expect(active).toEqual(["undereye"]);
  });
});

describe("eye lines and lashes over the cheeks", () => {
  /**
   * Cheek anchors on the whole-body Avatar with a band under each painted
   * eye, a triangle 8 cm wide whose top edge lies 4 mm under the eye's centre
   * and whose tip reaches 4.5 cm below the eye, taken as lash regions of the
   * face primitive (as detection takes geometry blink lowers), on a face
   * material made see-through by `material`.
   */
  async function cheeksUnderLashBands(
    material: (material: THREE.Material) => void,
  ) {
    const avatar = await loadWholeBodyAvatar();
    const face = faceEntry(avatar);
    material([face.object.material].flat()[0]!);
    const first = face.object.geometry.getIndex()!.count / 3;
    const landmarks = avatar.getFaceLandmarksSnapshot()!;
    const z = landmarks.frontZLocal! + 0.001;
    for (const eye of [landmarks.eyes.left!, landmarks.eyes.right!]) {
      const { x, y } = eye.centerLocal;
      appendTriangle({
        avatar,
        binding: face,
        anchor: avatar.vrm!.humanoid.getNormalizedBoneNode("head")!,
        corners: [
          new THREE.Vector3(x - 0.04, y - 0.004, z),
          new THREE.Vector3(x, y - 0.045, z),
          new THREE.Vector3(x + 0.04, y - 0.004, z),
        ],
        uv: [
          [0.97, 0.97],
          [0.98, 0.99],
          [0.99, 0.97],
        ],
        joint: HEAD_JOINT,
      });
    }
    await avatar.setFacePartCorrections(null);
    const lash = avatar.facePartMap!.parts.eyelash;
    lash.regions = [
      ...(lash.regions ?? []),
      { bindingKey: face.bindingKey, triangles: [first, first + 1] },
    ];
    return {
      anchors: cheekAnchors(new AvatarFaceTextureAnchors(avatar).getSnapshot()),
      bandBottom: landmarks.eyes.left!.centerLocal.y - 0.045,
    };
  }

  it("cover cheek art on an opaque face, which moves below them", async () => {
    const { anchors, bandBottom } = await cheeksUnderLashBands(() => {});
    for (const anchor of anchors) {
      expect(anchor.covered).toBeUndefined();
      expect(anchor.localPoint.y).toBeLessThan(bandBottom);
    }
  });

  /** Ways a face material lets the skin show between the strands on it. */
  const SEE_THROUGH: [string, (material: THREE.Material) => void][] = [
    [
      "an alpha test",
      (material) => {
        material.alphaTest = 0.5;
      },
    ],
    [
      "a lilToon cut-out render mode",
      (material) => {
        Object.assign(material, {
          isLilToonMaterial: true,
          renderMode: "cutout",
        });
      },
    ],
    [
      "blending",
      (material) => {
        material.transparent = true;
      },
    ],
  ];

  it.each(SEE_THROUGH)(
    "do not cover it on a face cut out by %s, where skin shows between strands",
    async (_, material) => {
      const { anchors, bandBottom } = await cheeksUnderLashBands(material);
      for (const anchor of anchors) {
        expect(anchor.covered).toBeUndefined();
        expect(anchor.localPoint.y).toBeGreaterThan(bandBottom);
      }
    },
  );

  it("never lets an eye-line or lash mesh part cover cheek art", async () => {
    const avatar = await loadedTestAvatar("AvatarSample_A_1_New");
    const before =
      avatar.getFaceTextureAnchorsSnapshot()!.anchors.undereye.left!;
    const lineKey = avatar.facePartMap!.parts.eyeline.bindings[0]!;
    const line = buildRuntimePrimitiveBindings(avatar).entries.find(
      (entry) => entry.bindingKey === lineKey,
    )!;
    // A strand of the eye-line part 2 mm in front of the under-eye anchor,
    // lowered by blink with the rest of the line.
    const { x, y, z } = before.localPoint;
    appendTriangle({
      avatar,
      binding: line,
      anchor: avatar.vrm!.humanoid.getNormalizedBoneNode("head")!,
      corners: [
        new THREE.Vector3(x - 0.01, y - 0.005, z + 0.002),
        new THREE.Vector3(x + 0.01, y - 0.005, z + 0.002),
        new THREE.Vector3(x, y + 0.005, z + 0.002),
      ],
      uv: [
        [0.1, 0.1],
        [0.12, 0.1],
        [0.11, 0.12],
      ],
      morph: {
        targets: blinkTargets(avatar, line.object),
        offset: new THREE.Vector3(0, -0.004, 0),
      },
    });
    await avatar.setFacePartCorrections(null);

    expect(avatar.facePartMap!.parts.eyeline.bindings).toEqual([lineKey]);
    const after =
      avatar.getFaceTextureAnchorsSnapshot()!.anchors.undereye.left!;
    expect(after.covered).toBeUndefined();
    expect(after.localPoint).toEqual(before.localPoint);
  });
});
