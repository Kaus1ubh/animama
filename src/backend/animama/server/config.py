from __future__ import annotations

import os
from pathlib import Path

from pydantic import BaseModel, Field, model_validator


def _env_text(name: str) -> str | None:
    value = os.getenv(name)
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed or None


def _env_bool(name: str, default: bool) -> bool:
    value = _env_text(name)
    if value is None:
        return default
    return value.lower() in {"1", "true", "yes", "on"}


def _resolved_path(value: str) -> Path:
    """Resolve a configured root without requiring it to exist yet."""

    return Path(value).expanduser().resolve(strict=False)


def _env_path(name: str) -> Path | None:
    value = _env_text(name)
    return _resolved_path(value) if value else None


def _paths_overlap(first: Path, second: Path) -> bool:
    return first == second or first in second.parents or second in first.parents


class Settings(BaseModel):
    animama_content_root: Path = _resolved_path(os.getenv("ANIMAMA_CONTENT_ROOT", "content"))
    animama_data_root: Path = _resolved_path(os.getenv("ANIMAMA_DATA_ROOT", "data"))
    animama_included_content_sources_json: str | None = _env_text("ANIMAMA_INCLUDED_CONTENT_SOURCES_JSON")
    animama_local_content_root: Path | None = _env_path("ANIMAMA_LOCAL_CONTENT_ROOT")
    # Serving policy belongs to the installation composition. These inputs
    # never come from a browser request or an installation-owner assertion.
    animama_public_origin: str = Field(
        default_factory=lambda: os.getenv("ANIMAMA_PUBLIC_ORIGIN", "http://localhost:8000")
    )
    animama_web_root: Path | None = Field(default_factory=lambda: _env_path("ANIMAMA_WEB_ROOT"))
    animama_desktop_renderer_capability: str | None = Field(
        default_factory=lambda: _env_text("ANIMAMA_DESKTOP_RENDERER_CAPABILITY"), repr=False
    )
    animama_desktop_control_token: str | None = Field(
        default_factory=lambda: _env_text("ANIMAMA_DESKTOP_CONTROL_TOKEN"), repr=False
    )
    animama_parakeet_model_mount_json: str | None = Field(
        default_factory=lambda: _env_text("ANIMAMA_PARAKEET_MODEL_MOUNT_JSON"), repr=False
    )
    # Compose retains its existing processing deployment; desktop explicitly
    # disables it until main verifies the matching executable feature pack.
    animama_user_file_processing_enabled: bool = _env_bool("ANIMAMA_USER_FILE_PROCESSING_ENABLED", True)
    animama_document_worker_instance_id: str | None = _env_text("ANIMAMA_DOCUMENT_WORKER_INSTANCE_ID")
    animama_document_pack_version: str | None = _env_text("ANIMAMA_DOCUMENT_PACK_VERSION")
    animama_docling_artifacts_path: Path | None = _env_path("ANIMAMA_DOCLING_ARTIFACTS_PATH")
    animama_parakeet_stt_enabled: bool = _env_bool("ANIMAMA_PARAKEET_STT_ENABLED", True)
    animama_parakeet_asset_version: str | None = _env_text("ANIMAMA_PARAKEET_ASSET_VERSION")
    # Native/frozen entrypoints validate loopback. The dedicated Compose
    # entrypoint has a fixed container-network bind, published only on loopback.
    animama_local_bind_host: str = os.getenv("ANIMAMA_LOCAL_BIND_HOST", "127.0.0.1")
    animama_database_url: str = os.getenv(
        "ANIMAMA_DATABASE_URL", "postgresql+asyncpg://animama:a@localhost:5432/animama"
    )
    animama_database_pool_size: int = int(os.getenv("ANIMAMA_DATABASE_POOL_SIZE", "10"))
    animama_database_max_overflow: int = int(os.getenv("ANIMAMA_DATABASE_MAX_OVERFLOW", "20"))
    animama_database_pool_timeout_seconds: float = float(os.getenv("ANIMAMA_DATABASE_POOL_TIMEOUT_SECONDS", "30"))
    animama_database_pool_recycle_seconds: int = int(os.getenv("ANIMAMA_DATABASE_POOL_RECYCLE_SECONDS", "-1"))
    animama_database_pool_pre_ping: bool = _env_bool("ANIMAMA_DATABASE_POOL_PRE_PING", True)
    openai_api_key: str | None = _env_text("OPENAI_API_KEY")
    openai_base_url: str | None = _env_text("OPENAI_BASE_URL")
    deepseek_api_key: str | None = _env_text("DEEPSEEK_API_KEY")
    huggingface_api_key: str | None = _env_text("HF_TOKEN") or _env_text("HUGGINGFACE_API_KEY")
    gemini_api_key: str | None = _env_text("GEMINI_API_KEY")
    elevenlabs_api_key: str | None = _env_text("ELEVENLABS_API_KEY")
    default_model: str = os.getenv("OPENAI_DEFAULT_MODEL", "gpt-5-nano")
    slow_model: str = os.getenv("OPENAI_SLOW_MODEL", "gpt-5-mini")
    private_upload_url_ttl_seconds: int = int(os.getenv("ANIMAMA_PRIVATE_UPLOAD_URL_TTL_SECONDS", "900"))
    anima_vrm_max_upload_bytes: int = int(os.getenv("ANIMAMA_VRM_MAX_UPLOAD_BYTES", str(100 * 1024 * 1024)))
    anima_pocket_voice_catalog_max_upload_bytes: int = int(
        os.getenv("ANIMAMA_POCKET_VOICE_CATALOG_MAX_UPLOAD_BYTES", str(25 * 1024 * 1024))
    )
    anima_user_file_max_upload_bytes: int = int(os.getenv("ANIMAMA_USER_FILE_MAX_UPLOAD_BYTES", str(25 * 1024 * 1024)))
    anima_user_file_max_process_bytes: int = int(
        os.getenv("ANIMAMA_USER_FILE_MAX_PROCESS_BYTES", str(10 * 1024 * 1024))
    )
    anima_user_file_processing_poll_seconds: float = float(os.getenv("ANIMAMA_USER_FILE_PROCESSING_POLL_SECONDS", "2"))
    anima_user_file_processing_batch_size: int = int(os.getenv("ANIMAMA_USER_FILE_PROCESSING_BATCH_SIZE", "1"))
    anima_user_file_processing_lease_seconds: int = int(os.getenv("ANIMAMA_USER_FILE_PROCESSING_LEASE_SECONDS", "300"))
    anima_user_file_processing_max_attempts: int = int(os.getenv("ANIMAMA_USER_FILE_PROCESSING_MAX_ATTEMPTS", "3"))
    anima_user_file_docling_timeout_seconds: int = int(os.getenv("ANIMAMA_USER_FILE_DOCLING_TIMEOUT_SECONDS", "120"))
    anima_user_file_docling_enable_ocr: bool = _env_bool("ANIMAMA_USER_FILE_DOCLING_ENABLE_OCR", False)
    anima_user_file_docling_do_table_structure: bool = _env_bool(
        "ANIMAMA_USER_FILE_DOCLING_DO_TABLE_STRUCTURE",
        True,
    )
    anima_user_file_docling_accelerator: str = os.getenv("ANIMAMA_USER_FILE_DOCLING_ACCELERATOR", "cpu")
    anima_user_file_docling_num_threads: int = int(os.getenv("ANIMAMA_USER_FILE_DOCLING_NUM_THREADS", "4"))
    anima_user_file_docling_table_mode: str = os.getenv("ANIMAMA_USER_FILE_DOCLING_TABLE_MODE", "fast")
    anima_user_file_docling_warmup: bool = _env_bool("ANIMAMA_USER_FILE_DOCLING_WARMUP", True)
    anima_user_file_chunk_max_tokens: int = int(os.getenv("ANIMAMA_USER_FILE_CHUNK_MAX_TOKENS", "800"))
    anima_user_file_chunk_tokenizer_model: str = (
        _env_text("ANIMAMA_USER_FILE_CHUNK_TOKENIZER_MODEL")
        or _env_text("ANIMAMA_EMBEDDING_MODEL")
        or "text-embedding-3-small"
    )
    anima_memory_file_max_bytes: int = int(os.getenv("ANIMAMA_MEMORY_FILE_MAX_BYTES", str(32 * 1024)))
    anima_chat_compaction_enabled: bool = _env_bool("ANIMAMA_CHAT_COMPACTION_ENABLED", True)
    anima_chat_compaction_threshold_tokens: int = int(os.getenv("ANIMAMA_CHAT_COMPACTION_THRESHOLD_TOKENS", "6000"))
    anima_chat_compaction_recent_message_min_count: int = int(
        os.getenv("ANIMAMA_CHAT_COMPACTION_RECENT_MESSAGE_MIN_COUNT", "4")
    )
    anima_default_model_provider_id: str = os.getenv(
        "ANIMAMA_DEFAULT_MODEL_PROVIDER_ID",
        "OpenAIResponsesHTTPAgent:gpt-5.6-luna",
    )
    anima_openai_responses_compaction_threshold_tokens: int = int(
        os.getenv("ANIMAMA_OPENAI_RESPONSES_COMPACTION_THRESHOLD_TOKENS", "10000")
    )
    anima_chat_compaction_provider: str = os.getenv(
        "ANIMAMA_CHAT_COMPACTION_PROVIDER",
        "OpenAIHTTPAgent",
    )
    anima_chat_compaction_model: str = os.getenv("ANIMAMA_CHAT_COMPACTION_MODEL", "gpt-5-nano")
    anima_chat_compaction_prompt_version: str = os.getenv(
        "ANIMAMA_CHAT_COMPACTION_PROMPT_VERSION",
        "chat-compaction-v1",
    )
    anima_chat_title_generation_enabled: bool = _env_bool("ANIMAMA_CHAT_TITLE_GENERATION_ENABLED", True)
    anima_chat_title_generation_provider: str = os.getenv(
        "ANIMAMA_CHAT_TITLE_GENERATION_PROVIDER",
        "OpenAIHTTPAgent",
    )
    anima_chat_title_generation_model: str = os.getenv("ANIMAMA_CHAT_TITLE_GENERATION_MODEL", "gpt-5-nano")
    anima_chat_title_generation_prompt_version: str = os.getenv(
        "ANIMAMA_CHAT_TITLE_GENERATION_PROMPT_VERSION",
        "chat-title-v1",
    )
    anima_chat_title_generation_max_chars: int = int(os.getenv("ANIMAMA_CHAT_TITLE_GENERATION_MAX_CHARS", "48"))
    anima_chat_title_generation_timeout_seconds: float = float(
        os.getenv("ANIMAMA_CHAT_TITLE_GENERATION_TIMEOUT_SECONDS", "20.0")
    )
    anima_chat_title_generation_reasoning_effort: str | None = (
        _env_text("ANIMAMA_CHAT_TITLE_GENERATION_REASONING_EFFORT") or "low"
    )
    anima_model_client_timeout_seconds: float = float(os.getenv("ANIMAMA_MODEL_CLIENT_TIMEOUT_SECONDS", "60.0"))
    anima_memory_manager_agent_model: str = os.getenv("ANIMAMA_MEMORY_MANAGER_AGENT_MODEL", "gpt-5.4-mini")
    elevenlabs_audio_max_upload_bytes: int = int(os.getenv("ELEVENLABS_AUDIO_MAX_UPLOAD_BYTES", str(25 * 1024 * 1024)))
    elevenlabs_max_in_flight: int = int(os.getenv("ELEVENLABS_MAX_IN_FLIGHT", "3"))
    elevenlabs_max_retries: int = int(os.getenv("ELEVENLABS_MAX_RETRIES", "2"))
    elevenlabs_retry_base_delay_seconds: float = float(os.getenv("ELEVENLABS_RETRY_BASE_DELAY_SECONDS", "0.75"))
    elevenlabs_retry_max_delay_seconds: float = float(os.getenv("ELEVENLABS_RETRY_MAX_DELAY_SECONDS", "8.0"))
    elevenlabs_concurrency_retry_delay_seconds: float = float(
        os.getenv("ELEVENLABS_CONCURRENCY_RETRY_DELAY_SECONDS", "1.5")
    )
    elevenlabs_realtime_tts_default_model_id: str = (
        _env_text("ANIMAMA_ELEVENLABS_REALTIME_TTS_DEFAULT_MODEL_ID") or "eleven_flash_v2_5"
    )
    avatar_upload_cleanup_interval_seconds: int = int(os.getenv("AVATAR_UPLOAD_CLEANUP_INTERVAL_SECONDS", "300"))
    avatar_upload_cleanup_batch_size: int = int(os.getenv("AVATAR_UPLOAD_CLEANUP_BATCH_SIZE", "50"))

    @model_validator(mode="after")
    def validate_local_roots(self) -> Settings:
        """Keep portable content and private data in disjoint trees."""

        content_root = self.animama_content_root.resolve(strict=False)
        data_root = self.animama_data_root.resolve(strict=False)
        if _paths_overlap(content_root, data_root):
            raise ValueError("ANIMAMA_CONTENT_ROOT and ANIMAMA_DATA_ROOT must be disjoint directories")
        self.animama_content_root = content_root
        self.animama_data_root = data_root
        return self


settings = Settings()
