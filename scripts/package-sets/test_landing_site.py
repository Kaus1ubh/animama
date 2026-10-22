"""Format-3 package sets: the landing site archive, its verifier and the producer's packer."""

import copy
import io
import shutil
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import build
import test_hosted_application
import test_package_sets as helpers
from landing_site import SITE, SITE_MANIFEST, site_mime, verify_site
from package_set import canonical, compare, file_record, identity, sha, verify

SITE_FILES = {
    "index.html": b'<!doctype html><script type="module" src="/assets/index-Bx1.js"></script>',
    "_headers": b"/*\n  X-Content-Type-Options: nosniff\n/assets/*\n  Cache-Control: immutable\n",
    "notices.txt": b"Fixture notices",
    "robots.txt": b"User-agent: *\nAllow: /\n",
    "sitemap.xml": b"<urlset><url><loc>https://animama.example/</loc></url></urlset>",
    "favicon.ico": b"\x00\x00\x01\x00",
    "emotions/joy-plain.webp": b"RIFF-fixture",
    "assets/index-Bx1.js": b"console.log('https://animama.example/home/')",
    "assets/content/Avatar-0123456789ab.vrm": b"glTF-fixture",
    "assets/content/0123456789ab/particle.json": b"{}",
}


def site_entry(name, data):
    try:
        mime_type = site_mime(name)
    except ValueError:
        mime_type = "application/octet-stream"  # Lets a test list an unreviewed file type.
    return {
        "path": name,
        "sha256": sha(data),
        "size": len(data),
        "mime_type": mime_type,
        "cache": "immutable" if name.startswith("assets/") else "revalidate",
    }


