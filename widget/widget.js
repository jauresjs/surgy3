"use strict";

/* ==========================================================================
   Hebelie widget — frame app
   1. Config & UI metadata
   2. Element refs & state
   3. Parent bridge (hello, resize, events)
   4. Boot & branding
   5. Treatments
   6. Photo handling
   7. Status & slider
   8. Preview cache
   9. Generate
   10. Download
   11. Lead form
   ==========================================================================
   This document is served only to be framed. It never assumes it is the top
   window: every call carries the key it was loaded with and the origin of the
   page that framed it, and every user-visible state is mirrored to the parent
   through postMessage so the host page can react without reaching inside. */

/* 1 · Config & UI metadata ------------------------------------------------- */
const HEBELIE_API = "https://qqrcxbmbulfsvgbqjngz.supabase.co/functions/v1/hebelie-api";
const STORE_PREFIX = "hebelie-widget:";
const MAX_PHOTO = 1024;
const HELLO_WAIT_MS = 700;
const MAX_TREATMENTS = 3;

/* Line-icon helper (24×24, stroke) */
const SVG = (d) =>
  `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

/* UI-only glyph and one-line description per treatment id. The treatment list
   itself, and every label in it, comes from /widget/config — never from here. */
const UI_META = {
  facelift: { desc: "Lifted jawline and neck",
    icon: SVG(`<path d="M12 3c-4.4 0-8 3.4-8 7.8V15c0 3.5 2.8 6.3 6.3 6.3h3.4c3.5 0 6.3-2.8 6.3-6.3v-4.2C20 6.4 16.4 3 12 3Z"/><path d="m8.5 10.5 3.5-3.5 3.5 3.5M12 7v6"/>`) },
  lips: { desc: "Fuller, natural lips",
    icon: SVG(`<path d="M3 12c2.2-3 4.3-3.2 5.5-1.6C9.6 9 10.8 8.5 12 8.5s2.4.5 3.5 1.9C16.7 8.8 18.8 9 21 12c-2.4 4-5.8 6-9 6s-6.6-2-9-6Z"/><path d="M3 12c3.2 1.1 6 1.6 9 1.6s5.8-.5 9-1.6"/>`) },
  botox: { desc: "Smoothed forehead and eyes",
    icon: SVG(`<path d="m13 6.5 4.5 4.5M18.5 3 21 5.5M15.5 4 20 8.5M12 8l4 4M8.5 12.5l3 3-4.5 4.5H4v-3l4.5-4.5Z"/>`) },
  rhino: { desc: "Refined nose contour",
    icon: SVG(`<path d="M12 3v7c0 2.5-1.5 3.5-2.5 5S8 18.5 8 20c0 1 1 1.5 2 1.5h6"/><path d="M15 21.5h3c1 0 1.6-1 1.2-1.9-.7-1.7-2.2-2.6-4-2.6h-2"/>`) },
  cheeks: { desc: "Youthful cheek contour",
    icon: SVG(`<path d="M11 3l1.6 4.6L17 9l-4.4 1.4L11 15l-1.6-4.6L5 9l4.4-1.4L11 3Z"/><path d="m18.5 14.5.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9.9-2.4Z"/>`) },
  jawline: { desc: "Sharper jawline and chin",
    icon: SVG(`<path d="M5 4.5v6.8C5 15.6 8 19 12 19.8c4-.8 7-4.2 7-8.5V4.5"/><path d="M9 12c1.8 1.5 4.2 1.5 6 0"/>`) },
  skin: { desc: "Clear, glowing skin",
    icon: SVG(`<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z"/><path d="m17.5 3.5.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z"/>`) },
  browlift: { desc: "Open, refreshed eyes",
    icon: SVG(`<path d="M5.5 12.5S8.5 7 12 7s6.5 5.5 6.5 5.5-3 5.5-6.5 5.5-6.5-5.5-6.5-5.5Z"/><circle cx="12" cy="12.5" r="2.2"/><path d="M6.5 5.5C8.3 4.3 10 3.8 12 3.8s3.7.5 5.5 1.7"/>`) },
};

const CHECK_ICON = `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="m4 12.5 5.5 5.5L20 6.5"/></svg>`;

/* 2 · Element refs & state ------------------------------------------------- */
const $ = (id) => document.getElementById(id);

