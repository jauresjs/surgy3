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
  install: document.getElementById("viewInstall"),
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
const installWhere = document.getElementById("installWhere");
const platformPicker = document.getElementById("platformPicker");
const installError = document.getElementById("installError");
const installStatus = document.getElementById("installStatus");
const copyInstall = document.getElementById("copyInstall");
const installCopyOk = document.getElementById("installCopyOk");
const installOne = document.getElementById("installOne");
const installOneOk = document.getElementById("installOneOk");
const installWhereTo = document.getElementById("installWhereTo");
const installMailto = document.getElementById("installMailto");
const installSnippet = document.getElementById("installSnippet");
const installCodeNote = document.getElementById("installCodeNote");
const ctaLabel = document.getElementById("ctaLabel");
const ctaCount = document.getElementById("ctaCount");
const ctaStage = document.getElementById("ctaStage");
const ctaPreview = document.getElementById("ctaPreview");
const brandPrimary = document.getElementById("brandPrimary");
const brandAccent = document.getElementById("brandAccent");
const brandPrimaryPick = document.getElementById("brandPrimaryPick");
const brandAccentPick = document.getElementById("brandAccentPick");
const treatmentOrder = document.getElementById("treatmentOrder");
const saveInstall = document.getElementById("saveInstall");
const saveOk = document.getElementById("saveOk");
const saveError = document.getElementById("saveError");
const cornerButtons = [...document.querySelectorAll("[data-corner]")];
const themeButtons = [...document.querySelectorAll("[data-theme]")];
const modeButtons = [...document.querySelectorAll(".desk-mode [data-mode]")];
const formButtons = [...document.querySelectorAll(".desk-form [data-form]")];

let platform = false;
let keys = [];
let maxKeys = 10;
let mode = "inline";
let snippetForm = "slot";
let selectedKeyId = "";
let previewSignature = "";
let widgetPending = false;
/* Why the key list is empty, as distinct from the list being empty. The Widget
   and Install tabs both read it, and only the one on screen shows it. */
let keysError = "";
/* Install hands out the same line on every platform: the platform decides where
   the line goes, not what it says. The div slot form stays on the Widget tab,
   where a clinic that wants the widget inside a page can see what it looks like. */
let installPlatform = "wordpress";
/* The clinic name, from /auth/me. Only the work-order email uses it, and only to
   say whose site the button belongs on. */
let clinicName = "";
/* The colours stored on the account, as the server last reported them. */
let brandState = { primary: "", accent: "" };
/* Every treatment this clinic sells, in the order the server says the frame lists
   them. The order is part of the widget, so the desk edits a copy of this. */
let catalog = [];
/* The settings the Install tab is editing: wording, corner, theme, colours and the
   treatment order. It is live state rather than a reading of the DOM, because the
   line, the preview button and the work-order email are all rebuilt from it. */
let look = null;
/* False means the next render must write `look` into the controls. Set after a
   fetch or a save, cleared as soon as the controls own the values. */
let lookSeeded = false;

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

/* "seen 2 minutes ago" is the one timestamp a clinic reads as a live check, so it
   reads coarsely and drops to an absolute date once a day has passed. */
function ago(iso) {
  if (!iso) return "just now";
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(seconds) || seconds < 90) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return minutes + (minutes === 1 ? " minute ago" : " minutes ago");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours + (hours === 1 ? " hour ago" : " hours ago");
  return when(iso);
}

/* A view is named by a tab and by a link (?view=install), so both paths validate
   the name the same way: an inherited object key is not a panel in this desk. */
function hasView(name) {
  return Boolean(name) &&
    Object.prototype.hasOwnProperty.call(views, name) &&
    Boolean(views[name]);
}

/* ?view=install is how a link outside the desk names a tab. An unknown name is
   ignored rather than reported: a stale bookmark should open the desk, not an
   error state. */
function requestedView() {
  const name = new URLSearchParams(location.search).get("view") || "";
  return hasView(name) ? name : "";
}

