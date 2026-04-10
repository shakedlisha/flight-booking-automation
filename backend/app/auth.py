from __future__ import annotations

import hmac
from collections.abc import Awaitable, Callable

from fastapi import HTTPException, Request


def build_bearer_checker(
    tokens: list[str],
) -> Callable[[Request], Awaitable[None]]:
    """If tokens is empty, auth is disabled. Otherwise require Authorization: Bearer <token>."""

    if not tokens:

        async def _open(_request: Request) -> None:
            return None

        return _open

    async def _require(request: Request) -> None:
        header = request.headers.get("authorization") or ""
        parts = header.split(None, 1)
        if len(parts) != 2 or parts[0].lower() != "bearer":
            raise HTTPException(
                status_code=401,
                detail={"error": "unauthorized"},
                headers={"WWW-Authenticate": 'Bearer realm="extract"'},
            )
        provided = parts[1].strip()
        for expected in tokens:
            if len(provided) != len(expected):
                continue
            if hmac.compare_digest(
                provided.encode("utf-8"),
                expected.encode("utf-8"),
            ):
                return
        raise HTTPException(
            status_code=401,
            detail={"error": "unauthorized"},
            headers={"WWW-Authenticate": 'Bearer realm="extract"'},
        )

    return _require
