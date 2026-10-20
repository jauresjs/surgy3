"use strict";

const API = "https://qqrcxbmbulfsvgbqjngz.supabase.co/functions/v1/hebelie-api";
const TOKEN_KEY = "hebelie-desk-token";

const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");
const board = document.getElementById("board");
const boardError = document.getElementById("boardError");
const leadList = document.getElementById("leadList");
const leadCount = document.getElementById("leadCount");
const signOut = document.getElementById("signOut");

function token() {
  return sessionStorage.getItem(TOKEN_KEY) || "";
}

function showError(el, message) {
  el.hidden = !message;
  el.textContent = message || "";
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (token()) headers.set("x-admin-token", token());
  const res = await fetch(API + path, { ...options, headers });
  if (res.status === 401 && path !== "/admin/login") {
    sessionStorage.removeItem(TOKEN_KEY);
    showBoard(false);
    showError(loginError, "Sign in again.");
    throw new Error("Sign in again");
  }
  return res;
}

function showBoard(on) {
  loginForm.hidden = on;
  board.hidden = !on;
  signOut.hidden = !on;
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
      <p class="desk-meta"></p>
      <ul class="desk-tags"></ul>
      <div class="desk-photos"></div>`;
    card.querySelector("h2").textContent = lead.name;
    card.querySelector(".desk-meta").textContent = contact + " · " + when(lead.createdAt);
    const tags = card.querySelector(".desk-tags");
    (lead.treatments || []).forEach((name) => {
      const li = document.createElement("li");
      li.textContent = name;
      tags.appendChild(li);
    });
    const photos = card.querySelector(".desk-photos");
    const figures = [{ caption: "Uploaded", path: lead.photoPath }];
    (lead.previews || []).forEach((preview, index) => {
      figures.push({
        caption: "Generated · " + (preview.treatments || []).join(" + "),
        path: preview.resultPath,
        note: index + 1,
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

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showError(loginError, "");
  const password = document.getElementById("password").value;
  const res = await fetch(API + "/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    showError(loginError, data.error || "Could not sign in");
    return;
  }
  sessionStorage.setItem(TOKEN_KEY, data.token);
  showBoard(true);
  await loadLeads();
});

signOut.addEventListener("click", () => {
  sessionStorage.removeItem(TOKEN_KEY);
  leadList.replaceChildren();
  showBoard(false);
});

if (token()) {
  showBoard(true);
  loadLeads().catch(() => {});
}