class LandingSiteTests(unittest.TestCase):
    """Independent tiny site bytes beside the hosted-application fixture set."""

    def setUp(self):
        test_hosted_application.HostedApplicationTests.setUp(self)
        self.site_files = dict(SITE_FILES)
        self.site = self.site_manifest()
        self.m["schema_version"] = 3
        self.write_site()

    write_app = test_hosted_application.HostedApplicationTests.write_app

    def site_manifest(self):
        return {
            "schema_version": 1,
            "site": SITE,
            "site_version": "0.1.0",
            "source_commit": "a" * 40,
            "source_tree": "b" * 40,
            "entry_document": "index.html",
            "headers_sha256": sha(self.site_files.get("_headers", b"")),
            "files": [site_entry(name, data) for name, data in sorted(self.site_files.items())],
        }

    def write_site(self, extras=(), site=None, files=None):
        archive = self.old / "animama-landing-0.1.0.tar.gz"
        with tarfile.open(archive, "w:gz") as tar:
            members = {**(self.site_files if files is None else files), SITE_MANIFEST: canonical(site or self.site)}
            for name, data in members.items():
                info = tarfile.TarInfo(f"{SITE}/{name}")
                info.size = len(data)
                tar.addfile(info, io.BytesIO(data))
            for info, data in extras:
                tar.addfile(info, io.BytesIO(data) if data is not None else None)
        self.m["sites"] = [file_record(self.old, archive.name, kind="site", name=SITE, version="0.1.0")]
        helpers.write_manifest(self.old, self.m)

    def verify_site(self):
        return verify_site(self.old / "animama-landing-0.1.0.tar.gz", "a" * 40, "0.1.0", source_tree="b" * 40)

    def test_format3_verifies_the_site_with_the_application(self):
        self.assertEqual(verify(self.old), self.m)
        self.assertEqual(self.verify_site(), self.site)
        self.assertTrue(identity(self.m).startswith("sets/v3/"))
        sums = (self.old / "SHA256SUMS").read_text()
        self.assertIn(f"{self.m['sites'][0]['sha256']}  animama-landing-0.1.0.tar.gz\n", sums)

    def test_set_record_must_be_one_listed_landing_site(self):
        for mutate in (
            lambda m: m.pop("sites"),
            lambda m: m.update(sites=[]),
            lambda m: m["sites"].append(dict(m["sites"][0], file="animama-landing-copy.tar.gz")),
            lambda m: m["sites"][0].update(name="other-site"),
            lambda m: m["sites"][0].update(kind="application"),
            lambda m: m["sites"][0].update(version="0.2.0"),
            lambda m: m["sites"][0].update(sha256="f" * 64),
            lambda m: m.update(schema_version=2),
        ):
            with self.subTest(mutate=mutate):
                m = copy.deepcopy(self.m)
                mutate(m)
                helpers.write_manifest(self.old, m)
                with self.assertRaises((ValueError, KeyError)):
                    verify(self.old)

    def test_a_site_is_listed_in_the_checksum_inventory(self):
        sums = self.old / "SHA256SUMS"
        sums.write_text("".join(line + "\n" for line in sums.read_text().splitlines() if "animama-landing" not in line))
        with self.assertRaisesRegex(ValueError, "Checksum"):
            verify(self.old)

    def test_tampered_added_and_missing_files_fail(self):
        tampered = dict(self.site_files, **{"robots.txt": b"User-agent: *\nDisallow: /\n"})
        missing = {k: v for k, v in self.site_files.items() if k != "favicon.ico"}
        added = dict(self.site_files, **{"extra.txt": b"unlisted"})
        for files in (tampered, missing, added):
            with self.subTest(files=sorted(set(files) ^ set(self.site_files)) or "tampered"):
                self.write_site(files=files)
                with self.assertRaisesRegex(ValueError, "integrity|inventories differ"):
                    verify(self.old)

    def test_required_files_are_required(self):
        for name in ("index.html", "_headers", "notices.txt", "robots.txt"):
            with self.subTest(name=name):
                self.site_files = {k: v for k, v in SITE_FILES.items() if k != name}
                self.site = self.site_manifest()
                self.write_site()
                with self.assertRaisesRegex(ValueError, "required"):
                    verify(self.old)

    def test_source_maps_local_paths_and_stage_routes_are_rejected(self):
        for name, data, error in (
            ("assets/index-Bx1.js.map", b"{}", "source map"),
            ("assets/index-Bx1.js", b'import "/Users/builder/animama/src/x.js"', "Local path"),
            ("notices.txt", b"Built in /home/builder/animama", "Local path"),
            ("assets/content/0123456789ab/particle.json", b'{"u":"file:///tmp/x.png"}', "Local path"),
            ("index.html", b"<script>'C:\\\\Users\\\\builder'</script>", "Local path"),
            ("assets/index-Bx1.js", b'fetch("/__preview/media/token/x.png")', "Stage server route"),
            ("index.html", b'<script src="/@fs/x.js"></script>', "Stage server route"),
            ("_headers", b"/__stage/*\n  X: y\n", "Stage server route"),
        ):
            with self.subTest(name=name, data=data):
                self.site_files = dict(SITE_FILES, **{name: data})
                self.site = self.site_manifest()
                self.write_site()
                with self.assertRaisesRegex(ValueError, error):
                    verify(self.old)

    def test_links_special_files_and_unsafe_paths_are_rejected(self):
        for name, kind in (
            ("linked.js", tarfile.SYMTYPE),
            ("hard.js", tarfile.LNKTYPE),
            ("fifo", tarfile.FIFOTYPE),
            ("assets", tarfile.DIRTYPE),
            ("../escape.txt", tarfile.REGTYPE),
        ):
            with self.subTest(name=name):
                info = tarfile.TarInfo(f"{SITE}/{name}")
                info.type = kind
                if kind in (tarfile.SYMTYPE, tarfile.LNKTYPE):
                    info.linkname = "index.html"
                data = b"x" if kind == tarfile.REGTYPE else None
                info.size = len(data or b"")
                self.write_site(extras=[(info, data)])
                with self.assertRaises(ValueError):
                    verify(self.old)
        info = tarfile.TarInfo("animama-hosted-web/index.html")
        info.size = 1
        self.write_site(extras=[(info, b"x")])
        with self.assertRaises(ValueError):
            verify(self.old)

    def test_closed_manifest_mime_cache_source_and_version(self):
        for mutate in (
            lambda s: s.update(source_commit="f" * 40),
            lambda s: s.update(source_tree="f" * 40),
            lambda s: s.update(site_version="0.2.0"),
            lambda s: s.update(site="other-site"),
            lambda s: s.update(entry_document="home.html"),
            lambda s: s.update(headers_sha256="e" * 64),
            lambda s: s.update(deploy_token="forbidden"),
            lambda s: s.update(schema_version=2),
            lambda s: s["files"][0].update(cache="immutable"),
            lambda s: next(f for f in s["files"] if f["path"].startswith("assets/")).update(cache="revalidate"),
            lambda s: s["files"][0].update(mime_type="text/html"),
            lambda s: s["files"][0].update(sha256="e" * 64),
            lambda s: s["files"][0].pop("cache"),
            lambda s: s["files"].append(dict(s["files"][0])),
            lambda s: s["files"].append(site_entry(SITE_MANIFEST, b"{}")),
        ):
            with self.subTest(mutate=mutate):
                site = copy.deepcopy(self.site)
                mutate(site)
                self.write_site(site=site)
                with self.assertRaises(ValueError):
                    verify(self.old)

    def test_unreviewed_file_types_are_rejected(self):
        self.site_files["run.exe"] = b"MZ"
        self.site = self.site_manifest()
        self.write_site()
        with self.assertRaisesRegex(ValueError, "Unreviewed site file type"):
            verify(self.old)

    def test_oversized_site_files_are_rejected(self):
        with patch("application.MAX_FILE", 64), self.assertRaisesRegex(ValueError, "oversized"):
            self.verify_site()  # index.html is over the patched per-file limit.
        with patch("application.MAX_TOTAL", 256), self.assertRaisesRegex(ValueError, "bounded"):
            self.verify_site()

    def test_format2_sets_still_verify_and_compare_into_format3(self):
        format2 = self.root / "format2"
        shutil.copytree(self.old, format2)
        (format2 / "animama-landing-0.1.0.tar.gz").unlink()
        m = copy.deepcopy(self.m)
        m.pop("sites")
        m["schema_version"] = 2
        helpers.write_manifest(format2, m)
        self.assertEqual(verify(format2), m)
        compare(format2, self.old)
        with self.assertRaisesRegex(ValueError, "downgrade"):
            compare(self.old, format2)

    def test_compare_rejects_a_site_version_rollback(self):
        newer = self.root / "newer"
        shutil.copytree(self.old, newer)
        site = dict(self.site, site_version="0.2.0")
        archive = newer / "animama-landing-0.2.0.tar.gz"
        (newer / "animama-landing-0.1.0.tar.gz").unlink()
        with tarfile.open(archive, "w:gz") as tar:
            for name, data in {**self.site_files, SITE_MANIFEST: canonical(site)}.items():
                info = tarfile.TarInfo(f"{SITE}/{name}")
                info.size = len(data)
                tar.addfile(info, io.BytesIO(data))
        m = copy.deepcopy(self.m)
        m["sites"] = [file_record(newer, archive.name, kind="site", name=SITE, version="0.2.0")]
        helpers.write_manifest(newer, m)
        compare(self.old, newer)
        with self.assertRaisesRegex(ValueError, "Site version rollback"):
            compare(newer, self.old)


