/*
 * Documentation extractor. Reads the "!!" comment blocks in the deck and
 * turns them into per-parameter descriptions and enum options, the same
 * zero-hardcoding idea as deckcheck's parser, tuned to the many option
 * styles used in deck3d.inp:
 *     0: text      0  text      =0: text      1 -- text     0-- 'text'
 *     name: 0: text            name: 0 = A, 1 = B, 2 = C
 * Option columns are tracked, so nested sub-lists (e.g. the stencilsize
 * list under iConvSchm) become details instead of overwriting options.
 */
(function () {
  'use strict';
  var DW = (window.DW = window.DW || {});

  // Doc names that do not literally match the parameter they describe.
  var DOC_ALIASES = { iflowformat: 'iflowdataformat', ixdirshape: 'ixshape' };

  var VAR_RE = /^([A-Za-z_][\w%]*(?:\s*,\s*[A-Za-z_][\w%]*)*)\s*:\s*(.*)$/;
  var OPT_RE = /^=?\s*(-?\d+)(?![\d.,)*\/])\s*(?::|--|=(?!=)|-)?\s*(\S.*)$/;
  var MULTI_OPT_PART = /^(-?\d+)\s*(?:=|:|--)\s*(.+)$/;
  var SWITCH_RE = /\bturn(?:s|ed)?\b[^.]*\b(?:on|off)\b|\bflag\b|\bor not\b|\(1 or 0\)|\b1 to turn on|\bistatus\s*=\s*1|on\/off|\bwhether\b|=\s*1\s*,\s*turn on/i;

  function cleanComment(raw) {
    var m = raw.match(/^[\s!]*/);
    var col = m[0].length;
    var body = raw.slice(col).replace(/\t/g, '    ');
    body = body.replace(/\s*!+\s*$/, '').trim();
    return { text: body, col: col };
  }

  function isDivider(t) {
    return t === '' || !/[A-Za-z0-9]/.test(t) || t[0] === '|';
  }

  function sharedPrefix(a, b) {
    var n = 0;
    while (n < a.length && n < b.length && a[n] === b[n]) n++;
    return n;
  }

  function newDoc() {
    return { desc: '', options: new Map(), note: '' };
  }

  function addOption(doc, value, label) {
    label = label.replace(/\s+/g, ' ').replace(/^(?:for|to)\s+/i, '').trim();
    if (!label) return null;
    var cur = doc.options.get(value);
    if (cur) { cur.label += ' / ' + label; return cur; }
    var o = { value: value, label: label, detail: '' };
    doc.options.set(value, o);
    return o;
  }

  /**
   * Group lines into sections (a comment block of 3+ lines starts a new one)
   * and attach short comment runs as notes on the assignments that follow.
   */
  function buildSections(model) {
    var sections = [];
    var cur = null, note = '', run = [], nlName = null;

    function defaultSection() {
      var s = { id: 's' + sections.length, title: (nlName || 'Deck') + ' (general)', commentLines: [], params: [], docs: new Map(), general: [] };
      sections.push(s);
      return s;
    }

    model.lines.forEach(function (line) {
      if (line.type === 'comment' || line.type === 'blank') { run.push(line); return; }
      if (line.type === 'nlstart') { nlName = line.namelist; cur = null; note = ''; run = []; return; }
      if (line.type !== 'assign') { run = []; return; }

      if (run.length) {
        var cmts = run.filter(function (l) { return l.type === 'comment'; });
        if (cmts.length >= 3) {
          cur = { id: 's' + sections.length, title: '', commentLines: cmts, params: [], docs: new Map(), general: [] };
          for (var i = 0; i < cmts.length; i++) {
            var t = cleanComment(cmts[i].raw).text;
            if (!isDivider(t)) { cur.title = t; break; }
          }
          sections.push(cur);
          note = '';
        } else {
          note = cmts.map(function (l) { return cleanComment(l.raw).text; }).filter(Boolean).join(' ');
        }
        run = [];
      }
      if (!cur) cur = defaultSection();
      var p = line.param;
      p.section = cur;
      p.note = note;
      cur.params.push(p);
    });
    return sections;
  }

  function parseSectionDocs(sec) {
    var names = [];
    sec.params.forEach(function (p) {
      var k = p.name.toLowerCase();
      if (names.indexOf(k) < 0) names.push(k);
    });

    function resolve(raw) {
      var n = raw.trim();
      if (n.indexOf('%') >= 0) n = n.split('%').pop();
      // placeholder axis, e.g. zone_Xbeg -> zone_ibeg, zone_jbeg, zone_kbeg
      if (/X/.test(n.slice(1))) {
        var subs = [];
        'ijk'.split('').forEach(function (d) {
          resolve(n.slice(0, 1) + n.slice(1).replace(/X/g, d)).forEach(function (r) { if (subs.indexOf(r) < 0) subs.push(r); });
        });
        return subs;
      }
      n = n.toLowerCase();
      if (DOC_ALIASES[n]) n = DOC_ALIASES[n];
      if (names.indexOf(n) >= 0) return [n];
      var suf = names.filter(function (k) { return k !== n && k.length - n.length <= 1 && k.slice(-n.length) === n; });
      if (suf.length) return suf;
      if (n.length >= 5) return names.filter(function (k) { return k.indexOf(n) >= 0; });
      return [];
    }

    function docFor(n) {
      if (!sec.docs.has(n)) sec.docs.set(n, newDoc());
      return sec.docs.get(n);
    }

    var curVars = [], optCol = null, defCol = 0, nestedCol = null, lastOpt = null;
    var lastDefHadBody = true, lastDefName = '', pendingNames = [];

    function resetScope() { curVars = []; optCol = null; nestedCol = null; lastOpt = null; pendingNames = []; }

    function applyOption(value, label) {
      curVars.forEach(function (v) { addOption(docFor(v), value, label); });
      lastOpt = { value: value };
      lastDefHadBody = true;
    }

    function appendText(text) {
      if (!curVars.length) { sec.general.push(text); return; }
      curVars.forEach(function (v) {
        var d = docFor(v);
        if (lastOpt && d.options.has(lastOpt.value)) {
          var o = d.options.get(lastOpt.value);
          o.detail = (o.detail ? o.detail + ' ' : '') + text;
        } else {
          d.desc = (d.desc ? d.desc + ' ' : '') + text;
        }
      });
      lastDefHadBody = true;
    }

    /** Options written inline after "name:" — single, or a list split by , or ; */
    function inlineOptions(desc) {
      var parts = desc.split(/[,;]\s*(?=-?\d+\s*(?:=|:|--)|-?\d+\s+[A-Za-z])/);
      if (parts.length >= 2 && parts.every(function (s) { return OPT_RE.test(s.trim()); })) {
        return parts.map(function (s) { var m = s.trim().match(OPT_RE); return [m[1], m[2]]; });
      }
      var mo = desc.match(OPT_RE);
      return mo ? [[mo[1], mo[2]]] : null;
    }

    sec.commentLines.forEach(function (line) {
      var c = cleanComment(line.raw);
      var t = c.text;
      if (isDivider(t)) { resetScope(); return; }

      // "a, b, c," continued on the next line
      if (/^[A-Za-z_][\w%]*(?:\s*,\s*[A-Za-z_][\w%]*)*\s*,$/.test(t)) {
        var ns = [];
        t.slice(0, -1).split(',').forEach(function (n) { resolve(n).forEach(function (r) { ns.push(r); }); });
        if (ns.length) { pendingNames = pendingNames.concat(ns); return; }
      }

      var mv = t.match(VAR_RE);
      if (mv) {
        var resolved = pendingNames.slice();
        mv[1].split(',').forEach(function (n) {
          resolve(n).forEach(function (r) { if (resolved.indexOf(r) < 0) resolved.push(r); });
        });
        pendingNames = [];
        if (resolved.length) {
          var desc = mv[2].trim();
          var first = resolved[0];
          // consecutive definitions of closely-named params share the option list that follows
          var group = curVars.length && !lastDefHadBody && optCol === null && sharedPrefix(lastDefName, first) >= 5;
          curVars = group ? curVars.concat(resolved) : resolved;
          lastDefName = first;
          defCol = c.col;
          lastOpt = null;
          optCol = null;
          nestedCol = null;
          lastDefHadBody = false;

          var opts = inlineOptions(desc);
          if (opts) {
            if (opts.length === 1) optCol = c.col + t.length - desc.length + (desc.length - desc.replace(/^=?\s*/, '').length);
            opts.forEach(function (o) { applyOption(o[0], o[1]); });
            if (opts.length > 1) lastOpt = null;
            return;
          }
          resolved.forEach(function (v) {
            var d = docFor(v);
            if (desc && d.desc.indexOf(desc) < 0) d.desc = (d.desc ? d.desc + ' ' : '') + desc;
          });
          return;
        }
        // "something:" that is not one of our params
        if (curVars.length && c.col > defCol + 2) {
          nestedCol = c.col;           // nested sub-list (e.g. stencilsize under iConvSchm)
          appendText(t);
        } else {
          resetScope();
          sec.general.push(t);
        }
        return;
      }

      var mo = curVars.length ? t.match(OPT_RE) : null;
      if (mo) {
        var col = c.col + (t.length - t.replace(/^=?\s*/, '').length);
        if (nestedCol !== null && col > nestedCol) { appendText(t); return; }
        if (optCol === null || col <= optCol + 1) {
          optCol = col;
          nestedCol = null;
          applyOption(mo[1], mo[2]);
          return;
        }
      }
      appendText(t);
    });

    // A switch whose documented options skip 0 still accepts 0 = off.
    sec.docs.forEach(function (d) {
      if (d.options.size && !d.options.has('0') && SWITCH_RE.test(d.desc)) addOption(d, '0', 'off');
    });
  }

  function extractDocs(model) {
    var sections = buildSections(model);
    sections.forEach(parseSectionDocs);
    model.sections = sections;

    model.params.forEach(function (p) {
      var d = p.section && p.section.docs.get(p.name.toLowerCase());
      var doc = { desc: d ? d.desc : '', options: [], note: p.note || '', comment: p.comment };
      if (d) {
        d.options.forEach(function (o) { doc.options.push(o); });
        doc.options.sort(function (a, b) { return Number(a.value) - Number(b.value); });
      }
      if (!doc.desc && p.comment) doc.desc = p.comment;
      p.doc = doc;

      var single = p.tokens.length === 1;
      var v = single ? p.tokens[0] : null;
      var text = doc.desc + ' ' + (p.comment || '');
      if (p.kind === 'logical' && single) p.widget = 'logical';
      else if (p.kind === 'int' && single && doc.options.length >= 2) p.widget = 'enum';
      else if (p.kind === 'int' && single && (v === '0' || v === '1') &&
        (/^(istatus|iuse)$/i.test(p.name) || (SWITCH_RE.test(text) && /^i|flag/i.test(p.name + ' ' + text)))) p.widget = 'switch';
      else if (p.kind === 'string' && single) p.widget = 'string';
      else p.widget = 'list';
    });
    return sections;
  }

  DW.extractDocs = extractDocs;
  DW.cleanComment = cleanComment;
})();
