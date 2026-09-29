/* Persistence in localStorage, using the same keys as the original app. */
(function () {
  'use strict';

  var KEYS = {
    intakes: 'caffeineIntakes',
    settings: 'caffeineSettings',
    recent: 'caftrack_recent_drinks',
    darkMode: 'darkMode'
  };

  // Drinks that were renamed: old id -> new id, old logged name -> new name.
  var RENAMED_IDS = { 'featured-caffeine-pouch-180-mg': 'featured-ultra-energy-pouch' };
  var RENAMED_NAMES = { 'Caffeine Pouch (180 mg)': 'Ultra Energy Pouch' };

  function renameLogged(name) {
    for (var oldName in RENAMED_NAMES) {
      if (name === oldName || name.indexOf(oldName + ' (') === 0) return RENAMED_NAMES[oldName] + name.slice(oldName.length);
    }
    return name;
  }

  function read(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw == null ? null : JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage full or blocked */ }
  }

  function newId() {
    if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return Date.now() + '-' + Math.random().toString(16).slice(2);
  }

  function clampNum(v, min, max, fallback) {
    var n = typeof v === 'number' ? v : Number(v);
    return isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  }

  function sanitizeSettings(s) {
    var d = CT.model.DEFAULT_SETTINGS;
    s = s || {};
    return {
      metabolismRate: CT.model.HALF_LIVES[s.metabolismRate] ? s.metabolismRate : d.metabolismRate,
      caffeineLimit: clampNum(s.caffeineLimit, 1, 2000, d.caffeineLimit),
      sleepTime: /^\d{2}:\d{2}$/.test(s.sleepTime || '') ? s.sleepTime : d.sleepTime,
      targetSleepCaffeine: clampNum(s.targetSleepCaffeine, 0, 1000, d.targetSleepCaffeine),
      pregnancyAdjustment: s.pregnancyAdjustment === true,
      smokerAdjustment: s.smokerAdjustment === true,
      oralContraceptivesAdjustment: s.oralContraceptivesAdjustment === true,
      lastCallDrinkId: typeof s.lastCallDrinkId === 'string' ? (RENAMED_IDS[s.lastCallDrinkId] || s.lastCallDrinkId) : d.lastCallDrinkId,
      updatedAt: isFinite(s.updatedAt) ? s.updatedAt : 0
    };
  }

  function sanitizeIntake(i) {
    if (!i || typeof i !== 'object') return null;
    var ts = Date.parse(i.timestamp);
    var amount = Number(i.amount);
    if (!isFinite(ts) || !isFinite(amount) || amount < 0) return null;
    var out = {
      id: i.id || i.clientId || newId(),
      name: renameLogged(String(i.name || 'Caffeine')).slice(0, 120),
      amount: Math.round(amount),
      category: CT.model.CATEGORIES[i.category] ? i.category : 'other',
      timestamp: new Date(ts).toISOString(),
      updatedAt: isFinite(i.updatedAt) ? i.updatedAt : ts
    };
    if (i.substance && i.substance !== 'caffeine' && CT.model.SUBSTANCES[i.substance]) out.substance = i.substance;
    return out;
  }

  function loadIntakes() {
    var arr = read(KEYS.intakes);
    return Array.isArray(arr) ? arr.map(sanitizeIntake).filter(Boolean) : [];
  }

  function loadDarkMode() {
    var v = read(KEYS.darkMode);
    if (v === true || v === false) return v;
    return !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  }

  window.CT = window.CT || {};
  window.CT.store = {
    KEYS: KEYS,
    newId: newId,
    sanitizeSettings: sanitizeSettings,
    sanitizeIntake: sanitizeIntake,
    load: function () {
      var recent = read(KEYS.recent);
      return {
        intakes: loadIntakes(),
        settings: sanitizeSettings(read(KEYS.settings)),
        recent: Array.isArray(recent) ? recent.filter(function (x) { return typeof x === 'string'; })
          .map(function (x) { return RENAMED_IDS[x] || x; }).slice(0, 5) : [],
        darkMode: loadDarkMode()
      };
    },
    saveIntakes: function (v) { write(KEYS.intakes, v); },
    saveSettings: function (v) { write(KEYS.settings, v); },
    saveRecent: function (v) { write(KEYS.recent, v); },
    saveDarkMode: function (v) { write(KEYS.darkMode, v); }
  };
})();
