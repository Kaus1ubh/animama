import { describe, expect, it } from "vitest";
import { chatRunStatusLabel, isChatRunStatus } from "@animama/product-ui/chat";

describe("run.status frames", () => {
  it("accepts known statuses and phases", () => {
    expect(
      isChatRunStatus({
        type: "run.status",
        run_id: "run-1",
        status: "summarizing_context",
        phase: "started",
      }),
    ).toBe(true);
  });

  it("ignores unknown statuses so older clients stay quiet", () => {
    expect(
      isChatRunStatus({
        type: "run.status",
        run_id: "run-1",
        status: "thinking_hard",
        phase: "started",
      }),
    ).toBe(false);
    expect(isChatRunStatus({ type: "run.status", run_id: "run-1" })).toBe(
      false,
    );
  });

  it("labels each status for the pending bubble", () => {
    expect(chatRunStatusLabel("summarizing_context")).toBe(
      "Summarizing earlier conversation…",
    );
    expect(chatRunStatusLabel("searching_web")).toBe("Searching the web…");
  });
});
