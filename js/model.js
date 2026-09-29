/* Caffeine model: half-life decay, projections, status and chart sampling. */
(function () {
  'use strict';

  var MINUTE = 60 * 1000;
  var HOUR = 60 * MINUTE;
  var DAY = 24 * HOUR;

  var HALF_LIVES = { fast: 4, average: 5.5, slow: 7.5 };

  // Paraxanthine (caffeine's main metabolite) blocks adenosine receptors about as strongly as
  // caffeine but clears faster: 3.1 h vs 4.1 h half-life measured in the same subjects
  // (Lelo et al., 1986). Both go through CYP1A2, so personal factors scale them together.
  var SUBSTANCES = {
    caffeine: { label: 'Caffeine', short: '', halfLifeRatio: 1 },
    paraxanthine: { label: 'Paraxanthine', short: 'PX', halfLifeRatio: 3.1 / 4.1 }
  };

  function substanceMeta(s) { return SUBSTANCES[s] || SUBSTANCES.caffeine; }

  var DEFAULT_SETTINGS = {
    metabolismRate: 'average',
    caffeineLimit: 200,
    sleepTime: '22:00',
    targetSleepCaffeine: 30,
    pregnancyAdjustment: false,
    smokerAdjustment: false,
    oralContraceptivesAdjustment: false,
    updatedAt: 0
  };

  var RANGES = [
    { value: '24h', label: '24h', durationMs: DAY },
    { value: '3d', label: '3 Days', durationMs: 3 * DAY },
    { value: 'week', label: 'Week', durationMs: 7 * DAY },
    { value: 'all', label: 'All', durationMs: null }
  ];

  var CATEGORIES = {
    coffee: { label: 'Coffee', icon: 'coffee', tone: 'amber' },
    tea: { label: 'Tea', icon: 'leaf', tone: 'emerald' },
    energy: { label: 'Energy', icon: 'zap', tone: 'sky' },
    soda: { label: 'Soda', icon: 'cupSoda', tone: 'rose' },
    other: { label: 'Other', icon: 'cookie', tone: 'slate' }
  };

  function categoryMeta(c) { return CATEGORIES[c] || CATEGORIES.other; }

  function findRange(value) {
    for (var i = 0; i < RANGES.length; i++) if (RANGES[i].value === value) return RANGES[i];
    return RANGES[0];
  }

  // Half-life in hours after special-condition multipliers (they stack).
  function halfLifeHours(s) {
    var h = HALF_LIVES[s && s.metabolismRate] || HALF_LIVES.average;
    if (s && s.pregnancyAdjustment) h *= 1.5;
    if (s && s.smokerAdjustment) h *= 0.7;
    if (s && s.oralContraceptivesAdjustment) h *= 1.3;
    return h;
  }

  function decayConstant(s) { return Math.LN2 / (halfLifeHours(s) * HOUR); }

  // Instant absorption, exponential elimination. k is caffeine's rate; other substances
  // decay at k divided by their half-life ratio. Returns the combined stimulant load (mg).
  function levelAt(intakes, t, k) {
    var sum = 0;
    for (var i = 0; i < intakes.length; i++) {
      var ti = Date.parse(intakes[i].timestamp);
      var amt = Number(intakes[i].amount);
      if (!isFinite(ti) || !isFinite(amt)) continue;
      var dt = t - ti;
      if (dt >= 0) sum += amt * Math.exp(-k / substanceMeta(intakes[i].substance).halfLifeRatio * dt);
    }
    return sum;
  }

  function currentLevel(intakes, s, now) {
    return Math.round(levelAt(intakes, now || Date.now(), decayConstant(s)));
  }

  function parseTime(hhmm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
    if (!m) return [22, 0];
    var h = Math.min(23, Math.max(0, +m[1])), mi = Math.min(59, Math.max(0, +m[2]));
    return [h, mi];
  }

  // Next occurrence of the bedtime; rolls to tomorrow once it has passed.
  function nextBedtime(sleepTime, now) {
    var t = parseTime(sleepTime);
    var d = new Date(now || Date.now());
    d.setHours(t[0], t[1], 0, 0);
    if (d.getTime() <= (now || Date.now())) d.setDate(d.getDate() + 1);
    return d;
  }

  function levelAtBedtime(intakes, s, now) {
    var bed = nextBedtime(s.sleepTime, now);
    return Math.round(levelAt(intakes, bed.getTime(), decayConstant(s)));
  }

  function status(level, limit) {
    var pct = level / (limit > 0 ? limit : 1) * 100;
    if (pct < 50) return { key: 'low', label: 'Low', icon: 'check' };
    if (pct < 80) return { key: 'moderate', label: 'Moderate', icon: 'alertCircle' };
    return { key: 'high', label: 'High', icon: 'alertTriangle' };
  }

  function formatDuration(ms) {
    var totalMin = Math.max(0, Math.round(ms / MINUTE));
    var h = Math.floor(totalMin / 60), m = totalMin % 60;
    if (h === 0) return m + ' min';
    return h + ' hr ' + m + ' min';
  }

  function formatClock(hhmm) {
    var t = parseTime(hhmm);
    var h12 = t[0] % 12 === 0 ? 12 : t[0] % 12;
    return h12 + ':' + String(t[1]).padStart(2, '0') + ' ' + (t[0] < 12 ? 'AM' : 'PM');
  }

  function stepFor(span) {
    if (span <= 36 * HOUR) return 15 * MINUTE;
    if (span <= 3 * DAY) return 30 * MINUTE;
    if (span <= 7 * DAY) return HOUR;
    if (span <= 30 * DAY) return 2 * HOUR;
    return 4 * HOUR;
  }

  // Sampled curve for the chart. Window: 12 h back (or first intake) to 24 h ahead,
  // clipped to the selected range.
  function chartSeries(intakes, s, rangeValue, now) {
    now = now || Date.now();
    var k = decayConstant(s);
    var times = intakes.map(function (i) { return Date.parse(i.timestamp); })
      .filter(isFinite).sort(function (a, b) { return a - b; });
    var start = now - 12 * HOUR;
    if (times.length && times[0] < start) start = times[0];
    var range = findRange(rangeValue);
    if (range.durationMs) start = Math.max(start, now - range.durationMs);
    var end = now + DAY;
    var step = stepFor(end - start);

    var set = {};
    set[start] = 1; set[end] = 1; set[now] = 1;
    for (var t = Math.ceil(start / step) * step; t < end; t += step) set[t] = 1;
    times.forEach(function (ti) {
      if (ti >= start && ti <= end) { set[ti] = 1; if (ti - 1 >= start) set[ti - 1] = 1; }
    });
    var pts = Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
    var peak = 0;
    var points = pts.map(function (tt) {
      var lvl = levelAt(intakes, tt, k);
      if (lvl > peak) peak = lvl;
      return { t: tt, level: lvl };
    });
    return { points: points, start: start, end: end, now: now, peak: peak, intakeTimes: times, step: step };
  }

  function yMaxFor(limit, peak) {
    var m = Math.max(1.1 * (limit || 0), 1.1 * (peak || 0), 120);
    return 25 * Math.ceil(m / 25);
  }

  function filterByRange(intakes, rangeValue, now) {
    var r = findRange(rangeValue);
    var list = intakes.slice();
    if (r.durationMs) {
      var from = (now || Date.now()) - r.durationMs;
      list = list.filter(function (i) { return Date.parse(i.timestamp) >= from; });
    }
    return list.sort(function (a, b) { return Date.parse(b.timestamp) - Date.parse(a.timestamp); });
  }

  window.CT = window.CT || {};
  window.CT.model = {
    MINUTE: MINUTE, HOUR: HOUR, DAY: DAY,
    HALF_LIVES: HALF_LIVES,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    RANGES: RANGES,
    CATEGORIES: CATEGORIES,
    categoryMeta: categoryMeta,
    SUBSTANCES: SUBSTANCES,
    substanceMeta: substanceMeta,
    findRange: findRange,
    halfLifeHours: halfLifeHours,
    decayConstant: decayConstant,
    levelAt: levelAt,
    currentLevel: currentLevel,
    parseTime: parseTime,
    nextBedtime: nextBedtime,
    levelAtBedtime: levelAtBedtime,
    status: status,
    formatDuration: formatDuration,
    formatClock: formatClock,
    chartSeries: chartSeries,
    yMaxFor: yMaxFor,
    filterByRange: filterByRange
  };
})();
