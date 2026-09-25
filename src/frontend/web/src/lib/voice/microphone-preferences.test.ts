import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  microphoneAudioConstraints,
  readSelectedMicrophoneId,
  subscribeSelectedMicrophoneId,
  toMicSensitivity,
  vadThresholdsForSensitivity,
  writeSelectedMicrophoneId,
} from "./microphone-preferences";

/** Minimal browser globals: an event target window with in-memory storage. */
function installWindow(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
) {
  const target = new EventTarget();
  vi.stubGlobal("window", {
    localStorage: storage,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
  });
}

beforeEach(() => {
  const values = new Map<string, string>();
  installWindow({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("microphone sensitivity", () => {
  it("keeps Normal equal to the original voice-detection values", () => {
    expect(vadThresholdsForSensitivity("normal")).toEqual({
      positiveSpeechThreshold: 0.3,
      negativeSpeechThreshold: 0.25,
      minSpeechMs: 180,
    });
  });

  it("orders thresholds so High triggers more easily than Low", () => {
    const low = vadThresholdsForSensitivity("low");
    const high = vadThresholdsForSensitivity("high");
    const normal = vadThresholdsForSensitivity("normal");
    expect(high.positiveSpeechThreshold).toBeLessThan(
      normal.positiveSpeechThreshold,
    );
    expect(low.positiveSpeechThreshold).toBeGreaterThan(
      normal.positiveSpeechThreshold,
    );
    for (const value of [low, normal, high]) {
      expect(value.negativeSpeechThreshold).toBeLessThan(
        value.positiveSpeechThreshold,
      );
    }
  });

  it("treats missing or unknown values as Normal", () => {
    expect(toMicSensitivity(undefined)).toBe("normal");
    expect(toMicSensitivity("loud")).toBe("normal");
    expect(toMicSensitivity("high")).toBe("high");
  });
});

describe("selected microphone", () => {
  it("requests a remembered device as ideal so a missing device falls back", () => {
    expect(microphoneAudioConstraints("usb-mic").deviceId).toEqual({
      ideal: "usb-mic",
    });
    expect(microphoneAudioConstraints(null)).not.toHaveProperty("deviceId");
  });

  it("remembers, clears and notifies about the device choice", () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeSelectedMicrophoneId(onChange);
    writeSelectedMicrophoneId("usb-mic");
    expect(readSelectedMicrophoneId()).toBe("usb-mic");
    writeSelectedMicrophoneId(null);
    expect(readSelectedMicrophoneId()).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("falls back to the default when storage is unavailable", () => {
    const blocked = () => {
      throw new Error("blocked");
    };
    installWindow({ getItem: blocked, setItem: blocked, removeItem: blocked });
    expect(readSelectedMicrophoneId()).toBeNull();
    expect(() => writeSelectedMicrophoneId("usb-mic")).not.toThrow();
  });
});
