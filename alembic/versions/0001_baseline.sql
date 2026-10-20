-- Accountless development baseline, originally captured from revisions 0001 through 0013.
-- Update this schema alongside ORM changes during development; do not add revisions.
-- Installation identity is seeded in Python.

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

-- animama-statement --

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;

-- animama-statement --

CREATE TABLE anima (
    id character varying NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    user_id character varying,
    archive_id character varying,
    avatar_id character varying,
    profile_picture_url text,
    emotional_state jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by_id character varying,
    last_updated_by_id character varying,
    organization_id character varying,
    display_name character varying(120) NOT NULL,
    aggregate_revision integer DEFAULT 1 NOT NULL,
    identity_status character varying(32) DEFAULT 'repair_required'::character varying NOT NULL,
    CONSTRAINT ck_anima_anima_aggregate_revision_positive CHECK ((aggregate_revision >= 1)),
    CONSTRAINT ck_anima_anima_display_name_length CHECK (((length((display_name)::text) >= 1) AND (length((display_name)::text) <= 120))),
    CONSTRAINT ck_anima_anima_identity_status_valid CHECK (((identity_status)::text = ANY ((ARRAY['ready'::character varying, 'repair_required'::character varying])::text[])))
);

-- animama-statement --

CREATE TABLE anima_chat_profiles (
    anima_id character varying NOT NULL,
    default_model_provider_id character varying NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- animama-statement --

CREATE TABLE anima_content_bindings (
    id character varying NOT NULL,
    anima_id character varying NOT NULL,
    slot_key character varying(192) NOT NULL,
    catalog_item_id character varying NOT NULL,
    kind character varying(32) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT ck_anima_content_bindings_config_object CHECK ((jsonb_typeof(config) = 'object'::text)),
    CONSTRAINT ck_anima_content_bindings_slot_key_length CHECK (((char_length((slot_key)::text) >= 1) AND (char_length((slot_key)::text) <= 192))),
    CONSTRAINT ck_anima_content_bindings_typed_kind_values CHECK (((kind)::text = ANY ((ARRAY['avatar'::character varying, 'gesture'::character varying, 'reaction'::character varying, 'music_track'::character varying, 'appearance'::character varying, 'voice'::character varying])::text[]))),
    CONSTRAINT ck_anima_content_bindings_typed_slot_shape CHECK (((((kind)::text = 'avatar'::text) AND ((slot_key)::text = 'avatar'::text)) OR (((kind)::text = 'gesture'::text) AND ((((slot_key)::text ~~ 'gesture:%'::text) AND (char_length((slot_key)::text) > 8)) OR (((slot_key)::text ~~ 'idle:%'::text) AND (char_length((slot_key)::text) > 5)))) OR (((kind)::text = 'reaction'::text) AND ((slot_key)::text ~~ 'reaction:%-_:_%'::text)) OR (((kind)::text = 'music_track'::text) AND ((slot_key)::text ~~ 'music:%'::text) AND (char_length((slot_key)::text) > 6)) OR (((kind)::text = 'appearance'::text) AND ((slot_key)::text = ANY ((ARRAY['appearance:profile'::character varying, 'appearance:background'::character varying])::text[]))) OR (((kind)::text = 'voice'::text) AND ((slot_key)::text = 'voice'::text))))
);

-- animama-statement --

CREATE TABLE anima_creation_receipts (
    owner_user_id character varying NOT NULL,
    operation character varying(32) NOT NULL,
    idempotency_key character varying(128) NOT NULL,
    spec_sha256 character varying(64) NOT NULL,
    anima_id character varying NOT NULL,
    result jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT ck_anima_creation_receipts_creation_operation CHECK (((operation)::text = 'live_anima_create_v1'::text)),
    CONSTRAINT ck_anima_creation_receipts_creation_result_bounded CHECK (((jsonb_typeof(result) = 'object'::text) AND (octet_length((result)::text) <= 65536)))
);

-- animama-statement --

CREATE TABLE anima_definition_revisions (
    anima_id character varying NOT NULL,
    aggregate_revision integer NOT NULL,
    display_name character varying(120) NOT NULL,
    identity_entry_id character varying,
    identity_version integer,
    actor_id character varying,
    reason character varying(128) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT ck_anima_definition_revisions_anima_definition_identity_434b CHECK ((((identity_entry_id IS NULL) AND (identity_version IS NULL)) OR ((identity_entry_id IS NOT NULL) AND (identity_version IS NOT NULL) AND (identity_version >= 1)))),
    CONSTRAINT ck_anima_definition_revisions_anima_definition_revision_ad02 CHECK ((aggregate_revision >= 1))
);

-- animama-statement --

CREATE TABLE anima_loadout_diagnostics (
    id character varying NOT NULL,
    anima_id character varying NOT NULL,
    code character varying(64) NOT NULL,
    slot_key character varying(192),
    catalog_item_id character varying,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- animama-statement --

CREATE TABLE anima_loadout_mutation_receipts (
    id character varying NOT NULL,
    owner_user_id character varying NOT NULL,
    anima_id character varying NOT NULL,
    idempotency_key character varying(128) NOT NULL,
    request_digest character varying(64) NOT NULL,
    result jsonb NOT NULL,
    resulting_revision integer NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- animama-statement --

CREATE TABLE anima_loadouts (
    anima_id character varying NOT NULL,
    owner_user_id character varying NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    starter_catalog_version integer DEFAULT 1 NOT NULL,
    starter_exclusions jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT ck_anima_loadouts_revision_positive CHECK ((revision > 0)),
    CONSTRAINT ck_anima_loadouts_starter_catalog_version_positive CHECK ((starter_catalog_version > 0)),
    CONSTRAINT ck_anima_loadouts_starter_exclusions_array CHECK ((jsonb_typeof(starter_exclusions) = 'array'::text))
);

-- animama-statement --

CREATE TABLE anima_memory_reflections (
    anima_id character varying NOT NULL,
    user_id character varying NOT NULL,
    covered_through_created_at timestamp without time zone NOT NULL,
    covered_through_message_id integer NOT NULL,
    run_id character varying NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT ck_anima_memory_reflections_message_id_positive CHECK ((covered_through_message_id >= 1))
);

-- animama-statement --

CREATE TABLE anima_runtime_snapshots (
    id character varying NOT NULL,
    owner_user_id character varying NOT NULL,
    anima_id character varying NOT NULL,
    loadout_revision integer NOT NULL,
    effective_revision character varying(128) NOT NULL,
    catalog_digest character varying(64) NOT NULL,
    catalog jsonb NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    admitted_item_revisions jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT ck_anima_runtime_snapshots_admitted_item_revisions_object CHECK ((jsonb_typeof(admitted_item_revisions) = 'object'::text))
);

-- animama-statement --

CREATE TABLE anima_settings (
    user_id character varying NOT NULL,
    anima_id character varying NOT NULL,
    theme jsonb,
    background character varying,
    favorited boolean DEFAULT false NOT NULL,
    preferences jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- animama-statement --

CREATE TABLE anima_starter_receipts (
    owner_user_id character varying NOT NULL,
    starter_id character varying(32) NOT NULL,
    spec_version integer NOT NULL,
    state character varying(32) NOT NULL,
    anima_id character varying,
    diagnostics jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT ck_anima_starter_receipts_starter_identity CHECK (((starter_id)::text = ANY ((ARRAY['starter:annie'::character varying, 'starter:andrew'::character varying])::text[]))),
    CONSTRAINT ck_anima_starter_receipts_starter_result_required CHECK ((((state)::text <> 'ready'::text) OR (anima_id IS NOT NULL))),
    CONSTRAINT ck_anima_starter_receipts_starter_state CHECK (((state)::text = ANY ((ARRAY['ready'::character varying, 'deleted'::character varying, 'legacy_unresolved'::character varying])::text[]))),
    CONSTRAINT ck_anima_starter_receipts_starter_version CHECK ((spec_version >= 1))
);

-- animama-statement --

CREATE TABLE archive_passages (
    id integer NOT NULL,
    archive_id character varying NOT NULL,
    text text NOT NULL,
    embedding vector,
    embedding_model_id character varying,
    embedding_rejections integer DEFAULT 0 NOT NULL,
    embedding_rejected_model_id character varying,
    tags json,
    metadata_ json,
    source_id character varying,
    file_id character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- animama-statement --

CREATE SEQUENCE archive_passages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

-- animama-statement --

ALTER SEQUENCE archive_passages_id_seq OWNED BY archive_passages.id;

-- animama-statement --

CREATE TABLE archives (
    id character varying NOT NULL,
    name character varying NOT NULL,
    description character varying,
    metadata_ json,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    organization_id character varying
);

-- animama-statement --

CREATE TABLE avatar (
    id character varying NOT NULL,
    name character varying NOT NULL,
    file_path character varying NOT NULL,
    identity text DEFAULT ''::text NOT NULL,
    user_id character varying,
    model_type character varying DEFAULT 'vrm'::character varying NOT NULL,
    animation_profile character varying,
    private boolean DEFAULT false NOT NULL,
    presentation_revision integer DEFAULT 1 NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by_id character varying,
    last_updated_by_id character varying,
    catalog_item_id character varying
);

-- animama-statement --

CREATE TABLE avatar_face_part_overrides (
    owner_user_id character varying NOT NULL,
    avatar_item_id character varying NOT NULL,
    avatar_revision_sha256 character varying(64) NOT NULL,
    parts jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT ck_avatar_face_part_overrides_avatar_revision_sha256_format CHECK (((avatar_revision_sha256)::text ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT ck_avatar_face_part_overrides_parts_object CHECK ((jsonb_typeof(parts) = 'object'::text))
);

-- animama-statement --

CREATE TABLE avatar_upload (
    id character varying NOT NULL,
    user_id character varying NOT NULL,
    storage_locator character varying NOT NULL,
    original_filename character varying NOT NULL,
    declared_content_type character varying,
    declared_size_bytes integer NOT NULL,
    upload_type character varying DEFAULT 'avatar_vrm'::character varying NOT NULL,
    status character varying DEFAULT 'pending'::character varying NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    avatar_id character varying,
    anima_id character varying,
    last_error text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- animama-statement --

CREATE TABLE chat_compactions (
    id character varying NOT NULL,
    chat_id character varying NOT NULL,
    user_id character varying NOT NULL,
    anima_id character varying NOT NULL,
    status character varying DEFAULT 'active'::character varying NOT NULL,
    summary_text text,
    start_turn integer,
    end_turn integer,
    source_message_count integer DEFAULT 0 NOT NULL,
    model_provider character varying,
    model character varying,
    prompt_version character varying,
    input_tokens integer,
    output_tokens integer,
    cached_input_tokens integer,
    output_reasoning_tokens integer,
    total_tokens integer,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    superseded_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT ck_chat_compactions_ck_chat_cmp_cached_input_nonneg CHECK (((cached_input_tokens IS NULL) OR (cached_input_tokens >= 0))),
    CONSTRAINT ck_chat_compactions_ck_chat_cmp_end_turn_positive CHECK (((end_turn IS NULL) OR (end_turn >= 1))),
    CONSTRAINT ck_chat_compactions_ck_chat_cmp_input_nonneg CHECK (((input_tokens IS NULL) OR (input_tokens >= 0))),
    CONSTRAINT ck_chat_compactions_ck_chat_cmp_output_nonneg CHECK (((output_tokens IS NULL) OR (output_tokens >= 0))),
    CONSTRAINT ck_chat_compactions_ck_chat_cmp_reasoning_nonneg CHECK (((output_reasoning_tokens IS NULL) OR (output_reasoning_tokens >= 0))),
    CONSTRAINT ck_chat_compactions_ck_chat_cmp_source_msg_nonneg CHECK ((source_message_count >= 0)),
    CONSTRAINT ck_chat_compactions_ck_chat_cmp_start_turn_positive CHECK (((start_turn IS NULL) OR (start_turn >= 1))),
    CONSTRAINT ck_chat_compactions_ck_chat_cmp_status CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'superseded'::character varying, 'failed'::character varying])::text[]))),
    CONSTRAINT ck_chat_compactions_ck_chat_cmp_total_nonneg CHECK (((total_tokens IS NULL) OR (total_tokens >= 0))),
    CONSTRAINT ck_chat_compactions_ck_chat_cmp_turn_order CHECK (((start_turn IS NULL) OR (end_turn IS NULL) OR (start_turn <= end_turn)))
);

-- animama-statement --

CREATE TABLE chat_messages (
    id integer NOT NULL,
    chat_id character varying NOT NULL,
    run_id character varying,
    message_type character varying,
    role character varying,
    content text,
    model character varying,
    model_provider character varying,
    search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english'::regconfig, COALESCE(NULLIF(((COALESCE(NULLIF((message_data #>> '{structured,speech}'::text[]), ''::text), ''::text) ||
CASE
    WHEN ((NULLIF((message_data #>> '{structured,speech}'::text[]), ''::text) IS NOT NULL) AND (NULLIF((message_data #>> '{structured,display}'::text[]), ''::text) IS NOT NULL)) THEN ' '::text
    ELSE ''::text
END) || COALESCE(NULLIF((message_data #>> '{structured,display}'::text[]), ''::text), ''::text)), ''::text), content, ''::text))) STORED NOT NULL,
    message_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    raw_provider_message jsonb,
    input_tokens integer,
    output_tokens integer,
    cached_input_tokens integer,
    output_reasoning_tokens integer,
    total_tokens integer,
    turn integer,
    internal boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT ck_chat_messages_ck_chat_messages_turn_positive CHECK (((turn IS NULL) OR (turn >= 1)))
);

-- animama-statement --

CREATE SEQUENCE chat_messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

-- animama-statement --

ALTER SEQUENCE chat_messages_id_seq OWNED BY chat_messages.id;

-- animama-statement --

CREATE TABLE chats (
    id character varying NOT NULL,
    user_id character varying NOT NULL,
    anima_id character varying NOT NULL,
    title character varying,
    api_standard character varying,
    last_model_client character varying,
    last_model_id character varying,
    last_model_provider_id character varying,
    openai_previous_response_id character varying,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    cum_input_tokens integer DEFAULT 0 NOT NULL,
    cum_output_tokens integer DEFAULT 0 NOT NULL,
    cum_total_tokens integer DEFAULT 0 NOT NULL,
    cum_cached_input_tokens integer DEFAULT 0 NOT NULL,
    cum_output_reasoning_tokens integer DEFAULT 0 NOT NULL,
    active_context_tokens integer DEFAULT 0 NOT NULL,
    next_turn integer DEFAULT 1 NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by_id character varying,
    last_updated_by_id character varying,
    CONSTRAINT ck_chats_api_standard_valid CHECK (((api_standard IS NULL) OR ((api_standard)::text = ANY ((ARRAY['chat_completions'::character varying, 'responses'::character varying, 'anthropic_messages'::character varying])::text[])))),
    CONSTRAINT ck_chats_last_model_client_valid CHECK (((last_model_client IS NULL) OR ((last_model_client)::text = ANY ((ARRAY['openai_chat_completions'::character varying, 'openai_responses'::character varying, 'anthropic_messages'::character varying])::text[]))))
);

-- animama-statement --

CREATE TABLE companion_safety_state (
    user_id character varying NOT NULL,
    age_status character varying DEFAULT 'unknown'::character varying NOT NULL,
    age_status_source character varying,
    age_status_recorded_at timestamp with time zone,
    last_notice_at timestamp with time zone,
    last_notice_local_date date,
    interaction_started_at timestamp with time zone,
    last_turn_started_at timestamp with time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT ck_companion_safety_state_age_status CHECK (((age_status)::text = ANY ((ARRAY['unknown'::character varying, 'adult'::character varying, 'minor'::character varying])::text[]))),
    CONSTRAINT ck_companion_safety_state_age_status_source CHECK (((age_status_source IS NULL) OR ((age_status_source)::text = 'self_attestation'::text)))
);

-- animama-statement --

CREATE TABLE content_catalog_dependencies (
    item_id character varying NOT NULL,
    ordinal integer NOT NULL,
    declared_ref character varying(512) NOT NULL,
    target_item_id character varying,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT ck_content_catalog_dependencies_ordinal_positive CHECK ((ordinal > 0))
);

-- animama-statement --

CREATE TABLE content_catalog_files (
    file_ref character varying NOT NULL,
    item_id character varying NOT NULL,
    relative_path text NOT NULL,
    role character varying(64) NOT NULL,
    media_type character varying(255) NOT NULL,
    size_bytes bigint NOT NULL,
    sha256 character varying(64) NOT NULL,
    ordinal integer NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT ck_content_catalog_files_ordinal_positive CHECK ((ordinal > 0)),
    CONSTRAINT ck_content_catalog_files_sha256_format CHECK (((sha256)::text ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT ck_content_catalog_files_size_bytes_positive CHECK ((size_bytes > 0))
);

-- animama-statement --

CREATE TABLE content_catalog_items (
    id character varying NOT NULL,
    source character varying(16) NOT NULL,
    scope character varying(32) NOT NULL,
    owner_user_id character varying,
    kind character varying(32) NOT NULL,
    relative_locator text NOT NULL,
    descriptor_relative_path text,
    logical_key character varying(192),
    display_name character varying(120) NOT NULL,
    status character varying(24) NOT NULL,
    revision_sha256 character varying(64),
    provenance jsonb DEFAULT '{}'::jsonb NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    diagnostics jsonb DEFAULT '[]'::jsonb NOT NULL,
    scanned_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    source_mount_id character varying(256),
    CONSTRAINT ck_content_catalog_items_display_name_length CHECK (((char_length((display_name)::text) >= 1) AND (char_length((display_name)::text) <= 120))),
    CONSTRAINT ck_content_catalog_items_kind_values CHECK (((kind)::text = ANY ((ARRAY['avatar'::character varying, 'gesture'::character varying, 'pose'::character varying, 'pose_clip'::character varying, 'reaction'::character varying, 'particle_effect'::character varying, 'avatar_effect'::character varying, 'scene_effect'::character varying, 'sound_effect'::character varying, 'music_track'::character varying, 'appearance'::character varying, 'voice'::character varying, 'anima'::character varying])::text[]))),
    CONSTRAINT ck_content_catalog_items_owner_scope_consistency CHECK (((((scope)::text = 'owner'::text) AND (owner_user_id IS NOT NULL)) OR (((scope)::text <> 'owner'::text) AND (owner_user_id IS NULL)))),
    CONSTRAINT ck_content_catalog_items_revision_sha256_format CHECK (((revision_sha256 IS NULL) OR ((revision_sha256)::text ~ '^[0-9a-f]{64}$'::text))),
    CONSTRAINT ck_content_catalog_items_scope_values CHECK (((scope)::text = ANY ((ARRAY['included'::character varying, 'owner'::character varying, 'installation_shared'::character varying])::text[]))),
    CONSTRAINT ck_content_catalog_items_source_values CHECK (((source)::text = ANY ((ARRAY['included'::character varying, 'local'::character varying])::text[]))),
    CONSTRAINT ck_content_catalog_items_status_values CHECK (((status)::text = ANY ((ARRAY['valid'::character varying, 'invalid'::character varying, 'missing'::character varying, 'scan_required'::character varying])::text[])))
);

-- animama-statement --

CREATE TABLE content_mutation_receipts (
    owner_user_id character varying NOT NULL,
    operation_id character varying(128) NOT NULL,
    request_digest character varying(64) NOT NULL,
    result jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT ck_content_mutation_receipts_content_mutation_digest CHECK (((request_digest)::text ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT ck_content_mutation_receipts_content_mutation_result_object CHECK ((jsonb_typeof(result) = 'object'::text))
);

-- animama-statement --

CREATE TABLE content_preview_files (
    preview_id character varying NOT NULL,
    file_ref character varying NOT NULL,
    source character varying(16) NOT NULL,
    relative_path text NOT NULL,
    role character varying(64) NOT NULL,
    media_type character varying(255) NOT NULL,
    size_bytes bigint NOT NULL,
    sha256 character varying(64) NOT NULL,
    ordinal integer NOT NULL,
    source_mount_id character varying(256),
    CONSTRAINT ck_content_preview_files_ordinal_positive CHECK ((ordinal > 0)),
    CONSTRAINT ck_content_preview_files_sha256_format CHECK (((sha256)::text ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT ck_content_preview_files_size_bytes_positive CHECK ((size_bytes > 0)),
    CONSTRAINT ck_content_preview_files_source_values CHECK (((source)::text = ANY ((ARRAY['included'::character varying, 'local'::character varying])::text[])))
);

-- animama-statement --

CREATE TABLE content_previews (
    id character varying NOT NULL,
    owner_user_id character varying NOT NULL,
    item_id character varying NOT NULL,
    revision_sha256 character varying(64) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT ck_content_previews_revision_sha256_format CHECK (((revision_sha256)::text ~ '^[0-9a-f]{64}$'::text))
);

-- animama-statement --

CREATE TABLE installation_settings (
    id smallint DEFAULT 1 NOT NULL,
    installation_principal_id text NOT NULL,
    first_run_completed_at timestamp with time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT ck_installation_settings_singleton_id CHECK ((id = 1))
);

-- animama-statement --

CREATE TABLE memory_entries (
    id character varying NOT NULL,
    user_id character varying NOT NULL,
    anima_id character varying,
    parent_id character varying,
    type character varying NOT NULL,
    name character varying(128) NOT NULL,
    normalized_name character varying(128) NOT NULL,
    path character varying(512) NOT NULL,
    normalized_path character varying(512) NOT NULL,
    content text,
    content_sha256 character varying(64),
    size_bytes bigint,
    version integer NOT NULL,
    kind character varying,
    description text,
    search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english'::regconfig, (((((COALESCE(path, (''::text)::character varying))::text || ' '::text) || COALESCE(description, ''::text)) || ' '::text) || COALESCE(content, ''::text)))) STORED NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    deleted_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT ck_memory_entries_memory_entries_name_non_empty CHECK ((length((name)::text) > 0)),
    CONSTRAINT ck_memory_entries_memory_entries_path_non_empty CHECK ((length((path)::text) > 0)),
    CONSTRAINT ck_memory_entries_memory_entries_size_bytes_non_negative CHECK (((size_bytes IS NULL) OR (size_bytes >= 0))),
    CONSTRAINT ck_memory_entries_memory_entries_type_payload_valid CHECK (((((type)::text = 'file'::text) AND (content IS NOT NULL) AND (content_sha256 IS NOT NULL) AND (size_bytes IS NOT NULL)) OR (((type)::text = 'directory'::text) AND (content IS NULL) AND (content_sha256 IS NULL) AND (size_bytes IS NULL)))),
    CONSTRAINT ck_memory_entries_memory_entries_type_valid CHECK (((type)::text = ANY ((ARRAY['file'::character varying, 'directory'::character varying])::text[]))),
    CONSTRAINT ck_memory_entries_memory_entries_version_positive CHECK ((version >= 1))
);

-- animama-statement --

CREATE TABLE memory_entry_versions (
    id integer NOT NULL,
    entry_id character varying NOT NULL,
    user_id character varying NOT NULL,
    anima_id character varying,
    parent_id character varying,
    type character varying NOT NULL,
    name character varying(128) NOT NULL,
    normalized_name character varying(128) NOT NULL,
    path character varying(512) NOT NULL,
    normalized_path character varying(512) NOT NULL,
    version integer NOT NULL,
    operation character varying NOT NULL,
    content text,
    content_sha256 character varying(64),
    size_bytes bigint,
    kind character varying,
    description text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    change_metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    deleted_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT ck_memory_entry_versions_memory_entry_versions_operation_valid CHECK (((operation)::text = ANY ((ARRAY['create'::character varying, 'update'::character varying, 'move'::character varying, 'delete'::character varying, 'undo'::character varying, 'revert'::character varying])::text[]))),
    CONSTRAINT ck_memory_entry_versions_memory_entry_versions_size_non_ab12 CHECK (((size_bytes IS NULL) OR (size_bytes >= 0))),
    CONSTRAINT ck_memory_entry_versions_memory_entry_versions_type_valid CHECK (((type)::text = ANY ((ARRAY['file'::character varying, 'directory'::character varying])::text[]))),
    CONSTRAINT ck_memory_entry_versions_memory_entry_versions_version_positive CHECK ((version >= 1))
);

-- animama-statement --

CREATE SEQUENCE memory_entry_versions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

-- animama-statement --

ALTER SEQUENCE memory_entry_versions_id_seq OWNED BY memory_entry_versions.id;

-- animama-statement --

CREATE TABLE memory_episode_items (
    id character varying NOT NULL,
    user_id character varying NOT NULL,
    source_anima_id character varying,
    source_chat_id character varying,
    source_run_id character varying,
    source_message_id character varying,
    occurred_at timestamp with time zone NOT NULL,
    local_date date NOT NULL,
    local_timezone character varying(128),
    episode_path character varying(512) NOT NULL,
    kind character varying DEFAULT 'chat_turn'::character varying NOT NULL,
    text text NOT NULL,
    status character varying DEFAULT 'pending'::character varying NOT NULL,
    processed_at timestamp with time zone,
    processed_by_run_id character varying,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT ck_memory_episode_items_memory_episode_items_episode_pa_6167 CHECK ((length((episode_path)::text) > 0)),
    CONSTRAINT ck_memory_episode_items_memory_episode_items_status_valid CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'processed'::character varying])::text[]))),
    CONSTRAINT ck_memory_episode_items_memory_episode_items_text_non_empty CHECK ((length(text) > 0))
);

-- animama-statement --

CREATE TABLE memory_manager_approvals (
    id character varying NOT NULL,
    run_id character varying NOT NULL,
    user_id character varying NOT NULL,
    status character varying DEFAULT 'pending'::character varying NOT NULL,
    operation character varying NOT NULL,
    target_path character varying(512) NOT NULL,
    target_entry_id character varying,
    expected_version integer,
    summary text,
    old_content text,
    new_content text,
    old_description text,
    new_description text,
    unified_diff text NOT NULL,
    operation_metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    decision_feedback text,
    applied_version integer,
    undone_at timestamp without time zone,
    undo_version integer,
    decided_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT ck_memory_manager_approvals_memory_manager_approvals_ap_116b CHECK (((applied_version IS NULL) OR (applied_version >= 1))),
    CONSTRAINT ck_memory_manager_approvals_memory_manager_approvals_op_913a CHECK (((operation)::text = ANY ((ARRAY['create'::character varying, 'update'::character varying, 'delete'::character varying])::text[]))),
    CONSTRAINT ck_memory_manager_approvals_memory_manager_approvals_st_906c CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'rejected'::character varying])::text[]))),
    CONSTRAINT ck_memory_manager_approvals_memory_manager_approvals_ta_3f18 CHECK ((length((target_path)::text) > 0)),
    CONSTRAINT ck_memory_manager_approvals_memory_manager_approvals_un_56e1 CHECK (((undo_version IS NULL) OR (((status)::text = 'approved'::text) AND (applied_version IS NOT NULL)))),
    CONSTRAINT ck_memory_manager_approvals_memory_manager_approvals_un_7ea0 CHECK (((undo_version IS NULL) OR (undo_version >= 1))),
    CONSTRAINT ck_memory_manager_approvals_memory_manager_approvals_un_d3e1 CHECK ((((undone_at IS NULL) AND (undo_version IS NULL)) OR ((undone_at IS NOT NULL) AND (undo_version IS NOT NULL))))
);

-- animama-statement --

CREATE TABLE memory_manager_messages (
    id character varying NOT NULL,
    run_id character varying NOT NULL,
    user_id character varying NOT NULL,
    role character varying NOT NULL,
    content text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT ck_memory_manager_messages_memory_manager_messages_cont_9b13 CHECK ((length(content) > 0)),
    CONSTRAINT ck_memory_manager_messages_memory_manager_messages_role_valid CHECK (((role)::text = ANY ((ARRAY['user'::character varying, 'assistant'::character varying, 'system'::character varying])::text[])))
);

-- animama-statement --

CREATE TABLE memory_manager_runs (
    id character varying NOT NULL,
    user_id character varying NOT NULL,
    status character varying DEFAULT 'active'::character varying NOT NULL,
    kind character varying DEFAULT 'general'::character varying NOT NULL,
    task_state jsonb,
    model_provider character varying,
    model_name character varying,
    model_provider_id character varying,
    openai_previous_response_id character varying,
    serialized_agent_state text,
    summary text,
    error text,
    usage_metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    completed_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT ck_memory_manager_runs_memory_manager_runs_kind_valid CHECK (((kind)::text = ANY ((ARRAY['general'::character varying, 'episode_processing'::character varying, 'reflection'::character varying])::text[]))),
    CONSTRAINT ck_memory_manager_runs_memory_manager_runs_status_valid CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'waiting_approval'::character varying, 'completed'::character varying, 'failed'::character varying])::text[])))
);

