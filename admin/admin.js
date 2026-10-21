"use strict";

const API = "https://qqrcxbmbulfsvgbqjngz.supabase.co/functions/v1/hebelie-api";
const TOKEN_KEY = "hebelie-desk-token";

const board = document.getElementById("board");
const boardError = document.getElementById("boardError");
const leadList = document.getElementById("leadList");
const leadCount = document.getElementById("leadCount");
const signOut = document.getElementById("signOut");
const who = document.getElementById("who");
const createClinic = document.getElementById("createClinic");
const createError = document.getElementById("createError");
const createOk = document.getElementById("createOk");

const deskTabs = document.getElementById("deskTabs");
const views = {
  leads: document.getElementById("viewLeads"),
  widget: document.getElementById("viewWidget"),
};
const widgetCount = document.getElementById("widgetCount");
const widgetReady = document.getElementById("widgetReady");
const widgetEmpty = document.getElementById("widgetEmpty");
const widgetPreview = document.getElementById("widgetPreview");
const previewNote = document.getElementById("previewNote");
const keyList = document.getElementById("keyList");
const keyPick = document.getElementById("keyPick");
const keySelect = document.getElementById("keySelect");
const snippet = document.getElementById("snippet");
const copySnippet = document.getElementById("copySnippet");
const copyOk = document.getElementById("copyOk");
const createFirstKey = document.getElementById("createFirstKey");
const newKey = document.getElementById("newKey");
const keyError = document.getElementById("keyError");
const keyOk = document.getElementById("keyOk");
const modeButtons = [...document.querySelectorAll(".desk-mode [data-mode]")];

let platform = false;
let keys = [];
let maxKeys = 10;
let mode = "inline";
let selectedKeyId = "";
let previewSignature = "";
let widgetPending = false;

function token() {
  return sessionStorage.getItem(TOKEN_KEY) || "";
}

function showError(el, message) {
  el.hidden = !message;
  el.textContent = message || "";
}

function goToLogin() {
  sessionStorage.removeItem(TOKEN_KEY);
  location.replace(hebelieRoot() + "login/");
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (token()) headers.set("x-admin-token", token());
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(API + path, { ...options, headers });
  if (res.status === 401) {
    goToLogin();
    throw new Error("Sign in again");
  }
  return res;
}

async function imageUrl(path) {
  if (!path) return "";
  const res = await api("/admin/media?path=" + encodeURIComponent(path));
  if (!res.ok) return "";
  return URL.createObjectURL(await res.blob());
}

