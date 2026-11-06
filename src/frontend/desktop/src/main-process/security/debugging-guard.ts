import { app } from "electron";
import { url as inspectorUrl } from "node:inspector";

import { refusesDebugging } from "./debugging-switches.js";

// main.ts imports this module first. A packaged app started with a debugging
// switch exits here, before any other start-up code opens a window, creates a
// session, writes a log or starts the runtime.
if (
  refusesDebugging({
    isPackaged: app.isPackaged,
    inspectorUrl: inspectorUrl(),
    argv: process.argv,
    hasSwitch: (name) => app.commandLine.hasSwitch(name),
  })
) {
  app.exit(1);
  // Hold back main.ts, whose body is the rest of start-up, until the exit lands.
  await new Promise<never>(() => undefined);
}
