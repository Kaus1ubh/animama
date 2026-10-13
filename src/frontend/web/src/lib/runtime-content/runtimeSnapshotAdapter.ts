import type {
  PyAnimaRuntime,
  PyRuntimeAction,
} from "@/lib/content/catalogTypes";
import type {
  RuntimeResourceKind,
  AnimaRuntimeCatalogSnapshot,
  RuntimeCatalogEntry,
  RuntimeContentSlot,
} from "./types";

/**
 * The runtime carries no Avatar name, so the snapshot entry uses this English
 * placeholder; display code words it in the UI Locale.
 */
export const RUNTIME_AVATAR_MODEL_NAME = "Avatar";

const slotsByType: Record<string, RuntimeContentSlot> = {
  particle_effect: "particle_vfx",
  avatar_effect: "avatar_vfx",
  sound_effect: "sfx",
};
const kindsByType: Record<string, RuntimeResourceKind> = {
  particle_effect: "particle_vfx",
  avatar_effect: "avatar_vfx",
  scene_effect: "scene_vfx",
  sound_effect: "audio",
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function privateEntry(
  node: Record<string, unknown>,
  slot: RuntimeContentSlot,
  runtimeId: string,
  kind: RuntimeResourceKind,
  revision: string,
): RuntimeCatalogEntry {
  const files = Array.isArray(node.files) ? node.files : [];
  const prepared =
    files.length > 0 &&
    files.every((value) => String(object(value).url ?? "").startsWith("blob:"));
  return {
    runtime_root_ids:
      typeof node.runtime_root_id === "string"
        ? [node.runtime_root_id]
        : Array.isArray(node.runtime_root_ids)
          ? node.runtime_root_ids.map(String)
          : [],
    slot,
    runtime_id: runtimeId,
    kind,
    display_name: String(node.name ?? runtimeId),
    description: String(node.description ?? node.name ?? runtimeId),
    config_schema_version: 1,
    config: {
      ...object(node.config),
      runtime_reference_map: object(node.reference_map),
      // Removed Included effects an Action plays without (alias → ref).
      ...(node.missing_references
        ? { runtime_missing_references: object(node.missing_references) }
        : {}),
    },
    definition: object(node.definition),
    ...(typeof node.definition_error === "string"
      ? { definition_error: node.definition_error }
      : {}),
    content_revision: `${revision}:${runtimeId}`,
    source: {
      type: prepared ? "prepared_files" : "authorized_files",
      files: files.map((value) => {
        const file = object(value);
        return {
          file_ref:
            typeof file.file_ref === "string" ? file.file_ref : undefined,
          role: String(file.role),
          ordinal: Number(file.ordinal),
          filename: String(file.filename),
          content_type: String(file.media_type),
          size_bytes: Number(file.size_bytes),
          sha256: typeof file.sha256 === "string" ? file.sha256 : undefined,
          content_revision: `${revision}:${String(file.file_ref)}`,
          url: String(file.url),
        };
      }),
      logical_resource_urls: Object.fromEntries(
        Object.entries(object(node.logical_resource_urls)).map(
          ([logicalName, url]) => [logicalName, String(url)],
        ),
      ),
    },
  };
}

function supportSlot(node: Record<string, unknown>): RuntimeContentSlot {
  const contentType = String(node.content_type);
  if (contentType === "scene_effect") {
    const definitionKind = String(object(node.definition).kind ?? "");
    if (definitionKind === "focus_lines") return "scene_focus_vfx";
    if (definitionKind === "background_layers") return "scene_background_vfx";
    return String(object(node.source).content_id).includes(":focus:")
      ? "scene_focus_vfx"
      : "scene_background_vfx";
  }
  return slotsByType[contentType]!;
}

function append(
  runtime: AnimaRuntimeCatalogSnapshot,
  entry: RuntimeCatalogEntry,
) {
  const laneBySlot: Partial<
    Record<RuntimeContentSlot, keyof AnimaRuntimeCatalogSnapshot>
  > = {
    gesture: "gestures",
    pose: "poses",
    idle_animation: "idle_animations",
    reaction: "reactions",
    particle_vfx: "particle_vfx",
    avatar_vfx: "avatar_vfx",
    scene_background_vfx: "scene_background_vfx",
    scene_focus_vfx: "scene_focus_vfx",
    background_image: "background_image",
    profile_image: "profile_image",
    sfx: "sfx",
  };
  const lane = laneBySlot[entry.slot];
  if (!lane) return;
  if (lane === "profile_image" || lane === "background_image") {
    runtime[lane] = entry;
    return;
  }
  const values = runtime[lane] as RuntimeCatalogEntry[];
  const index = values.findIndex(
    (candidate) => candidate.runtime_id === entry.runtime_id,
  );
  if (index >= 0) values[index] = entry;
  else values.push(entry);
}

function rootEntry(
  root: PyRuntimeAction,
  slot: "gesture" | "pose" | "reaction",
  runtimeId: string,
  revision: string,
): RuntimeCatalogEntry | null {
  const node = root as unknown as Record<string, unknown>;
  const implementation = object(root.implementation);
  const files = Array.isArray(node.files) ? node.files : [];
  if (files.length === 0) return null;
  return privateEntry(
    { ...node, files },
    slot,
    runtimeId,
    implementation.kind === "vrma" ? "animation" : "anima_pose_clip",
    revision,
  );
}

/** Adapt the typed runtime snapshot into the concrete avatar-player lanes. */
export function adaptRuntimeSnapshot(
  typed: PyAnimaRuntime,
  previous?: AnimaRuntimeCatalogSnapshot | null,
): AnimaRuntimeCatalogSnapshot {
  const runtime = {
    schema_version: 1,
    effective_revision: typed.effective_revision,
    loadout_revision: typed.loadout_revision,
    app_catalog_version: typed.catalog_version ?? 1,
    avatar_model: null,
    idle_animations: [],
    gestures: [],
    poses: [],
    reactions: [],
    particle_vfx: [],
    avatar_vfx: [],
    scene_background_vfx: [],
    scene_focus_vfx: [],
    background_image: null,
    profile_image: null,
    sfx: [],
    warnings: [],
  } as unknown as AnimaRuntimeCatalogSnapshot;
  const avatar = object(typed.avatar);
  if (Object.keys(avatar).length) {
    const files = Array.isArray(avatar.files) ? avatar.files : [];
    if (files.length) {
      runtime.avatar_model = privateEntry(
        {
          ...avatar,
          name: RUNTIME_AVATAR_MODEL_NAME,
          config: {
            avatar_catalog_item_id: String(object(avatar.source).item_id ?? ""),
            // The effective face part correction; validated where it is read.
            face_parts: avatar.face_parts ?? null,
          },
        },
        "primary_model",
        "primary",
        "avatar_model",
        typed.effective_revision,
      );
    } else {
      runtime.warnings.push({
        code: "avatar_files_unavailable",
        slot: "primary_model",
        runtime_id: "primary",
      });
    }
  }
  runtime.profile_image = null;
  runtime.background_image = null;
  for (const rawAppearance of Array.isArray(typed.appearances)
    ? typed.appearances
    : []) {
    const appearance = object(rawAppearance);
    const use = String(appearance.use);
    if (use !== "profile" && use !== "background") continue;
    const slot = use === "profile" ? "profile_image" : "background_image";
    const entry = privateEntry(
      {
        ...appearance,
        name: `${use === "profile" ? "Profile" : "Background"} image`,
        config: object(appearance.presentation),
      },
      slot,
      use,
      "image",
      typed.effective_revision,
    );
    append(runtime, entry);
  }
  const idleStyle = object(typed.idle_style);
  if (
    Array.isArray(idleStyle.gestures) &&
    (idleStyle.schema_version === 2 || idleStyle.gestures.length > 0)
  ) {
    const runtimeIds = new Map<string, string>();
    for (const raw of idleStyle.gestures) {
      const gesture = object(raw);
      const itemId = String(object(gesture.source).item_id ?? "");
      const runtimeId = String(gesture.binding_id ?? `idle:${itemId}`);
      const playback = object(gesture.idle_playback);
      if (!itemId || playback.eligible !== true) continue;
      runtimeIds.set(itemId, runtimeId);
      const entry = privateEntry(
        {
          ...gesture,
          runtime_root_id: idleStyle.runtime_root_id,
          config: {
            ...object(gesture.config),
            idle_playback: playback,
            duration_seconds: playback.cycle_seconds,
            loop_type: playback.loop_type,
            loop_count: playback.repetitions,
            time_scale: playback.time_scale,
            preload_tier: "tier_a",
          },
        },
        "idle_animation",
        runtimeId,
        object(gesture.implementation).kind === "vrma"
          ? "animation"
          : "anima_pose_clip",
        typed.effective_revision,
      );
      append(runtime, entry);
    }
    const ids = (value: unknown): string[] =>
      Array.isArray(value)
        ? value
            .map((id) => runtimeIds.get(String(id)))
            .filter((id): id is string => !!id)
        : [];
    runtime.idle_style_pools = {
      default: ids(idleStyle.default_pool),
      cells: Object.fromEntries(
        Object.entries(object(idleStyle.cells)).map(([emotion, levels]) => [
          emotion,
          Object.fromEntries(
            Object.entries(object(levels)).map(([level, raw]) => [
              level,
              object(raw).mode === "none" ? [] : ids(object(raw).gestures),
            ]),
          ),
        ]),
      ),
    };
  }
  const defaultPool = new Set(
    Array.isArray(idleStyle.default_pool)
      ? idleStyle.default_pool.map(String)
      : [],
  );
  const emotionPools = object(idleStyle.emotion_pools);
  for (const rawAnimation of Array.isArray(idleStyle.animations)
    ? idleStyle.animations
    : []) {
    const animation = object(rawAnimation);
    const animationId = String(animation.animation_id ?? "");
    if (!animationId) continue;
    const emotions = Object.entries(emotionPools)
      .filter(
        ([, pool]) =>
          Array.isArray(pool) && pool.map(String).includes(animationId),
      )
      .map(([emotion]) => emotion);
    const config = {
      ...object(animation.playback),
      idle_style_default: defaultPool.has(animationId),
      idle_style_emotions: emotions,
      emotion_weights: Object.fromEntries(
        emotions.map((emotion) => [emotion, { "1": 1, "2": 1, "3": 1 }]),
      ),
      preload_tier: "tier_a",
    };
    const files = Array.isArray(animation.files) ? animation.files : [];
    let entry: RuntimeCatalogEntry | null = null;
    if (files.length) {
      entry = privateEntry(
        { ...animation, config, runtime_root_id: idleStyle.runtime_root_id },
        "idle_animation",
        animationId,
        "animation",
        typed.effective_revision,
      );
    } else {
      runtime.warnings.push({
        code: "idle_files_unavailable",
        slot: "idle_animation",
        runtime_id: animationId,
      });
    }
    if (entry) append(runtime, entry);
  }
  const supports = [
    ...(typed.particle_effects ?? []),
    ...(typed.avatar_effects ?? []),
    ...(typed.scene_effects ?? []),
    ...(typed.sound_effects ?? []),
  ] as Record<string, unknown>[];
  const supportById = new Map(
    supports.map((support) => [String(support.runtime_id), support]),
  );
  // Support IDs are closure-global opaque identities. Local aliases belong to
  // the root/support document that declares them and are rewritten by the
  // player through runtime_reference_map. Mounting aliases globally makes two
  // otherwise valid roots overwrite each other's resources.
  for (const support of supportById.values()) {
    const runtimeId = String(support.runtime_id);
    const contentType = String(support.content_type);
    const slot = supportSlot(support);
    const supportFiles = Array.isArray(support.files) ? support.files : [];
    if (supportFiles.length === 0 && contentType !== "scene_effect") {
      runtime.warnings.push({
        code: "support_files_unavailable",
        slot,
        runtime_id: runtimeId,
      });
      continue;
    }
    append(
      runtime,
      privateEntry(
        support,
        slot,
        runtimeId,
        kindsByType[contentType]!,
        typed.effective_revision,
      ),
    );
  }
  for (const gesture of typed.gestures ?? []) {
    const entry = rootEntry(
      gesture,
      "gesture",
      gesture.semantic_key ?? gesture.binding_id,
      typed.effective_revision,
    );
    if (entry) append(runtime, entry);
  }
  for (const reaction of typed.reactions ?? []) {
    const entry = rootEntry(
      reaction,
      "reaction",
      `${reaction.emotion}-${reaction.intensity}`,
      typed.effective_revision,
    );
    if (entry) append(runtime, entry);
  }
  for (const pose of typed.poses ?? []) {
    const entry = rootEntry(
      pose,
      "pose",
      pose.semantic_key ?? pose.binding_id,
      typed.effective_revision,
    );
    if (entry) append(runtime, entry);
  }
  runtime.effective_revision = typed.effective_revision;
  runtime.loadout_revision = typed.loadout_revision;
  // Availability grows within one frozen revision. Retain entry identity so
  // React never reloads an already visible model or background on admission.
  if (previous?.effective_revision === runtime.effective_revision) {
    for (const key of [
      "avatar_model",
      "profile_image",
      "background_image",
    ] as const) {
      if (runtime[key] && previous[key]) runtime[key] = previous[key];
    }
    for (const key of [
      "idle_animations",
      "gestures",
      "poses",
      "reactions",
      "particle_vfx",
      "avatar_vfx",
      "scene_background_vfx",
      "scene_focus_vfx",
      "sfx",
    ] as const) {
      const entries = new Map(
        previous[key].map((entry) => [entry.runtime_id, entry]),
      );
      runtime[key] = runtime[key].map(
        (entry) => entries.get(entry.runtime_id) ?? entry,
      );
    }
  }
  return runtime;
}