function when(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function showView(name) {
  const target = name === "widget" ? "widget" : "leads";
  for (const [view, panel] of Object.entries(views)) panel.hidden = view !== target;
  for (const tab of deskTabs.querySelectorAll("[data-view]")) {
    const on = tab.dataset.view === target;
    tab.classList.toggle("is-on", on);
    tab.setAttribute("aria-selected", on ? "true" : "false");
  }
}

/* The desk is served from the same place as widget/embed.js, so deriving the URL
   from the desk's own address gives a working snippet on Pages, on a custom
   domain and on localhost:8787 with no build step and no constant to update. */
function embedSrc() {
  return new URL("../widget/embed.js", location.href).href;
}

function snippetFor(publicKey) {
  /* The closing tag is split so this line can never be mistaken for the end of
     the script block that contains it. */
  return `<script src="${embedSrc()}"
        data-hebelie-key="${publicKey}"
        data-hebelie-mode="${mode}"
        defer><\/script>`;
}

function currentKey() {
  return keys.find((key) => key.id === selectedKeyId) || keys[0] || null;
}

async function renderLeads(leads) {
  leadList.replaceChildren();
  leadCount.textContent = leads.length === 1 ? "1 lead" : leads.length + " leads";
  if (!leads.length) {
    const empty = document.createElement("p");
    empty.className = "desk-empty";
    empty.textContent = "No leads yet. They appear here after someone sends their details.";
    leadList.appendChild(empty);
    return;
  }
  for (const lead of leads) {
    const card = document.createElement("article");
    card.className = "desk-card";
    const contact = [lead.phone, lead.email, lead.city].filter(Boolean).join(" · ");
    card.innerHTML = `
      <h2></h2>
      <p class="desk-clinic" hidden></p>
      <p class="desk-meta"></p>
      <ul class="desk-tags"></ul>
      <div class="desk-photos"></div>`;
    card.querySelector("h2").textContent = lead.name;
    if (platform && lead.accountName) {
      const clinic = card.querySelector(".desk-clinic");
      clinic.hidden = false;
      clinic.textContent = lead.accountName;
    }
    card.querySelector(".desk-meta").textContent = contact + " · " + when(lead.createdAt);
    const tags = card.querySelector(".desk-tags");
    (lead.treatments || []).forEach((name) => {
      const li = document.createElement("li");
      li.textContent = name;
      tags.appendChild(li);
    });
    const photos = card.querySelector(".desk-photos");
    const figures = [{ caption: "Uploaded", path: lead.photoPath }];
    (lead.previews || []).forEach((preview) => {
      figures.push({
        caption: "Generated · " + (preview.treatments || []).join(" + "),
        path: preview.resultPath,
      });
    });
    for (const figure of figures) {
      const wrap = document.createElement("figure");
      const img = document.createElement("img");
      img.alt = figure.caption;
      const caption = document.createElement("figcaption");
      caption.textContent = figure.caption;
      wrap.append(img, caption);
      photos.appendChild(wrap);
      if (figure.path) img.src = await imageUrl(figure.path);
    }
    leadList.appendChild(card);
  }
}

async function loadLeads() {
  showError(boardError, "");
  const res = await api("/admin/leads");
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    showError(boardError, data.error || "Could not load leads");
    /* null rather than [], so a failed load never reads as an empty clinic and
       never decides which tab the desk opens on. */
    return null;
  }
  const leads = data.leads || [];
  await renderLeads(leads);
  return leads;
}

/* Widget tab --------------------------------------------------------------- */

function keyRow(key) {
  const row = document.createElement("li");
  row.className = "desk-key-row";

  const main = document.createElement("div");
  main.className = "desk-key-main";
  const label = document.createElement("p");
  label.className = "desk-key-label";
  label.textContent = key.label || "Untitled key";
  const code = document.createElement("code");
  code.className = "desk-key-code";
  /* A key is a public identifier, so showing all of it is the point: it has to
     stay recognisable in a page's source. */
  code.textContent = key.publicKey;
  const meta = document.createElement("p");
  meta.className = "desk-key-meta";
  meta.textContent = "Added " + when(key.createdAt) +
    (key.lastUsedAt ? " · Last seen " + when(key.lastUsedAt) : " · Never seen");
  main.append(label, code, meta);

  const actions = document.createElement("div");
  actions.className = "desk-key-actions";
  const using = key.id === (currentKey() || {}).id;
  const use = document.createElement("button");
  use.type = "button";
  use.className = "btn-ghost";
  use.textContent = using ? "In snippet" : "Use";
  use.disabled = using;
  use.addEventListener("click", () => {
    selectedKeyId = key.id;
    renderWidget();
  });
  const revoke = document.createElement("button");
  revoke.type = "button";
  revoke.className = "btn-ghost";
  revoke.textContent = "Revoke";
  revoke.addEventListener("click", () => revokeKey(key, revoke));
  actions.append(use, revoke);

  row.append(main, actions);
  return row;
}

function clearPreview() {
  previewSignature = "";
  widgetPreview.replaceChildren();
  /* Floating mode mounts its launcher and panel on document.body rather than
     beside the script tag, so emptying the box does not remove them. */
  document.querySelectorAll(".heb-launcher, .heb-panel").forEach((node) => node.remove());
  /* embed.js refuses to mount twice for the same key, so the previous run has to
     be forgotten before the next one starts. */
  delete window.HebelieWidget;
}

