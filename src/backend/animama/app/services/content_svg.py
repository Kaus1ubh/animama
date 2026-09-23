"""Validate self-contained static SVG artwork without rewriting its bytes."""

import re
from pathlib import Path
from xml.etree import ElementTree

from animama.domain.content_catalog import ContentDiagnostic

_SVG_NS = "http://www.w3.org/2000/svg"
_XLINK_NS = "http://www.w3.org/1999/xlink"
_ELEMENTS = frozenset(
    "svg g defs path rect circle ellipse line polyline polygon linearGradient radialGradient "
    "stop clipPath mask use title desc".split()
)
_ATTRIBUTES = frozenset(
    "id viewBox width height x y x1 y1 x2 y2 cx cy r rx ry d points transform "
    "fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin "
    "stroke-miterlimit stroke-dasharray stroke-dashoffset opacity clip-path clip-rule mask "
    "gradientUnits gradientTransform spreadMethod offset stop-color stop-opacity fx fy fr "
    "preserveAspectRatio version href color vector-effect shape-rendering display visibility "
    "maskUnits maskContentUnits clipPathUnits".split()
)
_LOCAL_REFERENCE = re.compile(r"#[A-Za-z_][A-Za-z0-9_.:-]*")
_LOCAL_PAINT = re.compile(r"url\(\s*['\"]?#[A-Za-z_][A-Za-z0-9_.:-]*['\"]?\s*\)")


def validate_svg_file(path: Path) -> tuple[ContentDiagnostic, ...]:
    """Admit flat vector artwork; reject active XML, CSS and external resources.

    UTF-8 decoding and declaration rejection precede XML parsing, so entity
    expansion and external document declarations never reach the parser.
    Attribute allowlisting also excludes event handlers, style and xml:base.
    """
    try:
        if path.stat().st_size > 32 * 1024 * 1024:
            return (ContentDiagnostic("svg_size_limit", "SVG images must be at most 32 MiB"),)
        text = path.read_bytes().decode("utf-8-sig")
        if re.search(r"<!\s*(?:DOCTYPE|ENTITY)|<\?(?!xml\s)", text, re.IGNORECASE):
            raise ValueError("XML declarations and processing instructions are unsupported")
        root = ElementTree.fromstring(text)
        if root.tag != f"{{{_SVG_NS}}}svg":
            raise ValueError("The root must be an SVG element with the SVG namespace")
        for index, element in enumerate(root.iter()):
            if index >= 100_000:
                raise ValueError("SVG contains too many elements")
            if not element.tag.startswith(f"{{{_SVG_NS}}}") or element.tag.split("}")[-1] not in _ELEMENTS:
                raise ValueError("Only static SVG shapes, groups, gradients and local references are supported")
            for key, value in element.attrib.items():
                name = "href" if key == f"{{{_XLINK_NS}}}href" else key
                if name not in _ATTRIBUTES:
                    raise ValueError(f"SVG attribute {name} is unsupported; remove styles and active content")
                if name == "href":
                    if not _LOCAL_REFERENCE.fullmatch(value):
                        raise ValueError("SVG references must target an element in the same image")
                elif "url" in value.lower():
                    if not _LOCAL_PAINT.fullmatch(value):
                        raise ValueError("SVG paint references must target a local gradient, clip or mask")
                if "\\" in value:
                    raise ValueError("Escaped SVG attribute values are unsupported")
    except OSError:
        return (ContentDiagnostic("unreadable_file", "SVG image could not be read"),)
    except (UnicodeError, ElementTree.ParseError, ValueError) as exc:
        return (ContentDiagnostic("invalid_svg", str(exc)),)
    return ()
