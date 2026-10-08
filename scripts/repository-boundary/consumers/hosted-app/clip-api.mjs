/** Bounded private clip HTTP bytes shared across emitted application selections. */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const MAX_CLIP = 2 * 1024 * 1024;
const typed = (item) =>
    Object.fromEntries(
        Object.entries(item).filter(([key]) =>
            [
                "kind",
                "item_id",
                "source",
                "editable",
                "logical_key",
                "name",
                "description",
                "semantic_key",
                "implementation",
                "config",
                "dependencies",
                "files",
                "revision_sha256",
                "definition",
                "runtime_defaults",
            ].includes(key),
        ),
    );

/** No product modules: retain the actual uploaded sequence and descriptor bytes. */
export function createClipApi(reply, applicationDirectory, expectedSchema) {
    const records = [],
        operations = new Map();
    const initialize = (admission) => {
        const seedRoot = path.join(applicationDirectory, "catalog-seed");
        const seed = JSON.parse(
            readFileSync(path.join(seedRoot, "manifest.json")),
        );
        const entry = seed.inventory.entries.find(
            (entry) => entry.logical_key === "builtin:particle-effect:hearts",
        );
        if (!entry)
            throw new Error(
                "Verified seed lacks the real effect-only clip dependency",
            );
        const descriptor = JSON.parse(
            readFileSync(
                path.join(seedRoot, "included", entry.locator, "hearts.json"),
            ),
        );
        const files = descriptor.files.map((file, ordinal) => {
            const relative = entry.locator + "/" + file.path;
            const declared = seed.files.find(
                (file) => file.path === "included/" + relative,
            );
            const bytes = readFileSync(
                path.join(seedRoot, "included", relative),
            );
            if (
                !declared ||
                bytes.length !== declared.size_bytes ||
                sha(bytes) !== declared.sha256
            )
                throw new Error("Effect dependency differs from verified seed");
            const fileRef = randomUUID();
            const registered = {
                file_ref: fileRef,
                filename: path.basename(file.path),
                logical_path: file.path,
                role: file.role,
                ordinal,
                size_bytes: bytes.length,
                sha256: sha(bytes),
                media_type:
                    file.role === "texture" ? "image/png" : "application/json",
                url: `/v1/content/previews/clip-included-hearts/revisions/${entry.revision_sha256}/files/${fileRef}`,
            };
            admission.state.files.set(fileRef, { ...registered, bytes });
            return registered;
        });
        admission.state.items.set("included-hearts", {
            kind: "particle_effect",
            item_id: "included-hearts",
            logical_key: entry.logical_key,
            name: descriptor.name,
            display_name: descriptor.name,
            status: "valid",
            diagnostics: [],
            description: descriptor.description,
            source: "included",
            editable: false,
            revision_sha256: entry.revision_sha256,
            dependencies: [],
            definition: JSON.parse(
                admission.state.files.get(
                    files.find((file) => file.role === "manifest").file_ref,
                ).bytes,
            ),
            runtime_defaults: descriptor.runtime_defaults,
            files,
        });
    };
    const handle = async (req, res, raw, session) => {
        const route = /^\/v1\/(gestures|reactions)(?:\/([^/:]+))?$/.exec(raw);
        if (route) {
            const kind = route[1] === "gestures" ? "gesture" : "reaction";
            const items = [...session.state.items.values()].filter(
                (item) => item.kind === kind,
            );
            const id = route[2] && decodeURIComponent(route[2]);
            if (req.method === "GET") {
                const item = items.find((item) => item.item_id === id);
                reply(
                    res,
                    id
                        ? item
                            ? typed(item)
                            : { detail: { code: "content_not_found" } }
                        : {
                              items: items.map(typed),
                              next_cursor: null,
                              query: {},
                          },
                    id && !item ? 404 : 200,
                );
                return true;
            }
            if (req.method === "PUT" && id) {
                const chunks = [];
                let total = 0;
                for await (const chunk of req) {
                    total += chunk.length;
                    if (total > MAX_CLIP + 128 * 1024)
                        throw new Error(
                            "Fixture clip request exceeds its byte bound",
                        );
                    chunks.push(chunk);
                }
                const form = await new Request("http://fixture.invalid", {
                    method: "POST",
                    headers: req.headers,
                    body: Buffer.concat(chunks),
                }).formData();
                const operation =
                    session.owner + ":" + form.get("operation_id");
                if (operations.has(operation)) {
                    reply(res, typed(operations.get(operation)));
                    return true;
                }
                const descriptorBytes = form.get("descriptor_json");
                const descriptor = JSON.parse(descriptorBytes);
                const uploaded = form.getAll("files");
                if (
                    uploaded.length !== 1 ||
                    descriptor.implementation.kind !== "anima_clip"
                )
                    throw new Error("Expected one actual clip companion");
                const bytes = Buffer.from(await uploaded[0].arrayBuffer());
                const selectedSchema = expectedSchema();
                if (
                    bytes.length > MAX_CLIP ||
                    !["animaPoseClip/1.0", "animaPoseClip/2.0"].includes(
                        selectedSchema,
                    ) ||
                    JSON.parse(bytes).schema !== selectedSchema
                )
                    throw new Error("Invalid or oversized clip companion");
                const old = session.state.items.get(
                    form.get("catalog_item_id"),
                );
                if (
                    old &&
                    old.revision_sha256 !== form.get("expected_revision")
                ) {
                    reply(
                        res,
                        { detail: { code: "catalog_revision_conflict" } },
                        409,
                    );
                    return true;
                }
                if (old)
                    for (const file of old.files)
                        session.state.files.delete(file.file_ref);
                const itemId = old?.item_id ?? randomUUID(),
                    revision = sha(bytes),
                    fileRef = randomUUID();
                const file = {
                    file_ref: fileRef,
                    filename: uploaded[0].name,
                    logical_path: uploaded[0].name,
                    role: "sequence",
                    ordinal: 0,
                    media_type: "application/json",
                    size_bytes: bytes.length,
                    sha256: revision,
                    url: `/v1/content/previews/clip-${itemId}/revisions/${revision}/files/${fileRef}`,
                };
                const dependencies = descriptor.dependencies.map(
                    (dependency) => ({
                        ref: dependency.ref,
                        kind: dependency.content_type,
                        alias: dependency.alias,
                        config: dependency.config,
                        item_id: [...session.state.items.values()].find(
                            (item) => item.logical_key === dependency.ref,
                        )?.item_id,
                    }),
                );
                const item = {
                    kind,
                    item_id: itemId,
                    source: "local",
                    editable: true,
                    logical_key: descriptor.id,
                    name: descriptor.name,
                    display_name: descriptor.name,
                    status: "valid",
                    diagnostics: [],
                    description:
                        descriptor.description ??
                        descriptor.ai_description ??
                        null,
                    semantic_key: descriptor.semantic_key,
                    implementation: descriptor.implementation,
                    dependencies,
                    files: [file],
                    revision_sha256: revision,
                };
                session.state.files.set(fileRef, { ...file, bytes });
                session.state.items.set(itemId, item);
                operations.set(operation, item);
                records.push({
                    owner: session.owner,
                    action: "save",
                    item_id: itemId,
                    revision,
                    sequence: JSON.parse(bytes),
                    bytes: bytes.length,
                    sequence_sha256: revision,
                    descriptor_sha256: sha(descriptorBytes),
                });
                reply(res, typed(item));
                return true;
            }
        }
        const preview =
            /^\/v1\/(gestures|reactions|particle-effects)\/([^/]+):preview$/.exec(
                raw,
            );
        if (preview && req.method === "POST") {
            const item = session.state.items.get(preview[2]);
            if (!item)
                reply(res, { detail: { code: "content_not_found" } }, 404);
            else {
                const supports = (item.dependencies ?? [])
                    .map((dependency) =>
                        session.state.items.get(dependency.item_id),
                    )
                    .filter(Boolean);
                reply(res, {
                    preview_id: "clip-" + item.item_id,
                    revision_sha256: item.revision_sha256,
                    expires_at: "2099-01-01T00:00:00Z",
                    item: typed(item),
                    supports: supports.map(typed),
                    files: [item, ...supports].flatMap((item) => item.files),
                });
            }
            return true;
        }
        const file =
            /^\/v1\/content\/previews\/clip-([^/]+)\/revisions\/([a-f0-9]{64})\/files\/([^/]+)$/.exec(
                raw,
            );
        if (file && ["GET", "HEAD"].includes(req.method)) {
            const item = session.state.items.get(file[1]),
                payload = session.state.files.get(file[3]);
            if (
                !item ||
                item.revision_sha256 !== file[2] ||
                !payload ||
                !item.files.some((entry) => entry.file_ref === file[3])
            )
                reply(res, { detail: { code: "content_file_not_found" } }, 404);
            else {
                res.writeHead(200, {
                    "content-type": payload.media_type,
                    "cache-control": "private, no-store",
                    "content-length": payload.bytes.length,
                });
                res.end(req.method === "HEAD" ? undefined : payload.bytes);
            }
            records.push({
                owner: session.owner,
                action: "read",
                item_id: file[1],
                revision: file[2],
                status: res.statusCode,
                sequence_sha256:
                    res.statusCode === 200 ? sha(payload.bytes) : null,
                bytes: res.statusCode === 200 ? payload.bytes.length : null,
            });
            return true;
        }
        return false;
    };
    return { records, handle, initialize };
}
