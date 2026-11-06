import { Menu, type MenuItemConstructorOptions } from "electron";

import type { ShellStrings } from "../locale/shell-locale.js";

type MenuRole = NonNullable<MenuItemConstructorOptions["role"]>;

const separator: MenuItemConstructorOptions = { type: "separator" };
const item = (role: MenuRole, label: string): MenuItemConstructorOptions => ({
  role,
  label,
});

/**
 * Electron's default application menu (`lib/browser/default-menu.ts` and its
 * role submenus in `menu-item-roles.ts`), spelled out so every label comes from
 * the shell catalog. Roles, and with them each item's behavior, accelerator
 * and native macOS action, stay exactly as Electron defines them. Packaged
 * builds always had an empty Help menu; unpackaged runs drop Electron's own
 * documentation links from it. Packaged builds also leave out the View menu's
 * DevTools item.
 */
export function applicationMenuTemplate(
  { text }: ShellStrings,
  platform: NodeJS.Platform,
  appName: string,
  packaged = false,
): MenuItemConstructorOptions[] {
  const mac = platform === "darwin";
  const name = { name: appName };
  const quit = item(
    "quit",
    mac
      ? text("menu.quitApp", name)
      : text(platform === "win32" ? "menu.exit" : "menu.quit"),
  );
  const appMenu: MenuItemConstructorOptions = {
    role: "appMenu",
    // macOS always titles this menu with the bundle name.
    label: appName,
    submenu: [
      item("about", text("menu.about", name)),
      separator,
      item("services", text("menu.services")),
      separator,
      item("hide", text("menu.hide", name)),
      item("hideOthers", text("menu.hideOthers")),
      item("unhide", text("menu.showAll")),
      separator,
      quit,
    ],
  };
  const macEditing: MenuItemConstructorOptions[] = [
    item("pasteAndMatchStyle", text("menu.pasteAndMatchStyle")),
    item("delete", text("menu.delete")),
    item("selectAll", text("menu.selectAll")),
    separator,
    {
      label: text("menu.substitutions"),
      submenu: [
        item("showSubstitutions", text("menu.showSubstitutions")),
        separator,
        item("toggleSmartQuotes", text("menu.smartQuotes")),
        item("toggleSmartDashes", text("menu.smartDashes")),
        item("toggleTextReplacement", text("menu.textReplacement")),
      ],
    },
    {
      label: text("menu.speech"),
      submenu: [
        item("startSpeaking", text("menu.startSpeaking")),
        item("stopSpeaking", text("menu.stopSpeaking")),
      ],
    },
  ];
  return [
    ...(mac ? [appMenu] : []),
    {
      role: "fileMenu",
      label: text("menu.file"),
      submenu: [mac ? item("close", text("menu.closeWindow")) : quit],
    },
    {
      role: "editMenu",
      label: text("menu.edit"),
      submenu: [
        item("undo", text("menu.undo")),
        item("redo", text("menu.redo")),
        separator,
        item("cut", text("menu.cut")),
        item("copy", text("menu.copy")),
        item("paste", text("menu.paste")),
        ...(mac
          ? macEditing
          : [
              item("delete", text("menu.delete")),
              separator,
              item("selectAll", text("menu.selectAll")),
            ]),
      ],
    },
    {
      role: "viewMenu",
      label: text("menu.view"),
      submenu: [
        item("reload", text("menu.reload")),
        item("forceReload", text("menu.forceReload")),
        // Packaged builds open no DevTools, so they offer no item for it.
        ...(packaged
          ? []
          : [item("toggleDevTools", text("menu.toggleDevTools"))]),
        separator,
        item("resetZoom", text("menu.actualSize")),
        item("zoomIn", text("menu.zoomIn")),
        item("zoomOut", text("menu.zoomOut")),
        separator,
        item("togglefullscreen", text("menu.toggleFullScreen")),
      ],
    },
    {
      // The role keeps macOS's window list and window-management items.
      role: "windowMenu",
      label: text("menu.window"),
      submenu: [
        item("minimize", text("menu.minimize")),
        item("zoom", text("menu.zoom")),
        ...(mac
          ? [separator, item("front", text("menu.bringAllToFront"))]
          : [item("close", text("menu.close"))]),
      ],
    },
    // The role gives macOS its Help search field.
    { role: "help", label: text("menu.help"), submenu: [] },
  ];
}

/** Install (or rebuild, after a locale change) the menu on every platform's menu bar. */
export function installApplicationMenu(
  strings: ShellStrings,
  appName: string,
  packaged: boolean,
): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      applicationMenuTemplate(strings, process.platform, appName, packaged),
    ),
  );
}
