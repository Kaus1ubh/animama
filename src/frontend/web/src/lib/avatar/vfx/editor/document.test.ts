import { describe, expect, it } from "vitest";

import {
  animationConfigForPreset,
  avatarEffectDefinition,
  avatarEffectDependencies,
  avatarEffectDocumentFingerprint,
  avatarEffectEditorReducer,
  buildAvatarEffectEditorExport,
  canonicalAvatarEffectImageName,
  cloneAvatarEffectDocument,
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
  it("drops legacy lifetime from saved definitions, drafts and exports", () => {
    const opened = createAvatarEffectDocumentFromDefinition({
      name: "Legacy",
      description: "",
      definition: {
        schema: "animama/avatar-effect/1",
        kind: "hover",
        region: "emote",
        hoverKind: "box_hover",
        placement: "forehead-left",
        lifetime: { kind: "duration", runEndBufferSec: 5 },
        image: image.logicalName,
      },
      image,
      sound: null,
    });
    expect(opened).not.toHaveProperty("lifetime");
    expect(avatarEffectDefinition(opened)).not.toHaveProperty("lifetime");
    expect(
      validateAvatarEffectDocument(opened, { imageBytesAvailable: true }),
    ).toEqual([]);

    const draft = {
      ...createDefaultAvatarEffectDocument(),
      image,
      lifetime: { kind: "duration", runEndBufferSec: 5 },
    };
    expect(cloneAvatarEffectDocument(draft)).not.toHaveProperty("lifetime");
    expect(
      parseAvatarEffectEditorExport({
        schema: "animama/avatar-effect-editor/1",
        document: draft,
      }),
    ).not.toHaveProperty("lifetime");
  });

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

  it("keeps new names empty and permits automatic naming on save", () => {
    const document = createDefaultAvatarEffectDocument();
    expect(document.name).toBe("");
    expect(
      validateAvatarEffectDocument(document, {
        imageBytesAvailable: false,
      }).filter((issue) => issue.field === "name"),
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
        ...createDefaultAvatarEffectDocument().face,
        anchor: "blush" as const,
        layout: "span" as const,
        pivot: "bottom-center" as const,
        side: "left" as const,
        requiresMirror: false,
      },
    };

    const hydrated = createAvatarEffectDocumentFromDefinition({
      name: source.name,
      description: "",
      definition: avatarEffectDefinition(source),
      image,
      sound: null,
    });

    expect(hydrated).toMatchObject({
      description: "",
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
  it.each([
    {
      kind: "hover",
      hoverKind: "eye_hover",
      region: "eyes",
      disableTargetRoles: ["eyeline"],
      forceBlink: false,
      autoDisableEyeMaterials: false,
      faceCleanup: false,
    },
    {
      kind: "texture",
      targetRole: "eye_iris",
      assetShape: "single_eye",
      applyMode: "overlay",
      region: "eyes",
      disableTargetRoles: ["eye_highlight"],
    },
    {
      kind: "hover",
      hoverKind: "mouth_hover",
      region: "mouth",
      faceCleanup: false,
    },
    {
      kind: "face_anchored",
      anchor: "mouth",
      region: "mouth",
      faceCleanup: false,
    },
  ])(
    "preserves suppression and cleanup through edit, export and save: $kind/$region",
    (definition) => {
      const hydrated = createAvatarEffectDocumentFromDefinition({
        name: "Existing effect",
        description: "",
        definition,
        image,
        sound: null,
      });
      const imported = parseAvatarEffectEditorExport(
        buildAvatarEffectEditorExport(hydrated),
      );
      expect(avatarEffectDefinition(imported)).toMatchObject(definition);
    },
  );

  it("suggests regions from placement and preserves custom assignments", () => {
    let document = createDefaultAvatarEffectDocument();
    document = avatarEffectEditorReducer(document, {
      type: "patch-hover",
      patch: { hoverKind: "box_hover" },
    });
    expect(document.region).toBe("emote");
    document = avatarEffectEditorReducer(document, {
      type: "patch-hover",
      patch: { hoverKind: "mouth_hover" },
    });
    expect(document.region).toBe("mouth");
    document = avatarEffectEditorReducer(document, {
      type: "set-kind",
      kind: "face_anchored",
    });
    expect(document.region).toBe("undereye");
    document = avatarEffectEditorReducer(document, {
      type: "patch-face",
      patch: { anchor: "blush" },
    });
    expect(document.region).toBe("blush");
    document = avatarEffectEditorReducer(document, {
      type: "set-kind",
      kind: "texture",
    });
    expect(document.region).toBe("full_face");
    document = avatarEffectEditorReducer(document, {
      type: "patch-texture",
      patch: { targetRole: "eye_iris" },
    });
    expect(document.region).toBe("eyes");
    document = avatarEffectEditorReducer(document, {
      type: "patch",
      patch: { region: "emote" },
    });
    document = avatarEffectEditorReducer(document, {
      type: "patch-texture",
      patch: { targetRole: "face_skin" },
    });
    expect(document.region).toBe("emote");
    document = avatarEffectEditorReducer(document, {
      type: "set-kind",
      kind: "hover",
    });
    expect(document.region).toBe("emote");
  });

  it("supplies legacy defaults when importing an older editor document", () => {
    const legacy = buildAvatarEffectEditorExport(
      createDefaultAvatarEffectDocument(),
    );
    for (const key of [
      "forceBlink",
      "autoDisableEyeMaterials",
      "faceCleanup",
      "disableTargetRoles",
    ]) {
      delete (legacy.document.hover as unknown as Record<string, unknown>)[key];
    }
    const imported = parseAvatarEffectEditorExport(legacy);
    expect(avatarEffectDefinition(imported)).toMatchObject({
      forceBlink: true,
      autoDisableEyeMaterials: true,
      faceCleanup: true,
      disableTargetRoles: [],
    });
  });
  it("keeps explicit regions even when they match the automatic suggestion", () => {
    let document = createDefaultAvatarEffectDocument();
    document = avatarEffectEditorReducer(document, {
      type: "patch",
      patch: { region: "eyes" },
    });
    document = avatarEffectEditorReducer(document, {
      type: "patch-hover",
      patch: { hoverKind: "box_hover" },
    });
    expect(document.region).toBe("eyes");
    document = avatarEffectEditorReducer(document, {
      type: "patch",
      patch: { regionMode: "automatic" },
    });
    expect(document.region).toBe("emote");
  });

  it("restores older recovery documents without losing their assigned region", () => {
    const legacy = createDefaultAvatarEffectDocument();
    delete (legacy as Partial<typeof legacy>).regionMode;
    delete (legacy.hover as Partial<typeof legacy.hover>).disableTargetRoles;
    delete (legacy.hover as Partial<typeof legacy.hover>).forceBlink;
    const recovered = cloneAvatarEffectDocument(legacy);
    expect(recovered.regionMode).toBe("custom");
    expect(recovered.hover).toMatchObject({
      forceBlink: true,
      disableTargetRoles: [],
    });
    expect(
      avatarEffectEditorReducer(recovered, {
        type: "patch-hover",
        patch: { hoverKind: "box_hover" },
      }).region,
    ).toBe("eyes");
  });
});
