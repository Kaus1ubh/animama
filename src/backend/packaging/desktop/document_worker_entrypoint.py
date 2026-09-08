"""PyInstaller boot script; never imports the core runtime CLI."""

from animama.runtime.document_worker import main

if __name__ == "__main__":
    raise SystemExit(main())
