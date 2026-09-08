/**
 * Short utterances that should be treated as complete turns when spoken alone.
 *
 * All entries are lowercase and should be compared against normalized text
 * (trimmed, punctuation stripped, and whitespace collapsed).
 */
export const SMART_TURN_FORCE_END_TURN_SHORT_UTTERANCES = Object.freeze([
  // Greetings
  "hi",
  "hey",
  "hello",
  "yo",
  "howdy",
  "sup",
  "hiya",
  "hi there",
  "hey there",
  "hello there",
  "good morning",
  "good afternoon",
  "good evening",

  // Short acknowledgements
  "ok",
  "okay",
  "kk",
  "yup",
  "yep",
  "yeah",
  "nah",
  "nope",
  "cool",
  "sounds good",
  "got it",
  "alright",
  "all right",

  // Polite one-shot replies
  "thanks",
  "thank you",
  "thank you!",
  "thank you so much",
  "appreciate it",
  "no thanks",

  // Short closings
  "bye",
  "goodbye",
  "see ya",
  "later",
] as const);

export const SMART_TURN_FORCE_END_TURN_SHORT_UTTERANCE_SET = new Set<string>(
  SMART_TURN_FORCE_END_TURN_SHORT_UTTERANCES.map((value) =>
    value
      .replace(/[^\w\s']/g, "")
      .replace(/\s+/g, " ")
      .trim(),
  ),
);
