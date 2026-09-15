#!/usr/bin/env python3
"""Expand recorded attribution into a hash-bound review inventory.

This is an inventory builder, not a license scanner or redistribution approval.
It reads tracked inputs only, preserves explicit exclusions, and represents
legacy fallback attribution as UNKNOWN. No asset is automatically approved.
"""

from __future__ import annotations

import argparse
import fnmatch
import hashlib
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = Path("docs/architecture/repository-provenance.json")
INCLUDED = "content/included/licenses/inventory.json"
RUNTIME = "src/frontend/desktop/runtime/license-sources.json"
NOTICE_ROOT = "src/frontend/desktop/runtime/notices/"
PUBLIC = "src/frontend/web/public/"
POCKET = "src/frontend/web/src/lib/speech/pocket/"


def command(root: Path, *args: str) -> bytes:
    """Run Git without a shell; never enumerate ignored private data."""
    return subprocess.run(args, cwd=root, check=True, capture_output=True).stdout


def load_checker():
    """Share the checker coverage policy instead of maintaining a second one."""
    spec = importlib.util.spec_from_file_location(
        "repository_boundary_audit", Path(__file__).with_name("audit-classification.py")
    )
    if spec is None or spec.loader is None:
        raise ValueError("Cannot load repository classification checker")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def matches_glob(path: str, pattern: str) -> bool:
    """Match inventory globs with ** as zero or more whole path components."""
    parts, patterns = path.split("/"), pattern.split("/")

    def matches(part: int, rule: int) -> bool:
        if rule == len(patterns):
            return part == len(parts)
        if patterns[rule] == "**":
            return matches(part, rule + 1) or (part < len(parts) and matches(part + 1, rule))
        return part < len(parts) and fnmatch.fnmatchcase(parts[part], patterns[rule]) and matches(part + 1, rule + 1)

    return matches(0, 0)


