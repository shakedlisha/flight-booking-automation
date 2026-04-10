const input = document.getElementById("apiBaseUrl");
const tokenInput = document.getElementById("apiBearerToken");
const saveBtn = document.getElementById("save");
const saved = document.getElementById("saved");

const oauthAuth = document.getElementById("oauthAuthorizeUrl");
const oauthToken = document.getElementById("oauthTokenUrl");
const oauthClient = document.getElementById("oauthClientId");
const oauthScope = document.getElementById("oauthScope");
const oauthSignIn = document.getElementById("oauthSignIn");
const clearOAuthBtn = document.getElementById("clearOAuth");
const oauthStatus = document.getElementById("oauthStatus");

const STORAGE_KEYS = [
  "apiBaseUrl",
  "apiBearerToken",
  "oauthAuthorizeUrl",
  "oauthTokenUrl",
  "oauthClientId",
  "oauthScope",
];

chrome.storage.sync.get(STORAGE_KEYS, (r) => {
  input.value = r.apiBaseUrl || "http://127.0.0.1:8000";
  tokenInput.value = r.apiBearerToken || "";
  oauthAuth.value = r.oauthAuthorizeUrl || "";
  oauthToken.value = r.oauthTokenUrl || "";
  oauthClient.value = r.oauthClientId || "";
  oauthScope.value = r.oauthScope || "openid profile offline_access";
});

clearOAuthBtn.addEventListener("click", () => {
  oauthStatus.textContent = "";
  chrome.storage.sync.remove(
    ["apiBearerToken", "oauthRefreshToken", "oauthTokenExpiresAt"],
    () => {
      tokenInput.value = "";
      tokenInput.placeholder = "Leave empty if the API does not require Bearer auth";
      oauthStatus.textContent = "OAuth access and refresh tokens cleared.";
    },
  );
});

saveBtn.addEventListener("click", () => {
  const v = input.value.trim().replace(/\/$/, "");
  const token = tokenInput.value.trim();
  chrome.storage.sync.set(
    {
      apiBaseUrl: v,
      apiBearerToken: token,
      oauthAuthorizeUrl: oauthAuth.value.trim(),
      oauthTokenUrl: oauthToken.value.trim(),
      oauthClientId: oauthClient.value.trim(),
      oauthScope: oauthScope.value.trim(),
    },
    () => {
      saved.hidden = false;
      setTimeout(() => {
        saved.hidden = true;
      }, 2000);
    },
  );
});

oauthSignIn.addEventListener("click", () => {
  oauthStatus.textContent = "";

  const authorizeUrl = oauthAuth.value.trim();
  const tokenUrl = oauthToken.value.trim();
  const clientId = oauthClient.value.trim();
  const scope = oauthScope.value.trim() || "openid profile offline_access";

  if (!authorizeUrl || !tokenUrl || !clientId) {
    oauthStatus.textContent = "Fill authorize URL, token URL, and client ID.";
    return;
  }

  const redirectUri = chrome.identity.getRedirectURL("oauth2");
  const verifier = window.pkceRandomVerifier(64);
  const state = window.pkceRandomState();

  window.pkceChallengeFromVerifier(verifier).then((challenge) => {
    sessionStorage.setItem("oauth_pkce_state", state);
    sessionStorage.setItem("oauth_pkce_verifier", verifier);

    const authUrl = new URL(authorizeUrl);
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("scope", scope);
    authUrl.searchParams.set("code_challenge", challenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("state", state);

    chrome.identity.launchWebAuthFlow(
      { url: authUrl.href, interactive: true },
      (responseUrl) => {
        if (chrome.runtime.lastError) {
          oauthStatus.textContent = chrome.runtime.lastError.message || "Auth cancelled.";
          return;
        }
        let u;
        try {
          u = new URL(responseUrl);
        } catch {
          oauthStatus.textContent = "Invalid redirect URL.";
          return;
        }
        const backState = u.searchParams.get("state");
        if (backState !== sessionStorage.getItem("oauth_pkce_state")) {
          oauthStatus.textContent = "OAuth state mismatch.";
          return;
        }
        const err = u.searchParams.get("error");
        if (err) {
          oauthStatus.textContent = `OAuth error: ${err}`;
          return;
        }
        const code = u.searchParams.get("code");
        if (!code) {
          oauthStatus.textContent = "No authorization code in redirect.";
          return;
        }
        const storedVerifier = sessionStorage.getItem("oauth_pkce_verifier");
        sessionStorage.removeItem("oauth_pkce_state");
        sessionStorage.removeItem("oauth_pkce_verifier");

        chrome.runtime.sendMessage(
          {
            type: "OAUTH_TOKEN_EXCHANGE",
            code,
            codeVerifier: storedVerifier,
            redirectUri,
            clientId,
            tokenUrl,
            scope,
          },
          (resp) => {
            if (chrome.runtime.lastError) {
              oauthStatus.textContent = chrome.runtime.lastError.message;
              return;
            }
            if (!resp?.ok) {
              oauthStatus.textContent = resp?.error || "Token exchange failed.";
              return;
            }
            oauthStatus.textContent =
              "Access token saved as API bearer token. You can use Process in the popup.";
            tokenInput.value = "";
            tokenInput.placeholder = "(token stored — re-open options to replace)";
          },
        );
      },
    );
  });
});
