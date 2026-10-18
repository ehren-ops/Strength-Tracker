# Strength Tracker

A strength log that thinks. You lift, it keeps score, and then it tells you what to put on the bar next time.

It lives on your phone like an app, keeps logging even when the gym has no signal, and syncs to the cloud when you are back online. No subscription, no ads, no social feed. It was built for one athlete and shaped by real training, which is why the details are fussy in a good way.

## The pitch

**It does the math you used to do in your head.**
Log your sets and it works out your next weight. Hit your reps, it moves up. Miss a few sessions in a row, it backs off about 15% and rebuilds. Take a week off, it eases you back in instead of letting you load a bar like nothing happened.

**It knows what "heavy day" means.**
Main lifts alternate between heavy (4 sets of 5) and volume (3 sets of 8) automatically. You never have to remember which one today is.

**It has a rest clock that runs the set for you.**
Tap the little clock on a lift and it walks you through set, rest, set, rest. Hold the rest you like and it remembers it for next time. Adjust it mid-workout with a tap. Mobility and rehab routines get the same treatment, one move at a time.

**It protects you from yourself.**
Flip on a care mode (shoulder, knee, back) and the plan quietly changes: some lifts pause, some hold, loads cap, and a return ramp brings things back. Log a joint twinge and the next weight holds or drops. Planning a deload week is one switch.

**It shows you your body, not just your numbers.**
A front and back muscle map lights up by how many sets each muscle got this week. Flip to Recovery and it shows what is fresh and what needs another day.

**It talks back (in a useful way).**
An AI coach reads your session and your week and gives short, specific notes. No "listen to your body" filler, no disclaimers, just what to change.

**It feels good to use.**
Light and dark themes (the dark one is neon), smooth slide transitions between days and lifts, a confetti moment when you finish a workout, and everything built to be thumbed one-handed at 360 pixels wide.

## Features

### Logging
- Log weight, sets and reps per lift, plus effort (RPE) and a note
- Per-set reps when your sets do not match
- Timed lifts (holds, carries) logged in seconds
- Joint check on any lift: rate pain 0 to 10 and pick the area
- Skip a lift for a reason (injury, equipment, time, other) so the plan stays honest
- Edit or delete any past entry, and change an entry's date
- "Repeat last time" for one-tap logging
- Recent History under every lift
- Records, plus an estimated 1-rep max on the big lifts (or enter your actual tested max)
- Plate-by-plate barbell math for every suggested weight

### The plan
- Two programs: Classic split (Full Body, Upper, Lower) or Full Body 2+1 (A and B, plus an optional C)
- Heavy and volume days handled for you
- Short core and grip finishers at the end of each day
- Smart suggestions for every lift: add weight, hold, or deload
- Reacts to how hard a set felt: an easy top-end effort fast-tracks the next increase, a brutal one holds you back a session
- Conservative or Standard progression per lift (two clean sessions before adding weight, or just one)
- Double progression on accessories (add a rep, then add weight once every set tops the range)
- Suggested rest times based on your rep range
- A "due" marker on lifts you have skipped too often
- Opens on the day it thinks you are doing next

### The clock
- Holds for timed lifts, set-by-set for rep lifts, step-by-step for routines
- Pause, skip, plus 15 and minus 15 seconds, and Min and Max rest buttons
- Remembers the rest you set for each lift
- Rest ranges that count down, then count up to your max
- Mobility and rehab routines play through from their doses

### Modifiers (training modes you can switch on)
- Deload Week: lighter loads, planned and ended on a schedule, with an end-of-week prompt
- Shoulder Rehab: a daily rehab card, paused and held lifts, and a return ramp
- Knee Care and Low Back Care: adjusted loads and bridge exercises
- Preseason Prep and Ski Season: tempo work and sport-specific targets, with date-aware phases
- Undo on every switch, so an accidental tap never wrecks your history
- Editable start dates, and flip-back restore if you toggle by mistake

### The exercise library
- Tap the plus on any day to browse every strength lift, grouped by movement
- Search, see the equipment, home day and when you last did it
- Add a lift for today only, or keep it on that day for good
- Add your own custom exercises

