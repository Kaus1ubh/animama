import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import {
  buildPython,
  desktopRoot,
  filesIn,
  frontendRoot,
  pythonEnvironment,
  readJson,
  repoRoot,
  run,
  sourceRoot,
  sha256,
  writeJson,
} from "./common.mjs";

/** Conservative dependency closure; optional modules absent on this target are recorded. */
export function javascriptLicenses(workspaceRoot = frontendRoot) {
  const records = new Map();
  const absentOptional = new Set();
  const visit = (folder) => {
    folder = realpathSync(folder);
    const pkg = readJson(path.join(folder, "package.json"));
    const id = `npm:${pkg.name}@${pkg.version}`;
    if (records.has(id)) return;
    const notices = readdirSync(folder)
      .sort()
      .filter((name) =>
        /^(?:licen[cs]e|copying|notice|copyright)(?:[._ -]|$)/iu.test(name),
      )
      .flatMap((name) => {
        try {
          return [
            { path: name, text: readFileSync(path.join(folder, name), "utf8") },
          ];
        } catch {
          return [];
        }
      });
    records.set(id, {
      id,
      name: pkg.name,
      version: pkg.version,
      license:
        typeof pkg.license === "string"
          ? pkg.license
          : pkg.private
            ? "Proprietary"
            : notices.length
              ? "SEE-NOTICE"
              : "NOASSERTION",
      source: pkg.private
        ? `workspace:${pkg.name}`
        : `https://www.npmjs.com/package/${pkg.name}/v/${pkg.version}`,
      review: "pending",
      notices,
    });
    const resolve = createRequire(path.join(folder, "package.json"));
    for (const name of Object.keys({
      ...pkg.dependencies,
      ...pkg.optionalDependencies,
    }).sort()) {
      // Type-only packages have no executable entrypoint, and exports may hide
      // package.json. Follow Node's module search directories without executing it.
      const dependency = (resolve.resolve.paths(`${name}/package.json`) ?? [])
        .map((base) => path.join(base, name))
        .find((candidate) => existsSync(path.join(candidate, "package.json")));
      if (!dependency) {
        if (pkg.optionalDependencies?.[name]) {
          absentOptional.add(`${id}:${name}`);
          continue;
        }
        throw new Error(
          `Missing declared dependency during license inventory: ${id} -> ${name}`,
        );
      }
      visit(dependency);
    }
  };
  for (const name of ["desktop", "web"]) visit(path.join(workspaceRoot, name));
  return {
    records: [...records.values()].sort((a, b) => a.id.localeCompare(b.id)),
    absentOptional: [...absentOptional].sort(),
  };
}

