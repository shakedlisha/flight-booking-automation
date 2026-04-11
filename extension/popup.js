const rawEl = document.getElementById("raw");
const pdfFileEl = document.getElementById("pdfFile");
const statusEl = document.getElementById("status");
const btn = document.getElementById("process");
const openOptions = document.getElementById("open-options");

const DEFAULT_API_BASE = "http://127.0.0.1:8000";

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = "status" + (cls ? ` ${cls}` : "");
}

function getApiSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["apiBaseUrl", "apiBearerToken"], (r) => {
      resolve({
        baseUrl: (r.apiBaseUrl || DEFAULT_API_BASE).replace(/\/$/, ""),
        bearerToken: (r.apiBearerToken || "").trim(),
      });
    });
  });
}

function authHeaders(bearerToken) {
  const h = {};
  if (bearerToken) {
    h["Authorization"] = `Bearer ${bearerToken}`;
  }
  return h;
}

async function applyFillResultToActiveTab(payload) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error("No active tab.");
  }
  await ensureBookingContentScript(tab.id);
  return chrome.tabs.sendMessage(tab.id, {
    type: "FILL_BOOKING",
    payload,
  });
}

openOptions.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

btn.addEventListener("click", async () => {
  const rawText = rawEl.value.trim();
  const pdfFile = pdfFileEl.files?.[0];

  if (!pdfFile && !rawText) {
    setStatus("Paste text or choose a PDF.", "error");
    return;
  }

  btn.disabled = true;
  setStatus("Calling extract API…");

  try {
    if (pdfFile) {
      const { baseUrl } = await getApiSettings();
      const tokenRes = await chrome.runtime.sendMessage({
        type: "ENSURE_ACCESS_TOKEN",
      });
      if (!tokenRes?.ok) {
        setStatus(tokenRes?.error || "Could not obtain access token.", "error");
        return;
      }

      const form = new FormData();
      form.append("file", pdfFile, pdfFile.name || "booking.pdf");

      const res = await fetch(`${baseUrl}/extract_pdf`, {
        method: "POST",
        headers: authHeaders(tokenRes.token),
        body: form,
      });

      const text = await res.text();
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }

      if (!res.ok) {
        const d = payload?.detail;
        let detail;
        if (typeof d === "string") {
          detail = d;
        } else if (d && typeof d === "object") {
          detail = d.error || d.code || JSON.stringify(d);
        } else {
          detail = text.slice(0, 300);
        }
        setStatus(`API error ${res.status}: ${detail}`, "error");
        return;
      }

      const fillResult = await applyFillResultToActiveTab(payload);
      setStatus(fillResult?.summary || "Done.", "ok");
      return;
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      setStatus("No active tab.", "error");
      return;
    }

    const res = await chrome.runtime.sendMessage({
      type: "EXTRACT",
      rawText,
      tabId: tab.id,
    });
    if (!res?.ok) {
      setStatus(res?.error || "Request failed.", "error");
      return;
    }
    setStatus(res.summary || "Done.", "ok");
  } catch (err) {
    setStatus(err?.message || String(err), "error");
  } finally {
    btn.disabled = false;
  }
});
