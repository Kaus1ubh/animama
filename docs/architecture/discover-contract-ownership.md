# Discover compatibility boundary

Discover and local-to-hosted account connection are discontinued. The local
application has no Discover navigation, publishing service or acquisition flow.
Local content remains editable and supports local `.zip`
[package sharing](../backend/features/typed-content-and-marketplace.md#local-package-boundary).

The unpublished `@animama/discover-client` package remains in the public artifact
set for compatibility with existing consumers and immutable artifact locks. It
contains inert contract fixtures and request-building helpers; it does not
provide a supported online feature. Its proposed protocol identifiers remain
unratified. Do not interpret their presence as product commitments or add a
service requirement to local builds, tests or startup.

Existing compatibility package versions and fixtures remain stable. They do not
define the supported local package format or enable hosted publication.
Contributors need no private proposal or approval records to use these contracts.

See [Repository boundaries](repository-boundaries.md) for artifact ownership and
[Typed content](../backend/features/typed-content-and-marketplace.md) for the
implemented local content behavior.
