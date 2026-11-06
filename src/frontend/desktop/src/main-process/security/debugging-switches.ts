/**
 * Command-line switches that open a debugging channel into the app: Chromium's
 * remote debugging and Node's inspector. A packaged app refuses to start with
 * any of them (see `debugging-guard.ts`).
 */
export const debuggingSwitches = [
  "remote-debugging-port",
  "remote-debugging-pipe",
  "inspect",
  "inspect-brk",
  "inspect-wait",
  "inspect-port",
] as const;

/**
 * Whether the command line names a debugging switch, with or without a value.
 * `hasSwitch` is Chromium's own parser (`app.commandLine.hasSwitch`); `argv` is
 * read as well, for the `--name` and `--name=value` spellings Node accepts.
 */
export function namesDebuggingSwitch(
  argv: readonly string[],
  hasSwitch: (name: string) => boolean,
): boolean {
  return debuggingSwitches.some(
    (name) =>
      hasSwitch(name) ||
      argv.some((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`)),
  );
}

/**
 * A packaged app quits when started with a debugging switch, unless its Node
 * inspector is actually running. The shipped fuse wire keeps the inspector
 * off, so only a build with the inspect fuse turned on (the release smoke's
 * copy) can pass. Unpackaged development is unaffected.
 */
export function refusesDebugging(options: {
  isPackaged: boolean;
  inspectorUrl: string | undefined;
  argv: readonly string[];
  hasSwitch: (name: string) => boolean;
}): boolean {
  return (
    options.isPackaged &&
    options.inspectorUrl === undefined &&
    namesDebuggingSwitch(options.argv, options.hasSwitch)
  );
}
