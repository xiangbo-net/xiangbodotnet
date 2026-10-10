/* ===========================================================
   汉字小侦探 · 孩子端逻辑（v2 · 云端版）

   与 v1 的主要变化：
   1) 字表与进度存在云端（Cloudflare D1），启动时 bootstrap 拉全量
   2) 关卡不再固定 10 关：全部汉字按难度排序，每关 20 个未测字顺序推进
      · 答「认识」→ 出关卡池、进「我的字库」
      · 答「不认识」→ 出关卡池、进「练习池」，按 10 个一组反复练
   3) 桌面 / 手机统一为「左滑=认识、右滑=不认识」
   4) 右上角返回：改用自定义确认弹层（iOS 全屏模式下 confirm() 会被静默拦截）
   5) 字卡自动带拼音 + 3–5 个组词；测试时默认折叠（防止看拼音蒙对），练习时默认展开
   6) 整局结束时批量提交到后端；提交失败会落本地队列，下次启动重试
   =========================================================== */
(function () {
  'use strict';

  var API_BASE = (window.__API_BASE__ != null) ? window.__API_BASE__ : '/api/baby';

  /* ---------------- 图标 ---------------- */
  function icon(name, color) {
    var c = color || 'currentColor';
    var p = {
      bolt: '<path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12L13 2z" fill="' + c + '"/>',
      speaker: '<path d="M4 9h3.2L12 5v14l-4.8-4H4V9z" fill="' + c + '"/><path d="M15.5 8.5a5 5 0 0 1 0 7" stroke="' + c + '" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M18 6a8.5 8.5 0 0 1 0 12" stroke="' + c + '" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
      smile: '<circle cx="12" cy="12" r="10" fill="' + c + '"/><circle cx="8.8" cy="10" r="1.5" fill="#fff"/><circle cx="15.2" cy="10" r="1.5" fill="#fff"/><path d="M7.6 14.2c1.1 1.7 2.6 2.5 4.4 2.5s3.3-.8 4.4-2.5" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
      ask: '<circle cx="12" cy="12" r="10" fill="' + c + '"/><circle cx="8.8" cy="9.6" r="1.6" fill="#fff"/><circle cx="15.2" cy="9.6" r="1.6" fill="#fff"/><ellipse cx="12" cy="15.3" rx="2.1" ry="1.7" fill="#fff"/>',
      gear: '<circle cx="12" cy="12" r="3.1" fill="none" stroke="' + c + '" stroke-width="1.9"/><path d="M12 2.9l1.25 2.5 2.75-.35.95 2.62 2.55 1.08-1.1 2.55 1.1 2.55-2.55 1.08-.95 2.62-2.75-.35L12 21.1l-1.25-2.5-2.75.35-.95-2.62-2.55-1.08 1.1-2.55-1.1-2.55 2.55-1.08.95-2.62 2.75.35z" fill="none" stroke="' + c + '" stroke-width="1.9" stroke-linejoin="round"/>',
      star: '<path d="M12 2.6l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.5 6.1 20.6l1.2-6.5L2.5 9.5l6.6-.9 2.9-6z"/>',
      thumb: '<path d="M6 20V9.6l4.6-7.1c1.5 0 2.4 1.2 2.4 2.6 0 .8-.5 2.7-.7 3.4h5.2c1.4 0 2.4 1.3 2.1 2.6l-1.5 6.4c-.2 1-1.1 1.7-2.1 1.7H6z" fill="' + c + '"/><rect x="2.4" y="9.6" width="3.2" height="10.4" rx="1.2" fill="' + c + '"/>',
      arrowL: '<path d="M14 6l-6 6 6 6" stroke="' + c + '" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M19 12H8" stroke="' + c + '" stroke-width="2.4" fill="none" stroke-linecap="round"/>',
      arrowR: '<path d="M10 6l6 6-6 6" stroke="' + c + '" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 12h11" stroke="' + c + '" stroke-width="2.4" fill="none" stroke-linecap="round"/>',
      medal: '<circle cx="12" cy="14.5" r="7" fill="#F5B95C"/><circle cx="12" cy="14.5" r="5" fill="#F08C1E"/><path d="M12 10.6l1.3 2.7 3 .4-2.2 2 .6 2.9-2.7-1.5-2.7 1.5.6-2.9-2.2-2 3-.4 1.3-2.7z" fill="#fff"/><path d="M8.5 8.5 6.4 1.6h4.2l1.4 6.3zM15.5 8.5l2.1-6.9h-4.2l-1.4 6.3z" fill="#E0A24C"/>',
      close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" stroke="' + c + '" stroke-width="2.2" fill="none" stroke-linecap="round"/>',
      // 底部两个大按钮的图标：白底圆盘 + 绿色对勾 / 红色圆圈（自带配色，不受 color 参数影响）
      check: '<circle cx="12" cy="12" r="11" fill="#fff"/><path d="M6.9 12.5l3.4 3.4 6.9-7.5" fill="none" stroke="#2E9E4F" stroke-width="2.9" stroke-linecap="round" stroke-linejoin="round"/>',
      ring: '<circle cx="12" cy="12" r="11" fill="#fff"/><circle cx="12" cy="12" r="7.3" fill="none" stroke="#D64541" stroke-width="2.9"/>',
      play: '<path d="M7 4.5v15l13-7.5z" fill="' + c + '"/>',
      shelf: '<path d="M4 5h4v14H4zM10 5h4v14h-4z" fill="' + c + '"/><path d="M16.6 5.6l3.2 13.2-3.9.9L12.7 6z" fill="' + c + '"/>',
      refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.6" stroke="' + c + '" stroke-width="2.2" fill="none" stroke-linecap="round"/><path d="M20 4v7h-7" stroke="' + c + '" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
      dumbbell: '<path d="M6.5 9h11v6h-11z" fill="' + c + '"/><rect x="2.5" y="7" width="3" height="10" rx="1.2" fill="' + c + '"/><rect x="18.5" y="7" width="3" height="10" rx="1.2" fill="' + c + '"/>'
    };
    return p[name] || '';
  }
  function svg(name, size, color) {
    return '<svg viewBox="0 0 24 24" width="' + (size || 24) + '" height="' + (size || 24) + '">' + icon(name, color) + '</svg>';
  }

  /* ---------------- 本地存储 ---------------- */
  var LS = 'hzdet2.';
  function lsGet(k, d) { try { var v = localStorage.getItem(LS + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch (e) { } }
  function lsDel(k) { try { localStorage.removeItem(LS + k); } catch (e) { } }

  var settings = Object.assign({
    mode: 'self', sound: true, showPinyin: false, seenGuide: false
  }, lsGet('settings', {}) || {});
  function saveSettings() { lsSet('settings', settings); }

  var energy = lsGet('energy', 0) || 0;
  function saveEnergy() { lsSet('energy', energy); }

  /* ---------------- 音效（Web Audio 实时合成，零音频文件） ---------------- */
  var Sfx = (function () {
    var ctx = null;
    function ac() {
      if (!settings.sound) return null;
      try {
        if (!ctx) { var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; ctx = new AC(); }
        if (ctx.state === 'suspended') ctx.resume();
        return ctx;
      } catch (e) { return null; }
    }
    function tone(freq, dur, type, vol, delay, freqTo) {
      var a = ac(); if (!a) return;
      var t0 = a.currentTime + (delay || 0);
      var o = a.createOscillator(), g = a.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t0);
      if (freqTo) o.frequency.exponentialRampToValueAtTime(Math.max(60, freqTo), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol || 0.15, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(a.destination);
      o.start(t0); o.stop(t0 + dur + 0.03);
    }
    function noise(dur, vol) {
      var a = ac(); if (!a) return;
      var n = Math.floor(a.sampleRate * dur);
      var buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      var s = a.createBufferSource(); s.buffer = buf;
      var f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1600; f.Q.value = 0.9;
      var g = a.createGain(); g.gain.value = vol || 0.06;
      s.connect(f); f.connect(g); g.connect(a.destination); s.start();
    }
    return {
      unlock: function () { ac(); },
      pick: function () { noise(0.05, 0.05); },
      know: function () { tone(680, 0.13, 'sine', 0.16, 0); tone(900, 0.13, 'sine', 0.15, 0.075); tone(1340, 0.2, 'sine', 0.13, 0.15); },
      unk: function () { tone(360, 0.2, 'triangle', 0.12, 0, 250); tone(260, 0.26, 'sine', 0.09, 0.09, 200); },
      tick: function () { tone(760, 0.1, 'square', 0.07, 0); tone(1010, 0.12, 'square', 0.06, 0.07); },
      combo: function () { [700, 880, 1100, 1320].forEach(function (f, i) { tone(f, 0.13, 'sine', 0.12, i * 0.06); }); },
      levelup: function () { [660, 830, 990, 1320, 1660].forEach(function (f, i) { tone(f, 0.22, 'sine', 0.13, i * 0.1); }); },
      finish: function () { [523, 659, 784, 1046].forEach(function (f, i) { tone(f, 0.3, 'sine', 0.14, i * 0.13); }); tone(1568, 0.5, 'sine', 0.1, 0.55); },
      tap: function () { tone(520, 0.05, 'sine', 0.07, 0); }
    };
  })();

  /* ---------------- 朗读 ---------------- */
  var Talk = (function () {
    var voices = [], zh = null, ok = false;
    function load() {
      if (!('speechSynthesis' in window)) return;
      voices = window.speechSynthesis.getVoices() || [];
      zh = voices.filter(function (v) { return /^zh|Chinese/i.test(v.lang + ' ' + v.name) && !/HK|TW|yue/i.test(v.lang); })[0]
        || voices.filter(function (v) { return /^zh|Chinese/i.test(v.lang + ' ' + v.name); })[0] || null;
      ok = !!zh;
    }
    if ('speechSynthesis' in window) { load(); window.speechSynthesis.onvoiceschanged = load; }
    return {
      available: function () { return ok; },
      say: function (text) {
        // 只在用户主动点小喇叭时调用；不做任何自动朗读
        if (!('speechSynthesis' in window)) return;
        if (!zh) load();
        try {
          window.speechSynthesis.cancel();
          var u = new SpeechSynthesisUtterance(text);
          u.lang = 'zh-CN'; u.rate = 0.72; u.pitch = 1.08; u.volume = 1;
          if (zh) u.voice = zh;
          window.speechSynthesis.speak(u);
        } catch (e) { }
      }
    };
  })();

  /* ---------------- DOM 小工具 ---------------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function el(tag, cls, html) { var d = document.createElement(tag); if (cls) d.className = cls; if (html != null) d.innerHTML = html; return d; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]; }); }
  function show(id) { ['home', 'play', 'result', 'library'].forEach(function (s) { var n = $('#' + s); if (n) n.classList.toggle('on', s === id); }); document.body.dataset.screen = id; }
  function buzz(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { } }

  var TITLES = [
    { e: 0, n: '新手上路' }, { e: 100, n: '汉字小侦探' }, { e: 300, n: '识字小能手' },
    { e: 600, n: '识字小达人' }, { e: 1000, n: '汉字小博士' }, { e: 2000, n: '汉字大师' }
  ];
  function titleOf(e) { var t = TITLES[0].n; TITLES.forEach(function (x) { if (e >= x.e) t = x.n; }); return t; }
  function titleRank(e) { var r = 0; TITLES.forEach(function (x) { if (e >= x.e) r = x.e; }); return r; }

  function floatText(x, y, text, color) {
    var layer = $('#toasts'); if (!layer) return;
    var d = el('div', 'float', esc(text));
    d.style.left = x + 'px'; d.style.top = y + 'px';
    if (color) d.style.color = color;
    layer.appendChild(d);
    setTimeout(function () { d.remove(); }, 1050);
  }

  /* ---------------- 自定义确认弹层（替代原生 confirm） ---------------- */
  function confirmBox(opt) {
    return new Promise(function (resolve) {
      var ov = el('div', 'overlay');
      ov.innerHTML = '<div class="box"><h2>' + esc(opt.title || '提示') + '</h2>' +
        '<p>' + (opt.body || '') + '</p>' +
        '<div class="foot">' +
        '<button class="btn ghost" data-x="0">' + esc(opt.cancel || '取消') + '</button>' +
        '<button class="btn primary" data-x="1">' + esc(opt.ok || '确定') + '</button>' +
        '</div></div>';
      document.body.appendChild(ov);
      function done(v) { ov.remove(); resolve(v); }
      ov.addEventListener('click', function (e) {
        var b = e.target.closest('[data-x]');
        if (b) done(b.dataset.x === '1');
        else if (e.target === ov) done(false);
      });
    });
  }

  /* ---------------- 全局状态 ---------------- */
  var S = {
    loaded: false,
    chars: [],       // 按难度升序：[{c,p,s,d,w,src}]
    byChar: {},
    progress: {},    // { c: {st:'known'|'unknown', k, u, t} }
    sessions: [],
    stats: {},
    config: { perLevel: 20, perPractice: 10 },
    round: null
  };

  function untested() { return S.chars.filter(function (x) { return !S.progress[x.c]; }); }
  function knownList() { return S.chars.filter(function (x) { var p = S.progress[x.c]; return p && p.st === 'known'; }); }
  function unknownList() { return S.chars.filter(function (x) { var p = S.progress[x.c]; return p && p.st === 'unknown'; }); }

  function recalcStats() {
    var total = S.chars.length, known = 0, unknown = 0;
    Object.keys(S.progress).forEach(function (c) { var p = S.progress[c]; if (p.st === 'known') known++; else if (p.st === 'unknown') unknown++; });
    var tested = known + unknown;
    var per = S.config.perLevel || 20;
    S.stats = {
      total: total, known: known, unknown: unknown, tested: tested,
      untested: Math.max(0, total - tested),
      levelNo: Math.floor(tested / per) + 1,
      totalLevels: Math.max(1, Math.ceil(total / per)),
      practiceGroups: Math.max(0, Math.ceil(unknown / (S.config.perPractice || 10)))
    };
  }

  /* ---------------- 网络 ---------------- */
  function apiGet(path) {
    return fetch(API_BASE + path, { headers: { 'Accept': 'application/json' } }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok || j.ok === false) { var e = new Error(j.error || ('HTTP ' + r.status)); e.status = r.status; throw e; }
        return j;
      });
    });
  }
  function apiPost(path, body) {
    return fetch(API_BASE + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {})
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok || j.ok === false) { var e = new Error(j.error || ('HTTP ' + r.status)); e.status = r.status; throw e; }
        return j;
      });
    });
  }

  // 待同步队列：整局提交失败时落本地，下次启动补传
  function queuePending(payload) { var q = lsGet('pending', []) || []; q.push(payload); if (q.length > 30) q = q.slice(-30); lsSet('pending', q); }
  function flushPending() {
    var q = lsGet('pending', []) || [];
    if (!q.length) return Promise.resolve();
    lsSet('pending', []);
    return Promise.all(q.map(function (p) {
      return apiPost('/round', p).catch(function (e) { if (e.status >= 400 && e.status < 500) return null; queuePending(p); return null; });
    }));
  }

  /* ===========================================================
     首页
     =========================================================== */
  function renderHome() {
    var wrap = $('#home');
    if (!S.loaded) {
      wrap.innerHTML = '<div class="home-wrap"><div class="card" style="text-align:center;padding:40px">' +
        '<div class="brand-badge" style="margin:0 auto 14px"><span>字</span></div>' +
        '<h2 style="justify-content:center;font-size:18px">正在打开字库…</h2>' +
        '<div class="tip" id="bootTip" style="margin-top:8px">连接中，请稍候</div></div></div>';
      return;
    }

    var st = S.stats;
    var ut = untested();
    var un = unknownList();
    var kn = knownList();
    var per = S.config.perLevel || 20;
    var thisLevel = Math.min(per, ut.length);
    var finished = ut.length === 0;

    var levelCard = finished
      ? '<button class="action-card library" data-go="library"><div class="ico">' + svg('medal', 30, '#3E8F4E') + '</div>' +
        '<div class="tx"><div class="t">全部汉字都测完啦！</div><div class="d">' + st.known + ' 个字认识，' + st.unknown + ' 个还在练习库里</div></div>' +
        '<div class="go">›</div></button>'
      : '<button class="action-card primary" data-go="level"><div class="ico">' + svg('play', 30, '#C67A11') + '</div>' +
        '<div class="tx"><div class="t">继续第 ' + st.levelNo + ' 关</div>' +
        '<div class="d">这一关 ' + thisLevel + ' 个字 · 全部还剩 ' + ut.length + ' 个没测过</div></div>' +
        '<div class="badge">' + thisLevel + ' 字</div></button>';

    var practiceCard = '<button class="action-card practice' + (un.length ? '' : ' disabled') + '" data-go="practice">' +
      '<div class="ico">' + svg('dumbbell', 30, '#455A6E') + '</div>' +
      '<div class="tx"><div class="t">练一练不认识的 ' + un.length + ' 个字</div>' +
      '<div class="d">' + (un.length ? ('每次 10 个一组，练会了就自动进「我的字库」') : '现在还没有要练的字，很棒！') + '</div></div>' +
      (un.length ? '<div class="badge">' + (S.config.perPractice || 10) + ' 个/组</div>' : '') + '</button>';

    var libCard = '<button class="action-card library' + (kn.length ? '' : ' disabled') + '" data-go="library">' +
      '<div class="ico">' + svg('shelf', 30, '#3E8F4E') + '</div>' +
      '<div class="tx"><div class="t">我的字库</div>' +
      '<div class="d">已经认识 ' + kn.length + ' 个字，随时点开复习（带拼音和组词）</div></div>' +
      '<div class="go">›</div></button>';

    var modeCards = [
      { k: 'self', t: '孩子自己滑', d: '认识往左滑，不认识往右滑。家长在旁边陪着就行。' },
      { k: 'parent', t: '家长判读（更准）', d: '让孩子读出来，家长点「读对了 / 没读对」。结果更可信。' }
    ].map(function (m) {
      return '<button class="mode ' + (settings.mode === m.k ? 'on' : '') + '" data-mode="' + m.k + '">' +
        '<div class="t">' + m.t + '</div><div class="d">' + m.d + '</div></button>';
    }).join('');

    wrap.innerHTML =
      '<div class="home-wrap">' +
        '<div class="brand">' +
          '<div class="brand-badge"><span>字</span></div>' +
          '<div><h1>汉字小侦探</h1><p>看看我认识多少个字 · 一共 ' + st.total + ' 个字，按难度一关一关来</p></div>' +
        '</div>' +

        '<div class="stat-strip">' +
          '<div class="stat know"><div class="k">已经认识</div><div class="v">' + st.known + '<small>字</small></div></div>' +
          '<div class="stat unk"><div class="k">要练习的</div><div class="v">' + st.unknown + '<small>字</small></div></div>' +
          '<div class="stat"><div class="k">还没测过</div><div class="v">' + st.untested + '<small>字</small></div></div>' +
          '<div class="stat"><div class="k">进度</div><div class="v">' + st.levelNo + '/' + st.totalLevels + '<small>关</small></div></div>' +
        '</div>' +

        '<div class="main-actions">' +
          levelCard + practiceCard + libCard +
        '</div>' +

        '<div class="card">' +
          '<h2><span class="dot"></span>谁来判？</h2>' +
          '<div class="mode-row">' + modeCards + '</div>' +
        '</div>' +

        '<div class="home-foot">' +
          '<button class="btn ghost" id="gearBtn" title="家长设置（长按 2 秒）">' + svg('gear', 18) + '家长设置</button>' +
          '<button class="btn ghost" id="guideBtn">怎么玩</button>' +
        '</div>' +
      '</div>';

    wrap.querySelectorAll('[data-go]').forEach(function (b) {
      b.addEventListener('click', function () {
        Sfx.unlock();
        var g = b.dataset.go;
        if (g === 'level') ensureGuide(function () { startLevelRound(); });
        else if (g === 'practice') startPracticeRound();
        else if (g === 'library') renderLibrary();
      });
    });
    wrap.querySelectorAll('[data-mode]').forEach(function (b) {
      b.addEventListener('click', function () { settings.mode = b.dataset.mode; saveSettings(); Sfx.tap(); renderHome(); });
    });
    $('#guideBtn').addEventListener('click', function () { showGuide(); });
    bindGear($('#gearBtn'), true);
  }

  function bindGear(btn, allowClick) {
    if (!btn) return;
    var t = null, ring = null;
    function clear() { if (t) { clearTimeout(t); t = null; } if (ring) { ring.remove(); ring = null; } }
    function down(e) {
      e.preventDefault();
      var r = btn.getBoundingClientRect();
      ring = el('div', 'hold-ring on', '<svg width="60" height="60"><circle cx="30" cy="30" r="24" stroke-dasharray="151" stroke-dashoffset="151"></circle></svg>');
      ring.style.left = (r.left + r.width / 2 - 30) + 'px';
      ring.style.top = (r.top + r.height / 2 - 30) + 'px';
      document.body.appendChild(ring);
      var c = ring.querySelector('circle');
      c.style.transition = 'stroke-dashoffset 2s linear';
      requestAnimationFrame(function () { c.style.strokeDashoffset = '0'; });
      t = setTimeout(function () { clear(); openSheet(); }, 2000);
    }
    btn.addEventListener('pointerdown', down);
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) { btn.addEventListener(ev, clear); });
    if (allowClick) btn.addEventListener('click', function () { clear(); openSheet(); });
  }

  /* ---------------- 玩法说明 ----------------
     首次进入会自动弹一次；右上角 ✕、点遮罩、按 Esc 都能关掉。
     「我知道啦」= 关掉并继续待办动作；✕ / 遮罩 = 只关掉，不继续。 */
  function showGuide(then) {
    var ov = el('div', 'overlay');
    ov.innerHTML = '<div class="box">' +
      '<button class="x" id="gClose" aria-label="关闭" title="关闭">' + svg('close', 18) + '</button>' +
      '<h2>怎么玩？</h2>' +
      '<div class="demo">' +
        '<div class="mini" style="border-color:' + '#F5B95C' + ';background:#FFF1DC;color:#B4720F;font-size:20px;font-weight:800">认识</div>' +
        '<div class="arw">←</div><div class="mini">木</div><div class="arw">→</div>' +
        '<div class="mini" style="border-color:#9FB3C8;background:#EDF2F7;color:#42566A;font-size:20px;font-weight:800">不认识</div>' +
      '</div>' +
      '<p>中间会蹦出一个大字，<b>认识就往左滑</b>，<b>不认识就往右滑</b>。<br>' +
      '滑不动也没关系——下面两个大按钮点一下就行。<br>' +
      '点卡片右上角的小喇叭可以听这个字怎么读；点「看拼音」会显示拼音和组词。</p>' +
      '<div class="foot"><button class="btn primary" id="gOk">我知道啦</button></div>' +
      '</div>';
    document.body.appendChild(ov);

    function done(go) {
      document.removeEventListener('keydown', onKey);
      ov.remove();
      settings.seenGuide = true; saveSettings();   // 关掉就不再自动弹（首页「怎么玩」可随时再看）
      if (go && then) then();
    }
    function onKey(e) { if (e.key === 'Escape') done(false); }

    ov.querySelector('#gOk').addEventListener('click', function () { done(true); });
    ov.querySelector('#gClose').addEventListener('click', function () { done(false); });
    ov.addEventListener('click', function (e) { if (e.target === ov) done(false); });
    document.addEventListener('keydown', onKey);
  }
  function ensureGuide(fn) { if (settings.seenGuide) fn(); else showGuide(fn); }

  /* ===========================================================
     认字页
     =========================================================== */

  // 关卡：从「还没测过的字」里按难度取前 N 个
  function currentLevelChars() {
    var per = S.config.perLevel || 20;
    return untested().slice(0, per);
  }
  // 练习：从「不认识的池子」里取 N 个，错得多的、最近错的优先
  function currentPracticeChars() {
    var per = S.config.perPractice || 10;
    var list = unknownList().slice();
    list.sort(function (a, b) {
      var pa = S.progress[a.c] || { u: 0, t: 0 }, pb = S.progress[b.c] || { u: 0, t: 0 };
      return (pb.u - pa.u) || (pb.t - pa.t);
    });
    return list.slice(0, per);
  }

  function startLevelRound() {
    var chars = currentLevelChars();
    if (!chars.length) { alertBox('太棒了，所有字都测完啦！'); return; }
    beginRound('level', chars);
  }
  function startPracticeRound() {
    var chars = currentPracticeChars();
    if (!chars.length) { alertBox('现在没有需要练习的字。'); return; }
    beginRound('practice', chars);
  }
  function alertBox(msg) {
    var ov = el('div', 'overlay');
    ov.innerHTML = '<div class="box"><p>' + esc(msg) + '</p><div class="foot"><button class="btn primary" data-x="1">好</button></div></div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function (e) { if (e.target.closest('[data-x]')) ov.remove(); });
  }

  function beginRound(kind, chars) {
    S.round = {
      kind: kind,
      levelNo: kind === 'level' ? (S.stats.levelNo || 1) : 0,
      chars: chars.map(function (x) { return x.c; }),
      idx: 0,
      marks: {},
      mode: settings.mode,
      startedAt: Date.now(),
      cardShownAt: 0,
      dwells: [],
      combo: 0, maxCombo: 0,
      tooFast: 0,
      energyGain: 0,
      locked: false,
      saved: false
    };
    show('play');
    paintPlay();
    renderCard(true);
  }

  function paintPlay() {
    var r = S.round;
    var isPractice = r.kind === 'practice';
    var modeTag = (isPractice ? '练习模式 · ' : '') + (r.mode === 'parent' ? '家长判读' : '孩子自己滑');
    var n = r.chars.length;

    $('#play').innerHTML =
      '<div class="hud">' +
        '<button class="icon-btn" id="quitBtn" title="退出这一局" aria-label="退出">' + svg('arrowL', 20) + '</button>' +
        '<div class="prog-wrap">' +
          '<div class="prog-txt"><span id="pgTxt">第 1 / ' + n + ' 张</span><span id="pgLeft">' +
            (isPractice ? '练一练不认得的字' : ('第 ' + r.levelNo + ' 关 · 还剩 ' + n + ' 张')) + '</span></div>' +
          '<div class="prog-bar"><div class="prog-fill" id="pgFill"></div></div>' +
        '</div>' +
        '<div class="counts">' +
          '<span class="c-know">认识 <b id="nKnow">0</b></span>' +
          '<span class="c-unk">不认识 <b id="nUnk">0</b></span>' +
        '</div>' +
        '<div class="energy">' + svg('bolt', 16, '#E1A02A') + '<span id="nEnergy">' + energy + '</span></div>' +
        '<span class="mode-tag">' + esc(modeTag) + '</span>' +
      '</div>' +

      '<div class="board">' +
        '<div class="zone" id="zoneKnow">' +
          '<div class="z-glow"></div>' +
          '<div class="z-body">' +
            '<div class="z-icon">' + svg('smile', 54, '#F08C1E') + '</div>' +
            '<div class="z-title">认识</div>' +
            '<div class="z-hint">往左滑到这里</div>' +
            '<div class="z-count" id="zkCount">0 个</div>' +
          '</div>' +
        '</div>' +
        '<div class="card-stage" id="stage"></div>' +
        '<div class="zone" id="zoneUnk">' +
          '<div class="z-glow"></div>' +
          '<div class="z-body">' +
            '<div class="z-icon">' + svg('ask', 54, '#5E7185') + '</div>' +
            '<div class="z-title">不认识</div>' +
            '<div class="z-hint">往右滑到这里</div>' +
            '<div class="z-count" id="zuCount">0 个</div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="actions">' +
        '<button class="big-btn know" id="btnKnow">' + svg('check', 26) + '<span>' + (r.mode === 'parent' ? '读对了' : '我认识') + '</span></button>' +
        '<button class="big-btn unk" id="btnUnk">' + svg('ring', 26) + '<span>' + (r.mode === 'parent' ? '没读对' : '还不认识') + '</span></button>' +
      '</div>' +
      '<div class="toast-layer" id="toasts"></div>';

    // ★ 返回按钮修复：用 pointerup 直接响应 + 自定义确认弹层，不再依赖原生 confirm()
    var quit = $('#quitBtn');
    quit.addEventListener('click', onQuit);
    quit.addEventListener('pointerup', function (e) { e.stopPropagation(); });

    $('#btnKnow').addEventListener('click', function () { answer('know'); });
    $('#btnUnk').addEventListener('click', function () { answer('unk'); });
    updateHud();
  }

  function onQuit(e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    if (!S.round) { show('home'); renderHome(); return; }
    var done = Object.keys(S.round.marks).length;
    confirmBox({
      title: '先退出这一局吗？',
      body: done
        ? '已经答了 <b>' + done + '</b> 张，进度会自动保存，下次接着来。'
        : '这一局还没开始答，退出不会丢东西。',
      ok: '退出', cancel: '继续玩'
    }).then(function (yes) {
      if (!yes) return;
      if (done) submitCurrentRound(true);
      S.round = null;
      clearInterval(S._dwellTimer);
      show('home'); renderHome();
    });
  }

  function updateHud() {
    var r = S.round; if (!r) return;
    var n = r.chars.length, i = r.idx;
    var know = 0, unk = 0;
    Object.keys(r.marks).forEach(function (c) { if (r.marks[c] === 'known') know++; else unk++; });
    var f = $('#pgFill'); if (f) f.style.width = (i / n * 100) + '%';
    var gt = $('#pgTxt'); if (gt) gt.textContent = '第 ' + Math.min(i + 1, n) + ' / ' + n + ' 张';
    var gl = $('#pgLeft');
    if (gl) gl.textContent = r.kind === 'practice' ? '练一练不认得的字' : ('第 ' + r.levelNo + ' 关 · 还剩 ' + Math.max(0, n - i) + ' 张');
    var nk = $('#nKnow'); if (nk) nk.textContent = know;
    var nu = $('#nUnk'); if (nu) nu.textContent = unk;
    var ne = $('#nEnergy'); if (ne) ne.textContent = energy;
    var zk = $('#zkCount'); if (zk) zk.textContent = know + ' 个';
    var zu = $('#zuCount'); if (zu) zu.textContent = unk + ' 个';
  }

  /* ---------------- 渲染一张卡 ---------------- */
  function renderCard(first) {
    var r = S.round; if (!r) return;
    var stage = $('#stage'); if (!stage) return;
    cleanupDrag();
    if (r.idx >= r.chars.length) { finishRound(); return; }

    var c = r.chars[r.idx];
    var info = S.byChar[c] || { c: c, p: '', w: [], s: 0 };
    var isPractice = r.kind === 'practice';
    // 练习模式默认展示拼音与组词；关卡测试时默认收起（避免看拼音蒙对）
    var revealOn = isPractice || settings.showPinyin;

    stage.innerHTML =
      '<div class="hanzi-card enter" id="card">' +
        '<div class="stamp know">认识</div>' +
        '<div class="stamp unk">不认识</div>' +
        '<button class="speak" id="speakBtn" title="听读音">' + svg('speaker', 22, '#B4720F') + '</button>' +
        '<div class="glyph">' + esc(c) + '</div>' +
        '<div class="py-line">' +
          '<span class="pinyin ' + (revealOn ? 'show' : '') + '" id="py">' + esc(info.p || '') + '</span>' +
        '</div>' +
        '<div class="words ' + (revealOn ? 'show' : '') + '" id="words">' +
          (info.w && info.w.length
            ? info.w.map(function (w) { return '<span class="wd">' + esc(w) + '</span>'; }).join('')
            : '<span class="wd" style="opacity:.6">（这个字暂时没有组词）</span>') +
        '</div>' +
        '<div class="py-line">' +
          '<button class="reveal" id="revealBtn">' + (revealOn ? '收起拼音和组词' : '看拼音和组词') + '</button>' +
        '</div>' +
        '<div class="dwell" id="dwellTxt"></div>' +
      '</div>' +
      (isPractice ? '<div class="practice-note">练会了就点「我认识」，它就会进「我的字库」</div>' : '');

    var card = $('#card');
    r.cardShownAt = performance.now();
    r.locked = false;
    r.drag = null;

    $('#speakBtn').addEventListener('click', function (e) { e.stopPropagation(); Talk.say(c); Sfx.tap(); });
    $('#revealBtn').addEventListener('click', function (e) {
      e.stopPropagation();
      var on = $('#words').classList.toggle('show');
      $('#py').classList.toggle('show', on);
      e.target.textContent = on ? '收起拼音和组词' : '看拼音和组词';
    });

    bindDrag(card);

    clearInterval(S._dwellTimer);
    S._dwellTimer = setInterval(function () {
      var d = $('#dwellTxt');
      if (!d || !S.round || S.round.locked) return;
      var sec = (performance.now() - S.round.cardShownAt) / 1000;
      d.textContent = sec.toFixed(1) + ' 秒';
      d.style.opacity = sec > 8 ? '0.4' : '0.7';
    }, 200);
  }

  /* ---------------- 拖拽（window 级监听，避免 setPointerCapture 吞事件） ---------------- */
  // 每次换卡都先清掉上一张卡残留的 window 级监听，避免监听器累积导致重复判定
  function cleanupDrag() { if (S._dragCleanup) { S._dragCleanup(); S._dragCleanup = null; } }

  function bindDrag(card) {
    var r = S.round;
    cleanupDrag();

    function onDown(e) {
      if (!r || r.locked) return;
      if (e.target.closest('.speak') || e.target.closest('.reveal')) return;
      r.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0 };
      card.classList.add('dragging');
      card.style.transition = 'none';
      Sfx.pick();
    }
    function onMove(e) {
      if (!r.drag || e.pointerId !== r.drag.id) return;
      r.drag.dx = e.clientX - r.drag.x0;
      r.drag.dy = e.clientY - r.drag.y0;
      applyDrag(card, r.drag.dx, r.drag.dy);
      if (e.cancelable) e.preventDefault();
    }
    function onUp(e) {
      if (!r.drag || e.pointerId !== r.drag.id) return;
      var dx = r.drag.dx, dy = r.drag.dy;
      r.drag = null;
      cleanup();
      card.classList.remove('dragging');
      var w = card.offsetWidth || 300;
      var side = null;
      if (dx < -w * 0.28) side = 'know';
      else if (dx > w * 0.28) side = 'unk';
      if (!side) {
        resetCard(card);
        setZoneGlow(null, 0);
        // 上面 cleanup() 已经摘掉了这张卡的全部拖拽监听。
        // 这里是「拖了但没到位、松手弹回」的分支，必须重新绑定，
        // 否则这张卡从此再也拖不动（只能用底部按钮），直到换下一张卡。
        bindDrag(card);
        return;
      }
      flyOut(card, side, dy, function () { answer(side, true); });
    }
    function cleanup() {
      card.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (S._dragCleanup === cleanup) S._dragCleanup = null;
    }
    S._dragCleanup = cleanup;

    card.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  function applyDrag(card, dx, dy) {
    var rot = Math.max(-14, Math.min(14, dx / 18));
    card.style.transform = 'translate3d(' + dx + 'px,' + (dy * 0.28) + 'px,0) rotate(' + rot + 'deg)';
    var w = card.offsetWidth || 300;
    var p = Math.min(1, Math.abs(dx) / (w * 0.5));
    card.style.setProperty('--dragp', p.toFixed(3));
    if (dx < -6) { card.classList.add('to-know'); card.classList.remove('to-unk'); setZoneGlow('know', p); }
    else if (dx > 6) { card.classList.add('to-unk'); card.classList.remove('to-know'); setZoneGlow('unk', p); }
    else { card.classList.remove('to-know', 'to-unk'); setZoneGlow(null, 0); }
  }

  function setZoneGlow(side, p) {
    var zk = $('#zoneKnow'), zu = $('#zoneUnk');
    if (!zk || !zu) return;
    zk.style.setProperty('--glow', side === 'know' ? p.toFixed(3) : 0);
    zu.style.setProperty('--glow', side === 'unk' ? p.toFixed(3) : 0);
    zk.classList.toggle('active', side === 'know' && p > 0.14);
    zu.classList.toggle('active', side === 'unk' && p > 0.14);
  }

  function resetCard(card) {
    card.classList.remove('to-know', 'to-unk');
    card.style.setProperty('--dragp', 0);
    card.style.transition = 'transform .3s cubic-bezier(.34,1.4,.5,1)';
    card.style.transform = '';
  }

  function flyOut(card, side, dy, done) {
    var dir = side === 'know' ? -1 : 1;
    var x = dir * (window.innerWidth * 0.95);
    var rot = dir * 15;
    card.style.transition = 'transform .32s cubic-bezier(.3,.85,.4,1), opacity .32s ease';
    card.style.transform = 'translate3d(' + x + 'px,' + ((dy || 0) * 0.25 + 20) + 'px,0) rotate(' + rot + 'deg)';
    card.style.opacity = '.12';
    var zone = side === 'know' ? $('#zoneKnow') : $('#zoneUnk');
    if (zone) {
      zone.classList.add(side === 'know' ? 'flash-know' : 'flash-unk');
      setTimeout(function () { zone.classList.remove('flash-know', 'flash-unk'); }, 520);
    }
    setTimeout(function () { if (done) done(); }, 240);
  }

  /* ---------------- 作答 ----------------
     side: 'know' | 'unk'
     fromSwipe: true 表示这次是手势滑出来的（卡片在 onUp 里已经飞出去了），
                此时不要再补一次飞出动画；按钮 / 键盘通道传 false，
                由这里调用同一个 flyOut()，让卡片按相同方向、相同动画飞出去。 */
  function answer(side, fromSwipe) {
    var r = S.round;
    if (!r || r.locked) return;
    r.locked = true;
    clearInterval(S._dwellTimer);

    var c = r.chars[r.idx];
    var dwell = performance.now() - r.cardShownAt;
    var status = side === 'know' ? 'known' : 'unknown';

    r.marks[c] = status;
    r.dwells.push(dwell);

    // 本地乐观更新（不等后端，界面立刻反映）
    var p = S.progress[c] || { st: null, k: 0, u: 0, t: 0 };
    p.st = status;
    if (status === 'known') p.k++; else p.u++;
    p.t = Date.now();
    S.progress[c] = p;

    // 积分只奖励「完成」，不奖励「认识」
    var tooFast = dwell < 400;
    var gain = tooFast ? 0 : 5;
    if (tooFast) { r.tooFast++; r.combo = 0; }
    else {
      r.combo++;
      if (r.combo % 5 === 0) { gain += 10; Sfx.combo(); floatText(window.innerWidth / 2 - 40, window.innerHeight * 0.36, '连击 +10', '#D98315'); }
      r.maxCombo = Math.max(r.maxCombo, r.combo);
    }
    var before = energy;
    energy += gain;
    r.energyGain += gain;
    saveEnergy();

    if (gain) {
      var card = $('#card');
      var rect = card ? card.getBoundingClientRect() : null;
      var fx = rect ? rect.left + rect.width / 2 - 16 : window.innerWidth / 2;
      var fy = rect ? rect.top + 14 : window.innerHeight / 2;
      // 注意：飘字要在卡片飞出前取位置
      floatText(fx, fy, '+' + gain, side === 'know' ? '#D98315' : '#5E7185');
    }
    if (side === 'know') { Sfx.know(); buzz(14); } else { Sfx.unk(); buzz(24); }
    if (titleRank(energy) > titleRank(before)) setTimeout(function () { showLevelUp(titleOf(energy)); }, 400);

    // 按钮 / 键盘通道：补一次和手势完全相同的飞出动画（含投放区闪光）
    if (!fromSwipe) {
      var fly = $('#card');
      if (fly) flyOut(fly, side, 0, null);
    }

    cleanupDrag();
    r.idx++;
    recalcStats();
    updateHud();
    setZoneGlow(null, 0);
    // 手势通道：answer() 本身是在 240ms 后才被调用的，沿用原来的节奏
    setTimeout(function () { renderCard(false); }, fromSwipe ? (tooFast ? 190 : 300) : 340);
  }

  function showLevelUp(name) {
    Sfx.levelup();
    var d = el('div', 'levelup', '<div class="inner"><div class="medal">' + svg('medal', 80) + '</div>' +
      '<div class="t1">能量满啦！新的称号是</div><div class="t2">' + esc(name) + '</div></div>');
    document.body.appendChild(d);
    setTimeout(function () { d.remove(); }, 2000);
  }

  /* ===========================================================
     结算 + 上传
     =========================================================== */
  function finishRound() {
    var r = S.round; if (!r) return;
    clearInterval(S._dwellTimer);
    energy += 20; r.energyGain += 20; saveEnergy();
    Sfx.finish();
    submitCurrentRound(false);
    var know = [], unk = [];
    r.chars.forEach(function (c) { if (r.marks[c] === 'known') know.push(c); else if (r.marks[c] === 'unknown') unk.push(c); });

    var answered = know.length + unk.length || 1;
    var avgDwell = r.dwells.length ? r.dwells.reduce(function (a, b) { return a + b; }, 0) / r.dwells.length : 0;
    var stars = 1;
    if (avgDwell >= 1200) stars++;
    if (r.maxCombo >= 10) stars++;
    if (r.tooFast > r.chars.length * 0.3) stars = 1;

    recalcStats();
    renderResult({
      kind: r.kind, levelNo: r.levelNo, mode: r.mode,
      know: know, unk: unk, avgDwell: avgDwell, stars: stars,
      unkTotal: S.stats.unknown, knownTotal: S.stats.known, remaining: S.stats.untested
    });
    S.round = null;
    show('result');
  }

  function submitCurrentRound(silent) {
    var r = S.round; if (!r || r.saved) return;
    r.saved = true;
    var payload = {
      kind: r.kind,
      levelNo: r.levelNo,
      mode: r.mode,
      marks: r.marks,
      avgDwell: r.dwells.length ? Math.round(r.dwells.reduce(function (a, b) { return a + b; }, 0) / r.dwells.length) : 0,
      stars: 0,
      device: navigator.platform || '',
      startedAt: r.startedAt,
      endedAt: Date.now()
    };
    apiPost('/round', payload).then(function (res) {
      if (res && res.progress) { S.progress = res.progress; if (res.stats) S.stats = res.stats; }
    }).catch(function () { queuePending(payload); });
  }

  function renderResult(res) {
    var stars = '';
    for (var i = 0; i < 3; i++) stars += '<svg viewBox="0 0 24 24" width="34" height="34"><g fill="' + (i < res.stars ? '#F08C1E' : '#E3DDD5') + '">' + icon('star') + '</g></svg>';

    var title = res.kind === 'practice' ? '练习完成！' : ('第 ' + res.levelNo + ' 关完成！');
    var learned = res.know.length;
    var res$ = $('#result');
    res$.innerHTML =
      '<div class="res-wrap">' +
        '<div class="res-head">' +
          '<div><h1>' + esc(title) + '</h1>' +
          '<div class="sub">' + new Date().toLocaleString('zh-CN') + '　·　' + (res.mode === 'parent' ? '家长判读' : '孩子自己滑') + '　·　平均每张 ' + (res.avgDwell / 1000).toFixed(1) + ' 秒</div></div>' +
          '<div class="stars">' + stars + '</div>' +
        '</div>' +

        '<div class="metrics">' +
          '<div class="metric know"><div class="k">' + svg('smile', 15, '#F08C1E') + '认识</div><div class="v">' + res.know.length + '<small>字</small></div></div>' +
          '<div class="metric unk"><div class="k">' + svg('ask', 15, '#5E7185') + '不认识</div><div class="v">' + res.unk.length + '<small>字</small></div></div>' +
          '<div class="metric new"><div class="k">累计认识</div><div class="v">' + res.knownTotal + '<small>字</small></div></div>' +
          '<div class="metric"><div class="k">还没测过</div><div class="v">' + res.remaining + '<small>字</small></div></div>' +
        '</div>' +

        '<div class="tip">' +
          (res.kind === 'practice'
            ? '练会了（这次答「认识」）的字已经进「我的字库」；还答错的会留在练习库里，下次优先再练。'
            : '答「认识」的字出了关卡池、进了「我的字库」；答「不认识」的进了练习库，下次按 10 个一组练。') +
        '</div>' +

        '<div class="res-cols">' +
          '<div class="card"><div class="list-head"><h3 class="c-know">这次认识的</h3><span class="n">' + res.know.length + ' 个</span></div>' + chips(res.know, 'know') + '</div>' +
          '<div class="card"><div class="list-head"><h3 class="c-unk">这次不认识的（进了练习库）</h3><span class="n">' + res.unk.length + ' 个</span></div>' + chips(res.unk, 'unk') + '</div>' +
        '</div>' +

        '<div class="res-actions">' +
          (res.remaining > 0 ? '<button class="btn primary" id="nextBtn">继续下一关</button>' : '') +
          (res.unkTotal > 0 ? '<button class="btn" id="practiceBtn">练一练（' + Math.min(10, res.unkTotal) + ' 个字）</button>' : '') +
          '<button class="btn ghost" id="homeBtn">回到首页</button>' +
          '<button class="btn ghost" id="libraryBtn">我的字库</button>' +
        '</div>' +
      '</div>';

    var nb = $('#nextBtn'); if (nb) nb.addEventListener('click', function () { Sfx.tap(); startLevelRound(); });
    var pb = $('#practiceBtn'); if (pb) pb.addEventListener('click', function () { Sfx.tap(); startPracticeRound(); });
    $('#homeBtn').addEventListener('click', function () { Sfx.tap(); show('home'); renderHome(); });
    $('#libraryBtn').addEventListener('click', function () { Sfx.tap(); renderLibrary(); });
  }

  function chips(list, cls) {
    if (!list.length) return '<div class="empty-tip">（没有）</div>';
    return '<div class="char-chips">' + list.map(function (c) {
      var i = S.byChar[c] || { p: '' };
      return '<div class="chip ' + cls + '"><div class="c">' + esc(c) + '</div><div class="p">' + esc(i.p || '') + '</div></div>';
    }).join('') + '</div>';
  }

  /* ===========================================================
     我的字库（已认识的字，可复习）
     =========================================================== */
  function renderLibrary() {
    var kn = knownList();
    var wrap = $('#library');
    wrap.innerHTML =
      '<div class="lib-wrap">' +
        '<div class="lib-top">' +
          '<button class="icon-btn" id="libBack">' + svg('arrowL', 20) + '</button>' +
          '<div><h1>我的字库</h1><div class="sub">已经认识的 ' + kn.length + ' 个字 · 点一下能看拼音和组词</div></div>' +
        '</div>' +
        (kn.length
          ? '<div class="lib-grid">' + kn.map(function (x) {
            return '<div class="lib-card"><div class="c">' + esc(x.c) + '</div>' +
              '<div class="p">' + esc(x.p || '') + '</div>' +
              '<div class="w">' + esc((x.w || []).slice(0, 3).join(' ')) + '</div></div>';
          }).join('') + '</div>'
          : '<div class="card" style="text-align:center"><div class="tip">还没有认识的字，先去测一测吧！</div></div>') +
      '</div>';
    $('#libBack').addEventListener('click', function () { Sfx.tap(); show('home'); renderHome(); });
    show('library');
  }

  /* ===========================================================
     设置抽屉
     =========================================================== */
  function openSheet() {
    Sfx.tap();
    var mask = $('#sheetMask'), sheet = $('#sheet');
    function sw(on) { return '<div class="switch ' + (on ? 'on' : '') + '"></div>'; }

    sheet.innerHTML =
      '<button class="icon-btn close" id="sheetClose">' + svg('close', 18) + '</button>' +
      '<h2>家长设置</h2>' +
      '<div class="sheet-sub">首页直接点「家长设置」进入；测试中需要<b>长按 2 秒</b>（防止孩子误入）。</div>' +

      '<div class="row" data-toggle="showPinyin"><div><div class="lab">卡片直接显示拼音</div><div class="desc">默认收起（点了才显示），避免把「认拼音」当成「认字」。练习模式下始终显示。</div></div><div class="ctl">' + sw(settings.showPinyin) + '</div></div>' +
      '<div class="row" data-toggle="sound"><div><div class="lab">音效</div><div class="desc">滑动、落位、连击、升级音</div></div><div class="ctl">' + sw(settings.sound) + '</div></div>' +

      '<div class="row" style="border:none"><div><div class="lab">重新同步数据</div><div class="desc">从云端重新拉取字表与进度</div></div><div class="ctl"><button class="btn sm" id="resyncBtn">重新同步</button></div></div>' +

      '<div class="sheet-sub" style="margin-top:18px">判定模式（谁来判）和当前进度都直接显示在首页，这里不再重复。这里是孩子端，只放孩子能看的设置；新增汉字、查看完整字库请在家长管理页操作。</div>';

    mask.classList.add('on'); sheet.classList.add('on');
    function close() { mask.classList.remove('on'); sheet.classList.remove('on'); }
    $('#sheetClose').addEventListener('click', close);
    mask.onclick = close;

    sheet.querySelectorAll('.row[data-toggle]').forEach(function (row) {
      row.style.cursor = 'pointer';
      row.addEventListener('click', function () {
        var k = row.dataset.toggle;
        settings[k] = !settings[k];
        if (k === 'sound' && settings.sound) Sfx.tap();
        saveSettings(); openSheet();
      });
    });
    $('#resyncBtn').addEventListener('click', function () {
      close(); loadBootstrap(true);
    });
  }

  /* ===========================================================
     启动
     =========================================================== */
  function loadBootstrap(isRetry) {
    S.loaded = false;
    if (isRetry) { show('home'); renderHome(); }
    return apiGet('/bootstrap').then(function (res) {
      S.chars = res.chars || [];
      S.byChar = {};
      S.chars.forEach(function (x) { S.byChar[x.c] = x; });
      S.progress = res.progress || {};
      S.sessions = res.sessions || [];
      S.stats = res.stats || {};
      S.config = res.config || S.config;
      recalcStats();
      S.loaded = true;
      flushPending();
      if (document.body.dataset.screen === 'home' || isRetry) { renderHome(); show('home'); }
    }).catch(function (e) {
      S.loaded = false;
      var wrap = $('#home');
      wrap.innerHTML = '<div class="home-wrap"><div class="card" style="text-align:center;padding:36px 24px">' +
        '<div class="brand-badge" style="margin:0 auto 14px;background:linear-gradient(180deg,#FFC46B,#F08C1E)"><span>字</span></div>' +
        '<h2 style="justify-content:center;font-size:18px">暂时连不上服务器</h2>' +
        '<div class="tip" style="margin:10px 0 18px">' + esc(e && e.message ? e.message : '网络异常') + '<br>请检查网络后重试。</div>' +
        '<button class="btn primary" id="retryBtn">重试</button></div></div>';
      var rb = $('#retryBtn'); if (rb) rb.addEventListener('click', function () { loadBootstrap(true); });
      show('home');
    });
  }

  document.addEventListener('keydown', function (e) {
    if (document.body.dataset.screen !== 'play' || !S.round) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); answer('know'); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); answer('unk'); }
    else if (e.key === ' ') { e.preventDefault(); var c = S.round.chars[S.round.idx]; if (c) Talk.say(c); }
  });

  function init() {
    renderHome();
    show('home');
    loadBootstrap();
    if (!settings.seenGuide) setTimeout(function () { if (S.loaded) showGuide(); }, 600);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  window.__HZ = S;
})();
