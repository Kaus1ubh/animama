import { describe, expect, it } from "vitest";

import conversion from "@/lib/content/fixtures/avatar-effect-conversion.json";
import { resolveAvatarVFXAnimationConfig } from "./animation";
import {
  AvatarEffectDefinitionError,
  applyAvatarEffectOverride,
  parseAvatarEffectDefinition,
  parseAvatarEffectUse,
} from "./definition";
import type { AnimaPoseClipAvatarVFXOverride } from "../poses/animaPoseClip";
import v1Snapshot from "./fixtures/included-v1-runtime-entries.json";
import { isAttachmentVFXEntry, type AvatarVFXParsedEntry } from "./types";

type JsonObject = Record<string, unknown>;

/**
 * The Included effects as first converted to `/2` (the conversion fixture's
 * `included/*` pairs), which the `/1` snapshot describes. Later redrawn
 * Included content is checked by `includedVfxProjection.test.ts`.
 */
function includedDefinitions(): Map<string, JsonObject> {
  const snapshot = v1Snapshot.included as Record<string, JsonObject>;
  return new Map(
    conversion.pairs
      .filter((pair) => pair.name.startsWith("included/"))
      .map((pair) => {
        const name = pair.name.slice("included/".length);
        const entry = snapshot[name] ?? {};
        return [
          name,
          {
            content_id: entry.id,
            name: entry.label,
            description: entry.description,
            definition: pair.v2,
          },
        ];
      }),
  );
}

/**
 * The comparison form of a runtime entry. Intentional `/2` differences are
 * normalized here, and only here:
 * - `appearance` is new; converted effects carry the default (opaque, untinted,
 *   normal blend), which renders as `/1` did.
 * - Animation presets are compared after resolution: `/2` writes preset
 *   defaults explicitly where `/1` left them implied.
 * - An explicit `requiresMirror: false` is the same as no mirror; `/2` omits it.
 * - Numbers are compared to 1e-6, since rotations round-trip through degrees.
 */
function comparable(entry: AvatarVFXParsedEntry | JsonObject): JsonObject {
  const value = { ...(entry as JsonObject) };
  if (value.appearance !== undefined) {
    expect(value.appearance).toEqual({
      opacity: 1,
      tint: null,
      blend: "normal",
    });
    delete value.appearance;
  }
  if (value.requiresMirror === false) delete value.requiresMirror;
  value.animationConfig = resolveAvatarVFXAnimationConfig(
    value.animationConfig as Parameters<
      typeof resolveAvatarVFXAnimationConfig
    >[0],
  );
  return value;
}

function expectClose(actual: unknown, expected: unknown, path = "entry"): void {
  if (typeof expected === "number") {
    expect(typeof actual, path).toBe("number");
    expect(Math.abs((actual as number) - expected), path).toBeLessThan(1e-6);
    return;
  }
  if (expected && typeof expected === "object") {
    expect(actual && typeof actual === "object", path).toBe(true);
    const actualRecord = actual as JsonObject;
    const expectedRecord = expected as JsonObject;
    expect(Object.keys(actualRecord).sort(), path).toEqual(
      Object.keys(expectedRecord).sort(),
    );
    for (const key of Object.keys(expectedRecord)) {
      expectClose(actualRecord[key], expectedRecord[key], `${path}.${key}`);
    }
    return;
  }
  expect(actual, path).toEqual(expected);
}

