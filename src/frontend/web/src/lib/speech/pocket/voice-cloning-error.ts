import { WordedError } from "@/lib/errors/apiError";

/**
 * A voice-cloning failure whose message is already worded in the UI Locale,
 * so callers show it as it is.
 */
export class PocketVoiceCloningError extends WordedError {
  constructor(message: string) {
    super(message);
    this.name = "PocketVoiceCloningError";
  }
}
