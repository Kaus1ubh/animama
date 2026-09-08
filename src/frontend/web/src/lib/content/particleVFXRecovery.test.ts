import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createParticleVFXEditorDraftFromBlank } from "@/lib/avatar/particle-vfx";
import {
  clearParticleVFXRecovery,
  loadParticleVFXRecovery,
  PARTICLE_VFX_RECOVERY_SCHEMA,
  saveParticleVFXRecovery,
} from "./particleVFXRecovery";

describe("Particle Effect recovery", () => {
  const values = new Map<string, string>();

  beforeEach(() => {
    values.clear();
    vi.stubGlobal("window", {
      indexedDB: undefined,
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("round-trips bounded authoring state for the current user", async () => {
    const draft = createParticleVFXEditorDraftFromBlank();
    const saved = await saveParticleVFXRecovery({
      schema: PARTICLE_VFX_RECOVERY_SCHEMA,
      userId: "user-a",
      documentKey: "new",
      source: null,
      operationId: "operation-a",
      fileOperationIds: ["operation-a-manifest", "operation-a-texture-1"],
      displayName: draft.catalog.label,
      catalog: draft.catalog,
      quarksJson: draft.quarksJson,
      updatedAt: "2026-08-09T12:00:00.000Z",
    });

    expect(saved).toEqual({ stored: true, warning: null });
    expect(await loadParticleVFXRecovery("user-a", null)).toMatchObject({
      operationId: "operation-a",
      fileOperationIds: ["operation-a-manifest", "operation-a-texture-1"],
    });
    expect(await loadParticleVFXRecovery("user-b", null)).toBeNull();

    await clearParticleVFXRecovery("user-a", null);
    expect(await loadParticleVFXRecovery("user-a", null)).toBeNull();
  });

  it("reports unavailable recovery without failing the ordinary save path", async () => {
    const draft = createParticleVFXEditorDraftFromBlank();
    vi.stubGlobal("window", {
      indexedDB: undefined,
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new DOMException("Quota exceeded", "QuotaExceededError");
        },
        removeItem: () => undefined,
      },
    });

    const result = await saveParticleVFXRecovery({
      schema: PARTICLE_VFX_RECOVERY_SCHEMA,
      userId: "user-a",
      documentKey: "new",
      source: null,
      operationId: "operation-a",
      fileOperationIds: [],
      displayName: draft.catalog.label,
      catalog: draft.catalog,
      quarksJson: draft.quarksJson,
      updatedAt: "2026-08-09T12:00:00.000Z",
    });

    expect(result.stored).toBe(false);
    expect(result.warning).toContain("crash recovery is unavailable");
  });
});
