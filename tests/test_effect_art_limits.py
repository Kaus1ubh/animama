"""The backend's Particle texture and Scene image limits match the shared fixture.

The asset scripts, the frontend import checks and the backend validators read
the same limits; the fixture under the frontend ``lib`` is the parity record.
"""

from __future__ import annotations

import json
from pathlib import Path

from animama.app.contracts.effect_art_limits import PARTICLE_TEXTURE_LIMITS, SCENE_IMAGE_LIMITS, EffectArtLimits

FIXTURE = json.loads(
    (Path(__file__).parents[1] / "src/frontend/web/src/lib/content/fixtures/effect-art-limits.json").read_text()
)


def _as_fixture(limits: EffectArtLimits) -> dict[str, int]:
    """Spell the backend limits with the fixture's keys; unset limits are omitted."""
    values = {
        "bytes": limits.max_bytes,
        "dimension": limits.max_dimension,
        "pixels": limits.max_pixels,
        "grid": limits.max_grid,
        "count": limits.max_count,
        "totalBytes": limits.max_total_bytes,
    }
    return {key: value for key, value in values.items() if value is not None}


def test_particle_texture_limits_match_the_fixture() -> None:
    assert _as_fixture(PARTICLE_TEXTURE_LIMITS) == FIXTURE["particleTexture"]


def test_scene_image_limits_match_the_fixture() -> None:
    assert _as_fixture(SCENE_IMAGE_LIMITS) == FIXTURE["sceneImage"]
