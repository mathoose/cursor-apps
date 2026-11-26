(function () {
  "use strict";

  var STORAGE_KEY = "quick-reader-v1";
  var APP_ID = "quick-reader";
  var EXPORT_FORMAT = "quick-reader-data";
  var MIN_WPM = 75;
  var MAX_WPM = 1000;
  var DEFAULT_WPM = 250;

  var TESSERACT_SRC = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
  var PHOTO_HINT = "Pick one or more screenshots. Text lands in the box so you can fix it before reading.";
  var PHOTO_MAX_EDGE = 1600;

  var state = loadData();
  var words = [];
  var readTimer = null;
  var toastTimer = null;
  var isReading = false;
  var photoBusy = false;
  var tesseractPromise = null;
  var ocrWorkerPromise = null;

  var els = {};

  function defaultData() {
    return {
      version: 1,
      title: "",
      sourceUrl: "",
      text: "",
      wpm: DEFAULT_WPM,
      position: 0,
      updatedAt: new Date().toISOString(),
    };
  }

  function normalizeText(text) {
    return String(text || "")
      .replace(/\r\n/g, "\n")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{4,}/g, "\n\n\n")
      .trim();
  }

  function clamp(num, min, max) {
    num = Number(num);
    if (!Number.isFinite(num)) return min;
    return Math.min(max, Math.max(min, num));
  }

  function normalizeData(raw) {
    var data = raw && typeof raw === "object" ? raw : defaultData();
    return {
      version: 1,
      title: typeof data.title === "string" ? data.title.slice(0, 180) : "",
      sourceUrl: typeof data.sourceUrl === "string" ? data.sourceUrl.slice(0, 2000) : "",
      text: normalizeText(data.text),
      wpm: clamp(data.wpm || DEFAULT_WPM, MIN_WPM, MAX_WPM),
      position: Math.max(0, Math.floor(Number(data.position) || 0)),
      updatedAt: data.updatedAt || new Date().toISOString(),
    };
  }

  function loadData() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultData();
      return normalizeData(JSON.parse(raw));
    } catch (e) {
      return defaultData();
    }
  }

  function saveData() {
    state.updatedAt = new Date().toISOString();
    state = normalizeData(state);
    if (words.length && state.position > words.length) state.position = words.length;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function toast(message) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      els.toast.classList.remove("show");
    }, 2800);
  }

  function tokenize(text) {
    var matches = normalizeText(text).match(/\S+/g);
    return matches || [];
  }

  function focusLetterOffset(word) {
    var positions = [];
    for (var i = 0; i < word.length; i++) {
      if (/[A-Za-z0-9]/.test(word.charAt(i))) positions.push(i);
    }
    if (!positions.length) return Math.max(0, Math.floor(word.length / 2));
    var focusIndex = Math.floor((positions.length - 1) * 0.35);
    return positions[focusIndex];
  }

  function wordWithFocusHtml(word) {
    word = String(word || "");
    if (!word) return "";
    var focus = focusLetterOffset(word);
    return escapeHtml(word.slice(0, focus)) +
      '<span class="focus-letter">' + escapeHtml(word.charAt(focus)) + "</span>" +
      escapeHtml(word.slice(focus + 1));
  }

  function formatCount(n, singular) {
    return n + " " + singular + (n === 1 ? "" : "s");
  }

  function displayTitle() {
    if (state.title) return state.title;
    if (state.sourceUrl) {
      try {
        return new URL(state.sourceUrl).hostname.replace(/^www\./, "");
      } catch (e) {
        return "Linked text";
      }
    }
    return "Pasted text";
  }

  function renderFullText() {
    if (!els.fullText) return;
    var text = normalizeText(state.text);
    if (!text) {
      els.fullText.innerHTML = '<p class="empty-state">Paste text or pull an article link to begin.</p>';
      return;
    }

    var lastReadIndex = state.position > 0 ? state.position - 1 : -1;
    var wordIndex = 0;
    var parts = text.match(/\S+|\s+/g) || [];
    var html = parts.map(function (part) {
      if (/^\s+$/.test(part)) return escapeHtml(part);
      var isLast = wordIndex === lastReadIndex;
      var out = '<span class="reader-word' + (isLast ? " is-last" : "") + '" data-word-index="' + wordIndex + '">';
      out += isLast ? wordWithFocusHtml(part) : escapeHtml(part);
      out += "</span>";
      wordIndex++;
      return out;
    }).join("");

    els.fullText.innerHTML = html;

    if (lastReadIndex >= 0) {
      var current = els.fullText.querySelector('[data-word-index="' + lastReadIndex + '"]');
      if (current && typeof current.scrollIntoView === "function") {
        current.scrollIntoView({ block: "center", inline: "nearest" });
      }
    }
  }

  function renderMeta() {
    var total = words.length;
    if (!total) {
      els.readerMeta.textContent = "No text loaded yet";
      els.holdWord.textContent = "Ready";
      els.holdHelp.textContent = "Lift your finger to pause and return to the full text.";
      els.progressBar.style.width = "0%";
      return;
    }

    var done = Math.min(state.position, total);
    var pct = Math.round((done / total) * 100);
    els.readerMeta.textContent = displayTitle() + " - " + done + " / " + formatCount(total, "word");
    els.progressBar.style.width = pct + "%";
    if (!isReading) {
      if (done >= total) {
        els.holdWord.textContent = "Done";
        els.holdHelp.textContent = "Tap Restart to read this text again.";
      } else if (done > 0) {
        els.holdWord.innerHTML = wordWithFocusHtml(words[done - 1]);
        els.holdHelp.textContent = "Hold again to continue from the next word.";
      } else {
        els.holdWord.textContent = "Ready";
        els.holdHelp.textContent = "Hold here to start reading.";
      }
    }
  }

  function renderSpeed() {
    els.wpmRange.value = state.wpm;
    els.wpmNumber.value = state.wpm;
  }

  function renderAll() {
    words = tokenize(state.text);
    if (state.position > words.length) state.position = words.length;
    if (els.textInput && els.textInput.value !== state.text) els.textInput.value = state.text;
    if (els.urlInput && els.urlInput.value !== state.sourceUrl) els.urlInput.value = state.sourceUrl;
    renderSpeed();
    renderMeta();
    renderFullText();
  }

  function setText(text, sourceUrl, title) {
    var nextText = normalizeText(text);
    if (!nextText) {
      toast("Add some text first.");
      return false;
    }

    state.text = nextText;
    state.sourceUrl = sourceUrl || "";
    state.title = title || "";
    state.position = 0;
    words = tokenize(state.text);
    saveData();
    renderAll();
    toast("Loaded " + formatCount(words.length, "word") + ".");
    return true;
  }

  function setWpm(value) {
    state.wpm = clamp(value, MIN_WPM, MAX_WPM);
    saveData();
    renderSpeed();
  }

  function stopReading() {
    if (readTimer) {
      clearTimeout(readTimer);
      readTimer = null;
    }
    if (!isReading) return;
    isReading = false;
    document.body.classList.remove("is-reading");
    els.holdZone.classList.remove("is-active");
    renderMeta();
    renderFullText();
  }

  function readingDelay() {
    return 60000 / clamp(state.wpm, MIN_WPM, MAX_WPM);
  }

  function showNextWord() {
    if (!isReading) return;
    if (!words.length) {
      stopReading();
      toast("Add text before reading.");
      return;
    }
    if (state.position >= words.length) {
      stopReading();
      toast("Finished.");
      return;
    }

    var word = words[state.position];
    els.holdWord.innerHTML = wordWithFocusHtml(word);
    state.position += 1;
    saveData();
    renderMeta();

    readTimer = setTimeout(showNextWord, readingDelay());
  }

  function startReading(event) {
    if (event && event.button != null && event.button !== 0) return;
    if (event && event.preventDefault) event.preventDefault();
    if (isReading) return;
    if (!words.length) {
      toast("Paste text or pull a link first.");
      return;
    }
    if (state.position >= words.length) {
      toast("You are at the end. Tap Restart to begin again.");
      return;
    }

    isReading = true;
    document.body.classList.add("is-reading");
    els.holdZone.classList.add("is-active");
    els.holdHelp.textContent = "Reading... lift to pause.";

    if (event && event.pointerId != null && els.holdZone.setPointerCapture) {
      try {
        els.holdZone.setPointerCapture(event.pointerId);
      } catch (e) {
        // Pointer capture is optional; reading still works without it.
      }
    }

    showNextWord();
  }

  function restartReading() {
    stopReading();
    state.position = 0;
    saveData();
    renderAll();
    if (words.length) toast("Restarted.");
  }

  function cleanJinaText(text) {
    var lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
    var out = [];
    var inContent = false;

    lines.forEach(function (line) {
      var trimmed = line.trim();
      if (/^Markdown Content:/i.test(trimmed)) {
        inContent = true;
        return;
      }
      if (!inContent && /^(Title|URL|Published Time|Author|Description):/i.test(trimmed)) return;
      if (/^!\[/.test(trimmed)) return;
      if (/^\[[^\]]+\]\([^)]+\)$/.test(trimmed)) return;
      out.push(line.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"));
    });

    return normalizeText(out.join("\n"));
  }

  function extractTitleFromMarkdown(text) {
    var lines = String(text || "").split("\n");
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      var match = /^Title:\s*(.+)$/i.exec(line) || /^#\s+(.+)$/.exec(line);
      if (match && match[1]) return match[1].trim().slice(0, 180);
    }
    return "";
  }

  function parseWikipediaUrl(url) {
    var parsed;
    try {
      parsed = new URL(url);
    } catch (e) {
      return null;
    }

    if (!/\.wikipedia\.org$/i.test(parsed.hostname)) return null;
    var match = /^\/wiki\/([^#?]+)$/.exec(parsed.pathname);
    if (!match) return null;

    return {
      host: parsed.hostname,
      title: decodeURIComponent(match[1]).replace(/_/g, " "),
    };
  }

  function fetchWikipediaText(url) {
    var info = parseWikipediaUrl(url);
    if (!info) return Promise.reject(new Error("Not a Wikipedia article URL."));

    var api = "https://" + info.host + "/w/api.php?action=query&prop=extracts&explaintext=1&exsectionformat=plain&format=json&origin=*&titles=" + encodeURIComponent(info.title);
    return fetch(api)
      .then(function (res) {
        if (!res.ok) throw new Error("Wikipedia request failed.");
        return res.json();
      })
      .then(function (json) {
        var pages = json && json.query && json.query.pages ? json.query.pages : {};
        var pageId = Object.keys(pages)[0];
        var page = pageId ? pages[pageId] : null;
        var extract = page && page.extract ? normalizeText(page.extract) : "";
        if (!extract) throw new Error("No readable Wikipedia text found.");
        return {
          title: page.title || info.title,
          text: extract,
        };
      });
  }

  function fetchReaderText(url) {
    var parsed;
    try {
      parsed = new URL(url);
    } catch (e) {
      return Promise.reject(new Error("Enter a full URL that starts with http:// or https://."));
    }

    if (!/^https?:$/.test(parsed.protocol)) {
      return Promise.reject(new Error("Only http and https links are supported."));
    }

    return fetch("https://r.jina.ai/" + parsed.href, {
      headers: {
        "Accept": "text/plain",
        "X-Retain-Images": "none",
        "X-Retain-Links": "text",
      },
    })
      .then(function (res) {
        if (!res.ok) throw new Error("Reader service could not load this page.");
        return res.text();
      })
      .then(function (text) {
        var cleaned = cleanJinaText(text);
        if (!cleaned || cleaned.split(/\s+/).length < 20) {
          throw new Error("Could not find enough readable text on that page.");
        }
        return {
          title: extractTitleFromMarkdown(text),
          text: cleaned,
        };
      });
  }

  function fetchUrlText(url) {
    var wiki = parseWikipediaUrl(url);
    if (wiki) return fetchWikipediaText(url);
    return fetchReaderText(url);
  }

  function setFetching(active) {
    els.fetchBtn.disabled = active;
    els.fetchBtn.textContent = active ? "Pulling..." : "Pull text";
    els.fetchHint.textContent = active ? "Trying to extract a readable version of the page." : "Some news sites block extraction. If that happens, paste the article text below.";
  }

  function handleUrlSubmit(event) {
    event.preventDefault();
    var url = (els.urlInput.value || "").trim();
    if (!url) {
      toast("Paste a URL first.");
      return;
    }

    setFetching(true);
    fetchUrlText(url)
      .then(function (result) {
        setText(result.text, url, result.title || "");
        els.fetchHint.textContent = "Text pulled successfully.";
      })
      .catch(function (err) {
        els.fetchHint.textContent = "Could not pull this page. Paste the article text instead.";
        toast(err && err.message ? err.message : "Could not pull this page.");
      })
      .finally(function () {
        setFetching(false);
      });
  }

  function downloadBlob(blob, filename) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 500);
  }

  function exportJson() {
    saveData();
    var payload = Object.assign({ format: EXPORT_FORMAT }, state);
    downloadBlob(
      new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
      "quick-reader-backup.json"
    );
    toast("Exported JSON.");
  }

  function importJsonFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(String(reader.result || "{}"));
        var slice = parsed;
        if (typeof AppsBackup !== "undefined" && AppsBackup.isUnifiedBackup(parsed)) {
          slice = AppsBackup.getAppSlice(parsed, APP_ID);
          if (!slice) {
            toast("No Quick Reader data in that backup.");
            return;
          }
        }

        var normalized = normalizeData(slice);
        if (!normalized.text) {
          toast("That backup does not contain readable text.");
          return;
        }
        state = normalized;
        words = tokenize(state.text);
        saveData();
        renderAll();
        toast("Imported Quick Reader data.");
      } catch (e) {
        toast("Could not import that JSON file.");
      }
    };
    reader.readAsText(file);
  }

  function clearAll() {
    stopReading();
    state = defaultData();
    words = [];
    saveData();
    renderAll();
    toast("Cleared.");
  }

  function realWordCount(text) {
    var words = String(text || "").match(/[A-Za-z]{3,}/g);
    return words ? words.length : 0;
  }

  function isChromeLine(line) {
    var text = String(line || "").trim();
    if (!text) return false;
    if (/^post your reply$/i.test(text)) return true;
    if (/^\d{1,2}:\d{2}(\s*(am|pm))?$/i.test(text)) return true;
    if (/^\d{1,2}:\d{2}\b/.test(text) && text.length < 28 && realWordCount(text) === 0) return true;
    if (/^[\d\s.,]+$/.test(text) && text.replace(/\D/g, "").length <= 6) return true;
    if (/^(5g|lte|wifi)$/i.test(text)) return true;
    if (!/[A-Za-z]/.test(text) && text.length <= 16) return true;
    if (text.length <= 40 && realWordCount(text) === 0 && /[\d|@¢$%]/.test(text)) return true;
    if (text.length <= 28 && realWordCount(text) === 0) return true;
    if (text.length <= 24 && realWordCount(text) <= 1 && (/[&@#]/.test(text) || /([A-Za-z])\1{2,}/.test(text))) return true;
    return false;
  }

  function endsSentence(line) {
    return /[.!?]["”']?$/.test(String(line || "").trim()) || /…$/.test(String(line || "").trim());
  }

  function tidyOcrLine(line) {
    var text = String(line || "").replace(/[ \t]+/g, " ").trim();
    text = text.replace(/(^|[\s“"(\[])[|¦∣](?=\s|$|[.,!?;:'’])/g, "$1I");
    text = text.replace(/(^|[\s“"(\[])l(?=\s)/g, "$1I");
    text = text.replace(/([.!?])(?:\s+[^A-Za-z0-9"“”']+|\s+[b-z]\b)+$/g, "$1");
    return text.trim();
  }

  function cleanOcrText(raw) {
    var lines = String(raw || "").replace(/\r\n/g, "\n").split("\n");
    var paragraphs = [];
    var current = "";

    function flush() {
      if (current) paragraphs.push(current);
      current = "";
    }

    lines.forEach(function (line) {
      var text = tidyOcrLine(line);
      if (!text) {
        flush();
        return;
      }
      if (isChromeLine(text)) return;
      if (!current) {
        current = text;
        return;
      }
      if (endsSentence(current)) {
        flush();
        current = text;
        return;
      }
      if (/-$/.test(current) && /^[a-z]/.test(text)) {
        current = current.replace(/-$/, "") + text;
        return;
      }
      current += " " + text;
    });
    flush();
    return normalizeText(paragraphs.join("\n\n"));
  }

  function isImageFile(file) {
    if (!file) return false;
    if (/^image\//.test(file.type || "")) return true;
    return /\.(png|jpe?g|gif|webp|heic|heif|bmp)$/i.test(file.name || "");
  }

  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (tesseractPromise) return tesseractPromise;
    tesseractPromise = new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = TESSERACT_SRC;
      script.async = true;
      script.onload = function () {
        if (window.Tesseract) resolve(window.Tesseract);
        else {
          tesseractPromise = null;
          reject(new Error("Could not load the photo reader. Check your connection."));
        }
      };
      script.onerror = function () {
        tesseractPromise = null;
        reject(new Error("Could not load the photo reader. Check your connection."));
      };
      document.head.appendChild(script);
    });
    return tesseractPromise;
  }

  function getOcrWorker() {
    if (ocrWorkerPromise) return ocrWorkerPromise;
    ocrWorkerPromise = loadTesseract().then(function (Tesseract) {
      return Tesseract.createWorker("eng").then(function (worker) {
        return worker.setParameters({
          tessedit_pageseg_mode: "6",
          preserve_interword_spaces: "1",
        }).then(function () {
          return worker;
        });
      });
    }).catch(function (err) {
      ocrWorkerPromise = null;
      throw err;
    });
    return ocrWorkerPromise;
  }

  function fileToCanvas(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height, 1));
        var width = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
        var height = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
        var canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        var ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(url);
        try {
          var imageData = ctx.getImageData(0, 0, width, height);
          var pixels = imageData.data;
          var sum = 0;
          var samples = 0;
          var i;
          for (i = 0; i < pixels.length; i += 64) {
            sum += pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114;
            samples++;
          }
          if (samples && sum / samples < 140) {
            for (i = 0; i < pixels.length; i += 4) {
              pixels[i] = 255 - pixels[i];
              pixels[i + 1] = 255 - pixels[i + 1];
              pixels[i + 2] = 255 - pixels[i + 2];
            }
            ctx.putImageData(imageData, 0, 0);
          }
        } catch (e) {
          // A tainted canvas cannot be inverted; recognition can still try the original.
        }
        resolve(canvas);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("Could not read that photo."));
      };
      img.src = url;
    });
  }

  function setPhotoBusy(active, message) {
    photoBusy = active;
    if (els.photoInput) els.photoInput.disabled = active;
    if (els.photoLabel) {
      els.photoLabel.classList.toggle("is-disabled", active);
      els.photoLabel.setAttribute("aria-busy", active ? "true" : "false");
    }
    if (els.photoHint) els.photoHint.textContent = message || PHOTO_HINT;
  }

  function insertPhotoText(addition, readCount, pickedCount) {
    var existing = (els.textInput.value || "").replace(/\s+$/g, "");
    els.textInput.value = existing ? existing + "\n\n" + addition : addition;
    var message = "Added text from " + readCount + " photo" + (readCount === 1 ? "" : "s") + ".";
    if (readCount < pickedCount) message = "Added text from " + readCount + " of " + pickedCount + " photos.";
    message += " Edit it, then tap Use this text.";
    toast(message);
    if (els.textInput.focus) els.textInput.focus();
  }

  function handlePhotoFiles(fileList) {
    if (photoBusy) return;
    var files = Array.prototype.filter.call(fileList || [], isImageFile);
    if (!files.length) {
      toast("Choose a photo.");
      return;
    }

    var collected = [];
    setPhotoBusy(true, "Preparing the photo reader…");

    var chain = getOcrWorker();
    files.forEach(function (file, index) {
      chain = chain.then(function (worker) {
        setPhotoBusy(true, "Reading photo " + (index + 1) + " of " + files.length + "…");
        return fileToCanvas(file).then(function (canvas) {
          return worker.recognize(canvas);
        }).then(function (result) {
          var text = cleanOcrText(result && result.data && result.data.text);
          if (text) collected.push(text);
          return worker;
        }).catch(function () {
          return getOcrWorker();
        });
      });
    });

    chain.then(function () {
      if (!collected.length) {
        toast(files.length > 1 ? "Could not find text in those photos." : "Could not find text in that photo.");
        return;
      }
      insertPhotoText(collected.join("\n\n"), collected.length, files.length);
    }).catch(function (err) {
      if (!collected.length) {
        toast(err && err.message ? err.message : "Could not read that photo.");
      } else {
        insertPhotoText(collected.join("\n\n"), collected.length, files.length);
      }
    }).then(function () {
      setPhotoBusy(false);
      if (els.photoInput) els.photoInput.value = "";
    });
  }

  function openSettings() {
    els.settingsOverlay.hidden = false;
  }

  function closeSettings() {
    els.settingsOverlay.hidden = true;
  }

  function bindEvents() {
    els.urlForm.addEventListener("submit", handleUrlSubmit);
    els.saveTextBtn.addEventListener("click", function () {
      setText(els.textInput.value, "", "");
    });
    els.clearBtn.addEventListener("click", clearAll);
    els.restartBtn.addEventListener("click", restartReading);

    els.wpmRange.addEventListener("input", function () {
      setWpm(els.wpmRange.value);
    });
    els.wpmNumber.addEventListener("change", function () {
      setWpm(els.wpmNumber.value);
    });

    els.holdZone.addEventListener("pointerdown", startReading);
    els.holdZone.addEventListener("pointerup", stopReading);
    els.holdZone.addEventListener("pointercancel", stopReading);
    els.holdZone.addEventListener("lostpointercapture", stopReading);
    window.addEventListener("blur", stopReading);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stopReading();
    });

    els.settingsBtn.addEventListener("click", openSettings);
    els.settingsCloseBtn.addEventListener("click", closeSettings);
    els.settingsOverlay.addEventListener("click", function (event) {
      if (event.target === els.settingsOverlay) closeSettings();
    });
    els.exportJsonBtn.addEventListener("click", exportJson);
    els.importJsonFile.addEventListener("change", function () {
      importJsonFile(els.importJsonFile.files && els.importJsonFile.files[0]);
      els.importJsonFile.value = "";
    });
    els.photoInput.addEventListener("change", function () {
      handlePhotoFiles(els.photoInput.files);
    });
  }

  function cacheElements() {
    [
      "settingsBtn",
      "settingsOverlay",
      "settingsCloseBtn",
      "urlForm",
      "urlInput",
      "fetchBtn",
      "fetchHint",
      "textInput",
      "photoLabel",
      "photoInput",
      "photoHint",
      "saveTextBtn",
      "clearBtn",
      "readerMeta",
      "restartBtn",
      "wpmRange",
      "wpmNumber",
      "holdZone",
      "holdWord",
      "holdHelp",
      "progressBar",
      "fullText",
      "exportJsonBtn",
      "importJsonFile",
      "toast",
    ].forEach(function (id) {
      els[id] = document.getElementById(id);
    });
  }

  function init() {
    cacheElements();
    words = tokenize(state.text);
    saveData();
    bindEvents();
    renderAll();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