-- animama-statement --

CREATE TABLE model_connections (
    id character varying NOT NULL,
    source character varying NOT NULL,
    name character varying NOT NULL,
    preset character varying NOT NULL,
    base_url character varying,
    credential_env character varying,
    compatibility jsonb NOT NULL,
    timeout_seconds double precision,
    active boolean NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT ck_model_connections_source_valid CHECK (((source)::text = ANY ((ARRAY['builtin'::character varying, 'owner'::character varying])::text[])))
);

-- animama-statement --

CREATE TABLE model_providers (
    id character varying NOT NULL,
    model character varying NOT NULL,
    provider_type character varying NOT NULL,
    model_label character varying NOT NULL,
    provider_label character varying NOT NULL,
    logo_provider character varying,
    model_type character varying,
    current_snapshot character varying,
    context_window_tokens integer,
    max_output_tokens integer,
    connection_id character varying DEFAULT 'openai'::character varying NOT NULL,
    source character varying DEFAULT 'builtin'::character varying NOT NULL,
    model_kind character varying DEFAULT 'chat'::character varying NOT NULL,
    hidden boolean DEFAULT false NOT NULL,
    early_compaction boolean DEFAULT true NOT NULL,
    allow_memory_writes boolean DEFAULT true NOT NULL,
    probe_result jsonb,
    service_tiers_supported json NOT NULL,
    active boolean NOT NULL,
    deprecated_at timestamp without time zone,
    accepts json NOT NULL,
    produces json NOT NULL,
    supports_developer_role boolean NOT NULL,
    supports_tools boolean NOT NULL,
    supports_streaming boolean NOT NULL,
    structured_kinds json NOT NULL,
    structured_output_transport character varying,
    supports_reasoning boolean,
    supported_reasoning_efforts json,
    native_tool_support json,
    tools_with_structured_output boolean DEFAULT true NOT NULL,
    pricing_status character varying NOT NULL,
    pricing_source_provider character varying,
    pricing_source_model character varying,
    pricing_source_url character varying,
    pricing_source_checked_at date,
    currency character varying,
    billing_unit character varying,
    standard_input_price_per_million numeric(12,6),
    standard_cached_input_price_per_million numeric(12,6),
    standard_output_price_per_million numeric(12,6),
    batch_input_price_per_million numeric(12,6),
    batch_cached_input_price_per_million numeric(12,6),
    batch_output_price_per_million numeric(12,6),
    flex_input_price_per_million numeric(12,6),
    flex_cached_input_price_per_million numeric(12,6),
    flex_output_price_per_million numeric(12,6),
    priority_input_price_per_million numeric(12,6),
    priority_cached_input_price_per_million numeric(12,6),
    priority_output_price_per_million numeric(12,6),
    long_context_token_threshold integer,
    standard_long_context_input_price_per_million numeric(12,6),
    standard_long_context_cached_input_price_per_million numeric(12,6),
    standard_long_context_output_price_per_million numeric(12,6),
    batch_long_context_input_price_per_million numeric(12,6),
    batch_long_context_cached_input_price_per_million numeric(12,6),
    batch_long_context_output_price_per_million numeric(12,6),
    flex_long_context_input_price_per_million numeric(12,6),
    flex_long_context_cached_input_price_per_million numeric(12,6),
    flex_long_context_output_price_per_million numeric(12,6),
    priority_long_context_input_price_per_million numeric(12,6),
    priority_long_context_cached_input_price_per_million numeric(12,6),
    priority_long_context_output_price_per_million numeric(12,6),
    regional_processing_uplift_factor numeric(12,6),
    pricing_notes json NOT NULL,
    metadata json NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT ck_model_providers_model_kind_valid CHECK (((model_kind)::text = ANY ((ARRAY['chat'::character varying, 'embedding'::character varying])::text[]))),
    CONSTRAINT ck_model_providers_source_valid CHECK (((source)::text = ANY ((ARRAY['builtin'::character varying, 'owner'::character varying])::text[])))
);

