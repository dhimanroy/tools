/*
 * Run summary: the information of deckcheck's dnsParamSummary.txt, minus the
 * file-size / storage estimates. Built as data (groups of rows) so the page and
 * the .txt export share one source. Every row lists the parameters it comes
 * from, so the UI can jump to them.
 *
 * Derived values follow deckcheck: gamma = 1.4, R = 8314.462 / molecularweight,
 * Sutherland viscosity (mu_ref 1.716e-5 Pa s, T_ref 273.15 K, S = 110.4 K).
 */
(function () {
  'use strict';
  var DW = (window.DW = window.DW || {});

  var SAVERS = [
    ['TimeseriesSave%Vol', 'Volume time series'],
    ['TimeseriesSave%kplane', 'k-plane time series (wall-parallel)'],
    ['TimeseriesSave%iplane', 'i-plane time series'],
    ['TimeseriesSave%jplane', 'j-plane time series'],
    ['TimeseriesSave%kbc', 'k-bc time series'],
    ['PlaneseriesSave', 'Inflow plane series'],
    ['FourierSave', 'Fourier modes'],
    ['XplaneSave', 'X-plane mean/RMS'],
    ['YplaneSave', 'Y-plane mean/RMS'],
    ['RMS3DSave', '3D mean/RMS'],
    ['SubfieldSave', 'Sub-field volume'],
    ['TKEBudgetSave', 'TKE budget'],
    ['AveSpanStat', 'Spanwise-averaged stats'],
    ['AcousticStat', 'Acoustic statistics'],
    ['BudgetStat', 'Reynolds-stress budget'],
    ['AveStreamSpanStat', 'Stream-span averaged stats'],
    ['AveRibletStat', 'Riblet statistics'],
    ['ProbeSave', 'Point probes']
  ];

  function fmtInt(n) { return isFinite(n) ? Math.round(n).toLocaleString('en-US') : '—'; }
  function fmtNum(n, d) {
    if (!isFinite(n)) return '—';
    var a = Math.abs(n);
    if (a !== 0 && (a < 1e-3 || a >= 1e6)) return n.toExponential(d == null ? 4 : d);
    return String(+n.toFixed(d == null ? 4 : d));
  }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  function build(model, hidden, grid) {
    grid = grid || {};
    function P(k) { return model.paramMap.get(k.toLowerCase()); }
    function num(k, d) { var x = DW.numVal(P(k)); return isNaN(x) ? d : x; }
    function nums(k) { var p = P(k); return p ? p.tokens.map(function (t) { return Number(t.replace(/[dD]/, 'e')); }) : []; }
    function raw(k) { var p = P(k); return p ? p.tokens.join(', ') : '—'; }
    function has(k) { return !!P(k); }
    function live(k) { var p = P(k); return !!p && !hidden.has(p.id); }
    function on(k) { return num(k, 0) !== 0; }
    function label(k) {
      var p = P(k);
      if (!p || !p.doc) return '';
      var o = p.doc.options.find(function (x) { return x.value === p.tokens[0]; });
      return o ? o.label : '';
    }
    function short(k) { return k.split('%').pop(); }
    /** "Periodic boundary condition [inletbc = 0]" */
    function named(k) { var l = label(k); return (l ? cap(l) : 'value') + ' [' + short(k) + ' = ' + raw(k) + ']'; }

    var groups = [];
    function group(title) { var g = { title: title, rows: [] }; groups.push(g); return g; }
    function row(g, lab, value, keys, extra) {
      var r = { label: lab, value: value, keys: keys || [] };
      if (extra) for (var x in extra) r[x] = extra[x];
      g.rows.push(r);
      return r;
    }

    // ---------------------------------------------------------------- 1. grid & MPI
    var g1 = group('Grid & MPI decomposition');
    var ib = num('RunParam%ibeg_rd', 1), ie = num('RunParam%iend_rd', 1);
    var jb = num('RunParam%jbeg_rd', 1), je = num('RunParam%jend_rd', 1);
    var kb = num('RunParam%kbeg_rd', 1), ke = num('RunParam%kend_rd', 1);
    var ni = ie - ib + 1, nj = je - jb + 1, nk = ke - kb + 1, tot = ni * nj * nk;
    var gi = grid.imax, gj = grid.jmax, gk = grid.kmax;
    row(g1, 'Grid size', gi || gj || gk
      ? (gi || '?') + ' × ' + (gj || '?') + ' × ' + (gk || '?') + ' (entered below)'
      : 'not entered (checks use the read window; enter it below)', [], gi || gj || gk ? null : { level: 'muted' });
    row(g1, 'Read window', 'i [' + ib + '..' + ie + '] · j [' + jb + '..' + je + '] · k [' + kb + '..' + ke + ']',
      ['RunParam%ibeg_rd', 'RunParam%iend_rd', 'RunParam%jbeg_rd', 'RunParam%jend_rd', 'RunParam%kbeg_rd', 'RunParam%kend_rd']);
    row(g1, 'Active points', ni + ' × ' + nj + ' × ' + nk + ' = ' + fmtInt(tot) + ' (' + (tot / 1e6).toFixed(2) + ' M)', ['RunParam%iend_rd']);
    var inn = num('RunParam%inode', 1), jnn = num('RunParam%jnode', 1), knn = num('RunParam%knode', 1);
    row(g1, 'MPI ranks', inn + ' × ' + jnn + ' × ' + knn + ' = ' + fmtInt(inn * jnn * knn) + ' ranks', ['RunParam%inode', 'RunParam%jnode', 'RunParam%knode']);
    var ri = ni % inn, rj = nj % jnn, rk = nk % knn;
    if (!ri && !rj && !rk) {
      row(g1, 'Points per rank', (ni / inn) + ' × ' + (nj / jnn) + ' × ' + (nk / knn) + ' = ' + fmtInt(tot / (inn * jnn * knn)), ['RunParam%inode']);
    } else {
      row(g1, 'Points per rank', 'uneven: remainder i = ' + ri + ', j = ' + rj + ', k = ' + rk + ' (≈ ' + fmtNum(ni / inn, 2) + ' × ' + fmtNum(nj / jnn, 2) + ' × ' + fmtNum(nk / knn, 2) + ')',
        ['RunParam%inode', 'RunParam%jnode', 'RunParam%knode'], { level: 'warn' });
    }
    if (has('RunParam%iflowdataformat')) {
      row(g1, 'Flow data I/O', raw('RunParam%iflowdataformat') === raw('RunParam%iflowdataformat_wt')
        ? cap(label('RunParam%iflowdataformat') || 'format') + ', read & write [iflowdataformat(_wt) = ' + raw('RunParam%iflowdataformat') + ']'
        : 'read: ' + named('RunParam%iflowdataformat') + ' · write: ' + named('RunParam%iflowdataformat_wt'),
        ['RunParam%iflowdataformat', 'RunParam%iflowdataformat_wt']);
    }

    // ---------------------------------------------------------------- 2. flow
    var g2 = group('Flow & fluid properties');
    var rho = num('FlowParam%rhoinf', 0), u = num('FlowParam%uinf', 0), T = num('FlowParam%tinf', 0);
    var d0 = num('FlowParam%delta0', 0), mw = num('FlowParam%molecularweight', 28.97);
    var R = mw > 0 ? 8314.462 / mw : 287.05, a = T > 0 ? Math.sqrt(1.4 * R * T) : 0, M = a > 0 ? u / a : 0;
    var mu = T > 0 ? 1.716e-5 * Math.pow(T / 273.15, 1.5) * (273.15 + 110.4) / (T + 110.4) : 0;
    row(g2, 'Freestream', 'ρ∞ = ' + fmtNum(rho) + ' kg/m³ · u∞ = ' + fmtNum(u, 2) + ' m/s · T∞ = ' + fmtNum(T, 3) + ' K',
      ['FlowParam%rhoinf', 'FlowParam%uinf', 'FlowParam%tinf']);
    row(g2, 'Reference length', 'δ0 = ' + fmtNum(d0 * 1000, 3) + ' mm', ['FlowParam%delta0']);
    row(g2, 'Mach · sound speed', 'M∞ = ' + fmtNum(M, 4) + ' · a∞ = ' + fmtNum(a, 2) + ' m/s (γ = 1.4, W = ' + fmtNum(mw, 3) + ')',
      ['FlowParam%uinf', 'FlowParam%tinf', 'FlowParam%molecularweight']);
    var imu = num('FlowParam%imu', 0);
    row(g2, 'Viscosity', 'μ∞ = ' + mu.toExponential(4) + ' Pa·s (Sutherland)' + (imu !== 0 ? '; deck uses ' + named('FlowParam%imu') : ''),
      ['FlowParam%imu'], imu !== 0 ? { level: 'warn' } : null);
    row(g2, 'Reynolds number', 'Re_δ0 = ' + fmtInt(mu > 0 ? rho * u * d0 / mu : NaN) + ' · Re/m = ' + (mu > 0 ? (rho * u / mu).toExponential(4) : '—') + ' 1/m',
      ['FlowParam%delta0']);
    row(g2, 'Prandtl number', num('FlowParam%iuseprandtlno', 1) === 1
      ? 'Pr = ' + raw('FlowParam%prandtlno') + ' (given)'
      : 'computed from rotationalcv = ' + raw('FlowParam%rotationalcv'), ['FlowParam%iuseprandtlno', 'FlowParam%prandtlno']);
    var iso = /isothermal/i.test(label('BCParam%iadiabaticwall')) || (!label('BCParam%iadiabaticwall') && num('BCParam%iadiabaticwall', 0) === 0);
    var tw = num('FlowParam%twall', 0);
    row(g2, 'Wall thermal state', iso ? 'Isothermal, Tw = ' + fmtNum(tw, 3) + ' K (Tw/T∞ = ' + (T > 0 ? (tw / T).toFixed(2) : '—') + ')' : 'Adiabatic',
      ['BCParam%iadiabaticwall', 'FlowParam%twall'], iso && !(tw > 0) ? { level: 'error' } : null);
    row(g2, 'Viscous terms', on('FlowParam%iviscous') ? 'on · ' + named('FlowParam%iViscSchm') : 'off (Euler)', ['FlowParam%iviscous', 'FlowParam%iViscSchm']);
    if (on('FlowParam%iReadMetrics')) row(g2, 'Grid metrics', named('FlowParam%iReadMetrics'), ['FlowParam%iReadMetrics']);
    if (on('FlowParam%icalresidual')) row(g2, 'Residual body force', 'on (baseflow.sol required)', ['FlowParam%icalresidual']);
    if (on('FlowParam%iCylinderCoordinate')) row(g2, 'Coordinates', 'cylindrical · ' + named('BCParam%CylinParam%ischeme'), ['FlowParam%iCylinderCoordinate']);

    // ---------------------------------------------------------------- 3. numerics
    var g3 = group('Numerical schemes & time integration');
    var conv = num('RunParam%iConvSchm', 0), r = num('RunParam%ConvStencil', 4), cl = label('RunParam%iConvSchm');
    var order = /central|hybrid/i.test(cl) ? 2 * r : /weno/i.test(cl) ? 2 * r - 1 : (conv === 1 || conv === 2 ? 2 * r : conv === 0 ? 2 * r - 1 : null);
    row(g3, 'Convective scheme', cap(cl || 'scheme ' + conv) + (order ? ', ' + order + getOrdinal(order) + ' order' : '') + ' [iConvSchm = ' + conv + ', ConvStencil = ' + r + ']',
      ['RunParam%iConvSchm', 'RunParam%ConvStencil']);
    if (live('WENOParam%iglobalscheme')) {
      var wsch = raw('WENOParam%iglobalscheme') === raw('WENOParam%ibcscheme')
        ? cap(label('WENOParam%iglobalscheme') || 'scheme') + ', interior & boundary [iglobalscheme = ibcscheme = ' + raw('WENOParam%iglobalscheme') + ']'
        : 'interior: ' + named('WENOParam%iglobalscheme') + ' · boundary: ' + named('WENOParam%ibcscheme');
      row(g3, 'WENO scheme', wsch, ['WENOParam%iglobalscheme', 'WENOParam%ibcscheme']);
      row(g3, 'Flux splitting', named('WENOParam%split_method'), ['WENOParam%split_method']);
      var limiter = on('WENOParam%ilimiter') ? 'on' : 'off';
      row(g3, 'WENO adaptation', 'x/y/z: ' + raw('WENOParam%iadaptx') + '/' + raw('WENOParam%iadapty') + '/' + raw('WENOParam%iadaptz') + ' · limiter ' + limiter,
        ['WENOParam%iadaptx', 'WENOParam%ilimiter']);
      if (on('WENOParam%adapt_zone_on')) {
        var zr = zoneRow('WENOParam', 'adapt_zone_');
        row(g3, 'WENO adapt zones', cap(label('WENOParam%adapt_zone_on')) + ' · ' + zr.n + ' zone' + (zr.n === 1 ? '' : 's') +
          (has('WENOParam%adapt_zone_iadapt_freq') ? ', eval freq ' + raw('WENOParam%adapt_zone_iadapt_freq') : ''),
          ['WENOParam%adapt_zone_on', 'WENOParam%adapt_zone_num'], { detail: zr.detail });
      }
    }
    if (live('HybridParam%ishocksensortype')) {
      row(g3, 'Hybrid shock sensor', named('HybridParam%ishocksensortype') + ' · threshold ' + raw('HybridParam%sensorthresh') + ' · splitting: ' + named('HybridParam%split_method'),
        ['HybridParam%ishocksensortype', 'HybridParam%sensorthresh']);
      if (on('HybridParam%weno_zone_on')) {
        var hz = zoneRow('HybridParam', 'weno_zone_');
        row(g3, 'Hybrid WENO zones', hz.n + ' zone' + (hz.n === 1 ? '' : 's'), ['HybridParam%weno_zone_on', 'HybridParam%weno_zone_num'], { detail: hz.detail });
      }
    }
    if (on('FilterParam%iuse')) {
      var fz = on('FilterParam%filter_zone_on') ? zoneRow('FilterParam', 'filter_zone_') : null;
      row(g3, 'Spatial filter', 'on · ' + named('FilterParam%iopt') + ' · strength ' + raw('FilterParam%filterStrength') + (fz ? ' · ' + fz.n + ' zone' + (fz.n === 1 ? '' : 's') : ' · everywhere'),
        ['FilterParam%iuse', 'FilterParam%iopt'], fz ? { detail: fz.detail } : null);
    } else {
      row(g3, 'Spatial filter', 'off' + (has('RunParam%iFilter') ? ' [FilterParam%iuse = ' + raw('FilterParam%iuse') + ', RunParam%iFilter = ' + raw('RunParam%iFilter') + ']' : ''), ['FilterParam%iuse']);
    }
    var turb = [];
    if (on('LESParam%iuse')) turb.push('LES: ' + named('LESParam%imodel') + ', C = ' + raw('LESParam%const') + (on('LESParam%iWMLES') ? ', wall-modelled' : ''));
    if (on('RANSParam%iuse')) turb.push('RANS: Baldwin-Lomax [imodel = ' + raw('RANSParam%imodel') + '], from step ' + raw('RANSParam%nstart'));
    row(g3, 'Turbulence model', turb.length ? turb.join(' · ') : 'none (DNS)', ['LESParam%iuse', 'RANSParam%iuse']);
    row(g3, 'Time integration', named('TemporalParam%ischeme'), ['TemporalParam%ischeme']);

    var ncfl = num('TemporalParam%ncfl', 1), icd = nums('TemporalParam%iconst_dt'), dts = nums('TemporalParam%dt_const');
    var constDt = icd[0] === 1 && dts[0] > 0 ? dts[0] : 0;
    var dtText = constDt ? 'constant dt = ' + constDt.toExponential(4) + ' s' : 'CFL-controlled: conv ' + raw('TemporalParam%cfl_conv') + ', vis ' + raw('TemporalParam%cfl_vis');
    var cflDetail = null;
    if (ncfl > 1) {
      var its = nums('TemporalParam%iteration'), cc = nums('TemporalParam%cfl_conv'), cv = nums('TemporalParam%cfl_vis');
      cflDetail = [];
      for (var s = 0; s < ncfl; s++) {
        cflDetail.push(['stage ' + (s + 1), 'until step ' + fmtInt(its[s]) + ': ' + (icd[s] === 1 ? 'dt = ' + fmtNum(dts[s]) + ' s' : 'CFL conv ' + cc[s] + ', vis ' + cv[s])]);
      }
      dtText += ' (stage 1 of ' + ncfl + ')';
    }
    row(g3, 'Time step', dtText, ['TemporalParam%iconst_dt', 'TemporalParam%dt_const', 'TemporalParam%ncfl'], cflDetail ? { detail: cflDetail } : null);
    var nstart = num('RunParam%nstart', -1), nstep = num('RunParam%nstep', 0);
    row(g3, 'Run', (nstart === -1 ? 'auto-restart from latest checkpoint' : 'start at step ' + fmtInt(nstart)) + ' · ' + fmtInt(nstep) + ' steps',
      ['RunParam%nstart', 'RunParam%nstep'], nstart < -1 ? { level: 'error' } : null);
    var tphys = constDt && ncfl <= 1 ? nstep * constDt : 0;
    if (tphys) {
      row(g3, 'Physical time', tphys.toExponential(4) + ' s (' + fmtNum(tphys * 1000, 3) + ' ms) · ' + (d0 > 0 ? fmtNum(tphys * u / d0, 2) + ' δ0/u∞' : ''),
        ['RunParam%nstep', 'TemporalParam%dt_const']);
    }
    var nsr = num('RunParam%nsaverestartfile', 1000);
    row(g3, 'Checkpoints', 'every ' + fmtInt(nsr) + ' steps → ~' + fmtInt(nsr > 0 ? Math.floor(nstep / nsr) : NaN) + ' restart files',
      ['RunParam%nsaverestartfile'], nsr > 0 ? null : { level: 'error' });

    // ---------------------------------------------------------------- 4. BCs
    var g4 = group('Boundary conditions & sponges');
    row(g4, 'Inlet (i = 1)', named('BCParam%inletbc'), ['BCParam%inletbc']);
    var inx = [];
    if (num('BCParam%inletbc', 0) !== 0) {
      inx.push('data type: ' + named('BCParam%inletdatatype'));
      if (on('BCParam%isynthetic')) inx.push('digital-filter turbulence');
      if (on('BCParam%irescale')) inx.push('rescaling');
      if (num('BCParam%inletbc', 0) === 5) inx.push('characteristic: ' + named('BCParam%inletbcCharatype'));
      row(g4, '', inx.join(' · '), ['BCParam%inletdatatype'], { sub: true });
    }
    row(g4, 'Outlet (i = imax)', named('BCParam%ioutletbc'), ['BCParam%ioutletbc']);
    row(g4, 'Bottom (k = 1)', named('BCParam%ibotbc') + (on('BCParam%ibotbcCharatype') ? ' · ' + named('BCParam%ibotbcCharatype') : ''), ['BCParam%ibotbc']);
    var topv = num('BCParam%itopbc', 0);
    row(g4, 'Top (k = kmax)', named('BCParam%itopbc') + ((topv === 3 || topv === 7) && has('BCParam%sigma_topbc') ? ' · sigma_topbc = ' + raw('BCParam%sigma_topbc') : ''),
      ['BCParam%itopbc', 'BCParam%sigma_topbc']);
    if (raw('BCParam%ispanwisebegbc') === raw('BCParam%ispanwiseendbc')) {
      row(g4, 'Spanwise (j = 1, jmax)', 'both: ' + named('BCParam%ispanwisebegbc'), ['BCParam%ispanwisebegbc', 'BCParam%ispanwiseendbc']);
    } else {
      row(g4, 'Spanwise j = 1', named('BCParam%ispanwisebegbc'), ['BCParam%ispanwisebegbc']);
      row(g4, 'Spanwise j = jmax', named('BCParam%ispanwiseendbc'), ['BCParam%ispanwiseendbc']);
    }
    var geo = ['istreamwisegeometry', 'ispanwisegeometry', 'iwallnormalgeometry'].filter(function (k) { return on('BCParam%' + k); });
    if (geo.length) row(g4, 'Ghost-point geometry', geo.map(function (k) { return named('BCParam%' + k); }).join(' · '), geo.map(function (k) { return 'BCParam%' + k; }));
    var sp = [['Inlet', 'inletsponge'], ['Outlet', 'ioutletsponge'], ['Top', 'itopsponge'], ['Bottom', 'ibotsponge'], ['Left', 'ileftsponge'], ['Right', 'irightsponge']]
      .filter(function (x) { return on('BCParam%' + x[1]); });
    row(g4, 'Sponge zones', sp.length ? sp.map(function (x) { return x[0] + ': ' + (label('BCParam%' + x[1]) || 'flag ' + raw('BCParam%' + x[1])); }).join(' · ') : 'none',
      sp.length ? sp.map(function (x) { return 'BCParam%' + x[1]; }) : ['BCParam%inletsponge']);
    var forcing = [];
    if (on('BCParam%inflowforce')) forcing.push(['Eigenmode inflow forcing', 'BCParam%inflowforce']);
    if (on('BCParam%iwallforce')) forcing.push(['Wall forcing: ' + label('BCParam%iwallforce'), 'BCParam%iwallforce']);
    if (on('BCParam%ilinearroughbc')) forcing.push(['Linearized wall roughness', 'BCParam%ilinearroughbc']);
    if (on('BodyForceParam%ibodyforce')) forcing.push(['Body force: ' + label('BodyForceParam%ibodyforce'), 'BodyForceParam%ibodyforce']);
    if (on('DisturModels%iuse')) forcing.push(['Disturbances: ' + label('DisturModels%imodel'), 'DisturModels%iuse']);
    row(g4, 'Forcing & disturbances', forcing.length ? forcing.map(function (f) { return f[0]; }).join(' · ') : 'none',
      forcing.length ? forcing.map(function (f) { return f[1]; }) : ['BCParam%iwallforce']);

    // ---------------------------------------------------------------- 5. output
    var g5 = group('Active post-processing & output');
    var off = [], activeOut = [];
    SAVERS.forEach(function (sv) {
      var pfx = sv[0], sw = P(pfx + '%istatus');
      if (!sw) return;
      if (!(DW.numVal(sw) > 0) || hidden.has(sw.id)) { off.push(pfx); return; }
      var parent = pfx.indexOf('%') > 0 ? pfx.split('%')[0] : null;
      function k(name) { return has(pfx + '%' + name) ? pfx + '%' + name : parent && has(parent + '%' + name) ? parent + '%' + name : null; }
      var parts = [];
      var ks = k('nstart');
      if (ks) parts.push('from step ' + raw(ks));
      var ki = k('nsave') || k('nsaveinterval') || k('ninterval');
      var kp = k('period') || k('Period'), kn = k('nsaveperiod');
      var when;
      if (ki) {
        var n = num(ki, 0);
        when = 'every ' + fmtInt(n) + ' step' + (n === 1 ? '' : 's') + (n > 0 ? ' (~' + fmtInt(Math.floor(nstep / n)) + ' outputs)' : '');
        parts.push(when);
      } else if (kp) {
        var every = num(kp, 0) * (kn ? num(kn, 1) : 1);
        when = 'every ' + (kn && num(kn, 1) !== 1 ? raw(kn) + ' × ' : '') + fmtNum(num(kp, 0)) + ' s' + (tphys && every > 0 ? ' (~' + fmtInt(Math.floor(tphys / every)) + ' outputs)' : '');
        parts.push(when);
      } else {
        when = 'with restart files (every ' + fmtInt(nsr) + ' steps)';
        parts.push('interval not set in deck (written with restart files, every ' + fmtInt(nsr) + ' steps)');
      }
      activeOut.push({ label: sv[1], text: when + (ks && raw(ks) !== '0' ? ', from step ' + raw(ks) : ''), keys: [pfx + '%istatus'].concat(ki ? [ki] : []) });
      var reg = region(pfx);
      if (reg) parts.push(reg);
      var detail = model.params.filter(function (p) { return p.parent === pfx && p.name.toLowerCase() !== 'istatus'; })
        .map(function (p) { return [p.name, p.tokens.join(', ')]; });
      row(g5, sv[1], parts.join(' · '), [pfx + '%istatus'].concat(ki ? [ki] : []), { detail: detail, mono: pfx });
    });
    if (!g5.rows.length) row(g5, 'Savers', 'none active', []);
    if (off.length) row(g5, 'Inactive', off.length + ' modules off: ' + off.join(', '), [], { level: 'muted' });

    // ---------------------------------------------------------------- key points (Summary page)
    // Short, slide-style bullets. Every item keeps the parameters it comes from.
    function shortLabel(k, fallback) {
      var l = label(k) || fallback || 'type ' + raw(k);
      l = l.replace(/\s*\(.*$/, '').replace(/,.*$/, '').replace(/\s*boundary condition\b/i, '').replace(/\s+BC\b/, '').trim();
      return cap(l);
    }
    function sig(x, n) { return isFinite(x) ? String(+x.toPrecision(n || 3)) : '—'; }
    function sci(x) { return isFinite(x) ? x.toExponential(2).replace('e+', 'e') : '—'; }
    var kp = [];
    /** One line per zone: "i 1–1720 · j 1–1920 · k 1–274" (first 4 zones, then a count). */
    function zoneItems(p, top, stem) {
      var n = Math.max(0, num(top + '%' + stem + 'num', 1)), shown = Math.min(n, 4);
      for (var z = 0; z < shown; z++) {
        var ext = ['i', 'j', 'k'].map(function (ax) {
          var b = nums(top + '%' + stem + ax + 'beg')[z], e = nums(top + '%' + stem + ax + 'end')[z];
          return '{' + ax + '} ' + (b == null ? '?' : b) + '–' + (e == null ? '?' : e);
        }).join(' · ');
        item(p, 'Zone ' + (z + 1), ext, [top + '%' + stem + 'ibeg', top + '%' + stem + 'num']);
      }
      if (n > shown) item(p, '', '+' + (n - shown) + ' more zone' + (n - shown > 1 ? 's' : ''), [top + '%' + stem + 'num'], 'muted');
    }
    /** "Ut(kBL)/Ut(klen) ~ 0.99  (tangential velocity)" -> "Tangential velocity" */
    function paren(l) { var m = (l || '').match(/\(([^()]*)\)\s*$/); return m ? cap(m[1]) : l ? cap(l) : ''; }
    function panel(title) { var p = { title: title, items: [] }; kp.push(p); return p; }
    function item(p, lab, text, keys, level) { p.items.push({ label: lab, text: text, keys: keys || [], level: level || '' }); }
    var RD = ['RunParam%ibeg_rd', 'RunParam%iend_rd', 'RunParam%jbeg_rd', 'RunParam%jend_rd', 'RunParam%kbeg_rd', 'RunParam%kend_rd'];
    var NODES = ['RunParam%inode', 'RunParam%jnode', 'RunParam%knode'];
    var uneven = ri || rj || rk;

    var pd = panel('Domain & MPI');
    // coordinate system (FlowParam%iCylinderCoordinate) and per-direction grid geometry (ghost-point generation)
    var cyl = on('FlowParam%iCylinderCoordinate');
    item(pd, 'Coordinates', cyl
      ? 'Cylindrical · ' + (shortLabel('BCParam%CylinParam%ischeme') || 'ischeme = ' + raw('BCParam%CylinParam%ischeme'))
      : 'Cartesian ({x}, {y}, {z})', ['FlowParam%iCylinderCoordinate'].concat(cyl ? ['BCParam%CylinParam%ischeme'] : []));
    function geoName(k) {
      var l = label(k) || 'type ' + raw(k);
      l = l.replace(/planner/i, 'planar').replace(/\s*geomet(?:e)?ry\b/i, '').replace(/\s*\(.*$/, '').replace(/,.*$/, '').trim();
      return l.toLowerCase();
    }
    var GEO = ['BCParam%istreamwisegeometry', 'BCParam%ispanwisegeometry', 'BCParam%iwallnormalgeometry'];
    var geos = GEO.map(function (k) { return has(k) ? geoName(k) : '—'; });
    item(pd, 'Geometry', geos[0] === geos[1] && geos[1] === geos[2]
      ? cap(geos[0]) + ' in {i}, {j}, {k}'
      : '{i} ' + geos[0] + ' · {j} ' + geos[1] + ' · {k} ' + geos[2], GEO);
    item(pd, 'Grid',ni + ' × ' + nj + ' × ' + nk + ' = ' + (tot >= 1e9 ? sig(tot / 1e9) + ' B' : sig(tot / 1e6) + ' M') + ' points', RD);
    item(pd, 'MPI', inn + ' × ' + jnn + ' × ' + knn + ' = ' + fmtInt(inn * jnn * knn) + ' ranks', NODES);
    item(pd, 'Per rank', uneven ? 'uneven (remainder ' + ri + ', ' + rj + ', ' + rk + ')' : (ni / inn) + ' × ' + (nj / jnn) + ' × ' + (nk / knn) + ' points',
      NODES, uneven ? 'warn' : '');
    if (gi || gj || gk) item(pd, 'Grid file', (gi || '?') + ' × ' + (gj || '?') + ' × ' + (gk || '?'), []);

    var pf = panel('Flow');
    // {v|sub} marks a math symbol with a subscript, {v} a plain math symbol; see mathText()
    item(pf, 'Mach', '{M|∞} = ' + sig(M, 4), ['FlowParam%uinf', 'FlowParam%tinf']);
    item(pf, 'Reynolds', '{Re|δ0} = ' + sci(mu > 0 ? rho * u * d0 / mu : NaN) + ' · {Re|u} = ' + sci(mu > 0 ? rho * u / mu : NaN) + ' m⁻¹', ['FlowParam%rhoinf', 'FlowParam%delta0']);
    item(pf, 'Freestream', '{u|∞} = ' + sig(u, 4) + ' m/s · {T|∞} = ' + sig(T, 4) + ' K · {ρ|∞} = ' + sig(rho, 3) + ' kg/m³', ['FlowParam%uinf', 'FlowParam%tinf', 'FlowParam%rhoinf']);
    item(pf, 'Ref. length', '{δ|0} = ' + sig(d0 * 1000, 3) + ' mm', ['FlowParam%delta0']);
    // Recovery temperature T_r = T∞ (1 + r (γ−1)/2 M∞²), turbulent recovery factor r = 0.89 (≈ Pr^(1/3), Pr = 0.71), γ = 1.4
    var RECOVERY = 0.89;
    var Tr = T > 0 ? T * (1 + RECOVERY * 0.2 * M * M) : NaN;
    // the wall thermal condition (iadiabaticwall) applies to the k = 1 face, so only report it when that face is a wall
    var bottomIsWall = /wall/i.test(label('BCParam%ibotbc'));
    if (bottomIsWall) {
      item(pf, 'Wall (k = 1)', iso ? 'isothermal, {T|w} = ' + sig(tw, 4) + ' K' : 'adiabatic', ['BCParam%iadiabaticwall', 'FlowParam%twall'], iso && !(tw > 0) ? 'error' : '');
      if (iso && tw > 0) item(pf, 'T ratios','{T|w}/{T|∞} = ' + (T > 0 ? (tw / T).toFixed(2) : '—') + ' · {T|w}/{T|r} = ' + (Tr > 0 ? (tw / Tr).toFixed(2) : '—'), ['FlowParam%twall']);
    }
    item(pf, 'Recovery', '{T|r} = ' + sig(Tr, 4) + ' K ({r} = ' + RECOVERY + ')', ['FlowParam%tinf', 'FlowParam%uinf']);
    if (imu !== 0) item(pf, 'Viscosity', shortLabel('FlowParam%imu'), ['FlowParam%imu']);

    var pn = panel('Numerics');
    var convName = ['WENO', 'Split central', 'Hybrid WENO-central', 'Upwind (Zhong)'][conv] || shortLabel('RunParam%iConvSchm');
    item(pn, 'Convection', convName + (order ? ', ' + order + getOrdinal(order) + ' order' : ''), ['RunParam%iConvSchm', 'RunParam%ConvStencil']);
    if (live('WENOParam%iglobalscheme')) {
      item(pn, 'WENO', shortLabel('WENOParam%iglobalscheme') + ' · ' + shortLabel('WENOParam%split_method'), ['WENOParam%iglobalscheme', 'WENOParam%split_method']);
      var azMode = num('WENOParam%adapt_zone_on', 0);
      var azText = azMode === 0 ? 'global, x/y/z = ' + raw('WENOParam%iadaptx') + '/' + raw('WENOParam%iadapty') + '/' + raw('WENOParam%iadaptz')
        : azMode === 1 ? 'in zones (' + Math.max(0, num('WENOParam%adapt_zone_num', 0)) + ')'
        : azMode === 2 ? 'from REST/WENO_adapt_zone.h5' : shortLabel('WENOParam%adapt_zone_on');
      if (has('WENOParam%adapt_zone_iadapt_freq')) azText += ' · freq = ' + raw('WENOParam%adapt_zone_iadapt_freq');
      item(pn, 'Adaptation', azText, ['WENOParam%adapt_zone_on', 'WENOParam%adapt_zone_iadapt_freq']);
      if (azMode === 1) zoneItems(pn, 'WENOParam', 'adapt_zone_');
    }
    if (live('HybridParam%ishocksensortype')) {
      item(pn, 'Shock sensor', shortLabel('HybridParam%ishocksensortype') + ', threshold ' + raw('HybridParam%sensorthresh'), ['HybridParam%ishocksensortype']);
      if (on('HybridParam%weno_zone_on')) { item(pn, 'WENO zones', String(Math.max(0, num('HybridParam%weno_zone_num', 0))), ['HybridParam%weno_zone_on']); zoneItems(pn, 'HybridParam', 'weno_zone_'); }
    }
    item(pn, 'Viscous', on('FlowParam%iviscous') ? shortLabel('FlowParam%iViscSchm') : 'off (Euler)', ['FlowParam%iviscous', 'FlowParam%iViscSchm']);
    item(pn, 'Time', shortLabel('TemporalParam%ischeme') + ' · ' + (constDt ? '{Δt} = ' + sig(constDt, 3) + ' s' : 'CFL ' + raw('TemporalParam%cfl_conv')) + (ncfl > 1 ? ' (' + ncfl + ' stages)' : ''),
      ['TemporalParam%ischeme', 'TemporalParam%dt_const']);
    item(pn, 'Filter', on('FilterParam%iuse') ? 'on, strength ' + raw('FilterParam%filterStrength') : 'off', ['FilterParam%iuse']);

    // ---- turbulence model: what is listed depends on which module is active
    var les = on('LESParam%iuse'), rans = on('RANSParam%iuse');
    var pm = panel('Turbulence model · ' + (les && rans ? 'LES + RANS' : les ? 'LES' : rans ? 'RANS' : 'DNS'));
    if (!les && !rans) item(pm, 'Mode', 'DNS: all scales resolved, no SGS or RANS model', ['LESParam%iuse', 'RANSParam%iuse']);
    if (rans) {
      item(pm, 'RANS model', label('RANSParam%imodel') ? shortLabel('RANSParam%imodel') : 'Baldwin-Lomax · imodel = ' + raw('RANSParam%imodel'), ['RANSParam%imodel']);
      item(pm, 'Active from', 'step ' + raw('RANSParam%nstart') + ' · {Pr|t} = ' + raw('RANSParam%Prt'), ['RANSParam%nstart', 'RANSParam%Prt']);
      item(pm, 'BL edge', paren(label('RANSParam%iBL')) || 'iBL = ' + raw('RANSParam%iBL'), ['RANSParam%iBL']);
      if (on('RANSParam%iTV')) item(pm, 'T–V relation', 'on from step ' + raw('RANSParam%TV_nstart'), ['RANSParam%iTV']);
      var rz = on('RANSParam%zone_on');
      item(pm, 'Region', rz ? 'mut added only in zones (' + Math.max(0, num('RANSParam%zone_num', 0)) + ')' : 'everywhere', ['RANSParam%zone_on', 'RANSParam%zone_num']);
      if (rz) zoneItems(pm, 'RANSParam', 'zone_');
    }
    if (les) {
      item(pm, 'SGS model', shortLabel('LESParam%imodel').replace(/^Use\s+/i, ''), ['LESParam%imodel']);
      item(pm, 'Constants', '{C} = ' + raw('LESParam%const') + ' · {Pr|t} = ' + raw('LESParam%Prt'), ['LESParam%const', 'LESParam%Prt']);
      if (label('LESParam%idelta')) {
        var dl = label('LESParam%idelta').replace(/^delta\b/i, '{Δ}').replace(/volume\^\(1\/3\)/i, '{V}¹ᐟ³ (cell volume)')
          .replace(/\(delta_i, delta_j, delta_k\)/i, '({Δ|i}, {Δ|j}, {Δ|k})');
        item(pm, 'Filter width', cap(dl), ['LESParam%idelta']);
      }
      if (on('LESParam%icomprCorr')) item(pm, 'Compressibility', 'correction on', ['LESParam%icomprCorr']);
      item(pm, 'Wall model', on('LESParam%iWMLES')
        ? 'WMLES · interface index ' + raw('LESParam%idx') + ' · {N|p} = ' + raw('LESParam%Np') + ' · {α} = ' + raw('LESParam%alpha')
        : 'off (wall-resolved)', ['LESParam%iWMLES']);
    }

    var prn = panel('Run');
    item(prn, 'Start', nstart === -1 ? 'auto-restart from latest checkpoint' : 'step ' + fmtInt(nstart), ['RunParam%nstart'], nstart < -1 ? 'error' : '');
    item(prn, 'Length', fmtInt(nstep) + ' steps' + (tphys ? ' = ' + sig(tphys * 1e3, 3) + ' ms' : ''), ['RunParam%nstep']);
    if (tphys && d0 > 0) item(prn, 'Flow-through', sig(tphys * u / d0, 4) + ' {δ|0}/{u|∞}', ['RunParam%nstep', 'TemporalParam%dt_const']);
    item(prn, 'Checkpoints', 'every ' + fmtInt(nsr) + ' steps (~' + fmtInt(nsr > 0 ? Math.floor(nstep / nsr) : NaN) + ' files)', ['RunParam%nsaverestartfile'], nsr > 0 ? '' : 'error');

    var pb = panel('Boundary conditions');
    function pair(lab, a, b, ka, kb) {
      if (raw(a) === raw(b)) item(pb, lab[0], shortLabel(a), [a, b]);
      else { item(pb, lab[1], shortLabel(a), [a]); item(pb, lab[2], shortLabel(b), [b]); }
    }
    pair(['Inlet / outlet', 'Inlet (i = 1)', 'Outlet (i = imax)'], 'BCParam%inletbc', 'BCParam%ioutletbc');
    if (num('BCParam%inletbc', 0) !== 0) {
      var inflow = [];
      if (on('BCParam%isynthetic')) inflow.push('digital-filter turbulence');
      if (on('BCParam%irescale')) inflow.push('rescaling');
      if (inflow.length) item(pb, 'Inflow', inflow.join(' + '), ['BCParam%isynthetic', 'BCParam%irescale']);
    }
    pair(['Spanwise', 'Span (j = 1)', 'Span (j = jmax)'], 'BCParam%ispanwisebegbc', 'BCParam%ispanwiseendbc');
    // "Bottom", not "Wall": in e.g. a nozzle the k = 1 face can be a freestream or symmetry face
    item(pb, 'Bottom (k = 1)', shortLabel('BCParam%ibotbc') + (bottomIsWall ? ', ' + (iso ? 'isothermal' : 'adiabatic') : ''), ['BCParam%ibotbc', 'BCParam%iadiabaticwall']);
    item(pb, 'Top (k = kmax)', shortLabel('BCParam%itopbc') + ((topv === 3 || topv === 7) && has('BCParam%sigma_topbc') ? ', {σ} = ' + raw('BCParam%sigma_topbc') : ''), ['BCParam%itopbc']);
    item(pb, 'Sponges', sp.length ? sp.map(function (x) { return x[0].toLowerCase(); }).join(', ') : 'none', sp.length ? sp.map(function (x) { return 'BCParam%' + x[1]; }) : ['BCParam%inletsponge']);
    item(pb, 'Forcing', forcing.length ? forcing.map(function (f) { return f[0]; }).join(', ') : 'none', forcing.length ? forcing.map(function (f) { return f[1]; }) : ['BCParam%iwallforce']);

    var po = panel('Output');
    activeOut.forEach(function (o) { item(po, o.label, o.text, o.keys); });
    if (!activeOut.length) item(po, 'Savers', 'none active', []);
    if (off.length) item(po, 'Off', off.length + ' other modules', [], 'muted');

    groups.keyPoints = kp;

    // ---- run type: TDNS (temporal) vs SDNS (spatial)
    // TDNS = inlet and outlet periodic AND no inflow turbulence generation
    //        (no digital filter, no rescaling, no unsteady inlet-plane data).
    // inletdatatype is only read when the inlet is not periodic, so it only counts then.
    function isPeriodic(k) { var l = label(k); return l ? /periodic/i.test(l) : num(k, -1) === 0; }
    var inPer = isPeriodic('BCParam%inletbc'), outPer = isPeriodic('BCParam%ioutletbc');
    var unsteadyInlet = !inPer && /unsteady/i.test(label('BCParam%inletdatatype'));
    var gen = [];
    if (on('BCParam%isynthetic')) gen.push('digital-filter inflow (isynthetic)');
    if (on('BCParam%irescale')) gen.push('rescaling (irescale)');
    if (unsteadyInlet) gen.push('unsteady inlet planes (inletdatatype = ' + raw('BCParam%inletdatatype') + ')');
    var temporal = inPer && outPer && !gen.length;
    // DNS is temporal or spatial; LES and RANS are just LES / RANS.
    // The code runs one type at a time, so LES + RANS together is invalid (the validator reports it).
    var simType = les && rans ? 'LES+RANS' : les ? 'LES' : rans ? 'RANS' : 'DNS';
    if (simType !== 'DNS') {
      groups.runType = {
        kind: simType === 'LES+RANS' ? 'LES + RANS' : simType,
        model: simType === 'LES+RANS' ? 'invalid' : simType,
        name: simType === 'LES+RANS' ? 'Invalid' : simType === 'LES' ? 'Large-eddy simulation' : 'RANS',
        why: simType === 'LES+RANS' ? 'LES and RANS are both on; only one type can run at a time'
          : simType === 'LES' ? shortLabel('LESParam%imodel').replace(/^Use\s+/i, '') + ', C = ' + raw('LESParam%const')
          : (label('RANSParam%imodel') ? shortLabel('RANSParam%imodel') : 'Baldwin-Lomax') + ', from step ' + raw('RANSParam%nstart'),
        keys: ['LESParam%iuse', 'RANSParam%iuse']
      };
      return groups;
    }
    groups.runType = {
      kind: (temporal ? 'T' : 'S') + 'DNS',
      model: 'dns',
      name: (temporal ? 'Temporal ' : 'Spatial ') + 'DNS',
      why: temporal
        ? 'inlet & outlet periodic, no inflow turbulence generation'
        : [!inPer || !outPer ? 'streamwise not periodic (inlet ' + (inPer ? 'periodic' : 'non-periodic') + ', outlet ' + (outPer ? 'periodic' : 'non-periodic') + ')' : null]
          .concat(gen.length ? ['turbulence generation: ' + gen.join(', ')] : []).filter(Boolean).join(' · '),
      keys: ['BCParam%inletbc', 'BCParam%ioutletbc', 'BCParam%isynthetic', 'BCParam%irescale', 'BCParam%inletdatatype', 'LESParam%iuse', 'RANSParam%iuse']
    };

    return groups;

    // ---- helpers that need the closures above
    function zoneRow(top, stem) {
      var n = Math.max(0, num(top + '%' + stem + 'num', 1));
      var detail = [];
      var b = function (ax, e) { return nums(top + '%' + stem + ax + e); };
      for (var z = 0; z < n; z++) {
        detail.push(['zone ' + (z + 1), ['i', 'j', 'k'].map(function (ax) {
          var bb = b(ax, 'beg')[z], ee = b(ax, 'end')[z];
          return ax + ' [' + (bb == null ? '?' : bb) + '..' + (ee == null ? '?' : ee) + ']';
        }).join(' · ')]);
      }
      return { n: n, detail: detail };
    }

    function region(pfx) {
      function v(n) { return has(pfx + '%' + n) ? raw(pfx + '%' + n) : null; }
      var out = [];
      ['i', 'j', 'k'].forEach(function (ax) {
        var b = v(ax + 'start') || v(ax + 'st'), e = v(ax + 'end'), sk = v(ax + 'skip'), rg = v(ax + 'region');
        if (rg) out.push(ax + ' [' + rg.replace(', ', '..') + ']');
        else if (b && e) out.push(ax + ' [' + b + '..' + e + ']' + (sk && sk !== '1' ? '/' + sk : ''));
      });
      var loc = v('ilocations') || v('jlocations') || v('klocations');
      if (loc && !out.length) out.push('at ' + loc);
      var pl = v('kplanes') || v('iplanes') || v('jplanes');
      if (pl) out.push(pl + ' plane' + (pl === '1' ? '' : 's'));
      return out.join(' ');
    }
  }

  function getOrdinal(n) {
    var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
  }

  /** Plain-text version in the spirit of dnsParamSummary.txt (no storage estimates). */
  function toText(groups, fileName) {
    var W = 80, out = [];
    out.push('='.repeat(W));
    out.push('  DNS SIMULATION CONFIGURATION SUMMARY');
    out.push('  Deck: ' + (fileName || 'deck3d.inp') + '   (generated by deckweb, ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + ')');
    if (groups.keyPoints) {
      out.push('='.repeat(W));
      if (groups.runType) out.push('  RUN TYPE: ' + groups.runType.kind + ' (' + groups.runType.name + ': ' + groups.runType.why + ')', '');
      out.push('  KEY POINTS');
      groups.keyPoints.forEach(function (pn) {
        out.push('', '  ' + pn.title);
        pn.items.forEach(function (it) { out.push('    - ' + (it.label + ':') + ' '.repeat(Math.max(1, 16 - it.label.length)) + plainMath(it.text)); });
      });
    }
    out.push('', '='.repeat(W), '  DETAILS', '='.repeat(W), '');
    groups.forEach(function (g, gi) {
      out.push((gi + 1) + '. ' + g.title.toUpperCase());
      out.push('-'.repeat(W));
      g.rows.forEach(function (r) {
        var lab = r.sub ? '    - ' : '  ' + (r.label + ':') + ' '.repeat(Math.max(1, 24 - r.label.length - 1));
        if (r.sub) lab += '';
        out.push(lab + r.value);
        var det = r.detail || [];
        if (det.length > 3) out.push('      ' + det.map(function (d) { return d[0] + ' = ' + d[1]; }).join(', '));
        else det.forEach(function (d) { out.push('      ' + d[0] + ': ' + d[1]); });
      });
      out.push('');
    });
    out.push('='.repeat(W));
    return out.join('\n') + '\n';
  }

  /** "{M|∞} = 4.87" -> "M∞ = 4.87" (plain text, for the .txt export) */
  function plainMath(s) {
    return s.replace(/\{([^|}]+)\|([^}]+)\}/g, function (_, v, sub) { return v + (v.length > 1 ? '_' : '') + sub; })
      .replace(/\{([^}]+)\}/g, '$1');
  }

  DW.plainMath = plainMath;
  DW.buildSummary = build;
  DW.summaryText = toText;
  DW.fmtNum = fmtNum;
  DW.fmtInt = fmtInt;
})();
