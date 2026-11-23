/*
 * deck3d.inp parser: line-preserving model of a Fortran namelist file.
 *
 * Every line of the input is kept verbatim. Assignment lines additionally
 * record where their value starts and ends, so an edit replaces ONLY the
 * value text; indentation, '=' spacing, trailing comma and inline comment
 * stay exactly as they were. An unedited deck serializes byte-for-byte
 * identical to the input.
 */
(function () {
  'use strict';
  var DW = (window.DW = window.DW || {});

  var NUM_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?$/;
  var INT_RE = /^[+-]?\d+$/;
  var LOGICAL_RE = /^(?:\.(?:true|false)\.|[TFtf])$/;
  var STR_RE = /^(['"])[\s\S]*\1$/;
  var REPEAT_RE = /^(\d+)\*(.+)$/;
  var KEY_RE = /^(\s*)([A-Za-z]\w*(?:\([^)]*\))?(?:%[A-Za-z]\w*(?:\([^)]*\))?)*)(\s*=\s*)/;

  function tokenKind(tok) {
    if (INT_RE.test(tok)) return 'int';
    if (NUM_RE.test(tok)) return 'real';
    if (LOGICAL_RE.test(tok)) return 'logical';
    if (STR_RE.test(tok)) return 'string';
    var r = tok.match(REPEAT_RE);
    if (r && tokenKind(r[2]) !== 'invalid') return 'repeat';
    return 'invalid';
  }

  /** Index of the first '!' outside quotes, and whether a quote is left open. */
  function scanComment(s) {
    var sq = false, dq = false;
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (ch === "'" && !dq) sq = !sq;
      else if (ch === '"' && !sq) dq = !dq;
      else if (ch === '!' && !sq && !dq) return { at: i, unclosed: false };
    }
    return { at: -1, unclosed: sq || dq };
  }

  /** Split on commas outside quotes; tokens are trimmed (may be empty). */
  function splitTokens(s) {
    var out = [], cur = '', sq = false, dq = false;
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (ch === "'" && !dq) sq = !sq;
      else if (ch === '"' && !sq) dq = !dq;
      if (ch === ',' && !sq && !dq) { out.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  }

  function parseDeck(text) {
    var eol = text.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
    var rawLines = text.split(/\r?\n/);
    var finalNewline = false;
    if (rawLines.length && rawLines[rawLines.length - 1] === '') {
      rawLines.pop();
      finalNewline = true;
    }

    var model = {
      eol: eol,
      finalNewline: finalNewline,
      lines: [],
      params: [],
      paramMap: new Map(),
      namelists: [],
      issues: []
    };
    var nl = null;

    function issue(idx, level, msg, fix) {
      model.issues.push({ line: idx, level: level, msg: msg, fix: fix || null });
    }

    rawLines.forEach(function (raw, idx) {
      var line = { idx: idx, raw: raw, type: 'unknown', namelist: nl ? nl.name : null, param: null };
      var t = raw.trim();

      if (!t) {
        line.type = 'blank';
      } else if (t[0] === '!') {
        line.type = 'comment';
      } else if (t[0] === '&') {
        line.type = 'nlstart';
        var name = t.slice(1).split(/[\s!]/)[0];
        if (nl) issue(idx, 'error', 'Namelist &' + nl.name + ' (line ' + (nl.start + 1) + ') is not closed with "/" before &' + name);
        nl = { name: name, start: idx, end: null };
        model.namelists.push(nl);
        line.namelist = name;
      } else if (t[0] === '/') {
        line.type = 'nlend';
        if (nl) { nl.end = idx; nl = null; }
        else issue(idx, 'warn', 'Stray "/" outside of a namelist');
      } else {
        var m = raw.match(KEY_RE);
        if (!m) {
          issue(idx, 'warn', 'Unrecognized line: not an assignment, comment, or namelist marker');
        } else {
          line.type = 'assign';
          var p = parseAssignment(raw, idx, m, nl, issue);
          line.param = p;
          model.params.push(p);
          if (model.paramMap.has(p.id)) {
            issue(idx, 'warn', 'Duplicate parameter ' + p.fullKey + ' (also on line ' + (model.paramMap.get(p.id).lineIdx + 1) + '); Fortran uses the last one');
          }
          model.paramMap.set(p.id, p);
        }
      }
      model.lines.push(line);
    });

    if (nl) issue(nl.start, 'error', 'Namelist &' + nl.name + ' is never closed with "/"');
    return model;
  }

  function parseAssignment(raw, idx, m, nl, issue) {
    var fullKey = m[2];
    var valueStart = m[0].length;
    var rest = raw.slice(valueStart);
    var cs = scanComment(rest);
    if (cs.unclosed) issue(idx, 'error', 'Unclosed string quote');

    var code = cs.at >= 0 ? rest.slice(0, cs.at) : rest;
    var valueText = code.replace(/\s+$/, '');
    var comma = false;
    if (valueText.slice(-1) === ',') {
      comma = true;
      valueText = valueText.slice(0, -1).replace(/\s+$/, '');
    }
    var valueEnd = valueStart + valueText.length;
    var head = raw.slice(0, valueStart);
    var tail = raw.slice(valueEnd);
    var comment = cs.at >= 0 ? rest.slice(cs.at + 1).trim() : '';

    var tokens = valueText === '' ? [] : splitTokens(valueText);
    var sep = /,\s/.test(valueText) ? ', ' : valueText.indexOf(',') >= 0 ? ',' : ', ';

    if (!tokens.length) {
      issue(idx, 'error', fullKey + ' has no value');
    } else if (tokens.some(function (t) { return t === ''; })) {
      // keep the empty token so the line renders exactly as written until fixed
      var clean = tokens.filter(function (t) { return t !== ''; });
      issue(idx, 'error', 'Syntax killer: consecutive/empty commas in the value of ' + fullKey,
        head + clean.join(sep) + tail);
    }
    tokens.forEach(function (t) {
      if (t && tokenKind(t) === 'invalid') issue(idx, 'warn', 'Unrecognized value "' + t + '" for ' + fullKey);
    });
    if (!nl) issue(idx, 'warn', fullKey + ' is outside of any &namelist block and will be ignored');

    var path = fullKey.split('%');
    var kinds = tokens.filter(Boolean).map(tokenKind);
    var kind = 'mixed';
    if (kinds.length && kinds.every(function (k) { return k === 'int'; })) kind = 'int';
    else if (kinds.length && kinds.every(function (k) { return k === 'int' || k === 'real'; })) kind = 'real';
    else if (kinds.length && kinds.every(function (k) { return k === 'logical'; })) kind = 'logical';
    else if (kinds.length && kinds.every(function (k) { return k === 'string'; })) kind = 'string';

    return {
      id: fullKey.toLowerCase(),
      fullKey: fullKey,
      path: path,
      top: path[0],
      name: path[path.length - 1],
      parent: path.slice(0, -1).join('%'),
      lineIdx: idx,
      lineRaw: raw,
      head: head,
      tail: tail,
      valueText: valueText,
      sep: sep,
      comma: comma,
      comment: comment,
      tokens: tokens.slice(),
      orig: tokens.slice(),
      kind: kind,
      namelist: nl ? nl.name : null
    };
  }

  /** Rebuild one assignment line, replacing only the value text. */
  function renderParamLine(p) {
    // untouched values are returned exactly as written (also keeps a broken ",," visible until fixed)
    if (p.tokens.length === p.orig.length && p.tokens.every(function (t, i) { return t === p.orig[i]; })) return p.lineRaw;
    var val = p.tokens.join(p.sep);
    if (val === p.valueText) return p.lineRaw;
    var m = p.tail.match(/^(\s*,)?(\s*)([\s\S]*)$/);
    var pre = m[1] || '', gap = m[2], rest = m[3];
    if (rest) {
      // keep the inline comment in its original column when possible
      var col = p.head.length + p.valueText.length + pre.length + gap.length;
      var need = col - (p.head.length + val.length + pre.length);
      gap = ' '.repeat(Math.max(1, need));
    }
    return p.head + val + pre + gap + rest;
  }

  function lineText(line) {
    return line.param ? renderParamLine(line.param) : line.raw;
  }

  function serialize(model) {
    return model.lines.map(lineText).join(model.eol) + (model.finalNewline ? model.eol : '');
  }

  /** Column-align every assignment (port of deckcheck --reformat). Returns new text. */
  function alignColumns(model) {
    var maxKey = 0;
    model.params.forEach(function (p) { maxKey = Math.max(maxKey, p.fullKey.length); });
    var width = Math.max(30, Math.min(maxKey + 1, 45));
    var out = model.lines.map(function (line) {
      var p = line.param;
      if (!p) return line.raw;
      var key = p.fullKey.length < width ? p.fullKey + ' '.repeat(width - p.fullKey.length) : p.fullKey;
      var s = '  ' + key + ' = ' + p.tokens.join(', ') + ',';
      if (p.comment) s += '    ! ' + p.comment;
      return s;
    });
    return out.join(model.eol) + (model.finalNewline ? model.eol : '');
  }

  DW.tokenKind = tokenKind;
  DW.NUM_RE = NUM_RE;
  DW.INT_RE = INT_RE;
  DW.parseDeck = parseDeck;
  DW.renderParamLine = renderParamLine;
  DW.lineText = lineText;
  DW.serialize = serialize;
  DW.alignColumns = alignColumns;
})();
