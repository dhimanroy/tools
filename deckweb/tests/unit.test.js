/*
 * Unit tests: parser, doc extraction, dormancy, count->array links, validator, summary.
 * Run:  node --test tests/unit.test.js      (or: npm test)
 * No dependencies; uses Node's built-in test runner (Node 18+).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadDW, deckText, setValue, analyse, keyPoint } = require('./helpers');

const DW = loadDW();
const TEXT = deckText();
const BASE = analyse(TEXT);

// ---------------------------------------------------------------- parser
test('parser: unedited deck serializes byte-for-byte', () => {
  assert.equal(DW.serialize(BASE.model), TEXT);
});

test('parser: finds all assignments, both namelists, no false syntax issues', () => {
  assert.equal(BASE.model.params.length, 477);
  assert.deepEqual(BASE.model.namelists.map((n) => n.name), ['MainInput', 'AuxInput']);
  assert.equal(BASE.model.issues.length, 0);
});

test('parser: Fortran d-exponents and multi-value arrays are kept as written', () => {
  assert.deepEqual(BASE.p('WENOParam%absolutelim_SI').tokens, ['1.d-30']);
  assert.deepEqual(BASE.p('FilterParam%filter_zone_ibeg').tokens, ['1', '1110']);
});

test('parser: an edit changes only the value and keeps the inline comment column', () => {
  const m = DW.parseDeck(TEXT);
  const p = m.paramMap.get('fouriersave%nstart');
  const before = p.lineRaw;
  p.tokens = ['1234567'];
  const after = DW.renderParamLine(p);
  assert.match(after, /FourierSave%nstart\s+= 1234567,/);
  assert.equal(after.indexOf('!'), before.indexOf('!'), 'comment stays in its column');
  assert.equal(DW.serialize(m).split('\n').filter((l, i) => l !== TEXT.split('\n')[i]).length, 1, 'only one line differs');
});

test('parser: ",," is reported with a fix, and the line is NOT silently fixed', () => {
  const broken = TEXT.replace('filter_zone_ibeg                  = 1, 1110,', 'filter_zone_ibeg                  = 1,, 1110,');
  const m = DW.parseDeck(broken);
  assert.equal(m.issues.length, 1);
  assert.equal(m.issues[0].level, 'error');
  assert.match(m.issues[0].fix, /= 1, 1110,$/);
  assert.equal(DW.serialize(m), broken, 'serialized text still has the error until Fix is applied');
});

test('parser: align columns keeps the line count', () => {
  const out = DW.alignColumns(BASE.model);
  assert.equal(out.split('\n').length, TEXT.split('\n').length);
});

// ---------------------------------------------------------------- docs
const opts = (k) => BASE.p(k).doc.options.map((o) => o.value);

test('docs: options parsed from the different comment styles', () => {
  assert.deepEqual(opts('RunParam%iConvSchm'), ['0', '1', '2', '3']);            // "0  weno scheme"
  assert.deepEqual(opts('WENOParam%split_method'), ['0', '1', '2']);             // "0 = A, 1 = B, 2 = C"
  assert.deepEqual(opts('RANSParam%zone_on'), ['0', '1']);                        // "zone_on: 0: ..."
  assert.deepEqual(opts('WENOParam%adapt_zone_on'), ['0', '1', '2']);             // "0 to ...; 1 to ..."
  assert.deepEqual(opts('BCParam%EigenModeInflowForce%irhodist'), ['0', '1']);    // "0-- 'u,v,w,p,t'"
  assert.equal(opts('BCParam%InletSpongeParam%isigmashape').length, 8);           // "1 -- constant ..."
});

test('docs: nested sub-lists do not overwrite the parent options', () => {
  const conv = BASE.p('RunParam%iConvSchm').doc.options;
  assert.match(conv.find((o) => o.value === '1').label, /split central/i);
  assert.match(conv.find((o) => o.value === '2').label, /hybrid/i);
});

test('docs: closely-named definitions share one option list (iflowformat / _wt)', () => {
  assert.equal(opts('RunParam%iflowdataformat').length, 8);
  assert.equal(opts('RunParam%iflowdataformat_wt').length, 8);
});

test('docs: switches that list options without 0 get "0: off"', () => {
  assert.ok(opts('BCParam%inletsponge').includes('0'));
  assert.ok(opts('BCParam%iwallforce').includes('0'));
});

test('docs: widget choice', () => {
  assert.equal(BASE.p('RunParam%iConvSchm').widget, 'enum');
  assert.equal(BASE.p('TimeseriesSave%kplane%istatus').widget, 'switch');
  assert.equal(BASE.p('FilterParam%iuse').widget, 'switch');
  assert.equal(BASE.p('AcousticStat%phase').widget, 'list', 'phase is a number, not an on/off flag');
  assert.equal(BASE.p('RunParam%nstep').widget, 'list');
});

// ---------------------------------------------------------------- dormancy
const hiddenIn = (a, prefix) => a.model.params.filter((p) => p.fullKey.indexOf(prefix) === 0 && a.hidden.has(p.id)).length;

test('dormancy: modules that are off fold away; switches stay visible', () => {
  assert.equal(hiddenIn(BASE, 'RANSParam%'), 18);
  assert.ok(!BASE.hidden.has('ransparam%iuse'));
  assert.equal(hiddenIn(BASE, 'BCParam%InletSpongeParam'), 16);
  assert.equal(hiddenIn(BASE, 'TimeseriesSave%kplane%'), 0, 'kplane is on');
});

test('dormancy: WENOParam only for iConvSchm = 0, HybridParam only for iConvSchm = 2', () => {
  assert.equal(hiddenIn(BASE, 'WENOParam%'), 0);
  assert.equal(hiddenIn(BASE, 'HybridParam%'), 15);
  const hyb = analyse(setValue(TEXT, 'RunParam%iConvSchm', '2'));
  assert.equal(hiddenIn(hyb, 'WENOParam%'), 23);
  assert.ok(!hyb.hidden.has('hybridparam%ishocksensortype'), 'Hybrid block is active');
  assert.equal(hiddenIn(hyb, 'HybridParam%'), 10, 'only the weno_zone_* params, hidden by weno_zone_on = 0');
  const cen = analyse(setValue(TEXT, 'RunParam%iConvSchm', '1'));
  assert.equal(hiddenIn(cen, 'WENOParam%') + hiddenIn(cen, 'HybridParam%'), 23 + 15);
});

// ---------------------------------------------------------------- count -> array links
const linked = (k) => DW.linkedArrays(BASE.model, BASE.p(k)).map((q) => q.name);

test('arrays: count parameters link to the right arrays', () => {
  assert.deepEqual(linked('TemporalParam%ncfl'), ['iteration', 'cfl_conv', 'cfl_vis', 'iconst_dt', 'dt_const']);
  const fz = linked('FilterParam%filter_zone_num');
  assert.ok(fz.includes('filter_zone_kend') && fz.includes('filter_zone_ifilterz'));
  assert.ok(!fz.includes('filter_zone_on') && !fz.includes('filter_zone_num'));
  assert.ok(!linked('WENOParam%adapt_zone_num').includes('adapt_zone_iadapt_freq'));
  assert.deepEqual(linked('BCParam%GeneralWallForce%nmodes'), ['freq', 'amplitude']);
  assert.deepEqual(linked('FourierSave%nmodes'), [], 'FourierSave freq is a scalar');
  assert.deepEqual(linked('BCParam%EigenModeInflowForce%nmodes'), [], 'amplitude there is a scalar');
});

// ---------------------------------------------------------------- validator
const errors = (a) => a.checks.filter((c) => c.level === 'error');
const has = (a, re) => a.checks.some((c) => (c.level === 'error' || c.level === 'warn') && re.test(c.title + ' ' + c.msg));

const warnings = (a) => a.checks.filter((c) => c.level === 'warn');

test('validator: uneven MPI blocks are warnings, not errors (the solver handles them)', () => {
  assert.equal(errors(BASE).length, 0, 'sample deck has no errors');
  assert.deepEqual(warnings(BASE).map((c) => c.title).sort(), ['MPI i-direction', 'MPI j-direction']);
  const perRank = BASE.summary.keyPoints[0].items.find((i) => i.label === 'Per rank');
  assert.equal(perRank.level, 'warn');
});

test('validator: an even decomposition clears the MPI warnings', () => {
  const ok = analyse(setValue(setValue(TEXT, 'RunParam%inode', '40'), 'RunParam%jnode', '40'));
  assert.equal(warnings(ok).filter((c) => /^MPI/.test(c.title)).length, 0);
  assert.equal(errors(ok).length, 0);
});

test('validator: no periodic-pair check on BCParam', () => {
  const a = analyse(setValue(TEXT, 'BCParam%ioutletbc', '3'));
  assert.ok(!has(a, /periodic/i));
});

test('validator: LES and RANS both on is an error', () => {
  const a = analyse(setValue(setValue(TEXT, 'LESParam%iuse', '1'), 'RANSParam%iuse', '1'));
  assert.ok(has(a, /LES and RANS both on/));
});

test('validator: array shorter than its count is an error', () => {
  const a = analyse(setValue(TEXT, 'TemporalParam%ncfl', '3'));
  assert.ok(has(a, /cfl_conv has 1 value/));
});

test('validator: grid size is checked against the read window', () => {
  const a = analyse(TEXT, { imax: 1700 });
  assert.ok(has(a, /iend_rd = 1720 exceeds grid size imax = 1700/));
});

test('validator: isothermal wall with twall <= 0 is an error', () => {
  const a = analyse(setValue(TEXT, 'FlowParam%twall', '0'));
  assert.ok(has(a, /Isothermal wall/));
});

// ---------------------------------------------------------------- summary
test('summary: derived flow quantities match deckcheck', () => {
  const s = BASE.summary;
  assert.equal(keyPoint(s, 'Flow', 'Mach'), '{M|∞} = 4.872');
  assert.match(keyPoint(s, 'Flow', 'Reynolds'), /\{Re\|δ0\} = 2\.58e5 · \{Re\|u\} = 4\.55e7/);
  assert.match(keyPoint(s, 'Flow', 'Recovery'), /\{T\|r\} = 342\.9 K/);
  assert.match(keyPoint(s, 'Flow', 'T ratios'), /\{T\|w\}\/\{T\|∞\} = 3\.13 · \{T\|w\}\/\{T\|r\} = 0\.60/);
  assert.match(keyPoint(s, 'Run', 'Flow-through'), /^243\.7 /);
});

test('summary: coordinates, geometry, WENO zones', () => {
  const s = BASE.summary;
  assert.equal(keyPoint(s, 'Domain', 'Coordinates'), 'Cartesian ({x}, {y}, {z})');
  assert.equal(keyPoint(s, 'Domain', 'Geometry'), 'Planar in {i}, {j}, {k}');
  assert.match(keyPoint(s, 'Numerics', 'Adaptation'), /in zones \(1\) · freq = 2/);
  assert.equal(keyPoint(s, 'Numerics', 'Zone 1'), '{i} 1–1720 · {j} 1–1920 · {k} 1–274');
});

test('summary: bottom BC is "Bottom", with wall lines only when k = 1 is a wall', () => {
  assert.equal(keyPoint(BASE.summary, 'Boundary', 'Bottom (k = 1)'), 'Solid-wall, isothermal');
  const nozzle = analyse(setValue(TEXT, 'BCParam%ibotbc', '2')).summary;
  assert.equal(keyPoint(nozzle, 'Boundary', 'Bottom (k = 1)'), 'Zero order extrapolation');
  assert.equal(keyPoint(nozzle, 'Flow', 'Wall (k = 1)'), null);
  assert.ok(keyPoint(nozzle, 'Flow', 'Recovery'));
});

test('summary: run type TDNS / SDNS / LES / RANS / invalid', () => {
  const rt = (t) => analyse(t).summary.runType.kind;
  assert.equal(rt(TEXT), 'TDNS');
  assert.equal(rt(setValue(TEXT, 'BCParam%ioutletbc', '3')), 'SDNS', 'outlet not periodic');
  assert.equal(rt(setValue(TEXT, 'BCParam%isynthetic', '1')), 'SDNS', 'digital filter inflow');
  assert.equal(rt(setValue(TEXT, 'BCParam%irescale', '1')), 'SDNS', 'rescaling');
  assert.equal(rt(TEXT), 'TDNS', 'inletdatatype = 3 is ignored while the inlet is periodic');
  assert.equal(rt(setValue(setValue(TEXT, 'BCParam%inletbc', '1'), 'BCParam%ioutletbc', '0')), 'SDNS');
  assert.equal(rt(setValue(TEXT, 'LESParam%iuse', '1')), 'LES');
  assert.equal(rt(setValue(TEXT, 'RANSParam%iuse', '1')), 'RANS');
  assert.equal(rt(setValue(setValue(TEXT, 'RANSParam%iuse', '1'), 'BCParam%irescale', '1')), 'RANS', 'no T/S for RANS');
  assert.equal(rt(setValue(setValue(TEXT, 'LESParam%iuse', '1'), 'RANSParam%iuse', '1')), 'LES + RANS');
});

test('summary: turbulence model panel follows the active module', () => {
  const title = (t) => analyse(t).summary.keyPoints.find((p) => /^Turbulence/.test(p.title)).title;
  assert.equal(title(TEXT), 'Turbulence model · DNS');
  const les = analyse(setValue(TEXT, 'LESParam%iuse', '1')).summary;
  assert.equal(keyPoint(les, 'Turbulence', 'Constants'), '{C} = 0.55 · {Pr|t} = 0.9');
  const rans = analyse(setValue(TEXT, 'RANSParam%iuse', '1')).summary;
  assert.equal(keyPoint(rans, 'Turbulence', 'Zone 1'), '{i} 1–2000 · {j} 1–1 · {k} 1–200');
});

test('summary: .txt export is plain text (no {..} math markup)', () => {
  const txt = DW.summaryText(BASE.summary, 'deck3d.inp');
  assert.match(txt, /RUN TYPE: TDNS/);
  assert.match(txt, /M∞ = 4\.872/);
  assert.match(txt, /Re_δ0 = 2\.58e5/);
  assert.ok(!/\{[^}]*\|/.test(txt), 'no leftover {sym|sub} markup');
});
