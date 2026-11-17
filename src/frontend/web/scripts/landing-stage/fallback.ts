import {
  createStore,
  type StageController,
  type StageState,
} from "./controller";
import { PAGE_NAMESPACES, createLandingI18n, initialLocale } from "./i18n";
import { mountOverlay } from "./overlay";
import {
  createBackdrops,
  openingStop,
  scrollPosition,
  scrollToStop,
} from "./page";
import { mountStills } from "./stills";
import { STAGE_AVATARS, STAGE_STOPS, stopClips } from "./stops";

/**
 * The page without the live 3D stage (`main.ts` decides when): a still of her
 * at each stop, with the captions and demos as usual. A stop that cycles
 * reactions still steps through them, so its mood bloom changes; the gesture
 * chips and Avatar switcher, which need her live, are hidden.
 */

/** How long each reaction shows before the next, in seconds. */
const CLIP_SEC = 4;

export async function startFallback(reason: string) {
  document.body.classList.add("is-fallback");
  const store = createStore<StageState>({
    ready: true,
    active: -1,
    playing: null,
    problems: [],
    intro: "done",
    revealed: true,
    avatar: STAGE_AVATARS[0].id,
    avatarLoading: null,
    fallback: true,
  });
  const cursors = STAGE_STOPS.map(() => 0);
  let timer: number | undefined;

  /** Show clip `index` of a stop; a cycling stop moves on after a while. */
  function playClip(stopIndex: number, index: number) {
    window.clearTimeout(timer);
    const stop = STAGE_STOPS[stopIndex];
    const clips = stopClips(stop, store.get().avatar);
    if (!clips[index]) return;
    store.set({ playing: { stop: stopIndex, clip: index } });
    if (stop.clipMode !== "cycle") return;
    cursors[stopIndex] = (index + 1) % clips.length;
    timer = window.setTimeout(
      () => playClip(stopIndex, cursors[stopIndex]),
      CLIP_SEC * 1000,
    );
  }

  function enterStop(index: number) {
    window.clearTimeout(timer);
    const stop = STAGE_STOPS[index];
    document.body.dataset.ink = stop.ink;
    store.set({ active: index, playing: null });
    if (stopClips(stop, store.get().avatar).length > 0)
      playClip(index, cursors[index]);
  }

  const showBackdrops = createBackdrops(
    document.getElementById("backdrop") as HTMLDivElement,
  );
  const showStills = mountStills(
    document.querySelector(".stage") as HTMLDivElement,
  );
  function update() {
    const { from, blend, active } = scrollPosition();
    showBackdrops(from, blend);
    showStills(from, blend);
    if (active !== store.get().active) enterStop(active);
  }

  const controller: StageController = {
    getState: store.get,
    subscribe: store.subscribe,
    scrollToStop,
    playClip,
    selectAvatar: () => {},
    setHeroTextBottom: () => {},
  };
  window.landingStage = {
    ready: false,
    error: null,
    stop: () => STAGE_STOPS[store.get().active]?.id ?? null,
    problems: [],
    fallback: reason,
  };
  // The page's words and its app components' labels, in the visitor's
  // language.
  mountOverlay(
    document.getElementById("overlay") as HTMLDivElement,
    controller,
    await createLandingI18n(initialLocale(), PAGE_NAMESPACES),
  );
  if (openingStop > 0)
    window.scrollTo({ top: openingStop * window.innerHeight });
  update();
  window.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update);
  window.landingStage.ready = true;
}
