"use strict";

/* ==========================================================================
   Hebelie — app.js
   1. Config & data
   2. Element refs & state
   3. Treatments
   4. Photo handling
   5. Status helpers
   6. Before / after slider
   7. Preview cache
   8. Generate (fal.ai)
   9. Download
   10. Lead form
   ========================================================================== */

/* 1 · Config & data -------------------------------------------------------- */
const HEBELIE_API = "https://qqrcxbmbulfsvgbqjngz.supabase.co/functions/v1/hebelie-api";

/* Line-icon helper (24×24, stroke) */
const SVG = d => `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

/* UI-only metadata (card description + icon) keyed by treatment id.
   Prompts live in prompts.js — TREATMENTS, buildPrompt, buildRequest. */
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
    icon: SVG(`<path d="M5.5 12.5S8.5 7 12 7s6.5 5.5 6.5 5.5-3 5.5-6.5 5.5-6.5-5.5-6.5-5.5Z"/><circle cx="12" cy="12.5" r="2.2"/><path d="M6.5 5.5C8.3 4.3 10 3.8 12 3.8s3.7.5 5.5 1.7"/>`) }
};

/* 2 · Element refs & state ------------------------------------------------- */
const CACHE_KEY = "hebelie-preview-cache";

const els = {
  camera:     document.getElementById("cameraInput"),
  upload:     document.getElementById("uploadInput"),
  preview:    document.getElementById("preview"),
  treatments: document.getElementById("treatments"),
  treatmentTitle: document.getElementById("treatmentTitle"),
  treatmentNext: document.getElementById("treatmentNext"),
  multiHint:  document.getElementById("multiHint"),
  selectionCount: document.getElementById("selectionCount"),
  generate:   document.getElementById("generateBtn"),
  status:     document.getElementById("status"),
  resultWrap: document.getElementById("resultWrap"),
  sliderWrap: document.getElementById("sliderWrap"),
  beforeImg:  document.getElementById("beforeImg"),
  afterImg:   document.getElementById("afterImg"),
  handle:     document.getElementById("sliderHandle"),
  divider:    document.querySelector(".frame-divider"),
  beforeBadge: document.getElementById("beforeBadge"),
  afterBadge:  document.getElementById("afterBadge"),
  download:   document.getElementById("downloadBtn"),
  previewCache: document.getElementById("previewCache"),
  cacheList:  document.getElementById("cacheList"),
  again:      document.getElementById("againBtn"),
  leadWrap:   document.getElementById("leadWrap"),
  leadForm:   document.getElementById("leadForm"),
  leadError:  document.getElementById("leadError"),
  infoSent:   document.getElementById("infoSent")
};

let photoDataUrl = null;
let sessionId = null;
let selectedTreatments = [];
let multiMode = false;
let previews = [];
let activePreviewId = null;
let resultUrl = null;
let leadSent = false;

/* 3 · Treatments (list from prompts.js; visuals from UI_META) -------------- */
TREATMENTS.forEach(t => {
  const meta = UI_META[t.id] || {};
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "treatment";
  btn.innerHTML = `
    <span class="check" aria-hidden="true"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="m4 12.5 5.5 5.5L20 6.5"/></svg></span>
    <span class="t-icon">${meta.icon || ""}</span>
    <span class="name">${t.label}</span>
    <span class="desc">${meta.desc || ""}</span>`;
  btn.dataset.id = t.id;
  btn.setAttribute("aria-pressed", "false");
  btn.addEventListener("click", () => selectTreatment(t));
  els.treatments.appendChild(btn);
});

/* First preview is a single treatment. After that, 1–3 can be selected. */
function selectTreatment(t) {
  const idx = selectedTreatments.findIndex(x => x.id === t.id);
  if (!multiMode) {
    selectedTreatments = [t];
  } else if (idx >= 0) {
    selectedTreatments.splice(idx, 1);
  } else if (selectedTreatments.length >= 3) {
    setStatus("You can choose up to 3 treatments.", false);
    return;
  } else {
    selectedTreatments.push(t);
  }
  syncTreatmentButtons();
  updateGenerateState();
}

function syncTreatmentButtons() {
  const ids = new Set(selectedTreatments.map(t => t.id));
  els.treatments.querySelectorAll(".treatment").forEach(b => {
    const on = ids.has(b.dataset.id);
    b.classList.toggle("selected", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

function enterMultiMode() {
  if (multiMode) return;
  multiMode = true;
  els.treatmentTitle.textContent = "Choose treatments";
  els.generate.textContent = "Generate again";
  els.multiHint.hidden = false;
  els.selectionCount.hidden = false;
  updateGenerateState();
}

els.treatmentNext.addEventListener("click", () => {
  document.getElementById("photoCard").scrollIntoView({ behavior: "smooth", block: "start" });
});

/* 4 · Photo handling ------------------------------------------------------- */
function handleFile(file) {
  if (!file || !file.type.startsWith("image/")) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const MAX = 1024;
      let w = img.width, h = img.height;
      if (w > MAX || h > MAX) {
        const s = MAX / Math.max(w, h);
        w = Math.round(w * s);
        h = Math.round(h * s);
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      const nextUrl = canvas.toDataURL("image/jpeg", 0.9);
      const replacing = photoDataUrl && nextUrl !== photoDataUrl;
      photoDataUrl = nextUrl;
      if (replacing) {
        previews = [];
        activePreviewId = null;
        resultUrl = null;
        sessionId = null;
        els.resultWrap.hidden = true;
        renderCache();
        persistCache();
      }
      els.preview.src = photoDataUrl;
      els.preview.style.display = "block";
      updateGenerateState();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

els.camera.addEventListener("change", e => handleFile(e.target.files[0]));
els.upload.addEventListener("change", e => handleFile(e.target.files[0]));

/* 5 · Status helpers ------------------------------------------------------- */
function updateGenerateState() {
  const n = selectedTreatments.length;
  els.treatmentNext.hidden = n < 1;
  els.generate.disabled = !(photoDataUrl && n >= 1 && n <= 3);
  if (!multiMode) return;
  els.selectionCount.hidden = false;
  els.selectionCount.textContent = n === 1
    ? "1 treatment selected · up to 3"
    : `${n} treatments selected · up to 3`;
}

function setStatus(msg, busy) {
  els.status.innerHTML = busy ? `<span class="spinner"></span>${msg}` : msg;
}

/* 6 · Before / after slider ------------------------------------------------ */
/* Left of divider = before · right of divider = after
   pct = divider position (0–100%). After image is clipped from the left. */
function setSlider(pct) {
  pct = Math.max(0, Math.min(100, pct));
  els.afterImg.style.clipPath = `inset(0 0 0 ${pct}%)`;
  els.handle.style.left = pct + "%";
  els.divider.style.left = pct + "%";
  els.handle.setAttribute("aria-valuenow", Math.round(pct));
  els.beforeBadge.style.opacity = Math.min(1, pct / 22);
  els.afterBadge.style.opacity = Math.min(1, (100 - pct) / 22);
}

function setSliderFromX(x) {
  const rect = els.sliderWrap.getBoundingClientRect();
  setSlider(((x - rect.left) / rect.width) * 100);
}

/* Intro sweep: divider glides from 100% → 45% so the result wipes in */
function sweepIntro(from = 100, to = 45, dur = 950) {
  const t0 = performance.now();
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  (function step(now) {
    const p = Math.min(1, (now - t0) / dur);
    setSlider(from + (to - from) * easeOut(p));
    if (p < 1) requestAnimationFrame(step);
  })(t0);
}

/* Drag anywhere on the frame */
let dragging = false;
function startDrag(e) {
  dragging = true;
  els.handle.classList.add("active");
  const ev = e.touches ? e.touches[0] : e;
  setSliderFromX(ev.clientX);
}
function drag(e) {
  if (!dragging) return;
  e.preventDefault();
  const ev = e.touches ? e.touches[0] : e;
  setSliderFromX(ev.clientX);
}
function endDrag() {
  dragging = false;
  els.handle.classList.remove("active");
}

els.sliderWrap.addEventListener("mousedown", startDrag);
els.sliderWrap.addEventListener("touchstart", startDrag, { passive: false });
window.addEventListener("mousemove", drag);
window.addEventListener("touchmove", drag, { passive: false });
window.addEventListener("mouseup", endDrag);
window.addEventListener("touchend", endDrag);

els.handle.addEventListener("keydown", e => {
  const step = e.shiftKey ? 10 : 2;
  const pct = parseFloat(els.handle.getAttribute("aria-valuenow")) || 50;
  if (e.key === "ArrowLeft")  { e.preventDefault(); setSlider(pct - step); }
  if (e.key === "ArrowRight") { e.preventDefault(); setSlider(pct + step); }
});

/* 7 · Preview cache -------------------------------------------------------- */
/* Each successful generation stays in the list so a later run does not
   replace access to the earlier one. Session storage keeps them for this visit. */
function activePreview() {
  return previews.find(p => p.id === activePreviewId) || null;
}

function showPreview(id, animate) {
  const p = previews.find(x => x.id === id);
  if (!p || !photoDataUrl) return;
  activePreviewId = id;
  resultUrl = p.url;
  els.beforeImg.src = photoDataUrl;
  els.afterImg.src = p.url;
  els.resultWrap.hidden = false;
  els.leadWrap.hidden = false;
  if (animate) {
    sweepIntro();
    els.resultWrap.scrollIntoView({ behavior: "smooth" });
  } else {
    setSlider(45);
  }
  renderCache();
  persistCache();
}

function renderCache() {
  els.cacheList.replaceChildren();
  els.previewCache.hidden = previews.length === 0;
  previews.forEach(p => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cache-item" + (p.id === activePreviewId ? " active" : "");
    btn.setAttribute("role", "listitem");
    btn.setAttribute("aria-label", "Open preview: " + p.labels.join(", "));
    btn.setAttribute("aria-pressed", p.id === activePreviewId ? "true" : "false");
    const img = document.createElement("img");
    img.src = p.url;
    img.alt = "";
    const label = document.createElement("span");
    label.textContent = p.labels.join(" + ");
    btn.append(img, label);
    btn.addEventListener("click", () => showPreview(p.id, false));
    els.cacheList.appendChild(btn);
  });
}

function persistCache() {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({
      photoDataUrl,
      sessionId,
      multiMode,
      leadSent,
      activePreviewId,
      previews
    }));
  } catch (e) {
    /* Quota or private mode — the in-page list still works until refresh. */
  }
}

function restoreCache() {
  let saved;
  try {
    saved = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "null");
  } catch (e) {
    return;
  }
  if (!saved || !saved.photoDataUrl || !Array.isArray(saved.previews) || !saved.previews.length) return;

  photoDataUrl = saved.photoDataUrl;
  sessionId = saved.sessionId || null;
  els.preview.src = photoDataUrl;
  els.preview.style.display = "block";
  previews = saved.previews;
  activePreviewId = saved.activePreviewId;
  leadSent = !!saved.leadSent;

  const current = activePreview() || previews[previews.length - 1];
  selectedTreatments = (current.treatmentIds || [])
    .map(id => TREATMENTS.find(t => t.id === id))
    .filter(Boolean);
  if (saved.multiMode || previews.length) enterMultiMode();
  syncTreatmentButtons();
  showPreview(current.id, false);
  if (leadSent) showInfoSent();
  updateGenerateState();
}

/* 8 · Generate ---------------------------------------------------------------- */
els.generate.addEventListener("click", async () => {
  if (!photoDataUrl || !selectedTreatments.length) return;
  const batch = selectedTreatments.slice();
  els.generate.disabled = true;
  setStatus("Generating your preview…", true);
  try {
    const res = await fetch(HEBELIE_API + "/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageDataUrl: photoDataUrl,
        treatmentIds: batch.map(t => t.id),
        sessionId
      })
    });
    const data = await res.json().catch(() => ({}));
    if (data.sessionId) sessionId = data.sessionId;
    if (!res.ok || !data.resultDataUrl) throw new Error(data.error || "The preview could not be generated. Try again.");
    previews.push({
      id: data.previewId,
      treatmentIds: batch.map(t => t.id),
      labels: batch.map(t => t.label),
      intensity: "medium",
      url: data.resultDataUrl
    });
    enterMultiMode();
    showPreview(previews[previews.length - 1].id, true);
    setStatus("Done — slide to compare. Earlier previews stay under the result.", false);
  } catch (err) {
    setStatus("⚠ " + err.message, false);
  } finally {
    updateGenerateState();
  }
});

els.again.addEventListener("click", () => {
  document.getElementById("treatmentCard").scrollIntoView({ behavior: "smooth", block: "start" });
});

/* 9 · Download ------------------------------------------------------------- */
els.download.addEventListener("click", async () => {
  const current = activePreview();
  if (!current) return;
  const name = current.treatmentIds.join("-");
  try {
    const blob = await (await fetch(current.url)).blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "hebelie-preview-" + name + ".jpg";
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) {
    window.open(current.url, "_blank");
  }
});

/* 10 · Lead form ----------------------------------------------------------- */
function showInfoSent() {
  els.leadForm.hidden = true;
  els.infoSent.hidden = false;
}

els.leadForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = new FormData(els.leadForm);
  const name = String(data.get("name") || "").trim();
  const phone = String(data.get("phone") || "").trim();
  const email = String(data.get("email") || "").trim();
  const city = String(data.get("city") || "").trim();
  if (!name || !city || (!phone && !email) || !data.get("consent")) {
    els.leadError.hidden = false;
    els.leadError.textContent = (!phone && !email)
      ? "Add a phone number or email so we can reach you."
      : "Please complete the form.";
    return;
  }
  if (!sessionId) {
    els.leadError.hidden = false;
    els.leadError.textContent = "Generate a preview first.";
    return;
  }
  els.leadError.hidden = true;
  const submit = els.leadForm.querySelector("button[type=submit]");
  submit.disabled = true;
  try {
    const res = await fetch(HEBELIE_API + "/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        name,
        phone,
        email,
        city,
        consent: true,
        sourceUrl: location.href
      })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "Could not send your details.");
    leadSent = true;
    showInfoSent();
    persistCache();
  } catch (err) {
    els.leadError.hidden = false;
    els.leadError.textContent = err.message;
  } finally {
    submit.disabled = false;
  }
});

restoreCache();
