"""PyInstaller's script entrypoint; keep the executable contract in the package."""

from animama.runtime.cli import main

raise SystemExit(main())
