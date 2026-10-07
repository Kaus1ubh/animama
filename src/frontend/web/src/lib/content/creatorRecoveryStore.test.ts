import { afterEach, describe, expect, it, vi } from "vitest";

import { createParticleVFXEditorDraftFromBlank } from "@/lib/avatar/particle-vfx";
import {
  AVATAR_EFFECT_RECOVERY_SCHEMA,
  avatarEffectRecoveryStore,
  createDefaultAvatarEffectDocument,
} from "@/lib/avatar/vfx/editor";
import {
  createDefaultSceneEffectDocument,
  sceneEffectRecoveryStore,
} from "@/lib/scene-vfx/editor";
import { particleVFXRecoveryStore } from "./particleVFXRecovery";

afterEach(() => vi.unstubAllGlobals());

type Databases = Map<string, Map<string, Map<string, unknown>>>;

/**
 * Minimal asynchronous IndexedDB: enough of open/transaction/get/put/delete to
 * prove which database, object store and key a record lives under.
 */
function fakeIndexedDb(databases: Databases = new Map()) {
  const later = (callback: () => void) => setTimeout(callback, 0);
  return {
    databases,
    indexedDB: {
      open(name: string) {
        const request: Record<string, unknown> & {
          onupgradeneeded?: () => void;
          onsuccess?: () => void;
        } = {};
        later(() => {
          const created = !databases.has(name);
          const stores = databases.get(name) ?? new Map();
          databases.set(name, stores);
          request.result = {
            objectStoreNames: {
              contains: (store: string) => stores.has(store),
            },
            createObjectStore: (store: string) => stores.set(store, new Map()),
            close: () => undefined,
            transaction(storeName: string) {
              const transaction: Record<string, unknown> & {
                oncomplete?: () => void;
              } = {
                objectStore() {
                  const store = stores.get(storeName)!;
                  const run = (operation: () => unknown) => {
                    const step: Record<string, unknown> & {
                      onsuccess?: () => void;
                    } = {};
                    later(() => {
                      step.result = operation();
                      step.onsuccess?.();
                      transaction.oncomplete?.();
                    });
                    return step;
                  };
                  return {
                    get: (key: string) => run(() => store.get(key)),
                    put: (value: unknown, key: string) =>
                      run(() => store.set(key, value)),
                    delete: (key: string) => run(() => store.delete(key)),
                  };
                },
              };
              return transaction;
            },
          };
          if (created) request.onupgradeneeded?.();
          request.onsuccess?.();
        });
        return request;
      },
    },
  };
}

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    },
  };
}

/** Records exactly as the per-kind modules wrote them before the shared store. */
function previousFormatDrafts() {
  const image = new File(["avatar image"], "sparkle.webp", {
    type: "image/webp",
  });
  const avatarDocument = {
    ...createDefaultAvatarEffectDocument(),
    name: "Old avatar draft",
  };
  const sceneDocument = {
    ...createDefaultSceneEffectDocument(),
    name: "Old scene draft",
  };
  const particle = createParticleVFXEditorDraftFromBlank();
  return {
    avatar: {
      schema: "animama/avatar-effect-recovery/1",
      userId: "owner",
      documentKey: "new",
      operationId: "avatar-operation",
      document: avatarDocument,
      imageResource: { file: image, sha256: "a".repeat(64) },
      contentFingerprint: "avatar-fingerprint",
      updatedAt: "2026-09-01T00:00:00.000Z",
    },
    scene: {
      schema: "animama/scene-effect-recovery/1",
      userId: "owner",
      documentKey: "item-1",
      operationId: "scene-operation",
      document: sceneDocument,
      imageResources: [],
      contentFingerprint: "scene-fingerprint",
      updatedAt: "2026-09-01T00:00:00.000Z",
    },
    // Particle stored JSON text, with its source and file operation IDs.
    particleText: JSON.stringify({
      schema: "animama/particle-effect-recovery/2",
      userId: "owner",
      documentKey: "new",
      source: null,
      operationId: "particle-operation",
      fileOperationIds: ["particle-operation-manifest"],
      displayName: "Old particle draft",
      catalog: { ...particle.catalog, label: "Old particle draft" },
      quarksJson: particle.quarksJson,
      updatedAt: "2026-09-01T00:00:00.000Z",
    }),
  };
}

