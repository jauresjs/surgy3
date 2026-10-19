"use strict";

/* Close the mobile menu after a link is chosen. */
(function () {
  var toggle = document.getElementById("navToggle");
  if (!toggle) return;
  document.querySelectorAll(".nav-links a").forEach(function (link) {
    link.addEventListener("click", function () {
      toggle.checked = false;
    });
  });
})();

/* Landing before/after uses the same single-frame slider as a result. */
(function () {
  var wrap = document.getElementById("heroSlider");
  var after = document.getElementById("heroAfter");
  var handle = document.getElementById("heroHandle");
  var divider = document.getElementById("heroDivider");
  var beforeBadge = document.getElementById("heroBeforeBadge");
  var afterBadge = document.getElementById("heroAfterBadge");
  if (!wrap || !after || !handle || !divider) return;

  function setSlider(pct) {
    pct = Math.max(0, Math.min(100, pct));
    after.style.clipPath = "inset(0 0 0 " + pct + "%)";
    handle.style.left = pct + "%";
    divider.style.left = pct + "%";
    handle.setAttribute("aria-valuenow", String(Math.round(pct)));
    if (beforeBadge) beforeBadge.style.opacity = String(Math.min(1, pct / 22));
    if (afterBadge) afterBadge.style.opacity = String(Math.min(1, (100 - pct) / 22));
  }

  function fromX(x) {
    var rect = wrap.getBoundingClientRect();
    setSlider(((x - rect.left) / rect.width) * 100);
  }

  var dragging = false;
  function start(e) {
    dragging = true;
    handle.classList.add("active");
    var ev = e.touches ? e.touches[0] : e;
    fromX(ev.clientX);
  }
  function move(e) {
    if (!dragging) return;
    e.preventDefault();
    var ev = e.touches ? e.touches[0] : e;
    fromX(ev.clientX);
  }
  function end() {
    dragging = false;
    handle.classList.remove("active");
  }

  wrap.addEventListener("mousedown", start);
  wrap.addEventListener("touchstart", start, { passive: false });
  window.addEventListener("mousemove", move);
  window.addEventListener("touchmove", move, { passive: false });
  window.addEventListener("mouseup", end);
  window.addEventListener("touchend", end);

  handle.addEventListener("keydown", function (e) {
    var step = e.shiftKey ? 10 : 2;
    var pct = parseFloat(handle.getAttribute("aria-valuenow")) || 48;
    if (e.key === "ArrowLeft") { e.preventDefault(); setSlider(pct - step); }
    if (e.key === "ArrowRight") { e.preventDefault(); setSlider(pct + step); }
  });

  setSlider(48);
})();
