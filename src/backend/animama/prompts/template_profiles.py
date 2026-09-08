from __future__ import annotations

import json
from importlib.resources import files
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, TemplateNotFound

from animama.logging import get_logger

log = get_logger("prompts.template_profiles")

_TEMPLATE_ROOT = Path(str(files("animama.prompts").joinpath("templates")))
_STREAMER_DIR = _TEMPLATE_ROOT / "streamer"
_CHARACTER_DIR = _TEMPLATE_ROOT / "character"

_DEFAULT_TEMPLATES = {
    "streamer": "streamer_system.jinja",
    "character": "character_system.jinja",
}


def render_template_profile(profile: str) -> str | None:
    """Render a custom instruction profile from templates + JSON payloads.

    Profile lookup order:
    - templates/streamer/{profile}.json
    - templates/character/{profile}.json
    """
    token = (profile or "").strip()
    if not token:
        return None

    payload, category = _load_profile_payload(token)
    if payload is None or category is None:
        return None

    template_name = _resolve_template_name(payload, category)
    if not template_name:
        return None

    try:
        env = Environment(
            loader=FileSystemLoader(str(_TEMPLATE_ROOT)),
            trim_blocks=True,
            lstrip_blocks=True,
            autoescape=False,
        )
        template = env.get_template(template_name)
    except TemplateNotFound:
        log.warning("Template not found for profile", profile=token, template=template_name)
        return None

    context = _build_context(payload, category)
    try:
        rendered = template.render(**context)
    except Exception as exc:
        log.warning("Failed to render template profile", profile=token, template=template_name, exc=exc)
        return None

    out = rendered.strip()
    return out if out else None


def _load_profile_payload(profile: str) -> tuple[dict[str, Any] | None, str | None]:
    profile_key = profile
    streamer_path = _STREAMER_DIR / f"{profile_key}.json"
    character_path = _CHARACTER_DIR / f"{profile_key}.json"

    streamer_exists = streamer_path.exists()
    character_exists = character_path.exists()

    # Try lowercase fallback for convenience
    if not streamer_exists and not character_exists and profile_key.lower() != profile_key:
        profile_key = profile_key.lower()
        streamer_path = _STREAMER_DIR / f"{profile_key}.json"
        character_path = _CHARACTER_DIR / f"{profile_key}.json"
        streamer_exists = streamer_path.exists()
        character_exists = character_path.exists()

    if streamer_exists and character_exists:
        log.warning("Profile exists in multiple template categories; preferring streamer", profile=profile)

    if streamer_exists:
        return _read_json(streamer_path), "streamer"
    if character_exists:
        return _read_json(character_path), "character"
    return None, None


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        log.warning("Failed to load template JSON", path=str(path), exc=exc)
        return None
    if not isinstance(data, dict):
        return None
    return data


def _resolve_template_name(payload: dict[str, Any], category: str) -> str | None:
    override = payload.get("template")
    if isinstance(override, str) and override.strip():
        return override.strip()
    return _DEFAULT_TEMPLATES.get(category)


def _build_context(payload: dict[str, Any], category: str) -> dict[str, Any]:
    # Explicit overrides from template_vars take precedence.
    overrides: dict[str, Any] = {}
    raw_overrides = payload.get("template_vars")
    if isinstance(raw_overrides, dict):
        overrides = dict(raw_overrides)

    if category == "streamer":
        base = _build_streamer_context(payload)
        base.update(overrides)
        return base

    if category == "character":
        base = {k: v for k, v in payload.items() if k not in {"template", "template_vars"}}
        if "CHAT_HISTORY" not in base:
            base["CHAT_HISTORY"] = []
        base.update(overrides)
        return base

    return overrides


def _build_streamer_context(payload: dict[str, Any]) -> dict[str, Any]:
    personality = payload.get("personality") if isinstance(payload.get("personality"), dict) else {}
    if not isinstance(personality, dict):
        personality = {}

    lore_val = personality.get("lore")
    if isinstance(lore_val, list):
        lore = "\n".join(str(x) for x in lore_val if str(x))
    elif isinstance(lore_val, str):
        lore = lore_val
    else:
        lore = ""

    agenda_raw = payload.get("stream_agenda") or payload.get("STREAM_AGENDA")
    agenda = _coerce_agenda(agenda_raw)

    return {
        "STREAMER_NAME": payload.get("name") or payload.get("STREAMER_NAME") or "",
        "ARCHETYPE": payload.get("archetype") or payload.get("ARCHETYPE") or "",
        "PERSONALITY_TRAITS": _coerce_list(personality.get("personality_traits") or payload.get("PERSONALITY_TRAITS")),
        "LORE": lore,
        "GOALS": _coerce_list(payload.get("goals") or payload.get("GOALS")),
        "LT_MEMORY": _coerce_list(
            payload.get("long_term_memory") or payload.get("lt_memory") or payload.get("LT_MEMORY")
        ),
        "PAST_WEEK_SUMMARY": payload.get("past_week_summary") or payload.get("PAST_WEEK_SUMMARY") or "",
        "STREAM_AGENDA": agenda,
        "STREAM_GOAL": payload.get("stream_goal") or payload.get("STREAM_GOAL") or "",
        "STREAM_SUMMARY": payload.get("stream_summary") or payload.get("STREAM_SUMMARY") or "",
        "ACTIVITY_NAME": payload.get("activity_name") or payload.get("ACTIVITY_NAME") or "",
        "ACTIVITY_DESCRIPTION": payload.get("activity_description") or payload.get("ACTIVITY_DESCRIPTION") or "",
        "ACTIVITY_GOAL": payload.get("activity_goal") or payload.get("ACTIVITY_GOAL") or "",
        "ACTIVITY_SUMMARY": payload.get("activity_summary") or payload.get("ACTIVITY_SUMMARY") or "",
        # Dynamic fields (optional; skipped unless provided)
        "STREAM_DATE_ISO": payload.get("stream_date_iso") or payload.get("STREAM_DATE_ISO") or "",
        "STREAM_NUMBER": payload.get("stream_number") or payload.get("STREAM_NUMBER") or 0,
        "ACTIVITY_NUMBER": payload.get("activity_number") or payload.get("ACTIVITY_NUMBER") or 0,
        "STREAM_START_ISO": payload.get("stream_start_iso") or payload.get("STREAM_START_ISO") or "",
        "STREAM_ELAPSED_MIN": payload.get("stream_elapsed_min") or payload.get("STREAM_ELAPSED_MIN") or 0,
        "TARGET_STREAM_LEN_MIN": payload.get("target_stream_len_min") or payload.get("TARGET_STREAM_LEN_MIN") or 0,
    }


def _coerce_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v) for v in value if str(v)]
    return [str(value)]


def _coerce_agenda(value: Any) -> list[dict[str, Any]]:
    if value is None:
        return []
    if isinstance(value, list):
        out: list[dict[str, Any]] = []
        for item in value:
            if isinstance(item, dict):
                name = str(item.get("name", "")).strip() or "Agenda"
                duration = item.get("duration_min", "")
                out.append({"name": name, "duration_min": duration})
            else:
                out.append({"name": str(item), "duration_min": ""})
        return out
    return [{"name": str(value), "duration_min": ""}]


__all__ = ["render_template_profile"]
