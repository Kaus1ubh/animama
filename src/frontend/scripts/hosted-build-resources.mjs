/** The digest is over pre-addressed emitted bytes: it never hashes its own URL. */
import { createHash } from "node:crypto";
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  javascriptLicenses,
  licenseRecordFiles,
} from "../desktop/scripts/runtime/licenses.mjs";
import { resolveBrowserRuntimeAssets } from "./browser-runtime-assets.mjs";

const frontend = fileURLToPath(new URL("..", import.meta.url));
const repository = path.resolve(frontend, "../..");
export const TEMPLATE_BASE = "/__animama_resource_template__/";
const sha = (data) => createHash("sha256").update(data).digest("hex");
const canonical = (value) => {
  const ordered = (v) =>
    Array.isArray(v)
      ? v.map(ordered)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, ordered(v[k])]),
          )
        : v;
  return Buffer.from(JSON.stringify(ordered(value)) + "\n");
};
const optionalModels = [
  "parakeet-tdt-0.6b-v2",
  "parakeet-tdt-0.6b-v2-webgpu",
  "pocket-tts-voice-cloning",
  "pocket-tts-voices",
];

/** Exact same-origin addresses for independently admitted optional model catalogs. */
export function hostedLazyResources() {
  return optionalModels.map((id) => {
    const data = readFileSync(
      path.join(repository, "models", id, "manifest.json"),
    );
    const digest = sha(data);
    return {
      id,
      version: `sha256-${digest}`,
      manifest: `resource-manifests/${id}/manifest.json`,
      manifest_sha256: digest,
      route_prefix: `/_animama/models/${id}/${digest}/`,
      notices: [],
    };
  });
}

function filesIn(root, relative = "") {
  return readdirSync(path.join(root, relative))
    .sort()
    .flatMap((name) => {
      const file = relative ? `${relative}/${name}` : name;
      const info = lstatSync(path.join(root, file));
      if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory()))
        throw new Error("Linked or special hosted build input");
      return info.isDirectory() ? filesIn(root, file) : [file];
    });
}

/** Assemble exact notices and model descriptors; no acquisition or model substitution. */
function addNotices(root) {
  const copy = (source, target) => {
    mkdirSync(path.dirname(path.join(root, target)), { recursive: true });
    copyFileSync(source, path.join(root, target));
  };
  const noticeRoot = path.join(frontend, "desktop/runtime/notices");
  // Browser code, tokenizer/WASM, model, Basis and logo notices are reviewed
  // source texts. Included content is delivered by the consumer content service.
  for (const name of readdirSync(noticeRoot).sort()) {
    if (name === "included-content-attribution.txt") continue;
    copy(path.join(noticeRoot, name), `notices/${name}`);
  }
  for (const name of [
    "README.md",
    "third-party/code-and-models.md",
    "third-party/code-and-models.json",
    "third-party/art-NOTICES.md",
  ]) {
    copy(path.join(repository, "licenses", name), `notices/source/${name}`);
  }
  // The adapted-code record and the upstream texts for adapted code and the
  // generated client's Hey API runtime, as the desktop bundle carries them.
  for (const name of licenseRecordFiles())
    copy(
      path.join(repository, "licenses/third-party", name),
      `notices/source/third-party/${name}`,
    );
  copy(path.join(repository, "LICENSE"), "notices/animama-LICENSE.txt");
  const dependencies = javascriptLicenses(frontend, ["web"]);
  if (dependencies.records.some((record) => record.license === "NOASSERTION"))
    throw new Error("Unidentified browser dependency license");
  writeFileSync(
    path.join(root, "notices/npm-dependencies.json"),
    canonical(dependencies),
  );
  writeFileSync(
    path.join(root, "notices/npm-NOTICES.txt"),
    dependencies.records
      .map(
        (record) =>
          `${record.name}@${record.version}\nLicense: ${record.license}\nSource: ${record.source}\n` +
          record.notices
            .map((n) => `\n--- ${n.path} ---\n${n.text}`)
            .join("\n"),
      )
      .join("\n\n"),
  );
  copy(
    path.join(repository, "models/browser-runtime/manifest.json"),
    "resource-manifests/browser-runtime.json",
  );
  copy(
    path.join(repository, "models/browser-speech/manifest.json"),
    "resource-manifests/browser-speech.json",
  );
  const resources = hostedLazyResources();
  for (const resource of resources) {
    const folder = path.join(repository, "models", resource.id);
    copy(path.join(folder, "manifest.json"), resource.manifest);
    const manifest = JSON.parse(
      readFileSync(path.join(folder, "manifest.json")),
    );
    for (const file of manifest.files.filter((f) => f.source?.local)) {
      const source = path.join(folder, file.source.local);
      const data = readFileSync(source);
      if (data.length !== file.size || sha(data) !== file.sha256)
        throw new Error("Optional model notice differs from exact manifest");
      const target = `notices/models/${resource.id}/${file.path}`;
      copy(source, target);
      resource.notices.push(target);
    }
    if (!resource.notices.length)
      throw new Error("Optional model catalog requires exact notices");
  }
  return resources;
}

