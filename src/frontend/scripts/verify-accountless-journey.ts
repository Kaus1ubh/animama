import { createHash, randomUUID } from "node:crypto";

type SetupMode = "name" | "existing";

type JourneyOptions = {
  origin: URL;
  setup: SetupMode;
  displayName: string;
  profileName: string;
};

type JsonObject = Record<string, unknown>;

const MUTATION_HEADERS = {
  "X-Animama-CSRF": "1",
};
const REQUEST_TIMEOUT_MS = 120_000;
const JOURNEY_ANIMA_NAME = "Phase 5 Companion";
const JOURNEY_FILE_NAME = "phase-five-private.txt";
const JOURNEY_IDEMPOTENCY_KEY = "phase5-accountless-journey-v1";

function parseOptions(args: string[]): JourneyOptions {
  const normalized = args[0] === "--" ? args.slice(1) : args;
  const values = new Map<string, string>();
  for (let index = 0; index < normalized.length; index += 2) {
    const key = normalized[index];
    const value = normalized[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(
        "usage: verify-accountless-journey --origin <origin> --setup <name|existing> --profile-name <name> [--display-name <name>]",
      );
    }
    values.set(key, value);
  }

  const origin = new URL(values.get("--origin") ?? "");
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    origin.username ||
    origin.password
  ) {
    throw new Error("--origin must be an HTTP(S) origin without a path");
  }
  const setup = values.get("--setup") as SetupMode | undefined;
  if (!setup || !["name", "existing"].includes(setup)) {
    throw new Error("--setup must be name or existing");
  }
  const profileName = values
    .get("--profile-name")
    ?.trim()
    .replace(/\s+/gu, " ");
  if (!profileName) throw new Error("--profile-name is required");
  const suppliedName = values
    .get("--display-name")
    ?.trim()
    .replace(/\s+/gu, " ");
  if (profileName.length > 80 || (suppliedName?.length ?? 0) > 80) {
    throw new Error("Display names must be 80 characters or fewer");
  }
  if (setup === "name" && !suppliedName) {
    throw new Error("--display-name is required when --setup is name");
  }
  if (setup !== "name" && suppliedName) {
    throw new Error("--display-name is valid only when --setup is name");
  }
  return {
    origin,
    setup,
    displayName: suppliedName ?? profileName,
    profileName,
  };
}

function asObject(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} returned an unexpected response`);
  }
  return value as JsonObject;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} returned an unexpected response`);
  }
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) {
    throw new Error(`${label} omitted a required value`);
  }
  return value;
}

