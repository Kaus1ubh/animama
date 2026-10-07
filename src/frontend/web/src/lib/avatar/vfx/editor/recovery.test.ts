import { afterEach, describe, expect, it, vi } from "vitest";

import { createDefaultAvatarEffectDocument } from "./defaults";
import {
  AVATAR_EFFECT_RECOVERY_SCHEMA,
  avatarEffectRecoveryStore,
} from "./recovery";

afterEach(() => vi.unstubAllGlobals());

describe("Avatar Effect recovery", () => {
  it("falls back to metadata-only local storage without losing save identity", async () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      indexedDB: undefined,
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });
    const document = createDefaultAvatarEffectDocument();
    document.image = {
      logicalName: "effect.webp",
      originalName: "effect.webp",
      contentType: "image/webp",
      sizeBytes: 24,
      sha256: "a".repeat(64),
    };

    const result = await avatarEffectRecoveryStore.save({
      schema: AVATAR_EFFECT_RECOVERY_SCHEMA,
      userId: "user-1",
      documentKey: "item-1",
      operationId: "operation-1",
      document,
      imageResource: null,
      contentFingerprint: "fingerprint",
      updatedAt: "2026-08-17T00:00:00.000Z",
    });
    const restored = await avatarEffectRecoveryStore.load("user-1", "item-1");

    expect(result).toMatchObject({ stored: true, metadataOnly: true });
    expect(restored).toMatchObject({
      operationId: "operation-1",
      imageResource: null,
    });

    await avatarEffectRecoveryStore.clear("user-1", "item-1");
    expect(await avatarEffectRecoveryStore.load("user-1", "item-1")).toBeNull();
  });
});
