"""The shared upload spooler bounds request bodies and never creates directories (ADR 0021)."""

from __future__ import annotations

from pathlib import Path

import pytest
from starlette.requests import Request

from animama.product_http.uploads import UploadEnvelopeError, spool_bounded_request


def _request(body: bytes) -> Request:
    async def receive() -> dict[str, object]:
        return {"type": "http.request", "body": body, "more_body": False}

    headers = [(b"content-length", str(len(body)).encode())]
    return Request({"type": "http", "method": "PUT", "headers": headers}, receive)


async def test_spooling_leaves_a_missing_staging_directory_missing(tmp_path: Path) -> None:
    staging = tmp_path / "data" / "staging" / "uploads"

    body = await spool_bounded_request(
        _request(b"catalog"), expected_size_bytes=7, max_size_bytes=8, staging_directory=staging
    )

    assert (body.stream.read(), body.size_bytes) == (b"catalog", 7)
    body.close()
    assert not (tmp_path / "data").exists()


async def test_a_body_outside_its_declared_envelope_is_refused(tmp_path: Path) -> None:
    with pytest.raises(UploadEnvelopeError, match="upload_size_mismatch"):
        await spool_bounded_request(_request(b"catalog"), expected_size_bytes=6, max_size_bytes=8)
    with pytest.raises(UploadEnvelopeError, match="upload_size_invalid"):
        await spool_bounded_request(_request(b"catalog"), expected_size_bytes=9, max_size_bytes=8)
