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
    await (await import("./smoke-windows.mjs")).smokeWindows(args);
  else
    throw new Error(
      "Expected mac [--resume-app-notarization <submission-id>], windows [--signing-rehearsal], smoke-mac --artifact <signed.dmg> or smoke-windows --artifact <setup.exe>",
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
