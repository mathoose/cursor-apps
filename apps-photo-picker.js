/**
 * Shared photo picker: Choose from Photos (gallery) or Take Photo (camera).
 * Include after apps-backup.js, before app scripts:
 *   <script src="../apps-photo-picker.js"></script>
 */
(function (global) {
  "use strict";

  var ACCEPT = "image/*,.heic,.heif";
  var pairCounter = 0;
  var activeOverlay = null;

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function filesFromInput(input) {
    if (!input || !input.files) return [];
    return Array.prototype.slice.call(input.files);
  }

  function isImageFile(file) {
    if (!file) return false;
    var type = (file.type || "").toLowerCase();
    if (type.indexOf("image/") === 0) return true;
    var name = (file.name || "").toLowerCase();
    return /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)$/i.test(name);
  }

  function filterImages(files) {
    return files.filter(isImageFile);
  }

  function removeOverlay() {
    if (activeOverlay && activeOverlay.parentNode) {
      activeOverlay.parentNode.removeChild(activeOverlay);
    }
    activeOverlay = null;
  }

  function createInputPair(prefix, multipleLibrary) {
    pairCounter += 1;
    var id = prefix || "apps-photo-" + pairCounter;
    var library = document.createElement("input");
    library.type = "file";
    library.accept = ACCEPT;
    library.hidden = true;
    library.id = id + "-library";
    if (multipleLibrary) library.multiple = true;

    var camera = document.createElement("input");
    camera.type = "file";
    camera.accept = "image/*";
    camera.setAttribute("capture", "environment");
    camera.hidden = true;
    camera.id = id + "-camera";

    document.body.appendChild(library);
    document.body.appendChild(camera);
    return { library: library, camera: camera };
  }

  function prompt(options) {
    options = options || {};
    var multiple = !!options.multiple;
    var onFiles = options.onFiles || function () {};
    var onCancel = options.onCancel || function () {};
    var onInvalid = options.onInvalid || function () {};
    var libraryLabel = options.libraryLabel || "Choose from Photos";
    var cameraLabel = options.cameraLabel || "Take Photo";
    var title = options.title || "Add photo";

    removeOverlay();

    var overlay = document.createElement("div");
    overlay.className = "apps-photo-choice-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.innerHTML =
      '<div class="apps-photo-choice-sheet">' +
        '<div class="apps-photo-choice-handle"></div>' +
        '<p class="apps-photo-choice-title">' + escapeHtml(title) + "</p>" +
        '<button type="button" class="apps-photo-choice-btn" data-choice="library">' + escapeHtml(libraryLabel) + "</button>" +
        '<button type="button" class="apps-photo-choice-btn" data-choice="camera">' + escapeHtml(cameraLabel) + "</button>" +
        '<button type="button" class="apps-photo-choice-cancel">Cancel</button>' +
      "</div>";

    document.body.appendChild(overlay);
    activeOverlay = overlay;

    var pair = createInputPair("apps-photo-prompt-" + Date.now(), multiple);
    var settled = false;

    function cleanup() {
      removeOverlay();
      pair.library.remove();
      pair.camera.remove();
    }

    function finish(files) {
      if (settled) return;
      settled = true;
      cleanup();
      var valid = filterImages(files);
      if (valid.length) {
        onFiles(valid);
        return;
      }
      if (files.length) onInvalid();
      else onCancel();
    }

    function wireInput(input, cb) {
      input.addEventListener("change", function onChange() {
        input.removeEventListener("change", onChange);
        var f = filesFromInput(input);
        input.value = "";
        cb(f);
      });
    }

    wireInput(pair.library, finish);
    wireInput(pair.camera, function (files) {
      finish(files.slice(0, 1));
    });

    overlay.querySelector('[data-choice="library"]').addEventListener("click", function () {
      pair.library.click();
    });
    overlay.querySelector('[data-choice="camera"]').addEventListener("click", function () {
      pair.camera.click();
    });
    overlay.querySelector(".apps-photo-choice-cancel").addEventListener("click", function () {
      finish([]);
    });
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) finish([]);
    });
  }

  function bind(options) {
    options = options || {};
    var pair = options.inputs;
    if (!pair) {
      pair = createInputPair(options.prefix, !!options.multiple);
    }
    if (options.libraryInput) pair.library = options.libraryInput;
    if (options.cameraInput) pair.camera = options.cameraInput;
    if (options.multiple) pair.library.multiple = true;
    else pair.library.removeAttribute("multiple");

    function handleFiles(files) {
      var valid = filterImages(files);
      if (!valid.length) {
        if (files.length && options.onInvalid) options.onInvalid();
        return;
      }
      if (options.onFiles) options.onFiles(valid);
    }

    if (options.libraryBtn) {
      options.libraryBtn.addEventListener("click", function () {
        pair.library.click();
      });
    }
    if (options.cameraBtn) {
      options.cameraBtn.addEventListener("click", function () {
        pair.camera.click();
      });
    }
    if (options.triggerBtn) {
      options.triggerBtn.addEventListener("click", function () {
        prompt({
          multiple: !!options.multiple,
          title: options.title,
          libraryLabel: options.libraryLabel,
          cameraLabel: options.cameraLabel,
          onFiles: handleFiles,
          onInvalid: options.onInvalid,
        });
      });
    }

    pair.library.addEventListener("change", function () {
      var f = filesFromInput(pair.library);
      pair.library.value = "";
      handleFiles(f);
    });
    pair.camera.addEventListener("change", function () {
      var f = filesFromInput(pair.camera);
      pair.camera.value = "";
      handleFiles(f.slice(0, 1));
    });

    return pair;
  }

  global.AppsPhotoPicker = {
    ACCEPT: ACCEPT,
    isImageFile: isImageFile,
    filterImages: filterImages,
    createInputPair: createInputPair,
    prompt: prompt,
    bind: bind,
  };
})(typeof window !== "undefined" ? window : this);