function mountPreview(publicKey) {
  const signature = mode + "|" + publicKey;
  if (signature === previewSignature) return;
  clearPreview();
  previewSignature = signature;
  previewNote.textContent = mode === "floating"
    ? "Floating mode pins a button to the corner of this page, exactly as it will on the clinic site. Press it to open the widget."
    : "Inline mode sits in the page flow, exactly as it will on the clinic site.";

  const script = document.createElement("script");
  script.src = embedSrc();
  /* document.currentScript is set for an inserted script, so embed.js reads its
     own URL and the key from this tag with no extra wiring. */
  script.dataset.hebelieKey = publicKey;
  script.dataset.hebelieMode = mode;
  widgetPreview.appendChild(script);
}

function renderWidget() {
  const count = keys.length;
  widgetCount.textContent = count === 1
    ? "1 active key"
    : count ? count + " active keys" : "No active keys";
  widgetReady.hidden = !count;
  widgetEmpty.hidden = !!count;

  keyPick.hidden = count < 2;
  keyList.replaceChildren();
  keySelect.replaceChildren();
  for (const key of keys) {
    const option = document.createElement("option");
    option.value = key.id;
    option.textContent = key.label || key.publicKey;
    keySelect.appendChild(option);
    keyList.appendChild(keyRow(key));
  }

  const key = currentKey();
  if (key) keySelect.value = key.id;
  snippet.textContent = key ? snippetFor(key.publicKey) : "";
  copySnippet.disabled = !key;
  copyOk.hidden = true;

  if (key) mountPreview(key.publicKey);
  else clearPreview();

  const addButton = newKey.querySelector("button[type=submit]");
  addButton.disabled = count >= maxKeys;
  addButton.title = count >= maxKeys ? "Revoke a key before adding another" : "";
}

async function loadWidget() {
  if (widgetPending) return;
  widgetPending = true;
  try {
    showError(keyError, "");
    const res = await api("/admin/widget");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Could not load the widget");
    keys = data.keys || [];
    maxKeys = Number(data.maxActiveKeys) || 10;
    if (!keys.some((key) => key.id === selectedKeyId)) {
      selectedKeyId = keys.length ? keys[0].id : "";
    }
    renderWidget();
  } catch (err) {
    if (err.message !== "Sign in again") showError(keyError, err.message);
  } finally {
    widgetPending = false;
  }
}

