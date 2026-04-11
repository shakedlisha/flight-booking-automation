const TOP_FIELDS = [
  "route",
  "flightNumber",
  "date",
  "depArr",
  "pnr",
  "sPnr",
  "flightClass",
  "service",
  "status",
  "currency",
  "price",
];

const TRAVELHUB_DEBUG_SESSION_KEY = "bookingPasteTravelHubDebugOnce";

/** Any subdomain of trvlhub.co.il (e.g. lordtickets.trvlhub.co.il). */
function isTravelHub() {
  return /\.trvlhub\.co\.il$/i.test(location.hostname);
}

function normalizeLabelText(s) {
  return (s || "")
    .replace(/\s+/g, " ")
    .replace(/[#/:]/g, " ")
    .trim()
    .toLowerCase();
}

function isFormControl(el) {
  if (!el || !el.tagName) return false;
  const t = el.tagName;
  if (t === "TEXTAREA" || t === "SELECT") return true;
  if (t !== "INPUT") return false;
  const type = (el.type || "text").toLowerCase();
  return (
    type === "text" ||
    type === "search" ||
    type === "tel" ||
    type === "email" ||
    type === "number" ||
    type === ""
  );
}

/**
 * Find input/textarea/select associated with a <label>.
 */
function resolveAssociatedInput(label) {
  if (label.htmlFor) {
    const byId = document.getElementById(label.htmlFor);
    if (byId && isFormControl(byId)) return byId;
  }
  const inner = label.querySelector("input, textarea, select");
  if (inner && isFormControl(inner)) return inner;

  let n = label.nextElementSibling;
  for (let i = 0; i < 6 && n; i++) {
    if (n.matches?.("input, textarea, select") && isFormControl(n)) return n;
    const found = n.querySelector?.(
      "input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea, select",
    );
    if (found && isFormControl(found)) return found;
    n = n.nextElementSibling;
  }

  const scope =
    label.closest(".form-group, .row, .field, td, tr, [class*='form'], [class*='Field']") ||
    label.parentElement;
  if (scope) {
    const list = scope.querySelectorAll(
      "input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea, select",
    );
    if (list.length === 1 && isFormControl(list[0])) return list[0];
    /* Prefer control after this label in DOM order */
    const all = [...scope.querySelectorAll("input, textarea, select")].filter(isFormControl);
    if (all.length) {
      const labelPos = label.compareDocumentPosition(all[0]);
      if (labelPos & Node.DOCUMENT_POSITION_FOLLOWING) {
        return all[0];
      }
      return all[0];
    }
  }
  return null;
}

/**
 * @param {string[]} matchers — substrings to find in label text (normalized)
 * @param {boolean} [exact] — when true, require label text === matcher (not just contains)
 */
function findInputByLabelMatchers(matchers, exact = false) {
  const labels = document.querySelectorAll("label");
  for (const m of matchers) {
    const needle = normalizeLabelText(m);
    if (!needle) continue;
    for (const lab of labels) {
      const text = normalizeLabelText(lab.textContent).slice(0, 120);
      if (!text) continue;
      const match = exact
        ? text === needle
        : text.includes(needle) || needle.includes(text);
      if (match) {
        const el = resolveAssociatedInput(lab);
        if (el) return el;
      }
    }
  }
  return null;
}

/**
 * Try common Yii / Bootstrap name fragments (best-effort).
 */
function findInputByNameHints(hints) {
  const inputs = document.querySelectorAll(
    "input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea, select",
  );
  for (const el of inputs) {
    const name = (el.name || "").toLowerCase();
    const id = (el.id || "").toLowerCase();
    for (const h of hints) {
      if (!h) continue;
      if (name.includes(h) || id.includes(h)) {
        return el;
      }
    }
  }
  return null;
}

const TRAVELHUB_FIELD_CONFIG = {
  route: {
    labels: ["route", "from / to", "from/to", "sector"],
    nameHints: ["route", "sector"],
  },
  flightNumber: {
    labels: ["flight #", "flight#", "flight no", "flight number", "flt"],
    nameHints: ["flight", "flt", "flightno", "flight_no"],
  },
  date: {
    /* "date" alone is very short — only match if label text is exactly "date" */
    labels: ["date"],
    nameHints: ["flightdate", "flight_date", "depdate", "dep_date", "date"],
    exactLabel: true,
  },
  depArr: {
    labels: ["dep/arr", "dep / arr", "departure/arrival", "dep arr", "dep time"],
    nameHints: ["deparr", "dep_arr", "departure", "depart", "deptime"],
  },
  pnr: {
    labels: ["pnr", "record locator", "locator", "confirmation", "record"],
    nameHints: ["pnr", "record", "locator", "conf"],
  },
  sPnr: {
    /* "S/PNR" is the label shown in the TravelHub form */
    labels: ["s/pnr", "s pnr", "supplier pnr", "spnr", "secondary pnr"],
    nameHints: ["spnr", "supplier_pnr", "s_pnr"],
  },
  flightClass: {
    /* Avoid matching generic "class" that lives everywhere in a web app */
    labels: ["service class", "booking class", "cabin class", "cabin", "rbd", "fare class"],
    nameHints: ["cabin", "rbd", "bookingclass", "flightclass", "flight_class"],
  },
  service: {
    labels: ["service"],
    nameHints: ["service"],
    exactLabel: true,
  },
  status: {
    labels: ["status"],
    nameHints: ["status", "bookingstatus", "booking_status"],
    exactLabel: true,
  },
  currency: {
    labels: ["currency"],
    nameHints: ["currency", "curr"],
    exactLabel: true,
  },
  price: {
    labels: ["price", "fare", "total", "amount"],
    nameHints: ["price", "fare", "total", "amount"],
  },
};

/** Israir 6H, Bluebird BZ, Arkia IZ, Air Haifa HF, Tusair TUS → "C"; else "FLIGHT". */
function deriveTravelHubService(flightNumber) {
  if (!flightNumber) return "FLIGHT";
  const flt = String(flightNumber).trim().toUpperCase();
  const charterPrefixes = ["6H", "BZ", "IZ", "HF", "TUS"];
  for (const prefix of charterPrefixes) {
    if (flt.startsWith(prefix)) return "C";
  }
  return "FLIGHT";
}

/**
 * Merge API payload with TravelHub business defaults (class T, USD, ok, derived service).
 */
function buildTravelHubPayload(data) {
  const d = data || {};
  const flightClass =
    d.flightClass != null && String(d.flightClass).trim() !== ""
      ? String(d.flightClass).trim()
      : "T";
  const currency =
    d.currency != null && String(d.currency).trim() !== ""
      ? String(d.currency).trim().toUpperCase()
      : "USD";
  const priceRaw = d.price != null ? String(d.price).trim() : "";
  return {
    ...d,
    flightClass,
    currency,
    service: deriveTravelHubService(d.flightNumber),
    status: "ok",
    price: priceRaw,
  };
}

function findTravelHubField(key) {
  const cfg = TRAVELHUB_FIELD_CONFIG[key];
  if (!cfg) return null;
  let el = findInputByLabelMatchers(cfg.labels, cfg.exactLabel === true);
  if (!el) el = findInputByNameHints(cfg.nameHints);
  if (!el && key === "flightClass") {
    el = findInputByLabelMatchers(["class"], true);
  }
  return el;
}

function debugTravelHubInputs() {
  const rows = [];
  document.querySelectorAll("input, textarea, select").forEach((el, i) => {
    if (!isFormControl(el)) return;
    const name = el.name || "";
    const id = el.id || "";
    const ph = el.placeholder || "";
    let labelText = "";
    if (id && typeof CSS !== "undefined" && CSS.escape) {
      const lab = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (lab) labelText = lab.textContent.trim().slice(0, 60);
    }
    if (!labelText) {
      const wrap = el.closest("td, .form-group, div");
      const prev = wrap?.querySelector("label");
      if (prev) labelText = prev.textContent.trim().slice(0, 60);
    }
    rows.push({ i, tag: el.tagName, type: el.type, name, id, placeholder: ph, labelText });
  });
  console.info(
    "[Booking paste] TravelHub DOM — visible form controls (first Process on this tab):",
    rows,
  );
}

function maybeDebugTravelHubOnce() {
  try {
    if (sessionStorage.getItem(TRAVELHUB_DEBUG_SESSION_KEY)) return;
    sessionStorage.setItem(TRAVELHUB_DEBUG_SESSION_KEY, "1");
    debugTravelHubInputs();
  } catch (_) {
    /* sessionStorage may be blocked */
  }
}

function fillTravelHubTop(data) {
  const payload = buildTravelHubPayload(data);
  const filled = [];
  const missing = [];
  const elements = {};

  for (const key of TOP_FIELDS) {
    const val = payload[key];
    const el = findTravelHubField(key);
    elements[key] = el;
    if (!el) {
      if (val != null && val !== "") missing.push(key);
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

  return { filled, missing, elements };
}

/**
 * Passenger table: thead with NAME + ID columns, tbody rows with inputs.
 */
function fillTravelHubPassengers(passengers) {
  const filled = [];
  const missing = [];

  if (!passengers?.length) {
    return { filled, missing, note: "no_passengers_in_payload" };
  }

  const tables = document.querySelectorAll("table");
  let targetTable = null;
  let nameCol = -1;
  let idCol = -1;

  for (const table of tables) {
    const thead = table.querySelector("thead");
    const headerRow = thead?.querySelector("tr") || table.querySelector("tr");
    if (!headerRow) continue;
    const cells = headerRow.querySelectorAll("th, td");
    if (cells.length < 2) continue;

    let nc = -1;
    let ic = -1;
    cells.forEach((cell, idx) => {
      const t = normalizeLabelText(cell.textContent);
      if (t === "name" || t.startsWith("name ") || t.includes("passenger name")) {
        nc = idx;
      }
      if (
        t === "id" ||
        t.startsWith("id ") ||
        t.includes("passport") ||
        t.includes("document") ||
        t.includes("teudat")
      ) {
        ic = idx;
      }
    });

    if (nc >= 0 && ic >= 0) {
      targetTable = table;
      nameCol = nc;
      idCol = ic;
      break;
    }
  }

  if (!targetTable) {
    /* Fallback: first table with multiple tbody rows and 2+ inputs per row */
    for (const table of tables) {
      const bodyRows = table.querySelectorAll("tbody tr");
      if (bodyRows.length < 1) continue;
      const firstRow = bodyRows[0];
      const inputs = firstRow.querySelectorAll(
        "input:not([type=hidden]):not([type=checkbox]), textarea",
      );
      if (inputs.length >= 2) {
        targetTable = table;
        nameCol = 0;
        idCol = 1;
        break;
      }
    }
  }

  if (!targetTable) {
    passengers.forEach((p, i) => {
      if (p?.name) missing.push(`passenger[${i}].name`);
      if (p?.id) missing.push(`passenger[${i}].id`);
    });
    return { filled, missing, note: "travelhub_no_passenger_table" };
  }

  const bodyRows = targetTable.querySelectorAll("tbody tr");
  passengers.forEach((p, i) => {
    const tr = bodyRows[i];
    if (!tr) {
      if (p?.name) missing.push(`passenger[${i}].name`);
      if (p?.id) missing.push(`passenger[${i}].id`);
      return;
    }
    const cells = tr.querySelectorAll("td, th");

    const getCellInput = (colIdx) => {
      const cell = cells[colIdx];
      if (!cell) return null;
      const inp = cell.querySelector("input:not([type=hidden]), textarea");
      return inp && isFormControl(inp) ? inp : null;
    };

    let nameEl = nameCol >= 0 ? getCellInput(nameCol) : null;
    let idEl = idCol >= 0 ? getCellInput(idCol) : null;

    if (!nameEl || !idEl) {
      const rowInputs = [
        ...tr.querySelectorAll("input:not([type=hidden]):not([type=checkbox]), textarea"),
      ].filter(isFormControl);
      if (!nameEl && rowInputs[0]) nameEl = rowInputs[0];
      if (!idEl && rowInputs[1]) idEl = rowInputs[1];
    }

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

function scrollFirstMissing(missingKeys, travelHubElements) {
  const first = missingKeys.find((k) => TOP_FIELDS.includes(k));
  if (!first) {
    return;
  }
  if (travelHubElements && travelHubElements[first]) {
    travelHubElements[first].scrollIntoView?.({ block: "center", behavior: "smooth" });
    return;
  }
  const el = queryField(document, first);
  if (el?.scrollIntoView) {
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

function buildSummary(top, pax, mode) {
  const parts = [];
  const prefix = mode === "travelhub" ? "[TravelHub] " : "";
  parts.push(`${prefix}Filled ${top.filled.length} top-level field(s).`);
  if (top.missing.length) {
    parts.push(`Missing / not set: ${top.missing.join(", ")}.`);
  }
  if (pax.filled?.length) {
    parts.push(`Passengers: ${pax.filled.length} value(s) applied.`);
  }
  if (pax.missing?.length) {
    parts.push(`Passenger gaps: ${pax.missing.join(", ")}.`);
  }
  if (mode === "travelhub") {
    parts.push("Tip: first Process per tab logs form fields in DevTools Console.");
  }
  return parts.join(" ");
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "PING") {
    sendResponse({ ok: true });
    return;
  }
  if (msg?.type !== "FILL_BOOKING") {
    return;
  }

  const data = msg.payload || {};
  let top;
  let pax;
  let mode = "demo";

  if (isTravelHub()) {
    mode = "travelhub";
    maybeDebugTravelHubOnce();
    top = fillTravelHubTop(data);
    pax = fillTravelHubPassengers(data.passengers || []);
    scrollFirstMissing(top.missing, top.elements);
  } else {
    top = fillTopLevel(data);
    pax = fillPassengers(data.passengers || []);
    scrollFirstMissing(top.missing, null);
  }

  const { elements: _el, ...topForResponse } = top;

  sendResponse({
    ok: true,
    summary: buildSummary(topForResponse, pax, mode),
    top: topForResponse,
    pax,
    mode,
  });
});
