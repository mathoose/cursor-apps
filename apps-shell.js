/* Include from each app: <script src="../apps-shell.js" defer></script> */
(function () {
  "use strict";
  window.APPS_HOME_URL = "https://mathoose.github.io/cursor-apps/";

  var backSvg =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">' +
    '<path d="M15 18l-6-6 6-6"/></svg>';

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("[data-apps-home]").forEach(function (el) {
      if (!el.getAttribute("href")) el.setAttribute("href", window.APPS_HOME_URL);
    });
  });
})();