const els = {
  app: $("app"),
  brandLogo: $("brandLogo"),
  brandName: $("brandName"),
  brandTagline: $("brandTagline"),
  loading: $("loading"),
  fatal: $("fatal"),
  fatalText: $("fatalText"),
  retry: $("retryBtn"),
  studio: $("studio"),
  treatments: $("treatments"),
  treatmentTitle: $("treatmentTitle"),
  treatmentNext: $("treatmentNext"),
  multiHint: $("multiHint"),
  selectionCount: $("selectionCount"),
  camera: $("cameraInput"),
  upload: $("uploadInput"),
  preview: $("preview"),
  generate: $("generateBtn"),
  status: $("status"),
  resultWrap: $("resultWrap"),
  sliderWrap: $("sliderWrap"),
  beforeImg: $("beforeImg"),
  afterImg: $("afterImg"),
  handle: $("sliderHandle"),
  divider: $("sliderWrap").querySelector(".h-divider"),
  beforeBadge: $("beforeBadge"),
  afterBadge: $("afterBadge"),
  download: $("downloadBtn"),
  previewCache: $("previewCache"),
  cacheList: $("cacheList"),
  again: $("againBtn"),
  leadWrap: $("leadWrap"),
  leadCopy: $("leadCopy"),
  leadForm: $("leadForm"),
  leadError: $("leadError"),
  consentText: $("consentText"),
  infoSent: $("infoSent"),
  bookingLink: $("bookingLink"),
  closeBtn: $("closeBtn"),
};

const state = {
  key: readKey(),
  parentOrigin: "",
  parentUrl: "",
  config: null,
  booted: false,
  photoDataUrl: null,
  sessionId: null,
  selected: [],
  multiMode: false,
  previews: [],
  activePreviewId: null,
  leadSent: false,
  busy: false,
  lastHeight: 0,
};

function readKey() {
  const query = new URLSearchParams(location.search).get("key") || "";
  const hash = location.hash.startsWith("#key=") ? location.hash.slice(5) : "";
  return (query || hash).trim();
}

/* 3 · Parent bridge -------------------------------------------------------- */
/* Every message names its originator so a host page never mistakes another
   widget's traffic for this one. */
function post(type, payload) {
  if (window.parent === window) return;
  window.parent.postMessage(
    { source: "hebelie-widget", type, ...(payload || {}) },
    state.parentOrigin || "*",
  );
}

/* The iframe gets its height from the frame, not from a fixed guess, so the
   host page never shows a second scrollbar or a clipped card. The height is
   read from the app box, not from documentElement.scrollHeight: the document
   is at least as tall as the iframe, so scrollHeight could never shrink and a
   failed load would leave a tall empty frame. */
let heightPending = false;
function reportHeight() {
  if (heightPending) return;
  heightPending = true;
  requestAnimationFrame(() => {
    heightPending = false;
    const next = Math.ceil(els.app.getBoundingClientRect().height);
    if (!next || Math.abs(next - state.lastHeight) < 2) return;
    state.lastHeight = next;
    post("resize", { height: next });
  });
}

/* embed.js sends hello on every load. event.origin is the framing page's real
   origin, which is the one value here a third party cannot write. */
window.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.source !== "hebelie-embed" || data.type !== "hello") return;
  if (!/^https?:\/\//i.test(String(event.origin || ""))) return;
  state.parentOrigin = event.origin;
  if (typeof data.url === "string" && /^https?:\/\//i.test(data.url)) {
    state.parentUrl = data.url.slice(0, 500);
  }
  boot();
});

/* Opened directly (the demo page, or someone pasting the frame URL) there is
   no handshake. The referrer still names the page that framed us. */
setTimeout(() => {
  if (state.booted) return;
  if (!state.parentOrigin && document.referrer) {
    try {
      const url = new URL(document.referrer);
      if (url.protocol === "https:" || url.protocol === "http:") state.parentOrigin = url.origin;
    } catch (err) {
      /* A malformed referrer is the same as no referrer. */
    }
  }
  boot();
}, HELLO_WAIT_MS);

if ("ResizeObserver" in window) new ResizeObserver(reportHeight).observe(els.app);
window.addEventListener("load", reportHeight);

/* 4 · Boot & branding ------------------------------------------------------ */
class WidgetError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "WidgetError";
    this.status = status;
  }
}

/* Every request is tagged with the key it was served for and the origin that
   framed it, so the API can resolve the tenant and check the origin together. */
