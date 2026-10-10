"""Product HTTP routes shared by every Animama composition (ADR 0021).

The local composition and a hosted consumer mount the same product routes, each
with its own ports and admission. This package must not import the local
composition, installation state or process-global settings.
"""
