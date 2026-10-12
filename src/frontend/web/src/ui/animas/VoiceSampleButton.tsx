import { LoaderCircle, Play, Square } from "lucide-react";

import type {
  createVoiceSamplePlayer,
  VoiceSampleSource,
  VoiceSampleState,
} from "@/lib/speech/pocket/voice-sample-player";
import { Button } from "@/ui/components/button";

/** A voice list and its selected voice share one player, owned by the picker. */
export type VoiceSamplePlayback = {
  sample: VoiceSampleState;
  player: ReturnType<typeof createVoiceSamplePlayer>;
};

/** Keep play/stop feedback identical beside the selection and in each list row. */
export function VoiceSampleButton({
  voice,
  sample,
  player,
  compact = false,
}: VoiceSamplePlayback & {
  voice: VoiceSampleSource | undefined;
  compact?: boolean;
}) {
  const active =
    sample.voiceId === voice?.id &&
    (sample.status === "playing" || sample.status === "loading");
  const unavailable =
    voice && "sampleUnavailable" in voice ? voice.sampleUnavailable : null;
  const label = unavailable
    ? `${voice!.name}: ${unavailable}`
    : voice
      ? `${active ? "Stop" : "Play"} ${voice.name} sample`
      : "No sample available for this voice";
  return (
    <Button
      type="button"
      variant={compact ? "ghost" : "outline"}
      size={compact ? "icon-sm" : "icon"}
      disabled={!voice || Boolean(unavailable)}
      className="shrink-0"
      aria-label={label}
      title={label}
      onClick={() => voice && !unavailable && void player.play(voice)}
    >
      {active ? (
        sample.status === "loading" ? (
          <LoaderCircle className="animate-spin motion-reduce:animate-none" />
        ) : (
          <Square />
        )
      ) : (
        <Play />
      )}
    </Button>
  );
}
