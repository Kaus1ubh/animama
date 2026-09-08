from __future__ import annotations

import re


def slugify(name: str) -> str:
    """Return a URL/identifier-friendly slug for a name.

    - Lowercases and replaces non-alphanumerics with dashes
    - Collapses multiple dashes
    - Ensures a non-empty return value (falls back to 'agent')
    """

    s = re.sub(r"[^a-zA-Z0-9]+", "-", name.strip().lower()).strip("-")
    return re.sub(r"-{2,}", "-", s) or "agent"
