import { describe, expect, it } from "vitest";

import {
  SMART_TURN_FORCE_END_TURN_SHORT_UTTERANCES,
  SMART_TURN_FORCE_END_TURN_SHORT_UTTERANCE_SET,
  normalizeSmartTurnOverrideText,
} from "./smart-turn-short-utterance-overrides";

const ends = (text: string) =>
  SMART_TURN_FORCE_END_TURN_SHORT_UTTERANCE_SET.has(
    normalizeSmartTurnOverrideText(text),
  );

describe("Smart Turn short-reply overrides", () => {
  it("keeps every script's letters while removing punctuation", () => {
    expect(normalizeSmartTurnOverrideText("  Thank you! ")).toBe("thank you");
    expect(normalizeSmartTurnOverrideText("はい。")).toBe("はい");
    expect(normalizeSmartTurnOverrideText("네.")).toBe("네");
    expect(normalizeSmartTurnOverrideText("好的！")).toBe("好的");
    expect(normalizeSmartTurnOverrideText("「了解」")).toBe("了解");
    expect(normalizeSmartTurnOverrideText("잘\u3000자")).toBe("잘 자");
  });

  it("folds fullwidth Latin and halfwidth kana", () => {
    expect(normalizeSmartTurnOverrideText("ＯＫ")).toBe("ok");
    expect(normalizeSmartTurnOverrideText("ｵｯｹｰ")).toBe("オッケー");
  });

  it("ends the turn on short replies in each conversation language", () => {
    for (const reply of [
      "Okay.",
      "はい。",
      "ありがとうございます！",
      "네.",
      "감사합니다.",
      "好的。",
      "謝謝。",
      "唔該",
      "系。",
    ])
      expect(ends(reply), reply).toBe(true);
  });

  it("does not end the turn on hesitation or the start of a longer reply", () => {
    for (const text of [
      "嗯",
      "어",
      "えーと",
      "ええ",
      "そうですね…",
      "そうだね",
      "아니",
      "好的，然后",
      "はい、それで",
      "",
    ])
      expect(ends(text), text).toBe(false);
  });

  it("lists only text that survives normalization unchanged", () => {
    for (const entry of SMART_TURN_FORCE_END_TURN_SHORT_UTTERANCES)
      expect(normalizeSmartTurnOverrideText(entry)).toBe(entry);
  });
});
