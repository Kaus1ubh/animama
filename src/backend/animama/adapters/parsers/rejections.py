"""Reasons shown with an upload the parsers refuse, and the errors that carry them.

Every reason is a short English sentence the owner sees with the failed file.
A refusal is permanent: the same bytes would fail the same way on a retry.
"""

from __future__ import annotations

from animama.app.ports.user_file_parser_port import UserFileParseRejectedError

ENCRYPTED_DOCUMENT_REASON = "Encrypted or password-protected documents are not supported"
UNSUPPORTED_FORMAT_REASON = "This file type is not supported."
NO_PDF_TEXT_REASON = "This PDF has no selectable text; it may be scanned."
XML_ENTITIES_REASON = "XML that declares entities or loads external content is not supported."


def extension_mismatch_reason(extension: str) -> str:
    """The reason for content of another kind than its extension names, such as a ``.docx`` that is not a package."""

    return f"The file does not match its {extension} extension."


def damaged_document_reason(extension: str) -> str:
    """The reason for a file of the right kind whose structure cannot be read, such as a truncated download."""

    return f"The {extension} file is damaged or incomplete."


def missing_documents_extra_reason(extension: str) -> str:
    """The reason for a format whose parser library this installation lacks."""

    return f"This installation cannot read {extension} files: the documents extra is not installed."


def rejected(reason: str, error_type: str) -> UserFileParseRejectedError:
    """A permanent refusal; ``error_type`` names the failure in logs, never the file's content."""

    return UserFileParseRejectedError(reason, error_type=error_type)


def encrypted_document() -> UserFileParseRejectedError:
    return rejected(ENCRYPTED_DOCUMENT_REASON, "EncryptedDocument")


def extension_mismatch(extension: str) -> UserFileParseRejectedError:
    return rejected(extension_mismatch_reason(extension), "ExtensionMismatch")


def damaged_document(extension: str) -> UserFileParseRejectedError:
    return rejected(damaged_document_reason(extension), "DamagedDocument")


def xml_entities() -> UserFileParseRejectedError:
    return rejected(XML_ENTITIES_REASON, "XmlEntitiesForbidden")


def missing_documents_extra(extension: str) -> UserFileParseRejectedError:
    return rejected(missing_documents_extra_reason(extension), "DocumentsExtraMissing")


def is_entity_expansion_error(error: BaseException) -> bool:
    """Whether an XML parser stopped at an entity, as libxml2 does at its expansion limit.

    The Office libraries parse with lxml without resolving entities, so a
    billion-laughs part ends in libxml2's amplification error rather than in
    expanded text. Only the error class and message are inspected.
    """

    return isinstance(error, SyntaxError) and "entit" in str(error).lower()


__all__ = [
    "ENCRYPTED_DOCUMENT_REASON",
    "NO_PDF_TEXT_REASON",
    "UNSUPPORTED_FORMAT_REASON",
    "XML_ENTITIES_REASON",
    "damaged_document",
    "damaged_document_reason",
    "encrypted_document",
    "extension_mismatch",
    "extension_mismatch_reason",
    "is_entity_expansion_error",
    "missing_documents_extra",
    "missing_documents_extra_reason",
    "rejected",
    "xml_entities",
]
