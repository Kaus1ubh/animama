#!/usr/bin/env python3
"""Export two clean candidates from a fully classified immutable Git commit."""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import tempfile
import tomllib
from pathlib import Path

from export_core import (
    ACTIVE,
    PROVENANCE_FILE,
    Blobs,
    Git,
    assert_path_set,
    canonical,
    check_secret,
    classification,
    file_identity,
    pointer,
    portable_path,
    safe_active_path,
    sha256,
    tree_digest,
    validate_provenance,
    verify_export,
)


def mappings_for(manifest: dict, assignments: dict) -> tuple[dict, dict, str]:
    """Map classified inputs; replacements suppress exactly one same-owner original."""
    settings = manifest.get("export", {})
    if not isinstance(settings, dict):
        raise ValueError("export must be a TOML table")
    mappings = settings.get("mappings", [])
    if not isinstance(mappings, list):
        raise ValueError("export.mappings must be an array")
    mapped, replaced = {}, {}
    for item in mappings:
        if not isinstance(item, dict) or set(item) - {"source", "target", "replaces"}:
            raise ValueError("Mappings support only source, target and optional replaces")
        source, target = portable_path(item.get("source")), portable_path(item.get("target"))
        if source not in assignments or assignments[source] not in ACTIVE or source in mapped:
            raise ValueError(f"Duplicate or non-active mapping source: {source!r}")
        mapped[source] = target
        if "replaces" in item:
            original = portable_path(item["replaces"])
            if (
                original == source
                or original not in assignments
                or original in replaced
                or assignments[original] != assignments[source]
                or target != original
            ):
                raise ValueError("Replacement must name one distinct same-owner source at its original target")
            if assignments[original] == "cloud" and (
                original.casefold() == "plans.md" or "plans" in Path(original.casefold()).parts[:-1]
            ):
                raise ValueError("A replacement cannot suppress a full private plan")
            replaced[original] = source
    if set(mapped) & set(replaced):
        raise ValueError("A replaced source cannot also have a mapping")
    outputs = {
        source: mapped.get(source, source)
        for source, owner in assignments.items()
        if owner in ACTIVE and source not in replaced
    }
    for owner in ACTIVE:
        paths = [target for source, target in outputs.items() if assignments[source] == owner]
        if PROVENANCE_FILE in paths:
            raise ValueError(f"{PROVENANCE_FILE} is reserved for generated export provenance")
        assert_path_set([*paths, PROVENANCE_FILE])
    return outputs, replaced, sha256(canonical(mappings))


