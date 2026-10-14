import { afterEach, describe, expect, it } from "vitest";
import { getI18n } from "react-i18next";

import {
  CreatorError,
  creatorErrorText,
  libraryAvatarFailureText,
} from "./createAnimaErrors";

afterEach(async () => {
  await getI18n().changeLanguage("en");
});

describe("creator failure wording", () => {
  it("keeps worded creator failures and their detail", () => {
    expect(
      creatorErrorText(new CreatorError("Worded.", "Backend detail")),
    ).toEqual({ message: "Worded.", detail: "Backend detail" });
  });

  it("shows other English as is in English and as detail elsewhere", async () => {
    const error = new Error("Failed to fetch");
    expect(creatorErrorText(error, "Fallback.")).toEqual({
      message: "Failed to fetch",
      detail: null,
    });
    await getI18n().changeLanguage("ja");
    expect(creatorErrorText(error, "フォールバック。")).toEqual({
      message: "フォールバック。",
      detail: "Failed to fetch",
    });
  });

  it("words the Library Avatar handoff with an inline or secondary reason", async () => {
    expect(libraryAvatarFailureText(new Error("Not found."))).toEqual({
      message:
        "The Library Avatar could not be selected: Not found. Choose an available Avatar below.",
      detail: null,
    });
    await getI18n().changeLanguage("ja");
    expect(libraryAvatarFailureText(new Error("Not found."))).toEqual({
      message:
        "ライブラリのアバターを選択できませんでした。以下から利用可能なアバターを選んでください。",
      detail: "Not found.",
    });
    expect(
      libraryAvatarFailureText(
        new CreatorError("このソースはアバターではありません。"),
      ),
    ).toEqual({
      message:
        "ライブラリのアバターを選択できませんでした: このソースはアバターではありません。 以下から利用可能なアバターを選んでください。",
      detail: null,
    });
  });
});
