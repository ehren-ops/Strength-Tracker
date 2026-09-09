# Strength Tracker

A phone-first strength training app that logs your lifts, tells you what to do next, and backs everything up to the cloud automatically. It runs as a single web app you install straight to your iPhone home screen, no App Store required, and looks and behaves like any other app on your phone.

It started as a simple lift log, but it's grown into a real coaching and data system: it doesn't just record what you did, it analyzes your training history and tells you what to lift next, when to back off, and how you're trending over time.

## Features

**Structured training programs**
- Full Body, Upper Body, Lower Body, and Extra/Off-Day tabs, each with its own ordered exercise list
- Add custom exercises to any day on the fly

**Adaptive coaching, not just a log**
- Automatically suggests your next session's weight and reps based on your actual training history
- Detects when you're stalled (3+ missed sessions at the same weight) and prescribes a ~15% deload instead of letting you grind
- Reacts to how hard a set felt: an easy top-end effort fast-tracks the next weight increase, a brutally hard one holds you back a session
- "Conservative" vs. "Standard" progression modes per exercise (require two clean sessions before adding weight, or just one)
- Suggested rest times based on your rep range
- Plate-by-plate barbell loading math for every suggested weight
- Estimated 1-rep max (or enter your actual tested max) per lift

**Visual progress tracking**
- Inline trend chart per exercise, color-coded for deloads, missed reps, under-volume sets, and bonus volume, with a projected next session plotted alongside your real history
- Full editable set history: fix a typo, adjust a date, or delete a bad entry after the fact
- "Repeat last time" one-tap logging

**Whole-program analytics**
- Overview dashboard: aggregate % progress across every lift, sets logged, how many lifts are progressing vs. holding vs. declining
- Volume trend charts by training day
- Training calendar: see which day-type you trained on any date this month, tap a day to see exactly what you logged
- Recovery readiness score based on days rested and how hard recent sessions were, with a recommended number of rest days
- Auto-generated "Coach's Notes" summarizing your last session in plain English, including flags for notes like "tender," "sore," or "pain" so nothing gets buried

**Seasonal programming**
- One-tap Ski Season mode shifts target reps and tempo on key lower-body lifts toward strength-endurance, with a visual badge on affected exercises, then switches back just as easily

**Real persistent storage, not just browser memory**
- Every set you log is backed up to a private cloud database (Supabase), tied to your own account, and protected by row-level security so no one else can ever see your data, even though the app itself can be shared as a public link
- Fully offline-first: logging never depends on a connection or being signed in. Anything logged offline queues locally and syncs automatically the moment you're back online, with a live status indicator so you always know what's synced
- Lose your phone, get a new one, or wipe it? Sign back in and every set you ever logged comes right back
- Manual JSON export/import is still built in too, for a portable backup independent of the cloud account

**Installable app experience**
- Add it to your iPhone home screen and it runs full-screen, no browser bar, no App Store, no yearly developer fee

## Getting started

1. Open the app link in Safari and tap **Share → Add to Home Screen**.
2. Go to the **Overview** tab and create an account under **Backup & Restore** to turn on cloud sync (optional, logging works without it).
3. Confirm your email, sign in, and start logging. Everything from here syncs automatically.