async function request(
  options: JourneyOptions,
  path: string,
  init: RequestInit,
  expectedStatuses: readonly number[],
  label: string,
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Origin", options.origin.origin);
  headers.set("Sec-Fetch-Site", "same-origin");
  const response = await fetch(new URL(path, options.origin), {
    ...init,
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!expectedStatuses.includes(response.status)) {
    await response.body?.cancel();
    throw new Error(`${label} returned status ${response.status}`);
  }
  return response;
}

async function jsonRequest(
  options: JourneyOptions,
  path: string,
  init: RequestInit,
  expectedStatuses: readonly number[],
  label: string,
): Promise<{ body: JsonObject; status: number }> {
  const response = await request(options, path, init, expectedStatuses, label);
  return {
    body: asObject(await response.json(), label),
    status: response.status,
  };
}

function jsonMutation(body?: unknown): RequestInit {
  const headers = new Headers(MUTATION_HEADERS);
  if (body !== undefined) headers.set("Content-Type", "application/json");
  return {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

function sourceRoots(options: JsonObject, avatar: JsonObject): JsonObject[] {
  const avatarSource = {
    item_id: requireString(avatar.item_id, "Avatar"),
    revision_sha256: requireString(avatar.revision_sha256, "Avatar"),
  };
  const roots: JsonObject[] = [{ kind: "avatar", source: avatarSource }];
  const recommended = asObject(options.recommended, "Creation options");
  for (const value of asArray(recommended.gestures, "Recommended gestures")) {
    const gesture = asObject(value, "Recommended gesture");
    roots.push({
      kind: "gesture",
      source: asObject(gesture.source, "Gesture source"),
    });
  }
  const reactions = asObject(recommended.reactions, "Recommended reactions");
  for (const cellsValue of Object.values(reactions)) {
    const cells = asObject(cellsValue, "Reaction cells");
    for (const source of Object.values(cells)) {
      if (source !== null) {
        roots.push({
          kind: "reaction",
          source: asObject(source, "Reaction source"),
        });
      }
    }
  }
  const defaultIdle = asObject(options.default_idle, "Default idle");
  if (defaultIdle.source !== null) {
    roots.push({
      kind: "idle_style",
      source: asObject(defaultIdle.source, "Default idle source"),
    });
  }

  const unique = new Map<string, JsonObject>();
  for (const root of roots) {
    const source = asObject(root.source, "Content source");
    const key = `${String(root.kind)}:${String(source.item_id)}:${String(source.revision_sha256)}`;
    unique.set(key, root);
  }
  return [...unique.values()];
}

function findSseEvent(body: string, eventName: string): JsonObject | null {
  for (const frame of body.split(/\r?\n\r?\n/)) {
    const lines = frame.split(/\r?\n/);
    const event = lines.find((line) => line.startsWith("event:"));
    if (event?.slice("event:".length).trim() !== eventName) continue;
    const data = lines.find((line) => line.startsWith("data:"));
    if (!data) return {};
    try {
      return asObject(JSON.parse(data.slice("data:".length).trim()), eventName);
    } catch {
      throw new Error(`${eventName} contained invalid JSON`);
    }
  }
  return null;
}

async function runJourney(options: JourneyOptions): Promise<void> {
  const health = await jsonRequest(
    options,
    "/health",
    {},
    [200],
    "Local HTTP health",
  );
  if (health.body.status !== "ok") {
    throw new Error(
      "Local HTTP health did not return the bounded local contract",
    );
  }

  const initial = await jsonRequest(
    options,
    "/v1/runtime-context",
    {},
    [200],
    "Initial runtime context",
  );
  const principalId = requireString(
    initial.body.principal_id,
    "Runtime context",
  );
  const firstBootstrap = await jsonRequest(
    options,
    "/v1/runtime/bootstrap:ensure",
    jsonMutation(),
    [200],
    "Installation bootstrap",
  );
  const secondBootstrap = await jsonRequest(
    options,
    "/v1/runtime/bootstrap:ensure",
    jsonMutation(),
    [200],
    "Installation bootstrap replay",
  );
  for (const result of [firstBootstrap.body, secondBootstrap.body]) {
    if (
      result.principal_id !== principalId ||
      result.bootstrap_status !== "ready" ||
      asArray(result.failed_steps, "Bootstrap failures").length !== 0
    ) {
      throw new Error("Installation bootstrap did not converge idempotently");
    }
  }

  const settings = await jsonRequest(
    options,
    "/v1/users/me/settings",
    {},
    [200],
    "Owner settings",
  );
  if (settings.body.user_id !== principalId) {
    throw new Error(
      "Owner settings were not scoped to the installation principal",
    );
  }
  const starterList = asArray(
    await (
      await request(options, "/v1/animas", {}, [200], "Starter Animas")
    ).json(),
    "Starter Animas",
  );
  if (starterList.length < 2)
    throw new Error("Installation bootstrap omitted starter Animas");
  await jsonRequest(
    options,
    "/v1/runtime/bootstrap:ensure",
    jsonMutation(),
    [200],
    "Post-list bootstrap replay",
  );
  const starterReplay = asArray(
    await (
      await request(options, "/v1/animas", {}, [200], "Starter replay")
    ).json(),
    "Starter replay",
  );
  if (starterReplay.length !== starterList.length) {
    throw new Error("Bootstrap replay duplicated an Anima");
  }

  if (options.setup === "existing") {
    if (
      initial.body.first_run_complete !== true ||
      initial.body.display_name !== options.profileName
    ) {
      throw new Error("Restart did not preserve first-run personalization");
    }
  } else {
    if (initial.body.first_run_complete !== false) {
      throw new Error("Fresh setup unexpectedly reported first run complete");
    }
    for (const payload of [
      {},
      { display_name: null },
      { display_name: "   " },
    ]) {
      await jsonRequest(
        options,
        "/v1/runtime/onboarding:complete",
        jsonMutation(payload),
        [422],
        "Required display-name validation",
      );
    }
    const completed = await jsonRequest(
      options,
      "/v1/runtime/onboarding:complete",
      jsonMutation({ display_name: options.displayName }),
      [200],
      "First-run completion",
    );
    if (
      completed.body.first_run_complete !== true ||
      completed.body.display_name !== options.displayName
    ) {
      throw new Error(
        "First-run completion did not retain the selected personalization",
      );
    }
    const replayed = await jsonRequest(
      options,
      "/v1/runtime/onboarding:complete",
      jsonMutation({ display_name: "Ignored replay" }),
      [200],
      "Lost-response onboarding replay",
    );
    if (replayed.body.display_name !== options.displayName) {
      throw new Error("Onboarding replay overwrote committed personalization");
    }
  }

  const profileUpdate = await jsonRequest(
    options,
    "/v1/users/me/profile",
    {
      method: "PATCH",
      headers: { ...MUTATION_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ display_name: options.profileName }),
    },
    [200],
    "Private profile update",
  );
  if (
    Object.keys(profileUpdate.body).length !== 1 ||
    profileUpdate.body.display_name !== options.profileName
  ) {
    throw new Error(
      "Private profile returned fields outside the local contract",
    );
  }

  const creationOptions = await jsonRequest(
    options,
    "/v1/animas/creation-options",
    {},
    [200],
    "Anima creation options",
  );
  const avatarsPage = await jsonRequest(
    options,
    "/v1/avatar-content",
    {},
    [200],
    "Avatar catalog",
  );
  const avatars = asArray(avatarsPage.body.items, "Avatar catalog");
  if (!avatars.length) throw new Error("Avatar catalog is empty");
  const avatar = asObject(avatars[0], "Avatar");
  const evidence = await jsonRequest(
    options,
    "/v1/content/evidence:resolve",
    jsonMutation({
      schema_version: 1,
      roots: sourceRoots(creationOptions.body, avatar),
    }),
    [200],
    "Creation source evidence",
  );
  if (evidence.body.complete !== true) {
    throw new Error("Creation source evidence was incomplete");
  }
  const recommended = asObject(
    creationOptions.body.recommended,
    "Recommended creation content",
  );
  const creationPayload = {
    schema_version: 1,
    display_name: JOURNEY_ANIMA_NAME,
    identity_markdown:
      "# Phase 5 Companion\n\nA deterministic local companion for the accountless integration journey.\n",
    avatar: {
      item_id: requireString(avatar.item_id, "Avatar"),
      revision_sha256: requireString(avatar.revision_sha256, "Avatar"),
    },
    appearance: { profile: null, background: null },
    gestures: recommended.gestures,
    reactions: recommended.reactions,
    starter_pack: creationOptions.body.starter_pack,
    expected_source_revisions: evidence.body.combined_expected_source_revisions,
    idempotency_key: JOURNEY_IDEMPOTENCY_KEY,
  };
  const beforeCreationCount = starterReplay.length;
  const created = await jsonRequest(
    options,
    "/v1/animas",
    jsonMutation(creationPayload),
    [200, 201],
    "Custom Anima creation",
  );
  const animaId = requireString(created.body.anima_id, "Custom Anima creation");
  const afterCreation = asArray(
    await (
      await request(options, "/v1/animas", {}, [200], "Animas after creation")
    ).json(),
    "Animas after creation",
  );
  const expectedCount =
    created.status === 201 ? beforeCreationCount + 1 : beforeCreationCount;
  if (afterCreation.length !== expectedCount) {
    throw new Error(
      "Custom Anima creation changed the collection unexpectedly",
    );
  }
  const replay = await jsonRequest(
    options,
    "/v1/animas",
    jsonMutation(creationPayload),
    [200],
    "Custom Anima creation replay",
  );
  if (
    replay.body.anima_id !== animaId ||
    replay.body.idempotent_replay !== true
  ) {
    throw new Error("Custom Anima receipt did not replay idempotently");
  }
  const afterReplay = asArray(
    await (
      await request(options, "/v1/animas", {}, [200], "Animas after replay")
    ).json(),
    "Animas after replay",
  );
  if (afterReplay.length !== afterCreation.length) {
    throw new Error("Custom Anima replay duplicated product state");
  }

  const runtime = await jsonRequest(
    options,
    `/v1/animas/${encodeURIComponent(animaId)}/runtime`,
    {},
    [200],
    "Anima runtime",
  );
  const runtimeRevision = requireString(
    runtime.body.effective_revision,
    "Anima runtime",
  );

  const preview = await jsonRequest(
    options,
    "/v1/content/previews:prepare",
    jsonMutation({
      schema_version: 1,
      roots: [
        {
          kind: "avatar",
          source: {
            type: "catalog",
            catalog_item_id: requireString(avatar.item_id, "Avatar"),
          },
        },
      ],
    }),
    [200],
    "Typed preview preparation",
  );
  const lease = asObject(preview.body.lease, "Typed preview lease");
  const previewFiles = asArray(lease.files, "Typed preview files");
  if (!previewFiles.length)
    throw new Error("Typed preview omitted private bytes");
  const previewFile = asObject(previewFiles[0], "Typed preview file");
  const previewBytes = await request(
    options,
    requireString(previewFile.url, "Typed preview file"),
    {},
    [200],
    "Typed preview private bytes",
  );
  const previewBuffer = Buffer.from(await previewBytes.arrayBuffer());
  if (
    previewBuffer.byteLength !== previewFile.size_bytes ||
    createHash("sha256").update(previewBuffer).digest("hex") !==
      previewFile.sha256
  ) {
    throw new Error("Typed preview bytes did not match the admitted file");
  }

  const existingFiles = asArray(
    (await jsonRequest(options, "/v1/files", {}, [200], "Private files")).body
      .files,
    "Private files",
  );
  const persistedFile = existingFiles.find(
    (value) =>
      asObject(value, "Private file").original_filename === JOURNEY_FILE_NAME,
  );
  if (options.setup === "existing" && !persistedFile) {
    throw new Error("Restart did not preserve the private file");
  }
  if (!persistedFile) {
    const bytes = new TextEncoder().encode(
      "Accountless Phase 5 private upload.\n",
    );
    const initialized = await jsonRequest(
      options,
      "/v1/files/uploads",
      jsonMutation({
        filename: JOURNEY_FILE_NAME,
        content_type: "text/plain",
        size_bytes: bytes.byteLength,
      }),
      [200],
      "Private upload initialization",
    );
    const fileId = requireString(initialized.body.file_id, "Private upload");
    const uploadResponse = await request(
      options,
      requireString(initialized.body.upload_url, "Private upload"),
      {
        method: "PUT",
        headers: {
          ...MUTATION_HEADERS,
          "Content-Type": "text/plain",
        },
        body: bytes,
      },
      [204],
      "Private upload bytes",
    );
    await uploadResponse.body?.cancel();
    const finalized = await jsonRequest(
      options,
      `/v1/files/${encodeURIComponent(fileId)}:finalize`,
      jsonMutation({}),
      [200],
      "Private upload finalization",
    );
    if (
      finalized.body.status !== "uploaded" ||
      finalized.body.stored_size_bytes !== bytes.byteLength ||
      finalized.body.detected_content_type !== "text/plain"
    ) {
      throw new Error("Private upload did not verify the stored bytes");
    }
    const metadata = await jsonRequest(
      options,
      `/v1/files/${encodeURIComponent(fileId)}`,
      {},
      [200],
      "Private file metadata",
    );
    if (
      metadata.body.status !== "uploaded" ||
      metadata.body.stored_size_bytes !== bytes.byteLength
    ) {
      throw new Error("Private file metadata did not preserve upload state");
    }
  }

  const priorChats = asArray(
    await (
      await request(options, "/v1/chats", {}, [200], "Chat history")
    ).json(),
    "Chat history",
  ).filter((value) => asObject(value, "Chat").anima_id === animaId);
  if (options.setup === "existing" && priorChats.length < 1) {
    throw new Error("Restart did not preserve chat history");
  }
  const chat = await request(
    options,
    `/v1/animas/${encodeURIComponent(animaId)}/chat:sse`,
    jsonMutation({
      message: "Confirm the accountless Phase 5 local journey.",
      run_id: `phase5-${randomUUID()}`,
      runtime_revision: runtimeRevision,
      dispatch_options: {
        disable_memory_updates: true,
        disable_memory_influence: true,
        tts: { enabled: false },
      },
    }),
    [200],
    "Chat SSE",
  );
  const stream = await chat.text();
  if (!findSseEvent(stream, "user.response")) {
    throw new Error("Chat SSE omitted the assistant response");
  }
  const completed = findSseEvent(stream, "run.completed");
  const chatId = completed
    ? requireString(completed.chat_id, "Chat completion")
    : null;
  if (!chatId) throw new Error("Chat SSE did not complete");
  const messages = await jsonRequest(
    options,
    `/v1/chats/${encodeURIComponent(chatId)}/messages`,
    {},
    [200],
    "Persisted chat messages",
  );
  if (asArray(messages.body.messages, "Persisted chat messages").length < 2) {
    throw new Error("Chat completion did not persist both sides of the turn");
  }

  console.log(
    JSON.stringify({
      ok: true,
      setup: options.setup,
      bootstrap_replay_stable: true,
      starter_count_stable: true,
      creation_receipt_replayed: true,
      private_upload_verified: true,
      typed_preview_bytes_verified: true,
      chat_completed_and_persisted: true,
      restart_state_verified: options.setup === "existing",
    }),
  );
}

const options = parseOptions(process.argv.slice(2));
void runJourney(options).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown failure";
  console.error(`accountless journey: FAILED (${message})`);
  process.exitCode = 1;
});