/** Every staged file gets an attribution group, with unresolved provenance visible. */
export function writeLicenses(target, contentInventory) {
  const directory = path.join(target.runtime, "licenses");
  mkdirSync(directory, { recursive: true });
  const python = JSON.parse(
    run(
      buildPython(),
      [path.join(repoRoot, "src/backend/packaging/desktop/python_licenses.py")],
      { env: pythonEnvironment(), capture: true },
    ),
  );
  const js = javascriptLicenses();
  const policy = readJson(path.join(sourceRoot, "license-sources.json"));
  const policyRecords = policy.groups.map((group) => ({
    ...group,
    notices: (group.notice_files ?? []).map((name) => {
      if (!/^[a-z0-9][a-z0-9.-]{0,99}\.txt$/u.test(name))
        throw new Error("Invalid static license notice path");
      return {
        path: name,
        text: readFileSync(path.join(sourceRoot, "notices", name), "utf8"),
      };
    }),
  }));
  const native = readJson(path.join(sourceRoot, "native-components.lock.json"));
  const records = [...policyRecords, ...python, ...js.records];
  for (const name of ["postgresql", "pgvector"])
    records.push({
      id: name,
      name,
      version: native[name].version,
      license: native[name].license,
      source: native[name].url,
      review: "pending",
      notices: [
        {
          path: `${name}.txt`,
          text: readFileSync(
            path.join(directory, "native", `${name}.txt`),
            "utf8",
          ),
        },
      ],
    });
  const electronDist = path.join(desktopRoot, "node_modules/electron/dist");
  records.push({
    id: "electron",
    name: "Electron + Chromium",
    version: readJson(
      path.join(desktopRoot, "node_modules/electron/package.json"),
    ).version,
    license: "MIT and bundled Chromium notices",
    source: "https://github.com/electron/electron",
    review: "pending",
    notices: ["LICENSE", "LICENSES.chromium.html"].map((name) => ({
      path: name,
      text: readFileSync(path.join(electronDist, name), "utf8"),
    })),
  });
  const contentRecords = new Map();
  for (const file of contentInventory.files)
    contentRecords.set(file.license.license_id, {
      id: file.license.license_id,
      name: file.license.creator,
      license: file.license.license_id,
      source: file.license.provenance,
      review: file.license.redistribution_review,
    });
  records.push(...contentRecords.values());
  records.sort((a, b) => a.id.localeCompare(b.id));
  const assignments = filesIn(target.runtime)
    .filter((name) => !name.startsWith("licenses/") && name !== "manifest.json")
    .map((name) => {
      const staticGroup = policy.groups.find((item) =>
        item.paths?.some((prefix) => name.startsWith(prefix)),
      );
      let refs = ["animama"];
      if (name.startsWith("backend/"))
        refs = ["animama", "python-runtime-dependencies"];
      else if (name.startsWith("postgres/"))
        refs = ["postgresql", ...(name.includes("vector") ? ["pgvector"] : [])];
      else if (name.startsWith("content/")) refs = [...contentRecords.keys()];
      else if (staticGroup) refs = [staticGroup.id];
      else if (name.startsWith("web/"))
        refs = ["animama", "javascript-runtime-dependencies"];
      return { path: name, license_refs: refs };
    });
  const inventory = {
    schema: "animama-redistribution-inventory/1",
    release_approved: false,
    coverage:
      "Conservative dependency groups per file; not a legal approval or exact binary SBOM",
    records: records.map(({ notices, ...record }) => ({
      ...record,
      notice_count: notices?.length ?? 0,
      notice_sha256: createHash("sha256")
        .update(JSON.stringify(notices ?? []))
        .digest("hex"),
    })),
    groups: {
      "python-runtime-dependencies": python.map((p) => p.id),
      "javascript-runtime-dependencies": js.records.map((p) => p.id),
    },
    files: assignments,
    external_components: {
      app: ["animama", "javascript-runtime-dependencies"],
      electron: ["electron"],
    },
    absent_optional_javascript: js.absentOptional,
    pending_review: records
      .filter((r) => r.review !== "approved")
      .map((r) => r.id),
    // Bind human review to unchanged dependency sources and static third-party
    // bytes, without tying it to nondeterministic native signing timestamps.
    source_locks: Object.fromEntries(
      [
        ["uv.lock", path.join(repoRoot, "uv.lock")],
        ["pnpm-lock.yaml", path.join(frontendRoot, "pnpm-lock.yaml")],
        ["runtime-sources", path.join(sourceRoot, "source-manifest.json")],
        ["license-sources", path.join(sourceRoot, "license-sources.json")],
        [
          "native-components",
          path.join(sourceRoot, "native-components.lock.json"),
        ],
      ].map(([name, file]) => [name, sha256(file)]),
    ),
    source_assets: filesIn(target.runtime)
      .filter((name) =>
        ["content/", "web/onnx/", "web/tts/", "web/basis/"].some((prefix) =>
          name.startsWith(prefix),
        ),
      )
      .map((name) => ({
        path: name,
        sha256: sha256(path.join(target.runtime, name)),
      })),
  };
  writeJson(path.join(directory, "inventory.json"), inventory);
  const text = [
    "ANIMAMA DESKTOP — THIRD PARTY NOTICES",
    "Development feasibility build. Redistribution approval is pending.",
    "The inventory covers exact staged files and conservative dependency groups. NOASSERTION and missing notices require resolution before release.",
    ...records.map(
      (record) =>
        `\n${"=".repeat(72)}\n${record.name} (${record.id})\nLicense: ${record.license}\nSource: ${record.source}\nReview: ${record.review}\n${(record.notices ?? []).map((notice) => `\n--- ${notice.path} ---\n${notice.text}`).join("\n")}`,
    ),
  ].join("\n");
  writeFileSync(path.join(directory, "THIRD_PARTY_NOTICES.txt"), text);
  const packDir = path.join(
    target.output,
    "pack-inputs/expanded-included-content",
  );
  writeFileSync(
    path.join(packDir, "ATTRIBUTION.txt"),
    "Development pack input; not approved for redistribution.\n" +
      [...contentRecords.values()]
        .map((r) => `${r.id}: ${r.source} (${r.review})`)
        .join("\n") +
      "\n",
  );
  return inventory;
}
