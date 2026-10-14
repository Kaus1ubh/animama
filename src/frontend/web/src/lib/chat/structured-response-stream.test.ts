import { describe, expect, it } from "vitest";

import {
  createStructuredResponseStreamState,
  getStructuredAssistantTexts,
  reduceStructuredResponseStream,
  selectStructuredSpeechTtsPayload,
} from "./structured-response-stream";

describe("structured response stream", () => {
  it("accumulates multiple speech deltas into one assistant speech text", () => {
    let state = createStructuredResponseStreamState();

    state = reduceStructuredResponseStream(state, {
      response_part: "speech",
      text: "First sentence.",
      is_delta: true,
      part_index: 0,
    }).state;
    state = reduceStructuredResponseStream(state, {
      response_part: "speech",
      text: " Second sentence.",
      is_delta: true,
      part_index: 1,
    }).state;

    expect(state.speechText).toBe("First sentence. Second sentence.");
    expect(state.speechSegments).toEqual([
      "First sentence.",
      " Second sentence.",
    ]);
    expect(getStructuredAssistantTexts(state)).toEqual([
      "First sentence. Second sentence.",
    ]);
  });

  it("marks an empty final speech marker without changing text", () => {
    let state = createStructuredResponseStreamState();
    state = reduceStructuredResponseStream(state, {
      response_part: "speech",
      text: "Ready.",
      is_delta: true,
      part_index: 0,
      part_final: false,
    }).state;

    const update = reduceStructuredResponseStream(state, {
      response_part: "speech",
      text: "",
      is_delta: true,
      part_index: 1,
      part_final: true,
    });

    expect(update.textChanged).toBe(false);
    expect(update.state.speechText).toBe("Ready.");
    expect(update.state.speechSegments).toEqual(["Ready."]);
    expect(update.state.speechFinal).toBe(true);
    expect(update.state.lastSpeechPartIndex).toBe(1);
  });

  it("replaces streamed speech when a complete non-delta speech event arrives", () => {
    let state = createStructuredResponseStreamState();
    state = reduceStructuredResponseStream(state, {
      response_part: "speech",
      text: "Draft text.",
      is_delta: true,
    }).state;

    state = reduceStructuredResponseStream(state, {
      response_part: "speech",
      text: "Corrected complete text.",
      is_delta: false,
    }).state;

    expect(state.speechText).toBe("Corrected complete text.");
    expect(state.speechSegments).toEqual(["Corrected complete text."]);
    expect(getStructuredAssistantTexts(state)).toEqual([
      "Corrected complete text.",
    ]);
  });

  it("accumulates display deltas as a separate assistant message", () => {
    let state = createStructuredResponseStreamState();
    state = reduceStructuredResponseStream(state, {
      response_part: "speech",
      text: "Short spoken text.",
      is_delta: true,
    }).state;
    state = reduceStructuredResponseStream(state, {
      response_part: "display",
      text: "Visible ",
      is_delta: true,
      part_index: 0,
    }).state;
    state = reduceStructuredResponseStream(state, {
      response_part: "display",
      text: "details.",
      is_delta: true,
      part_index: 1,
      part_final: true,
    }).state;

    expect(state.displayText).toBe("Visible details.");
    expect(state.displayFinal).toBe(true);
    expect(getStructuredAssistantTexts(state)).toEqual([
      "Short spoken text.",
      "Visible details.",
    ]);
  });

  it("does not duplicate display text that is equal to speech", () => {
    let state = createStructuredResponseStreamState();
    state = reduceStructuredResponseStream(state, {
      response_part: "speech",
      text: "Same text.",
      is_delta: true,
    }).state;
    state = reduceStructuredResponseStream(state, {
      response_part: "display",
      text: "Same text.",
      is_delta: true,
    }).state;

    expect(getStructuredAssistantTexts(state)).toEqual(["Same text."]);
  });

  it("tolerates missing and unknown metadata", () => {
    let state = createStructuredResponseStreamState();
    const ignored = reduceStructuredResponseStream(state, {
      response_part: "unknown",
      text: "Ignored.",
      is_delta: true,
    });

    expect(ignored.handled).toBe(false);
    expect(ignored.state).toBe(state);

    state = reduceStructuredResponseStream(state, {
      response_part: "speech",
      text: "Complete fallback text.",
    }).state;

    expect(state.speechText).toBe("Complete fallback text.");
    expect(state.speechFinal).toBe(false);
    expect(state.lastSpeechPartIndex).toBeNull();
  });

  it("speaks structured speech deltas as written", () => {
    expect(
      selectStructuredSpeechTtsPayload({
        visibleText: " It costs $5.99 at 3:30 pm.",
        isDelta: true,
        structuredTtsAppended: false,
      }),
    ).toEqual({ text: " It costs $5.99 at 3:30 pm." });
  });

  it("speaks a segment in any language as written", () => {
    expect(
      selectStructuredSpeechTtsPayload({
        visibleText: "おはようございます。",
        isDelta: true,
        structuredTtsAppended: false,
      }),
    ).toEqual({ text: "おはようございます。" });
  });

  it("does not select TTS text for an empty final marker", () => {
    expect(
      selectStructuredSpeechTtsPayload({
        visibleText: "",
        isDelta: true,
        structuredTtsAppended: true,
      }),
    ).toBeNull();
  });

  it("speaks complete non-delta fallback speech once", () => {
    expect(
      selectStructuredSpeechTtsPayload({
        visibleText: "Visible complete text.",
        isDelta: false,
        structuredTtsAppended: false,
      }),
    ).toEqual({ text: "Visible complete text." });
  });

  it("does not re-select replacement speech after structured TTS was appended", () => {
    expect(
      selectStructuredSpeechTtsPayload({
        visibleText: "Corrected complete text.",
        isDelta: false,
        structuredTtsAppended: true,
      }),
    ).toBeNull();
  });
});
