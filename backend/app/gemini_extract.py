from __future__ import annotations

import json
import logging
from typing import Any

from google import genai
from google.genai import types

from app.models import ExtractResult

logger = logging.getLogger(__name__)

# Inline JSON Schema for Gemini structured output (avoid Pydantic $defs / default quirks).
BOOKING_RESPONSE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "route": {"type": "string", "nullable": True},
        "flightNumber": {"type": "string", "nullable": True},
        "date": {"type": "string", "nullable": True},
        "depArr": {"type": "string", "nullable": True},
        "pnr": {"type": "string", "nullable": True},
        "sPnr": {"type": "string", "nullable": True},
        "flightClass": {"type": "string", "nullable": True},
        "currency": {"type": "string", "nullable": True},
        "price": {"type": "string", "nullable": True},
        "passengers": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "nullable": True},
                    "id": {"type": "string", "nullable": True},
                },
                "required": [],
            },
        },
    },
    "required": [],
}

SYSTEM_INSTRUCTION = """You extract flight booking facts from unstructured text (emails, GDS snippets, PDF paste).
Return only JSON matching the schema. Use null for unknown fields.
- route: airport or city pair like TLV/JFK or TLV-JFK when clearly a route; otherwise null.
- flightNumber: airline flight number if present (e.g. LY001, AA100).
- date: travel date as DD.MM.YYYY when you can infer a single main flight date; otherwise null.
- depArr: departure/arrival time pair as "HH:MM/HH:MM" (e.g. "08:40/11:45") when times are present; otherwise null.
- pnr: primary record locator / PNR if present.
- sPnr: supplier PNR or secondary PNR only when a second PNR is explicitly labelled differently; otherwise null.
- flightClass: cabin/class text if present (economy, business, Y, J, etc.).
- currency: 3-letter ISO code (USD, EUR, ILS) only when explicitly stated in the text; otherwise null.
- price: total or per-person fare as a plain number string (e.g. '450', '1250.00') when a numeric amount is clearly a fare; otherwise null.
- passengers: list of {name, id} for each traveler when names or IDs appear; id is national ID or document number if present, else null.
Do not invent data. If multiple dates exist, pick the primary outbound flight date or null if ambiguous."""


def extract_with_gemini(
    *,
    api_key: str,
    model: str,
    raw_text: str,
) -> ExtractResult:
    client = genai.Client(api_key=api_key)
    config = types.GenerateContentConfig(
        system_instruction=SYSTEM_INSTRUCTION,
        response_mime_type="application/json",
        response_schema=BOOKING_RESPONSE_SCHEMA,
        temperature=0.2,
    )
    user_part = (
        "Extract booking fields from the following text.\n\n---\n"
        f"{raw_text}\n---"
    )
    try:
        response = client.models.generate_content(
            model=model,
            contents=user_part,
            config=config,
        )
    except Exception:
        logger.exception("gemini_request_failed")
        raise RuntimeError("upstream_model_error") from None

    text = (response.text or "").strip()
    if not text:
        logger.error("gemini_empty_response")
        raise RuntimeError("empty_model_response")

    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        logger.error("gemini_invalid_json")
        raise RuntimeError("invalid_model_json") from e

    try:
        return ExtractResult.model_validate(data)
    except Exception:
        logger.error("gemini_json_validate_failed")
        raise RuntimeError("model_json_shape_error") from None
