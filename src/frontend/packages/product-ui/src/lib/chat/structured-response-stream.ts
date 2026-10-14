import { hideSpeechTags } from "./audio-tags";

export type StructuredResponsePart = "speech" | "display";

export type StructuredResponseStreamEvent = {
  response_part?: StructuredResponsePart | string | null;
  text?: string | null;
  is_delta?: boolean | null;
  part_index?: number | null;
  part_final?: boolean | null;
};

export type StructuredResponseStreamState = {
  speechText: string;
  speechSegments: string[];
  speechFinal: boolean;
  displayText: string;
  displayFinal: boolean;
  lastSpeechPartIndex: number | null;
  lastDisplayPartIndex: number | null;
};

export type StructuredResponseStreamUpdate = {
  state: StructuredResponseStreamState;
  handled: boolean;
  part: StructuredResponsePart | null;
  textChanged: boolean;
  partFinal: boolean;
};

export type StructuredSpeechTtsPayload = {
  text: string;
};

export type SelectStructuredSpeechTtsPayloadArgs = {
  visibleText?: string | null;
  isDelta: boolean;
  structuredTtsAppended: boolean;
};

export function createStructuredResponseStreamState(): StructuredResponseStreamState {
  return {
    speechText: "",
    speechSegments: [],
    speechFinal: false,
    displayText: "",
    displayFinal: false,
    lastSpeechPartIndex: null,
    lastDisplayPartIndex: null,
  };
}

export function isStructuredResponsePart(
  part: StructuredResponseStreamEvent["response_part"],
): part is StructuredResponsePart {
  return part === "speech" || part === "display";
}

export function reduceStructuredResponseStream(
  state: StructuredResponseStreamState,
  event: StructuredResponseStreamEvent,
): StructuredResponseStreamUpdate {
  const part = event.response_part;
  if (!isStructuredResponsePart(part)) {
    return {
      state,
      handled: false,
      part: null,
      textChanged: false,
      partFinal: false,
    };
  }

  const text = typeof event.text === "string" ? event.text : "";
  const isDelta = event.is_delta === true;
  const partFinal = event.part_final === true;

  if (part === "speech") {
    const nextText = isDelta ? state.speechText + text : text;
    const nextSegments = isDelta
      ? text
        ? state.speechSegments.concat(text)
        : state.speechSegments
      : text
        ? [text]
        : [];
    return {
      state: {
        ...state,
        speechText: nextText,
        speechSegments: nextSegments,
        speechFinal: state.speechFinal || partFinal,
        lastSpeechPartIndex:
          typeof event.part_index === "number"
            ? event.part_index
            : state.lastSpeechPartIndex,
      },
      handled: true,
      part,
      textChanged: nextText !== state.speechText,
      partFinal,
    };
  }

  const nextText = isDelta ? state.displayText + text : text;
  return {
    state: {
      ...state,
      displayText: nextText,
      displayFinal: state.displayFinal || partFinal,
      lastDisplayPartIndex:
        typeof event.part_index === "number"
          ? event.part_index
          : state.lastDisplayPartIndex,
    },
    handled: true,
    part,
    textChanged: nextText !== state.displayText,
    partFinal,
  };
}

/**
 * A reply's bubbles: its speech with the audio tags hidden (a tag-only speech
 * shows none), then its display unless it repeats the speech, as written or as
 * shown.
 */
export function replyBubbleTexts(speech: string, display: string): string[] {
  const rawSpeech = speech.trim();
  const visibleSpeech = hideSpeechTags(rawSpeech);
  const visibleDisplay = display.trim();
  const texts = visibleSpeech ? [visibleSpeech] : [];
  if (
    visibleDisplay &&
    visibleDisplay !== visibleSpeech &&
    visibleDisplay !== rawSpeech
  ) {
    texts.push(visibleDisplay);
  }
  return texts;
}

export function getStructuredAssistantTexts(
  state: StructuredResponseStreamState,
): string[] {
  return replyBubbleTexts(state.speechText, state.displayText);
}

export function selectStructuredSpeechTtsPayload({
  visibleText,
  isDelta,
  structuredTtsAppended,
}: SelectStructuredSpeechTtsPayloadArgs): StructuredSpeechTtsPayload | null {
  if (!isDelta && structuredTtsAppended) {
    return null;
  }

  if (typeof visibleText !== "string" || !visibleText.trim()) {
    return null;
  }

  return { text: visibleText };
}
