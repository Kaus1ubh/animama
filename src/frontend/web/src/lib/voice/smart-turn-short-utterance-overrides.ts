/**
 * Short utterances that should be treated as complete turns when spoken alone,
 * in every conversation language. Words that also open a longer turn while the
 * speaker thinks are left out: 嗯 and 어, Japanese ええ, そうだね and そうですね,
 * and Korean 아니 (아니요 stays).
 *
 * Compare against `normalizeSmartTurnOverrideText` output.
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
  "thank you so much",
  "appreciate it",
  "no thanks",

  // Short closings
  "bye",
  "goodbye",
  "see ya",
  "later",

  // Japanese
  "はい",
  "うん",
  "いいえ",
  "ううん",
  "なるほど",
  "わかった",
  "わかりました",
  "了解",
  "オッケー",
  "おはよう",
  "おはようございます",
  "こんにちは",
  "こんばんは",
  "ありがとう",
  "ありがとうございます",
  "どうも",
  "またね",
  "じゃあね",
  "バイバイ",
  "おやすみ",
  "おやすみなさい",
  "さようなら",

  // Korean
  "네",
  "예",
  "응",
  "아니요",
  "그래",
  "좋아",
  "좋아요",
  "알겠어",
  "알겠어요",
  "알겠습니다",
  "오케이",
  "안녕",
  "안녕하세요",
  "고마워",
  "고마워요",
  "감사합니다",
  "잘 자",
  "또 봐",
  "안녕히 가세요",

  // Chinese (Simplified and Traditional; Cantonese under zh-Hant)
  "好",
  "好的",
  "是的",
  "对",
  "對",
  "行",
  "可以",
  "没问题",
  "沒問題",
  "知道了",
  "明白了",
  "不用了",
  "你好",
  "早上好",
  "早安",
  "晚上好",
  "谢谢",
  "謝謝",
  "多谢",
  "多謝",
  "唔該",
  "係",
  // SenseVoice writes Cantonese 係 with the Simplified 系, which the
  // Traditional conversion keeps.
  "系",
  "再见",
  "再見",
  "拜拜",
  "晚安",
] as const);

/**
 * Compare transcribed text with the list: Unicode compatibility forms folded
 * (fullwidth Latin, halfwidth kana), lowercase, punctuation and symbols
 * removed in any script, whitespace collapsed. Letters and marks of every
 * script are kept, so Japanese, Korean and Chinese text survives.
 */
export function normalizeSmartTurnOverrideText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s']/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

export const SMART_TURN_FORCE_END_TURN_SHORT_UTTERANCE_SET = new Set<string>(
  SMART_TURN_FORCE_END_TURN_SHORT_UTTERANCES.map(
    normalizeSmartTurnOverrideText,
  ),
);
