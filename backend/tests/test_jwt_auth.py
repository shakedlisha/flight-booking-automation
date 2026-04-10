from __future__ import annotations

import time
from unittest.mock import MagicMock

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from starlette.requests import Request

from app.jwt_auth import JwtAuthConfig, verify_jwt_bearer


def _request_with_bearer(token: str) -> Request:
    auth = f"Bearer {token}".encode("ascii")
    scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/extract",
        "raw_path": b"/extract",
        "root_path": "",
        "query_string": b"",
        "headers": [(b"authorization", auth)],
        "client": ("testclient", 50000),
        "server": ("test", 80),
        "state": {},
    }
    return Request(scope)


def _rsa_keys():
    priv = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return priv, priv.public_key()


def _encode(
    priv,
    *,
    iss: str = "https://issuer.example",
    aud: str = "my-api",
    exp_offset: int = 600,
    scp: str | None = None,
) -> str:
    now = int(time.time())
    payload: dict = {
        "iss": iss,
        "aud": aud,
        "iat": now,
        "exp": now + exp_offset,
    }
    if scp is not None:
        payload["scp"] = scp
    return jwt.encode(
        payload,
        priv,
        algorithm="RS256",
        headers={"kid": "test-kid"},
    )


def test_verify_jwt_bearer_accepts_valid_token() -> None:
    priv, pub = _rsa_keys()
    token = _encode(priv)
    mock_client = MagicMock()
    mock_client.get_signing_key_from_jwt.return_value = MagicMock(key=pub)
    config = JwtAuthConfig(
        jwks_url="https://issuer.example/jwks",
        audience="my-api",
        issuer="https://issuer.example",
        required_scope=None,
        leeway_seconds=60,
    )
    request = _request_with_bearer(token)
    verify_jwt_bearer(request, config, mock_client)
    mock_client.get_signing_key_from_jwt.assert_called_once()


def test_verify_jwt_bearer_rejects_expired() -> None:
    priv, pub = _rsa_keys()
    token = _encode(priv, exp_offset=-120)
    mock_client = MagicMock()
    mock_client.get_signing_key_from_jwt.return_value = MagicMock(key=pub)
    config = JwtAuthConfig(
        jwks_url="https://issuer.example/jwks",
        audience="my-api",
        issuer="https://issuer.example",
        leeway_seconds=0,
    )
    request = _request_with_bearer(token)
    with pytest.raises(HTTPException) as exc_info:
        verify_jwt_bearer(request, config, mock_client)
    assert exc_info.value.status_code == 401
    assert exc_info.value.detail["code"] == "jwt_expired"


def test_verify_jwt_bearer_rejects_wrong_audience() -> None:
    priv, pub = _rsa_keys()
    token = _encode(priv, aud="other-api")
    mock_client = MagicMock()
    mock_client.get_signing_key_from_jwt.return_value = MagicMock(key=pub)
    config = JwtAuthConfig(
        jwks_url="https://issuer.example/jwks",
        audience="my-api",
        issuer="https://issuer.example",
    )
    request = _request_with_bearer(token)
    with pytest.raises(HTTPException) as exc_info:
        verify_jwt_bearer(request, config, mock_client)
    assert exc_info.value.status_code == 401
    assert exc_info.value.detail["code"] == "jwt_invalid_audience"


def test_verify_jwt_bearer_rejects_missing_scope() -> None:
    priv, pub = _rsa_keys()
    token = _encode(priv, scp="openid profile")
    mock_client = MagicMock()
    mock_client.get_signing_key_from_jwt.return_value = MagicMock(key=pub)
    config = JwtAuthConfig(
        jwks_url="https://issuer.example/jwks",
        audience="my-api",
        issuer="https://issuer.example",
        required_scope="extract",
    )
    request = _request_with_bearer(token)
    with pytest.raises(HTTPException) as exc_info:
        verify_jwt_bearer(request, config, mock_client)
    assert exc_info.value.status_code == 401
    assert exc_info.value.detail["code"] == "jwt_insufficient_scope"


def test_verify_jwt_bearer_accepts_required_scope() -> None:
    priv, pub = _rsa_keys()
    token = _encode(priv, scp="openid extract")
    mock_client = MagicMock()
    mock_client.get_signing_key_from_jwt.return_value = MagicMock(key=pub)
    config = JwtAuthConfig(
        jwks_url="https://issuer.example/jwks",
        audience="my-api",
        issuer="https://issuer.example",
        required_scope="extract",
    )
    request = _request_with_bearer(token)
    verify_jwt_bearer(request, config, mock_client)


def test_verify_jwt_bearer_rejects_missing_authorization() -> None:
    scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/extract",
        "raw_path": b"/extract",
        "root_path": "",
        "query_string": b"",
        "headers": [],
        "client": ("testclient", 50000),
        "server": ("test", 80),
        "state": {},
    }
    request = Request(scope)
    mock_client = MagicMock()
    config = JwtAuthConfig(
        jwks_url="https://issuer.example/jwks",
        audience="my-api",
        issuer="https://issuer.example",
    )
    with pytest.raises(HTTPException) as exc_info:
        verify_jwt_bearer(request, config, mock_client)
    assert exc_info.value.status_code == 401
