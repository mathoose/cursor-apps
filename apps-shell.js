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

  // How tall the fixed bottom chrome is, measured from the viewport bottom.
  function dockLift() {
    var lift = 0;
    chromeHosts().forEach(function (host) {
      var style = window.getComputedStyle(host);
      if (style.display === "none" || style.visibility === "hidden") return;
      var rect = host.getBoundingClientRect();
      if (rect.height < 8) return;
      var fromBottom = window.innerHeight - rect.top;
      if (fromBottom < 8 || fromBottom > window.innerHeight * 0.55) return;
      if (fromBottom > lift) lift = fromBottom;
    });
    return Math.round(lift);
  }

  function mountQuickExport() {
    if (!window.AppsBackup || !AppsBackup.exportAll || !AppsBackup.downloadBundle) return;
    if (document.querySelector(".apps-quick-export-bar")) return;

    var bar = document.createElement("div");
    bar.className = "apps-quick-export-bar";
    bar.setAttribute("data-apps-export-bar", "");

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "apps-quick-export";
    btn.id = "appsQuickExport";
    btn.addEventListener("click", function () {
      try {
        AppsBackup.downloadBundle(AppsBackup.exportAll(), AppsBackup.defaultFilename());
        refresh();
      } catch (e) { /* leave the label unchanged */ }
    });
    bar.appendChild(btn);
    document.body.appendChild(bar);

    function refresh() {
      var label = exportLineLabel();
      btn.textContent = label;
      btn.setAttribute("aria-label", label + ". Downloads a backup of all apps.");
    }

    function padTargets() {
      var nodes = [];
      function take(node) {
        if (!node || nodes.indexOf(node) >= 0) return;
        nodes.push(node);
      }
      take(document.querySelector(".app"));
      take(document.querySelector("main"));
      take(document.getElementById("app"));
      // Apps with min-height: 100dvh need the clearance inside the root, not only on body.
      if (!nodes.length) take(document.body);
      return nodes;
    }

    function syncPad() {
      var lift = dockLift();
      bar.classList.toggle("is-above-dock", lift > 0);
      bar.style.bottom = lift ? lift + "px" : "0px";

      var barRect = bar.getBoundingClientRect();
      var barTop = barRect.height > 2 ? barRect.top : window.innerHeight - 44;
      var needed = Math.ceil(window.innerHeight - barTop) + 2;
      if (needed < 16) needed = 16;

      document.documentElement.style.setProperty("--apps-export-offset", needed + "px");
      document.body.style.paddingBottom = "";
      var bodyBase = parseFloat(window.getComputedStyle(document.body).paddingBottom) || 0;
      document.body.style.paddingBottom = Math.max(Math.ceil(bodyBase), needed) + "px";

      padTargets().forEach(function (node) {
        if (node === document.body) return;
        node.style.paddingBottom = "";
        var base = parseFloat(window.getComputedStyle(node).paddingBottom) || 0;
        node.style.paddingBottom = Math.max(Math.ceil(base), needed) + "px";
        node.style.boxSizing = "border-box";
      });
    }

    refresh();
    document.body.classList.add("apps-has-quick-export");
    syncPad();

    if (window.ResizeObserver) {
      var observer = new ResizeObserver(function () { syncPad(); });
      observer.observe(bar);
      observer.observe(btn);
      chromeHosts().forEach(function (host) { observer.observe(host); });
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
      if (document.visibilityState === "visible") {
        refresh();
        syncPad();
      }
    });
    window.AppsQuickExport = { refresh: refresh, syncPad: syncPad };
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
