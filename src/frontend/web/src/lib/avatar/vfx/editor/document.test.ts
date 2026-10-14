import type { AvatarEffectDefinitionV2 } from "@animama/runtime-contracts/api-types";
import { getI18n } from "react-i18next";
import { describe, expect, it } from "vitest";

import conversion from "@/lib/content/fixtures/avatar-effect-conversion.json";
import packageCapabilities from "@/lib/content/fixtures/package-capabilities.json";
import {
  avatarEffectDefinition,
  avatarEffectDependencies,
  avatarEffectDocumentFingerprint,
  avatarEffectEditorReducer,
  avatarEffectRuntimeEntry,
  avatarEffectUsesOtherEyeImage,
  buildAvatarEffectEditorExport,
  canonicalAvatarEffectImageName,
  createAvatarEffectDocumentFromDefinition,
  createDefaultAvatarEffectDocument,
  distinctAvatarEffectImageName,
  otherEyeAvatarEffectImageName,
  parseAvatarEffectEditorExport,
  validateAvatarEffectDocument,
  type AvatarEffectEditorDocument,
  type AvatarEffectEditorImage,
} from ".";

const imageOf = (logicalName: string): AvatarEffectEditorImage => ({
  logicalName,
  originalName: logicalName,
  contentType: "image/png",
  sizeBytes: 42,
  sha256: "a".repeat(64),
});
const image = imageOf("eye-star.png");

function open(definition: unknown): AvatarEffectEditorDocument {
  const { art, soundAlias } = definition as Partial<AvatarEffectDefinitionV2>;
  return createAvatarEffectDocumentFromDefinition({
    name: "Effect",
    description: "",
    definition,
    image: imageOf(art?.image ?? "effect.png"),
    otherEyeImage: art?.otherEyeImage ? imageOf(art.otherEyeImage) : null,
    sound: soundAlias
      ? {
          alias: soundAlias,
          label: soundAlias,
          source: { type: "catalog", catalog_item_id: "sound-item" },
        }
      : null,
  });
}

/** One definition per attachment and `/2` feature, as stored descriptors hold them. */
const FEATURE_DEFINITIONS: Array<[string, AvatarEffectDefinitionV2]> = [
  [
    "face surface decal with other-eye art, keyframes and appearance",
    {
      schema: "animama/avatar-effect/2",
      region: "blush",
      attachment: {
        kind: "face_surface",
        part: "face_skin",
        area: "blush",
        layout: "single",
        side: "left",
        mirror: true,
        pivot: "bottom-center",
        offset: { x: 0.01, y: -0.02 },
        scale: { x: 1.5, y: 1.2 },
        rotationDeg: 12,
      },
      art: { image: "blush.png", otherEyeImage: "blush-right.png" },
      appearance: { opacity: 0.6, tint: "#ff8800", blend: "multiply" },
      motion: {
        keyframes: {
          loop: true,
          frames: [
            { t: 0, opacity: 0 },
            { t: 0.5, opacity: 1, scale: 1.2, rotationDeg: 10 },
            { t: 1.5, offset: { x: 0.01, y: 0 } },
          ],
        },
      },
    },
  ],
  [
    "face landmark eyes with flipbook and face options",
    {
      schema: "animama/avatar-effect/2",
      region: "eyes",
      attachment: {
        kind: "face_landmark",
        landmark: "eyes",
        side: "right",
        mirror: true,
        offset: { x: 0.004, y: 0.002, z: 0.001 },
        rotationDeg: { x: 0, y: 0, z: 15 },
      },
      art: {
        image: "swirl.png",
        flipbook: { columns: 4, rows: 2, frames: 7, fps: 12, loop: "pingpong" },
      },
      motion: { spin: { degreesPerSecond: 90, direction: "counterclockwise" } },
      faceOptions: { forceBlink: false, hideParts: ["eye_highlight"] },
    },
  ],
  [
    "body",
    {
      schema: "animama/avatar-effect/2",
      region: "body",
      attachment: {
        kind: "body",
        bone: "rightHand",
        offset: { x: 0.02, y: 0.05, z: 0.1 },
        size: 0.3,
        facing: "bone",
        rotationDeg: -20,
      },
      art: { image: "star.png" },
      motion: { pulse: { scaleMin: 0.9, scaleMax: 1.1 } },
    },
  ],
  [
    "sticker",
    {
      schema: "animama/avatar-effect/2",
      region: "sticker",
      attachment: {
        kind: "sticker",
        around: "body",
        offset: { x: -0.3, y: 0.2 },
        size: 0.4,
        rotationDeg: 8,
      },
      art: { image: "doki.png" },
      appearance: { blend: "additive" },
      motion: { drift: { x: 0, y: 0.05 } },
    },
  ],
  [
    "silhouette",
    {
      schema: "animama/avatar-effect/2",
      region: "silhouette",
      attachment: {
        kind: "silhouette",
        fill: "pattern",
        patternScale: 2,
        scroll: { x: 0.5, y: 0 },
      },
      art: { image: "stripes.png" },
      appearance: { opacity: 0.4 },
    },
  ],
];

