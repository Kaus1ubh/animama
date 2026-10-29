"""Shared pieces of the chat evaluation tools in ``scripts/evals``.

The Gesture selection harness and the model benchmark both run prompts through
chat's real turn executor (``DirectChatTurnExecutor``) with in-memory
stand-ins, a call budget, timing, usage and cost. These modules hold those
pieces so each tool keeps only its own inputs, measures and reports:

- ``inputs``: JSON input helpers and the input error type;
- ``pricing``: usage totals, catalog cost and ``--price`` rates;
- ``stats``: distributions, latency and token summaries, Gesture runs;
- ``model_calls``: the budgeted model client and its call records;
- ``chat``: the executor's in-memory stand-ins, turn options and requests, and
  the history replay chat would use;
- ``turns``: running one turn and collecting what it played;
- ``catalog``: the read-only model catalog and chat's model client registry.
"""
