import { afterEach, describe, expect, it } from "vitest";
import { getI18n } from "react-i18next";

import { creationFailureText, creationIssueText } from "./creationErrors";

afterEach(async () => {
  await getI18n().changeLanguage("en");
});

describe("creation wording", () => {
  it("words failures and issues from their codes", async () => {
    await getI18n().changeLanguage("ja");
    expect(
      creationFailureText({
        code: "anima_creation_invalid",
        message: "The Anima definition is invalid.",
      }),
    ).toEqual({ message: "Anima の定義が無効です。", detail: null });
    expect(
      creationIssueText({
        code: "no_gestures_selected",
        message: "This Anima has no Gestures selected.",
      }).message,
    ).toBe("この Anima にはジェスチャーが選択されていません。");
  });

  it("words Loadout codes reported through creation", () => {
    expect(
      creationIssueText({
        code: "reaction_pool_full",
        message: "The exact typed loadout could not be created.",
      }).message,
    ).toBe(
      "That cell already holds four Reactions. Remove one to add another.",
    );
  });

  it("keeps a multi-cause code's backend cause as detail", async () => {
    const detail = {
      code: "anima_creation_defaults_unavailable",
      message: "The Included starter Avatar is unavailable.",
    };
    expect(creationFailureText(detail)).toEqual({
      message:
        "The default model, Starter Pack or starter Avatar for new Animas is unavailable or needs repair.",
      detail: "The Included starter Avatar is unavailable.",
    });
    await getI18n().changeLanguage("ja");
    expect(creationIssueText(detail)).toEqual({
      message:
        "新しい Anima の既定のモデル、スターターパック、またはスターターアバターが利用できないか、修復が必要です。",
      detail: "The Included starter Avatar is unavailable.",
    });
  });

  it("keeps the creator's own issue text", () => {
    expect(
      creationIssueText({
        code: "draft_invalid",
        message: "Enter a name to continue.",
      }),
    ).toEqual({ message: "Enter a name to continue.", detail: null });
  });

  it("shows no English backend prose as the primary message outside English", async () => {
    const issue = {
      code: "vrm_humanoid_missing",
      message: "The selected media failed structural validation.",
    };
    expect(creationIssueText(issue)).toEqual({
      message: "The selected media failed structural validation.",
      detail: null,
    });
    await getI18n().changeLanguage("ja");
    expect(creationIssueText(issue)).toEqual({
      message: "この項目は確認が必要です。",
      detail: "The selected media failed structural validation.",
    });
    expect(
      creationFailureText({ code: "new_failure", message: "Backend detail" }),
    ).toEqual({
      message: "Anima を作成できませんでした。下書きは保持されています。",
      detail: "Backend detail",
    });
  });
});
