import hashlib
import uuid

import pytest

from animama.app.services.runtime_budget_policy import (
    MAX_RUNTIME_ENTRIES,
    RuntimeBudgetUsage,
    runtime_budget_violation,
)
from animama.domain.runtime_content_descriptor import validate_admitted_item_revisions


def test_runtime_budget_policy_is_shared_and_operation_independent() -> None:
    assert (
        runtime_budget_violation(
            RuntimeBudgetUsage(
                entries=MAX_RUNTIME_ENTRIES + 1,
                bytes=0,
                audio_seconds=0,
                config_bytes=0,
            )
        )
        == "runtime_entry_budget"
    )
    assert runtime_budget_violation(RuntimeBudgetUsage(entries=1, bytes=1, audio_seconds=0, config_bytes=2)) is None


def test_admitted_item_map_holds_exactly_the_runtime_entry_limit() -> None:
    def admitted(count: int) -> dict[str, str]:
        return {
            str(uuid.uuid5(uuid.NAMESPACE_URL, f"item-{index}")): hashlib.sha256(str(index).encode()).hexdigest()
            for index in range(count)
        }

    # The byte cap must not undercut the entry limit.
    assert len(validate_admitted_item_revisions(admitted(MAX_RUNTIME_ENTRIES))) == MAX_RUNTIME_ENTRIES
    with pytest.raises(ValueError, match="item count"):
        validate_admitted_item_revisions(admitted(MAX_RUNTIME_ENTRIES + 1))
