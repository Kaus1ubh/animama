const [command, ...args] = process.argv
  .slice(2)
  .filter((value) => value !== "--");
try {
  if (command === "mac")
    await (await import("./release-macos.mjs")).releaseMac(args);
  else if (command === "smoke-mac")
    await (await import("./smoke-macos.mjs")).smokeMac(args);
  else if (command === "windows")
    await (await import("./release-windows.mjs")).releaseWindows(args);
  else if (command === "smoke-windows")
    throw new Error(
      "Windows installed-artifact smoke is not implemented yet (desktop Phase 7)",
    );
  else
    throw new Error(
      "Expected mac [--resume-app-notarization <submission-id>], windows [--signing-rehearsal] or smoke-mac --artifact <signed.dmg>",
    );
} catch (error) {
  console.error(
    `Desktop ${command}: ${error instanceof Error ? error.message : "release failed"}`,
  );
  process.exitCode = 1;
  // After a build, electron-builder's dependencies can still end the process
  // with a zero code (its own CLI guards the same way), so keep the failure.
  process.on("exit", () => {
    process.exitCode = 1;
  });
}
