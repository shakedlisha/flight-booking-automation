from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


class OcrUnavailableError(Exception):
    """Poppler or Tesseract missing, or OCR stack failed to initialize."""

    def __init__(self, reason: str = "unknown") -> None:
        super().__init__(reason)
        self.reason = reason


def ocr_pdf_bytes(
    data: bytes,
    *,
    max_pages: int,
    max_chars: int,
    lang: str,
) -> str:
    """
    Rasterize PDF pages (Poppler) and OCR with Tesseract.
    Requires poppler-utils and tesseract on PATH (or configured for pytesseract).
    """
    try:
        import pytesseract
        from pdf2image import convert_from_bytes
    except ImportError:
        logger.error("ocr_import_failed")
        raise OcrUnavailableError("import") from None

    if max_pages < 1:
        return ""

    try:
        images = convert_from_bytes(
            data,
            first_page=1,
            last_page=max_pages,
            fmt="png",
        )
    except Exception:
        logger.info("ocr_poppler_failed code=ocr_unavailable")
        raise OcrUnavailableError("poppler") from None

    parts: list[str] = []
    total = 0
    for img in images:
        try:
            chunk = pytesseract.image_to_string(img, lang=lang) or ""
        except pytesseract.TesseractNotFoundError:
            logger.info("ocr_tesseract_missing")
            raise OcrUnavailableError("tesseract") from None
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
