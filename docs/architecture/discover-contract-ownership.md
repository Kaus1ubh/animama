# Discover compatibility boundary

Discover and local-to-hosted account connection are discontinued. The local
application has no Discover navigation, publishing service or acquisition flow.
Local content remains editable and supports the existing typed `.animama`
`animama-content-package/2` import/export behavior.

The unpublished `@animama/discover-client` package remains in the public artifact
set for compatibility with existing consumers and immutable artifact locks. It
contains inert contract fixtures and request-building helpers; it does not
provide a supported online feature. Its proposed protocol identifiers remain
unratified. Do not interpret their presence as product commitments or add a
service requirement to local builds, tests or startup.

Existing package versions and fixtures remain stable. This cleanup introduces
no `.anima` format, package `/3`, live-Anima export, identity connection or new
import/export behavior. Full historical proposals and approval records are
retained privately; contributors do not need them to use the current repository.

See [Repository boundaries](repository-boundaries.md) for artifact ownership and
[Typed content](../backend/features/typed-content-and-marketplace.md) for the
implemented local content behavior.
