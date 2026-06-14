(function () {
  'use strict';

  var STORAGE_KEY = 'shopping-list-v1';
  var APP_ID = 'shopping-list';
  var TEXT_MARKER = 'shop-list-v1';
  var toastTimer = null;

  var state = {
    view: 'list',
    pickSelected: {},
  };

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function defaultData() {
    return { version: 1, items: [] };
  }

  function normalizeText(text) {
    return String(text || '').trim().replace(/\s+/g, ' ');
  }

  function normalizeKey(text) {
    return normalizeText(text).toLowerCase();
  }

  function normalizeData(raw) {
    var data = raw && typeof raw === 'object' ? raw : defaultData();
    if (!Array.isArray(data.items)) data.items = [];
    data.version = 1;
    data.items = data.items
      .filter(function (it) {
        return it && it.id && normalizeText(it.text);
      })
      .map(function (it) {
        return {
          id: it.id,
          text: normalizeText(it.text),
          checked: !!it.checked,
          createdAt: it.createdAt || new Date().toISOString(),
        };
      });
    data.items.sort(function (a, b) {
      return new Date(a.createdAt) - new Date(b.createdAt);
    });
    return data;
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

  function saveData(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeData(data)));
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toast(msg) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove('show');
    }, 2800);
  }

  function downloadBlob(blob, filename) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 500);
  }

  /* ——— Text format for Messages ——— */

  function formatShareText(items, title) {
    title = title || 'Grocery list';
    var lines = [title, ''];
    items.forEach(function (it) {
      lines.push('• ' + it.text);
    });
    lines.push('');
    lines.push('—');
    lines.push(TEXT_MARKER);
    return lines.join('\n');
  }

  function parseTextList(text) {
    if (!text || !String(text).trim()) return [];
    var lines = String(text).replace(/\r\n/g, '\n').split('\n');
    var items = [];
    var seen = {};
    var afterMarker = false;
    var started = false;

    lines.forEach(function (line) {
      var trimmed = line.trim();
      if (!trimmed) return;

      if (trimmed === TEXT_MARKER || trimmed === '---' || trimmed === '—') {
        if (trimmed === TEXT_MARKER) afterMarker = true;
        return;
      }

      if (/^shop-list/i.test(trimmed)) return;

      if (/^grocery|^our groceries|^shopping list|^shared list/i.test(trimmed)) {
        started = true;
        return;
      }

      if (afterMarker) return;

      var itemText = trimmed
        .replace(/^[\u2022\u2023\u25E6\u2043\u2219•\-\*\u2013\u2014]\s*/, '')
        .replace(/^\d+[\.\)]\s*/, '')
        .trim();

      if (!itemText || itemText.length > 120) return;
      if (/^paste into|^import|^sent from/i.test(itemText)) return;

      var key = normalizeKey(itemText);
      if (seen[key]) return;
      seen[key] = true;
      items.push(itemText);
      started = true;
    });

    if (!started && !items.length) {
      lines.forEach(function (line) {
        var trimmed = line.trim();
        if (!trimmed || trimmed === '---' || trimmed === '—') return;
        var itemText = trimmed
          .replace(/^[\u2022\u2023\u25E6\u2043\u2219•\-\*\u2013\u2014]\s*/, '')
          .replace(/^\d+[\.\)]\s*/, '')
          .trim();
        if (!itemText) return;
        var key = normalizeKey(itemText);
        if (seen[key]) return;
        seen[key] = true;
        items.push(itemText);
      });
    }

    return items;
  }

  function mergeItemsAdditive(existing, incomingTexts) {
    var data = normalizeData(existing);
    var keys = {};
    data.items.forEach(function (it) {
      keys[normalizeKey(it.text)] = true;
    });
    var added = 0;
    incomingTexts.forEach(function (text) {
      var norm = normalizeText(text);
      if (!norm) return;
      var key = normalizeKey(norm);
      if (keys[key]) return;
      keys[key] = true;
      data.items.push({
        id: uid(),
        text: norm,
        checked: false,
        createdAt: new Date().toISOString(),
      });
      added++;
    });
    return { data: data, added: added };
  }

  function mergeJsonAdditive(existing, incoming) {
    var data = normalizeData(existing);
    var ids = {};
    var keys = {};
    data.items.forEach(function (it) {
      ids[it.id] = true;
      keys[normalizeKey(it.text)] = true;
    });
    var added = 0;
    (incoming.items || []).forEach(function (it) {
      if (!it || !normalizeText(it.text)) return;
      var norm = normalizeText(it.text);
      var key = normalizeKey(norm);
      if (ids[it.id] || keys[key]) return;
      ids[it.id] = true;
      keys[key] = true;
      data.items.push({
        id: it.id || uid(),
        text: norm,
        checked: !!it.checked,
        createdAt: it.createdAt || new Date().toISOString(),
      });
      added++;
    });
    return { data: data, added: added };
  }

  /* ——— Render ——— */

  function setView(view) {
    state.view = view;
    document.body.className = 'view-' + view;
    document.querySelectorAll('.view').forEach(function (el) {
      el.classList.toggle('active', el.dataset.view === view);
    });
    document.querySelectorAll('.nav-btn').forEach(function (btn) {
      var on = btn.dataset.view === view;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    render();
  }

  function renderMainList(data) {
    var list = document.getElementById('mainList');
    var empty = document.getElementById('listEmpty');
    var countEl = document.getElementById('listCount');
    var clearBtn = document.getElementById('clearCheckedBtn');
    if (!list) return;

    var items = data.items;
    var checkedCount = items.filter(function (it) { return it.checked; }).length;

    countEl.textContent = items.length + ' item' + (items.length === 1 ? '' : 's');
    clearBtn.hidden = checkedCount === 0;
    empty.hidden = items.length > 0;

    list.innerHTML = items.map(function (it) {
      return (
        '<li class="item-row' + (it.checked ? ' checked' : '') + '" data-id="' + escapeHtml(it.id) + '">' +
          '<button type="button" class="item-check' + (it.checked ? ' on' : '') + '" aria-label="' + (it.checked ? 'Uncheck' : 'Check') + ' ' + escapeHtml(it.text) + '">' +
            '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>' +
          '</button>' +
          '<span class="item-text">' + escapeHtml(it.text) + '</span>' +
          '<button type="button" class="item-delete" aria-label="Delete ' + escapeHtml(it.text) + '">' +
            '<svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
          '</button>' +
        '</li>'
      );
    }).join('');
  }

  function renderPickList(data) {
    var list = document.getElementById('pickList');
    var empty = document.getElementById('pickEmpty');
    var countEl = document.getElementById('pickCount');
    var clearBtn = document.getElementById('clearPickBtn');
    var shareBtn = document.getElementById('shareBtn');
    var copyBtn = document.getElementById('copyBtn');
    if (!list) return;

    var items = data.items.filter(function (it) { return !it.checked; });
    var selectedCount = 0;
    items.forEach(function (it) {
      if (state.pickSelected[it.id]) selectedCount++;
    });

    countEl.textContent = selectedCount + ' selected';
    clearBtn.hidden = selectedCount === 0;
    shareBtn.disabled = selectedCount === 0;
    copyBtn.disabled = selectedCount === 0;
    empty.hidden = data.items.length > 0;
    list.innerHTML = '';

    if (!data.items.length) return;

    list.innerHTML = data.items.map(function (it) {
      var picked = !!state.pickSelected[it.id];
      return (
        '<li class="item-row' + (picked ? ' selected' : '') + (it.checked ? ' checked' : '') + '" data-id="' + escapeHtml(it.id) + '">' +
          '<button type="button" class="item-pick' + (picked ? ' on' : '') + '" aria-label="' + (picked ? 'Deselect' : 'Select') + ' ' + escapeHtml(it.text) + '">' +
            '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>' +
          '</button>' +
          '<span class="item-text">' + escapeHtml(it.text) + '</span>' +
        '</li>'
      );
    }).join('');
  }

  function render() {
    var data = loadData();
    renderMainList(data);
    renderPickList(data);
  }

  /* ——— Actions ——— */

  function addItem(text) {
    var norm = normalizeText(text);
    if (!norm) return false;
    var data = loadData();
    var key = normalizeKey(norm);
    var exists = data.items.some(function (it) {
      return normalizeKey(it.text) === key;
    });
    if (exists) {
      toast('Already on the list');
      return false;
    }
    data.items.push({
      id: uid(),
      text: norm,
      checked: false,
      createdAt: new Date().toISOString(),
    });
    saveData(data);
    render();
    return true;
  }

  function toggleChecked(id) {
    var data = loadData();
    data.items.forEach(function (it) {
      if (it.id === id) it.checked = !it.checked;
    });
    saveData(data);
    render();
  }

  function deleteItem(id) {
    var data = loadData();
    data.items = data.items.filter(function (it) { return it.id !== id; });
    delete state.pickSelected[id];
    saveData(data);
    render();
  }

  function clearChecked() {
    var data = loadData();
    var before = data.items.length;
    data.items = data.items.filter(function (it) { return !it.checked; });
    var removed = before - data.items.length;
    Object.keys(state.pickSelected).forEach(function (id) {
      if (!data.items.some(function (it) { return it.id === id; })) {
        delete state.pickSelected[id];
      }
    });
    saveData(data);
    toast(removed ? ('Removed ' + removed + ' checked') : 'Nothing to clear');
    render();
  }

  function togglePick(id) {
    if (state.pickSelected[id]) delete state.pickSelected[id];
    else state.pickSelected[id] = true;
    renderPickList(loadData());
  }

  function selectAllPick() {
    var data = loadData();
    data.items.forEach(function (it) {
      state.pickSelected[it.id] = true;
    });
    renderPickList(data);
  }

  function clearPick() {
    state.pickSelected = {};
    renderPickList(loadData());
  }

  function getSelectedItems() {
    var data = loadData();
    return data.items.filter(function (it) {
      return state.pickSelected[it.id];
    });
  }

  function shareSelected() {
    var items = getSelectedItems();
    if (!items.length) return;
    var dateStr = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    var text = formatShareText(items, 'Grocery run — ' + dateStr);

    if (navigator.share) {
      navigator.share({ title: 'Grocery list', text: text }).then(function () {
        toast('Shared!');
      }).catch(function (err) {
        if (err && err.name === 'AbortError') return;
        copyText(text);
      });
    } else {
      copyText(text);
    }
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast('Copied — paste in Messages');
      }).catch(function () {
        fallbackCopy(text);
      });
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      toast('Copied — paste in Messages');
    } catch (e) {
      toast('Could not copy');
    }
    document.body.removeChild(ta);
  }

  function importPastedText(text) {
    var parsed = parseTextList(text);
    if (!parsed.length) {
      toast('No items found in paste');
      return 0;
    }
    var result = mergeItemsAdditive(loadData(), parsed);
    saveData(result.data);
    render();
    return result.added;
  }

  function exportJson() {
    var data = loadData();
    downloadBlob(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      'shopping-list-backup-' + new Date().toISOString().slice(0, 10) + '.json'
    );
    toast('Exported');
  }

  function importJson(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(reader.result);
        var slice = parsed;

        if (typeof AppsBackup !== 'undefined' && AppsBackup.isUnifiedBackup(parsed)) {
          slice = AppsBackup.getAppSlice(parsed, APP_ID);
          if (!slice) {
            toast('No grocery list data in this file');
            return;
          }
        }

        if (slice && Array.isArray(slice.items)) {
          var result = mergeJsonAdditive(loadData(), slice);
          saveData(result.data);
          toast(result.added
            ? ('Added ' + result.added + ' item' + (result.added === 1 ? '' : 's'))
            : 'No new items to add');
          render();
          return;
        }

        if (typeof parsed === 'string' || Array.isArray(parsed)) {
          toast('Invalid backup file');
          return;
        }

        var fromText = parseTextList(reader.result);
        if (fromText.length) {
          var textResult = mergeItemsAdditive(loadData(), fromText);
          saveData(textResult.data);
          toast('Added ' + textResult.added + ' item' + (textResult.added === 1 ? '' : 's'));
          render();
          return;
        }

        toast('Invalid backup file');
      } catch (e) {
        var added = importPastedText(reader.result);
        if (added) {
          toast('Added ' + added + ' item' + (added === 1 ? '' : 's'));
        } else {
          toast('Could not read file');
        }
      }
    };
    reader.readAsText(file);
  }

  function openSettings() {
    document.getElementById('settingsOverlay').hidden = false;
  }

  function closeSettings() {
    document.getElementById('settingsOverlay').hidden = true;
  }

  /* ——— Events ——— */

  function wireEvents() {
    document.getElementById('addForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var input = document.getElementById('addInput');
      if (addItem(input.value)) input.value = '';
      input.focus();
    });

    document.getElementById('mainList').addEventListener('click', function (e) {
      var row = e.target.closest('.item-row');
      if (!row) return;
      var id = row.dataset.id;
      if (e.target.closest('.item-delete')) {
        deleteItem(id);
      } else if (e.target.closest('.item-check')) {
        toggleChecked(id);
      }
    });

    document.getElementById('pickList').addEventListener('click', function (e) {
      var row = e.target.closest('.item-row');
      if (!row) return;
      togglePick(row.dataset.id);
    });

    document.getElementById('clearCheckedBtn').addEventListener('click', clearChecked);
    document.getElementById('selectAllBtn').addEventListener('click', selectAllPick);
    document.getElementById('clearPickBtn').addEventListener('click', clearPick);
    document.getElementById('shareBtn').addEventListener('click', shareSelected);
    document.getElementById('copyBtn').addEventListener('click', function () {
      var items = getSelectedItems();
      if (!items.length) return;
      var dateStr = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      copyText(formatShareText(items, 'Grocery run — ' + dateStr));
    });

    document.querySelectorAll('.nav-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setView(btn.dataset.view);
      });
    });

    document.getElementById('settingsBtn').addEventListener('click', openSettings);
    document.getElementById('settingsCloseBtn').addEventListener('click', closeSettings);
    document.getElementById('settingsOverlay').addEventListener('click', function (e) {
      if (e.target === e.currentTarget) closeSettings();
    });

    document.getElementById('pasteImportBtn').addEventListener('click', function () {
      var text = document.getElementById('pasteInput').value;
      var added = importPastedText(text);
      if (added) {
        toast('Added ' + added + ' item' + (added === 1 ? '' : 's'));
        document.getElementById('pasteInput').value = '';
        closeSettings();
      } else if (text.trim()) {
        toast('No new items to add');
      } else {
        toast('Paste a list first');
      }
    });

    document.getElementById('exportJsonBtn').addEventListener('click', exportJson);
    document.getElementById('importJsonFile').addEventListener('change', function () {
      var f = this.files && this.files[0];
      this.value = '';
      importJson(f);
    });
  }

  wireEvents();
  render();
})();
