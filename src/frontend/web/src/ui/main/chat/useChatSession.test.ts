import { describe, expect, it } from "vitest";

import { chatSessionCanChat } from "./useChatSession";

describe("chatSessionCanChat", () => {
  it("allows text chat while optional visual content is still preparing", () => {
    expect(
      chatSessionCanChat({
        animaId: "anima-1",
        loadedAnimaId: "anima-1",
        runtimeRevision: "tr2-mounted",
        runtimeCanChat: true,
      }),
    ).toBe(true);
  });

  it("still requires an issued runtime revision fence", () => {
    expect(
      chatSessionCanChat({
        animaId: "anima-1",
        loadedAnimaId: "anima-1",
        runtimeRevision: null,
        runtimeCanChat: true,
      }),
    ).toBe(false);
  });
});