class Evidence:
    """Keep attribution evidence once while binding decisions to individual files."""

    def __init__(self, root: Path, entries: dict, checker):
        self.root, self.entries, self.checker = root, entries, checker
        self.groups: dict[str, dict] = {}
        self.rules = json.loads((root / INCLUDED).read_text())["rules"]
        self.runtime = {group["id"]: group for group in json.loads((root / RUNTIME).read_text())["groups"]}

    def add(
        self,
        identifier: str,
        *,
        source: str,
        revision: str = "UNKNOWN",
        license: str = "UNKNOWN",
        paths: tuple[str, ...] | list[str] = (),
        required_notices: tuple[str, ...] | list[str] = (),
        unresolved_decision: str,
    ) -> str:
        if identifier not in self.groups:
            # References must be tracked evidence, not a guessed missing notice.
            for path in paths:
                if path not in self.entries or not (self.root / path).is_file():
                    raise ValueError(f"Evidence input is not a tracked file: {path}")
            self.groups[identifier] = {
                "id": identifier,
                "source": source,
                "revision": revision,
                "license": license,
                "paths": sorted(paths),
                "path_sha256": {path: self.checker.digest(self.root / path) for path in sorted(paths)},
                "required_notices": list(required_notices),
                "unresolved_decision": unresolved_decision,
            }
        return identifier

    def runtime_group(self, identifier: str, revision: str = "UNKNOWN") -> str:
        group = self.runtime[identifier]
        notices = [NOTICE_ROOT + name for name in group.get("notice_files", [])]
        return self.add(
            identifier,
            source=group["source"],
            revision=revision,
            license=group["license"],
            paths=[RUNTIME, *[path for path in notices if path in self.entries]],
            required_notices=notices or ["Preserve and reconcile upstream copyright and license texts."],
            unresolved_decision=(
                "The existing record is pending release review. Verify upstream terms, "
                "the exact source-repository redistribution use, and required notices; "
                "desktop packaging evidence is not a source-publication grant."
            ),
        )

    def included(self, path: str) -> tuple[str, str, str]:
        relative = path.removeprefix("content/included/")
        for rule in self.rules:
            if rule["glob"] == "**/*" or not matches_glob(relative, rule["glob"]):
                continue
            identifier = "included-" + hashlib.sha256(rule["glob"].encode()).hexdigest()[:12]
            blocked = rule.get("distribution") == "excluded"
            mixamo = rule["license_id"] == "LicenseRef-Adobe-Mixamo-embedded-product"
            decision = (
                "Retain in private archival material under the existing exclusion. "
                "Do not export to public-ready source without a new explicit source/rights decision."
                if blocked
                else "Review exact source publication rights and attribution separately from desktop redistribution."
            )
            if mixamo:
                decision = (
                    "Existing approval covers embedded avatar playback, not raw asset redistribution. "
                    "Resolve whether these source files may be published, or replace/omit them and "
                    "update their runtime/catalog consumers before publication."
                )
            notices = [NOTICE_ROOT + "included-content-attribution.txt"]
            evidence_paths = [INCLUDED, "content/included/README.md", *notices]
            if "Twemoji" in rule["license_id"]:
                evidence_paths.append("content/included/resources/scene-vfx/twemoji/README.md")
                notices.append("Twemoji graphics CC-BY-4.0 attribution and license text")
            if "particle-VFX" in rule["license_id"]:
                evidence_paths.extend(
                    [
                        "content/included/vfx/particle/particle-vfx/README.md",
                        "src/frontend/scripts/generate-particle-vfx-assets.mjs",
                    ]
                )
            if any(name in rule["license_id"] for name in ("Brackeys", "Kenney", "LeLu", "particle-VFX")):
                decision += (
                    " The old inventory references upstream pack notices that are not tracked "
                    "in this snapshot; recover and review those notices before source publication."
                )
                notices.append("Referenced upstream pack license/readme/credits, currently absent from tracked source")
            identifier = self.add(
                identifier,
                source=f"Recorded creator: {rule['creator']}. {rule['provenance']}",
                revision="Twemoji 14.0.2" if "Twemoji" in rule["license_id"] else "UNKNOWN",
                license=rule["license_id"],
                paths=evidence_paths,
                required_notices=notices,
                unresolved_decision=decision,
            )
            status = "blocked" if blocked or mixamo else "review-pending"
            note = f"Existing desktop inventory selector: {rule['glob']}. "
            if blocked:
                note += "Existing distribution exclusion preserved; recommended private archive ownership."
            elif mixamo:
                note += "Embedded-product approval does not clear publication of raw VRMA assets."
            else:
                note += "Recorded attribution is evidence, not publication approval."
            return identifier, status, note
        identifier = self.add(
            "included-source-unknown",
            source="UNKNOWN: only a historical blanket project-owner fallback is recorded for these paths.",
            paths=[INCLUDED, "content/included/README.md"],
            required_notices=["UNKNOWN until actual sources, authors and terms are identified."],
            unresolved_decision=(
                "Identify each file's actual author/source and dependent asset terms. The legacy "
                "fallback is explicitly not ownership or redistribution clearance. Keep private "
                "until provenance and the applicable source license are resolved."
            ),
        )
        return (
            identifier,
            "review-pending",
            "Legacy blanket attribution deliberately not treated as verified authorship.",
        )

    def for_path(self, path: str) -> tuple[str, str, str]:
        if path.startswith("content/included/"):
            return self.included(path)
        if path.startswith("parakeet-tdt-0.6b-v2/"):
            identifier = self.add(
                "parakeet-source",
                source=self.runtime["parakeet-input"]["source"],
                revision=(
                    "istupakov 0bbb45a3365852604aef28b538a8f066f4ccaa85; ysdede "
                    "db4a768f5795e0f508187a34241fbeeef6ebb0d3"
                ),
                license="CC-BY-4.0 (declared; exact source redistribution review pending)",
                paths=[RUNTIME, "parakeet-tdt-0.6b-v2/ATTRIBUTION.md", "parakeet-tdt-0.6b-v2/README.md"],
                required_notices=[
                    "parakeet-tdt-0.6b-v2/ATTRIBUTION.md",
                    "NVIDIA model and conversion-source license/copyright notices",
                ],
                unresolved_decision=(
                    "Review source redistribution rights for the exact pinned model payloads "
                    "and include all upstream notices."
                ),
            )
            return (
                identifier,
                "review-pending",
                "Existing exact-snapshot evidence reused; no new upstream verification or approval performed.",
            )
        public_groups = (
            (PUBLIC + "basis/", "browser-basis", "UNKNOWN"),
            (PUBLIC + "onnx/ort/", "browser-onnx", "1.24.2"),
            (
                PUBLIC + "onnx/models/pocket-tts/",
                "browser-pocket",
                (
                    "codexxx 6fbae64699d94f60dde9c3975984b383a6a3d950; KevinAHM "
                    "3cf6daa623e2b09992c972cab32568ee8679a154; Kyutai "
                    "492522650173a0653b7575cdc25ae09810e5d741"
                ),
            ),
            (PUBLIC + "onnx/models/vad/", "browser-vad", "@ricky0123/vad-web 0.0.30; Silero VAD v5"),
            (PUBLIC + "onnx/models/smart-turn/", "browser-turn", "f766f81d3cfdf7737ac64aad813d91bbfd56bf93"),
        )
        for prefix, group, revision in public_groups:
            if path.startswith(prefix):
                return (
                    self.runtime_group(group, revision),
                    "review-pending",
                    "Source-publication and any commercial/hosted use require their own rights review.",
                )
        if path.startswith((POCKET, PUBLIC + "tts/")):
            identifier = self.add(
                "pocket-browser-code",
                source=(
                    "Recorded PocketTTS web implementation ancestry; local integration/debug "
                    "modifications also exist. Exact upstream-to-local derivation remains to be"
                    " reconciled."
                ),
                revision=(
                    "UNKNOWN; sentencepiece.js is recorded as matching KevinAHM "
                    "3cf6daa623e2b09992c972cab32568ee8679a154"
                ),
                license="Apache-2.0 (recorded browser-code declaration; per-file derivation review pending)",
                paths=[
                    RUNTIME,
                    NOTICE_ROOT + "pocket-tts-code-apache-2.0.txt",
                    NOTICE_ROOT + "pocket-tts-attribution.txt",
                    "scripts/repository-cleanup/measurement-rules.json",
                ],
                required_notices=[
                    NOTICE_ROOT + "pocket-tts-code-apache-2.0.txt",
                    "Preserve upstream copyright and identify local modifications.",
                ],
                unresolved_decision=(
                    "Reconcile the vendored code and modified workers against their exact "
                    "upstream revisions. Do not apply the model-weight license to browser "
                    "source by directory."
                ),
            )
            return (
                identifier,
                "review-pending",
                (
                    "Browser code reviewed separately from ONNX/model/voice assets; no blanket "
                    "local-authorship assumption."
                ),
            )
        if path.startswith(".agents/skills/"):
            skill = path.split("/")[2]
            skill_root = ".agents/skills/" + skill + "/"
            evidence_paths = [skill_root + "SKILL.md"]
            evidence_paths.extend(
                candidate
                for candidate in [skill_root + "README.md", skill_root + "metadata.json"]
                if candidate in self.entries
            )
            upstream = {
                "composition-patterns": (
                    "Vercel composition-patterns skill, as identified by checked-in skill "
                    "metadata; exact imported revision UNKNOWN."
                ),
                "react-best-practices": (
                    "https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices"
                    " ; locally adapted for Animama."
                ),
                "react-view-transitions": (
                    "https://github.com/vercel-labs/agent-skills ; checked-in README records "
                    "installation source and local compatibility adaptations."
                ),
                "web-design-guidelines": (
                    "Vercel skill; https://github.com/vercel-labs/web-interface-guidelines ; "
                    "local adaptations exist and a remote runtime guide is separate from "
                    "tracked source."
                ),
            }
            identifier = self.add(
                "skill-" + skill,
                source=upstream.get(
                    skill,
                    (
                        "UNKNOWN: project-local skill with no verified external origin or "
                        "complete authorship chain recorded in this inventory."
                    ),
                ),
                paths=evidence_paths,
                required_notices=["Identify and preserve any upstream skill license and copyright notice."],
                unresolved_decision=(
                    "Identify exact imported revisions and contribution provenance; resolve "
                    "local and upstream source-license terms before publication."
                ),
            )
            return (
                identifier,
                "review-pending",
                "Skill content, examples and generated compilations require their own provenance review.",
            )
        if path.startswith("content/"):
            identifier = self.add(
                "content-guide-source",
                source=(
                    "Tracked repository content guides; authorship chain and future source "
                    "license remain to be reviewed."
                ),
                paths=["LICENSE", "content/README.md"],
                required_notices=["Final approved source license and applicable copyright declarations."],
                unresolved_decision=(
                    "Reconcile contribution provenance and the currently undecided future source license."
                ),
            )
            return (
                identifier,
                "review-pending",
                "A tracked guide is not local user data; no ignored local payload was read.",
            )
        if path.startswith("observability/"):
            dashboard = json.loads((self.root / path).read_text()) if path.endswith(".json") else {}
            imported_id = dashboard.get("gnetId")
            identifier = self.add(
                "observability-" + hashlib.sha256(path.encode()).hexdigest()[:12],
                source=(
                    f"Recorded Grafana dashboard gnetId {imported_id}; title {dashboard.get('title')!r}. "
                    "This identifies an apparent imported dashboard; upstream source and license were not fetched."
                    if imported_id
                    else (
                        "UNKNOWN: no definitive external origin or complete authorship evidence"
                        " in this local observability input."
                    )
                ),
                paths=[path],
                required_notices=[
                    "Identify and preserve any upstream dashboard/configuration license and copyright notice."
                ],
                unresolved_decision=(
                    "Verify original author/source, imported revision, local modifications and "
                    "redistribution terms before publication."
                ),
            )
            return (
                identifier,
                "review-pending",
                "Dashboard metadata and configuration filenames do not establish ownership or publication rights.",
            )
        identifier = self.add(
            "unidentified-" + hashlib.sha256(path.encode()).hexdigest()[:12],
            source=(
                "UNKNOWN: no specific origin, authorship, upstream revision or permission "
                "evidence identified for this exact tracked input."
            ),
            paths=[path],
            required_notices=["UNKNOWN until actual source and terms are identified."],
            unresolved_decision=(
                "Identify the actual source and terms for this individual file before "
                "publication; replace or omit it if clearance cannot be established."
            ),
        )
        return (
            identifier,
            "review-pending",
            "Per-file unknown; neither its folder nor the root proprietary notice proves third-party rights.",
        )


