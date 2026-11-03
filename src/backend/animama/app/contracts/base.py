# Adapted from Letta (Apache-2.0): letta/schemas/letta_base.py; modified for Animama.
# See licenses/third-party/adapted-code.md.
import uuid
from datetime import datetime
from logging import getLogger
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

logger = getLogger(__name__)


class Base(BaseModel):
    """Base schema for Anima schemas (does not include model provider schemas)."""

    model_config = ConfigDict(
        populate_by_name=True,
        from_attributes=True,
        extra="forbid",
    )

    @classmethod
    def generate_id_field(cls, prefix: str | None = None):
        resolved_prefix = prefix or getattr(cls, "__id_prefix__", "item")
        assert isinstance(resolved_prefix, str)
        return Field(
            default_factory=lambda: cls.generate_id(resolved_prefix),
            description=cls._id_description(resolved_prefix),
            pattern=cls._id_regex_pattern(resolved_prefix),
            examples=[cls._id_example(resolved_prefix)],
        )

    @classmethod
    def generate_id(cls, prefix: str | None = None) -> str:
        prefix = prefix or getattr(cls, "__id_prefix__", "item")
        return f"{prefix}-{uuid.uuid4()}"

    @classmethod
    def _id_regex_pattern(cls, prefix: str):
        if cls.__name__ in ("JobBase", "Job", "Run", "RunBase"):
            prefix_pattern = "(job|run)"
        else:
            prefix_pattern = prefix

        return r"^" + prefix_pattern + r"-" r"[a-fA-F0-9]{8}"

    @classmethod
    def _id_example(cls, prefix: str):
        return f"{prefix}-123e4567-e89b-12d3-a456-426614174000"

    @classmethod
    def _id_description(cls, prefix: str):
        return f"The human-friendly ID of the {prefix.capitalize()}"

    @field_validator("id", check_fields=False, mode="before")
    @classmethod
    def allow_bare_uuids(cls, v, values):
        _ = values
        if isinstance(v, UUID):
            prefix = getattr(cls, "__id_prefix__", "item")
            logger.debug(f"Bare UUIDs are deprecated, please use the full prefixed id ({prefix})!")
            return f"{prefix}-{v}"
        return v

    def model_dump(self, to_orm: bool = False, **kwargs):
        data = super().model_dump(**kwargs)
        if to_orm and "metadata" in data:
            data["metadata_"] = data.pop("metadata")
        return data


class MetadataBase(Base):
    created_by_id: str | None = Field(default=None, description="The id of the user that made this object.")
    last_updated_by_id: str | None = Field(default=None, description="The id of the user that made this object.")
    created_at: datetime | None = Field(default=None, description="The timestamp when the object was created.")
    updated_at: datetime | None = Field(default=None, description="The timestamp when the object was last updated.")
