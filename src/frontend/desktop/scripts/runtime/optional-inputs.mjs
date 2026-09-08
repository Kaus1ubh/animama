import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { normalizeTree, repoRoot, run, sha256, writeJson } from "./common.mjs";
import { assertPortablePath } from "./inventory.mjs";

/** Inventory existing model inputs without advertising an unpublished feature pack. */
export function stageOptionalInputs(target) {
  const source = path.join(repoRoot, "parakeet-tdt-0.6b-v2");
  if (!existsSync(source)) {
    writeJson(path.join(target.output, "optional-inputs.json"), {
      parakeet: "unavailable",
      document_processing: "separate-signed-worker",
    });
    return;
  }
  const destination = path.join(target.output, "pack-inputs/parakeet-stt");
  mkdirSync(destination, { recursive: true });
  const names = run("git", ["ls-files", "-z", "--", "parakeet-tdt-0.6b-v2"], {
    capture: true,
  })
    .split("\0")
    .filter(Boolean)
    .map((name) => name.slice("parakeet-tdt-0.6b-v2/".length))
    .sort();
  const inventory = [];
  for (const name of names) {
    assertPortablePath(name);
    const file = path.join(source, name);
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error("Parakeet inputs must be regular tracked files");
    mkdirSync(path.dirname(path.join(destination, name)), { recursive: true });
    copyFileSync(file, path.join(destination, name));
    inventory.push({
      path: name,
      size_bytes: stat.size,
      sha256: sha256(file),
      license_refs: ["parakeet-input"],
    });
  }
  for (const required of [
    "ATTRIBUTION.md",
    "README.md",
    "encoder-model.int8.onnx",
    "decoder_joint-model.int8.onnx",
    "nemo128.onnx",
    "vocab.txt",
    "config.json",
  ]) {
    if (!inventory.some((item) => item.path === required))
      throw new Error(`Missing Parakeet input: ${required}`);
  }
  writeJson(path.join(target.output, "optional-inputs.json"), {
    schema: "animama-optional-inputs/1",
    parakeet: {
      declared_license: "CC-BY-4.0",
      review: "pending",
      files: inventory,
    },
    document_processing: "separate-signed-worker",
  });
  writeFileSync(
    path.join(destination, "PACK-REVIEW.txt"),
    "Unpublished pack input. Preserve ATTRIBUTION.md and README.md, which identify the exact INT8 model/preprocessor snapshots. Owner approval of the complete inventory remains required.\n",
  );
  normalizeTree(destination);
}