async function api(path, options) {
  const opts = options || {};
  const headers = { "x-widget-key": state.key };
  if (state.parentOrigin) headers["x-parent-origin"] = state.parentOrigin;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  let res;
  try {
    res = await fetch(HEBELIE_API + path, {
      method: opts.method || "POST",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch (err) {
    throw new WidgetError("The studio cannot be reached. Check your connection.", 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new WidgetError(data.error || "Something went wrong. Try again.", res.status);
  return data;
}

function boot() {
  if (state.booted) return;
  state.booted = true;
  els.fatal.hidden = true;
  els.studio.hidden = true;
  els.loading.hidden = false;
  els.loading.textContent = "Loading your preview studio…";
  els.app.setAttribute("aria-busy", "true");
  load().catch(showFatal).finally(reportHeight);
}

async function load() {
  if (!state.key) throw new WidgetError("This preview is not set up yet.", 401);
  const config = await api("/widget/config", { method: "GET" });
  state.config = config;
  applyBrand(config);
  renderTreatments(Array.isArray(config.treatments) ? config.treatments : []);
  if (config.consent && config.consent.text) els.consentText.textContent = config.consent.text;
  els.loading.hidden = true;
  els.studio.hidden = false;
  els.app.setAttribute("aria-busy", "false");
  els.closeBtn.hidden = window.parent === window;
  restoreCache();
  updateGenerateState();
  reportHeight();
  post("ready", { tenant: (config.tenant && config.tenant.name) || "" });
}

function showFatal(err) {
  const status = err && typeof err.status === "number" ? err.status : 0;
  els.loading.hidden = true;
  els.studio.hidden = true;
  els.fatal.hidden = false;
  els.fatalText.textContent =
    status === 401 ? "This preview is not connected to an active studio."
    : status === 403 ? "This site is not allowed to show this preview studio."
    : status === 404 ? "This studio could not be found."
    : status === 429 ? "The studio is busy. Try again in a little while."
    : (err && err.message) || "This preview is unavailable right now.";
  els.app.setAttribute("aria-busy", "false");
  post("error", { status, message: els.fatalText.textContent });
  reportHeight();
}

const HEX = /^#[0-9a-f]{3,8}$/i;

/* Branding is the only thing the tenant controls inside the frame, so it is
   validated before it reaches a style declaration. */
function applyBrand(config) {
  const tenant = config.tenant || {};
  const brand = tenant.brand || {};
  const root = document.documentElement.style;
  if (HEX.test(brand.primary || "")) root.setProperty("--h-primary", brand.primary);
  if (HEX.test(brand.accent || "")) root.setProperty("--h-accent", brand.accent);
  if (tenant.name) {
    els.brandName.textContent = tenant.name;
    document.title = tenant.name + " — treatment preview";
    els.leadCopy.textContent =
      "Share your details and " + tenant.name + " will follow up about what you previewed.";
  }
  if (brand.tagline) {
    els.brandTagline.textContent = brand.tagline;
    els.brandTagline.hidden = false;
  }
  if (brand.logoUrl) {
    els.brandLogo.src = brand.logoUrl;
    els.brandLogo.alt = (tenant.name || "Studio") + " logo";
    els.brandLogo.hidden = false;
  }
  if (brand.bookingUrl && /^https?:\/\//i.test(brand.bookingUrl)) {
    els.bookingLink.href = brand.bookingUrl;
    els.bookingLink.hidden = false;
  }
}

els.retry.addEventListener("click", () => {
  state.booted = false;
  boot();
});

/* 5 · Treatments ----------------------------------------------------------- */
/* The list and its labels are the tenant's, from the server. Only the glyph and
   the empty-state copy are local. */
function renderTreatments(list) {
  els.treatments.replaceChildren();
  if (!list.length) {
    const note = document.createElement("p");
    note.className = "h-photo-note";
    note.textContent = "This studio has no treatments turned on yet.";
    els.treatments.appendChild(note);
    return;
  }
  list.forEach((t) => {
    const meta = UI_META[t.id] || {};
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "h-treatment";
    btn.dataset.id = t.id;
    btn.setAttribute("aria-pressed", "false");
    btn.innerHTML = `
      <span class="h-check" aria-hidden="true">${CHECK_ICON}</span>
      <span class="h-icon">${meta.icon || ""}</span>
      <span class="h-name"></span>
      <span class="h-desc"></span>`;
    btn.querySelector(".h-name").textContent = t.label;
    btn.querySelector(".h-desc").textContent = meta.desc || "";
    btn.addEventListener("click", () => selectTreatment(t));
    els.treatments.appendChild(btn);
  });
}

/* First preview is one treatment. After that, one to three. */
function selectTreatment(t) {
  const idx = state.selected.findIndex((x) => x.id === t.id);
  if (!state.multiMode) {
    state.selected = [t];
  } else if (idx >= 0) {
    state.selected.splice(idx, 1);
  } else if (state.selected.length >= MAX_TREATMENTS) {
    setStatus("You can choose up to 3 treatments.", false);
    return;
  } else {
    state.selected.push(t);
  }
  syncTreatmentButtons();
  updateGenerateState();
}

function syncTreatmentButtons() {
  const ids = new Set(state.selected.map((t) => t.id));
  els.treatments.querySelectorAll(".h-treatment").forEach((b) => {
    const on = ids.has(b.dataset.id);
    b.classList.toggle("selected", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

function enterMultiMode() {
  if (state.multiMode) return;
  state.multiMode = true;
  els.treatmentTitle.textContent = "Choose treatments";
  els.multiHint.hidden = false;
  els.selectionCount.hidden = false;
  updateGenerateState();
}

els.treatmentNext.addEventListener("click", () => {
  const card = els.upload.closest(".h-card");
  if (card) card.scrollIntoView({ behavior: "smooth", block: "start" });
});

/* 6 · Photo handling ------------------------------------------------------- */
function handleFile(file) {
  if (!file) return;
  if (!file.type || !file.type.startsWith("image/")) {
    setStatus("Choose a photo file.", false);
    return;
  }
  const reader = new FileReader();
  reader.onerror = () => setStatus("That photo could not be opened. Try a JPEG.", false);
  reader.onload = (event) => {
    const img = new Image();
    img.onerror = () => setStatus("That photo could not be opened. Try a JPEG.", false);
    img.onload = () => {
      let w = img.width;
      let h = img.height;
      if (w > MAX_PHOTO || h > MAX_PHOTO) {
        const scale = MAX_PHOTO / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      const nextUrl = canvas.toDataURL("image/jpeg", 0.9);
      const replacing = state.photoDataUrl && nextUrl !== state.photoDataUrl;
      state.photoDataUrl = nextUrl;
      if (replacing) {
        /* A new face means the old previews no longer describe it. */
        state.previews = [];
        state.activePreviewId = null;
        state.sessionId = null;
        els.resultWrap.hidden = true;
        renderCache();
        persistCache();
      }
      els.preview.src = nextUrl;
      els.preview.style.display = "block";
      setStatus("", false);
      updateGenerateState();
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
}

els.camera.addEventListener("change", (e) => handleFile(e.target.files[0]));
els.upload.addEventListener("change", (e) => handleFile(e.target.files[0]));

/* 7 · Status & slider ------------------------------------------------------ */
function updateGenerateState() {
  const n = state.selected.length;
  els.treatmentNext.hidden = n < 1;
  els.generate.disabled = state.busy || !state.photoDataUrl || n < 1 || n > MAX_TREATMENTS;
  if (!state.multiMode) return;
  els.selectionCount.hidden = false;
  els.selectionCount.textContent =
    n === 1 ? "1 treatment selected · up to 3" : `${n} treatments selected · up to 3`;
}

/* Text nodes only: a server message must never be parsed as markup. */
function setStatus(msg, busy) {
  els.status.replaceChildren();
  if (msg) {
    if (busy) {
      const dot = document.createElement("span");
      dot.className = "h-spinner";
      els.status.appendChild(dot);
    }
    els.status.appendChild(document.createTextNode(msg));
  }
  reportHeight();
}

/* Left of the divider is before, right is after. pct is the divider position. */
function setSlider(pct) {
  const value = Math.max(0, Math.min(100, pct));
  els.afterImg.style.clipPath = `inset(0 0 0 ${value}%)`;
  els.handle.style.left = value + "%";
  els.divider.style.left = value + "%";
  els.handle.setAttribute("aria-valuenow", String(Math.round(value)));
  els.beforeBadge.style.opacity = String(Math.min(1, value / 22));
  els.afterBadge.style.opacity = String(Math.min(1, (100 - value) / 22));
}

function setSliderFromX(x) {
  const rect = els.sliderWrap.getBoundingClientRect();
  if (!rect.width) return;
  setSlider(((x - rect.left) / rect.width) * 100);
}

const reducedMotion = () =>
  window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* The divider glides in so the result reads as a reveal, not a swap. */
function sweepIntro(from = 100, to = 48, duration = 900) {
  if (reducedMotion()) {
    setSlider(to);
    return;
  }
  const start = performance.now();
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  (function step(now) {
    const p = Math.min(1, (now - start) / duration);
    setSlider(from + (to - from) * easeOut(p));
    if (p < 1) requestAnimationFrame(step);
  })(start);
}

let dragging = false;

function startDrag(e) {
  dragging = true;
  els.handle.classList.add("active");
  const point = e.touches ? e.touches[0] : e;
  setSliderFromX(point.clientX);
}

function drag(e) {
  if (!dragging) return;
  e.preventDefault();
  const point = e.touches ? e.touches[0] : e;
  setSliderFromX(point.clientX);
}

function endDrag() {
  if (!dragging) return;
  dragging = false;
  els.handle.classList.remove("active");
}

els.sliderWrap.addEventListener("mousedown", startDrag);
els.sliderWrap.addEventListener("touchstart", startDrag, { passive: false });
window.addEventListener("mousemove", drag);
window.addEventListener("touchmove", drag, { passive: false });
window.addEventListener("mouseup", endDrag);
window.addEventListener("touchend", endDrag);

els.handle.addEventListener("keydown", (e) => {
  const step = e.shiftKey ? 10 : 2;
  const pct = parseFloat(els.handle.getAttribute("aria-valuenow")) || 48;
  if (e.key === "ArrowLeft") {
    e.preventDefault();
    setSlider(pct - step);
  }
  if (e.key === "ArrowRight") {
    e.preventDefault();
    setSlider(pct + step);
  }
});

/* 8 · Preview cache -------------------------------------------------------- */
/* The frame shares one sessionStorage with every other tenant embedded from
   this browser, so the key is part of the record name and is checked on read.
   A cached preview can never leak from one studio into another. */
function storeKey() {
  return STORE_PREFIX + (state.key || "default");
}

function activePreview() {
  return state.previews.find((p) => p.id === state.activePreviewId) || null;
}

function showPreview(id, animate) {
  const preview = state.previews.find((x) => x.id === id);
  if (!preview || !state.photoDataUrl) return;
  state.activePreviewId = id;
  els.beforeImg.src = state.photoDataUrl;
  els.afterImg.src = preview.url;
  els.resultWrap.hidden = false;
  els.leadWrap.hidden = false;
  if (animate) {
    sweepIntro();
    els.resultWrap.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "center" });
  } else {
    setSlider(48);
  }
  renderCache();
  persistCache();
  reportHeight();
}

function renderCache() {
  els.cacheList.replaceChildren();
  els.previewCache.hidden = state.previews.length === 0;
  state.previews.forEach((preview) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "h-cache-item" + (preview.id === state.activePreviewId ? " active" : "");
    btn.setAttribute("role", "listitem");
    btn.setAttribute("aria-pressed", preview.id === state.activePreviewId ? "true" : "false");
    btn.setAttribute("aria-label", "Open preview: " + preview.labels.join(", "));
    const img = document.createElement("img");
    img.src = preview.url;
    img.alt = "";
    const label = document.createElement("span");
    label.textContent = preview.labels.join(" + ");
    btn.append(img, label);
    btn.addEventListener("click", () => showPreview(preview.id, false));
    els.cacheList.appendChild(btn);
  });
}

function persistCache() {
  try {
    sessionStorage.setItem(storeKey(), JSON.stringify({
      key: state.key,
      photoDataUrl: state.photoDataUrl,
      sessionId: state.sessionId,
      multiMode: state.multiMode,
      leadSent: state.leadSent,
      activePreviewId: state.activePreviewId,
      previews: state.previews,
    }));
  } catch (err) {
    /* Quota or partitioned storage: the in-page list still works. */
  }
}

function restoreCache() {
  let saved;
  try {
    saved = JSON.parse(sessionStorage.getItem(storeKey()) || "null");
  } catch (err) {
    return;
  }
  if (!saved || saved.key !== state.key || !saved.photoDataUrl) return;
  if (!Array.isArray(saved.previews) || !saved.previews.length) return;

  state.photoDataUrl = saved.photoDataUrl;
  state.sessionId = saved.sessionId || null;
  state.previews = saved.previews;
  state.activePreviewId = saved.activePreviewId;
  state.leadSent = !!saved.leadSent;
  els.preview.src = saved.photoDataUrl;
  els.preview.style.display = "block";

  const current = activePreview() || state.previews[state.previews.length - 1];
  state.selected = (current.treatmentIds || [])
    .map((id) => (state.config.treatments || []).find((t) => t.id === id))
    .filter(Boolean);
  if (saved.multiMode || state.previews.length) enterMultiMode();
  syncTreatmentButtons();
  showPreview(current.id, false);
  if (state.leadSent) showInfoSent();
}

/* 9 · Generate ------------------------------------------------------------- */
els.generate.addEventListener("click", async () => {
  if (state.busy || !state.photoDataUrl || !state.selected.length) return;
  const batch = state.selected.slice();
  state.busy = true;
  updateGenerateState();
  setStatus("Generating your preview…", true);
  try {
    const data = await api("/generate", {
      body: {
        imageDataUrl: state.photoDataUrl,
        treatmentIds: batch.map((t) => t.id),
        sessionId: state.sessionId,
      },
    });
    if (data.sessionId) state.sessionId = data.sessionId;
    if (!data.resultDataUrl) throw new Error("The preview could not be generated. Try again.");
    state.previews.push({
      id: data.previewId,
      treatmentIds: batch.map((t) => t.id),
      labels: batch.map((t) => t.label),
      intensity: "medium",
      url: data.resultDataUrl,
    });
    enterMultiMode();
    showPreview(state.previews[state.previews.length - 1].id, true);
    setStatus("Done — slide to compare.", false);
    post("preview", { treatmentIds: batch.map((t) => t.id) });
  } catch (err) {
    setStatus("⚠ " + err.message, false);
  } finally {
    state.busy = false;
    updateGenerateState();
  }
});

els.again.addEventListener("click", () => {
  const card = els.treatments.closest(".h-card");
  if (card) card.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
});

/* 10 · Download ------------------------------------------------------------ */
els.download.addEventListener("click", async () => {
  const current = activePreview();
  if (!current) return;
  const name = current.treatmentIds.join("-") || "preview";
  try {
    const blob = await (await fetch(current.url)).blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "treatment-preview-" + name + ".jpg";
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  } catch (err) {
    window.open(current.url, "_blank", "noopener");
  }
});

/* 11 · Lead form ----------------------------------------------------------- */
function showInfoSent() {
  els.leadForm.hidden = true;
  els.infoSent.hidden = false;
  reportHeight();
}

els.leadForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = new FormData(els.leadForm);
  const name = String(data.get("name") || "").trim();
  const phone = String(data.get("phone") || "").trim();
  const email = String(data.get("email") || "").trim();
  const city = String(data.get("city") || "").trim();
  const consent = data.get("consent") === "on";
  if (!name || !city || (!phone && !email) || !consent) {
    els.leadError.hidden = false;
    els.leadError.textContent = !phone && !email
      ? "Add a phone number or email so the studio can reach you."
      : "Please complete the form.";
    reportHeight();
    return;
  }
  if (!state.sessionId || !state.previews.length) {
    els.leadError.hidden = false;
    els.leadError.textContent = "Generate a preview first.";
    reportHeight();
    return;
  }
  els.leadError.hidden = true;
  const submit = els.leadForm.querySelector("button[type=submit]");
  submit.disabled = true;
  try {
    await api("/leads", {
      body: {
        sessionId: state.sessionId,
        name,
        phone,
        email,
        city,
        consent: true,
        /* The page the widget is embedded in, not the frame URL, so the clinic
           can see which page produced the lead. */
        sourceUrl: state.parentUrl || document.referrer || location.href,
      },
    });
    state.leadSent = true;
    showInfoSent();
    persistCache();
    const current = activePreview();
    post("lead", { treatmentIds: (current && current.treatmentIds) || [] });
  } catch (err) {
    els.leadError.hidden = false;
    els.leadError.textContent = err.message;
    reportHeight();
  } finally {
    submit.disabled = false;
  }
});

els.closeBtn.addEventListener("click", () => post("close"));




