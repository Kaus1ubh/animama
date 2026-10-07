import { describe, expect, it } from "vitest";

import { AVATAR_POSE_CATALOG } from "@/lib/avatar/poses/catalog";
import { parseAvatarEffectDefinition } from "@/lib/avatar/vfx/definition";
import { isAttachmentVFXEntry } from "@/lib/avatar/vfx/types";
import {
  avatarEffectDefinition,
  createAvatarEffectDocumentFromDefinition,
} from "@/lib/avatar/vfx/editor";
import { parseSceneVFXEntry } from "@/lib/scene-vfx/catalog";
import fixture from "./fixtures/package-capabilities.json";

describe("portable package renderer capabilities", () => {
  it("keeps the closed backend Pose capability inventory aligned with runtime", () => {
    expect(Object.keys(AVATAR_POSE_CATALOG).sort()).toEqual(
      fixture.builtinPoses,
    );
  });

  it.each(fixture.effects.filter((effect) => effect.kind === "avatar_effect"))(
    "matches what the Avatar Effect creator writes for $name",
    (effect) => {
      const definition = structuredClone(effect.definition) as Record<
        string,
        unknown
      >;
      const document = createAvatarEffectDocumentFromDefinition({
        name: effect.name,
        description: "",
        definition,
        image: {
          logicalName: String((definition.art as { image: string }).image),
          originalName: String((definition.art as { image: string }).image),
          contentType: "image/png",
          sizeBytes: 1,
          sha256: null,
        },
        sound: null,
      });
      // The backend export and Save validators accept exactly these fields.
      expect(avatarEffectDefinition(document)).toEqual(definition);
    },
  );

  it.each(fixture.effects)(
    "parses the shared $name primitive without kind fallback",
    (effect) => {
      const definition = structuredClone(effect.definition);
      if (effect.kind === "avatar_effect") {
        const parsed = parseAvatarEffectDefinition(definition, {
          id: "package-fixture",
          label: effect.name,
          description: "Shared backend compatibility fixture",
          assetPath: "blob:verified-package-resource",
        });
        // Every shared fixture is a face effect.
        expect(isAttachmentVFXEntry(parsed)).toBe(false);
        return;
      }
      const runtime = definition as Record<string, unknown>;
      if (definition.kind === "background_layers") {
        const marquee = runtime.marquee as { items: Record<string, unknown>[] };
        marquee.items = marquee.items.map((item) => ({
          id: item.id,
          label: item.label,
          kind: "png",
          src: "blob:verified-package-resource",
        }));
      }
      const parsed = parseSceneVFXEntry({
        ...runtime,
        id: "package-fixture",
        label: effect.name,
        enabled: true,
      });
      expect(parsed.kind).toBe(definition.kind);
    },
  );
});
