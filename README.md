# Flight booking paste-to-form

Python **FastAPI** service calls **Gemini** with a fixed JSON schema; a **Chrome MV3** extension pastes raw text (`POST /extract`) or uploads a PDF (`POST /extract_pdf`: text layer first, optional **Tesseract** OCR for scans), then fills inputs marked with `data-booking-field` / `data-booking-passenger-row`.

## Backend

**Windows (easiest):** from the repo root, double-click **`Start-API.bat`**. It installs dependencies if needed, opens a second window running the API, and opens the demo form in your browser (`/demo/`). Edit **`backend/.env`** first for `GEMINI_API_KEY` and `CORS_ORIGINS` (see below).

**Manual:**

```text
cd backend
copy .env.example .env
# set GEMINI_API_KEY and CORS_ORIGINS (see below)
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

### Tests and CI

- **Local:** from `backend/`, install dev dependencies and run pytest (no real `GEMINI_API_KEY` required; tests mock Gemini and OCR):

```text
pip install -r requirements-dev.txt
python -m pytest -q
```

- **CI:** pushes and pull requests that touch `backend/**` run the same suite on GitHub Actions (`.github/workflows/backend-ci.yml`).

- **Health:** `GET http://127.0.0.1:8000/health`
- **Extract (text):** `POST http://127.0.0.1:8000/extract` with JSON `{ "raw_text": "..." }`
- **Extract (PDF):** `POST http://127.0.0.1:8000/extract_pdf` with `multipart/form-data` field `file` (`.pdf`). **pypdf** reads the text layer first. If that is empty and **`PDF_OCR_ENABLED=true`**, pages are rasterized (**Poppler** `pdftoppm`) and run through **Tesseract** (`OCR_LANG`, default `eng`). If OCR is enabled but Poppler/Tesseract are missing → **503** `ocr_unavailable`. If the text layer is empty and OCR is off → **400** `pdf_no_text`. Password-protected PDFs → **400** `pdf_encrypted`. Oversized uploads → **413** `pdf_too_large`. Same **auth** and **per-IP rate limit** as `/extract`. OCR adds significant CPU and latency; the Docker image installs Poppler + English Tesseract by default.
- **Demo form:** open `http://127.0.0.1:8000/demo/` (for manual extension testing)

### CORS and the extension

Browser `fetch` from the extension uses origin `chrome-extension://<extension-id>`. After loading the unpacked extension once, copy its ID from `chrome://extensions` and add to `.env`:

```env
CORS_ORIGINS=http://127.0.0.1:3000,http://localhost:3000,chrome-extension://YOUR_EXTENSION_ID_HERE
```

Restart the API after changing CORS.

### Environment variables

| Variable | Purpose |
|----------|---------|
| `GEMINI_API_KEY` | Google AI Studio / Gemini API key (server only) |
| `GEMINI_MODEL` | Model id (default `gemini-2.0-flash`) |
| `CORS_ORIGINS` | Comma-separated allowed origins |
| `RATE_LIMIT_PER_MINUTE` | Per-IP limit on `POST /extract` and `POST /extract_pdf` (default 60) |
| `LOG_LEVEL` | e.g. `INFO` |
| `EXTRACT_BEARER_TOKENS` | Optional. Comma-separated static secrets; `Authorization: Bearer …` (ignored for `/extract` when JWT mode is on; see below). |
| `JWT_JWKS_URL` | With `JWT_AUDIENCE` + `JWT_ISSUER`, enables **JWT-only** auth on `/extract` and `/extract_pdf` (JWKS must be HTTPS). |
| `JWT_AUDIENCE` | Required `aud` claim (string or list in token). |
| `JWT_ISSUER` | Required `iss` claim (must match the token exactly, including trailing slashes). |
| `JWT_REQUIRED_SCOPE` | Optional. One scope string that must appear in `scp`, `scope`, or `permissions`. |
| `JWT_LEEWAY_SECONDS` | Clock skew leeway for `exp` (default 60). |
| `PDF_MAX_BYTES` | Max upload size for `/extract_pdf` (default 5_000_000). |
| `PDF_MAX_PAGES` | Max pages read / OCR’d per PDF (default 40). |
| `PDF_OCR_ENABLED` | If `true`, run Tesseract when the text layer is empty (requires Poppler + Tesseract on the host). |
| `OCR_LANG` | Tesseract language(s), e.g. `eng` or `eng+deu` if data packs are installed. |

**Precedence:** If `JWT_JWKS_URL`, `JWT_AUDIENCE`, and `JWT_ISSUER` are all set, only **JWTs** are accepted for `/extract` and `/extract_pdf`, and `EXTRACT_BEARER_TOKENS` is ignored (startup logs a warning).

Logs do **not** include request bodies or extracted PII.

### Tests

```text
cd backend
python -m pip install -r requirements-dev.txt
python -m pytest tests/ -q
```

**Extension (manual):** After OAuth sign-in with refresh-capable scopes, wait until near access-token expiry (or temporarily shorten TTL in a test IdP), then run **Process** — the service worker should refresh once and succeed. PDF upload uses the same token path via **ENSURE_ACCESS_TOKEN**.


## Deploy (Docker / HTTPS)

TLS termination is usually handled by your host (load balancer, Fly, Render, Cloud Run, etc.). The app listens on **`PORT`** (default **8000** in the image).

**Build and run locally with Compose** (expects `backend/.env`):

```text
docker compose up --build
```

**Build the image alone:**

```text
docker build -t booking-extract ./backend
docker run --rm -p 8000:8000 --env-file backend/.env -e PORT=8000 booking-extract
```

**After you have a public HTTPS URL:**

1. Set **`CORS_ORIGINS`** on the server to include every `chrome-extension://…` ID your team uses (and any web origins if needed). Commas, no spaces unless each origin is trimmed (the app strips spaces).
2. In the extension, set **API base URL** in Options to `https://your-api.example.com` (no trailing slash).
3. Add that same origin to **`host_permissions`** in [`extension/manifest.json`](extension/manifest.json) (e.g. `https://your-api.example.com/*`).

## Chrome extension

1. Open `chrome://extensions` → Developer mode → **Load unpacked** → select the `extension/` folder.
2. **Options** (or the link in the popup): set **API base URL** if not using `http://127.0.0.1:8000`. Set **API bearer token** to a static secret (`EXTRACT_BEARER_TOKENS` mode) **or** to an **access token (JWT)** when the API uses **JWT / JWKS** mode. Optionally use **Sign in (OAuth2 + PKCE)** to fetch an access token (configure IdP URLs and client id; add your IdP **token** endpoint origin to `host_permissions`). If the IdP returns a **refresh token** (often requires `offline_access` or the vendor’s offline scope in **Scope**), the extension refreshes the access token automatically before **Process** (text and PDF). A **400/401** refresh clears stored OAuth tokens so you can sign in again. Use **Clear OAuth tokens** in Options to drop access + refresh without removing URL settings.
3. Add your **production** API host to `host_permissions` in `manifest.json` (and your booking app origins to `content_scripts.matches`). For OAuth token exchange, add the token URL’s origin (e.g. `https://login.microsoftonline.com/*` or your Auth0 domain).
4. Open your booking page (or the demo at `/demo/`), then use the extension popup → **Process** (paste text and/or choose a **PDF**). For scans, enable **`PDF_OCR_ENABLED`** on the server (see Docker or install Poppler + Tesseract locally; on Windows, WSL/Chocolatey or run via Docker).

### TravelHub (`*.trvlhub.co.il`)

The manifest already allows **`https://*.trvlhub.co.il/*`**. On those sites the content script uses **label / name heuristics** to fill Route, Flight #, Date, PNR, Class, and passenger **NAME / ID** table rows (not the generic `data-booking-field` demo hooks). After loading or updating the extension, use **Reload** on `chrome://extensions`, then refresh the docket page.

If some fields stay empty, open **DevTools → Console** on that tab and run **Process** once: the first run per tab logs a table of inputs (`[Booking paste] TravelHub DOM`) so you can share names/labels for selector tweaks.

On TravelHub, the extension also applies **defaults**: **Status** = `ok`, **Currency** = extracted ISO code or **`USD`**, **Class** = extracted value or **`T`**, **Service** = **`C`** for flight numbers starting with **6H** (Israir), **BZ** (Bluebird), **IZ** (Arkia), **HF** (Air Haifa), or **TUS** (Tusair); otherwise **`FLIGHT`**. **Price** is filled when the API extracts a fare from the paste (set `currency` / `price` in the model).

### Form hooks (your web app)

- Top-level: `data-booking-field` one of `route`, `flightNumber`, `date`, `pnr`, `flightClass`.
- Passengers: a container per row with `data-booking-passenger-row`, and inside it `data-booking-field="passengerName"` and `passengerId`. If there are no rows, optional global `passengerName` / `passengerId` inputs are used for the first passenger.

## Operations

See [RUNBOOK.md](RUNBOOK.md) for auth phases and deployment notes.
