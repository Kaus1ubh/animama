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
    expect(error.message).toContain("80");
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
