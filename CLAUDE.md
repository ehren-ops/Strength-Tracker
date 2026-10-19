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
- No emoji in the UI, with one exception: the training modifiers keep their emoji (`emoji` in
  `MODE_DEFS`, on their pills and Overview rows). Everything else uses outline icons via `icon(key)`
  (04, `ICON_PATHS`). Scenario 100 checks.
- No disclaimers or safety warnings anywhere ("not a substitute for a PT or doctor", "get it checked",
  "not medical advice"), in the app or the coach prompt. They are clutter; say what to change instead.
- No dangling lines: at 360px, card notes, tips, labels and tile text should not wrap a few words
  onto a line of their own. Tighten the wording, merge related notes onto one line, or drop words
  the context already says (a modifier's name after its pill, "today" under TODAY). Look for orphans
  in the 360px screenshots before shipping.
- Leave destructive Supabase actions (drops, deletes) to the owner.

## Layout
`index.html` loads `styles.css` and classic scripts in order; they share one global scope.

| File | What lives there |
|---|---|
| `js/01-sync.js` | Supabase client, offline op queue (`enqueueOp`/`runOp`/`flushQueue`), row mapping (`entryToRow`/`rowToEntry`), `pullRemoteAndMerge` (paged fetch; newest `updatedAt` wins per entry, pending local ops always win, synced entries missing from the cloud are removed only for the same account) |
| `js/02-program.js` | Program data: `DAY_ORDER`, `EXERCISE_DEFAULTS`, tips, sides, checklists, Extra groups, `RECOVERY`, `APP_VERSION` |
| `js/03-state.js` | Loaded state, `MODE_DEFS` (modifiers synced to `user_settings`), `toggleMode`, deload and rehab date records |
| `js/04-helpers.js` | Dates (`shiftISO`), formatting, plate math, `isLoggedToday`, `skipReason`, workout-complete check |
| `js/05-rest-timer-progression.js` | Rest timer, readiness, progression engine: `computeSuggestion` = core, note target, max weight cap, `applyReturn` (breaks, post-deload), `applyShoulder`, deload overlay |
| `js/05b-shoulder-rehab.js` | Shoulder Rehab modifier: rehab card, paused/held lifts, return ramp, coach block |
| `js/05c-hold-timer.js` | The clock: holds for timed lifts (`unit: "sec"`), set by set for rep lifts, routines (Mobility, Shoulder Rehab groups) from item doses; Pause, Skip, -15/+15 rests, remembered rests (`restPrefs`); fills the form |
| `js/06-day-view.js` | Render: tabs, pill rows, Mobility and checklist cards, the exercise card (`.card-head`: the name row with the clock and its plan text, then a grid pairing today's weight with Last and its label with the record; a modifier's pill leads its own note line, pills with no note sit in a strip; then the Next tile and chart) |
| `js/06b-next-tile.js` | The Next tile's words: `planModifiers`, the call, and the guidance sentence pool |
| `js/06c-history-form.js` | Recent History rows, edit/delete/skip, the log form (per-set reps, joint check) |
| `js/06d-library.js` | Exercise library from the "+" on a day's pill row: every strength lift grouped by movement (`LIFT_PATTERNS`), search, equipment, home day, last done; picks join today's row only (`dayPicks`, this phone), "Keep on this day" makes them stay (`keptLifts`, synced in `user_settings.settings.kept`); never counted toward finishing a day |
| `js/07-charts.js` | SVG chart, `MODIFIER_TAGS` (light = diamond, block = circle), note tag helpers |
| `js/08-calendar-notes.js` | Calendar, `guessDayForNames`, due lifts (`dueLifts`), rule-based Coach's Notes |
| `js/09-coach.js` | AI coach: cached analyses, payloads (`buildSessionCoachPayload`/`buildWeeklyCoachPayload`), trends, heart rate, panels |
| `js/09b-overview.js` | Overview page: deload status and popup, modifier rows, Weekly Balance, % change, backup card |
| `js/09c-muscle-map.js` | Muscle Map card on the Overview: `LIFT_MUSCLES` (main muscles full sets, helpers half), `muscleWeek` (last 7 days), `muscleRecovery` (last 2 days: 5+ sets hard, 2+ recovering), front and back SVG figures (left half drawn once, `mirror`ed), Sets / Recovery toggle, tap a muscle for its lifts plus `MUSCLE_IDEAS` (lifts not in the app, tagged "Not in app") |
| `js/10-interactions.js` | Selecting, adding exercises, `logEntry` |
| `js/11-init.js` | Startup and event wiring |
| `supabase/functions/coach/index.ts` | Edge function: session/weekly AI notes (Claude), `hr` mode, prompts in `PRINCIPLES` |
| `supabase/migrations/` | SQL history; apply new ones with the Supabase MCP `apply_migration` |
| `test/unit.test.js` | Fast Node unit tests: the scripts loaded into a stubbed browser; progression math and helpers |
| `test/app.test.js` | Playwright regression suite against a mocked Supabase (`test/mock-supabase.js`) |

## Patterns to follow
- A new entry field needs: `entryToRow` and `rowToEntry` in 01, a migration adding the column, and
  the mock needs nothing (it is generic).
- A new modifier is one row in `MODE_DEFS` (03): name, emoji, badge, tag (kind light or block),
  `applies` / `changesNumbers` rules and the Overview text, plus a `--<key>` color token in both
  themes and its `.<key>-badge` style; scenario 88 checks the row. No schema change: settings sync
  through `user_settings.settings` (JSON). The old per-mode columns are legacy; leave them be.
  What it actually does to the numbers lives with its own logic (05, 05b, the exercise fields).
- Ski is one setting with two phases (`setSkiPhase`, 03): Preseason and In season are still the
  modes `preseason` and `ski`, never on together; route changes through `setSkiPhase` (or
  `toggleMode`, which calls it). `skiPhase` dates the phase (`preseasonWeek`, the week-3 lifts in
  `activeDayOrder`, `checkSkiPhasePrompt`) and syncs in `user_settings.settings.ski`.
- Programs (`PROGRAMS`, `setProgram`, 03): Classic (`full`/`upper`/`lower`) or Full Body 2+1
  (`a`/`b`/`c`, C optional). Never hardcode day keys: use `programDays()`, `dayGroupKeys()` (08)
  and `tabOrder()` (02). Finishers (`finishersFor`, 02) sit after a day's numbered lifts in the
  core color (`.finisher-pill`), carry a "Finisher" line in the card tips, and never count toward
  completion. `nextProgramDay` picks the day the app opens on. `YEAR_ROUND` / `isYearRound` (02)
  keep some preseason lifts on all year by day (Lateral Lunge on Lower and the 2+1 days).
- Heavy and volume days (03, 05): lifts with `targetRepsStrength` (Squat, Bench, RDL, Row) run
  heavy (`HEAVY_SETS` x 5) or volume (3x8) on both programs. `plannedHeavy(name, ex, date)`:
  Classic = first session of the lift in the Monday week; 2+1 = `HEAVY_DAY` by day. Never heavy
  under a preseason/ski target or Shoulder Rehab hold/pause. `logEntry` stores `entry.heavy`
  (column `heavy`); `isHeavyEntry` reads it (v107 2+1 entries without it count as heavy via
  `programOn`). `computeSuggestion` plans from the matching track only, and `startTrack` converts
  an empty track from the estimated max. Read reps through `effectiveTargetReps` /
  `entryTargetReps`, which know the track. Browser scenarios that test other rules on a main lift
  stub `plannedHeavy = () => false` so they do not depend on the weekday.
- The clock repaints through `paintClock` (05c), which rebuilds its markup only when words or buttons
  change; ticks update just the time and bar. Never set its innerHTML on every tick, or taps on
  Pause, Skip and Done get lost mid-press.
- The clock (05c): one `holdTimer` with `mode` holds / sets / routine and a list of steps (`ready`,
  `hold`, `set` waits for Done, `rest`), all on absolute end times. `timerButtonFor` puts the round
  clock button at the top of the card head's side column (in the title row before any history);
  `routineButton` does the same for checklist cards and each rehab group. A rest changed with
  -15/+15 or the Min / Max buttons (`restRangeFor`: 90, 60 or the lift's own shorter rest, up to
  3:00) is saved per lift in `restPrefs` and synced in `user_settings.settings.rest`; the clock
  always starts on the rest set last. Set by set, each rest is a range: it counts down to that rest,
  then an `extra` step ("Ready") counts up to the max before the next set starts on its own. Routine
  doses are parsed by `parseDose`; keep new checklist doses in the same shapes ("45 sec each side",
  "10 reps", "3 × 12-15, 3-5 lb").
- The program switch keeps the same safety net as Ski: `userSetProgram` offers Undo, switching back
  within `PROGRAM_RESUME_DAYS` restores the old start (dropping an empty stint), and `repairProgram`
  clears same-day stints so Classic with no real 2+1 stint counts from the first logged session.
- Modifier note lines: one line per modifier (its pill, then its notes run together), and the text
  never repeats the modifier's name ("Tempo: 4 sec lowering, 5 reps.", not "Preseason tempo: ...").
- A lift added from the library (`addedLifts(day)`) sits after the day's numbered lifts and custom
  exercises, before the finishers: dashed for today only, solid once kept. Its card says so in the
  tips (`addedLiftTip`). New lifts for the library want a `LIFT_PATTERNS` group (09) and a
  `LIBRARY_EQUIPMENT` line (06d). On Extra the "+" still adds a custom exercise by name.
- A new lift wants a `LIFT_MUSCLES` row (09c) too, or the Muscle Map leaves it out (it also drops off
  `MUSCLE_IDEAS` by itself once the app has it). Shading is by
  class (`mm-b0`..`mm-b4`, `mm-hard` / `mm-recovering` / `mm-ready`) on `--mm-*` tokens in both themes.
- Things that are not lift sessions (checklists, `RECOVERY`, `REHAB_NAME`) stay out of session
  counting: check `isRecovery` / `trackBy === "checklist"` where entries are iterated.
- Accessory rep ranges: `repRange: "10-15"` in `EXERCISE_DEFAULTS` (02) turns on double
  progression: weight goes up once every set reaches the top, or a session reaches the middle at
  RPE 7 or easier (`rangeEarly`); until then +2 reps after RPE 7 or easier, +1 at 8, none at 9+. A
  typical set (median of `repsBySet`) 3+ reps under the bottom refits the weight from the estimated
  max (`refit`). Read targets through `effectiveTargetReps` / `activeRepRange` (03), never
  `ex.targetReps` directly.
- Weight should move, not just reps. Only pain words hold a lift that hit its reps
  (`noteConcernWord`, 05; "no pain" doesn't count; "heavy" and "grip" never hold). Knee/Back Care
  trims once to about 90% of the 6-week peak and then holds, never compounding. A Deload Week
  session done heavier than the regular one before it counts as the baseline.
- Shoulder Rehab held lifts (`applyShoulder`, 05b): the first session under rehab starts at
  `SHOULDER_HOLD_PCT` of the pre-rehab weight; after that the load follows the log (never below a
  weight that is holding) and two clean sessions in a row (reps hit, RPE 8 or less, pain 3 or less)
  add one `increment`, up to the pre-rehab weight. Reps stay at the target.
- Joint check: `pain` (0-10) and `painArea` on an entry. `applyPain` (05) holds the load above 3
  and drops about 10% at 6+; `painSignals` (08) nudges the matching care modifier. Rep records
  come from `prFlags` / `repRecord` (04); only `COMPOUND_LIFTS` (02) show Est. 1RM.
- The coach system prompt is cached (5 minutes). Keep anything that changes per call out of
  `PRINCIPLES` and the mode prompts, or every call pays the cache write for nothing.
- Render is a full `innerHTML` rebuild on every change; keep helpers pure and cheap.
- View transitions (`navTransition(kind, dir, update)`, 06): tab switches (`switchView`), lift picks
  (`selectExercise`) and Extra group chips change state first, then repaint inside
  `document.startViewTransition`, so the DOM updates a frame later. Animate new navigation through it
  rather than CSS on rebuilt elements. Each `view-transition-name` must be unique on the page (a
  duplicate skips the animation): names are set only under `html[data-vt]`. Off for reduced motion
  and test browsers (`viewTransitions`, false under `navigator.webdriver`); scenario 105 turns it on.

## Commands
- Tests: `cd test && npm install` once (with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`), then
  `PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium npm test`: unit tests first (`npm run unit`,
  under a second), then the browser suite. Prints `UNIT TESTS PASSED` and `ALL SCENARIOS PASSED`.
  Add a unit test for any new progression rule; use the browser suite for UI and sync. Unit tests
  pin main lifts to a volume day (`reset` stubs `plannedHeavy`); heavy-day tests call `heavyDays()`.
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
