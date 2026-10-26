"""The benchmark's tracked prompt set: format v1, its loader and its input hashes.

A prompt set is one JSON manifest. Paths inside it are relative to the
manifest's directory, so a set and its files move together:

``version``
    The prompt-set version a report names; any change to items, fixtures,
    checklists, guidance, acceptable lists or rubrics makes a new one.
``loadout``
    ``{"path", "sha256"}``: the equipped Gesture list every turn sees, a JSON
    list of ``{selector, name, description}`` sorted by selector, as chat lists
    equipped Gestures. The hash pins the exact file.
``personas``
    ``{"id", "name", "identity"}`` for an inline identity, or ``{"id",
    "starter"}`` naming a starter Anima (``starter:annie``) whose shipped name
    and identity text the app uses.
``items``
    Single-turn prompts: ``{"id", "area", "language", "pair_id", "message",
    "tags", "acceptable", "held_out", "tier"}``. ``acceptable`` lists the
    Gesture selectors (``null`` for no Gesture) that fit. A Japanese item's
    ``pair_id`` names the English item it translates.
``scripted_chats``
    ``{"id", "area", "language", "pair_id", "persona", "turns", "held_out",
    "tier"}``: fixed user messages sent turn by turn.

``language`` is ``en`` or ``ja``; ``tier`` is ``smoke`` (in the smoke and the
full tier) or ``full`` (full tier only). Held-out items are never used for
tuning prompts, AI descriptions, rubrics or guidance; reports show them apart.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from animama.app.services.anima_starter_service import STARTER_ANIMA_SPECS

from ..core.inputs import EvalInputError, read_json, require_unique, required_text
from ..core.loadouts import Loadout, load_loadout

__all__ = [
    "AREAS",
    "LANGUAGES",
    "TIERS",
    "Item",
    "Persona",
    "PromptSet",
    "ScriptedChat",
    "load_prompt_set",
]

AREAS = ("core", "long_chat")
LANGUAGES = ("en", "ja")
TIERS = ("smoke", "full")


@dataclass(frozen=True, slots=True)
class Persona:
    """The Anima a turn speaks as: the name and identity text chat puts in the prompt."""

    id: str
    name: str
    identity: str
    starter: str | None = None
    """The starter Anima id this persona uses, when it is one."""


@dataclass(frozen=True, slots=True)
class Item:
    """A single-turn prompt and the Gestures (``None`` for no Gesture) that fit it."""

    id: str
    area: str
    language: str
    message: str
    acceptable: tuple[str | None, ...]
    tags: tuple[str, ...] = ()
    pair_id: str | None = None
    held_out: bool = False
    tier: str = "full"


@dataclass(frozen=True, slots=True)
class ScriptedChat:
    """A multi-turn chat of fixed user messages, spoken to one persona."""

    id: str
    area: str
    language: str
    persona: str
    turns: tuple[str, ...]
    pair_id: str | None = None
    held_out: bool = False
    tier: str = "full"


@dataclass(frozen=True, slots=True)
class PromptSet:
    version: str
    loadout: Loadout
    personas: tuple[Persona, ...]
    items: tuple[Item, ...] = ()
    scripted_chats: tuple[ScriptedChat, ...] = ()
    hashes: Mapping[str, str] = field(default_factory=dict, compare=False)
    """SHA-256 of each loaded file's bytes, by role: ``manifest`` and ``loadout``."""

    def persona(self, persona_id: str) -> Persona:
        return next(persona for persona in self.personas if persona.id == persona_id)

    def for_tier(self, tier: str) -> PromptSet:
        """The items and chats in ``tier``: ``smoke`` keeps only those marked smoke."""

        if tier == "full":
            return self
        return PromptSet(
            version=self.version,
            loadout=self.loadout,
            personas=self.personas,
            items=tuple(item for item in self.items if item.tier == "smoke"),
            scripted_chats=tuple(chat for chat in self.scripted_chats if chat.tier == "smoke"),
            hashes=self.hashes,
        )


_MANIFEST_KEYS = frozenset({"version", "loadout", "personas", "items", "scripted_chats"})
_LOADOUT_KEYS = frozenset({"path", "sha256"})
_PERSONA_KEYS = frozenset({"id", "name", "identity", "starter"})
_ITEM_KEYS = frozenset({"id", "area", "language", "pair_id", "message", "tags", "acceptable", "held_out", "tier"})
_CHAT_KEYS = frozenset({"id", "area", "language", "pair_id", "persona", "turns", "held_out", "tier"})


