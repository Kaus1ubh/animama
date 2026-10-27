import { ipcRenderer } from "electron";

const TITLE_BAR_SET_COLORS_CHANNEL = "anima:title-bar:set-colors";

type TitleBarColors = { color: string; symbolColor: string };

export function createTitleBarBridge() {
  return {
    /** Windows only: recolors the window buttons drawn over the title strip. */
    setColors: async (colors: TitleBarColors) => {
      await ipcRenderer.invoke(TITLE_BAR_SET_COLORS_CHANNEL, colors);
    },
  };
}
