import { useEffect } from "react";

/** `#rrggbb` for any CSS color, read back from one painted canvas pixel. */
export function cssColorToHex(
  cssColor: string,
  context: CanvasRenderingContext2D,
): string {
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = cssColor;
  context.fillRect(0, 0, 1, 1);
  const [red = 0, green = 0, blue = 0] = context.getImageData(0, 0, 1, 1).data;
  return `#${[red, green, blue]
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * On Windows the main window's minimize, maximize and close buttons are drawn
 * over the app's title strip. Keeps them in the page's background and text
 * colors as the theme or Appearance colors change. A no-op elsewhere.
 */
export function useDesktopTitleBarColors(): void {
  useEffect(() => {
    const bridge = window.animamaDesktop;
    const titleBar = bridge?.titleBar;
    if (bridge?.windowRole !== "main" || bridge.platform !== "win32") return;
    if (!titleBar) return;
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;

    let sentColors = "";
    const sync = () => {
      const style = getComputedStyle(document.body);
      const colors = {
        color: cssColorToHex(style.backgroundColor, context),
        symbolColor: cssColorToHex(style.color, context),
      };
      const key = `${colors.color} ${colors.symbolColor}`;
      if (key === sentColors) return;
      sentColors = key;
      void titleBar.setColors(colors).catch(() => {});
    };
    sync();
    // The theme toggles a class on <html>; Appearance colors are a <style>.
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    observer.observe(document.head, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, []);
}
