"""Conversion-only fresh destinations must never replace an operator's edits."""

from __future__ import annotations

import json

import pytest

from animama.domain.content_catalog import ContentConflictError, ContentKind
from tests.content_package_helpers import package_services


def test_fresh_descriptor_destination_rejects_existing_files(async_session, tmp_path) -> None:  # noqa: ANN001
    paths, _, content, _, _ = package_services(async_session, tmp_path)
    original = {
        "schema_version": 2,
        "content_type": "idle_style",
        "content_id": "local:idle:existing",
        "name": "Existing operator edit",
        "default_pool": [],
        "cells": {},
        "dependencies": [],
    }
    store = content.mutations.store
    store.save_descriptor_entry(
        kind=ContentKind.IDLE_STYLE,
        relative_locator="idle-styles/occupied",
        descriptor=json.dumps(original).encode(),
        companion_files={},
    )
    before = (paths.local_root / "idle-styles/occupied/occupied.json").read_bytes()
    with pytest.raises(ContentConflictError, match="content_destination_exists"):
        store.save_descriptor_entry(
            kind=ContentKind.IDLE_STYLE,
            relative_locator="idle-styles/occupied",
            descriptor=json.dumps({**original, "name": "Attempted overwrite"}).encode(),
            companion_files={},
            require_new=True,
        )
    assert (paths.local_root / "idle-styles/occupied/occupied.json").read_bytes() == before
