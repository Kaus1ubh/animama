import { describe, expect, it } from "vitest";

import {
  ContentSaveApiError,
  parseContentApiErrorDetail,
  toContentSaveApiError,
} from "./contentSaveErrors";

describe("parseContentApiErrorDetail", () => {
  it("parses the direct FastAPI error envelope", () => {
    expect(
      parseContentApiErrorDetail({
        detail: {
          code: "content_invalid",
          field: "files",
          reason: "The sequence is malformed",
          details: { filename: "wave.json" },
        },
      }),
    ).toEqual({
      code: "content_invalid",
      field: "files",
      reason: "The sequence is malformed",
      message: null,
      details: { filename: "wave.json" },
    });
  });

  it("parses the legacy upload wrapper", () => {
    expect(
      parseContentApiErrorDetail({
        data: { detail: { code: "content_upload_retry_required" } },
      }),
    ).toEqual({
      code: "content_upload_retry_required",
      field: null,
      reason: null,
      message: null,
      details: {},
    });
  });
});

describe("toContentSaveApiError", () => {
  it.each([
    [
      "catalog_revision_conflict",
      "This item changed since you opened it. Reload the latest version before saving. Your draft is preserved.",
    ],
    [
      "content_path_exists",
      "Another item already uses this name. Choose a different name and try again. Your draft is preserved.",
    ],
    [
      "invalid_entry_name",
      "Use a name that starts with a letter or number (in any script) and contains only letters, numbers, spaces, periods, underscores or hyphens. Your draft is preserved.",
    ],
    [
      "content_path_invalid",
      "Use a name that starts with a letter or number (in any script) and contains only letters, numbers, spaces, periods, underscores or hyphens. Your draft is preserved.",
    ],
    [
      "content_file_empty",
      "The selected file is empty. Choose a valid exported file. Your draft is preserved.",
    ],
    [
      "content_file_too_large",
      "The selected file exceeds the supported size limit. Reduce its size and retry. Your draft is preserved.",
    ],
    [
      "content_entry_too_large",
      "The combined files exceed the supported entry size. Remove or reduce companion files. Your draft is preserved.",
    ],
    [
      "duplicate_companion_path",
      "Two files would be saved to the same path. Rename one of them and retry. Your draft is preserved.",
    ],
    [
      "unsupported_standalone_extension",
      "This file type is not supported for this content kind. Choose a supported export format. Your draft is preserved.",
    ],
    [
      "standalone_extension_change_requires_new_item",
      "Changing the primary file type requires saving this as a new item. Your draft is preserved.",
    ],
    [
      "content_not_found",
      "The original item no longer exists. Return to the Library or save this draft as a new item. Your draft is preserved.",
    ],
  ])("maps %s to corrective guidance", (code, message) => {
    const error = toContentSaveApiError({ detail: { code } }, 409);

    expect(error).toBeInstanceOf(ContentSaveApiError);
    expect(error).toMatchObject({ status: 409, code, message });
  });

  it("includes a safe backend validation reason and preserves its metadata", () => {
    const error = toContentSaveApiError(
      {
        detail: {
          code: "content_invalid",
          reason: "The sequence has no playable frames",
          details: { frame_count: 0 },
        },
      },
      422,
    );

    expect(error.message).toBe(
      "Content validation failed: The sequence has no playable frames. Correct the source and retry. Your draft is preserved.",
    );
    expect(error.reason).toBe("The sequence has no playable frames");
    expect(error.details).toEqual({ frame_count: 0 });
  });

  it.each([
    [
      "definition.placement",
      'The Avatar Effect setting "placement" is invalid: Unsupported hover placement primitive. Correct it and retry. Your draft is preserved.',
    ],
    [
      "definition.transform.offset.x",
      'The Avatar Effect setting "transform.offset.x" is invalid: x must be finite. Correct it and retry. Your draft is preserved.',
    ],
  ])(
    "names the invalid Avatar Effect definition field %s",
    (field, message) => {
      const error = toContentSaveApiError(
        {
          detail: {
            code: "content_invalid",
            reason: "avatar_effect_definition_invalid",
            field,
            message: field.endsWith(".x")
              ? "x must be finite"
              : "Unsupported hover placement primitive",
          },
        },
        422,
      );

      expect(error).toMatchObject({
        status: 422,
        code: "content_invalid",
        reason: "avatar_effect_definition_invalid",
        field,
        message,
      });
    },
  );

  it("names the definition when the backend reports no field path", () => {
    expect(
      toContentSaveApiError(
        {
          detail: {
            code: "content_invalid",
            reason: "avatar_effect_definition_invalid",
          },
        },
        422,
      ).message,
    ).toBe(
      'The Avatar Effect setting "definition" is invalid. Correct it and retry. Your draft is preserved.',
    );
  });

  it("prefers the backend's human message over a document error code", () => {
    expect(
      toContentSaveApiError(
        {
          detail: {
            code: "content_invalid",
            reason: "package_definition_invalid",
            message: "Resource reference must name a registered package file",
          },
        },
        422,
      ).message,
    ).toBe(
      "Content validation failed: Resource reference must name a registered package file. Correct the source and retry. Your draft is preserved.",
    );
  });

  it.each([
    ["content_path_exists", "name"],
    ["invalid_entry_name", "name"],
    ["content_file_empty", "files"],
    ["content_file_too_large", "files"],
    ["content_entry_too_large", "files"],
    ["duplicate_companion_path", "files"],
    ["unsupported_standalone_extension", "files"],
    ["standalone_extension_change_requires_new_item", "files"],
    ["standalone_requires_one_file", "files"],
    ["invalid_companion_paths", "files"],
  ])("infers the %s control target for older backends", (code, field) => {
    expect(toContentSaveApiError({ detail: { code } }, 409).field).toBe(field);
  });

  it("prefers an explicit backend field and leaves global failures untargeted", () => {
    expect(
      toContentSaveApiError(
        { detail: { code: "content_path_exists", field: "custom-name" } },
        409,
      ).field,
    ).toBe("custom-name");
    expect(
      toContentSaveApiError(
        { detail: { code: "catalog_revision_conflict" } },
        409,
      ).field,
    ).toBeNull();
    expect(
      toContentSaveApiError({ detail: { code: "content_path_invalid" } }, 422)
        .field,
    ).toBeNull();
  });

  it("turns a browser fetch failure into local-stack recovery guidance", () => {
    expect(
      toContentSaveApiError(new TypeError("Failed to fetch")).message,
    ).toBe(
      "Animama could not be reached. Check that the local stack is running, then retry. Your draft is preserved.",
    );
  });

  it("uses a safe fallback for unknown HTTP failures", () => {
    const error = toContentSaveApiError(
      { detail: { code: "new_backend_failure" } },
      500,
    );

    expect(error.message).toBe(
      "Animama encountered an unexpected error while saving. Your draft is preserved; retry or check the backend logs.",
    );
    expect(error.code).toBe("new_backend_failure");
  });

  it("uses the same draft-safe fallback for an unknown thrown value", () => {
    expect(toContentSaveApiError({ unexpected: true }).message).toBe(
      "Animama encountered an unexpected error while saving. Your draft is preserved; retry or check the backend logs.",
    );
  });

  it("preserves actionable native Error and string messages", () => {
    expect(
      toContentSaveApiError(new Error("Choose a VRMA file before saving."))
        .message,
    ).toBe("Choose a VRMA file before saving.");
    expect(
      toContentSaveApiError("The browser rejected the file.").message,
    ).toBe("The browser rejected the file.");
    expect(
      toContentSaveApiError(new TypeError("Invalid form data")).message,
    ).toBe("Invalid form data");
  });
});
