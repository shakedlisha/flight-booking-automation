from __future__ import annotations

import asyncio
import logging
import os

from pathlib import Path

from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic_settings import BaseSettings, SettingsConfigDict
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.auth import build_bearer_checker
from app.gemini_extract import extract_with_gemini
from app.jwt_auth import JwtAuthConfig, build_jwks_client, verify_jwt_bearer
from app.models import ExtractRequest, ExtractResult
from app.pdf_ocr import OcrUnavailableError, ocr_pdf_bytes
from app.pdf_text import PdfExtractError, extract_text_from_pdf

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.0-flash"
    cors_origins: str = ""
    rate_limit_per_minute: int = 60
    # Comma-separated. If non-empty, POST /extract requires Authorization: Bearer <one token>.
    extract_bearer_tokens: str = ""
    jwt_jwks_url: str = ""
    jwt_audience: str = ""
    jwt_issuer: str = ""
    jwt_required_scope: str = ""
    jwt_leeway_seconds: int = 60
    pdf_max_bytes: int = 5_000_000
    pdf_max_pages: int = 40
    pdf_ocr_enabled: bool = False
    ocr_lang: str = "eng"


def _parse_cors_origins(raw: str) -> list[str]:
    if not raw.strip():
        return [
            "http://127.0.0.1:3000",
            "http://localhost:3000",
        ]
    return [o.strip() for o in raw.split(",") if o.strip()]


settings = Settings()
_extract_rate = f"{max(1, settings.rate_limit_per_minute)}/minute"
_bearer_tokens = [
    t.strip() for t in settings.extract_bearer_tokens.split(",") if t.strip()
]
_extract_bearer = build_bearer_checker(_bearer_tokens)


def _jwt_fully_configured() -> bool:
    return bool(
        settings.jwt_jwks_url.strip()
        and settings.jwt_audience.strip()
        and settings.jwt_issuer.strip()
    )


_jwt_mode = _jwt_fully_configured()
_jwks_client = (
    build_jwks_client(settings.jwt_jwks_url.strip()) if _jwt_mode else None
)
_jwt_config = (
    JwtAuthConfig(
        jwks_url=settings.jwt_jwks_url.strip(),
        audience=settings.jwt_audience.strip(),
        issuer=settings.jwt_issuer.strip(),
        required_scope=(settings.jwt_required_scope.strip() or None),
        leeway_seconds=max(0, settings.jwt_leeway_seconds),
    )
    if _jwt_mode
    else None
)

if _jwt_mode and _bearer_tokens:
    logger.warning(
        "JWT_JWKS_URL/JWT_AUDIENCE/JWT_ISSUER are set: EXTRACT_BEARER_TOKENS is ignored for POST /extract and POST /extract_pdf",
    )


async def extract_auth(request: Request) -> None:
    if _jwt_mode and _jwt_config is not None and _jwks_client is not None:
        await asyncio.to_thread(
            verify_jwt_bearer,
            request,
            _jwt_config,
            _jwks_client,
        )
        return
    await _extract_bearer(request)


limiter = Limiter(key_func=get_remote_address)

app = FastAPI(title="Booking extract API", version="0.1.0")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_parse_cors_origins(settings.cors_origins),
    allow_credentials=False,
    allow_methods=["POST", "OPTIONS", "GET"],
    allow_headers=["*"],
    expose_headers=["*"],
)

_static = Path(__file__).resolve().parent.parent / "static"
if _static.is_dir():
    app.mount(
        "/demo",
        StaticFiles(directory=str(_static), html=True),
        name="demo",
    )


@app.middleware("http")
async def no_body_logging(request: Request, call_next):
    return await call_next(request)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/extract", response_model=ExtractResult)
@limiter.limit(_extract_rate)
async def extract(
    request: Request,
    body: ExtractRequest,
    _: None = Depends(extract_auth),
) -> ExtractResult:
    if not settings.gemini_api_key:
        logger.error("missing_gemini_api_key")
        raise HTTPException(status_code=503, detail="service_misconfigured")

    try:
        result = await asyncio.to_thread(
            extract_with_gemini,
            api_key=settings.gemini_api_key,
            model=settings.gemini_model,
            raw_text=body.raw_text,
        )
    except RuntimeError as e:
        code = str(e)
        logger.error("extract_failed code=%s", code)
        raise HTTPException(
            status_code=502,
            detail={"error": "Extraction failed. Retry or shorten input.", "code": code},
        ) from e

    return result


_RAW_MAX = 120_000


@app.post("/extract_pdf", response_model=ExtractResult)
@limiter.limit(_extract_rate)
async def extract_pdf(
    request: Request,
    file: UploadFile = File(...),
    _: None = Depends(extract_auth),
) -> ExtractResult:
    if not settings.gemini_api_key:
        logger.error("missing_gemini_api_key")
        raise HTTPException(status_code=503, detail="service_misconfigured")

    content = await file.read()
    if len(content) > settings.pdf_max_bytes:
        raise HTTPException(
            status_code=413,
            detail={"error": "PDF too large", "code": "pdf_too_large"},
        )

    try:
        raw_text = await asyncio.to_thread(
            extract_text_from_pdf,
            content,
            max_chars=_RAW_MAX,
            max_pages=settings.pdf_max_pages,
        )
    except PdfExtractError as e:
        logger.info("extract_pdf_failed code=%s", e.code)
        messages = {
            "pdf_invalid_magic": "Not a PDF file",
            "pdf_invalid": "Could not read PDF",
            "pdf_encrypted": "Password-protected PDFs are not supported",
        }
        raise HTTPException(
            status_code=400,
            detail={"error": messages.get(e.code, "PDF error"), "code": e.code},
        ) from None

    if not raw_text.strip():
        if not settings.pdf_ocr_enabled:
            logger.info("extract_pdf_failed code=pdf_no_text")
            raise HTTPException(
                status_code=400,
                detail={
                    "error": (
                        "No extractable text in PDF. Set PDF_OCR_ENABLED=true for scanned "
                        "documents (requires Poppler and Tesseract on the server)."
                    ),
                    "code": "pdf_no_text",
                },
            )
        try:
            raw_text = await asyncio.to_thread(
                ocr_pdf_bytes,
                content,
                max_pages=settings.pdf_max_pages,
                max_chars=_RAW_MAX,
                lang=settings.ocr_lang.strip() or "eng",
            )
        except OcrUnavailableError:
            logger.error("extract_pdf_ocr_unavailable")
            raise HTTPException(
                status_code=503,
                detail={
                    "error": (
                        "OCR is not available. Install Poppler and Tesseract, or use the "
                        "Docker image that includes them."
                    ),
                    "code": "ocr_unavailable",
                },
            ) from None

        if not raw_text.strip():
            logger.info("extract_pdf_failed code=pdf_no_text_after_ocr")
            raise HTTPException(
                status_code=400,
                detail={
                    "error": "No text could be read from the PDF (OCR produced no text).",
                    "code": "pdf_no_text",
                },
            )

    try:
        result = await asyncio.to_thread(
            extract_with_gemini,
            api_key=settings.gemini_api_key,
            model=settings.gemini_model,
            raw_text=raw_text,
        )
    except RuntimeError as e:
        code = str(e)
        logger.error("extract_pdf_gemini_failed code=%s", code)
        raise HTTPException(
            status_code=502,
            detail={"error": "Extraction failed. Retry or shorten input.", "code": code},
        ) from e

    return result
