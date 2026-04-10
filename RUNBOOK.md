# Runbook — flight booking automation

## Who can call `POST /extract`

- **MVP:** Run the API on a private network, VPN, or behind IP allowlisting so arbitrary internet clients cannot abuse Gemini quota. The Chrome extension is **not** a secret; treat the API as needing network-level protection until tokens are in place.
- **Phase 5 (implemented):** Optional **`EXTRACT_BEARER_TOKENS`** — if non-empty and JWT mode is **off**, the API requires `Authorization: Bearer <static secret>` (constant-time compare). Users store the value in extension **Options** (`chrome.storage.sync`).
- **Phase 6 (implemented):** If **`JWT_JWKS_URL`**, **`JWT_AUDIENCE`**, and **`JWT_ISSUER`** are all set, `POST /extract` accepts **only JWT access tokens** validated via **JWKS** (RS/ES algorithms). Optional **`JWT_REQUIRED_SCOPE`** checks `scp` / `scope` / `permissions`. Use **`JWT_LEEWAY_SECONDS`** for clock skew. **IdP checklist:** HTTPS JWKS URL; access tokens include correct **`aud`** and **`iss`** (exact string match for issuer); optional scope granted; understand JWKS cache (~300s) after key rotation.
- **Extension OAuth (optional):** PKCE **authorization_code** stores `access_token`, and **`refresh_token` + expiry** when the IdP returns them. The service worker calls **`grant_type=refresh_token`** before `/extract`; the popup asks the worker for a fresh token before `/extract_pdf`. Register redirect `https://<extension-id>.chromiumapp.org/oauth2` with your IdP as a public/native client with PKCE. Request offline / refresh behavior via your IdP’s scopes (e.g. OIDC **`offline_access`**). **Auth0 / Azure** may require specific API scopes or `scope` on the refresh body—test against your tenant. Failed refresh (**400/401**) clears OAuth tokens from sync storage.

## Key rotation

- Rotate **`GEMINI_API_KEY`** in the host environment / secret manager. Restart replicas after rotation.
- **JWT mode:** rotate signing keys in your IdP per vendor guidance; allow a few minutes for JWKS cache (~300s) on the API before retiring old keys.
- If a client-side key was ever shipped in the CRX, assume compromise: rotate server keys and move to token or network controls.

## Logging and PII

- Application code must **not** log `raw_text`, passenger names, or IDs. Errors should log **codes** only (e.g. `extract_failed`, `upstream_model_error`).
- On `5xx` / `502`, operators use logs + metrics, not payload dumps.

## Rate limiting

- `slowapi` enforces `RATE_LIMIT_PER_MINUTE` per client IP on `POST /extract` and `POST /extract_pdf`. Tune per environment; add WAF / gateway limits for production.

## PDF uploads

- `/extract_pdf` reads the **text layer** with pypdf. Optional **`PDF_OCR_ENABLED`**: if the layer is empty, rasterize with **Poppler** and OCR with **Tesseract** (see **`OCR_LANG`**). **`ocr_unavailable`** means OCR was required but Poppler/Tesseract were missing or failed to run.
- **`pdf_no_text`**: no text layer and OCR off, or OCR produced no text. **`pdf_encrypted`**: password-protected PDFs are rejected.
- Non-English OCR needs the matching `tesseract-ocr-*` packages on the server (extend the Docker image beyond `tesseract-ocr-eng` if needed).

## Extension distribution

- Unpacked load is for development. For production, pin `host_permissions` to booking + API hosts and publish via your org’s Chrome policy or Web Store as appropriate.
