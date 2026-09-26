"""Static, reviewed crisis-resource table and region resolution (spec R5).

The bundled table ships in ``animama.resources``. A self-host operator may
replace it with ``ANIMAMA_CRISIS_RESOURCES_PATH``; an invalid table raises at
load time so resources are never silently missing.
"""

from __future__ import annotations

import json
from datetime import date
from functools import cache
from importlib.resources import files
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, ValidationError, model_validator

FALLBACK_REGION_CODE = "fallback"
_BUNDLED_TABLE = "crisis-resources.v1.json"


class CrisisContact(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    kind: Literal["phone", "sms", "chat"]
    label: str = Field(min_length=1, max_length=80)
    value: str = Field(min_length=1, max_length=300)

    @model_validator(mode="after")
    def _validate_value(self) -> CrisisContact:
        if self.kind == "chat":
            HttpUrl(self.value)
            if not self.value.startswith("https://"):
                raise ValueError("chat contacts must use https URLs")
        elif not self.value.replace("+", "", 1).isdigit():
            raise ValueError("phone and sms contacts must be digits, optionally with a leading +")
        return self


class CrisisService(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=300)
    contacts: tuple[CrisisContact, ...] = Field(min_length=1)


class CrisisResourceRegion(BaseModel):
    """Resources for one region; ``source_url`` and ``verified_on`` record the review."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    code: str = Field(pattern=r"^([A-Z]{2}|fallback)$")
    label: str = Field(min_length=1, max_length=80)
    emergency_number: str | None = Field(default=None, pattern=r"^[0-9]{2,4}$")
    services: tuple[CrisisService, ...]
    source_url: HttpUrl | None
    verified_on: date


class CrisisResourceTable(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    version: Literal[1]
    regions: tuple[CrisisResourceRegion, ...] = Field(min_length=1)
    fallback: CrisisResourceRegion

    @model_validator(mode="after")
    def _validate_regions(self) -> CrisisResourceTable:
        codes = [region.code for region in self.regions]
        if len(codes) != len(set(codes)):
            raise ValueError("crisis resource region codes must be unique")
        if FALLBACK_REGION_CODE in codes:
            raise ValueError("the fallback entry belongs in 'fallback', not 'regions'")
        if self.fallback.code != FALLBACK_REGION_CODE:
            raise ValueError("the fallback entry must use code 'fallback'")
        for region in self.regions:
            if not region.services or region.source_url is None:
                raise ValueError(f"region {region.code} needs at least one service and a source_url")
        return self

    def region(self, code: str | None) -> CrisisResourceRegion:
        """Return the entry for ``code``, or the fallback for an unknown region."""

        normalized = (code or "").strip().upper()
        for region in self.regions:
            if region.code == normalized:
                return region
        return self.fallback


class CrisisResourceTableError(ValueError):
    """The configured crisis-resource table is missing or invalid."""


def load_crisis_resource_table(path: Path | None = None) -> CrisisResourceTable:
    """Load and validate the bundled table, or an operator replacement at ``path``."""

    source = str(path) if path is not None else f"animama.resources/{_BUNDLED_TABLE}"
    try:
        if path is None:
            raw = files("animama.resources").joinpath(_BUNDLED_TABLE).read_text(encoding="utf-8")
        else:
            raw = path.read_text(encoding="utf-8")
        return CrisisResourceTable.model_validate(json.loads(raw))
    except (OSError, json.JSONDecodeError, ValidationError) as exc:
        raise CrisisResourceTableError(f"invalid crisis resource table {source}: {exc}") from exc


@cache
def _cached_table(path: Path | None) -> CrisisResourceTable:
    return load_crisis_resource_table(path)


def crisis_resource_table(path: Path | None = None) -> CrisisResourceTable:
    """Return the validated table for ``path`` (cached per path)."""

    return _cached_table(path)


def region_from_locale(locale: str | None) -> str | None:
    """Extract an ISO region from a BCP 47 locale such as ``en-US`` or ``fr_CA``."""

    if not locale:
        return None
    for part in locale.replace("_", "-").split("-")[1:]:
        if len(part) == 2 and part.isalpha():
            return part.upper()
    return None


def resolve_crisis_region(
    table: CrisisResourceTable, *, preferred_region: str | None, locale: str | None
) -> CrisisResourceRegion:
    """Owner preference first, then the client locale's region, then the fallback."""

    if preferred_region:
        return table.region(preferred_region)
    return table.region(region_from_locale(locale))
