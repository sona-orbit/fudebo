/* Fudebo home page: the greeting robot and the "write one from memory" pad. Plain JS, no framework.
   Texts come from <script id="fudebo-i18n" type="application/json"> (the app's own strings, filled in by build.py);
   stroke data from assets/try-kana.json (KanjiVG, CC BY-SA 3.0); the check is assets/matcher.js (a port of the app's
   StrokeMatcher.swift). Sound plays only after a tap or click. */
(function () {
  "use strict";
  var cfgEl = document.getElementById("fudebo-i18n");
  if (!cfgEl) return;
  var C = JSON.parse(cfgEl.textContent);
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var audio = {};
  function play(word) {
    var src = C.voice[word];
    if (!src) return;
    try {
      var a = audio[word] || (audio[word] = new Audio(src));
      a.currentTime = 0;
      var p = a.play();
      if (p && p.catch) p.catch(function () {});
    } catch (e) { /* no sound is fine */ }
  }
  // next animation step: requestAnimationFrame, or a timer when frames do not come (hidden tab, some in-app web views),
  // so an animation always finishes and the pad never stays locked
  function nextFrame(cb) {
    var fired = false;
    function go() { if (!fired) { fired = true; cb(performance.now()); } }
    requestAnimationFrame(go);
    setTimeout(go, 50);
  }
  function fmt(t, args) {
    var i = 0;
    return t.replace(/%(\d)\$(?:@|d|lld)/g, function (_, n) { return args[+n - 1]; })
            .replace(/%(?:@|d|lld)/g, function () { return args[i++]; });
  }

  /* ---------------- greeting robot ---------------- */
  (function greeter() {
    var root = document.querySelector("[data-greeter]");
    if (!root) return;
    var bot = root.querySelector(".greeter-bot"), hi = root.querySelector(".bubble-hi"), line = root.querySelector(".bubble-line");
    var h = new Date().getHours(), part = h >= 5 && h < 11 ? "morning" : h >= 11 && h < 18 ? "day" : "night";
    var lines = [C.greet.lines[part]].concat(C.greet.more), n = 0;
    hi.textContent = C.greet.hi[part];
    line.textContent = lines[0];
    root.classList.add("ready");
    nextFrame(function () { root.classList.add("in"); });
    bot.addEventListener("click", function () {
      n = (n + 1) % lines.length;
      line.textContent = lines[n];
      play(C.greet.hi[part]);
      if (reduce) return;
      root.classList.remove("jump", "pop");
      void root.offsetWidth;                       // restart the CSS animations
      root.classList.add("jump", "pop");
    });
  })();

  /* ---------------- write one from memory ---------------- */
  (function tryPad() {
    var root = document.querySelector("[data-try]");
    var M = window.FudeboMatcher;
    if (!root || !M) return;
    var cv = root.querySelector("canvas"), ctx = cv.getContext("2d");
    var msg = root.querySelector(".try-msg"), romaji = root.querySelector(".try-romaji"), dots = root.querySelector(".try-dots");
    var end = root.querySelector(".try-end"), pad = root.querySelector(".try-pad-wrap");
    var REF = null, ROUND = 5, queue = [], done = 0, cur = null;
    var strokes = [], live = null, wrongIdx = -1, busy = false, idle = 0, size = 0, dpr = 1;
    var css = getComputedStyle(document.documentElement);
    function col(name, fb) { return (css.getPropertyValue(name) || fb).trim() || fb; }

    fetch(C.data).then(function (r) { return r.json(); }).then(function (d) {
      REF = d.kana;
      root.hidden = false;
      resize();
      newRound();
    }).catch(function () {});

    function resize() {
      var w = pad.clientWidth;
      if (!w) return;
      dpr = Math.min(window.devicePixelRatio || 1, 3);
      size = w;
      cv.width = Math.round(w * dpr); cv.height = Math.round(w * dpr);
      cv.style.height = w + "px";
      draw();
    }
    window.addEventListener("resize", function () { if (pad.clientWidth !== size) resize(); });

    function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
    function newRound() {
      queue = shuffle(Object.keys(REF)).slice(0, ROUND); done = 0;
      end.hidden = true; pad.hidden = false; root.querySelector(".try-q").hidden = false; root.querySelector(".try-btns").hidden = false;
      next();
    }
    function next() {
      cur = queue[done];
      romaji.textContent = C.romaji[cur];
      strokes = []; wrongIdx = -1; msg.textContent = ""; msg.className = "try-msg";
      renderDots();
      draw();
    }
    function renderDots() {
      dots.innerHTML = "";
      for (var i = 0; i < ROUND; i++) {
        var s = document.createElement("span");
        s.className = i < done ? "on" : i === done ? "now" : "";
        dots.appendChild(s);
      }
    }

    /* drawing */
    function k() { return size * dpr / 109; }               // 109 box → canvas pixels
    function grid() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.setTransform(k(), 0, 0, k(), 0, 0);
      ctx.save();
      ctx.strokeStyle = col("--shu", "#E0533D"); ctx.globalAlpha = 0.6; ctx.lineWidth = 0.6; ctx.setLineDash([2.2, 2]);
      ctx.beginPath(); ctx.moveTo(54.5, 5); ctx.lineTo(54.5, 104); ctx.moveTo(5, 54.5); ctx.lineTo(104, 54.5); ctx.stroke();
      ctx.restore();
    }
    function path(p, upto) {                                  // midpoint quadratic smoothing; upto = fraction drawn
      var n = p.length;
      if (!n) return;
      var last = upto === undefined ? n : Math.max(1, Math.floor(n * upto));
      ctx.beginPath();
      ctx.moveTo(p[0][0], p[0][1]);
      if (last === 1) { ctx.lineTo(p[0][0] + 0.01, p[0][1]); ctx.stroke(); return; }
      for (var i = 1; i < last - 1; i++) {
        ctx.quadraticCurveTo(p[i][0], p[i][1], (p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2);
      }
      ctx.lineTo(p[last - 1][0], p[last - 1][1]);
      ctx.stroke();
    }
    function pen(color, w, alpha) { ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.globalAlpha = alpha || 1; }
    function draw() {
      if (!size) return;
      grid();
      var ink = col("--sheet-ink", "#1C2230"), shu = col("--shu", "#E0533D");
      strokes.forEach(function (s, i) { pen(i === wrongIdx ? shu : ink, 4.2); path(s); });
      if (live) { pen(ink, 4.2); path(live); }
      ctx.globalAlpha = 1;
    }
    function animateRef(after) {                              // show the right stroke order, one stroke after another
      busy = true;
      var ref = REF[cur], i = 0, t0 = 0, dur = reduce ? 1 : 520;
      var guide = col("--navy", "#2F55D4");
      function frame(ts) {
        if (!t0) t0 = ts;
        var f = Math.min(1, (ts - t0) / dur);
        draw();
        ctx.save(); ctx.globalAlpha = 0.9;
        for (var j = 0; j < i; j++) { pen(guide, 3.4, 0.9); path(ref[j]); }
        pen(guide, 3.4, 0.9); path(ref[i], f);
        ctx.restore();
        if (f < 1) return nextFrame(frame);
        i += 1; t0 = 0;
        if (i < ref.length) return nextFrame(frame);
        setTimeout(function () { busy = false; if (after) after(); }, reduce ? 300 : 650);
      }
      nextFrame(frame);
    }
    function hanamaru(after) {                                // yellow "well done" spiral over the grid
      busy = true;
      var t0 = 0, dur = reduce ? 1 : 650;
      function frame(ts) {
        if (!t0) t0 = ts;
        var f = Math.min(1, (ts - t0) / dur);
        draw();
        ctx.save();
        pen(col("--sun", "#FFD43B"), 3.2, 0.85);
        ctx.beginPath();
        var turns = 2.15 * f, steps = Math.max(2, Math.floor(120 * f));
        for (var s = 0; s <= steps; s++) {
          var a = -Math.PI / 2 + (s / steps) * turns * Math.PI * 2, r = 40 - (s / steps) * turns * 7;
          var x = 54.5 + Math.cos(a) * r, y = 56 + Math.sin(a) * r * 0.92;
          if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();
        if (f < 1) return nextFrame(frame);
        setTimeout(function () { busy = false; after(); }, 750);
      }
      nextFrame(frame);
    }

    /* judging, like the app: after every stroke; wrong once the stroke count is reached; or after 1.6 s of rest */
    function judge(final) {
      clearTimeout(idle);
      var ref = REF[cur], r = M.match(strokes, ref);
      if (r.passed) return success();
      if (final || strokes.length >= ref.length) return fail(r);
      idle = setTimeout(function () { judge(true); }, 1600);
    }
    function success() {
      msg.textContent = C.msg.ok; msg.className = "try-msg ok";
      play(cur);
      hanamaru(function () {
        done += 1;
        if (done >= ROUND) return finish();
        next();
      });
    }
    function fail(r) {
      var text = "", p = r.problem;
      for (var other in REF) {                                // wrote a look-alike instead?
        if (other !== cur && strokes.length && M.match(strokes, REF[other]).passed) { text = fmt(C.msg.lookalike, [other, cur]); break; }
      }
      if (!text && p) {
        if (p.type === "strokeCount") text = fmt(strokes.length < p.expected ? C.msg.fewer : C.msg.more, [p.expected]);
        else text = fmt(C.msg[p.type], [p.stroke]);
        if (p.type === "direction" || p.type === "shape" || p.type === "order") wrongIdx = p.stroke - 1;
      }
      msg.textContent = text; msg.className = "try-msg bad";
      draw();
      setTimeout(function () {
        animateRef(function () { strokes = []; wrongIdx = -1; draw(); });
      }, reduce ? 200 : 600);
    }
    function finish() {
      pad.hidden = true; root.querySelector(".try-q").hidden = true; root.querySelector(".try-btns").hidden = true;
      msg.textContent = ""; end.hidden = false; renderDots();
    }

    /* input: finger, pen or mouse */
    function pt(e) {
      var b = cv.getBoundingClientRect();
      return [(e.clientX - b.left) * 109 / b.width, (e.clientY - b.top) * 109 / b.height];
    }
    cv.addEventListener("pointerdown", function (e) {
      if (busy || !REF) return;
      e.preventDefault();
      clearTimeout(idle);
      if (msg.classList.contains("bad")) { msg.textContent = ""; msg.className = "try-msg"; }
      try { cv.setPointerCapture(e.pointerId); } catch (_) {}
      live = [pt(e)];
      draw();
    });
    cv.addEventListener("pointermove", function (e) {
      if (!live) return;
      var evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      if (!evs.length) evs = [e];
      evs.forEach(function (x) { live.push(pt(x)); });
      draw();
    });
    function up() {
      if (!live) return;
      var s = live; live = null;
      strokes.push(s);
      draw();
      judge(false);
    }
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);

    root.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-act]");
      if (!b) return;
      var act = b.getAttribute("data-act");
      if (act === "say") play(cur);
      if (busy) return;
      if (act === "order") { clearTimeout(idle); strokes = []; wrongIdx = -1; msg.textContent = ""; animateRef(function () { draw(); }); }
      if (act === "clear") { clearTimeout(idle); strokes = []; wrongIdx = -1; msg.textContent = ""; msg.className = "try-msg"; draw(); }
      if (act === "again") newRound();
    });
  })();
})();
