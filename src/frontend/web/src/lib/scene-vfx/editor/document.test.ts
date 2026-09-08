import { describe, expect, it } from "vitest";

import {
  applySceneEffectTemplate,
  buildSceneEffectEditorExport,
  canonicalSceneEffectImageName,
  createDefaultSceneEffectDocument,
  createSceneEffectDocumentFromDefinition,
  DEFAULT_SCENE_PATTERN_COLOR,
  DEFAULT_SCENE_SOLID_COLOR,
  parseSceneEffectEditorExport,
  sceneEffectDefinition,
  sceneEffectDependencies,
  sceneEffectDocumentFingerprint,
  sceneEffectImageMetadata,
  sceneEffectEditorReducer,
  sceneEffectRuntimeEntry,
  uniqueSceneEffectImageName,
  validateSceneEffectDocument,
} from ".";

const image = {
  logicalName: "sparkle.webp",
  originalName: "Sparkle.PNG",
  contentType: "image/png",
  sizeBytes: 42,
  sha256: "a".repeat(64),
};

describe("Scene Effect editor document", () => {
  it("starts new documents with all background layers enabled and themed", () => {
    const document = createDefaultSceneEffectDocument();

    expect(document.kind).toBe("background_layers");
    expect(document.background).toMatchObject({
      solid: { enabled: true, color: DEFAULT_SCENE_SOLID_COLOR },
      pattern: {
        enabled: true,
        pattern: "polkadot",
        color: DEFAULT_SCENE_PATTERN_COLOR,
      },
      marquee: { enabled: true, items: [] },
    });
    expect(validateSceneEffectDocument(document, [])).toEqual([]);
  });

  it("serializes portable background layers and their private images", () => {
    const document = createDefaultSceneEffectDocument();
    document.name = "Sparkle Scene";
    document.background.marquee.items.push({
      id: "private-sparkle",
      kind: "image",
      label: "Sparkle",
      image,
    });
    const resource = {
      logicalName: image.logicalName,
      file: new File(["sparkle"], image.originalName, {
        type: image.contentType,
      }),
      sha256: image.sha256,
    };

    const definition = sceneEffectDefinition(document);
    expect(definition).toMatchObject({
      schema: "animama/scene-effect/1",
      kind: "background_layers",
      durationMs: 5000,
      dismissOnInput: true,
    });
    expect((definition.marquee as { items: unknown[] }).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "private-sparkle",
          kind: "image",
          image: "sparkle.webp",
        }),
      ]),
    );
    expect(sceneEffectImageMetadata(document)).toEqual([image]);
    expect(validateSceneEffectDocument(document, [resource])).toEqual([]);
  });

  it("keeps both variants while applying a Focus Lines template", () => {
    const initial = createDefaultSceneEffectDocument();
    initial.background.solid.color = "#123456";
    const focused = applySceneEffectTemplate(initial, "dark");

    expect(focused.kind).toBe("focus_lines");
    expect(focused.dismissOnInput).toBe(false);
    expect(focused.focus.lineCount).toBeGreaterThan(0);
    expect(initial.background.solid.color).toBe("#123456");
    expect(validateSceneEffectDocument(focused, [])).toEqual([]);
  });

  it("preserves marquee ordering through explicit editor actions", () => {
    const document = createDefaultSceneEffectDocument();
    const reversed = [...document.background.marquee.items].reverse();
    const changed = sceneEffectEditorReducer(document, {
      type: "set-marquee-items",
      items: reversed,
    });

    expect(changed.background.marquee.items.map((item) => item.id)).toEqual(
      reversed.map((item) => item.id),
    );
  });

  it("preserves front-of-avatar placement in the isolated runtime entry", () => {
    const document = applySceneEffectTemplate(
      createDefaultSceneEffectDocument(),
      "dark",
    );
    document.focus.renderPlacement = "front_of_avatar";

    expect(sceneEffectRuntimeEntry(document, new Map())).toMatchObject({
      kind: "focus_lines",
      renderPlacement: "front_of_avatar",
      dismissOnInput: false,
    });
  });

  it("rejects out-of-bounds manual targets and URL-shaped imported items", () => {
    const focus = applySceneEffectTemplate(
      createDefaultSceneEffectDocument(),
      "dark",
    );
    focus.focus.target = {
      kind: "manual_box",
      rect: { x: 0.9, y: 0.1, width: 0.2, height: 0.5 },
    };
    expect(validateSceneEffectDocument(focus, [])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "focus.target", severity: "error" }),
      ]),
    );

    const forged = buildSceneEffectEditorExport(
      createDefaultSceneEffectDocument(),
    ) as unknown as {
      document: { background: { marquee: { items: unknown[] } } };
    };
    forged.document.background.marquee.items = [
      {
        id: "remote",
        kind: "png",
        label: "Remote",
        src: "https://example.test/tracker.png",
      },
    ];
    expect(() => parseSceneEffectEditorExport(forged)).toThrow();
  });

  it("pins an optional Sound Effect to its exact source", () => {
    const document = createDefaultSceneEffectDocument();
    document.sound = {
      alias: "on-apply",
      label: "Bright Idea",
      source: {
        type: "builtin",
        content_id: "sound_effect:bright-idea",
        version: 3,
      },
    };

    expect(sceneEffectDependencies(document)).toEqual([
      {
        alias: "on-apply",
        content_type: "sound_effect",
        source: document.sound.source,
        config: {},
      },
    ]);
    expect(sceneEffectDefinition(document)).toMatchObject({
      soundAlias: "on-apply",
    });
  });

  it("round-trips editor JSON without browser-local capabilities", () => {
    const document = createDefaultSceneEffectDocument();
    const encoded = JSON.stringify(buildSceneEffectEditorExport(document));

    expect(parseSceneEffectEditorExport(JSON.parse(encoded))).toEqual(document);
    expect(encoded).not.toContain("blob:");
    expect(encoded).not.toContain("download_url");
  });

  it("hydrates an exact portable Focus Lines release", () => {
    const source = applySceneEffectTemplate(
      createDefaultSceneEffectDocument(),
      "light-streak",
    );
    source.name = "Light Streak";
    source.description = "Exact release";

    const hydrated = createSceneEffectDocumentFromDefinition({
      name: source.name,
      description: source.description,
      definition: sceneEffectDefinition(source),
      images: new Map(),
      sound: null,
    });

    expect(hydrated).toMatchObject({
      kind: "focus_lines",
      name: "Light Streak",
      focus: { renderPlacement: source.focus.renderPlacement },
    });
  });

  it("uses canonical fingerprints and collision-safe webp names", () => {
    const left = createDefaultSceneEffectDocument();
    const right = structuredClone(left);

    expect(sceneEffectDocumentFingerprint(left)).toBe(
      sceneEffectDocumentFingerprint(right),
    );
    expect(canonicalSceneEffectImageName("../My Sparkle.JPEG")).toBe(
      "My-Sparkle.webp",
    );
    expect(
      uniqueSceneEffectImageName("My Sparkle.png", ["My-Sparkle.webp"]),
    ).toBe("My-Sparkle-2.webp");
  });
});
