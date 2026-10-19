import { afterEach, describe, expect, it } from "vitest";
import { getI18n } from "react-i18next";

import { loadoutFailureText, loadoutWarningText } from "./loadoutErrors";

afterEach(async () => {
  await getI18n().changeLanguage("en");
});

describe("Loadout failures", () => {
  it("words a generated-client failure body from its code", () => {
    expect(
      loadoutFailureText(
        { detail: { code: "loadout_revision_conflict", current_revision: 4 } },
        "Review failed.",
      ),
    ).toEqual({
      message:
        "Behavior changed since you opened it. Review the change again.",
      detail: null,
    });
  });

  it("uses the failure wording for a code whose warning needs parameters", () => {
    expect(
      loadoutFailureText(
        { detail: { code: "gesture_semantic_key_conflict" } },
        "Review failed.",
      ).message,
    ).toBe(
      "The Gesture's semantic key conflicts with another equipped Gesture.",
    );
  });

  it("names the failed action for an unworded code or a validation body", () => {
    expect(
      loadoutFailureText({ detail: { code: "new_code" } }, "Update failed."),
    ).toEqual({ message: "Update failed.", detail: null });
    expect(
      loadoutFailureText({ detail: [{ loc: ["body"] }] }, "Review failed.")
        .message,
    ).toBe("Review failed.");
  });

  it("keeps a local error's English as detail outside English", async () => {
    await getI18n().changeLanguage("ja");
    const text = loadoutFailureText(
      new Error("The Anima preview context is still loading."),
      getI18n().t("errors:loadout.previewFailed"),
    );
    expect(text.message).toBe(getI18n().t("errors:loadout.previewFailed"));
    expect(text.detail).toBe("The Anima preview context is still loading.");
  });
});

describe("Loadout warnings", () => {
  it("word warnings from their code and parameters", async () => {
    await getI18n().changeLanguage("ja");
    expect(
      loadoutWarningText({
        code: "starter_gesture_unavailable",
        message: "Included Gesture wave is unavailable.",
        params: { semanticKey: "wave" },
      }),
    ).toBe("同梱ジェスチャー wave は利用できません。");
  });

  it("fall back to the backend message for an unworded code", () => {
    expect(
      loadoutWarningText({ code: "legacy_binding", message: "Legacy." }),
    ).toBe("Legacy.");
  });
});
