from __future__ import annotations

import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, cast

from pydantic import BaseModel, ConfigDict, Field, create_model, field_validator

from animama.app.voice_emotional_tone import (
    ELEVENLABS_EMOTIONAL_TONE_VALUES,
    validate_voice_emotional_tone,
)
from animama.domain.emotions import NEUTRAL_EMOTION
from animama.domain.text_segmenter import UserResponseSegmenter
from animama.prompts.avatar_animation_manifest import normalize_gesture_id

MAIN_STRUCTURED_RESPONSE_FORMAT = "main_structured_json"
MAIN_STRUCTURED_RESPONSE_KIND = "main_structured_response"
MAIN_STRUCTURED_RESPONSE_PART_EMOTIONAL_TONE = "emotional_tone"
MAIN_STRUCTURED_RESPONSE_PART_EMOTIONAL_INTENSITY = "emotional_intensity"
MAIN_STRUCTURED_RESPONSE_PART_GESTURE = "gesture"
MAIN_STRUCTURED_RESPONSE_PART_SPEECH = "speech"
MAIN_STRUCTURED_RESPONSE_PART_DISPLAY = "display"
MAIN_STRUCTURED_RESPONSE_PART_REMEMBER = "remember"


@dataclass(frozen=True, slots=True)
class HelperInstructionData:
    id: str
    field: str | None = None
    role: str | None = None


def validate_main_emotional_intensity(value: Any) -> int:
    if isinstance(value, bool):
        return 1
    if isinstance(value, int):
        return min(10, max(1, value))
    if isinstance(value, float) and value.is_integer():
        return min(10, max(1, int(value)))
    if isinstance(value, str):
        token = value.strip()
        if re.fullmatch(r"[+-]?\d+", token):
            return min(10, max(1, int(token)))
    return 1


class PyMainAgentResponseBase(BaseModel):
    """Every field of the structured chat reply except ``remember``.

    Chat replies with ``PyMainAgentResponse``; only the model benchmark's ``MEMORIES.md``-only arm
    (``app/chat/memory_arm.py``) replies with this base, which has no episodic ``remember`` note.
    """

    model_config = ConfigDict(extra="forbid")

    emotional_tone: str = Field(
        ...,
        description=("Emotional delivery of the spoken response. Use neutral or one allowed emotional tone key"),
        json_schema_extra={"enum": list(ELEVENLABS_EMOTIONAL_TONE_VALUES)},
    )
    emotional_intensity: int = Field(
        ...,
        ge=1,
        le=10,
        description=(
            "Required integer from 1 through 10 representing the strength of the selected "
            "emotional_tone for this utterance."
        ),
    )
    gesture: str | None = Field(
        ...,
        description="Optional production gesture id; null or empty string means no gesture.",
    )
    speech: str = Field(..., description="Speakable assistant response for text-to-speech")
    display: str | None = Field(..., description="Optional fuller text to render visually after speech")

    @field_validator("emotional_tone", mode="before")
    @classmethod
    def _validate_emotional_tone(cls, value: Any) -> str:
        return validate_voice_emotional_tone(value, context=cls.__name__)

    @field_validator("emotional_intensity", mode="before")
    @classmethod
    def _validate_emotional_intensity(cls, value: Any) -> int:
        return validate_main_emotional_intensity(value)

    @property
    def request_helpers(self) -> list[str]:
        return []


class PyMainAgentResponse(PyMainAgentResponseBase):
    """Structured assistant response used by normal chat."""

    remember: str | None = Field(
        ...,
        description=(
            "Optional 1-3 sentence durable memory note from this turn; null or empty string means nothing notable."
        ),
    )


@dataclass(frozen=True)
class MainStructuredResponse:
    emotional_tone: str
    emotional_intensity: int
    gesture: str
    speech: str
    display: str | None
    remember: str | None
    structured: dict[str, Any]
    request_helpers: set[str]

    @property
    def visible_text(self) -> str:
        return self.display or self.speech

    @property
    def response(self) -> str:
        return self.visible_text


@dataclass(frozen=True)
class MainStructuredStreamEvent:
    """Semantic event decoded from a partially streamed main structured JSON object.

    The parser never exposes raw JSON text. It emits hidden emotion metadata
    once `emotional_tone` and `emotional_intensity` are both available, then
    visible speech/display chunks after the ordered metadata fields have been
    safely decoded.
    """

    response_part: str
    text: str
    is_delta: bool
    part_index: int | None = None
    part_final: bool | None = None
    emotional_intensity: int | None = None


