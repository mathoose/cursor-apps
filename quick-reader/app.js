(function () {
  "use strict";

  var STORAGE_KEY = "quick-reader-v1";
  var APP_ID = "quick-reader";
  var EXPORT_FORMAT = "quick-reader-data";
  var MIN_WPM = 75;
  var MAX_WPM = 1000;
  var DEFAULT_WPM = 300;
  var WPM_PER_PIXEL = 1.5;

  var TESSERACT_SRC = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
  var PHOTO_HINT = "Pick screenshots. Read all of the text, or highlight just the words you want.";
  var HIGHLIGHT_HINT = "Read all takes the whole photo. Highlight and Erase choose part of it. Higher marks are read first.";
  var PHOTO_MAX_EDGE = 1600;
  var HIGHLIGHT_COLOR = "rgba(250, 204, 21, 0.45)";

  var state = loadData();
  var words = [];
  var readTimer = null;
  var toastTimer = null;
  var isReading = false;
  var jumpedToWord = false;
  var readPointerId = null;
  var slideOriginX = 0;
  var slideOriginWpm = DEFAULT_WPM;
  var wordShownAt = 0;
  var photoBusy = false;
  var tesseractPromise = null;
  var ocrWorkerPromise = null;
  var highlightPages = [];
  var undoStack = [];
  var currentStroke = null;
  var highlightMode = "draw";

  var els = {};

  function defaultData() {
    return {
      version: 1,
      title: "",
      sourceUrl: "",
      text: "",
      wpm: DEFAULT_WPM,
      defaultWpm: DEFAULT_WPM,
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

  function snapWpm(value) {
    var next = Math.round(clamp(value, MIN_WPM, MAX_WPM) / 5) * 5;
    return clamp(next, MIN_WPM, MAX_WPM);
  }

  function migrateWpm(data) {
    var saved = clamp(data && data.wpm || DEFAULT_WPM, MIN_WPM, MAX_WPM);
    if (data && data.defaultWpm == null && saved === 250) return DEFAULT_WPM;
    return snapWpm(saved);
  }

  function normalizeData(raw) {
    var data = raw && typeof raw === "object" ? raw : defaultData();
    return {
      version: 1,
      title: typeof data.title === "string" ? data.title.slice(0, 180) : "",
      sourceUrl: typeof data.sourceUrl === "string" ? data.sourceUrl.slice(0, 2000) : "",
      text: normalizeText(data.text),
      wpm: migrateWpm(data),
      defaultWpm: snapWpm(data.defaultWpm != null ? data.defaultWpm : DEFAULT_WPM),
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

    var cueIndex = -1;
    if (jumpedToWord && state.position < words.length) cueIndex = state.position;
    else if (state.position > 0) cueIndex = state.position - 1;
    var wordIndex = 0;
    var parts = text.match(/\S+|\s+/g) || [];
    var html = parts.map(function (part) {
      if (/^\s+$/.test(part)) return escapeHtml(part);
      var isCue = wordIndex === cueIndex;
      var out = '<span class="reader-word' + (isCue ? " is-start" : "") + '" data-word-index="' + wordIndex + '">';
      out += isCue ? wordWithFocusHtml(part) : escapeHtml(part);
      out += "</span>";
      wordIndex++;
      return out;
    }).join("");

    els.fullText.innerHTML = html;

    if (cueIndex >= 0) {
      var current = els.fullText.querySelector('[data-word-index="' + cueIndex + '"]');
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
      els.holdHelp.textContent = "Hold here to start reading.";
      els.progressBar.style.width = "0%";
      return;
    }

    var done = Math.min(state.position, total);
    var pct = Math.round((done / total) * 100);
    els.readerMeta.textContent = displayTitle() + " - " + done + " / " + formatCount(total, "word");
    els.progressBar.style.width = pct + "%";
    if (!isReading) {
      if (jumpedToWord && done < total) {
        els.holdWord.innerHTML = wordWithFocusHtml(words[done]);
        els.holdHelp.textContent = "Hold to start here.";
      } else if (done >= total) {
        els.holdWord.textContent = "Done";
        els.holdHelp.textContent = "Tap Restart to read this text again.";
      } else if (done > 0) {
        els.holdWord.innerHTML = wordWithFocusHtml(words[done - 1]);
        els.holdHelp.textContent = "Hold again to continue from the next word.";
      } else {
        els.holdWord.textContent = "Ready";
        els.holdHelp.textContent = "Hold here to start. Tap a word below to start there.";
      }
    }
  }

  function renderSpeed() {
    if (els.wpmRange) els.wpmRange.value = state.wpm;
    if (els.wpmNumber) els.wpmNumber.value = state.wpm;
    if (els.defaultWpmRange) els.defaultWpmRange.value = state.defaultWpm;
    if (els.defaultWpmNumber) els.defaultWpmNumber.value = state.defaultWpm;
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

  function setText(text, sourceUrl, title, toastMessage) {
    var nextText = normalizeText(text);
    if (!nextText) {
      toast("Add some text first.");
      return false;
    }

    state.text = nextText;
    state.sourceUrl = sourceUrl || "";
    state.title = title || "";
    state.position = 0;
    state.wpm = state.defaultWpm;
    jumpedToWord = false;
    words = tokenize(state.text);
    saveData();
    renderAll();
    toast(toastMessage || ("Loaded " + formatCount(words.length, "word") + "."));
    return true;
  }

  function setWpm(value, persist) {
    var next = snapWpm(value);
    var changed = next !== state.wpm;
    state.wpm = next;
    renderSpeed();
    if (changed && isReading) scheduleNextWord();
    if (persist !== false) saveData();
  }

  function setDefaultWpm(value) {
    state.defaultWpm = snapWpm(value);
    state.wpm = state.defaultWpm;
    saveData();
    renderSpeed();
    if (isReading) scheduleNextWord();
  }

  function stopReading() {
    if (readTimer) {
      clearTimeout(readTimer);
      readTimer = null;
    }
    if (!isReading) return;
    isReading = false;
    readPointerId = null;
    document.body.classList.remove("is-reading");
    els.holdZone.classList.remove("is-active");
    saveData();
    renderMeta();
    renderFullText();
  }

  function readingDelay() {
    return 60000 / clamp(state.wpm, MIN_WPM, MAX_WPM);
  }

  function scheduleNextWord() {
    if (!isReading) return;
    if (readTimer) clearTimeout(readTimer);
    var remain = readingDelay() - (Date.now() - wordShownAt);
    readTimer = setTimeout(showNextWord, Math.max(0, remain));
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
    jumpedToWord = false;
    wordShownAt = Date.now();
    saveData();
    renderMeta();
    scheduleNextWord();
  }

  function slideReadingSpeed(event) {
    if (!isReading) return;
    if (readPointerId != null && event.pointerId !== readPointerId) return;
    var dx = event.clientX - slideOriginX;
    if (Math.abs(dx) < 4) return;
    setWpm(slideOriginWpm + dx * WPM_PER_PIXEL, false);
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
    readPointerId = event && event.pointerId != null ? event.pointerId : null;
    slideOriginX = event && event.clientX != null ? event.clientX : 0;
    slideOriginWpm = state.wpm;
    document.body.classList.add("is-reading");
    els.holdZone.classList.add("is-active");
    els.holdHelp.textContent = "Slide right to go faster, left to go slower.";

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
    jumpedToWord = false;
    state.position = 0;
    saveData();
    renderAll();
    if (words.length) toast("Restarted.");
  }

  function jumpTo(index) {
    if (!words.length) {
      toast("Add text before reading.");
      return;
    }
    stopReading();
    var next = Math.max(0, Math.min(words.length, Math.floor(Number(index) || 0)));
    state.position = next;
    jumpedToWord = next < words.length;
    saveData();
    renderMeta();
    renderFullText();
  }

  function isSentenceEnd(word) {
    return /[.!?]["')\]]*$/.test(word);
  }

  function sentenceStart(index) {
    var i = Math.min(index, words.length) - 1;
    while (i >= 0 && !isSentenceEnd(words[i])) i--;
    return i + 1;
  }

  function backOneSentence() {
    if (!words.length) {
      toast("Add text before reading.");
      return;
    }
    var start = sentenceStart(state.position);
    var next = state.position > start ? start : (start === 0 ? 0 : sentenceStart(start - 1));
    if (next === state.position) {
      toast("You're at the start.");
      return;
    }
    jumpTo(next);
  }

  function backTenWords() {
    if (!words.length) {
      toast("Add text before reading.");
      return;
    }
    var next = Math.max(0, state.position - 10);
    if (next === state.position) {
      toast("You're at the start.");
      return;
    }
    jumpTo(next);
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
    var keptDefault = state.defaultWpm;
    jumpedToWord = false;
    state = defaultData();
    state.defaultWpm = snapWpm(keptDefault);
    state.wpm = state.defaultWpm;
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

  function insertPhotoText(addition, readCount, pickedCount, noun) {
    var existing = (els.textInput.value || "").replace(/\s+$/g, "");
    var combined = existing ? existing + "\n\n" + addition : addition;
    var message;
    if (noun === "highlight") {
      message = readCount < pickedCount
        ? "Loaded text from " + readCount + " of " + pickedCount + " highlights."
        : "Loaded the highlighted text.";
    } else if (noun === "page") {
      message = readCount < pickedCount
        ? "Loaded text from " + readCount + " of " + pickedCount + " photos."
        : (readCount === 1 ? "Loaded all the text from the photo." : "Loaded all the text from " + readCount + " photos.");
    } else {
      message = "Loaded text from " + readCount + " photo" + (readCount === 1 ? "" : "s") + ".";
      if (readCount < pickedCount) message = "Loaded text from " + readCount + " of " + pickedCount + " photos.";
    }
    if (!setText(combined, "", "", message)) {
      els.textInput.value = combined;
      return;
    }
    showReader();
  }

  function showReader() {
    var reader = document.querySelector(".reader-card");
    var main = document.querySelector(".main-panel");
    if (!reader || !main) return;
    var spacer = document.getElementById("readerSpacer");
    if (!spacer) {
      spacer = document.createElement("div");
      spacer.id = "readerSpacer";
      spacer.setAttribute("aria-hidden", "true");
      main.appendChild(spacer);
    }
    spacer.style.height = "0px";
    var top = reader.getBoundingClientRect().top + window.pageYOffset;
    var max = document.documentElement.scrollHeight - window.innerHeight;
    if (top > max) spacer.style.height = (top - max + 12) + "px";
    window.scrollTo(0, Math.max(0, top));
  }

  function canvasForOcr(source) {
    var canvas = document.createElement("canvas");
    canvas.width = source.width;
    canvas.height = source.height;
    var ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(source, 0, 0);
    try {
      var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
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
    return canvas;
  }

  function brushBitmapSize(canvas) {
    var css = Number(els.brushRange && els.brushRange.value);
    if (!css) css = 36;
    var rect = canvas.getBoundingClientRect();
    var scale = rect.width ? canvas.width / rect.width : 1;
    return Math.max(4, css * scale);
  }

  function drawStroke(ctx, stroke) {
    if (!stroke.points.length) return;
    ctx.lineWidth = stroke.size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (stroke.points.length === 1) {
      ctx.beginPath();
      ctx.arc(stroke.points[0].x, stroke.points[0].y, stroke.size / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (var i = 1; i < stroke.points.length; i++) {
      ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
    }
    ctx.stroke();
  }

  function paintStrokes(ctx, strokes, markStyle) {
    strokes.forEach(function (stroke) {
      if (stroke.kind === "erase") {
        ctx.globalCompositeOperation = "destination-out";
        ctx.strokeStyle = "rgba(0,0,0,1)";
        ctx.fillStyle = "rgba(0,0,0,1)";
      } else {
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = markStyle;
        ctx.fillStyle = markStyle;
      }
      drawStroke(ctx, stroke);
    });
    ctx.globalCompositeOperation = "source-over";
  }

  function redrawStrokes(page) {
    var ctx = page.draw.getContext("2d");
    ctx.clearRect(0, 0, page.draw.width, page.draw.height);
    paintStrokes(ctx, page.strokes, HIGHLIGHT_COLOR);
  }

  function pointFromEvent(canvas, event) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * canvas.width / (rect.width || canvas.width),
      y: (event.clientY - rect.top) * canvas.height / (rect.height || canvas.height),
    };
  }

  function setHighlightMode(mode) {
    highlightMode = mode === "move" || mode === "erase" ? mode : "draw";
    currentStroke = null;
    if (els.highlightSheet) {
      els.highlightSheet.classList.toggle("is-moving", highlightMode === "move");
      els.highlightSheet.classList.toggle("is-erasing", highlightMode === "erase");
    }
    [
      ["highlightModeBtn", "draw"],
      ["eraseModeBtn", "erase"],
      ["moveModeBtn", "move"],
    ].forEach(function (pair) {
      var button = els[pair[0]];
      if (!button) return;
      var selected = highlightMode === pair[1];
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    });
  }

  function setHighlightBusy(active, message) {
    photoBusy = active;
    ["readAllBtn", "highlightPullBtn", "highlightUndoBtn", "highlightClearBtn", "highlightCancelBtn", "brushRange", "highlightModeBtn", "eraseModeBtn", "moveModeBtn"].forEach(function (id) {
      if (els[id]) els[id].disabled = active;
    });
    if (els.photoInput) els.photoInput.disabled = active;
    if (els.highlightStatus) els.highlightStatus.textContent = message || HIGHLIGHT_HINT;
  }

  function closeHighlighter() {
    currentStroke = null;
    highlightPages = [];
    undoStack = [];
    if (els.highlightPages) els.highlightPages.innerHTML = "";
    if (els.highlightOverlay) els.highlightOverlay.hidden = true;
    document.body.classList.remove("is-highlighting");
    setHighlightMode("draw");
    setHighlightBusy(false);
  }

  function bindDrawCanvas(page) {
    var canvas = page.draw;
    canvas.addEventListener("pointerdown", function (event) {
      if ((highlightMode !== "draw" && highlightMode !== "erase") || photoBusy) return;
      if (event.button != null && event.button !== 0) return;
      if (event.preventDefault) event.preventDefault();
      var stroke = {
        kind: highlightMode === "erase" ? "erase" : "mark",
        points: [pointFromEvent(canvas, event)],
        size: brushBitmapSize(canvas),
      };
      page.strokes.push(stroke);
      undoStack.push(page);
      currentStroke = stroke;
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch (e) {
        // Capture is optional; the stroke still follows the pointer.
      }
      redrawStrokes(page);
    });
    canvas.addEventListener("pointermove", function (event) {
      if (!currentStroke || (highlightMode !== "draw" && highlightMode !== "erase")) return;
      if (event.preventDefault) event.preventDefault();
      currentStroke.points.push(pointFromEvent(canvas, event));
      redrawStrokes(page);
    });
    function endStroke() {
      currentStroke = null;
    }
    canvas.addEventListener("pointerup", endStroke);
    canvas.addEventListener("pointercancel", endStroke);
  }

  function openHighlighter(pages) {
    highlightPages = pages;
    undoStack = [];
    currentStroke = null;
    els.highlightPages.innerHTML = "";
    pages.forEach(function (page, index) {
      var figure = document.createElement("figure");
      figure.className = "highlight-figure";
      if (pages.length > 1) {
        var label = document.createElement("p");
        label.className = "highlight-page-label";
        label.textContent = "Photo " + (index + 1) + " of " + pages.length;
        figure.appendChild(label);
      }
      var frame = document.createElement("div");
      frame.className = "highlight-page";
      page.display.className = "highlight-photo";
      page.draw = document.createElement("canvas");
      page.draw.className = "highlight-draw";
      page.draw.width = page.display.width;
      page.draw.height = page.display.height;
      page.draw.setAttribute("aria-label", "Highlight the words to read");
      frame.appendChild(page.display);
      frame.appendChild(page.draw);
      figure.appendChild(frame);
      els.highlightPages.appendChild(figure);
      page.strokes = [];
      bindDrawCanvas(page);
    });
    setHighlightMode("draw");
    if (els.highlightStatus) els.highlightStatus.textContent = HIGHLIGHT_HINT;
    els.highlightOverlay.hidden = false;
    document.body.classList.add("is-highlighting");
    if (els.highlightPages.scrollTo) els.highlightPages.scrollTo(0, 0);
  }

  function undoHighlight() {
    currentStroke = null;
    var page = undoStack.pop();
    if (!page) return;
    page.strokes.pop();
    redrawStrokes(page);
  }

  function clearHighlights() {
    undoStack = [];
    currentStroke = null;
    highlightPages.forEach(function (page) {
      page.strokes = [];
      redrawStrokes(page);
    });
  }

  function centerY(box) {
    return (box.minY + box.maxY) / 2;
  }

  function sameBand(a, b) {
    var ah = Math.max(1, a.maxY - a.minY);
    var bh = Math.max(1, b.maxY - b.minY);
    return Math.abs(centerY(a) - centerY(b)) <= Math.min(ah, bh) * 0.6;
  }

  function readingOrder(boxes) {
    var items = boxes.slice().sort(function (a, b) {
      return centerY(a) - centerY(b) || a.minX - b.minX;
    });
    var rows = [];
    items.forEach(function (box) {
      var row = rows[rows.length - 1];
      if (!row || !sameBand(row.anchor, box)) rows.push({ anchor: box, boxes: [box] });
      else row.boxes.push(box);
    });
    return rows.map(function (row) {
      row.boxes.sort(function (a, b) {
        return a.minX - b.minX || a.minY - b.minY;
      });
      return row.boxes;
    });
  }

  function dilateMask(mask, width, height, radius) {
    var tmp = new Uint8Array(mask.length);
    var out = new Uint8Array(mask.length);
    var y, x, k, max, xx, yy;
    for (y = 0; y < height; y++) {
      for (x = 0; x < width; x++) {
        max = 0;
        for (k = -radius; k <= radius; k++) {
          xx = x + k;
          if (xx >= 0 && xx < width && mask[y * width + xx]) {
            max = 1;
            break;
          }
        }
        tmp[y * width + x] = max;
      }
    }
    for (y = 0; y < height; y++) {
      for (x = 0; x < width; x++) {
        max = 0;
        for (k = -radius; k <= radius; k++) {
          yy = y + k;
          if (yy >= 0 && yy < height && tmp[yy * width + x]) {
            max = 1;
            break;
          }
        }
        out[y * width + x] = max;
      }
    }
    return out;
  }

  function strokesToMask(page) {
    var width = page.display.width;
    var height = page.display.height;
    var canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    var ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);
    paintStrokes(ctx, page.strokes, "#fff");
    var image = ctx.getImageData(0, 0, width, height);
    var raw = new Uint8Array(width * height);
    var pixels = image.data;
    for (var i = 0; i < raw.length; i++) {
      var p = i * 4;
      raw[i] = pixels[p + 3] > 127 && pixels[p] > 127 ? 1 : 0;
    }
    return dilateMask(raw, width, height, 4);
  }

  function highlightBoxes(mask, width, height) {
    var seen = new Uint8Array(mask.length);
    var boxes = [];
    var stack = [];
    function consider(index) {
      if (!mask[index] || seen[index]) return;
      seen[index] = 1;
      stack.push(index);
    }
    for (var y = 0; y < height; y++) {
      for (var x = 0; x < width; x++) {
        var start = y * width + x;
        if (!mask[start] || seen[start]) continue;
        var minX = x;
        var maxX = x;
        var minY = y;
        var maxY = y;
        var count = 0;
        consider(start);
        while (stack.length) {
          var idx = stack.pop();
          var cx = idx % width;
          var cy = (idx - cx) / width;
          count++;
          if (cx < minX) minX = cx;
          if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy;
          if (cy > maxY) maxY = cy;
          if (cx > 0) consider(idx - 1);
          if (cx + 1 < width) consider(idx + 1);
          if (cy > 0) consider(idx - width);
          if (cy + 1 < height) consider(idx + width);
        }
        if (count >= 80 && maxX - minX >= 8 && maxY - minY >= 8) {
          boxes.push({ minX: minX, minY: minY, maxX: maxX + 1, maxY: maxY + 1 });
        }
      }
    }
    return boxes;
  }

  function cropForOcr(source, box) {
    var pad = 8;
    var x0 = Math.max(0, box.minX - pad);
    var y0 = Math.max(0, box.minY - pad);
    var x1 = Math.min(source.width, box.maxX + pad);
    var y1 = Math.min(source.height, box.maxY + pad);
    var w = Math.max(1, x1 - x0);
    var h = Math.max(1, y1 - y0);
    var canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(source, x0, y0, w, h, 0, 0, w, h);
    return canvas;
  }

  function recognizeCrop(worker, canvas) {
    return worker.recognize(canvas).then(function (result) {
      return cleanOcrText(result && result.data && result.data.text);
    });
  }

  function pageHasMark(page) {
    return page.strokes.some(function (stroke) {
      return stroke.kind !== "erase";
    });
  }

  function regionsForPage(page) {
    if (!pageHasMark(page)) return [];
    var width = page.display.width;
    var height = page.display.height;
    var mask = strokesToMask(page);
    return readingOrder(highlightBoxes(mask, width, height)).map(function (row) {
      return row.map(function (box) {
        return cropForOcr(page.ocr, box);
      });
    });
  }

  function pullHighlightedText() {
    if (photoBusy) return;
    var marked = highlightPages.some(pageHasMark);
    if (!marked) {
      toast("Highlight the words you want.");
      return;
    }

    setHighlightBusy(true, "Finding highlighted text…");
    Promise.resolve().then(function () {
      var jobs = [];
      highlightPages.forEach(function (page) {
        regionsForPage(page).forEach(function (row) {
          if (row.length) jobs.push(row);
        });
      });
      if (!jobs.length) {
        toast("Highlight the words you want.");
        setHighlightBusy(false);
        return;
      }
      readHighlightJobs(jobs, "highlight");
    });
  }

  function pullAllText() {
    if (photoBusy || !highlightPages.length) return;
    readHighlightJobs(highlightPages.map(function (page) {
      return [page.ocr];
    }), "page");
  }

  function readHighlightJobs(jobs, noun) {
    var collected = [];
    var attempted = jobs.length;
    setHighlightBusy(true, "Preparing the photo reader…");
    var chain = getOcrWorker();
    jobs.forEach(function (row, index) {
      chain = chain.then(function (worker) {
        var label = noun === "page" ? "photo" : "highlight";
        setHighlightBusy(true, "Reading " + label + " " + (index + 1) + " of " + jobs.length + "…");
        var parts = [];
        var step = Promise.resolve(worker);
        row.forEach(function (canvas) {
          step = step.then(function (current) {
            return recognizeCrop(current, canvas).then(function (text) {
              if (text) parts.push(text);
              return current;
            });
          });
        });
        return step.then(function (current) {
          if (parts.length) collected.push(parts.join(" "));
          return current;
        }).catch(function () {
          return getOcrWorker();
        });
      });
    });

    chain.then(function () {
      if (!collected.length) {
        toast(noun === "page" ? "Could not find text in the photo." : "Could not find text in the highlight.");
        setHighlightBusy(false);
        return;
      }
      var text = collected.join("\n\n");
      closeHighlighter();
      insertPhotoText(text, collected.length, attempted, noun || "highlight");
    }).catch(function (err) {
      if (!collected.length) {
        toast(err && err.message ? err.message : (noun === "page" ? "Could not read that photo." : "Could not read that highlight."));
        setHighlightBusy(false);
        return;
      }
      closeHighlighter();
      insertPhotoText(collected.join("\n\n"), collected.length, attempted, noun || "highlight");
    });
  }

  function handlePhotoFiles(fileList) {
    if (photoBusy) return;
    if (els.highlightOverlay && !els.highlightOverlay.hidden) closeHighlighter();
    var files = Array.prototype.filter.call(fileList || [], isImageFile);
    if (!files.length) {
      toast("Choose a photo.");
      if (els.photoInput) els.photoInput.value = "";
      return;
    }

    var loaded = [];
    setPhotoBusy(true, "Opening photos…");
    var chain = Promise.resolve();
    files.forEach(function (file) {
      chain = chain.then(function () {
        return fileToCanvas(file).then(function (canvas) {
          loaded.push({
            display: canvas,
            ocr: canvasForOcr(canvas),
            strokes: [],
          });
        }).catch(function () {});
      });
    });

    chain.then(function () {
      setPhotoBusy(false);
      if (els.photoInput) els.photoInput.value = "";
      if (!loaded.length) {
        toast(files.length > 1 ? "Could not open those photos." : "Could not open that photo.");
        return;
      }
      openHighlighter(loaded);
    }).catch(function (err) {
      setPhotoBusy(false);
      if (els.photoInput) els.photoInput.value = "";
      toast(err && err.message ? err.message : "Could not open that photo.");
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
    els.sentenceBackBtn.addEventListener("click", backOneSentence);
    els.wordsBackBtn.addEventListener("click", backTenWords);
    els.fullText.addEventListener("click", function (event) {
      var node = event.target && event.target.closest ? event.target.closest(".reader-word") : null;
      if (!node || !els.fullText.contains(node)) return;
      var index = Number(node.getAttribute("data-word-index"));
      if (!Number.isFinite(index)) return;
      jumpTo(index);
    });

    els.wpmRange.addEventListener("input", function () {
      setWpm(els.wpmRange.value);
    });
    els.wpmNumber.addEventListener("change", function () {
      setWpm(els.wpmNumber.value);
    });
    els.defaultWpmRange.addEventListener("input", function () {
      setDefaultWpm(els.defaultWpmRange.value);
    });
    els.defaultWpmNumber.addEventListener("change", function () {
      setDefaultWpm(els.defaultWpmNumber.value);
    });

    els.holdZone.addEventListener("pointerdown", startReading);
    els.holdZone.addEventListener("pointermove", slideReadingSpeed);
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
    els.brushRange.addEventListener("input", function () {
      els.brushValue.textContent = els.brushRange.value;
    });
    els.highlightModeBtn.addEventListener("click", function () {
      setHighlightMode("draw");
    });
    els.eraseModeBtn.addEventListener("click", function () {
      setHighlightMode("erase");
    });
    els.moveModeBtn.addEventListener("click", function () {
      setHighlightMode("move");
    });
    els.highlightUndoBtn.addEventListener("click", undoHighlight);
    els.highlightClearBtn.addEventListener("click", clearHighlights);
    els.highlightCancelBtn.addEventListener("click", closeHighlighter);
    els.readAllBtn.addEventListener("click", pullAllText);
    els.highlightPullBtn.addEventListener("click", pullHighlightedText);
    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape") return;
      if (!els.highlightOverlay || els.highlightOverlay.hidden || photoBusy) return;
      closeHighlighter();
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
      "highlightOverlay",
      "highlightSheet",
      "highlightPages",
      "highlightStatus",
      "brushRange",
      "brushValue",
      "highlightModeBtn",
      "eraseModeBtn",
      "moveModeBtn",
      "readAllBtn",
      "highlightUndoBtn",
      "highlightClearBtn",
      "highlightPullBtn",
      "highlightCancelBtn",
      "saveTextBtn",
      "clearBtn",
      "readerMeta",
      "restartBtn",
      "sentenceBackBtn",
      "wordsBackBtn",
      "wpmRange",
      "wpmNumber",
      "defaultWpmRange",
      "defaultWpmNumber",
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
