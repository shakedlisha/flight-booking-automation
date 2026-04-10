from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytesseract
import pytest

from app.pdf_ocr import OcrUnavailableError, ocr_pdf_bytes


@patch("pytesseract.image_to_string", side_effect=["Page one text", "Page two more"])
@patch("pdf2image.convert_from_bytes", return_value=[MagicMock(), MagicMock()])
def test_ocr_pdf_bytes_concatenates_pages(mock_conv, _mock_ts) -> None:
    out = ocr_pdf_bytes(
        b"%PDF-1.4 fake",
        max_pages=10,
        max_chars=100,
        lang="eng",
    )
    assert "Page one" in out
    assert "Page two" in out
    mock_conv.assert_called_once()
    call_kw = mock_conv.call_args.kwargs
    assert call_kw["first_page"] == 1
    assert call_kw["last_page"] == 10


@patch("pytesseract.image_to_string", return_value="x" * 50)
@patch("pdf2image.convert_from_bytes", return_value=[MagicMock()])
def test_ocr_pdf_bytes_truncates_to_max_chars(_mock_conv, _mock_ts) -> None:
    out = ocr_pdf_bytes(
        b"%PDF-1.4",
        max_pages=5,
        max_chars=20,
        lang="eng",
    )
    # Matches pdf_text overflow: remaining = max_chars - total - 1 for join budget.
    assert len(out) == 19
    assert out == "x" * 19


@patch(
    "pytesseract.image_to_string",
    side_effect=pytesseract.TesseractNotFoundError(),
)
@patch("pdf2image.convert_from_bytes", return_value=[MagicMock()])
def test_ocr_pdf_bytes_tesseract_missing_raises(_mock_conv, _mock_ts) -> None:
    with pytest.raises(OcrUnavailableError) as ei:
        ocr_pdf_bytes(b"%PDF-1.4", max_pages=1, max_chars=100, lang="eng")
    assert ei.value.reason == "tesseract"


@patch("pdf2image.convert_from_bytes", side_effect=RuntimeError("pdftoppm failed"))
def test_ocr_pdf_bytes_poppler_failure_raises(_mock_conv) -> None:
    with pytest.raises(OcrUnavailableError) as ei:
        ocr_pdf_bytes(b"%PDF-1.4", max_pages=1, max_chars=100, lang="eng")
    assert ei.value.reason == "poppler"
