/* CafTrack clone: UI, state and interactions. */
(function () {
  'use strict';

  var M = CT.model, S = CT.store, icon = CT.icon;
  var DESKTOP_QUERY = window.matchMedia('(min-width: 1024px)');
  var UNDO_MS = 6000;
  var BEDTIME_PRESETS = [['21:00', '9 PM'], ['22:00', '10 PM'], ['23:00', '11 PM'], ['00:00', '12 AM']];

  // ---------- Drinks ----------
  var ALL_DRINKS = (function () {
    var seen = {}, out = [];
    CT.FEATURED_DRINKS.concat(CT.DRINKS).forEach(function (d) {
      if (!seen[d.id]) { seen[d.id] = 1; out.push(d); }
    });
    return out;
  })();
  var DRINKS_BY_ID = {};
  ALL_DRINKS.forEach(function (d) { DRINKS_BY_ID[d.id] = d; });

  // ---------- State ----------
  var saved = S.load();
  var state = {
    intakes: saved.intakes,
    settings: saved.settings,
    recent: saved.recent.filter(function (id) { return DRINKS_BY_ID[id]; }),
    darkMode: saved.darkMode,
    tab: initialTab(),
    range: '24h',
    add: { mode: 'now', date: '', time: '', exactTouched: false, query: '', selectedId: null, portion: 100, customOpen: false, error: '' },
    modals: [],
    settingsDraft: null,
    undo: null
  };
  sortIntakes();

  // ---------- Helpers ----------
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function localDateStr(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function localTimeStr(d) { return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  function daysAgoStr(n) { var d = new Date(); d.setDate(d.getDate() - n); return localDateStr(d); }
  function isDesktop() { return DESKTOP_QUERY.matches; }

  function initialTab() {
    try {
      var t = new URLSearchParams(location.search).get('tab');
      return t === 'history' || t === 'stats' ? t : 'home';
    } catch (e) { return 'home'; }
  }

  function sortIntakes() {
    state.intakes.sort(function (a, b) { return Date.parse(b.timestamp) - Date.parse(a.timestamp); });
  }

  function fmtWhen(ts) {
    var d = new Date(ts);
    var time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    var today = localDateStr(new Date());
    var ds = localDateStr(d);
    if (ds === today) return time;
    if (ds === daysAgoStr(1)) return 'Yesterday, ' + time;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + time;
  }

  function mgText(amount, substance) {
    var short = M.substanceMeta(substance).short;
    return amount + ' mg' + (short ? ' ' + short : '');
  }

  function servingText(d) {
    var parts = [];
    if (d.unit) {
      parts.push(d.unit);
      parts.push(M.substanceMeta(d.substance).label);
      return parts.join(' • ');
    }
    if (d.serving) {
      var oz = d.serving.oz;
      parts.push((Number.isInteger(oz) ? oz.toFixed(0) : oz.toFixed(1)) + ' oz');
      parts.push(d.serving.ml + ' ml');
    }
    parts.push(M.categoryMeta(d.category).label);
    return parts.join(' • ');
  }

  function rangeCaption(prefix) {
    var r = M.findRange(state.range);
    return (prefix || 'Showing ') + (r.value === 'all' ? 'all history' : r.label);
  }

  // ---------- Derived numbers ----------
  function metrics() {
    var now = Date.now();
    var s = state.settings;
    var level = M.currentLevel(state.intakes, s, now);
    var bed = M.nextBedtime(s.sleepTime, now);
    var atSleep = M.levelAtBedtime(state.intakes, s, now);
    return {
      now: now,
      level: level,
      status: M.status(level, s.caffeineLimit),
      pct: Math.min(100, level / (s.caffeineLimit || 1) * 100),
      bedtime: bed,
      bedLabel: M.formatClock(s.sleepTime),
      timeLeft: M.formatDuration(bed.getTime() - now),
      atSleep: atSleep,
      sleepOk: atSleep <= s.targetSleepCaffeine
    };
  }

  // ---------- Mutations ----------
  function persistIntakes() { S.saveIntakes(state.intakes); }

  function addIntake(entry) {
    var it = S.sanitizeIntake({
      id: S.newId(), name: entry.name, amount: entry.amount, category: entry.category,
      substance: entry.substance, timestamp: entry.timestamp, updatedAt: Date.now()
    });
    if (!it) return;
    state.intakes.push(it);
    sortIntakes();
    persistIntakes();
    renderData();
    showToast('Logged “' + it.name + '”', mgText(it.amount, it.substance) + ' · ' + fmtWhen(it.timestamp));
  }

  function removeIntake(id) {
    var idx = -1;
    for (var i = 0; i < state.intakes.length; i++) if (state.intakes[i].id === id) { idx = i; break; }
    if (idx < 0) return;
    var removed = state.intakes.splice(idx, 1)[0];
    persistIntakes();
    renderData();
    showUndo(removed);
  }

  function restoreIntake(it) {
    if (state.intakes.some(function (x) { return x.id === it.id; })) return;
    it.updatedAt = Date.now();
    state.intakes.push(it);
    sortIntakes();
    persistIntakes();
    renderData();
  }

  function updateSettings(patch) {
    var next = Object.assign({}, state.settings, patch, { updatedAt: Date.now() });
    state.settings = S.sanitizeSettings(next);
    S.saveSettings(state.settings);
    renderData();
  }

  function setDarkMode(on) {
    state.darkMode = !!on;
    S.saveDarkMode(state.darkMode);
    applyTheme();
    renderCharts();
    if (topModal() === 'settings') renderModals();
  }

  function applyTheme() {
    document.body.classList.toggle('dark', state.darkMode);
    var btn = $('#themeToggle');
    btn.innerHTML = icon(state.darkMode ? 'sun' : 'moon', 18);
    btn.setAttribute('aria-pressed', String(state.darkMode));
    var meta = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < meta.length; i++) meta[i].setAttribute('content', state.darkMode ? '#05070f' : '#f5f7fb');
  }

  // ---------- Render: data views ----------
  function renderData() {
    var m = metrics();
    renderHeader(m);
    renderSummary(m);
    renderMobileHome(m);
    renderLastCall(m);
    renderRanges();
    renderHistory();
    renderCharts(m);
    if (addPanel) updateImpact();
    if (topModal() === 'bedtime') updateBedtimeModal();
  }

  function renderHeader(m) {
    $('#bedtimeLabel').textContent = m.bedLabel;
    $('#bedtimeBtn').setAttribute('aria-label', 'Bedtime: ' + m.bedLabel);
  }

  function renderSummary(m) {
    var s = state.settings, st = m.status;
    $('#summaryCard').innerHTML =
      '<div class="summary-head"><div><h2 class="eyebrow-title">Summary</h2><p class="card-sub">Today</p></div>' +
      '<span class="pill pill-' + st.key + '">' + st.label + '</span></div>' +
      '<div class="summary-level"><div class="summary-level-label"><span class="tone-' + st.key + '">' + icon(st.icon, 18) + '</span>Current level</div>' +
      '<div class="big-mg tabular">' + m.level + '<small>mg</small></div></div>' +
      '<div class="progress" role="progressbar" aria-label="Caffeine level relative to daily limit" aria-valuemin="0" aria-valuemax="' + s.caffeineLimit + '" aria-valuenow="' + m.level + '">' +
      '<div class="progress-bar ' + st.key + '" style="width:' + m.pct + '%"></div></div>' +
      '<div class="progress-legend"><span>0 mg</span><span class="tabular">Daily Limit ' + s.caffeineLimit + ' mg</span></div>' +
      '<div class="divider"></div>' +
      '<div class="stat-trio">' +
      '<div><div class="stat-label">' + icon('moon', 14) + 'Bedtime</div><div class="stat-value">' + m.bedLabel + '</div></div>' +
      '<div><div class="stat-label">' + icon('clock', 14) + 'Time left</div><div class="stat-value">' + m.timeLeft + '</div></div>' +
      '<div><div class="stat-label">' + icon('trendingDown', 14) + 'At sleep</div><div class="stat-value ' + (m.sleepOk ? 'ok' : 'warn') + '">' + m.atSleep + ' mg</div></div>' +
      '</div>' +
      '<p class="foot-note">Target ' + s.targetSleepCaffeine + ' mg or less at bedtime</p>';
  }

  function renderMobileHome(m) {
    var s = state.settings, st = m.status;
    $('#levelCard').innerHTML =
      '<h2>Current Caffeine Level</h2>' +
      '<div class="level-row"><div class="level-main"><div class="status-bubble ' + st.key + '">' + icon(st.icon, 22) + '</div>' +
      '<div class="big-mg tabular">' + m.level + '<small>mg</small></div></div>' +
      '<span class="pill pill-' + st.key + '">' + st.label + '</span></div>' +
      '<div class="progress"><div class="progress-bar ' + st.key + '" style="width:' + m.pct + '%"></div></div>' +
      '<div class="progress-legend"><span>0 mg</span><span class="tabular">Daily Limit: ' + s.caffeineLimit + ' mg</span></div>';
    var cls = m.sleepOk ? 'ok' : 'warn';
    $('#sleepCard').innerHTML =
      '<div class="sleep-head"><div class="sleep-head-icon">' + icon('moon', 22) + '</div>' +
      '<div><h2>Sleep Readiness</h2><p class="card-sub">Projection for your bedtime</p></div></div>' +
      '<div class="sleep-grid">' +
      '<div>' + icon('moon', 16) + '<div class="v">' + m.bedLabel + '</div><div class="l">Bedtime</div></div>' +
      '<div>' + icon('clock', 16) + '<div class="v">' + m.timeLeft + '</div><div class="l">Until sleep</div></div>' +
      '<div>' + icon('trendingDown', 16, cls) + '<div class="v ' + cls + '">' + m.atSleep + ' mg</div><div class="l">At bedtime</div></div>' +
      '</div>' +
      '<p class="foot-note">Target: ' + s.targetSleepCaffeine + ' mg or less at bedtime</p>';
  }

  // ---------- Last call ----------
  // The personal staples (favorites with a unit: pills, mints, pouches) plus whichever drink is chosen.
  function lastCallDrinks() {
    var list = CT.FEATURED_DRINKS.filter(function (d) { return d.unit; });
    var chosen = DRINKS_BY_ID[state.settings.lastCallDrinkId];
    if (chosen && list.indexOf(chosen) < 0) list.unshift(chosen);
    return list;
  }

  function headlineDrink() {
    return DRINKS_BY_ID[state.settings.lastCallDrinkId] || lastCallDrinks()[0];
  }

  function clockMs(t) {
    var d = new Date(t);
    var time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    var ds = localDateStr(d), today = localDateStr(new Date());
    if (ds === today) return time;
    var tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    return (ds === localDateStr(tomorrow) ? 'Tomorrow ' : ds === daysAgoStr(1) ? 'Yesterday ' : '') + time;
  }

  function sameDay(a, b) { return localDateStr(new Date(a)) === localDateStr(new Date(b)); }

  function doseLabel(d) {
    var unit = d.unit ? d.unit.replace(/^1 /, '') : 'serving';
    return mgText(d.caffeineMg, d.substance) + ' ' + unit;
  }

  function lastCallTone(lc, now) {
    if (lc.kind === 'anytime') return 'ok';
    if (lc.kind === 'open') return lc.time - now <= M.HOUR ? 'soon' : 'ok';
    return 'closed';
  }

  function renderLastCall(m) {
    var s = state.settings, now = m.now;
    var d = headlineDrink();
    var lc = M.lastCall(state.intakes, s, d.caffeineMg, d.substance, now);
    var tone = lastCallTone(lc, now);
    var target = s.targetSleepCaffeine;
    var title, sub;
    if (lc.kind === 'open') {
      title = 'Last call ' + clockMs(lc.time);
      sub = 'for a ' + doseLabel(d) + ' · ' + M.formatDuration(lc.time - now) + ' left';
    } else if (lc.kind === 'closed') {
      title = sameDay(lc.time, now) ? 'Last call was ' + clockMs(lc.time) : 'Closed for today';
      sub = 'A ' + doseLabel(d) + ' now would leave ' + Math.round(lc.ifNow) + ' mg at bedtime (target ' + target + ')';
    } else if (lc.kind === 'anytime') {
      title = 'No cutoff tonight';
      sub = 'A ' + doseLabel(d) + ' stays under your ' + target + ' mg target even right before bed';
    } else {
      title = 'Done for today';
      sub = 'You’re already projected at ' + Math.round(lc.base) + ' mg at bedtime, over your ' + target + ' mg target';
    }
    var budget = M.budgetNow(state.intakes, s, now);
    var budgetText = budget > 0 ?
      'Room right now: up to <strong>' + budget + ' mg</strong> of caffeine' :
      'No room left for caffeine before bed';

    var rows = lastCallDrinks().map(function (x) {
      var r = M.lastCall(state.intakes, s, x.caffeineMg, x.substance, now);
      var t = lastCallTone(r, now);
      var txt = r.kind === 'open' ? 'until ' + clockMs(r.time) :
        r.kind === 'closed' ? (sameDay(r.time, now) ? 'closed ' + clockMs(r.time) : 'closed today') :
        r.kind === 'anytime' ? 'any time' : 'skip';
      var sel = x.id === d.id;
      return '<button type="button" class="lc-row" data-action="set-lastcall" data-id="' + esc(x.id) + '" aria-pressed="' + sel + '">' +
        '<span class="lc-name">' + esc(x.name) + '</span>' +
        '<span class="lc-when lc-' + t + '">' + txt + '</span></button>';
    }).join('');

    var html =
      '<div class="lc-head"><h2 class="eyebrow-title">Last Call</h2>' +
      '<span class="lc-dot lc-dot-' + tone + '" aria-hidden="true"></span></div>' +
      '<div class="lc-hero lc-hero-' + tone + '">' +
      '<div class="lc-icon">' + icon(tone === 'closed' ? 'alertTriangle' : 'clock', 20) + '</div>' +
      '<div><div class="lc-title">' + title + '</div><div class="lc-sub">' + sub + '</div></div></div>' +
      '<p class="lc-budget">' + budgetText + '</p>' +
      '<div class="lc-list" role="group" aria-label="Last call by item">' + rows + '</div>' +
      '<p class="foot-note">Tap an item to make it your headline. Based on a ' + m.bedLabel +
      ' bedtime and ' + target + ' mg target. <button type="button" class="link-btn lc-change" data-action="open-bedtime">Change</button></p>';
    $$('[data-lastcall]').forEach(function (el) { el.innerHTML = html; });
  }

  function renderRanges() {
    var html = M.RANGES.map(function (r) {
      return '<button type="button" class="seg-btn" data-action="set-range" data-range="' + r.value + '" aria-pressed="' + (r.value === state.range) + '">' + r.label + '</button>';
    }).join('');
    $$('[data-range-group]').forEach(function (el) { el.innerHTML = html; });
    $$('[data-range-caption]').forEach(function (el) { el.textContent = rangeCaption(); });
  }

  function intakeRowHtml(it) {
    var cat = M.categoryMeta(it.category);
    return '<div class="intake-row">' +
      '<div class="cat-icon cat-' + cat.tone + '">' + icon(cat.icon, 16) + '</div>' +
      '<div class="intake-main"><div class="intake-name" title="' + esc(it.name) + '">' + esc(it.name) + '</div>' +
      '<div class="intake-time">' + esc(fmtWhen(it.timestamp)) + '</div></div>' +
      '<div class="intake-mg"' + (it.substance ? ' title="' + M.substanceMeta(it.substance).label + '"' : '') + '>' + mgText(it.amount, it.substance) + '</div>' +
      '<button type="button" class="del-btn" data-action="delete-intake" data-id="' + esc(it.id) + '" aria-label="Remove ' + esc(it.name) + '">' + icon('x', 18) + '</button>' +
      '</div>';
  }

  function renderHistory() {
    var html;
    if (!state.intakes.length) {
      html = '<div class="empty"><p>No caffeine intake recorded yet.</p>' +
        '<button type="button" class="btn btn-primary" data-action="first-drink">Add Your First Drink</button></div>';
    } else {
      var list = M.filterByRange(state.intakes, state.range);
      html = list.length ? list.map(intakeRowHtml).join('') :
        '<div class="empty"><p>No entries for this range.</p><p>Try selecting a broader window above to see older drinks.</p></div>';
    }
    $('#historyDesktop').innerHTML = html;
    $('#historyMobile').innerHTML = html;
  }

  // ---------- Chart cards ----------
  var chartCards = [];

  function setupChartCards() {
    $$('[data-chart]').forEach(function (el) {
      var variant = el.getAttribute('data-chart');
      var inputId = 'limit-' + variant;
      el.innerHTML =
        '<div class="chart-top"><div>' +
        '<div class="chart-eyebrow">' + icon('barChart', 18) + 'Trending Intake</div>' +
        '<h2 class="chart-title">Caffeine Levels</h2><p class="card-sub" data-caption></p></div>' +
        '<div class="limit-field"><label for="' + inputId + '">Daily Limit (mg)</label>' +
        '<div class="row"><input class="input" id="' + inputId + '" type="number" min="1" max="2000" step="10" inputmode="numeric" data-limit-input><span>mg</span></div></div>' +
        '</div>' +
        '<div class="chart-box"></div>' +
        '<div class="legend' + (variant === 'mobile' ? ' four' : '') + '" data-legend></div>';
      chartCards.push({ el: el, variant: variant, box: $('.chart-box', el), input: $('[data-limit-input]', el) });
    });
  }

  function renderCharts(m) {
    m = m || metrics();
    var s = state.settings;
    var series = M.chartSeries(state.intakes, s, state.range, m.now);
    var hd = headlineDrink();
    var lc = M.lastCall(state.intakes, s, hd.caffeineMg, hd.substance, m.now);
    var lastCallT = lc.kind === 'open' || lc.kind === 'closed' ? lc.time : null;
    var showLc = lastCallT !== null && lastCallT >= series.start && lastCallT <= series.end;
    chartCards.forEach(function (c) {
      $('[data-caption]', c.el).textContent = rangeCaption();
      if (document.activeElement !== c.input) c.input.value = s.caffeineLimit;
      var mobile = c.variant === 'mobile';
      $('[data-legend]', c.el).innerHTML =
        '<span class="legend-item"><span class="sw sw-line"></span>Caffeine Level</span>' +
        '<span class="legend-item"><span class="sw sw-limit"></span>Daily Limit (' + s.caffeineLimit + ' mg)</span>' +
        '<span class="legend-item"><span class="sw sw-target"></span>Sleep Target (' + s.targetSleepCaffeine + ' mg)</span>' +
        (mobile ? '<span class="legend-item"><span class="sw sw-bed"></span>Bedtime</span>' : '') +
        (showLc ? '<span class="legend-item"><span class="sw sw-lastcall"></span>Last call · ' + esc(hd.name) + '</span>' : '');
      CT.chart.render(c.box, {
        series: series,
        limit: s.caffeineLimit,
        target: s.targetSleepCaffeine,
        bedtime: m.bedtime.getTime(),
        showBedtime: mobile,
        lastCall: showLc ? lastCallT : null,
        height: mobile ? 260 : 320
      });
    });
  }

  // ---------- Add intake panel ----------
  var addPanel;

  function buildAddPanel() {
    addPanel = document.createElement('div');
    addPanel.className = 'add-panel';
    addPanel.innerHTML =
      '<div class="glass sub-card">' +
      '<p class="sub-card-title">When did you have this?</p>' +
      '<div class="time-grid">' +
      '<button type="button" class="opt" data-action="time-mode" data-mode="now"><span class="radio"></span><span class="opt-text">Just now</span></button>' +
      '<button type="button" class="opt" data-action="time-mode" data-mode="1hr"><span class="radio"></span><span class="opt-text">1 hour ago</span></button>' +
      '<button type="button" class="opt" data-action="time-mode" data-mode="earlier"><span class="radio"></span><span class="opt-text">Earlier today<span class="opt-desc">8:00 AM</span></span></button>' +
      '</div>' +
      '<button type="button" class="opt opt-wide" data-action="time-mode" data-mode="specific"><span class="left"><span class="radio"></span>Pick exact time</span>' + icon('chevronDown', 18, 'chev') + '</button>' +
      '<div class="exact-box" data-exact hidden>' +
      '<div class="two"><div><label for="exact-date">Date</label><input class="input" type="date" id="exact-date" data-exact-date></div>' +
      '<div><label for="exact-time">Time</label><input class="input" type="time" id="exact-time" data-exact-time></div></div>' +
      '<div class="quick-days" data-quick-days></div>' +
      '</div>' +
      '</div>' +

      '<div class="glass search-card">' +
      '<div class="search-wrap">' + icon('search', 16, 'icon-search') +
      '<label class="sr-only" for="drink-search" hidden>Search for a drink</label>' +
      '<input class="input search-input" id="drink-search" type="search" placeholder="Search for a drink…" aria-label="Search for a drink" autocomplete="off" data-search>' +
      '<button type="button" class="search-clear" data-action="clear-search" aria-label="Clear search" hidden>' + icon('x', 16) + '</button>' +
      '</div>' +
      '<div class="drink-list" data-drink-list></div>' +
      '</div>' +

      '<button type="button" class="btn btn-outline btn-block custom-toggle" data-action="toggle-custom">' + icon('plus', 16) + 'Add Custom Drink</button>' +
      '<form class="glass custom-card" data-custom-form novalidate>' +
      '<div class="custom-divider">Custom Drink</div>' +
      '<div class="field"><label for="custom-name">Drink name</label><input class="input" id="custom-name" name="name" maxlength="80" autocomplete="off"></div>' +
      '<div class="field"><label for="custom-mg">Amount (mg)</label><input class="input" id="custom-mg" name="mg" type="number" min="1" max="2000" inputmode="numeric"></div>' +
      '<div class="field"><label for="custom-substance">Stimulant</label><select class="input" id="custom-substance" name="substance">' +
      '<option value="caffeine">Caffeine</option><option value="paraxanthine">Paraxanthine (clears faster)</option></select></div>' +
      '<p class="form-error" data-custom-error hidden></p>' +
      '<button type="submit" class="btn btn-primary btn-block">' + icon('plus', 16) + 'Log custom drink</button>' +
      '</form>';

    $('#addPanelHome').appendChild(addPanel);

    var search = $('[data-search]', addPanel);
    search.addEventListener('input', function () {
      state.add.query = search.value;
      state.add.selectedId = null;
      renderDrinkList();
    });
    search.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        var first = $('.drink-row', addPanel);
        if (first) selectDrink(first.getAttribute('data-id'));
      } else if (e.key === 'Escape' && search.value) {
        e.stopPropagation();
        clearSearch();
      }
    });
    $('[data-exact-date]', addPanel).addEventListener('input', function (e) {
      state.add.date = e.target.value; state.add.exactTouched = true; renderTimeOptions();
    });
    $('[data-exact-time]', addPanel).addEventListener('input', function (e) {
      state.add.time = e.target.value; state.add.exactTouched = true; updateImpact();
    });
    $('[data-custom-form]', addPanel).addEventListener('submit', function (e) {
      e.preventDefault();
      logCustom(e.target);
    });
    addPanel.addEventListener('input', function (e) {
      if (e.target.matches('[data-portion]')) {
        state.add.portion = +e.target.value;
        updatePortionLabel();
      }
    });

    renderTimeOptions();
    renderDrinkList();
  }

  function renderTimeOptions() {
    var mode = state.add.mode;
    $$('.opt[data-mode]', addPanel).forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-mode') === mode));
    });
    var wide = $('.opt-wide', addPanel);
    wide.setAttribute('aria-expanded', String(mode === 'specific'));
    $('[data-exact]', addPanel).hidden = mode !== 'specific';
    var dateInput = $('[data-exact-date]', addPanel), timeInput = $('[data-exact-time]', addPanel);
    if (dateInput.value !== state.add.date) dateInput.value = state.add.date;
    if (timeInput.value !== state.add.time) timeInput.value = state.add.time;
    dateInput.max = localDateStr(new Date(Date.now() + 7 * M.DAY));
    var chips = '';
    for (var n = 0; n < 4; n++) {
      var ds = daysAgoStr(n);
      var label = n === 0 ? 'Today' : n === 1 ? 'Yesterday' : n + ' days ago';
      chips += '<button type="button" class="chip" data-action="quick-day" data-days="' + n + '" aria-pressed="' + (state.add.date === ds) + '">' + label + '</button>';
    }
    $('[data-quick-days]', addPanel).innerHTML = chips;
    updateImpact();
  }

  function searchResults(q) {
    q = q.trim().toLowerCase();
    if (!q) return [];
    var matches = ALL_DRINKS.filter(function (d) {
      return d.name.toLowerCase().indexOf(q) >= 0 ||
        M.categoryMeta(d.category).label.toLowerCase().indexOf(q) >= 0 ||
        (d.substance && M.substanceMeta(d.substance).label.toLowerCase().indexOf(q) >= 0) ||
        (d.unit && d.unit.indexOf(q) >= 0);
    });
    matches.sort(function (a, b) {
      var ai = a.name.toLowerCase().indexOf(q), bi = b.name.toLowerCase().indexOf(q);
      var ar = ai === 0 ? 0 : ai > 0 ? 1 : 2, br = bi === 0 ? 0 : bi > 0 ? 1 : 2;
      return ar - br || (a.id.indexOf('featured-') === 0 ? -1 : 0) - (b.id.indexOf('featured-') === 0 ? -1 : 0) || a.name.localeCompare(b.name);
    });
    return matches.slice(0, 60);
  }

  function highlight(name, q) {
    q = q.trim();
    if (!q) return esc(name);
    var i = name.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return esc(name);
    return esc(name.slice(0, i)) + '<mark>' + esc(name.slice(i, i + q.length)) + '</mark>' + esc(name.slice(i + q.length));
  }

  function drinkRowHtml(d, q) {
    var sel = state.add.selectedId === d.id;
    var row = '<button type="button" class="drink-row" data-action="select-drink" data-id="' + esc(d.id) + '" aria-pressed="' + sel + '">' +
      '<span><span class="drink-name">' + highlight(d.name, q || '') + '</span>' +
      '<span class="drink-meta" style="display:block">' + esc(servingText(d)) + '</span></span>' +
      '<span class="drink-mg">' + mgText(d.caffeineMg, d.substance) + '</span></button>';
    return sel ? row + confirmHtml(d) : row;
  }

  function confirmHtml(d) {
    var p = state.add.portion;
    return '<div class="confirm" data-confirm>' +
      '<div class="confirm-head"><div><div class="drink-name">' + esc(d.name) + '</div><div class="drink-meta">' + esc(servingText(d)) + '</div></div>' +
      '<button type="button" class="close-btn" data-action="clear-selection" aria-label="Clear selection">' + icon('x', 16) + '</button></div>' +
      '<div class="portion-row"><label for="portion-range">Portion consumed</label><strong data-portion-label>' + p + '% · ' + mgText(Math.round(d.caffeineMg * p / 100), d.substance) + '</strong></div>' +
      '<input class="range" id="portion-range" type="range" min="10" max="100" step="5" value="' + p + '" data-portion>' +
      '<div class="portion-quick">' + [10, 25, 50, 75, 100].map(function (v) {
        return '<button type="button" class="chip" data-action="portion" data-value="' + v + '" aria-pressed="' + (p === v) + '">' + v + '%</button>';
      }).join('') + '</div>' +
      '<p class="bed-impact" data-impact>' + impactHtml(d) + '</p>' +
      '<button type="button" class="btn btn-primary btn-block" data-action="add-selected">' + icon('plus', 16) + 'Add ' + esc(d.name) + '</button>' +
      '</div>';
  }

  // What this dose, at the chosen time and portion, does to the bedtime projection.
  function impactHtml(d) {
    var s = state.settings, now = Date.now();
    var dose = d.caffeineMg * state.add.portion / 100;
    var t = Date.parse(chosenTimestamp());
    var bed = M.nextBedtime(s.sleepTime, now).getTime();
    if (t > bed) return icon('moon', 14) + '<span>Logged after tonight’s bedtime</span>';
    var proj = Math.round(M.projectedWithDose(state.intakes, s, dose, d.substance, t, now));
    var ok = proj <= s.targetSleepCaffeine;
    return '<span class="impact-' + (ok ? 'ok' : 'warn') + '">' + icon(ok ? 'check' : 'alertTriangle', 14) +
      'At bedtime: ' + proj + ' mg ' + (ok ? '(within your ' : '(over your ') + s.targetSleepCaffeine + ' mg target)</span>';
  }

  function updateImpact() {
    var d = DRINKS_BY_ID[state.add.selectedId];
    var el = $('[data-impact]', addPanel);
    if (d && el) el.innerHTML = impactHtml(d);
  }

  function updatePortionLabel() {
    var d = DRINKS_BY_ID[state.add.selectedId];
    if (!d) return;
    var p = state.add.portion;
    var lbl = $('[data-portion-label]', addPanel);
    if (lbl) lbl.textContent = p + '% · ' + mgText(Math.round(d.caffeineMg * p / 100), d.substance);
    var range = $('[data-portion]', addPanel);
    if (range && +range.value !== p) range.value = p;
    $$('.portion-quick .chip', addPanel).forEach(function (c) {
      c.setAttribute('aria-pressed', String(+c.getAttribute('data-value') === p));
    });
    updateImpact();
  }

  function renderDrinkList() {
    var q = state.add.query;
    var listEl = $('[data-drink-list]', addPanel);
    $('.search-clear', addPanel).hidden = !q;
    var html = '';
    if (q.trim()) {
      var res = searchResults(q);
      html = res.length ? res.map(function (d) { return drinkRowHtml(d, q); }).join('') :
        '<p class="no-results">No drinks match “' + esc(q.trim()) + '”. Log it as a custom drink below.</p>';
    } else if (!ALL_DRINKS.length) {
      html = '<p class="no-results">No drinks available. Add a custom drink below.</p>';
    } else {
      html = '<p class="list-heading">Favorites</p>' + CT.FEATURED_DRINKS.map(function (d) { return drinkRowHtml(d); }).join('');
      var recent = state.recent.map(function (id) { return DRINKS_BY_ID[id]; }).filter(Boolean);
      if (recent.length) html += '<p class="list-heading">Recent</p>' + recent.map(function (d) { return drinkRowHtml(d); }).join('');
    }
    listEl.innerHTML = html;
  }

  function selectDrink(id) {
    state.add.selectedId = state.add.selectedId === id ? null : id;
    state.add.portion = 100;
    renderDrinkList();
    var c = $('[data-confirm]', addPanel);
    if (c) c.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function chosenTimestamp() {
    var now = new Date();
    switch (state.add.mode) {
      case '1hr': return new Date(now.getTime() - M.HOUR).toISOString();
      case 'earlier': { var d = new Date(now); d.setHours(8, 0, 0, 0); return d.toISOString(); }
      case 'specific': {
        var dp = (state.add.date || localDateStr(now)).split('-').map(Number);
        var tp = (state.add.time || localTimeStr(now)).split(':').map(Number);
        var dt = new Date(dp[0], dp[1] - 1, dp[2], tp[0], tp[1], 0, 0);
        return isFinite(dt.getTime()) ? dt.toISOString() : now.toISOString();
      }
      default: return now.toISOString();
    }
  }

  function addSelected() {
    var d = DRINKS_BY_ID[state.add.selectedId];
    if (!d) return;
    var p = state.add.portion;
    addIntake({
      name: d.name + (p !== 100 ? ' (' + p + '%)' : ''),
      amount: Math.max(0, Math.round(d.caffeineMg * p / 100)),
      category: d.category,
      substance: d.substance,
      timestamp: chosenTimestamp()
    });
    state.recent = [d.id].concat(state.recent.filter(function (x) { return x !== d.id; })).slice(0, 5);
    S.saveRecent(state.recent);
    state.add.selectedId = null;
    state.add.portion = 100;
    renderDrinkList();
    if (topModal() === 'add') closeModal();
  }

  function logCustom(form) {
    var name = form.elements.name.value.trim();
    var mg = Number(form.elements.mg.value);
    var err = $('[data-custom-error]', addPanel);
    var msg = !name ? 'Enter a drink name.' : !(mg > 0) ? 'Enter a caffeine amount above 0 mg.' : mg > 2000 ? 'That is more than 2000 mg; check the amount.' : '';
    err.hidden = !msg;
    err.textContent = msg;
    if (msg) return;
    var substance = form.elements.substance.value;
    addIntake({ name: name, amount: Math.round(mg), category: 'other', substance: substance === 'caffeine' ? undefined : substance, timestamp: chosenTimestamp() });
    form.reset();
    if (topModal() === 'add') closeModal();
  }

  function clearSearch() {
    var input = $('[data-search]', addPanel);
    input.value = '';
    state.add.query = '';
    state.add.selectedId = null;
    renderDrinkList();
    input.focus();
  }

  // ---------- Modals ----------
  function topModal() { return state.modals.length ? state.modals[state.modals.length - 1] : null; }
  var lastFocus = [];

  function openModal(kind) {
    if (state.modals.indexOf(kind) >= 0) return;
    lastFocus.push(document.activeElement);
    if (kind === 'settings') state.settingsDraft = Object.assign({}, state.settings);
    state.modals.push(kind);
    renderModals();
    var top = $('#modalRoot .modal-overlay:last-child');
    var focusTarget = top && (top.querySelector('[data-autofocus]') || top.querySelector('.close-btn'));
    if (focusTarget) focusTarget.focus();
  }

  function closeModal() {
    var kind = state.modals.pop();
    if (kind === 'add') {
      addPanel.parentNode && addPanel.parentNode.classList.remove('sheet');
      $('#addPanelHome').appendChild(addPanel);
      state.add.customOpen = false;
    }
    if (kind === 'settings') state.settingsDraft = null;
    renderModals();
    var f = lastFocus.pop();
    if (f && document.contains(f)) f.focus();
  }

  function modalShell(kind, title, body, small) {
    return '<div class="modal-overlay" data-modal="' + kind + '" data-action="overlay">' +
      '<div class="modal' + (small ? ' modal-sm' : '') + '" role="dialog" aria-modal="true" aria-labelledby="mt-' + kind + '">' +
      '<div class="modal-head"><h2 id="mt-' + kind + '">' + title + '</h2>' +
      '<button type="button" class="close-btn" data-action="close-modal" aria-label="Close modal">' + icon('x', 18) + '</button></div>' +
      '<div class="modal-body">' + body + '</div></div></div>';
  }

  function renderModals() {
    var root = $('#modalRoot');
    // Keep the add panel alive across re-renders.
    if (addPanel.parentNode && addPanel.parentNode.closest && addPanel.parentNode.closest('#modalRoot')) {
      $('#addPanelHome').appendChild(addPanel);
    }
    root.innerHTML = state.modals.map(function (kind) {
      if (kind === 'settings') return modalShell(kind, 'Settings', settingsBody());
      if (kind === 'bedtime') return modalShell(kind, 'Set Bedtime', bedtimeBody(), true);
      if (kind === 'about') return modalShell(kind, 'About Caffeine', aboutBody());
      if (kind === 'add') return modalShell(kind, 'Add Caffeine Intake', '<div class="sheet" data-sheet-slot></div>');
      return '';
    }).join('');
    var slot = $('[data-sheet-slot]', root);
    if (slot) {
      slot.appendChild(addPanel);
      addPanel.classList.remove('sheet');
      var custom = $('.custom-card', addPanel);
      custom.classList.toggle('collapsed', !state.add.customOpen);
      $('.custom-toggle', addPanel).hidden = state.add.customOpen;
    } else {
      $('.custom-card', addPanel).classList.remove('collapsed');
    }
    document.body.style.overflow = state.modals.length ? 'hidden' : '';
    if (state.modals.indexOf('settings') >= 0) bindSettings();
    if (state.modals.indexOf('bedtime') >= 0) bindBedtime();
  }

  // Settings
  function settingsBody() {
    var d = state.settingsDraft;
    var rates = [['fast', 'Fast (4 hours)'], ['average', 'Average (5.5 hours)'], ['slow', 'Slow (7.5 hours)']];
    return '' +
      '<div class="setting"><label class="t" for="set-rate">Metabolism Rate</label>' +
      '<select class="input" id="set-rate" data-set="metabolismRate" data-autofocus>' +
      rates.map(function (r) { return '<option value="' + r[0] + '"' + (d.metabolismRate === r[0] ? ' selected' : '') + '>' + r[1] + '</option>'; }).join('') +
      '</select><p class="hint">How quickly your body metabolizes caffeine</p></div>' +
      '<div class="setting"><label class="t" for="set-limit">Daily Caffeine Limit (mg)</label>' +
      '<input class="input" id="set-limit" type="number" min="1" max="2000" data-set="caffeineLimit" value="' + d.caffeineLimit + '">' +
      '<p class="hint">Default: 200mg</p></div>' +
      '<div class="setting"><label class="t" for="set-target">Target Sleep Caffeine Level (mg)</label>' +
      '<input class="input" id="set-target" type="number" min="0" max="1000" data-set="targetSleepCaffeine" value="' + d.targetSleepCaffeine + '">' +
      '<p class="hint">Recommended: 30mg or less for quality sleep</p></div>' +
      '<div class="panel"><h3>Special Conditions</h3>' +
      checkRow('pregnancyAdjustment', 'Pregnancy (slower metabolism)', d) +
      checkRow('smokerAdjustment', 'Smoker (faster metabolism)', d) +
      checkRow('oralContraceptivesAdjustment', 'Oral contraceptives (slower metabolism)', d) +
      '<p class="effective" data-effective>' + effectiveText(d) + '</p></div>' +
      '<div class="panel"><h3>Appearance</h3><div class="row-between"><span>Dark Mode</span>' +
      '<button type="button" class="icon-btn" data-action="toggle-theme" aria-label="Toggle dark mode" aria-pressed="' + state.darkMode + '">' + icon(state.darkMode ? 'sun' : 'moon', 18) + '</button></div></div>' +
      '<div class="panel"><h3>About Caffeine</h3><button type="button" class="btn btn-outline btn-block" data-action="open-about">Click here to learn more about caffeine</button></div>' +
      '<div class="panel"><h3>Your Data</h3><p class="hint" style="font-size:.8rem;color:var(--muted);margin-bottom:10px">Everything is stored only in this browser. Export a backup to move it to another device.</p>' +
      '<div class="btn-row">' +
      '<button type="button" class="btn btn-outline" data-action="export">' + icon('download', 16) + 'Export</button>' +
      '<button type="button" class="btn btn-outline" data-action="import">' + icon('upload', 16) + 'Import</button>' +
      '<button type="button" class="btn btn-outline btn-danger" data-action="clear-data">' + icon('trash', 16) + 'Clear all</button>' +
      '</div></div>' +
      '<button type="button" class="btn btn-primary btn-block" data-action="save-settings">Save Settings</button>';
  }

  function checkRow(key, label, d) {
    return '<label class="check"><input type="checkbox" data-set="' + key + '"' + (d[key] ? ' checked' : '') + '>' + label + '</label>';
  }

  function effectiveText(d) {
    var h = M.halfLifeHours(d);
    return 'Effective half-life: ' + (Math.round(h * 10) / 10) + ' hours';
  }

  function bindSettings() {
    $$('#modalRoot [data-set]').forEach(function (el) {
      el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', function () {
        var key = el.getAttribute('data-set');
        var d = state.settingsDraft;
        if (!d) return;
        if (el.type === 'checkbox') d[key] = el.checked;
        else if (el.type === 'number') d[key] = el.value === '' ? d[key] : Number(el.value);
        else d[key] = el.value;
        var eff = $('#modalRoot [data-effective]');
        if (eff) eff.textContent = effectiveText(d);
      });
    });
  }

  function saveSettings() {
    var d = state.settingsDraft;
    if (!d) return;
    updateSettings({
      metabolismRate: d.metabolismRate,
      caffeineLimit: d.caffeineLimit,
      targetSleepCaffeine: d.targetSleepCaffeine,
      pregnancyAdjustment: d.pregnancyAdjustment,
      smokerAdjustment: d.smokerAdjustment,
      oralContraceptivesAdjustment: d.oralContraceptivesAdjustment
    });
    closeModal();
    showToast('Settings saved');
  }

  // Bedtime
  function bedtimeBody() {
    return '<div class="inner bed-current"><div class="label-caps">Current</div><div class="v" data-bed-current></div></div>' +
      '<div><div class="label-caps" style="margin-bottom:10px">Presets</div><div class="preset-grid">' +
      BEDTIME_PRESETS.map(function (p) {
        return '<button type="button" class="preset" data-action="set-bedtime" data-time="' + p[0] + '" aria-pressed="false">' + p[1] + '</button>';
      }).join('') + '</div></div>' +
      '<div class="setting"><label class="t" for="bed-custom" style="font-weight:500;font-size:.8rem;color:var(--muted)">Custom time</label>' +
      '<input class="input" type="time" id="bed-custom" data-bed-custom></div>' +
      '<div class="inner proj"><div class="row-between"><span>Projected at sleep</span><span class="mg" data-bed-proj></span></div>' +
      '<p class="t" data-bed-target></p></div>';
  }

  function bindBedtime() {
    var input = $('#modalRoot [data-bed-custom]');
    input.value = state.settings.sleepTime;
    input.addEventListener('change', function () {
      if (/^\d{2}:\d{2}$/.test(input.value)) updateSettings({ sleepTime: input.value });
    });
    updateBedtimeModal();
  }

  function updateBedtimeModal() {
    var root = $('#modalRoot [data-modal="bedtime"]');
    if (!root) return;
    var m = metrics();
    $('[data-bed-current]', root).textContent = m.bedLabel;
    $$('.preset', root).forEach(function (b) {
      var on = b.getAttribute('data-time') === state.settings.sleepTime;
      b.setAttribute('aria-pressed', String(on));
      b.innerHTML = (on ? icon('check', 14) : '') + BEDTIME_PRESETS.filter(function (p) { return p[0] === b.getAttribute('data-time'); })[0][1];
    });
    var input = $('[data-bed-custom]', root);
    if (document.activeElement !== input) input.value = state.settings.sleepTime;
    var proj = $('[data-bed-proj]', root);
    proj.textContent = m.atSleep + ' mg';
    proj.className = 'mg ' + (m.sleepOk ? 'ok' : 'warn');
    $('[data-bed-target]', root).textContent = 'Target: ' + state.settings.targetSleepCaffeine + ' mg or less';
  }

  // About
  function aboutBody() {
    return '<div class="about">' +
      '<h3>' + icon('coffee', 18) + 'What is caffeine?</h3>' +
      '<p>Caffeine is a naturally occurring stimulant found in coffee beans, tea leaves, cacao and guarana. It is the most widely consumed psychoactive substance in the world, mostly through drinks.</p>' +
      '<h3>' + icon('zap', 18) + 'How it works</h3>' +
      '<p>Caffeine is absorbed from the gut within about 45 minutes and peaks in the blood 15–120 minutes after drinking. It blocks adenosine receptors in the brain; adenosine builds up while you are awake and creates sleep pressure, so blocking it makes you feel more alert.</p>' +
      '<p>The liver breaks caffeine down (mainly via the CYP1A2 enzyme) into paraxanthine, theobromine and theophylline, which are then excreted.</p>' +
      '<h3>' + icon('clock', 18) + 'Half-life and metabolism</h3>' +
      '<p>Half-life is the time your body needs to clear half of the caffeine in your system. It varies widely between people:</p>' +
      '<ul><li>Fast metabolizers: about 4 hours</li><li>Average: about 5.5 hours</li><li>Slow metabolizers: about 7.5 hours</li></ul>' +
      '<p>Genetics, pregnancy (slower), smoking (faster), oral contraceptives (slower), liver health and some medications all shift it. CafTrack models each drink as absorbed when logged and then decaying exponentially by your half-life.</p>' +
      '<h3>' + icon('alertCircle', 18) + 'How much is too much?</h3>' +
      '<p>Health authorities such as the FDA and EFSA consider up to 400 mg a day safe for most healthy adults, roughly four 8 oz cups of brewed coffee. During pregnancy the usual guidance is 200 mg a day or less. Single doses above about 200 mg are more likely to cause jitters or a racing heart.</p>' +
      '<h3>' + icon('moon', 18) + 'Caffeine and sleep</h3>' +
      '<p>Caffeine can delay sleep and reduce deep sleep even when you do not feel wired. A common rule is to stop 6–8 hours before bed. CafTrack projects your level at bedtime so you can aim for your sleep target (30 mg by default).</p>' +
      '<h3>' + icon('leaf', 18) + 'Paraxanthine</h3>' +
      '<p>Paraxanthine is the main compound your liver turns caffeine into (about 80% of it). It blocks adenosine receptors about as strongly as caffeine, so it keeps you alert in a similar way, but it clears faster: roughly a 3.1-hour half-life versus 4.1 hours for caffeine in the same people. Some supplements and pouches (such as Ultra Focus) contain it instead of caffeine.</p>' +
      '<p>CafTrack counts paraxanthine toward your level and bedtime projection (marked “PX”), decaying about 24% faster than your caffeine half-life. Human sleep studies on paraxanthine supplements are still limited, so treat its sleep effect as similar to caffeine until proven otherwise.</p>' +
      '<p class="disclaimer">Estimates only, based on published averages. This app is not a medical device; individual responses vary, so talk to a clinician about your own limits.</p>' +
      '</div>';
  }

  // ---------- Data import / export ----------
  function exportData() {
    var payload = {
      app: 'caftrack-clone', version: 1, exportedAt: new Date().toISOString(),
      intakes: state.intakes, settings: state.settings, recent: state.recent, darkMode: state.darkMode
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'caftrack-backup-' + localDateStr(new Date()) + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    showToast('Backup downloaded', state.intakes.length + ' entries');
  }

  function importData(obj) {
    var incoming = Array.isArray(obj) ? obj : obj && (obj.intakes || obj.caffeineIntakes);
    if (!Array.isArray(incoming)) throw new Error('No intakes found in that file.');
    var byId = {};
    state.intakes.forEach(function (i) { byId[i.id] = i; });
    var added = 0;
    incoming.map(S.sanitizeIntake).filter(Boolean).forEach(function (i) {
      var cur = byId[i.id];
      if (!cur) added++;
      if (!cur || i.updatedAt > cur.updatedAt) byId[i.id] = i;
    });
    state.intakes = Object.keys(byId).map(function (k) { return byId[k]; });
    sortIntakes();
    persistIntakes();
    var s = obj && (obj.settings || obj.caffeineSettings);
    if (s && (s.updatedAt || 0) >= (state.settings.updatedAt || 0)) {
      state.settings = S.sanitizeSettings(s);
      S.saveSettings(state.settings);
    }
    if (obj && Array.isArray(obj.recent)) {
      state.recent = obj.recent.concat(state.recent).filter(function (id, idx, arr) {
        return DRINKS_BY_ID[id] && arr.indexOf(id) === idx;
      }).slice(0, 5);
      S.saveRecent(state.recent);
    }
    return added;
  }

  // ---------- Toasts ----------
  var infoTimer = null;

  function renderToasts(info) {
    var root = $('#toastRoot');
    var html = '';
    if (state.undo) {
      html += '<div class="toast" role="status"><div class="toast-main"><div class="toast-title">Removed “' + esc(state.undo.intake.name) + '”</div>' +
        '<div class="toast-sub">Undo is available for a few seconds.</div></div>' +
        '<button type="button" class="btn btn-primary" data-action="undo">Undo</button>' +
        '<button type="button" class="close-btn" data-action="dismiss-undo" aria-label="Dismiss undo">' + icon('x', 16) + '</button></div>';
    } else if (info) {
      html += '<div class="toast" role="status"><div class="toast-main"><div class="toast-title">' + esc(info.title) + '</div>' +
        (info.sub ? '<div class="toast-sub">' + esc(info.sub) + '</div>' : '') + '</div></div>';
    }
    root.innerHTML = html;
  }

  function showUndo(intake) {
    if (state.undo) clearTimeout(state.undo.timer);
    clearTimeout(infoTimer);
    state.undo = { intake: intake, timer: setTimeout(function () { state.undo = null; renderToasts(); }, UNDO_MS) };
    renderToasts();
  }

  function showToast(title, sub) {
    if (state.undo) return;
    clearTimeout(infoTimer);
    renderToasts({ title: title, sub: sub });
    infoTimer = setTimeout(function () { renderToasts(); }, 2600);
  }

  // ---------- Tabs ----------
  function setTab(tab) {
    state.tab = tab;
    $$('[data-tab-panel]').forEach(function (p) { p.hidden = p.getAttribute('data-tab-panel') !== tab; });
    $$('.nav-item').forEach(function (b) {
      if (b.getAttribute('data-tab') === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    try { history.replaceState(null, '', '?tab=' + tab); } catch (e) { /* file:// or sandboxed */ }
    renderCharts();
  }

  // ---------- Events ----------
  function onClick(e) {
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var a = el.getAttribute('data-action');
    switch (a) {
      case 'overlay':
        if (e.target === el) closeModal();
        return;
      case 'close-modal': closeModal(); break;
      case 'toggle-theme': setDarkMode(!state.darkMode); break;
      case 'open-settings': openModal('settings'); break;
      case 'open-bedtime': openModal('bedtime'); break;
      case 'open-about': openModal('about'); break;
      case 'open-add': openModal('add'); break;
      case 'save-settings': saveSettings(); break;
      case 'set-bedtime': updateSettings({ sleepTime: el.getAttribute('data-time') }); break;
      case 'set-tab':
        e.preventDefault();
        setTab(el.getAttribute('data-tab'));
        window.scrollTo(0, 0);
        break;
      case 'set-range':
        state.range = el.getAttribute('data-range');
        renderRanges(); renderHistory(); renderCharts();
        break;
      case 'view-all':
        state.range = 'all';
        renderRanges(); renderHistory(); renderCharts();
        break;
      case 'delete-intake': removeIntake(el.getAttribute('data-id')); break;
      case 'undo':
        if (state.undo) {
          clearTimeout(state.undo.timer);
          var it = state.undo.intake;
          state.undo = null;
          renderToasts();
          restoreIntake(it);
        }
        break;
      case 'dismiss-undo':
        if (state.undo) clearTimeout(state.undo.timer);
        state.undo = null;
        renderToasts();
        break;
      case 'first-drink':
        if (isDesktop()) $('[data-search]', addPanel).focus();
        else openModal('add');
        break;
      case 'time-mode':
        state.add.mode = el.getAttribute('data-mode');
        if (state.add.mode === 'specific' && !state.add.exactTouched) {
          var now = new Date();
          state.add.date = localDateStr(now);
          state.add.time = localTimeStr(now);
        }
        renderTimeOptions();
        break;
      case 'quick-day':
        state.add.date = daysAgoStr(+el.getAttribute('data-days'));
        state.add.exactTouched = true;
        renderTimeOptions();
        break;
      case 'select-drink': selectDrink(el.getAttribute('data-id')); break;
      case 'set-lastcall': updateSettings({ lastCallDrinkId: el.getAttribute('data-id') }); break;
      case 'clear-selection':
        state.add.selectedId = null;
        renderDrinkList();
        break;
      case 'portion':
        state.add.portion = +el.getAttribute('data-value');
        updatePortionLabel();
        break;
      case 'add-selected': addSelected(); break;
      case 'clear-search': clearSearch(); break;
      case 'toggle-custom':
        state.add.customOpen = true;
        $('.custom-card', addPanel).classList.remove('collapsed');
        el.hidden = true;
        $('#custom-name').focus();
        break;
      case 'export': exportData(); break;
      case 'import': $('#importFile').click(); break;
      case 'clear-data':
        if (confirm('Delete all logged drinks from this browser? This cannot be undone.')) {
          state.intakes = []; state.recent = [];
          persistIntakes(); S.saveRecent([]);
          renderData(); renderDrinkList();
          showToast('All intake data cleared');
        }
        break;
    }
  }

  function onKeydown(e) {
    if (e.key === 'Escape' && state.modals.length) {
      e.preventDefault();
      closeModal();
    } else if (e.key === 'Tab' && state.modals.length) {
      // Keep focus inside the top modal.
      var top = $('#modalRoot .modal-overlay:last-child .modal');
      if (!top) return;
      var f = $$('button, input, select, a[href], [tabindex]:not([tabindex="-1"])', top).filter(function (x) { return !x.disabled && x.offsetParent !== null; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  function bindGlobal() {
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKeydown);

    document.addEventListener('input', function (e) {
      if (e.target.matches('[data-limit-input]')) {
        var v = Number(e.target.value);
        if (v >= 1 && v <= 2000) updateSettings({ caffeineLimit: Math.round(v) });
      }
    });
    document.addEventListener('focusout', function (e) {
      if (e.target.matches && e.target.matches('[data-limit-input]')) e.target.value = state.settings.caffeineLimit;
    });

    $('#importFile').addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var added = importData(JSON.parse(reader.result));
          if (state.settingsDraft) state.settingsDraft = Object.assign({}, state.settings);
          renderModals(); renderData(); renderDrinkList();
          showToast('Import complete', added + ' new entries added');
        } catch (err) {
          alert('Could not import that file: ' + err.message);
        }
        e.target.value = '';
      };
      reader.readAsText(file);
    });

    var resizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        if (isDesktop() && topModal() === 'add') closeModal();
        renderCharts();
      }, 120);
    });

    document.addEventListener('visibilitychange', function () { if (!document.hidden) renderData(); });

    // Keep in sync with other tabs of the app.
    window.addEventListener('storage', function (e) {
      if (!e.key || Object.keys(S.KEYS).some(function (k) { return S.KEYS[k] === e.key; })) {
        var fresh = S.load();
        state.intakes = fresh.intakes; state.settings = fresh.settings;
        state.recent = fresh.recent; state.darkMode = fresh.darkMode;
        sortIntakes(); applyTheme(); renderData(); renderDrinkList();
      }
    });

    setInterval(renderData, 30 * 1000);
  }

  function crash(err) {
    if (window.console) console.error(err);
    $('#crash').hidden = false;
  }

  // ---------- Init ----------
  function init() {
    $$('[data-icon]').forEach(function (el) {
      el.innerHTML = icon(el.getAttribute('data-icon'), +el.getAttribute('data-size') || 18);
    });
    applyTheme();
    setupChartCards();
    buildAddPanel();
    bindGlobal();
    setTab(state.tab);
    renderData();
  }

  window.addEventListener('error', function (e) {
    if (e.filename && /\/js\/[a-z]+\.js/.test(e.filename)) crash(e.error || e.message);
  });

  try { init(); } catch (err) { crash(err); }
})();
