"""Validate generated manifests against tracked JSON Schemas, fully offline."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from jsonschema import Draft202012Validator

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", type=Path, required=True)
    args = parser.parse_args()
    schemas = Path(__file__).resolve().parents[4] / "src/frontend/desktop/runtime"
    schema = json.loads((schemas / "desktop-runtime.schema.json").read_text())
    Draft202012Validator.check_schema(schema)
    Draft202012Validator(schema).validate(json.loads((args.runtime / "manifest.json").read_text()))
    Draft202012Validator.check_schema(json.loads((schemas / "feature-pack.schema.json").read_text()))
    print("Runtime manifest schema: OK")
