# deckweb

A local, browser-based editor for `deck3d.inp`, the web counterpart of the `deckcheck` CLI.
It's plain HTML, CSS and JavaScript, with no build step, no server and no network access.

## Run

Open `index.html` in a browser by double-clicking it. Then drop a `deck3d.inp` onto the page or click **Open**.

## What it does

- **Block-by-block editing.** Every `Prefix%...` group (RunParam, BCParam, …) is a block in the sidebar.
  Inside a block, parameters are grouped by the `!!` comment section they belong to.
- **Widgets come from the deck's own comments.** Documented options (`0: …`, `1 -- …`, `0 = A, 1 = B`, …)
  become dropdowns, on/off flags become switches, and arrays and zones get one field per value.
  Pasting `1, 2, 3` into a field splits it into separate values.
- **Values are edited in place.** Only the value text changes. Indentation, `=` spacing, the trailing
  comma, `1.d-30` style numbers and inline `! comments` (kept in their column) are left alone.
  An unedited deck downloads byte-for-byte identical.
- **Live preview** of the whole file on the right, with changed lines highlighted. Clicking a preview line
  jumps to its field, and a **Changes** tab shows before/after pairs.
- **Dormant modules collapse.** Parameters of switched-off modules (`istatus = 0`, `iuse = 0`, `inletsponge = 0`, …) fold into one line.
  Turning the switch on expands them right away. *Tools → Show dormant parameters* shows everything.
- **Summary page**: the run at a glance, like deckcheck's `dnsParamSummary.txt` but without the storage estimates.
  It covers grid & MPI, flow properties (Mach, μ∞, Re), numerics & run time, BCs & sponges, and active output.
  Click a row to jump to its parameter, and use *Download .txt* to export it.
- **Checks** (listed on the Summary page), re-run on every edit:
  - syntax killers (`,,`, unclosed quotes, unclosed namelists), with one-click fixes
  - read window, MPI divisibility, convective order, nstart/nsaverestartfile
  - isothermal wall temperature, periodic BC pairs
  - zone bounds, array length vs. count parameters (`ncfl`, `nmodes`, `*_zone_num`, …)
  - saver index ranges, PlaneseriesSave buffering
  - values outside the documented options

  Enter `imax/jmax/kmax` on the checks page to check against the real grid (a browser can't read `REST/grid.h5`).
- **Undo/redo** (Ctrl+Z / Ctrl+Shift+Z) and **autosave** of a draft in the browser, offered again on the next visit.
- **Output**:
  - **Download**
  - **Save**: writes back to the file you opened, in Chrome or Edge via *Open*
  - **Copy**
  - **Align columns**, the same as `deckcheck --reformat`

Keyboard shortcuts: `/` search · `Ctrl+S` save or download · `Ctrl+O` open · `Esc` clear search.

## Folder layout

```
deckweb/
├── index.html              entry point (open this)
├── favicon.svg
├── README.md
├── package.json            test scripts only (the app needs no install)
├── assets/
│   └── css/app.css         styles, light/dark theme
├── src/
│   ├── core/               logic, no UI code
│   │   ├── parser.js       line-preserving namelist parser, syntax checks, serializer, column aligner
│   │   ├── docs.js         pulls descriptions and options out of the !! comment blocks
│   │   ├── validator.js    checks (errors / warnings)
│   │   └── summary.js      run summary shown on the Summary page and exported as .txt
│   ├── config/
│   │   └── blocks.js       block titles, dormancy rules, count → array links
│   └── ui/
│       └── app.js          UI, state, live preview, file handling
└── tests/
    ├── README.md           how to run and write tests
    ├── helpers.js          load the modules in Node, edit a deck, analyse it
    ├── unit.test.js        parser, docs, dormancy, arrays, validator, summary (Node only)
    ├── e2e.test.js         the real page in headless Chromium (Playwright)
    └── fixtures/deck3d.inp sample deck used by every test
```

To teach the app about a new switch, add a line to `RULES` in `src/config/blocks.js`.
To link a new count parameter to its arrays, add it to `ARRAY_COUNTS` in the same file.

## Tests

```bash
npm test
```

That runs the unit tests in Node, with nothing to install. The browser tests need Playwright once:

```bash
npm install && npx playwright install chromium
```

Then:

```bash
npm run test:e2e
```

See `tests/README.md` for how to add a test.
