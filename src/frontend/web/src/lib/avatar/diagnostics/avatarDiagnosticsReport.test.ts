import { describe, expect, it, vi } from "vitest";

import { readTestAvatarBytes } from "../motion-authoring/testing/includedAvatars";
import { loadedTestAvatar } from "../testing/loadedTestAvatar";
import { readAvatarFileFacts } from "./avatarFileFacts";
import {
  AVATAR_DIAGNOSTICS_SCHEMA,
  automaticMaterialsLine,
  avatarDiagnosticsJson,
  avatarDiagnosticsText,
  buildAvatarDiagnosticsReport,
} from "./avatarDiagnosticsReport";

/** Every name the file itself carries: meta, nodes, meshes, materials, images. */
function namesInFile(bytes: ArrayBuffer): string[] {
  const view = new DataView(bytes);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(
    new TextDecoder().decode(new Uint8Array(bytes, 20, jsonLength)),
  ) as Record<string, unknown>;
  const names: string[] = [];
  for (const key of ["nodes", "meshes", "materials", "images", "textures"]) {
    for (const item of (json[key] as { name?: string }[] | undefined) ?? []) {
      if (item.name) names.push(item.name);
    }
  }
  const meta = (
    json.extensions as { VRMC_vrm?: { meta?: Record<string, unknown> } }
  ).VRMC_vrm?.meta;
  if (typeof meta?.name === "string") names.push(meta.name);
  for (const author of (meta?.authors as string[] | undefined) ?? []) {
    names.push(author);
  }
  // Short or generic names ("Face", "Body") also appear as ordinary words.
  return names.filter((name) => name.length >= 8);
}

async function includedReport(id: "Andrew" | "AvatarSample_A_1_New") {
  vi.spyOn(console, "info").mockImplementation(() => {});
  const bytes = await readTestAvatarBytes(id);
  const avatar = await loadedTestAvatar(id);
  return {
    bytes,
    report: buildAvatarDiagnosticsReport({
      avatar: { source: "included", itemId: "item-1" },
      file: readAvatarFileFacts(bytes),
      live: avatar.getDiagnostics(),
      issues: [{ code: "face_parts_correction_invalid" }],
    }),
  };
}

describe("Avatar diagnostics reports", () => {
  it.each(["Andrew", "AvatarSample_A_1_New"] as const)(
    "hold no paths, URLs or names from %s's file",
    async (id) => {
      const { bytes, report } = await includedReport(id);
      const names = namesInFile(bytes);
      expect(names.length).toBeGreaterThan(0);
      for (const text of [
        avatarDiagnosticsJson(report),
        avatarDiagnosticsText(report),
      ]) {
        expect(text).not.toMatch(/https?:|blob:|file:|data:/);
        expect(text).not.toMatch(/\.(vrm|glb|gltf|png|jpe?g|webp)\b/i);
        expect(text).not.toMatch(/[A-Za-z]:\\|\/(Users|home|private)\//);
        for (const name of names) expect(text).not.toContain(name);
      }
    },
  );

  it("identify the Avatar by source and item id, and list every finding", async () => {
    const { report } = await includedReport("Andrew");
    expect(report).toMatchObject({
      schema: AVATAR_DIAGNOSTICS_SCHEMA,
      avatar: { source: "included", itemId: "item-1" },
      status: "loaded",
      issues: [{ code: "face_parts_correction_invalid" }],
    });
    expect(report.live).not.toHaveProperty("issues");
    const text = avatarDiagnosticsText(report);
    for (const heading of [
      "File",
      "Face",
      "Expressions",
      "Motion",
      "Warnings",
    ]) {
      expect(text).toContain(`\n${heading}\n`);
    }
    expect(text).toContain("  - face_parts_correction_invalid");
    expect(JSON.parse(avatarDiagnosticsJson(report))).toEqual(report);
  });

  it("name effects by reference, never by a runtime id built from a name", () => {
    const report = buildAvatarDiagnosticsReport({
      avatar: { source: "local", itemId: "item-2" },
      file: null,
      live: null,
      issues: [
        {
          code: "effect_face_part_missing",
          params: { effectId: "ray-secret-blush", part: "eyelash" },
        },
        { code: "effect_load_failed", params: { effectId: "other-blush" } },
        { code: "effect_unknown", params: { effectId: "typed-by-hand" } },
      ],
      effectReference: (id) =>
        id === "typed-by-hand" ? undefined : "local:item-fx",
    });
    expect(report.issues).toEqual([
      {
        code: "effect_face_part_missing",
        params: { part: "eyelash", effect: "local:item-fx" },
      },
      { code: "effect_load_failed", params: { effect: "local:item-fx" } },
      { code: "effect_unknown", params: { effect: "unlisted" } },
    ]);
    for (const text of [
      avatarDiagnosticsJson(report),
      avatarDiagnosticsText(report),
    ]) {
      expect(text).not.toMatch(/blush|typed-by-hand/);
    }
  });

  it("describe an Avatar that did not load by its file facts", async () => {
    const report = buildAvatarDiagnosticsReport({
      avatar: { source: "local", itemId: "item-2" },
      file: readAvatarFileFacts(await readTestAvatarBytes("Andrew")),
      live: null,
      issues: [{ code: "avatar_load_failed" }],
    });
    expect(report).toMatchObject({ status: "failed", live: null });
    const text = avatarDiagnosticsText(report);
    expect(text).toContain("Format: GLB, VRM 1.0");
    expect(text).toContain("Live Avatar\n  Not loaded");
    expect(text).toContain("  - avatar_load_failed");
  });
});

describe("automaticMaterialsLine", () => {
  const decision = {
    frameMs: null,
    pixels: null,
    thresholdMs: 8,
  } as const;

  it("states the measured time, the threshold and the choice", () => {
    expect(
      automaticMaterialsLine({
        ...decision,
        choice: "simple",
        reason: "slow",
        frameMs: 9.64,
        pixels: 1_920_000,
      }),
    ).toBe(
      "Automatic chose Simple: a lilToon frame took 9.6 ms of GPU time on this GPU (1920000 pixels), above the 8.0 ms threshold",
    );
    expect(
      automaticMaterialsLine({
        ...decision,
        choice: "liltoon",
        reason: "fast",
        frameMs: 5.2,
        pixels: 1_920_000,
      }),
    ).toBe(
      "Automatic chose lilToon: a lilToon frame took 5.2 ms of GPU time on this GPU (1920000 pixels), within the 8.0 ms threshold",
    );
  });

  it("says when the GPU is not measured or cannot be timed", () => {
    expect(
      automaticMaterialsLine({
        ...decision,
        choice: "liltoon",
        reason: "not_measured",
      }),
    ).toBe(
      "Automatic chose lilToon: this GPU's lilToon frame time is not measured yet (threshold 8.0 ms)",
    );
    expect(
      automaticMaterialsLine({
        ...decision,
        choice: "liltoon",
        reason: "unsupported",
      }),
    ).toBe(
      "Automatic chose lilToon: this browser cannot time the GPU (threshold 8.0 ms)",
    );
  });
});
