import { describe, expect, it } from "vitest";
import {
  canShowEmotionPopout,
  selectHeaderEmotionState,
} from "./animaModalPresentation";

describe("stationary profile emotion placement", () => {
  it("requires the complete panel, gap and edge margin without moving the profile", () => {
    expect(canShowEmotionPopout(1040, 1440)).toBe(true);
    expect(canShowEmotionPopout(1040, 1432)).toBe(true);
    expect(canShowEmotionPopout(1040, 1431)).toBe(false);
    expect(canShowEmotionPopout(960, 1280)).toBe(false);
    expect(canShowEmotionPopout(100, 767)).toBe(false);
  });
});

describe("header emotion source precedence", () => {
  const persisted = { joy: 24 };
  const runtime = { values: { curiosity: 12 } };
  const input = {
    isChatRoute: true,
    currentAnimaId: "annie",
    runtimeAnimaId: "annie",
    runtimeState: runtime,
    persistedState: persisted,
  };
  it("uses the current chat runtime including neutral and unavailable snapshots", () => {
    expect(selectHeaderEmotionState(input)).toEqual({
      state: runtime,
      sourceLabel: "Live runtime state",
    });
    expect(
      selectHeaderEmotionState({ ...input, runtimeState: {} }).state,
    ).toEqual({});
    expect(
      selectHeaderEmotionState({ ...input, runtimeState: null }).state,
    ).toBeNull();
  });
  it("uses persisted state outside chat and when the mounted runtime belongs to another anima", () => {
    expect(selectHeaderEmotionState({ ...input, isChatRoute: false })).toEqual({
      state: persisted,
      sourceLabel: "Persisted anima state",
    });
    expect(
      selectHeaderEmotionState({ ...input, runtimeAnimaId: "caitlyn" }).state,
    ).toBe(persisted);
    expect(
      selectHeaderEmotionState({ ...input, currentAnimaId: null }).state,
    ).toBe(persisted);
    expect(
      selectHeaderEmotionState({
        ...input,
        isChatRoute: false,
        persistedState: undefined,
      }).state,
    ).toBeNull();
  });
});
