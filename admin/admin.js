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
const installSteps = document.getElementById("installSteps");
const installError = document.getElementById("installError");
const installStatus = document.getElementById("installStatus");
const copyInstall = document.getElementById("copyInstall");
const installCopyOk = document.getElementById("installCopyOk");
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
let installPlatform = "wordpress";
/* Only Custom HTML accepts both shapes, so this choice is scoped to it: every
   other platform pins the one form its own editor will keep. */
let installForm = "slot";

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

function showView(name) {
  /* A tab is the only thing that can name a view, so an unknown name is a desk
     bug rather than a state to render: Leads is the one panel that is always
     safe to land on. */
  const target = views[name] ? name : "leads";
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

function snippetFor(publicKey, form = snippetForm) {
  const src = snippetSrc();
  /* A div slot is the install a clinic should paste: the slot says where the
     widget goes, so the snippet never has to be kept in sync with the page's
     markup. The tag form stays one click away for a site that can only add a
     script — a tag manager, an embed field that takes no HTML. */
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

/* Where each platform keeps its site-wide footer, and which shape of snippet it
   will actually keep. Naming a screen is the whole job here: "add the code to
   your site" is the sentence that turns an install into a support thread. */
const PLATFORMS = [
  {
    key: "wordpress",
    name: "WordPress",
    summary: "Theme footer, or a snippets plugin",
    form: "slot",
    steps: [
      {
        title: "Appearance → Theme File Editor → footer.php",
        body: "On a block theme there is no footer.php: use the Site Editor instead, then Patterns → Template Parts → Footer.",
      },
      {
        title: "Paste just above the closing body tag",
        body: "Slot first, script after it, both at the end of the footer: the page's own markup is then already there when the loader scans for the slot.",
      },
      {
        title: "Or use a snippets plugin",
        body: "Add a snippet, set its location to Footer, paste, and activate. A plugin carries the install through a theme update, which a theme file does not.",
      },
      {
        title: "Save, then open the site in a new tab",
        body: "The customiser preview often skips footer scripts, so it can look broken while the live page is fine.",
      },
    ],
    note: "Paste both halves — the div and the script tag. The div on its own is only a slot; nothing mounts it until embed.js is on that page.",
  },
  {
    key: "shopify",
    name: "Shopify",
    summary: "theme.liquid, before the closing body tag",
    form: "slot",
    steps: [
      {
        title: "Online Store → Themes → Edit code",
        body: "Edit the theme the storefront actually uses. A duplicate or an unpublished theme changes nothing a visitor sees.",
      },
      {
        title: "Open layout/theme.liquid",
        body: "Scroll to the closing body tag at the bottom of the file.",
      },
      {
        title: "Paste just above it, then Save",
        body: "This layout wraps every storefront template, so one paste covers the whole store and the slot can be moved page by page later.",
      },
      {
        title: "Open the storefront",
        body: "The theme editor's preview pane can hide the footer, so check the live URL rather than the preview.",
      },
    ],
    note: "For one page instead of the whole store, keep the script in theme.liquid and move only the div into that page's template or a Custom Liquid section.",
  },
  {
    key: "squarespace",
    name: "Squarespace",
    summary: "Settings → Advanced → Code Injection → Footer",
    form: "slot",
    steps: [
      {
        title: "Settings → Advanced → Code Injection",
        body: "Code Injection is a Business-plan feature. On a lower plan, use the Code Block route in the note below.",
      },
      {
        title: "Paste into Footer, not Header",
        body: "Footer injection runs on every page and after the body, which is exactly where the slot and the script belong.",
      },
      {
        title: "Save, then open the live site",
        body: "The editor preview does not run every injected script, so the live page is the only place the result counts.",
      },
    ],
    note: "Without Code Injection, add a Code Block to the last section of the footer and paste the snippet there. Some templates strip script tags from a Code Block: if the widget stays blank and the console never mentions embed.js, that is the cause, and we can send an iframe form that needs no script.",
  },
  {
    key: "wix",
    name: "Wix",
    summary: "Settings → Custom Code → Body, all pages",
    form: "slot",
    steps: [
      {
        title: "Settings → Custom Code → Add Custom Code",
        body: "In the editor, open Settings, then Custom Code. Name it Hebelie so it is easy to find again.",
      },
      {
        title: "Paste, then choose Body — end and All pages",
        body: "The slot has to be in the body and the script has to run after it, so the end of the body is the one place that satisfies both.",
      },
      {
        title: "Apply, then Publish",
        body: "Custom code runs on the published site only: the editor canvas and preview mode will not show the widget.",
      },
    ],
    note: "Publish before judging the result. Code that is applied but not published looks exactly like a broken snippet.",
  },
  {
    key: "custom",
    name: "Custom HTML",
    summary: "Anywhere in the page body",
    /* The only platform that takes both shapes: an HTML block keeps a div, while
       a tag manager or a text-only field may only accept the script. */
    form: "any",
    steps: [
      {
        title: "Put the slot where the widget should appear",
        body: "Anywhere inside the body: a page, a post, a CMS template, or the HTML block of a landing-page builder. The widget renders exactly where the div is.",
      },
      {
        title: "Put the script at the end of the page",
        body: "Once per page, just before the closing body tag. A page that never runs the script shows an empty slot and nothing else.",
      },
      {
        title: "If the host strips script tags",
        body: "Many embed fields and page builders do. The browser console says so, and either a Content-Security-Policy entry or the iframe form is the way around it.",
      },
    ],
    note: "A page with a Content-Security-Policy needs the script's own host allowed in script-src, and the same host in frame-src for the widget it mounts. Without both, the browser blocks the embed before any of our code runs.",
  },
];

function currentPlatform() {
  return PLATFORMS.find((item) => item.key === installPlatform) || PLATFORMS[0];
}

/* A platform that accepts one form pins it; only Custom HTML reads the choice. */
function formFor(item) {
  return item.form === "any" ? installForm : item.form;
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

function formToggle(item) {
  const group = document.createElement("div");
  group.className = "desk-mode desk-form";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "Snippet form");
  for (const form of ["slot", "tag"]) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.installForm = form;
    button.textContent = form === "slot" ? "Div slot" : "Script tag";
    const on = formFor(item) === form;
    button.classList.toggle("is-on", on);
    button.setAttribute("aria-pressed", on ? "true" : "false");
    button.addEventListener("click", () => {
      installForm = form;
      renderInstall();
    });
    group.appendChild(button);
  }
  return group;
}

function renderInstall() {
  const item = currentPlatform();
  const key = currentKey();
  const code = key ? snippetFor(key.publicKey, formFor(item)) : "";

  installWhere.textContent = key ? "Key: " + (key.label || key.publicKey) : "No key yet";

  installSteps.replaceChildren();

  const heading = document.createElement("h3");
  heading.textContent = item.name;
  const summary = document.createElement("p");
  summary.className = "desk-meta";
  summary.textContent = item.summary;
  installSteps.append(heading, summary);

  const list = document.createElement("ol");
  list.className = "desk-install-steps";
  for (const step of item.steps) {
    const entry = document.createElement("li");
    const title = document.createElement("strong");
    title.textContent = step.title;
    const body = document.createElement("p");
    body.textContent = step.body;
    entry.append(title, body);
    list.appendChild(entry);
  }
  installSteps.appendChild(list);

  if (item.form === "any") installSteps.appendChild(formToggle(item));

  if (code) {
    const pre = document.createElement("pre");
    pre.className = "desk-snippet";
    pre.id = "installSnippet";
    pre.tabIndex = 0;
    pre.textContent = code;
    installSteps.appendChild(pre);
  } else {
    const empty = document.createElement("p");
    empty.className = "desk-note";
    empty.textContent = "Create a key on the Widget tab and the snippet appears here.";
    installSteps.appendChild(empty);
  }

  if (item.note) {
    const note = document.createElement("p");
    note.className = "desk-note";
    note.textContent = item.note;
    installSteps.appendChild(note);
  }

  showError(installError, keysError);
  copyInstall.disabled = !code;
  installCopyOk.hidden = true;
  installStatus.textContent = installStatusText(key);
  installStatus.classList.toggle("is-live", Boolean(clinicOrigin(key)));
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
       toggle, while Install copies the form the chosen platform accepts. */
    const code = install
      ? snippetFor(key.publicKey, formFor(currentPlatform()))
      : snippetFor(key.publicKey);
    copyCode(code, install ? installCopyOk : copyOk);
  });
}

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
  /* A clinic with no leads has nothing to read and everything to set up, so it
     lands on the widget. A clinic with a history keeps its leads, and the
     platform admin always does: the desk is a support tool before it is a
     first-run screen. */
  const landing = platform || !leads || leads.length ? "leads" : "widget";
  showView(landing);
  if (landing === "widget") await loadWidget();
}

boot().catch(() => {});
