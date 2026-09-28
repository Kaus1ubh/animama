import { describe, expect, it } from "vitest";
import type { PyTypedContentPreview } from "@animama/runtime-contracts/api-types";
import {
  typedActionPreview,
  typedIdleStylePreview,
} from "@/lib/content/typedPreviewAdapters";
import { actionPreviewTarget } from "./actionPreviewTarget";
import { idleStylePreviewTarget } from "./idleStylePreviewTarget";

function preview(kind: "vrma" | "anima_clip"): PyTypedContentPreview {
  const revision = "a".repeat(64);
  const base = {
    source: "local" as const,
    editable: true,
    revision_sha256: revision,
    dependencies: [],
    files: [],
  };
  const file = {
    file_ref: "motion",
    logical_path: "motion.json",
    filename: "motion.json",
    role: kind === "vrma" ? "animation" : "sequence",
    ordinal: 1,
    media_type: "application/json",
    sha256: revision,
    size_bytes: 30,
  };
  return {
    idle_playback: {
      "local:gesture:breathing": {
        eligible: true,
        cycle_seconds: 1,
        time_scale: 0.5,
        repetitions: 3,
        duration_seconds: 6,
        loop_type: "repeat",
      },
    },
    preview_id: "style-preview",
    revision_sha256: revision,
    expires_at: "2027-01-01T00:00:00Z",
    item: {
      ...base,
      kind: "idle_style",
      item_id: "style",
      logical_key: "local:idle_style:rest",
      name: "Rest",
      schema_version: 2,
      default_pool: ["local:gesture:breathing"],
      cells: {},
      dependencies: [{ kind: "gesture", ref: "local:gesture:breathing" }],
    },
    supports: [
      {
        ...base,
        kind: "gesture",
        item_id: "gesture",
        logical_key: "local:gesture:breathing",
        name: "Breathing",
        semantic_key: "breathing",
        implementation: { kind, file_role: file.role },
        config: { time_scale: 0.5, loop_count: 3 },
        files: [file],
        dependencies: [
          {
            kind: "sound_effect",
            ref: "local:sound_effect:bell",
            alias: "bell",
          },
        ],
      },
      {
        ...base,
        kind: "sound_effect",
        item_id: "bell",
        logical_key: "local:sound_effect:bell",
        name: "Bell",
        duration_seconds: 1,
        codec: "wav",
        defaults: {},
        files: [],
      },
    ],
    files: [{ ...file, url: "/preview/motion" }],
  };
}

describe("Idle Style previews", () => {
  it("resolves admitted locator refs for the Style member and its nested sound by item identity", () => {
    const input = preview("anima_clip");
    if (input.item.kind !== "idle_style")
      throw new Error("Style fixture is missing");
    input.item.default_pool = ["gestures/breathe"];
    input.item.dependencies = [
      { kind: "gesture", ref: "gestures/breathe", item_id: "gesture" },
    ];
    input.idle_playback = {
      "gestures/breathe": input.idle_playback!["local:gesture:breathing"]!,
    };
    const gesture = input.supports?.find((item) => item.kind === "gesture");
    if (!gesture) throw new Error("Gesture fixture is missing");
    gesture.dependencies = [
      {
        kind: "sound_effect",
        ref: "audio/bell",
        alias: "bell",
        item_id: "bell",
      },
    ];
    const target = idleStylePreviewTarget(typedIdleStylePreview(input), "Rest");
    expect(target.displayName).toBe("Breathing");
    expect(target.idlePlayback?.durationSeconds).toBe(6);
    expect(target.config).toMatchObject({
      runtime_reference_map: { bell: "bell" },
    });
    if (target.sourceType !== "resolved_action")
      throw new Error("Action target missing");
    expect(target.runtime.sfx.map((entry) => entry.runtime_id)).toEqual([
      "bell",
    ]);

    gesture.dependencies[0]!.item_id = "missing-bell";
    expect(() => typedIdleStylePreview(input)).toThrow(
      "dependency is unavailable",
    );
  });

  it.each(["vrma", "anima_clip"] as const)(
    "previews a draft pool's %s candidate with the exact response's finite clock",
    (kind) => {
      const input = preview(kind);
      const [gesture, ...supports] = input.supports ?? [];
      if (!gesture) throw new Error("Gesture fixture is missing");
      const candidate = { ...input, item: gesture, supports };
      const target = idleStylePreviewTarget(
        typedIdleStylePreview(candidate),
        gesture.name,
      );
      expect(target.idlePlayback).toEqual({
        timeScale: 0.5,
        repetitions: 3,
        durationSeconds: 6,
        loopType: "repeat",
      });
      expect(target.config).toMatchObject({
        runtime_reference_map: { bell: "bell" },
      });
      expect(
        actionPreviewTarget(typedActionPreview(candidate), gesture.name)
          .idlePlayback,
      ).toBeUndefined();
    },
  );

  it("refuses an ineligible candidate in the idle context while preserving ordinary Action preview", () => {
    const input = preview("anima_clip");
    const [gesture, ...supports] = input.supports ?? [];
    if (!gesture) throw new Error("Gesture fixture is missing");
    const candidate = { ...input, item: gesture, supports, idle_playback: {} };
    expect(() =>
      idleStylePreviewTarget(typedIdleStylePreview(candidate), gesture.name),
    ).toThrow("Finite idle playback is unavailable");
    expect(
      actionPreviewTarget(typedActionPreview(candidate), gesture.name).kind,
    ).toBe("anima_pose_clip");
  });

  it.each(["vrma", "anima_clip"] as const)(
    "previews a %s Gesture with its authored config and sound dependency",
    (kind) => {
      const target = idleStylePreviewTarget(
        typedIdleStylePreview(preview(kind)),
        "Rest",
      );
      expect(target.kind).toBe(
        kind === "vrma" ? "animation" : "anima_pose_clip",
      );
      expect(target.displayName).toBe("Breathing");
      expect(target.config).toMatchObject({
        time_scale: 0.5,
        loop_count: 3,
        runtime_reference_map: { bell: "bell" },
      });
      expect(target.sourceType).toBe("resolved_action");
      expect(target.idlePlayback).toEqual({
        timeScale: 0.5,
        repetitions: 3,
        durationSeconds: 6,
        loopType: "repeat",
      });
      if (target.sourceType === "resolved_action") {
        expect(target.runtime.sfx.map((entry) => entry.runtime_id)).toEqual([
          "bell",
        ]);
      }
    },
  );

  it("does not replace an empty Default with an arbitrary dependency", () => {
    const input = preview("vrma");
    if (input.item.kind === "idle_style") input.item.default_pool = [];
    expect(() => typedIdleStylePreview(input)).toThrow("No scheduled idle");
    expect(() =>
      typedIdleStylePreview(input, "local:gesture:not-in-style"),
    ).toThrow("unavailable");
  });
});
