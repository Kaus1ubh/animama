import { describe, expect, it } from "vitest";

import {
  animationConfigForPreset,
  avatarEffectDefinition,
  avatarEffectDependencies,
  avatarEffectDocumentFingerprint,
  avatarEffectEditorReducer,
  buildAvatarEffectEditorExport,
  canonicalAvatarEffectImageName,
  createAvatarEffectDocumentFromDefinition,
  createDefaultAvatarEffectDocument,
  parseAvatarEffectEditorExport,
  validateAvatarEffectDocument,
} from ".";

const image = {
  logicalName: "eye-star.png",
  originalName: "Eye Star.png",
  contentType: "image/png",
  sizeBytes: 42,
  sha256: "a".repeat(64),
};

describe("Avatar Effect editor document", () => {
  it.each([
    ["hover", "hoverKind", "eye_hover"],
    ["face_anchored", "anchor", "undereye"],
    ["texture", "targetRole", "face_skin"],
  ] as const)("serializes the %s variant", (kind, field, expected) => {
    const document = {
      ...createDefaultAvatarEffectDocument(),
      name: "Eye Star",
      kind,
      image,
    };

    expect(avatarEffectDefinition(document)).toMatchObject({
      schema: "animama/avatar-effect/1",
      kind,
      image: "eye-star.png",
      [field]: expected,
    });
    expect(
      validateAvatarEffectDocument(document, { imageBytesAvailable: true }),
    ).toEqual([]);
  });

  it("keeps kind-specific state while switching creator tabs", () => {
    const initial = createDefaultAvatarEffectDocument();
    const withHover = avatarEffectEditorReducer(initial, {
      type: "patch-hover",
      patch: { hoverKind: "box_hover", placement: "top-right" },
    });
    const texture = avatarEffectEditorReducer(withHover, {
      type: "set-kind",
      kind: "texture",
    });
    const restored = avatarEffectEditorReducer(texture, {
      type: "set-kind",
      kind: "hover",
    });

    expect(restored.hover).toMatchObject({
      hoverKind: "box_hover",
      placement: "top-right",
    });
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

  it("round-trips the editor JSON without local capabilities", () => {
    const document = {
      ...createDefaultAvatarEffectDocument(),
      image,
      animationConfig: animationConfigForPreset("pulse_spin"),
    };
    const encoded = JSON.stringify(buildAvatarEffectEditorExport(document));
    const parsed = parseAvatarEffectEditorExport(JSON.parse(encoded));

    expect(parsed).toEqual(document);
    expect(encoded).not.toContain("blob:");
    expect(encoded).not.toContain("download_url");
  });

  it("hydrates an exact portable release definition", () => {
    const source = {
      ...createDefaultAvatarEffectDocument(),
      name: "Blush Stars",
      kind: "face_anchored" as const,
      image,
      face: {
        anchor: "blush" as const,
        layout: "span" as const,
        pivot: "bottom-center" as const,
        side: "left" as const,
        requiresMirror: false,
      },
    };

    const hydrated = createAvatarEffectDocumentFromDefinition({
      name: source.name,
      description: "Portable face decal",
      definition: avatarEffectDefinition(source),
      image,
      sound: null,
    });

    expect(hydrated).toMatchObject({
      kind: "face_anchored",
      face: { anchor: "blush", layout: "span", pivot: "bottom-center" },
    });
  });

  it.each(["", "   "])(
    "reopens saved effects with optional description %j",
    (description) => {
      const source = {
        ...createDefaultAvatarEffectDocument(),
        name: "Uploaded Stars",
        description,
        image,
      };
      const hydrated = createAvatarEffectDocumentFromDefinition({
        name: source.name,
        description,
        definition: avatarEffectDefinition(source),
        image,
        sound: null,
      });
      expect(hydrated.name).toBe(source.name);
      expect(hydrated.description).toBe(description);
      expect(avatarEffectDefinition(hydrated)).toEqual(
        avatarEffectDefinition(source),
      );
    },
  );

  it("uses canonical stable fingerprints and safe image names", () => {
    const left = createDefaultAvatarEffectDocument();
    const right = structuredClone(left);

    expect(avatarEffectDocumentFingerprint(left)).toBe(
      avatarEffectDocumentFingerprint(right),
    );
    expect(canonicalAvatarEffectImageName("../Eye Star.JPEG")).toBe(
      "Eye-Star.jpg",
    );
  });
});
