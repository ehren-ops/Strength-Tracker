# Strength Tracker: working notes for Claude

Phone-first PWA strength log for one athlete. Plain HTML/CSS/JS, no build step, served by GitHub
Pages from `main`. Supabase project `eixbpujqsectkstkqllz` holds the data and the `coach` edge
function. The Outlive app (`szsgxlbvleviuzobhuty`) hosts `strava-hr` (wearable heart rate).

## House rules (the owner's)
- Never use em dashes anywhere: UI copy, comments, commits, replies. Use commas, colons, periods.
- Answer questions without changing code; build only when asked. Ask before outward-facing changes.
- Every release bumps the version (see Releasing), passes the full suite, and gets a 360px
  screenshot check (light and dark) before pushing to `main`.
- Weights are "lb" everywhere (never "lbs"). Short, plain coaching language.
- Leave destructive Supabase actions (drops, deletes) to the owner.

## Layout
`index.html` loads `styles.css` and classic scripts in order; they share one global scope.

| File | What lives there |
|---|---|
| `js/01-sync.js` | Supabase client, offline op queue (`enqueueOp`/`runOp`/`flushQueue`), row mapping (`entryToRow`/`rowToEntry`), `pullRemoteAndMerge` (local wins, remote only adds) |
| `js/02-program.js` | Program data: `DAY_ORDER`, `EXERCISE_DEFAULTS`, tips, sides, checklists, Extra groups, `RECOVERY`, `APP_VERSION` |
| `js/03-state.js` | Loaded state, `MODE_DEFS` (modifiers synced to `user_settings`), `toggleMode`, deload and rehab date records |
| `js/04-helpers.js` | Dates, formatting, plate math, `isLoggedToday`, `skipReason`, workout-complete check |
| `js/05-rest-timer-progression.js` | Rest timer, readiness, progression engine: `computeSuggestion` = core, note target, max weight cap, `applyReturn` (breaks, post-deload), `applyShoulder`, deload overlay |
| `js/05b-shoulder-rehab.js` | Shoulder Rehab modifier: rehab card, paused/held lifts, return ramp, coach block |
| `js/06-day-view.js` | Render: tabs, pill rows, exercise card, Next tile, history, log form, Mobility card |
| `js/07-charts.js` | SVG chart, `MODIFIER_TAGS` (light = diamond, block = circle), note tag helpers |
| `js/08-calendar-notes.js` | Calendar, `guessDayForNames`, due lifts (`dueLifts`), rule-based Coach's Notes |
| `js/09-coach-overview.js` | AI coach payloads and panels, heart rate, Overview page, modifier rows, % change |
| `js/10-interactions.js` | Selecting, adding exercises, `logEntry` |
| `js/11-init.js` | Startup and event wiring |
| `supabase/functions/coach/index.ts` | Edge function: session/weekly AI notes (Claude), `hr` mode, prompts in `PRINCIPLES` |
| `supabase/migrations/` | SQL history; apply new ones with the Supabase MCP `apply_migration` |
| `test/app.test.js` | Playwright regression suite against a mocked Supabase (`test/mock-supabase.js`) |

## Patterns to follow
- A new entry field needs: `entryToRow` and `rowToEntry` in 01, a migration adding the column, and
  the mock needs nothing (it is generic).
- A new modifier touches: `MODE_DEFS` (03) plus a `user_settings` column, badge and care line in
  `renderExerciseCard` (06), `planModifiers` (06), `activeModifierTags` and `MODIFIER_TAGS` (07,
  pick kind light or block), an Overview row (09), CSS color tokens (light and dark).
- Things that are not lift sessions (checklists, `RECOVERY`, `REHAB_NAME`) stay out of session
  counting: check `isRecovery` / `trackBy === "checklist"` where entries are iterated.
- Accessory rep ranges: `repRange: "10-15"` in `EXERCISE_DEFAULTS` (02) turns on double
  progression (add a rep, add weight once every set reaches the top). Read targets through
  `effectiveTargetReps` / `activeRepRange` (03), never `ex.targetReps` directly.
- Render is a full `innerHTML` rebuild on every change; keep helpers pure and cheap.

## Commands
- Tests: `cd test && npm install` once (with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`), then
  `PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium npm test`. Prints `ALL SCENARIOS PASSED`.
  Scenarios share one page, so save and restore any global state a scenario changes.
- Local server for screenshots: `cd test && TEST_PORT=8133 node server.js`, then Playwright at
  `viewport {width:360}` with the Supabase script routed to `test/mock-supabase.js`.

## Releasing
1. Bump `APP_VERSION` in `js/02-program.js` and every `?v=NN` in `index.html` (they must match;
   scenario 75 checks). Example: `sed -i 's/?v=93/?v=94/g' index.html`.
2. Run the suite, screenshot at 360px.
3. Commit on a `claude/<topic>` branch, fast-forward `main`, `git push origin main`. If the push is
   rejected, another session pushed: fetch, rebase, re-run tests.
4. The coach function deploys itself from `main` via `.github/workflows/deploy-coach.yml` when
   `supabase/functions/**` changes (needs the `SUPABASE_ACCESS_TOKEN` repo secret). Without the
   secret, deploy with the Supabase MCP `deploy_edge_function` (`verify_jwt: false`).
