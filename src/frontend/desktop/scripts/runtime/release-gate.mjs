const [command, ...args] = process.argv
  .slice(2)
  .filter((value) => value !== "--");
try {
  if (command === "mac")
    await (await import("./release-macos.mjs")).releaseMac(args);
  else if (command === "smoke-mac")
    await (await import("./smoke-macos.mjs")).smokeMac(args);
  else if (command?.includes("windows"))
    throw new Error(
      "Signed Windows releases remain gated on desktop Phase 6; use installer:win for an unsigned local installer",
    );
  else
    throw new Error(
      "Expected mac [--resume-app-notarization <submission-id>] or smoke-mac --artifact <signed.dmg>",
    );
} catch (error) {
  console.error(
    `Desktop ${command}: ${error instanceof Error ? error.message : "release failed"}`,
  );
  process.exitCode = 1;
}
