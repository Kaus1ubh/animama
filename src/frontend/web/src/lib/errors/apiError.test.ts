import { afterEach, describe, expect, it } from "vitest";
import { getI18n } from "react-i18next";

import {
  apiErrorText,
  errorWording,
  readApiError,
  WordedError,
} from "./apiError";

afterEach(async () => {
  await getI18n().changeLanguage("en");
});

describe("readApiError", () => {
  it("reads the code, params and English detail from generated-client failures", () => {
    expect(
      readApiError({
        detail: {
          code: "content_invalid",
          reason: "clip_invalid",
          field: "name",
          message: "Name is required",
          params: { name: "おじぎ", count: 2 },
        },
      }),
    ).toEqual({
      status: null,
      code: "content_invalid",
      reason: "clip_invalid",
      field: "name",
      params: { name: "おじぎ", count: 2 },
      message: "Name is required",
    });
    expect(readApiError({ data: { detail: { code: "x" } } }).code).toBe("x");
    expect(readApiError({ detail: "Not pending" }).message).toBe("Not pending");
    expect(readApiError(new Error("Failed to fetch")).message).toBe(
      "Failed to fetch",
    );
    expect(readApiError(null).code).toBeNull();
  });
});

describe("apiErrorText", () => {
  it("words a known code with its params", () => {
    expect(
      errorWording("loadout", "gesture_semantic_key_conflict", {
        name: "お辞儀",
      }),
    ).toBe("Gesture お辞儀 has a conflicting semantic key.");
    expect(errorWording("loadout", "no_such_code", {})).toBeNull();
    expect(
      apiErrorText(
        readApiError({
          detail: {
            code: "gesture_semantic_key_conflict",
            message: "ignored",
            params: { name: "お辞儀" },
          },
        }),
        "loadout",
      ),
    ).toEqual({
      message: "Gesture お辞儀 has a conflicting semantic key.",
      detail: null,
    });
  });

  it("keeps English backend detail as the message in English, and secondary elsewhere", async () => {
    const info = readApiError({
      detail: { code: "unworded", message: "clip.beats[0].time is negative" },
    });
    expect(apiErrorText(info, "loadout")).toEqual({
      message: "clip.beats[0].time is negative",
      detail: null,
    });
    await getI18n().changeLanguage("ja");
    const translated = apiErrorText(info, "loadout");
    expect(translated.detail).toBe("clip.beats[0].time is negative");
    expect(translated.message).not.toBe(translated.detail);
  });

  it("shows an already worded error as it is in every locale", async () => {
    await getI18n().changeLanguage("ja");
    const info = readApiError(new WordedError("翻訳済みのメッセージ"));
    expect(apiErrorText(info, null, "fallback")).toEqual({
      message: "翻訳済みのメッセージ",
      detail: null,
    });
  });
});
