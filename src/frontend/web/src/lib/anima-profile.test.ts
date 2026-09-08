import { describe, expect, it } from "vitest";

import type {
  PyAnimaListItem,
  PyAnimaResponse,
} from "@/lib/content/catalogTypes";
import { getAnimaDisplayName } from "./anima-profile";

describe("live Anima names", () => {
  const anima: PyAnimaResponse = {
    id: "anima-one",
    display_name: "My  companion",
    aggregate_revision: 1,
    identity_status: "ready",
    avatar: {
      id: "avatar-one",
      name: "Template name",
      identity: "Template identity",
      file_path: "/shared/fixture.vrm",
      model_type: "vrm",
      private: false,
      source: { type: "builtin", avatar_id: "avatar-one", version: 1 },
    },
  };

  it("uses stable live names and preserves meaningful internal whitespace", () => {
    expect(getAnimaDisplayName(anima)).toBe("My  companion");
    expect(
      getAnimaDisplayName({
        ...anima,
        avatar: { ...anima.avatar!, name: "Changed source" },
      }),
    ).toBe("My  companion");
  });

  it("prefers updated aggregate authority over a stale presentation cache", () => {
    const item: PyAnimaListItem = {
      ...anima,
      presentation: {
        anima_id: anima.id,
        display_name: "Earlier live name",
        presentation_revision: "earlier",
      },
    };
    expect(getAnimaDisplayName(item)).toBe("My  companion");
  });

  it("does not use an Avatar as a repair-time name fallback", () => {
    expect(getAnimaDisplayName({ ...anima, display_name: "" })).toBe(anima.id);
    expect(getAnimaDisplayName(null)).toBe("Anima");
  });
});