describe("creator recovery store", () => {
  it("reads drafts the previous creators stored in IndexedDB", async () => {
    const old = previousFormatDrafts();
    const databases: Databases = new Map([
      [
        "animama-avatar-effect-creator-recovery",
        new Map([
          ["drafts", new Map<string, unknown>([["owner:new", old.avatar]])],
        ]),
      ],
      [
        "animama-scene-effect-creator-recovery",
        new Map([
          ["drafts", new Map<string, unknown>([["owner:item-1", old.scene]])],
        ]),
      ],
      [
        "animama-content-creator-recovery",
        new Map([
          [
            "particle-vfx",
            new Map<string, unknown>([["owner:new", old.particleText]]),
          ],
        ]),
      ],
    ]);
    vi.stubGlobal("window", {
      indexedDB: fakeIndexedDb(databases).indexedDB,
      localStorage: memoryStorage().localStorage,
    });

    const avatar = await avatarEffectRecoveryStore.load("owner", "new");
    expect(avatar).toMatchObject({
      schema: AVATAR_EFFECT_RECOVERY_SCHEMA,
      operationId: "avatar-operation",
      document: { name: "Old avatar draft" },
    });
    expect(avatar?.imageResource?.file).toBe(old.avatar.imageResource.file);
    expect(
      await sceneEffectRecoveryStore.load("owner", "item-1"),
    ).toMatchObject({
      operationId: "scene-operation",
      document: { name: "Old scene draft" },
    });
    expect(await particleVFXRecoveryStore.load("owner", "new")).toMatchObject({
      operationId: "particle-operation",
      displayName: "Old particle draft",
      source: null,
    });
    // A different owner or document never sees the draft.
    expect(await avatarEffectRecoveryStore.load("other", "new")).toBeNull();
    expect(await sceneEffectRecoveryStore.load("owner", "new")).toBeNull();
  });

  it("reads drafts the previous creators stored in the localStorage fallback", async () => {
    const old = previousFormatDrafts();
    vi.stubGlobal("window", {
      indexedDB: undefined,
      localStorage: memoryStorage({
        "anima.avatarEffectCreator.recovery.v1:owner:new": JSON.stringify({
          ...old.avatar,
          imageResource: null,
        }),
        "anima.sceneEffectCreator.recovery.v1:owner:item-1": JSON.stringify(
          old.scene,
        ),
        "anima.particleVfxCreator.recovery.v1:owner:new": old.particleText,
      }).localStorage,
    });

    expect(await avatarEffectRecoveryStore.load("owner", "new")).toMatchObject({
      operationId: "avatar-operation",
      imageResource: null,
    });
    expect(
      await sceneEffectRecoveryStore.load("owner", "item-1"),
    ).toMatchObject({ operationId: "scene-operation" });
    expect(await particleVFXRecoveryStore.load("owner", "new")).toMatchObject({
      operationId: "particle-operation",
    });
  });

  it("writes to IndexedDB under the kind's names and clears a stale fallback", async () => {
    const old = previousFormatDrafts();
    const browser = fakeIndexedDb();
    const storage = memoryStorage({
      "anima.avatarEffectCreator.recovery.v1:owner:new": "stale",
    });
    vi.stubGlobal("window", {
      indexedDB: browser.indexedDB,
      localStorage: storage.localStorage,
    });

    const result = await avatarEffectRecoveryStore.save({
      ...old.avatar,
      schema: AVATAR_EFFECT_RECOVERY_SCHEMA,
    });

    expect(result).toEqual({
      stored: true,
      metadataOnly: false,
      warning: null,
    });
    expect(
      browser.databases
        .get("animama-avatar-effect-creator-recovery")
        ?.get("drafts")
        ?.has("owner:new"),
    ).toBe(true);
    expect(storage.values.size).toBe(0);
    await avatarEffectRecoveryStore.clear("owner", "new", { strict: true });
    expect(await avatarEffectRecoveryStore.load("owner", "new")).toBeNull();
  });

  it("falls back to localStorage, without image bytes, when IndexedDB is unavailable", async () => {
    const old = previousFormatDrafts();
    const storage = memoryStorage();
    vi.stubGlobal("window", {
      indexedDB: undefined,
      localStorage: storage.localStorage,
    });
    const document = {
      ...old.avatar.document,
      art: {
        ...old.avatar.document.art,
        image: {
          logicalName: "sparkle.webp",
          originalName: "sparkle.webp",
          contentType: "image/webp",
          sizeBytes: 12,
          sha256: "a".repeat(64),
        },
      },
    };

    const result = await avatarEffectRecoveryStore.save({
      ...old.avatar,
      schema: AVATAR_EFFECT_RECOVERY_SCHEMA,
      document,
    });

    expect(result.stored).toBe(true);
    expect(result.metadataOnly).toBe(true);
    expect(result.warning).toContain("Reselect the image");
    const stored = JSON.parse(
      storage.values.get("anima.avatarEffectCreator.recovery.v1:owner:new")!,
    );
    expect(stored.imageResource).toBeNull();
    expect(stored.operationId).toBe("avatar-operation");
  });

  it("keeps a full Particle draft in the fallback only below its size cap", async () => {
    const storage = memoryStorage();
    vi.stubGlobal("window", {
      indexedDB: undefined,
      localStorage: storage.localStorage,
    });
    const record = JSON.parse(previousFormatDrafts().particleText);

    expect(await particleVFXRecoveryStore.save(record)).toEqual({
      stored: true,
      metadataOnly: false,
      warning: null,
    });
    const large = {
      ...record,
      displayName: "x".repeat(1024 * 1024),
    };
    const result = await particleVFXRecoveryStore.save(large);
    expect(result.stored).toBe(false);
    expect(result.warning).toContain("crash recovery is unavailable");
    const tooLarge = await particleVFXRecoveryStore.save({
      ...record,
      displayName: "x".repeat(6 * 1024 * 1024),
    });
    expect(tooLarge.warning).toContain("too large");
  });
});
