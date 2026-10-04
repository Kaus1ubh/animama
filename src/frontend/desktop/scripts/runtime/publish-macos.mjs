import { runPublication } from "./publish-release.mjs";

/** Publish the local macOS candidate; see publish-release.mjs. */
await runPublication("darwin-arm64");
