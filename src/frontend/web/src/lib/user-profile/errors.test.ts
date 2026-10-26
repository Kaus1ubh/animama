import { describe, expect, it } from "vitest";

import { UserProfileApiError } from "@/lib/user-profile/errors";

describe("UserProfileApiError", () => {
  it("maps the bounded local display-name validation contract", () => {
    const error = new UserProfileApiError(422, {
      detail: {
        code: "user_profile_invalid",
        field: "display_name",
        reason: "length",
      },
    });

    expect(error.status).toBe(422);
    expect(error.field).toBe("display_name");
    expect(error.reason).toBe("length");
    expect(error.message).toContain("30");
  });

  it("explains that ordinary edits wait for first-run setup", () => {
    const error = new UserProfileApiError(409, {
      detail: { code: "first_run_incomplete" },
    });

    expect(error.message).toContain("first-run setup");
  });

  it("explains a missing required name", () => {
    const error = new UserProfileApiError(422, {
      detail: {
        code: "user_profile_invalid",
        field: "display_name",
        reason: "required",
      },
    });
    expect(error.message).toBe("Enter a display name.");
  });
});

describe("hosted display-name denials", () => {
  it("shows the hosted length limit message", () => {
    const error = new UserProfileApiError(422, {
      error: "display_name_too_long",
      code: "display_name_too_long",
      max_characters: 20,
      message: "Display names can be up to 20 characters.",
    });
    expect(error.status).toBe(422);
    expect(error.code).toBe("display_name_too_long");
    expect(error.message).toBe("Display names can be up to 20 characters.");
  });

  it("states the hosted length limit when no message is sent", () => {
    expect(
      new UserProfileApiError(422, {
        error: "display_name_too_long",
        max_characters: 20,
      }).message,
    ).toBe("Display names can be up to 20 characters.");
  });

  it("asks to sign in again before changing the display name", () => {
    const error = new UserProfileApiError(403, {
      error: "reauthentication_required",
      code: "reauthentication_required",
      message: "Sign in again to change your display name.",
    });
    expect(error.code).toBe("reauthentication_required");
    expect(error.message).toBe("Sign in again to change your display name.");
    expect(
      new UserProfileApiError(403, { code: "reauthentication_required" })
        .message,
    ).toMatch(/sign in again/i);
  });

  it("keeps the generic copy for other server messages", () => {
    expect(
      new UserProfileApiError(400, {
        code: "something_else",
        message: "Internal detail",
      }).message,
    ).toBe("Could not save your personalization. Try again.");
  });
});