-- animama-statement --

CREATE TABLE passage_tags (
    passage_id integer NOT NULL,
    tag_id integer NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- animama-statement --

CREATE TABLE runtime_worker_heartbeats (
    kind character varying(64) NOT NULL,
    instance_id character varying(128) NOT NULL,
    heartbeat_at timestamp with time zone NOT NULL
);

-- animama-statement --

CREATE TABLE tags (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- animama-statement --

CREATE SEQUENCE tags_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

-- animama-statement --

ALTER SEQUENCE tags_id_seq OWNED BY tags.id;

-- animama-statement --

CREATE TABLE user_file (
    id character varying NOT NULL,
    user_id character varying NOT NULL,
    storage_locator character varying NOT NULL,
    original_filename character varying NOT NULL,
    normalized_extension character varying NOT NULL,
    declared_content_type character varying,
    detected_content_type character varying,
    declared_size_bytes bigint NOT NULL,
    stored_size_bytes bigint,
    sha256 character varying,
    status character varying DEFAULT 'pending_upload'::character varying NOT NULL,
    upload_expires_at timestamp with time zone NOT NULL,
    processed_at timestamp with time zone,
    last_error text,
    metadata json NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT ck_user_file_declared_size_bytes_positive CHECK ((declared_size_bytes > 0)),
    CONSTRAINT ck_user_file_stored_size_bytes_positive CHECK (((stored_size_bytes IS NULL) OR (stored_size_bytes > 0)))
);

-- animama-statement --

CREATE TABLE user_file_chunk (
    id character varying NOT NULL,
    file_id character varying NOT NULL,
    user_id character varying NOT NULL,
    chunk_index integer NOT NULL,
    text text NOT NULL,
    embedding_text text,
    embedding vector,
    embedding_model_id character varying,
    embedding_rejections integer DEFAULT 0 NOT NULL,
    embedding_rejected_model_id character varying,
    char_count bigint NOT NULL,
    token_estimate integer NOT NULL,
    metadata json NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- animama-statement --

CREATE TABLE user_file_processing_job (
    id character varying NOT NULL,
    file_id character varying NOT NULL,
    user_id character varying NOT NULL,
    job_type character varying DEFAULT 'process_file'::character varying NOT NULL,
    status character varying DEFAULT 'queued'::character varying NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 3 NOT NULL,
    run_after timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    locked_by character varying,
    locked_at timestamp with time zone,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    last_error text,
    metadata json NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- animama-statement --

CREATE TABLE user_profiles (
    user_id character varying NOT NULL,
    display_name character varying(80),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT ck_user_profiles_display_name_length CHECK (((display_name IS NULL) OR ((char_length((display_name)::text) >= 1) AND (char_length((display_name)::text) <= 80))))
);

-- animama-statement --

CREATE TABLE user_settings (
    user_id character varying NOT NULL,
    theme character varying DEFAULT 'anima'::character varying NOT NULL,
    locale character varying,
    last_active_anima_id character varying,
    preferences jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- animama-statement --

CREATE TABLE web_search_settings (
    id character varying NOT NULL,
    backend character varying NOT NULL,
    base_url character varying,
    credential_env character varying,
    timeout_seconds double precision,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT ck_web_search_settings_single_row CHECK (((id)::text = 'installation'::text)),
    CONSTRAINT ck_web_search_settings_backend_valid CHECK (((backend)::text = ANY ((ARRAY['searxng'::character varying, 'brave'::character varying])::text[])))
);

-- animama-statement --

ALTER TABLE ONLY archive_passages ALTER COLUMN id SET DEFAULT nextval('archive_passages_id_seq'::regclass);

-- animama-statement --

ALTER TABLE ONLY chat_messages ALTER COLUMN id SET DEFAULT nextval('chat_messages_id_seq'::regclass);

-- animama-statement --

ALTER TABLE ONLY memory_entry_versions ALTER COLUMN id SET DEFAULT nextval('memory_entry_versions_id_seq'::regclass);

-- animama-statement --

ALTER TABLE ONLY tags ALTER COLUMN id SET DEFAULT nextval('tags_id_seq'::regclass);

-- animama-statement --

ALTER TABLE ONLY anima
    ADD CONSTRAINT pk_anima PRIMARY KEY (id);

-- animama-statement --

ALTER TABLE ONLY anima_chat_profiles
    ADD CONSTRAINT pk_anima_chat_profiles PRIMARY KEY (anima_id);

-- animama-statement --

ALTER TABLE ONLY anima_content_bindings
    ADD CONSTRAINT pk_anima_content_bindings PRIMARY KEY (id);

-- animama-statement --

ALTER TABLE ONLY anima_creation_receipts
    ADD CONSTRAINT pk_anima_creation_receipts PRIMARY KEY (owner_user_id, operation, idempotency_key);

-- animama-statement --

ALTER TABLE ONLY anima_definition_revisions
    ADD CONSTRAINT pk_anima_definition_revisions PRIMARY KEY (anima_id, aggregate_revision);

-- animama-statement --

ALTER TABLE ONLY anima_loadout_diagnostics
    ADD CONSTRAINT pk_anima_loadout_diagnostics PRIMARY KEY (id);

-- animama-statement --

ALTER TABLE ONLY anima_loadout_mutation_receipts
    ADD CONSTRAINT pk_anima_loadout_mutation_receipts PRIMARY KEY (id);

-- animama-statement --

ALTER TABLE ONLY anima_loadouts
    ADD CONSTRAINT pk_anima_loadouts PRIMARY KEY (anima_id);

-- animama-statement --

ALTER TABLE ONLY anima_memory_reflections
    ADD CONSTRAINT pk_anima_memory_reflections PRIMARY KEY (anima_id);

-- animama-statement --

ALTER TABLE ONLY anima_runtime_snapshots
    ADD CONSTRAINT pk_anima_runtime_snapshots PRIMARY KEY (id);

-- animama-statement --

ALTER TABLE ONLY anima_settings
    ADD CONSTRAINT pk_anima_settings PRIMARY KEY (user_id, anima_id);

-- animama-statement --

ALTER TABLE ONLY anima_starter_receipts
    ADD CONSTRAINT pk_anima_starter_receipts PRIMARY KEY (owner_user_id, starter_id);

-- animama-statement --

ALTER TABLE ONLY archive_passages
    ADD CONSTRAINT pk_archive_passages PRIMARY KEY (id);

-- animama-statement --

ALTER TABLE ONLY archives
    ADD CONSTRAINT pk_archives PRIMARY KEY (id);

-- animama-statement --

ALTER TABLE ONLY avatar
    ADD CONSTRAINT pk_avatar PRIMARY KEY (id);

-- animama-statement --

ALTER TABLE ONLY avatar_face_part_overrides
    ADD CONSTRAINT pk_avatar_face_part_overrides PRIMARY KEY (owner_user_id, avatar_item_id);

-- animama-statement --

ALTER TABLE ONLY avatar_upload
    ADD CONSTRAINT pk_avatar_upload PRIMARY KEY (id);

-- animama-statement --

ALTER TABLE ONLY chat_compactions
    ADD CONSTRAINT pk_chat_compactions PRIMARY KEY (id);

-- animama-statement --

ALTER TABLE ONLY chat_messages
    ADD CONSTRAINT pk_chat_messages PRIMARY KEY (id);

-- animama-statement --

ALTER TABLE ONLY chats
    ADD CONSTRAINT pk_chats PRIMARY KEY (id);

-- animama-statement --

ALTER TABLE ONLY companion_safety_state
    ADD CONSTRAINT pk_companion_safety_state PRIMARY KEY (user_id);

-- animama-statement --

ALTER TABLE ONLY content_catalog_dependencies
    ADD CONSTRAINT pk_content_catalog_dependencies PRIMARY KEY (item_id, ordinal);

-- animama-statement --

ALTER TABLE ONLY content_catalog_files
    ADD CONSTRAINT pk_content_catalog_files PRIMARY KEY (file_ref);

-- animama-statement --

ALTER TABLE ONLY content_catalog_items
    ADD CONSTRAINT pk_content_catalog_items PRIMARY KEY (id);

-- animama-statement --

ALTER TABLE ONLY content_mutation_receipts
    ADD CONSTRAINT pk_content_mutation_receipts PRIMARY KEY (owner_user_id, operation_id);

-- animama-statement --

ALTER TABLE ONLY content_preview_files
    ADD CONSTRAINT pk_content_preview_files PRIMARY KEY (preview_id, file_ref);

-- animama-statement --

ALTER TABLE ONLY content_previews
    ADD CONSTRAINT pk_content_previews PRIMARY KEY (id);

-- animama-statement --

ALTER TABLE ONLY installation_settings
    ADD CONSTRAINT pk_installation_settings PRIMARY KEY (id);

-- animama-statement --

ALTER TABLE ONLY memory_entries
    ADD CONSTRAINT pk_memory_entries PRIMARY KEY (id);

-- animama-statement --

ALTER TABLE ONLY memory_entry_versions
    ADD CONSTRAINT pk_memory_entry_versions PRIMARY KEY (id);

-- animama-statement --

ALTER TABLE ONLY memory_episode_items
    ADD CONSTRAINT pk_memory_episode_items PRIMARY KEY (id);

-- animama-statement --

ALTER TABLE ONLY memory_manager_approvals
    ADD CONSTRAINT pk_memory_manager_approvals PRIMARY KEY (id);

-- animama-statement --

ALTER TABLE ONLY memory_manager_messages
    ADD CONSTRAINT pk_memory_manager_messages PRIMARY KEY (id);

-- animama-statement --

ALTER TABLE ONLY memory_manager_runs
    ADD CONSTRAINT pk_memory_manager_runs PRIMARY KEY (id);

-- animama-statement --

ALTER TABLE ONLY model_connections
    ADD CONSTRAINT pk_model_connections PRIMARY KEY (id);

-- animama-statement --

ALTER TABLE ONLY model_providers
    ADD CONSTRAINT pk_model_providers PRIMARY KEY (id);

-- animama-statement --

ALTER TABLE ONLY passage_tags
    ADD CONSTRAINT pk_passage_tags PRIMARY KEY (passage_id, tag_id);

-- animama-statement --

ALTER TABLE ONLY runtime_worker_heartbeats
    ADD CONSTRAINT pk_runtime_worker_heartbeats PRIMARY KEY (kind);

-- animama-statement --

ALTER TABLE ONLY tags
    ADD CONSTRAINT pk_tags PRIMARY KEY (id);

-- animama-statement --

ALTER TABLE ONLY user_file
    ADD CONSTRAINT pk_user_file PRIMARY KEY (id);

-- animama-statement --

ALTER TABLE ONLY user_file_chunk
    ADD CONSTRAINT pk_user_file_chunk PRIMARY KEY (id);

-- animama-statement --

ALTER TABLE ONLY user_file_processing_job
    ADD CONSTRAINT pk_user_file_processing_job PRIMARY KEY (id);

-- animama-statement --

ALTER TABLE ONLY user_profiles
    ADD CONSTRAINT pk_user_profiles PRIMARY KEY (user_id);

-- animama-statement --

ALTER TABLE ONLY user_settings
    ADD CONSTRAINT pk_user_settings PRIMARY KEY (user_id);

-- animama-statement --

ALTER TABLE ONLY web_search_settings
    ADD CONSTRAINT pk_web_search_settings PRIMARY KEY (id);

-- animama-statement --

ALTER TABLE ONLY anima_content_bindings
    ADD CONSTRAINT uq_anima_content_bindings_uq_anima_content_slot UNIQUE (anima_id, slot_key);

-- animama-statement --

ALTER TABLE ONLY anima_loadout_mutation_receipts
    ADD CONSTRAINT uq_anima_loadout_receipt_key UNIQUE (owner_user_id, anima_id, idempotency_key);

-- animama-statement --

ALTER TABLE ONLY anima_runtime_snapshots
    ADD CONSTRAINT uq_anima_runtime_snapshot_revision UNIQUE (owner_user_id, anima_id, effective_revision);

-- animama-statement --

ALTER TABLE ONLY avatar
    ADD CONSTRAINT uq_avatar_catalog_item_id UNIQUE (catalog_item_id);

-- animama-statement --

ALTER TABLE ONLY avatar
    ADD CONSTRAINT uq_avatar_owner_name UNIQUE NULLS NOT DISTINCT (user_id, name);

-- animama-statement --

ALTER TABLE ONLY avatar_upload
    ADD CONSTRAINT uq_avatar_upload_storage_locator UNIQUE (storage_locator);

-- animama-statement --

ALTER TABLE ONLY content_catalog_dependencies
    ADD CONSTRAINT uq_content_catalog_dependencies_uq_content__d318 UNIQUE (item_id, declared_ref);

-- animama-statement --

ALTER TABLE ONLY content_catalog_files
    ADD CONSTRAINT uq_content_catalog_files_uq_content_file_path UNIQUE (item_id, relative_path);

-- animama-statement --

ALTER TABLE ONLY content_catalog_items
    ADD CONSTRAINT uq_content_catalog_items_uq_content_source_locator UNIQUE (source, relative_locator);

-- animama-statement --

ALTER TABLE ONLY installation_settings
    ADD CONSTRAINT uq_installation_settings_installation_principal_id UNIQUE (installation_principal_id);

-- animama-statement --

ALTER TABLE ONLY model_providers
    ADD CONSTRAINT uq_model_providers_connection_model UNIQUE (connection_id, provider_type, model, source);

-- animama-statement --

ALTER TABLE ONLY tags
    ADD CONSTRAINT uq_tags_name UNIQUE (name);

-- animama-statement --

ALTER TABLE ONLY user_file_chunk
    ADD CONSTRAINT uq_user_file_chunk_file_id_chunk_index UNIQUE (file_id, chunk_index);

-- animama-statement --

CREATE INDEX idx_chat_compactions_anima_created ON chat_compactions USING btree (anima_id, created_at);

-- animama-statement --

CREATE INDEX idx_chat_compactions_chat_end_turn ON chat_compactions USING btree (chat_id, end_turn);

-- animama-statement --

CREATE INDEX idx_chat_compactions_chat_status_created ON chat_compactions USING btree (chat_id, status, created_at);

-- animama-statement --

CREATE INDEX idx_chat_compactions_user_created ON chat_compactions USING btree (user_id, created_at);

-- animama-statement --

CREATE INDEX idx_chat_messages_chat_model_provider ON chat_messages USING btree (chat_id, model_provider, model);

-- animama-statement --

CREATE INDEX idx_chat_messages_chat_time ON chat_messages USING btree (chat_id, created_at);

-- animama-statement --

CREATE INDEX idx_chat_messages_chat_turn ON chat_messages USING btree (chat_id, turn);

-- animama-statement --

CREATE INDEX idx_chat_messages_model_provider ON chat_messages USING btree (model_provider, model);

-- animama-statement --

CREATE INDEX idx_chat_messages_run_id ON chat_messages USING btree (run_id);

-- animama-statement --

CREATE INDEX ix_anima_content_bindings_item ON anima_content_bindings USING btree (catalog_item_id);

-- animama-statement --

CREATE INDEX ix_anima_creation_receipts_anima ON anima_creation_receipts USING btree (anima_id);

-- animama-statement --

CREATE INDEX ix_anima_loadout_diagnostics_anima ON anima_loadout_diagnostics USING btree (anima_id, created_at);

-- animama-statement --

CREATE INDEX ix_anima_loadout_receipts_expiry ON anima_loadout_mutation_receipts USING btree (expires_at);

-- animama-statement --

CREATE INDEX ix_anima_loadouts_owner_anima ON anima_loadouts USING btree (owner_user_id, anima_id);

-- animama-statement --

CREATE INDEX ix_anima_runtime_snapshots_expiry ON anima_runtime_snapshots USING btree (expires_at);

-- animama-statement --

CREATE INDEX ix_anima_starter_receipts_anima ON anima_starter_receipts USING btree (anima_id);

-- animama-statement --

CREATE INDEX ix_avatar_upload_user_id ON avatar_upload USING btree (user_id);

-- animama-statement --

CREATE INDEX ix_chat_messages_content_fts ON chat_messages USING gin (search_vector) WHERE ((internal IS FALSE) AND ((role)::text = ANY ((ARRAY['user'::character varying, 'assistant'::character varying])::text[])) AND (content IS NOT NULL));

-- animama-statement --

CREATE INDEX ix_chats_anima_id ON chats USING btree (anima_id);

-- animama-statement --

CREATE INDEX ix_chats_user_id ON chats USING btree (user_id);

-- animama-statement --

CREATE INDEX ix_content_catalog_files_item_id ON content_catalog_files USING btree (item_id);

-- animama-statement --

CREATE INDEX ix_content_catalog_kind_status ON content_catalog_items USING btree (kind, status);

-- animama-statement --

CREATE INDEX ix_content_catalog_owner ON content_catalog_items USING btree (owner_user_id, status);

-- animama-statement --

CREATE INDEX ix_content_dependencies_target ON content_catalog_dependencies USING btree (target_item_id);

-- animama-statement --

CREATE INDEX ix_content_files_item_ordinal ON content_catalog_files USING btree (item_id, ordinal);

-- animama-statement --

CREATE INDEX ix_content_previews_expiry ON content_previews USING btree (expires_at);

-- animama-statement --

CREATE INDEX ix_memory_entries_anima_id ON memory_entries USING btree (anima_id);

-- animama-statement --

CREATE INDEX ix_memory_entries_fts ON memory_entries USING gin (search_vector);

-- animama-statement --

CREATE INDEX ix_memory_entries_parent_id ON memory_entries USING btree (parent_id);

-- animama-statement --

CREATE INDEX ix_memory_entries_user_id ON memory_entries USING btree (user_id);

-- animama-statement --

CREATE INDEX ix_memory_entries_user_parent ON memory_entries USING btree (user_id, parent_id);

-- animama-statement --

CREATE INDEX ix_memory_entries_user_scope_path ON memory_entries USING btree (user_id, anima_id, normalized_path);

-- animama-statement --

CREATE INDEX ix_memory_entry_versions_anima_id ON memory_entry_versions USING btree (anima_id);

-- animama-statement --

CREATE INDEX ix_memory_entry_versions_entry_version ON memory_entry_versions USING btree (entry_id, version);

-- animama-statement --

CREATE INDEX ix_memory_entry_versions_user_id ON memory_entry_versions USING btree (user_id);

-- animama-statement --

CREATE INDEX ix_memory_entry_versions_user_path ON memory_entry_versions USING btree (user_id, anima_id, normalized_path);

-- animama-statement --

CREATE INDEX ix_memory_episode_items_source_anima_id ON memory_episode_items USING btree (source_anima_id);

-- animama-statement --

CREATE INDEX ix_memory_episode_items_source_chat_id ON memory_episode_items USING btree (source_chat_id);

-- animama-statement --

CREATE INDEX ix_memory_episode_items_source_chat_run ON memory_episode_items USING btree (source_chat_id, source_run_id);

-- animama-statement --

CREATE INDEX ix_memory_episode_items_source_message_id ON memory_episode_items USING btree (source_message_id);

-- animama-statement --

CREATE INDEX ix_memory_episode_items_source_run_id ON memory_episode_items USING btree (source_run_id);

-- animama-statement --

CREATE INDEX ix_memory_episode_items_user_episode_path ON memory_episode_items USING btree (user_id, episode_path);

-- animama-statement --

CREATE INDEX ix_memory_episode_items_user_id ON memory_episode_items USING btree (user_id);

-- animama-statement --

CREATE INDEX ix_memory_episode_items_user_local_date_occurred ON memory_episode_items USING btree (user_id, local_date, occurred_at);

-- animama-statement --

CREATE INDEX ix_memory_episode_items_user_status_occurred ON memory_episode_items USING btree (user_id, status, occurred_at);

-- animama-statement --

CREATE INDEX ix_memory_manager_approvals_run_id ON memory_manager_approvals USING btree (run_id);

-- animama-statement --

CREATE INDEX ix_memory_manager_approvals_run_status_created ON memory_manager_approvals USING btree (run_id, status, created_at);

-- animama-statement --

CREATE INDEX ix_memory_manager_approvals_target_entry_id ON memory_manager_approvals USING btree (target_entry_id);

-- animama-statement --

CREATE INDEX ix_memory_manager_approvals_user_id ON memory_manager_approvals USING btree (user_id);

-- animama-statement --

CREATE INDEX ix_memory_manager_approvals_user_status_created ON memory_manager_approvals USING btree (user_id, status, created_at);

-- animama-statement --

CREATE INDEX ix_memory_manager_approvals_user_target_applied ON memory_manager_approvals USING btree (user_id, target_entry_id, applied_version);

-- animama-statement --

CREATE INDEX ix_memory_manager_messages_run_created ON memory_manager_messages USING btree (run_id, created_at);

-- animama-statement --

CREATE INDEX ix_memory_manager_messages_run_id ON memory_manager_messages USING btree (run_id);

-- animama-statement --

CREATE INDEX ix_memory_manager_messages_user_id ON memory_manager_messages USING btree (user_id);

-- animama-statement --

CREATE INDEX ix_memory_manager_messages_user_run_created ON memory_manager_messages USING btree (user_id, run_id, created_at);

-- animama-statement --

CREATE INDEX ix_memory_manager_runs_user_id ON memory_manager_runs USING btree (user_id);

-- animama-statement --

CREATE INDEX ix_memory_manager_runs_user_status_created ON memory_manager_runs USING btree (user_id, status, created_at);

-- animama-statement --

CREATE INDEX ix_user_file_chunk_file_id ON user_file_chunk USING btree (file_id);

-- animama-statement --

CREATE INDEX ix_user_file_chunk_user_embedding_model ON user_file_chunk USING btree (user_id, embedding_model_id);

-- animama-statement --

CREATE INDEX ix_user_file_chunk_text_fts ON user_file_chunk USING gin (to_tsvector('english'::regconfig, text));

-- animama-statement --

CREATE INDEX ix_user_file_chunk_user_created_at ON user_file_chunk USING btree (user_id, created_at);

-- animama-statement --

CREATE INDEX ix_user_file_chunk_user_file ON user_file_chunk USING btree (user_id, file_id);

-- animama-statement --

CREATE INDEX ix_user_file_chunk_user_id ON user_file_chunk USING btree (user_id);

-- animama-statement --

CREATE INDEX ix_user_file_processing_job_file_id ON user_file_processing_job USING btree (file_id);

-- animama-statement --

CREATE INDEX ix_user_file_processing_job_file_status ON user_file_processing_job USING btree (file_id, status);

-- animama-statement --

CREATE INDEX ix_user_file_processing_job_status ON user_file_processing_job USING btree (status);

-- animama-statement --

CREATE INDEX ix_user_file_processing_job_status_run_after_created_at ON user_file_processing_job USING btree (status, run_after, created_at);

-- animama-statement --

CREATE INDEX ix_user_file_processing_job_user_created_at ON user_file_processing_job USING btree (user_id, created_at);

-- animama-statement --

CREATE INDEX ix_user_file_processing_job_user_id ON user_file_processing_job USING btree (user_id);

-- animama-statement --

CREATE INDEX ix_user_file_status ON user_file USING btree (status);

-- animama-statement --

CREATE UNIQUE INDEX ix_user_file_storage_locator ON user_file USING btree (storage_locator);

-- animama-statement --

CREATE INDEX ix_user_file_user_id ON user_file USING btree (user_id);

-- animama-statement --

CREATE INDEX ix_user_file_user_id_created_at ON user_file USING btree (user_id, created_at);

-- animama-statement --

CREATE UNIQUE INDEX uq_anima_music_autoplay ON anima_content_bindings USING btree (anima_id) WHERE (((kind)::text = 'music_track'::text) AND (config @> '{"autoplay": true}'::jsonb));

-- animama-statement --

CREATE UNIQUE INDEX uq_anima_music_catalog_item ON anima_content_bindings USING btree (anima_id, catalog_item_id) WHERE ((kind)::text = 'music_track'::text);

-- animama-statement --

CREATE UNIQUE INDEX uq_chat_compactions_active_chat ON chat_compactions USING btree (chat_id) WHERE ((status)::text = 'active'::text);

-- animama-statement --

CREATE UNIQUE INDEX uq_chat_messages_chat_turn ON chat_messages USING btree (chat_id, turn);

-- animama-statement --

CREATE UNIQUE INDEX uq_memory_entries_anima_path ON memory_entries USING btree (user_id, anima_id, normalized_path) WHERE ((anima_id IS NOT NULL) AND (deleted_at IS NULL));

-- animama-statement --

CREATE UNIQUE INDEX uq_memory_entries_anima_root_name ON memory_entries USING btree (user_id, anima_id, normalized_name) WHERE ((parent_id IS NULL) AND (anima_id IS NOT NULL) AND (deleted_at IS NULL));

-- animama-statement --

CREATE UNIQUE INDEX uq_memory_entries_non_root_sibling_name ON memory_entries USING btree (parent_id, normalized_name) WHERE ((parent_id IS NOT NULL) AND (deleted_at IS NULL));

-- animama-statement --

CREATE UNIQUE INDEX uq_memory_entries_user_path ON memory_entries USING btree (user_id, normalized_path) WHERE ((anima_id IS NULL) AND (deleted_at IS NULL));

-- animama-statement --

CREATE UNIQUE INDEX uq_memory_entries_user_root_name ON memory_entries USING btree (user_id, normalized_name) WHERE ((parent_id IS NULL) AND (anima_id IS NULL) AND (deleted_at IS NULL));

-- animama-statement --

CREATE UNIQUE INDEX uq_memory_entry_versions_entry_version ON memory_entry_versions USING btree (entry_id, version);

-- animama-statement --

CREATE UNIQUE INDEX uq_memory_episode_items_chat_turn_run ON memory_episode_items USING btree (user_id, source_chat_id, source_run_id, kind) WHERE ((source_chat_id IS NOT NULL) AND (source_run_id IS NOT NULL) AND ((kind)::text = 'chat_turn'::text));

-- animama-statement --

CREATE UNIQUE INDEX uq_memory_manager_runs_user_open ON memory_manager_runs USING btree (user_id) WHERE ((status)::text = ANY ((ARRAY['active'::character varying, 'waiting_approval'::character varying])::text[]));

-- animama-statement --

ALTER TABLE ONLY anima
    ADD CONSTRAINT fk_anima_archive_id_archives FOREIGN KEY (archive_id) REFERENCES archives(id) ON DELETE CASCADE;

-- animama-statement --

ALTER TABLE ONLY anima
    ADD CONSTRAINT fk_anima_avatar_id_avatar FOREIGN KEY (avatar_id) REFERENCES avatar(id) ON DELETE RESTRICT;

-- animama-statement --

ALTER TABLE ONLY anima_chat_profiles
    ADD CONSTRAINT fk_anima_chat_profiles_anima_id_anima FOREIGN KEY (anima_id) REFERENCES anima(id) ON DELETE CASCADE;

-- animama-statement --

ALTER TABLE ONLY anima_chat_profiles
    ADD CONSTRAINT fk_anima_chat_profiles_default_model_provider_id_model__01a0 FOREIGN KEY (default_model_provider_id) REFERENCES model_providers(id);

-- animama-statement --

ALTER TABLE ONLY anima_content_bindings
    ADD CONSTRAINT fk_anima_content_bindings_anima_id_anima_loadouts FOREIGN KEY (anima_id) REFERENCES anima_loadouts(anima_id) ON DELETE CASCADE;

-- animama-statement --

ALTER TABLE ONLY anima_content_bindings
    ADD CONSTRAINT fk_anima_content_bindings_catalog_item_id_local_c_984b FOREIGN KEY (catalog_item_id) REFERENCES content_catalog_items(id) ON DELETE RESTRICT;

-- animama-statement --

ALTER TABLE ONLY anima_definition_revisions
    ADD CONSTRAINT fk_anima_definition_revisions_anima_id_anima FOREIGN KEY (anima_id) REFERENCES anima(id) ON DELETE CASCADE;

-- animama-statement --

ALTER TABLE ONLY anima_loadout_diagnostics
    ADD CONSTRAINT fk_anima_loadout_diagnostics_anima_id_anima_loadouts FOREIGN KEY (anima_id) REFERENCES anima_loadouts(anima_id) ON DELETE CASCADE;

-- animama-statement --

ALTER TABLE ONLY anima_loadout_mutation_receipts
    ADD CONSTRAINT fk_anima_loadout_mutation_receipts_anima_id_anima_loadouts FOREIGN KEY (anima_id) REFERENCES anima_loadouts(anima_id) ON DELETE CASCADE;

-- animama-statement --

ALTER TABLE ONLY anima_loadouts
    ADD CONSTRAINT fk_anima_loadouts_anima_id_anima FOREIGN KEY (anima_id) REFERENCES anima(id) ON DELETE CASCADE;

-- animama-statement --

ALTER TABLE ONLY anima_memory_reflections
    ADD CONSTRAINT fk_anima_memory_reflections_anima_id_anima FOREIGN KEY (anima_id) REFERENCES anima(id) ON DELETE CASCADE;

-- animama-statement --

ALTER TABLE ONLY anima_runtime_snapshots
    ADD CONSTRAINT fk_anima_runtime_snapshots_anima_id_anima FOREIGN KEY (anima_id) REFERENCES anima(id) ON DELETE CASCADE;

-- animama-statement --

ALTER TABLE ONLY anima_settings
    ADD CONSTRAINT fk_anima_settings_anima_id_anima FOREIGN KEY (anima_id) REFERENCES anima(id) ON DELETE CASCADE;

-- animama-statement --

ALTER TABLE ONLY archive_passages
    ADD CONSTRAINT fk_archive_passages_archive_id_archives FOREIGN KEY (archive_id) REFERENCES archives(id) ON DELETE CASCADE;

-- animama-statement --

ALTER TABLE ONLY avatar
    ADD CONSTRAINT fk_avatar_catalog_item_id_content_catalog_items FOREIGN KEY (catalog_item_id) REFERENCES content_catalog_items(id) ON DELETE RESTRICT;

-- animama-statement --

ALTER TABLE ONLY avatar_face_part_overrides
    ADD CONSTRAINT fk_avatar_face_part_overrides_avatar_item_id FOREIGN KEY (avatar_item_id) REFERENCES content_catalog_items(id) ON DELETE CASCADE;

-- animama-statement --

ALTER TABLE ONLY avatar_upload
    ADD CONSTRAINT fk_avatar_upload_anima_id_anima FOREIGN KEY (anima_id) REFERENCES anima(id) ON DELETE SET NULL;

-- animama-statement --

ALTER TABLE ONLY avatar_upload
    ADD CONSTRAINT fk_avatar_upload_avatar_id_avatar FOREIGN KEY (avatar_id) REFERENCES avatar(id) ON DELETE SET NULL;

-- animama-statement --

ALTER TABLE ONLY chat_compactions
    ADD CONSTRAINT fk_chat_compactions_chat_id_chats FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE;

-- animama-statement --

ALTER TABLE ONLY chat_messages
    ADD CONSTRAINT fk_chat_messages_chat_id_chats FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE;

-- animama-statement --

ALTER TABLE ONLY model_providers
    ADD CONSTRAINT fk_model_providers_connection_id_model_connections FOREIGN KEY (connection_id) REFERENCES model_connections(id);

-- animama-statement --

ALTER TABLE ONLY chats
    ADD CONSTRAINT fk_chats_anima_id_anima FOREIGN KEY (anima_id) REFERENCES anima(id) ON DELETE CASCADE;

-- animama-statement --

ALTER TABLE ONLY content_catalog_dependencies
    ADD CONSTRAINT fk_content_catalog_dependencies_item_id_local_con_cbbc FOREIGN KEY (item_id) REFERENCES content_catalog_items(id) ON DELETE CASCADE;

-- animama-statement --

ALTER TABLE ONLY content_catalog_dependencies
    ADD CONSTRAINT fk_content_catalog_dependencies_target_item_id_lo_8a5d FOREIGN KEY (target_item_id) REFERENCES content_catalog_items(id) ON DELETE SET NULL;

-- animama-statement --

ALTER TABLE ONLY content_catalog_files
    ADD CONSTRAINT fk_content_catalog_files_item_id_content_ca_979b FOREIGN KEY (item_id) REFERENCES content_catalog_items(id) ON DELETE CASCADE;

-- animama-statement --

ALTER TABLE ONLY content_preview_files
    ADD CONSTRAINT fk_content_preview_files_preview_id_content_6cae FOREIGN KEY (preview_id) REFERENCES content_previews(id) ON DELETE CASCADE;

-- animama-statement --

ALTER TABLE ONLY content_previews
    ADD CONSTRAINT fk_content_previews_item_id_content_catalog_items FOREIGN KEY (item_id) REFERENCES content_catalog_items(id) ON DELETE CASCADE;

-- animama-statement --

ALTER TABLE ONLY memory_entries
    ADD CONSTRAINT fk_memory_entries_parent_id_memory_entries FOREIGN KEY (parent_id) REFERENCES memory_entries(id) ON DELETE RESTRICT;

-- animama-statement --

ALTER TABLE ONLY memory_manager_approvals
    ADD CONSTRAINT fk_memory_manager_approvals_run_id_memory_manager_runs FOREIGN KEY (run_id) REFERENCES memory_manager_runs(id) ON DELETE CASCADE;

-- animama-statement --

ALTER TABLE ONLY memory_manager_messages
    ADD CONSTRAINT fk_memory_manager_messages_run_id_memory_manager_runs FOREIGN KEY (run_id) REFERENCES memory_manager_runs(id) ON DELETE CASCADE;

-- animama-statement --

ALTER TABLE ONLY passage_tags
    ADD CONSTRAINT fk_passage_tags_passage_id_archive_passages FOREIGN KEY (passage_id) REFERENCES archive_passages(id) ON DELETE CASCADE;

-- animama-statement --

ALTER TABLE ONLY passage_tags
    ADD CONSTRAINT fk_passage_tags_tag_id_tags FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE;

-- animama-statement --

ALTER TABLE ONLY user_file_chunk
    ADD CONSTRAINT fk_user_file_chunk_file_id_user_file FOREIGN KEY (file_id) REFERENCES user_file(id) ON DELETE CASCADE;

-- animama-statement --

ALTER TABLE ONLY user_file_processing_job
    ADD CONSTRAINT fk_user_file_processing_job_file_id_user_file FOREIGN KEY (file_id) REFERENCES user_file(id) ON DELETE CASCADE;
