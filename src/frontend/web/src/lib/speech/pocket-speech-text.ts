/**
 * The text Pocket TTS speaks for a reply: English with numbers, symbols and
 * abbreviations spelled out, and vocal tags and emoji left out, since Pocket
 * cannot perform them. Lip-sync plans Pocket speech from the same text.
 */

import { spellOutEnglish } from "@/lib/lipsync/text/spell-out-english";
import { stripTags } from "@/lib/lipsync/text/tags";

export function pocketSpeechText(text: string): string {
  return spellOutEnglish(stripTags(text));
}
