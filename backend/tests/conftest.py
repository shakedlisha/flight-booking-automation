"""Pytest loads this before test modules — clear JWT env so local .env does not force JWT auth on tests."""

from __future__ import annotations

import os

os.environ["JWT_JWKS_URL"] = ""
os.environ["JWT_AUDIENCE"] = ""
os.environ["JWT_ISSUER"] = ""
os.environ["EXTRACT_BEARER_TOKENS"] = ""
