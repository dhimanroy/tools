# Tests

Two suites, both using Node's built-in test runner (Node 18 or newer).

| File | What it covers | Needs |
|---|---|---|
| `unit.test.js` | Parser (exact round-trip, value-only edits, `,,` detection), doc/option extraction, dormancy rules, count → array links, validator rules, Summary key points and run type, `.txt` export | Node only |
| `e2e.test.js` | The real page in headless Chromium: loading, editing, dropdowns, switches, array resizing, syntax fix + undo/redo, Summary layout and badge, grid-size input, section pager, draft resume, download | Playwright + Chromium |

`fixtures/deck3d.inp` is the sample deck every test starts from.

## Running

From the `deckWeb/` folder:

```bash
npm test
```

That runs the unit tests and needs nothing installed. The browser tests need Playwright once:

```bash
npm install
npx playwright install chromium
npm run test:e2e
```

Without npm, the same commands are `node --test tests/unit.test.js` and `node --test tests/e2e.test.js`. If Playwright is not installed, the browser tests are reported as skipped rather than failing.

## Writing a new test

Start from the fixture, change it, and check the result:

```js
const { deckText, setValue, analyse, keyPoint } = require('./helpers');

test('my rule', () => {
  const a = analyse(setValue(deckText(), 'RunParam%iConvSchm', '2'));
  assert.ok(a.hidden.has('wenoparam%iglobalscheme'));        // dormancy
  assert.ok(a.checks.some((c) => /MPI/.test(c.title)));     // validator
  assert.equal(a.summary.runType.kind, 'TDNS');             // summary
  assert.match(keyPoint(a.summary, 'Numerics', 'Convection'), /Hybrid/);
});
```

- **`setValue(text, key, value)`** edits through the app's own parser, exactly like a UI edit. Use `'1, 2, 3'` for arrays.
- **`analyse(text, grid)`** returns `{ model, hidden, checks, summary, p(key) }`. `grid` is the optional `{ imax, jmax, kmax }`.
- **`keyPoint(summary, panelPrefix, label)`** returns one Summary bullet's text. The text still contains the math markup, e.g. `{M|∞} = 4.872`.

For browser tests, copy one of the tests in `e2e.test.js`: `open()` gives a page with the deck loaded, and `done(page)` also asserts that the page logged no errors.

Good habits:
- Add a unit test with every new validator rule or Summary line.
- Add a browser test when you change how something is edited.
