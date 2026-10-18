import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { EffectSource } from "@/lib/avatar/vfx/effectSource";
import { editAvatarEffectUse } from "@/ui/pose-creator/avatarEffectUse";

import { planTuneSave } from "../scripts/content-tune-save.mjs";
import { placementSource } from "../scripts/content-tune/placement";
import type { TuneSound } from "../scripts/content-tune/model";

const includedRoot = fileURLToPath(
  new URL("../../../../content/included", import.meta.url),
);

/** An Included Avatar Effect as the tuning page's preview media serves it. */
function includedEffect(stem: string): EffectSource {
  const descriptor = JSON.parse(
    readFileSync(
      path.join(includedRoot, "vfx/avatar", stem, `${stem}.json`),
      "utf8",
    ),
  );
  const soundCueIds = Object.fromEntries(
    (descriptor.dependencies ?? []).map(
      (edge: { alias: string; ref: string }) => [edge.alias, edge.ref],
    ),
  );
  return {
    stem,
    contentId: descriptor.content_id,
    name: descriptor.name,
    description: descriptor.description ?? "",
    definition: descriptor.definition,
    imageUrl: "",
    otherImageUrl: null,
    soundCueIds,
  };
}

describe("content tuning placement", () => {
  it("places an Avatar Effect for one use and saves the override", () => {
    const effect = includedEffect("sweat_drop");
    const ref = Object.values(effect.soundCueIds ?? {})[0];
    const sounds = new Map<string, TuneSound>(
      ref
        ? [
            [
              ref,
              {
                key: "k",
                ref,
                name: "Sweat",
                description: null,
                duration: null,
                category: "Pack",
                shipped: true,
                available: true,
              },
            ],
          ]
        : [],
    );
    const source = placementSource(effect, sounds);
    expect(source).not.toBeNull();
    if (ref)
      expect(source!.sounds.map((sound) => sound.label)).toContain("Sweat");

    // The section's size control, as the Action creator applies it.
    const edit = editAvatarEffectUse(source!.definition, undefined, {
      action: { type: "patch-attachment", patch: { size: 0.123 } },
    });
    expect("override" in edit && edit.override).toBeTruthy();
    const override = "override" in edit ? edit.override : undefined;

    const event = {
      id: "sweat",
      time: 0.2,
      kind: "avatar_vfx",
      effectId: "sweat",
      override,
    };
    const plan = planTuneSave(
      {
        kind: "gesture",
        contentId: "builtin:gesture:probe",
        revision: "r",
        meta: { content_id: "builtin:gesture:probe", dependencies: [] },
        clip: { schema: "animaPoseClip/2.0", id: "probe", duration: 1 },
      },
      {
        revision: "r",
        events: [event],
        dependencies: [
          {
            ref: effect.contentId,
            alias: "sweat",
            content_type: "avatar_effect",
          },
        ],
      },
      {
        includedTypes: new Map([[effect.contentId, "avatar_effect"]]),
        packSounds: new Set(),
        shipped: new Set(),
        idleKeys: new Set(),
      },
    );
    expect(plan.clip.events[0].override).toEqual(override);
    expect(
      (plan.clip.events[0].override as { attachment: { size: number } })
        .attachment.size,
    ).toBe(0.123);
  });

  it("lists a merged effect's sounds with its own sound first", () => {
    const effect = includedEffect("heart_pop");
    const source = placementSource(effect, new Map());
    expect(source!.sounds.length).toBeGreaterThan(1);
    expect(source!.sounds[0].alias).toBe(
      (effect.definition as { soundAlias?: string }).soundAlias,
    );
  });

  it("refuses an effect whose definition isn't a valid /2 one", () => {
    const effect = { ...includedEffect("sweat_drop"), definition: {} };
    expect(placementSource(effect, new Map())).toBeNull();
  });
});
