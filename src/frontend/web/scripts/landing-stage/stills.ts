import { STAGE_STOPS } from "./stops";

/** Stills of her at each stop, `<stop id>-<wide|tall>.webp` (`landing:stills`). */
const STILLS = import.meta.glob<string>("./stills/*.webp", {
  eager: true,
  query: "?url",
  import: "default",
});

/** Screens narrower than the stage's `tall` framing (4:5) get its stills. */
const TALL_MEDIA = "(max-aspect-ratio: 4/5)";

/**
 * Where the live 3D stage cannot run: a still of her at each stop, in
 * `container` where the canvas would be. The returned function cross-fades
 * them for a scroll position (`from`, `blend`), as the backdrops do.
 */
export function mountStills(container: HTMLElement) {
  const root = document.createElement("div");
  root.className = "stills";
  root.setAttribute("aria-hidden", "true");
  const pictures = STAGE_STOPS.map(({ id }) => {
    const picture = document.createElement("picture");
    const wide = STILLS[`./stills/${id}-wide.webp`];
    const tall = STILLS[`./stills/${id}-tall.webp`];
    if (tall) {
      const source = document.createElement("source");
      source.media = TALL_MEDIA;
      source.srcset = tall;
      picture.append(source);
    }
    if (wide) {
      const image = document.createElement("img");
      image.src = wide;
      image.alt = "";
      image.decoding = "async";
      picture.append(image);
    }
    root.append(picture);
    return picture;
  });
  container.append(root);
  return (from: number, blend: number) =>
    pictures.forEach((picture, index) => {
      picture.style.opacity = String(
        index === from ? 1 - blend : index === from + 1 ? blend : 0,
      );
    });
}