class SitePackTests(unittest.TestCase):
    """The producer's packer emits archives the verifier accepts, byte for byte reproducibly."""

    def setUp(self):
        temp = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.built, self.stage = temp / "landing", temp / "stage"
        for name, data in SITE_FILES.items():
            (self.built / name).parent.mkdir(parents=True, exist_ok=True)
            (self.built / name).write_bytes(data)
        # A path over the 100-byte ustar name limit needs the producer's PAX record.
        self.long = "assets/content/0123456789ab/" + "a" * 90 + ".png"
        (self.built / self.long).write_bytes(b"\x89PNG-fixture")
        self.stage.mkdir()
        self.source = {"commit": "a" * 40, "tree": "b" * 40, "source_date_epoch": 1_700_000_000}

    def test_pack_round_trips_deterministically(self):
        record = build.pack_site(self.built, self.stage, self.source, "1.2.3")
        self.assertEqual(
            {k: record[k] for k in ("file", "kind", "name", "version")},
            {"file": "animama-landing-1.2.3.tar.gz", "kind": "site", "name": SITE, "version": "1.2.3"},
        )
        archive = self.stage / record["file"]
        site = verify_site(archive, "a" * 40, "1.2.3", source_tree="b" * 40)
        self.assertEqual({f["path"] for f in site["files"]}, set(SITE_FILES) | {self.long})
        self.assertEqual(site["headers_sha256"], sha(SITE_FILES["_headers"]))
        with tarfile.open(archive) as tar:
            self.assertTrue(all(m.mtime == 1_700_000_000 and m.mode == 0o644 for m in tar.getmembers()))
        first = archive.read_bytes()
        archive.unlink()
        build.pack_site(self.built, self.stage, self.source, "1.2.3")
        self.assertEqual(archive.read_bytes(), first)

    def test_pack_rejects_linked_unsafe_or_incomplete_output(self):
        (self.built / "linked.js").symlink_to(self.built / "index.html")
        with self.assertRaisesRegex(ValueError, "Linked"):
            build.pack_site(self.built, self.stage, self.source, "1.2.3")
        (self.built / "linked.js").unlink()
        (self.built / "assets/index-Bx1.js.map").write_bytes(b"{}")
        with self.assertRaisesRegex(ValueError, "Unreviewed|source map"):
            build.pack_site(self.built, self.stage, self.source, "1.2.3")
        (self.built / "assets/index-Bx1.js.map").unlink()
        (self.built / "_headers").unlink()
        with self.assertRaisesRegex(ValueError, "_headers"):
            build.pack_site(self.built, self.stage, self.source, "1.2.3")

    def test_only_application_sources_with_the_landing_build_emit_a_site(self):
        root = self.stage / "source"
        self.assertFalse(build.builds_site(root))
        (root / "src/frontend/web/scripts").mkdir(parents=True)
        (root / "src/frontend/web/scripts/landing-build.mjs").write_text("// fixture\n")
        self.assertFalse(build.builds_site(root))  # A site needs the application beside it.
        (root / "src/frontend/scripts").mkdir(parents=True)
        (root / "src/frontend/scripts/hosted-build-resources.mjs").write_text("// fixture\n")
        self.assertTrue(build.builds_site(root))


if __name__ == "__main__":
    unittest.main()
