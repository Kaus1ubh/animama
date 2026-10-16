import { useCallback, useMemo, useRef } from "react";

import type { AnimaPoseClipEvent } from "@/lib/avatar/poses/animaPoseClip";
import { validateAvatarEffectDefinition } from "@/lib/avatar/vfx/definition";
import type { EffectSource } from "@/lib/avatar/vfx/effectSource";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/select";
import type { AvatarEffectUseSource } from "@/ui/pose-creator/avatarEffectUse";
import {
  PoseCreatorAvatarEffectUseSection,
  useAvatarEffectUse,
} from "@/ui/pose-creator/PoseCreatorAvatarEffectUse";
import type { PoseCreatorClipEventDraftPatch } from "@/ui/pose-creator/poseCreatorClipAuthoring";

import type { TuneEvent, TuneSound } from "./model";

/*
 * The Action creator's "This use" section on the tuning page: an
 * `avatar_vfx` event's placement, look and motion for this use only, saved
 * into the event's `override` exactly as the creator saves it (ADR 0025).
 * The page supplies the effect's definition from its preview media instead
 * of a mounted runtime.
 */

/**
 * What the section needs to know about the effect: its validated definition
 * and the sounds it declares (named from the sound list), the effect's own
 * first, as `avatarEffectUseSource` orders them. Null when the definition
 * isn't a valid `/2` one.
 */
export function placementSource(
  effect: EffectSource,
  sounds: Map<string, TuneSound>,
): AvatarEffectUseSource | null {
  let definition;
  try {
    definition = validateAvatarEffectDefinition(effect.definition);
  } catch {
    return null;
  }
  return {
    definition,
    sounds: Object.entries(effect.soundCueIds ?? {})
      .map(([alias, ref]) => ({ alias, label: sounds.get(ref)?.name ?? alias }))
      .sort(
        (left, right) =>
          Number(right.alias === definition.soundAlias) -
            Number(left.alias === definition.soundAlias) ||
          left.label.localeCompare(right.label),
      ),
  };
}

export function PlacementSection({
  event,
  effect,
  sounds,
  onOverride,
}: {
  event: TuneEvent;
  effect: EffectSource;
  sounds: Map<string, TuneSound>;
  /**
   * The event's new override (undefined removes it: Reset to effect). `key`
   * groups the changes of one focus visit into one Undo step, as the Action
   * creator groups them.
   */
  onOverride: (
    override: TuneEvent["override"] | undefined,
    key: string,
  ) => void;
}) {
  const visit = useRef(0);
  const source = useMemo(
    () => placementSource(effect, sounds),
    [effect, sounds],
  );
  const onUpdate = useCallback(
    (patch: PoseCreatorClipEventDraftPatch) => {
      if ("override" in patch)
        onOverride(
          (patch.override ?? undefined) as TuneEvent["override"] | undefined,
          `place:${event.id}:${visit.current}`,
        );
    },
    [event.id, onOverride],
  );
  const use = useAvatarEffectUse(
    event as unknown as AnimaPoseClipEvent,
    source,
    onUpdate,
  );
  if (!source)
    return (
      <p className="text-muted-foreground text-xs">
        This effect&apos;s definition can&apos;t be placed per use.
      </p>
    );
  if (!use) return null;
  return (
    <div
      onFocus={() => {
        visit.current += 1;
      }}
    >
      {use.source.sounds.length > 1 && (
        // A merged effect declares several sounds; each use picks one.
        <label className="mb-2 flex items-center gap-2 text-xs">
          Sound for this use
          <Select value={use.soundAlias ?? ""} onValueChange={use.chooseSound}>
            <SelectTrigger className="h-8 w-56" aria-label="Sound for this use">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {use.source.sounds.map((sound) => (
                <SelectItem key={sound.alias} value={sound.alias}>
                  {sound.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      )}
      <PoseCreatorAvatarEffectUseSection use={use} disabled={false} />
    </div>
  );
}
