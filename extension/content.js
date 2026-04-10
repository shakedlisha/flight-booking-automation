const TOP_FIELDS = ["route", "flightNumber", "date", "pnr", "flightClass"];

function setInputValue(el, value) {
  if (value == null || value === "") {
    return false;
  }
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") {
    el.focus();
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  if (tag === "SELECT") {
    const opt = Array.from(el.options).find(
      (o) => o.value === value || o.textContent.trim() === value,
    );
    if (opt) {
      el.value = opt.value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
  }
  return false;
}

function queryField(root, key) {
  return root.querySelector(`[data-booking-field="${key}"]`);
}

function fillTopLevel(data) {
  const filled = [];
  const missing = [];
  for (const key of TOP_FIELDS) {
    const el = queryField(document, key);
    const val = data[key];
    if (!el) {
      if (val) {
        missing.push(key);
      }
      continue;
    }
    if (val == null || val === "") {
      missing.push(key);
      continue;
    }
    if (setInputValue(el, String(val))) {
      filled.push(key);
    } else {
      missing.push(key);
    }
  }
  return { filled, missing };
}

function fillPassengers(passengers) {
  const filled = [];
  const missing = [];
  const rows = document.querySelectorAll("[data-booking-passenger-row]");
  if (!passengers?.length) {
    return { filled, missing, note: "no_passengers_in_payload" };
  }
  if (!rows.length) {
    const nameEl = queryField(document, "passengerName");
    const idEl = queryField(document, "passengerId");
    const p0 = passengers[0];
    if (nameEl && p0?.name) {
      setInputValue(nameEl, p0.name);
      filled.push("passengerName");
    } else if (p0?.name) {
      missing.push("passengerName");
    }
    if (idEl && p0?.id) {
      setInputValue(idEl, p0.id);
      filled.push("passengerId");
    } else if (p0?.id) {
      missing.push("passengerId");
    }
    return { filled, missing };
  }

  passengers.forEach((p, i) => {
    const row = rows[i];
    if (!row) {
      missing.push(`passengerRow[${i}]`);
      return;
    }
    const nameEl = queryField(row, "passengerName");
    const idEl = queryField(row, "passengerId");
    if (p?.name) {
      if (nameEl && setInputValue(nameEl, p.name)) {
        filled.push(`passenger[${i}].name`);
      } else {
        missing.push(`passenger[${i}].name`);
      }
    }
    if (p?.id) {
      if (idEl && setInputValue(idEl, p.id)) {
        filled.push(`passenger[${i}].id`);
      } else {
        missing.push(`passenger[${i}].id`);
      }
    }
  });

  return { filled, missing };
}

function scrollFirstMissing(missingKeys) {
  const first = missingKeys.find((k) => TOP_FIELDS.includes(k));
  if (!first) {
    return;
  }
  const el = queryField(document, first);
  if (el?.scrollIntoView) {
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

function buildSummary(top, pax) {
  const parts = [];
  parts.push(`Filled ${top.filled.length} top-level field(s).`);
  if (top.missing.length) {
    parts.push(`Missing / not set: ${top.missing.join(", ")}.`);
  }
  if (pax.filled?.length) {
    parts.push(`Passengers: ${pax.filled.length} value(s) applied.`);
  }
  if (pax.missing?.length) {
    parts.push(`Passenger gaps: ${pax.missing.join(", ")}.`);
  }
  return parts.join(" ");
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "FILL_BOOKING") {
    return;
  }

  const data = msg.payload || {};
  const top = fillTopLevel(data);
  const pax = fillPassengers(data.passengers || []);
  scrollFirstMissing(top.missing);

  sendResponse({
    ok: true,
    summary: buildSummary(top, pax),
    top,
    pax,
  });
});
