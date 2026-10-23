/* Hebelie widget — embed loader (v1)
   ---------------------------------------------------------------------------
   Two installs, one file.

   1 · A key on the tag, mounted where the tag sits (or at data-hebelie-target):

         <script src="https://<hebelie-host>/widget/v1/embed.js"
                 data-hebelie-key="pk_live_xxx"
                 data-hebelie-mode="inline"
                 defer></script>

   2 · A placeholder the clinic can move anywhere in its own page:

         <script src="https://<hebelie-host>/widget/v1/embed.js" defer></script>
         <div data-hebelie-widget="pk_live_xxx"></div>

   3 · The whole install inside the tag's own URL, for a footer field that keeps
       a URL but drops attributes:

         <script src="https://<hebelie-host>/widget/v1/embed.js?key=pk_live_xxx&mode=floating" defer></script>

   Form 3 is the one the desk hands a clinic: one line, every setting in the URL,
   so there is nothing in the page to keep in sync. Form 2 is the layout-aware
   version: the div is the slot, so the widget appears exactly where the div is.
   Form 1 is for a page that can only take a script — a tag manager, or an embed
   field that takes no HTML.

   Either way the loader builds the iframe, keeps it in handshake with the
   frame, and mirrors the frame's height so the host page never shows a nested
   scrollbar. No dependency, no globals beyond window.HebelieWidget, no styles
   that could reach the host page's own elements. */
