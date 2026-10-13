import { describe, expect, it } from "vitest";
import type { PyContentPreview } from "@/lib/content/catalogTypes";
import { previewSoundForCopy } from "./previewSound";

function preview(...dependencies: Record<string, unknown>[]): PyContentPreview {
  return {
    metadata: {
      dependencies,
      reference_map: { "on-apply": "pop" },
      supports: [{ runtime_id: "pop", name: "Pop" }],
    },
  } as unknown as PyContentPreview;
}

const sound = (portability?: string) => ({
  alias: "on-apply",
  content_type: "sound_effect",
  source: { type: "catalog", catalog_item_id: "sound-item" },
  ...(portability ? { portability } : {}),
});

describe("previewSoundForCopy", () => {
  it("copies an ordinary sound with its picker label", () => {
    expect(previewSoundForCopy(preview(sound("portable")))).toEqual({
      sound: {
        alias: "on-apply",
        label: "Pop",
        source: { type: "catalog", catalog_item_id: "sound-item" },
      },
      licensedOmitted: false,
    });
  });

  it("leaves a licensed built-in sound behind and says so", () => {
    expect(previewSoundForCopy(preview(sound("non-portable")))).toEqual({
      sound: null,
      licensedOmitted: true,
    });
  });

  it("returns no sound for an effect without one", () => {
    expect(previewSoundForCopy(preview())).toEqual({
      sound: null,
      licensedOmitted: false,
    });
  });
});