def _known_keys(entry: Mapping[str, Any], keys: frozenset[str], where: str) -> None:
    """Reject keys the format does not define, so a typo such as ``held-out`` cannot silently change an entry."""

    unknown = sorted(set(entry) - keys)
    if unknown:
        raise EvalInputError(f"{where}: unknown keys {', '.join(map(repr, unknown))}")


def _choice(entry: Mapping[str, Any], key: str, choices: Sequence[str], where: str, default: str) -> str:
    value = entry.get(key, default)
    if value not in choices:
        raise EvalInputError(f"{where}: {key!r} must be one of {', '.join(choices)}")
    return str(value)


def _flag(entry: Mapping[str, Any], key: str, where: str) -> bool:
    value = entry.get(key, False)
    if not isinstance(value, bool):
        raise EvalInputError(f"{where}: {key!r} must be true or false")
    return value


def _optional_text(entry: Mapping[str, Any], key: str, where: str) -> str | None:
    if entry.get(key) is None:
        return None
    return required_text(entry, key, where)


def _strings(entry: Mapping[str, Any], key: str, where: str) -> tuple[str, ...]:
    values = entry.get(key, [])
    if not isinstance(values, list) or not all(isinstance(value, str) and value.strip() for value in values):
        raise EvalInputError(f"{where}: {key!r} must be a list of non-empty strings")
    return tuple(values)


def _loadout(base: Path, entry: Any, where: str) -> Loadout:
    if not isinstance(entry, Mapping):
        raise EvalInputError(f"{where}: expected {{'path', 'sha256'}}")
    _known_keys(entry, _LOADOUT_KEYS, where)
    loadout = load_loadout(base / required_text(entry, "path", where))
    if loadout.sha256 != required_text(entry, "sha256", where):
        raise EvalInputError(f"{where}: {entry['path']} does not match its pinned sha256")
    if list(loadout.selectors) != sorted(loadout.selectors):
        # Chat lists an Anima's equipped Gestures sorted by selector; the benchmark lists them the same way.
        raise EvalInputError(f"{where}: {entry['path']} must list Gestures sorted by selector, as chat does")
    return loadout


def _persona(entry: Any, where: str) -> Persona:
    if not isinstance(entry, Mapping):
        raise EvalInputError(f"{where}: expected an object")
    _known_keys(entry, _PERSONA_KEYS, where)
    persona_id = required_text(entry, "id", where)
    starter = _optional_text(entry, "starter", where)
    if starter is not None:
        spec = next((spec for spec in STARTER_ANIMA_SPECS if spec.id == starter), None)
        if spec is None:
            raise EvalInputError(f"{where}: unknown starter Anima {starter!r}")
        return Persona(id=persona_id, name=spec.display_name, identity=spec.identity_markdown, starter=starter)
    return Persona(
        id=persona_id, name=required_text(entry, "name", where), identity=required_text(entry, "identity", where)
    )


def _item(entry: Any, where: str) -> Item:
    if not isinstance(entry, Mapping):
        raise EvalInputError(f"{where}: expected an object")
    _known_keys(entry, _ITEM_KEYS, where)
    acceptable = entry.get("acceptable")
    if (
        not isinstance(acceptable, list)
        or not acceptable
        or not all(value is None or (isinstance(value, str) and value.strip()) for value in acceptable)
    ):
        raise EvalInputError(f"{where}: 'acceptable' must be a non-empty list of selectors or null")
    # The message is sent exactly as written; it only has to say something.
    required_text(entry, "message", where)
    return Item(
        id=required_text(entry, "id", where),
        area=_choice(entry, "area", ("core",), where, "core"),
        language=_choice(entry, "language", LANGUAGES, where, "en"),
        message=entry["message"],
        acceptable=tuple(value.strip() if isinstance(value, str) else None for value in acceptable),
        tags=_strings(entry, "tags", where),
        pair_id=_optional_text(entry, "pair_id", where),
        held_out=_flag(entry, "held_out", where),
        tier=_choice(entry, "tier", TIERS, where, "full"),
    )