describe("Avatar Effect editor document", () => {
  it.each(conversion.pairs.map((pair) => [pair.name, pair.v2] as const))(
    "reopens and saves the converted definition %s unchanged",
    (_name, definition) => {
      expect(avatarEffectDefinition(open(definition))).toEqual(definition);
    },
  );

  it.each(
    packageCapabilities.effects
      .filter((effect) => effect.kind === "avatar_effect")
      .map((effect) => [effect.name, effect.definition] as const),
  )("matches what the backend accepts for %s", (_name, definition) => {
    expect(avatarEffectDefinition(open(definition))).toEqual(definition);
  });

  it.each(FEATURE_DEFINITIONS)(
    "round-trips a %s definition through the document and its export",
    (_name, definition) => {
      const opened = open(definition);
      expect(avatarEffectDefinition(opened)).toEqual(definition);
      const imported = parseAvatarEffectEditorExport(
        JSON.parse(JSON.stringify(buildAvatarEffectEditorExport(opened))),
      );
      expect(imported).toEqual(opened);
      expect(avatarEffectDefinition(imported)).toEqual(definition);
      expect(
        validateAvatarEffectDocument(opened, {
          imageBytesAvailable: true,
          otherEyeImageBytesAvailable: true,
        }),
      ).toEqual([]);
    },
  );

  it.each([
    [
      "a converted /1 mirrored eye hover (no side)",
      {
        schema: "animama/avatar-effect/2",
        region: "eyes",
        attachment: { kind: "face_landmark", landmark: "eyes", mirror: true },
        art: { image: "eye.png" },
        faceOptions: { forceBlink: true, hideEyeDetails: true },
      },
    ],
    [
      "a P4-creator mirrored eye hover with other-eye art (no side)",
      {
        schema: "animama/avatar-effect/2",
        region: "eyes",
        attachment: { kind: "face_landmark", landmark: "eyes", mirror: true },
        art: { image: "wink.png", otherEyeImage: "wink-other.png" },
      },
    ],
    [
      "a mirrored iris texture without a side",
      {
        schema: "animama/avatar-effect/2",
        region: "eyes",
        attachment: {
          kind: "face_surface",
          part: "eye_iris",
          area: "eyes",
          layout: "single",
          mirror: true,
        },
        art: { image: "iris.png" },
      },
    ],
  ] as Array<[string, AvatarEffectDefinitionV2]>)(
    "keeps the mirror of %s through reopening and unrelated edits",
    (_name, definition) => {
      const opened = open(definition);
      expect(avatarEffectDefinition(opened)).toEqual(definition);
      const edited = avatarEffectEditorReducer(
        avatarEffectEditorReducer(opened, {
          type: "patch-attachment",
          patch: { scale: { x: 0.7, y: 0.7 } },
        }),
        { type: "patch-appearance", patch: { opacity: 0.8 } },
      );
      const saved = avatarEffectDefinition(edited);
      expect(saved.attachment).toMatchObject({ mirror: true });
      expect(saved.attachment).not.toHaveProperty("side");
      expect(saved.art).toEqual(definition.art);
    },
  );

  it("keeps the main and other-eye image names distinct", () => {
    expect(
      distinctAvatarEffectImageName("Wink-other.png", "Wink-other.png", "main"),
    ).toBe("Wink-other-main.png");
    expect(distinctAvatarEffectImageName("a.png", "a-main.png", "main")).toBe(
      "a.png",
    );
    expect(otherEyeAvatarEffectImageName("eye.png", "eye.png")).toBe(
      "eye-other.png",
    );
  });

  it("previews body, sticker and silhouette attachments with their own entries", () => {
    for (const [, definition] of FEATURE_DEFINITIONS.slice(2)) {
      const entry = avatarEffectRuntimeEntry(open(definition), {
        image: "blob:image",
      });
      expect(entry.kind).toBe(definition.attachment.kind);
    }
  });

  it("names the other-eye image apart from the main image and saves it only when mirrored", () => {
    expect(otherEyeAvatarEffectImageName("Eye.PNG", "Eye.png")).toBe(
      "Eye-other.png",
    );
    expect(otherEyeAvatarEffectImageName("wink.png", "Eye.png")).toBe(
      "wink.png",
    );
    const document = open(FEATURE_DEFINITIONS[0]![1]);
    expect(avatarEffectUsesOtherEyeImage(document)).toBe(true);
    const unmirrored = avatarEffectEditorReducer(document, {
      type: "patch-attachment",
      patch: { mirror: false },
    });
    expect(avatarEffectUsesOtherEyeImage(unmirrored)).toBe(false);
    expect(avatarEffectDefinition(unmirrored).art).toEqual({
      image: "blush.png",
    });
    // The art is kept, so mirroring again restores it.
    expect(unmirrored.art.otherEyeImage?.logicalName).toBe("blush-right.png");
  });

  it("starts each attachment from valid defaults and follows its region", () => {
    let document: AvatarEffectEditorDocument = {
      ...createDefaultAvatarEffectDocument(),
      art: { image, otherEyeImage: null, flipbook: null },
    };
    for (const kind of [
      "face_surface",
      "body",
      "sticker",
      "silhouette",
      "face_landmark",
    ] as const) {
      document = avatarEffectEditorReducer(document, {
        type: "set-attachment",
        kind,
      });
      expect(document.attachment.kind).toBe(kind);
      expect(
        validateAvatarEffectDocument(document, { imageBytesAvailable: true }),
      ).toEqual([]);
    }
    expect(document.region).toBe("eyes");
  });

  it("repairs cross-field rules when the placement changes", () => {
    let document = createDefaultAvatarEffectDocument();
    document = avatarEffectEditorReducer(document, {
      type: "patch-attachment",
      patch: { landmark: "top_edge", position: "right_corner" },
    });
    expect(document.attachment).toEqual({
      kind: "face_landmark",
      landmark: "top_edge",
      position: "right_corner",
    });
    expect(document.region).toBe("emote");
    document = avatarEffectEditorReducer(document, {
      type: "patch-attachment",
      patch: { landmark: "forehead" },
    });
    expect(document.attachment).toMatchObject({ position: "right" });

    document = avatarEffectEditorReducer(document, {
      type: "set-attachment",
      kind: "face_surface",
    });
    document = avatarEffectEditorReducer(document, {
      type: "patch-attachment",
      patch: { area: "full" },
    });
    expect(document.attachment).toEqual({
      kind: "face_surface",
      part: "face_skin",
      area: "full",
    });
    expect(document.region).toBe("full_face");
    document = avatarEffectEditorReducer(document, {
      type: "patch-attachment",
      patch: { area: "undereye" },
    });
    expect(document.attachment).toMatchObject({
      layout: "single",
      side: "left",
      mirror: true,
    });
  });

  it("keeps a custom region until it no longer suits the attachment", () => {
    let document = avatarEffectEditorReducer(
      createDefaultAvatarEffectDocument(),
      { type: "patch", patch: { region: "emote" } },
    );
    document = avatarEffectEditorReducer(document, {
      type: "patch-attachment",
      patch: { landmark: "mouth" },
    });
    expect(document.region).toBe("emote");
    document = avatarEffectEditorReducer(document, {
      type: "set-attachment",
      kind: "sticker",
    });
    expect(document).toMatchObject({
      region: "sticker",
      regionMode: "automatic",
    });
  });

  it("saves only the face options the attachment honours", () => {
    let document = avatarEffectEditorReducer(
      {
        ...createDefaultAvatarEffectDocument(),
        art: { ...createDefaultAvatarEffectDocument().art, image },
      },
      {
        type: "patch-face-options",
        patch: { forceBlink: false, skinBackdrop: true },
      },
    );
    expect(avatarEffectDefinition(document).faceOptions).toEqual({
      forceBlink: false,
      skinBackdrop: true,
    });
    document = avatarEffectEditorReducer(document, {
      type: "patch-attachment",
      patch: { landmark: "mouth" },
    });
    expect(avatarEffectDefinition(document).faceOptions).toEqual({
      skinBackdrop: true,
    });
    document = avatarEffectEditorReducer(document, {
      type: "set-attachment",
      kind: "body",
    });
    expect(avatarEffectDefinition(document)).not.toHaveProperty("faceOptions");
    // The authored choices stay for when the attachment honours them again.
    expect(document.faceOptions).toEqual({
      forceBlink: false,
      skinBackdrop: true,
    });
  });

  it("names the invalid setting by its plain label and definition path", () => {
    const document = avatarEffectEditorReducer(
      {
        ...createDefaultAvatarEffectDocument(),
        art: { image, otherEyeImage: null, flipbook: null },
      },
      { type: "patch-attachment", patch: { offset: { x: 9, y: 0, z: 0 } } },
    );
    const [issue] = validateAvatarEffectDocument(document, {
      imageBytesAvailable: true,
    });
    expect(issue).toMatchObject({
      field: "attachment.offset.x",
      severity: "error",
    });
    expect(issue!.message).toMatch(/^Position: /);
  });

  it("keeps the validator's English as detail outside English", async () => {
    const document = avatarEffectEditorReducer(
      {
        ...createDefaultAvatarEffectDocument(),
        art: { image, otherEyeImage: null, flipbook: null },
      },
      { type: "patch-attachment", patch: { offset: { x: 9, y: 0, z: 0 } } },
    );
    const english = validateAvatarEffectDocument(document, {
      imageBytesAvailable: true,
    })[0]!.message.replace(/^Position: /, "");
    await getI18n().changeLanguage("ja");
    try {
      const [issue] = validateAvatarEffectDocument(document, {
        imageBytesAvailable: true,
      });
      expect(issue!.message).toBe(
        `位置: 設定の組み合わせが正しくありません。（${english}）`,
      );
    } finally {
      await getI18n().changeLanguage("en");
    }
  });

  it("reports missing image bytes, other-eye bytes and an impossible flipbook", () => {
    const document = open(FEATURE_DEFINITIONS[0]![1]);
    document.art.flipbook = {
      columns: 2,
      rows: 2,
      frames: 5,
      fps: 10,
      loop: "loop",
    };
    expect(
      validateAvatarEffectDocument(document, {
        imageBytesAvailable: false,
        otherEyeImageBytesAvailable: false,
      }).map((issue) => issue.field),
    ).toEqual(["art.image", "art.otherEyeImage", "art.flipbook.frames"]);
    expect(
      validateAvatarEffectDocument(createDefaultAvatarEffectDocument(), {
        imageBytesAvailable: false,
      }).map((issue) => issue.field),
    ).toEqual(["art.image"]);
  });

  it("pins an optional Sound Effect to its exact source", () => {
    const document = {
      ...createDefaultAvatarEffectDocument(),
      sound: {
        alias: "on-apply",
        label: "Bright Idea",
        source: {
          type: "builtin" as const,
          content_id: "sound_effect:bright-idea",
          version: 3,
        },
      },
    };
    expect(avatarEffectDependencies(document)).toEqual([
      {
        alias: "on-apply",
        content_type: "sound_effect",
        source: document.sound.source,
        config: {},
      },
    ]);
    expect(avatarEffectDefinition(document)).toMatchObject({
      soundAlias: "on-apply",
    });
  });

  it("round-trips the editor JSON without local capabilities and refuses the old format", () => {
    const document = open(FEATURE_DEFINITIONS[1]![1]);
    const encoded = JSON.stringify(buildAvatarEffectEditorExport(document));
    expect(parseAvatarEffectEditorExport(JSON.parse(encoded))).toEqual(
      document,
    );
    expect(encoded).not.toContain("blob:");
    expect(() =>
      parseAvatarEffectEditorExport({
        schema: "animama/avatar-effect-editor/1",
        document: { kind: "hover" },
      }),
    ).toThrow(/earlier Avatar Effect editor format/);
  });

  it("keeps descriptions optional and fingerprints stable", () => {
    const document = open(FEATURE_DEFINITIONS[2]![1]);
    expect(document.description).toBe("");
    expect(avatarEffectDocumentFingerprint(document)).toBe(
      avatarEffectDocumentFingerprint(structuredClone(document)),
    );
    expect(canonicalAvatarEffectImageName("../Eye Star.JPEG")).toBe(
      "Eye-Star.jpg",
    );
  });

  it("refuses a /1 definition with the conversion hint", () => {
    expect(() => open(conversion.pairs[0]!.v1)).toThrow(/content_cli/);
  });
});
