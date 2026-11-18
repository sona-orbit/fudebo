/* Fudebo stroke matcher: a line-by-line port of the app's Sources/Engine/StrokeMatcher.swift (keep the two in step).
   Coordinates are in the KanjiVG 109×109 box. Each user stroke maps, in order, to one reference stroke or to two
   neighbouring strokes written in one go; count, order, direction and shape are judged separately so the page can
   say what is wrong. Points are [x, y] arrays. tools/matchtest.mjs compares this file with the Swift original. */
(function (root) {
  "use strict";
  var MEAN_LIMIT = 13.5, MAX_LIMIT = 32;

  function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }
  function length(p) { var s = 0; for (var i = 1; i < p.length; i++) s += dist(p[i - 1], p[i]); return s; }
  function dedupe(p) {
    var out = [];
    for (var i = 0; i < p.length; i++) if (!out.length || dist(out[out.length - 1], p[i]) > 0.3) out.push(p[i]);
    return out.length ? out : p;
  }
  function bounds(p) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (var i = 0; i < p.length; i++) {
      x0 = Math.min(x0, p[i][0]); y0 = Math.min(y0, p[i][1]); x1 = Math.max(x1, p[i][0]); y1 = Math.max(y1, p[i][1]);
    }
    if (!p.length) return { x: 0, y: 0, w: 0, h: 0 };
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  function resample(p, n) {
    var i, out;
    if (p.length <= 1) { out = []; for (i = 0; i < n; i++) out.push(p[0] || [0, 0]); return out; }
    var total = length(p);
    if (!(total > 0)) { out = []; for (i = 0; i < n; i++) out.push(p[0]); return out; }
    out = [p[0]];
    var step = total / (n - 1), acc = 0, prev = p[0];
    i = 1;
    while (out.length < n - 1 && i < p.length) {
      var d = dist(prev, p[i]);
      if (acc + d >= step) {
        var t = (step - acc) / d, q = [prev[0] + (p[i][0] - prev[0]) * t, prev[1] + (p[i][1] - prev[1]) * t];
        out.push(q); prev = q; acc = 0;
      } else { acc += d; prev = p[i]; i += 1; }
    }
    while (out.length < n) out.push(p[p.length - 1]);
    return out;
  }
  function flat(strokes) { var a = []; strokes.forEach(function (s) { a = a.concat(s); }); return a; }

  function normalize(user, ref) {
    var ub = bounds(flat(user)), rb = bounds(flat(ref));
    var us = Math.max(ub.w, ub.h), rs = Math.max(rb.w, rb.h);
    var scale = us < 4 ? 1 : rs / us;
    var ucx = ub.x + ub.w / 2, ucy = ub.y + ub.h / 2, rcx = rb.x + rb.w / 2, rcy = rb.y + rb.h / 2;
    return user.map(function (s) {
      return s.map(function (p) { return [rcx + (p[0] - ucx) * scale, rcy + (p[1] - ucy) * scale]; });
    });
  }

  function score(u, r) {
    var a = resample(u, 32), b = resample(r, 32), sum = 0, mx = 0, rsum = 0;
    for (var k = 0; k < 32; k++) {
      var d = dist(a[k], b[k]); sum += d; mx = Math.max(mx, d);
      rsum += dist(a[k], b[31 - k]);
    }
    var mean = sum / 32, rmean = rsum / 32, len = length(r);
    var limit = len < 18 ? MEAN_LIMIT * 0.9 : MEAN_LIMIT;
    var ok = mean <= limit && mx <= MAX_LIMIT;
    var reversed = !ok && len >= 14 && rmean <= limit && rmean < mean * 0.6;
    return { mean: mean, max: mx, ok: ok, reversedBetter: reversed };
  }

  function sequentialAlign(user, ref) {
    var n = user.length, m = ref.length, i, j, span;
    if (!(n <= m && m <= n * 2)) return null;
    var best = [], back = [], cache = {};
    for (i = 0; i <= n; i++) { best.push(new Array(m + 1).fill(Infinity)); back.push(new Array(m + 1).fill(0)); }
    best[0][0] = 0;
    for (i = 1; i <= n; i++) {
      for (j = 1; j <= m; j++) {
        for (span = 1; span <= 2; span++) {
          if (!(j - span >= 0 && best[i - 1][j - span] < Infinity)) continue;
          var target = span === 1 ? ref[j - 1] : ref[j - 2].concat(ref[j - 1]);
          if (span === 2 && dist(ref[j - 2][ref[j - 2].length - 1], ref[j - 1][0]) > 38) continue;
          var key = i + "-" + j + "-" + span;
          var sc = cache[key] || score(user[i - 1], target);
          cache[key] = sc;
          var c = best[i - 1][j - span] + sc.mean + (span === 2 ? 2 : 0);
          if (c < best[i][j]) { best[i][j] = c; back[i][j] = span; }
        }
      }
    }
    if (!(best[n][m] < Infinity)) return null;
    var mapping = [], scores = [];
    i = n; j = m;
    while (i > 0) {
      span = back[i][j];
      mapping.unshift(j - span);
      scores.unshift(cache[i + "-" + j + "-" + span]);
      i -= 1; j -= span;
    }
    return { mapping: mapping, scores: scores, cost: best[n][m] };
  }

  function orderProblem(user, ref) {
    var used = {}, firstWrong = null;
    for (var k = 0; k < user.length; k++) {
      var bestJ = -1, bestS = Infinity;
      for (var j = 0; j < ref.length; j++) {
        if (used[j]) continue;
        var s = score(user[k], ref[j]);
        if (s.ok && s.mean < bestS) { bestS = s.mean; bestJ = j; }
      }
      if (bestJ < 0) return null;
      used[bestJ] = true;
      if (bestJ !== k && firstWrong === null) firstWrong = k + 1;
    }
    return firstWrong;
  }

  function quality(means) {
    if (!means.length) return 0;
    var avg = means.reduce(function (a, b) { return a + b; }, 0) / means.length;
    return Math.max(0, Math.min(100, Math.trunc((1 - avg / MEAN_LIMIT) * 70 + 30)));
  }

  /** user: [[ [x,y], ... ], ...] in 109 units; ref: same shape. Returns {passed, problem, strokeScores, mapping, quality}.
      problem: {type: "strokeCount", expected, got} | {type: "order"|"direction"|"shape", stroke} | null */
  function match(rawUser, ref) {
    var user = rawUser.map(dedupe);
    if (!user.length || !ref.length) {
      return { passed: false, problem: { type: "strokeCount", expected: ref.length, got: user.length }, strokeScores: [], mapping: [], quality: 0 };
    }
    var aligned = normalize(user, ref);
    var seq = sequentialAlign(aligned, ref);
    if (seq) {
      var problem = null, k;
      for (k = 0; k < seq.scores.length; k++) if (seq.scores[k].reversedBetter) { problem = { type: "direction", stroke: k + 1 }; break; }
      if (!problem) for (k = 0; k < seq.scores.length; k++) if (!seq.scores[k].ok) { problem = { type: "shape", stroke: k + 1 }; break; }
      var means = seq.scores.map(function (s) { return s.mean; });
      return { passed: !problem, problem: problem, strokeScores: means, mapping: seq.mapping, quality: quality(means) };
    }
    if (user.length === ref.length && user.length <= 6) {
      var wrong = orderProblem(aligned, ref);
      if (wrong !== null) return { passed: false, problem: { type: "order", stroke: wrong }, strokeScores: [], mapping: [], quality: 0 };
    }
    return { passed: false, problem: { type: "strokeCount", expected: ref.length, got: user.length }, strokeScores: [], mapping: [], quality: 0 };
  }

  var api = { match: match, resample: resample, MEAN_LIMIT: MEAN_LIMIT, MAX_LIMIT: MAX_LIMIT };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.FudeboMatcher = api;
})(this);
