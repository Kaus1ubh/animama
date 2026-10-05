"""Hostile whole-application archives, tested before any consumer can select them."""

import copy
import gzip
import importlib.util
import io
import json
import tarfile
import unittest
from pathlib import Path
from unittest.mock import patch

import application
import test_package_sets as helpers
from application import TEMPLATE_BASE, inspect_archive, unpack_application
from package_set import canonical, file_record, sha, verify


class HostedApplicationTests(unittest.TestCase):
    """Use independent tiny bytes, not a producer that also implements verification."""

    def setUp(self):
        helpers.PackageSetTests.setUp(self)
        template = {
            "index.html": ('<script src="' + TEMPLATE_BASE + 'app.js"></script>').encode(),
            "app.js": b"console.log('whole app fixture')",
            "notices/license.txt": b"Fixture license notice",
        }
        template["tts/workers/inference-worker.js"] = b"self.postMessage({type:'ready'})"
        assets = []
        for i in range(21):
            data, name = bytes([i]), f"models/fixture-{i}.onnx"
            template["onnx/" + name] = data
            assets.append({"path": name, "size": len(data), "sha256": sha(data)})
        template["resource-manifests/browser-runtime.json"] = canonical({"schema_version": 1, "files": assets})
        digest = sha(canonical({name: {"sha256": sha(data), "size": len(data)} for name, data in template.items()}))
        prefix = "/_animama/static/" + digest + "/"
        self.files = {
            name if name == "index.html" else prefix[1:] + name: data.replace(TEMPLATE_BASE.encode(), prefix.encode())
            for name, data in template.items()
        }
        self.seed_files = {
            "included/avatar.vrm": b"fixture avatar bytes",
            "included/licenses/inventory.json": b"{}",
            "notices/LICENSE": b"Fixture permission provenance",
        }
        inventory = {
            "schema": "animama-starter-content/1",
            "starter_pack": {},
            "starters": [{"diagnostics": []}, {"diagnostics": []}],
            "entries": [],
            "excluded": [],
            "files": [
                {
                    "path": "avatar.vrm",
                    "size_bytes": 20,
                    "sha256": sha(self.seed_files["included/avatar.vrm"]),
                    "license": {"license_id": "Fixture", "provenance": "Independent unit-test bytes"},
                }
            ],
        }
        inventory["files"][0]["size_bytes"] = len(self.seed_files["included/avatar.vrm"])
        inventory["id"] = sha(json.dumps(inventory, sort_keys=True, separators=(",", ":")).encode())
        self.seed = {
            "schema_version": 1,
            "artifact": "animama-included-content",
            "source_commit": "a" * 40,
            "source_tree": "b" * 40,
            "inventory": inventory,
            "files": [
                {"path": name, "size_bytes": len(data), "sha256": sha(data)} for name, data in self.seed_files.items()
            ],
            "notices": ["notices/LICENSE"],
        }
        self.app = {
            "schema_version": 1,
            "source_commit": "a" * 40,
            "app_version": "0.1.0",
            "entry_document": "index.html",
            "backend_contracts": {
                "runtime-owner": {"min_major": 1, "max_major_exclusive": 2},
                "local-http": {"min_major": 1, "max_major_exclusive": 2},
            },
            "files": [
                {
                    "path": name,
                    "sha256": sha(data),
                    "size": len(data),
                    "mime_type": "text/html; charset=utf-8"
                    if name.endswith(".html")
                    else "text/javascript; charset=utf-8"
                    if name.endswith(".js")
                    else "application/json"
                    if name.endswith(".json")
                    else "application/octet-stream"
                    if name.endswith(".onnx")
                    else "text/plain; charset=utf-8",
                    "cache": "revalidate" if name == "index.html" else "immutable",
                    "range": False,
                }
                for name, data in self.files.items()
            ],
            "lazy_resources": [],
            "notices": [next(name for name in self.files if name.endswith("license.txt"))],
            "catalog_seed": {
                "manifest": "catalog-seed/manifest.json",
                "sha256": sha(canonical(self.seed)),
                "size": len(canonical(self.seed)),
            },
        }
        self.m["schema_version"] = 2
        self.write_app()

    def write_app(self, extras=(), app=None):
        app = app or self.app
        archive = self.old / "animama-hosted-web-0.1.0.tar.gz"
        with tarfile.open(archive, "w:gz") as tar:
            for name, data in {
                **self.files,
                **{"catalog-seed/" + name: data for name, data in self.seed_files.items()},
                "catalog-seed/manifest.json": canonical(self.seed),
                "app-manifest.json": canonical(app),
            }.items():
                info = tarfile.TarInfo("animama-hosted-web/" + name)
                info.size = len(data)
                tar.addfile(info, io.BytesIO(data))
            for info, data in extras:
                tar.addfile(info, io.BytesIO(data) if data is not None else None)
        self.m["applications"] = [
            file_record(self.old, archive.name, kind="application", name="animama-hosted-web", version="0.1.0")
        ]
        helpers.write_manifest(self.old, self.m)

    def test_format2_selects_verified_whole_application(self):
        self.assertEqual(verify(self.old), self.m)

    def test_text_only_application_cannot_pass_the_speech_inventory_gate(self):
        self.files.pop(next(name for name in self.files if name.endswith("/resource-manifests/browser-runtime.json")))
        self.write_app()
        with self.assertRaisesRegex(ValueError, "baseline"):
            verify(self.old)

    def test_unlisted_duplicate_parent_encoded_and_link_members_rejected(self):
        for name, link in (
            ("surprise.js", False),
            ("index.html", False),
            ("../escape", False),
            ("%2e%2e/escape", False),
            ("linked", True),
        ):
            with self.subTest(name=name):
                info = tarfile.TarInfo("animama-hosted-web/" + name)
                info.size = 1
                if link:
                    info.type, info.linkname, info.size = tarfile.SYMTYPE, "/tmp/outside", 0
                self.write_app([(info, None if link else b"x")])
                with self.assertRaises(ValueError):
                    verify(self.old)

    def test_hash_mime_cache_backend_bounds_and_closed_manifest_rejected(self):
        for mutate in (
            lambda a: a["files"][1].update(sha256="e" * 64),
            lambda a: a["files"][1].update(mime_type="text/html"),
            lambda a: a["files"][0].update(cache="immutable"),
            lambda a: a["backend_contracts"]["local-http"].update(min_major=2),
            lambda a: a.update(provider_secret="forbidden"),
            lambda a: a.update(source_commit="f" * 40),
        ):
            with self.subTest(mutate=mutate):
                app = copy.deepcopy(self.app)
                mutate(app)
                self.write_app(app=app)
                with self.assertRaises(ValueError):
                    verify(self.old)

    def test_seed_is_closed_source_bound_and_cannot_hide_in_static_inventory(self):
        original = copy.deepcopy(self.seed)
        for mutate in (
            lambda seed: seed.update(source_commit="f" * 40),
            lambda seed: seed.update(source_tree="f" * 40),
            lambda seed: seed["files"][0].update(sha256="f" * 64),
            lambda seed: seed["files"][0].update(path="../escape"),
            lambda seed: seed.update(notices=[]),
            lambda seed: seed.update(private_upload="forbidden"),
        ):
            with self.subTest(mutate=mutate):
                self.seed = copy.deepcopy(original)
                mutate(self.seed)
                self.app["catalog_seed"].update(sha256=sha(canonical(self.seed)), size=len(canonical(self.seed)))
                self.write_app()
                with self.assertRaises(ValueError):
                    verify(self.old)

    def test_malformed_json_scalars_fail_as_rejected_manifests(self):
        for mutate in (
            lambda app: app.update(source_commit=None),
            lambda app: app.update(notices=[{}]),
            lambda app: app["files"][0].update(sha256=True),
            lambda app: app["files"][0].update(cache={}),
            lambda app: app.update(lazy_resources=[{"id": None}]),
        ):
            with self.subTest(mutate=mutate):
                app = copy.deepcopy(self.app)
                mutate(app)
                self.write_app(app=app)
                with self.assertRaises(ValueError):
                    verify(self.old)

    def test_limits_and_selected_archive_hash_precede_extraction(self):
        archive = self.old / "animama-hosted-web-0.1.0.tar.gz"
        destination = self.root / "rejected-selection"
        with self.assertRaisesRegex(ValueError, "selected package-set digest"):
            unpack_application(
                archive,
                destination,
                "a" * 40,
                "0.1.0",
                self.m["contracts"],
                archive_sha256="f" * 64,
                source_tree="b" * 40,
            )
        self.assertFalse(destination.exists())
        with patch("application.MAX_TEXT", 1), self.assertRaisesRegex(ValueError, "verifier memory"):
            inspect_archive(archive)

    def test_members_after_tar_end_and_truncated_gzip_are_not_closed_archives(self):
        archive = self.old / "animama-hosted-web-0.1.0.tar.gz"
        original = archive.read_bytes()
        extra = io.BytesIO()
        with tarfile.open(fileobj=extra, mode="w:gz") as tar:
            info = tarfile.TarInfo("animama-hosted-web/hidden-after-end.txt")
            info.size = 1
            tar.addfile(info, io.BytesIO(b"x"))
        for data in (original + extra.getvalue(), original[:-8]):
            with self.subTest(kind="concatenated" if len(data) > len(original) else "truncated"):
                archive.write_bytes(data)
                self.m["applications"] = [
                    file_record(self.old, archive.name, kind="application", name="animama-hosted-web", version="0.1.0")
                ]
                helpers.write_manifest(self.old, self.m)
                with self.assertRaises(ValueError):
                    verify(self.old)

    def extension_archive(self, extensions, *, original=True):
        """Build raw extension frames without a writer normalizing hostile metadata."""
        archive = self.old / "animama-hosted-web-0.1.0.tar.gz"
        suffix = gzip.decompress(archive.read_bytes()) if original else b"\0" * 1024
        raw = b""
        for kind, payload, declared in extensions:
            header = tarfile.TarInfo("././@PaxHeader")
            header.type, header.size = kind, len(payload) if declared is None else declared
            raw += header.tobuf() + payload + b"\0" * (-len(payload) % 512)
        archive.write_bytes(gzip.compress(raw + suffix, mtime=0))
        return archive

    @staticmethod
    def pax_path(path):
        """Canonical POSIX length includes its decimal prefix and trailing newline."""
        body = b"path=" + path.encode() + b"\n"
        length = len(body) + 3
        while len(str(length)) + 1 + len(body) != length:
            length = len(str(length)) + 1 + len(body)
        return str(length).encode() + b" " + body

    def test_repeated_pax_cannot_hide_expanded_bytes_in_a_complete_valid_app(self):
        payload = self.pax_path("animama-hosted-web/index.html") * 40000
        archive = self.extension_archive([(tarfile.XHDTYPE, payload, None)])
        self.assertLess(archive.stat().st_size, 16 * 1024)
        with patch("application.MAX_TOTAL", 64 * 1024), self.assertRaises(ValueError):
            application.verify_application(archive, "a" * 40, "0.1.0", self.m["contracts"], source_tree="b" * 40)

    def test_hostile_extensions_fail_before_tarfile_can_preconsume_or_recurse(self):
        original = (self.old / "animama-hosted-web-0.1.0.tar.gz").read_bytes()
        path = "animama-hosted-web/index.html"
        record = self.pax_path(path)
        cases = [
            [(tarfile.XHDTYPE, record * 2, None)],
            [(tarfile.XGLTYPE, record, None)],
            [(tarfile.GNUTYPE_LONGNAME, path.encode() + b"\0", None)],
            [(tarfile.GNUTYPE_LONGLINK, path.encode() + b"\0", None)],
            [(tarfile.XHDTYPE, b"", 8 * 1024 * 1024)],
            [(tarfile.XHDTYPE, self.pax_path("animama-hosted-web/" + "x" * 120 + ".txt"), None)] * 3,
        ]

        def forbidden_parser(*_):
            raise AssertionError("Untrusted extension body reached tarfile's allocating/recursive parser")

        for extensions in cases:
            with self.subTest(types=[extension[0] for extension in extensions]):
                (self.old / "animama-hosted-web-0.1.0.tar.gz").write_bytes(original)
                archive = self.extension_archive(extensions)
                with (
                    patch.object(tarfile.TarInfo, "_proc_pax", forbidden_parser),
                    patch.object(tarfile.TarInfo, "_proc_gnulong", forbidden_parser),
                    self.assertRaises(ValueError),
                ):
                    inspect_archive(archive)

    def test_genuine_producer_long_paths_roundtrip_without_extension_recursion(self):
        archive = self.root / "long-path.tar.gz"
        name = "a" * 120 + "/resource.txt"
        payload = b"Verified long-path bytes"
        with tarfile.open(archive, "w:gz", format=tarfile.PAX_FORMAT) as tar:
            info = tarfile.TarInfo("animama-hosted-web/" + name)
            info.size = len(payload)
            tar.addfile(info, io.BytesIO(payload))
        files, texts = inspect_archive(archive)
        self.assertEqual(files, {name: {"sha256": sha(payload), "size": len(payload)}})
        self.assertEqual(texts[name], payload)

    def test_changed_archive_with_hostile_header_cleans_partial_installation(self):
        archive = self.old / "animama-hosted-web-0.1.0.tar.gz"
        raw = gzip.decompress(archive.read_bytes())
        with tarfile.open(archive) as tar:
            last = list(tar)[-1]
            end = last.offset_data + (last.size + 511) // 512 * 512
        header = tarfile.TarInfo("././@PaxHeader")
        header.type, header.size = tarfile.XHDTYPE, 8 * 1024 * 1024
        hostile = gzip.compress(raw[:end] + header.tobuf() + b"\0" * 1024, mtime=0)
        verify_before_mutation = application.verify_application

        def replace_after_verification(*args, **kwargs):
            result = verify_before_mutation(*args, **kwargs)
            archive.write_bytes(hostile)
            return result

        destination = self.root / "unselected-after-mutation"
        with patch("application.verify_application", replace_after_verification), self.assertRaises(ValueError):
            unpack_application(archive, destination, "a" * 40, "0.1.0", self.m["contracts"])
        self.assertFalse(destination.exists())
        self.assertEqual(list(self.root.glob("app-verified-*")), [])

    def test_changed_emitted_bytes_cannot_keep_the_same_immutable_urls(self):
        name = next(name for name in self.files if name.endswith("/app.js"))
        self.files[name] += b"\n// A different build from the same source.\n"
        entry = next(entry for entry in self.app["files"] if entry["path"] == name)
        entry.update(sha256=sha(self.files[name]), size=len(self.files[name]))
        self.write_app()
        with self.assertRaisesRegex(ValueError, "prefix does not bind"):
            verify(self.old)

    def test_controlled_selection_retains_bytes_under_a_distinct_verified_prefix(self):
        archive = self.old / "animama-hosted-web-0.1.0.tar.gz"
        selected = self.root / "selected"
        unpack_application(archive, selected, "a" * 40, "0.1.0", self.m["contracts"])
        fixture_file = (
            Path(__file__).resolve().parents[2]
            / "scripts/repository-boundary/consumers/hosted-app/selection_fixture.py"
        )
        spec = importlib.util.spec_from_file_location("selection_fixture", fixture_file)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        changed = module.previous_resource_fixture(selected, self.root / "controlled", self.m["contracts"])
        after = json.loads((changed / "app-manifest.json").read_bytes())
        self.assertEqual(after["source_commit"], self.app["source_commit"])
        before_worker = next(entry for entry in self.app["files"] if entry["path"].endswith("/inference-worker.js"))
        after_worker = next(entry for entry in after["files"] if entry["path"].endswith("/inference-worker.js"))
        self.assertNotEqual(after_worker["path"], before_worker["path"])
        self.assertNotEqual(after_worker["sha256"], before_worker["sha256"])
        self.assertEqual(after["catalog_seed"], self.app["catalog_seed"])


if __name__ == "__main__":
    unittest.main()
