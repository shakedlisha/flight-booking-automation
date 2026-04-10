from __future__ import annotations

from io import BytesIO

import pytest
from pypdf import PdfWriter
from reportlab.pdfgen import canvas

from app.pdf_text import PdfExtractError, extract_text_from_pdf


def _blank_pdf_bytes() -> bytes:
    w = PdfWriter()
    w.add_blank_page(width=200, height=200)
    buf = BytesIO()
    w.write(buf)
    return buf.getvalue()


def _pdf_with_text(s: str) -> bytes:
    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=(400, 800))
    c.drawString(72, 720, s)
    c.save()
    return buf.getvalue()


def test_extract_rejects_non_pdf() -> None:
    with pytest.raises(PdfExtractError) as ei:
        extract_text_from_pdf(b"not a pdf", max_chars=1000, max_pages=5)
    assert ei.value.code == "pdf_invalid_magic"


def test_extract_blank_page_yields_empty() -> None:
    text = extract_text_from_pdf(_blank_pdf_bytes(), max_chars=1000, max_pages=5)
    assert text == ""


def test_extract_finds_embedded_text() -> None:
    raw = _pdf_with_text("PNR ABC123 LY001 TLV/JFK")
    text = extract_text_from_pdf(raw, max_chars=120_000, max_pages=40)
    assert "PNR" in text
    assert "ABC123" in text
