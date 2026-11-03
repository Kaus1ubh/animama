"""Benchmark configurations: a model catalog row plus the settings it is benchmarked at.

The standard set is every visible built-in chat row at reasoning effort none
and low. Other rows (owner-added, local or OpenRouter) and efforts are chosen
by id. A configuration the row cannot serve is reported as not run, with the
reason, instead of failing the run.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass

from animama.app.model_catalog import MAIN_STRUCTURED_RESPONSE_KIND, serialize_model_provider_catalog
from animama.domain import ModelProvider
from animama.domain.model_connection import MODEL_KIND_CHAT, MODEL_SOURCE_BUILTIN
from scripts.evals.core.inputs import EvalInputError

__all__ = [
    "STANDARD_EFFORTS",
    "Configuration",
    "builtin_chat_rows",
    "capability_problem",
    "first_per_row",
    "parse_config",
    "standard_configurations",
]

STANDARD_EFFORTS = ("none", "low")


@dataclass(frozen=True, slots=True)
class Configuration:
    """One catalog row at one reasoning effort (``None`` leaves the row's default)."""

    model_provider: ModelProvider
    effort: str | None

    @property
    def label(self) -> str:
        """A stable, unique name for reports: the row id and effort.

        For example ``AnthropicMessagesHTTPAgent:claude-haiku-5-5@none``; rows of different protocols can share a
        model id, so the model alone is not unique.
        """

        return f"{self.model_provider.id}@{self.effort or 'default'}"


def builtin_chat_rows() -> list[ModelProvider]:
    """The built-in catalog rows as the code defines them, for a dry run that reads no database."""

    from animama.adapters.mappers.model_provider_map import model_provider_registry_row_to_domain

    rows = [model_provider_registry_row_to_domain(row) for row in serialize_model_provider_catalog()]
    return [row for row in rows if row.model_kind == MODEL_KIND_CHAT]


def standard_configurations(rows: Iterable[ModelProvider]) -> list[Configuration]:
    """Every visible, active built-in chat row at each standard effort, ordered by row id."""

    standard = sorted(
        (
            row
            for row in rows
            if row.source == MODEL_SOURCE_BUILTIN
            and row.model_kind == MODEL_KIND_CHAT
            and row.active
            and not row.hidden
        ),
        key=lambda row: row.id,
    )
    return [Configuration(row, effort) for row in standard for effort in STANDARD_EFFORTS]


def parse_config(text: str, rows: Sequence[ModelProvider]) -> Configuration:
    """Resolve ``<row id>[@<effort>]`` against the catalog rows."""

    row_id, _, effort = text.partition("@")
    row = next((row for row in rows if row.id == row_id), None)
    if row is None:
        raise EvalInputError(f"--config: no catalog row {row_id!r} (see the models command)")
    return Configuration(row, effort.strip() or None)


def first_per_row(configurations: Iterable[Configuration]) -> tuple[Configuration, ...]:
    """The first configuration of each catalog row, in order."""

    first: dict[str, Configuration] = {}
    for configuration in configurations:
        first.setdefault(configuration.model_provider.id, configuration)
    return tuple(first.values())


def capability_problem(configuration: Configuration) -> str | None:
    """Why chat cannot run this configuration, or ``None`` when it can."""

    capabilities = configuration.model_provider.capabilities
    if MAIN_STRUCTURED_RESPONSE_KIND not in (capabilities.structured_kinds or ()):
        return "no structured chat replies"
    if not capabilities.supports_streaming:
        return "no streaming"
    effort = configuration.effort
    if effort is not None and (
        not capabilities.supports_reasoning or effort not in (capabilities.supported_reasoning_efforts or ())
    ):
        return f"reasoning effort {effort} not supported"
    return None
