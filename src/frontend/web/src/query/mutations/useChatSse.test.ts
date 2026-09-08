import { describe, expect, it } from "vitest";

import { isRuntimeRemountRequired } from "@/lib/runtime-content/errors";
import { ChatSseHttpError, matchesRuntimeContentRevision } from "./useChatSse";

describe("chat runtime Asset revision fencing", () => {
  it("accepts only the mounted revision when a chat request is fenced", () => {
    expect(matchesRuntimeContentRevision("ar1-mounted", "ar1-mounted")).toBe(
      true,
    );
    expect(matchesRuntimeContentRevision("ar1-mounted", "ar1-stale")).toBe(
      false,
    );
    expect(matchesRuntimeContentRevision("ar1-mounted", null)).toBe(false);
  });

  it("rejects events when no frozen runtime revision is mounted", () => {
    expect(matchesRuntimeContentRevision(null, null)).toBe(false);
    expect(matchesRuntimeContentRevision(null, "tr1-any")).toBe(false);
  });

  it("preserves a pre-stream revision conflict for recovery", () => {
    const error = new ChatSseHttpError(409, "Conflict", {
      detail: {
        code: "runtime_remount_required",
      },
    });

    expect(error.status).toBe(409);
    expect(isRuntimeRemountRequired(error)).toBe(true);
  });
});
