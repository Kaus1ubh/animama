import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { validateAnimaPoseClipV2 } from "@/lib/avatar/poses/animaPoseClip/schemaV2";
import { POSE_CREATOR_CLIP_VALIDATION_OPTIONS } from "@/stores/pose-creator-store";
import { createPoseCreatorClipDraftFromAnimaPoseClip } from "@/ui/pose-creator/poseCreatorClipAuthoring";
import { actionSequenceFromTimelineDraft } from "./actionPersistence";

const includedRoot = fileURLToPath(
  new URL("../../../../../../content/included/", import.meta.url),
);

type Meta = {
  implementation?: { kind?: string };
  files?: { path: string; role: string }[];
};

/** Every Included Gesture and Reaction clip, as `[kind, name, sequence]`. */
function includedClips(folder: "gestures" | "reactions") {
  return readdirSync(`${includedRoot}${folder}`)
    .sort()
    .flatMap((name) => {
      const dir = `${includedRoot}${folder}/${name}`;
      const meta = JSON.parse(
        readFileSync(`${dir}/${name}.meta.json`, "utf8"),
      ) as Meta;
      const file = meta.files?.find(({ role }) => role === "sequence");
      if (meta.implementation?.kind !== "anima_clip" || !file) return [];
      return [
        [name, JSON.parse(readFileSync(`${dir}/${file.path}`, "utf8"))] as [
          string,
          unknown,
        ],
      ];
    });
}

describe.each([
  ["gestures", "gesture"],
  ["reactions", "reaction"],
] as const)("Included %s open as 2.0 beats", (folder, intent) => {
  const clips = includedClips(folder);

  it("finds the Included clips", () => {
    expect(clips.length).toBeGreaterThan(0);
  });

  it.each(clips)("%s opens and saves as 2.0", (_name, sequence) => {
    const draft = createPoseCreatorClipDraftFromAnimaPoseClip(sequence, {
      ...POSE_CREATOR_CLIP_VALIDATION_OPTIONS,
      fallbackBasePose: "",
    });
    expect(draft.motion?.beats.length).toBe(draft.keyframes.length);
    expect(
      draft.validationIssues.filter(({ severity }) => severity === "error"),
    ).toEqual([]);
    const saved = actionSequenceFromTimelineDraft(draft, intent);
    expect(saved?.schema).toBe("animaPoseClip/2.0");
    expect(validateAnimaPoseClipV2(saved).ok).toBe(true);
  });
});
