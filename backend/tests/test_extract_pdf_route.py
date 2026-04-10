from __future__ import annotations

from io import BytesIO
from unittest.mock import patch

import pytest
from pypdf import PdfWriter
from reportlab.pdfgen import canvas
from starlette.testclient import TestClient

from app.main import app
from app.models import ExtractResult
from app.pdf_ocr import OcrUnavailableError


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


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


def test_extract_pdf_400_when_no_text(client: TestClient) -> None:
    import app.main as main

    main.settings.gemini_api_key = "test-key"
    files = {"file": ("empty.pdf", _blank_pdf_bytes(), "application/pdf")}
    r = client.post("/extract_pdf", files=files)
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "pdf_no_text"


@patch("app.main.extract_with_gemini")
def test_extract_pdf_200_calls_gemini(mock_g, client: TestClient) -> None:
    import app.main as main

    main.settings.gemini_api_key = "test-key"
    mock_g.return_value = ExtractResult(pnr="ABC123")

    pdf = _pdf_with_text("Record locator ABC123")
    files = {"file": ("b.pdf", pdf, "application/pdf")}
    r = client.post("/extract_pdf", files=files)
    assert r.status_code == 200
    body = r.json()
    assert body.get("pnr") == "ABC123"
    mock_g.assert_called_once()
    call_kw = mock_g.call_args.kwargs
    assert "ABC123" in call_kw["raw_text"] or "Record" in call_kw["raw_text"]


@patch("app.main.ocr_pdf_bytes", return_value="PNR OCR123 from scan")
@patch("app.main.extract_with_gemini")
def test_extract_pdf_ocr_fallback_when_text_layer_empty(
    mock_g,
    mock_ocr,
    client: TestClient,
) -> None:
    import app.main as main

    prev_ocr = main.settings.pdf_ocr_enabled
    main.settings.gemini_api_key = "test-key"
    main.settings.pdf_ocr_enabled = True
    try:
        mock_g.return_value = ExtractResult(pnr="OCR123")
        files = {"file": ("scan.pdf", _blank_pdf_bytes(), "application/pdf")}
        r = client.post("/extract_pdf", files=files)
        assert r.status_code == 200
        mock_ocr.assert_called_once()
        mock_g.assert_called_once()
    finally:
        main.settings.pdf_ocr_enabled = prev_ocr


@patch("app.main.ocr_pdf_bytes", side_effect=OcrUnavailableError("tesseract"))
@patch("app.main.extract_with_gemini")
def test_extract_pdf_503_when_ocr_unavailable(
    _mock_g,
    _mock_ocr,
    client: TestClient,
) -> None:
    import app.main as main

    prev_ocr = main.settings.pdf_ocr_enabled
    main.settings.gemini_api_key = "test-key"
    main.settings.pdf_ocr_enabled = True
    try:
        files = {"file": ("scan.pdf", _blank_pdf_bytes(), "application/pdf")}
        r = client.post("/extract_pdf", files=files)
        assert r.status_code == 503
        assert r.json()["detail"]["code"] == "ocr_unavailable"
    finally:
        main.settings.pdf_ocr_enabled = prev_ocr
