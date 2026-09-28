import path from "node:path";
import { parseArgs } from "node:util";
import { desktopRoot } from "./common.mjs";
import {
  modelDistribution,
  planModelPublication,
  publishModelObjects,
  stageModelCandidate,
} from "./model-publication.mjs";
import { PublicationError, verifyScanReceipt } from "./publication.mjs";
import { r2Credentials } from "./r2-objects.mjs";

/**
 * Stage, then publish, one tracked model set to R2 under `models/`:
 *
 *   models:stage   --model ID                          copy the verified store set
 *   release:scan   --candidate release/models/ID       secrets/privacy scan
 *   models:publish --model ID --dry-run                list keys, no credentials
 *   models:publish --model ID --confirm-publication    create-only upload
 */
async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2).filter((arg) => arg !== "--"),
    allowPositionals: true,
    options: {
      model: { type: "string" },
      "model-root": { type: "string" },
      "dry-run": { type: "boolean", default: false },
      "confirm-publication": { type: "boolean", default: false },
    },
  });
  const [command] = positionals;
  const modelId = values.model ?? "";
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(modelId))
    throw new PublicationError("Pass --model with a tracked model ID");
  // Fixed beneath the ignored release directory: staging replaces it wholesale.
  const directory = path.join(desktopRoot, "release/models", modelId);

  if (command === "stage") {
    const index = stageModelCandidate({
      modelId,
      directory,
      modelRoot: values["model-root"],
    });
    console.log(
      `Staged ${index.files.length} files. Scan them next: pnpm --filter animama-desktop release:scan --candidate ${path.relative(desktopRoot, directory)}`,
    );
    return;
  }
  if (command !== "publish")
    throw new PublicationError("Use the stage or publish command");

  const { origin, bucket } = modelDistribution();
  const planned = planModelPublication({ modelId, directory, origin });
  if (values["dry-run"]) {
    let scan = "passing";
    try {
      verifyScanReceipt(directory, planned);
    } catch {
      scan = "missing or stale; run the scan before publishing";
    }
    for (const file of planned)
      console.log(`${file.key}  ${file.size_bytes} bytes`);
    console.log(`Scan receipt: ${scan}. Nothing was uploaded.`);
    return;
  }
  if (!values["confirm-publication"])
    throw new PublicationError(
      "Publishing is permanent: pass --confirm-publication after owner approval, or --dry-run to preview",
    );
  // Refuse an unscanned candidate before reading any credential.
  verifyScanReceipt(directory, planned);
  const outcomes = await publishModelObjects({
    directory,
    planned,
    bucket,
    credentials: r2Credentials(),
  });
  for (const { key, outcome } of outcomes) console.log(`${key}  ${outcome}`);
  console.log(
    "Every object was verified anonymously through the public domain.",
  );
}

try {
  await main();
} catch (error) {
  // Only bounded messages are printed; other errors can contain host paths.
  console.error(
    error instanceof PublicationError
      ? error.message
      : "Model publication failed. Set ANIMAMA_PUBLISH_DEBUG=1 to print the underlying error locally.",
  );
  if (process.env.ANIMAMA_PUBLISH_DEBUG === "1") console.error(error);
  process.exitCode = 1;
}
