import { describe, expect, it } from "vitest";

import type { PyReaction } from "@/lib/content/catalogTypes";
import { presentReaction } from "./reactionPresentation";

describe("presentReaction", () => {
  it("keeps a private Reaction product-oriented", () => {
    const card = presentReaction({
      item_id: "reaction-1",
      name: "Happy Sparkle",
      description: null,
      origin: "owned",
      source: {
        type: "catalog",
        catalog_item_id: "reaction-1",
        logical_key: "local:reaction:happy-sparkle",
      },
      state: "ready",
      created_at: "2026-08-10T00:00:00Z",
      updated_at: "2026-08-10T00:00:00Z",
      update_available: true,
    } satisfies PyReaction);

    expect(card).toMatchObject({
      key: "owned:reaction-1",
      description: "No description",
      originLabel: "Mine",
      versionLabel: "Local",
      updateAvailable: true,
    });
  });
});
