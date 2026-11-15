/* AstroCare — app logic.
   Thresholds and advice are loaded from data/thresholds.json and data/advice.json;
   readings are simulated. All colours are read from the CSS variables in css/style.css. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var rootStyle = getComputedStyle(document.documentElement);
  function cssVar(name) { return rootStyle.getPropertyValue(name).trim(); }
  function rgba(name, a) { return 'rgba(' + cssVar(name) + ',' + a + ')'; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ================= display info for each metric key in thresholds.json ================= */
  var META = {
    mental_health:       { order: 1, side: 'L', organ: 'brain',  name: 'Brain',      metric: 'Mental health score', unit: '/5',  dec: 1, base: 4.1,  wmin: 2.8,  wmax: 5,     step: 0.08, min: 1,    max: 5 },
    blood_oxygen_spo2:   { order: 2, side: 'L', organ: 'lungs',  name: 'Lungs',      metric: 'Blood oxygen (SpO₂)', unit: '%',   dec: 0, base: 98.4, wmin: 94.5, wmax: 99.8,  step: 0.3,  min: 85,   max: 100 },
    body_temp:           { order: 3, side: 'L', organ: 'core',   name: 'Core',       metric: 'Body temperature',    unit: '°C',  dec: 1, base: 36.9, wmin: 36.5, wmax: 37.7,  step: 0.05, min: 35.5, max: 39.5 },
    exercise_compliance: { order: 4, side: 'L', organ: 'muscle', name: 'Muscles',    metric: 'Exercise compliance', unit: '%',   dec: 0, base: 91,   wmin: 70,   wmax: 100,   step: 1.2,  min: 40,   max: 100 },
    sleep_hours:         { order: 5, side: 'R', organ: 'eyes',   name: 'Sleep',      metric: 'Sleep (last cycle)',  unit: 'h',   dec: 1, base: 6.8,  wmin: 5.2,  wmax: 8.4,   step: 0.12, min: 3,    max: 10 },
    resting_hr:          { order: 6, side: 'R', organ: 'heart',  name: 'Heart',      metric: 'Resting heart rate',  unit: 'bpm', dec: 0, base: 74,   wmin: 62,   wmax: 90,    step: 1.4,  min: 40,   max: 130 },
    dose_cum:            { order: 7, side: 'R', organ: 'shell',  name: 'Whole body', metric: 'Cumulative radiation dose', unit: 'mSv', dec: 1, base: 97, wmin: 0, wmax: 300, step: 0.15, min: 0, max: 280, bars: true, cumulative: true }
  };
  var LEVEL_LABEL = { normal: 'Normal', border: 'Borderline', yellow: 'Warning', red: 'Critical' };

  var TH = {}, ADV = {}, PARTS = [], byId = {}, cur = {}, hist = {}, HN = 288;

  /* ================= loading the data files ================= */
  function fetchJSON(u) {
    return fetch(u, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(u + ' → HTTP ' + r.status);
      return r.json();
    });
  }
  function loadFromFiles() {
    return Promise.all([fetchJSON('data/thresholds.json'), fetchJSON('data/advice.json')])
      .then(function (r) { return { t: r[0], a: r[1], src: 'files' }; });
  }
  function validate(t, a) {
    if (!t || typeof t !== 'object' || !Object.keys(t).length) throw new Error('thresholds.json is empty or invalid');
    Object.keys(t).forEach(function (k) {
      var x = t[k];
      if (!x || (x.dir !== 'high' && x.dir !== 'low') || isNaN(+x.warn) || isNaN(+x.danger)) throw new Error('thresholds.json: "' + k + '" needs dir (high/low), warn and danger');
    });
    if (!a || typeof a !== 'object') throw new Error('advice.json is invalid');
  }
  function readPicked(files) {
    return Promise.all(Array.prototype.map.call(files, function (f) {
      return f.text().then(function (s) { return JSON.parse(s); });
    })).then(function (objs) {
      var t = null, a = null;
      objs.forEach(function (o) {
        var first = o[Object.keys(o)[0]] || {};
        if ('dir' in first || 'warn' in first) t = o; else if ('green' in first || 'red' in first) a = o;
      });
      if (!t || !a) throw new Error('Please select both thresholds.json and advice.json.');
      validate(t, a);
      try { localStorage.setItem('astrocare-data', JSON.stringify({ t: t, a: a })); } catch (e) { /* storage full / disabled */ }
      return { t: t, a: a, src: 'picked' };
    });
  }
  function askForFiles() {
    $('ld-spin').hidden = true;
    $('ld-msg').hidden = true;
    $('ld-pick').hidden = false;
    return new Promise(function (resolve) {
      $('ld-file').addEventListener('change', function onPick(e) {
        readPicked(e.target.files).then(function (d) {
          $('ld-file').removeEventListener('change', onPick);
          resolve(d);
        }).catch(function (err) {
          $('ld-msg').hidden = false; $('ld-msg').className = 'err'; $('ld-msg').textContent = err.message;
        });
        e.target.value = '';
      });
    });
  }
  function loadData() {
    return loadFromFiles().catch(function (err) {
      console.warn('AstroCare: could not fetch data files —', err.message);
      var cached = null;
      try { cached = JSON.parse(localStorage.getItem('astrocare-data')); } catch (e) { cached = null; }
      if (cached && cached.t && cached.a) return { t: cached.t, a: cached.a, src: 'cache' };
      return askForFiles();
    });
  }

  loadData().then(function (d) {
    try { validate(d.t, d.a); } catch (e) {
      $('ld-spin').hidden = true; $('ld-msg').className = 'err'; $('ld-msg').textContent = e.message; return;
    }
    start(d);
    $('loader').hidden = true;
  });

  /* ================= metric helpers ================= */
  function titleCase(k) { return k.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }); }
  function parseNormal(t) {
    var m = /(<=|>=|<|>|=)?\s*(-?\d+(?:\.\d+)?)/.exec(String(t.normal == null ? '' : t.normal));
    if (!m) return { op: t.dir === 'high' ? '<' : '>', v: +t.warn };
    return { op: m[1] || (t.dir === 'high' ? '<=' : '>='), v: parseFloat(m[2]) };
  }
  function cmp(v, op, x) {
    if (op === '<') return v < x; if (op === '<=') return v <= x;
    if (op === '>') return v > x; if (op === '>=') return v >= x; return v === x;
  }
  function buildPart(key, idx) {
    var t = TH[key], m = META[key], nrm = parseNormal(t);
    if (!m) {
      var lo = Math.min(nrm.v, +t.warn, +t.danger), hi = Math.max(nrm.v, +t.warn, +t.danger), span = (hi - lo) || 1;
      var base = t.dir === 'high' ? nrm.v - span * 0.2 : nrm.v + span * 0.2;
      m = { order: 100 + idx, side: idx % 2 ? 'R' : 'L', organ: 'shell', name: titleCase(key), metric: titleCase(key), unit: '', dec: 1,
        base: base, wmin: lo - span * 0.3, wmax: hi, step: span * 0.02, min: lo - span * 0.5, max: hi + span * 0.3 };
    }
    var p = {}; Object.keys(m).forEach(function (k) { p[k] = m[k]; });
    p.id = key; p.t = t; p.normal = nrm;
    return p;
  }
  function shown(p) { return +cur[p.id].toFixed(p.dec); }
  function zoneOf(p, v) {
    var t = p.t;
    if (v == null) v = shown(p);
    if (t.dir === 'high') { if (v >= t.danger) return 'red'; if (v >= t.warn) return 'yellow'; }
    else { if (v <= t.danger) return 'red'; if (v <= t.warn) return 'yellow'; }
    return cmp(v, p.normal.op, p.normal.v) ? 'normal' : 'border';
  }
  function levelOf(p) { var z = zoneOf(p); return z === 'normal' || z === 'border' ? 'green' : z; }
  function adviceOf(p, lvl) { return (ADV[p.id] && ADV[p.id][lvl || levelOf(p)]) || 'No advice defined in advice.json for this level.'; }
  function adviceHTML(s) { return esc(s).replace(/^(Optimal|Warning|Critical):/, '<b>$1:</b>').replace(/Action:/, '<b>Action:</b>'); }
  function fmtNormal(p) { return String(p.t.normal).trim() + ' ' + p.unit; }
  function fmtWarn(p) { return (p.t.dir === 'high' ? '≥ ' : '≤ ') + p.t.warn + ' ' + p.unit; }
  function fmtDanger(p) { return (p.t.dir === 'high' ? '≥ ' : '≤ ') + p.t.danger + ' ' + p.unit; }
  function detHTML(p) {
    var lvl = levelOf(p);
    return '<div class="det"><h4>Thresholds · thresholds.json</h4><div class="thr">' +
      '<div class="g"><span>Normal</span><b>' + esc(fmtNormal(p)) + '</b></div>' +
      '<div class="y"><span>Warning</span><b>' + esc(fmtWarn(p)) + '</b></div>' +
      '<div class="r"><span>Danger</span><b>' + esc(fmtDanger(p)) + '</b></div></div>' +
      '<h4>Advice · advice.json</h4><ul class="adv-l">' +
      ['green', 'yellow', 'red'].map(function (l) {
        return '<li class="' + l + (l === lvl ? ' cur' : '') + '">' + adviceHTML(adviceOf(p, l)) + '</li>';
      }).join('') + '</ul></div>';
  }
  function setStatus(st, p) {
    var z = zoneOf(p), l = levelOf(p);
    st.className = 'st ' + l; st.textContent = LEVEL_LABEL[z];
  }
  function setCardLevel(el, p) {
    var l = levelOf(p);
    el.classList.toggle('lvl-yellow', l === 'yellow');
    el.classList.toggle('lvl-red', l === 'red');
    var det = el.querySelector('[data-det]');
    if (det && det.getAttribute('data-lv') !== l) { det.innerHTML = detHTML(p); det.setAttribute('data-lv', l); }
    var adv = el.querySelector('[data-adv]');
    if (adv && adv.getAttribute('data-lv') !== l) { adv.innerHTML = adviceHTML(adviceOf(p, l)); adv.className = 'adv ' + l; adv.setAttribute('data-lv', l); }
  }

  /* ================= simulation ================= */
  function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function seedStr(s) { var h = 1779033703; for (var i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; } return h >>> 0; }
  function walk(v, lo, hi, s, base) { v += (Math.random() - 0.5) * 2 * s + (base - v) * 0.08; return Math.min(hi, Math.max(lo, v)); }
  function makeHistory(p) {
    var r = mulberry(seedStr(p.id)), v = p.base, a = [], i;
    if (p.cumulative) {
      for (i = 0; i < HN; i++) a.push(p.base - (HN - 1 - i) * 0.03 + (r() - 0.5) * 0.05);
    } else {
      for (i = 0; i < HN; i++) {
        v += (r() - 0.5) * 2 * p.step * 1.7 + (p.base - v) * 0.07;
        v = Math.min(p.wmax, Math.max(p.wmin, v)); a.push(v);
      }
    }
    a[HN - 1] = p.base; return a;
  }
  var scenHist = false; // true while a check-in (scenario days) is shown: ranges mean days, not hours
  function seriesFor(id, range) {
    var a = hist[id];
    if (scenHist) return range === '1h' ? a.slice(-30) : range === '6h' ? a.slice(-90) : a.slice();
    if (range === '1h') return a.slice(-12);
    if (range === '6h') return a.slice(-72);
    var out = []; for (var i = a.length - 1; i >= 0; i -= 3) out.push(a[i]);
    return out.reverse();
  }

  /* ================================================================= */
  function start(data) {
    TH = data.t; ADV = data.a;
    PARTS = Object.keys(TH).map(buildPart).sort(function (a, b) { return a.order - b.order; });
    PARTS.forEach(function (p, i) { p.n = i + 1; byId[p.id] = p; cur[p.id] = p.base; hist[p.id] = makeHistory(p); });
    if (data.src !== 'files') {
      $('src').innerHTML = 'Data: <b>' + (data.src === 'cache' ? 'cached copy' : 'selected files') + '</b> · <a href="#" id="src-re">reload files</a>';
      $('src-re').addEventListener('click', function (e) { e.preventDefault(); $('ld-file').click(); });
      $('ld-file').addEventListener('change', function (e) {
        readPicked(e.target.files).then(function (d) { applyData(d.t, d.a); }).catch(function (err) { alert(err.message); });
        e.target.value = '';
      });
    }

    var sel = null, pendingScroll = false, range = '24h';
    var hrP = byId.resting_hr, o2P = byId.blood_oxygen_spo2, tcP = byId.body_temp;

    /* ---------------- card zoom (every .card: hover + click to grow / click again to shrink) ---------------- */
    var backdrop = document.createElement('div'); backdrop.className = 'zoom-backdrop';
    var zstage = document.createElement('div'); zstage.className = 'zoom-stage'; zstage.hidden = true;
    document.body.appendChild(backdrop); document.body.appendChild(zstage);
    var zoomed = null, ph = null, busy = false;

    function flip(from, to) {
      return 'translate(' + (from.left - to.left) + 'px,' + (from.top - to.top) + 'px) scale(' + (from.width / to.width) + ',' + (from.height / to.height) + ')';
    }
    function afterTransition(el, fn) {
      var done = false;
      function fin() { if (done) return; done = true; el.removeEventListener('transitionend', onEnd); fn(); }
      function onEnd(e) { if (e.target === el && e.propertyName === 'transform') fin(); }
      el.addEventListener('transitionend', onEnd);
      setTimeout(fin, reduce ? 0 : 520);
    }
    function targetWidth(card, r) {
      var w = Math.max(r.width * 1.9, 460);
      if (card.classList.contains('p')) w = Math.max(w, 600);
      if (card.classList.contains('cc') || card.classList.contains('box') || card.classList.contains('pc') || card.querySelector('[data-xc]')) w = Math.max(w, 720);
      if (card.classList.contains('pm')) w = Math.max(w, 780);
      return Math.min(w, window.innerWidth * 0.94, 900);
    }
    function zoomIn(card) {
      if (busy) return;
      if (zoomed) { zoomOut(function () { if (zoomed !== card) zoomIn(card); }); return; }
      busy = true;
      var r = (card.__from || card).getBoundingClientRect();
      if (card.__from) ph = null;
      else {
        ph = document.createElement('div');
        ph.className = card.className + ' card-ph';
        ph.style.width = r.width + 'px'; ph.style.height = r.height + 'px';
        card.parentNode.replaceChild(ph, card);
      }
      zstage.style.width = targetWidth(card, r) + 'px';
      zstage.hidden = false;
      zstage.appendChild(card);
      card.classList.add('is-expanded');
      zoomed = card;
      onZoomChange(card);
      var r2 = card.getBoundingClientRect();
      card.style.transform = flip(r, r2);
      void card.offsetWidth;
      card.classList.add('is-animating');
      card.style.transform = '';
      backdrop.classList.add('on');
      afterTransition(card, function () { card.classList.remove('is-animating'); busy = false; card.focus({ preventScroll: true }); });
    }
    function zoomOut(cb) {
      if (!zoomed || busy) return;
      busy = true;
      var card = zoomed, r = (card.__from || ph).getBoundingClientRect(), r2 = card.getBoundingClientRect();
      card.classList.add('is-animating');
      card.style.transform = flip(r, r2);
      backdrop.classList.remove('on');
      afterTransition(card, function () {
        card.style.transition = 'none';
        card.classList.remove('is-animating', 'is-expanded');
        card.style.transform = '';
        if (card.__from) card.remove(); else ph.parentNode.replaceChild(card, ph);
        void card.offsetWidth;
        card.style.transition = '';
        ph = null; zoomed = null; zstage.hidden = true; busy = false;
        onZoomChange(card);
        if (cb) cb();
      });
    }
    function toggleZoom(card) { if (zoomed === card) zoomOut(); else zoomIn(card); }
    function onZoomChange(card) {
      var cc = card.getAttribute('data-cc');
      if (cc) card.querySelector('.cc-plot').innerHTML = chartSVG(byId[cc], seriesFor(cc, range));
      if (card.classList.contains('is-expanded')) fillXChart(card);
    }

    /* expanded chart (measurements + stats) for every card tied to a metric */
    var xRange = '6h';
    function statsOf(a) {
      var mn = Infinity, mx = -Infinity, sum = 0;
      a.forEach(function (v) { if (v < mn) mn = v; if (v > mx) mx = v; sum += v; });
      return { mn: mn, mx: mx, avg: sum / a.length };
    }
    function fillXChart(card) {
      var id = card.getAttribute('data-xp') || card.getAttribute('data-link'), p = byId[id], box = card.querySelector('[data-xc]');
      if (!p || !box) return;
      if (!box.firstChild) {
        box.innerHTML = '<div class="xc"><div class="xc-h"><h4>Measurements · ' + esc(p.metric) + '</h4><div class="seg" role="group" aria-label="Time window">' +
          ['1h', '6h', '24h'].map(function (r) { return '<button type="button" data-xr="' + r + '">' + r.replace('h', ' h') + '</button>'; }).join('') +
          '</div></div><div class="xc-plot" data-xplot></div><div class="xc-stats" data-xstats></div></div>';
      }
      var a = seriesFor(id, xRange), st = statsOf(a);
      box.querySelector('[data-xplot]').innerHTML = chartSVG(p, a, { w: 640, h: 230, rg: xRange, uid: '-x' });
      box.querySelector('[data-xstats]').innerHTML = [['Now', cur[id]], ['Min', st.mn], ['Average', st.avg], ['Max', st.mx]].map(function (r) {
        var v = +r[1].toFixed(p.dec), z = zoneOf(p, v);
        return '<div class="' + (z === 'normal' || z === 'border' ? 'green' : z) + '"><span>' + r[0] + '</span><b>' + v.toFixed(p.dec) + ' <small>' + esc(p.unit) + '</small></b><em>' + LEVEL_LABEL[z] + '</em></div>';
      }).join('');
      box.querySelectorAll('[data-xr]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-xr') === xRange ? 'true' : 'false'); });
    }
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-xr]');
      if (!b) return;
      xRange = b.getAttribute('data-xr');
      if (zoomed) fillXChart(zoomed);
    });

    /* part popup: grows out of a 3D tag and shows chart, stats, thresholds and advice */
    function refreshPM(c, p) {
      c.querySelector('[data-v]').textContent = cur[p.id].toFixed(p.dec);
      setStatus(c.querySelector('[data-st]'), p);
      setCardLevel(c, p);
    }
    function openPart(id, fromEl) {
      var p = byId[id];
      if (!p || busy) return;
      if (zoomed) {
        var same = zoomed.getAttribute('data-pm') === id;
        zoomOut(function () { if (!same) openPart(id, fromEl); });
        return;
      }
      select(id);
      var c = document.createElement('article');
      c.className = 'pm card'; c.tabIndex = 0;
      c.setAttribute('data-pm', id); c.setAttribute('data-xp', id);
      c.innerHTML = '<div class="pm-h"><span class="chip">' + p.n + '</span><div><h3>' + esc(p.name) + '</h3><p class="pm-m">' + esc(p.metric) + '</p></div><span class="st" data-st></span></div>' +
        '<div class="pm-now"><b data-v></b><small>' + esc(p.unit) + '</small><p class="adv" data-adv></p></div>' +
        '<div data-xc></div><div data-det></div>';
      c.__from = fromEl;
      refreshPM(c, p);
      zoomIn(c);
    }
    function refreshExpanded() {
      if (!zoomed || busy) return;
      var pm = zoomed.getAttribute('data-pm');
      if (pm) refreshPM(zoomed, byId[pm]);
      if (zoomed.querySelector('[data-xc]')) fillXChart(zoomed);
    }
    document.addEventListener('click', function (e) {
      if (e.target.closest('a, button, input, label, .fig3d')) return;
      var card = e.target.closest('.card');
      if (card && !card.classList.contains('card-ph')) toggleZoom(card);
    });
    backdrop.addEventListener('click', function () { zoomOut(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && zoomed) { zoomOut(); return; }
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('card')) { e.preventDefault(); toggleZoom(e.target); }
    });
    window.addEventListener('hashchange', function () { if (zoomed) zoomOut(); });

    document.querySelectorAll('.hud [data-link]').forEach(function (c) {
      c.querySelector('[data-det]').insertAdjacentHTML('beforebegin', '<div class="x-only" data-xc></div>');
    });

    /* ---------------- dashboard advisories ---------------- */
    $('advgrid').innerHTML = PARTS.map(function (p) {
      return '<article class="ac card" tabindex="0" data-ac="' + p.id + '" data-xp="' + p.id + '">' +
        '<div class="ac-h"><span class="chip">' + p.n + '</span><h3>' + esc(p.metric) + '</h3><span class="st" data-st></span></div>' +
        '<p class="ac-v"><b data-v></b>' + esc(p.unit) + '</p>' +
        '<p class="adv" data-adv></p><div class="x-only" data-xc></div><div class="x-only" data-det></div></article>';
    }).join('');
    function updateAdvisories() {
      PARTS.forEach(function (p) {
        var el = document.querySelector('[data-ac="' + p.id + '"]');
        el.querySelector('[data-v]').textContent = cur[p.id].toFixed(p.dec);
        setStatus(el.querySelector('[data-st]'), p);
        setCardLevel(el, p);
      });
    }

    /* ---------------- body page ---------------- */
    function cardHTML(p) {
      return '<article class="pc card" tabindex="0" data-card="' + p.id + '" data-xp="' + p.id + '">' +
        '<div class="pc-main">' +
        '<div class="pc-top"><span class="chip">' + p.n + '</span><h3>' + esc(p.name) + '</h3><span class="st" data-st></span></div>' +
        '<div class="pc-metric">' + esc(p.metric) + '</div>' +
        '<div class="pc-val"><b data-v>' + cur[p.id].toFixed(p.dec) + '</b><small>' + esc(p.unit) + '</small>' +
        '<svg viewBox="0 0 72 26" preserveAspectRatio="none" aria-hidden="true"><polyline data-sp fill="none" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg></div>' +
        '<p class="adv" data-adv></p><div class="x-only" data-xc></div><div class="x-only" data-det></div></div>' +
        '<a class="pc-link" href="#charts" data-chartlink="' + p.id + '">Open chart →</a></article>';
    }
    $('colL').innerHTML = PARTS.filter(function (p) { return p.side === 'L'; }).map(cardHTML).join('');
    $('colR').innerHTML = PARTS.filter(function (p) { return p.side === 'R'; }).map(cardHTML).join('');

    var body3d = window.Body3D ? window.Body3D.create($('fig3d'), $('hs-layer'), {
      parts: PARTS.map(function (p) { return { id: p.id, n: p.n, organ: p.organ, name: p.name }; }),
      colors: { cyan: cssVar('--cyan'), green: cssVar('--status-green'), yellow: cssVar('--status-yellow'), red: cssVar('--status-red'), white: cssVar('--white'), glow: cssVar('--glow-cyan') },
      reduce: reduce,
      onHover: function (id) { if (id) select(id); },
      onPick: function (id) { openPart(id, tagEl[id]); },
      onFrame: layoutTags
    }) : null;
    if (!body3d || !body3d.ok) {
      $('fig3d').insertAdjacentHTML('beforeend', '<div class="no3d">The 3D body view needs WebGL, which is not available in this browser.</div>');
    }
    $('b3-rot').addEventListener('click', function () {
      var on = this.getAttribute('aria-pressed') !== 'true';
      this.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (body3d && body3d.ok) body3d.setAutoRotate(on);
    });
    $('b3-reset').addEventListener('click', function () { if (body3d && body3d.ok) body3d.reset(); });

    function select(id) {
      sel = id;
      document.querySelectorAll('[data-card]').forEach(function (el) { el.classList.toggle('on', el.getAttribute('data-card') === id); });
      PARTS.forEach(function (p) { tagEl[p.id].classList.toggle('on', p.id === id); tlEl[p.id].classList.toggle('on', p.id === id); });
      if (body3d && body3d.ok) body3d.select(id);
      updateFigRead();
    }
    function updateFigRead() {
      var p = byId[sel];
      $('fig-sel').textContent = p ? p.n + ' · ' + p.name : 'All systems';
      $('fig-read').innerHTML = p ? esc(p.metric) + ': <b>' + cur[p.id].toFixed(p.dec) + ' ' + esc(p.unit) + '</b> · ' + LEVEL_LABEL[zoneOf(p)]
        : PARTS.filter(function (q) { return levelOf(q) === 'green'; }).length + ' / ' + PARTS.length + ' systems in range';
    }
    document.querySelectorAll('[data-card]').forEach(function (el) {
      var id = el.getAttribute('data-card');
      el.addEventListener('mouseenter', function () { select(id); });
      el.addEventListener('focus', function () { select(id); });
    });
    document.querySelectorAll('[data-chartlink]').forEach(function (a) {
      var id = a.getAttribute('data-chartlink');
      a.addEventListener('click', function () { sel = id; pendingScroll = true; });
    });

    /* floating status tags pinned to each part of the 3D body */
    var tagLayer = $('tag-layer'), tagSvg = $('tag-lines'), figBox = { w: 0, h: 0 }, tagSize = {}, tagEl = {}, tlEl = {}, tldEl = {};
    tagLayer.innerHTML = PARTS.map(function (p) {
      return '<button type="button" class="tag green side-' + p.side + '" data-tag="' + p.id + '" aria-label="' + esc(p.name) + ': open chart">' +
        '<span class="tag-h"><i></i>' + esc(p.name) + '</span>' +
        '<span class="tag-v"><b data-tv></b><small>' + esc(p.unit) + '</small></span>' +
        '<span class="tag-s" data-ts></span></button>';
    }).join('');
    tagSvg.innerHTML = PARTS.map(function (p) { return '<path class="tl green" data-tl="' + p.id + '"/><circle class="tl-d green" data-tld="' + p.id + '" r="3.2"/>'; }).join('');
    PARTS.forEach(function (p) {
      var el = tagLayer.querySelector('[data-tag="' + p.id + '"]');
      tagEl[p.id] = el; tlEl[p.id] = tagSvg.querySelector('[data-tl="' + p.id + '"]'); tldEl[p.id] = tagSvg.querySelector('[data-tld="' + p.id + '"]');
      el.addEventListener('mouseenter', function () { select(p.id); if (body3d && body3d.ok) body3d.hold(); });
      el.addEventListener('focus', function () { select(p.id); });
      el.addEventListener('click', function () { openPart(p.id, el); });
    });
    function measureTags() {
      var f = $('fig3d');
      figBox = { w: f.clientWidth, h: f.clientHeight };
      tagSvg.setAttribute('viewBox', '0 0 ' + figBox.w + ' ' + figBox.h);
      PARTS.forEach(function (p) { tagSize[p.id] = { w: tagEl[p.id].offsetWidth, h: tagEl[p.id].offsetHeight }; });
    }
    function layoutTags() {
      if (!body3d || !body3d.ok || $('page-body').hidden) return;
      if (!figBox.w) measureTags();
      var an = body3d.anchors(), pad = figBox.w < 520 ? 8 : 14, top = 64, bottom = figBox.h - 40;
      ['L', 'R'].forEach(function (side) {
        var list = PARTS.filter(function (p) { return p.side === side && an[p.id]; }).map(function (p) {
          var sz = tagSize[p.id];
          return { p: p, a: an[p.id], w: sz.w, h: sz.h, y: an[p.id].y - sz.h / 2 };
        }).sort(function (m, n) { return m.a.y - n.a.y; });
        var i, prev = top, lim = bottom;
        for (i = 0; i < list.length; i++) { list[i].y = Math.max(list[i].y, prev); prev = list[i].y + list[i].h + 8; }
        for (i = list.length - 1; i >= 0; i--) { if (list[i].y + list[i].h > lim) list[i].y = lim - list[i].h; lim = list[i].y - 8; }
        list.forEach(function (t) {
          var id = t.p.id, x = side === 'L' ? pad : figBox.w - pad - t.w;
          var ex = side === 'L' ? x + t.w : x, ey = t.y + t.h / 2, mx = side === 'L' ? ex + 18 : ex - 18;
          tagEl[id].style.transform = 'translate(' + x.toFixed(1) + 'px,' + t.y.toFixed(1) + 'px)';
          tlEl[id].setAttribute('d', 'M' + ex.toFixed(1) + ' ' + ey.toFixed(1) + 'H' + mx.toFixed(1) + 'L' + t.a.x.toFixed(1) + ' ' + t.a.y.toFixed(1));
          tldEl[id].setAttribute('cx', t.a.x.toFixed(1)); tldEl[id].setAttribute('cy', t.a.y.toFixed(1));
          [tagEl[id], tlEl[id], tldEl[id]].forEach(function (el) { el.classList.toggle('back', !t.a.front); });
        });
      });
    }
    function updateTags() {
      PARTS.forEach(function (p) {
        var l = levelOf(p), el = tagEl[p.id];
        el.querySelector('[data-tv]').textContent = cur[p.id].toFixed(p.dec);
        el.querySelector('[data-ts]').textContent = LEVEL_LABEL[zoneOf(p)];
        ['green', 'yellow', 'red'].forEach(function (c) {
          el.classList.toggle(c, c === l); tlEl[p.id].classList.toggle(c, c === l); tldEl[p.id].classList.toggle(c, c === l);
        });
      });
    }
    if (window.ResizeObserver) new ResizeObserver(function () { measureTags(); }).observe($('fig3d'));
    window.addEventListener('resize', measureTags);

    function updateCards() {
      PARTS.forEach(function (p) {
        var el = document.querySelector('[data-card="' + p.id + '"]');
        el.querySelector('[data-v]').textContent = cur[p.id].toFixed(p.dec);
        setStatus(el.querySelector('[data-st]'), p);
        setCardLevel(el, p);
        if (body3d && body3d.ok) body3d.setLevel(p.id, levelOf(p));
        var s = seriesFor(p.id, '6h'), a = [], i;
        for (i = 0; i < s.length; i += 3) a.push(s[i]);
        a.push(s[s.length - 1]);
        var mn = Math.min.apply(null, a), mx = Math.max.apply(null, a), rg = (mx - mn) || 1;
        el.querySelector('[data-sp]').setAttribute('points', a.map(function (v, k) {
          return (2 + 68 * k / (a.length - 1)).toFixed(1) + ',' + (23 - 20 * (v - mn) / rg).toFixed(1);
        }).join(' '));
      });
      if (body3d && body3d.ok && hrP) body3d.setHeartRate(cur[hrP.id]);
      updateTags();
      updateFigRead();
    }

    /* ---------------- charts page ---------------- */
    var LAB = { '1h': ['−60 min', '−30 min', 'now'], '6h': ['−6 h', '−3 h', 'now'], '24h': ['−24 h', '−12 h', 'now'] };
    function down(s, n) {
      if (s.length <= n) return s;
      var out = []; for (var i = 0; i < n; i++) out.push(s[Math.round(i * (s.length - 1) / (n - 1))]);
      return out;
    }
    function zones(p, lo, hi) {
      var t = p.t, nv = p.normal.v, w = +t.warn, d = +t.danger, z = [];
      if (t.dir === 'high') { z.push(['g', lo, nv], ['y', w, d], ['r', d, hi]); }
      else { z.push(['g', nv, hi], ['y', d, w], ['r', lo, d]); }
      return z.map(function (b) { return [b[0], Math.max(lo, Math.min(b[1], b[2])), Math.min(hi, Math.max(b[1], b[2]))]; })
        .filter(function (b) { return b[2] > b[1]; });
    }
    function chartSVG(p, s0, opt) {
      opt = opt || {};
      var gid = 'ga-' + p.id + (opt.uid || '');
      var W = opt.w || 360, H = opt.h || 156, L = 40, R = 10, T = 10, B = 22, pw = W - L - R, ph2 = H - T - B;
      var s = p.bars ? down(s0, 24) : s0, n = s.length;
      var mn = Math.min.apply(null, [p.normal.v, +p.t.warn, +p.t.danger].concat(s)), mx = Math.max.apply(null, [p.normal.v, +p.t.warn, +p.t.danger].concat(s));
      var pad = (mx - mn) * 0.1; mn -= pad; mx += pad;
      if (p.bars || p.min === 0) mn = Math.max(0, Math.min(mn, 0));
      var y = function (v) { return T + ph2 * (1 - (v - mn) / (mx - mn)); };
      var o = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(p.name + ' ' + p.metric) + ' trend">';
      o += '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="areaS-top"/><stop offset="1" class="areaS-bot"/></linearGradient></defs>';
      zones(p, mn, mx).forEach(function (b) {
        o += '<rect class="band-' + b[0] + '" x="' + L + '" y="' + y(b[2]).toFixed(1) + '" width="' + pw + '" height="' + (y(b[1]) - y(b[2])).toFixed(1) + '"/>';
      });
      o += '<line class="thl y" x1="' + L + '" x2="' + (L + pw) + '" y1="' + y(+p.t.warn).toFixed(1) + '" y2="' + y(+p.t.warn).toFixed(1) + '"/>';
      o += '<line class="thl r" x1="' + L + '" x2="' + (L + pw) + '" y1="' + y(+p.t.danger).toFixed(1) + '" y2="' + y(+p.t.danger).toFixed(1) + '"/>';
      [0, 0.5, 1].forEach(function (f) {
        var v = mn + (mx - mn) * f, yy = y(v);
        o += '<line class="gl" x1="' + L + '" x2="' + (L + pw) + '" y1="' + yy.toFixed(1) + '" y2="' + yy.toFixed(1) + '"/>';
        o += '<text class="ax" x="' + (L - 6) + '" y="' + (yy + 3.5).toFixed(1) + '" text-anchor="end">' + v.toFixed(p.dec === 0 && mx - mn > 10 ? 0 : 1) + '</text>';
      });
      var lab = LAB[opt.rg || range];
      o += '<text class="ax" x="' + L + '" y="' + (H - 6) + '" text-anchor="start">' + lab[0] + '</text>';
      o += '<text class="ax" x="' + (L + pw / 2) + '" y="' + (H - 6) + '" text-anchor="middle">' + lab[1] + '</text>';
      o += '<text class="ax" x="' + (L + pw) + '" y="' + (H - 6) + '" text-anchor="end">' + lab[2] + '</text>';
      if (p.bars) {
        var slot = pw / n, bw = slot * 0.68;
        s.forEach(function (v, i) {
          var yy = y(v);
          o += '<rect class="barS" x="' + (L + slot * i + (slot - bw) / 2).toFixed(1) + '" y="' + yy.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(1, T + ph2 - yy).toFixed(1) + '" rx="1.5"/>';
        });
      } else {
        var pts = s.map(function (v, i) { return (L + pw * i / (n - 1)).toFixed(1) + ' ' + y(v).toFixed(1); });
        o += '<path d="M' + pts.join('L') + 'L' + (L + pw) + ' ' + (T + ph2) + 'L' + L + ' ' + (T + ph2) + 'Z" fill="url(#' + gid + ')"/>';
        o += '<path class="lineS" d="M' + pts.join('L') + '"/>';
        var ex = L + pw, ey = y(s[n - 1]);
        o += '<circle class="endH" cx="' + ex + '" cy="' + ey.toFixed(1) + '" r="7"/><circle class="endD" cx="' + ex + '" cy="' + ey.toFixed(1) + '" r="3.6"/>';
      }
      return o + '</svg>';
    }
    function pct(p, v) { return Math.max(0, Math.min(100, (v - p.min) / (p.max - p.min) * 100)); }

    $('cgrid').innerHTML = PARTS.map(function (p) {
      return '<article class="cc card" tabindex="0" data-cc="' + p.id + '">' +
        '<div class="cc-h"><span class="chip">' + p.n + '</span><h3>' + esc(p.name) + '</h3><span class="st" data-st></span></div>' +
        '<p class="cc-m">' + esc(p.metric) + '</p>' +
        '<div class="cc-now"><b data-v>' + cur[p.id].toFixed(p.dec) + '</b>' + esc(p.unit) + '</div>' +
        '<div class="cc-plot"></div>' +
        '<p class="cc-f" data-f></p><p class="adv" data-adv></p><div class="x-only" data-det></div></article>';
    }).join('');
    function renderBullets() {
      $('bullets').innerHTML = PARTS.map(function (p) {
        var bands = zones(p, p.min, p.max).map(function (b) {
          return '<div class="bl-band ' + b[0] + '" style="left:' + pct(p, b[1]).toFixed(1) + '%;width:' + (pct(p, b[2]) - pct(p, b[1])).toFixed(1) + '%"></div>';
        }).join('');
        return '<div class="bl" data-bl="' + p.id + '"><span class="bl-n"><span class="chip">' + p.n + '</span>' + esc(p.name) + '</span>' +
          '<div class="bl-track">' + bands + '<div class="bl-mark" data-mk></div></div>' +
          '<span class="bl-v"><span data-bv></span><small>' + esc(p.unit) + '</small></span></div>';
      }).join('');
    }
    renderBullets();
    $('ringt').textContent = PARTS.length;

    function updateCharts() {
      if ($('page-charts').hidden) return;
      var okCount = 0, bad = [];
      PARTS.forEach(function (p) {
        var el = document.querySelector('[data-cc="' + p.id + '"]'), l = levelOf(p);
        if (l === 'green') okCount++; else bad.push(p);
        el.querySelector('.cc-plot').innerHTML = chartSVG(p, seriesFor(p.id, range));
        el.querySelector('[data-v]').textContent = cur[p.id].toFixed(p.dec);
        el.querySelector('[data-f]').textContent = 'Normal ' + fmtNormal(p) + ' · warning ' + fmtWarn(p) + ' · danger ' + fmtDanger(p);
        setStatus(el.querySelector('[data-st]'), p);
        setCardLevel(el, p);
        var bl = document.querySelector('[data-bl="' + p.id + '"]'), mk = bl.querySelector('[data-mk]');
        mk.style.left = pct(p, cur[p.id]).toFixed(1) + '%'; mk.className = 'bl-mark ' + l;
        bl.querySelector('[data-bv]').textContent = cur[p.id].toFixed(p.dec);
      });
      $('ringn').textContent = okCount;
      var c = 2 * Math.PI * 42;
      $('ringp').setAttribute('stroke-dasharray', (c * okCount / PARTS.length).toFixed(1) + ' ' + c.toFixed(1));
      $('ringp').style.stroke = bad.some(function (p) { return levelOf(p) === 'red'; }) ? 'var(--status-red)' : bad.length ? 'var(--status-yellow)' : '';
      $('ringcap').textContent = okCount === PARTS.length ? 'All systems are inside their normal range.' : bad.length + ' system(s) need attention.';
      var key = bad.map(function (p) { return p.id + levelOf(p); }).join();
      if ($('ring-det').getAttribute('data-k') !== key) {
        $('ring-det').setAttribute('data-k', key);
        $('ring-det').innerHTML = '<h4>Systems needing attention</h4>' + (bad.length ? '<ul class="adv-l">' + bad.map(function (p) {
          return '<li class="cur ' + levelOf(p) + '"><b>' + esc(p.name) + ' — ' + esc(p.metric) + ':</b> ' + adviceHTML(adviceOf(p)) + '</li>';
        }).join('') + '</ul>' : 'None. Every system is in its normal range.');
      }
    }
    document.querySelectorAll('[data-range]').forEach(function (b) {
      b.addEventListener('click', function () {
        range = b.getAttribute('data-range');
        document.querySelectorAll('[data-range]').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        updateCharts();
      });
    });

    /* ---------------- routing ---------------- */
    var PAGES = ['dashboard', 'body', 'checkin', 'charts'];
    function route() {
      var h = (location.hash || '#dashboard').slice(1);
      if (PAGES.indexOf(h) < 0) h = 'dashboard';
      PAGES.forEach(function (p) { $('page-' + p).hidden = p !== h; });
      document.querySelectorAll('[data-nav]').forEach(function (a) {
        if (a.getAttribute('data-nav') === h) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
      });
      if (body3d && body3d.ok) body3d.setActive(h === 'body');
      if (h === 'body') requestAnimationFrame(measureTags);
      if (h === 'charts') {
        updateCharts();
        if (pendingScroll && sel) {
          pendingScroll = false;
          var el = document.querySelector('[data-cc="' + sel + '"]');
          if (el) {
            el.classList.add('hl');
            setTimeout(function () { el.classList.remove('hl'); }, 2400);
            requestAnimationFrame(function () { el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' }); });
            return;
          }
        }
      }
      window.scrollTo(0, 0);
    }
    window.addEventListener('hashchange', route);

    /* ---------------- dashboard ---------------- */
    var sc = $('stars'), sx = sc.getContext('2d');
    function stars() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2), w = sc.clientWidth, h = sc.clientHeight;
      if (w < 2) return;
      sc.width = w * dpr; sc.height = h * dpr;
      sx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sx.fillStyle = cssVar('--deep'); sx.fillRect(0, 0, w, h);
      var seed = 7, white = cssVar('--white'), tint = cssVar('--star-tint');
      function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
      var n = Math.round(w * h / 2200);
      for (var i = 0; i < n; i++) {
        var x = rnd() * w, y = rnd() * h, k = rnd();
        sx.globalAlpha = 0.25 + rnd() * 0.75; sx.fillStyle = k > 0.9 ? tint : white;
        sx.beginPath(); sx.arc(x, y, k > 0.95 ? 1.4 : 0.8, 0, 6.2832); sx.fill();
      }
      sx.globalAlpha = 1;
    }

    var ec = $('ecg'), ex = ec.getContext('2d');
    var W = 0, H = 0, STEP = 1.6, buf = [], phase = 0, acc = 0, last = performance.now(), looping = false;
    var ecgGrid = rgba('--cyan-rgb', 0.14), ecgLine = cssVar('--green'), ecgGlow = rgba('--green-rgb', 0.7);
    function g(x, m, s) { return Math.exp(-Math.pow(x - m, 2) / (2 * s * s)); }
    function wave(p) { return 0.12 * g(p, 0.14, 0.035) - 0.14 * g(p, 0.27, 0.01) + g(p, 0.3, 0.011) - 0.28 * g(p, 0.335, 0.012) + 0.22 * g(p, 0.58, 0.05); }
    function hrNow() { return hrP ? cur[hrP.id] : 72; }
    function push(n) {
      for (var i = 0; i < n; i++) { phase = (phase + Math.round(hrNow()) / 3600) % 1; buf.push(wave(phase)); }
      var max = Math.ceil(W / STEP) + 2;
      if (buf.length > max) buf.splice(0, buf.length - max);
    }
    function drawEcg() {
      ex.clearRect(0, 0, W, H);
      ex.strokeStyle = ecgGrid; ex.lineWidth = 1; ex.beginPath();
      var gx, gy;
      for (gx = 0; gx < W; gx += 20) { ex.moveTo(gx + 0.5, 0); ex.lineTo(gx + 0.5, H); }
      for (gy = 0; gy < H; gy += 20) { ex.moveTo(0, gy + 0.5); ex.lineTo(W, gy + 0.5); }
      ex.stroke();
      ex.strokeStyle = ecgLine; ex.lineWidth = 1.6; ex.lineJoin = 'round';
      ex.shadowColor = ecgGlow; ex.shadowBlur = 6; ex.beginPath();
      for (var i = 0; i < buf.length; i++) {
        var x = W - (buf.length - i) * STEP, y = H * 0.7 - buf[i] * H * 0.55;
        if (i === 0) ex.moveTo(x, y); else ex.lineTo(x, y);
      }
      ex.stroke(); ex.shadowBlur = 0;
    }
    function ecgFrame(now) {
      var dt = Math.min((now - last) / 1000, 0.1); last = now;
      if ($('page-dashboard').hidden) { looping = false; return; }
      acc += dt * 60; var n = Math.floor(acc); acc -= n;
      push(n); drawEcg();
      requestAnimationFrame(ecgFrame);
    }
    function ecgSize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2), w = ec.clientWidth, h = ec.clientHeight;
      if (w < 2) return;
      W = w; H = h;
      ec.width = W * dpr; ec.height = H * dpr; ex.setTransform(dpr, 0, 0, dpr, 0, 0);
      buf = []; push(Math.ceil(W / STEP) + 2); drawEcg();
      if (!reduce && !looping) { looping = true; last = performance.now(); requestAnimationFrame(ecgFrame); }
    }
    if (window.ResizeObserver) {
      new ResizeObserver(ecgSize).observe(ec);
      new ResizeObserver(stars).observe(sc);
    }
    window.addEventListener('hashchange', function () { setTimeout(ecgSize, 30); });

    var DASH = [['hr', 'resting_hr'], ['o2', 'blood_oxygen_spo2'], ['tc', 'body_temp'], ['dose', 'dose_cum'], ['slp', 'sleep_hours'], ['mood', 'mental_health'], ['exr', 'exercise_compliance']];
    function hud(el, p) {
      var card = el.closest('.p');
      var st = card.querySelector('[data-hud-st]');
      if (!p) return;
      setStatus(st, p);
      setCardLevel(card, p);
    }
    function updateDash() {
      DASH.forEach(function (d) {
        var p = byId[d[1]], el = $(d[0]);
        if (!p || !el) return;
        el.textContent = d[0] === 'hr' || d[0] === 'exr' || d[0] === 'dose' ? Math.round(cur[p.id]) : cur[p.id].toFixed(p.dec);
        hud(el, p);
      });
    }

    /* ---------------- live tick ---------------- */
    var episode = null, epWait = 3, frozen = false;
    function anomaly() {
      if (episode) { if (--episode.left <= 0) episode = null; return; }
      if (--epWait > 0) return;
      epWait = 8 + Math.floor(Math.random() * 10);
      var pool = PARTS.filter(function (p) { return !p.cumulative; });
      var p = pool[Math.floor(Math.random() * pool.length)], t = p.t, w = +t.warn, d = +t.danger;
      var target = Math.random() < 0.55 ? d + (t.dir === 'high' ? 1 : -1) * Math.abs(d - w) * 0.3 : (w + d) / 2;
      episode = { id: p.id, target: target, left: 7 + Math.floor(Math.random() * 5) };
    }
    function tick() {
      if (!frozen) anomaly();
      PARTS.forEach(function (p) {
        if (frozen) return; // showing a check-in: keep the submitted values
        var v = cur[p.id];
        if (p.cumulative) v += 0.004 + Math.random() * 0.01;
        else if (episode && episode.id === p.id) v += (episode.target - v) * 0.45 + (Math.random() - 0.5) * p.step;
        else if (v > p.wmax || v < p.wmin) v += (p.base - v) * 0.35;
        else v = walk(v, p.wmin, p.wmax, p.step, p.base);
        cur[p.id] = v;
        hist[p.id].push(v); hist[p.id].shift();
      });
      updateAll();
    }
    function updateAll() { updateDash(); updateAdvisories(); updateCards(); updateCharts(); refreshExpanded(); }
    updateAll();
    setInterval(tick, 2000);

    /* ---------------- re-read the JSON files so edits show up live ---------------- */
    function applyData(t, a) {
      try { validate(t, a); } catch (e) { console.warn('AstroCare:', e.message); return; }
      var oldKeys = Object.keys(TH).sort().join(), newKeys = Object.keys(t).sort().join();
      if (oldKeys !== newKeys) { location.reload(); return; }
      var changed = JSON.stringify(t) !== JSON.stringify(TH) || JSON.stringify(a) !== JSON.stringify(ADV);
      if (!changed) return;
      TH = t; ADV = a;
      PARTS.forEach(function (p) { p.t = TH[p.id]; p.normal = parseNormal(p.t); });
      document.querySelectorAll('[data-lv]').forEach(function (el) { el.removeAttribute('data-lv'); });
      $('ring-det').removeAttribute('data-k');
      renderBullets();
      updateAll();
    }
    if (data.src === 'files') {
      setInterval(function () {
        loadFromFiles().then(function (d) { applyData(d.t, d.a); }).catch(function () { /* keep last good data */ });
      }, 15000);
    }

    /* ---------------- daily check-in (manual readings + scenario data) ---------------- */
    var CI_KEYS = ['resting_hr', 'blood_oxygen_spo2', 'exercise_compliance', 'body_temp', 'sleep_hours', 'mental_health', 'dose_cum'];
    var SYSTEMS = [
      { id: 'cardio', name: 'Heart & oxygen', keys: ['resting_hr', 'blood_oxygen_spo2'] },
      { id: 'bone_muscle', name: 'Muscles & bones', keys: ['exercise_compliance'] },
      { id: 'immune', name: 'Immune (temperature)', keys: ['body_temp'] },
      { id: 'mind', name: 'Mind & sleep', keys: ['sleep_hours', 'mental_health'] },
      { id: 'radiation', name: 'Radiation', keys: ['dose_cum'] }
    ];
    var RANK = { green: 0, yellow: 1, red: 2 };
    var LVL_TXT = { green: 'Normal', yellow: 'Warning', red: 'Critical' };
    function worstOf(a) { return a.reduce(function (m, x) { return RANK[x] > RANK[m] ? x : m; }, 'green'); }
    var ciForm = $('ci-form'), ciRes = $('ci-result'), ciErr = $('ci-err'), lastCI = null;
    function scenRow() {
      var sc = window.ASTRO_SCENARIOS && window.ASTRO_SCENARIOS[$('ci-scenario').value], d = Number($('ci-day').value);
      return sc && Number.isInteger(d) && d >= 1 && d <= sc.length ? sc[d - 1] : null;
    }
    function loadScenarioDay() {
      var row = scenRow(); ciRes.hidden = true; ciErr.hidden = true;
      CI_KEYS.forEach(function (k, i) { ciForm.elements[k].value = row ? row[i] : ''; });
    }
    $('ci-scenario').addEventListener('change', loadScenarioDay);
    $('ci-day').addEventListener('input', loadScenarioDay);
    loadScenarioDay();

    var LAB_LIVE = JSON.stringify(LAB), BTN_LIVE = {};
    document.querySelectorAll('[data-range]').forEach(function (b) { BTN_LIVE[b.getAttribute('data-range')] = b.textContent; });
    function setRangeMode(days, d) {
      scenHist = days;
      var names = days ? { '1h': '30 d', '6h': '90 d', '24h': 'All' } : BTN_LIVE;
      document.querySelectorAll('[data-range]').forEach(function (b) { b.textContent = names[b.getAttribute('data-range')]; });
      $('rangelbl').textContent = days ? 'Time window (mission days)' : 'Time window';
      if (days) { LAB['1h'] = ['−30 d', '−15 d', 'day ' + d]; LAB['6h'] = ['−90 d', '−45 d', 'day ' + d]; LAB['24h'] = ['day 1', 'day ' + Math.round(d / 2), 'day ' + d]; }
      else { var o = JSON.parse(LAB_LIVE); for (var k in o) LAB[k] = o[k]; }
    }
    function applyToLive(vals, label) {
      frozen = true; episode = null;
      var sc = window.ASTRO_SCENARIOS && window.ASTRO_SCENARIOS[$('ci-scenario').value], d = Number($('ci-day').value);
      PARTS.forEach(function (p) {
        if (vals[p.id] == null) return;
        cur[p.id] = vals[p.id];
        var i = CI_KEYS.indexOf(p.id), a = [];
        if (sc && i >= 0 && d >= 1 && d <= sc.length) { for (var k = 0; k < d - 1; k++) a.push(sc[k][i]); a.push(vals[p.id]); }
        else for (var n = 0; n < 30; n++) a.push(vals[p.id]);
        hist[p.id] = a;
      });
      setRangeMode(!!(sc && d >= 2), d);
      $('modetxt').textContent = 'Showing your check-in: ' + label + '. Charts show mission days 1 to ' + d + '.';
      $('modebar').hidden = false;
      updateAll();
    }
    $('resume').addEventListener('click', function () {
      frozen = false;
      PARTS.forEach(function (p) { cur[p.id] = p.base; hist[p.id] = makeHistory(p); });
      setRangeMode(false, 0);
      $('modebar').hidden = true; updateAll();
    });

    ciForm.addEventListener('submit', function (e) {
      e.preventDefault(); ciErr.hidden = true;
      var vals = {}, bad = null;
      CI_KEYS.forEach(function (k) {
        var el = ciForm.elements[k], v = el.value.trim() === '' ? NaN : Number(el.value);
        if (!isFinite(v) || v < Number(el.min) || v > Number(el.max)) { bad = bad || el; el.setCustomValidity('Out of range'); } else { el.setCustomValidity(''); }
        vals[k] = v;
      });
      if (bad) {
        ciErr.textContent = 'Please enter a valid number between ' + bad.min + ' and ' + bad.max + ' for: ' + bad.closest('label').firstChild.textContent.trim() + '.';
        ciErr.hidden = false; ciRes.hidden = true; bad.focus(); return;
      }
      var lv = {};
      CI_KEYS.forEach(function (k) { var p = byId[k]; if (p) { var z = zoneOf(p, vals[k]); lv[k] = (z === 'normal' || z === 'border') ? 'green' : z; } else lv[k] = 'green'; });
      var sys = SYSTEMS.map(function (s) { return { name: s.name, level: worstOf(s.keys.map(function (k) { return lv[k]; })) }; });
      var overall = worstOf(sys.map(function (s) { return s.level; }));
      var row = scenRow(), same = row && CI_KEYS.every(function (k, i) { return Number(row[i]) === vals[k]; });
      var trend = same && row[7] === 1;
      var items = CI_KEYS.filter(function (k) { return lv[k] !== 'green' && byId[k]; })
        .sort(function (a, b) { return RANK[lv[b]] - RANK[lv[a]]; });
      var h = '<div class="ci-overall ' + overall + '"><small>Overall status</small><b>' + LVL_TXT[overall] + '</b></div>';
      sys.forEach(function (s) { h += '<div class="ci-sys"><span>' + esc(s.name) + '</span><span class="st ' + s.level + '">' + LVL_TXT[s.level] + '</span></div>'; });
      if (trend) h += '<p class="ci-trend"><b>Trend alert:</b> sleep and mood have been drifting down for weeks, even though some readings have not reached the warning levels yet.</p>';
      h += '<h3>Recommended actions</h3>';
      if (!items.length) h += '<ul class="adv-l"><li class="green cur">' + adviceHTML(adviceOf(byId.resting_hr || PARTS[0], 'green')) + '</li></ul>';
      else h += '<ul class="adv-l">' + items.map(function (k) { return '<li class="' + lv[k] + ' cur"><i>' + esc(byId[k].metric) + '</i>' + adviceHTML(adviceOf(byId[k], lv[k])) + '</li>'; }).join('') + '</ul>';
      h += '<div class="ci-actions"><button type="button" class="btn" id="ci-show">Show on body scan</button></div>';
      ciRes.innerHTML = h; ciRes.hidden = false;
      lastCI = { vals: vals, label: ($('ci-scenario').selectedOptions[0].textContent + ', day ' + $('ci-day').value) };
      $('ci-show').addEventListener('click', function () { applyToLive(lastCI.vals, lastCI.label); location.hash = '#body'; });
    });

    route();
    stars(); ecgSize();
  }
})();