function showView(name) {
  /* A tab is the only thing that can name a view, so an unknown name is a desk
     bug rather than a state to render: Leads is the one panel that is always
     safe to land on. */
  const target = hasView(name) ? name : "leads";
  for (const [view, panel] of Object.entries(views)) panel.hidden = view !== target;
  for (const tab of deskTabs.querySelectorAll("[data-view]")) {
    const on = tab.dataset.view === target;
    tab.classList.toggle("is-on", on);
    tab.setAttribute("aria-selected", on ? "true" : "false");
  }
}

/* The desk is served from the same place as widget/embed.js, so deriving the URL
   from the desk's own address works on Pages, on a custom domain and on
   localhost:8787 with no build step and no constant to update. */
const WIDGET_VERSION = "v1";

/* Two URLs, because the preview and the snippet answer different questions. The
   preview is the desk talking to itself, so it loads the unversioned loader: a
   desk opened under a plain `python -m http.server` has no /widget/v1/ folder,
   and the preview should never be the thing that breaks when a version freezes.
   The snippet is what a clinic pastes, so it names the version and keeps working
   the day v2 ships beside v1. */
function previewSrc() {
  return new URL("../widget/embed.js", location.href).href;
}

function snippetSrc() {
  return new URL("../widget/" + WIDGET_VERSION + "/embed.js", location.href).href;
}

/* The host the widget frame is served from, which is also where a frame opened
   on its own reports itself from. A key "live" on this host is a key somebody
   looked at, not one installed anywhere. */
function widgetOrigin() {
  try {
    return new URL(snippetSrc()).origin;
  } catch (err) {
    return "";
  }
}

/* The origin to trust as a clinic's own site. The API already refuses to stamp
   first-party pages, but a desk that ignores its own host anyway means one
   misconfigured deployment cannot make every key look installed. */
function clinicOrigin(key) {
  const origin = (key && key.lastParentOrigin) || "";
  if (!origin) return "";
  if (origin === location.origin || origin === widgetOrigin()) return "";
  return origin;
}

/* The wording the desk would save right now, capped exactly as the server caps
   it, so the line can never carry something the save would refuse. */
function draftLabel() {
  const typed = String(ctaLabel.value || "").replace(/\s+/g, " ").trim().slice(0, 40);
  return typed || "Preview a treatment";
}

/* One colour, or nothing. The text field is the source of truth: a colour input
   cannot be empty, so an empty field is how a clinic asks for the Hebelie palette
   back. A half-typed "#8b5e" is not a colour and never reaches the server. */
function colourOf(value) {
  const colour = String(value || "").trim();
  if (!colour) return "";
  const withHash = colour.charAt(0) === "#" ? colour : "#" + colour;
  return /^#[0-9a-f]{6}$/i.test(withHash) ? withHash.toLowerCase() : "";
}

function themeName() {
  if (!look || look.theme === "light") return "light";
  return look.theme === "dark" ? "dark" : "automatic";
}

/* The line the desk hands a clinic: every setting rides in the loader's own URL, so
   a footer field that keeps a URL but drops attributes still gets a working widget,
   and there is nothing in the page to keep in sync. The wording is always spelled
   out — it is the one setting a clinic reads in the line — while the corner and the
   theme are only named when they differ from the loader's own defaults. */
function lineSnippet(publicKey) {
  const params = [
    "key=" + encodeURIComponent(publicKey),
    "mode=floating",
    "label=" + encodeURIComponent(draftLabel()),
  ];
  if (look && look.launcherPosition === "bottom-left") params.push("launcher-position=bottom-left");
  if (look && look.theme !== "light") params.push("theme=" + look.theme);
  return `<script src="${snippetSrc()}?${params.join("&")}" defer><\/script>`;
}

