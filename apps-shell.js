/* Include from each app: <script src="../apps-shell.js" defer></script> */
(function () {
  "use strict";
  window.APPS_HOME_URL = "https://mathoose.github.io/cursor-apps/";

  var backSvg =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">' +
    '<path d="M15 18l-6-6 6-6"/></svg>';

  function getAppIdFromPath() {
    var path = window.location.pathname.replace(/\/$/, "");
    var segments = path.split("/").filter(Boolean);
    if (!segments.length) return null;
    var last = segments[segments.length - 1];
    if (/\.html$/i.test(last)) {
      return segments.length > 1 ? segments[segments.length - 2] : null;
    }
    return last;
  }

  function versionsUrl() {
    var path = window.location.pathname;
    if (/\/[^/]+\/[^/]+\.html$/i.test(path) || /\/[^/]+\/$/.test(path)) {
      return "../versions.json";
    }
    return "versions.json";
  }

  function loadVersions() {
    return fetch(versionsUrl() + "?" + Date.now())
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .catch(function () {
        return null;
      });
  }

  function versionInteger(text) {
    var n = String(text || "").split("·")[0].trim();
    return /^\d+$/.test(n) ? n : "";
  }

  function assetVersion(url) {
    var m = String(url || "").match(/[?&]v=(\d+)/);
    return m ? m[1] : "";
  }

  function reloadIfStaleApp(versionText) {
    var want = versionInteger(versionText);
    if (!want) return false;
    var stale = false;
    document.querySelectorAll("script[src]").forEach(function (node) {
      var src = node.getAttribute("src") || "";
      if (!/(^|\/)app\.js(\?|$)/.test(src)) return;
      var have = assetVersion(src);
      if (have && have !== want) stale = true;
    });
    document.querySelectorAll("link[rel='stylesheet']").forEach(function (node) {
      var href = node.getAttribute("href") || "";
      if (!/(^|\/)styles\.css(\?|$)/.test(href)) return;
      var have = assetVersion(href);
      if (have && have !== want) stale = true;
    });
    if (!stale) return false;
    var url = new URL(window.location.href);
    if (url.searchParams.get("appv") === want) return false;
    url.searchParams.set("appv", want);
    window.location.replace(url.toString());
    return true;
  }

  function exportLineLabel() {
    if (!window.AppsBackup || !AppsBackup.getDaysSinceLastExport) return "Export";
    var days = AppsBackup.getDaysSinceLastExport();
    if (days == null) return "Export · never exported";
    if (days === 0) return "Export · 0 days since last export";
    if (days === 1) return "Export · 1 day since last export";
    return "Export · " + days + " days since last export";
  }

  function chromeHosts() {
    var docks = document.querySelectorAll(".bottom-dock, .bottom-nav");
    if (docks.length) return Array.prototype.slice.call(docks);
    return Array.prototype.slice.call(document.querySelectorAll(".tabbar"));
  }

  function mountQuickExport() {
    if (!window.AppsBackup || !AppsBackup.exportAll || !AppsBackup.downloadBundle) return;
    if (document.querySelector(".apps-quick-export")) return;

    var hosts = chromeHosts();
    var buttons = [];

    function makeButton(extraClass) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "apps-quick-export" + (extraClass ? " " + extraClass : "");
      btn.addEventListener("click", function () {
        try {
          AppsBackup.downloadBundle(AppsBackup.exportAll(), AppsBackup.defaultFilename());
          refresh();
        } catch (e) { /* leave the label unchanged */ }
      });
      buttons.push(btn);
      return btn;
    }

    if (!hosts.length) {
      document.body.appendChild(makeButton("is-viewport"));
    } else {
      hosts.forEach(function (host) {
        if (window.getComputedStyle(host).position === "static") host.style.position = "relative";
        host.appendChild(makeButton(""));
      });
    }

    function refresh() {
      var label = exportLineLabel();
      buttons.forEach(function (btn) {
        btn.textContent = label;
        btn.setAttribute("aria-label", label);
      });
    }

    function syncPad() {
      var top = window.innerHeight;
      buttons.forEach(function (btn) {
        var rect = btn.getBoundingClientRect();
        if (rect.height < 2) return;
        if (rect.top < top) top = rect.top;
      });
      var needed = Math.ceil(window.innerHeight - top) + 2;
      if (needed < 16) needed = 16;
      document.body.style.paddingBottom = "";
      var base = parseFloat(window.getComputedStyle(document.body).paddingBottom) || 0;
      document.body.style.paddingBottom = Math.max(Math.ceil(base), needed) + "px";
    }

    refresh();
    document.body.classList.add("apps-has-quick-export");
    syncPad();

    if (window.ResizeObserver) {
      var observer = new ResizeObserver(function () { syncPad(); });
      hosts.forEach(function (host) { observer.observe(host); });
      buttons.forEach(function (btn) { observer.observe(btn); });
    }
    window.addEventListener("resize", syncPad);
    if (window.visualViewport) window.visualViewport.addEventListener("resize", syncPad);
    if (window.MutationObserver) {
      new MutationObserver(function () { syncPad(); }).observe(document.body, {
        attributes: true,
        attributeFilter: ["class"]
      });
    }
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") refresh();
    });
    window.AppsQuickExport = { refresh: refresh };
  }

  function showAppVersion(versionText) {
    if (!versionText) return;
    if (document.querySelector(".app-version")) return;

    if (document.querySelector(".bottom-nav") || document.querySelector(".tabbar") || document.querySelector(".bottom-dock")) {
      document.body.classList.add("has-bottom-nav");
    }

    var footer = document.createElement("footer");
    footer.className = "app-version-footer";

    var node = document.createElement("p");
    node.className = "app-version";
    node.setAttribute("aria-label", "App version");
    node.textContent = "v" + versionText;
    footer.appendChild(node);

    var main = document.querySelector("main");
    if (main && main.parentNode) {
      main.parentNode.insertBefore(footer, main.nextSibling);
    } else {
      document.body.appendChild(footer);
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("[data-apps-home]").forEach(function (el) {
      if (!el.getAttribute("href")) el.setAttribute("href", window.APPS_HOME_URL);
    });

    mountQuickExport();

    var appId = getAppIdFromPath();
    if (!appId) return;

    loadVersions().then(function (versions) {
      if (!versions || !versions.apps) return;
      if (reloadIfStaleApp(versions.apps[appId])) return;
      showAppVersion(versions.apps[appId]);
    });
  });
})();
