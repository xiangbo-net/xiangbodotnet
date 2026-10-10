/* ===========================================================
   汉字小侦探 · 家长端（admin.html）

   功能：
   1) 口令登录（口令存在后端 D1，默认 momo2026，可在此页修改）
   2) 识字总览看板（页面顶部，各标签页都可见）：字库总数 / 已经认识 / 需要练习 / 尚未测试，
      点任意一块直接跳到字库对应分组
   3) 字库：分组标签卡（全部 / 认识 / 不认识 / 未测 / 家长添加 / 自带字库），
      点一下直接看这一类，不用再手选筛选条件；每个分组里都带检索框，可按汉字或拼音查
   4) 新增汉字：输入即自动补全拼音与组词；
      · 字库中还没有 → 新增（标为家长添加）
      · 字库中已有   → 按你选的「是否认识」更新它的状态（不重复加字）
   5) 设置：改口令 / 重置全部进度 / 重置某个字
   孩子端 index.html 里不放任何入口。
   =========================================================== */
(function () {
  'use strict';

  var API_BASE = (window.__API_BASE__ != null) ? window.__API_BASE__ : '/api/baby';
  var TOKEN_KEY = 'hzdet2.adminToken';

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function el(tag, cls, html) { var d = document.createElement(tag); if (cls) d.className = cls; if (html != null) d.innerHTML = html; return d; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]; }); }

  var token = '';
  try { token = localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { token = ''; }

  /* ---------------- 网络 ---------------- */
  function api(method, path, body) {
    var headers = { 'Accept': 'application/json' };
    if (body) headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return fetch(API_BASE + path, {
      method: method, headers: headers, body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: 'HTTP ' + r.status }; }).then(function (j) {
        if (r.status === 401) {
          setToken('');
          var app = document.getElementById('app');
          if (app && !app.classList.contains('hidden')) gotoLogin(j.error || '登录已过期，请重新登录');
          throw new Error(j.error || '登录已过期，请重新登录');
        }
        if (!r.ok || j.ok === false) throw new Error(j.error || ('HTTP ' + r.status));
        return j;
      });
    });
  }

  function setToken(t) {
    token = t || '';
    try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch (e) { }
  }
  function gotoLogin(msg) {
    var app = document.getElementById('app');
    if (app) app.classList.add('hidden');
    renderLogin(msg);
  }

  /* ---------------- 小工具 ---------------- */
  var toastTimer = null;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg; t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('on'); }, 2200);
  }
  function confirmBox(opt) {
    return new Promise(function (resolve) {
      var ov = el('div', 'overlay');
      ov.innerHTML = '<div class="box"><h2>' + esc(opt.title || '请确认') + '</h2><p>' + (opt.body || '') + '</p>' +
        '<div class="foot"><button class="btn ghost" data-x="0">' + esc(opt.cancel || '取消') + '</button>' +
        '<button class="btn ' + (opt.danger ? 'danger' : 'primary') + '" data-x="1">' + esc(opt.ok || '确定') + '</button></div></div>';
      document.body.appendChild(ov);
      ov.addEventListener('click', function (e) {
        var b = e.target.closest('[data-x]');
        if (b) { ov.remove(); resolve(b.dataset.x === '1'); }
        else if (e.target === ov) { ov.remove(); resolve(false); }
      });
    });
  }

  /* ---------------- 状态 ---------------- */
  // 字库分组：直接点标签卡切换，不用再手选筛选条件。
  // 每张卡映射到后端的一个 (status, source) 组合；nk 是它在 stats 里的计数字段。
  var GROUPS = [
    { k: 'all',      t: '全部',     cls: 'g-all',      status: 'all',      source: 'all',    nk: 'total' },
    { k: 'known',    t: '认识',     cls: 'g-known',    status: 'known',    source: 'all',    nk: 'known' },
    { k: 'unknown',  t: '不认识',   cls: 'g-unknown',  status: 'unknown',  source: 'all',    nk: 'unknown' },
    { k: 'untested', t: '未测',     cls: 'g-untested', status: 'untested', source: 'all',    nk: 'untested' },
    { k: 'parent',   t: '家长添加', cls: 'g-parent',   status: 'all',      source: 'parent', nk: 'parent' },
    { k: 'seed',     t: '自带字库', cls: 'g-seed',     status: 'all',      source: 'seed',   nk: 'seed' }
  ];
  function groupOf(k) {
    for (var i = 0; i < GROUPS.length; i++) if (GROUPS[i].k === k) return GROUPS[i];
    return GROUPS[0];
  }

  var S = {
    tab: 'chars',
    stats: {},
    parentChars: 0,
    list: [], total: 0, page: 1, size: 48, q: '',
    group: 'all',
    lookup: null, lookupState: 'known',
    ready: false
  };

  /* ===========================================================
     登录页
     =========================================================== */
  function renderLogin(errMsg) {
    $('#app').classList.add('hidden');
    var box = $('#login');
    box.classList.remove('hidden');
    box.innerHTML =
      '<div class="login-box">' +
        '<div class="badge"><span>字</span></div>' +
        '<h1>家长管理</h1>' +
        '<div class="sub">汉字小侦探 · 字库与进度管理</div>' +
        '<div class="field"><label for="pw">口令</label>' +
          '<input class="input" id="pw" type="password" inputmode="text" autocomplete="current-password" placeholder="请输入家长口令">' +
        '</div>' +
        '<button class="btn primary" id="loginBtn">登录</button>' +
        '<div class="login-err" id="loginErr">' + (errMsg ? esc(errMsg) : '') + '</div>' +
      '</div>';

    var pw = $('#pw');
    function go() {
      var v = pw.value.trim();
      if (!v) { $('#loginErr').textContent = '请输入口令'; return; }
      $('#loginBtn').disabled = true;
      $('#loginErr').textContent = '正在登录…';
      api('POST', '/admin/login', { password: v }).then(function (res) {
        setToken(res.token);
        toast('登录成功');
        boot();
      }).catch(function (e) {
        $('#loginBtn').disabled = false;
        $('#loginErr').textContent = e.message || '登录失败';
        pw.select();
      });
    }
    $('#loginBtn').addEventListener('click', go);
    pw.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    setTimeout(function () { pw.focus(); }, 120);
  }

  /* ===========================================================
     主界面
     =========================================================== */
  function renderTop() {
    $('#topIn').innerHTML =
      '<div class="logo"><span>字</span></div>' +
      '<div class="tt">家长管理<small>汉字小侦探</small></div>' +
      '<div class="sp"></div>' +
      '<button class="btn sm ghost" id="logoutBtn">退出</button>';
    $('#logoutBtn').addEventListener('click', function () {
      confirmBox({ title: '退出登录？', body: '退出后需要重新输入口令。', ok: '退出' }).then(function (y) {
        if (!y) return;
        api('POST', '/admin/logout', {}).catch(function () { }).then(function () {
          setToken(''); gotoLogin('已退出登录');
        });
      });
    });
  }

  /* ---------------- 识字总览看板 ----------------
     四个数：字库总数 / 已经认识 / 需要练习 / 尚未测试。
     每块都能点，直接跳到字库的对应分组。 */
  function renderDash() {
    var st = S.stats || {};
    var total = st.total || 0, known = st.known || 0, unknown = st.unknown || 0, untested = st.untested || 0;
    var parent = (typeof st.parent === 'number') ? st.parent : (S.parentChars || 0);
    var seed = (typeof st.seed === 'number') ? st.seed : Math.max(0, total - parent);
    var tested = known + unknown;
    var rate = total ? (known / total * 100) : 0;
    var kw = total ? (known / total * 100) : 0;
    var uw = total ? (unknown / total * 100) : 0;

    function pct(n) { return total ? (n / total * 100).toFixed(1) + '%' : '—'; }
    function tile(cls, lab, n, sub, goto) {
      return '<button class="dash-item ' + cls + '" data-goto="' + goto + '" title="点一下看这一类">' +
        '<div class="k">' + lab + '</div>' +
        '<div class="v">' + n + '<small>字</small></div>' +
        '<div class="u">' + sub + '</div>' +
      '</button>';
    }

    return '<div class="card dash">' +
      '<div class="dash-head">' +
        '<div>' +
          '<h2>识字总览</h2>' +
          '<div class="sub">已测 <b>' + tested + '</b> 字　·　还有 <b>' + untested + '</b> 字没测' +
            (parent ? '　·　家长添加 <b>' + parent + '</b> 字' : '') + '</div>' +
        '</div>' +
        '<div class="rate"><b>' + rate.toFixed(1) + '%</b><span>识字率（认识 ÷ 字库总数）</span></div>' +
      '</div>' +
      '<div class="dash-bar"><i class="b1" style="width:' + kw + '%"></i><i class="b2" style="width:' + uw + '%"></i></div>' +
      '<div class="dash-grid">' +
        tile('d-total',    '字库总数', total,    '内置 ' + seed + ' · 家长添加 ' + parent, 'all') +
        tile('d-known',    '已经认识', known,    pct(known),                              'known') +
        tile('d-unknown',  '需要练习', unknown,  pct(unknown),                            'unknown') +
        tile('d-untested', '尚未测试', untested, pct(untested),                           'untested') +
      '</div>' +
      '<div class="dash-tip">点任意一块，直接跳到字库里对应的分组</div>' +
    '</div>';
  }

  function bindGoto(scope) {
    $$('[data-goto]', scope || document).forEach(function (b) {
      b.addEventListener('click', function () {
        S.tab = 'chars'; S.group = b.dataset.goto; S.page = 1; S.q = '';
        renderMain();
        var v = $('#view');
        if (v && v.scrollIntoView) v.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  function paintDash() {
    var box = $('#dashBox');
    if (!box) return;
    box.innerHTML = renderDash();
    bindGoto(box);
  }

  // 统计变化后统一刷新：顶栏 + 看板 + 分组标签卡
  function refreshStats() { renderTop(); paintDash(); }

  function renderTabs() {
    var tabs = [['chars', '字库'], ['add', '新增汉字'], ['settings', '设置']];
    return '<div class="tabs">' + tabs.map(function (t) {
      return '<button class="tab ' + (S.tab === t[0] ? 'on' : '') + '" data-tab="' + t[0] + '">' + t[1] + '</button>';
    }).join('') + '</div>';
  }

  function renderMain() {
    var m = $('#main');
    m.innerHTML = '<div id="dashBox"></div>' + renderTabs() + '<div id="view"></div>';
    paintDash();
    $$('[data-tab]', m).forEach(function (b) {
      b.addEventListener('click', function () { S.tab = b.dataset.tab; renderMain(); });
    });
    if (S.tab === 'chars') renderChars();
    else if (S.tab === 'add') renderAdd();
    else renderSettings();
  }

  /* ---------------- 字库视图 ---------------- */
  function statusTag(s) {
    if (s === 'known') return '<span class="tag know">认识</span>';
    if (s === 'unknown') return '<span class="tag unk">不认识</span>';
    return '<span class="tag untested">未测</span>';
  }

  function renderChars() {
    var v = $('#view');
    v.innerHTML =
      '<div class="card">' +
        '<div class="chips" id="chips"></div>' +
        '<div class="toolbar">' +
          '<input class="input search" id="q" placeholder="检索汉字或拼音（如 木 / mu），在选中的分组里查找" value="' + esc(S.q) + '">' +
          '<button class="btn sm ghost" id="reloadBtn">刷新</button>' +
        '</div>' +
        '<div id="chrBox"></div>' +
        '<div class="pager" id="pager"></div>' +
      '</div>';

    paintChips();

    $('#q').addEventListener('input', debounce(function (e) { S.q = e.target.value.trim(); S.page = 1; loadChars(); }, 280));
    $('#reloadBtn').addEventListener('click', function () { loadChars(); });

    loadChars();
  }

  // 标签卡：显示分组名 + 数量（为 0 的置灰，一眼看出是空的）
  function paintChips() {
    var box = $('#chips'); if (!box) return;
    var st = S.stats || {};
    box.innerHTML = GROUPS.map(function (g) {
      var n = st[g.nk];
      n = (typeof n === 'number') ? n : 0;
      return '<button class="chip ' + g.cls + (S.group === g.k ? ' on' : '') + (n ? '' : ' zero') + '" data-g="' + g.k + '">' +
        '<span class="ct">' + g.t + '</span><b class="cn">' + n + '</b>' +
      '</button>';
    }).join('');
    $$('.chip', box).forEach(function (b) {
      b.addEventListener('click', function () {
        if (S.group === b.dataset.g) return;
        S.group = b.dataset.g; S.page = 1;
        paintChips();
        loadChars();
      });
    });
  }

  var loadSeq = 0;   // 连点标签卡时，丢弃过期响应，避免旧结果覆盖新分组
  function loadChars() {
    var box = $('#chrBox'); if (!box) return;
    var seq = ++loadSeq;
    box.innerHTML = '<div class="empty">加载中…</div>';
    var g = groupOf(S.group);
    var qs = '?q=' + encodeURIComponent(S.q) + '&status=' + g.status + '&source=' + g.source + '&page=' + S.page + '&size=' + S.size;
    api('GET', '/admin/chars' + qs).then(function (res) {
      if (seq !== loadSeq) return;
      S.list = res.list || []; S.total = res.total || 0; S.page = res.page; S.size = res.size;
      if (res.stats) { S.stats = res.stats; refreshStats(); paintChips(); }
      paintChars();
    }).catch(function (e) {
      if (seq !== loadSeq) return;
      box.innerHTML = '<div class="empty">加载失败：' + esc(e.message) + '</div>';
    });
  }

  // 空结果时给出有针对性的说明，而不是一句「没有符合条件的字」
  function emptyHint() {
    if (S.q && S.group !== 'all') {
      return '「' + esc(groupOf(S.group).t) + '」里没有匹配「' + esc(S.q) + '」的字。' +
        '<br><button class="btn sm ghost" id="searchAllBtn" style="margin-top:12px">到「全部」里搜一搜</button>';
    }
    if (S.q) return '没有匹配「' + esc(S.q) + '」的字。';
    if (S.group === 'known') return '还没有标为「认识」的字。孩子答题时向左滑就会归到这里。';
    if (S.group === 'unknown') return '还没有标为「不认识」的字。孩子答题时向右滑就会归到这里。';
    if (S.group === 'untested') return '所有字都测过了，没有未测的字了。';
    if (S.group === 'parent') return '还没有家长手动添加的字，到「新增汉字」里加一个。';
    return '没有符合条件的字。';
  }

  function paintChars() {
    var box = $('#chrBox');
    if (!S.list.length) {
      box.innerHTML = '<div class="empty">' + emptyHint() + '</div>';
      $('#pager').innerHTML = '';
      var sa = $('#searchAllBtn');
      if (sa) sa.addEventListener('click', function () { S.group = 'all'; S.page = 1; paintChips(); loadChars(); });
      return;
    }
    box.innerHTML = '<div class="chr-list">' + S.list.map(function (r) {
      var cls = r.status === 'known' ? 'k' : (r.status === 'unknown' ? 'u' : '');
      return '<div class="chr ' + cls + '" data-h="' + esc(r.hanzi) + '">' +
        '<div class="hz">' + esc(r.hanzi) + '</div>' +
        '<div class="meta">' +
          '<div class="py">' + esc(r.pinyin || '—') + ' <span class="muted" style="font-size:11.5px">' + (r.strokes || 0) + '画</span></div>' +
          '<div class="wd">' + (r.words && r.words.length ? esc(r.words.slice(0, 4).join(' · ')) : '<span class="muted">（无组词）</span>') + '</div>' +
          '<div class="tags">' + statusTag(r.status) +
            '<span class="tag ' + (r.source === 'parent' ? 'parent' : 'seed') + '">' + (r.source === 'parent' ? '家长添加' : '内置') + '</span>' +
            (r.knownCount || r.unknownCount ? '<span class="tag">答对' + r.knownCount + '/答错' + r.unknownCount + '</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="acts">' +
          '<button class="iconbtn" data-act="know" title="标为认识">✓</button>' +
          '<button class="iconbtn" data-act="unknown" title="标为不认识">?</button>' +
          '<button class="iconbtn" data-act="reset" title="重置为未测">↺</button>' +
          (r.source === 'parent' ? '<button class="iconbtn del" data-act="del" title="删除">✕</button>' : '') +
        '</div>' +
      '</div>';
    }).join('') + '</div>';

    var totalPages = Math.max(1, Math.ceil(S.total / S.size));
    $('#pager').innerHTML = '<button class="btn sm ghost" id="pPrev"' + (S.page <= 1 ? ' disabled' : '') + '>上一页</button>' +
      '<span class="info">第 ' + S.page + ' / ' + totalPages + ' 页　共 ' + S.total + ' 个字</span>' +
      '<button class="btn sm ghost" id="pNext"' + (S.page >= totalPages ? ' disabled' : '') + '>下一页</button>';
    $('#pPrev').addEventListener('click', function () { if (S.page > 1) { S.page--; loadChars(); } });
    $('#pNext').addEventListener('click', function () { if (S.page < totalPages) { S.page++; loadChars(); } });

    $$('.chr', box).forEach(function (row) {
      var h = row.dataset.h;
      $$('[data-act]', row).forEach(function (b) {
        b.addEventListener('click', function () { charAction(b.dataset.act, h); });
      });
    });
  }

  function charAction(act, hanzi) {
    if (act === 'know' || act === 'unknown') {
      api('POST', '/admin/chars', { hanzi: hanzi, known: act === 'know' }).then(function (res) {
        if (res.stats) { S.stats = res.stats; refreshStats(); }
        toast('「' + hanzi + '」已标为' + (act === 'know' ? '认识' : '不认识'));
        loadChars();
      }).catch(function (e) { toast('失败：' + e.message); });
    } else if (act === 'reset') {
      api('POST', '/admin/chars/reset', { hanzi: hanzi }).then(function (res) {
        if (res.stats) { S.stats = res.stats; refreshStats(); }
        toast('「' + hanzi + '」已重置为未测');
        loadChars();
      }).catch(function (e) { toast('失败：' + e.message); });
    } else if (act === 'del') {
      confirmBox({ title: '删除「' + hanzi + '」？', body: '将从字库中移除这个家长添加的字（内置字不能删）。', ok: '删除', danger: true }).then(function (y) {
        if (!y) return;
        api('DELETE', '/admin/chars/' + encodeURIComponent(hanzi)).then(function (res) {
          if (res.stats) { S.stats = res.stats; refreshStats(); }
          toast('已删除');
          loadChars();
        }).catch(function (e) { toast('失败：' + e.message); });
      });
    }
  }

  /* ---------------- 新增汉字 ---------------- */
  function renderAdd() {
    var v = $('#view');
    v.innerHTML =
      '<div class="add-grid">' +
        '<div class="card">' +
          '<h2 style="font-size:16px;margin-bottom:14px">输入一个汉字</h2>' +
          '<div class="form-row">' +
            '<input class="input" id="hzInput" placeholder="在这里打一个汉字，例如：皓" ' +
              'style="text-align:center;font-family:var(--font-hanzi);font-size:46px;padding:14px">' +
          '</div>' +
          '<div class="tip">打进去后会自动查它的<b>拼音、笔画、部首和常用组词</b>；如果字库里已经有这个字，会显示它现在的状态。</div>' +
          '<div class="form-row" style="margin-top:18px">' +
            '<label>这个字孩子认识吗？</label>' +
            '<div class="state-picker">' +
              '<button class="state-opt on" data-st="known"><div class="t">认识</div><div class="d">进「我的字库」</div></button>' +
              '<button class="state-opt unk" data-st="unknown"><div class="t">不认识</div><div class="d">进练习库</div></button>' +
              '<button class="state-opt none" data-st="none"><div class="t">先不改状态</div><div class="d">只把字加进字库</div></button>' +
            '</div>' +
          '</div>' +
          '<div style="display:flex;gap:10px;margin-top:18px;flex-wrap:wrap">' +
            '<button class="btn primary" id="saveBtn" disabled>保存</button>' +
            '<button class="btn ghost" id="clearBtn">清空</button>' +
          '</div>' +
        '</div>' +

        '<div class="card">' +
          '<h2 style="font-size:16px;margin-bottom:14px">预览</h2>' +
          '<div class="add-preview" id="preview"><div class="ph">在上面输入一个汉字</div></div>' +
          '<div id="libInfo" class="tip" style="margin-top:12px"></div>' +
        '</div>' +
      '</div>';

    var input = $('#hzInput');

    // 中文输入法兼容：拼字过程中（composition）不要动 value，
    // 否则会把「hao」这类拼音串当非法字符清掉，等于打断输入法，用户就「打不进字」。
    var composing = false;

    function normalize() {
      var v2 = (input.value || '').replace(/[^\u4e00-\u9fa5]/g, '').slice(0, 1);
      if (input.value !== v2) input.value = v2;
      if (v2) doLookup(v2); else resetPreview();
    }

    input.addEventListener('compositionstart', function () {
      composing = true;
      // 这个框只收一个汉字：开始输入新字时直接替换旧内容，
      // 否则新字的拼音会拼在旧字后面（如「花hao」），上屏后被当成第二个字丢掉。
      if (input.value) input.value = '';
    });
    input.addEventListener('compositionend', function () {
      composing = false;
      normalize();   // 拼字结束、汉字真正落下后再过滤和查询
    });
    input.addEventListener('input', function (e) {
      // 以事件自带的 isComposing 为准（最可靠）；composing 只作兜底，
      // 且收到非组合输入时主动复位，避免标志位残留导致后续输入被忽略。
      if (e.isComposing) return;
      composing = false;
      normalize();
    });
    input.addEventListener('focus', function () {
      // 聚焦即选中，直接打新字就会覆盖旧字
      setTimeout(function () { try { input.select(); } catch (e) { } }, 0);
    });
    $$('.state-opt').forEach(function (b) {
      b.addEventListener('click', function () {
        $$('.state-opt').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        S.lookupState = b.dataset.st;
      });
    });
    $('#saveBtn').addEventListener('click', saveChar);
    $('#clearBtn').addEventListener('click', function () { input.value = ''; resetPreview(); input.focus(); });
    setTimeout(function () { input.focus(); }, 100);
  }

  function resetPreview() {
    $('#preview').innerHTML = '<div class="ph">在上面输入一个汉字</div>';
    $('#libInfo').innerHTML = '';
    $('#saveBtn').disabled = true;
    S.lookup = null;
  }

  var lookupSeq = 0;
  function doLookup(hz) {
    var seq = ++lookupSeq;   // 防止旧请求的响应盖掉新结果
    $('#saveBtn').disabled = true;
    $('#preview').innerHTML = '<div class="ph">查询中…</div>';
    api('GET', '/admin/lookup?hanzi=' + encodeURIComponent(hz)).then(function (res) {
      if (seq !== lookupSeq) return;
      S.lookup = res;
      var d = res.dict;
      if (!d) {
        $('#preview').innerHTML = '<div class="hz">' + esc(hz) + '</div><div class="ph">字典里没找到这个字，会把字直接加进字库（拼音和组词可以留空）。</div>';
      } else {
        $('#preview').innerHTML =
          '<div class="hz">' + esc(hz) + '</div>' +
          '<div class="py">' + esc(d.pinyin || '') + '</div>' +
          '<div class="muted" style="font-size:12.5px">' + (d.strokes || 0) + ' 画 · ' + esc(d.radical || '—') + ' · ' + esc(d.structure || '—') + '</div>' +
          '<div class="wd">' + (d.words && d.words.length ? esc(d.words.join(' · ')) : '（暂无组词）') + '</div>';
      }
      var lines = [];
      if (res.inLibrary) {
        lines.push('字库里<b>已经有</b>这个字，当前状态：' + (res.status === 'known' ? '<b style="color:var(--know-deep)">认识</b>' : (res.status === 'unknown' ? '<b style="color:var(--unk-deep)">不认识</b>' : '未测')) + '。保存会更新它的状态。');
      } else {
        lines.push('字库里<b>还没有</b>这个字，保存会把它新增进来（来源标为「家长添加」）。');
      }
      $('#libInfo').innerHTML = lines.join('<br>');
      $('#saveBtn').disabled = false;
    }).catch(function (e) {
      $('#preview').innerHTML = '<div class="ph">查询失败：' + esc(e.message) + '</div>';
    });
  }

  function saveChar() {
    var hz = ($('#hzInput').value || '').trim();
    if (!/^[\u4e00-\u9fa5]$/.test(hz)) { toast('请输入一个汉字'); return; }
    var payload = { hanzi: hz };
    if (S.lookupState === 'known') payload.known = true;
    else if (S.lookupState === 'unknown') payload.known = false;

    $('#saveBtn').disabled = true;
    api('POST', '/admin/chars', payload).then(function (res) {
      if (res.stats) { S.stats = res.stats; refreshStats(); }
      toast('「' + hz + '」' + (res.created ? '已新增到字库' : '状态已更新'));
      $('#hzInput').value = '';
      resetPreview();
      $('#hzInput').focus();
    }).catch(function (e) {
      $('#saveBtn').disabled = false;
      toast('保存失败：' + e.message);
    });
  }

  /* ---------------- 设置 ---------------- */
  function renderSettings() {
    var v = $('#view');
    v.innerHTML =
      '<div class="card">' +
        '<h2 style="font-size:16px;margin-bottom:12px">修改口令</h2>' +
        '<div class="form-row"><label>原口令</label><input class="input" id="pwOld" type="password" autocomplete="current-password"></div>' +
        '<div class="form-row"><label>新口令（至少 4 位）</label><input class="input" id="pwNew" type="password" autocomplete="new-password"></div>' +
        '<div class="form-row"><label>再输一次新口令</label><input class="input" id="pwNew2" type="password" autocomplete="new-password"></div>' +
        '<button class="btn primary" id="pwSave">保存新口令</button>' +
        '<div class="tip" style="margin-top:10px">改完口令后所有登录都会失效，需要重新登录。</div>' +
      '</div>' +

      '<div class="card">' +
        '<h2 style="font-size:16px;margin-bottom:12px">危险操作</h2>' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
          '<button class="btn danger" id="resetProg">清空全部学习进度</button>' +
          '<button class="btn danger" id="resetAll">清空进度 + 对局记录</button>' +
        '</div>' +
        '<div class="tip" style="margin-top:10px">只影响「哪些字认识 / 不认识」和成绩记录，<b>不会</b>删除字库里的字。</div>' +
      '</div>';

    $('#pwSave').addEventListener('click', function () {
      var o = $('#pwOld').value, n = $('#pwNew').value, n2 = $('#pwNew2').value;
      if (!o || !n) { toast('请填写原口令和新口令'); return; }
      if (n !== n2) { toast('两次输入的新口令不一致'); return; }
      if (n.length < 4) { toast('新口令至少 4 位'); return; }
      api('POST', '/admin/password', { oldPassword: o, newPassword: n }).then(function () {
        toast('口令已修改，请重新登录');
        setToken('');
        setTimeout(function () { renderLogin('口令已修改，请用新口令登录'); }, 700);
      }).catch(function (e) { toast('修改失败：' + e.message); });
    });

    function doReset(keepSessions, label) {
      confirmBox({
        title: '确定' + label + '？',
        body: '孩子端所有「认识 / 不认识」的记录会被清空，无法恢复（字库里的字保留）。',
        ok: '确定清空', danger: true
      }).then(function (y) {
        if (!y) return;
        api('POST', '/admin/reset', { keepSessions: keepSessions }).then(function (res) {
          if (res.stats) { S.stats = res.stats; refreshStats(); }
          toast('已清空');
          renderSettings();
        }).catch(function (e) { toast('失败：' + e.message); });
      });
    }
    $('#resetProg').addEventListener('click', function () { doReset(true, '清空学习进度'); });
    $('#resetAll').addEventListener('click', function () { doReset(false, '清空进度和对局记录'); });
  }

  /* ---------------- 工具 ---------------- */
  function debounce(fn, ms) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    var lg = $('#login');
    lg.innerHTML = '';
    lg.classList.add('hidden');   // 容器有 min-height:100%，只清内容会占满一屏把主界面顶下去
    $('#app').classList.remove('hidden');
    S.tab = 'chars';
    api('GET', '/admin/stats').then(function (res) {
      S.stats = res.stats || {};
      S.parentChars = res.parentChars || 0;
      S.ready = true;
      renderTop();
      renderMain();
    }).catch(function (e) {
      // 令牌失效等 → login 里已经处理；其余给出提示
      renderTop();
      renderMain();
      toast('数据加载异常：' + e.message);
    });
  }

  if (token) boot(); else renderLogin();
})();
