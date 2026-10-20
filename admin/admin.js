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

let platform = false;

function token() {
  return sessionStorage.getItem(TOKEN_KEY) || "";
}

function showError(el, message) {
  el.hidden = !message;
  el.textContent = message || "";
}

function goToLogin() {
  sessionStorage.removeItem(TOKEN_KEY);
  location.replace("/login/");
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
    return;
  }
  await renderLeads(data.leads || []);
}

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
    location.replace("/login/");
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
  await loadLeads();
}

boot().catch(() => {});
