"""The ``animama/avatar-face-parts/1`` correction: user-chosen face and eye parts.

The frontend detects an Avatar's face skin, irises, eye details and hair from
VRM signals. A user can correct that detection; the correction names glTF mesh
primitives by ``node:mesh:primitive`` index keys, which are stable only for the
exact VRM bytes, so it also carries the VRM file's sha256. A correction whose
digest does not match the loaded VRM is ignored.

A Local Avatar stores its correction as ``face_parts`` in its ``.meta.json``
sidecar. An Included Avatar is read-only, so the owner's correction is stored
as an override keyed by the Avatar item and its revision.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

# A VRM rarely has more than a few dozen primitives; the bound keeps a hostile
# correction small without limiting real models.
MAX_PART_BINDINGS = 64

# glTF node, mesh and primitive indices, as the frontend's runtime bindings key them.
FacePartBindingKey = Annotated[str, StringConstraints(pattern=r"^\d{1,6}:\d{1,6}:\d{1,6}$")]
RequiredPartBindings = Annotated[list[FacePartBindingKey], Field(min_length=1, max_length=MAX_PART_BINDINGS)]
# An empty list marks an optional part as absent on this model.
OptionalPartBindings = Annotated[list[FacePartBindingKey], Field(max_length=MAX_PART_BINDINGS)]


class _Strict(BaseModel):
    """Reject unknown keys and coercions; keep the validation-mode JSON Schema for zod."""

    model_config = ConfigDict(extra="forbid", strict=True, json_schema_mode_override="validation")


class AvatarFacePartBindings(_Strict):
    """Primitive keys per part. ``eye_left``/``eye_right`` hold the irises; one
    primitive may hold both eyes and then appears in both lists."""

    face_skin: RequiredPartBindings
    eye_left: RequiredPartBindings
    eye_right: RequiredPartBindings
    eye_highlight: OptionalPartBindings | None = None
    eyeline: OptionalPartBindings | None = None
    eyelash: OptionalPartBindings | None = None
    hair: OptionalPartBindings | None = None

    @field_validator("face_skin", "eye_left", "eye_right", "eye_highlight", "eyeline", "eyelash", "hair")
    @classmethod
    def _unique(cls, value: list[str] | None) -> list[str] | None:
        if value is not None and len(set(value)) != len(value):
            raise ValueError("binding keys must be unique")
        return value


class AvatarFacePartCorrection(_Strict):
    """A complete correction for one exact VRM file."""

    schema_: Literal["animama/avatar-face-parts/1"] = Field(alias="schema")
    vrm_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    parts: AvatarFacePartBindings

    model_config = ConfigDict(
        extra="forbid",
        strict=True,
        json_schema_mode_override="validation",
        serialize_by_alias=True,
    )


AvatarFacePartsSource = Literal["local_metadata", "included_override", "none"]


class AvatarFacePartsUpdate(BaseModel):
    """Replace (or with ``face_parts: null``, clear) an Avatar's correction.

    ``expected_revision`` fences the write against a concurrent change to the
    Avatar; a Local write produces a new Avatar revision.
    """

    model_config = ConfigDict(extra="forbid")

    expected_revision: str = Field(pattern=r"^[0-9a-f]{64}$")
    face_parts: AvatarFacePartCorrection | None


class AvatarFacePartsState(BaseModel):
    """The effective correction for one Avatar and the revision it applies to."""

    model_config = ConfigDict(extra="forbid")

    item_id: str
    revision: str
    source: AvatarFacePartsSource
    face_parts: AvatarFacePartCorrection | None = None


__all__ = [
    "AvatarFacePartBindings",
    "AvatarFacePartCorrection",
    "AvatarFacePartsSource",
    "AvatarFacePartsState",
    "AvatarFacePartsUpdate",
]
