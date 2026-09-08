import { afterEach, describe, expect, it, vi } from "vitest";

import { createDefaultSceneEffectDocument } from "./defaults";
import {
  clearSceneEffectRecovery,
  loadSceneEffectRecovery,
  saveSceneEffectRecovery,
  SCENE_EFFECT_RECOVERY_SCHEMA,
} from "./recovery";

afterEach(() => vi.unstubAllGlobals());

describe("Scene Effect recovery", () => {
  it("falls back to metadata-only storage while retaining save identity", async () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      indexedDB: undefined,
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });
    const document = createDefaultSceneEffectDocument();
    document.background.marquee.items.push({
      id: "private-image",
      kind: "image",
      label: "Private image",
      image: {
        logicalName: "private.webp",
        originalName: "private.png",
        contentType: "image/png",
        sizeBytes: 7,
        sha256: "a".repeat(64),
      },
    });

    const result = await saveSceneEffectRecovery({
      schema: SCENE_EFFECT_RECOVERY_SCHEMA,
      userId: "user-1",
      documentKey: "item-1",
      operationId: "operation-1",
      document,
      imageResources: [
        {
          logicalName: "private.webp",
          file: new File(["private"], "private.png", { type: "image/png" }),
          sha256: "a".repeat(64),
        },
      ],
      contentFingerprint: "fingerprint",
      updatedAt: "2026-08-17T00:00:00.000Z",
    });
    const restored = await loadSceneEffectRecovery("user-1", "item-1");

    expect(result).toMatchObject({ stored: true, metadataOnly: true });
    expect(result.warning).toContain("Reselect private images");
    expect(restored).toMatchObject({
      operationId: "operation-1",
      imageResources: [],
    });

    await clearSceneEffectRecovery("user-1", "item-1");
    expect(await loadSceneEffectRecovery("user-1", "item-1")).toBeNull();
  });
});
