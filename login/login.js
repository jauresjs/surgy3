"use strict";

const API = "https://qqrcxbmbulfsvgbqjngz.supabase.co/functions/v1/hebelie-api";
const TOKEN_KEY = "hebelie-desk-token";

const form = document.getElementById("loginForm");
const ok = document.getElementById("loginOk");
const okText = document.getElementById("loginOkText");
const okMeta = document.getElementById("loginOkMeta");
const errorEl = document.getElementById("loginError");
const signOutLocal = document.getElementById("signOutLocal");

function showError(message) {
  errorEl.hidden = !message;
  errorEl.textContent = message || "";
}

function showSignedIn(profile) {
  form.hidden = true;
  ok.hidden = false;
  okText.textContent = profile.clinicName + " · " + profile.email;
  okMeta.textContent = profile.platform ? "Hebelie admin" : "Medspa owner";
}

async function refreshSession() {
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (!token) return;
  const res = await fetch(API + "/auth/me", { headers: { "x-admin-token": token } });
  const profile = await res.json().catch(() => ({}));
  if (!res.ok) {
    sessionStorage.removeItem(TOKEN_KEY);
    return;
  }
  location.replace(hebelieRoot() + "admin/");
}

signOutLocal.addEventListener("click", () => {
  sessionStorage.removeItem(TOKEN_KEY);
  ok.hidden = true;
  form.hidden = false;
  form.reset();
  showError("");
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  showError("");
  const data = new FormData(form);
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const res = await fetch(API + "/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: String(data.get("email") || ""),
        password: String(data.get("password") || ""),
      }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error || "Could not sign in");
    sessionStorage.setItem(TOKEN_KEY, payload.token);
    location.href = hebelieRoot() + "admin/";
  } catch (err) {
    showError(err.message);
  } finally {
    button.disabled = false;
  }
});

refreshSession().catch(() => {});
