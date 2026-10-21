"use strict";

/** Site root path (trailing slash), e.g. /surgy3/ on GitHub Pages or / on a custom domain. */
function hebelieRoot() {
  const parts = location.pathname.replace(/\/$/, "").split("/").filter(Boolean);
  const leaf = parts[parts.length - 1];
  if (leaf === "login" || leaf === "signup" || leaf === "admin") parts.pop();
  else if (leaf && leaf.includes(".")) parts.pop();
  return parts.length ? `/${parts.join("/")}/` : "/";
}

window.hebelieRoot = hebelieRoot;
