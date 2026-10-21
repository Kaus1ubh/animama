import { describe, expect, it } from "vitest";

import { closeUnspacedGaps, joinSpeechText } from "./speech-text";

describe("joinSpeechText", () => {
  it("separates words of spaced languages with one space", () => {
    expect(joinSpeechText("Hello there", "how are you")).toBe(
      "Hello there how are you",
    );
    expect(joinSpeechText("안녕하세요", "반갑습니다")).toBe(
      "안녕하세요 반갑습니다",
    );
  });

  it("adds no space beside Chinese or Japanese text", () => {
    expect(joinSpeechText("東京に", "行きます。")).toBe("東京に行きます。");
    expect(joinSpeechText("我们明天", "见面")).toBe("我们明天见面");
    expect(joinSpeechText("你好。", "Hello")).toBe("你好。Hello");
    expect(joinSpeechText("Animama", "です")).toBe("Animamaです");
    expect(joinSpeechText("コーヒー", "2杯")).toBe("コーヒー2杯");
  });

  it("closes word gaps inside Chinese and Japanese text only", () => {
    expect(closeUnspacedGaps("群島や 湖で は 必要あり ません。")).toBe(
      "群島や湖では必要ありません。",
    );
    expect(closeUnspacedGaps("我们 明天 见面")).toBe("我们明天见面");
    expect(closeUnspacedGaps("Animama です")).toBe("Animamaです");
    expect(closeUnspacedGaps("안녕하세요 반갑습니다")).toBe(
      "안녕하세요 반갑습니다",
    );
    expect(closeUnspacedGaps("Hello world")).toBe("Hello world");
  });

  it("keeps existing whitespace and empty sides as they are", () => {
    expect(joinSpeechText("Note:\n", "buy milk")).toBe("Note:\nbuy milk");
    expect(joinSpeechText("", "words")).toBe("words");
    expect(joinSpeechText("words", "")).toBe("words");
  });
});