def project_inventory(
    manifest: dict,
    provenance: dict,
    assignments: dict,
    outputs: dict,
    identities: dict,
    source_commit: str,
    manifest_sha: str,
    mappings_sha: str,
) -> dict[str, bytes]:
    """Generate a standalone public inventory without leaking private source paths."""
    origin = {"source_commit": source_commit, "source_manifest_sha256": manifest_sha, "mappings_sha256": mappings_sha}
    snapshot_id = sha256(canonical(origin))
    metadata = {
        "schema_version": 1,
        "mode": "exported-snapshot",
        "source_commit": source_commit,
        "source_manifest_sha256": manifest_sha,
        "snapshot_id": snapshot_id,
    }
    public = {source: target for source, target in outputs.items() if assignments[source] == "public"}
    inventory_path = "repository-boundary.toml"
    provenance_source = manifest["provenance_manifest"]
    if public.get(inventory_path) != inventory_path or public.get(provenance_source) != provenance_source:
        raise ValueError("Projected inventory/provenance must retain their public original paths")
    groups = []
    for group in manifest["groups"]:
        paths = sorted(public[path] for path in group["paths"] if path in public)
        if paths:
            # Rationales describe source review but must not enumerate removed/private files.
            groups.append(
                {
                    "id": group["id"],
                    "owner": "public",
                    "rationale": "Reviewed public files from the immutable source export.",
                    "paths": paths,
                }
            )
    groups.append(
        {
            "id": "split-provenance",
            "owner": "public",
            "rationale": "Deterministic source identifiers for this candidate.",
            "paths": [PROVENANCE_FILE],
        }
    )
    lines = ["# Standalone public snapshot; original source history is retained privately."]
    for key, value in {**metadata, "provenance_manifest": provenance_source}.items():
        lines.append(f"{key} = {json.dumps(value)}")
    if manifest.get("scanner_pins") in public:
        lines.append(f"scanner_pins = {json.dumps(public[manifest['scanner_pins']])}")
    for group in groups:
        lines.append("\n[[groups]]")
        for key in ("id", "owner", "rationale"):
            lines.append(f"{key} = {json.dumps(group[key])}")
        lines.append("paths = [")
        lines.extend(f"  {json.dumps(path)}," for path in group["paths"])
        lines.append("]")
    projected_files = []
    required_ids = set()
    for record in provenance["files"]:
        if record["path"] in public:
            transformed = dict(record, path=public[record["path"]])
            projected_files.append(transformed)
            required_ids.update(transformed["evidence_ids"])
    evidence = []
    for item in provenance["evidence"]:
        if item["id"] not in required_ids:
            continue
        transformed = {key: value for key, value in item.items() if key != "path_sha256"}
        transformed["path_sha256"] = {
            public[path]: digest
            for path, digest in item["path_sha256"].items()
            if path in public and path not in {inventory_path, provenance_source}
        }
        if not transformed["path_sha256"]:
            raise ValueError(f"Public asset loses all public provenance evidence: {item['id']!r}")
        evidence.append(transformed)
    projected_provenance = {**metadata, "evidence": evidence, "files": sorted(projected_files, key=lambda r: r["path"])}
    return {inventory_path: ("\n".join(lines) + "\n").encode(), provenance_source: canonical(projected_provenance)}


def output_locations(root: Path, public: Path, cloud: Path, manifest: Path) -> tuple[Path, Path, Path]:
    """Reject reused, overlapping or source-contained output locations before writes."""
    for path in (public, cloud, manifest):
        if path.is_symlink():
            raise ValueError("Export output cannot be a symlink")
    public, cloud, manifest = public.resolve(), cloud.resolve(), manifest.resolve()
    for output in (public, cloud):
        if output == root or output.is_relative_to(root):
            raise ValueError("Candidate outputs must be outside the source checkout")
        if output.exists() and (not output.is_dir() or any(output.iterdir())):
            raise ValueError("Candidate output must be absent or empty; nonempty resume is unsupported")
    if public == cloud or public.is_relative_to(cloud) or cloud.is_relative_to(public):
        raise ValueError("Candidate roots must be distinct and disjoint")
    if (
        manifest.is_relative_to(root)
        or manifest.is_relative_to(public)
        or manifest.is_relative_to(cloud)
        or manifest.exists()
        or manifest.with_suffix(manifest.suffix + ".sha256").exists()
    ):
        raise ValueError("Export manifest must be a new external file outside source and candidates")
    return public, cloud, manifest


