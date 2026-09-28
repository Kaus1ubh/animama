import { describe, expect, it } from "vitest";

import {
  encodePocketAnimaCatalogReference,
  resolvePocketAnimaVoiceSelection,
} from "./anima-voice-selection";

describe("Pocket Anima catalog selection", () => {
  const context = {
    animaId: "anima-1",
    emotionLabel: "neutral" as const,
    emotionIntensity: 1,
    animaVoiceCatalogUrl: "/legacy/catalog.bin",
  };

  it("uses the prepared clone ahead of a legacy URL", () => {
    const assertActive = () => undefined;
    const selection = resolvePocketAnimaVoiceSelection({
      ...context,
      mountedVoice: { catalogUrl: "blob:clone-a", assertActive },
    });
    expect(selection.animaVoiceCatalogUrl).toBe("blob:clone-a");
    expect(selection.assertAnimaCatalogActive).toBe(assertActive);
    expect(encodePocketAnimaCatalogReference(selection)).toContain(
      encodeURIComponent("blob:clone-a"),
    );
  });

  it("does not revive legacy catalog lookup while an equipped clone is unavailable", () => {
    const selection = resolvePocketAnimaVoiceSelection({
      ...context,
      mountedVoice: {
        catalogUrl: null,
        assertActive: () => {
          throw new Error("Voice unavailable");
        },
      },
    });
    expect(encodePocketAnimaCatalogReference(selection)).toBeNull();
    expect(selection.assertAnimaCatalogActive).toThrow("Voice unavailable");
  });

  it("preserves legacy catalogs when there is no equipped library voice", () => {
    const selection = resolvePocketAnimaVoiceSelection({
      ...context,
      mountedVoice: null,
    });
    expect(selection.animaVoiceCatalogUrl).toBe("/legacy/catalog.bin");
    expect(selection.assertAnimaCatalogActive).toBeUndefined();
  });
});
