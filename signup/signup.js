"use strict";

const API = "https://qqrcxbmbulfsvgbqjngz.supabase.co/functions/v1/hebelie-api";
const form = document.getElementById("signupForm");
const ok = document.getElementById("signupOk");
const okText = document.getElementById("signupOkText");
const errorEl = document.getElementById("signupError");

function showError(message) {
  errorEl.hidden = !message;
  errorEl.textContent = message || "";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  showError("");
  const data = new FormData(form);
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const res = await fetch(API + "/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clinicName: String(data.get("clinicName") || ""),
        email: String(data.get("email") || ""),
        password: String(data.get("password") || ""),
      }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error || "Could not create the account");
    form.hidden = true;
    ok.hidden = false;
    okText.textContent = payload.clinicName + " is set up for " + payload.email + ".";
  } catch (err) {
    showError(err.message);
  } finally {
    button.disabled = false;
  }
});