### Overview and insights
- An inline trend chart per lift, color-coded for deloads, missed reps, under-volume and bonus volume, with your projected next session plotted alongside your history
- Calendar of your training days, with what you logged on any date
- Coach's Notes: quick rule-based observations from your log, including flags for notes like "tender" or "sore"
- Aggregate progress and percent change over any range (2 weeks to all time)
- Volume trends by training day
- Weekly Balance: pulling versus pressing, and sets per movement pattern
- Recovery readiness score from days rested and how hard recent sessions were
- Muscle Map: sets per muscle and recovery, front and back, tap any muscle for its lifts
- Optional heart rate per lift from a connected wearable
- Backup and restore, with a manual JSON export and import that works independently of the cloud account

### The AI coach
- A session note after you train and a weekly read of your week, powered by Claude
- Knows your recent history, trends, deload status, modifiers and heart rate
- Short, specific, no filler. Results are cached and synced, never re-run automatically

### Sync, safety and reach
- Logging never needs a connection: changes queue up and sync when you reconnect, with a live status indicator so you always know what is synced
- Cloud sync across devices, with the newest change winning and your pending edits always protected
- Lose your phone or wipe it? Sign back in and every set you ever logged comes right back
- Add it to your iPhone home screen and it runs full screen, no browser bar, no App Store, no yearly developer fee
- Private to you: every account is protected by row-level security, so no one else can see your data even though the app itself is a public link

### Look and feel
- Light theme and a neon dark theme
- Outline icons throughout, with emoji reserved for the training modifiers
- Slide transitions between days and lifts, using the browser's native view transitions
- Confetti celebration when you finish a workout
- Phone-first layouts checked at 360 pixels wide in both themes

## How it got here

The major pieces, oldest first.

1. Cloud sync with offline-first queueing and last-write-wins merging
2. Unit tests for the progression math, and a full browser regression suite
3. Modifiers stored as a single synced settings record
4. New day lists and the Weekly Balance redesign
5. Ski Season with Off, Preseason and In Season phases
6. Distance, time and speed auto-fill, plus a rowing card
7. Programs: Classic and Full Body 2+1
8. 4x5 main lifts, starting weights and rest ranges
9. Heavy and volume tracks, Classic upgrades and finisher styling
10. Timer round 1: pause, skip, plus and minus 15, underline, remembered rest
11. Timer round 2: set-by-set mode and the top-right start button
12. Timer round 3: Mobility and Shoulder Rehab routine players
13. Tap-reliability fix for the clock, outline icons, a rebuilt card header, modifier pills on their own notes, and a live plan indicator
14. Ski date repair, Undo on every mode switch, flip-back restore and editable dates
15. No disclaimers anywhere, in the app or the coach prompt
16. Exercise library behind the plus button, with modifier emoji kept
17. Program-switch safety net: repair, flip-back and Undo
18. Modifier notes without repeating the modifier's name, one clean line each
19. View transitions: tabs and lifts slide, highlights glide
20. Muscle Map on the Overview: sets and recovery, front and back

## Getting started

1. Open the app link in Safari and tap **Share → Add to Home Screen**.
2. Go to the **Overview** tab and create an account under **Backup & Restore** to turn on cloud sync (optional, logging works without it).
3. Confirm your email, sign in, and start logging. Everything from here syncs automatically.

## Under the hood

- Plain HTML, CSS and JavaScript. No framework, no build step, no bundler.
- Hosted as static files on GitHub Pages
- Supabase for the database, sign-in and an edge function that talks to the AI coach
- Home-screen web app with an offline queue, so logging works without a connection once the app is open
- Tested by a fast Node unit suite and a Playwright browser suite against a mocked backend

## Code layout

No build step. GitHub Pages serves the repo as-is.

- `index.html`: markup only. Loads `styles.css` and the scripts in `js/`.
- `styles.css`: theme tokens (light, then dark) and components.
- `js/01-sync.js` to `js/11-init.js`: ordered classic scripts sharing one global scope. Each file
  opens with a line saying what it holds. A file can only call functions from later files
  inside handlers, never at load. Event wiring and the first render live in `js/11-init.js`.
- `supabase/`: the `coach` edge function and database migrations.
- `test/`: the unit tests and the Playwright regression suite (`cd test && npm test`).

**Releasing:** bump `APP_VERSION` in `js/02-program.js` and the `?v=` on every file in
`index.html` to the same number. Pages caches files for 10 minutes, and the shared version keeps a
phone from mixing new and old scripts. The test suite fails if they don't match.
