const DEFAULT_API_BASE = "http://127.0.0.1:8000";
const DEFAULT_BEARER_TOKEN = "local-dev-booking-token";
const REFRESH_BUFFER_MS = 120_000;

async function getApiBase() {
  const stored = await chrome.storage.sync.get(["apiBaseUrl"]);
  const url = (stored.apiBaseUrl || DEFAULT_API_BASE).replace(/\/$/, "");
  return url;
}

/**
 * @returns {Promise<{ ok: true, token: string } | { ok: false, error: string }>}
 */
async function getValidAccessToken() {
  const stored = await chrome.storage.sync.get([
    "apiBearerToken",
    "oauthRefreshToken",
    "oauthTokenExpiresAt",
    "oauthTokenUrl",
    "oauthClientId",
    "oauthScope",
  ]);

  const access = (stored.apiBearerToken || DEFAULT_BEARER_TOKEN).trim();
  const refresh = (stored.oauthRefreshToken || "").trim();
  const expiresAt = Number(stored.oauthTokenExpiresAt) || 0;
  const tokenUrl = (stored.oauthTokenUrl || "").trim();
  const clientId = (stored.oauthClientId || "").trim();
  const scope = (stored.oauthScope || "").trim();

  if (!refresh) {
    return { ok: true, token: access };
  }

  if (!tokenUrl || !clientId) {
    return {
      ok: false,
      error: "OAuth refresh configured but token URL or client ID is missing. Save Options.",
    };
  }

  const now = Date.now();
  if (expiresAt > 0 && now < expiresAt - REFRESH_BUFFER_MS) {
    if (access) {
      return { ok: true, token: access };
    }
    /* In lifetime window but no access token in storage — try refresh. */
  }

  /* Unknown expiry: use cached access token without calling the token endpoint. */
  if (expiresAt === 0 && access) {
    return { ok: true, token: access };
  }

  try {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refresh,
      client_id: clientId,
    });
    if (scope) {
      body.set("scope", scope);
    }

    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    const text = await res.text();
    if (!res.ok) {
      if (res.status === 400 || res.status === 401) {
        await chrome.storage.sync.remove([
          "apiBearerToken",
          "oauthRefreshToken",
          "oauthTokenExpiresAt",
        ]);
      }
      return {
        ok: false,
        error: `Token refresh failed (${res.status}): ${text.slice(0, 300)}`,
      };
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, error: "Refresh response was not JSON" };
    }

    if (!data.access_token) {
      return { ok: false, error: "No access_token in refresh response" };
    }

    const patch = { apiBearerToken: data.access_token };
    if (data.refresh_token) {
      patch.oauthRefreshToken = data.refresh_token;
    }
    if (typeof data.expires_in === "number" && data.expires_in > 0) {
      patch.oauthTokenExpiresAt = Date.now() + data.expires_in * 1000;
    } else {
      patch.oauthTokenExpiresAt = 0;
    }
    await chrome.storage.sync.set(patch);

    return { ok: true, token: data.access_token.trim() };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "ENSURE_ACCESS_TOKEN") {
    (async () => {
      const result = await getValidAccessToken();
      sendResponse(result);
    })();
    return true;
  }

  if (msg?.type === "OAUTH_TOKEN_EXCHANGE") {
    (async () => {
      try {
        const body = new URLSearchParams({
          grant_type: "authorization_code",
          code: msg.code,
          redirect_uri: msg.redirectUri,
          client_id: msg.clientId,
          code_verifier: msg.codeVerifier,
        });
        const res = await fetch(msg.tokenUrl, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
        });
        const text = await res.text();
        if (!res.ok) {
          sendResponse({
            ok: false,
            error: `Token HTTP ${res.status}: ${text.slice(0, 400)}`,
          });
          return;
        }
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          sendResponse({ ok: false, error: "Token response was not JSON" });
          return;
        }
        if (!data.access_token) {
          sendResponse({ ok: false, error: "No access_token in token response" });
          return;
        }

        const patch = {
          apiBearerToken: data.access_token,
          oauthTokenUrl: msg.tokenUrl,
          oauthClientId: msg.clientId,
        };
        if (msg.scope != null && String(msg.scope).trim()) {
          patch.oauthScope = String(msg.scope).trim();
        }
        if (data.refresh_token) {
          patch.oauthRefreshToken = data.refresh_token;
        } else {
          patch.oauthRefreshToken = "";
        }
        if (typeof data.expires_in === "number" && data.expires_in > 0) {
          patch.oauthTokenExpiresAt = Date.now() + data.expires_in * 1000;
        } else {
          patch.oauthTokenExpiresAt = 0;
        }
        await chrome.storage.sync.set(patch);

        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({
          ok: false,
          error: e?.message || String(e),
        });
      }
    })();
    return true;
  }

  if (msg?.type !== "EXTRACT") {
    return;
  }

  (async () => {
    const baseUrl = await getApiBase();
    const tokenResult = await getValidAccessToken();
    if (!tokenResult.ok) {
      sendResponse({ ok: false, error: tokenResult.error });
      return;
    }

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 120_000);

    const headers = { "Content-Type": "application/json" };
    if (tokenResult.token) {
      headers["Authorization"] = `Bearer ${tokenResult.token}`;
    }

    try {
      const res = await fetch(`${baseUrl}/extract`, {
        method: "POST",
        headers,
        body: JSON.stringify({ raw_text: msg.rawText }),
        signal: controller.signal,
      });
      clearTimeout(t);

      if (!res.ok) {
        let detail = `${res.status}`;
        try {
          const j = await res.json();
          if (j?.detail) {
            detail =
              typeof j.detail === "string"
                ? j.detail
                : JSON.stringify(j.detail);
          }
        } catch {
          /* ignore */
        }
        sendResponse({ ok: false, error: `API error: ${detail}` });
        return;
      }

      const payload = await res.json();

      try {
        const fillResult = await chrome.tabs.sendMessage(msg.tabId, {
          type: "FILL_BOOKING",
          payload,
        });
        sendResponse({
          ok: true,
          summary: fillResult?.summary || "Form updated (no summary).",
        });
      } catch (e) {
        sendResponse({
          ok: false,
          error:
            "Could not reach the content script. Open your booking site (matching manifest URL patterns) and try again.",
        });
      }
    } catch (e) {
      clearTimeout(t);
      const message =
        e?.name === "AbortError" ? "Request timed out." : e?.message || String(e);
      sendResponse({ ok: false, error: message });
    }
  })();

  return true;
});
