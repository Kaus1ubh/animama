# Repository boundary checks

These tools verify shared-code import direction and isolated wheel/npm consumers.
Repository ownership is documented in
[repository boundaries](../../docs/architecture/repository-boundaries.md).

For an unpublished source review candidate, use
[source preparation](../public-release/README.md).

Run the tooling tests from the repository root:

```bash
uv run --no-sync python -m unittest discover -s scripts/repository-boundary -p 'test_*.py'
```

## Shared import and artifact checks

`check-python-imports.py` statically follows every domain/application module,
including relative imports, package initializers and transitive helpers. A
dependency on local installation state, server construction, migrations,
local HTTP admission or private service modules fails. Local compositions may
depend on shared APIs; the reverse direction is forbidden.

`check-packed-artifacts.py` requires one built Python wheel and the three packed
npm packages (`runtime-contracts`, `product-ui`, `discover-client`). It validates
emitted exports and rejects workspace/source dependencies, then copies consumer
fixtures into a new directory outside the checkout. The frontend installs only
tarballs and declared registry dependencies, checks declarations, builds with
Vite and mounts two fake owners in Chromium. It exercises real Anima selection,
chat/session/SSE code, cancellation, stale event fencing, failed-POST retry
policy, emitted CSS and transport-supplied thumbnails. The backend installs the
wheel into a new virtual environment and exercises real bootstrap, Anima and
chat services with fake ports/model clients. Separate consumers render the shared
request/response schemas and exercise content save, export, import and receipt
recovery with owner-scoped memory storage and the canonical archive inspector.
Local-composition imports are
actively blocked and loaded modules must not resolve into the source checkout.

From the repository root:

```bash
uv run --no-sync python scripts/repository-boundary/check-python-imports.py
uv build --wheel --out-dir /private/tmp/animama-package-audit
pnpm --dir src/frontend packages:pack --destination /private/tmp/animama-package-audit
uv run --no-sync python scripts/repository-boundary/check-packed-artifacts.py /private/tmp/animama-package-audit
```

The artifact checker needs Node/pnpm, uv and Playwright's Chromium browser.
The frontend's normal `pnpm e2e:install` command installs that browser. Optional
`--offline` requires a populated dependency cache; `--pnpm-store PATH` selects a
content-addressed store whose package bytes are copied into the consumer, never
linked back to application source. `--work-dir PATH` chooses a new empty output
directory outside the checkout. The checker prints the evidence directory and
retains logs, the browser screenshot, installed dependency locks and a summary.
It never reads the maintainer's application `.env` or calls a model/service.

Build the wheel twice from unchanged inputs and compare SHA-256 digests to
verify reproducibility. These checks prove package composition and fixture
behavior; local setup/restart, voice/avatar and native desktop acceptance remain
separate checks of the actual product.

## Candidate scanner pins

[scanner-pins.json](scanner-pins.json) records the official Gitleaks and
ScanCode release versions, exact archive digests, supported runner choice,
command shapes and recorded tool-verification scope. Verify the
selected download digest and executable version before use. Require a synthetic
secret-detection canary and a known-license fixture before accepting empty
candidate reports. Scanner output and any remediation evidence belong in private
storage outside the source tree. Do not interpret a pin or a passing inventory
check as a completed candidate scan or a license grant.
