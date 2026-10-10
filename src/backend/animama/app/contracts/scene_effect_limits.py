"""Ranges and counts for Scene Effect definitions (``animama/scene-effect/1``).

Definitions are untrusted input from the creator, Local content and Portable
packages. The backend checks them at Save, scan and package import; the creator
checks the same values before Save (``src/frontend/web/src/lib/scene-vfx/
limits.ts``). ``src/frontend/web/src/lib/content/fixtures/
scene-effect-limits.json`` records the values for the parity tests. A range is
``(minimum, maximum)``, inclusive.
"""

from __future__ import annotations

from typing import Any, Final

Range = tuple[float, float]

SCENE_EFFECT_LIMITS: Final[dict[str, Any]] = {
    "durationMs": (100, 30_000),
    "seed": (0, 4_294_967_295),
    "pattern": {"size": (1, 512), "spacing": (0, 1024), "opacity": (0, 1)},
    "marquee": {
        "items": 64,
        "itemSize": (1, 1024),
        "gap": (0, 2048),
        "rowGap": (0, 2048),
        "rotationDeg": (-360, 360),
        "speedPxPerSec": (0, 2000),
        "opacity": (0, 1),
    },
    "focus": {
        "lineCount": (1, 256),
        "opacity": (0, 1),
        "baseThicknessPx": (0.1, 128),
        "thicknessVariationPx": (0, 128),
        "lengthVariation": (0, 1),
        "overscanPx": (0, 4096),
        "paddingPx": (0, 2048),
        "animationMs": (0, 10_000),
        "opacityJitter": (0, 1),
    },
    # C1: a linear or radial gradient fill of 2-4 stops.
    "gradient": {"angleDeg": (0, 360), "center": (0, 1), "stops": (2, 4), "position": (0, 1)},
    # C2: one image tiled over the view, drifting.
    "tile": {"size": (16, 1024), "opacity": (0, 1), "speedPxPerSec": (0, 600)},
    # C3: procedural rays; turnSeconds is 0 (still) or this range, signed.
    "rays": {
        "count": (4, 48),
        "center": (0, 1),
        "turnSeconds": (4, 600),
        "throbPerSec": (0, 4),
        "opacity": (0, 1),
    },
    # C3: procedural lines; swaySeconds is 0 (still) or this range.
    "lines": {
        "count": (4, 96),
        "length": (0.05, 1),
        "widthPx": (0.5, 16),
        "swaySeconds": (1, 60),
        "opacity": (0, 1),
    },
    # C4 and C5: scattered items with per-item variation and motion.
    "scatter": {
        "layers": 3,
        "items": (1, 8),
        "count": (1, 48),
        "totalCount": 96,
        "sizePx": (4, 512),
        "rotationDeg": (-360, 360),
        "opacity": (0, 1),
        "region": (0, 1),
        "speedPxPerSec": (0, 600),
        "spinDegPerSec": (0, 720),
    },
    # C6: one fade from a colour when the Scene starts.
    "flash": {"durationMs": (50, 2000)},
}
