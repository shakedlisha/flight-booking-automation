from __future__ import annotations

import logging
from io import BytesIO

from pypdf import PdfReader
from pypdf.errors import PdfReadError

logger = logging.getLogger(__name__)


class PdfExtractError(Exception):
    """Domain error for PDF text extraction; `.code` is a stable API detail code."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def extract_text_from_pdf(
    data: bytes,
    *,
    max_chars: int,
    max_pages: int,
) -> str:
    if not data.startswith(b"%PDF"):
        raise PdfExtractError("pdf_invalid_magic")
    if max_pages < 1:
        raise PdfExtractError("pdf_invalid")

    try:
        reader = PdfReader(BytesIO(data), strict=False)
    except PdfReadError:
        logger.info("pdf_read_failed code=pdf_invalid")
        raise PdfExtractError("pdf_invalid") from None
    except Exception:
        logger.exception("pdf_read_failed code=pdf_invalid")
        raise PdfExtractError("pdf_invalid") from None

    if getattr(reader, "is_encrypted", False):
        logger.info("pdf_encrypted_rejected")
        raise PdfExtractError("pdf_encrypted")

    parts: list[str] = []
    total = 0
    n_pages = min(len(reader.pages), max_pages)
    for i in range(n_pages):
        page = reader.pages[i]
        try:
            chunk = page.extract_text() or ""
        except Exception:
            chunk = ""
        chunk = chunk.strip()
        if not chunk:
            continue
        if total + len(chunk) + 1 > max_chars:
            remaining = max_chars - total - 1
            if remaining > 0:
                parts.append(chunk[:remaining])
            break
        parts.append(chunk)
        total += len(chunk) + 1

    return "\n".join(parts).strip()