function snippetFor(publicKey, form = snippetForm) {
  const src = snippetSrc();
  if (form === "line") return lineSnippet(publicKey);
  /* A div slot is the install for a clinic that wants the widget inside the page:
     the slot says where it goes, so the snippet never has to be kept in sync with
     the page's markup. The tag form stays for a site that can only add a script —
     a tag manager, an embed field that takes no HTML. */
  if (form === "tag") {
    /* The closing tag is split so this line can never be mistaken for the end of
       the script block that contains it. */
    return `<script src="${src}"
        data-hebelie-key="${publicKey}"
        data-hebelie-mode="${mode}"
        defer><\/script>`;
  }
  /* A slot's own attributes win over the script tag's, so the mode rides on the
     div: that keeps the slot self-describing, and lets two slots on one page
     differ. Inline is the default, so only a floating install spells it out. */
  const slotMode = mode === "floating" ? ` data-hebelie-mode="floating"` : "";
  return `<div data-hebelie-widget="${publicKey}"${slotMode}></div>
<script src="${src}" defer><\/script>`;
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
  /* last_used_at cannot answer this: the desk's own preview rescans the key, so a
     key that never left this page looks used. Only a page that is not ours can
     make a key "live". */
  const origin = clinicOrigin(key);
  meta.textContent = "Added " + when(key.createdAt) + " · " + (origin
    ? "Live on " + origin + " · seen " + ago(key.lastParentAt)
    : "Not seen on a site yet");
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
  /* The loader's registry is per page, and it keeps an instance only while its
     slot is still in the document, so emptying the box above is what tells the
     next run it may mount again. Dropping the global keeps the two in step. */
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
  script.src = previewSrc();
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

/* The key list is the one thing both tabs read, so it is fetched once and held.
   Returning whether the fetch worked, rather than only rendering, is what lets
   the Install tab tell "no key yet" apart from "could not ask". */
async function fetchKeys() {
  if (widgetPending) return false;
  widgetPending = true;
  try {
    showError(keyError, "");
    keysError = "";
    const res = await api("/admin/widget");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Could not load the widget");
    keys = data.keys || [];
    maxKeys = Number(data.maxActiveKeys) || 10;
    /* The Install tab configures a key and the account behind it, and both arrive
       on this one call: two round trips could render controls that describe a
       different clinic than the key they save against. */
    brandState = {
      primary: (data.brand && data.brand.primary) || "",
      accent: (data.brand && data.brand.accent) || "",
    };
    catalog = Array.isArray(data.treatments) ? data.treatments : [];
    lookSeeded = false;
    if (!keys.some((key) => key.id === selectedKeyId)) {
      selectedKeyId = keys.length ? keys[0].id : "";
    }
    return true;
  } catch (err) {
    if (err.message !== "Sign in again") {
      keysError = err.message || "Could not load the widget";
      showError(keyError, keysError);
    }
    return false;
  } finally {
    widgetPending = false;
  }
}

async function loadWidget() {
  if (await fetchKeys()) renderWidget();
}

/* Entering Install must not mount the preview: the preview is a real widget
   request, and a tab opened to read instructions should not start one. */
async function loadInstall() {
  if (!keys.length) await fetchKeys();
  renderInstall();
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

/* Install tab ------------------------------------------------------------- */

/* Where each platform keeps its site-wide footer. Naming a screen is the whole job
   here: "add the code to your site" is the sentence that turns an install into a
   support thread, and one sentence per platform is enough to avoid it — the line
   itself no longer changes shape between them. */
const PLATFORMS = [
  {
    key: "wordpress",
    name: "WordPress",
    paste: "in footer.php, just above the closing body tag — or the Footer template part in the Site Editor",
  },
  {
    key: "shopify",
    name: "Shopify",
    paste: "in layout/theme.liquid, just above the closing body tag",
  },
  {
    key: "squarespace",
    name: "Squarespace",
    paste: "in Settings → Advanced → Code Injection → Footer",
  },
  {
    key: "wix",
    name: "Wix",
    paste: "in Settings → Custom Code → Body — end, then All pages",
  },
  {
    key: "custom",
    name: "Custom HTML",
    /* No platform at all: an HTML block, a page builder, a hand-edited theme.
       The end of the body is the one place that is always safe. */
    paste: "anywhere in the page body — the end of the page is safest",
  },
];

function currentPlatform() {
  return PLATFORMS.find((item) => item.key === installPlatform) || PLATFORMS[0];
}

/* The second route to a live install: the owner forwards the settings instead of
   pasting them. A mailto needs no backend and no address — it opens whichever mail
   client the owner already uses, with the To field left for them to fill.

   It is a work order rather than a bare snippet. The web person is being asked to
   paste one line, and the wording, the corner, the theme and the treatment order
   are the parts they cannot read out of that line. */
function mailtoFor(line) {
  const item = currentPlatform();
  const site = clinicName ? "the " + clinicName + " website" : "our website";
  const body = [
    "Hello,",
    "",
    "Could you add this to " + site + "? It is one line of code, and it adds a button visitors can press to preview a treatment.",
    "",
    line,
    "",
    "It goes " + item.paste + ".",
    "It only needs to run once per page, and nothing else on the site changes.",
    "",
    "What we set up on our side:",
    "· The button says: " + draftLabel(),
    "· It sits in the " + (look && look.launcherPosition === "bottom-left" ? "bottom-left" : "bottom-right")
      + " corner, in the " + themeName() + " theme.",
  ];
  if (look && (look.brandPrimary || look.brandAccent)) {
    body.push("· Brand colours: " + [look.brandPrimary, look.brandAccent].filter(Boolean).join(" and ") + ".");
  }
  if (look && look.treatments.length) {
    body.push("· The treatments, in this order: " + look.treatments.map((entry) => entry.label).join(", ") + ".");
  }
  body.push("", "Thank you.");
  return "mailto:?subject=" + encodeURIComponent("Add our treatment preview button to the website")
    + "&body=" + encodeURIComponent(body.join("\n"));
}

/* The one line a clinic comes back to read. last_used_at cannot answer it — the
   desk's own preview rescans the key — so the answer is the parent origin the
   API recorded, which it only writes for a page that is not ours. */
function installStatusText(key) {
  if (!key) return "No key yet. A key names the clinic inside the snippet.";
  const origin = clinicOrigin(key);
  if (origin) {
    return "Live on " + origin + " · seen " + ago(key.lastParentAt);
  }
  return "Not seen on a site yet. The desk's own preview doesn't count.";
}

function renderPlatforms() {
  platformPicker.replaceChildren();
  for (const item of PLATFORMS) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.platform = item.key;
    button.textContent = item.name;
    const on = item.key === installPlatform;
    button.classList.toggle("is-on", on);
    button.setAttribute("aria-pressed", on ? "true" : "false");
    button.addEventListener("click", () => {
      installPlatform = item.key;
      for (const other of platformPicker.querySelectorAll("[data-platform]")) {
        const chosen = other === button;
        other.classList.toggle("is-on", chosen);
        other.setAttribute("aria-pressed", chosen ? "true" : "false");
      }
      renderInstall();
    });
    platformPicker.appendChild(button);
  }
}

/* The look controls are seeded, not bound: a render rewrites them from `look` only
   when a fetch or a save has just replaced it, so typing in a field is never
   overwritten by an unrelated redraw. */
function seedLook() {
  const key = currentKey();
  look = {
    ctaLabel: (key && key.ctaLabel) || "Preview a treatment",
    launcherPosition: (key && key.launcherPosition) || "bottom-right",
    theme: (key && key.theme) || "light",
    brandPrimary: brandState.primary || "",
    brandAccent: brandState.accent || "",
    treatments: catalog.map((entry) => ({ id: entry.id, label: entry.label })),
  };
  lookSeeded = false;
}

function renderOrder() {
  treatmentOrder.replaceChildren();
  if (!look || !look.treatments.length) return;
  look.treatments.forEach((entry, index) => {
    const row = document.createElement("li");
    row.className = "desk-order-row";
    const name = document.createElement("span");
    name.className = "desk-order-name";
    name.textContent = entry.label;
    const move = document.createElement("div");
    move.className = "desk-order-move";
    for (const step of [-1, 1]) {
      const direction = step < 0 ? "up" : "down";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn-ghost";
      button.dataset.move = direction;
      button.dataset.index = String(index);
      button.textContent = step < 0 ? "↑" : "↓";
      button.setAttribute("aria-label", "Move " + entry.label + " " + direction);
      button.disabled = (step < 0 && index === 0) || (step > 0 && index === look.treatments.length - 1);
      button.addEventListener("click", () => moveTreatment(index, step, direction));
      move.appendChild(button);
    }
    row.append(name, move);
    treatmentOrder.appendChild(row);
  });
}

/* ↑ and ↓ rather than drag and drop: the list is short, and two buttons work with a
   keyboard, on a touch screen and through a screen reader with no extra code. */
function moveTreatment(index, step, direction) {
  const next = index + step;
  if (!look || next < 0 || next >= look.treatments.length) return;
  const [entry] = look.treatments.splice(index, 1);
  look.treatments.splice(next, 0, entry);
  renderOrder();
  /* A re-render drops the focused node, so focus follows the row that moved: a
     keyboard user can press the same key again without hunting for the button. */
  const again = treatmentOrder.querySelector('[data-move="' + direction + '"][data-index="' + next + '"]');
  if (again) again.focus();
  refreshInstall();
}

/* The preview is the launcher, drawn from the same values the loader will paint
   from: wording, corner, theme, and the one colour a clinic sees before opening. */
function paintPill() {
  const label = draftLabel();
  ctaPreview.textContent = label;
  ctaCount.textContent = label.length + "/40 characters";
  ctaStage.classList.toggle("is-left", Boolean(look && look.launcherPosition === "bottom-left"));
  ctaStage.classList.toggle("is-dark", Boolean(look && look.theme === "dark"));
  const primary = colourOf(brandPrimary.value);
  if (primary) ctaPreview.style.background = primary;
  else ctaPreview.style.removeProperty("background");
}

function renderLook() {
  ctaLabel.value = look.ctaLabel;
  brandPrimary.value = look.brandPrimary;
  brandAccent.value = look.brandAccent;
  /* A colour input cannot be empty, so its swatch only follows a colour the clinic
     actually set; an empty field leaves the swatch showing what was last picked. */
  if (colourOf(look.brandPrimary)) brandPrimaryPick.value = colourOf(look.brandPrimary);
  if (colourOf(look.brandAccent)) brandAccentPick.value = colourOf(look.brandAccent);
  for (const button of cornerButtons) {
    const on = button.dataset.corner === look.launcherPosition;
    button.classList.toggle("is-on", on);
    button.setAttribute("aria-pressed", on ? "true" : "false");
  }
  for (const button of themeButtons) {
    const on = button.dataset.theme === look.theme;
    button.classList.toggle("is-on", on);
    button.setAttribute("aria-pressed", on ? "true" : "false");
  }
  renderOrder();
  paintPill();
  lookSeeded = true;
}

/* Everything downstream of the settings: the sentence naming the paste location,
   the line itself, the email that carries it, and the status line that says whether
   it is live. Called on every keystroke, because the line follows the wording. */
function refreshInstall() {
  const key = currentKey();
  const line = key ? snippetFor(key.publicKey, "line") : "";
  /* Every platform takes the same line; only the file or screen it belongs in
     differs, and that is the one sentence worth placing beside the button that
     copies it. */
  installWhereTo.textContent = "Paste it " + currentPlatform().paste + ".";
  installMailto.href = mailtoFor(line || "<the Hebelie line from our desk>");
  installSnippet.textContent = line;
  installSnippet.hidden = !line;
  installCodeNote.hidden = Boolean(line);
  copyInstall.disabled = !line;
  installOne.disabled = !line;
  saveInstall.disabled = !key;
  installStatus.textContent = installStatusText(key);
  installStatus.classList.toggle("is-live", Boolean(clinicOrigin(key)));
  /* Any edit makes an older "Saved" untrue, and this runs on every edit. */
  saveOk.hidden = true;
}

/* The answer to a save is the stored state, not what was typed: a capped label or a
   treatment the catalog no longer carries comes back the way the next page view
   will read it. */
function applySaved(data) {
  if (data.key && data.key.id) {
    const at = keys.findIndex((entry) => entry.id === data.key.id);
    if (at >= 0) keys[at] = data.key;
  }
  if (data.brand) brandState = { primary: data.brand.primary || "", accent: data.brand.accent || "" };
  if (Array.isArray(data.treatments)) catalog = data.treatments;
  lookSeeded = false;
  renderInstall();
}

function renderInstall() {
  const key = currentKey();
  installWhere.textContent = key ? "Key: " + (key.label || key.publicKey) : "No key yet";
  if (!lookSeeded) {
    seedLook();
    renderLook();
  }
  refreshInstall();
  /* The platform picker re-renders this panel, so a confirmation naming the
     previous platform's file must not survive the choice. */
  installOneOk.hidden = true;
  installCopyOk.hidden = true;
  showError(saveError, "");
  showError(installError, keysError);
}

deskTabs.addEventListener("click", (event) => {
  const tab = event.target.closest("[data-view]");
  if (!tab) return;
  const view = tab.dataset.view;
  showView(view);
  if (view === "widget") loadWidget();
  else if (view === "install") loadInstall();
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

for (const button of formButtons) {
  button.addEventListener("click", () => {
    snippetForm = button.dataset.form === "tag" ? "tag" : "slot";
    for (const other of formButtons) {
      const on = other === button;
      other.classList.toggle("is-on", on);
      other.setAttribute("aria-pressed", on ? "true" : "false");
    }
    /* Only the snippet changes: the desk's own preview always mounts through the
       tag form, because that is the one shape that can be inserted into a live
       page after the loader has already run. */
    const key = currentKey();
    if (key) snippet.textContent = snippetFor(key.publicKey);
  });
}

keySelect.addEventListener("change", () => {
  selectedKeyId = keySelect.value;
  renderWidget();
});

/* One clipboard path for every Copy button on the desk: the snippet card and the
   Install tab copy the same text, and only the confirmation differs. */
async function copyCode(code, ok) {
  ok.hidden = true;
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
  ok.hidden = false;
}

for (const button of document.querySelectorAll("[data-copy]")) {
  button.addEventListener("click", () => {
    const key = currentKey();
    if (!key) return;
    const install = button.dataset.copy === "install";
    /* Each surface copies the shape it is showing: the Widget tab follows its own
       toggle, while Install hands out the one line every platform takes. */
    const code = install ? snippetFor(key.publicKey, "line") : snippetFor(key.publicKey);
    copyCode(code, install ? installCopyOk : copyOk);
  });
}

/* The Install tab's one button: copy the line, then name the place it goes. The
   clipboard write is the same path every other Copy button uses, so a desk
   opened over plain http on a LAN address still copies through the fallback. */
installOne.addEventListener("click", async () => {
  const key = currentKey();
  if (!key) return;
  const item = currentPlatform();
  await copyCode(snippetFor(key.publicKey, "line"), installOneOk);
  installOneOk.textContent = "Copied. Paste it " + item.paste + ".";
});

/* The look controls ------------------------------------------------------- */

/* Two controls, one colour. The text field decides: it is the one that can be
   empty, and empty is how a clinic asks for the Hebelie palette back. A half-typed
   "#8b5e" is not a colour yet, so the last valid one stays and the preview does not
   flash between keystrokes. */
function adoptColour(field, pick, slot) {
  if (!look) return;
  const colour = colourOf(field.value);
  if (colour) {
    look[slot] = colour;
    pick.value = colour;
  } else if (!field.value.trim()) {
    look[slot] = "";
  }
  paintPill();
  refreshInstall();
}

function adoptPick(field, pick, slot) {
  if (!look) return;
  field.value = pick.value;
  look[slot] = colourOf(pick.value);
  paintPill();
  refreshInstall();
}

ctaLabel.addEventListener("input", () => {
  paintPill();
  refreshInstall();
});
brandPrimary.addEventListener("input", () => adoptColour(brandPrimary, brandPrimaryPick, "brandPrimary"));
brandAccent.addEventListener("input", () => adoptColour(brandAccent, brandAccentPick, "brandAccent"));
brandPrimaryPick.addEventListener("input", () => adoptPick(brandPrimary, brandPrimaryPick, "brandPrimary"));
brandAccentPick.addEventListener("input", () => adoptPick(brandAccent, brandAccentPick, "brandAccent"));

for (const button of cornerButtons) {
  button.addEventListener("click", () => {
    if (!look) return;
    look.launcherPosition = button.dataset.corner === "bottom-left" ? "bottom-left" : "bottom-right";
    for (const other of cornerButtons) {
      const on = other === button;
      other.classList.toggle("is-on", on);
      other.setAttribute("aria-pressed", on ? "true" : "false");
    }
    paintPill();
    refreshInstall();
  });
}

for (const button of themeButtons) {
  button.addEventListener("click", () => {
    if (!look) return;
    const theme = button.dataset.theme;
    look.theme = theme === "dark" || theme === "auto" ? theme : "light";
    for (const other of themeButtons) {
      const on = other === button;
      other.classList.toggle("is-on", on);
      other.setAttribute("aria-pressed", on ? "true" : "false");
    }
    paintPill();
    refreshInstall();
  });
}

/* One save for all five settings. The server answers with what it stored, so the
   desk re-renders from that rather than from what was typed: a capped label or a
   treatment the catalog no longer carries then shows up as it really is. */
saveInstall.addEventListener("click", async () => {
  const key = currentKey();
  if (!key || !look) return;
  showError(saveError, "");
  saveOk.hidden = true;
  saveInstall.disabled = true;
  try {
    const res = await api("/admin/widget/configure", {
      method: "POST",
      body: JSON.stringify({
        id: key.id,
        ctaLabel: draftLabel(),
        launcherPosition: look.launcherPosition,
        theme: look.theme,
        brandPrimary: look.brandPrimary,
        brandAccent: look.brandAccent,
        treatmentOrder: look.treatments.map((entry) => entry.id),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Could not save the button");
    applySaved(data);
    saveOk.hidden = false;
    saveOk.textContent = "Saved. The line below is what the site runs — copy it, or send it to your web person.";
  } catch (err) {
    if (err.message !== "Sign in again") showError(saveError, err.message);
  } finally {
    saveInstall.disabled = !currentKey();
  }
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
  clinicName = profile.clinicName || "";
  who.hidden = false;
  who.textContent = profile.platform ? profile.email + " · Admin" : profile.email + " · " + profile.clinicName;
  signOut.hidden = false;
  createClinic.hidden = !profile.platform;
  board.hidden = false;
  /* Both panels stay hidden until the landing tab is known, so a first-run
     clinic never sees the Leads empty state flash before the widget opens. */
  for (const panel of Object.values(views)) panel.hidden = true;
  /* The platform row is static, so it is built once rather than on every render. */
  renderPlatforms();
  /* A thrown request (an offline desk) gives no verdict on the lead count, so the
     desk falls back to Leads, which is where that error is reported. */
  let leads = null;
  try {
    leads = await loadLeads();
  } catch (err) {
    if (err.message !== "Sign in again") showError(boardError, err.message || "Could not load leads");
  }
  /* A link can name the tab: signup sends a brand-new owner straight to Install,
     where one button copies the line for their site. Without a link, a clinic
     with no leads has nothing to read and everything to set up, so it lands on
     Install too. A clinic with a history keeps its leads, and the platform admin
     always does: the desk is a support tool before it is a first-run screen. */
  const landing = requestedView() ||
    (platform || !leads || leads.length ? "leads" : "install");
  showView(landing);
  if (landing === "install") await loadInstall();
  else if (landing === "widget") await loadWidget();
}

boot().catch(() => {});
