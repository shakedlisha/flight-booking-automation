from __future__ import annotations

import logging
from dataclasses import dataclass

import jwt
from fastapi import HTTPException, Request
from jwt import PyJWKClient, PyJWTError

logger = logging.getLogger(__name__)

# Algorithms commonly used by IdPs for access tokens.
_JWT_ALGORITHMS = ("RS256", "RS384", "RS512", "ES256", "ES384", "ES512")


@dataclass(frozen=True, slots=True)
class JwtAuthConfig:
    jwks_url: str
    audience: str
    issuer: str
    required_scope: str | None = None
    leeway_seconds: int = 60


def _parse_bearer_token(request: Request) -> str:
    header = request.headers.get("authorization") or ""
    parts = header.split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(
            status_code=401,
            detail={"error": "unauthorized"},
            headers={"WWW-Authenticate": 'Bearer realm="extract"'},
        )
    token = parts[1].strip()
    if not token:
        raise HTTPException(
            status_code=401,
            detail={"error": "unauthorized"},
            headers={"WWW-Authenticate": 'Bearer realm="extract"'},
        )
    return token


def _collect_scopes(payload: dict) -> set[str]:
    scopes: set[str] = set()
    scp = payload.get("scp")
    if isinstance(scp, str):
        scopes.update(scp.split())
    elif isinstance(scp, list):
        for x in scp:
            if isinstance(x, str):
                scopes.update(x.split())
    scope = payload.get("scope")
    if isinstance(scope, str):
        scopes.update(scope.split())
    perms = payload.get("permissions")
    if isinstance(perms, list):
        for x in perms:
            if isinstance(x, str):
                scopes.add(x)
    return scopes


def _scope_ok(payload: dict, required: str | None) -> bool:
    if not required or not required.strip():
        return True
    need = required.strip()
    return need in _collect_scopes(payload)


def verify_jwt_bearer(request: Request, config: JwtAuthConfig, jwks_client: PyJWKClient) -> None:
    """Validate Authorization Bearer JWT (sync; call via asyncio.to_thread from async routes)."""
    token = _parse_bearer_token(request)
    try:
        signing_key = jwks_client.get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=list(_JWT_ALGORITHMS),
            audience=config.audience,
            issuer=config.issuer,
            leeway=config.leeway_seconds,
            options={
                "require": ["exp", "iss", "aud"],
                "verify_aud": True,
            },
        )
    except jwt.ExpiredSignatureError:
        logger.info("jwt_auth_failed code=jwt_expired")
        raise HTTPException(
            status_code=401,
            detail={"error": "unauthorized", "code": "jwt_expired"},
            headers={"WWW-Authenticate": 'Bearer realm="extract"'},
        ) from None
    except jwt.InvalidAudienceError:
        logger.info("jwt_auth_failed code=jwt_invalid_audience")
        raise HTTPException(
            status_code=401,
            detail={"error": "unauthorized", "code": "jwt_invalid_audience"},
            headers={"WWW-Authenticate": 'Bearer realm="extract"'},
        ) from None
    except jwt.InvalidIssuerError:
        logger.info("jwt_auth_failed code=jwt_invalid_issuer")
        raise HTTPException(
            status_code=401,
            detail={"error": "unauthorized", "code": "jwt_invalid_issuer"},
            headers={"WWW-Authenticate": 'Bearer realm="extract"'},
        ) from None
    except PyJWTError:
        logger.info("jwt_auth_failed code=jwt_invalid_token")
        raise HTTPException(
            status_code=401,
            detail={"error": "unauthorized", "code": "jwt_invalid_token"},
            headers={"WWW-Authenticate": 'Bearer realm="extract"'},
        ) from None
    except Exception:
        logger.exception("jwt_auth_failed code=jwk_fetch_error")
        raise HTTPException(
            status_code=401,
            detail={"error": "unauthorized", "code": "jwt_jwks_error"},
            headers={"WWW-Authenticate": 'Bearer realm="extract"'},
        ) from None

    if not _scope_ok(payload, config.required_scope):
        logger.info("jwt_auth_failed code=jwt_insufficient_scope")
        raise HTTPException(
            status_code=401,
            detail={"error": "unauthorized", "code": "jwt_insufficient_scope"},
            headers={"WWW-Authenticate": 'Bearer realm="extract"'},
        )


def build_jwks_client(jwks_url: str) -> PyJWKClient:
    """JWKS client with short-lived set cache to limit outbound calls."""
    return PyJWKClient(
        jwks_url,
        cache_jwk_set=True,
        lifespan=300,
        max_cached_keys=16,
    )
