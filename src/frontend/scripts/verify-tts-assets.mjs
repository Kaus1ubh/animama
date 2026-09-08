#!/usr/bin/env node
import { access, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.cwd());
const publicRoot = path.join(root, "web", "public", "tts");
const onnxPublicRoot = path.join(root, "web", "public", "onnx");
const ortVersion = "1.24.2";
const ortDir = path.join(onnxPublicRoot, "ort", ortVersion);

const requiredFiles = [
  "workers/inference-worker.js",
  // "workers/alignment-worker.js",
  "audio/pcm-processor.worklet.js",
  "vendor/sentencepiece.js",
];

const requiredOnnxFiles = [
  `ort/${ortVersion}/ort.min.mjs`,
  "models/pocket-tts/tokenizer.model",
  "models/pocket-tts/voices.bin",
  "models/pocket-tts/mimi_encoder.onnx",
  "models/pocket-tts/text_conditioner.onnx",
  "models/pocket-tts/flow_lm_main_int8.onnx",
  "models/pocket-tts/flow_lm_flow_int8.onnx",
  "models/pocket-tts/mimi_decoder_int8.onnx",
];

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function verifyOrtSidecars() {
  let files = [];
  try {
    files = await readdir(ortDir);
  } catch {
    return {
      ok: false,
      errors: [`onnx/ort/${ortVersion} directory missing`],
    };
  }

  const mjsSidecars = files.filter((name) => /^ort-wasm-.*\.mjs$/u.test(name));
  const wasmSidecars = files.filter((name) =>
    /^ort-wasm-.*\.wasm$/u.test(name),
  );

  const errors = [];
  if (mjsSidecars.length === 0) {
    errors.push(`Missing ort-wasm-*.mjs sidecars in onnx/ort/${ortVersion}`);
  }
  if (wasmSidecars.length === 0) {
    errors.push(`Missing ort-wasm-*.wasm sidecars in onnx/ort/${ortVersion}`);
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

async function main() {
  const missing = [];

  for (const relativeFile of requiredFiles) {
    const absoluteFile = path.join(publicRoot, relativeFile);
    if (!(await exists(absoluteFile))) {
      missing.push(relativeFile);
    }
  }

  for (const relativeFile of requiredOnnxFiles) {
    const absoluteFile = path.join(onnxPublicRoot, relativeFile);
    if (!(await exists(absoluteFile))) {
      missing.push(`../onnx/${relativeFile}`);
    }
  }

  const ort = await verifyOrtSidecars();

  if (missing.length > 0 || !ort.ok) {
    console.error("TTS asset verification failed.");
    for (const file of missing) {
      if (file.startsWith("../onnx/")) {
        console.error(`- Missing: web/public/${file.slice(3)}`);
      } else {
        console.error(`- Missing: web/public/tts/${file}`);
      }
    }
    for (const error of ort.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log("TTS assets verified.");
}

main().catch((error) => {
  console.error("TTS asset verification failed with an unexpected error.");
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : error,
  );
  process.exit(1);
});
