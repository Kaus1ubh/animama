"""A labelled byte-change fixture, never a released or clean-source predecessor."""

from __future__ import annotations

import copy
import gzip
import shutil
import tarfile
from pathlib import Path

from application import APP, TEMPLATE_BASE, TEXT_SUFFIXES, unpack_application, verify_application
from package_set import canonical, file_sha, sha


def previous_resource_fixture(directory: Path, output: Path, contracts: list) -> Path:
    """Retain executable app behavior but change one worker comment and every bound URL.

    This exercises the immutable selection mechanism with two verified byte sets.
    It does not establish compatibility between two actual source revisions.
    """
    import json

    app = json.loads((directory / "app-manifest.json").read_bytes())
    old_prefix = next(
        entry["path"].split("resource-manifests/")[0]
        for entry in app["files"]
        if entry["path"].endswith("/resource-manifests/browser-runtime.json")
    )
    if not any(entry["path"] == old_prefix + "tts/workers/inference-worker.js" for entry in app["files"]):
        raise ValueError("Controlled selection requires the actual retained inference worker")
    template, texts = {}, {}
    for entry in app["files"]:
        relative = entry["path"].removeprefix(old_prefix)
        file = directory / entry["path"]
        if file.suffix in TEXT_SUFFIXES:
            data = file.read_bytes().replace(("/" + old_prefix).encode(), TEMPLATE_BASE.encode())
            if relative == "tts/workers/inference-worker.js":
                data += b"\n// Controlled previous-resource fixture; not a release.\n"
            texts[relative] = data
            template[relative] = {"sha256": sha(data), "size": len(data)}
        else:
            template[relative] = {"sha256": file_sha(file), "size": file.stat().st_size}
    digest = sha(canonical(template))
    new_prefix = "_animama/static/" + digest + "/"
    output.mkdir(parents=True, exist_ok=False)
    staging = output / "staging"
    staging.mkdir()
    changed = copy.deepcopy(app)
    for entry in changed["files"]:
        relative = entry["path"].removeprefix(old_prefix)
        name = "index.html" if relative == "index.html" else new_prefix + relative
        destination = staging / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        if relative in texts:
            destination.write_bytes(texts[relative].replace(TEMPLATE_BASE.encode(), ("/" + new_prefix).encode()))
        else:
            shutil.copyfile(directory / entry["path"], destination)
        entry.update(path=name, sha256=file_sha(destination), size=destination.stat().st_size)
    changed["notices"] = [name.replace(old_prefix, new_prefix, 1) for name in changed["notices"]]
    for resource in changed["lazy_resources"]:
        resource["manifest"] = resource["manifest"].replace(old_prefix, new_prefix, 1)
        resource["notices"] = [name.replace(old_prefix, new_prefix, 1) for name in resource["notices"]]
    shutil.copytree(directory / "catalog-seed", staging / "catalog-seed")
    (staging / "app-manifest.json").write_bytes(canonical(changed))
    archive = output / "controlled-previous-app.tar.gz"
    with archive.open("wb") as stream, gzip.GzipFile(filename="", mode="wb", fileobj=stream, mtime=0) as zipped:
        with tarfile.open(fileobj=zipped, mode="w", format=tarfile.PAX_FORMAT) as tar:
            for file in sorted(staging.rglob("*")):
                if not file.is_file():
                    continue
                info = tarfile.TarInfo(APP + "/" + file.relative_to(staging).as_posix())
                info.mode, info.mtime, info.size = 0o644, 0, file.stat().st_size
                with file.open("rb") as payload:
                    tar.addfile(info, payload)
    # Apply the production verifier to the fixture before any browser selects it.
    verify_application(archive, app["source_commit"], app["app_version"], contracts)
    selected = output / "application"
    unpack_application(archive, selected, app["source_commit"], app["app_version"], contracts)
    shutil.rmtree(staging)
    return selected