@dataclass(frozen=True)
class GestureValidationResult:
    raw: str
    normalized: str
    gesture: str
    dropped_reason: str | None = None


@dataclass(frozen=True)
class _JsonStringScan:
    complete: bool
    value: str
    end: int | None = None
    invalid: bool = False


@dataclass(frozen=True)
class _JsonFieldScan:
    key: str
    value: str
    complete: bool
    end: int | None = None
    invalid: bool = False


@dataclass(frozen=True)
class _JsonValueScan:
    key: str
    value: Any
    complete: bool
    end: int | None = None
    invalid: bool = False


def _runtime_gesture_ids(
    gesture_ids: Sequence[str] | None,
) -> tuple[str, ...]:
    """Resolve the exact gesture inventory supplied by the mounted Anima."""

    return tuple(gesture_ids or ())


def _runtime_gesture_ids_for_model(
    output_type: type[BaseModel],
    *,
    gesture_ids: Sequence[str] | None = None,
) -> tuple[str, ...]:
    if gesture_ids is not None:
        return tuple(gesture_ids)
    attached = getattr(output_type, "_anima_runtime_gesture_ids", None)
    if isinstance(attached, tuple) and all(isinstance(value, str) for value in attached):
        return attached
    return ()


def _skip_json_ws(source: str, start: int) -> int:
    index = start
    while index < len(source) and source[index].isspace():
        index += 1
    return index


def _decode_json_string_prefix(source: str, start: int) -> _JsonStringScan:
    if start >= len(source) or source[start] != '"':
        return _JsonStringScan(complete=False, value="", invalid=True)

    out: list[str] = []
    index = start + 1
    while index < len(source):
        char = source[index]
        if char == '"':
            return _JsonStringScan(complete=True, value="".join(out), end=index + 1)
        if char != "\\":
            out.append(char)
            index += 1
            continue

        if index + 1 >= len(source):
            return _JsonStringScan(complete=False, value="".join(out))
        escape = source[index + 1]
        if escape in {'"', "\\", "/"}:
            out.append(escape)
            index += 2
            continue
        if escape == "b":
            out.append("\b")
            index += 2
            continue
        if escape == "f":
            out.append("\f")
            index += 2
            continue
        if escape == "n":
            out.append("\n")
            index += 2
            continue
        if escape == "r":
            out.append("\r")
            index += 2
            continue
        if escape == "t":
            out.append("\t")
            index += 2
            continue
        if escape != "u":
            return _JsonStringScan(complete=False, value="".join(out), invalid=True)

        if index + 6 > len(source):
            return _JsonStringScan(complete=False, value="".join(out))
        hex_value = source[index + 2 : index + 6]
        try:
            codepoint = int(hex_value, 16)
        except ValueError:
            return _JsonStringScan(complete=False, value="".join(out), invalid=True)

        if 0xD800 <= codepoint <= 0xDBFF:
            if index + 12 > len(source):
                return _JsonStringScan(complete=False, value="".join(out))
            if source[index + 6 : index + 8] != "\\u":
                out.append(chr(codepoint))
                index += 6
                continue
            low_hex = source[index + 8 : index + 12]
            try:
                low_codepoint = int(low_hex, 16)
            except ValueError:
                return _JsonStringScan(complete=False, value="".join(out), invalid=True)
            if not 0xDC00 <= low_codepoint <= 0xDFFF:
                out.append(chr(codepoint))
                index += 6
                continue
            combined = 0x10000 + ((codepoint - 0xD800) << 10) + (low_codepoint - 0xDC00)
            out.append(chr(combined))
            index += 12
            continue

        out.append(chr(codepoint))
        index += 6

    return _JsonStringScan(complete=False, value="".join(out))


def _skip_json_value(source: str, start: int) -> int | None:
    index = _skip_json_ws(source, start)
    if index >= len(source):
        return None

    char = source[index]
    if char == '"':
        value = _decode_json_string_prefix(source, index)
        if value.invalid or not value.complete or value.end is None:
            return None
        return value.end

    if char in "{[":
        stack = [char]
        index += 1
        while index < len(source):
            current = source[index]
            if current == '"':
                value = _decode_json_string_prefix(source, index)
                if value.invalid or not value.complete or value.end is None:
                    return None
                index = value.end
                continue
            if current in "{[":
                stack.append(current)
            elif current in "}]":
                if not stack:
                    return None
                open_char = stack.pop()
                if (open_char == "{" and current != "}") or (open_char == "[" and current != "]"):
                    return None
                if not stack:
                    return index + 1
            index += 1
        return None

    while index < len(source):
        current = source[index]
        if current in ",}":
            return index
        index += 1
    return None


