"""Direct chat turn runtime helpers.

This package contains behavior-preserving pieces that were previously grouped
inside ``direct_executor.py``. ``DirectChatTurnExecutor`` remains the public
entrypoint; these modules keep request setup, stream collection, persistence
payloads, provider state, and domain-event construction separately readable.
"""
