import { describe, expect, it } from "vitest";

import { AVATAR_POSE_CATALOG } from "@/lib/avatar/poses/catalog";
import { parseAvatarVFXCatalogEntry } from "@/lib/avatar/vfx/catalog";
import { parseSceneVFXEntry } from "@/lib/scene-vfx/catalog";
import fixture from "./fixtures/package-capabilities.json";

describe("portable package renderer capabilities", () => {
  it("keeps the closed backend Pose capability inventory aligned with runtime", () => {
    expect(Object.keys(AVATAR_POSE_CATALOG).sort()).toEqual(
      fixture.builtinPoses,
    );
  });

  it.each(fixture.effects)(
    "parses the shared $name primitive without kind fallback",
    (effect) => {
      const definition = structuredClone(effect.definition);
      if (effect.kind === "avatar_effect") {
        const parsed = parseAvatarVFXCatalogEntry({
          ...definition,
          id: "package-fixture",
          label: effect.name,
          description: "Shared backend compatibility fixture",
          assetPath: "blob:verified-package-resource",
        });
        expect(parsed.kind).toBe(definition.kind);
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
