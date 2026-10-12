import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parseAvatarEffectDefinition } from "@/lib/avatar/vfx/definition";
import { isAttachmentVFXEntry } from "@/lib/avatar/vfx/types";
import { sceneEntryFromDefinition } from "@/lib/scene-vfx/sceneDefinition";

type JsonObject = Record<string, unknown>;

const INCLUDED_VFX = resolve(process.cwd(), "../../../content/included/vfx");

function objectsAt(directory: string): JsonObject[] {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(directory, entry.name, `${entry.name}.json`))
    .filter((path) => existsSync(path))
    .map((path) => JSON.parse(readFileSync(path, "utf8")));
}

function object(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected an object in an Included VFX descriptor.");
  }
  return value as JsonObject;
}

describe("Included typed VFX runtime projection", () => {
  it("parses every Avatar Effect as /2 with its registered images", () => {
    const documents = objectsAt(resolve(INCLUDED_VFX, "avatar"));

    for (const document of documents) {
      const definition = object(structuredClone(document.definition));
      const art = object(definition.art);
      const files = (document.files as JsonObject[] | undefined) ?? [];
      expect(definition.schema).toBe("animama/avatar-effect/2");
      expect(files.map((file) => file.path)).toEqual(
        [art.image, art.otherEyeImage].filter(Boolean),
      );

      const parsed = parseAvatarEffectDefinition(definition, {
        id: String(document.content_id),
        label: String(document.name),
        description: String(document.description),
        assetPath: "blob:registered-image",
        ...(typeof art.otherEyeImage === "string"
          ? { otherEyeAssetPath: "blob:registered-other-eye" }
          : {}),
        ...(typeof definition.soundAlias === "string"
          ? { sound: { onApply: "registered-sound" } }
          : {}),
      });
      // Body, sticker and silhouette effects are attachment entries; the
      // rest are face effects.
      const attachment = object(definition.attachment);
      expect(isAttachmentVFXEntry(parsed)).toBe(
        ["body", "sticker", "silhouette"].includes(String(attachment.kind)),
      );
    }
  });

  it("projects every Scene Effect with exactly its registered images", () => {
    const documents = objectsAt(resolve(INCLUDED_VFX, "scene"));

    for (const document of documents) {
      const definition = object(structuredClone(document.definition));
      const { entry, referencedImages } = sceneEntryFromDefinition(
        definition,
        { id: String(document.content_id), label: String(document.name) },
        () => "blob:registered-image",
        typeof definition.soundAlias === "string"
          ? { sound: { onApply: "registered-sound" } }
          : {},
      );
      const files = (document.files as JsonObject[] | undefined) ?? [];
      expect(new Set(files.map((file) => file.path))).toEqual(referencedImages);
      expect(entry.kind).toBe(definition.kind);
    }
  });
});
