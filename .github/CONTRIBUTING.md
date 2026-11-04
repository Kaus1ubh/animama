# Contributing

Animama has one maintainer, Raymond Van. Bug reports and feature ideas are
welcome; code contributions are not accepted for now.

## Report a bug or suggest a feature

Open an issue with the [bug report](https://github.com/raymond-van/animama/issues/new?template=bug.yml)
or [feature request](https://github.com/raymond-van/animama/issues/new?template=feature.yml)
form. Search existing issues first. Report security problems privately, as the
[security policy](https://github.com/raymond-van/animama/security/policy)
describes, never in a public issue.

## Pull requests

Pull requests from outside contributors are not accepted for now. Keeping the
maintainer the sole author keeps the licensing simple while the project
settles; this may change, with a contributor agreement, later. If you have a
fix, describe it in an issue.

## Working on your own copy

The source is licensed AGPL-3.0-only, so you are free to study, change and run
it under that licence. A modified build that you distribute or host must use
its own name and infrastructure; see [Name and logo](../docs/trademarks.md).

- [README](../README.md#run-from-source) and
  [development and operations](../docs/backend/operations/development.md):
  setting up and running a local stack.
- [How Animama is built](../docs/agents/README.md): the development lifecycle,
  and where specs, plans and decision records live.
- [AGENTS.md](../AGENTS.md): the guide AI coding agents read first; it also
  lists the checks.
- `python3 scripts/public-release/check_source.py`: every tracked file needs a
  licence-review entry; see [Source licensing review](../licenses/README.md).

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).
