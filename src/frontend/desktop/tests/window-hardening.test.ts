import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = new URL("../src/", import.meta.url);

/** Every main-process source file that creates a window. */
function windowSources(): string[] {
  return readdirSync(source, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
    .filter((file) =>
      readFileSync(new URL(file, source), "utf8").includes(
        "new BrowserWindow(",
      ),
    )
    .sort();
}

describe("packaged windows", () => {
  it("are created only where this check expects", () => {
    expect(
      windowSources().map((file) => file.split(path.sep).join("/")),
    ).toEqual([
      "main-process/pip/pip-window-manager.ts",
      "main-process/quick-chat/quick-chat-window-manager.ts",
      "main-process/runtime/recovery.ts",
      "main-process/window/create-window.ts",
    ]);
  });

  it.each(windowSources())("%s opens no DevTools when packaged", (file) => {
    const windows = readFileSync(new URL(file, source), "utf8")
      .split("new BrowserWindow(")
      .slice(1);
    for (const options of windows) {
      // The window's own webPreferences block, up to its closing brace.
      const preferences = options.slice(options.indexOf("webPreferences: {"));
      expect(preferences.slice(0, preferences.indexOf("}"))).toContain(
        "devTools: !app.isPackaged",
      );
    }
  });
});
