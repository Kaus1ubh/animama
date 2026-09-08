"""Shared product catalogs shipped in source, wheel and frozen distributions.

These are product definitions, not installation settings. Frontend source files
remain canonical; the build verifies the generated package copies byte-for-byte.
There is no checkout discovery or local-runtime fallback in this module.
"""

from importlib.resources import files
from pathlib import Path

CATALOG_NAMES = frozenset({"animation-manifest.json", "vfx-catalog.json"})


def catalog_resource(name: str) -> Path:
    """Resolve a known catalog from the installed package, failing on omission."""
    if name not in CATALOG_NAMES:
        raise ValueError(f"Unknown shared product catalog: {name}")
    resource = files("animama.resources").joinpath(name)
    if not resource.is_file():
        raise FileNotFoundError(f"Required packaged product catalog is missing: {name}")
    return Path(str(resource))