def _scan_first_top_level_key(source: str) -> _JsonStringScan | None:
    index = _skip_json_ws(source, 0)
    if index >= len(source):
        return None
    if source[index] != "{":
        return _JsonStringScan(complete=False, value="", invalid=True)
    index = _skip_json_ws(source, index + 1)
    if index >= len(source):
        return None
    if source[index] != '"':
        return _JsonStringScan(complete=False, value="", invalid=True)
    key = _decode_json_string_prefix(source, index)
    if key.invalid:
        return _JsonStringScan(complete=False, value=key.value, invalid=True)
    if not key.complete or key.end is None:
        return None
    index = _skip_json_ws(source, key.end)
    if index >= len(source):
        return None
    if source[index] != ":":
        return _JsonStringScan(complete=False, value=key.value, invalid=True)
    return key


def _scan_top_level_string_field(source: str, target_key: str) -> _JsonFieldScan | None:
    index = _skip_json_ws(source, 0)
    if index >= len(source) or source[index] != "{":
        return None
    index += 1

    while index < len(source):
        index = _skip_json_ws(source, index)
        if index >= len(source):
            return None
        if source[index] == ",":
            index += 1
            continue
        if source[index] == "}":
            return None
        if source[index] != '"':
            return None

        key = _decode_json_string_prefix(source, index)
        if key.invalid:
            return None
        if not key.complete or key.end is None:
            return None

        index = _skip_json_ws(source, key.end)
        if index >= len(source):
            return None
        if source[index] != ":":
            return None
        index = _skip_json_ws(source, index + 1)
        if index >= len(source):
            return None

        if key.value == target_key:
            if source[index] != '"':
                return _JsonFieldScan(
                    key=key.value,
                    value="",
                    complete=False,
                    invalid=True,
                )
            value = _decode_json_string_prefix(source, index)
            return _JsonFieldScan(
                key=key.value,
                value=value.value,
                complete=value.complete,
                end=value.end,
                invalid=value.invalid,
            )

        next_index = _skip_json_value(source, index)
        if next_index is None:
            return None
        index = next_index

    return None


def _scan_top_level_value_field(source: str, target_key: str) -> _JsonValueScan | None:
    index = _skip_json_ws(source, 0)
    if index >= len(source) or source[index] != "{":
        return None
    index += 1

    while index < len(source):
        index = _skip_json_ws(source, index)
        if index >= len(source):
            return None
        if source[index] == ",":
            index += 1
            continue
        if source[index] == "}":
            return None
        if source[index] != '"':
            return None

        key = _decode_json_string_prefix(source, index)
        if key.invalid:
            return None
        if not key.complete or key.end is None:
            return None

        index = _skip_json_ws(source, key.end)
        if index >= len(source):
            return None
        if source[index] != ":":
            return None
        index = _skip_json_ws(source, index + 1)
        if index >= len(source):
            return None

        next_index = _skip_json_value(source, index)
        if key.value == target_key:
            if next_index is None:
                return None
            raw_value = source[index:next_index].strip()
            try:
                value = json.loads(raw_value)
            except ValueError:
                return _JsonValueScan(key=key.value, value=None, complete=False, invalid=True)
            return _JsonValueScan(key=key.value, value=value, complete=True, end=next_index)

        if next_index is None:
            return None
        index = next_index

    return None


