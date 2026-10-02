# Regression tests

A single Playwright script that drives the app (`index.html` plus `styles.css` and `js/`) in a real (headless)
browser and checks the app's actual behavior end to end - offline-first
sync, the rest timer, progression suggestions, the celebration overlay,
and so on. There's no framework or test runner: `app.test.js` is a plain
Node script that runs every scenario in one browser session and exits
non-zero if any assertion fails.

`mock-supabase.js` stands in for the real `@supabase/supabase-js` CDN
script (intercepted via `context.route`), backed by `sessionStorage`
instead of a network call, so the suite needs no real Supabase project,
credentials, or network access to run.

## Running it

```sh
cd test
npm install
npx playwright install chromium   # first time only, downloads a matching browser
npm test
```

`npm test` starts a tiny static file server for the repo root, waits for
it to answer, runs the full suite against it, and shuts the server down
again on its own - there's nothing else to start or stop by hand.

## Adding a scenario

Scenarios are just numbered `console.log` blocks inside `main()` in
`app.test.js` - copy the shape of an existing one (drive the UI, assert
on the resulting DOM/state, throw a descriptive `Error` on failure) and
add it before the final `ALL SCENARIOS PASSED` line. Keep it in the same
browser session as the rest rather than spinning up a new `main()` -
several scenarios rely on state earlier ones already set up (a signed-in
session, entries logged "today", etc.), which is also why scenario order
here matters more than it would in a typical isolated test suite.

## Environment notes

- No `executablePath` is hardcoded. `chromium.launch()` finds whatever
  Chromium `npx playwright install` put in place for the installed
  `playwright` version. If you're running in an environment with a
  pre-installed browser at a nonstandard path, set
  `PLAYWRIGHT_CHROMIUM_PATH` to point at it instead of re-downloading.
- `TEST_PORT` overrides the default port (8123) if it's already in use.
