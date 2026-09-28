import type { PyModelAssetState } from "@animama/runtime-contracts/api-types";

import { POCKET_VOICES } from "@/lib/speech/pocket/voice-catalog";
import type { PocketVoiceAvailability } from "@/lib/speech/pocket/voice-preferences";

/** Worker URLs for downloadable voices: the downloader's same-origin content route. */
export function pocketVoiceWorkerUrls(): Record<string, string> {
  return Object.fromEntries(
    POCKET_VOICES.filter((voice) => voice.assetId).map((voice) => [
      voice.id,
      `/v1/model-assets/${voice.assetId}/content`,
    ]),
  );
}

type AssetState = Pick<
  PyModelAssetState,
  "id" | "status" | "bytes_downloaded" | "total_bytes"
>;

/**
 * Look up the install state of a downloadable voice from the downloader's asset
 * list. Core voices return null: they always ship with the app.
 */
export function pocketVoiceAvailability(
  assets: readonly AssetState[] | undefined,
): (voiceId: string) => PocketVoiceAvailability | null {
  const byId = new Map((assets ?? []).map((asset) => [asset.id, asset]));
  return (voiceId) => {
    const voice = POCKET_VOICES.find((item) => item.id === voiceId);
    if (!voice?.assetId) return null;
    // Before the list loads (or while it fails), the state is unknown: callers
    // must neither assume "installed" nor request another install.
    if (!assets)
      return { status: "unknown", assetId: voice.assetId, progress: null };
    const asset = byId.get(voice.assetId);
    const total = asset?.total_bytes ?? 0;
    return {
      status: asset?.status ?? "not_installed",
      assetId: voice.assetId,
      progress:
        asset?.status === "downloading" && total > 0
          ? (asset.bytes_downloaded ?? 0) / total
          : null,
    };
  };
}

/**
 * What picking a voice does: `select` loads it now (core or installed);
 * `install` saves it and starts the download; `save` saves it while a download
 * is already running. Downloadable voices that are not installed are never sent
 * to the worker.
 */
export function pocketVoicePickAction(
  availability: PocketVoiceAvailability | null,
): "select" | "install" | "save" {
  if (!availability || availability.status === "installed") return "select";
  return availability.status === "downloading" ? "save" : "install";
}
