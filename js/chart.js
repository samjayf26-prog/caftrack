/* Caffeine level chart: SVG area line with limit / sleep-target / bedtime markers and a hover tooltip. */
(function () {
  'use strict';

  var M = CT.model;
  var uid = 0;

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function timeLabel(t) {
    return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  function dateLabel(t) {
    return new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  // Tick marks aligned to whole hours (short spans) or local midnights (long spans).
  function xTicks(start, end, width) {
    var span = end - start;
    var maxTicks = Math.max(3, Math.floor(width / 72));
    var ticks = [];
    if (span <= 3 * M.DAY) {
      var hourSteps = [1, 2, 3, 4, 6, 8, 12, 24];
      var sh = hourSteps[hourSteps.length - 1];
      for (var i = 0; i < hourSteps.length; i++) {
        if (span / (hourSteps[i] * M.HOUR) <= maxTicks) { sh = hourSteps[i]; break; }
      }
      var d = new Date(start);
      d.setMinutes(0, 0, 0);
      d.setHours(Math.ceil((d.getHours() + (d.getTime() < start ? 1 : 0)) / sh) * sh);
      for (var t = d.getTime(); t <= end; ) {
        var dt = new Date(t);
        ticks.push({ t: t, label: dt.getHours() === 0 ? dateLabel(t) : timeLabel(t) });
        dt.setHours(dt.getHours() + sh);
        t = dt.getTime();
      }
    } else {
      var daySteps = [1, 2, 7, 14, 30, 60, 90, 180, 365];
      var sd = daySteps[daySteps.length - 1];
      for (var j = 0; j < daySteps.length; j++) {
        if (span / (daySteps[j] * M.DAY) <= maxTicks) { sd = daySteps[j]; break; }
      }
      var d2 = new Date(start);
      d2.setHours(0, 0, 0, 0);
      if (d2.getTime() < start) d2.setDate(d2.getDate() + 1);
      for (; d2.getTime() <= end; d2.setDate(d2.getDate() + sd)) ticks.push({ t: d2.getTime(), label: dateLabel(d2.getTime()) });
    }
    return ticks;
  }

  function yTicks(yMax) {
    var steps = [10, 20, 25, 50, 100, 200, 250, 500];
    var s = steps[steps.length - 1];
    for (var i = 0; i < steps.length; i++) if (yMax / steps[i] <= 5) { s = steps[i]; break; }
    var out = [];
    for (var v = 0; v <= yMax; v += s) out.push(v);
    return out;
  }

  function nearest(points, t) {
    var lo = 0, hi = points.length - 1;
    while (hi - lo > 1) {
      var mid = (lo + hi) >> 1;
      if (points[mid].t < t) lo = mid; else hi = mid;
    }
    return Math.abs(points[lo].t - t) <= Math.abs(points[hi].t - t) ? points[lo] : points[hi];
  }

  function render(el, opts) {
    var width = el.clientWidth;
    if (!width) return;
    var height = opts.height || 300;
    var pad = { l: 40, r: 14, t: 12, b: 30 };
    var s = opts.series, pts = s.points;
    var yMax = M.yMaxFor(opts.limit, s.peak);
    var iw = width - pad.l - pad.r, ih = height - pad.t - pad.b;
    function X(t) { return pad.l + (t - s.start) / (s.end - s.start) * iw; }
    function Y(v) { return pad.t + ih - Math.min(v, yMax) / yMax * ih; }

    var id = 'g' + (++uid);
    var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + X(p.t).toFixed(1) + ' ' + Y(p.level).toFixed(1); }).join('');
    var area = line + 'L' + X(pts[pts.length - 1].t).toFixed(1) + ' ' + Y(0) + 'L' + X(pts[0].t).toFixed(1) + ' ' + Y(0) + 'Z';

    var svg = '<svg class="chart-svg" width="' + width + '" height="' + height + '" role="img" aria-label="Caffeine level over time">';
    svg += '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="var(--chart-line)" stop-opacity="0.28"/>' +
      '<stop offset="100%" stop-color="var(--chart-line)" stop-opacity="0.02"/></linearGradient></defs>';

    yTicks(yMax).forEach(function (v) {
      svg += '<line x1="' + pad.l + '" x2="' + (width - pad.r) + '" y1="' + Y(v) + '" y2="' + Y(v) + '" class="chart-grid"/>';
      svg += '<text x="' + (pad.l - 8) + '" y="' + (Y(v) + 3.5) + '" text-anchor="end" class="chart-tick">' + v + '</text>';
    });
    xTicks(s.start, s.end, iw).forEach(function (tk) {
      var x = X(tk.t);
      if (x < pad.l - 1 || x > width - pad.r + 1) return;
      svg += '<text x="' + x + '" y="' + (height - 10) + '" text-anchor="middle" class="chart-tick">' + esc(tk.label) + '</text>';
    });

    svg += '<path d="' + area + '" fill="url(#' + id + ')"/>';
    svg += '<path d="' + line + '" class="chart-line"/>';

    if (opts.limit > 0 && opts.limit <= yMax) {
      svg += '<line x1="' + pad.l + '" x2="' + (width - pad.r) + '" y1="' + Y(opts.limit) + '" y2="' + Y(opts.limit) + '" class="chart-ref chart-ref-limit"/>';
    }
    if (opts.target >= 0) {
      svg += '<line x1="' + pad.l + '" x2="' + (width - pad.r) + '" y1="' + Y(opts.target) + '" y2="' + Y(opts.target) + '" class="chart-ref chart-ref-target"/>';
    }
    if (opts.showBedtime && opts.bedtime >= s.start && opts.bedtime <= s.end) {
      var bx = X(opts.bedtime);
      svg += '<line x1="' + bx + '" x2="' + bx + '" y1="' + pad.t + '" y2="' + (pad.t + ih) + '" class="chart-ref chart-ref-bed"/>';
    }
    if (opts.lastCall != null && opts.lastCall >= s.start && opts.lastCall <= s.end) {
      var lx = X(opts.lastCall);
      svg += '<line x1="' + lx + '" x2="' + lx + '" y1="' + pad.t + '" y2="' + (pad.t + ih) + '" class="chart-ref chart-ref-lastcall"/>';
      svg += '<text x="' + (lx + 4) + '" y="' + (pad.t + 10) + '" class="chart-lastcall-label">Last call</text>';
    }
    svg += '<g class="chart-hover" style="display:none"><line class="chart-hover-line" y1="' + pad.t + '" y2="' + (pad.t + ih) + '"/>' +
      '<circle class="chart-hover-dot" r="4.5"/></g>';
    svg += '<rect class="chart-hit" x="' + pad.l + '" y="' + pad.t + '" width="' + iw + '" height="' + ih + '" fill="transparent"/>';
    svg += '</svg>';

    el.innerHTML = svg + '<div class="chart-tooltip" role="status" hidden></div>';

    var hit = el.querySelector('.chart-hit');
    var hover = el.querySelector('.chart-hover');
    var hline = el.querySelector('.chart-hover-line');
    var dot = el.querySelector('.chart-hover-dot');
    var tip = el.querySelector('.chart-tooltip');

    function show(ev) {
      var rect = el.getBoundingClientRect();
      var px = ev.clientX - rect.left;
      var t = s.start + (px - pad.l) / iw * (s.end - s.start);
      var p = nearest(pts, t);
      var x = X(p.t), y = Y(p.level);
      hover.style.display = '';
      hline.setAttribute('x1', x); hline.setAttribute('x2', x);
      dot.setAttribute('cx', x); dot.setAttribute('cy', y);
      var st = M.status(p.level, opts.limit);
      var tol = Math.max(s.step / 2, M.MINUTE);
      var detected = s.intakeTimes.some(function (ti) { return Math.abs(ti - p.t) <= tol; });
      var when = new Date(p.t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      tip.innerHTML =
        '<p class="tip-when">' + esc(when) + '</p>' +
        '<div class="tip-row">' + CT.icon('coffee', 14, 'tip-icon') + '<span class="tip-mg">' + Math.round(p.level) + ' mg</span>' +
        '<span class="pill pill-sm pill-' + st.key + '">' + st.label + '</span></div>' +
        (detected ? '<div class="tip-detected">☕ Intake detected</div>' : '') +
        '<div class="tip-pct">' + Math.round(p.level / (opts.limit || 1) * 100) + '% of daily limit</div>';
      tip.hidden = false;
      var tw = tip.offsetWidth, th = tip.offsetHeight;
      var left = x + 14;
      if (left + tw > width) left = x - tw - 14;
      var top = Math.max(0, Math.min(y - th / 2, height - th));
      tip.style.left = Math.max(0, left) + 'px';
      tip.style.top = top + 'px';
    }
    function hide() { hover.style.display = 'none'; tip.hidden = true; }
    hit.addEventListener('pointermove', show);
    hit.addEventListener('pointerdown', show);
    hit.addEventListener('pointerleave', hide);
  }

  window.CT = window.CT || {};
  window.CT.chart = { render: render };
})();
