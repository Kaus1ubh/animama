import { afterEach, describe, expect, it } from "vitest";
import { getI18n } from "react-i18next";

import {
  MemoryEntryApiError,
  memoryEntryErrorMessage,
  memoryEntryErrorText,
} from "./errors";

afterEach(async () => {
  await getI18n().changeLanguage("en");
});

describe("memory entry failures", () => {
  const conflict = new MemoryEntryApiError(409, {
    detail: "Entry revision is stale",
  });

  it("show the backend's English detail in English", () => {
    expect(memoryEntryErrorText(conflict, "Could not save")).toEqual({
      message: "Entry revision is stale",
      detail: null,
    });
    expect(memoryEntryErrorMessage(new MemoryEntryApiError(500, {}))).toBe(
      "Memory operation failed.",
    );
  });

  it("show the action's translated failure with the English detail elsewhere", async () => {
    await getI18n().changeLanguage("ja");
    const generic = getI18n().t("memory:errors.entryFailed");
    expect(memoryEntryErrorText(conflict)).toEqual({
      message: generic,
      detail: "Entry revision is stale",
    });
    expect(generic).not.toBe("Memory operation failed.");
  });
});
