# Animama Private Data

This root is reserved for private non-portable files such as chat attachments
and internal application machinery. It is deliberately separate from the
shareable typed content library.

```text
user-files/                  private chat attachments
staging/uploads/             bounded upload staging
staging/imports/             hostile package validation staging
staging/exports/             generated export staging
internal/operations/         safe-Save operation receipts
internal/runtime/            short-lived runtime state
internal/derivatives/        generated previews and portraits
internal/reconciliation/     scanner bookkeeping
```

Back up durable private data together with PostgreSQL and `content/local`.
Staging and reconstructible runtime bookkeeping may be excluded by a documented
consistent backup procedure.