(function () {
  "use strict";

  const VERSION = "1";
  const DEFAULT_LABEL = "Preview a treatment";
  const DEFAULT_HEIGHT = "520px";
  /* 220 is the floor for a frame showing only an error card; the studio itself
     is always taller. */
  const HEIGHT_FLOOR = 220;
  const HEIGHT_CEILING = 2600;

  /* The studio's API, which is where /widget/config lives. widget.js carries the
     same constant: the loader is served from the same host as the frame, so there
     is nothing here to discover at runtime. */
  const HEBELIE_API = "https://qqrcxbmbulfsvgbqjngz.supabase.co/functions/v1/hebelie-api";
  /* A look is cosmetic and the button is already on the page, so the answer is
     only worth waiting for as long as it stays invisible. */
  const LOOK_TIMEOUT = 1500;
  /* One entry per key, on the clinic's own origin. It saves the first paint, not
     the request: the server always gets the last word. */
  const LOOK_STORE = "hebelie-look:";

  /* ---- 1 · Where this copy of the loader lives -------------------------- */

  /* A script injected with async, or moved by a tag manager, can leave
     currentScript empty, so the tag itself is the fallback: the keyed tag first,
     then the first embed.js tag on the page. The URL may carry a query — that is
     the one-line install — so the tags are matched on their whole src rather
     than on a selector that has to end where embed.js ends. */
  const LOADER = /\/embed(?:\.min)?\.js(?:[?#]|$)/;

  function ownScript() {
    const current = document.currentScript;
    if (current && LOADER.test(current.src || "")) return current;
    const tags = document.getElementsByTagName("script");
    for (let i = 0; i < tags.length; i++) {
      if (attr(tags[i], "data-hebelie-key") && LOADER.test(tags[i].src || "")) return tags[i];
    }
    /* A page can serve another vendor's embed.js; /widget/ is the folder that
       says the tag is ours, so it wins over a bare file name. */
    for (let i = 0; i < tags.length; i++) {
      if (LOADER.test(tags[i].src || "") && tags[i].src.indexOf("/widget/") !== -1) return tags[i];
    }
    for (let i = 0; i < tags.length; i++) {
      if (LOADER.test(tags[i].src || "")) return tags[i];
    }
    return null;
  }

  /* Without its own URL the loader cannot know which host serves the frame, and
     guessing would point a clinic's page at the wrong place. */
  function widgetRoot(src) {
    let url;
    try {
      url = new URL(src);
    } catch (err) {
      return "";
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    /* /widget/v1/embed.js is this same loader under a versioned path; the frame
       always lives in the folder above the version. */
    const dir = url.pathname.replace(/[^/]*$/, "").replace(/(?:^|\/)v\d+(?:\.\d+)*\/$/, "/");
    return url.origin + dir;
  }

  const script = ownScript();
  if (!script) {
    console.error("[hebelie] the embed loader could not find its own script tag");
    return;
  }

  const root = widgetRoot(script.src);
  if (!root) {
    console.error("[hebelie] the embed script needs an absolute src");
    return;
  }

  const frameOrigin = new URL(root).origin;

  /* ---- 2 · Reading an install ------------------------------------------ */

  function attr(el, name) {
    const value = el && el.getAttribute ? el.getAttribute(name) : null;
    return value == null ? "" : String(value).trim();
  }

  /* An install can carry its settings in the script's own URL instead of on the
     tag: .../embed.js?key=pk_live_xxx&mode=floating. That is the form the desk
     hands out, because one line survives a footer field that keeps a URL but
     strips attributes. Every attribute has a URL twin: data-hebelie-mode is
     mode, data-hebelie-launcher-position is launcher-position, and so on. */
  function query(name) {
    try {
      return new URL(script.src).searchParams.get(name) || "";
    } catch (err) {
      return "";
    }
  }

  /* A placeholder's own attributes win, then the script tag's, then a query on
     the script URL, then the default: one tag can carry the defaults for every
     placeholder on a page, and a one-line install can carry them for itself. */
  function setting(el, name, fallback) {
    return attr(el, name) || attr(script, name) || query(name.replace(/^data-hebelie-/, "")) || fallback;
  }

  function validKey(key) {
    return /^[A-Za-z0-9_-]{6,120}$/.test(key);
  }

  function modeOf(value) {
    return String(value).toLowerCase() === "floating" ? "floating" : "inline";
  }

  function themeOf(value) {
    const theme = String(value).toLowerCase();
    return theme === "dark" || theme === "auto" ? theme : "light";
  }

  function cornerOf(value) {
    const corner = String(value).toLowerCase();
    return corner === "bottom-left" || corner === "left" ? "left" : "right";
  }

  /* A single CSS length, because this reaches a style property: anything else
     is a typo, and a typo should fall back to the stylesheet, not win. */
  function widthOf(value) {
    const width = String(value).trim();
    return /^\d{1,4}(?:\.\d{1,3})?(?:px|rem|em|%|vw)$/.test(width) ? width : "";
  }

  function optionsFor(el, key) {
    return {
      key: key,
      mode: modeOf(setting(el, "data-hebelie-mode", "inline")),
      theme: themeOf(setting(el, "data-hebelie-theme", "light")),
      corner: cornerOf(setting(el, "data-hebelie-launcher-position", "bottom-right")),
      width: widthOf(setting(el, "data-hebelie-width", "")),
      label: setting(el, "data-hebelie-label", DEFAULT_LABEL),
    };
  }

  /* ---- 2b · The look the server stores ---------------------------------- */

  /* What the installed button says, where it sits and which theme it wears are
     stored on the key and edited in the desk, so the loader asks /widget/config
     instead of trusting the line forever. The line still seeds the first paint: a
     clinic that typed the wording into the snippet gets it immediately, and a page
     whose Content-Security-Policy blocks connect-src keeps a working button
     rather than none. That is why every setting has a URL twin. */

  /* The label ends up as a button's content, so it is read as text and never as
     markup. 40 characters is the same cap the desk's field, the API and the
     column all carry. */
  function labelOf(value) {
    const label = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
    return label.slice(0, 40) || DEFAULT_LABEL;
  }

  /* The desk and the database name the corner "bottom-left", while a
     hand-written line may carry the older "left". Both mean the same corner. */
  function positionOf(value) {
    return cornerOf(value) === "left" ? "bottom-left" : "bottom-right";
  }

  function lookFrom(data) {
    const widget = (data && data.widget) || {};
    return {
      label: labelOf(widget.label),
      position: positionOf(widget.position || "bottom-right"),
      theme: themeOf(widget.theme || "light"),
    };
  }

  /* A look is cosmetic, so a page with storage disabled — private mode, a cookie
     wall, a sandboxed frame — simply gets no cache. Every path here swallows its
     own error rather than costing the widget its button. */
  function readLook(key) {
    try {
      const raw = window.localStorage.getItem(LOOK_STORE + key);
      if (!raw) return null;
      const saved = JSON.parse(raw);
      if (!saved || typeof saved.label !== "string") return null;
      return {
        label: labelOf(saved.label),
        position: positionOf(saved.position),
        theme: themeOf(saved.theme),
      };
    } catch (err) {
      return null;
    }
  }

  function writeLook(key, look) {
    try {
      window.localStorage.setItem(LOOK_STORE + key, JSON.stringify(look));
    } catch (err) {
      /* Full or disabled storage: the next page view pays for one more request. */
    }
  }

  /* One request, and never longer than the launcher can afford to wait. A slow or
     missing API leaves whatever the line said in place. */
  function fetchLook(key) {
    return new Promise((resolve) => {
      if (typeof fetch !== "function") {
        resolve(null);
        return;
      }
      const control = typeof AbortController === "function" ? new AbortController() : null;
      let timer = 0;
      const stop = (value) => {
        clearTimeout(timer);
        resolve(value);
      };
      timer = setTimeout(() => {
        if (control) control.abort();
        stop(null);
      }, LOOK_TIMEOUT);
      fetch(HEBELIE_API + "/widget/config?key=" + encodeURIComponent(key), {
        method: "GET",
        mode: "cors",
        credentials: "omit",
        signal: control ? control.signal : undefined,
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => stop(data ? lookFrom(data) : null))
        .catch(() => stop(null));
    });
  }

  /* ---- 3 · The only styles this file adds ------------------------------- */

  /* Every rule is prefixed with heb- and scoped to the loader's own elements, so
     none of it can restyle the host page. Colours arrive through custom
     properties, so a theme is one class instead of a second copy of the sheet. */
  const CSS = `
.heb-embed{width:100%;max-width:560px;margin:0 auto;overflow:hidden}
.heb-frame{width:100%;border:0;display:block;background:transparent;color-scheme:light}
.heb-panel{--heb-surface:#fff;--heb-line:rgba(0,0,0,.1);--heb-ink:#221f1c;--heb-muted:#6b635c;--heb-hover:rgba(0,0,0,.06);position:fixed;right:16px;bottom:88px;z-index:2147483000;width:min(420px,calc(100vw - 32px));height:min(760px,calc(100vh - 120px));display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--heb-line);border-radius:20px;background:var(--heb-surface);box-shadow:0 24px 70px rgba(20,16,12,.24);font-family:system-ui,-apple-system,"Segoe UI",Arial,sans-serif}
.heb-panel[hidden]{display:none}
.heb-panel-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px 10px 16px;border-bottom:1px solid var(--heb-line);background:var(--heb-surface)}
.heb-panel-title{margin:0;font-size:13px;font-weight:600;letter-spacing:.02em;color:var(--heb-ink)}
.heb-close{appearance:none;border:0;background:transparent;cursor:pointer;width:30px;height:30px;border-radius:50%;color:var(--heb-muted);font-size:18px;line-height:1;display:grid;place-items:center}
.heb-close:hover{background:var(--heb-hover)}
.heb-panel-body{flex:1;min-height:0;overflow:auto;-webkit-overflow-scrolling:touch}
.heb-panel-body .heb-frame{height:auto;min-height:100%}
.heb-launcher{--heb-cta:#221f1c;--heb-cta-ink:#fff;position:fixed;right:16px;bottom:16px;z-index:2147483000;display:inline-flex;align-items:center;gap:8px;padding:13px 18px;border:0;border-radius:999px;background:var(--heb-cta);color:var(--heb-cta-ink);font-family:system-ui,-apple-system,"Segoe UI",Arial,sans-serif;font-size:13px;font-weight:600;letter-spacing:.01em;cursor:pointer;box-shadow:0 12px 30px rgba(20,16,12,.28);transition:transform .16s ease,filter .16s ease}
.heb-launcher:hover{transform:translateY(-1px);filter:brightness(1.1)}
.heb-launcher[hidden]{display:none}
.heb-panel.heb-corner-left{right:auto;left:16px}
.heb-launcher.heb-corner-left{right:auto;left:16px}
.heb-theme-dark{--heb-surface:#17140f;--heb-line:rgba(255,255,255,.14);--heb-ink:#f2ece4;--heb-muted:#c8bfb4;--heb-hover:rgba(255,255,255,.1);--heb-cta:#f4f0ea;--heb-cta-ink:#17140f}
@media (prefers-color-scheme:dark){.heb-theme-auto{--heb-surface:#17140f;--heb-line:rgba(255,255,255,.14);--heb-ink:#f2ece4;--heb-muted:#c8bfb4;--heb-hover:rgba(255,255,255,.1);--heb-cta:#f4f0ea;--heb-cta-ink:#17140f}}
@media (max-width:520px){.heb-panel{left:8px;right:8px;bottom:76px;width:auto;height:calc(100vh - 96px)}.heb-panel.heb-corner-left{left:8px;right:8px}.heb-launcher{right:12px;bottom:12px}.heb-launcher.heb-corner-left{left:12px;right:auto}}
@media (prefers-reduced-motion:reduce){.heb-launcher{transition:none}}
`;

  function injectStyles() {
    if (document.getElementById("hebelie-embed-styles")) return;
    const style = document.createElement("style");
    style.id = "hebelie-embed-styles";
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function emit(name, detail) {
    document.dispatchEvent(new CustomEvent(name, { detail: detail }));
  }

  /* ---- 4 · The frame and its handshake --------------------------------- */

  function hello(frame) {
    if (!frame) return;
    try {
      frame.contentWindow.postMessage(
        { source: "hebelie-embed", type: "hello", url: location.href },
        frameOrigin,
      );
    } catch (err) {
      /* A frame that cannot be reached will show its own error state. */
    }
  }

  function buildFrame(options) {
    const frame = document.createElement("iframe");
    frame.src = root + "index.html?key=" + encodeURIComponent(options.key);
    frame.title = "Treatment preview";
    frame.className = "heb-frame";
    frame.setAttribute("loading", "eager");
    frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    /* The frame reports the page it is framed by; the handshake restates it
       with an origin the parent cannot forge. */
    frame.addEventListener("load", () => hello(frame));
    return frame;
  }

  /* Every message is checked against this frame, so a second widget on the same
     page cannot resize or re-key the first. */
  function listen(frame, onResize) {
    window.addEventListener("message", (event) => {
      if (event.source !== frame.contentWindow) return;
      const data = event.data;
      if (!data || data.source !== "hebelie-widget") return;
      if (data.type === "resize") {
        const height = Math.ceil(Number(data.height) || 0);
        if (height > 0) onResize(Math.max(HEIGHT_FLOOR, Math.min(HEIGHT_CEILING, height)));
        return;
      }
      emit("hebelie:" + data.type, data);
    });
  }

  /* ---- 5 · The two shapes a widget can take ---------------------------- */

  /* Inline: the frame sits in the page flow, inside the slot the clinic chose,
     and sets its own height. `anchor` is the script tag to mount beside when the
     slot is the tag itself. */
  function mountInline(options, host, anchor) {
    injectStyles();

    const holder = document.createElement("div");
    holder.className = "heb-embed";
    /* Only an explicit width overrides the stylesheet's 560px: a slot in a wide
       column should not be narrowed by a default it never asked for. */
    if (options.width) holder.style.maxWidth = options.width;

    const frame = buildFrame(options);
    frame.style.height = DEFAULT_HEIGHT;
    holder.appendChild(frame);

    if (host) {
      host.appendChild(holder);
    } else if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(holder, anchor.nextSibling);
    } else if (document.body) {
      document.body.appendChild(holder);
    } else {
      return null;
    }

    listen(frame, (height) => {
      frame.style.height = height + "px";
    });

    return {
      holder: holder,
      frame: function () { return frame; },
      open: function () {},
      close: function () {},
    };
  }

  /* Floating: nothing loads until the visitor asks for it. One launcher, one
     panel, however many placeholders the page has with this mode. */
  function mountFloating(options) {
    injectStyles();

    const chrome = [];
    if (options.theme !== "light") chrome.push("heb-theme-" + options.theme);
    if (options.corner === "left") chrome.push("heb-corner-left");

    let frame = null;

    const launcher = document.createElement("button");
    launcher.type = "button";
    launcher.className = ["heb-launcher"].concat(chrome).join(" ");
    launcher.textContent = options.label;
    launcher.setAttribute("aria-haspopup", "dialog");
    launcher.setAttribute("aria-expanded", "false");

    const panel = document.createElement("div");
    panel.className = ["heb-panel"].concat(chrome).join(" ");
    panel.hidden = true;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "false");
    panel.setAttribute("aria-label", "Treatment preview");

    const head = document.createElement("div");
    head.className = "heb-panel-head";
    const title = document.createElement("p");
    title.className = "heb-panel-title";
    title.textContent = "Treatment preview";
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "heb-close";
    closeButton.setAttribute("aria-label", "Close preview");
    closeButton.innerHTML = "&times;";
    head.append(title, closeButton);

    const body = document.createElement("div");
    body.className = "heb-panel-body";
    panel.append(head, body);

    if (!document.body) return null;
    document.body.append(launcher, panel);

    /* One painter for both elements, because the server's answer lands after the
       button is already on the page: wording, corner and theme are the only things
       it is allowed to change, and the frame is untouched. */
    function paint(next) {
      options.label = next.label;
      options.theme = next.theme;
      options.corner = next.position === "bottom-left" ? "left" : "right";
      launcher.textContent = next.label;
      for (const el of [launcher, panel]) {
        el.classList.remove("heb-theme-dark", "heb-theme-auto", "heb-corner-left");
        if (next.theme !== "light") el.classList.add("heb-theme-" + next.theme);
        if (options.corner === "left") el.classList.add("heb-corner-left");
      }
    }

    /* The line is the first paint; the server is the truth. A cached answer is
       applied before the button settles, so a returning visitor sees no flicker,
       and a fresh answer follows on its own — which is what lets a clinic change
       the wording in the desk without repasting the snippet. */
    const cached = readLook(options.key);
    if (cached) paint(cached);
    fetchLook(options.key).then((fresh) => {
      if (!fresh) return;
      writeLook(options.key, fresh);
      paint(fresh);
    });

    function openPanel() {
      if (!frame) {
        frame = buildFrame(options);
        frame.style.height = "100%";
        body.appendChild(frame);
        listen(frame, (height) => {
          frame.style.height = height + "px";
        });
      } else {
        hello(frame);
      }
      panel.hidden = false;
      launcher.hidden = true;
      launcher.setAttribute("aria-expanded", "true");
      closeButton.focus();
      emit("hebelie:open", { key: options.key });
    }

    function closePanel() {
      panel.hidden = true;
      launcher.hidden = false;
      launcher.setAttribute("aria-expanded", "false");
      launcher.focus();
      emit("hebelie:close", { key: options.key });
    }

    launcher.addEventListener("click", openPanel);
    closeButton.addEventListener("click", closePanel);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !panel.hidden) closePanel();
    });
    window.addEventListener("message", (event) => {
      if (!frame || event.source !== frame.contentWindow) return;
      const data = event.data;
      if (data && data.source === "hebelie-widget" && data.type === "close") closePanel();
    });

    return {
      holder: launcher,
      frame: function () { return frame; },
      open: openPanel,
      close: closePanel,
    };
  }

  /* ---- 6 · One runtime per page ---------------------------------------- */

  /* A page can hold more than one copy of this tag: a tag manager, a clinic that
     pasted the snippet twice, the desk re-mounting its preview. They all share
     one registry, so no slot is mounted twice and one widget never answers
     another's messages. */
  function createRuntime() {
    const instances = [];
    /* A slot with a bad key is reported once, not once per scan: every copy of
       the tag on the page runs a scan of its own. */
    const reported = new WeakSet();
    let observer = null;

    /* A widget whose slot has left the document is gone, not hidden: the desk
       empties its preview box between runs, and a single-page app may drop a
       route. Both have to free the registry, or the next mount would look like
       a duplicate and mount nothing at all. */
    function alive(entry) {
      return Boolean(entry && entry.holder && document.documentElement.contains(entry.holder));
    }

    function prune() {
      for (let i = instances.length - 1; i >= 0; i--) {
        if (!alive(instances[i])) instances.splice(i, 1);
      }
    }

    function primary() {
      prune();
      for (let i = instances.length - 1; i >= 0; i--) {
        if (instances[i].mode === "inline") return instances[i];
      }
      return instances[instances.length - 1] || null;
    }

    function attach(options, host, source, anchor) {
      prune();
      /* The same key twice is never what a page wants: two frames for one
         clinic, both listening, both reporting height. */
      const seen = instances.some((entry) => source === "container"
        ? entry.host === host
        : entry.source === "script" && entry.key === options.key);
      if (seen) return null;

      const instance = options.mode === "floating"
        ? mountFloating(options)
        : mountInline(options, host, anchor);
      if (!instance) return null;

      instance.key = options.key;
      instance.mode = options.mode;
      instance.host = host;
      instance.source = source;
      instances.push(instance);
      return instance;
    }

    function scan() {
      const slots = document.querySelectorAll("[data-hebelie-widget]");
      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        const key = attr(slot, "data-hebelie-widget");
        if (!validKey(key)) {
          if (!reported.has(slot)) {
            reported.add(slot);
            console.error("[hebelie] data-hebelie-widget needs a widget public key", slot);
          }
          continue;
        }
        attach(optionsFor(slot, key), slot, "container");
      }
    }

    /* A slot added after this script ran — a page builder, a tab that renders
       late, a route change. Installed only on a page that uses the slot form, so
       a keyed install never pays for an observer it cannot use. */
    function observe() {
      if (observer || typeof MutationObserver !== "function" || !document.documentElement) return;
      observer = new MutationObserver((records) => {
        for (let i = 0; i < records.length; i++) {
          const added = records[i].addedNodes;
          for (let j = 0; j < added.length; j++) {
            const node = added[j];
            if (node.nodeType !== 1) continue;
            const itself = node.matches && node.matches("[data-hebelie-widget]");
            if (itself || (node.querySelector && node.querySelector("[data-hebelie-widget]"))) {
              scan();
              return;
            }
          }
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    const api = {
      version: VERSION,
      instances: instances,
      attach: attach,
      scan: scan,
      observe: observe,
      open: function () { const top = primary(); if (top) top.open(); },
      close: function () { const top = primary(); if (top) top.close(); },
      frame: function () { const top = primary(); return top ? top.frame() : null; },
    };

    /* The global keeps the shape the first release published (key, mode, open,
       close, frame) for a page written against it, with the registry underneath
       for a page that holds more than one widget. */
    Object.defineProperty(api, "key", {
      enumerable: true,
      get: function () { const top = primary(); return top ? top.key : ""; },
    });
    Object.defineProperty(api, "mode", {
      enumerable: true,
      get: function () { const top = primary(); return top ? top.mode : ""; },
    });

    return api;
  }

  /* ---- 7 · Start -------------------------------------------------------- */

  const existing = window.HebelieWidget;
  const runtime = existing && existing.version === VERSION && typeof existing.attach === "function"
    ? existing
    : createRuntime();

  if (runtime !== existing) {
    try {
      window.HebelieWidget = runtime;
    } catch (err) {
      /* A page that froze the global still gets its slots mounted. */
    }
  }

  /* Form 1: a key on the tag (or in the tag's URL), mounted beside it or at the
     target. */
  /* The key arrives on the tag or in the tag's own URL, and either one is a
     complete install: the one-line form puts everything in the URL. */
  const scriptKey = attr(script, "data-hebelie-key") || query("key");
  if (scriptKey && !validKey(scriptKey)) {
    console.error("[hebelie] data-hebelie-key is not a widget public key");
  } else if (scriptKey) {
    const targetPath = attr(script, "data-hebelie-target");
    const target = targetPath ? document.querySelector(targetPath) : null;
    if (targetPath && !target) {
      console.error("[hebelie] nothing on the page matches data-hebelie-target:", targetPath);
    }
    runtime.attach(optionsFor(script, scriptKey), target, "script", script);
  }

  /* Form 2: placeholders. A deferred script runs with the document parsed, but
     an async or in-head tag runs earlier, so wait for the parse when needed. */
  function startSlots() {
    if (!document.querySelector("[data-hebelie-widget]")) {
      if (!scriptKey) {
        console.warn("[hebelie] no key on the script (data-hebelie-key, or ?key= in its URL) and no [data-hebelie-widget] slot on the page");
      }
      return;
    }
    runtime.scan();
    runtime.observe();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startSlots);
  } else {
    startSlots();
  }
})();
