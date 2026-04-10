/* global crypto, btoa */
(function () {
  "use strict";

  const CHARSET =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

  function randomVerifier(length) {
    const n = length || 64;
    const arr = new Uint8Array(n);
    crypto.getRandomValues(arr);
    let s = "";
    for (let i = 0; i < n; i++) {
      s += CHARSET[arr[i] % CHARSET.length];
    }
    return s;
  }

  async function challengeFromVerifier(verifier) {
    const data = new TextEncoder().encode(verifier);
    const hash = await crypto.subtle.digest("SHA-256", data);
    const bytes = new Uint8Array(hash);
    let bin = "";
    bytes.forEach((b) => {
      bin += String.fromCharCode(b);
    });
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function randomState() {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  window.pkceRandomVerifier = randomVerifier;
  window.pkceChallengeFromVerifier = challengeFromVerifier;
  window.pkceRandomState = randomState;
})();
