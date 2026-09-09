# Security and issue boundaries

Ordinary bugs reproducible in the shared or local product belong in this
repository. Describe the local version, reproduction and expected behavior.
Do not include credentials, personal data, hosted internals, moderation evidence
or abuse details in a public issue or source change.

Report sensitive findings privately to the maintainer through an established
private channel. Authorized maintainers can use the private Animama Cloud
repository for hosted issues and coordinated fixes. If private advisory reporting
is available on this repository, it is also appropriate for a local/shared
vulnerability; this policy does not claim that GitHub feature is enabled.

A coordinated fix lands the public/shared dependency first, followed by the
private consumer lock and compatibility change. Public builds and contributors
never need private service code or private planning access. See
[repository boundaries](docs/architecture/repository-boundaries.md).
