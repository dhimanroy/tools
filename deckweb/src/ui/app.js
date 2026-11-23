/* deckweb: UI, state, live preview, file handling. */
(function () {
  'use strict';
  var DW = window.DW;

  // ------------------------------------------------------------------ utils
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function trunc(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  function debounce(fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }

  var LS_DRAFT = 'deckweb.draft.v1', LS_PREF = 'deckweb.prefs.v1';
  var prefs = lsGet(LS_PREF) || {};
  function savePrefs() { lsSet(LS_PREF, prefs); }

  var S = {
    fileName: null, base: null, baseLines: [], baseModel: null,
    model: null, blocks: [], hidden: new Map(), checks: [], byKey: new Map(),
    sel: 'RunParam', showDormant: false, expanded: new Set(), sumClosed: new Set(),
    undo: [], redo: [], grid: {}, handle: null, view: 'full', focusLine: -1, search: ''
  };

  var el = {
    app: $('#app'), empty: $('#empty'), nav: $('#nav'), editor: $('#editor'), code: $('#code'), diff: $('#diff'),
    fileinfo: $('#fileinfo'), search: $('#search'), toast: $('#toast'), file: $('#file')
  };

  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { el.toast.classList.remove('show'); }, 2200);
  }

  // ------------------------------------------------------------------ model
  function loadText(text, opts) {
    opts = opts || {};
    if (!opts.keepBase) {
      S.base = text;
      S.baseModel = DW.parseDeck(text);
      S.baseLines = S.baseModel.lines.map(function (l) { return l.raw; });
      S.undo = []; S.redo = []; S.expanded.clear(); S.search = ''; el.search.value = '';
      S.sel = 'RunParam';
    }
    S.model = DW.parseDeck(text);
    DW.extractDocs(S.model);
    S.blocks = DW.buildBlocks(S.model);
    if (!S.blocks.some(function (b) { return b.id === S.sel; }) && S.sel !== '__checks') S.sel = S.blocks.length ? S.blocks[0].id : '__checks';
    if (!opts.keepBase && S.model.issues.some(function (i) { return i.level === 'error'; })) S.sel = '__checks';
    recompute();
    el.empty.hidden = true;
    el.app.hidden = false;
    renderNav();
    renderEditor({ keepScroll: !!opts.keepBase });
    renderPreview();
    updateChrome();
    saveDraftSoon();
  }

  function recompute() {
    S.hidden = DW.computeDormancy(S.model);
    S.counts = DW.arrayCounts(S.model);
    S.checks = DW.validate(S.model, S.hidden, S.grid);
    S.byKey = new Map();
    S.checks.forEach(function (c) {
      if (c.level !== 'error' && c.level !== 'warn') return;
      c.keys.forEach(function (k) {
        if (!S.byKey.has(k)) S.byKey.set(k, []);
        S.byKey.get(k).push(c);
      });
    });
  }

  function currentText() { return DW.serialize(S.model); }
  function lineChanged(i) { return DW.lineText(S.model.lines[i]) !== S.baseLines[i]; }
  function changedLines() {
    var out = [];
    for (var i = 0; i < S.model.lines.length; i++) if (lineChanged(i)) out.push(i);
    return out;
  }
  function isModified(p) { return lineChanged(p.lineIdx); }
  function baseParam(p) { return S.baseModel && S.baseModel.paramMap.get(p.id); }
  function hasChanges() { return S.model && currentText() !== S.base; }

  function widgetOf(p) {
    if (p.widget === 'switch' && !(p.tokens.length === 1 && (p.tokens[0] === '0' || p.tokens[0] === '1'))) return 'list';
    if ((p.widget === 'enum' || p.widget === 'logical' || p.widget === 'string') && p.tokens.length !== 1) return 'list';
    return p.widget;
  }

  function groupKey(p) {
    var h = S.hidden.get(p.id);
    return p.section.id + '|' + p.parent + '|' + (h ? h.sw.id : '');
  }

  // ------------------------------------------------------------------ edits
  var MAX_COUNT_FIELDS = 64;

  /** New token list for array q resized to n values. Values cut off are kept in
   *  q.stash so raising the count again brings them back; otherwise the last value is repeated. */
  function resized(q, n) {
    var t = q.tokens.slice();
    q.stash = q.stash || [];
    if (t.length > n) { q.stash = t.slice(n).concat(q.stash); t = t.slice(0, n); }
    while (t.length < n) t.push(q.stash.length ? q.stash.shift() : t[t.length - 1]);
    return t;
  }

  function same(a, b) { return a.join('\u0001') === b.join('\u0001'); }

  /** Edit p; if p is a count parameter, resize its linked arrays in the same undo step. */
  function commit(p, tokens, ck) {
    if (same(p.tokens, tokens)) return;
    var changes = [{ p: p, tokens: tokens }];
    var links = DW.linkedArrays(S.model, p);
    if (links.length && tokens.length === 1 && /^\d+$/.test(tokens[0])) {
      var n = Math.max(1, parseInt(tokens[0], 10));
      if (n > MAX_COUNT_FIELDS) toast(p.name + ' = ' + n + ': too many to show as fields; arrays left as they are');
      else links.forEach(function (q) { if (q.tokens.length !== n) changes.push({ p: q, tokens: resized(q, n) }); });
    }

    var last = S.undo[S.undo.length - 1], now = Date.now();
    var entry = ck && last && last.ck === ck && now - last.t < 1500 ? last : null;
    if (!entry) { entry = { changes: [], ck: ck, t: now }; S.undo.push(entry); }
    entry.t = now;
    changes.forEach(function (c) {
      var rec = entry.changes.find(function (r) { return r.id === c.p.id; });
      if (!rec) entry.changes.push(rec = { id: c.p.id, before: c.p.tokens.slice() });
      rec.after = c.tokens.slice();
    });
    if (S.undo.length > 500) S.undo.shift();
    S.redo = [];

    changes.forEach(function (c) { c.p.tokens = c.tokens.slice(); });
    afterEdit(p);
    changes.slice(1).forEach(function (c) { rerenderRow(c.p); afterEdit(c.p, true); });
    if (changes.length > 1) toast(p.name + ' = ' + tokens[0] + ': resized ' + changes.slice(1).map(function (c) { return c.p.name; }).join(', '));
  }

  function afterEdit(p, quiet) {
    updatePreviewLine(p.lineIdx);
    if (!quiet) setFocusLine(p.lineIdx, true);
    var row = rowEl(p);
    if (row) {
      row.classList.toggle('mod', isModified(p));
      var was = $('.was', row);
      if (was) was.outerHTML = wasHTML(p);
    }
    updateChrome();
    recheckSoon();
    saveDraftSoon();
  }

  function pushTextUndo() {
    S.undo.push({ text: currentText() });
    S.redo = [];
  }

  function applyText(text) { loadText(text, { keepBase: true }); }

  function undoRedo(fromUndo) {
    var src = fromUndo ? S.undo : S.redo, dst = fromUndo ? S.redo : S.undo;
    var e = src.pop();
    if (!e) return;
    if (e.text != null) {
      dst.push({ text: currentText() });
      applyText(e.text);
      toast(fromUndo ? 'Undone' : 'Redone');
      return;
    }
    dst.push(e);
    var ps = e.changes.map(function (c) {
      var q = S.model.paramMap.get(c.id);
      if (q) q.tokens = (fromUndo ? c.before : c.after).slice();
      return q;
    }).filter(Boolean);
    if (!ps.length) return;
    gotoParam(ps[0], { focus: false });
    ps.forEach(function (q, i) { rerenderRow(q); afterEdit(q, i > 0); });
    toast((fromUndo ? 'Undid ' : 'Redid ') + ps[0].fullKey + (ps.length > 1 ? ' (+' + (ps.length - 1) + ' linked)' : ''));
  }

  var recheckSoon = debounce(function () {
    if (!S.model) return;
    var prev = Array.from(S.hidden.keys()).sort().join('|');
    recompute();
    var now = Array.from(S.hidden.keys()).sort().join('|');
    if (prev !== now || S.sel === '__checks') renderEditor({ keepScroll: true, keepFocus: true });
    else refreshRowMessages();
    renderNav();
    updateChrome();
    if (S.view === 'diff') renderDiff();
    updateIssueMarks();
  }, 120);

  var saveDraftSoon = debounce(function () {
    if (!S.model) return;
    lsSet(LS_DRAFT, { name: S.fileName, base: S.base, text: currentText(), grid: S.grid, t: Date.now() });
  }, 400);

  // ------------------------------------------------------------------ nav
  function blockStats(b) {
    var err = 0, warn = 0;
    S.checks.forEach(function (c) {
      if (c.block !== b.id) return;
      if (c.level === 'error') err++;
      else if (c.level === 'warn') warn++;
    });
    var mod = b.params.filter(isModified).length;
    var off = (b.mainSwitch && DW.numVal(b.mainSwitch) === 0) ||
      b.params.every(function (p) { return S.hidden.has(p.id); });
    return { err: err, warn: warn, mod: mod, off: off };
  }

  function pills(st) {
    var h = '';
    if (st.err) h += '<span class="pill err" title="errors">' + st.err + '</span>';
    if (st.warn) h += '<span class="pill warn" title="warnings">' + st.warn + '</span>';
    if (st.mod) h += '<span class="dot" title="' + st.mod + ' changed"></span>';
    if (st.off) h += '<span class="pill off">off</span>';
    return h;
  }

  function renderNav() {
    var err = S.checks.filter(function (c) { return c.level === 'error'; }).length;
    var warn = S.checks.filter(function (c) { return c.level === 'warn'; }).length;
    var sub = 'Run overview · ' + (err ? err + ' error' + (err > 1 ? 's' : '') : warn ? 'no errors' : 'all checks pass');
    var h = '<button class="nav-i nav-checks' + (S.sel === '__checks' ? ' sel' : '') + '" data-b="__checks">' +
      '<span class="nk">Summary</span><span class="nt">' + sub + (warn ? ' · ' + warn + ' warning' + (warn > 1 ? 's' : '') : '') + '</span>' +
      '<span class="nb">' + (err ? '<span class="pill err">' + err + '</span>' : '<span class="pill ok">✓</span>') + '</span></button>';
    var nl = null;
    S.blocks.forEach(function (b) {
      if (b.namelist !== nl) { nl = b.namelist; h += '<div class="nav-h">&amp;' + esc(nl || '—') + '</div>'; }
      var st = blockStats(b);
      h += '<button class="nav-i' + (S.sel === b.id && !S.search ? ' sel' : '') + (st.off ? ' off' : '') + '" data-b="' + esc(b.id) + '" title="' + esc(b.blurb) + '">' +
        '<span class="nk">' + esc(b.id) + '</span><span class="nt">' + esc(b.title) + '</span><span class="nb">' + pills(st) + '</span></button>';
    });
    var st = el.nav.scrollTop;
    el.nav.innerHTML = h;
    el.nav.scrollTop = st;
  }

  // ------------------------------------------------------------------ rows
  function rowEl(p) { return el.editor.querySelector('.row[data-id="' + cssEsc(p.id) + '"]'); }
  function cssEsc(s) { return window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&'); }

  function wasHTML(p) {
    var bp = baseParam(p);
    if (!isModified(p) || !bp) return '<div class="was" hidden></div>';
    return '<div class="was">was ' + esc(bp.valueText || '(empty)') + '</div>';
  }

  function widgetHTML(p) {
    var w = widgetOf(p), v = p.tokens[0];
    if (w === 'enum') {
      var has = false;
      var opts = p.doc.options.map(function (o) {
        if (o.value === v) has = true;
        return '<option value="' + esc(o.value) + '"' + (o.value === v ? ' selected' : '') + '>' + esc(o.value) + ' — ' + esc(trunc(o.label, 72)) + '</option>';
      }).join('');
      if (!has) opts = '<option value="' + esc(v) + '" selected>' + esc(v) + ' — (not documented)</option>' + opts;
      return '<div class="w"><select data-act="enum" aria-label="' + esc(p.fullKey) + '">' + opts + '</select></div>';
    }
    if (w === 'switch' || w === 'logical') {
      var on = w === 'switch' ? v !== '0' : /^\.?t/i.test(v);
      return '<div class="w"><button class="sw" role="switch" data-act="sw" aria-checked="' + on + '" aria-label="' + esc(p.fullKey) + '">' +
        '<span class="tr"></span><span class="sl">' + (on ? 'On' : 'Off') + '</span><span class="sv">= ' + esc(v) + '</span></button></div>';
    }
    if (w === 'string') {
      return '<div class="w"><input type="text" data-act="str" value="' + esc(v.slice(1, -1)) + '" style="--ch:' + Math.max(12, v.length) + '" spellcheck="false" aria-label="' + esc(p.fullKey) + '"></div>';
    }
    // The number of fields is fixed: it's what the file has, or what the count parameter sets.
    var cnt = S.counts && S.counts.get(p.id);
    var multi = p.tokens.length > 1 || !!cnt;
    var h = '<div class="w' + (multi ? ' multi' : '') + '">';
    p.tokens.forEach(function (t, i) {
      var cls = tokenClass(p, t);
      h += '<span class="tok">' + (multi ? '<span class="ix">' + (i + 1) + '</span>' : '') +
        '<input type="text" data-act="tok" data-i="' + i + '" class="' + cls + '" value="' + esc(t) + '" style="--ch:' + Math.max(4, t.length) + '" spellcheck="false" autocomplete="off" aria-label="' + esc(p.fullKey) + (multi ? ' value ' + (i + 1) : '') + '"></span>';
    });
    if (cnt) {
      h += '<button class="cnt" data-act="goto-count" data-key="' + esc(cnt.id) + '" title="The number of values is set by ' + esc(cnt.fullKey) + '">count: ' + esc(cnt.name) + ' = ' + esc(cnt.tokens[0]) + '</button>';
    }
    return h + '</div>';
  }

  function tokenClass(p, t) {
    var k = DW.tokenKind(t.trim());
    if (!t.trim() || k === 'invalid') return 'bad';
    if (p.kind === 'int' && k === 'real') return 'meh';
    return '';
  }

  function moreHTML(p) {
    var h = '<div class="more">';
    if (p.doc.desc) h += '<div>' + esc(p.doc.desc) + '</div>';
    if (p.doc.options.length) {
      h += '<ul>' + p.doc.options.map(function (o) {
        return '<li><span class="ov">' + esc(o.value) + '</span> — ' + esc(o.label) + (o.detail ? ' <span class="od">' + esc(o.detail) + '</span>' : '') + '</li>';
      }).join('') + '</ul>';
    }
    if (p.comment && p.comment !== p.doc.desc) h += '<div class="note">Inline comment: ' + esc(p.comment) + '</div>';
    var hd = S.hidden.get(p.id);
    if (hd) h += '<div class="note">Not used while ' + esc(hd.text) + '</div>';
    h += '<div class="note">' + esc(p.fullKey) + ' · line ' + (p.lineIdx + 1) + ' · &amp;' + esc(p.namelist || '?') + '</div>';
    return h + '</div>';
  }

  function msgsHTML(p) {
    var ms = S.byKey.get(p.id) || [];
    return '<div class="msgs">' + ms.map(function (c) { return '<div class="msg ' + c.level + '">' + esc(c.msg) + '</div>'; }).join('') + '</div>';
  }

  function rowHTML(p, prefix) {
    var ms = S.byKey.get(p.id) || [];
    var cls = 'row' + (isModified(p) ? ' mod' : '') + (S.hidden.has(p.id) ? ' dormant' : '') +
      (ms.some(function (c) { return c.level === 'error'; }) ? ' err' : ms.length ? ' warn' : '');
    var desc = p.doc.desc;
    var dHTML = desc ? '<div class="d">' + esc(desc) + '</div>' : (p.doc.options.length ? '' : '<div class="d none">No description in the deck</div>');
    var note = p.doc.note ? '<div class="note">' + esc(p.doc.note) + '</div>' : '';
    if (p.comment && p.comment !== desc) note += '<div class="note">! ' + esc(p.comment) + '</div>';
    return '<div class="' + cls + '" data-id="' + esc(p.id) + '">' +
      '<div class="k"><div class="kn" data-act="more" title="' + esc(p.fullKey) + '">' + (prefix ? '<span class="kp">' + esc(prefix) + '</span>' : '') + esc(p.name) + '</div>' + dHTML + note + moreHTML(p) + '</div>' +
      widgetHTML(p) +
      '<div class="side"><button class="reset" data-act="reset" title="Revert to the original value">↺</button>' +
      '<button class="info-t" data-act="more" title="Details">ⓘ</button>' +
      '<button class="ln-link" data-act="line" title="Show in preview">L' + (p.lineIdx + 1) + '</button></div>' +
      '<div class="k2" style="grid-column:2">' + wasHTML(p) + '</div>' +
      msgsHTML(p) + '</div>';
  }

  function rerenderRow(p) {
    var row = rowEl(p);
    if (!row) return;
    var open = row.classList.contains('open');
    var prefix = $('.kp', row) ? $('.kp', row).textContent : '';
    row.outerHTML = rowHTML(p, prefix);
    if (open) rowEl(p).classList.add('open');
  }

  function refreshRowMessages() {
    $$('.row', el.editor).forEach(function (row) {
      var p = S.model.paramMap.get(row.dataset.id);
      if (!p) return;
      var ms = S.byKey.get(p.id) || [];
      row.classList.toggle('err', ms.some(function (c) { return c.level === 'error'; }));
      row.classList.toggle('warn', ms.length > 0 && !row.classList.contains('err'));
      row.classList.toggle('mod', isModified(p));
      $('.msgs', row).outerHTML = msgsHTML(p);
    });
  }

  // ------------------------------------------------------------------ editor views
  function renderEditor(opts) {
    opts = opts || {};
    var scroll = el.editor.scrollTop;
    var focus = null, act = document.activeElement;
    if (opts.keepFocus && act && el.editor.contains(act)) {
      var r = act.closest('.row');
      focus = { id: r && r.dataset.id, act: act.dataset.act, i: act.dataset.i, s: act.selectionStart, e: act.selectionEnd };
    }
    // the Summary is a full-width "slide": the file preview steps aside while it is shown
    document.body.classList.toggle('summary-mode', !S.search && S.sel === '__checks');
    if (S.search) renderSearch();
    else if (S.sel === '__checks') renderChecks();
    else renderBlock(S.blocks.find(function (b) { return b.id === S.sel; }) || S.blocks[0]);
    el.editor.scrollTop = opts.keepScroll ? scroll : 0;
    if (focus && focus.id) {
      var sel = '.row[data-id="' + cssEsc(focus.id) + '"] [data-act="' + focus.act + '"]' + (focus.i != null ? '[data-i="' + focus.i + '"]' : '');
      var f = $(sel, el.editor);
      if (f) {
        f.focus({ preventScroll: true });
        if (f.setSelectionRange && focus.s != null) try { f.setSelectionRange(focus.s, focus.e); } catch (e) { /* not a text input */ }
      }
    }
  }

  // ---- section pager (Summary, then every block in file order)
  function sectionOrder() { return ['__checks'].concat(S.blocks.map(function (b) { return b.id; })); }
  function sectionName(id) { return id === '__checks' ? 'Summary' : id; }
  function neighbours(id) {
    var o = sectionOrder(), i = o.indexOf(id);
    return { prev: i > 0 ? o[i - 1] : null, next: i >= 0 && i < o.length - 1 ? o[i + 1] : null, pos: i + 1, total: o.length };
  }
  function pagerTop(id) {
    var n = neighbours(id);
    return '<div class="pg-mini"><button class="btn icon sm" data-act="goto-sec" data-sec="' + esc(n.prev || '') + '"' + (n.prev ? '' : ' disabled') +
      ' title="Previous section' + (n.prev ? ': ' + esc(sectionName(n.prev)) : '') + ' (Alt+↑)">‹</button>' +
      '<span class="pg-pos">' + n.pos + ' / ' + n.total + '</span>' +
      '<button class="btn icon sm" data-act="goto-sec" data-sec="' + esc(n.next || '') + '"' + (n.next ? '' : ' disabled') +
      ' title="Next section' + (n.next ? ': ' + esc(sectionName(n.next)) : '') + ' (Alt+↓)">›</button></div>';
  }
  function pagerBottom(id) {
    var n = neighbours(id);
    function btn(sec, dir) {
      if (!sec) return '<span></span>';
      var b = S.blocks.find(function (x) { return x.id === sec; });
      return '<button class="pg-btn ' + dir + '" data-act="goto-sec" data-sec="' + esc(sec) + '">' +
        '<span class="pg-dir">' + (dir === 'prev' ? '← Previous' : 'Next →') + '</span>' +
        '<span class="pg-name">' + esc(sectionName(sec)) + '</span>' +
        (b ? '<span class="pg-sub">' + esc(b.title) + (blockStats(b).off ? ' · off' : '') + '</span>' : '') + '</button>';
    }
    return '<div class="pager">' + btn(n.prev, 'prev') + btn(n.next, 'next') + '</div>';
  }
  function stepSection(dir) {
    if (S.search) return;
    var n = neighbours(S.sel), t = dir > 0 ? n.next : n.prev;
    if (t) select(t);
  }

  function renderBlock(b) {
    if (!b) { el.editor.innerHTML = '<div class="empty-note">No parameters found.</div>'; return; }
    var st = blockStats(b);
    var first = b.params[0].lineIdx, last = b.params[b.params.length - 1].lineIdx;
    var nHidden = b.params.filter(function (p) { return S.hidden.has(p.id); }).length;
    var h = '<div class="bh"><div><h2>' + esc(b.id) + '</h2><div class="sub">' + esc(b.title) + (b.blurb ? ' — ' + esc(b.blurb) : '') + '</div>' +
      '<div class="meta">' + b.params.length + ' parameters · lines ' + (first + 1) + '–' + (last + 1) + ' · &amp;' + esc(b.namelist || '?') +
      (nHidden ? ' · ' + nHidden + ' dormant' : '') + '</div></div><div class="bh-side">' + pills(st) + pagerTop(b.id) + '</div></div>';

    // group by doc section, keeping file order
    var secs = [];
    b.params.forEach(function (p) {
      var s = secs[secs.length - 1];
      if (!s || s.sec !== p.section) secs.push(s = { sec: p.section, params: [] });
      s.params.push(p);
    });

    secs.forEach(function (s) {
      var sec = s.sec;
      var docText = sec.commentLines.map(function (l) { return DW.cleanComment(l.raw).text; })
        .filter(function (t) { return /[A-Za-z0-9]/.test(t); }).join('\n');
      h += '<div class="card"><div class="card-h"><h3>' + esc(sec.title || b.id) + '</h3>' +
        (docText ? '<button class="link doc-t" data-act="docs">Show deck notes</button>' : '') + '</div>' +
        (docText ? '<pre class="docs" hidden>' + esc(docText) + '</pre>' : '');
      var curParent = null, i = 0;
      while (i < s.params.length) {
        var p = s.params[i];
        if (p.parent !== curParent) {
          curParent = p.parent;
          if (curParent !== b.id) {
            var rel = curParent.split('%').slice(1).join('%');
            h += '<div class="grp-h"><span class="gp">' + esc(b.id) + '%</span>' + esc(rel) + '</div>';
          }
        }
        var hd = S.hidden.get(p.id);
        var key = groupKey(p);
        if (hd && !S.showDormant && !S.expanded.has(key)) {
          var j = i;
          while (j < s.params.length && s.params[j].parent === p.parent && groupKey(s.params[j]) === key) j++;
          h += '<button class="collapsed" data-act="expand" data-key="' + esc(key) + '">▸ ' + (j - i) + ' parameter' + (j - i > 1 ? 's' : '') +
            ' not used while <code>' + esc(hd.text) + '</code> — show</button>';
          i = j;
          continue;
        }
        h += rowHTML(p, '');
        i++;
      }
      h += '</div>';
    });
    el.editor.innerHTML = h + pagerBottom(b.id);
  }

  function renderSearch() {
    var q = S.search.toLowerCase();
    var hits = S.model.params.filter(function (p) {
      if (p.id.indexOf(q) >= 0) return true;
      if (p.doc.desc.toLowerCase().indexOf(q) >= 0) return true;
      if ((p.comment || '').toLowerCase().indexOf(q) >= 0) return true;
      if (p.tokens.join(', ').toLowerCase() === q) return true;
      return p.doc.options.some(function (o) { return o.label.toLowerCase().indexOf(q) >= 0; });
    });
    var h = '<div class="bh"><div><h2>Search</h2><div class="sub">' + hits.length + ' parameter' + (hits.length === 1 ? '' : 's') + ' matching “' + esc(S.search) + '”</div></div>' +
      '<div class="bh-side"><button class="btn" data-act="clear-search">Clear (Esc)</button></div></div>';
    var cur = null;
    hits.slice(0, 250).forEach(function (p) {
      if (p.top !== cur) {
        if (cur) h += '</div>';
        cur = p.top;
        var b = S.blocks.find(function (x) { return x.id === cur; });
        h += '<div class="card"><div class="card-h"><h3><span class="mono">' + esc(cur) + '</span> · ' + esc(b ? b.title : '') + '</h3></div>';
      }
      var prefix = p.path.slice(1, -1).join('%');
      h += rowHTML(p, prefix ? prefix + '%' : '');
    });
    if (cur) h += '</div>';
    if (!hits.length) h += '<div class="empty-note">Nothing matches. Search looks at names, descriptions, option labels and values.</div>';
    el.editor.innerHTML = h;
  }

  /**
   * Summary page: one screen of key points, like a slide. No folds, no nested
   * details; every bullet jumps to its parameter. Full detail lives in the .txt export.
   */
  function renderChecks() {
    var by = { error: [], warn: [], ok: [], info: [] };
    S.checks.forEach(function (c) { by[c.level].push(c); });
    var nchg = changedLines().length;
    var groups = DW.buildSummary(S.model, S.hidden, S.grid);

    var rt = groups.runType;
    var h = '<div class="bh"><div><h2>Summary' + (rt ? ' <span class="run-type ' + rt.model.toLowerCase().replace('+', '-') + ' clickable" data-key="' + esc(rt.keys[0].toLowerCase()) + '" title="' +
      esc(rt.name + ': ' + rt.why + ' (click to jump to ' + rt.keys[0] + ')') + '">' + rt.kind + '</span><span class="run-why">' + esc(rt.name + ' · ' + rt.why) + '</span>' : '') +
      '</h2><div class="sub">' + esc(S.fileName || 'deck3d.inp') +
      (nchg ? ' · <span class="chg-t">' + nchg + ' changed line' + (nchg > 1 ? 's' : '') + '</span>' : ' · unchanged') + '</div></div>' +
      '<div class="bh-side"><button class="btn sm-txt" data-act="sum-copy" title="Copy the summary as text">Copy</button>' +
      '<button class="btn sm-txt" data-act="sum-dl" title="Download as dnsParamSummary.txt (key points + full detail)">Download .txt</button>' + pagerTop('__checks') + '</div></div>';

    // ---- one status line, then only the problems (one line each)
    var probs = by.error.concat(by.warn).filter(function (c) { return c.title !== 'Syntax'; });
    var nErr = by.error.length, nWarn = by.warn.length, nOk = by.ok.length + by.info.length;
    h += '<div class="status-line ' + (nErr ? 'err' : nWarn ? 'warn' : 'ok') + '">' +
      (nErr ? '<b>✗ ' + nErr + ' error' + (nErr > 1 ? 's' : '') + '</b>' : '<b>✓ No errors</b>') +
      ' · ' + nWarn + ' warning' + (nWarn === 1 ? '' : 's') + ' · ' + nOk + ' checks pass</div>';
    if (S.model.issues.length || probs.length) {
      h += '<ul class="issues">';
      S.model.issues.forEach(function (iss, n) {
        h += '<li class="' + (iss.level === 'error' ? 'error' : 'warn') + ' clickable" data-line="' + iss.line + '">' +
          '<span class="ii">' + (iss.level === 'error' ? '✗' : '!') + '</span><span>Line ' + (iss.line + 1) + ': ' + esc(iss.msg) + '</span>' +
          (iss.fix ? '<button class="fixbtn" data-act="fix" data-n="' + n + '">Fix</button>' : '') + '</li>';
      });
      probs.forEach(function (c) {
        var k = c.keys[0];
        h += '<li class="' + c.level + (k ? ' clickable' : '') + '"' + (k ? ' data-key="' + esc(k) + '"' : '') + '>' +
          '<span class="ii">' + (c.level === 'error' ? '✗' : '!') + '</span><span class="it" title="' + esc(c.title + ': ' + c.msg) + '"><b>' + esc(c.title) + '</b> — ' + esc(c.msg) + '</span></li>';
      });
      h += '</ul>';
    }

    // ---- key points
    h += '<div class="kp-grid">';
    groups.keyPoints.forEach(function (pn, pi) {
      h += '<section class="kp"><h3>' + esc(pn.title) + '</h3><ul>';
      pn.items.forEach(function (it) {
        var k = it.keys[0];
        h += '<li class="' + (it.level || '') + (k ? ' clickable' : '') + '"' + (k ? ' data-key="' + esc(k.toLowerCase()) + '" title="' + esc(it.keys.join(', ')) + '"' : '') + '>' +
          '<span class="kl">' + esc(it.label.replace(/\s*\(.*\)$/, '')) + '</span><span class="kt">' + mathText(it.text) + '</span></li>';
      });
      h += '</ul>';
      if (pi === 0) {
        h += '<div class="kp-grid-in" title="Grid size from REST/grid.h5 (a browser can’t read HDF5). Applies on Enter, Apply, or clicking away. Blank = use the read window.">' +
          '<span class="kl">Grid file</span><span class="ck-grid">' +
          ['imax', 'jmax', 'kmax'].map(function (k) {
            return '<input type="text" inputmode="numeric" data-grid="' + k + '" value="' + esc(S.grid[k] || '') + '" placeholder="' + k + '" aria-label="' + k + '" autocomplete="off">';
          }).join('') +
          '<button class="btn sm-txt" data-act="grid-apply" disabled>Apply</button></span></div>';
      }
      h += '</section>';
    });
    h += '</div>';

    // no bottom pager here: the Summary should fit on one screen (‹ › in the header and Alt+↓ still work)
    el.editor.innerHTML = h;
  }

  // ---- typeset math for the Summary: {M|∞} -> italic M with subscript ∞, 2.58e5 -> 2.58 × 10⁵
  function mathSym(v) {
    if (/^Δ./.test(v)) return 'Δ<i>' + esc(v.slice(1)) + '</i>';       // Δt: operator upright, variable italic
    if (/^[A-Za-z]{2,}$/.test(v)) return esc(v);                      // Re, Pr: upright by convention
    return '<i>' + esc(v) + '</i>';
  }
  function mathSub(s) {
    var m = s.match(/^(\D+)(\d+)$/);                                   // δ0 -> δ with subscript 0
    if (m) return '<i>' + esc(m[1]) + '</i><sub>' + m[2] + '</sub>';
    return /^[A-Za-zα-ω]+$/.test(s) ? '<i>' + esc(s) + '</i>' : esc(s); // letter subscripts italic (u, w, r, t, p); ∞ and digits upright
  }
  function mathText(s) {
    return s.split(/(\{[^}]+\})/).map(function (part) {
      var m = part.match(/^\{([^|}]+)(?:\|([^}]+))?\}$/);
      if (m) return '<span class="mth">' + mathSym(m[1]) + (m[2] ? '<sub>' + mathSub(m[2]) + '</sub>' : '') + '</span>';
      return esc(part).replace(/(\d(?:\.\d+)?)e([+-]?)(\d+)\b/g, function (_, a, sgn, e) {
        return a + '&#8201;×&#8201;10<sup>' + (sgn === '-' ? '−' : '') + e + '</sup>';
      });
    }).join('');
  }

  function summaryText() { return DW.summaryText(DW.buildSummary(S.model, S.hidden, S.grid), S.fileName); }

  // ------------------------------------------------------------------ preview
  function hl(t, type) {
    if (t === '') return ' ';
    if (type === 'comment') return '<span class="c">' + esc(t) + '</span>';
    if (type === 'nlstart' || type === 'nlend') return '<span class="nl">' + esc(t) + '</span>';
    if (type !== 'assign') return esc(t);
    var m = t.match(/^(\s*)([^\s=]+)(\s*=\s*)/);
    if (!m) return esc(t);
    var rest = t.slice(m[0].length), ci = -1, sq = false, dq = false;
    for (var i = 0; i < rest.length; i++) {
      var ch = rest[i];
      if (ch === "'" && !dq) sq = !sq;
      else if (ch === '"' && !sq) dq = !dq;
      else if (ch === '!' && !sq && !dq) { ci = i; break; }
    }
    var code = ci >= 0 ? rest.slice(0, ci) : rest, cmt = ci >= 0 ? rest.slice(ci) : '';
    var vm = code.match(/^([\s\S]*?)(\s*,?\s*)$/);
    return esc(m[1]) + '<span class="ky">' + esc(m[2]) + '</span>' + esc(m[3]) + '<span class="vl">' + esc(vm[1]) + '</span>' + esc(vm[2]) +
      (cmt ? '<span class="c">' + esc(cmt) + '</span>' : '');
  }

  function plHTML(i) {
    var line = S.model.lines[i], t = DW.lineText(line);
    return '<div class="pl' + (line.type === 'assign' ? ' a' : '') + (t !== S.baseLines[i] ? ' chg' : '') + (i === S.focusLine ? ' foc' : '') +
      '" data-i="' + i + '"><span class="g">' + (i + 1) + '</span><span>' + hl(t, line.type) + '</span></div>';
  }

  function renderPreview() {
    var h = '';
    for (var i = 0; i < S.model.lines.length; i++) h += plHTML(i);
    el.code.innerHTML = h;
    updateIssueMarks();
    if (S.view === 'diff') renderDiff();
  }

  function updateIssueMarks() {
    $$('.pl.iss', el.code).forEach(function (n) { n.classList.remove('iss'); });
    S.model.issues.forEach(function (iss) { var n = el.code.children[iss.line]; if (n) n.classList.add('iss'); });
  }

  function updatePreviewLine(i) {
    var n = el.code.children[i];
    if (!n) return;
    var tmp = document.createElement('div');
    tmp.innerHTML = plHTML(i);
    el.code.replaceChild(tmp.firstChild, n);
  }

  function setFocusLine(i, scroll) {
    var old = el.code.children[S.focusLine];
    if (old) old.classList.remove('foc');
    S.focusLine = i;
    var n = el.code.children[i];
    if (!n) return;
    n.classList.add('foc');
    if (scroll && S.view === 'full') {
      var r = n.getBoundingClientRect(), c = el.code.getBoundingClientRect();
      if (r.top < c.top + 20 || r.bottom > c.bottom - 20) {
        el.code.scrollTop += r.top - c.top - c.height / 2 + r.height / 2;
      }
    }
  }

  function renderDiff() {
    var ch = changedLines();
    if (!ch.length) { el.diff.innerHTML = '<div class="none">No changes yet. Edited lines show up here as before/after pairs.</div>'; return; }
    var h = '';
    ch.forEach(function (i) {
      var p = S.model.lines[i].param;
      h += '<div class="dh" data-i="' + i + '"><b>L' + (i + 1) + '</b>' + (p ? '<span>' + esc(p.fullKey) + '</span>' : '') + '</div>' +
        '<div class="dl del">- ' + esc(S.baseLines[i] == null ? '' : S.baseLines[i]) + '</div>' +
        '<div class="dl ins">+ ' + esc(DW.lineText(S.model.lines[i])) + '</div>';
    });
    el.diff.innerHTML = h;
  }

  function setView(v) {
    S.view = v;
    $('#pv-full').classList.toggle('on', v === 'full');
    $('#pv-diff').classList.toggle('on', v === 'diff');
    el.code.hidden = v !== 'full';
    el.diff.hidden = v !== 'diff';
    if (v === 'diff') renderDiff();
  }

  function stepChange(dir) {
    var ch = changedLines();
    if (!ch.length) { toast('No changes yet'); return; }
    if (S.view !== 'full') setView('full');
    var cur = S.focusLine, next;
    if (dir > 0) next = ch.find(function (i) { return i > cur; });
    else next = ch.slice().reverse().find(function (i) { return i < cur; });
    if (next == null) next = dir > 0 ? ch[0] : ch[ch.length - 1];
    setFocusLine(next, true);
    var p = S.model.lines[next].param;
    if (p) gotoParam(p, { focus: false, fromPreview: true });
  }

  // ------------------------------------------------------------------ navigation
  function select(id) {
    S.sel = id;
    if (S.search) { S.search = ''; el.search.value = ''; }
    renderNav();
    renderEditor();
  }

  function gotoParam(p, opts) {
    opts = opts || {};
    var need = false;
    if (S.search) { S.search = ''; el.search.value = ''; need = true; }
    if (S.sel !== p.top) { S.sel = p.top; need = true; }
    if (S.hidden.has(p.id) && !S.showDormant && !S.expanded.has(groupKey(p))) { S.expanded.add(groupKey(p)); need = true; }
    if (need) { renderNav(); renderEditor(); }
    var row = rowEl(p);
    if (!row) return;
    row.scrollIntoView({ block: 'center', behavior: opts.fromPreview ? 'smooth' : 'auto' });
    row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash');
    if (!opts.fromPreview) setFocusLine(p.lineIdx, true);
    if (opts.focus !== false) {
      var f = $('.w input, .w select, .w button', row);
      if (f) f.focus({ preventScroll: true });
    }
  }

  // ------------------------------------------------------------------ editor events
  function paramOf(node) {
    var row = node.closest('.row');
    return row ? S.model.paramMap.get(row.dataset.id) : null;
  }

  // ---- grid size: applied on Apply, Enter, or when focus leaves the three boxes
  function gridInputs() { return $$('input[data-grid]', el.editor); }
  function gridDirty() {
    return gridInputs().some(function (i) { return i.value.trim() !== String(S.grid[i.dataset.grid] || ''); });
  }
  function applyGrid() {
    var ins = gridInputs();
    if (!ins.length || !gridDirty()) return;
    if (ins.some(function (i) { return i.classList.contains('bad'); })) { toast('Grid sizes must be whole numbers (or blank)'); return; }
    var g = {};
    ins.forEach(function (i) { var v = parseInt(i.value, 10); if (v > 0) g[i.dataset.grid] = v; });
    S.grid = g;
    recompute();
    renderNav();
    renderEditor({ keepScroll: true });
    saveDraftSoon();
    toast(Object.keys(g).length
      ? 'Checking against grid ' + ['imax', 'jmax', 'kmax'].map(function (k) { return g[k] || 'auto'; }).join(' × ')
      : 'Grid size cleared, using RunParam%*end_rd');
  }
  el.editor.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.dataset && e.target.dataset.grid) { e.preventDefault(); applyGrid(); }
  });
  el.editor.addEventListener('focusout', function (e) {
    if (!e.target.dataset || !e.target.dataset.grid) return;
    var box = e.target.closest('.ck-grid');
    if (e.relatedTarget && box && box.contains(e.relatedTarget)) return; // moving between boxes or to Apply
    applyGrid();
  });

  el.editor.addEventListener('input', function (e) {
    var t = e.target, p = paramOf(t);
    if (t.dataset.grid) {
      // only validate while typing; nothing is re-evaluated until applied
      t.classList.toggle('bad', t.value.trim() !== '' && !/^\d+$/.test(t.value.trim()));
      var btn = $('[data-act="grid-apply"]', el.editor);
      if (btn) btn.disabled = !gridDirty();
      return;
    }
    if (!p) return;
    if (t.dataset.act === 'tok') {
      var raw = t.value, v2 = raw.trim(), i = +t.dataset.i;
      t.style.setProperty('--ch', Math.max(4, raw.length));
      t.className = tokenClass(p, raw);
      if (v2.indexOf(',') >= 0) return; // split on change
      if (!v2 || DW.tokenKind(v2) === 'invalid') return; // keep last valid value in the deck
      var toks = p.tokens.slice(); toks[i] = v2;
      commit(p, toks, p.id + ':' + i);
    } else if (t.dataset.act === 'str') {
      var q = /^"/.test(p.tokens[0]) ? '"' : "'";
      if (t.value.indexOf(q) >= 0) { t.classList.add('bad'); return; }
      t.classList.remove('bad');
      commit(p, [q + t.value + q], p.id + ':s');
    }
  });

  el.editor.addEventListener('change', function (e) {
    var t = e.target, p = paramOf(t);
    if (!p) return;
    if (t.dataset.act === 'enum') {
      commit(p, [t.value]);
      rerenderRow(p);
      var s2 = $('select', rowEl(p)); if (s2) s2.focus();
    } else if (t.dataset.act === 'tok') {
      var i = +t.dataset.i, v = t.value.trim();
      if (v.indexOf(',') >= 0) {
        toast('One value per field. The number of values is set by its count parameter');
        t.value = p.tokens[i];
        t.className = tokenClass(p, p.tokens[i]);
      } else if (!v || DW.tokenKind(v) === 'invalid') {
        toast('“' + (v || 'empty') + '” is not a valid Fortran value — kept ' + p.tokens[i]);
        t.value = p.tokens[i];
        t.className = tokenClass(p, p.tokens[i]);
      }
    }
  });

  el.editor.addEventListener('click', function (e) {
    var a = e.target.closest('[data-act], [data-key], [data-line]');
    if (!a || !el.editor.contains(a)) return;
    var act = a.dataset.act, p = paramOf(a);
    if (act === 'sw' && p) {
      var w = widgetOf(p), v = p.tokens[0], nv;
      if (w === 'switch') nv = v === '0' ? '1' : '0';
      else {
        var on = /^\.?t/i.test(v), up = v === v.toUpperCase();
        nv = /^\./.test(v) ? (on ? '.false.' : '.true.') : (on ? 'f' : 't');
        if (up) nv = nv.toUpperCase();
      }
      commit(p, [nv]);
      rerenderRow(p);
      var b = $('.sw', rowEl(p)); if (b) b.focus();
    } else if (act === 'sum-copy') {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(summaryText()).then(function () { toast('Summary copied'); }, function () { toast('Clipboard not available'); });
      } else toast('Clipboard not available');
    } else if (act === 'sum-dl') {
      var blob = new Blob([summaryText()], { type: 'text/plain' });
      var link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'dnsParamSummary.txt';
      document.body.appendChild(link); link.click();
      setTimeout(function () { URL.revokeObjectURL(link.href); link.remove(); }, 0);
      toast('Downloaded dnsParamSummary.txt');
    } else if (act === 'goto-sec') {
      if (a.dataset.sec) select(a.dataset.sec);
    } else if (act === 'reset' && p) {
      var bp = baseParam(p);
      if (bp) { commit(p, bp.tokens.slice()); rerenderRow(p); }
    } else if (act === 'more' && p) {
      rowEl(p).classList.toggle('open');
    } else if (act === 'line' && p) {
      if (S.view !== 'full') setView('full');
      document.body.classList.add('show-preview');
      setFocusLine(p.lineIdx, true);
    } else if (act === 'docs') {
      var pre = a.closest('.card').querySelector('.docs');
      pre.hidden = !pre.hidden;
      a.textContent = pre.hidden ? 'Show deck notes' : 'Hide deck notes';
    } else if (act === 'expand') {
      S.expanded.add(a.dataset.key);
      renderEditor({ keepScroll: true });
    } else if (act === 'grid-apply') {
      applyGrid();
    } else if (act === 'clear-search') {
      clearSearch();
    } else if (act === 'fix') {
      var iss = S.model.issues[+a.dataset.n];
      if (iss && iss.fix != null) applyFixes([iss]);
    } else if (act === 'fixall') {
      applyFixes(S.model.issues.filter(function (i) { return i.fix; }));
    } else if (a.dataset.key) {
      var q = S.model.paramMap.get(a.dataset.key);
      if (q) gotoParam(q);
    } else if (a.dataset.line != null) {
      var ln = +a.dataset.line, lp = S.model.lines[ln] && S.model.lines[ln].param;
      if (lp) gotoParam(lp); else { setView('full'); setFocusLine(ln, true); }
    }
  });

  // remember which summary groups are folded across re-renders
  el.editor.addEventListener('toggle', function (e) {
    var d = e.target;
    if (!d.classList || !d.classList.contains('sg')) return;
    var g = d.dataset.g === 'checks' ? 'checks' : +d.dataset.g;
    var stored = g === 'checks' ? d.open : !d.open; // 'checks' is stored when open, groups when closed
    if (stored) S.sumClosed.add(g); else S.sumClosed.delete(g);
  }, true);

  el.editor.addEventListener('focusin', function (e) {
    var p = paramOf(e.target);
    if (p) setFocusLine(p.lineIdx, true);
  });

  function applyFixes(list) {
    var lines = S.model.lines.map(DW.lineText);
    list.forEach(function (i) { lines[i.line] = i.fix; });
    pushTextUndo();
    applyText(lines.join(S.model.eol) + (S.model.finalNewline ? S.model.eol : ''));
    toast('Fixed ' + list.length + ' line' + (list.length > 1 ? 's' : ''));
  }

  // ------------------------------------------------------------------ chrome & other events
  function updateChrome() {
    if (!S.model) return;
    var n = changedLines().length;
    el.fileinfo.innerHTML = '<span class="name">' + esc(S.fileName || 'deck3d.inp') + '</span>' + (n ? '<span class="chg">● ' + n + ' changed line' + (n > 1 ? 's' : '') + '</span>' : '');
    $('#pv-count').textContent = n;
    $('#btn-undo').disabled = !S.undo.length;
    $('#btn-redo').disabled = !S.redo.length;
    $('#btn-download').disabled = false;
    $('#btn-tools').disabled = false;
    $('#btn-preview').disabled = false;
    el.search.disabled = false;
    $('#btn-save').hidden = !S.handle;
    $('[data-act="dormant"]', $('#tools-pop')).classList.toggle('on', S.showDormant);
    document.title = (n ? '● ' : '') + (S.fileName || 'deck3d.inp') + ' · deckweb';
  }

  el.nav.addEventListener('click', function (e) {
    var b = e.target.closest('[data-b]');
    if (b) select(b.dataset.b);
  });

  el.code.addEventListener('click', function (e) {
    var n = e.target.closest('.pl');
    if (!n) return;
    var i = +n.dataset.i, p = S.model.lines[i].param;
    setFocusLine(i, false);
    if (p) gotoParam(p, { fromPreview: true });
  });
  el.diff.addEventListener('click', function (e) {
    var n = e.target.closest('.dh');
    if (!n) return;
    var p = S.model.lines[+n.dataset.i].param;
    if (p) gotoParam(p);
  });

  $('#pv-full').onclick = function () { setView('full'); };
  $('#pv-diff').onclick = function () { setView('diff'); };
  $('#pv-prev').onclick = function () { stepChange(-1); };
  $('#pv-next').onclick = function () { stepChange(1); };
  $('#btn-undo').onclick = function () { undoRedo(true); };
  $('#btn-redo').onclick = function () { undoRedo(false); };
  $('#btn-preview').onclick = function () { document.body.classList.toggle('show-preview'); };

  // search
  function clearSearch() { S.search = ''; el.search.value = ''; renderNav(); renderEditor(); }
  el.search.addEventListener('input', debounce(function () {
    S.search = el.search.value.trim();
    renderNav();
    renderEditor();
  }, 120));
  el.search.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { clearSearch(); el.search.blur(); }
    if (e.key === 'Enter') { var f = $('.row .w input, .row .w select, .row .w button', el.editor); if (f) f.focus(); }
  });

  // tools menu
  var pop = $('#tools-pop');
  $('#btn-tools').onclick = function (e) { e.stopPropagation(); pop.hidden = !pop.hidden; };
  document.addEventListener('click', function (e) { if (!pop.hidden && !pop.contains(e.target)) pop.hidden = true; });
  pop.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    pop.hidden = true;
    var act = b.dataset.act;
    if (act === 'dormant') { S.showDormant = !S.showDormant; updateChrome(); renderEditor({ keepScroll: true }); }
    else if (act === 'align') {
      pushTextUndo();
      applyText(DW.alignColumns(S.model));
      toast('Columns aligned (undo with Ctrl+Z)');
    } else if (act === 'copy') copyDeck();
    else if (act === 'reset') {
      if (!hasChanges() || confirm('Revert every change back to the file as it was opened?')) { pushTextUndo(); applyText(S.base); toast('All changes reverted'); }
    } else if (act === 'close') {
      if (hasChanges() && !confirm('Close this deck? Your changes are lost unless you download or save them first.')) return;
      lsDel(LS_DRAFT);
      S.model = null; S.handle = null;
      el.app.hidden = true; el.empty.hidden = false;
      el.fileinfo.innerHTML = ''; el.search.disabled = true;
      ['#btn-undo', '#btn-redo', '#btn-download', '#btn-tools', '#btn-preview'].forEach(function (s) { $(s).disabled = true; });
      $('#btn-save').hidden = true;
      document.title = 'deckweb · deck3d.inp editor';
      renderResume();
    }
  });

  function copyDeck() {
    var t = currentText();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(function () { toast('Deck copied to clipboard'); }, function () { toast('Clipboard not available'); });
    } else toast('Clipboard not available');
  }

  // ------------------------------------------------------------------ files
  function openFile(file, handle) {
    if (hasChanges() && !confirm('Open another file? Unsaved changes to ' + S.fileName + ' will be lost.')) return;
    file.text().then(function (text) {
      S.fileName = file.name;
      S.handle = handle || null;
      S.grid = {};
      loadText(text);
      var n = S.model.params.length;
      toast('Loaded ' + n + ' parameters from ' + file.name);
    });
  }

  function pickFile() {
    if (window.showOpenFilePicker) {
      window.showOpenFilePicker({ types: [{ description: 'Deck files', accept: { 'text/plain': ['.inp', '.txt'] } }], excludeAcceptAllOption: false })
        .then(function (hs) { return hs[0].getFile().then(function (f) { openFile(f, hs[0]); }); })
        .catch(function (err) { if (err && err.name !== 'AbortError') el.file.click(); });
    } else el.file.click();
  }
  $('#btn-open').onclick = pickFile;
  $('#btn-open2').onclick = pickFile;
  el.file.onchange = function () { if (el.file.files[0]) openFile(el.file.files[0], null); el.file.value = ''; };

  function download() {
    var blob = new Blob([currentText()], { type: 'text/plain' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = S.fileName || 'deck3d.inp';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    toast('Downloaded ' + a.download);
  }
  $('#btn-download').onclick = download;

  function saveInPlace() {
    if (!S.handle) return download();
    S.handle.createWritable().then(function (w) {
      return w.write(currentText()).then(function () { return w.close(); });
    }).then(function () { toast('Saved to ' + S.fileName); }, function (err) { toast('Could not save: ' + (err && err.message || err)); });
  }
  $('#btn-save').onclick = saveInPlace;

  // drag & drop
  var dragDepth = 0;
  window.addEventListener('dragenter', function (e) { e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
  window.addEventListener('dragleave', function () { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('drop', function (e) {
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dragging');
    var item = e.dataTransfer.items && e.dataTransfer.items[0];
    var file = e.dataTransfer.files[0];
    if (!file) return;
    if (item && item.getAsFileSystemHandle) {
      item.getAsFileSystemHandle().then(function (h) { openFile(file, h && h.kind === 'file' ? h : null); }, function () { openFile(file, null); });
    } else openFile(file, null);
  });

  // keyboard
  document.addEventListener('keydown', function (e) {
    var mod = e.ctrlKey || e.metaKey, tag = (e.target.tagName || '').toLowerCase();
    var typing = tag === 'input' || tag === 'textarea' || tag === 'select';
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); if (S.model) (S.handle ? saveInPlace : download)(); return; }
    if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); pickFile(); return; }
    if (!S.model) return;
    if (mod && !typing && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) {
      e.preventDefault();
      undoRedo(e.key.toLowerCase() === 'z' && !e.shiftKey);
      return;
    }
    if (e.altKey && !mod && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && tag !== 'select') {
      e.preventDefault();
      stepSection(e.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (!typing && (e.key === '/' || (mod && e.key.toLowerCase() === 'k'))) { e.preventDefault(); el.search.focus(); el.search.select(); }
    if (e.key === 'Escape' && document.body.classList.contains('show-preview')) document.body.classList.remove('show-preview');
  });

  // splitter
  (function () {
    var sp = $('#splitter'), dragging = false;
    if (prefs.pv) el.app.style.setProperty('--pv-w', prefs.pv + 'px');
    sp.addEventListener('pointerdown', function (e) { dragging = true; sp.classList.add('drag'); sp.setPointerCapture(e.pointerId); });
    sp.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var w = Math.round(Math.max(300, Math.min(window.innerWidth - 640, window.innerWidth - e.clientX)));
      el.app.style.setProperty('--pv-w', w + 'px');
      prefs.pv = w;
    });
    sp.addEventListener('pointerup', function () { dragging = false; sp.classList.remove('drag'); savePrefs(); });
  })();

  // theme
  if (prefs.theme) document.documentElement.setAttribute('data-theme', prefs.theme);
  $('#btn-theme').onclick = function () {
    var cur = document.documentElement.getAttribute('data-theme') ||
      (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    prefs.theme = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', prefs.theme);
    savePrefs();
  };

  // draft restore
  function renderResume() {
    var d = lsGet(LS_DRAFT), box = $('#resume');
    if (!d || !d.text) { box.innerHTML = ''; return; }
    var a = d.base.split(/\r?\n/), b = d.text.split(/\r?\n/), n = 0;
    for (var i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) n++;
    var mins = Math.round((Date.now() - d.t) / 60000);
    var when = mins < 1 ? 'just now' : mins < 60 ? mins + ' min ago' : mins < 1440 ? Math.round(mins / 60) + ' h ago' : Math.round(mins / 1440) + ' d ago';
    box.innerHTML = '<div class="resume"><div class="rt">Last session: <code>' + esc(d.name || 'deck3d.inp') + '</code><br><span class="muted">' +
      (n ? n + ' changed line' + (n > 1 ? 's' : '') : 'no changes') + ' · ' + when + '</span></div>' +
      '<div><button class="btn primary" id="btn-resume">Resume</button> <button class="btn" id="btn-discard">Discard</button></div></div>';
    $('#btn-resume').onclick = function () {
      S.fileName = d.name; S.handle = null; S.grid = d.grid || {};
      loadText(d.base);
      if (d.text !== d.base) { applyText(d.text); S.undo = []; updateChrome(); }
      toast('Draft restored. Download or Save to write it out.');
    };
    $('#btn-discard').onclick = function () { lsDel(LS_DRAFT); box.innerHTML = ''; };
  }
  renderResume();

  // exposed for tests / console use
  window.deckweb = {
    state: S,
    loadText: function (text, name) { S.fileName = name || 'deck3d.inp'; S.handle = null; S.grid = {}; loadText(text); },
    text: currentText
  };
})();
