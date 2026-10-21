/* Hebelie widget — embed loader
   ---------------------------------------------------------------------------
   The only file a clinic pastes:

     <script src="https://<hebelie-host>/widget/embed.js"
             data-hebelie-key="pk_live_xxx"
             data-hebelie-mode="inline"
             defer></script>

   It builds the iframe, keeps it in handshake with the frame, and mirrors the
   frame's height so the host page never shows a nested scrollbar. No
   dependency, no globals beyond window.HebelieWidget, no styles that could
   reach the host page's own elements. */
(function () {
  "use strict";

  /* A script injected with async, or moved by a tag manager, can leave
     currentScript empty, so the tag with the key is the fallback. */
  const script = document.currentScript || document.querySelector("script[data-hebelie-key]");
  if (!script) return;

  const key = (script.getAttribute("data-hebelie-key") || "").trim();
  if (!key) {
    console.error("[hebelie] data-hebelie-key is missing from the embed script");
    return;
  }

  const mode = (script.getAttribute("data-hebelie-mode") || "inline").toLowerCase() === "floating"
    ? "floating"
    : "inline";
  const targetSelector = script.getAttribute("data-hebelie-target") || "";
  const launcherLabel = script.getAttribute("data-hebelie-label") || "Preview a treatment";

  let frameOrigin = "";
  let frameUrl = "";
  try {
    frameOrigin = new URL(script.src).origin;
    frameUrl = new URL("index.html", script.src).href + "?key=" + encodeURIComponent(key);
  } catch (err) {
    console.error("[hebelie] the embed script needs an absolute src");
    return;
  }

  const CSS = `
.heb-embed{width:100%;max-width:560px;margin:0 auto;overflow:hidden}
.heb-frame{width:100%;border:0;display:block;background:transparent;color-scheme:light}
.heb-panel{position:fixed;right:16px;bottom:88px;z-index:2147483000;width:min(420px,calc(100vw - 32px));height:min(760px,calc(100vh - 120px));display:flex;flex-direction:column;overflow:hidden;border:1px solid rgba(0,0,0,.1);border-radius:20px;background:#fff;box-shadow:0 24px 70px rgba(20,16,12,.24);font-family:system-ui,-apple-system,"Segoe UI",Arial,sans-serif}
.heb-panel[hidden]{display:none}
.heb-panel-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px 10px 16px;border-bottom:1px solid rgba(0,0,0,.08);background:#fff}
.heb-panel-title{margin:0;font-size:13px;font-weight:600;letter-spacing:.02em;color:#221f1c}
.heb-close{appearance:none;border:0;background:transparent;cursor:pointer;width:30px;height:30px;border-radius:50%;color:#6b635c;font-size:18px;line-height:1;display:grid;place-items:center}
.heb-close:hover{background:rgba(0,0,0,.06)}
.heb-panel-body{flex:1;min-height:0;overflow:auto;-webkit-overflow-scrolling:touch}
.heb-panel-body .heb-frame{height:auto;min-height:100%}
.heb-launcher{position:fixed;right:16px;bottom:16px;z-index:2147483000;display:inline-flex;align-items:center;gap:8px;padding:13px 18px;border:0;border-radius:999px;background:#221f1c;color:#fff;font-family:system-ui,-apple-system,"Segoe UI",Arial,sans-serif;font-size:13px;font-weight:600;letter-spacing:.01em;cursor:pointer;box-shadow:0 12px 30px rgba(20,16,12,.28);transition:transform .16s ease,filter .16s ease}
.heb-launcher:hover{transform:translateY(-1px);filter:brightness(1.1)}
.heb-launcher[hidden]{display:none}
@media (max-width:520px){.heb-panel{left:8px;right:8px;bottom:76px;width:auto;height:calc(100vh - 96px)}.heb-launcher{right:12px;bottom:12px}}
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

  function buildFrame() {
    const frame = document.createElement("iframe");
    frame.src = frameUrl;
    frame.title = "Treatment preview";
    frame.className = "heb-frame";
    frame.setAttribute("loading", "eager");
    frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    /* The frame reports the page it is framed by; the handshake restates it
       with an origin the parent cannot forge. */
    frame.addEventListener("load", () => {
      try {
        frame.contentWindow.postMessage(
          { source: "hebelie-embed", type: "hello", url: location.href },
          frameOrigin,
        );
      } catch (err) {
        /* A frame that cannot be reached will show its own error state. */
      }
    });
    return frame;
  }

  /* Every message is checked against this frame, so a second widget on the
     same page cannot resize or re-key the first. */
  function listen(frame, onResize) {
    window.addEventListener("message", (event) => {
      if (event.source !== frame.contentWindow) return;
      const data = event.data;
      if (!data || data.source !== "hebelie-widget") return;
      if (data.type === "resize") {
        const height = Math.ceil(Number(data.height) || 0);
        /* 220 is the floor for a frame showing only an error card; the studio
           itself is always taller. */
        if (height > 0) onResize(Math.max(220, Math.min(2600, height)));
        return;
      }
      emit("hebelie:" + data.type, data);
    });
  }

  /* Inline: the frame sits in the page flow and sets its own height. */
  function mountInline() {
    injectStyles();
    const holder = document.createElement("div");
    holder.className = "heb-embed";
    const frame = buildFrame();
    frame.style.height = "520px";
    holder.appendChild(frame);

    const target = targetSelector ? document.querySelector(targetSelector) : null;
    if (target) target.appendChild(holder);
    else if (script.parentNode) script.parentNode.insertBefore(holder, script.nextSibling);
    else document.body.appendChild(holder);

    listen(frame, (height) => {
      frame.style.height = height + "px";
    });

    return { frame: frame, open: function () {}, close: function () {} };
  }

  /* Floating: nothing loads until the visitor asks for it. */
  function mountFloating() {
    injectStyles();

    let frame = null;

    const launcher = document.createElement("button");
    launcher.type = "button";
    launcher.className = "heb-launcher";
    launcher.textContent = launcherLabel;
    launcher.setAttribute("aria-haspopup", "dialog");
    launcher.setAttribute("aria-expanded", "false");

    const panel = document.createElement("div");
    panel.className = "heb-panel";
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
    document.body.append(launcher, panel);

    function hello() {
      if (!frame) return;
      try {
        frame.contentWindow.postMessage(
          { source: "hebelie-embed", type: "hello", url: location.href },
          frameOrigin,
        );
      } catch (err) {
        /* The frame keeps its own error state. */
      }
    }

    function openPanel() {
      if (!frame) {
        frame = buildFrame();
        frame.style.height = "100%";
        body.appendChild(frame);
        listen(frame, (height) => {
          frame.style.height = height + "px";
        });
      } else {
        hello();
      }
      panel.hidden = false;
      launcher.hidden = true;
      launcher.setAttribute("aria-expanded", "true");
      closeButton.focus();
      emit("hebelie:open", { key: key });
    }

    function closePanel() {
      panel.hidden = true;
      launcher.hidden = false;
      launcher.setAttribute("aria-expanded", "false");
      launcher.focus();
      emit("hebelie:close", { key: key });
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

    return { frame: function () { return frame; }, open: openPanel, close: closePanel };
  }

  /* A second copy of this script on the same page would create a second frame
     for one key, which is never what the page wants. */
  if (window.HebelieWidget && window.HebelieWidget.key === key) return;

  const controller = mode === "floating" ? mountFloating() : mountInline();

  window.HebelieWidget = {
    key: key,
    mode: mode,
    open: controller.open,
    close: controller.close,
    /* Handy for a host page that wants to reach into the frame only when it
       has to, e.g. to read a preview URL after the lead event. */
    frame: mode === "floating"
      ? function () { return controller.frame(); }
      : function () { return controller.frame; },
  };
})();
