import { afterEach, describe, expect, it, vi } from "vitest";

import { createDefaultAvatarEffectDocument } from "./defaults";
import {
  AVATAR_EFFECT_RECOVERY_SCHEMA,
  avatarEffectRecoveryStore,
} from "./recovery";

afterEach(() => vi.unstubAllGlobals());

function stubLocalStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  vi.stubGlobal("window", {
    indexedDB: undefined,
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  return values;
}

const record = {
  schema: AVATAR_EFFECT_RECOVERY_SCHEMA,
  userId: "user-1",
  documentKey: "item-1",
  operationId: "operation-1",
  contentFingerprint: "fingerprint",
  updatedAt: "2026-08-17T00:00:00.000Z",
};

describe("Avatar Effect recovery", () => {
  it("falls back to metadata-only local storage without losing save identity", async () => {
    stubLocalStorage();
    const document = createDefaultAvatarEffectDocument();
    document.art.image = {
      logicalName: "effect.webp",
      originalName: "effect.webp",
      contentType: "image/webp",
      sizeBytes: 24,
      sha256: "a".repeat(64),
    };

    const result = await avatarEffectRecoveryStore.save({
      ...record,
      document,
      imageResource: null,
      otherEyeImageResource: null,
    });
    const restored = await avatarEffectRecoveryStore.load("user-1", "item-1");

    expect(result).toMatchObject({ stored: true, metadataOnly: true });
    expect(result.warning).toContain("Reselect the image");
    expect(restored).toMatchObject({
      operationId: "operation-1",
      imageResource: null,
      otherEyeImageResource: null,
      document: { art: { image: { logicalName: "effect.webp" } } },
    });
    expect(restored).not.toHaveProperty("dropped");

    await avatarEffectRecoveryStore.clear("user-1", "item-1");
    expect(await avatarEffectRecoveryStore.load("user-1", "item-1")).toBeNull();
  });

  it("marks a draft in the earlier editor format as dropped", async () => {
    stubLocalStorage({
      "anima.avatarEffectCreator.recovery.v1:user-1:item-1": JSON.stringify({
        ...record,
        document: {
          schema: "animama/avatar-effect-editor/1",
          name: "Old draft",
          kind: "hover",
        },
        imageResource: null,
      }),
    });

    const restored = await avatarEffectRecoveryStore.load("user-1", "item-1");

    expect(restored).toMatchObject({
      dropped: "old_editor_format",
      operationId: "operation-1",
      document: createDefaultAvatarEffectDocument(),
    });
  });

  it("ignores records of an unknown editor format", async () => {
    stubLocalStorage({
      "anima.avatarEffectCreator.recovery.v1:user-1:item-1": JSON.stringify({
        ...record,
        document: { schema: "animama/avatar-effect-editor/9" },
      }),
    });
    expect(await avatarEffectRecoveryStore.load("user-1", "item-1")).toBeNull();
  });
});