class MainStructuredJsonStreamParser:
    """Incrementally turns ordered main structured JSON into semantic events.

    The model is prompted to emit fields in this order:
    `emotional_tone`, `emotional_intensity`, `gesture`, `speech`, `display`,
    `remember`.
    Early streaming follows that order: it waits for tone + intensity together,
    waits until gesture is complete, and only then emits speech sentence chunks.
    The final full JSON parse remains authoritative for validation and
    persistence.
    """

    def __init__(self) -> None:
        self._buffer = ""
        self._streaming_prefix_checked = False
        self._streaming_unavailable = False
        self._emotional_tone_emitted = False
        self._gesture_ready = False
        self._speech_complete = False
        self._speech_decoded = ""
        self._speech_segmenter = UserResponseSegmenter()
        self._speech_part_index = 0
        self._display_emitted = ""
        self._display_complete = False
        self._display_part_index = 0

    def feed(self, chunk: str) -> list[MainStructuredStreamEvent]:
        if not chunk or self._streaming_unavailable:
            return []
        self._buffer += chunk
        events: list[MainStructuredStreamEvent] = []

        if not self._streaming_prefix_checked:
            first_key = _scan_first_top_level_key(self._buffer)
            if first_key is None:
                return []
            if first_key.invalid or first_key.value != MAIN_STRUCTURED_RESPONSE_PART_EMOTIONAL_TONE:
                self._streaming_unavailable = True
                return []
            self._streaming_prefix_checked = True

        if not self._emotional_tone_emitted:
            # Tone and intensity are a single hidden metadata unit for early
            # streaming. Emitting them together avoids starting speech/TTS with
            # only half of the model's requested emotional delivery.
            emotional_tone = _scan_top_level_string_field(
                self._buffer,
                MAIN_STRUCTURED_RESPONSE_PART_EMOTIONAL_TONE,
            )
            emotional_intensity = _scan_top_level_value_field(
                self._buffer,
                MAIN_STRUCTURED_RESPONSE_PART_EMOTIONAL_INTENSITY,
            )
            if emotional_tone is not None and emotional_intensity is not None and emotional_tone.invalid:
                normalized_tone = validate_voice_emotional_tone(None, context="main_structured_stream")
                normalized_intensity = validate_main_emotional_intensity(emotional_intensity.value)
                self._emotional_tone_emitted = True
                events.append(
                    MainStructuredStreamEvent(
                        response_part=MAIN_STRUCTURED_RESPONSE_PART_EMOTIONAL_TONE,
                        text=normalized_tone,
                        is_delta=False,
                        emotional_intensity=normalized_intensity,
                    )
                )
            elif (
                emotional_tone is not None
                and emotional_tone.complete
                and emotional_intensity is not None
                and emotional_intensity.complete
            ):
                normalized_tone = validate_voice_emotional_tone(
                    emotional_tone.value,
                    context="main_structured_stream",
                )
                normalized_intensity = validate_main_emotional_intensity(emotional_intensity.value)
                self._emotional_tone_emitted = True
                events.append(
                    MainStructuredStreamEvent(
                        response_part=MAIN_STRUCTURED_RESPONSE_PART_EMOTIONAL_TONE,
                        text=normalized_tone,
                        is_delta=False,
                        emotional_intensity=normalized_intensity,
                    )
                )

        if self._emotional_tone_emitted and not self._gesture_ready:
            # Gesture is not streamed as text, but it precedes speech in the
            # schema. Wait until the field is complete so early speech does not
            # leap ahead of ordered structured metadata.
            gesture = _scan_top_level_value_field(self._buffer, MAIN_STRUCTURED_RESPONSE_PART_GESTURE)
            if gesture is not None and gesture.invalid:
                self._streaming_unavailable = True
                return events
            if gesture is not None and gesture.complete:
                self._gesture_ready = True

        if self._gesture_ready and not self._speech_complete:
            speech = _scan_top_level_string_field(self._buffer, MAIN_STRUCTURED_RESPONSE_PART_SPEECH)
            if speech is not None and speech.invalid:
                self._streaming_unavailable = True
                return events
            if speech is not None:
                if len(speech.value) > len(self._speech_decoded):
                    delta = speech.value[len(self._speech_decoded) :]
                    self._speech_decoded = speech.value
                    for segment in self._speech_segmenter.add_delta(
                        MAIN_STRUCTURED_RESPONSE_PART_SPEECH,
                        delta,
                    ):
                        if segment.text:
                            events.append(
                                self._speech_event(
                                    segment.text,
                                    part_final=False,
                                )
                            )
                if speech.complete:
                    normalized_speech = speech.value.strip()
                    if not normalized_speech:
                        raise ValueError("main structured response requires a non-empty speech field")
                    self._speech_complete = True
                    final_segments = self._speech_segmenter.finish_run(MAIN_STRUCTURED_RESPONSE_PART_SPEECH)
                    if final_segments:
                        for segment in final_segments:
                            events.append(
                                self._speech_event(
                                    segment.text,
                                    part_final=segment.is_final,
                                )
                            )
                    else:
                        events.append(self._speech_event("", part_final=True))

        if self._speech_complete and not self._display_complete:
            display = _scan_top_level_string_field(self._buffer, MAIN_STRUCTURED_RESPONSE_PART_DISPLAY)
            if display is not None and not display.invalid:
                emitted_delta = False
                if len(display.value) > len(self._display_emitted):
                    delta = display.value[len(self._display_emitted) :]
                    self._display_emitted = display.value
                    if delta:
                        emitted_delta = True
                        events.append(
                            self._display_event(
                                delta,
                                part_final=display.complete,
                            )
                        )
                if display.complete:
                    self._display_complete = True
                    if not emitted_delta and self._display_part_index > 0:
                        events.append(self._display_event("", part_final=True))

        return events

    def _speech_event(self, text: str, *, part_final: bool) -> MainStructuredStreamEvent:
        event = MainStructuredStreamEvent(
            response_part=MAIN_STRUCTURED_RESPONSE_PART_SPEECH,
            text=text,
            is_delta=True,
            part_index=self._speech_part_index,
            part_final=part_final,
        )
        self._speech_part_index += 1
        return event

    def _display_event(self, text: str, *, part_final: bool) -> MainStructuredStreamEvent:
        event = MainStructuredStreamEvent(
            response_part=MAIN_STRUCTURED_RESPONSE_PART_DISPLAY,
            text=text,
            is_delta=True,
            part_index=self._display_part_index,
            part_final=part_final,
        )
        self._display_part_index += 1
        return event

    @property
    def streaming_unavailable(self) -> bool:
        return self._streaming_unavailable

    def salvaged_data(self) -> dict[str, Any] | None:
        """Return reply fields recovered from what this parser streamed, if any speech streamed.

        Used when the final text fails validation after speech was already sent
        to the client: the streamed parts become the reply instead of a repair
        request that would repeat or replace audible speech.
        """

        speech = self._speech_decoded.strip()
        if not speech:
            return None
        tone = _scan_top_level_string_field(self._buffer, MAIN_STRUCTURED_RESPONSE_PART_EMOTIONAL_TONE)
        intensity = _scan_top_level_value_field(self._buffer, MAIN_STRUCTURED_RESPONSE_PART_EMOTIONAL_INTENSITY)
        gesture = _scan_top_level_value_field(self._buffer, MAIN_STRUCTURED_RESPONSE_PART_GESTURE)
        return {
            MAIN_STRUCTURED_RESPONSE_PART_EMOTIONAL_TONE: (
                tone.value if tone is not None and tone.complete and not tone.invalid else None
            ),
            MAIN_STRUCTURED_RESPONSE_PART_EMOTIONAL_INTENSITY: (
                intensity.value if intensity is not None and intensity.complete else None
            ),
            MAIN_STRUCTURED_RESPONSE_PART_GESTURE: (
                gesture.value if gesture is not None and gesture.complete else None
            ),
            MAIN_STRUCTURED_RESPONSE_PART_SPEECH: speech,
            MAIN_STRUCTURED_RESPONSE_PART_DISPLAY: self._display_emitted or None,
            MAIN_STRUCTURED_RESPONSE_PART_REMEMBER: None,
        }


