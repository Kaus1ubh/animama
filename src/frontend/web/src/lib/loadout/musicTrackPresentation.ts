export type MusicTrackPresentation = {
  id: string;
  title: string;
  status: string;
  detail: string;
};

export function presentMusicTrack(track: {
  binding_id: string;
  name: string;
  duration_seconds: number;
  enabled: boolean;
  autoplay: boolean;
  effective_loop: boolean;
  effective_gain: number;
}): MusicTrackPresentation {
  const minutes = Math.floor(track.duration_seconds / 60);
  const seconds = Math.round(track.duration_seconds % 60)
    .toString()
    .padStart(2, "0");
  return {
    id: track.binding_id,
    title: track.name,
    status: !track.enabled
      ? "Disabled"
      : track.autoplay
        ? "Autoplay"
        : "Enabled",
    detail: `${minutes}:${seconds} · ${track.effective_loop ? "Loop" : "Play once"} · ${Math.round(track.effective_gain * 100)}% gain`,
  };
}
