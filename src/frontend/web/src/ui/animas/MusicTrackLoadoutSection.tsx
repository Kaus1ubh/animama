import { useState } from "react";
import { Music2, Pause, Play, Settings2, Trash2 } from "lucide-react";

import type { PyAnimaMusicTrack } from "@animama/runtime-contracts/api-types";
import type {
  PyMusicTrack,
  PyMusicTrackPreview,
} from "@/lib/content/catalogTypes";
import { presentMusicTrack } from "@/lib/loadout/musicTrackPresentation";
import { LoadoutSectionDisclosure } from "@/ui/animas/LoadoutSectionDisclosure";
import { Button } from "@/ui/components/button";
import { useContentPreviewAudio } from "@/ui/content-preview/useContentPreviewAudio";

/** Friendly Music Track controls for one Anima loadout. */
export function MusicTrackLoadoutSection({
  tracks,
  available,
  preview,
  disabled,
  onPreview,
  onAdd,
  onToggle,
  onAutoplay,
  onConfigure,
  onRemove,
}: {
  tracks: PyAnimaMusicTrack[];
  available: PyMusicTrack[];
  preview: PyMusicTrackPreview | null;
  disabled: boolean;
  onPreview: (track: PyAnimaMusicTrack) => void;
  onAdd: (track: PyMusicTrack) => void;
  onToggle: (track: PyAnimaMusicTrack) => void;
  onAutoplay: (track: PyAnimaMusicTrack) => void;
  onConfigure: (track: PyAnimaMusicTrack) => void;
  onRemove: (track: PyAnimaMusicTrack) => void;
}) {
  const audio = useContentPreviewAudio(preview);
  const [expanded, setExpanded] = useState(false);
  return (
    <LoadoutSectionDisclosure
      title="Music"
      headingId="music-heading"
      contentId="music-content"
      expanded={expanded}
      onToggle={() => setExpanded((current) => !current)}
    >
      <div className="space-y-3">
        <div className="grid gap-3">
          {tracks.length ? (
            tracks.map((track) => {
              const row = presentMusicTrack(track);
              return (
                <article
                  key={track.binding_id}
                  className="rounded-xl border p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Music2 className="text-muted-foreground size-4" />
                    <div className="min-w-52 flex-1">
                      <h3 className="font-medium">{row.title}</h3>
                      <p className="text-muted-foreground text-xs">
                        {row.status} · {row.detail}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onPreview(track)}
                    >
                      <Play /> Preview
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={disabled}
                      onClick={() => onToggle(track)}
                    >
                      {track.enabled ? <Pause /> : <Play />}
                      {track.enabled ? "Disable" : "Enable"}
                    </Button>
                    <Button
                      size="sm"
                      variant={track.autoplay ? "default" : "outline"}
                      disabled={disabled || !track.enabled}
                      onClick={() => onAutoplay(track)}
                    >
                      Autoplay
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={disabled}
                      onClick={() => onConfigure(track)}
                    >
                      <Settings2 /> Configure
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={disabled}
                      onClick={() => onRemove(track)}
                    >
                      <Trash2 /> Remove
                    </Button>
                  </div>
                </article>
              );
            })
          ) : (
            <p className="text-muted-foreground rounded-xl border p-4 text-sm">
              No Music Tracks are in this Loadout.
            </p>
          )}
        </div>
        {preview ? (
          <div className="rounded-xl border p-3">
            {audio.url ? (
              <audio controls autoPlay src={audio.url} className="w-full" />
            ) : null}
            {audio.error ? (
              <p className="text-destructive text-sm">{audio.error}</p>
            ) : null}
          </div>
        ) : null}
        {available.length ? (
          <label className="grid max-w-sm gap-1 text-sm">
            Add a Music Track
            <select
              className="bg-background rounded-md border px-3 py-2"
              disabled={disabled}
              value=""
              onChange={(event) => {
                const selected = available.find(
                  (row) => row.item_id === event.target.value,
                );
                if (selected) onAdd(selected);
              }}
            >
              <option value="">Select Music Track…</option>
              {available.map((row) => (
                <option
                  key={`${row.origin}:${row.item_id}`}
                  value={row.item_id}
                >
                  {row.name} {row.origin === "builtin" ? "(Built-in)" : ""}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
    </LoadoutSectionDisclosure>
  );
}