def build_main_response_model(
    *,
    agent_id: str,
    entries: Sequence[HelperInstructionData] | None = None,
    gesture_ids: Sequence[str] | None = None,
    remember: bool = True,
) -> type[PyMainAgentResponseBase]:
    """The reply model for one turn's equipped Gestures; ``remember=False`` drops the episodic note."""

    _ = entries
    runtime_gesture_ids = _runtime_gesture_ids(gesture_ids)
    dynamic_model = cast(
        type[PyMainAgentResponseBase],
        create_model(
            f"PyMainAgentResponse_{agent_id.replace('-', '_')}",
            __base__=PyMainAgentResponse if remember else PyMainAgentResponseBase,
            gesture=(
                str | None,
                Field(
                    ...,
                    description="Optional production gesture id; null means no gesture.",
                    json_schema_extra={"enum": [None, *runtime_gesture_ids]},
                ),
            ),
        ),
    )
    cast("Any", dynamic_model)._anima_runtime_gesture_ids = runtime_gesture_ids
    return dynamic_model


def build_main_structured_response_model(
    *,
    agent_id: str,
    entries: Sequence[HelperInstructionData] | None = None,
    gesture_ids: Sequence[str] | None = None,
    remember: bool = True,
) -> type[PyMainAgentResponseBase]:
    return build_main_response_model(
        agent_id=agent_id,
        entries=entries,
        gesture_ids=gesture_ids,
        remember=remember,
    )


