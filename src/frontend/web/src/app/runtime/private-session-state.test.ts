import { describe, expect, it, vi } from "vitest";
import { clearPrivateSessionState } from "./private-session-state";
import { registerPrivateStateReset } from "./private-module-state";

describe("private session state", () => {
  it("clears registered module drafts, even when another reset fails", async () => {
    const reset = vi.fn();
    registerPrivateStateReset(() => {
      throw new Error("Draft could not be cleared");
    });
    registerPrivateStateReset(reset);
    await expect(clearPrivateSessionState("session")).rejects.toThrow(
      "Private session state could not all be disposed",
    );
    expect(reset).toHaveBeenCalledOnce();
  });
});