def export(
    root: Path, explicit_commit: str | None, manifest_path: str, public: Path, cloud: Path, output_manifest: Path
) -> dict:
    """Preflight immutable bytes, then atomically install each complete candidate directory."""
    git = Git(root)
    commit = git.source_commit(explicit_commit)
    public, cloud, output_manifest = output_locations(git.root, public, cloud, output_manifest)
    portable_path(manifest_path)
    entries = git.entries(commit)
    blobs = Blobs(git)
    try:
        # The implementation is a committed export input too, not a dirty rewrite engine.
        for name in ("export.py", "export_core.py", "audit-classification.py"):
            source_tool = f"scripts/repository-boundary/{name}"
            if source_tool in entries and (
                blobs.read(entries[source_tool]["oid"]) != Path(__file__).with_name(name).read_bytes()
            ):
                raise ValueError(f"Run the committed exporter tools for the selected revision: {source_tool}")
        if manifest_path not in entries:
            raise ValueError("Classification manifest is not committed at the selected revision")
        manifest_bytes = blobs.read(entries[manifest_path]["oid"])
        manifest_sha = sha256(manifest_bytes)
        manifest = tomllib.loads(manifest_bytes.decode())
        if manifest.get("schema_version") != 1 or manifest.get("mode", "source") != "source":
            raise ValueError("Export requires the authoritative schema-1 source inventory")
        errors = []
        assignments = classification.ownership(manifest, set(entries), errors)
        if errors:
            raise ValueError("\n".join(errors))
        outputs, replaced, mappings_sha = mappings_for(manifest, assignments)
        allowed = manifest.get("export", {}).get("allowed_paths", [])
        if (
            not isinstance(allowed, list)
            or any(not isinstance(path, str) for path in allowed)
            or len(allowed) != len(set(allowed))
            or any(assignments.get(path) not in ACTIVE for path in allowed)
        ):
            raise ValueError("export.allowed_paths must list distinct exact active source paths")
        allowed = set(allowed)
        allowed_targets = {outputs[path] for path in allowed if path in outputs}
        lfs_attributes = git.lfs_paths(commit, entries)
        lfs_store = git.lfs_store()
        identities, payloads = {}, {}
        for path, entry in entries.items():
            payload = blobs.read(entry["oid"])
            lfs = pointer(payload, path)
            if path in lfs_attributes and lfs is None:
                raise ValueError(f"Committed LFS attribute lacks a pointer: {path!r}")
            if lfs:
                disk = lfs_store / lfs["oid"][:2] / lfs["oid"][2:4] / lfs["oid"]
                if not disk.is_file():
                    raise ValueError(f"Required LFS object is not hydrated locally: {path!r}")
                digest, size = file_identity(disk, secret_path=path if path in outputs else None)
                if (digest, size) != (lfs["oid"], lfs["size"]):
                    raise ValueError(f"LFS object does not match committed pointer: {path!r}")
                identities[path] = {"sha256": digest, "size": size, "lfs_oid": lfs["oid"], "lfs_size": size}
                payloads[path] = disk
            else:
                identities[path] = {"sha256": sha256(payload), "size": len(payload)}
                payloads[path] = payload
                if path in outputs:
                    check_secret(payload, path)
            if path in outputs:
                safe_active_path(path, assignments[path], allowed)
                safe_active_path(outputs[path], assignments[path], allowed_targets)
        provenance_path = portable_path(manifest.get("provenance_manifest"))
        if provenance_path not in entries:
            raise ValueError("Provenance manifest must be committed")
        provenance = json.loads(blobs.read(entries[provenance_path]["oid"]))
        validate_provenance(git, blobs, provenance, entries, identities, manifest)
        generated = {"public": {}, "cloud": {}}
        project = manifest.get("export", {}).get("project_inventory", False)
        if type(project) is not bool:
            raise ValueError("export.project_inventory must be boolean")
        if project:
            if manifest_path != "repository-boundary.toml":
                raise ValueError("Inventory projection requires the canonical root manifest")
            public_lfs = {
                outputs[path] for path in outputs if assignments[path] == "public" and "lfs_oid" in identities[path]
            }
            if public_lfs:
                if any(
                    assignments[source] == "public" and source != target and Path(target).name == ".gitattributes"
                    for source, target in outputs.items()
                ):
                    raise ValueError("Projected LFS output requires unchanged committed attribute locations")
                target_attributes = git.lfs_paths(commit, dict.fromkeys(public_lfs))
                if public_lfs - target_attributes:
                    raise ValueError(
                        "Projected LFS targets require committed LFS attributes: "
                        f"{sorted(public_lfs - target_attributes)!r}"
                    )
            generated["public"].update(
                project_inventory(
                    manifest,
                    provenance,
                    assignments,
                    outputs,
                    identities,
                    commit,
                    manifest_sha,
                    mappings_sha,
                )
            )
        for owner in ACTIVE:
            generated[owner][PROVENANCE_FILE] = (
                "# Split provenance\n\n"
                f"Repository role: `{owner}`\n\n"
                f"Source commit: `{commit}`\n\n"
                f"Source classification manifest SHA-256: `{manifest_sha}`\n\n"
                f"Committed mapping SHA-256: `{mappings_sha}`\n\n"
                "This is a private candidate. Publication and license approval remain separate.\n"
            ).encode()
        result = {
            "schema_version": 1,
            "kind": "repository-export",
            "source_commit": commit,
            "source_manifest": manifest_path,
            "source_manifest_sha256": manifest_sha,
            "source_provenance_sha256": sha256(blobs.read(entries[provenance_path]["oid"])),
            "mappings_sha256": mappings_sha,
            "project_inventory": project,
            "publication_approval": False,
            "source_files": [],
            "exports": {},
        }
        for source in sorted(entries):
            row = {
                "path": source,
                "owner": assignments[source],
                "git_blob_oid": entries[source]["oid"],
                "mode": entries[source]["mode"],
                **identities[source],
            }
            if source in outputs:
                row.update(disposition="exported", target=outputs[source])
                if outputs[source] in generated[assignments[source]]:
                    row["disposition"] = "projected"
            elif source in replaced:
                row.update(disposition="replaced", replacement_source=replaced[source])
            else:
                row["disposition"] = assignments[source]
            result["source_files"].append(row)
        for owner in sorted(ACTIVE):
            records = []
            for source, target in outputs.items():
                if assignments[source] != owner or target in generated[owner]:
                    continue
                records.append(
                    {
                        "path": target,
                        "mode": entries[source]["mode"],
                        **identities[source],
                        "source_path": source,
                        "git_blob_oid": entries[source]["oid"],
                    }
                )
            for target, payload in generated[owner].items():
                safe_active_path(target, owner)
                check_secret(payload, target)
                records.append(
                    {
                        "path": target,
                        "mode": "100644",
                        "size": len(payload),
                        "sha256": sha256(payload),
                        "generated": "projected-inventory" if target != PROVENANCE_FILE else "split-provenance",
                    }
                )
            records.sort(key=lambda row: row["path"])
            assert_path_set([row["path"] for row in records])
            result["exports"][owner] = {"tree_sha256": tree_digest(records), "files": records}
        # All classification, provenance, path and content checks precede creation of outputs.
        for owner, destination in (("public", public), ("cloud", cloud)):
            destination.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.TemporaryDirectory(prefix=".animama-export-", dir=destination.parent) as temporary:
                stage = Path(temporary) / "candidate"
                stage.mkdir()
                for record in result["exports"][owner]["files"]:
                    path = stage / record["path"]
                    path.parent.mkdir(parents=True, exist_ok=True)
                    value = generated[owner].get(record["path"])
                    if value is None:
                        value = payloads[record["source_path"]]
                    if isinstance(value, Path):
                        shutil.copyfile(value, path, follow_symlinks=False)
                    else:
                        path.write_bytes(value)
                    path.chmod(int(record["mode"], 8) & 0o777)
                    if file_identity(path) != (record["sha256"], record["size"]):
                        raise ValueError("Source object changed during materialization")
                if destination.exists():
                    destination.rmdir()  # Fails if anything arrived after the empty-directory preflight.
                stage.rename(destination)
        output_manifest.parent.mkdir(parents=True, exist_ok=True)
        with output_manifest.open("xb") as stream:
            stream.write(canonical(result))
        with output_manifest.with_suffix(output_manifest.suffix + ".sha256").open("x") as stream:
            stream.write(f"{sha256(canonical(result))}  {output_manifest.name}\n")
        verify_export(output_manifest, public, cloud)
        return result
    finally:
        blobs.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--source-commit")
    parser.add_argument("--manifest", default="repository-boundary.toml", help="Committed source-relative manifest")
    parser.add_argument("--public-out", type=Path, required=True)
    parser.add_argument("--cloud-out", type=Path, required=True)
    parser.add_argument("--output-manifest", type=Path)
    args = parser.parse_args()
    try:
        result = export(
            args.root,
            args.source_commit,
            args.manifest,
            args.public_out,
            args.cloud_out,
            args.output_manifest or args.public_out.parent / "export-manifest.json",
        )
        print(
            json.dumps(
                {
                    "source_commit": result["source_commit"],
                    "manifest_sha256": sha256(canonical(result)),
                    "trees": {owner: data["tree_sha256"] for owner, data in result["exports"].items()},
                },
                sort_keys=True,
            )
        )
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(f"Export failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
