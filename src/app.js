/* Palette Studio · TekiDeki - application logic
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 Kristian Mario Miskovic (TekiDeki)
 *
 * No framework, no build step for the user, no network request at runtime.
 * All colour maths lives in color.js and palette.js, which the Node tests
 * load directly.
 */
(function () {
  'use strict';

  var VERSION = '1';
  var STORAGE_PREFIX = 'tekideki-palette-';
  var LOCALES = window.TD_LOCALES || {};
  var FALLBACK = 'en';

  var MAX_FILE_BYTES = 40 * 1024 * 1024;
  var MAX_DECODE_EDGE = 1000;
  var MAX_STOPS = 8;
  var MAX_HISTORY_COLORS = 18;
  var MAX_UNDO = 40;

  var HARMONY_LIST = ['complementary', 'analogous', 'triadic', 'tetradic', 'split', 'square', 'monochromatic'];
  var GRADIENT_TYPES = ['linear', 'radial', 'conic'];
  var EXPORT_FORMATS = ['css', 'tailwind', 'scss', 'json', 'svg', 'png'];

  var CVD_LIST = [
    { key: 'normal', prevalence: '-' },
    { key: 'protanopia', men: '1%', women: '0.01%' },
    { key: 'deuteranopia', men: '1%', women: '0.01%' },
    { key: 'tritanopia', men: '0.003%', women: '0.003%' },
    { key: 'protanomaly', men: '1%', women: '0.03%' },
    { key: 'deuteranomaly', men: '6%', women: '0.4%' },
    { key: 'tritanomaly', men: '0.01%', women: '0.01%' },
    { key: 'achromatopsia', men: '0.003%', women: '0.003%' }
  ];

  var WHITE = { r: 255, g: 255, b: 255, a: 1 };
  var BLACK = { r: 0, g: 0, b: 0, a: 1 };

  var state = {
    current: '#2563eb',
    savedPalette: [],
    extracted: [],
    harmony: 'triadic',
    gradient: { type: 'linear', angle: 135, stops: [] },
    contrast: { fg: '#2563eb', bg: '#ffffff' },
    cvd: 'normal',
    exportFormat: 'css',
    prefix: 'brand',
    pngSize: 1200,
    history: [],
    locale: 'ro',
    theme: 'light',
    sourceName: ''
  };

  var undoStack = [];
  var currentBitmap = null;
  var objectUrl = null;
  var suggestion = null;

  /* --------------------------------------------------------------- storage */

  function safeGet(key) {
    try { return window.localStorage.getItem(STORAGE_PREFIX + key); } catch (e) { return null; }
  }

  function safeSet(key, value) {
    try { window.localStorage.setItem(STORAGE_PREFIX + key, value); } catch (e) { /* private mode */ }
  }

  function persist() {
    safeSet('state', JSON.stringify({
      current: state.current,
      savedPalette: state.savedPalette,
      harmony: state.harmony,
      gradient: state.gradient,
      contrast: state.contrast,
      cvd: state.cvd,
      exportFormat: state.exportFormat,
      prefix: state.prefix,
      pngSize: state.pngSize,
      history: state.history
    }));
  }

  function restore() {
    var raw = safeGet('state');
    if (!raw) return;
    try {
      var saved = JSON.parse(raw);
      if (typeof saved.current === 'string' && TD.parseHex(saved.current)) state.current = saved.current;
      if (Array.isArray(saved.savedPalette)) {
        state.savedPalette = saved.savedPalette
          .filter(function (hex) { return TD.parseHex(hex); })
          .slice(0, 12);
      }
      if (HARMONY_LIST.indexOf(saved.harmony) >= 0) state.harmony = saved.harmony;
      if (saved.gradient && GRADIENT_TYPES.indexOf(saved.gradient.type) >= 0) {
        state.gradient.type = saved.gradient.type;
        state.gradient.angle = Number(saved.gradient.angle) || 135;
        if (Array.isArray(saved.gradient.stops)) {
          state.gradient.stops = saved.gradient.stops
            .filter(function (stop) { return stop && TD.parseHex(stop.hex); })
            .map(function (stop) { return { hex: stop.hex, position: TD.clamp(Number(stop.position) || 0, 0, 100) }; })
            .slice(0, MAX_STOPS);
        }
      }
      if (saved.contrast && TD.parseHex(saved.contrast.fg) && TD.parseHex(saved.contrast.bg)) {
        state.contrast = { fg: saved.contrast.fg, bg: saved.contrast.bg };
      }
      if (CVD_LIST.some(function (item) { return item.key === saved.cvd; })) state.cvd = saved.cvd;
      if (EXPORT_FORMATS.indexOf(saved.exportFormat) >= 0) state.exportFormat = saved.exportFormat;
      if (typeof saved.prefix === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,23}$/.test(saved.prefix)) state.prefix = saved.prefix;
      if (Array.isArray(saved.history)) {
        state.history = saved.history.filter(function (hex) { return TD.parseHex(hex); }).slice(0, MAX_HISTORY_COLORS);
      }
    } catch (e) { /* corrupted storage: start clean */ }
  }

  /* ------------------------------------------------------------------ i18n */

  function t(key, values) {
    var table = LOCALES[state.locale] || LOCALES[FALLBACK] || LOCALES.ro || {};
    var text = table[key];
    if (text === undefined) {
      text = (LOCALES[FALLBACK] || {})[key];
    }
    if (text === undefined) {
      text = (LOCALES.ro || {})[key];
    }
    if (text === undefined) return key;
    if (!values) return text;
    return text.replace(/\{([a-z0-9_]+)\}/g, function (match, name) {
      return values[name] === undefined ? match : String(values[name]);
    });
  }

  /* Serbian Cyrillic is transliterated, never translated separately. */
  function toCyrillic(value) {
    var digraphs = [
      ['DŽ', 'Џ'], ['Dž', 'Џ'], ['dž', 'џ'],
      ['LJ', 'Љ'], ['Lj', 'Љ'], ['lj', 'љ'],
      ['NJ', 'Њ'], ['Nj', 'Њ'], ['nj', 'њ']
    ];
    var singles = {
      a: 'а', b: 'б', v: 'в', g: 'г', d: 'д', 'đ': 'ђ', e: 'е',
      'ž': 'ж', z: 'з', i: 'и', j: 'ј', k: 'к', l: 'л', m: 'м', n: 'н',
      o: 'о', p: 'п', r: 'р', s: 'с', t: 'т', 'ć': 'ћ', u: 'у', f: 'ф',
      h: 'х', c: 'ц', 'č': 'ч', 'š': 'ш', 'ă': 'а', 'â': 'а', 'î': 'и',
      'ș': 'с', 'ț': 'т'
    };
    var out = '';
    var index = 0;
    while (index < value.length) {
      var matched = false;
      for (var d = 0; d < digraphs.length; d++) {
        if (value.indexOf(digraphs[d][0], index) === index) {
          out += digraphs[d][1];
          index += digraphs[d][0].length;
          matched = true;
          break;
        }
      }
      if (matched) continue;
      var char = value[index];
      var lower = char.toLowerCase();
      var converted = singles[lower];
      if (converted) {
        out += char === char.toUpperCase() && char !== char.toLowerCase()
          ? converted.toUpperCase()
          : converted;
      } else {
        out += char;
      }
      index += 1;
    }
    return out;
  }

  function label(key) {
    var text = t(key);
    return state.locale === 'sr-cyrl' ? toCyrillic(text) : text;
  }

  function applyTranslations() {
    document.documentElement.lang = state.locale;
    document.querySelectorAll('[data-i18n]').forEach(function (node) {
      var key = node.getAttribute('data-i18n');
      if (LOCALES[state.locale] && LOCALES[state.locale][key] !== undefined) {
        node.textContent = label(key);
      }
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(function (node) {
      node.setAttribute('aria-label', label(node.getAttribute('data-i18n-aria')));
    });
    document.querySelectorAll('#langSelect option').forEach(function (option) {
      if (state.locale === 'sr-cyrl') {
        option.textContent = toCyrillic(option.getAttribute('data-base') || option.textContent);
      } else if (option.getAttribute('data-base')) {
        option.textContent = option.getAttribute('data-base');
      }
    });
    document.getElementById('themeLabel').textContent = label(state.theme === 'dark' ? 'themeLight' : 'themeDark');
    document.getElementById('themeBtn').setAttribute('aria-pressed', state.theme === 'dark' ? 'true' : 'false');
    document.getElementById('versionBadge').textContent = t('aboutVersion', { version: VERSION });
  }

  function detectLocale() {
    var params = new URLSearchParams(window.location.search);
    var fromUrl = (params.get('lang') || '').toLowerCase();
    if (LOCALES[fromUrl]) return fromUrl;
    var saved = safeGet('lang');
    if (saved && LOCALES[saved]) return saved;
    var nav = (navigator.language || 'en').toLowerCase();
    if (nav.indexOf('ro') === 0) return 'ro';
    if (nav.indexOf('sr') === 0) return nav.indexOf('cyrl') >= 0 ? 'sr-cyrl' : 'sr-latn';
    return FALLBACK;
  }

  function setLocale(locale) {
    if (!LOCALES[locale]) return;
    state.locale = locale;
    document.getElementById('langSelect').value = locale;
    safeSet('lang', locale);
    renderAll();
  }

  /* ----------------------------------------------------------------- theme */

  function setTheme(theme, persistTheme) {
    state.theme = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.classList.toggle('theme-dark', state.theme === 'dark');
    document.documentElement.classList.toggle('theme-light', state.theme !== 'dark');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', state.theme === 'dark' ? '#0b1120' : '#2563eb');
    if (persistTheme !== false) safeSet('theme', state.theme);
    document.getElementById('themeLabel').textContent = label(state.theme === 'dark' ? 'themeLight' : 'themeDark');
    document.getElementById('themeBtn').setAttribute('aria-pressed', state.theme === 'dark' ? 'true' : 'false');
  }

  /* ------------------------------------------------------------------ undo */

  function snapshot() {
    return JSON.stringify({
      current: state.current,
      savedPalette: state.savedPalette.slice(),
      extracted: state.extracted.slice(),
      harmony: state.harmony,
      gradient: JSON.parse(JSON.stringify(state.gradient)),
      contrast: { fg: state.contrast.fg, bg: state.contrast.bg }
    });
  }

  function pushUndo() {
    undoStack.push(snapshot());
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    document.getElementById('undoBtn').disabled = false;
  }

  function undo() {
    if (undoStack.length === 0) return;
    var previous = JSON.parse(undoStack.pop());
    state.current = previous.current;
    state.savedPalette = previous.savedPalette;
    state.extracted = previous.extracted;
    state.harmony = previous.harmony;
    state.gradient = previous.gradient;
    state.contrast = previous.contrast;
    document.getElementById('undoBtn').disabled = undoStack.length === 0;
    renderAll();
    persist();
  }

  /* ---------------------------------------------------------------- colors */

  function currentRgb() {
    return TD.parseHex(state.current) || { r: 37, g: 99, b: 235, a: 1 };
  }

  function harmonyColors() {
    var rgb = currentRgb();
    if (state.harmony === 'monochromatic') return TD.monochromatic(rgb, 5);
    return TD.harmony(state.harmony, rgb);
  }

  function rememberColor(hex) {
    if (state.history[0] === hex) return;
    state.history = [hex].concat(state.history.filter(function (item) { return item !== hex; }));
    if (state.history.length > MAX_HISTORY_COLORS) state.history.length = MAX_HISTORY_COLORS;
  }

  function setCurrent(hex, options) {
    var parsed = TD.parseHex(hex);
    if (!parsed) return false;
    var normalized = TD.rgbToHex(TD.normalizeRgb(parsed));
    if (normalized === state.current) return true;
    if (!options || options.recordUndo !== false) pushUndo();
    state.current = normalized;
    rememberColor(normalized);
    renderAll();
    persist();
    return true;
  }

  /* ------------------------------------------------------------- clipboard */

  function showToast(elementId, message, kind) {
    var node = document.getElementById(elementId);
    if (!node) return;
    node.textContent = message;
    node.hidden = false;
    node.className = 'status' + (kind ? ' ' + kind : '');
    window.clearTimeout(node.timer);
    node.timer = window.setTimeout(function () { node.hidden = true; }, 3200);
  }

  function copyText(text, statusId) {
    function fallback() {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(area);
      showToast(statusId || 'toast', ok ? label('copied') : label('copyFailed'), ok ? 'ok' : 'error');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        showToast(statusId || 'toast', label('copied'), 'ok');
      }).catch(fallback);
    } else {
      fallback();
    }
  }

  /* --------------------------------------------------------------- helpers */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function swatchButton(hex, extraClass, title) {
    var button = el('button', 'swatch' + (extraClass ? ' ' + extraClass : ''));
    button.type = 'button';
    button.style.setProperty('--swatch', hex);
    button.title = title || hex;
    button.setAttribute('aria-label', (title || hex) + ' ' + hex);
    button.appendChild(el('span', 'swatch-label', hex));
    return button;
  }

  function downloadText(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    showToast('exportStatus', label('downloaded'), 'ok');
  }

  function downloadBlob(filename, blob) {
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    showToast('exportStatus', label('downloaded'), 'ok');
  }

  /* Order of preference: the saved palette, then the palette extracted from
   * an image, then the harmony of the current color. Never a single color:
   * an export of one swatch is not a palette. */
  function exportColors() {
    if (state.savedPalette.length > 0) {
      return state.savedPalette
        .map(function (hex) {
          var rgb = TD.parseHex(hex);
          return rgb ? { hex: hex, rgb: rgb } : null;
        })
        .filter(Boolean);
    }
    if (state.extracted.length > 0) {
      return state.extracted.map(function (item) { return { hex: item.hex, rgb: item.rgb, share: item.share }; });
    }
    return harmonyColors().map(function (rgb) {
      return { hex: TD.rgbToHex(rgb), rgb: rgb };
    });
  }

  /* ---------------------------------------------------------------- render */

  function renderHero() {
    var rgb = currentRgb();
    var hex = TD.rgbToHex(rgb);
    var hsl = TD.rgbToHsl(rgb);
    var hsv = TD.rgbToHsv(rgb);
    var cmyk = TD.rgbToCmyk(rgb);
    var lab = TD.rgbToLab(rgb);
    var name = TD.nearestColorName(rgb);

    document.getElementById('heroSwatch').style.setProperty('--current', hex);
    document.getElementById('heroHex').textContent = hex;
    document.getElementById('heroName').textContent = label('colorName_' + name.key);
    document.getElementById('metaRgb').textContent = Math.round(rgb.r) + ' ' + Math.round(rgb.g) + ' ' + Math.round(rgb.b);
    document.getElementById('metaHsl').textContent = Math.round(hsl.h) + ' ' + Math.round(hsl.s) + ' ' + Math.round(hsl.l);
    document.getElementById('metaContrast').textContent = TD.contrastRatio(rgb, WHITE).toFixed(2) + ':1';

    document.getElementById('hexInput').value = hex;
    document.getElementById('hexInput').classList.remove('invalid');
    document.getElementById('colorPicker').value = hex;
    document.getElementById('rangeH').value = Math.round(hsl.h);
    document.getElementById('rangeS').value = Math.round(hsl.s);
    document.getElementById('rangeL').value = Math.round(hsl.l);
    document.getElementById('valueH').textContent = Math.round(hsl.h);
    document.getElementById('valueS').textContent = Math.round(hsl.s) + '%';
    document.getElementById('valueL').textContent = Math.round(hsl.l) + '%';
    document.getElementById('inputR').value = Math.round(rgb.r);
    document.getElementById('inputG').value = Math.round(rgb.g);
    document.getElementById('inputB').value = Math.round(rgb.b);

    document.getElementById('fmtHex').textContent = hex;
    document.getElementById('fmtRgb').textContent = TD.formatRgb(rgb);
    document.getElementById('fmtHsl').textContent = TD.formatHsl(hsl);
    document.getElementById('fmtHsv').textContent = 'hsv(' + Math.round(hsv.h) + ', ' + Math.round(hsv.s) + '%, ' + Math.round(hsv.v) + '%)';
    document.getElementById('fmtCmyk').textContent = 'cmyk(' + Math.round(cmyk.c) + '%, ' + Math.round(cmyk.m) + '%, ' + Math.round(cmyk.y) + '%, ' + Math.round(cmyk.k) + '%)';
    document.getElementById('fmtLab').textContent = 'lab(' + lab.l.toFixed(1) + ', ' + lab.a.toFixed(1) + ', ' + lab.b.toFixed(1) + ')';
    document.getElementById('fmtName').textContent = label('colorName_' + name.key);
    document.getElementById('fmtNameDelta').textContent = 'dE ' + name.distance.toFixed(1);
  }

  function renderShades() {
    var host = document.getElementById('shadeList');
    host.textContent = '';
    var table = el('table');
    var head = el('thead');
    var headRow = el('tr');
    ['step', 'hex', 'onWhite', 'onBlack'].forEach(function (key) {
      headRow.appendChild(el('th', null, t('shade' + key.charAt(0).toUpperCase() + key.slice(1))));
    });
    head.appendChild(headRow);
    table.appendChild(head);
    var body = el('tbody');
    TD.shadeScale(currentRgb()).forEach(function (shade) {
      var row = el('tr');
      row.appendChild(el('td', 'num', String(shade.step)));
      var hexCell = el('td');
      var chip = el('span', 'badge');
      chip.style.setProperty('--swatch', shade.hex);
      chip.textContent = shade.hex;
      chip.style.background = shade.hex;
      chip.style.color = TD.contrastRatio(shade.rgb, WHITE) >= 3 ? '#ffffff' : '#101725';
      chip.style.borderColor = 'transparent';
      chip.style.cursor = 'pointer';
      chip.title = label('paletteUse');
      chip.addEventListener('click', function () { setCurrent(shade.hex); });
      hexCell.appendChild(chip);
      row.appendChild(hexCell);
      var whiteCell = el('td', 'num', shade.contrastOnWhite.toFixed(2) + ':1');
      var blackCell = el('td', 'num', shade.contrastOnBlack.toFixed(2) + ':1');
      row.appendChild(whiteCell);
      row.appendChild(blackCell);
      body.appendChild(row);
    });
    table.appendChild(body);
    host.appendChild(table);
  }

  function renderHistory() {
    var host = document.getElementById('historyList');
    var empty = document.getElementById('historyEmpty');
    host.textContent = '';
    empty.hidden = state.history.length > 0;
    state.history.forEach(function (hex) {
      var button = el('button');
      button.type = 'button';
      button.style.setProperty('--swatch', hex);
      button.title = hex;
      button.setAttribute('aria-label', hex);
      button.addEventListener('click', function () { setCurrent(hex); });
      host.appendChild(button);
    });
  }

  function renderHarmony() {
    var tabs = document.getElementById('harmonyTabs');
    if (tabs.childElementCount === 0) {
      HARMONY_LIST.forEach(function (name) {
        var button = el('button', null, label('harmony' + name.charAt(0).toUpperCase() + name.slice(1)));
        button.type = 'button';
        button.dataset.harmony = name;
        button.addEventListener('click', function () {
          pushUndo();
          state.harmony = name;
          renderHarmony();
          renderExport();
          persist();
        });
        tabs.appendChild(button);
      });
    }
    Array.prototype.forEach.call(tabs.children, function (button) {
      var active = button.dataset.harmony === state.harmony;
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      button.textContent = label('harmony' + button.dataset.harmony.charAt(0).toUpperCase() + button.dataset.harmony.slice(1));
    });

    var colors = harmonyColors();
    var host = document.getElementById('harmonySwatches');
    host.textContent = '';
    colors.forEach(function (rgb) {
      var hex = TD.rgbToHex(rgb);
      var button = swatchButton(hex, hex === state.current ? 'is-active' : '', label('paletteUse'));
      var meta = el('span', 'swatch-meta', Math.round(TD.rgbToHsl(rgb).h) + '\u00B0');
      button.appendChild(meta);
      button.addEventListener('click', function () { setCurrent(hex); });
      host.appendChild(button);
    });
    document.getElementById('harmonyBadge').textContent = t('colorCount', { n: colors.length });
  }

  function renderExtracted() {
    var host = document.getElementById('extractedSwatches');
    var empty = document.getElementById('extractedEmpty');
    host.textContent = '';
    empty.hidden = state.extracted.length > 0;
    state.extracted.forEach(function (item) {
      var button = swatchButton(item.hex, item.hex === state.current ? 'is-active' : '', label('paletteUse'));
      button.appendChild(el('span', 'swatch-meta', item.share.toFixed(1) + '%'));
      button.addEventListener('click', function () { setCurrent(item.hex); });
      host.appendChild(button);
    });
  }

  function renderSaved() {
    var host = document.getElementById('savedSwatches');
    var empty = document.getElementById('savedEmpty');
    host.textContent = '';
    empty.hidden = state.savedPalette.length > 0;
    state.savedPalette.forEach(function (hex, index) {
      var button = swatchButton(hex, hex === state.current ? 'is-active' : '', label('removeColor'));
      button.addEventListener('click', function () { setCurrent(hex); });
      var remove = el('button', 'swatch-meta');
      remove.type = 'button';
      remove.textContent = '\u00D7';
      remove.title = label('removeColor');
      remove.setAttribute('aria-label', label('removeColor') + ' ' + hex);
      remove.addEventListener('click', function (event) {
        event.stopPropagation();
        pushUndo();
        state.savedPalette.splice(index, 1);
        renderAll();
        persist();
      });
      button.appendChild(remove);
      host.appendChild(button);
    });
  }

  function gradientStops() {
    if (state.gradient.stops.length >= 2) {
      return state.gradient.stops.map(function (stop) {
        return { rgb: TD.parseHex(stop.hex) || currentRgb(), position: stop.position };
      });
    }
    var colors = exportColors();
    return colors.slice(0, Math.max(2, Math.min(colors.length, 5))).map(function (color, index, list) {
      return { rgb: color.rgb, position: Math.round((index / Math.max(1, list.length - 1)) * 100) };
    });
  }

  function renderGradient() {
    var typeTabs = document.getElementById('gradientTypeTabs');
    if (typeTabs.childElementCount === 0) {
      GRADIENT_TYPES.forEach(function (type) {
        var button = el('button', null, label('gradient' + type.charAt(0).toUpperCase() + type.slice(1)));
        button.type = 'button';
        button.dataset.type = type;
        button.addEventListener('click', function () {
          pushUndo();
          state.gradient.type = type;
          renderGradient();
          persist();
        });
        typeTabs.appendChild(button);
      });
    }
    Array.prototype.forEach.call(typeTabs.children, function (button) {
      button.setAttribute('aria-pressed', button.dataset.type === state.gradient.type ? 'true' : 'false');
      button.textContent = label('gradient' + button.dataset.type.charAt(0).toUpperCase() + button.dataset.type.slice(1));
    });

    var stops = gradientStops();
    var css = TD.gradientCss(stops, { type: state.gradient.type, angle: state.gradient.angle });
    document.getElementById('gradientPreview').style.setProperty('--gradient', css);
    document.getElementById('gradientCode').textContent = 'background: ' + css + ';';
    document.getElementById('gradientAngle').value = state.gradient.angle;
    document.getElementById('gradientAngleValue').textContent = state.gradient.angle + 'deg';

    var list = document.getElementById('stopList');
    list.textContent = '';
    if (state.gradient.stops.length >= 2) {
      state.gradient.stops.forEach(function (stop, index) {
        var row = el('div', 'stop-row');
        var chip = el('button', 'stop-chip');
        chip.type = 'button';
        chip.style.setProperty('--swatch', stop.hex);
        chip.setAttribute('aria-label', label('paletteUse') + ' ' + stop.hex);
        chip.addEventListener('click', function () { setCurrent(stop.hex); });
        row.appendChild(chip);

        var range = document.createElement('input');
        range.type = 'range';
        range.min = '0';
        range.max = '100';
        range.value = String(stop.position);
        range.setAttribute('aria-label', label('gradientStops') + ' ' + stop.hex);
        range.addEventListener('input', function () {
          state.gradient.stops[index].position = Number(range.value);
          renderGradient();
        });
        range.addEventListener('change', function () { persist(); });
        row.appendChild(range);

        row.appendChild(el('span', 'stop-hex', stop.hex + ' ' + stop.position + '%'));

        var remove = el('button', 'btn btn-sm btn-quiet');
        remove.type = 'button';
        remove.textContent = '\u00D7';
        remove.title = label('gradientRemoveStop');
        remove.setAttribute('aria-label', label('gradientRemoveStop') + ' ' + stop.hex);
        remove.addEventListener('click', function () {
          if (state.gradient.stops.length <= 2) return;
          pushUndo();
          state.gradient.stops.splice(index, 1);
          renderGradient();
          persist();
        });
        row.appendChild(remove);
        list.appendChild(row);
      });
    } else {
      var note = el('p', 'hint', label('gradientReset'));
      list.appendChild(note);
    }
  }

  function renderContrast() {
    var fg = TD.parseHex(state.contrast.fg);
    var bg = TD.parseHex(state.contrast.bg);
    var status = document.getElementById('contrastStatus');
    if (!fg || !bg) {
      status.textContent = label('invalidHex');
      status.hidden = false;
      return;
    }
    status.hidden = true;
    document.getElementById('fgInput').value = TD.rgbToHex(fg);
    document.getElementById('bgInput').value = TD.rgbToHex(bg);

    var ratio = TD.contrastRatio(fg, bg);
    document.getElementById('contrastValue').textContent = ratio.toFixed(2) + ':1';
    document.getElementById('contrastVerdict').textContent = TD.wcagLevel(ratio, false);
    document.getElementById('contrastVerdict').className = 'badge ' + (TD.wcagLevel(ratio, false) === 'fail' ? 'fail' : 'pass');

    var demo = document.getElementById('contrastDemo');
    demo.style.setProperty('--demo-bg', TD.rgbToHex(bg));
    demo.style.setProperty('--demo-fg', TD.rgbToHex(fg));

    var normal = TD.wcagLevel(ratio, false);
    var large = TD.wcagLevel(ratio, true);
    var ui = ratio >= 3 ? 'AA' : 'fail';
    [['badgeNormal', normal], ['badgeLarge', large], ['badgeUi', ui]].forEach(function (pair) {
      var node = document.getElementById(pair[0]);
      node.textContent = pair[1] === 'fail' ? label('contrastFail') : pair[1] + ' ' + label('contrastPass');
      node.className = 'badge ' + (pair[1] === 'fail' ? 'fail' : 'pass');
    });

    suggestion = null;
    var suggestionRow = document.getElementById('suggestionRow');
    if (ratio < 4.5) {
      suggestion = TD.nearestAccessible(fg, bg, 4.5);
      document.getElementById('suggestionText').textContent = t('contrastSuggestionText', {
        color: suggestion.hex,
        background: TD.rgbToHex(bg),
        ratio: suggestion.ratio.toFixed(2) + ':1',
        min: 'AA 4.5:1'
      });
      document.getElementById('suggestionSwatch').textContent = suggestion.hex;
      document.getElementById('suggestionSwatch').style.background = suggestion.hex;
      document.getElementById('suggestionSwatch').style.color = TD.contrastRatio(suggestion.rgb, WHITE) >= 3 ? '#ffffff' : '#101725';
      suggestionRow.hidden = false;
    } else {
      document.getElementById('suggestionText').textContent = label('contrastSuggestionNone');
      suggestionRow.hidden = true;
    }

    var colors = exportColors();
    var host = document.getElementById('paletteContrast');
    host.textContent = '';
    if (colors.length > 0) {
      var table = el('table');
      var head = el('thead');
      var row = el('tr');
      row.appendChild(el('th', null, label('formatsTitle')));
      row.appendChild(el('th', null, label('contrastOnWhiteShort')));
      row.appendChild(el('th', null, t('contrastOnBlackShort')));
      head.appendChild(row);
      table.appendChild(head);
      var body = el('tbody');
      colors.forEach(function (color) {
        var line = el('tr');
        line.appendChild(el('td', null, color.hex));
        var onWhite = TD.contrastRatio(color.rgb, WHITE);
        var onBlack = TD.contrastRatio(color.rgb, BLACK);
        var whiteCell = el('td', 'num', onWhite.toFixed(2) + ':1');
        var blackCell = el('td', 'num', onBlack.toFixed(2) + ':1');
        whiteCell.title = TD.wcagLevel(onWhite, false);
        blackCell.title = TD.wcagLevel(onBlack, false);
        line.appendChild(whiteCell);
        line.appendChild(blackCell);
        body.appendChild(line);
      });
      table.appendChild(body);
      host.appendChild(table);
    }
  }

  function cvdColor(rgb, type) {
    if (type === 'normal') return TD.normalizeRgb(rgb);
    if (type === 'achromatopsia') {
      /* Complete monochromacy: only luminance survives, so the perceived
       * color is the grey with the same relative luminance. */
      var grey = TD.round(TD.linearToSrgb(TD.relativeLuminance(rgb)) * 255, 0);
      return { r: grey, g: grey, b: grey, a: 1 };
    }
    return TD.simulateCvd(rgb, type);
  }

  function renderCvd() {
    var grid = document.getElementById('cvdGrid');
    grid.textContent = '';
    var base = currentRgb();
    CVD_LIST.forEach(function (item) {
      var rgb = cvdColor(base, item.key);
      var hex = TD.rgbToHex(rgb);
      var card = el('div', 'cvd-item');
      card.style.setProperty('--cvd', hex);
      var swatch = el('div', 'cvd-swatch');
      card.appendChild(swatch);
      var body = el('div', 'cvd-body');
      body.appendChild(el('b', null, label('cvd' + item.key.charAt(0).toUpperCase() + item.key.slice(1))));
      body.appendChild(el('span', null, hex));
      var prevalence = item.prevalence
        ? item.prevalence
        : label('cvdMen') + ' ' + item.men + ' / ' + label('cvdWomen') + ' ' + item.women;
      body.appendChild(el('em', null, label('cvdPrevalence') + ': ' + prevalence));
      card.appendChild(body);
      if (item.key !== 'normal') {
        card.style.cursor = 'pointer';
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.title = label('paletteUse');
        var pick = function () { setCurrent(hex); };
        card.addEventListener('click', pick);
        card.addEventListener('keydown', function (event) {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pick(); }
        });
      }
      grid.appendChild(card);
    });

    var strip = document.getElementById('cvdStrip');
    strip.textContent = '';
    var colors = exportColors();
    colors.forEach(function (color) {
      var cell = el('div');
      cell.style.background = TD.rgbToHex(cvdColor(color.rgb, state.cvd));
      cell.title = color.hex;
      strip.appendChild(cell);
    });
    if (colors.length === 0) {
      strip.appendChild(el('div'));
    }
  }

  function renderExport() {
    var tabs = document.getElementById('exportTabs');
    if (tabs.childElementCount === 0) {
      EXPORT_FORMATS.forEach(function (format) {
        var button = el('button', null, label('format' + format.charAt(0).toUpperCase() + format.slice(1)));
        button.type = 'button';
        button.dataset.format = format;
        button.addEventListener('click', function () {
          state.exportFormat = format;
          renderExport();
          persist();
        });
        tabs.appendChild(button);
      });
    }
    Array.prototype.forEach.call(tabs.children, function (button) {
      button.setAttribute('aria-pressed', button.dataset.format === state.exportFormat ? 'true' : 'false');
      button.textContent = label('format' + button.dataset.format.charAt(0).toUpperCase() + button.dataset.format.slice(1));
    });

    var colors = exportColors();
    var code = document.getElementById('exportCode');
    var status = document.getElementById('exportStatus');
    if (colors.length === 0) {
      code.textContent = label('exportEmpty');
      status.hidden = true;
      return;
    }
    var prefix = state.prefix;
    switch (state.exportFormat) {
      case 'tailwind':
        code.textContent = TD.paletteToTailwind(colors, prefix);
        break;
      case 'scss':
        code.textContent = TD.paletteToScss(colors, prefix);
        break;
      case 'json':
        code.textContent = TD.paletteToJson(colors, 'Palette Studio v' + VERSION);
        break;
      case 'svg':
        code.textContent = TD.paletteToSvg(colors);
        break;
      case 'png':
        code.textContent = pngPlan(colors);
        break;
      default:
        code.textContent = TD.paletteToCssVars(colors, prefix);
    }
    status.textContent = t('exportCount', { n: colors.length });
    status.hidden = false;
    status.className = 'status';
  }

  function pngPlan(colors) {
    var width = state.pngSize;
    var height = Math.round(width / 3);
    var lines = [
      'PNG ' + width + ' x ' + height + ' px',
      label('pngSize') + ': ' + width + ' x ' + height,
      label('exportCount', { n: colors.length }),
      ''
    ];
    colors.forEach(function (color) {
      lines.push(color.hex + '  rgb(' + Math.round(color.rgb.r) + ', ' + Math.round(color.rgb.g) + ', ' + Math.round(color.rgb.b) + ')');
    });
    return lines.join('\n');
  }

  function renderAll() {
    applyTranslations();
    renderHero();
    renderShades();
    renderHistory();
    renderHarmony();
    renderExtracted();
    renderSaved();
    renderGradient();
    renderContrast();
    renderCvd();
    renderExport();
  }

  /* --------------------------------------------------------- image loading */

  function handleFile(file) {
    var status = document.getElementById('paletteStatus');
    if (!file) return;
    if (file.type && file.type.indexOf('image/') !== 0) {
      showToast('paletteStatus', t('paletteNotImage', { name: file.name }), 'error');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      showToast('paletteStatus', t('paletteTooLarge', { max: '40 MB' }), 'error');
      return;
    }
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);
    var image = new Image();
    image.onload = function () {
      state.sourceName = file.name || 'image';
      var preview = document.getElementById('sourceImage');
      preview.src = objectUrl;
      preview.alt = state.sourceName;
      document.getElementById('sourcePreview').hidden = false;
      currentBitmap = image;
      extractFromImage(image);
    };
    image.onerror = function () {
      showToast('paletteStatus', label('paletteError'), 'error');
    };
    image.src = objectUrl;
    status.textContent = label('paletteLoading');
    status.className = 'status';
    status.hidden = false;
  }

  function drawDemoImage() {
    /* A deterministic picture: fixed colours on a fixed layout, so the
     * extracted palette is reproducible in the UI tests. */
    var canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 400;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, 640, 400);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, 640, 96);
    var blobs = [
      ['#2563eb', 150, 210, 86],
      ['#f59e0b', 330, 250, 70],
      ['#10b981', 500, 200, 64],
      ['#e11d48', 250, 330, 46],
      ['#7c3aed', 440, 330, 52]
    ];
    blobs.forEach(function (blob) {
      ctx.fillStyle = blob[0];
      ctx.beginPath();
      ctx.arc(blob[1], blob[2], blob[3], 0, Math.PI * 2);
      ctx.fill();
    });
    return canvas;
  }

  function extractFromImage(source) {
    var width = source.naturalWidth || source.width;
    var height = source.naturalHeight || source.height;
    if (!width || !height) {
      showToast('paletteStatus', label('paletteError'), 'error');
      return;
    }
    var scale = Math.min(1, MAX_DECODE_EDGE / Math.max(width, height));
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    var data;
    try {
      data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    } catch (e) {
      showToast('paletteStatus', label('paletteError'), 'error');
      return;
    }
    var samples = TD.samplePixels(data, canvas.width, canvas.height);
    if (samples.length === 0) {
      showToast('paletteStatus', label('paletteError'), 'error');
      return;
    }
    pushUndo();
    state.extracted = TD.extractPalette(samples, { k: Number(document.getElementById('paletteK').value) || 6 });
    renderExtracted();
    renderCvd();
    renderExport();
    persist();
    showToast('paletteStatus', t('paletteDone', {
      n: state.extracted.length,
      pixels: samples.length
    }), 'ok');
  }

  /* ----------------------------------------------------------------- events */

  function wireEvents() {
    var hexInput = document.getElementById('hexInput');
    hexInput.addEventListener('change', function () {
      if (!TD.parseHex(hexInput.value)) {
        hexInput.classList.add('invalid');
        showToast('hexError', label('invalidHex'), 'error');
        return;
      }
      hexInput.classList.remove('invalid');
      document.getElementById('hexError').hidden = true;
      setCurrent(hexInput.value);
    });

    document.getElementById('colorPicker').addEventListener('input', function (event) {
      setCurrent(event.target.value, { recordUndo: false });
    });
    document.getElementById('colorPicker').addEventListener('change', function (event) {
      setCurrent(event.target.value);
    });

    document.getElementById('randomBtn').addEventListener('click', function () {
      var hex = '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
      setCurrent(hex);
    });

    document.getElementById('copyHexBtn').addEventListener('click', function () {
      copyText(state.current, 'hexError');
    });

    [['rangeH', 'h'], ['rangeS', 's'], ['rangeL', 'l']].forEach(function (pair) {
      var input = document.getElementById(pair[0]);
      var commit = function () {
        var hsl = TD.rgbToHsl(currentRgb());
        hsl[pair[1]] = Number(input.value);
        setCurrent(TD.rgbToHex(TD.hslToRgb(hsl)));
      };
      input.addEventListener('input', function () {
        var hsl = TD.rgbToHsl(currentRgb());
        hsl[pair[1]] = Number(input.value);
        setCurrent(TD.rgbToHex(TD.hslToRgb(hsl)), { recordUndo: false });
      });
      input.addEventListener('change', commit);
    });

    [['inputR', 'r'], ['inputG', 'g'], ['inputB', 'b']].forEach(function (pair) {
      var input = document.getElementById(pair[0]);
      input.addEventListener('change', function () {
        var rgb = currentRgb();
        rgb[pair[1]] = TD.clamp(Number(input.value) || 0, 0, 255);
        setCurrent(TD.rgbToHex(rgb));
      });
    });

    document.querySelectorAll('[data-copy]').forEach(function (button) {
      button.addEventListener('click', function () {
        var target = document.querySelector(button.getAttribute('data-copy'));
        if (target) copyText(target.textContent, 'hexError');
      });
    });

    document.getElementById('themeBtn').addEventListener('click', function () {
      setTheme(state.theme === 'dark' ? 'light' : 'dark');
    });

    document.getElementById('langSelect').addEventListener('change', function (event) {
      setLocale(event.target.value);
    });

    document.getElementById('undoBtn').addEventListener('click', undo);

    document.getElementById('harmonyAddBtn').addEventListener('click', function () {
      pushUndo();
      harmonyColors().forEach(function (rgb) {
        var hex = TD.rgbToHex(rgb);
        if (state.savedPalette.indexOf(hex) < 0 && state.savedPalette.length < 12) {
          state.savedPalette.push(hex);
        }
      });
      renderAll();
      persist();
      showToast('paletteStatus', label('harmonyAdded'), 'ok');
    });

    var dropZone = document.getElementById('dropZone');
    ['dragenter', 'dragover'].forEach(function (name) {
      dropZone.addEventListener(name, function (event) {
        event.preventDefault();
        dropZone.classList.add('is-over');
      });
    });
    ['dragleave', 'drop'].forEach(function (name) {
      dropZone.addEventListener(name, function (event) {
        event.preventDefault();
        dropZone.classList.remove('is-over');
      });
    });
    dropZone.addEventListener('drop', function (event) {
      var files = event.dataTransfer && event.dataTransfer.files;
      if (files && files.length) handleFile(files[0]);
    });

    document.getElementById('imageInput').addEventListener('change', function (event) {
      if (event.target.files && event.target.files.length) handleFile(event.target.files[0]);
    });

    document.getElementById('demoImageBtn').addEventListener('click', function () {
      var canvas = drawDemoImage();
      var image = new Image();
      image.onload = function () {
        state.sourceName = 'demo.png';
        document.getElementById('sourceImage').src = canvas.toDataURL('image/png');
        document.getElementById('sourceImage').alt = 'demo';
        document.getElementById('sourcePreview').hidden = false;
        currentBitmap = image;
        extractFromImage(image);
      };
      image.src = canvas.toDataURL('image/png');
    });

    document.getElementById('paletteK').addEventListener('input', function (event) {
      document.getElementById('paletteKValue').textContent = event.target.value;
    });
    document.getElementById('paletteK').addEventListener('change', function () {
      if (currentBitmap) extractFromImage(currentBitmap);
    });

    document.getElementById('extractBtn').addEventListener('click', function () {
      if (currentBitmap) {
        extractFromImage(currentBitmap);
      } else {
        showToast('paletteStatus', label('paletteEmpty'), 'error');
      }
    });

    document.getElementById('paletteUseBtn').addEventListener('click', function () {
      var colors = state.extracted.length > 0 ? state.extracted.map(function (item) { return item.hex; }) : [state.current];
      if (colors.length === 0) return;
      pushUndo();
      state.savedPalette = colors.slice(0, 12);
      renderAll();
      persist();
      showToast('paletteStatus', label('paletteSaved'), 'ok');
    });

    document.getElementById('paletteClearBtn').addEventListener('click', function () {
      pushUndo();
      state.savedPalette = [];
      renderAll();
      persist();
    });

    document.getElementById('gradientAngle').addEventListener('input', function (event) {
      state.gradient.angle = Number(event.target.value);
      renderGradient();
      persist();
    });
    document.getElementById('gradientAngle').addEventListener('change', persist);

    document.getElementById('addStopBtn').addEventListener('click', function () {
      if (state.gradient.stops.length < 2) {
        state.gradient.stops = gradientStops().map(function (stop) {
          return { hex: TD.rgbToHex(stop.rgb), position: stop.position };
        });
      }
      if (state.gradient.stops.length >= MAX_STOPS) {
        showToast('gradientStatus', t('gradientMaxStops', { n: MAX_STOPS }), 'error');
        return;
      }
      pushUndo();
      var last = state.gradient.stops[state.gradient.stops.length - 1].position;
      state.gradient.stops.push({ hex: state.current, position: TD.clamp(last + 10, 0, 100) });
      state.gradient.stops.sort(function (a, b) { return a.position - b.position; });
      renderGradient();
      persist();
    });

    document.getElementById('gradientResetBtn').addEventListener('click', function () {
      pushUndo();
      state.gradient.stops = [];
      renderGradient();
      persist();
    });

    document.getElementById('copyGradientBtn').addEventListener('click', function () {
      copyText(document.getElementById('gradientCode').textContent, 'gradientStatus');
    });

    document.getElementById('downloadSvgBtn').addEventListener('click', function () {
      var stops = gradientStops();
      var svg = TD.gradientSvg(stops, { type: state.gradient.type, angle: state.gradient.angle, width: 1200, height: 675 });
      downloadText('palette-gradient.svg', svg, 'image/svg+xml;charset=utf-8');
    });

    document.getElementById('fgInput').addEventListener('change', function (event) {
      if (!TD.parseHex(event.target.value)) {
        showToast('contrastStatus', label('invalidHex'), 'error');
        return;
      }
      pushUndo();
      state.contrast.fg = TD.rgbToHex(TD.parseHex(event.target.value));
      renderContrast();
      persist();
    });

    document.getElementById('bgInput').addEventListener('change', function (event) {
      if (!TD.parseHex(event.target.value)) {
        showToast('contrastStatus', label('invalidHex'), 'error');
        return;
      }
      pushUndo();
      state.contrast.bg = TD.rgbToHex(TD.parseHex(event.target.value));
      renderContrast();
      persist();
    });

    document.getElementById('swapBtn').addEventListener('click', function () {
      pushUndo();
      var fg = state.contrast.fg;
      state.contrast.fg = state.contrast.bg;
      state.contrast.bg = fg;
      renderContrast();
      persist();
    });

    document.getElementById('useBaseBtn').addEventListener('click', function () {
      pushUndo();
      state.contrast.fg = state.current;
      renderContrast();
      persist();
    });

    document.getElementById('applySuggestionBtn').addEventListener('click', function () {
      if (!suggestion) return;
      pushUndo();
      state.contrast.fg = suggestion.hex;
      setCurrent(suggestion.hex, { recordUndo: false });
      renderContrast();
      persist();
    });

    document.getElementById('prefixInput').addEventListener('change', function (event) {
      var value = String(event.target.value || '').trim();
      if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,23}$/.test(value)) {
        event.target.value = state.prefix;
        return;
      }
      state.prefix = value;
      renderExport();
      persist();
    });

    document.getElementById('copyExportBtn').addEventListener('click', function () {
      copyText(document.getElementById('exportCode').textContent, 'exportStatus');
    });

    document.getElementById('downloadExportBtn').addEventListener('click', function () {
      var colors = exportColors();
      if (colors.length === 0) return;
      var format = state.exportFormat;
      if (format === 'png') {
        renderPng(colors);
        return;
      }
      var files = {
        css: ['palette.css', TD.paletteToCssVars(colors, state.prefix), 'text/css;charset=utf-8'],
        tailwind: ['tailwind.config.js', TD.paletteToTailwind(colors, state.prefix), 'text/javascript;charset=utf-8'],
        scss: ['palette.scss', TD.paletteToScss(colors, state.prefix), 'text/x-scss;charset=utf-8'],
        json: ['palette.json', TD.paletteToJson(colors, 'Palette Studio v' + VERSION), 'application/json;charset=utf-8'],
        svg: ['palette.svg', TD.paletteToSvg(colors), 'image/svg+xml;charset=utf-8']
      };
      var entry = files[format];
      if (entry) downloadText(entry[0], entry[1], entry[2]);
    });

    document.addEventListener('keydown', function (event) {
      var target = event.target;
      var typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
      if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 'z') {
        event.preventDefault();
        undo();
        return;
      }
      if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
      if (String(event.key).toLowerCase() === 'r') {
        document.getElementById('randomBtn').click();
      } else if (String(event.key).toLowerCase() === 'c') {
        document.getElementById('copyHexBtn').click();
      }
    });

    window.addEventListener('beforeunload', persist);
  }

  function renderPng(colors) {
    if (!colors.length) return;
    var width = state.pngSize;
    var perSwatch = Math.round(width / colors.length);
    var height = Math.round(width / 3);
    var canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    var ctx = canvas.getContext('2d');
    colors.forEach(function (color, index) {
      ctx.fillStyle = TD.rgbToHex(color.rgb);
      ctx.fillRect(index * perSwatch, 0, perSwatch, height);
      ctx.fillStyle = TD.contrastRatio(color.rgb, WHITE) >= 3 ? '#ffffff' : '#101725';
      ctx.font = '600 22px ui-monospace, monospace';
      ctx.fillText(TD.rgbToHex(color.rgb), index * perSwatch + 18, height - 24);
    });
    canvas.toBlob(function (blob) {
      if (blob) downloadBlob('palette.png', blob);
    }, 'image/png');
  }

  /* ------------------------------------------------------------------ init */

  function init() {
    restore();
    state.locale = detectLocale();
    document.getElementById('langSelect').value = state.locale;
    var savedTheme = safeGet('theme');
    if (savedTheme === 'dark' || savedTheme === 'light') {
      setTheme(savedTheme, false);
    } else {
      setTheme('light', false);
    }
    document.getElementById('prefixInput').value = state.prefix;
    document.getElementById('paletteKValue').textContent = document.getElementById('paletteK').value;
    if (state.history.indexOf(state.current) < 0) rememberColor(state.current);
    wireEvents();
    renderAll();
    document.getElementById('undoBtn').disabled = true;

    if ('serviceWorker' in navigator && window.location.protocol.indexOf('http') === 0) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () { /* offline is optional */ });
      });
    }
    window.TD_APP = { state: state, render: renderAll, label: label, t: t, toCyrillic: toCyrillic, cvdColor: cvdColor, VERSION: VERSION };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