def is_main_structured_output_schema(schema: Any) -> bool:
    if not isinstance(schema, Mapping):
        return False
    kind = schema.get("kind")
    response_format = schema.get("response_format")
    return kind == MAIN_STRUCTURED_RESPONSE_KIND or response_format == MAIN_STRUCTURED_RESPONSE_FORMAT


def build_main_response_model_from_schema(
    *,
    agent_id: str,
    schema: Mapping[str, Any],
    include_helpers: bool = True,
    gesture_ids: Sequence[str] | None = None,
) -> type[PyMainAgentResponse]:
    _ = schema, include_helpers
    # With ``remember`` (the default) the model is chat's own PyMainAgentResponse.
    return cast(type[PyMainAgentResponse], build_main_response_model(agent_id=agent_id, gesture_ids=gesture_ids))


def build_main_structured_response_model_from_schema(
    *,
    agent_id: str,
    schema: Mapping[str, Any],
    include_helpers: bool = True,
    gesture_ids: Sequence[str] | None = None,
) -> type[PyMainAgentResponse]:
    return build_main_response_model_from_schema(
        agent_id=agent_id,
        schema=schema,
        include_helpers=include_helpers,
        gesture_ids=gesture_ids,
    )


def build_main_structured_prompt(
    output_type: type[BaseModel],
    *,
    gesture_ids: Sequence[str] | None = None,
) -> str:
    schema_json = json.dumps(
        build_main_structured_response_json_schema(
            output_type,
            gesture_ids=gesture_ids,
        ),
        ensure_ascii=True,
        indent=2,
    )
    example = {
        "emotional_tone": "neutral",
        "emotional_intensity": 3,
        "gesture": None,
        "speech": "Short spoken reply.",
        "display": None,
        "remember": None,
    }
    # The model benchmark's MEMORIES.md-only arm replies without `remember`.
    fields = [name for name in example if name in output_type.model_fields]
    example_json = json.dumps({name: example[name] for name in fields}, ensure_ascii=True, indent=2)
    return (
        "Return ONLY one valid json object that matches the configured response format.\n"
        "Do not include markdown or prose outside JSON.\n"
        f"Emit object properties in this order: {', '.join(fields)}.\n"
        "Expected json schema:\n"
        f"{schema_json}\n\n"
        "Example valid json object:\n"
        f"{example_json}"
    )


def build_main_structured_response_json_schema(
    output_type: type[BaseModel],
    *,
    gesture_ids: Sequence[str] | None = None,
) -> dict[str, Any]:
    """Return the OpenAI-facing strict JSON schema for the main response."""

    schema = output_type.model_json_schema()
    _collapse_nullable_any_of(schema, "gesture")
    _collapse_nullable_any_of(schema, "display")
    _collapse_nullable_any_of(schema, "remember")
    _set_gesture_enum(
        schema,
        _runtime_gesture_ids_for_model(output_type, gesture_ids=gesture_ids),
    )
    return schema


def _set_gesture_enum(
    schema: dict[str, Any],
    gesture_ids: Sequence[str],
) -> None:
    properties = schema.get("properties")
    if not isinstance(properties, dict):
        return
    field_schema = properties.get("gesture")
    if not isinstance(field_schema, dict):
        return
    field_schema["enum"] = [None, *gesture_ids]


def _collapse_nullable_any_of(schema: dict[str, Any], field_name: str) -> None:
    properties = schema.get("properties")
    if not isinstance(properties, dict):
        return
    field_schema = properties.get(field_name)
    if not isinstance(field_schema, dict):
        return
    variants = field_schema.get("anyOf")
    if not isinstance(variants, list):
        return
    types: list[str] = []
    for variant in variants:
        if not isinstance(variant, Mapping):
            return
        variant_type = variant.get("type")
        if not isinstance(variant_type, str):
            return
        types.append(variant_type)
    if set(types) != {"string", "null"}:
        return
    field_schema.pop("anyOf", None)
    field_schema["type"] = ["string", "null"]


def parse_main_structured_response(
    raw_text: str,
    output_type: type[BaseModel],
) -> MainStructuredResponse:
    """Strictly parse a final reply that must match the schema exactly."""

    parsed = output_type.model_validate_json(raw_text)
    return main_structured_response_from_data(parsed.model_dump())


