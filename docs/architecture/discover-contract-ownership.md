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

Existing package versions and fixtures remain stable. The supported local
package format is typed `.animama` `/2`; it does not export live Animas.
Contributors need no private proposal or approval records to use these contracts.

See [Repository boundaries](repository-boundaries.md) for artifact ownership and
[Typed content](../backend/features/typed-content-and-marketplace.md) for the
implemented local content behavior.
