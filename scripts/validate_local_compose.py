#!/usr/bin/env python3
"""Enforce the local gateway and opt-in loopback administration boundary."""

from __future__ import annotations

import argparse
import errno
import ipaddress
import json
import socket
import subprocess
import sys
from collections.abc import Mapping
from typing import Any
from urllib.parse import urlsplit

TOOL_TARGETS = {"pgadmin": 80, "dozzle": 8080}
PUBLISHED_TARGETS = {"web-server": 3000, **TOOL_TARGETS}


class ComposeBoundaryError(ValueError):
    """The rendered local Compose graph violates its publication contract."""


def _environment(service: Mapping[str, Any]) -> dict[str, str]:
    raw = service.get("environment") or {}
    if isinstance(raw, Mapping):
        return {str(name): str(value) for name, value in raw.items()}
    result: dict[str, str] = {}
    for item in raw:
        name, _, value = str(item).partition("=")
        result[name] = value
    return result


def _is_loopback_hostname(hostname: str) -> bool:
    normalized = hostname.rstrip(".").lower()
    if normalized == "localhost" or normalized.endswith(".localhost"):
        return True
    try:
        return ipaddress.ip_address(normalized).is_loopback
    except ValueError:
        return False


def _validate_public_origin(value: str) -> None:
    origin = urlsplit(value)
    if (
        origin.scheme not in {"http", "https"}
        or not origin.hostname
        or origin.username
        or origin.password
        or origin.path not in {"", "/"}
        or origin.query
        or origin.fragment
    ):
        raise ComposeBoundaryError("ANIMAMA_PUBLIC_ORIGIN must be one bare HTTP(S) origin")
    if origin.scheme == "http" and not _is_loopback_hostname(origin.hostname):
        raise ComposeBoundaryError("a non-loopback ANIMAMA_PUBLIC_ORIGIN must use TLS at the operator boundary")


def _validate_publication(name: str, service: Mapping[str, Any]) -> int:
    """Return one validated host port; never accept implicit or broad bindings."""

    ports = service.get("ports") or []
    if len(ports) != 1 or not isinstance(ports[0], Mapping):
        raise ComposeBoundaryError(f"{name} must publish exactly one structured port")
    publication = ports[0]
    if publication.get("host_ip") != "127.0.0.1":
        raise ComposeBoundaryError(f"{name} host publication must be pinned to 127.0.0.1")
    if publication.get("target") != PUBLISHED_TARGETS[name] or publication.get("protocol", "tcp") != "tcp":
        raise ComposeBoundaryError(f"{name} may publish only its TCP target port {PUBLISHED_TARGETS[name]}")
    published = str(publication.get("published", ""))
    if not published.isascii() or not published.isdigit() or not 1 <= int(published) <= 65535:
        raise ComposeBoundaryError(f"{name} must publish one host port from 1 to 65535")
    return int(published)