def recover_main_structured_response(
    raw_text: str,
    output_type: type[BaseModel],
) -> MainStructuredResponse:
    """Validate a final reply locally, accepting unambiguous deviations from the schema.

    Models without schema-constrained output often wrap the object in a
    markdown fence or prose, omit optional fields or add keys. The reply is
    valid when a JSON object with a non-blank ``speech`` string can be found;
    unknown keys are dropped and other fields are coerced as in strict parsing
    (unknown tone becomes neutral, an unknown gesture is dropped later).
    Raises ``ValueError`` when no such object exists.
    """

    try:
        return parse_main_structured_response(raw_text, output_type)
    except ValueError:
        pass
    candidate = _json_object_candidate(raw_text)
    if candidate is None:
        raise ValueError("main structured response contains no JSON object")
    data = {name: candidate.get(name) for name in output_type.model_fields}
    for name in (
        MAIN_STRUCTURED_RESPONSE_PART_GESTURE,
        MAIN_STRUCTURED_RESPONSE_PART_DISPLAY,
        MAIN_STRUCTURED_RESPONSE_PART_REMEMBER,
    ):
        # The model benchmark's MEMORIES.md-only reply model has no `remember` field.
        if name in data and not isinstance(data[name], str):
            data[name] = None
    if not isinstance(data.get(MAIN_STRUCTURED_RESPONSE_PART_SPEECH), str):
        raise ValueError("main structured response requires a non-empty speech field")
    return main_structured_response_from_data(output_type.model_validate(data).model_dump())


def plain_text_main_structured_response(raw_text: str) -> MainStructuredResponse | None:
    """Build the neutral, gesture-free reply used when structured output fails.

    The model's text becomes the speech. A JSON-looking reply contributes only
    its ``speech`` value so raw JSON is never spoken. Returns ``None`` when no
    speakable text remains.
    """

    text = _strip_markdown_fence(raw_text)
    if text.startswith("{"):
        speech = _scan_top_level_string_field(text, MAIN_STRUCTURED_RESPONSE_PART_SPEECH)
        text = speech.value if speech is not None and not speech.invalid else ""
    if not text.strip():
        return None
    return main_structured_response_from_data(
        {
            MAIN_STRUCTURED_RESPONSE_PART_EMOTIONAL_TONE: NEUTRAL_EMOTION,
            MAIN_STRUCTURED_RESPONSE_PART_EMOTIONAL_INTENSITY: 1,
            MAIN_STRUCTURED_RESPONSE_PART_GESTURE: None,
            MAIN_STRUCTURED_RESPONSE_PART_SPEECH: text,
            MAIN_STRUCTURED_RESPONSE_PART_DISPLAY: None,
            MAIN_STRUCTURED_RESPONSE_PART_REMEMBER: None,
        }
    )


def main_structured_response_from_data(data: Mapping[str, Any]) -> MainStructuredResponse:
    """Normalize reply fields into the authoritative structured response."""

    emotional_tone = validate_voice_emotional_tone(
        data.get(MAIN_STRUCTURED_RESPONSE_PART_EMOTIONAL_TONE),
        context="main_structured_parse",
        warn=False,
    )
    emotional_intensity = validate_main_emotional_intensity(data.get(MAIN_STRUCTURED_RESPONSE_PART_EMOTIONAL_INTENSITY))
    speech = data.get(MAIN_STRUCTURED_RESPONSE_PART_SPEECH)
    if not isinstance(speech, str) or not speech.strip():
        raise ValueError("main structured response requires a non-empty speech field")
    display_raw = data.get(MAIN_STRUCTURED_RESPONSE_PART_DISPLAY)
    display = display_raw.strip() if isinstance(display_raw, str) and display_raw.strip() else None
    gesture_raw = data.get(MAIN_STRUCTURED_RESPONSE_PART_GESTURE)
    gesture = gesture_raw.strip() if isinstance(gesture_raw, str) and gesture_raw.strip() else ""
    remember_raw = data.get(MAIN_STRUCTURED_RESPONSE_PART_REMEMBER)
    remember = remember_raw.strip() if isinstance(remember_raw, str) and remember_raw.strip() else None
    speech = speech.strip()
    if display == speech:
        display = None
    structured: dict[str, Any] = {
        "emotional_tone": emotional_tone,
        "emotional_intensity": emotional_intensity,
        "gesture": gesture,
        "speech": speech,
        "display": display,
        "remember": remember,
    }
    return MainStructuredResponse(
        emotional_tone=emotional_tone,
        emotional_intensity=emotional_intensity,
        gesture=gesture,
        speech=speech,
        display=display,
        remember=remember,
        structured=structured,
        request_helpers=set(),
    )


