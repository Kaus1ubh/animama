import { PARAKEET_DOWNLOADS_OFFERED } from "@/lib/speech/client-parakeet/assets";
import { parakeetSttClient } from "@/lib/speech/client-parakeet/client";
import { senseVoiceSttClient } from "@/lib/speech/client-sensevoice/client";

import type { OfflineSttEngine } from "./routing";
import type { OfflineSttClient } from "./worker-client";

/** Each offline engine's page-side client. */
export const offlineSttClients: Record<OfflineSttEngine, OfflineSttClient> = {
  parakeet: parakeetSttClient,
  sensevoice: senseVoiceSttClient,
};

/**
 * Whether this build installs offline speech sets in the app. Both engines'
 * sets come from the same source (`__CLIENT_*_MODELS__`).
 */
export const OFFLINE_SPEECH_DOWNLOADS_OFFERED = PARAKEET_DOWNLOADS_OFFERED;

/**
 * Session teardown: stop every offline engine's worker now (see
 * `OfflineSttClient.terminate`).
 */
export function terminateOfflineSttWorkers(): void {
  for (const client of Object.values(offlineSttClients)) client.terminate();
}