/** Finalize the whole emitted app; every changed emitted byte obtains a new URL. */
export function finalizeHostedBuild(root) {
  resolveBrowserRuntimeAssets({ builtRoot: root, allowMissingModels: false });
  rmSync(path.join(root, ".vite"), { recursive: true, force: true });
  rmSync(path.join(root, "README.md"), { force: true });
  const lazy = addNotices(root);
  const encoder = lazy.find(
    (resource) => resource.id === "pocket-tts-voice-cloning",
  );
  const voices = lazy.find((resource) => resource.id === "pocket-tts-voices");
  const workerFile = path.join(root, "tts/workers/inference-worker.js");
  const worker = readFileSync(workerFile, "utf8");
  const localEncoder =
    '"/v1/model-assets/pocket-tts-voice-cloning-encoder/content"';
  if (worker.split(localEncoder).length !== 2)
    throw new Error("Unexpected cloning worker resource boundary");
  const voicePrefix = "const OPTIONAL_VOICE_RESOURCE_PREFIX = null;";
  if (worker.split(voicePrefix).length !== 2)
    throw new Error("Unexpected Pocket voice resource boundary");
  writeFileSync(
    workerFile,
    worker
      .replace(
        localEncoder,
        JSON.stringify(`${encoder.route_prefix}mimi_encoder.onnx`),
      )
      .replace(
        voicePrefix,
        `const OPTIONAL_VOICE_RESOURCE_PREFIX = ${JSON.stringify(voices.route_prefix)};`,
      ),
  );
  const names = filesIn(root);
  const inventory = {};
  for (const name of names) {
    if (name.endsWith(".map"))
      throw new Error("Hosted archive cannot contain source maps");
    const data = readFileSync(path.join(root, name));
    inventory[name] = { sha256: sha(data), size: data.length };
  }
  const digest = sha(canonical(inventory));
  const prefix = `/_animama/static/${digest}/`;
  for (const name of names) {
    const original = path.join(root, name);
    if (/\.(html|js|mjs|css|json|svg|txt|md)$/.test(name)) {
      const text = readFileSync(original, "utf8");
      if (text.includes(TEMPLATE_BASE))
        writeFileSync(original, text.replaceAll(TEMPLATE_BASE, prefix));
    }
    if (name !== "index.html") {
      const target = path.join(root, prefix.slice(1), name);
      mkdirSync(path.dirname(target), { recursive: true });
      renameSync(original, target);
    }
  }
  // Metadata is consumed by the producer, never a served archive member.
  const record = {
    resource_prefix: prefix,
    template_sha256: digest,
    notices: names
      .filter((name) => name.startsWith("notices/"))
      .map((name) => prefix.slice(1) + name),
    lazy_resources: lazy.map((record) => ({
      ...record,
      manifest: prefix.slice(1) + record.manifest,
      notices: record.notices.map((name) => prefix.slice(1) + name),
    })),
  };
  writeFileSync(path.join(root, ".hosted-build.json"), canonical(record));
  return record;
}
