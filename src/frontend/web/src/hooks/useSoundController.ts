import { useSoundContext } from "@/ui/sound/SoundProvider";
import { useOptionalSoundContext } from "@/ui/sound/SoundProvider";

export function useSoundController() {
  return useSoundContext();
}

export function useOptionalSoundController() {
  return useOptionalSoundContext();
}
