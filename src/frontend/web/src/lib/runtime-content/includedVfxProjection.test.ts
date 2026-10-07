import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parseAvatarEffectDefinition } from "@/lib/avatar/vfx/definition";
import { parseSceneVFXEntry } from "@/lib/scene-vfx/catalog";

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
      expect(parsed.kind).not.toBe("deferred_attachment");
    }
  });

  it("parses every Scene Effect after replacing registered marquee images", () => {
    const documents = objectsAt(resolve(INCLUDED_VFX, "scene"));

    for (const document of documents) {
      const definition = object(structuredClone(document.definition));
      const marquee =
        definition.marquee === undefined ? null : object(definition.marquee);
      const items = Array.isArray(marquee?.items) ? marquee.items : [];
      const referencedImages = new Set<string>();
      if (marquee) {
        marquee.items = items.map((rawItem) => {
          const item = object(rawItem);
          if (item.kind !== "image") return item;
          if (typeof item.image !== "string") {
            throw new Error(
              "Scene image item is missing its logical filename.",
            );
          }
          referencedImages.add(item.image);
          return {
            id: item.id,
            kind: "png",
            label: item.label,
            src: "blob:registered-image",
          };
        });
      }
      const files = (document.files as JsonObject[] | undefined) ?? [];
      expect(new Set(files.map((file) => file.path))).toEqual(referencedImages);

      expect(() =>
        parseSceneVFXEntry({
          ...definition,
          id: document.content_id,
          label: document.name,
          enabled: true,
          ...(typeof definition.soundAlias === "string"
            ? { sound: { onApply: "registered-sound" } }
            : {}),
        }),
      ).not.toThrow();
    }
  });
});
