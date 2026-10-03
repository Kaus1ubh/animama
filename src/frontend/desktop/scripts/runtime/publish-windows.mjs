import { runPublication } from "./publish-release.mjs";

/** Publish the local Windows candidate; see publish-release.mjs. */
await runPublication("win32-x64");