def build(root: Path, source_commit: str) -> dict:
    """Bind the reviewed source revision, index identities and hydrated bytes."""
    checker = load_checker()
    entries = checker.index_entries(root)
    pointers = checker.lfs_pointers(root, entries)
    paths = sorted(checker.required_provenance_paths(entries, pointers))
    source_entries = {}
    for entry in command(root, "git", "ls-tree", "-r", "-z", source_commit).split(b"\0"):
        if entry:
            metadata, path = entry.split(b"\t", 1)
            source_entries[path.decode()] = metadata.split()[2].decode()
    evidence = Evidence(root, entries, checker)
    records = []
    for path in paths:
        if source_entries.get(path) != entries[path]["oid"]:
            raise ValueError(
                f"Asset index differs from source commit: {path}; review and explicitly refresh --source-commit"
            )
        payload = root / path
        if payload.is_symlink() or not payload.is_file():
            raise ValueError(f"Asset must be an ordinary hydrated tracked file: {path}")
        digest = checker.digest(payload)
        if path in pointers:
            pointer = pointers[path]
            if digest != pointer["oid"] or payload.stat().st_size != pointer["size"]:
                raise ValueError(f"LFS payload is missing, unhydrated or differs from its pointer: {path}")
        else:
            oid = command(root, "git", "hash-object", "--no-filters", "--", path).decode().strip()
            if oid != entries[path]["oid"]:
                raise ValueError(f"Tracked provenance input has unstaged changes: {path}")
        identifier, status, note = evidence.for_path(path)
        record = {
            "path": path,
            "git_blob_oid": entries[path]["oid"],
            "sha256": digest,
            "evidence_ids": [identifier],
            "publication_status": status,
            "notes": note,
        }
        if path in pointers:
            record.update(lfs_oid=pointers[path]["oid"], lfs_size=pointers[path]["size"])
        records.append(record)
    # Notices and attribution ledgers can sit outside the required asset set.
    # Bind those supporting inputs to the same committed snapshot as the assets.
    supporting_paths = {path for group in evidence.groups.values() for path in group["paths"]} - set(paths)
    for path in sorted(supporting_paths):
        if source_entries.get(path) != entries[path]["oid"]:
            raise ValueError(f"Evidence index differs from source commit: {path}")
        if (root / path).is_symlink():
            raise ValueError(f"Evidence must be an ordinary tracked file: {path}")
        oid = command(root, "git", "hash-object", "--no-filters", "--", path).decode().strip()
        if oid != entries[path]["oid"]:
            raise ValueError(f"Supporting provenance evidence has unstaged changes: {path}")
    if entries != checker.index_entries(root):
        raise ValueError("Git index changed during inventory; retry from a stable snapshot")
    return {
        "schema_version": 1,
        "source_commit": source_commit,
        "scope": (
            "Every tracked content path, browser public path, Parakeet path, agent skill, "
            "backend example, observability input, known vendored source, media/archive suffix,"
            " and Git LFS path. Ignored/untracked private data and historical payloads are not "
            "examined."
        ),
        "approval": (
            "No file is approved for publication by this inventory. Source ownership is solely "
            "in repository-boundary.toml. Existing desktop exclusions and constraints remain "
            "effective; all source-publication decisions are pending or blocked."
        ),
        "evidence": [evidence.groups[key] for key in sorted(evidence.groups)],
        "files": records,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument(
        "--source-commit", help="Explicitly reviewed source revision (defaults to existing inventory snapshot or HEAD)"
    )
    parser.add_argument("--check", action="store_true", help="Compare deterministic output without writing")
    args = parser.parse_args()
    root = args.root.resolve()
    destination = args.output if args.output.is_absolute() else root / args.output
    source = args.source_commit
    existing = json.loads(destination.read_text()) if destination.exists() else None
    if existing and existing.get("mode") == "exported-snapshot":
        if not args.check or source is not None:
            raise ValueError(
                "Projected provenance is an immutable export record; regenerate it from the reviewed source export"
            )
        result = load_checker().audit(root, root / "repository-boundary.toml")
        print(json.dumps({"check": True, "mode": "exported-snapshot", **result}, sort_keys=True))
        return 0
    if source is None and destination.exists():
        source = existing["source_commit"]
    source_commit = command(root, "git", "rev-parse", (source or "HEAD") + "^{commit}").decode().strip()
    result = build(root, source_commit)
    encoded = json.dumps(result, indent=2, ensure_ascii=False) + "\n"
    if args.check:
        if not destination.exists() or destination.read_text() != encoded:
            raise ValueError(
                "Provenance inventory differs from deterministic output; review changes before regeneration"
            )
    else:
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(encoded)
    counts = {
        status: sum(row["publication_status"] == status for row in result["files"])
        for status in ("approved", "review-pending", "blocked")
    }
    print(
        json.dumps(
            {
                "files": len(result["files"]),
                "evidence_groups": len(result["evidence"]),
                "lfs_files": sum("lfs_oid" in row for row in result["files"]),
                "publication_status": counts,
                "check": args.check,
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError, KeyError, subprocess.CalledProcessError) as error:
        print(f"Provenance inventory failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
