import { describe, expect, it } from "vitest";
import { buildAnimaSpec, createAnimaDraftReducer } from "./createAnimaDraft";
import {
  classifyCreationFailure,
  freezeCreation,
} from "./createAnimaSubmission";
import { readyDraft } from "./createAnimaTestFixtures";

describe("creation command identity", () => {
  it("keeps the exact payload/key across unchanged rejection, navigation, and normalized edits", () => {
    const draft = readyDraft();
    const request = freezeCreation(draft, buildAnimaSpec(draft));
    const rejected = {
      ...draft,
      submission: { state: "rejected" as const, request },
    };
    const edited = createAnimaDraftReducer(rejected, {
      type: "edit",
      patch: { display_name: "Rowan 🌿" },
    });
    expect(freezeCreation(edited, buildAnimaSpec(edited))).toEqual(request);
    const changed = createAnimaDraftReducer(rejected, {
      type: "edit",
      patch: { display_name: "Juniper" },
    });
    expect(
      freezeCreation(changed, buildAnimaSpec(changed)).idempotency_key,
    ).not.toBe(request.idempotency_key);
  });

  it("can replay a frozen command without resolving current content and rejects attempted edits", () => {
    const draft = readyDraft();
    const request = freezeCreation(draft, buildAnimaSpec(draft));
    const unknown = {
      ...draft,
      evidence: {},
      submission: { state: "unknown" as const, request },
    };
    expect(freezeCreation(unknown, buildAnimaSpec(draft))).toEqual(request);
    expect(() =>
      freezeCreation(unknown, {
        ...buildAnimaSpec(draft),
        display_name: "changed",
      }),
    ).toThrow("previous creation result");
  });
});

describe("conservative HTTP outcome classification", () => {
  it.each([
    [422, "anima_creation_invalid", "rejected"],
    [404, "anima_creation_source_unavailable", "rejected"],
    [409, "anima_creation_sources_stale", "rejected"],
    [503, "anima_creation_defaults_unavailable", "rejected"],
    [409, "idempotency_key_reused", "conflict"],
    [410, "creation_result_deleted", "deleted"],
    [503, "anima_creation_unavailable", "unknown"],
    [409, "unrecognized", "unknown"],
    [500, "anima_creation_invalid", "unknown"],
  ])("HTTP %s / %s is %s", (status, code, expected) => {
    const failure = classifyCreationFailure(
      {
        detail: { code, message: "Safe message", retryable: false, issues: [] },
      },
      status as number,
    );
    expect(failure.state).toBe(expected);
  });

  it("treats network, malformed, gateway, and unexpected responses as unknown", () => {
    expect(classifyCreationFailure(new Error("lost response")).state).toBe(
      "unknown",
    );
    expect(classifyCreationFailure({}, 200).state).toBe("unknown");
    expect(classifyCreationFailure({}, 401).state).toBe("unknown");
    expect(
      classifyCreationFailure({
        detail: {
          issues: [
            null,
            {},
            "bad",
            { code: "source", message: "Changed", path: "/avatar" },
          ],
        },
      }).detail.issues,
    ).toEqual([{ code: "source", message: "Changed", path: "/avatar" }]);
  });
});
