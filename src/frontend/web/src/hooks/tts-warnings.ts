import { getI18n } from "react-i18next";
import { toast } from "sonner";

import { apiErrorLine, uncodedErrorText } from "@/lib/errors/apiError";

/**
 * Word a Text-to-Speech warning from its reason code. Reasons without their
 * own wording (provider and runtime failures that carry a specific message,
 * Pocket voice notices) keep the message they were reported with.
 */
export function ttsWarningText(reason: string, message?: string): string {
  const t = getI18n().getFixedT(null, "app");
  switch (reason) {
    case "browser_tts_unsupported":
    case "browser_tts_missing":
      return t("tts.warnings.browserUnsupported");
    case "browser_tts_error":
      return t("tts.warnings.browserGenerateFailed");
    case "browser_tts_speak_failed":
      return t("tts.warnings.browserPlayFailed");
    case "pocket_tts_unsupported":
      return t("tts.warnings.pocketUnsupported");
    case "pocket_generation_failed":
      return t("tts.warnings.pocketGenerationFailed");
    case "elevenlabs_unsupported":
      return t("tts.warnings.elevenLabsUnsupported");
    case "elevenlabs_missing_persona":
      return t("tts.warnings.elevenLabsMissingAnima");
    case "gemini_unsupported":
      return t("tts.warnings.geminiUnsupported");
    case "gemini_missing_persona":
      return t("tts.warnings.geminiMissingAnima");
    case "elevenlabs_ws_error":
      return t("tts.warnings.elevenLabsConnectionFailed");
    case "elevenlabs_ws_closed":
      return t("tts.warnings.elevenLabsClosedEarly");
    case "elevenlabs_audio_decode_failed":
      return t("tts.warnings.elevenLabsDecodeFailed");
    case "finalized_audio_decode_failed":
      return t("tts.warnings.finalizedDecodeFailed");
    default:
      return message || t("tts.warnings.generic");
  }
}

/** Report that speech is unavailable for a reply, worded in the active UI Locale. */
export function showTtsUnavailable(reason: string, message?: string): void {
  const t = getI18n().getFixedT(null, "app");
  toast.error(t("tts.unavailable"), {
    description: ttsWarningText(reason, message),
  });
}

/**
 * Report a provider or runtime failure. Its English message shows as written
 * in English and as detail under the generic warning elsewhere; reasons with
 * their own wording ignore it.
 */
export function showTtsRuntimeFailure(reason: string, message: string): void {
  const t = getI18n().getFixedT(null, "app");
  showTtsUnavailable(
    reason,
    apiErrorLine(uncodedErrorText(message, t("tts.warnings.generic"))),
  );
}

/** Report a saved Pocket voice that cannot be used this session. */
export function showPocketVoiceUnavailable(
  reason: string,
  message: string,
): void {
  const t = getI18n().getFixedT(null, "app");
  toast.warning(t("tts.pocketVoiceUnavailable"), {
    description: ttsWarningText(reason, message),
  });
}