_MARKDOWN_FENCE = re.compile(r"^```[A-Za-z0-9_-]*[ \t]*\n?(?P<body>.*?)\n?[ \t]*```$", re.DOTALL)
# Bounds the search for an embedded object in long prose replies.
_MAX_JSON_OBJECT_CANDIDATES = 32


def _strip_markdown_fence(raw_text: str) -> str:
    text = raw_text.strip()
    match = _MARKDOWN_FENCE.match(text)
    return match.group("body").strip() if match else text


def _json_object_candidate(raw_text: str) -> dict[str, Any] | None:
    """Return the first JSON object found in a fenced or prose-wrapped reply."""

    text = _strip_markdown_fence(raw_text)
    decoder = json.JSONDecoder()
    start = text.find("{")
    for _ in range(_MAX_JSON_OBJECT_CANDIDATES):
        if start == -1:
            return None
        try:
            value, _end = decoder.raw_decode(text, start)
        except ValueError:
            value = None
        if isinstance(value, dict):
            return value
        start = text.find("{", start + 1)
    return None


def render_main_structured_json(parsed: MainStructuredResponse, *, remember: bool = True) -> str:
    """The reply as compact JSON, as chat replays it in history.

    ``remember=False`` leaves the note out: the model benchmark's MEMORIES.md-only reply model has none.
    """

    payload: dict[str, Any] = {
        "emotional_tone": parsed.emotional_tone,
        "emotional_intensity": parsed.emotional_intensity,
        "gesture": parsed.gesture,
        "speech": parsed.speech,
        "display": parsed.display,
    }
    if remember:
        payload["remember"] = parsed.remember
    return json.dumps(payload, ensure_ascii=True, separators=(",", ":"))


def validate_main_structured_gesture(
    value: Any,
    *,
    gesture_ids: Sequence[str] | None = None,
) -> GestureValidationResult:
    raw = value.strip() if isinstance(value, str) else ""
    if not raw:
        return GestureValidationResult(raw="", normalized="", gesture="")
    normalized = normalize_gesture_id(raw)
    if not normalized:
        return GestureValidationResult(raw=raw, normalized="", gesture="", dropped_reason="invalid_gesture_id")
    available_ids = set(_runtime_gesture_ids(gesture_ids))
    if normalized in available_ids:
        return GestureValidationResult(raw=raw, normalized=normalized, gesture=normalized)
    return GestureValidationResult(
        raw=raw,
        normalized=normalized,
        gesture="",
        dropped_reason="unknown_gesture_id",
    )


__all__ = [
    "MAIN_STRUCTURED_RESPONSE_FORMAT",
    "MAIN_STRUCTURED_RESPONSE_KIND",
    "MAIN_STRUCTURED_RESPONSE_PART_DISPLAY",
    "MAIN_STRUCTURED_RESPONSE_PART_EMOTIONAL_INTENSITY",
    "MAIN_STRUCTURED_RESPONSE_PART_EMOTIONAL_TONE",
    "MAIN_STRUCTURED_RESPONSE_PART_GESTURE",
    "MAIN_STRUCTURED_RESPONSE_PART_REMEMBER",
    "MAIN_STRUCTURED_RESPONSE_PART_SPEECH",
    "GestureValidationResult",
    "PyMainAgentResponse",
    "PyMainAgentResponseBase",
    "MainStructuredResponse",
    "MainStructuredJsonStreamParser",
    "MainStructuredStreamEvent",
    "build_main_response_model",
    "build_main_response_model_from_schema",
    "build_main_structured_response_model",
    "build_main_structured_response_model_from_schema",
    "build_main_structured_prompt",
    "build_main_structured_response_json_schema",
    "is_main_structured_output_schema",
    "main_structured_response_from_data",
    "parse_main_structured_response",
    "plain_text_main_structured_response",
    "recover_main_structured_response",
    "render_main_structured_json",
    "validate_main_emotional_intensity",
    "validate_main_structured_gesture",
]
