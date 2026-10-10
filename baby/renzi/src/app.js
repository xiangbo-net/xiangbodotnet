/* ===========================================================
   汉字小侦探 —— 应用逻辑
   设计要点：
   1) 三条判定通道：拖拽（Pointer Events，鼠标/触摸统一）、底部大按钮、键盘方向键
   2) 双模式：self 自评模式（孩子自己拖）/ parent 家长判读模式（孩子读，家长判对错）
   3) 积分只奖励「完成」，绝不奖励「认识」——否则孩子会为了拿分乱说认识
   4) 落入「不认识」区不做失败音效，避免负反馈
   5) 全部离线：音效用 Web Audio 实时合成，不依赖任何音频文件
   =========================================================== */
(function () {
  'use strict';

  var DATA = window.__HANZI__;
  var ALL = [];
  DATA.groups.forEach(function (g) {
    g.chars.forEach(function (x) { x.level = g.id; ALL.push(x); });
  });
  var CHAR_MAP = {};
  ALL.forEach(function (x) { CHAR_MAP[x.c] = x; });

  var TITLES = [
    { e: 0, n: '新手上路' }, { e: 100, n: '汉字小侦探' }, { e: 300, n: '识字小能手' },
    { e: 600, n: '识字小达人' }, { e: 1000, n: '汉字小博士' }, { e: 2000, n: '汉字大师' }
  ];
  var PER_ROUND_OPTIONS = [10, 20, 30, 50, 100];
  var FAST_MS = 400;        // 低于此停留时间：不计分、不计连击（防乱拖刷分）
  var DWELL_GOAL = 1200;    // 认真作答的平均停留时间

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
      check: '<path d="M4.5 12.5l5 5 10-11" stroke="' + c + '" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
      arrowL: '<path d="M14 6l-6 6 6 6" stroke="' + c + '" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M19 12H8" stroke="' + c + '" stroke-width="2.4" fill="none" stroke-linecap="round"/>',
      arrowR: '<path d="M10 6l6 6-6 6" stroke="' + c + '" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 12h11" stroke="' + c + '" stroke-width="2.4" fill="none" stroke-linecap="round"/>',
      thumb: '<path d="M6 20V9.6l4.6-7.1c1.5 0 2.4 1.2 2.4 2.6 0 .8-.5 2.7-.7 3.4h5.2c1.4 0 2.4 1.3 2.1 2.6l-1.5 6.4c-.2 1-1.1 1.7-2.1 1.7H6z" fill="' + c + '"/><rect x="2.4" y="9.6" width="3.2" height="10.4" rx="1.2" fill="' + c + '"/>',
      chevU: '<path d="M6 14.5l6-6 6 6" stroke="' + c + '" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
      chevD: '<path d="M6 9.5l6 6 6-6" stroke="' + c + '" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
      medal: '<circle cx="12" cy="14.5" r="7" fill="#F5B95C"/><circle cx="12" cy="14.5" r="5" fill="#F08C1E"/><path d="M12 10.6l1.3 2.7 3 .4-2.2 2 .6 2.9-2.7-1.5-2.7 1.5.6-2.9-2.2-2 3-.4 1.3-2.7z" fill="#fff"/><path d="M8.5 8.5 6.4 1.6h4.2l1.4 6.3zM15.5 8.5l2.1-6.9h-4.2l-1.4 6.3z" fill="#E0A24C"/>',
      close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" stroke="' + c + '" stroke-width="2.2" fill="none" stroke-linecap="round"/>'
    };
    return p[name] || '';
  }
  function svg(name, size, color) {
    return '<svg viewBox="0 0 24 24" width="' + (size || 24) + '" height="' + (size || 24) + '">' + icon(name, color) + '</svg>';
  }

  /* ---------------- 存储 ---------------- */
  var KEY = 'hzdet.';
  function ls(key, val) {
    try {
      if (val === undefined) { var r = localStorage.getItem(KEY + key); return r ? JSON.parse(r) : null; }
      localStorage.setItem(KEY + key, JSON.stringify(val));
    } catch (e) { }
    return null;
  }

  var settings = Object.assign({
    mode: 'self', level: 1, perRound: 20, review: false,
    sound: true, speak: true, showPinyin: false, seenGuide: false
  }, ls('settings') || {});
  var energy = ls('energy') || 0;
  var history = ls('history') || [];
  var charState = ls('chars') || {};
  var progress = ls('progress') || null;
  function saveSettings() { ls('settings', settings); }
  function saveAll() { ls('chars', charState); ls('energy', energy); ls('history', history); }

  /* ---------------- 音效（Web Audio 实时合成，零音频文件） ---------------- */
  var Sfx = (function () {
    var ctx = null;
    function ac() {
      if (!settings.sound) return null;
      try {
        if (!ctx) {
          var AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return null;
          ctx = new AC();
        }
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
        if (!settings.speak || !('speechSynthesis' in window)) return;
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
  function show(id) {
    ['home', 'play', 'result'].forEach(function (s) { $('#' + s).classList.toggle('on', s === id); });
    document.body.dataset.screen = id;
  }
  function titleOf(e) { var t = TITLES[0].n; TITLES.forEach(function (x) { if (e >= x.e) t = x.n; }); return t; }
  function estimateLevel(e) { var r = 0; TITLES.forEach(function (x) { if (e >= x.e) r = x.e; }); return r; }

  /* ---------------- 版面方向 ----------------
     手机（≤640px）三区竖排 → 上滑=认识 / 下滑=不认识
     平板与桌面仍是左右两区 → 左拖=认识 / 右拖=不认识     */
  function vertMode() { return !!(window.matchMedia && window.matchMedia('(max-width:640px)').matches); }
  // 从真实布局判断：两个投放区是否上下关系（比媒体查询更可靠，旋转后自动跟随）
  function zoneVert() {
    var zk = $('#zoneKnow'), zu = $('#zoneUnk');
    if (zk && zu) {
      var a = zk.getBoundingClientRect(), b = zu.getBoundingClientRect();
      if (a.width && b.width) return a.bottom <= b.top + 8;
    }
    return vertMode();
  }
  function buzz(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { } }

  function floatText(x, y, text, color) {
    var layer = $('#toasts');
    var d = el('div', 'float', text);
    d.style.left = x + 'px'; d.style.top = y + 'px';
    if (color) d.style.color = color;
    layer.appendChild(d);
    setTimeout(function () { d.remove(); }, 1050);
  }

  /* ---------------- 首页 ---------------- */
  function totalKnown() { return Object.keys(charState).filter(function (c) { return charState[c].last === 'know'; }).length; }
  function unknownList() { return Object.keys(charState).filter(function (c) { return charState[c].last === 'unk' && CHAR_MAP[c]; }); }

  function renderHome() {
    var wrap = $('#home');
    var known = totalKnown();
    var reviewN = unknownList().length;
    var lv = DATA.groups[settings.level - 1];

    var v = vertMode();
    var modeCards = [
      { k: 'self', t: '孩子自己拖', d: v ? '孩子认识就往上滑，不认识往下滑。家长在旁边陪着就行。' : '孩子认识就往左拖，不认识往右拖。家长在旁边陪着就行。' },
      { k: 'parent', t: '家长判读（更准）', d: '让孩子把字读出来，家长点「读对了 / 没读对」。结果更可信。' }
    ].map(function (m) {
      return '<button class="mode ' + (settings.mode === m.k ? 'on' : '') + '" data-mode="' + m.k + '">' +
        '<div class="t">' + m.t + '</div><div class="d">' + m.d + '</div></button>';
    }).join('');

    var levels = DATA.groups.map(function (g) {
      var done = history.some(function (h) { return h.level === g.id; });
      return '<button class="lv ' + (settings.level === g.id ? 'on' : '') + (done ? ' done' : '') + '" data-level="' + g.id + '">' +
        '<span class="n">第' + g.id + '关</span><span class="s">' + g.avgStroke + '画</span></button>';
    }).join('');

    var perBtns = PER_ROUND_OPTIONS.map(function (n) {
      return '<button class="pill ' + (settings.perRound === n ? 'on' : '') + '" data-per="' + n + '">' + n + ' 张</button>';
    }).join('');

    wrap.innerHTML =
      '<div class="home-wrap">' +
        '<div class="brand">' +
          '<div class="brand-badge"><span>字</span></div>' +
          '<div><h1>汉字小侦探</h1><p>看看我认识多少个字 · 一共 ' + ALL.length + ' 个字，' + DATA.groups.length + ' 关，由简单到复杂</p></div>' +
        '</div>' +

        '<div class="stat-strip">' +
          '<div class="stat"><div class="k">累计认识</div><div class="v">' + known + '<small>字</small></div></div>' +
          '<div class="stat"><div class="k">待复习</div><div class="v">' + reviewN + '<small>字</small></div></div>' +
          '<div class="stat"><div class="k">能量</div><div class="v">' + energy + '</div></div>' +
          '<div class="stat"><div class="k">称号</div><div class="v" style="font-size:20px">' + titleOf(energy) + '</div></div>' +
        '</div>' +

        '<div class="home-cards">' +
          '<div class="card">' +
            '<h2><span class="dot"></span>怎么玩</h2>' +
            '<div class="mode-row">' + modeCards + '</div>' +
            '<h2 style="margin-top:20px"><span class="dot"></span>选关卡（越往后字越难）</h2>' +
            '<div class="level-grid">' + levels + '</div>' +
            '<div class="tip" style="margin-top:12px">当前第 ' + lv.id + ' 关共 ' + lv.chars.length + ' 字（' + lv.minStroke + '–' + lv.maxStroke + ' 画）。抽测会在这 100 字里均匀挑选，难度由简单到复杂。</div>' +
          '</div>' +
          '<div class="card">' +
            '<h2><span class="dot"></span>这一局测多少字</h2>' +
            '<div class="pill-row">' + perBtns + '</div>' +
            '<div class="tip" style="margin-top:14px">一局 20 张大约 5 分钟，适合 4 岁孩子的注意力时长。想全套测完可以分多次，进度会自动保存。</div>' +
            '<h2 style="margin-top:22px"><span class="dot"></span>上次没测完</h2>' +
            '<div id="resumeBox" class="tip"></div>' +
            '<h2 style="margin-top:22px"><span class="dot"></span>不知道怎么玩</h2>' +
            '<button class="btn sm ghost" id="guideBtn">看玩法说明</button>' +
          '</div>' +
        '</div>' +

        '<div class="home-actions">' +
          '<button class="btn lg primary" id="startBtn">开始测一测</button>' +
          (reviewN >= 5 ? '<button class="btn lg ghost" id="reviewBtn">只练不认识的 ' + reviewN + ' 个字</button>' : '') +
          '<button class="btn ghost" id="gearBtn" title="家长设置（长按 2 秒）">' + svg('gear', 18) + '家长设置</button>' +
        '</div>' +
      '</div>';

    // 事件
    wrap.querySelectorAll('[data-mode]').forEach(function (b) {
      b.addEventListener('click', function () { settings.mode = b.dataset.mode; saveSettings(); Sfx.tap(); renderHome(); });
    });
    wrap.querySelectorAll('[data-level]').forEach(function (b) {
      b.addEventListener('click', function () { settings.level = +b.dataset.level; saveSettings(); Sfx.tap(); renderHome(); });
    });
    wrap.querySelectorAll('[data-per]').forEach(function (b) {
      b.addEventListener('click', function () { settings.perRound = +b.dataset.per; saveSettings(); Sfx.tap(); renderHome(); });
    });
    $('#startBtn').addEventListener('click', function () { Sfx.unlock(); settings.review = false; saveSettings(); ensureGuideThen(startRound); });
    var rb = $('#reviewBtn');
    if (rb) rb.addEventListener('click', function () { Sfx.unlock(); settings.review = true; saveSettings(); ensureGuideThen(startRound); });
    $('#guideBtn').addEventListener('click', showGuide);
    bindGear($('#gearBtn'), true);

    // 续玩提示
    var box = $('#resumeBox');
    if (progress && progress.idx > 0 && progress.idx < progress.queue.length) {
      var left = progress.queue.length - progress.idx;
      box.innerHTML = '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
        '<span>上次测到第 ' + progress.idx + ' / ' + progress.queue.length + ' 张，还剩 <b>' + left + '</b> 张。</span>' +
        '<button class="btn sm" id="resumeBtn">继续测完</button>' +
        '<button class="btn sm ghost" id="dropBtn">不要了</button></div>';
      $('#resumeBtn').addEventListener('click', function () { settings.review = !!progress.review; settings.level = progress.level; settings.perRound = progress.perRound || settings.perRound; settings.mode = progress.mode || settings.mode; saveSettings(); resumeRound(); });
      $('#dropBtn').addEventListener('click', function () { progress = null; ls('progress', null); renderHome(); });
    } else {
      box.textContent = '没有未完成的测试。';
    }
    if (!Talk.available()) { box.innerHTML += '<div style="margin-top:10px;color:#B4720F">本设备没有找到中文语音，卡片上的朗读按钮已隐藏（不影响其他功能）。</div>'; }
  }

  // 长按 2 秒进入家长设置（allowClick：首页那一下可以直接点）
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

  /* ---------------- 玩法说明 ---------------- */
  function showGuide(force) {
    var v = vertMode();
    var demo = v
      ? '<div class="demo demo-v">' +
          '<div class="v-lab"><span class="v-arrow">↑</span>认识的字，往上滑</div>' +
          '<div class="mini">木</div>' +
          '<div class="v-lab down"><span class="v-arrow">↓</span>不认识的字，往下滑</div>' +
        '</div>'
      : '<div class="demo">' +
          '<div class="mini">木</div><div class="arw">←</div>' +
          '<div class="mini" style="border-color:#F5B95C;background:#FFF1DC;color:#B4720F">认识</div>' +
          '<div class="arw">·</div>' +
          '<div class="mini" style="border-color:#9FB3C8;background:#EDF2F7;color:#42566A">不认识</div>' +
          '<div class="arw">→</div><div class="mini">木</div>' +
        '</div>';
    var tip = v
      ? '看到中间的大字，<b>认识就把卡片往上滑</b>，<b>不认识就往下滑</b>。<br>' +
        '滑不动也没关系——下面两个大按钮点一下就行。<br>' +
        '点卡片右上角的小喇叭可以听这个字怎么读。'
      : '看到中间的大字，<b>认识就把卡片往左拖</b>，<b>不认识就往右拖</b>。<br>' +
        '拖不动也没关系——下面两个大按钮点一下就行。<br>' +
        '点卡片右上角的小喇叭可以听这个字怎么读。';
    var g = el('div', 'guide');
    g.innerHTML = '<div class="box">' +
      '<h2>怎么玩？</h2>' + demo +
      '<p>' + tip + '</p>' +
      '<div style="margin-top:20px"><button class="btn primary" id="gOk">我知道啦</button></div>' +
      '</div>';
    document.body.appendChild(g);
    g.querySelector('#gOk').addEventListener('click', function () {
      g.remove(); settings.seenGuide = true; saveSettings(); if (force === 'then') startRound();
    });
  }
  function ensureGuideThen(fn) { if (settings.seenGuide) fn(); else showGuide('then'); }

  /* ---------------- 出题 ---------------- */
  function buildQueue() {
    var pool;
    if (settings.review) {
      var cs = unknownList();
      if (cs.length < 1) { alert('暂时没有需要复习的字，先去测一测吧。'); return null; }
      pool = cs.map(function (c) { return CHAR_MAP[c]; });
    } else {
      pool = DATA.groups[settings.level - 1].chars;
    }
    var n = Math.min(settings.perRound, pool.length);
    var step = pool.length / n, picked = [];
    for (var i = 0; i < n; i++) picked.push(pool[Math.min(pool.length - 1, Math.floor(i * step))]);
    return picked.map(function (x) { return x.c; });
  }

  var round = null;

  function startRound() {
    var q = buildQueue();
    if (!q) return;
    var state = {};
    q.forEach(function (c) { state[c] = charState[c] ? charState[c].last : null; });
    round = {
      queue: q, idx: 0, marks: {}, dwells: [],
      level: settings.level, mode: settings.mode, perRound: settings.perRound,
      review: settings.review, energy: 0, combo: 0, maxCombo: 0,
      prevState: state, startedAt: Date.now(), cardShownAt: 0, locked: false, tooFast: 0
    };
    progress = { queue: q, idx: 0, marks: {}, level: round.level, mode: round.mode, perRound: round.perRound, review: round.review, energy: 0, prevState: state };
    saveProgress();
    show('play');
    paintPlayChrome();
    renderCard(true);
  }

  function resumeRound() {
    if (!progress) return;
    var state = {};
    progress.queue.forEach(function (c) { state[c] = charState[c] ? charState[c].last : null; });
    round = {
      queue: progress.queue, idx: progress.idx, marks: progress.marks || {}, dwells: [],
      level: progress.level, mode: progress.mode, perRound: progress.perRound || settings.perRound,
      review: !!progress.review, energy: progress.energy || 0, combo: 0, maxCombo: 0,
      prevState: progress.prevState || state, startedAt: Date.now(), cardShownAt: 0, locked: false, tooFast: 0
    };
    show('play');
    paintPlayChrome();
    renderCard(true);
  }

  function saveProgress() {
    if (!round) return;
    progress = {
      queue: round.queue, idx: round.idx, marks: round.marks, level: round.level, mode: round.mode,
      perRound: round.perRound, review: round.review, energy: round.energy, prevState: round.prevState
    };
    ls('progress', progress);
  }

  /* ---------------- 测试页外壳 ---------------- */
  // 按当前真实布局刷新：区域提示文案、方向箭头显示与否、底部按钮的键值提示
  function applyOrientation() {
    var board = $('.board');
    if (!board) return;
    var v = zoneVert();
    board.classList.toggle('vert', v);

    var parent = round && round.mode === 'parent';
    var hk = board.querySelector('[data-hint="know"]');
    var hu = board.querySelector('[data-hint="unk"]');
    if (hk) hk.textContent = v ? (parent ? '读对了往上放' : '往上滑到这里') : (parent ? '读对了 → 放这里' : '把卡片拖过来松手');
    if (hu) hu.textContent = v ? (parent ? '没读对往下放' : '往下滑到这里') : (parent ? '没读对 → 放这里' : '把卡片拖过来松手');

    var k1 = $('[data-key="know"]');
    var k2 = $('[data-key="unk"]');
    if (k1) k1.textContent = v ? '↑' : '←';
    if (k2) k2.textContent = v ? '↓' : '→';
  }

  function paintPlayChrome() {
    var modeTag = round.mode === 'parent' ? '家长判读模式' : '孩子自己拖';
    if (round.review) modeTag = '复习模式 · ' + modeTag;
    $('#play').innerHTML =
      '<div class="hud">' +
        '<button class="icon-btn" id="quitBtn" title="退出">' + svg('arrowL', 18) + '</button>' +
        '<div class="prog-wrap">' +
          '<div class="prog-txt"><span id="pgTxt">第 1 / ' + round.queue.length + ' 张</span><span id="pgLeft">还剩 ' + round.queue.length + ' 张</span></div>' +
          '<div class="prog-bar"><div class="prog-fill" id="pgFill"></div></div>' +
        '</div>' +
        '<div class="counts">' +
          '<span class="c-know">认识 <b id="nKnow">0</b></span>' +
          '<span class="c-unk">还不认识 <b id="nUnk">0</b></span>' +
        '</div>' +
        '<div class="energy">' + svg('bolt', 16, '#E1A02A') + '<span id="nEnergy">' + energy + '</span></div>' +
        '<span class="title-tag" id="tagTitle">' + titleOf(energy) + '</span>' +
        '<span class="mode-tag">' + modeTag + '</span>' +
        '<button class="icon-btn" id="gearBtn2" title="家长设置（长按 2 秒）">' + svg('gear', 18) + '</button>' +
      '</div>' +

      '<div class="board">' +
        '<div class="zone" id="zoneKnow">' +
          '<div class="z-icon">' + svg('smile', 56, '#F08C1E') + '</div>' +
          '<div class="z-title">我认识<span class="z-arrow">' + svg('chevU', 16, '#B4720F') + '</span></div>' +
          '<div class="z-hint" data-hint="know"></div>' +
          '<div class="z-count" id="zkCount">0 个字</div>' +
        '</div>' +
        '<div class="card-stage" id="stage"></div>' +
        '<div class="zone" id="zoneUnk">' +
          '<div class="z-icon">' + svg('ask', 56, '#5E7185') + '</div>' +
          '<div class="z-title">还不认识<span class="z-arrow">' + svg('chevD', 16, '#42566A') + '</span></div>' +
          '<div class="z-hint" data-hint="unk"></div>' +
          '<div class="z-count" id="zuCount">0 个字</div>' +
        '</div>' +
      '</div>' +

      '<div class="actions">' +
        '<button class="big-btn know" id="btnKnow">' + svg('thumb', 26, '#fff') + '<span>' + (round.mode === 'parent' ? '读对了' : '我认识') + '</span><span class="k" data-key="know">←</span></button>' +
        '<button class="big-btn unk" id="btnUnk">' + svg('ask', 26, '#fff') + '<span>' + (round.mode === 'parent' ? '没读对' : '还不认识') + '</span><span class="k" data-key="unk">→</span></button>' +
      '</div>' +
      '<div class="toast-layer" id="toasts"></div>';

    applyOrientation();

    $('#quitBtn').addEventListener('click', function () {
      if (confirm('先退出这一局吗？（进度会保存，下次可以继续）')) { saveProgress(); Sfx.tap(); show('home'); renderHome(); }
    });
    $('#btnKnow').addEventListener('click', function () { answer('know'); });
    $('#btnUnk').addEventListener('click', function () { answer('unk'); });
    bindGear($('#gearBtn2'));
    updateHud();
  }

  function updateHud() {
    if (!round) return;
    var answered = round.idx;
    var know = 0, unk = 0;
    Object.keys(round.marks).forEach(function (c) { if (round.marks[c] === 'know') know++; else unk++; });
    var total = round.queue.length;
    var f = $('#pgFill'); if (f) f.style.width = (answered / total * 100) + '%';
    var gt = $('#pgTxt'); if (gt) gt.textContent = '第 ' + Math.min(answered + 1, total) + ' / ' + total + ' 张';
    var gl = $('#pgLeft'); if (gl) gl.textContent = answered >= total ? '本局完成' : '还剩 ' + (total - answered) + ' 张';
    var nk = $('#nKnow'); if (nk) nk.textContent = know;
    var nu = $('#nUnk'); if (nu) nu.textContent = unk;
    var ne = $('#nEnergy'); if (ne) ne.textContent = energy;
    var tt = $('#tagTitle'); if (tt) tt.textContent = titleOf(energy);
    var zk = $('#zkCount'); if (zk) zk.textContent = know + ' 个字';
    var zu = $('#zuCount'); if (zu) zu.textContent = unk + ' 个字';
  }

  /* ---------------- 渲染一张卡 + 拖拽 ---------------- */
  function renderCard(first) {
    var stage = $('#stage');
    if (!stage) return;
    if (round.idx >= round.queue.length) { finishRound(); return; }
    var ch = round.queue[round.idx];
    var info = CHAR_MAP[ch] || { c: ch, p: '', s: 0, w: [] };

    stage.innerHTML =
      (round.mode === 'parent' ? '<div class="judge-hint">让孩子读出来，家长点「读对了 / 没读对」</div>' : '') +
      '<div class="hanzi-card enter" id="card">' +
        '<button class="speak" id="speakBtn" title="听读音">' + svg('speaker', 22, '#B4720F') + '</button>' +
        '<div class="glyph">' + ch + '</div>' +
        '<div class="sub">' +
          '<span class="pinyin ' + (settings.showPinyin ? 'show' : '') + '" id="py">' + (info.p || '') + '</span>' +
          '<button class="reveal" id="revealBtn">' + (round.mode === 'parent' ? '看答案' : '看拼音') + '</button>' +
        '</div>' +
        '<div class="dwell" id="dwellTxt"></div>' +
      '</div>';

    var card = $('#card');
    round.cardShownAt = performance.now();
    round.locked = false;

    $('#speakBtn').addEventListener('click', function (e) { e.stopPropagation(); Talk.say(ch); Sfx.tap(); });
    $('#revealBtn').addEventListener('click', function (e) {
      e.stopPropagation();
      $('#py').classList.add('show');
      var ex = info.w && info.w.length ? '　组词：' + info.w.join('、') : '';
      e.target.textContent = '共 ' + info.s + ' 画' + ex;
      Talk.say(ch);
    });

    // 触摸/鼠标拖拽
    var drag = null;
    card.addEventListener('pointerdown', function (e) {
      if (round.locked) return;
      if (e.target.closest('.speak') || e.target.closest('.reveal')) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, dy: 0, vert: zoneVert() };
      card.setPointerCapture(e.pointerId);
      card.classList.add('dragging');
      Sfx.pick();
    });
    card.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      drag.dx = e.clientX - drag.x; drag.dy = e.clientY - drag.y;
      // 竖排：主要跟手上下位移，横向只轻微跟随；横排反之
      card.style.transform = drag.vert
        ? 'translate(' + (drag.dx * 0.35) + 'px,' + drag.dy + 'px) rotate(' + (-drag.dx / 60) + 'deg)'
        : 'translate(' + drag.dx + 'px,' + (drag.dy * 0.35) + 'px) rotate(' + (drag.dx / 30) + 'deg)';
      var side = sideAt(e.clientX, e.clientY, card, drag.dx, drag.dy);
      $('#zoneKnow').classList.toggle('hot', side === 'know');
      $('#zoneUnk').classList.toggle('hot', side === 'unk');
    });
    function up(e) {
      if (!drag || e.pointerId !== drag.id) return;
      var dx = drag.dx, dy = drag.dy; drag = null;
      card.classList.remove('dragging');
      var side = sideAt(e.clientX, e.clientY, card, dx, dy);
      $('#zoneKnow').classList.remove('hot');
      $('#zoneUnk').classList.remove('hot');
      if (!side) { card.style.transform = ''; return; }
      fly(card, side, function () { answer(side); });
    }
    card.addEventListener('pointerup', up);
    card.addEventListener('pointercancel', function (e) { if (drag && e.pointerId === drag.id) { drag = null; card.classList.remove('dragging'); card.style.transform = ''; $('#zoneKnow').classList.remove('hot'); $('#zoneUnk').classList.remove('hot'); } });

    // 停留计时显示（给家长看：这张看了多久）
    clearInterval(round._dwellTimer);
    round._dwellTimer = setInterval(function () {
      var d = $('#dwellTxt');
      if (!d || !round || round.locked) return;
      var sec = (performance.now() - round.cardShownAt) / 1000;
      d.textContent = sec.toFixed(1) + ' 秒';
      d.style.opacity = sec > 8 ? '0.45' : '0.75';
    }, 200);

    if (first && settings.speak) setTimeout(function () { if (round && !round.locked) Talk.say(ch); }, 320);
  }

  // 判定落在哪一侧（比单纯看位移宽容很多，孩子拖偏了也算）
  // 竖排：上 = 认识，下 = 不认识；横排：左 = 认识，右 = 不认识
  function sideAt(px, py, card, dx, dy) {
    var zk = $('#zoneKnow').getBoundingClientRect();
    var zu = $('#zoneUnk').getBoundingClientRect();
    var r = card.getBoundingClientRect();
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    function inside(z, x, y) { return x >= z.left && x <= z.right && y >= z.top && y <= z.bottom; }
    // 手指落点在某个区里，或卡片已经被拖到某个区里 → 直接判定
    if (inside(zk, px, py) || inside(zk, cx, cy)) return 'know';
    if (inside(zu, px, py) || inside(zu, cx, cy)) return 'unk';
    if (zoneVert()) {
      // 竖排：位移足够远且以纵向为主就算（手指短、滑不到区域也能命中）
      var tri = Math.max(56, r.height * 0.26);
      if (Math.abs(dy) > tri && Math.abs(dy) > Math.abs(dx) * 0.8) return dy < 0 ? 'know' : 'unk';
    } else {
      var half = r.width * 0.45;
      if (dx < -half) return 'know';
      if (dx > half) return 'unk';
    }
    return null;
  }

  function fly(card, side, done) {
    var zone = side === 'know' ? $('#zoneKnow') : $('#zoneUnk');
    var zr = zone.getBoundingClientRect(), cr = card.getBoundingClientRect();
    var fx = (zr.left + zr.width / 2) - (cr.left + cr.width / 2);
    var fy = (zr.top + zr.height / 2) - (cr.top + cr.height / 2);
    card.style.setProperty('--fx', fx + 'px');
    card.style.setProperty('--fy', fy + 'px');
    card.classList.remove('dragging');
    card.classList.add(side === 'know' ? 'fly-know' : 'fly-unk');
    zone.classList.add(side === 'know' ? 'flash-know' : 'flash-unk');
    setTimeout(function () { zone.classList.remove('flash-know', 'flash-unk'); }, 520);
    setTimeout(done, 300);
  }

  /* ---------------- 作答 ---------------- */
  function answer(side) {
    if (!round || round.locked) return;
    round.locked = true;
    clearInterval(round._dwellTimer);
    var ch = round.queue[round.idx];
    var dwell = performance.now() - round.cardShownAt;
    var tooFast = dwell < FAST_MS;

    round.marks[ch] = side;
    round.dwells.push(dwell);

    // 只奖励「完成」，不奖励「认识」
    var gain = tooFast ? 0 : 5;
    if (tooFast) { round.tooFast++; round.combo = 0; }
    else {
      round.combo++;
      if (round.combo > 0 && round.combo % 5 === 0) { gain += 10; Sfx.combo(); floatText(window.innerWidth / 2 - 40, window.innerHeight * 0.38, '连击 +10', '#D98315'); }
      round.maxCombo = Math.max(round.maxCombo, round.combo);
    }
    var before = energy;
    energy += gain;
    round.energy += gain;

    // 记录每个字的掌握状态
    var st = charState[ch] || { last: null, k: 0, u: 0 };
    if (side === 'know') { st.last = 'know'; st.k++; } else { st.last = 'unk'; st.u++; }
    charState[ch] = st;

    if (gain) {
      var card = $('#card');
      var r = card ? card.getBoundingClientRect() : { left: window.innerWidth / 2, top: window.innerHeight / 2 };
      floatText(r.left + r.width / 2 - 16, r.top + 12, '+' + gain, side === 'know' ? '#D98315' : '#5E7185');
    }

    if (side === 'know') { Sfx.know(); buzz(14); } else { Sfx.unk(); buzz(26); }

    // 称号升级
    if (estimateLevel(energy) > estimateLevel(before)) setTimeout(function () { showLevelUp(titleOf(energy)); }, 420);

    round.idx++;
    saveProgress();
    saveAll();
    updateHud();
    setTimeout(function () { renderCard(false); }, tooFast ? 200 : 340);
  }

  function showLevelUp(name) {
    Sfx.levelup();
    var d = el('div', 'levelup', '<div class="inner"><div class="medal">' + svg('medal', 84) + '</div>' +
      '<div class="t1">升级啦！新的称号是</div><div class="t2">' + name + '</div></div>');
    document.body.appendChild(d);
    setTimeout(function () { d.remove(); }, 2100);
  }

  /* ---------------- 结算 ---------------- */
  function finishRound() {
    clearInterval(round._dwellTimer);
    energy += 20; round.energy += 20;
    var know = [], unk = [], fresh = [];
    round.queue.forEach(function (c) {
      if (round.marks[c] === 'know') know.push(c); else if (round.marks[c] === 'unk') unk.push(c);
    });
    // 新学会：上次记录是「不认识」，这次是「认识」
    know.forEach(function (c) { if (round.prevState[c] === 'unk') fresh.push(c); });

    var answered = know.length + unk.length || 1;
    var estimate = Math.round(know.length / answered * ALL.length);
    var knownAll = totalKnown();
    var avgDwell = round.dwells.length ? round.dwells.reduce(function (a, b) { return a + b; }, 0) / round.dwells.length : 0;
    var stars = 1;
    if (avgDwell >= DWELL_GOAL) stars++;
    if (round.maxCombo >= 10) stars++;
    if (round.tooFast > round.queue.length * 0.3) stars = 1;

    history.push({
      ts: Date.now(), level: round.level, mode: round.mode, review: round.review,
      n: round.queue.length, know: know.length, unk: unk.length, estimate: estimate, stars: stars
    });
    if (history.length > 200) history = history.slice(-200);
    ls('progress', null); progress = null;
    saveAll();
    Sfx.finish();
    renderResult({ know: know, unk: unk, fresh: fresh, estimate: estimate, knownAll: knownAll, avgDwell: avgDwell, stars: stars, mode: round.mode, review: round.review });
    show('result');
  }

  function chips(list, cls) {
    if (!list.length) return '<div class="empty-tip">（没有）</div>';
    return '<div class="char-chips">' + list.map(function (c) {
      var i = CHAR_MAP[c] || { p: '' };
      return '<div class="chip ' + cls + '"><div class="c">' + c + '</div><div class="p">' + (i.p || '') + '</div></div>';
    }).join('') + '</div>';
  }

  function renderResult(r) {
    var stars = '';
    for (var i = 0; i < 3; i++) stars += '<svg viewBox="0 0 24 24" width="38" height="38"><g fill="' + (i < r.stars ? '#F08C1E' : '#E3DDD5') + '">' + icon('star') + '</g></svg>';

    var res = $('#result');
    res.innerHTML =
      '<div class="res-wrap">' +
        '<div class="res-head">' +
          '<div>' +
            '<h1>本局完成！' + (r.review ? '（复习模式）' : '第 ' + round.level + ' 关') + '</h1>' +
            '<div class="sub">' + new Date().toLocaleString('zh-CN') + '　·　' + (r.mode === 'parent' ? '家长判读模式' : '孩子自己拖模式') + '　·　平均每张看 ' + (r.avgDwell / 1000).toFixed(1) + ' 秒</div>' +
          '</div>' +
          '<div class="stars">' + stars + '</div>' +
        '</div>' +

        '<div class="metrics">' +
          '<div class="metric know"><div class="k">' + svg('smile', 16, '#F08C1E') + '认识</div><div class="v">' + r.know.length + '<small>字</small></div></div>' +
          '<div class="metric unk"><div class="k">' + svg('ask', 16, '#5E7185') + '还不认识</div><div class="v">' + r.unk.length + '<small>字</small></div></div>' +
          '<div class="metric new"><div class="k">比上次新学会</div><div class="v">' + r.fresh.length + '<small>字</small></div></div>' +
          '<div class="metric"><div class="k">识字量估算</div><div class="v">' + r.estimate + '<small>字</small></div></div>' +
        '</div>' +
        '<div class="tip" style="margin-left:4px">识字量按本局「认识 / 已测」比例外推到全部 ' + ALL.length + ' 字，<b>是估算值</b>，不是精确测量；想更准就多测几局或把每局张数调大。累计认识（历史所有局）目前是 <b>' + r.knownAll + '</b> 字。</div>' +

        '<div class="res-cols">' +
          '<div class="card"><div class="list-head"><h3 class="c-know">认识的字</h3><span class="n">' + r.know.length + ' 个</span></div>' + chips(r.know, 'know') + '</div>' +
          '<div class="card"><div class="list-head"><h3 class="c-unk">还不认识的字（这些就是复习重点）</h3><span class="n">' + r.unk.length + ' 个</span></div>' + chips(r.unk, 'unk') + '</div>' +
        '</div>' +

        (r.fresh.length ? '<div class="card" style="border-color:#8CC79A;background:linear-gradient(180deg,#F5FCF7,#fff)"><div class="list-head"><h3 style="color:#3E8F4E">这次新学会的字</h3><span class="n">' + r.fresh.length + ' 个</span></div>' + chips(r.fresh, 'new') + '</div>' : '') +

        '<div class="trend"><div class="list-head"><h3>识字量估算变化</h3><span class="n">最近 ' + Math.min(history.length, 12) + ' 局</span></div>' + trendSvg() + '</div>' +

        '<div class="res-actions">' +
          '<button class="btn primary" id="againBtn">再来一局</button>' +
          (r.unk.length ? '<button class="btn" id="onlyUnkBtn">只练这 ' + r.unk.length + ' 个字</button>' : '') +
          '<button class="btn ghost" id="printBtn">打印复习卡（A4）</button>' +
          '<button class="btn ghost" id="csvBtn">导出成绩单 CSV</button>' +
          '<button class="btn ghost" id="homeBtn">回到首页</button>' +
        '</div>' +

        '<div class="print-area" id="printArea"></div>' +
      '</div>';

    $('#againBtn').addEventListener('click', function () { Sfx.tap(); startRound(); });
    var ou = $('#onlyUnkBtn');
    if (ou) ou.addEventListener('click', function () {
      r.unk.forEach(function (c) { charState[c] = charState[c] || { k: 0, u: 0 }; charState[c].last = 'unk'; });
      saveAll(); settings.review = true; settings.perRound = Math.max(10, r.unk.length); saveSettings(); startRound();
    });
    $('#printBtn').addEventListener('click', function () { buildPrint(r.unk); window.print(); });
    $('#csvBtn').addEventListener('click', function () { exportCsv(r); });
    $('#homeBtn').addEventListener('click', function () { Sfx.tap(); show('home'); renderHome(); });
  }

  function trendSvg() {
    var h = history.slice(-12);
    if (h.length < 2) return '<div class="empty-tip">测满两局就能看到变化曲线了。</div>';
    var W = 900, H = 180, P = 34;
    var max = Math.max.apply(null, h.map(function (x) { return x.estimate; }).concat([ALL.length]));
    var min = 0;
    var pts = h.map(function (x, i) {
      var px = P + (W - P * 2) * (i / (h.length - 1));
      var py = H - P - (H - P * 2) * ((x.estimate - min) / (max - min || 1));
      return [px, py, x];
    });
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    var area = d + ' L' + pts[pts.length - 1][0].toFixed(1) + ' ' + (H - P) + ' L' + pts[0][0].toFixed(1) + ' ' + (H - P) + ' Z';
    var grid = [0, 0.5, 1].map(function (f) {
      var y = H - P - (H - P * 2) * f;
      return '<line x1="' + P + '" y1="' + y + '" x2="' + (W - P) + '" y2="' + y + '" stroke="rgba(44,40,36,.09)" stroke-width="1"/>' +
        '<text x="' + (P - 8) + '" y="' + (y + 4) + '" font-size="11" fill="#9C928A" text-anchor="end">' + Math.round(min + (max - min) * f) + '</text>';
    }).join('');
    var dots = pts.map(function (p) {
      var dt = new Date(p[2].ts);
      return '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="4.5" fill="#F08C1E"/>' +
        '<text x="' + p[0].toFixed(1) + '" y="' + (H - 10) + '" font-size="10" fill="#9C928A" text-anchor="middle">' + (dt.getMonth() + 1) + '/' + dt.getDate() + '</text>';
    }).join('');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' + grid +
      '<path d="' + area + '" fill="rgba(240,140,30,.12)"/>' +
      '<path d="' + d + '" fill="none" stroke="#F08C1E" stroke-width="2.5" stroke-linejoin="round"/>' + dots + '</svg>';
  }

  function buildPrint(list) {
    var html = '<h1>汉字复习卡 · 共 ' + list.length + ' 个字</h1>' +
      '<div class="prow" style="border-bottom:1pt solid #333"><span class="pchar">字</span><span class="ppy">拼音</span><span class="pwd">组词</span></div>' +
      '<div class="pgrid" style="margin-top:8pt">' +
      list.map(function (c) {
        var i = CHAR_MAP[c] || { p: '', w: [] };
        return '<div><span class="pchar">' + c + '</span><span class="ppy">' + (i.p || '') + '</span></div>';
      }).join('') + '</div>' +
      '<h1 style="margin-top:18pt">组词参考</h1>' +
      list.map(function (c) {
        var i = CHAR_MAP[c] || { p: '', w: [] };
        return '<div class="prow"><span class="pchar">' + c + '</span><span class="ppy">' + (i.p || '') + '</span><span class="pwd">' + ((i.w || []).join('、') || '—') + '</span></div>';
      }).join('');
    $('#printArea').innerHTML = html;
  }

  function exportCsv(r) {
    var rows = [['结果', '汉字', '拼音', '笔画', '部首', '结构', '组词', '关卡']];
    r.know.forEach(function (c) { var i = CHAR_MAP[c]; rows.push(['认识', c, i.p, i.s, i.r, i.st, (i.w || []).join('|'), '第' + i.level + '关']); });
    r.unk.forEach(function (c) { var i = CHAR_MAP[c]; rows.push(['不认识', c, i.p, i.s, i.r, i.st, (i.w || []).join('|'), '第' + i.level + '关']); });
    rows.push([]);
    rows.push(['本局统计', '认识 ' + r.know.length + ' 字', '不认识 ' + r.unk.length + ' 字', '识字量估算 ' + r.estimate, '', '', '', '']);
    var csv = rows.map(function (row) { return row.map(function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }).join(','); }).join('\r\n');
    var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    var d = new Date();
    a.href = URL.createObjectURL(blob);
    a.download = '汉字小侦探-' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
  }

  /* ---------------- 设置抽屉 ---------------- */
  function openSheet() {
    Sfx.tap();
    var mask = $('#sheetMask');
    var sheet = $('#sheet');
    function sw(on) { return '<div class="switch ' + (on ? 'on' : '') + '"></div>'; }
    var levels = DATA.groups.map(function (g) {
      return '<option value="' + g.id + '"' + (settings.level === g.id ? ' selected' : '') + '>第 ' + g.id + ' 关（' + g.avgStroke + ' 画，' + g.chars.length + ' 字）</option>';
    }).join('');
    var pers = PER_ROUND_OPTIONS.map(function (n) {
      return '<option value="' + n + '"' + (settings.perRound === n ? ' selected' : '') + '>' + n + ' 张</option>';
    }).join('');

    sheet.innerHTML =
      '<button class="icon-btn close" id="sheetClose">' + svg('close', 18) + '</button>' +
      '<h2>家长设置</h2>' +
      '<div class="sheet-sub">首页直接点齿轮即可进入；测试中需要长按 2 秒（防止孩子误点）。</div>' +

      '<div class="row"><div><div class="lab">判定模式</div><div class="desc">家长判读更准确，适合正式记录</div></div>' +
        '<div class="ctl"><select class="select" id="setMode">' +
          '<option value="self"' + (settings.mode === 'self' ? ' selected' : '') + '>孩子自己拖</option>' +
          '<option value="parent"' + (settings.mode === 'parent' ? ' selected' : '') + '>家长判读</option>' +
        '</select></div></div>' +

      '<div class="row"><div><div class="lab">当前关卡</div><div class="desc">关卡内按笔画由少到多</div></div><div class="ctl"><select class="select" id="setLevel">' + levels + '</select></div></div>' +

      '<div class="row"><div><div class="lab">每局张数</div><div class="desc">4 岁建议 20 张以内</div></div><div class="ctl"><select class="select" id="setPer">' + pers + '</select></div></div>' +

      '<div class="row" data-toggle="showPinyin"><div><div class="lab">卡片直接显示拼音</div><div class="desc">默认不显示（点了才显示），避免把「认拼音」当成「认字」</div></div><div class="ctl">' + sw(settings.showPinyin) + '</div></div>' +

      '<div class="row" data-toggle="sound"><div><div class="lab">音效</div><div class="desc">拖动、落位、连击、升级音</div></div><div class="ctl">' + sw(settings.sound) + '</div></div>' +
      '<div class="row" data-toggle="speak"><div><div class="lab">自动朗读汉字</div><div class="desc">' + (Talk.available() ? '每张卡出现时朗读读音' : '本设备没有中文语音，不可用') + '</div></div><div class="ctl">' + sw(settings.speak && Talk.available()) + '</div></div>' +

      '<div class="row"><div><div class="lab">累计认识</div><div class="desc">历史所有局去重后认识的字</div></div><div class="ctl"><b style="font-size:18px">' + totalKnown() + ' 字</b></div></div>' +
      '<div class="row"><div><div class="lab">测试记录</div><div class="desc">已保存 ' + history.length + ' 局</div></div><div class="ctl"><button class="btn sm danger" id="clearHist">清空记录</button></div></div>' +
      '<div class="row" style="border:none"><div><div class="lab">全部重置</div><div class="desc">清空认识/不认识、能量、历史、进度</div></div><div class="ctl"><button class="btn sm danger" id="clearAll">全部重置</button></div></div>';
    mask.classList.add('on'); sheet.classList.add('on');

    function close() { mask.classList.remove('on'); sheet.classList.remove('on'); }
    $('#sheetClose').addEventListener('click', close);
    mask.onclick = close;

    $('#setMode').addEventListener('change', function (e) { settings.mode = e.target.value; saveSettings(); });
    $('#setLevel').addEventListener('change', function (e) { settings.level = +e.target.value; saveSettings(); if (document.body.dataset.screen === 'home') renderHome(); });
    $('#setPer').addEventListener('change', function (e) { settings.perRound = +e.target.value; saveSettings(); });

    sheet.querySelectorAll('.row[data-toggle]').forEach(function (row) {
      row.style.cursor = 'pointer';
      row.addEventListener('click', function () {
        var k = row.dataset.toggle;
        if (k === 'speak' && !Talk.available()) { alert('本设备没有中文语音，无法开启朗读。'); return; }
        settings[k] = !settings[k];
        if (k === 'sound' && settings.sound) Sfx.tap();
        saveSettings(); openSheet();
      });
    });
    $('#clearHist').addEventListener('click', function () {
      if (confirm('清空所有测试记录（历史曲线会一起清掉）？认识/不认识的状态会保留。')) { history = []; ls('history', []); openSheet(); }
    });
    $('#clearAll').addEventListener('click', function () {
      if (confirm('确定全部重置吗？认识/不认识、能量、历史、未完成进度都会清空，无法恢复。')) {
        history = []; charState = {}; energy = 0; progress = null;
        ['history', 'chars', 'energy', 'progress'].forEach(function (k) { localStorage.removeItem(KEY + k); });
        openSheet();
      }
    });
  }

  /* ---------------- 键盘 ----------------
     横排：← 认识 / → 不认识；竖排（手机）：↑ 认识 / ↓ 不认识
     两者都接受，接蓝牙键盘或 iPad 外接键盘时都能用                     */
  document.addEventListener('keydown', function (e) {
    if (document.body.dataset.screen !== 'play' || !round) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); answer('know'); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); answer('unk'); }
    else if (e.key === ' ') { e.preventDefault(); var c = round.queue[round.idx]; if (c) Talk.say(c); }
  });

  /* ---------------- 旋转屏幕 / 改变窗口 ----------------
     版面在三栏与竖排之间切换时，重新套用提示文案与手势方向         */
  var rzTimer = null;
  function onViewportChange() {
    clearTimeout(rzTimer);
    rzTimer = setTimeout(function () {
      var s = document.body.dataset.screen;
      if (s === 'play') applyOrientation();
      else if (s === 'home') renderHome();
    }, 180);
  }
  window.addEventListener('resize', onViewportChange);
  window.addEventListener('orientationchange', onViewportChange);

  /* ---------------- 启动 ---------------- */
  function init() {
    // 首次使用：给出使用须知
    renderHome();
    show('home');
    if (!settings.seenGuide) setTimeout(function () { showGuide(); }, 400);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  window.__HZ = { setLevel: function (n) { settings.level = n; saveSettings(); renderHome(); } };
})();
