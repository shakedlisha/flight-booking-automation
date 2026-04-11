/**
 * Ensures content.js is loaded in the tab so tabs.sendMessage works.
 * Shared via importScripts (service worker) and <script> (popup).
 */
async function ensureBookingContentScript(tabId) {
  if (tabId == null) {
    throw new Error("No tab id.");
  }
  try {
    await chrome.tabs.sendMessage(tabId, { type: "PING" });
    return;
  } catch (_) {
    /* content script not present — inject if allowed */
  }

  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (e) {
    throw new Error("Tab closed or unavailable.");
  }

  const u = tab.url || "";
  if (!/^https?:\/\//i.test(u)) {
    throw new Error(
      "Open a real page (http/https). chrome:// pages cannot use the filler.",
    );
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      files: ["content.js"],
    });
  } catch (e) {
    const msg = e?.message || String(e);
    if (/Cannot access|permission|host/i.test(msg)) {
      throw new Error(
        "This site is not allowed for the extension. Use the demo at http://127.0.0.1:8000/demo/ or a *.trvlhub.co.il booking page, then try again.",
      );
    }
    throw new Error(
      `Could not inject helper: ${msg}. Reload the tab (F5) after installing the extension.`,
    );
  }

  try {
    await chrome.tabs.sendMessage(tabId, { type: "PING" });
  } catch (_) {
    throw new Error(
      "Helper injected but did not respond. Reload the tab (F5) and try again.",
    );
  }
}

async function sendFillBookingToTab(tabId, payload) {
  await ensureBookingContentScript(tabId);
  return chrome.tabs.sendMessage(tabId, {
    type: "FILL_BOOKING",
    payload,
  });
}
