/*
 * Pre-flight checks (port of deckcheck's validator rules that need only the
 * deck), plus generic checks: array length vs. count parameters, index
 * ranges inside the grid, and values outside the documented options.
 * Dormant parameters are skipped. Grid dimensions come from the optional
 * user-entered size (REST/grid.h5), falling back to RunParam%*end_rd.
 */
(function () {
  'use strict';
  var DW = (window.DW = window.DW || {});

  function validate(model, hidden, grid) {
    var out = [];
    var P = model.paramMap;
    function get(k) { return P.get(k.toLowerCase()); }
    function num(k, d) { var v = DW.numVal(get(k)); return isNaN(v) ? d : v; }
    function nums(p) { return p.tokens.map(function (t) { return Number(t.replace(/[dD]/, 'e')); }); }
    function live(p) { return p && !hidden.has(p.id); }
    function add(level, block, title, msg, keys) {
      out.push({ level: level, block: block, title: title, msg: msg, keys: (keys || []).map(function (k) { return k.toLowerCase(); }) });
    }

    // ---- syntax issues from the parser
    model.issues.forEach(function (i) {
      var p = model.lines[i.line] && model.lines[i.line].param;
      add(i.level === 'error' ? 'error' : 'warn', p ? p.top : 'Syntax', 'Syntax', 'Line ' + (i.line + 1) + ': ' + i.msg, p ? [p.fullKey] : []);
    });

    // ---- value kinds
    model.params.forEach(function (p) {
      if (!live(p)) return;
      p.tokens.forEach(function (t) {
        if (!t) return; // empty commas are reported as syntax errors
        var k = DW.tokenKind(t);
        if (k === 'invalid') add('error', p.top, 'Invalid value', p.fullKey + ': "' + t + '" is not a valid Fortran value', [p.fullKey]);
        else if (p.kind === 'int' && k === 'real') add('warn', p.top, 'Integer expected', p.fullKey + ' was an integer; "' + t + '" is a real', [p.fullKey]);
      });
      if (p.widget === 'enum' && p.tokens.length === 1) {
        var ok = p.doc.options.some(function (o) { return o.value === p.tokens[0]; });
        if (!ok) add('warn', p.top, 'Undocumented option', p.fullKey + ' = ' + p.tokens[0] + ' is not among the documented options (' +
          p.doc.options.map(function (o) { return o.value; }).join(', ') + ')', [p.fullKey]);
      }
    });

    // ---- RunParam: read window and grid
    var dims = {};
    [['i', 'ibeg_rd', 'iend_rd', 'imax'], ['j', 'jbeg_rd', 'jend_rd', 'jmax'], ['k', 'kbeg_rd', 'kend_rd', 'kmax']].forEach(function (d) {
      var kb = 'RunParam%' + d[1], ke = 'RunParam%' + d[2];
      var beg = num(kb, 1), end = num(ke, 1), max = grid && grid[d[3]] > 0 ? grid[d[3]] : 0;
      dims[d[0]] = max || end;
      if (beg < 1) add('error', 'RunParam', 'Read window ' + d[0], kb + ' = ' + beg + ' is < 1 (Fortran indexing is 1-based)', [kb]);
      else if (beg > end) add('error', 'RunParam', 'Read window ' + d[0], 'Start index ' + beg + ' exceeds end index ' + end, [kb, ke]);
      else if (max && end > max) add('error', 'RunParam', 'Read window ' + d[0], ke + ' = ' + end + ' exceeds grid size ' + d[3] + ' = ' + max, [ke]);
      else add('ok', 'RunParam', 'Read window ' + d[0], '[' + beg + ' .. ' + end + '] → ' + (end - beg + 1) + ' points' + (max ? ' (grid ' + max + ')' : ''), []);
      dims[d[0] + 'n'] = end - beg + 1;
    });

    // ---- MPI decomposition
    var ranks = 1;
    [['i', 'inode'], ['j', 'jnode'], ['k', 'knode']].forEach(function (d) {
      var key = 'RunParam%' + d[1], n = num(key, 1), pts = dims[d[0] + 'n'];
      ranks *= n;
      if (n < 1) { add('error', 'RunParam', 'MPI ' + d[0] + '-direction', key + ' = ' + n + ' must be ≥ 1', [key]); return; }
      if (pts > 0 && pts % n !== 0) {
        var near = [];
        for (var x = 1; x <= pts; x++) if (pts % x === 0) near.push(x);
        near.sort(function (a, b) { return Math.abs(a - n) - Math.abs(b - n); });
        add('error', 'RunParam', 'MPI ' + d[0] + '-direction', pts + ' points do not divide evenly by ' + d[1] + ' = ' + n +
          ' (remainder ' + (pts % n) + '). Nearest divisors: ' + near.slice(0, 4).sort(function (a, b) { return a - b; }).join(', '), [key]);
      } else if (pts > 0) {
        add('ok', 'RunParam', 'MPI ' + d[0] + '-direction', pts + ' / ' + n + ' = ' + (pts / n) + ' points per rank', []);
      }
    });
    add('info', 'RunParam', 'MPI ranks', 'inode × jnode × knode = ' + ranks + ' MPI ranks (srun -n ' + ranks + ')', []);

    // ---- convective scheme order
    var conv = get('RunParam%iConvSchm'), stencil = num('RunParam%ConvStencil', 4);
    if (conv) {
      var opt = conv.doc.options.find(function (o) { return o.value === conv.tokens[0]; });
      var name = opt ? opt.label : 'scheme ' + conv.tokens[0];
      if (stencil < 1) add('error', 'RunParam', 'Convective stencil', 'ConvStencil = ' + stencil + ' must be ≥ 1', ['RunParam%ConvStencil']);
      else if (/weno/i.test(name) && !/central|hybrid/i.test(name)) add('info', 'RunParam', 'Convective order', name + ': ' + (2 * stencil - 1) + 'th order (2r−1, r = ' + stencil + ')', []);
      else if (/central|hybrid/i.test(name)) add('info', 'RunParam', 'Convective order', name + ': ' + (2 * stencil) + 'th order (2r, r = ' + stencil + ')', []);
    }

    // ---- run length / restart
    var nstart = num('RunParam%nstart', -1), nstep = num('RunParam%nstep', 0), nsave = num('RunParam%nsaverestartfile', 1000);
    if (nstart < -1) add('error', 'RunParam', 'Start iteration', 'nstart = ' + nstart + ' is invalid (use -1 for auto-restart, or ≥ 0)', ['RunParam%nstart']);
    if (nstep <= 0) add('warn', 'RunParam', 'Run steps', 'nstep = ' + nstep + ': nothing will be run', ['RunParam%nstep']);
    if (nsave <= 0) add('error', 'RunParam', 'Restart interval', 'nsaverestartfile = ' + nsave + ' must be > 0', ['RunParam%nsaverestartfile']);
    else add('info', 'RunParam', 'Restart interval', 'Every ' + nsave + ' steps (~' + Math.floor(nstep / nsave) + ' restart files this run)', []);
    if (nsave > 0 && nstep > 0 && nstep % nsave !== 0) add('warn', 'RunParam', 'Restart interval', 'nstep = ' + nstep + ' is not a multiple of nsaverestartfile = ' + nsave + '; the last ' + (nstep % nsave) + ' steps are not checkpointed', ['RunParam%nstep', 'RunParam%nsaverestartfile']);

    // ---- wall thermal condition
    var adia = get('BCParam%iadiabaticwall');
    if (adia) {
      var ao = adia.doc.options.find(function (o) { return o.value === adia.tokens[0]; });
      var iso = ao ? /isothermal/i.test(ao.label) : adia.tokens[0] === '0';
      var tw = num('FlowParam%twall', 0);
      if (iso && tw <= 0) add('error', 'FlowParam', 'Isothermal wall', 'Isothermal wall selected (iadiabaticwall = ' + adia.tokens[0] + ') but FlowParam%twall = ' + tw + ' (must be > 0 K)', ['FlowParam%twall', 'BCParam%iadiabaticwall']);
      else add('ok', 'FlowParam', 'Wall thermal condition', iso ? 'Isothermal wall, Twall = ' + tw + ' K' : 'Adiabatic wall', []);
    }

    // ---- periodic BC pairs
    function periodic(key) {
      var p = get(key);
      if (!p) return null;
      var o = p.doc.options.find(function (x) { return x.value === p.tokens[0]; });
      return o ? /periodic/i.test(o.label) : null;
    }
    [['Streamwise (i)', 'BCParam%inletbc', 'BCParam%ioutletbc'],
      ['Spanwise (j)', 'BCParam%ispanwisebegbc', 'BCParam%ispanwiseendbc'],
      ['Wall-normal (k)', 'BCParam%ibotbc', 'BCParam%itopbc']].forEach(function (d) {
      var a = periodic(d[1]), b = periodic(d[2]);
      if (a === null || b === null) return;
      if (a !== b) add('error', 'BCParam', d[0] + ' periodicity', (a ? d[1] : d[2]) + ' is periodic but ' + (a ? d[2] : d[1]) + ' is not; periodic BCs must be paired', [d[1], d[2]]);
      else add('ok', 'BCParam', d[0] + ' BC pair', a ? 'Periodic on both sides' : 'Non-periodic on both sides', []);
    });

    // ---- time step
    var icd = get('TemporalParam%iconst_dt'), dtc = get('TemporalParam%dt_const');
    if (icd && dtc) nums(icd).forEach(function (v, i) {
      var dt = nums(dtc)[i];
      if (v === 1 && !(dt > 0)) add('error', 'TemporalParam', 'Constant time step', 'iconst_dt(' + (i + 1) + ') = 1 but dt_const(' + (i + 1) + ') = ' + dtc.tokens[i], ['TemporalParam%dt_const']);
    });

    // ---- zones: *_zone_num with *_zone_ibeg .. *_zone_kend
    model.params.forEach(function (p) {
      if (!/zone_num$/i.test(p.name) || !live(p)) return;
      var stem = p.name.slice(0, -3), n = DW.numVal(p);
      if (!(n > 0)) return;
      ['i', 'j', 'k'].forEach(function (ax) {
        var pb = P.get((p.parent + '%' + stem + ax + 'beg').toLowerCase());
        var pe = P.get((p.parent + '%' + stem + ax + 'end').toLowerCase());
        if (!live(pb) || !live(pe)) return;
        var bs = nums(pb), es = nums(pe), max = dims[ax];
        for (var z = 0; z < Math.min(n, bs.length, es.length); z++) {
          if (!(bs[z] >= 1 && bs[z] <= es[z] && es[z] <= max)) {
            add('error', p.top, 'Zone ' + (z + 1) + ' bounds', stem + ax + ' zone ' + (z + 1) + ': [' + bs[z] + ' .. ' + es[z] + '] is outside 1..' + max, [pb.fullKey, pe.fullKey]);
          }
        }
      });
    });

    // ---- array length vs. count parameter (same parent)
    // (links are defined in src/config/blocks.js: ARRAY_COUNTS and *zone_num)
    model.params.forEach(function (p) {
      if (!live(p)) return;
      var links = DW.linkedArrays(model, p);
      if (!links.length) return;
      var n = DW.numVal(p);
      if (!(n > 0)) return;
      links.forEach(function (q) {
        if (live(q) && q.tokens.length < n) add('error', p.top, 'Array length', q.fullKey + ' has ' + q.tokens.length + ' value(s) but ' + p.fullKey + ' = ' + n, [q.fullKey, p.fullKey]);
      });
    });

    // ---- index ranges of savers / statistics
    var PAIRS = [['istart', 'iend', 'i'], ['ist', 'iend', 'i'], ['jstart', 'jend', 'j'], ['kstart', 'kend', 'k'], ['kst', 'kend', 'k']];
    var groups = new Map();
    model.params.forEach(function (p) {
      if (p.top === 'RunParam' || /Sponge|Rough|Force|Cylin/i.test(p.parent) || !live(p)) return;
      if (!groups.has(p.parent)) groups.set(p.parent, new Map());
      groups.get(p.parent).set(p.name.toLowerCase(), p);
    });
    groups.forEach(function (g) {
      PAIRS.forEach(function (pr) {
        var b = g.get(pr[0]), e = g.get(pr[1]);
        if (!b || !e) return;
        var bv = DW.numVal(b), ev = DW.numVal(e), max = dims[pr[2]];
        if (bv < 1 || bv > ev) add('error', b.top, 'Index range', b.fullKey + ' = ' + bv + ', ' + e.fullKey + ' = ' + ev + ': need 1 ≤ start ≤ end', [b.fullKey, e.fullKey]);
        else if (ev > max) add('warn', b.top, 'Index range', e.fullKey + ' = ' + ev + ' exceeds the ' + pr[2] + ' size ' + max, [e.fullKey]);
      });
      ['i', 'j', 'k'].forEach(function (ax) {
        var r = g.get(ax + 'region');
        if (r && r.tokens.length >= 2) {
          var v = nums(r);
          if (v[0] < 1 || v[0] > v[1]) add('error', r.top, 'Index range', r.fullKey + ' = ' + r.tokens.join(', ') + ': need 1 ≤ start ≤ end', [r.fullKey]);
          else if (v[1] > dims[ax]) add('warn', r.top, 'Index range', r.fullKey + ' end ' + v[1] + ' exceeds the ' + ax + ' size ' + dims[ax], [r.fullKey]);
        }
        var loc = g.get(ax + 'locations');
        if (loc) nums(loc).forEach(function (v) {
          if (v < 1 || v > dims[ax]) add('warn', loc.top, 'Plane location', loc.fullKey + ' value ' + v + ' is outside 1..' + dims[ax], [loc.fullKey]);
        });
      });
    });

    // ---- plane series buffering
    var ps = get('PlaneseriesSave%istatus');
    if (live(ps) && DW.numVal(ps) !== 0) {
      var nb = num('PlaneseriesSave%nBufferSize', 1), pss = num('PlaneseriesSave%nsave', 1);
      if (nsave % (nb * pss) !== 0) add('error', 'PlaneseriesSave', 'Buffer vs restart', 'nsaverestartfile (' + nsave + ') must be divisible by nBufferSize × nsave (' + nb + ' × ' + pss + ' = ' + nb * pss + ')', ['PlaneseriesSave%nBufferSize', 'PlaneseriesSave%nsave', 'RunParam%nsaverestartfile']);
    }

    return out;
  }

  DW.validate = validate;
})();
