from animama.app.services.runtime_budget_policy import (
    MAX_RUNTIME_ENTRIES,
    RuntimeBudgetUsage,
    runtime_budget_violation,
)


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
    assert (
        runtime_budget_violation(
            RuntimeBudgetUsage(entries=1, bytes=1, audio_seconds=0, config_bytes=2)
        )
        is None
    )
