"""Safe, bounded removal diagnostics shared by local adapters and delivery."""

from dataclasses import dataclass
from typing import Literal

FEATURE_PACK_IDS = frozenset({"expanded-included-content"})
BlockerKind = Literal["anima_loadout", "runtime_lease", "preview_lease", "content_operation"]


@dataclass(frozen=True, slots=True)
class PackRemovalBlocker:
    kind: BlockerKind
    id: str
    label: str
