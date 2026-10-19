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
