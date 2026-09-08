import type { Locator } from "playwright/test";

import type { EvidenceAttachment } from "../fixtures/animama";
import {
  attachObservationWindow,
  type PlaybackObservation,
} from "./playback-observation";

/** Attach a named diagnostic image beside the runtime facts that produced it. */
export async function attachPlaybackCheckpoint(args: {
  evidence: EvidenceAttachment;
  locator: Locator;
  name: string;
  samples: readonly PlaybackObservation[];
}): Promise<void> {
  const screenshot = await args.locator.screenshot({
    animations: "disabled",
    type: "png",
  });
  await args.evidence.attachBuffer(
    `${args.name}-checkpoint`,
    screenshot,
    "image/png",
  );
  await attachObservationWindow(args.evidence, args.name, args.samples);
}