def _scripted_chat(entry: Any, where: str) -> ScriptedChat:
    if not isinstance(entry, Mapping):
        raise EvalInputError(f"{where}: expected an object")
    _known_keys(entry, _CHAT_KEYS, where)
    turns = entry.get("turns")
    if not isinstance(turns, list) or not turns or not all(isinstance(turn, str) and turn.strip() for turn in turns):
        raise EvalInputError(f"{where}: 'turns' must be a non-empty list of messages")
    return ScriptedChat(
        id=required_text(entry, "id", where),
        area=_choice(entry, "area", ("long_chat",), where, "long_chat"),
        language=_choice(entry, "language", LANGUAGES, where, "en"),
        persona=required_text(entry, "persona", where),
        turns=tuple(turns),
        pair_id=_optional_text(entry, "pair_id", where),
        held_out=_flag(entry, "held_out", where),
        tier=_choice(entry, "tier", TIERS, where, "full"),
    )


def _check_references(prompt_set: PromptSet, where: str) -> None:
    persona_ids = {persona.id for persona in prompt_set.personas}
    selectors = set(prompt_set.loadout.selectors)
    english_items = {item.id for item in prompt_set.items if item.language == "en"}
    english_chats = {chat.id for chat in prompt_set.scripted_chats if chat.language == "en"}
    for item in prompt_set.items:
        unknown = [value for value in item.acceptable if value is not None and value not in selectors]
        if unknown:
            raise EvalInputError(f"{where}: item {item.id!r} accepts Gestures not in the loadout: {unknown}")
        _check_pair(item.id, item.language, item.pair_id, english_items, where)
    for chat in prompt_set.scripted_chats:
        if chat.persona not in persona_ids:
            raise EvalInputError(f"{where}: chat {chat.id!r} names unknown persona {chat.persona!r}")
        _check_pair(chat.id, chat.language, chat.pair_id, english_chats, where)


def _check_pair(entry_id: str, language: str, pair_id: str | None, english: set[str], where: str) -> None:
    if language == "en" and pair_id is not None:
        raise EvalInputError(f"{where}: English entry {entry_id!r} must not name a pair_id")
    if language != "en" and pair_id not in english:
        raise EvalInputError(f"{where}: {language} entry {entry_id!r} must name the English original it translates")


def load_prompt_set(path: Path) -> PromptSet:
    """Read and validate a format-v1 prompt-set manifest and the files it pins."""

    data, manifest_sha256 = read_json(path)
    where = str(path)
    if not isinstance(data, Mapping):
        raise EvalInputError(f"{where}: expected a JSON object")
    _known_keys(data, _MANIFEST_KEYS, where)
    raw_personas = data.get("personas")
    raw_items = data.get("items", [])
    raw_chats = data.get("scripted_chats", [])
    if not isinstance(raw_personas, list) or not raw_personas:
        raise EvalInputError(f"{where}: 'personas' must be a non-empty list")
    if not isinstance(raw_items, list) or not isinstance(raw_chats, list):
        raise EvalInputError(f"{where}: 'items' and 'scripted_chats' must be lists")
    loadout = _loadout(path.parent, data.get("loadout"), f"{where}: loadout")
    prompt_set = PromptSet(
        version=required_text(data, "version", where),
        loadout=loadout,
        personas=tuple(_persona(entry, f"{where}: personas[{index}]") for index, entry in enumerate(raw_personas)),
        items=tuple(_item(entry, f"{where}: items[{index}]") for index, entry in enumerate(raw_items)),
        scripted_chats=tuple(
            _scripted_chat(entry, f"{where}: scripted_chats[{index}]") for index, entry in enumerate(raw_chats)
        ),
        hashes={"manifest": manifest_sha256, "loadout": loadout.sha256},
    )
    if not prompt_set.items and not prompt_set.scripted_chats:
        raise EvalInputError(f"{where}: no items or scripted chats")
    require_unique((persona.id for persona in prompt_set.personas), f"{where}: personas")
    require_unique((item.id for item in prompt_set.items), f"{where}: items")
    require_unique((chat.id for chat in prompt_set.scripted_chats), f"{where}: scripted_chats")
    _check_references(prompt_set, where)
    return prompt_set