async function createKey(label, button) {
  showError(keyError, "");
  keyOk.hidden = true;
  if (button) button.disabled = true;
  try {
    const res = await api("/admin/widget/keys", {
      method: "POST",
      body: JSON.stringify({ label }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Could not create a key");
    if (data.key && data.key.id) selectedKeyId = data.key.id;
    await loadWidget();
    keyOk.hidden = false;
    keyOk.textContent = "New key created. The snippet above now uses it.";
    return true;
  } catch (err) {
    if (err.message !== "Sign in again") showError(keyError, err.message);
    return false;
  } finally {
    /* renderWidget owns this button once the cap is reached, so a failed call
       must not hand it back. */
    if (button) button.disabled = keys.length >= maxKeys;
  }
}

async function revokeKey(key, button) {
  if (!confirm("Revoke " + (key.label || key.publicKey) + "? Every site still using it stops working.")) return;
  showError(keyError, "");
  keyOk.hidden = true;
  button.disabled = true;
  try {
    const res = await api("/admin/widget/keys/revoke", {
      method: "POST",
      body: JSON.stringify({ id: key.id }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Could not revoke that key");
    if (selectedKeyId === key.id) selectedKeyId = "";
    await loadWidget();
    keyOk.hidden = false;
    keyOk.textContent = "Key revoked. Anything still using it is refused now.";
  } catch (err) {
    if (err.message !== "Sign in again") showError(keyError, err.message);
  } finally {
    button.disabled = false;
  }
}

deskTabs.addEventListener("click", (event) => {
  const tab = event.target.closest("[data-view]");
  if (!tab) return;
  showView(tab.dataset.view);
  if (tab.dataset.view === "widget") loadWidget();
});

for (const button of modeButtons) {
  button.addEventListener("click", () => {
    mode = button.dataset.mode === "floating" ? "floating" : "inline";
    for (const other of modeButtons) {
      const on = other === button;
      other.classList.toggle("is-on", on);
      other.setAttribute("aria-pressed", on ? "true" : "false");
    }
    const key = currentKey();
    if (!key) return;
    snippet.textContent = snippetFor(key.publicKey);
    mountPreview(key.publicKey);
  });
}

keySelect.addEventListener("change", () => {
  selectedKeyId = keySelect.value;
  renderWidget();
});

copySnippet.addEventListener("click", async () => {
  const key = currentKey();
  if (!key) return;
  const code = snippetFor(key.publicKey);
  copyOk.hidden = true;
  try {
    await navigator.clipboard.writeText(code);
  } catch (err) {
    /* Clipboard access needs a secure context, so a desk opened over plain http
       on a LAN address still gets a working copy through the selection path. */
    const area = document.createElement("textarea");
    area.className = "desk-copy-area";
    area.setAttribute("readonly", "");
    area.value = code;
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  copyOk.hidden = false;
});

newKey.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(newKey);
  const label = String(data.get("label") || "").trim();
  const ok = await createKey(label, newKey.querySelector("button[type=submit]"));
  if (ok) newKey.reset();
});

createFirstKey.addEventListener("click", () => {
  createKey("", createFirstKey);
});

createClinic.addEventListener("submit", async (event) => {
  event.preventDefault();
  showError(createError, "");
  createOk.hidden = true;
  const data = new FormData(createClinic);
  const button = createClinic.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const res = await api("/accounts", {
      method: "POST",
      body: JSON.stringify({
        clinicName: String(data.get("clinicName") || ""),
        email: String(data.get("email") || ""),
        password: String(data.get("password") || ""),
      }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error || "Could not create the clinic");
    createOk.hidden = false;
    createOk.textContent = payload.clinicName + " can sign in as " + payload.email + ".";
    createClinic.reset();
  } catch (err) {
    if (err.message !== "Sign in again") showError(createError, err.message);
  } finally {
    button.disabled = false;
  }
});

signOut.addEventListener("click", async () => {
  try {
    await api("/auth/logout", { method: "POST" });
  } catch (err) {
    /* Session may already be gone. */
  }
  goToLogin();
});

async function boot() {
  if (!token()) {
    location.replace(hebelieRoot() + "login/");
    return;
  }
  const res = await api("/auth/me");
  const profile = await res.json().catch(() => ({}));
  if (!res.ok) {
    showError(boardError, profile.error || "Could not open the desk");
    board.hidden = false;
    return;
  }
  platform = !!profile.platform;
  who.hidden = false;
  who.textContent = profile.platform ? profile.email + " · Admin" : profile.email + " · " + profile.clinicName;
  signOut.hidden = false;
  createClinic.hidden = !profile.platform;
  board.hidden = false;
  /* Both panels stay hidden until the landing tab is known, so a first-run
     clinic never sees the Leads empty state flash before the widget opens. */
  views.leads.hidden = true;
  views.widget.hidden = true;
  /* A thrown request (an offline desk) gives no verdict on the lead count, so the
     desk falls back to Leads, which is where that error is reported. */
  let leads = null;
  try {
    leads = await loadLeads();
  } catch (err) {
    if (err.message !== "Sign in again") showError(boardError, err.message || "Could not load leads");
  }
  /* A clinic with no leads has nothing to read and everything to set up, so it
     lands on the widget. A clinic with a history keeps its leads, and the
     platform admin always does: the desk is a support tool before it is a
     first-run screen. */
  const landing = platform || !leads || leads.length ? "leads" : "widget";
  showView(landing);
  if (landing === "widget") await loadWidget();
}

boot().catch(() => {});
