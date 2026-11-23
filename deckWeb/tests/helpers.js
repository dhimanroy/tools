/*
 * Shared helpers for the deckWeb tests.
 *
 * The app is plain browser JavaScript that attaches everything to window.DW.
 * For Node tests we fake `window` as the global object and load the same
 * source files the page loads (minus the UI), in the same order.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'deck3d.inp');

let DW = null;
/** Load the non-UI modules once and return window.DW. */
function loadDW() {
  if (DW) return DW;
  global.window = global;
  ['src/core/parser.js', 'src/core/docs.js', 'src/config/blocks.js', 'src/core/validator.js', 'src/core/summary.js']
    .forEach((f) => require(path.join(ROOT, f)));
  DW = global.DW;
  return DW;
}

/** The sample deck as text. */
function deckText() { return fs.readFileSync(FIXTURE, 'utf8'); }

/**
 * Return deck text with one parameter's value replaced, keeping the line layout.
 * setValue(text, 'RunParam%nstep', '400000')
 */
function setValue(text, fullKey, value) {
  // edit through the app's own parser, exactly like a UI edit (value text only)
  const dw = loadDW();
  const model = dw.parseDeck(text);
  const p = model.paramMap.get(fullKey.toLowerCase());
  if (!p) throw new Error('setValue: key not found: ' + fullKey);
  p.tokens = String(value).split(',').map((s) => s.trim());
  return dw.serialize(model);
}

/** Parse + docs + dormancy + checks + summary for a deck text, like the app does. */
function analyse(text, grid) {
  const dw = loadDW();
  const model = dw.parseDeck(text);
  dw.extractDocs(model);
  const hidden = dw.computeDormancy(model);
  const checks = dw.validate(model, hidden, grid || {});
  const summary = dw.buildSummary(model, hidden, grid || {});
  return { model, hidden, checks, summary, p: (k) => model.paramMap.get(k.toLowerCase()) };
}

/** Find a key-point item by panel title prefix and item label. */
function keyPoint(summary, panelPrefix, label) {
  const panel = summary.keyPoints.find((p) => p.title.indexOf(panelPrefix) === 0);
  if (!panel) return null;
  const it = panel.items.find((i) => i.label === label);
  return it ? it.text : null;
}

module.exports = { ROOT, FIXTURE, loadDW, deckText, setValue, analyse, keyPoint };