def validate_local_compose_document(document: Mapping[str, Any]) -> None:
    """Validate a fully rendered local desktop/self-host Compose document."""

    services = document.get("services")
    if not isinstance(services, Mapping):
        raise ComposeBoundaryError("rendered Compose document has no services")

    required_services = {"web-server", "animama-server", "web", "postgres"}
    missing = required_services - set(services)
    if missing:
        raise ComposeBoundaryError(f"local Compose is missing required services: {', '.join(sorted(missing))}")

    published_ports: set[int] = set()
    for name, raw_service in services.items():
        if not isinstance(raw_service, Mapping):
            raise ComposeBoundaryError(f"service {name} has invalid configuration")
        if raw_service.get("network_mode") == "host":
            raise ComposeBoundaryError(f"service {name} must not use host networking")
        ports = raw_service.get("ports") or []
        if name not in PUBLISHED_TARGETS and ports:
            raise ComposeBoundaryError(f"service {name} must remain private and has a published port")
        if name in TOOL_TARGETS and raw_service.get("profiles") != ["dev-tools"]:
            raise ComposeBoundaryError(f"{name} must belong only to the dev-tools profile")
        if name in PUBLISHED_TARGETS:
            published_port = _validate_publication(name, raw_service)
            if published_port in published_ports:
                raise ComposeBoundaryError(f"duplicate loopback host port {published_port}")
            published_ports.add(published_port)

    obsolete_environment = {
        "ANIMAMA_DEPLOYMENT_TRUST_MODE",
        "ANIMAMA_INFRASTRUCTURE_BIND_HOST",
        "ANIMAMA_JWKS_URL",
        "ANIMAMA_PUBLISHED_BIND_HOST",
        "BETTER_AUTH_SECRET",
        "BETTER_AUTH_URL",
        "SEED_TOKEN",
        "SERVICE_API_KEY",
    }
    for name, raw_service in services.items():
        environment = _environment(raw_service)
        obsolete = sorted(obsolete_environment.intersection(environment))
        if obsolete:
            raise ComposeBoundaryError(f"service {name} contains obsolete local-auth settings: {', '.join(obsolete)}")

    gateway_environment = _environment(services["web-server"])
    public_origin = gateway_environment.get("ANIMAMA_PUBLIC_ORIGIN", "")
    _validate_public_origin(public_origin)
    expected_internal_origins = {
        "ANIMAMA_PRIVATE_API_ORIGIN": "http://animama-server:8000",
        "ANIMAMA_PRIVATE_VITE_ORIGIN": "http://web:5173",
    }
    for variable, expected in expected_internal_origins.items():
        if gateway_environment.get(variable) != expected:
            raise ComposeBoundaryError(f"{variable} must remain the fixed private Compose origin {expected}")

    web_environment = _environment(services["web"])
    for variable in ("VITE_WEB_BASE_URL", "VITE_FRONTEND_SERVER_BASE_URL"):
        if web_environment.get(variable) != public_origin:
            raise ComposeBoundaryError(f"{variable} must use the canonical Hono public origin")


def check_available_ports(document: Mapping[str, Any]) -> None:
    """Reject foreign listeners before reset stops containers; allow this project's current ports."""

    project = document.get("name")
    if not isinstance(project, str) or not project:
        raise ComposeBoundaryError("rendered Compose document has no project name")
    result = subprocess.run(
        ["docker", "compose", "-p", project, "--profile", "*", "ps", "--format", "json"],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode:
        raise ComposeBoundaryError("cannot inspect this Compose project's current ports; check Docker availability")
    # Compose versions emit either a JSON array or newline-delimited objects.
    output = result.stdout.strip()
    containers = json.loads(output) if output.startswith("[") else [json.loads(line) for line in output.splitlines()]
    owned_ports = {
        int(publisher["PublishedPort"])
        for container in containers
        if container.get("Project") == project and container.get("State") == "running"
        for publisher in container.get("Publishers") or []
        if publisher.get("PublishedPort")
        and publisher.get("Protocol") == "tcp"
        and publisher.get("URL") in {"127.0.0.1", "0.0.0.0"}
    }
    for name, service in document["services"].items():
        if name not in PUBLISHED_TARGETS:
            continue
        port = _validate_publication(name, service)
        if port in owned_ports:
            continue
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
                probe.bind(("127.0.0.1", port))
        except OSError as exc:
            if exc.errno == errno.EADDRINUSE:
                raise ComposeBoundaryError(
                    f"{name} localhost port {port} is occupied outside project {project}; "
                    "choose another port or stop its owner explicitly"
                ) from exc
            raise ComposeBoundaryError(f"cannot check {name} localhost port {port}: {exc.strerror}") from exc


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check-ports", action="store_true", help="check selected ports before stopping containers")
    parser.add_argument("--print-tool-ports", action="store_true", help="emit only selected pgAdmin/Dozzle ports")
    args = parser.parse_args()
    try:
        document = json.load(sys.stdin)
        validate_local_compose_document(document)
        if args.check_ports:
            check_available_ports(document)
        if args.print_tool_ports:
            services = document["services"]
            print(
                " ".join(
                    str(_validate_publication(name, services[name])) if name in services else "-"
                    for name in TOOL_TARGETS
                )
            )
    except (ComposeBoundaryError, json.JSONDecodeError, TypeError, ValueError, OSError) as exc:
        print(f"Local Compose boundary check failed: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":  # pragma: no cover - command wrapper
    raise SystemExit(main())
