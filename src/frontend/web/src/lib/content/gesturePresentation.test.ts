import { describe, expect, it } from "vitest";

import type { PyGesture } from "@/lib/content/catalogTypes";
import { presentGesture } from "./gesturePresentation";

describe("presentGesture", () => {
  it("presents a built-in catalog item as a Gesture", () => {
    const card = presentGesture({
      item_id: "builtin:gesture:wave",
      name: "Wave",
      description: "Friendly wave",
      semantic_key: "wave",
      implementation_kind: "vrma",
      origin: "builtin",
      source: {
        type: "builtin",
        content_id: "builtin:gesture:wave",
        version: 2,
      },
      state: "ready",
      created_at: null,
      updated_at: null,
      update_available: false,
    } satisfies PyGesture);

    expect(card).toMatchObject({
      key: "builtin:builtin:gesture:wave",
      originLabel: "Built-in",
      semanticKey: "wave",
      versionLabel: "Built-in v2",
    });
  });
});