describe("parseAvatarEffectDefinition", () => {
  it("parses each converted Included effect into the entry the /1 parser produced", () => {
    const included = includedDefinitions();
    const snapshot = v1Snapshot.included as Record<string, JsonObject>;
    expect([...included.keys()].sort()).toEqual(Object.keys(snapshot).sort());
    for (const [name, document] of included) {
      const definition = document.definition as JsonObject;
      const art = definition.art as JsonObject;
      const parsed = parseAvatarEffectDefinition(definition, {
        id: String(document.content_id),
        label: String(document.name),
        description: String(document.description),
        assetPath: `registered:${String(art.image)}`,
      });
      expectClose(comparable(parsed), comparable(snapshot[name]!), name);
    }
  });

  it("parses each converted creator kind into the entry the /1 parser produced", () => {
    const snapshot = v1Snapshot.creator as Record<string, JsonObject>;
    for (const [name, expected] of Object.entries(snapshot)) {
      const pair = conversion.pairs.find(
        (item) => item.name === `creator/${name}`,
      );
      expect(pair, name).toBeDefined();
      const parsed = parseAvatarEffectDefinition(pair!.v2, {
        id: `fixture:${name}`,
        label: name,
        description: name,
        assetPath: `registered:${String((pair!.v2 as JsonObject & { art: JsonObject }).art.image)}`,
      });
      expectClose(comparable(parsed), comparable(expected), name);
    }
  });

  it("refuses /1 with the conversion command and other schemas as invalid", () => {
    const context = {
      id: "x",
      label: "X",
      description: "X",
      assetPath: "blob:x",
    };
    const legacy = () =>
      parseAvatarEffectDefinition(conversion.pairs[0]!.v1, context);
    expect(legacy).toThrow(AvatarEffectDefinitionError);
    expect(legacy).toThrow(/content_cli/);
    try {
      legacy();
    } catch (error) {
      expect((error as AvatarEffectDefinitionError).code).toBe(
        "avatar_effect_conversion_required",
      );
    }
    expect(() =>
      parseAvatarEffectDefinition(
        { schema: "animama/avatar-effect/3" },
        context,
      ),
    ).toThrow(/unsupported schema/);
    expect(() =>
      parseAvatarEffectDefinition(
        { ...conversion.pairs[0]!.v2, appearance: { opacity: 3 } },
        context,
      ),
    ).toThrow(AvatarEffectDefinitionError);
  });

  it("maps appearance, other-eye art, flipbooks and keyframes", () => {
    const parsed = parseAvatarEffectDefinition(
      {
        schema: "animama/avatar-effect/2",
        region: "eyes",
        attachment: {
          kind: "face_landmark",
          landmark: "eyes",
          side: "right",
          mirror: true,
        },
        art: {
          image: "right.png",
          otherEyeImage: "left.png",
          flipbook: {
            columns: 4,
            rows: 2,
            frames: 6,
            fps: 12,
            loop: "pingpong",
          },
        },
        appearance: { opacity: 0.5, tint: "#ff8800", blend: "additive" },
        motion: {
          keyframes: {
            loop: true,
            frames: [
              { t: 0, opacity: 0, rotationDeg: 0 },
              {
                t: 1,
                opacity: 1,
                rotationDeg: 90,
                scale: 2,
                offset: { x: 0.1, y: 0 },
              },
            ],
          },
        },
      },
      {
        id: "eyes",
        label: "Eyes",
        description: "Eyes",
        assetPath: "blob:right",
        otherEyeAssetPath: "blob:left",
      },
    );
    expect(parsed).toMatchObject({
      kind: "hover",
      hoverKind: "eye_hover",
      side: "right",
      requiresMirror: true,
      otherEyeAssetPath: "blob:left",
      appearance: { opacity: 0.5, tint: "#ff8800", blend: "additive" },
      flipbook: { columns: 4, rows: 2, frames: 6, fps: 12, loop: "pingpong" },
      keyframes: { loop: true },
    });
    if (isAttachmentVFXEntry(parsed)) throw new Error("unexpected");
    expect(parsed.keyframes?.frames[1]?.rotation).toBeCloseTo(Math.PI / 2);
  });

  it("reads the API projection, which writes defaults and nulls", () => {
    // `AvatarEffectDefinitionV2.model_dump(mode="json")` of the converted
    // Included "eye".
    const projected = {
      schema: "animama/avatar-effect/2",
      region: "eyes",
      attachment: {
        kind: "face_landmark",
        landmark: "eyes",
        position: null,
        side: "right",
        mirror: true,
        offset: { x: 0.0, y: 0.0, z: 0.0 },
        scale: { x: 0.6, y: 0.6 },
        rotationDeg: { x: 0.0, y: 0.0, z: 0.0 },
      },
      art: { image: "eye_=_r.png", otherEyeImage: null, flipbook: null },
      appearance: { opacity: 1.0, tint: null, blend: "normal" },
      motion: { pulse: null, spin: null, drift: null, keyframes: null },
      faceOptions: {
        forceBlink: null,
        hideEyeDetails: null,
        faceCleanup: null,
        skinBackdrop: null,
        hideParts: ["eye_highlight"],
      },
      soundAlias: null,
    };
    const context = {
      id: "eye",
      label: "Eye",
      description: "Eye",
      assetPath: "x",
    };
    const stored = includedDefinitions().get("eye")!.definition;
    expect(parseAvatarEffectDefinition(projected, context)).toEqual(
      parseAvatarEffectDefinition(stored, context),
    );
  });

  it("refuses a flipbook with more frames than cells", () => {
    expect(() =>
      parseAvatarEffectDefinition(
        {
          ...conversion.pairs[0]!.v2,
          art: {
            image: "a.png",
            flipbook: { columns: 2, rows: 2, frames: 5, fps: 10 },
          },
        },
        { id: "x", label: "X", description: "X", assetPath: "blob:x" },
      ),
    ).toThrow(/flipbook/);
  });

  it("normalizes body, sticker and silhouette attachments with defaults", () => {
    const parse = (
      attachment: Record<string, unknown>,
      region: string,
      extra: Record<string, unknown> = {},
    ) =>
      parseAvatarEffectDefinition(
        {
          schema: "animama/avatar-effect/2",
          region,
          attachment,
          art: { image: "a.png" },
          ...extra,
        },
        { id: region, label: region, description: region, assetPath: "blob:a" },
      );
    expect(parse({ kind: "body", bone: "chest" }, "body")).toMatchObject({
      kind: "body",
      region: "body",
      bone: "chest",
      offset: { x: 0, y: 0, z: 0 },
      size: 0.2,
      facing: "camera",
      rotation: 0,
      appearance: { opacity: 1, tint: null, blend: "normal" },
    });
    expect(
      parse(
        {
          kind: "sticker",
          around: "body",
          offset: { x: 0.3, y: -0.1 },
          size: 0.4,
          rotationDeg: 90,
        },
        "sticker",
        { motion: { pulse: {} }, appearance: { opacity: 0.5 } },
      ),
    ).toMatchObject({
      kind: "sticker",
      around: "body",
      offset: { x: 0.3, y: -0.1 },
      size: 0.4,
      rotation: Math.PI / 2,
      animationConfig: { pulseCyclesPerSecond: 2 },
      appearance: { opacity: 0.5 },
    });
    expect(
      parse({ kind: "silhouette", fill: "tint" }, "silhouette", {
        art: {
          image: "a.png",
          flipbook: { columns: 2, rows: 1, frames: 2, fps: 8 },
        },
      }),
    ).toMatchObject({
      kind: "silhouette",
      fill: "tint",
      patternScale: 1,
      scroll: { x: 0, y: 0 },
      flipbook: { columns: 2, rows: 1, frames: 2, fps: 8, loop: "loop" },
    });
  });

  it("refuses an attachment whose region belongs to another attachment", () => {
    expect(() =>
      parseAvatarEffectDefinition(
        {
          schema: "animama/avatar-effect/2",
          region: "sticker",
          attachment: { kind: "body", bone: "head" },
          art: { image: "a.png" },
        },
        { id: "x", label: "X", description: "X", assetPath: "blob:x" },
      ),
    ).toThrow(AvatarEffectDefinitionError);
  });
});

