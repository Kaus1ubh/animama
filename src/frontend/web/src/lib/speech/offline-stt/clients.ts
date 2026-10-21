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
 * Session teardown: stop every offline engine's worker now (see
 * `OfflineSttClient.terminate`).
 */
export function terminateOfflineSttWorkers(): void {
  for (const client of Object.values(offlineSttClients)) client.terminate();
}
