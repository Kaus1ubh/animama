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
  textBasis?: "gruut_text_with_ws";
};

export type StructuredSpeechVisemePayload = {
  tokenizedText: string | null;
  phonemizedText: string[][];
};

export type AccumulatedStructuredSpeechVisemeInputs = {
  tokenizedText: string | null;
  phonemizedText: string[][];
};

export type SelectStructuredSpeechTtsPayloadArgs = {
  visibleText?: string | null;
  ttsText?: string | null;
  ttsTextBasis?: string | null;
  isDelta: boolean;
  structuredTtsAppended: boolean;
};

export type SelectStructuredSpeechVisemePayloadArgs = {
  ttsPayload: StructuredSpeechTtsPayload | null;
  ttsPhonemizedText?: string[][] | null;
  phonemizedText?: string[][] | null;
  tokenizedText?: string | null;
  fallbackTokenizedText?: string | null;
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

function hasPhonemizedText(
  value: string[][] | null | undefined,
): value is string[][] {
  return Array.isArray(value) && value.length > 0;
}

function joinTokenizedVisemeText(
  previous: string | null,
  next: string | null,
): string | null {
  const prior = typeof previous === "string" ? previous : "";
  const addition = typeof next === "string" ? next : "";
  if (!prior.trim()) return addition.trim() || null;
  if (!addition.trim()) return prior;
  if (/\s$/.test(prior) || /^\s/.test(addition)) {
    return `${prior}${addition}`.replace(/\s+/g, " ").trim();
  }
  return `${prior} ${addition}`.replace(/\s+/g, " ").trim();
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

export function getStructuredAssistantTexts(
  state: StructuredResponseStreamState,
): string[] {
  const speech = state.speechText.trim();
  const display = state.displayText.trim();
  const texts = speech ? [speech] : [];
  if (display && display !== speech) {
    texts.push(display);
  }
  return texts;
}

export function selectStructuredSpeechTtsPayload({
  visibleText,
  ttsText,
  ttsTextBasis,
  isDelta,
  structuredTtsAppended,
}: SelectStructuredSpeechTtsPayloadArgs): StructuredSpeechTtsPayload | null {
  if (!isDelta && structuredTtsAppended) {
    return null;
  }

  if (
    ttsTextBasis === "gruut_text_with_ws" &&
    typeof ttsText === "string" &&
    ttsText.trim()
  ) {
    return {
      text: ttsText,
      textBasis: "gruut_text_with_ws",
    };
  }

  if (typeof visibleText !== "string" || !visibleText.trim()) {
    return null;
  }

  return { text: visibleText };
}

export function selectStructuredSpeechVisemePayload({
  ttsPayload,
  ttsPhonemizedText,
  phonemizedText,
  tokenizedText,
  fallbackTokenizedText,
}: SelectStructuredSpeechVisemePayloadArgs): StructuredSpeechVisemePayload | null {
  if (!ttsPayload) return null;

  if (
    ttsPayload.textBasis === "gruut_text_with_ws" &&
    hasPhonemizedText(ttsPhonemizedText)
  ) {
    return {
      tokenizedText: ttsPayload.text,
      phonemizedText: ttsPhonemizedText,
    };
  }

  if (!hasPhonemizedText(phonemizedText)) {
    return null;
  }

  return {
    tokenizedText: tokenizedText ?? fallbackTokenizedText ?? ttsPayload.text,
    phonemizedText,
  };
}

export function appendStructuredSpeechVisemeInputs(
  current: AccumulatedStructuredSpeechVisemeInputs | null,
  payload: StructuredSpeechVisemePayload,
): AccumulatedStructuredSpeechVisemeInputs {
  return {
    tokenizedText: joinTokenizedVisemeText(
      current?.tokenizedText ?? null,
      payload.tokenizedText,
    ),
    phonemizedText: [
      ...(current?.phonemizedText ?? []),
      ...payload.phonemizedText,
    ],
  };
}