describe("per-use Avatar Effect overrides", () => {
  const star = {
    schema: "animama/avatar-effect/2",
    region: "body",
    attachment: { kind: "body", bone: "head", offset: { x: 0.1 }, size: 0.1 },
    art: { image: "star.png" },
    appearance: { opacity: 0.8 },
    motion: { pulse: { scaleMin: 0.9, scaleMax: 1.1 } },
    soundAlias: "bell",
  };
  const context = {
    id: "kira_star",
    label: "Kira Star",
    description: "A star.",
    assetPath: "blob:star",
    sound: { onApply: "bell-cue" },
  };
  const cues: Record<string, string> = { bell: "bell-cue", tehe: "tehe-cue" };
  const soundCue = (alias: string) => cues[alias];

  it("replaces each part the override sets, whole", () => {
    const merged = applyAvatarEffectOverride(star, {
      attachment: { kind: "body", bone: "leftHand", size: 0.08 },
      motion: {},
    });
    expect(merged.attachment).toEqual({
      kind: "body",
      bone: "leftHand",
      size: 0.08,
    });
    expect(merged.motion).toEqual({});
    expect(merged.appearance?.opacity).toBe(0.8);
    expect(merged.soundAlias).toBe("bell");
  });

  it.each([
    [
      "body",
      { kind: "body", bone: "head" },
      { kind: "body", bone: "rightHand", facing: "bone" },
      { kind: "body", bone: "rightHand", facing: "bone" },
      "body",
    ],
    [
      "face_surface",
      { kind: "face_surface", part: "face_skin", area: "full" },
      {
        kind: "face_surface",
        part: "face_skin",
        area: "full",
        mode: "replace",
      },
      { kind: "texture", applyMode: "replace" },
      "full_face",
    ],
    [
      "face_landmark",
      { kind: "face_landmark", landmark: "mouth" },
      { kind: "face_landmark", landmark: "top", position: "left" },
      { kind: "hover", hoverKind: "box_hover", placement: "top-left" },
      "emote",
    ],
    [
      "sticker",
      { kind: "sticker" },
      { kind: "sticker", around: "body", size: 0.1 },
      { kind: "sticker", around: "body", size: 0.1 },
      "sticker",
    ],
    [
      "silhouette",
      { kind: "silhouette" },
      { kind: "silhouette", fill: "tint" },
      { kind: "silhouette", fill: "tint" },
      "silhouette",
    ],
  ])(
    "places, styles and moves a %s use by its override",
    (_, attachment, overridden, expected, region) => {
      const entry = parseAvatarEffectUse(
        {
          schema: "animama/avatar-effect/2",
          region,
          attachment,
          art: { image: "art.png" },
        },
        {
          attachment:
            overridden as AnimaPoseClipAvatarVFXOverride["attachment"],
          appearance: { opacity: 0.4 },
          motion: { spin: { degreesPerSecond: 90 } },
        },
        context,
      );
      expect(entry).toMatchObject({
        ...expected,
        appearance: { opacity: 0.4 },
      });
      expect(entry.animationConfig?.rotationRadiansPerSecond).toBeCloseTo(
        Math.PI / 2,
      );
    },
  );

  it.each([
    [
      "moves mirrored other-eye art off the eyes",
      { kind: "face_landmark", landmark: "top", position: "middle" },
    ],
    [
      "drops the mirror the other-eye art needs",
      { kind: "face_landmark", landmark: "eyes", side: "left" },
    ],
  ])("refuses an override that %s", (_, attachment) => {
    const eyes = {
      schema: "animama/avatar-effect/2",
      region: "eyes",
      attachment: {
        kind: "face_landmark",
        landmark: "eyes",
        side: "right",
        mirror: true,
      },
      art: { image: "right.png", otherEyeImage: "left.png" },
      faceOptions: { forceBlink: true },
    };
    expect(() =>
      applyAvatarEffectOverride(eyes, {
        attachment: attachment as AnimaPoseClipAvatarVFXOverride["attachment"],
      }),
    ).toThrow(expect.objectContaining({ field: "override.attachment" }));
  });

  it("refuses an override whose placement the effect's face options do not fit", () => {
    expect(() =>
      applyAvatarEffectOverride(
        {
          schema: "animama/avatar-effect/2",
          region: "eyes",
          attachment: { kind: "face_landmark", landmark: "eyes" },
          art: { image: "eye.png" },
          faceOptions: { forceBlink: true },
        },
        { attachment: { kind: "face_landmark", landmark: "mouth" } },
      ),
    ).toThrow(/forceBlink/);
  });

  it("refuses an override that changes the attachment kind", () => {
    expect(() =>
      applyAvatarEffectOverride(star, { attachment: { kind: "sticker" } }),
    ).toThrow(
      expect.objectContaining({
        code: "avatar_effect_definition_invalid",
        field: "override.attachment.kind",
      }),
    );
  });

  it("parses the use with its own placement and the sound it picks", () => {
    const entry = parseAvatarEffectUse(
      star,
      {
        attachment: { kind: "body", bone: "leftHand", size: 0.08 },
        soundAlias: "tehe",
      },
      context,
      soundCue,
    );
    expect(entry).toMatchObject({
      id: "kira_star",
      kind: "body",
      bone: "leftHand",
      size: 0.08,
      offset: { x: 0, y: 0, z: 0 },
      sound: { onApply: "tehe-cue" },
    });
  });

  it("keeps the effect's resolved sound when the use names the effect's own", () => {
    expect(
      parseAvatarEffectUse(
        star,
        { soundAlias: "bell" },
        context,
        () => undefined,
      ).sound,
    ).toEqual({ onApply: "bell-cue" });
  });

  it("keeps the effect's sound unless the use picks another, and an unknown one is silent", () => {
    const appearance = { appearance: { opacity: 0.5 } };
    expect(
      parseAvatarEffectUse(star, appearance, context, soundCue).sound,
    ).toEqual({ onApply: "bell-cue" });
    expect(
      parseAvatarEffectUse(star, { soundAlias: "missing" }, context, soundCue)
        .sound,
    ).toBeUndefined();
  });
});
