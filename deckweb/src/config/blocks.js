/*
 * Block definitions (titles from deckcheck's DECK_BLOCK_DEFS) and dormancy
 * rules: which switch hides which parameters when it is off. Any top-level
 * prefix not listed here still shows up as its own block automatically.
 */
(function () {
  'use strict';
  var DW = (window.DW = window.DW || {});

  DW.BLOCK_TITLES = {
    RunParam: ['Core run & grid decomposition', 'Run controls, MPI decomposition, grid read window, convective scheme'],
    FlowParam: ['Flow & thermodynamic scales', 'Freestream reference scales, viscosity law, wall temperature'],
    RANSParam: ['RANS turbulence model', 'Baldwin-Lomax RANS model and zones'],
    LESParam: ['Large-eddy simulation', 'SGS model selection, delta definition, wall-modeled LES'],
    TemporalParam: ['Time integration & CFL', 'Time-stepping scheme, CFL schedule, time step'],
    WENOParam: ['WENO numerics', 'WENO schemes, limiters and adaptation zones'],
    HybridParam: ['Hybrid WENO-central', 'Shock sensors, thresholds and WENO zones'],
    FilterParam: ['Spatial filtering', 'Conserved-variable filter and filter zones'],
    BCParam: ['Boundary conditions', 'Inlet/outlet/wall/top/spanwise BCs, sponges, inflow turbulence, forcing, roughness'],
    BodyForceParam: ['Body force', 'Channel/eddy body forces'],
    DisturModels: ['Disturbance models', 'Random disturbance generation'],
    TimeseriesSave: ['Time-series planes & volume', 'k/i/j-plane, k-bc and volume time series'],
    PlaneseriesSave: ['Plane series (inflow planes)', 'Cross-plane time series for inflow/bottom/top BCs'],
    FourierSave: ['Fourier modes', 'Fourier transform in i-planes or 3D'],
    XplaneSave: ['X-plane statistics', 'Mean and RMS in i-planes'],
    YplaneSave: ['Y-plane statistics', 'Mean and RMS in j-planes'],
    RMS3DSave: ['3D mean & RMS', 'Mean and RMS in the 3D domain'],
    SubfieldSave: ['Sub-field volume', 'Subsampled 3D flow field'],
    TKEBudgetSave: ['TKE budget', 'TKE budget in 3D'],
    AveSpanStat: ['Spanwise-averaged stats', 'Spanwise averaged statistics'],
    AcousticStat: ['Acoustic statistics', 'Spanwise averaged statistics for acoustic simulations'],
    BudgetStat: ['Reynolds-stress budget', 'Spanwise averaged TKE / Reynolds-stress budgets'],
    AveStreamSpanStat: ['Stream-span averaged stats', 'Streamwise-spanwise averaged statistics'],
    AveRibletStat: ['Riblet statistics', 'Riblet-averaged statistics'],
    ProbeSave: ['Point probes', 'Time series at probe points (probe.inp)']
  };

  // Explicit switches. `target` is a parameter path prefix; `keys` lists exact keys.
  // `active(v)` decides when the targets are in use (default: v != 0).
  var RULES = [
    // WENO parameters are only used by the pure WENO convective scheme (iConvSchm = 0)
    { sw: 'RunParam%iConvSchm', target: 'WENOParam', active: function (v) { return v === 0; }, when: '= 0' },
    // Hybrid parameters are only used by the hybrid WENO-central scheme (iConvSchm = 2)
    { sw: 'RunParam%iConvSchm', target: 'HybridParam', active: function (v) { return v === 2; }, when: '= 2' },
    { sw: 'BCParam%isynthetic', target: 'BCParam%DigFilterParam' },
    { sw: 'BCParam%ilinearroughbc', target: 'BCParam%LinearWallRoughness' },
    { sw: 'BCParam%irescale', target: 'BCParam%RescaleParam' },
    { sw: 'BCParam%inflowforce', target: 'BCParam%EigenModeInflowForce' },
    { sw: 'BCParam%iwallforce', target: 'BCParam%GeneralWallForce' },
    { sw: 'BCParam%inletsponge', target: 'BCParam%InletSpongeParam' },
    { sw: 'BCParam%ioutletsponge', target: 'BCParam%OutletSpongeParam' },
    { sw: 'BCParam%itopsponge', target: 'BCParam%TopSpongeParam' },
    { sw: 'BCParam%ibotsponge', target: 'BCParam%BotSpongeParam' },
    { sw: 'BCParam%ileftsponge', target: 'BCParam%LeftSpongeParam' },
    { sw: 'BCParam%irightsponge', target: 'BCParam%RightSpongeParam' },
    { sw: 'FlowParam%iCylinderCoordinate', target: 'BCParam%CylinParam' },
    { sw: 'BCParam%LinearWallRoughness%CylinRough', target: 'BCParam%LinearWallRoughness%CylinderWallRough' },
    { sw: 'BCParam%LinearWallRoughness%NatRough', target: 'BCParam%LinearWallRoughness%NaturalWallRough' },
    { sw: 'BCParam%DigFilterParam%idf_kdir', keys: ['BCParam%DigFilterParam%nzones_kdir', 'BCParam%DigFilterParam%zbeg', 'BCParam%DigFilterParam%zend'] },
    { sw: 'BCParam%DigFilterParam%idf_jdir', keys: ['BCParam%DigFilterParam%nzones_jdir', 'BCParam%DigFilterParam%ybeg', 'BCParam%DigFilterParam%yend'] },
    { sw: 'BCParam%RescaleParam%iImposeFreestream', keys: ['BCParam%RescaleParam%zodInletfsimpose'] },
    { sw: 'BodyForceParam%ibodyforce', target: 'BodyForceParam%SimpleEddyBodyForce', active: function (v) { return v === 2; }, when: '= 2' },
    { sw: 'BodyForceParam%ibodyforce', target: 'BodyForceParam%EddyBodyForce', active: function (v) { return v === 3; }, when: '= 3' },
    { sw: 'PlaneseriesSave%isaveiplane', target: 'PlaneseriesSave%iplane' },
    { sw: 'PlaneseriesSave%isavekplane', target: 'PlaneseriesSave%kplane' },
    { sw: 'LESParam%iWMLES', keys: ['LESParam%idx', 'LESParam%Np', 'LESParam%alpha', 'LESParam%tol', 'LESParam%iterMax'] },
    { sw: 'RANSParam%iTV', keys: ['RANSParam%TV_nstart', 'RANSParam%TV_znstarBeg', 'RANSParam%TV_znstarEnd'] }
  ];

  // Count parameters and the arrays whose length they set (same parent path).
  // `parent` restricts a rule to matching parent paths. Any *zone_num parameter is
  // also linked automatically to its sibling *zone_* arrays (except *zone_on).
  var ARRAY_COUNTS = [
    { count: 'ncfl', arrays: ['iteration', 'cfl_conv', 'cfl_vis', 'iconst_dt', 'dt_const'] },
    { count: 'nmodes', arrays: ['freq', 'amplitude'], parent: /GeneralWallForce|SimpleEddyBodyForce/ },
    { count: 'nzones_kdir', arrays: ['zbeg', 'zend'] },
    { count: 'nzones_jdir', arrays: ['ybeg', 'yend'] },
    { count: 'kplanes', arrays: ['klocations'] },
    { count: 'iplanes', arrays: ['ilocations'] },
    { count: 'jplanes', arrays: ['jlocations'] },
    { count: 'ipgroups', arrays: ['ilocations'] },
    { count: 'kpgroups', arrays: ['klocations'] },
    { count: 'kWNplane', arrays: ['kWNskip'] }
  ];
  var ZONE_SCALARS = /(?:on|num|freq)$/; // *_zone_on, *_zone_num, adapt_zone_iadapt_freq are not per-zone

  /** Arrays whose length is set by count parameter p (empty if p is not a count). */
  function linkedArrays(model, p) {
    var name = p.name.toLowerCase(), out = [];
    function add(n) {
      var q = model.paramMap.get((p.parent + '%' + n).toLowerCase());
      if (q && q !== p && out.indexOf(q) < 0) out.push(q);
    }
    ARRAY_COUNTS.forEach(function (r) {
      if (r.count.toLowerCase() === name && (!r.parent || r.parent.test(p.parent))) r.arrays.forEach(add);
    });
    if (/zone_num$/.test(name)) {
      var stem = name.slice(0, -3);
      model.params.forEach(function (q) {
        var n = q.name.toLowerCase();
        if (q.parent === p.parent && q !== p && n.indexOf(stem) === 0 && !ZONE_SCALARS.test(n.slice(stem.length))) add(q.name);
      });
    }
    return out;
  }

  /** Map(arrayParamId -> count param) for the whole deck. */
  function arrayCounts(model) {
    var m = new Map();
    model.params.forEach(function (p) {
      linkedArrays(model, p).forEach(function (q) { if (!m.has(q.id)) m.set(q.id, p); });
    });
    return m;
  }

  function numVal(p) {
    if (!p || !p.tokens.length) return NaN;
    var t = p.tokens[0];
    if (/^\.true\.|^t$/i.test(t)) return 1;
    if (/^\.false\.|^f$/i.test(t)) return 0;
    return Number(t.replace(/[dD]/, 'e'));
  }

  /** Returns Map(paramId -> {sw: param, text}) of parameters that are currently unused. */
  function computeDormancy(model) {
    var rules = RULES.slice();
    // Generic: istatus / iuse switches hide their siblings and children.
    model.params.forEach(function (p) {
      if (/^(istatus|iuse)$/i.test(p.name)) rules.push({ sw: p.fullKey, target: p.parent });
      else if (/zone_on$/i.test(p.name)) {
        var stem = p.name.slice(0, -2).toLowerCase();
        rules.push({ sw: p.fullKey, match: function (q) { return q.parent === p.parent && q.name.toLowerCase().indexOf(stem) === 0; } });
      }
    });

    var hidden = new Map();
    rules.forEach(function (r) {
      var swp = model.paramMap.get(r.sw.toLowerCase());
      if (!swp) return;
      var v = numVal(swp);
      var on = r.active ? r.active(v) : (v !== 0 && !isNaN(v));
      if (on) return;
      var tgt = r.target ? r.target.toLowerCase() + '%' : null;
      var keys = r.keys ? r.keys.map(function (k) { return k.toLowerCase(); }) : null;
      model.params.forEach(function (q) {
        if (q === swp || hidden.has(q.id)) return;
        var hit = r.match ? r.match(q) : keys ? keys.indexOf(q.id) >= 0 : q.id.indexOf(tgt) === 0;
        if (hit) hidden.set(q.id, { sw: swp, text: swp.fullKey + (r.when ? ' is not ' + r.when.replace('= ', '') : ' = ' + swp.tokens[0]) });
      });
    });
    return hidden;
  }

  /** Top-level blocks in file order. */
  function buildBlocks(model) {
    var blocks = [], byTop = new Map();
    model.params.forEach(function (p) {
      var b = byTop.get(p.top);
      if (!b) {
        var t = DW.BLOCK_TITLES[p.top] || [p.top, ''];
        b = { id: p.top, title: t[0], blurb: t[1], namelist: p.namelist, params: [] };
        byTop.set(p.top, b);
        blocks.push(b);
      }
      b.params.push(p);
    });
    blocks.forEach(function (b) {
      b.mainSwitch = b.params.find(function (p) { return p.parent === b.id && /^(istatus|iuse|ibodyforce)$/i.test(p.name); }) || null;
    });
    return blocks;
  }

  DW.linkedArrays = linkedArrays;
  DW.arrayCounts = arrayCounts;
  DW.numVal = numVal;
  DW.computeDormancy = computeDormancy;
  DW.buildBlocks = buildBlocks;
})();
