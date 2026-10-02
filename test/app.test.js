const { chromium } = require('playwright');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

const PORT = Number(process.env.TEST_PORT) || 8123;
const URL = `http://localhost:${PORT}/`;
const EMAIL = 'testuser@example.com';
const PASSWORD = 'hunter2pass';

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

async function waitForText(page, selector, predicate, timeoutMs=15000, label=''){
  const start = Date.now();
  while(Date.now() - start < timeoutMs){
    const txt = await page.textContent(selector).catch(() => null);
    if(txt !== null && predicate(txt)) return txt;
    await sleep(150);
  }
  throw new Error(`[${label}] Timed out waiting for ${selector}. Last seen: ${await page.textContent(selector).catch(()=>'<err>')}`);
}

// Polls the static server started by run() below until it actually answers,
// rather than a fixed sleep - startup time varies enough between a local
// machine and a CI runner that a guessed delay would be flaky either way.
function waitForServer(url, timeoutMs = 10000){
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function attempt(){
      http.get(url, res => { res.resume(); resolve(); })
        .on('error', () => {
          if(Date.now() - start > timeoutMs) return reject(new Error('test server did not start in time'));
          setTimeout(attempt, 150);
        });
    })();
  });
}

async function main(){
  // No executablePath here on purpose: `npx playwright install chromium`
  // (see package.json / CI workflow) puts the matching browser wherever
  // Playwright expects it, so this launches unmodified both locally and in
  // CI. Set PLAYWRIGHT_CHROMIUM_PATH to override for a one-off environment
  // (e.g. a sandbox with a pre-baked browser at a nonstandard path) without
  // needing to edit this file.
  const launchOpts = { headless: true };
  if(process.env.PLAYWRIGHT_CHROMIUM_PATH) launchOpts.executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  const browser = await chromium.launch(launchOpts);
  const context = await browser.newContext();
  await context.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js', route =>
    route.fulfill({ path: path.join(__dirname, 'mock-supabase.js'), contentType: 'application/javascript' })
  );
  await context.route('https://fonts.googleapis.com/**', route => route.abort());
  // The real coach edge function costs real money and needs a live
  // Anthropic key, neither of which belong in a test run - mocked here so
  // scenarios 59-63 can verify the button/cache/collapse behavior without
  // ever making a real call. aiBreakdownCallCount lets them assert it's
  // called exactly once per explicit click, never automatically.
  let aiBreakdownCallCount = 0;
  const coachRequests = [];
  await context.route('**/functions/v1/coach', route => {
    // Mirrors the real function: no signed-in session, no call.
    if(!/^Bearer \S+/.test(route.request().headers()['authorization'] || '')){
      return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'not_signed_in' }) });
    }
    aiBreakdownCallCount++;
    const req = route.request().postDataJSON();
    coachRequests.push(req);
    const breakdown = req.mode === 'weekly'
      ? { verdict: 'Mock weekly verdict.', sections: [
          { title: 'Training', items: ['Mock weekly training item.'] },
          { title: 'Next week', items: ['Mock next-week item.'] },
        ] }
      : { verdict: 'Mock breakdown headline for test verification.', sections: [
          { title: 'Recovery context', items: ['Mock recovery item.'] },
          { title: 'How to improve next session', items: ['Mock improve item.'] },
          { title: 'Be mindful of', items: ['Mock mindful item.'] },
        ] };
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ breakdown, generatedAt: new Date().toISOString(), context: 'signed_out' }),
    });
  });
  const page = await context.newPage();
  // Any uncaught page error fails the run at the end. The app is split across ordered classic
  // scripts, so a load-order mistake (a file calling a function from a later file at load) shows
  // up here first.
  const pageErrors = [];
  page.on('pageerror', err => { pageErrors.push(err.message); console.log('[pageerror]', err.message); });
  const failedLoads = [];
  page.on('response', r => { if(r.url().startsWith(URL) && r.status() >= 400) failedLoads.push(r.status() + ' ' + r.url()); });

  console.log('=== 1: fresh load, no sign-in yet ===');
  await page.goto(URL);
  await waitForText(page, '#sync-status', t => t.includes('Not signed in'), 5000, 'initial load');
  console.log('OK: renders with "Not signed in" and no crash when Supabase is unauthenticated');

  console.log('=== 2: log an entry fully offline / pre-auth ===');
  await page.click('text=Full Body');
  await page.fill('#f-weight', '135');
  await page.fill('#f-sets', '3');
  await page.fill('#f-reps', '8');
  await page.click('button.log:has-text("Log set")');
  await sleep(300);
  const preAuthStatus = await page.textContent('#sync-status');
  if(!preAuthStatus.includes('Not signed in')) throw new Error('expected still "Not signed in" pre-auth, got: ' + preAuthStatus);
  const preAuthLocal = await page.evaluate(() => JSON.parse(localStorage.getItem('strength-tracker-v1')).Squat.entries.length);
  if(preAuthLocal !== 1) throw new Error('expected 1 local entry pre-auth, got ' + preAuthLocal);
  const preAuthQueueLen = await page.evaluate(() => JSON.parse(localStorage.getItem('strength-tracker-pending-ops-v1')).length);
  console.log('OK: logged locally pre-auth, queue has', preAuthQueueLen, 'op(s) waiting');
  if(preAuthQueueLen < 1) throw new Error('expected queued op(s) even though unauthenticated');

  console.log('=== 3: sign up, verify pre-existing local data reconciles to the cloud ===');
  await page.click('text=Overview');
  await page.fill('#auth-email', EMAIL);
  await page.fill('#auth-password', PASSWORD);
  await page.click('button:has-text("Create Account")');
  await waitForText(page, '#sync-status', t => t.includes('Synced'), 10000, 'post-signup sync');
  const mockRowsAfterSignup = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__mock_supabase_db__')));
  console.log('OK: mock cloud now has', mockRowsAfterSignup.exercises.length, 'exercise(s) and', mockRowsAfterSignup.entries.length, 'entr(y/ies)');
  if(mockRowsAfterSignup.entries.length !== 1) throw new Error('expected the pre-auth entry to have synced up, got ' + mockRowsAfterSignup.entries.length);
  if(mockRowsAfterSignup.exercises.length !== 1) throw new Error('expected the Squat exercise to have synced up');

  console.log('=== 4: log a second entry while online (signed in) ===');
  await page.click('text=Full Body');
  await page.fill('#f-weight', '140');
  await page.fill('#f-sets', '3');
  await page.fill('#f-reps', '8');
  await page.click('button.log:has-text("Log set")');
  await waitForText(page, '#sync-status', t => t.includes('Synced'), 10000, 'second entry sync');
  const afterSecond = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__mock_supabase_db__')).entries.length);
  if(afterSecond !== 2) throw new Error('expected 2 synced entries, got ' + afterSecond);
  console.log('OK: second online entry synced immediately');

  console.log('=== 5: go offline, log a third entry, verify it queues instead of syncing ===');
  await context.setOffline(true);
  await page.fill('#f-weight', '145');
  await page.fill('#f-sets', '3');
  await page.fill('#f-reps', '8');
  await page.click('button.log:has-text("Log set")');
  await sleep(300);
  const offlineStatus = await page.textContent('#sync-status');
  if(!offlineStatus.includes('Offline') || !offlineStatus.includes('pending')) throw new Error('expected "Offline - N pending", got: ' + offlineStatus);
  const localWhileOffline = await page.evaluate(() => JSON.parse(localStorage.getItem('strength-tracker-v1')).Squat.entries.length);
  if(localWhileOffline !== 3) throw new Error('expected 3 local entries while offline, got ' + localWhileOffline);
  const cloudWhileOffline = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__mock_supabase_db__')).entries.length);
  if(cloudWhileOffline !== 2) throw new Error('expected cloud to still have only 2 entries while offline, got ' + cloudWhileOffline);
  console.log('OK: third entry logged locally, held in queue, NOT pushed while offline. Status:', offlineStatus);

  console.log('=== 6: reconnect, verify the queued entry flushes ===');
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await waitForText(page, '#sync-status', t => t.includes('Synced'), 10000, 'reconnect flush');
  const cloudAfterReconnect = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__mock_supabase_db__')).entries.length);
  if(cloudAfterReconnect !== 3) throw new Error('expected 3 synced entries after reconnect, got ' + cloudAfterReconnect);
  console.log('OK: reconnect flushed the queued entry, cloud now has 3');

  console.log('=== 7: simulate a lost/reset phone: wipe localStorage (NOT sessionStorage), reload, sign back in ===');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await waitForText(page, '#sync-status', t => t.includes('Not signed in'), 5000, 'after wipe reload');
  // Opening the Full Body tab lazily creates an empty Squat shell (existing app
  // behavior) even with no saved data, so check for zero entries, not a null key.
  const localAfterWipe = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('strength-tracker-v1') || '{}');
    return d.Squat ? d.Squat.entries.length : 0;
  });
  if(localAfterWipe !== 0) throw new Error('expected zero local entries after wipe, got ' + localAfterWipe);
  await page.click('text=Overview');
  await page.fill('#auth-email', EMAIL);
  await page.fill('#auth-password', PASSWORD);
  await page.click('button:has-text("Sign In")');
  await waitForText(page, '#sync-status', t => t.includes('Synced'), 10000, 'post-restore sync');
  await page.click('text=Full Body');
  const restoredEntries = await page.evaluate(() => JSON.parse(localStorage.getItem('strength-tracker-v1')).Squat.entries.length);
  if(restoredEntries !== 3) throw new Error('expected all 3 entries restored from the cloud after wipe, got ' + restoredEntries);
  const bigVal = await page.textContent('.big-val');
  console.log('OK: all 3 entries restored onto a "new phone" purely from the cloud. Latest shown:', bigVal);

  console.log('=== 8: restoring an old JSON backup while signed in also pushes it to the cloud ===');
  await page.click('text=Overview');
  const importResult = await page.evaluate(async () => {
    const backupPayload = { exportedAt: new Date().toISOString(), data: {
      "Bench Press": { trackBy: "weight", entries: [
        { clientId: "backup-entry-1", label: "S1", date: "2026-01-01", confirmed: true, weight: 95, sets: 3, reps: 8, note: "" }
      ]}
    }};
    const blob = new Blob([JSON.stringify(backupPayload)], { type: "application/json" });
    const file = new File([blob], "backup.json", { type: "application/json" });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.getElementById("restore-input");
    input.files = dt.files;
    const evt = new Event("change", { bubbles: true });
    input.dispatchEvent(evt);
    await new Promise(r => setTimeout(r, 400));
    return document.getElementById("card-status").textContent;
  });
  console.log('restore status message:', importResult);
  await waitForText(page, '#sync-status', t => t.includes('Synced'), 10000, 'post-backup-restore sync');
  const cloudExercisesAfterImport = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__mock_supabase_db__')).exercises.map(e => e.name));
  if(!cloudExercisesAfterImport.includes('Bench Press')) throw new Error('expected imported Bench Press exercise to have synced to the cloud, got: ' + JSON.stringify(cloudExercisesAfterImport));
  console.log('OK: JSON backup restore also reconciled to the cloud. Cloud exercises now:', cloudExercisesAfterImport);

  console.log('=== 9: editing a set shows and saves the RPE field, and the edit syncs ===');
  // Step 8's JSON restore wholesale-replaced local data (existing app behavior),
  // leaving only "Bench Press" with one entry, so target that exercise here.
  await page.click('text=Full Body');
  await page.click('.pill:has-text("Bench Press")');
  await page.click('.icon-btn[aria-label="Edit"] >> nth=0');
  const rpeFieldVisible = await page.locator('#edit-difficulty').count();
  if(rpeFieldVisible !== 1) throw new Error('expected an RPE field in the edit box, found ' + rpeFieldVisible);
  await page.fill('#edit-difficulty', '9');
  await page.click('button.save-btn:has-text("Save")');
  await waitForText(page, '#sync-status', t => t.includes('Synced'), 10000, 'post-edit sync');
  const savedDifficulty = await page.evaluate(() => {
    const bp = JSON.parse(localStorage.getItem('strength-tracker-v1'))["Bench Press"];
    return bp.entries[bp.entries.length - 1].difficulty;
  });
  if(savedDifficulty !== 9) throw new Error('expected edited RPE of 9 to be saved locally, got ' + savedDifficulty);
  const cloudDifficulty = await page.evaluate(() => {
    const db = JSON.parse(sessionStorage.getItem('__mock_supabase_db__'));
    const row = db.entries.find(e => e.weight === 95);
    return row && row.difficulty;
  });
  if(cloudDifficulty !== 9) throw new Error('expected edited RPE to have synced to the cloud, got ' + cloudDifficulty);
  console.log('OK: RPE field appears in edit box, saves locally, and syncs to the cloud');

  console.log('=== 10: RPE labels replaced "Difficulty" throughout the visible UI ===');
  const bodyText = await page.evaluate(() => document.body.innerText);
  if(bodyText.includes('Difficulty') || bodyText.includes('Diff.')) throw new Error('found leftover "Difficulty"/"Diff." label in the UI');
  if(!bodyText.includes('RPE')) throw new Error('expected "RPE" label to appear in the UI');
  console.log('OK: no leftover "Difficulty" labels, RPE appears instead');

  console.log('=== 11: last-synced timestamp appears on the Backup & Restore card ===');
  await page.click('text=Overview');
  const syncedLine = await page.evaluate(() => {
    const paras = Array.from(document.querySelectorAll('.card p'));
    const p = paras.find(el => el.textContent.includes('Last synced:'));
    return p && p.textContent;
  });
  if(!syncedLine) throw new Error('expected a "Last synced:" line on the Backup & Restore card');
  if(syncedLine.includes('never yet')) throw new Error('expected a real timestamp, got: ' + syncedLine);
  console.log('OK:', syncedLine);

  console.log('=== 12: a concerning note on the prior session holds back progression, even if reps/RPE alone would advance ===');
  await page.click('text=Full Body');
  await page.click('.pill:has-text("Squat")');
  // Step 8's JSON restore wiped local Squat history, so this is a fresh start:
  // two clean hits at the same weight qualify for progression on reps/RPE alone;
  // flag the second one with a concerning note and confirm that holds it back anyway.
  await page.fill('#f-weight', '150');
  await page.fill('#f-sets', '3');
  await page.fill('#f-reps', '8');
  await page.fill('#f-difficulty', '6');
  await page.click('button.log:has-text("Log set")');
  await page.fill('#f-weight', '150');
  await page.fill('#f-sets', '3');
  await page.fill('#f-reps', '8');
  await page.fill('#f-difficulty', '6');
  await page.fill('#f-note', 'left knee tender on the way up');
  await page.click('button.log:has-text("Log set")');
  const recBox = await page.textContent('.rec-box');
  console.log('recommendation shown:', recBox.replace(/\s+/g, ' ').trim());
  if(!recBox.toLowerCase().includes('tender')) throw new Error('expected the concerning note to be surfaced in the recommendation, got: ' + recBox);
  const nextWeightMatch = recBox.match(/Next:\s*(\d+)\s*lbs/);
  if(!nextWeightMatch || Number(nextWeightMatch[1]) !== 150) throw new Error('expected next weight to hold at 150 despite two clean hits, got: ' + (nextWeightMatch && nextWeightMatch[1]));
  console.log('OK: progression held at 150 lbs and the note was surfaced, instead of blindly advancing on reps/RPE alone');

  console.log('=== 13: Extra day cardio exercises log time/distance/incline instead of weight/sets/reps ===');
  await page.click('.tab:has-text("Extra")');
  await page.click('.pill:has-text("Zone 2 Ride")');
  const rideFields = {
    weight: await page.locator('#f-weight').count(),
    sets: await page.locator('#f-sets').count(),
    minutes: await page.locator('#f-minutes').count(),
    distance: await page.locator('#f-distance').count(),
    incline: await page.locator('#f-incline').count(),
  };
  if(rideFields.weight !== 0 || rideFields.sets !== 0) throw new Error('Zone 2 Ride still shows weight/sets fields: ' + JSON.stringify(rideFields));
  if(rideFields.minutes !== 1 || rideFields.distance !== 1) throw new Error('Zone 2 Ride missing minutes/distance fields: ' + JSON.stringify(rideFields));
  if(rideFields.incline !== 0) throw new Error('Zone 2 Ride should not show an incline field: ' + JSON.stringify(rideFields));
  await page.fill('#f-minutes', '45');
  await page.fill('#f-distance', '12.5');
  await page.click('button.log:has-text("Log set")');
  await waitForText(page, '#sync-status', t => t.includes('Synced'), 10000, 'zone2 ride sync');
  const rideEntry = await page.evaluate(() => {
    const ex = JSON.parse(localStorage.getItem('strength-tracker-v1'))["Zone 2 Ride"];
    return ex.entries[ex.entries.length - 1];
  });
  if(rideEntry.minutes !== 45 || rideEntry.distance !== 12.5) throw new Error('Zone 2 Ride entry did not save minutes/distance correctly: ' + JSON.stringify(rideEntry));
  console.log('OK: Zone 2 Ride logs minutes + distance, no weight/sets/reps, no incline');

  await page.click('.pill:has-text("Incline Treadmill Walk")');
  const walkFields = {
    weight: await page.locator('#f-weight').count(),
    minutes: await page.locator('#f-minutes').count(),
    distance: await page.locator('#f-distance').count(),
    incline: await page.locator('#f-incline').count(),
  };
  if(walkFields.weight !== 0) throw new Error('Incline Treadmill Walk still shows a weight field: ' + JSON.stringify(walkFields));
  if(walkFields.minutes !== 1 || walkFields.distance !== 1 || walkFields.incline !== 1) throw new Error('Incline Treadmill Walk missing a cardio field: ' + JSON.stringify(walkFields));
  await page.fill('#f-minutes', '30');
  await page.fill('#f-distance', '1.8');
  await page.fill('#f-incline', '8');
  await page.click('button.log:has-text("Log set")');
  await waitForText(page, '#sync-status', t => t.includes('Synced'), 10000, 'incline walk sync');
  const walkEntry = await page.evaluate(() => {
    const ex = JSON.parse(localStorage.getItem('strength-tracker-v1'))["Incline Treadmill Walk"];
    return ex.entries[ex.entries.length - 1];
  });
  if(walkEntry.minutes !== 30 || walkEntry.distance !== 1.8 || walkEntry.incline !== 8) throw new Error('Incline Treadmill Walk entry did not save correctly: ' + JSON.stringify(walkEntry));
  const historyText = await page.locator('.hist-row.latest .exact').first().textContent();
  if(!historyText.includes('30 min') || !historyText.includes('1.8 mi') || !historyText.includes('8% incline')) throw new Error('history row does not display time/distance/incline correctly: ' + historyText);
  console.log('OK: Incline Treadmill Walk logs minutes + distance + incline, displays correctly:', historyText);

  const cloudCardioRows = await page.evaluate(() => {
    const db = JSON.parse(sessionStorage.getItem('__mock_supabase_db__'));
    const walkEx = db.exercises.find(e => e.name === 'Incline Treadmill Walk');
    const walkRow = db.entries.find(e => e.exercise_id === walkEx.id);
    return { trackBy: walkEx.track_by, trackDistance: walkEx.track_distance, trackIncline: walkEx.track_incline, distance: walkRow.distance, incline: walkRow.incline };
  });
  if(cloudCardioRows.trackBy !== 'duration' || !cloudCardioRows.trackDistance || !cloudCardioRows.trackIncline) throw new Error('cloud exercise row missing cardio flags: ' + JSON.stringify(cloudCardioRows));
  if(cloudCardioRows.distance !== 1.8 || cloudCardioRows.incline !== 8) throw new Error('cloud entry row missing distance/incline: ' + JSON.stringify(cloudCardioRows));
  console.log('OK: cardio tracking flags and distance/incline values synced to the cloud correctly');

  console.log('=== 14: ski season mode shows the badge/tempo line on ski-enabled exercises ===');
  await page.click('.tab:has-text("Full Body")');
  await page.click('.pill:has-text("Squat")');
  let skiBadgeCount = await page.locator('.ski-badge').count();
  if(skiBadgeCount !== 0) throw new Error('did not expect a ski badge before ski season mode is on');
  await page.click('.tab:has-text("Overview")');
  await page.click('button:has-text("Ski Season: OFF")');
  await page.click('.tab:has-text("Full Body")');
  await page.click('.pill:has-text("Squat")');
  skiBadgeCount = await page.locator('.ski-badge').count();
  if(skiBadgeCount !== 1) throw new Error('expected a ski badge on Squat once ski season is on, found ' + skiBadgeCount);
  const tempoLine = await page.locator('.ski-tempo-line').textContent();
  if(!tempoLine.includes('3-4 sec eccentric descent') || !tempoLine.includes('5')) throw new Error('unexpected ski tempo line: ' + tempoLine);
  const repsField = await page.locator('#f-reps').inputValue();
  if(repsField !== '5') throw new Error('expected target reps to shift to 5 for ski season, got ' + repsField);
  console.log('OK: ski badge and tempo line show on Squat, target reps shift to 5:', tempoLine.trim());

  console.log('=== 15: ski fields backfill onto an exercise that already existed before this fix ===');
  await page.click('.tab:has-text("Overview")');
  await page.click('button:has-text("Ski Season: ON")'); // turn back off for a clean re-check
  const backfillCheck = await page.evaluate(() => {
    // Simulate a pre-existing exercise saved before ski defaults existed (no targetRepsSki/skiTempo)
    const store = JSON.parse(localStorage.getItem('strength-tracker-v1'));
    delete store.Squat.targetRepsSki;
    delete store.Squat.skiTempo;
    localStorage.setItem('strength-tracker-v1', JSON.stringify(store));
    return true;
  });
  await page.reload();
  await waitForText(page, '#sync-status', t => t.includes('Synced'), 10000, 'reload after simulating stale exercise');
  const backfilled = await page.evaluate(() => JSON.parse(localStorage.getItem('strength-tracker-v1')).Squat.targetRepsSki);
  if(backfilled !== 5) throw new Error('expected ski fields to backfill onto a pre-existing Squat exercise, got targetRepsSki=' + backfilled);
  console.log('OK: pre-existing Squat exercise (saved before this fix) automatically backfilled with ski fields on load');

  console.log('=== 16: Knee Care badge/tip shows only on knee-flagged exercises ===');
  await page.click('.tab:has-text("Overview")');
  await page.click('button:has-text("Knee Care: OFF")');
  await page.click('.tab:has-text("Full Body")');
  await page.locator('.pill').filter({ hasText: new RegExp('^' + '1\. Squat' + '\\s*.?$') }).click();
  if(await page.locator('.knee-badge').count() !== 1) throw new Error('expected a knee badge on Squat with Knee Care on');
  if(await page.locator('.knee-care-line').count() !== 1) throw new Error('expected a knee care tip line on Squat');
  await page.locator('.pill').filter({ hasText: new RegExp('^' + '2\. Bench Press' + '\\s*.?$') }).click();
  if(await page.locator('.knee-badge').count() !== 0) throw new Error('did not expect a knee badge on Bench Press');
  await page.locator('.pill').filter({ hasText: new RegExp('^' + '5\. Bulgarian Split Squat' + '\\s*.?$') }).click();
  if(await page.locator('.knee-badge').count() !== 1) throw new Error('expected a knee badge on Bulgarian Split Squat');
  await page.locator('.pill').filter({ hasText: new RegExp('^' + '4\. RDL' + '\\s*.?$') }).click();
  if(await page.locator('.knee-badge').count() !== 0) throw new Error('did not expect a knee badge on RDL');
  console.log('OK: knee badge/tip appear only on Squat and Bulgarian Split Squat, not Bench Press or RDL');

  console.log('=== 17: Low Back Care badge/tip shows only on back-flagged exercises, can stack with Knee Care ===');
  await page.click('.tab:has-text("Overview")');
  await page.click('button:has-text("Low Back Care: OFF")');
  await page.click('.tab:has-text("Full Body")');
  await page.locator('.pill').filter({ hasText: new RegExp('^' + '4\. RDL' + '\\s*.?$') }).click();
  if(await page.locator('.back-badge').count() !== 1) throw new Error('expected a back badge on RDL');
  await page.locator('.pill').filter({ hasText: new RegExp('^' + '6\. Barbell Row' + '\\s*.?$') }).click();
  if(await page.locator('.back-badge').count() !== 1) throw new Error('expected a back badge on Barbell Row');
  await page.locator('.pill').filter({ hasText: new RegExp('^' + '2\. Bench Press' + '\\s*.?$') }).click();
  if(await page.locator('.back-badge').count() !== 0) throw new Error('did not expect a back badge on Bench Press');
  await page.locator('.pill').filter({ hasText: new RegExp('^' + '1\. Squat' + '\\s*.?$') }).click();
  if(await page.locator('.knee-badge').count() !== 1 || await page.locator('.back-badge').count() !== 1) throw new Error('expected Squat to show BOTH knee and back badges simultaneously');
  // Lower Body: Hip Thrust follows Bulgarian Split Squat, then Kettlebell Swings.
  await page.click('.tab:has-text("Lower Body")');
  await page.locator('.pill').filter({ hasText: new RegExp('^' + '4\. Hip Thrust' + '\\s*.?$') }).click();
  if(await page.locator('.back-badge').count() !== 1) throw new Error('expected a back badge on Hip Thrust');
  const htTip = await page.locator('.back-care-line').textContent();
  if(!/glute bridge/i.test(htTip)) throw new Error('expected Back Care to swap Hip Thrust to a glute bridge, got: ' + htTip);
  await page.locator('.pill').filter({ hasText: new RegExp('^' + '5\. Kettlebell Swings' + '\\s*.?$') }).click();
  if(await page.locator('.back-badge').count() !== 1) throw new Error('expected a back badge on Kettlebell Swings');
  console.log('OK: back badge appears only on RDL/Barbell Row/Hip Thrust/Kettlebell Swings, Hip Thrust swaps to a glute bridge, and Squat shows both badges at once');

  console.log('=== 18: Knee Care mode cuts load ~10% and holds, instead of progressing, with the tip surfaced ===');
  await page.click('.tab:has-text("Full Body")');
  await page.locator('.pill').filter({ hasText: new RegExp('^' + '5\. Bulgarian Split Squat' + '\\s*.?$') }).click();
  await page.fill('#f-weight', '50');
  await page.fill('#f-sets', '3');
  await page.fill('#f-reps', '8');
  await page.click('button.log:has-text("Log set")');
  const careRec = await page.textContent('.rec-box');
  console.log('recommendation shown:', careRec.replace(/\s+/g, ' ').trim());
  const careNextMatch = careRec.match(/Next:\s*(\d+(?:\.\d+)?)\s*lbs/);
  if(!careNextMatch || Number(careNextMatch[1]) !== 45) throw new Error('expected next weight to be cut to 45 lbs (10% off 50), got: ' + (careNextMatch && careNextMatch[1]));
  if(!careRec.includes('Knee Care: ~10% lighter, holding')) throw new Error('expected the knee care message in the recommendation');
  const tipText = await page.locator('.knee-care-line').textContent();
  if(!tipText.toLowerCase().includes('rear-foot elevation')) throw new Error('expected the knee care variation tip near the exercise name, got: ' + tipText);
  console.log('OK: Bulgarian Split Squat suggests 45 lbs (a cut, not a progression) with the knee care message and tip');

  console.log('=== 19: a real deload (3 missed reps) still takes priority over care-mode reduction ===');
  await page.locator('.pill').filter({ hasText: new RegExp('^' + '1\. Squat' + '\\s*.?$') }).click(); // Squat is flagged for both knee and back care, both currently ON
  for(let i = 0; i < 3; i++){
    await page.fill('#f-weight', '200');
    await page.fill('#f-sets', '3');
    await page.fill('#f-reps', '5'); // below the default target of 8 -> a miss
    await page.fill('#f-difficulty', '7');
    await page.click('button.log:has-text("Log set")');
  }
  const deloadRec = await page.textContent('.rec-box');
  console.log('recommendation shown:', deloadRec.replace(/\s+/g, ' ').trim());
  if(!deloadRec.includes('sessions straight')) throw new Error('expected the deload message to win over the knee/back care message, got: ' + deloadRec);
  const deloadNextMatch = deloadRec.match(/Next:\s*(\d+(?:\.\d+)?)\s*lbs/);
  if(!deloadNextMatch || Number(deloadNextMatch[1]) !== 170) throw new Error('expected the standard 15% deload (170 lbs from 200), not the 10% care-mode cut, got: ' + (deloadNextMatch && deloadNextMatch[1]));
  console.log('OK: deload logic still wins over care-mode reduction when both would apply');

  console.log('=== 20: both care toggles persist through a lost-phone wipe + re-sign-in ===');
  await context.setOffline(false); // ensure clean sync state
  await waitForText(page, '#sync-status', t => t.includes('Synced'), 15000, 'pre-wipe sync settle');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await waitForText(page, '#sync-status', t => t.includes('Not signed in'), 5000, 'after wipe reload');
  await page.click('.tab:has-text("Overview")');
  await page.fill('#auth-email', EMAIL);
  await page.fill('#auth-password', PASSWORD);
  await page.click('button:has-text("Sign In")');
  await waitForText(page, '#sync-status', t => t.includes('Synced'), 10000, 'post-restore sync');
  const kneeOn = await page.locator('button:has-text("Knee Care: ON")').count();
  const backOn = await page.locator('button:has-text("Low Back Care: ON")').count();
  if(kneeOn !== 1 || backOn !== 1) throw new Error('expected both care toggles to restore to ON after wipe + re-sign-in');
  console.log('OK: Knee Care and Low Back Care toggle states survived a full wipe and cloud restore');

  console.log('=== 21: plate math shows for barbell exercises, and backfills onto exercises that predate this fix ===');
  await page.click('.tab:has-text("Full Body")');
  await page.locator('.pill').filter({ hasText: /^1\.\s*Squat/ }).click();
  if(await page.locator('.plate-line').count() !== 1) throw new Error('expected plate math on Squat');
  const plateText = await page.locator('.plate-line').textContent();
  console.log('Squat plate line:', plateText.trim());
  if(!plateText.includes('Load:')) throw new Error('expected "Load:" plate text on Squat, got: ' + plateText);

  await page.locator('.pill').filter({ hasText: /^2\.\s*Bench Press/ }).click();
  if(await page.locator('.plate-line').count() !== 1) throw new Error('expected plate math on Bench Press');

  await page.locator('.pill').filter({ hasText: /^3\.\s*Incline DB Press/ }).click();
  if(await page.locator('.plate-line').count() !== 0) throw new Error('did not expect plate math on a dumbbell exercise (Incline DB Press)');
  console.log('OK: plate math shows on barbell exercises (Squat, Bench Press) and not on Incline DB Press');

  await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem('strength-tracker-v1'));
    delete store.Squat.equipment;
    localStorage.setItem('strength-tracker-v1', JSON.stringify(store));
  });
  await page.reload();
  await waitForText(page, '#sync-status', t => t.includes('Synced'), 10000, 'reload after simulating stale barbell exercise');
  const backfilledEquipment = await page.evaluate(() => JSON.parse(localStorage.getItem('strength-tracker-v1')).Squat.equipment);
  if(backfilledEquipment !== 'barbell') throw new Error('expected equipment to backfill to barbell on Squat, got: ' + backfilledEquipment);
  console.log('OK: pre-existing Squat exercise (missing equipment field) automatically backfilled with equipment: barbell');

  console.log('=== 22: exercises logged today show a lightened/checked pill, others do not, and it resets on a new day ===');
  await page.click('.tab:has-text("Full Body")');
  await page.locator('.pill').filter({ hasText: /^2\.\s*Bench Press/ }).click(); // switch away so Squat's pill isn't the active one
  const squatPillClass = await page.locator('.pill').filter({ hasText: /^1\.\s*Squat/ }).getAttribute('class');
  if(!squatPillClass.includes('logged-today')) throw new Error('expected Squat pill to show logged-today, class was: ' + squatPillClass);
  const squatPillText = await page.locator('.pill').filter({ hasText: /^1\.\s*Squat/ }).textContent();
  if(!squatPillText.includes('✓')) throw new Error('expected a checkmark on the Squat pill, got: ' + squatPillText);
  const rdlPillClass = await page.locator('.pill').filter({ hasText: /^4\.\s*RDL/ }).getAttribute('class');
  if(rdlPillClass.includes('logged-today')) throw new Error('did not expect RDL pill (never logged) to show logged-today, class was: ' + rdlPillClass);
  console.log('OK: Squat (logged today) shows the lightened/checked pill, RDL (never logged) does not');

  await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem('strength-tracker-v1'));
    store.Squat.entries.forEach(e => { e.date = '2020-01-01'; }); // simulate "not today" for every Squat entry
    localStorage.setItem('strength-tracker-v1', JSON.stringify(store));
  });
  await page.reload();
  await waitForText(page, '#sync-status', t => t.includes('Synced'), 10000, 'reload after backdating Squat entries');
  await page.click('.tab:has-text("Full Body")');
  const squatPillClassNextDay = await page.locator('.pill').filter({ hasText: /^1\.\s*Squat/ }).getAttribute('class');
  if(squatPillClassNextDay.includes('logged-today')) throw new Error('expected the indicator to clear once no entries are dated today, class was: ' + squatPillClassNextDay);
  console.log('OK: indicator is date-scoped, not "ever logged" - clears once nothing is dated today (i.e. resets on a new day)');

  console.log('=== 23: text inputs no longer use IBM Plex Mono ===');
  await page.click('.tab:has-text("Full Body")');
  await page.locator('.pill').filter({ hasText: /^1\.\s*Squat/ }).click();
  const inputFont = await page.locator('#f-weight').evaluate(el => getComputedStyle(el).fontFamily);
  console.log('input font-family:', inputFont);
  if(inputFont.toLowerCase().includes('ibm plex mono')) throw new Error('expected input font to NOT be IBM Plex Mono, got: ' + inputFont);
  console.log('OK: text inputs use the app\'s normal font, not mono');

  console.log('=== 24: Farmer\'s Carry logs by time (seconds), not reps, and shows no plate math ===');
  await page.click('.tab:has-text("Extra")');
  await page.locator('.pill').filter({ hasText: /^Farmer's Carry$/ }).click();
  const carryUnitLabel = await page.locator('.field label').nth(2).textContent();
  if(carryUnitLabel.trim() !== 'Seconds') throw new Error('expected Farmer\'s Carry\'s third field to be labeled Seconds, got: ' + carryUnitLabel);
  if(await page.locator('.plate-line').count() !== 0) throw new Error('did not expect plate math on Farmer\'s Carry');
  await page.fill('#f-weight', '55');
  await page.fill('#f-sets', '4');
  await page.fill('#f-reps', '40');
  await page.click('button.log:has-text("Log set")');
  const carryHistText = await page.locator('.hist-row.latest .exact').first().textContent();
  if(!carryHistText.includes('40x4sec') && !carryHistText.includes('4x40sec')) throw new Error('unexpected Farmer\'s Carry history text: ' + carryHistText);
  console.log('OK: Farmer\'s Carry labels the field Seconds and shows no plate math:', carryHistText);

  console.log('=== 25: Incline Treadmill Walk has a Speed (mph) field alongside minutes/distance/incline ===');
  await page.locator('.pill').filter({ hasText: /^Incline Treadmill Walk/ }).click();
  if(await page.locator('#f-speed').count() !== 1) throw new Error('expected a Speed (mph) field on Incline Treadmill Walk');
  await page.fill('#f-minutes', '25');
  await page.fill('#f-distance', '1.5');
  await page.fill('#f-speed', '3.5');
  await page.fill('#f-incline', '6');
  await page.click('button.log:has-text("Log set")');
  await waitForText(page, '#sync-status', t => t.includes('Synced'), 10000, 'treadmill mph sync');
  const treadmillHistText = await page.locator('.hist-row.latest .exact').first().textContent();
  if(!treadmillHistText.includes('3.5 mph')) throw new Error('expected speed to show in history, got: ' + treadmillHistText);
  console.log('OK: Incline Treadmill Walk logs and displays speed:', treadmillHistText);
  const cloudTreadmillSpeed = await page.evaluate(() => {
    const db = JSON.parse(sessionStorage.getItem('__mock_supabase_db__'));
    const row = db.entries.find(e => e.speed === 3.5);
    return row && row.speed;
  });
  if(cloudTreadmillSpeed !== 3.5) throw new Error('expected speed to sync to the cloud, got: ' + cloudTreadmillSpeed);

  console.log('=== 26: core-workout-complete banner fires once all NUMBERED Full Body exercises are logged today, ignores custom exercises ===');
  await page.click('.tab:has-text("Full Body")');
  // Every numbered lift shown for the day is required. Ski and care modes
  // never change that list; preseason-only lifts join it only while
  // Preseason Prep is on (it's off here, so Seated Calf Raise is hidden).
  const fullBodyCore = await page.evaluate(() => activeDayOrder('full'));
  if(fullBodyCore.includes('Seated Calf Raise')) throw new Error('expected preseason-only Seated Calf Raise to be hidden while Preseason Prep is off');
  for(const exName of fullBodyCore){
    const escaped = exName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    await page.locator('.pill').filter({ hasText: new RegExp('^\\d+\\.\\s*' + escaped) }).click();
    await page.fill('#f-weight', '50');
    await page.fill('#f-sets', '3');
    await page.fill('#f-reps', '8');
    await page.click('button.log:has-text("Log set")');
  }
  const bannerHiddenAttr = await page.locator('#celebration-banner').getAttribute('hidden');
  const bannerText = await page.locator('#celebration-banner').textContent();
  console.log('banner state: hidden=' + bannerHiddenAttr + ' text="' + bannerText + '"');
  if(bannerHiddenAttr !== null) throw new Error('expected the celebration banner to be visible after completing all core Full Body exercises');
  if(!bannerText.includes('Full Body complete')) throw new Error('unexpected banner text: ' + bannerText);
  const celebratedState = await page.evaluate(() => JSON.parse(localStorage.getItem('strength-tracker-celebrated') || '{}'));
  const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; });
  if(celebratedState.full !== today) throw new Error('expected celebratedToday.full to be recorded, got: ' + JSON.stringify(celebratedState));
  console.log('OK: banner fired and recorded so it won\'t repeat today');

  console.log('--- verifying a custom-only exercise does NOT trigger the banner on an otherwise-incomplete day ---');
  await page.click('.tab:has-text("Upper Body")');
  await page.click('.pill-add');
  await page.fill('#new-ex-name', 'Lateral Raise');
  await page.click('.add-ex-row button:has-text("Add")');
  await page.fill('#f-weight', '15');
  await page.fill('#f-sets', '3');
  await page.fill('#f-reps', '12');
  await page.click('button.log:has-text("Log set")');
  const celebratedAfterCustom = await page.evaluate(() => JSON.parse(localStorage.getItem('strength-tracker-celebrated') || '{}'));
  if(celebratedAfterCustom.upper === today) throw new Error('did not expect the banner to fire from a custom exercise alone, got: ' + JSON.stringify(celebratedAfterCustom));
  console.log('OK: logging only a custom exercise does not trigger the banner for an otherwise-incomplete day');

  console.log('=== 27: stretch/core-routine checklist pills work - collapsed by default, checkbox persists and syncs ===');
  await page.click('.tab:has-text("Extra")');
  await page.locator('.pill').filter({ hasText: /^Hip Stretch$/ }).click();
  if(await page.locator('.stretch-item').count() !== 5) throw new Error('expected 5 stretch items in Hip Stretch');
  if(await page.locator('.stretch-detail').count() !== 0) throw new Error('expected all stretch details to be collapsed by default');
  await page.locator('.stretch-item').nth(0).locator('input[type=checkbox]').check();
  await waitForText(page, '#sync-status', t => t.includes('Synced'), 10000, 'stretch checkbox sync');
  if(await page.locator('.stretch-item.done').count() !== 1) throw new Error('expected exactly one stretch item marked done');
  const doneCountText = await page.locator('.card p').last().textContent();
  if(!doneCountText.includes('1/5 done today')) throw new Error('expected "1/5 done today", got: ' + doneCountText);
  await page.locator('.stretch-item').nth(0).locator('.stretch-toggle').click();
  if(await page.locator('.stretch-detail').count() !== 1) throw new Error('expected the detail to expand after clicking the toggle');
  const detailText = await page.locator('.stretch-detail').first().textContent();
  if(!detailText.toLowerCase().includes('90')) throw new Error('expected the 90/90 hip stretch description, got: ' + detailText);
  console.log('OK: checklist collapsed by default, checkbox marks done + syncs, detail expands on click');

  await page.click('.tab:has-text("Full Body")');
  await page.click('.tab:has-text("Extra")');
  const hipPillClassPartial = await page.locator('.pill').filter({ hasText: /^Hip Stretch/ }).getAttribute('class');
  if(hipPillClassPartial.includes('logged-today')) throw new Error('did not expect Hip Stretch pill to show logged-today with only 1/5 items checked, class was: ' + hipPillClassPartial);
  console.log('OK: Hip Stretch pill does NOT light up as logged-today with only some items checked');

  const cloudChecklist = await page.evaluate(() => {
    const db = JSON.parse(sessionStorage.getItem('__mock_supabase_db__'));
    const row = db.entries.find(e => Array.isArray(e.completed_indices) && e.completed_indices.includes(0));
    return row && row.completed_indices;
  });
  if(!cloudChecklist || !cloudChecklist.includes(0)) throw new Error('expected completed_indices to sync to the cloud, got: ' + JSON.stringify(cloudChecklist));
  console.log('OK: checklist completion synced to the cloud');

  await page.locator('.pill').filter({ hasText: /^Hip Stretch/ }).click();
  for(let i = 1; i < 5; i++){
    await page.locator('.stretch-item').nth(i).locator('input[type=checkbox]').check();
  }
  await waitForText(page, '#sync-status', t => t.includes('Synced'), 10000, 'stretch all-checked sync');
  if(await page.locator('.stretch-item.done').count() !== 5) throw new Error('expected all 5 stretch items marked done');
  await page.click('.tab:has-text("Full Body")');
  await page.click('.tab:has-text("Extra")');
  const hipPillClassFull = await page.locator('.pill').filter({ hasText: /^Hip Stretch/ }).getAttribute('class');
  if(!hipPillClassFull.includes('logged-today')) throw new Error('expected Hip Stretch pill to show logged-today once ALL 5 items are checked, class was: ' + hipPillClassFull);
  console.log('OK: Hip Stretch pill lights up as logged-today only once every item is checked');

  console.log('=== 28: pill row horizontal scroll position survives logging a set / checking a box (does not reset) ===');
  await page.setViewportSize({ width: 375, height: 700 });
  await page.click('.tab:has-text("Full Body")');
  // Select the exercise FIRST (while the pill is still on-screen), then scroll -
  // clicking an off-screen pill would legitimately auto-scroll it into view first,
  // which isn't the bug being fixed here (an in-card action resetting the scroll).
  await page.locator('.pill').filter({ hasText: /^1\.\s*Squat/ }).click();
  const scrollBefore = await page.evaluate(() => {
    const el = document.getElementById('pill-scroll');
    el.scrollLeft = 9999;
    return el.scrollLeft;
  });
  if(scrollBefore <= 0) throw new Error('expected the pill row to be scrollable at 375px width, scrollLeft was: ' + scrollBefore);
  await page.fill('#f-weight', '155');
  await page.fill('#f-sets', '3');
  await page.fill('#f-reps', '8');
  await page.click('button.log:has-text("Log set")');
  const scrollAfterLog = await page.evaluate(() => document.getElementById('pill-scroll').scrollLeft);
  if(scrollAfterLog !== scrollBefore) throw new Error(`expected pill scroll to survive logging a set, before=${scrollBefore} after=${scrollAfterLog}`);
  console.log('OK: pill row scroll position survives logging a set');

  await page.click('.tab:has-text("Extra")');
  await page.locator('.pill').filter({ hasText: /^Hip Stretch/ }).click();
  const extraScrollBefore = await page.evaluate(() => {
    const el = document.getElementById('pill-scroll');
    el.scrollLeft = 9999;
    return el.scrollLeft;
  });
  if(extraScrollBefore <= 0) throw new Error('expected the Extra pill row to be scrollable at 375px width, scrollLeft was: ' + extraScrollBefore);
  await page.locator('.stretch-item').nth(0).locator('.stretch-toggle').click();
  const extraScrollAfter = await page.evaluate(() => document.getElementById('pill-scroll').scrollLeft);
  if(extraScrollAfter !== extraScrollBefore) throw new Error(`expected pill scroll to survive toggling a stretch detail, before=${extraScrollBefore} after=${extraScrollAfter}`);
  console.log('OK: pill row scroll position survives toggling a checklist detail');

  await page.click('.tab:has-text("Full Body")');
  const scrollAfterTabSwitch = await page.evaluate(() => document.getElementById('pill-scroll').scrollLeft);
  if(scrollAfterTabSwitch !== 0) throw new Error('expected scroll to reset to 0 on an actual tab switch, got: ' + scrollAfterTabSwitch);
  console.log('OK: switching tabs still resets scroll to the start (only same-tab re-renders preserve it)');

  console.log('=== 29: Incline Treadmill Walk edit box keeps all 4 duration fields on one row ===');
  await page.click('.tab:has-text("Extra")');
  await page.locator('.pill').filter({ hasText: /^Incline Treadmill Walk/ }).click();
  await page.locator('.hist-row.latest .icon-btn[aria-label="Edit"]').click();
  const editLabels = page.locator('.hist-edit-box .field label');
  const labelCount = await editLabels.count();
  if(labelCount < 4) throw new Error('expected at least 4 fields (Minutes, Miles, MPH, Incline %) in the edit box, got: ' + labelCount);
  const tops = [];
  for(let i = 0; i < labelCount; i++){
    const box = await editLabels.nth(i).boundingBox();
    tops.push(Math.round(box.y));
  }
  const firstRowTops = tops.slice(0, 4);
  const maxDrift = Math.max(...firstRowTops) - Math.min(...firstRowTops);
  if(maxDrift > 3) throw new Error('expected the first 4 edit fields to align on one row, label tops were: ' + JSON.stringify(firstRowTops));
  const labelTexts = await editLabels.allTextContents();
  if(!labelTexts.includes('Miles') || !labelTexts.includes('MPH')) throw new Error('expected shortened Miles/MPH labels, got: ' + JSON.stringify(labelTexts));
  console.log('OK: Incline Treadmill Walk edit box fields (' + JSON.stringify(labelTexts) + ') align on one row');
  await page.click('.hist-edit-box button.cancel-btn');
  await page.setViewportSize({ width: 1280, height: 720 });

  console.log('=== 30: Zone 2 Ride has an MPH field; leaving it blank auto-calculates speed in history ===');
  await page.locator('.pill').filter({ hasText: /^Zone 2 Ride/ }).click();
  if(await page.locator('#f-speed').count() !== 1) throw new Error('expected an MPH field on Zone 2 Ride');
  await page.fill('#f-minutes', '60');
  await page.fill('#f-distance', '15');
  await page.click('button.log:has-text("Log set")');
  await waitForText(page, '#sync-status', t => t.includes('Synced'), 10000, 'zone2 ride auto-speed sync');
  const rideAutoSpeedText = await page.locator('.hist-row.latest .exact').first().textContent();
  if(!rideAutoSpeedText.includes('~15 mph')) throw new Error('expected auto-calculated ~15 mph (15 miles in 60 min) in history, got: ' + rideAutoSpeedText);
  console.log('OK: Zone 2 Ride auto-calculates and labels speed when left blank:', rideAutoSpeedText);

  await page.fill('#f-minutes', '30');
  await page.fill('#f-distance', '8');
  await page.fill('#f-speed', '17.2');
  await page.click('button.log:has-text("Log set")');
  await waitForText(page, '#sync-status', t => t.includes('Synced'), 10000, 'zone2 ride explicit speed sync');
  const rideExplicitSpeedText = await page.locator('.hist-row.latest .exact').first().textContent();
  if(!rideExplicitSpeedText.includes('17.2 mph') || rideExplicitSpeedText.includes('~17.2')) throw new Error('expected the explicitly entered 17.2 mph (not calculated) in history, got: ' + rideExplicitSpeedText);
  console.log('OK: an explicitly entered Zone 2 Ride speed is shown as-is, not recalculated:', rideExplicitSpeedText);

  console.log('=== 31: exercise charts are windowed to the current calendar quarter, with a Prev/Next pager ===');
  const expectedQuarterLabel = await page.evaluate(() => {
    const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const d = new Date();
    const q = Math.floor(d.getMonth() / 3);
    const year = d.getFullYear();
    const start = new Date(Date.UTC(year, q * 3, 1));
    const end = new Date(Date.UTC(year, q * 3 + 3, 0));
    return `Q${q + 1} ${year} · ${MONTH_ABBR[start.getUTCMonth()]} ${start.getUTCDate()} – ${MONTH_ABBR[end.getUTCMonth()]} ${end.getUTCDate()}`;
  });
  await page.click('.tab:has-text("Full Body")');
  await page.locator('.pill').filter({ hasText: /^1\.\s*Squat/ }).click();
  if(await page.locator('.chart-quarter-nav').count() !== 1) throw new Error('expected a quarter pager above the Squat chart');
  const quarterLabelText = await page.locator('.chart-quarter-label').first().textContent();
  if(quarterLabelText.trim() !== expectedQuarterLabel) throw new Error(`expected quarter label "${expectedQuarterLabel}", got "${quarterLabelText.trim()}"`);
  console.log('OK: current-quarter date range shown above the chart:', quarterLabelText.trim());
  const nextDisabled = await page.locator('.chart-quarter-nav button:has-text("Next")').first().isDisabled();
  if(!nextDisabled) throw new Error('expected Next to be disabled while viewing the current (most recent) quarter');
  if(await page.locator('svg.chart').count() < 1) throw new Error('expected the current quarter to render a populated chart (today\'s Squat entries)');

  await page.locator('.chart-quarter-nav button:has-text("Prev")').first().click();
  if(await page.locator('p:has-text("No sessions logged this quarter.")').count() !== 1) throw new Error('expected "No sessions logged this quarter." for the prior (empty) quarter');
  const prevQuarterLabel = await page.locator('.chart-quarter-label').first().textContent();
  if(prevQuarterLabel.trim() === expectedQuarterLabel) throw new Error('expected the quarter label to change after clicking Prev');
  console.log('OK: paging back shows the prior quarter (' + prevQuarterLabel.trim() + ') with an empty-state message, no crash');

  await page.locator('.chart-quarter-nav button:has-text("Next")').first().click();
  const restoredLabel = await page.locator('.chart-quarter-label').first().textContent();
  if(restoredLabel.trim() !== expectedQuarterLabel) throw new Error('expected paging Next to return to the current quarter');
  console.log('OK: paging forward returns to the current quarter and its chart');

  console.log('=== 32: Overview footer shows the app version and last-updated date ===');
  await page.click('.tab:has-text("Overview")');
  const versionInfo = await page.evaluate(() => ({ version: APP_VERSION, updated: APP_UPDATED }));
  const footerText = await page.locator('.save-note').last().textContent();
  if(!footerText.includes(versionInfo.version) || !footerText.includes(versionInfo.updated)) {
    throw new Error(`expected footer to show "${versionInfo.version}" and "${versionInfo.updated}", got: "${footerText}"`);
  }
  console.log('OK: Overview footer shows version + last-updated:', footerText.trim());

  console.log('=== 33: Volume Trends by Day charts get their own independent quarter pager per day-group ===');
  await page.click('text=Volume Trends by Day');
  const volumeNavCount = await page.locator('.chart-quarter-nav').count();
  if(volumeNavCount < 1) throw new Error('expected at least one quarter pager in the expanded Volume Trends by Day view');
  await page.locator('.chart-quarter-nav button:has-text("Prev")').first().click();
  const fullBodyLabelAfterPrev = await page.locator('.chart-quarter-label').first().textContent();
  const otherLabelsUnaffected = await page.locator('.chart-quarter-label').nth(1).textContent().catch(() => null);
  if(fullBodyLabelAfterPrev.trim() === expectedQuarterLabel) throw new Error('expected the first Volume Trends pager to move off the current quarter after Prev');
  if(otherLabelsUnaffected !== null && otherLabelsUnaffected.trim() !== expectedQuarterLabel) throw new Error('expected the OTHER day-group pager to stay on the current quarter (independent state), got: ' + otherLabelsUnaffected);
  console.log('OK: each Volume Trends day-group chart pages independently');

  console.log('=== 34: Neon Dark Mode toggle lives in Backup & Restore, re-themes the app, and persists ===');
  await page.click('.tab:has-text("Full Body")');
  const bodyBgLight = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const headingFontLight = await page.evaluate(() => getComputedStyle(document.querySelector('.ex-name')).fontFamily);
  const themeAttrBefore = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  if(themeAttrBefore !== 'light') throw new Error('expected to start in light mode, got: ' + themeAttrBefore);

  await page.click('.tab:has-text("Overview")');
  if(await page.locator('.theme-toggle[aria-label="Toggle dark mode"]').count() !== 1) throw new Error('expected a Neon Dark Mode toggle in the Backup & Restore card');
  await page.click('.theme-toggle[aria-label="Toggle dark mode"]');
  await sleep(150);
  const themeAttrAfter = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  if(themeAttrAfter !== 'dark') throw new Error('expected data-theme to flip to dark after toggling, got: ' + themeAttrAfter);
  const bodyBgDark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  if(bodyBgDark === bodyBgLight) throw new Error('expected the page background to actually change in dark mode');

  await page.click('.tab:has-text("Full Body")');
  const headingFontDark = await page.evaluate(() => getComputedStyle(document.querySelector('.ex-name')).fontFamily);
  if(!headingFontDark.toLowerCase().includes('orbitron')) throw new Error('expected headings to switch to Orbitron in dark mode, got: ' + headingFontDark);
  if(headingFontDark === headingFontLight) throw new Error('expected the heading font to actually differ between light and dark');
  const darkModeStored = await page.evaluate(() => localStorage.getItem('strength-tracker-dark-mode'));
  if(darkModeStored !== '1') throw new Error('expected dark mode preference to persist to localStorage');
  console.log('OK: toggling dark mode swaps the background, switches headings to Orbitron, and persists');

  await page.reload();
  await waitForText(page, '#sync-status', t => t.includes('Synced') || t.includes('Not signed in'), 10000, 'reload after enabling dark mode');
  const themeAttrAfterReload = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  if(themeAttrAfterReload !== 'dark') throw new Error('expected dark mode to survive a reload, got: ' + themeAttrAfterReload);
  console.log('OK: dark mode survives a full page reload');

  await page.click('.tab:has-text("Overview")');
  await page.click('.theme-toggle[aria-label="Toggle dark mode"]');
  await sleep(150);
  const themeAttrBackToLight = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  if(themeAttrBackToLight !== 'light') throw new Error('expected toggling again to return to light mode, got: ' + themeAttrBackToLight);
  console.log('OK: toggling again switches cleanly back to light mode');

  console.log('=== 35: logging over target reps calls it out by name with the actual count, not just "hit target" ===');
  await page.click('.tab:has-text("Overview")');
  await page.click('button:has-text("Low Back Care: ON")');
  await sleep(150);
  await page.click('.tab:has-text("Full Body")');
  await page.locator('.pill').filter({ hasText: /^4\.\s*RDL/ }).click();
  await page.fill('#f-weight', '50');
  await page.fill('#f-sets', '3');
  await page.fill('#f-reps', '12');
  await page.click('button.log:has-text("Log set")');
  await sleep(300);
  const overTargetMsg = await page.locator('.rec-desc').textContent();
  if(!overTargetMsg.includes('Went over target reps')) throw new Error('expected the rec message to call out going over target reps, got: ' + overTargetMsg);
  if(!overTargetMsg.includes('did 12 reps')) throw new Error('expected the rec message to state the actual reps done (12), got: ' + overTargetMsg);
  if(!overTargetMsg.includes('target is 8 reps')) throw new Error('expected the rec message to state the target (8), got: ' + overTargetMsg);
  console.log('OK: over-target rep count is called out explicitly:', overTargetMsg.trim());

  await page.fill('#f-weight', '55');
  await page.fill('#f-sets', '3');
  await page.fill('#f-reps', '8');
  await page.click('button.log:has-text("Log set")');
  await sleep(300);
  const exactTargetMsg = await page.locator('.rec-desc').textContent();
  if(exactTargetMsg.includes('Went over target')) throw new Error('did not expect "went over" language when reps exactly matched target, got: ' + exactTargetMsg);
  if(!exactTargetMsg.includes('Hit target reps')) throw new Error('expected plain "Hit target reps" when reps exactly matched target, got: ' + exactTargetMsg);
  console.log('OK: hitting target exactly still uses the plain "Hit target reps" wording, not "went over"');

  console.log('=== 36: an entry for an exercise missing server-side self-heals instead of jamming the queue forever ===');
  await page.click('.tab:has-text("Extra")');
  await page.locator('.pill').filter({ hasText: /^Leg Stretch/ }).click();
  await waitForText(page, '#sync-status', t => t.includes('Synced'), 10000, 'Leg Stretch shell created and pushed');
  const legStretchRowExists = await page.evaluate(() => {
    const db = JSON.parse(sessionStorage.getItem('__mock_supabase_db__'));
    return db.exercises.some(e => e.name === 'Leg Stretch');
  });
  if(!legStretchRowExists) throw new Error('expected opening Leg Stretch for the first time to push its exercise row');
  // Simulate the real-world gap that stranded the user's queue: the exercise
  // row is missing server-side (deleted here to force it) even though the
  // app already has it cached locally as synced.
  await page.evaluate(() => {
    const db = JSON.parse(sessionStorage.getItem('__mock_supabase_db__'));
    db.exercises = db.exercises.filter(e => e.name !== 'Leg Stretch');
    sessionStorage.setItem('__mock_supabase_db__', JSON.stringify(db));
    delete exerciseIdCache['Leg Stretch'];
  });
  await page.locator('.stretch-item').nth(0).locator('input[type=checkbox]').check();
  await waitForText(page, '#sync-status', t => t.includes('Synced'), 10000, 'checklist entry self-heals the missing exercise row');
  const legStretchRowRecreated = await page.evaluate(() => {
    const db = JSON.parse(sessionStorage.getItem('__mock_supabase_db__'));
    return db.exercises.some(e => e.name === 'Leg Stretch');
  });
  if(!legStretchRowRecreated) throw new Error('expected the missing exercise row to be recreated instead of the entry failing forever');
  const pendingAfterHeal = await page.evaluate(() => JSON.parse(localStorage.getItem('strength-tracker-pending-ops-v1')).length);
  if(pendingAfterHeal !== 0) throw new Error('expected the queue to fully drain after self-healing, got ' + pendingAfterHeal + ' still pending');
  console.log('OK: an entry for a since-missing exercise recreates the exercise row instead of stalling forever');

  console.log('=== 37: one failing op no longer blocks every other op behind it in the queue ===');
  await page.evaluate(() => {
    window.__origRunOp = window.runOp;
    window.runOp = async function(op){
      if(op.type === 'upsert_settings') throw new Error('simulated persistent failure');
      return window.__origRunOp(op);
    };
  });
  await page.click('.tab:has-text("Overview")');
  await page.click('button:has-text("Ski Season: OFF")');
  await page.click('.tab:has-text("Full Body")');
  await page.locator('.pill').filter({ hasText: /^1\.\s*Squat/ }).click();
  await page.fill('#f-weight', '165');
  await page.fill('#f-sets', '3');
  await page.fill('#f-reps', '8');
  await page.click('button.log:has-text("Log set")');
  await sleep(500);
  const squatSyncedDespiteFailure = await page.evaluate(() => {
    const db = JSON.parse(sessionStorage.getItem('__mock_supabase_db__'));
    return db.entries.some(e => e.weight === 165);
  });
  if(!squatSyncedDespiteFailure) throw new Error('expected the Squat entry to sync even though an unrelated earlier op failed');
  const pendingAfterPartialFailure = await page.evaluate(() => JSON.parse(localStorage.getItem('strength-tracker-pending-ops-v1')).length);
  if(pendingAfterPartialFailure !== 1) throw new Error('expected exactly the 1 failed op still queued, got ' + pendingAfterPartialFailure);
  const stuckStatusText = await page.locator('#sync-status').textContent();
  if(!stuckStatusText.includes('having trouble syncing')) throw new Error('expected the sync status to say it is having trouble, got: ' + stuckStatusText);
  console.log('OK: the Squat entry synced normally despite an unrelated op failing, and the failure is visible in the status line');

  await page.evaluate(() => { window.runOp = window.__origRunOp; });
  await page.click('.tab:has-text("Overview")');
  await page.click('#sync-now-btn');
  await waitForText(page, '#sync-now-btn', t => t.includes('Synced'), 5000, 'Sync now shows a success confirmation');
  console.log('OK: pressing Sync now shows a "Synced" confirmation once the retry succeeds');
  await waitForText(page, '#sync-now-btn', t => t.trim() === '↻ Sync now', 5000, 'Sync now button label reverts');
  const pendingAfterRetry = await page.evaluate(() => JSON.parse(localStorage.getItem('strength-tracker-pending-ops-v1')).length);
  if(pendingAfterRetry !== 0) throw new Error('expected the queue to fully drain after retrying, got ' + pendingAfterRetry);
  console.log('OK: retrying via Sync now fully drains the queue and the button label reverts');

  console.log('=== 38: Sync now gives explicit feedback instead of silently doing nothing ===');
  await context.setOffline(true);
  await page.click('.tab:has-text("Full Body")');
  await page.locator('.pill').filter({ hasText: /^1\.\s*Squat/ }).click();
  await page.fill('#f-weight', '166');
  await page.fill('#f-sets', '3');
  await page.fill('#f-reps', '8');
  await page.click('button.log:has-text("Log set")');
  await sleep(200);
  await page.click('.tab:has-text("Overview")');
  await page.click('#sync-now-btn');
  await waitForText(page, '#sync-now-btn', t => t.includes('offline'), 5000, 'Sync now reports being offline');
  console.log('OK: pressing Sync now while offline explicitly says so instead of doing nothing visible');
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await waitForText(page, '#sync-status', t => t.includes('Synced'), 10000, 'reconnect flush after offline test');

  console.log('=== 39: every trackBy in use is one the live database is actually known to accept ===');
  // Mirrors the exercises_track_by_check constraint on the real Supabase
  // project (eixbpujqsectkstkqllz) as of the last time it was checked by
  // hand. This is exactly the gap that let "checklist" ship without a
  // matching migration and silently jam a real user's sync queue - keep
  // this list updated whenever that constraint is migrated, and treat a
  // failure here as "go check the live constraint," not "just add it here."
  const KNOWN_DB_TRACK_BY_VALUES = ["weight", "duration", "reps", "checklist"];
  const trackByAudit = await page.evaluate(() => {
    const usedByExercise = Object.entries(EXERCISE_DEFAULTS)
      .filter(([, preset]) => preset.trackBy)
      .map(([name, preset]) => [name, preset.trackBy]);
    return { used: usedByExercise, validList: VALID_TRACK_BY_VALUES };
  });
  const usedValues = [...new Set(trackByAudit.used.map(([, tb]) => tb))];
  const notInAppList = usedValues.filter(v => !trackByAudit.validList.includes(v));
  if(notInAppList.length) throw new Error('trackBy value(s) used but missing from VALID_TRACK_BY_VALUES: ' + notInAppList.join(', '));
  const notInKnownDb = trackByAudit.validList.filter(v => !KNOWN_DB_TRACK_BY_VALUES.includes(v));
  if(notInKnownDb.length) throw new Error('VALID_TRACK_BY_VALUES has value(s) not confirmed against the live database constraint: ' + notInKnownDb.join(', ') + ' - verify exercises_track_by_check was actually migrated, then update KNOWN_DB_TRACK_BY_VALUES in this test');
  console.log('OK: every trackBy in use (' + usedValues.join(', ') + ') is covered by VALID_TRACK_BY_VALUES and the known-good database constraint');

  console.log('=== 40: Preseason Prep toggle lives next to Ski Season, is independent, and persists ===');
  await page.click('.tab:has-text("Overview")');
  if(await page.locator('button:has-text("Preseason Prep: OFF"), button:has-text("Preseason Prep: ON")').count() !== 1) throw new Error('expected a Preseason Prep toggle in Training Modifiers');
  const preseasonStateBefore = await page.evaluate(() => modes.preseason);
  if(preseasonStateBefore) throw new Error('expected Preseason Prep to start OFF');
  await page.click('button:has-text("Preseason Prep: OFF")');
  await waitForText(page, '#sync-status', t => t.includes('Synced'), 10000, 'preseason toggle sync');
  const preseasonStateAfter = await page.evaluate(() => modes.preseason);
  if(!preseasonStateAfter) throw new Error('expected Preseason Prep to turn ON after clicking it');
  const preseasonStored = await page.evaluate(() => localStorage.getItem('strength-tracker-preseason-mode'));
  if(preseasonStored !== '1') throw new Error('expected the preseason toggle to persist to localStorage');
  const cloudPreseasonSetting = await page.evaluate(() => {
    const db = JSON.parse(sessionStorage.getItem('__mock_supabase_db__'));
    return db.user_settings[0] && db.user_settings[0].preseason_mode;
  });
  if(cloudPreseasonSetting !== true) throw new Error('expected preseason_mode to sync to the cloud settings row, got: ' + cloudPreseasonSetting);
  console.log('OK: Preseason Prep toggle exists, flips independently of Ski Season, and syncs to the cloud');

  console.log('=== 41: Preseason Prep badges/notes appear on flagged exercises and shift Squat\'s tempo target ===');
  await page.click('.tab:has-text("Lower Body")');
  // Kettlebell Swings lives only on Lower Body and is a power exercise, so
  // with Preseason Prep on it's bumped to the front of the pill row (see
  // getDisplayOrder) and numbered 1.
  await page.locator('.pill').filter({ hasText: /^1\.\s*Kettlebell Swings/ }).click();
  if(await page.locator('.preseason-badge').count() !== 1) throw new Error('expected a Preseason badge on Kettlebell Swings with the toggle on');
  const kbNote = await page.locator('.preseason-line').textContent();
  if(!kbNote.includes('do this first')) throw new Error('expected the "do this first" power note on Kettlebell Swings, got: ' + kbNote);
  console.log('OK: Kettlebell Swings shows the Preseason badge and "do this first" note, bumped to the front of the pill row');

  // Full Body has no power exercises since Kettlebell Swings moved back to
  // Lower Body, so Squat stays first there.
  await page.click('.tab:has-text("Full Body")');
  await page.locator('.pill').filter({ hasText: /^1\.\s*Squat/ }).click();
  if(await page.locator('.preseason-badge').count() !== 1) throw new Error('expected a Preseason badge on Squat');
  const squatTempoLine = await page.locator('.preseason-line').first().textContent();
  if(!squatTempoLine.includes('4 sec lowering') || !squatTempoLine.includes('5')) throw new Error('unexpected preseason tempo line on Squat: ' + squatTempoLine);
  if(squatTempoLine.toLowerCase().includes('knee')) throw new Error('did not expect knee-pain commentary in the preseason tempo line, got: ' + squatTempoLine);
  const squatRepsField = await page.locator('#f-reps').inputValue();
  if(squatRepsField !== '5') throw new Error('expected Squat target reps to shift to 5 for preseason prep, got ' + squatRepsField);
  console.log('OK: Squat shows the preseason tempo note (no knee commentary) and its target reps shift to 5:', squatTempoLine.trim());

  console.log('=== 42: new preseason exercises appear on the right days without disturbing the default landing lift ===');
  // Day mapping: Lower Body = squat day (Box Jumps/Lateral Lunge/Trap Bar
  // Jump/Skater Bound - all quad-dominant/squat-pattern work
  // now lives here, not spread across days), Upper Body = upper day (Med
  // Ball Slam), Full Body = hinge day (Seated Calf Raise; Kettlebell Swings
  // moved back to Lower Body next to RDL).
  // Copenhagen Plank (hip adductor, no upper-body connection) moved to
  // Extra instead of Upper Body.
  await page.click('.tab:has-text("Overview")');
  await page.click('.tab:has-text("Full Body")');
  const landingExName = await page.evaluate(() => selected);
  if(landingExName !== 'Squat') throw new Error('expected Full Body to still default to Squat with Preseason Prep on, got: ' + landingExName);
  if(await page.locator('.pill').filter({ hasText: /Box Jumps/ }).count() !== 0) throw new Error('did not expect a Box Jumps pill on Full Body - it is squat-pattern work and now lives only on Lower Body');
  if(await page.locator('.pill').filter({ hasText: /Seated Calf Raise/ }).count() !== 1) throw new Error('expected Seated Calf Raise pill on Full Body (hinge day)');
  await page.click('.tab:has-text("Upper Body")');
  const upperLandingExName = await page.evaluate(() => selected);
  if(upperLandingExName !== 'Bench Press') throw new Error('expected Upper Body to still default to Bench Press with Preseason Prep on, got: ' + upperLandingExName);
  if(await page.locator('.pill').filter({ hasText: /Med Ball Slam/ }).count() !== 1) throw new Error('expected Med Ball Slam pill on Upper Body');
  if(await page.locator('.pill').filter({ hasText: /Copenhagen Plank/ }).count() !== 0) throw new Error('did not expect a Copenhagen Plank pill on Upper Body - it is a hip adductor exercise with no upper-body connection');
  await page.click('.tab:has-text("Lower Body")');
  const lowerLandingExName = await page.evaluate(() => selected);
  if(lowerLandingExName !== 'Squat') throw new Error('expected Lower Body to still default to Squat with Preseason Prep on, got: ' + lowerLandingExName);
  if(await page.locator('.pill').filter({ hasText: /Box Jumps/ }).count() !== 1) throw new Error('expected a single Box Jumps pill on Lower Body (squat day)');
  if(await page.locator('.pill').filter({ hasText: /Lateral Lunge/ }).count() !== 1) throw new Error('expected Lateral Lunge pill on Lower Body (squat day)');
  if(await page.locator('.pill').filter({ hasText: /Skater Bound/ }).count() !== 1) throw new Error('expected Skater Bound pill on Lower Body (moved from Full Body - it is quad/glute-med dominant, not hinge-pattern)');
  if(await page.locator('.pill').filter({ hasText: /Spanish Squat/ }).count() !== 0) throw new Error('expected Spanish Squat off Lower Body (it moved to Extra, outside preseason)');
  console.log('OK: preseason pills are grouped by movement pattern with each day\'s main lift, not spread evenly; opening a tab still lands on its original main lift');

  await page.click('.tab:has-text("Extra")');
  if(await page.locator('.pill').filter({ hasText: /Copenhagen Plank/ }).count() !== 1) throw new Error('expected Copenhagen Plank to now live on the Extra day');
  await page.locator('.pill').filter({ hasText: /Spanish Squat/ }).click();
  await sleep(100);
  const spanish = await page.evaluate(() => ({ pill: !!document.querySelector('.pill.active.cat-strength'), preseasonBadge: !!document.querySelector('.preseason-badge'), flag: !!data['Spanish Squat'].preseason }));
  if(!spanish.pill || spanish.preseasonBadge || spanish.flag) throw new Error('expected Spanish Squat on Extra as a plain strength lift with no preseason flag, got: ' + JSON.stringify(spanish));
  await page.evaluate(() => toggleMode('preseason'));
  await page.click('.tab:has-text("Extra")');
  if(await page.locator('.pill').filter({ hasText: /Spanish Squat/ }).count() !== 1) throw new Error('expected Spanish Squat to stay on Extra with Preseason Prep off');
  await page.evaluate(() => toggleMode('preseason'));
  console.log('OK: Copenhagen Plank and Spanish Squat live on Extra; Spanish Squat is no longer a preseason lift');

  console.log('=== 42b: power exercises are visually bumped to the front of the pill row while Preseason Prep is on ===');
  // getDisplayOrder only affects the pill row's rendering order - selected/
  // DAY_ORDER/completion-banner logic all still read the static array, so
  // this only checks the visible pill text order, not any of that other state.
  // Lower Body's power exercises are Kettlebell Swings, Box Jumps, Trap Bar
  // Jump and Skater Bound, in their DAY_ORDER order, then the rest.
  await page.click('.tab:has-text("Lower Body")');
  const lowerPillOrder = await page.locator('.pill-row .pill').allTextContents();
  const lowerNonAddPills = lowerPillOrder.filter(t => t.trim() !== '+');
  const expectedLowerStart = ['Kettlebell Swings', 'Box Jumps', 'Trap Bar Jump', 'Skater Bound', 'Squat'];
  expectedLowerStart.forEach((name, i) => {
    if(!new RegExp('^' + (i + 1) + '\\.\\s*' + name).test(lowerNonAddPills[i])) throw new Error('expected ' + name + ' at position ' + (i + 1) + ' in the Lower Body pill row, got: ' + lowerNonAddPills[i]);
  });
  console.log('OK: power exercises (Kettlebell Swings, Box Jumps, Trap Bar Jump, Skater Bound) are bumped ahead of the rest of the Lower Body pill row');

  console.log('=== 43: week-3 exercises are noted, not auto-hidden, and stack correctly with Knee Care badges ===');
  // Knee Care mode has been ON since an earlier scenario in this suite and
  // is never turned off, so both Skater Bound and Box Jumps (both flagged
  // knee-sensitive above) are expected to already show a knee badge
  // alongside their Preseason badge here - this checks the two badge
  // systems stack correctly, not a fresh "before/after" toggle. Both now
  // live on Lower Body (the squat day) after the movement-pattern regroup.
  const kneeCareCurrentlyOn = await page.evaluate(() => modes.knee);
  if(!kneeCareCurrentlyOn) throw new Error('expected Knee Care mode to already be on from an earlier scenario');
  await page.click('.tab:has-text("Lower Body")');
  await page.locator('.pill').filter({ hasText: /Skater Bound/ }).click();
  const week3Note = await page.locator('.preseason-line').textContent();
  if(!week3Note.includes('Add from week 3')) throw new Error('expected a "add from week 3" note on Skater Bound, got: ' + week3Note);
  if(await page.locator('.knee-badge').count() !== 1) throw new Error('expected Skater Bound to carry a Knee Care badge alongside its Preseason badge');
  if(await page.locator('.preseason-badge').count() !== 1) throw new Error('expected Skater Bound to still carry its Preseason badge alongside the Knee Care badge');
  await page.locator('.pill').filter({ hasText: /Box Jumps/ }).click();
  if(await page.locator('.knee-badge').count() !== 1) throw new Error('expected Box Jumps to also carry a Knee Care badge');
  if(await page.locator('.preseason-badge').count() !== 1) throw new Error('expected Box Jumps to still carry its Preseason badge alongside the Knee Care badge');
  const boxJumpsNote = await page.locator('.preseason-line').textContent();
  if(!boxJumpsNote.includes('step-down')) throw new Error('expected the Box Jumps note to fold in the gentler step-down eccentric option, got: ' + boxJumpsNote);
  if(boxJumpsNote.toLowerCase().includes('knee pain')) throw new Error('did not expect knee-pain commentary in the Box Jumps preseason note (that\'s what Knee Care mode is for), got: ' + boxJumpsNote);
  console.log('OK: week-3 exercises are labeled rather than hidden, and Knee Care badges stack correctly on new exercises');

  console.log('=== 44: modifier toggles (preseason, etc.) never change which exercises gate the core-workout-complete banner ===');
  const preseasonIsOnBefore44 = await page.evaluate(() => modes.preseason);
  if(!preseasonIsOnBefore44) throw new Error('expected Preseason Prep to still be on entering this scenario');
  const coreListWithPreseasonOn = await page.evaluate(() => DAY_ORDER.upper);
  if(!coreListWithPreseasonOn.includes('Med Ball Slam')) throw new Error('expected Med Ball Slam to always count toward the Upper Body core list');

  await page.click('.tab:has-text("Overview")');
  await page.click('button:has-text("Preseason Prep: ON")'); // turn it off
  await sleep(150);
  const coreListWithPreseasonOff = await page.evaluate(() => DAY_ORDER.upper);
  if(!coreListWithPreseasonOff.includes('Med Ball Slam')) throw new Error('expected Med Ball Slam to still count toward the Upper Body core list with Preseason Prep off - DAY_ORDER is fixed and toggle-independent');
  console.log('OK: the core-workout-complete list is identical regardless of Preseason Prep state');

  console.log('=== 45: stale preseason copy (wording/numbers from an older version) self-corrects on load instead of sticking forever ===');
  // preseasonNote/preseasonTempo/preseasonWeek3/preseasonPower/targetRepsPreseason
  // are pure app-authored copy that never syncs to Supabase and is never
  // user-edited - unlike other backfilled fields, a later wording fix (e.g.
  // dropping a knee-specific load reduction once that stopped being an
  // issue) must always reach an install that already has the old text
  // baked in locally, not just brand-new exercise shells.
  await page.evaluate(() => {
    const local = JSON.parse(localStorage.getItem('strength-tracker-v1'));
    local['Squat'].preseasonTempo = '4 sec lowering, 95-110 lb (~65-70% of current) - lighter on purpose while the knee settles';
    localStorage.setItem('strength-tracker-v1', JSON.stringify(local));
  });
  await page.reload();
  await waitForText(page, '#sync-status', t => t.includes('Synced'), 15000, 'reload after injecting stale preseason copy');
  const correctedTempo = await page.evaluate(() => JSON.parse(localStorage.getItem('strength-tracker-v1')).Squat.preseasonTempo);
  if(correctedTempo.toLowerCase().includes('knee')) throw new Error('expected stale knee-pain wording to self-correct on load, got: ' + correctedTempo);
  if(correctedTempo !== '4 sec lowering') throw new Error('expected Squat preseasonTempo to self-correct to the current copy, got: ' + correctedTempo);
  console.log('OK: stale preseason copy from an older version is refreshed on load instead of sticking forever:', correctedTempo);

  console.log('=== 46: the rest timer is always on: a global countdown badge with a per-exercise 60/90/upper-limit cycle ===');
  await page.click('.tab:has-text("Overview")');
  if(await page.locator('.theme-toggle[aria-label="Toggle rest timer"]').count() !== 0) throw new Error('expected no Rest Timer toggle now that the timer is permanent');

  await page.click('.tab:has-text("Full Body")');
  await page.locator('.pill').filter({ hasText: /^2\.\s*Bench Press/ }).click();
  const startBtnText = await page.locator('.rest-action-btn').textContent();
  if(!startBtnText.includes('90 sec')) throw new Error('expected the Start Rest button to show Bench Press\'s own recommended rest (90 sec), got: ' + startBtnText);
  if(await page.locator('#rest-timer-badge:visible').count() !== 0) throw new Error('did not expect the rest timer badge visible before starting a rest');

  await page.click('.rest-action-btn');
  await sleep(150);
  const badgeStart = await page.locator('#rest-timer-badge').textContent();
  if(badgeStart.trim() !== '1:30') throw new Error('expected the badge to start counting down from 1:30 (90 sec), got: ' + badgeStart);
  const badgeClassStart = await page.locator('#rest-timer-badge').getAttribute('class');
  if(!badgeClassStart.includes('running')) throw new Error('expected the running badge state, got class: ' + badgeClassStart);
  console.log('OK: Start Rest begins a countdown badge at the exercise\'s recommended rest time');

  // The badge lives outside the normal render() cycle, so it must stay
  // visible across tab switches instead of disappearing with the page it
  // was started from - that was the whole point of the top-right global
  // placement over a page-local one.
  await page.click('.tab:has-text("Overview")');
  if(!(await page.locator('#rest-timer-badge').isVisible())) throw new Error('expected the rest timer badge to persist across tab switches (global, not page-local)');
  console.log('OK: the rest timer badge persists across tab switches instead of disappearing with the page');

  await sleep(1200);
  const badgeAfterTick = await page.locator('#rest-timer-badge').textContent();
  if(badgeAfterTick.trim() === '1:30') throw new Error('expected the countdown to actually tick down after ~1 second, still showed: ' + badgeAfterTick);
  console.log('OK: the countdown ticks down every second:', badgeAfterTick.trim());

  // Tapping mid-countdown cycles 60 / 90 / this exercise's own upper limit -
  // Bench Press's bucket is a flat 90 sec, so its 3 raw choices collapse to
  // just [60, 90] once de-duped - then ONE MORE tap past the end of that
  // cycle removes the timer entirely, covering "I pressed it by accident".
  await page.click('#rest-timer-badge');
  await sleep(150);
  const badgeAfterFirstTap = await page.locator('#rest-timer-badge').textContent();
  if(badgeAfterFirstTap.trim() !== '1:00') throw new Error('expected the first tap to cycle to 60 sec (1:00), got: ' + badgeAfterFirstTap);
  await page.click('#rest-timer-badge');
  await sleep(150);
  const badgeAfterSecondTap = await page.locator('#rest-timer-badge').textContent();
  if(badgeAfterSecondTap.trim() !== '1:30') throw new Error('expected the second tap to cycle to 90 sec (1:30), got: ' + badgeAfterSecondTap);
  await page.click('#rest-timer-badge');
  await sleep(150);
  if(await page.locator('#rest-timer-badge:visible').count() !== 0) throw new Error('expected a third tap (past the end of the 60/90 cycle) to remove the timer entirely');
  console.log('OK: tapping the running badge cycles through 60/90/upper-limit, then removes the timer on the next tap');

  // The same cycle-then-remove behavior lives on the "Start Rest" button
  // itself, not just the badge - repeatedly pressing the button you
  // already pressed should let you back out of an accidental start.
  await page.click('.tab:has-text("Full Body")');
  await page.locator('.pill').filter({ hasText: /^2\.\s*Bench Press/ }).click();
  await page.click('.rest-action-btn');
  await sleep(150);
  if((await page.locator('#rest-timer-badge').textContent()).trim() !== '1:30') throw new Error('expected pressing Start Rest fresh to begin at the default 90 sec (1:30)');
  await page.click('.rest-action-btn');
  await sleep(150);
  if((await page.locator('#rest-timer-badge').textContent()).trim() !== '1:00') throw new Error('expected a second press of Start Rest to cycle to 60 sec (1:00), same as the badge tap');
  await page.click('.rest-action-btn');
  await sleep(150);
  if((await page.locator('#rest-timer-badge').textContent()).trim() !== '1:30') throw new Error('expected a third press of Start Rest to cycle to 90 sec (1:30)');
  await page.click('.rest-action-btn');
  await sleep(150);
  if(await page.locator('#rest-timer-badge:visible').count() !== 0) throw new Error('expected a fourth press of Start Rest (past the cycle) to remove the timer');
  console.log('OK: repeatedly pressing the Start Rest button cycles 60/90/upper-limit and then removes the timer, same as the badge');

  // Start fresh again for the zero/finished-state coverage below.
  await page.click('.rest-action-btn');
  await sleep(150);

  // Force the rest period into the past instead of waiting out a real 90
  // seconds, then call the same completion check the interval and the
  // visibilitychange listener both use - the interval's own schedule
  // isn't synced to when endAt gets overridden here, so waiting on a
  // real tick to notice would be a flaky guess at timing rather than a
  // deterministic check.
  await page.evaluate(() => { restTimer.endAt = Date.now() - 1; checkRestTimerCompletion(); });
  await sleep(150);
  const badgeAtZero = await page.locator('#rest-timer-badge').textContent();
  const badgeClassAtZero = await page.locator('#rest-timer-badge').getAttribute('class');
  if(badgeAtZero.trim() !== 'Rest over') throw new Error('expected the badge to read "Rest over" once the countdown reaches zero, got: ' + badgeAtZero);
  if(!badgeClassAtZero.includes('done')) throw new Error('expected the finished badge to carry the red "done" state, got class: ' + badgeClassAtZero);
  console.log('OK: the badge turns into a big "Rest over" indicator once the countdown reaches zero');

  if(await page.evaluate(() => getComputedStyle(document.getElementById('rest-timer-badge')).animationName) !== 'none') throw new Error('expected the finished badge to stay still, with no pulse animation');
  // First tap on finished badge should restart the SAME duration that had
  // just been running (90 sec here, the fresh-start default) - not a
  // shorter/earlier choice, and not clear immediately.
  await page.click("#rest-timer-badge");
  await sleep(150);
  const badgeAfterFirstTapDone = await page.locator("#rest-timer-badge").textContent();
  if(badgeAfterFirstTapDone.trim() !== "1:30") throw new Error("expected first tap on finished badge to restart the prior 90 sec duration, got: " + badgeAfterFirstTapDone);
  console.log("OK: first tap on finished badge restarts the prior duration");
  // Second tap dismisses
  await page.click("#rest-timer-badge");
  await sleep(150);
  if(await page.locator("#rest-timer-badge:visible").count() !== 0) throw new Error("expected second tap on finished badge to dismiss it");
  console.log("OK: second tap on finished badge dismisses it");
  await page.click('.tab:has-text("Extra")');
  await page.locator('.pill').filter({ hasText: /^Zone 2 Ride/ }).click();
  if(await page.locator('.rest-action-btn').count() !== 0) throw new Error('did not expect a Start Rest button on a duration-tracked cardio exercise');
  console.log('OK: cardio (duration-tracked) exercises do not get a Start Rest button');

  await page.click('.tab:has-text("Full Body")');
  await page.locator('.pill').filter({ hasText: /^2\.\s*Bench Press/ }).click();
  await page.click('.rest-action-btn');
  await sleep(150);
  for(const tab of ['Upper Body', 'Lower Body', 'Extra']){
    await page.click(`.tab:has-text("${tab}")`);
    await sleep(100);
    if(!(await page.locator('#rest-timer-badge').isVisible())) throw new Error('expected the running rest timer badge on the ' + tab + ' tab too');
  }
  await page.evaluate(() => clearRestTimer());
  console.log('OK: the rest timer badge stays up on every tab while a countdown runs');

  console.log('=== 47: calendar day-guessing weighs distinctive exercises over shared ones, and defaults ties to Extra ===');
  // Mirrors a real bug: Sept 17 logged Squat/RDL/Bulgarian Split Squat
  // (shared between Full Body and Lower Body), Kettlebell Swings and Back
  // Extension (Full-only/shared with Upper), plus Walking Lunge and
  // Standing Calf Raise (Lower-only). Raw overlap counts tied Full Body
  // and Lower Body at the same score and broke the tie toward Full Body
  // just because it's checked first - the fix weighs Walking Lunge/
  // Standing Calf Raise (distinctive to Lower Body) more heavily than the
  // exercises shared with Full Body, so Lower Body should now win outright.
  const sept17Guess = await page.evaluate(() => guessDayForNames(['Back Extension','Bulgarian Split Squat','Kettlebell Swings','RDL','Squat','Standing Calf Raise','Walking Lunge']));
  if(sept17Guess !== 'lower') throw new Error('expected a real Lower Body session (with Full-Body-shared lifts plus Lower-only accessories) to classify as lower, got: ' + sept17Guess);
  console.log('OK: a real Lower Body session with several Full-Body-shared lifts still classifies as Lower Body, not Full Body');

  const farmerCarryAloneGuess = await page.evaluate(() => guessDayForNames(["Farmer's Carry"]));
  if(farmerCarryAloneGuess !== 'extra') throw new Error('expected a day with only Farmer\'s Carry logged (Extra-only exercise) to default to extra, got: ' + farmerCarryAloneGuess);
  console.log('OK: Farmer\'s Carry logged alone defaults to Extra');

  const realUpperGuess = await page.evaluate(() => guessDayForNames(['Bench Press','Barbell Row','Face Pulls','Bicep Curl','Tricep Pushdown']));
  if(realUpperGuess !== 'upper') throw new Error('expected a real Upper Body session to still classify as upper, got: ' + realUpperGuess);
  console.log('OK: a normal Upper Body session still classifies correctly');

  console.log('=== 48: rest timer completion is caught immediately on returning to the app, not just by the regular tick ===');
  // Browsers throttle or fully suspend setInterval in a backgrounded tab
  // (locked screen, another app in front), so the countdown must be able
  // to detect "the whole rest already elapsed while I was away" the
  // instant the app is reopened, without depending on that interval ever
  // having fired. Proven here by disabling the interval outright before
  // simulating the return, so only the visibilitychange listener can
  // possibly catch it.
  await page.click('.tab:has-text("Full Body")');
  await page.locator('.pill').filter({ hasText: /^2\.\s*Bench Press/ }).click();
  await page.click('.rest-action-btn');
  await sleep(150);
  await page.evaluate(() => {
    clearInterval(restTimer.intervalId);
    restTimer.endAt = Date.now() - 5000; // the 90 sec rest fully elapsed 5 sec ago
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await sleep(150);
  const badgeAfterReturn = await page.locator('#rest-timer-badge').textContent();
  const badgeClassAfterReturn = await page.locator('#rest-timer-badge').getAttribute('class');
  if(badgeAfterReturn.trim() !== 'Rest over') throw new Error('expected reopening the app to immediately catch a rest that fully elapsed while backgrounded, got: ' + badgeAfterReturn);
  if(!badgeClassAfterReturn.includes('done')) throw new Error('expected the done state after returning, got class: ' + badgeClassAfterReturn);
  console.log('OK: reopening/foregrounding the app immediately catches a rest period that fully elapsed while backgrounded, even with the interval disabled');

  // After visibilitychange catches completion, tap 1 should restart the same
  // duration that had been running (90 sec here), tap 2 should dismiss
  await page.click('#rest-timer-badge', { force: true });
  await sleep(150);
  const badgeAfterVisibilityRevert = await page.locator('#rest-timer-badge').textContent();
  if(badgeAfterVisibilityRevert.trim() !== '1:30') throw new Error('expected first tap after visibilitychange completion to restart the prior 90 sec duration, got: ' + badgeAfterVisibilityRevert);
  // Second tap dismisses
  await page.click('#rest-timer-badge', { force: true });
  await sleep(150);
  if(await page.locator('#rest-timer-badge:visible').count() !== 0) throw new Error('expected second tap after visibilitychange completion to dismiss the badge');
  console.log('OK: the finished badge from a visibilitychange catch-up reverts then dismisses normally');

  console.log('=== 49: preseason-flagged pills get a light purple background, and a darker purple when active ===');
  await page.click('.tab:has-text("Overview")');
  await page.click('button:has-text("Preseason Prep: OFF")'); // scenario 44 left this off
  await sleep(150);
  await page.click('.tab:has-text("Full Body")');
  const kbPillClass = await page.locator('.pill').filter({ hasText: /Seated Calf Raise/ }).getAttribute('class');
  if(!kbPillClass.includes('preseason-pill')) throw new Error('expected a preseason-flagged pill (Seated Calf Raise) to carry the preseason-pill class, got: ' + kbPillClass);
  const benchPillClass = await page.locator('.pill').filter({ hasText: /Bench Press/ }).getAttribute('class');
  if(benchPillClass.includes('preseason-pill')) throw new Error('did not expect a non-preseason pill (Bench Press) to carry the preseason-pill class, got: ' + benchPillClass);
  console.log('OK: preseason-flagged pills carry a distinct class, non-flagged pills do not');

  await page.locator('.pill').filter({ hasText: /Seated Calf Raise/ }).click();
  const kbActivePillClass = await page.locator('.pill').filter({ hasText: /Seated Calf Raise/ }).getAttribute('class');
  if(!kbActivePillClass.includes('preseason-pill') || !kbActivePillClass.includes('active')) throw new Error('expected the selected preseason pill to carry both preseason-pill and active, got: ' + kbActivePillClass);
  const kbBg = await page.locator('.pill').filter({ hasText: /Seated Calf Raise/ }).evaluate(el => getComputedStyle(el).backgroundColor);
  // Bench Press (not preseason-flagged) for the "normal active" comparison - Squat
  // is also preseason-flagged (its tempo/reps shift too), so it wouldn't isolate this.
  await page.locator('.pill').filter({ hasText: /^2\.\s*Bench Press/ }).click();
  const nonPreseasonActiveBg = await page.locator('.pill').filter({ hasText: /^2\.\s*Bench Press/ }).evaluate(el => getComputedStyle(el).backgroundColor);
  if(kbBg === nonPreseasonActiveBg) throw new Error('expected the active preseason pill\'s background to differ from the normal amber active-pill background, both read: ' + kbBg);
  console.log('OK: an active preseason pill renders a different (darker purple) background than a normal active pill:', kbBg, 'vs', nonPreseasonActiveBg);

  await page.click('.tab:has-text("Overview")');
  await page.click('button:has-text("Preseason Prep: ON")');
  await sleep(150);
  await page.click('.tab:has-text("Full Body")');
  // Squat always shows and carries preseason notes, so it's the one to check;
  // Seated Calf Raise is preseason-only and is hidden entirely once it's off.
  if(await page.locator('.pill').filter({ hasText: /Seated Calf Raise/ }).count() !== 0) throw new Error('expected preseason-only Seated Calf Raise to hide once Preseason Prep is off');
  const kbPillClassAfterOff = await page.locator('.pill').filter({ hasText: /^1\.\s*Squat/ }).getAttribute('class');
  if(kbPillClassAfterOff.includes('preseason-pill')) throw new Error('expected the preseason-pill class to disappear once Preseason Prep is turned off, got: ' + kbPillClassAfterOff);
  console.log('OK: pills lose the preseason coloring once Preseason Prep is turned back off');

  console.log('=== 50: the Date field and Log Set button sit on the same row for every exercise ===');
  await page.locator('.pill').filter({ hasText: /^1\.\s*Squat/ }).click();
  const dateBox = await page.locator('#f-date').boundingBox();
  const logBtnBox = await page.locator('button.log').boundingBox();
  if(Math.abs(dateBox.y - logBtnBox.y) > 5) throw new Error(`expected the Date field and Log Set button to sit on the same row (similar y position), got date.y=${dateBox.y} vs log.y=${logBtnBox.y}`);
  await page.click('.tab:has-text("Extra")');
  await page.locator('.pill').filter({ hasText: /^Zone 2 Ride/ }).click();
  const cardioDateBox = await page.locator('#f-date').boundingBox();
  const cardioLogBtnBox = await page.locator('button.log').boundingBox();
  if(Math.abs(cardioDateBox.y - cardioLogBtnBox.y) > 5) throw new Error(`expected Date and Log Set to sit on the same row for cardio exercises too, got date.y=${cardioDateBox.y} vs log.y=${cardioLogBtnBox.y}`);
  console.log('OK: Date and Log Set sit on the same row for both a standard exercise and a duration-tracked one');

  console.log('=== 51: Cable Chest Fly progression is not permanently locked by one old miss buried in a same-weight streak ===');
  await page.click('.tab:has-text("Full Body")');
  await page.evaluate(() => {
    const mk = (i, reps) => ({ clientId: 'cf'+i, label: 'S'+i, date: '2026-08-'+(String(10+i).padStart(2,'0')), confirmed: true, weight: 50, sets: 3, reps, difficulty: 6, note: '' });
    data['Cable Chest Fly'] = { trackBy: 'weight', entries: [mk(1,6), mk(2,8), mk(3,8), mk(4,8), mk(5,8)] };
    persist();
  });
  await page.locator('.pill').filter({ hasText: /Cable Chest Fly/ }).click();
  await sleep(150);
  const chestFlySuggestion = await page.evaluate(() => computeSuggestion(data['Cable Chest Fly'], 'Cable Chest Fly'));
  if(!chestFlySuggestion.readyToProgress) throw new Error('expected Cable Chest Fly to be ready to progress once the 4 most recent sessions all hit target, got: ' + JSON.stringify(chestFlySuggestion));
  if(chestFlySuggestion.weight !== 55) throw new Error('expected Cable Chest Fly to suggest 55 lbs, got: ' + chestFlySuggestion.weight);
  console.log('OK: an old miss no longer permanently blocks progression once recent sessions consistently hit target');

  console.log('=== 52: Back Extension is weight-tracked and autoloads the last logged reps count ===');
  await page.click('.tab:has-text("Full Body")');
  await page.locator('.pill').filter({ hasText: /Back Extension/ }).click();
  await sleep(150);
  if(await page.locator('#f-weight').count() !== 1) throw new Error('expected a Weight field on Back Extension');
  // Back Extension already has an entry from scenario 26 (reps: 8, the
  // static target). Log a new one with a different rep count, then confirm
  // the freshly re-rendered form autoloads THAT rep count, not the static
  // target - proving it tracks the last logged value, not a fixed default.
  await page.fill('#f-weight', '55');
  await page.fill('#f-sets', '3');
  await page.fill('#f-reps', '11');
  await page.click('button.log:has-text("Log set")');
  await sleep(150);
  const backExtRepsVal = await page.inputValue('#f-reps');
  if(backExtRepsVal !== '11') throw new Error('expected the Reps field to autoload the last logged reps (11), got: ' + backExtRepsVal);
  console.log('OK: Back Extension has a weight field and autoloads the last logged reps count');

  console.log('=== 53: Dead Hang exercise defaults to a 3x45 second time interval ===');
  await page.click('.tab:has-text("Extra")');
  await page.locator('.pill').filter({ hasText: /^Dead Hang$/ }).click();
  await sleep(150);
  const deadHangSets = await page.inputValue('#f-sets');
  const deadHangSeconds = await page.inputValue('#f-reps');
  if(deadHangSets !== '3' || deadHangSeconds !== '45') throw new Error(`expected Dead Hang to default to 3 sets x 45 sec, got sets=${deadHangSets} seconds=${deadHangSeconds}`);
  if(await page.locator('#f-weight').count() !== 0) throw new Error('did not expect a Weight field on Dead Hang');
  console.log('OK: Dead Hang defaults to a 3x45 second time interval with no weight field');

  console.log('=== 54: a user-added custom exercise can be deleted, but a built-in exercise cannot ===');
  await page.click('.tab:has-text("Full Body")');
  if(await page.locator('button[aria-label="Delete exercise"]').count() !== 0) throw new Error('did not expect a delete control on a built-in exercise');
  await page.click('.pill-add');
  await page.fill('#new-ex-name', 'Cable Lateral Raise');
  await page.click('.add-ex-row button:has-text("Add")');
  await sleep(150);
  if(await page.locator('button[aria-label="Delete exercise"]').count() !== 1) throw new Error('expected a delete control on a newly-added custom exercise');
  await page.click('button[aria-label="Delete exercise"]');
  await sleep(150);
  await page.click('button:has-text("Yes, delete")');
  await sleep(150);
  const customExStillExists = await page.evaluate(() => !!data['Cable Lateral Raise']);
  if(customExStillExists) throw new Error('expected the custom exercise to be removed after confirming delete');
  console.log('OK: custom exercises can be deleted after confirmation; built-in exercises have no delete control');

  console.log('=== 55: action-row tiles stay equal height even at narrow real-phone widths where Progression text wraps ===');
  // At 420px (this suite's default viewport) "Progression: Standard" fits on
  // one line, masking a real bug: at true iPhone widths (375-390px CSS px)
  // it wraps to two lines while Repeat/Rest stay single-line, making the
  // middle tile visibly taller unless the row stretches all three to match.
  await page.setViewportSize({ width: 375, height: 800 });
  await page.click('.tab:has-text("Full Body")');
  await page.locator('.pill').filter({ hasText: /^1\.\s*Squat/ }).click();
  await sleep(150);
  const rowBoxes = await page.evaluate(() => {
    const row = document.querySelector('.action-row');
    return Array.from(row.children).map(el => el.getBoundingClientRect().height);
  });
  const maxH = Math.max(...rowBoxes), minH = Math.min(...rowBoxes);
  if(maxH - minH > 1) throw new Error('expected all three action-row tiles to share the same height at 375px width, got heights: ' + JSON.stringify(rowBoxes));
  await page.setViewportSize({ width: 420, height: 900 });
  console.log('OK: action-row tiles remain equal height at narrow phone widths, even when Progression text wraps to two lines');

  console.log('=== 56: Extra day pills are grouped strength/cardio/core/stretch, color-coded, in that order ===');
  await page.click('.tab:has-text("Extra")');
  await sleep(150);
  const extraPills = await page.evaluate(() => Array.from(document.querySelectorAll('.pill-row .pill:not(.pill-add)')).map(el => ({ text: el.textContent.trim(), classes: el.className })));
  const expectedOrder = [
    ["Farmer's Carry", 'cat-strength'], ['Dead Hang', 'cat-strength'], ['Spanish Squat', 'cat-strength'],
    ['Zone 2 Ride', 'cat-cardio'], ['Incline Treadmill Walk', 'cat-cardio'],
    ['5-Minute Core Routine', 'cat-core'],
    ['Thoracic Spine Stretch', 'cat-stretch'], ['Hip Stretch', 'cat-stretch'],
    ['Leg Stretch', 'cat-stretch'], ['Full Body Stretch', 'cat-stretch'],
  ];
  expectedOrder.forEach(([name, cls], i) => {
    const actualName = extraPills[i] ? extraPills[i].text.replace(/\s*✓$/, '') : undefined;
    if(actualName !== name) throw new Error(`expected Extra pill ${i} to be "${name}", got: ${JSON.stringify(extraPills[i])}`);
    if(!extraPills[i].classes.includes(cls)) throw new Error(`expected "${name}" pill to carry class "${cls}", got: ${extraPills[i].classes}`);
  });
  if(extraPills.some(p => p.text.startsWith('Copenhagen Plank'))) throw new Error('expected preseason-only Copenhagen Plank to be hidden while Preseason Prep is off');
  console.log('OK: Extra pills are ordered strength, cardio, core, stretch and each carries its category class');

  console.log('=== 57: logging with a required field empty flashes that field red instead of silently doing nothing ===');
  await page.click('.tab:has-text("Full Body")');
  await page.locator('.pill').filter({ hasText: /^2\.\s*Bench Press/ }).click();
  await sleep(150);
  const entriesBefore = await page.evaluate(() => data['Bench Press'] ? data['Bench Press'].entries.length : 0);
  await page.fill('#f-weight', ''); // leave weight blank
  await page.click('button.log:has-text("Log set")');
  await sleep(50);
  const hasFieldError = await page.evaluate(() => document.getElementById('f-weight').classList.contains('field-error'));
  const entriesAfter = await page.evaluate(() => data['Bench Press'].entries.length);
  if(!hasFieldError) throw new Error('expected the weight field to flash red when left empty');
  if(entriesAfter !== entriesBefore) throw new Error('expected nothing to be logged while the weight field is empty');
  await sleep(1000);
  const errorCleared = await page.evaluate(() => !document.getElementById('f-weight').classList.contains('field-error'));
  if(!errorCleared) throw new Error('expected the red flash to clear on its own after about a second');
  console.log('OK: an empty required field flashes red and clears itself instead of silently refusing to log');

  console.log('--- same check for a duration-tracked exercise missing Minutes ---');
  await page.click('.tab:has-text("Extra")');
  await page.locator('.pill').filter({ hasText: /^Zone 2 Ride/ }).click();
  await sleep(150);
  await page.fill('#f-minutes', ''); // pre-filled from the last ride when there is one
  await page.click('button.log:has-text("Log set")');
  await sleep(50);
  const minutesHasError = await page.evaluate(() => document.getElementById('f-minutes').classList.contains('field-error'));
  if(!minutesHasError) throw new Error('expected the Minutes field to flash red when left empty on a duration-tracked exercise');
  console.log('OK: duration-tracked exercises flash their Minutes field the same way');

  console.log('=== 58: workout-complete celebration is a full-screen confetti takeover that holds ~7 sec, fades, and closes on tap ===');
  // Every Full Body exercise is already logged today from scenario 26,
  // except Cable Chest Fly - scenario 52 overwrote its entries with
  // historical (non-today) dates to test the progression-lock fix. Log it
  // fresh today, then clear today's "already celebrated" flag and re-run
  // the check directly rather than re-logging all 11 exercises.
  await page.click('.tab:has-text("Full Body")');
  await page.locator('.pill').filter({ hasText: /Cable Chest Fly/ }).click();
  await sleep(150);
  await page.fill('#f-weight', '55');
  await page.click('button.log:has-text("Log set")');
  await sleep(150);
  await page.evaluate(() => {
    celebratedToday = {};
    try{ localStorage.removeItem('strength-tracker-celebrated'); }catch(e){}
    checkCoreWorkoutComplete('full');
  });
  await sleep(200);
  const overlayBox = await page.evaluate(() => {
    const el = document.getElementById('celebration-banner');
    const r = el.getBoundingClientRect();
    return { width: r.width, height: r.height, viewportW: window.innerWidth, viewportH: window.innerHeight, confetti: document.querySelectorAll('.confetti-piece').length, hidden: el.hidden };
  });
  if(overlayBox.hidden) throw new Error('expected the celebration overlay to be visible right after completing the day');
  if(overlayBox.width < overlayBox.viewportW - 2 || overlayBox.height < overlayBox.viewportH - 2) throw new Error('expected the celebration overlay to cover the full viewport, got: ' + JSON.stringify(overlayBox));
  if(overlayBox.confetti < 20) throw new Error('expected a substantial number of confetti pieces, got: ' + overlayBox.confetti);
  console.log('OK: celebration overlay covers the full screen with confetti pieces');

  await sleep(3500);
  const stillUp = await page.evaluate(() => { const el = document.getElementById('celebration-banner'); return !el.hidden && !el.classList.contains('fade-out'); });
  if(!stillUp) throw new Error('expected the overlay to still be fully up at 3.5 seconds (held 7 seconds now)');
  await sleep(3600);
  const isFadingOut = await page.evaluate(() => document.getElementById('celebration-banner').classList.contains('fade-out'));
  if(!isFadingOut) throw new Error('expected the overlay to start fading out around the 7 second mark');
  console.log('OK: overlay holds fully visible for ~7 seconds, then fades');

  await sleep(700);
  const isGoneAfterFade = await page.evaluate(() => document.getElementById('celebration-banner').hidden);
  if(!isGoneAfterFade) throw new Error('expected the overlay to be fully hidden once the fade-out transition completes');
  console.log('OK: overlay is hidden and cleaned up once the fade-out completes');
  await page.evaluate(() => showCelebration('test'));
  await sleep(200);
  await page.click('#celebration-banner');
  await sleep(750);
  if(!(await page.evaluate(() => document.getElementById('celebration-banner').hidden))) throw new Error('expected a tap to close the celebration early');
  console.log('OK: tapping the celebration closes it early');

  console.log('=== 59: Session Breakdown button generates once, then stays cached and collapsible ===');
  await page.click('.tab:has-text("Overview")');
  await sleep(150);
  if(await page.locator('.coach-head .ai-btn:has-text("Session")').count() !== 1) throw new Error('expected a Session Breakdown button in Coach\'s Notes before any breakdown is generated');
  if(await page.locator('.coach-head .ai-btn:has-text("Weekly")').count() !== 1) throw new Error('expected a separate Weekly Check-in button in Coach\'s Notes');
  // The coach function only serves signed-in accounts, so signed out the button explains that
  // instead of calling it.
  if(!(await page.textContent('#sync-status')).includes('Synced')){
    await page.click('.coach-head .ai-btn:has-text("Session")');
    await waitForText(page, '.card', t => t.includes('Sign in to use AI coaching'), 5000, 'signed-out coach message');
    if(aiBreakdownCallCount !== 0) throw new Error('expected no call to the coach function while signed out, got ' + aiBreakdownCallCount);
    console.log('OK: signed out, the AI buttons ask you to sign in and never call the function');
    await page.fill('#auth-email', EMAIL);
    await page.fill('#auth-password', PASSWORD);
    await page.click('button:has-text("Sign In")');
    await waitForText(page, '#sync-status', t => t.includes('Synced'), 10000, 'sign in before AI breakdown');
  }
  await page.click('.coach-head .ai-btn:has-text("Session")');
  await waitForText(page, '.card', t => t.includes('Mock breakdown headline'), 5000, 'AI breakdown generation');
  if(await page.locator('text=Mock recovery item.').count() !== 1) throw new Error('expected the recovery item to render');
  if(await page.locator('text=Mock improve item.').count() !== 1) throw new Error('expected the how-to-improve item to render');
  if(await page.locator('text=Mock mindful item.').count() !== 1) throw new Error('expected the be-mindful item to render');
  const sessionReq = coachRequests[coachRequests.length - 1];
  if(sessionReq.mode !== 'session' || !sessionReq.payload.date || !sessionReq.payload.tz) throw new Error('expected a session-mode request with the session date and time zone, got: ' + JSON.stringify(sessionReq).slice(0, 300));
  const squatPayload = sessionReq.payload.exercises.find(e => e.name === 'Squat');
  if(!squatPayload || !Array.isArray(squatPayload.history) || squatPayload.history.length > 8 || !squatPayload.appSuggestion) throw new Error('expected each lift to carry up to 8 prior results and the app suggestion, got: ' + JSON.stringify(squatPayload));
  if(!squatPayload.trend || squatPayload.trend.pattern !== 'squat' || typeof squatPayload.trend.sessionsAtCurrentLoad !== 'number') throw new Error('expected a pre-computed trend with the movement pattern per lift, got: ' + JSON.stringify(squatPayload.trend));
  if(!sessionReq.payload.patterns || typeof sessionReq.payload.patterns !== 'object') throw new Error('expected a movement-pattern summary in the session payload');
  const lt = sessionReq.payload.logTimes;
  if(!Array.isArray(lt) || !lt.length || !lt.every(l => l.name && !isNaN(Date.parse(l.at))) || lt.some((l, i) => i && l.at < lt[i-1].at)) throw new Error('expected the session payload to carry each lift\'s log time, oldest first, for the heart-rate split, got: ' + JSON.stringify(lt));
  const timedTrend = await page.evaluate(() => liftTrend("Farmer's Carry", { trackBy: 'weight', unit: 'sec', entries: [
    { date: '2026-09-15', weight: 60, sets: 3, reps: 8 }, { date: '2026-10-01', weight: 60, sets: 3, reps: 40 } ] }, '2026-10-01'));
  if(timedTrend.e1rmChange4WeeksPct !== null || timedTrend.secondsChange4Weeks !== 32) throw new Error('expected timed holds to report a seconds change, not a fake e1RM gain, got: ' + JSON.stringify(timedTrend));
  if(aiBreakdownCallCount !== 1) throw new Error('expected exactly one call to the breakdown function, got ' + aiBreakdownCallCount);
  console.log('OK: clicking Session Breakdown calls the function once and renders the verdict and all three sections');

  await page.reload();
  await waitForText(page, '#sync-status', t => t.includes('Not signed in') || t.includes('Synced'), 10000, 'reload after generating AI breakdown');
  await page.click('.tab:has-text("Overview")');
  await sleep(150);
  if(await page.locator('.ai-panel-head:has-text("Session Breakdown")').count() !== 1) throw new Error('expected the cached breakdown\'s collapsible header to persist across reload');
  if(await page.locator('text=Mock breakdown headline').count() !== 0) throw new Error('expected the cached breakdown to be collapsed by default, not auto-expanded, after reload');
  if(aiBreakdownCallCount !== 1) throw new Error('expected reload to reuse the cached breakdown, not call the function again, got ' + aiBreakdownCallCount + ' total calls');
  console.log('OK: cached breakdown persists across reload, collapsed by default, with no re-fetch');

  await page.click('.ai-panel-head:has-text("Session Breakdown")');
  await sleep(150);
  if(await page.locator('text=Mock breakdown headline').count() !== 1) throw new Error('expected clicking the collapsed header to reveal the cached content');
  console.log('OK: clicking the collapsed header reveals the cached content without re-generating');

  console.log('=== 60: a fresh deployment with no ANTHROPIC_API_KEY set shows setup instructions, not a dead-end retry message ===');
  // Overrides the context-level mock above just for this page - simulates
  // what anyone else pulling this repo and standing up their own Supabase
  // project sees before they've added the secret.
  await page.route('**/functions/v1/coach', route => {
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'anthropic_key_not_configured' }) });
  });
  await page.click('button:has-text("Regenerate")');
  await waitForText(page, '.card', t => t.includes('ANTHROPIC_API_KEY'), 5000, 'missing-key error message');
  const errorCardText = await page.locator('.card').first().textContent();
  if(!errorCardText.includes('Edge Functions')) throw new Error('expected setup instructions pointing at Supabase Edge Function secrets, got: ' + errorCardText);
  console.log('OK: a missing-key error surfaces setup instructions instead of a generic "try again" message');

  console.log('=== 61: the core-workout-complete banner fires for Upper Body and Lower Body too, not just Full Body ===');
  // Scenario 26 only ever exercised Full Body end to end - Upper Body and
  // Lower Body had no direct "does the banner actually fire" coverage,
  // which is exactly how Farmer's Carry silently sitting on both
  // DAY_ORDER.upper and DAY_ORDER.extra went unnoticed (it made Upper
  // Body's banner require an 11th exercise that read, visually, like an
  // Extra-day accessory). Logs every current item in each list fresh and
  // confirms the banner actually appears for both.
  async function fillAndLog(page, name){
    const trackBy = await page.evaluate((n) => data[n] ? data[n].trackBy : newExerciseShell(n).trackBy, name);
    if(trackBy === 'weight') await page.fill('#f-weight', '50');
    else if(trackBy === 'duration') await page.fill('#f-minutes', '20');
    await page.click('button.log:has-text("Log set")');
  }
  await page.evaluate(() => {
    celebratedToday.upper = null;
    celebratedToday.lower = null;
    try{ localStorage.setItem('strength-tracker-celebrated', JSON.stringify(celebratedToday)); }catch(e){}
  });

  await page.click('.tab:has-text("Upper Body")');
  await sleep(150);
  const upperList = await page.evaluate(() => activeDayOrder('upper'));
  if(upperList.includes("Farmer's Carry")) throw new Error('expected Farmer\'s Carry to no longer be required on Upper Body');
  for(const name of upperList){
    await page.locator('.pill').filter({ hasText: new RegExp('\\.\\s*' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($| )') }).first().click();
    await sleep(80);
    await fillAndLog(page, name);
    await sleep(80);
  }
  await sleep(200);
  let upperLowerBannerHidden = await page.evaluate(() => document.getElementById('celebration-banner').hidden);
  let upperLowerBannerText = await page.evaluate(() => document.getElementById('celebration-banner').textContent);
  // Earlier scenarios already logged most of these lifts today, so the banner
  // can fire partway through the loop and fade out before this check. What
  // must hold is that the day was celebrated, and any visible banner names it.
  let celebrated = await page.evaluate(() => celebratedToday.upper === todayISO());
  if(!celebrated || (!upperLowerBannerHidden && !upperLowerBannerText.includes('Upper Body complete'))) throw new Error('expected the Upper Body celebration to fire once every current Upper Body exercise is logged, got celebrated=' + celebrated + ' hidden=' + upperLowerBannerHidden + ' text=' + upperLowerBannerText);
  console.log('OK: Upper Body banner fires with its current (Farmer\'s-Carry-free) exercise list');

  await page.click('.tab:has-text("Lower Body")');
  await sleep(150);
  const lowerList = await page.evaluate(() => activeDayOrder('lower'));
  for(const name of lowerList){
    await page.locator('.pill').filter({ hasText: new RegExp('\\.\\s*' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($| )') }).first().click();
    await sleep(80);
    await fillAndLog(page, name);
    await sleep(80);
  }
  await sleep(200);
  upperLowerBannerHidden = await page.evaluate(() => document.getElementById('celebration-banner').hidden);
  upperLowerBannerText = await page.evaluate(() => document.getElementById('celebration-banner').textContent);
  celebrated = await page.evaluate(() => celebratedToday.lower === todayISO());
  if(!celebrated || (!upperLowerBannerHidden && !upperLowerBannerText.includes('Lower Body complete'))) throw new Error('expected the Lower Body celebration to fire once every Lower Body exercise is logged, got celebrated=' + celebrated + ' hidden=' + upperLowerBannerHidden + ' text=' + upperLowerBannerText);
  console.log('OK: Lower Body banner fires too - all three main muscle-group days confirmed working');

  console.log('=== 62: AI breakdowns sync to the ai_breakdowns table and restore onto a wiped phone ===');
  // The cloud copy is what outlive's strength-sync reads, so one generated
  // breakdown shows up in both apps without a second AI call.
  await page.click('.tab:has-text("Overview")');
  await sleep(150);
  if(!(await page.textContent('#sync-status')).includes('Synced')){
    await page.fill('#auth-email', EMAIL);
    await page.fill('#auth-password', PASSWORD);
    await page.click('button:has-text("Sign In")');
  }
  await waitForText(page, '#sync-status', t => t.includes('Synced'), 10000, 'breakdown sync');
  const localBreakdownDates = await page.evaluate(() => Object.keys(aiBreakdowns));
  if(!localBreakdownDates.length) throw new Error('expected a cached breakdown from scenario 59 to exist locally');
  const cloudBreakdowns = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__mock_supabase_db__')).ai_breakdowns || []);
  const cloudRow = cloudBreakdowns.find(r => r.session_date === localBreakdownDates[0]);
  if(!cloudRow || cloudRow.kind !== 'session' || !cloudRow.breakdown.verdict.startsWith('Mock breakdown headline')) throw new Error('expected the breakdown to be saved to the ai_breakdowns table, got: ' + JSON.stringify(cloudBreakdowns));
  if('generatedAt' in cloudRow.breakdown || !cloudRow.generated_at) throw new Error('expected generatedAt stored in its own generated_at column, not inside the breakdown JSON');
  console.log('OK: breakdown saved to the cloud ai_breakdowns table');

  const callsBeforeRestore = aiBreakdownCallCount;
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await waitForText(page, '#sync-status', t => t.includes('Not signed in'), 5000, 'after wipe reload (breakdowns)');
  await page.click('.tab:has-text("Overview")');
  await page.fill('#auth-email', EMAIL);
  await page.fill('#auth-password', PASSWORD);
  await page.click('button:has-text("Sign In")');
  await waitForText(page, '#sync-status', t => t.includes('Synced'), 10000, 'post-wipe breakdown restore');
  const restoredBreakdown = await page.evaluate((d) => aiBreakdowns[d], localBreakdownDates[0]);
  if(!restoredBreakdown || !restoredBreakdown.verdict.startsWith('Mock breakdown headline')) throw new Error('expected the breakdown to be restored from the cloud after a wipe, got: ' + JSON.stringify(restoredBreakdown));
  if(aiBreakdownCallCount !== callsBeforeRestore) throw new Error('expected restore to come from the cloud, not a new AI call');
  console.log('OK: breakdown restored from the cloud onto a wiped phone with no new AI call');

  console.log('=== 63: Weekly Check-in is a separate button with its own request, cache and cloud row ===');
  await page.unroute('**/functions/v1/coach'); // drop scenario 60's missing-key override
  await page.click('.tab:has-text("Overview")');
  await sleep(150);
  const callsBeforeWeekly = aiBreakdownCallCount;
  await page.click('.coach-head .ai-btn:has-text("Weekly")');
  await waitForText(page, 'body', t => t.includes('Mock weekly verdict.'), 5000, 'weekly check-in generation');
  if(aiBreakdownCallCount !== callsBeforeWeekly + 1) throw new Error('expected exactly one coach call for the weekly check-in');
  const weeklyReq = coachRequests[coachRequests.length - 1];
  if(weeklyReq.mode !== 'weekly' || !weeklyReq.payload.weekEnd || !weeklyReq.payload.weekStart || !weeklyReq.payload.exercises.length) throw new Error('expected a weekly-mode request with the week window and lift history, got: ' + JSON.stringify(weeklyReq).slice(0, 300));
  if(!weeklyReq.payload.patterns || !weeklyReq.payload.exercises.every(e => 'trend' in e)) throw new Error('expected pattern summary and per-lift trends in the weekly payload');
  if(!weeklyReq.payload.exercises.every(e => Array.isArray(e.entries) && e.entries.every(x => x.slice(0, 10) >= weeklyReq.payload.weekEnd.slice(0, 4)))) throw new Error('expected compact dated entries per lift');
  if(await page.locator('text=Mock weekly training item.').count() !== 1 || await page.locator('text=Mock next-week item.').count() !== 1) throw new Error('expected the weekly sections to render');
  if(await page.locator('text=Mock breakdown headline').count() !== 0) throw new Error('expected the session breakdown to stay collapsed while the weekly check-in shows');
  await waitForText(page, '#sync-status', t => t.includes('Synced'), 10000, 'weekly check-in sync');
  const weeklyRow = await page.evaluate((d) => (JSON.parse(sessionStorage.getItem('__mock_supabase_db__')).ai_breakdowns || []).find(r => r.kind === 'weekly' && r.session_date === d), weeklyReq.payload.weekEnd);
  if(!weeklyRow || weeklyRow.breakdown.verdict !== 'Mock weekly verdict.') throw new Error('expected the weekly check-in saved as its own ai_breakdowns row');
  await page.reload();
  await waitForText(page, '#sync-status', t => t.includes('Synced'), 10000, 'reload after weekly check-in');
  await page.click('.tab:has-text("Overview")');
  await sleep(150);
  if(await page.locator('.ai-panel-head:has-text("Weekly Check-in")').count() !== 1) throw new Error('expected this week\'s check-in to persist as a collapsed panel below the notes');
  const headRow = await page.evaluate(() => {
    const row = document.querySelector('.coach-head');
    return row ? [...row.children].map(c => c.textContent.replace(/\s+/g, ' ').trim()) : [];
  });
  if(headRow.length !== 3 || !/Coach's Notes/i.test(headRow[0]) || !/AI Session$/.test(headRow[1]) || !/AI Weekly$/.test(headRow[2])) throw new Error('expected Coach\'s Notes and both AI buttons in one header row, got: ' + JSON.stringify(headRow));
  const headBox = await page.evaluate(() => {
    const row = document.querySelector('.coach-head');
    const kids = [...row.children].map(c => c.getBoundingClientRect());
    return { rowW: row.getBoundingClientRect().width, tops: kids.map(k => Math.round(k.top)), heights: kids.map(k => Math.round(k.height)), right: Math.round(Math.max(...kids.map(k => k.right)) - row.getBoundingClientRect().right) };
  });
  if(Math.max(...headBox.heights) > 30 || headBox.right > 1) throw new Error('expected the title and both AI buttons to fit on one line inside the card, got: ' + JSON.stringify(headBox));
  await page.click('.coach-head .ai-btn:has-text("Weekly")');
  await sleep(150);
  if(await page.locator('text=Mock weekly verdict.').count() !== 1) throw new Error('expected tapping the Weekly Check-in button to open the cached panel');
  await page.click('.coach-head .ai-btn:has-text("Weekly")');
  await sleep(150);
  if(await page.locator('text=Mock weekly verdict.').count() !== 0) throw new Error('expected tapping the button again to collapse the panel');
  if(aiBreakdownCallCount !== callsBeforeWeekly + 1) throw new Error('expected reload to reuse the cached check-in, not call the function again');
  console.log('OK: weekly check-in generates on its own button, syncs as kind "weekly", and stays cached for the week');

  console.log('=== 64: preseason-only lifts hide when Preseason Prep is off; Deload Week sits first and overlays the other modifiers ===');
  await page.click('.tab:has-text("Lower Body")');
  await sleep(150);
  const lowerPillsOff = await page.evaluate(() => [...document.querySelectorAll('.pill-row .pill:not(.pill-add)')].map(p => p.textContent));
  if(lowerPillsOff.some(t => /Box Jumps|Trap Bar Jump|Skater Bound|Spanish Squat|Lateral Lunge/.test(t))) throw new Error('expected preseason-only lifts hidden with Preseason Prep off, got: ' + lowerPillsOff.join(' | '));
  await page.evaluate(() => toggleMode('preseason'));
  await sleep(150);
  const lowerPillsOn = await page.evaluate(() => [...document.querySelectorAll('.pill-row .pill:not(.pill-add)')].map(p => p.textContent));
  if(!lowerPillsOn.some(t => t.includes('Box Jumps'))) throw new Error('expected preseason-only lifts to appear once Preseason Prep is on');
  await page.evaluate(() => toggleMode('preseason'));
  await sleep(150);
  console.log('OK: preseason-only lifts appear and disappear with the Preseason Prep toggle');

  await page.click('.tab:has-text("Overview")');
  await sleep(150);
  const modOrder = await page.evaluate(() => {
    const card = [...document.querySelectorAll('.card')].find(c => c.textContent.includes('Training Modifiers'));
    const t = card.textContent;
    return { deload: t.indexOf('Deload Week'), ski: t.indexOf('Ski Season'), status: document.getElementById('deload-status').textContent };
  });
  if(modOrder.deload < 0 || modOrder.deload > modOrder.ski) throw new Error('expected Deload Week to be the first modifier, got: ' + JSON.stringify(modOrder));
  if(!/No deload logged yet/.test(modOrder.status) || !/Next recommended/.test(modOrder.status)) throw new Error('expected deload status to show no prior deload and a next recommended date, got: ' + modOrder.status);

  const before = await page.evaluate(() => {
    const ex = data['Bench Press']; const last = ex.entries[ex.entries.length - 1];
    return { lastWeight: last.weight, lastSets: last.sets };
  });
  await page.click('button:has-text("Deload Week: OFF")');
  await sleep(150);
  const onStatus = await page.textContent('#deload-status');
  if(!/On since/.test(onStatus)) throw new Error('expected the status to show when the deload started, got: ' + onStatus);
  const deloadSug = await page.evaluate(() => computeSuggestion(data['Bench Press'], 'Bench Press'));
  const expectedW = Math.round(before.lastWeight * 0.9 / 2.5) * 2.5;
  if(!deloadSug.deloadWeek || deloadSug.weight !== expectedW || deloadSug.sets >= before.lastSets) throw new Error('expected ~10% lighter and fewer sets in deload, got: ' + JSON.stringify(deloadSug) + ' from ' + JSON.stringify(before));
  const kneeWasOn = await page.evaluate(() => modes.knee);
  if(!kneeWasOn) await page.evaluate(() => { toggleMode('knee'); });
  const careSug = await page.evaluate(() => {
    const normal = (() => { const m = modes.deload; modes.deload = false; const r = computeSuggestion(data['Squat'], 'Squat'); modes.deload = m; return r; })();
    return { normal, deload: computeSuggestion(data['Squat'], 'Squat') };
  });
  if(!careSug.normal.careFlags || !careSug.deload.deloadKeptReduction || careSug.deload.weight !== careSug.normal.weight) throw new Error('expected a knee-care lift to keep its care weight under deload instead of a second cut, got: ' + JSON.stringify(careSug));
  if(!kneeWasOn) await page.evaluate(() => { toggleMode('knee'); });

  await page.click('.tab:has-text("Full Body")');
  await page.locator('.pill').filter({ hasText: /^2\.\s*Bench Press/ }).click();
  await sleep(100);
  if(await page.locator('.ex-name .deload-badge').count() !== 1) throw new Error('expected a Deload badge on the exercise card');
  await page.fill('#f-weight', String(expectedW));
  await page.fill('#f-sets', '2');
  await page.fill('#f-reps', '8');
  await page.click('button.log:has-text("Log set")');
  await sleep(150);
  await page.click('.tab:has-text("Overview")');
  await page.click('button:has-text("Deload Week: ON")');
  await sleep(150);
  const afterSug = await page.evaluate(() => computeSuggestion(data['Bench Press'], 'Bench Press'));
  if(afterSug.deloadWeek || afterSug.weight < before.lastWeight) throw new Error('expected progression to resume from the pre-deload weight after switching deload off, got: ' + JSON.stringify(afterSug));
  const offStatus = await page.textContent('#deload-status');
  if(!/Last deload:/.test(offStatus) || !/Next recommended: .*in \d+ day/.test(offStatus)) throw new Error('expected the last deload and the next due date after switching it off, got: ' + offStatus);
  await waitForText(page, '#sync-status', t => t.includes('Synced'), 10000, 'deload settings sync');
  const settingsRow = await page.evaluate(() => (JSON.parse(sessionStorage.getItem('__mock_supabase_db__')).user_settings || [])[0]);
  if(!settingsRow || !settingsRow.deload_started_on || !settingsRow.deload_ended_on || settingsRow.deload_mode !== false) throw new Error('expected deload dates synced to user_settings, got: ' + JSON.stringify(settingsRow));
  console.log('OK: Deload Week is first, cuts load and sets, respects care-mode cuts, skips deload sessions afterward, and syncs its dates');

  console.log('=== 65: Kettlebell Swings cap at 35 lb, deload messages carry the RPE 6 cap, and a deload ends itself after a week ===');
  const kbSug = await page.evaluate(() => {
    const saved = { knee: modes.knee, back: modes.back, deload: modes.deload };
    modes.knee = false; modes.back = false; modes.deload = false;
    const mk = reps => ({ trackBy: 'weight', targetReps: 12, entries: [
      { date: '2026-09-20', weight: 35, sets: 3, reps, difficulty: 6 }, { date: '2026-09-28', weight: 35, sets: 3, reps, difficulty: 6 } ] });
    const out = { mid: computeSuggestion(mk(12), 'Kettlebell Swings'), cap: computeSuggestion(mk(20), 'Kettlebell Swings') };
    Object.assign(modes, saved);
    return out;
  });
  if(kbSug.mid.weight !== 35 || kbSug.mid.reps !== 14 || !kbSug.mid.atMaxWeight) throw new Error('expected swings to stay at 35 lb and progress by reps, got: ' + JSON.stringify(kbSug.mid));
  if(kbSug.cap.weight !== 35 || !kbSug.cap.atRepCap) throw new Error('expected swings at 20 reps to point at a harder variation, got: ' + JSON.stringify(kbSug.cap));
  console.log('OK: Kettlebell Swings never suggest more than 35 lb, progress by reps, then point to single-arm swings');

  if(!(await page.evaluate(() => modes.deload))) await page.evaluate(() => toggleMode('deload'));
  await page.click('.tab:has-text("Full Body")');
  await page.locator('.pill').filter({ hasText: /^2\.\s*Bench Press/ }).click();
  await sleep(100);
  const deloadMsg = await page.locator('.rec-box').first().textContent();
  if(!/RPE 6, 3 to 4 reps short of failure/.test(deloadMsg)) throw new Error('expected the deload message to carry the RPE 6 effort cap, got: ' + deloadMsg);
  await page.evaluate(() => { deloadDates.plannedEndOn = shiftISO(todayISO(), -1); saveDeloadDates(); checkDeloadAutoEnd(); });
  await sleep(150);
  const autoEnded = await page.evaluate(() => ({ on: modes.deload, modal: !document.getElementById('deload-modal').hidden }));
  if(autoEnded.on || !autoEnded.modal) throw new Error('expected the deload to switch itself off after a week and show the popup, got: ' + JSON.stringify(autoEnded));
  await page.click('#deload-modal button:has-text("Keep it on another week")');
  await sleep(150);
  const kept = await page.evaluate(() => ({ on: modes.deload, planned: deloadDates.plannedEndOn, expected: shiftISO(todayISO(), 7), modal: !document.getElementById('deload-modal').hidden }));
  if(!kept.on || kept.planned !== kept.expected || kept.modal) throw new Error('expected "keep it on" to restore the deload for another week, got: ' + JSON.stringify(kept));
  await page.evaluate(() => toggleMode('deload'));
  console.log('OK: deload messages carry the RPE 6 cap; a deload ends itself after a week and the popup can keep it on another week');

  console.log('=== 66: sync status lives in the header corner, hidden when synced, shown for trouble, never shifts the page ===');
  const syncShown = () => page.evaluate(() => getComputedStyle(document.getElementById('sync-status')).opacity === '1');
  const tabsTop = () => page.evaluate(() => document.getElementById('tabs').getBoundingClientRect().top);
  await waitForText(page, '#sync-status', t => t.includes('Synced'), 15000, 'synced before scenario 66');
  await sleep(3200);
  if(await syncShown()) throw new Error('expected the sync status to be hidden once steady-state synced');
  const topSynced = await tabsTop();
  await page.evaluate(() => { pendingQueue.push({ type: 'noop-test' }); lastFlushHadFailures = true; renderSyncStatus(); });
  await sleep(400);
  if(!(await syncShown())) throw new Error('expected the sync status to show while sync is having trouble');
  if(await tabsTop() !== topSynced) throw new Error('expected showing the sync status not to move the page');
  await page.evaluate(() => { pendingQueue.pop(); lastFlushHadFailures = false; renderSyncStatus(); });
  await sleep(400);
  if(!(await syncShown())) throw new Error('expected "Synced" to flash after recovering');
  await sleep(3000);
  if(await syncShown()) throw new Error('expected the "Synced" flash to fade after a couple of seconds');
  console.log('OK: sync status hides when synced, shows for trouble, flashes "Synced" on recovery, and never moves the page');

  console.log('=== 67: each logged set records when it was logged; the coach gets the actual exercise order vs the plan ===');
  await page.click('.tab:has-text("Lower Body")');
  await page.locator('.pill').filter({ hasText: /^1\.\s*Squat/ }).click();
  await page.fill('#f-weight', '135');
  await page.click('button.log');
  await sleep(150);
  const logged = await page.evaluate(() => {
    const e = data['Squat'].entries[data['Squat'].entries.length - 1];
    return { at: e.loggedAt, row: entryToRow(e, 'x', 'y').logged_at };
  });
  if(!logged.at || Math.abs(Date.now() - Date.parse(logged.at)) > 60000 || logged.row !== logged.at) throw new Error('expected a fresh loggedAt that syncs as logged_at, got: ' + JSON.stringify(logged));
  const legacyRow = await page.evaluate(() => 'logged_at' in JSON.parse(JSON.stringify(entryToRow({ clientId: 'old', date: '2026-01-01' }, 'x', 'y'))));
  if(legacyRow) throw new Error('expected entries without loggedAt to leave logged_at out of the upsert, so an edit never wipes the server backfill');
  const order = await page.evaluate(() => {
    const saved = JSON.stringify(data);
    const d = '2026-03-03';
    const add = (name, t) => { (data[name] ||= newExerciseShell(name)).entries.push({ clientId: 'ord-' + name, date: d, weight: 100, sets: 3, reps: 8, loggedAt: '2026-03-03T17:' + t + ':00.000Z' }); };
    add('Squat', '00'); add('RDL', '10'); add('Hip Thrust', '20'); add('Bulgarian Split Squat', '30'); add('Walking Lunge', '40');
    const out = { order: sessionOrder(d), payload: buildSessionCoachPayload(d).order };
    data['RDL'].entries.find(e => e.date === d).loggedAt = undefined;
    out.unknown = sessionOrder(d);
    data = JSON.parse(saved);
    return out;
  });
  if(!order.order || !order.order.logged.startsWith('Squat (#1), RDL (#2), Hip Thrust (#4), Bulgarian Split Squat (#3)')) throw new Error('expected the logged order with planned numbers, got: ' + JSON.stringify(order.order));
  if(JSON.stringify(order.order.outOfOrder) !== JSON.stringify(['Hip Thrust', 'Bulgarian Split Squat'])) throw new Error('expected Hip Thrust and Bulgarian Split Squat flagged as swapped, got: ' + JSON.stringify(order.order.outOfOrder));
  if(!order.payload || order.payload.logged !== order.order.logged) throw new Error('expected the session coach payload to carry the order');
  if(order.unknown !== null) throw new Error('expected no order when an entry that day predates order tracking');
  console.log('OK: sets carry loggedAt, the coach sees Squat #1, RDL #2, Hip Thrust #4, Bulgarian Split Squat #3 and which two were swapped');

  console.log('=== 68: a local save the phone refuses (storage full) shows in the sync status until saves work again ===');
  const storage = await page.evaluate(() => {
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function(){ throw new DOMException('full', 'QuotaExceededError'); };
    const ok = persist();
    const shown = { ok, text: document.getElementById('sync-status').textContent, warn: document.getElementById('sync-status').classList.contains('warn') };
    Storage.prototype.setItem = real;
    persist();
    shown.after = document.getElementById('sync-status').textContent;
    return shown;
  });
  if(storage.ok !== false || !storage.text.includes("Couldn't save on this phone") || !storage.warn) throw new Error('expected a refused save to show a warning in the sync status, got: ' + JSON.stringify(storage));
  if(storage.after.includes("Couldn't save")) throw new Error('expected the warning to clear once a save succeeds, got: ' + storage.after);
  console.log('OK: a refused local save shows "Couldn\'t save on this phone" and clears on the next good save');

  console.log('=== 69: the log form starts on the modifier plan when one applies, otherwise the next progression ===');
  await page.evaluate(() => { MODE_DEFS.forEach(m => { if(modes[m.key]) toggleMode(m.key); }); });
  await page.click('.tab:has-text("Full Body")');
  const readForm = () => page.evaluate(() => ({
    weight: document.getElementById('f-weight') && document.getElementById('f-weight').value,
    sets: document.getElementById('f-sets') && document.getElementById('f-sets').value,
    reps: document.getElementById('f-reps') && document.getElementById('f-reps').value,
    note: (document.querySelector('.prefill-note') || {}).textContent || '',
  }));
  const planFor = name => page.evaluate(n => { const s = computeSuggestion(data[n], n); return { weight: String(s.weight), sets: String(s.sets), reps: String(s.reps) }; }, name);
  await page.locator('.pill').filter({ hasText: /^1\.\s*Squat/ }).click();
  await sleep(100);
  const plain = await readForm(), plainPlan = await planFor('Squat');
  if(plain.weight !== plainPlan.weight || plain.sets !== plainPlan.sets || plain.reps !== plainPlan.reps || plain.note !== 'Pre-filled: next progression') throw new Error('expected every modifier off to pre-fill the next progression ' + JSON.stringify(plainPlan) + ', got: ' + JSON.stringify(plain));
  await page.evaluate(() => toggleMode('knee'));
  await page.locator('.pill').filter({ hasText: /^1\.\s*Squat/ }).click();
  await sleep(100);
  const knee = await readForm(), kneePlan = await planFor('Squat');
  if(knee.weight !== kneePlan.weight || knee.sets !== kneePlan.sets || knee.reps !== kneePlan.reps || !knee.note.includes('Knee Care')) throw new Error('expected Knee Care to pre-fill Squat with its plan ' + JSON.stringify(kneePlan) + ', got: ' + JSON.stringify(knee));
  await page.evaluate(() => toggleMode('deload'));
  await page.locator('.pill').filter({ hasText: /^1\.\s*Squat/ }).click();
  await sleep(100);
  const both = await readForm(), bothPlan = await planFor('Squat');
  if(both.weight !== bothPlan.weight || both.sets !== bothPlan.sets || both.reps !== bothPlan.reps || !both.note.includes('Deload Week, Knee Care')) throw new Error('expected Deload plus Knee Care to pre-fill the combined plan ' + JSON.stringify(bothPlan) + ', got: ' + JSON.stringify(both));
  await page.evaluate(() => toggleMode('deload'));
  await page.locator('.pill').filter({ hasText: /^2\.\s*Bench Press/ }).click();
  await sleep(100);
  const bench = await readForm(), benchPlan = await planFor('Bench Press');
  if(bench.weight !== benchPlan.weight || bench.note !== 'Pre-filled: next progression') throw new Error('expected Bench Press (not knee-flagged) to pre-fill its plain progression under Knee Care, got: ' + JSON.stringify(bench));
  await page.evaluate(() => toggleMode('knee'));
  const backExt = await page.evaluate(() => {
    const ex = data['Back Extension'] ||= newExerciseShell('Back Extension');
    const saved = ex.entries;
    ex.entries = [{ clientId: 'be1', date: '2026-09-20', weight: 25, sets: 3, reps: 12 }];
    selected = 'Back Extension'; view = 'full'; render();
    const out = { reps: document.getElementById('f-reps').value, weight: document.getElementById('f-weight').value };
    ex.entries = saved; render();
    return out;
  });
  if(backExt.reps !== '12' || !backExt.weight) throw new Error('expected Back Extension to keep carrying its last reps (12) with a pre-filled weight, got: ' + JSON.stringify(backExt));
  console.log('OK: the form pre-fills the modifier plan when one applies, otherwise the next progression, and says which; Back Extension keeps its last reps');

  console.log('=== 70: a weight written in last session\'s note sets the next one; jumps and bounds hold their reps ===');
  const noteCases = await page.evaluate(() => [
    ['Dial to 50!', 60], ['60 sec intervals. Good to move up to 180', 175], ['Good for 150 next', 130], ['Ok for 15 lbs', 0],
    ['next 155', 150], ['try 52.5', 50], ['drop back to 135', 155], ['Next time 47.5', 45],
    ['60 sec intervals', 175], ['Felt heavy, stay', 150], ['Good to move up', 150], ['Stay one set', 150], ['Go to 10 reps', 40],
    ['3x8 felt easy', 135], ['Maxing out, deload again next', 37.5], ['Pail in left front shoulder on curl', 30], ['move up to 500', 175], ['try 90 sec rest', 60],
    ['felt heavy, next: 185', 175], ['Next: 3 sets', 175],
  ].map(([note, w]) => noteTargetWeight(note, w)));
  const wantNotes = [50, 180, 150, 15, 155, 52.5, 135, 47.5, null, null, null, null, null, null, null, null, null, null, 185, null];
  if(JSON.stringify(noteCases) !== JSON.stringify(wantNotes)) throw new Error('note weight parsing mismatch: ' + JSON.stringify(noteCases));
  const noteSug = await page.evaluate(() => {
    const mk = (entries, extra) => Object.assign({ trackBy: 'weight', targetReps: 8, increment: 5, entries }, extra || {});
    const saved = { ...modes };
    MODE_DEFS.forEach(m => { modes[m.key] = false; });
    const bss = computeSuggestion(mk([{ date: '2026-09-23', weight: 45, sets: 3, reps: 8, difficulty: 7 }, { date: '2026-09-28', weight: 60, sets: 3, reps: 6, difficulty: 8, note: 'Dial to 50!' }]), 'Bulgarian Split Squat');
    const squatUp = computeSuggestion(mk([{ date: '2026-10-02', weight: 175, sets: 3, reps: 8, difficulty: 7, note: '60 sec intervals. Good to move up to 180' }]), 'Squat');
    modes.knee = true;
    const kneeHigher = computeSuggestion(mk([{ date: '2026-10-02', weight: 175, sets: 3, reps: 8, note: 'move up to 180' }]), 'Squat');
    const kneeLower = computeSuggestion(mk([{ date: '2026-10-02', weight: 175, sets: 3, reps: 8, note: 'drop to 135' }]), 'Squat');
    modes.knee = false;
    const box = computeSuggestion(Object.assign(newExerciseShell('Box Jumps'), { entries: [{ date: '2026-10-02', weight: 0, sets: 4, reps: 3, difficulty: 4 }] }), 'Box Jumps');
    const skater = computeSuggestion(Object.assign(newExerciseShell('Skater Bound'), { entries: [{ date: '2026-10-02', weight: 0, sets: 3, reps: 6, difficulty: 6 }] }), 'Skater Bound');
    Object.assign(modes, saved);
    return { bss: [bss.weight, bss.noteTarget, bss.deload], squatUp: [squatUp.weight, squatUp.readyToProgress], kneeHigher: kneeHigher.weight, kneeLower: kneeLower.weight, box: [box.sets, box.reps, !!box.powerHold], skater: [skater.sets, skater.reps] };
  });
  const wantSug = { bss: [50, 50, false], squatUp: [180, true], kneeHigher: 157.5, kneeLower: 135, box: [4, 3, true], skater: [3, 4] };
  if(JSON.stringify(noteSug) !== JSON.stringify(wantSug)) throw new Error('expected note targets and power holds ' + JSON.stringify(wantSug) + ', got: ' + JSON.stringify(noteSug));
  console.log('OK: "Dial to 50!" sets 50, "move up to 180" sets 180, Knee Care lets a note lower but not raise the load, and jumps/bounds hold their target reps');

  console.log('=== 71: every exercise says whether its weight and reps are per hand, per side, per leg or total ===');
  const sides = await page.evaluate(() => {
    const read = name => {
      const ex = data[name] || (data[name] = newExerciseShell(name));
      const saved = ex.entries;
      ex.entries = [{ clientId: 'sd-' + name, date: '2026-09-20', weight: 40, sets: 3, reps: 8, difficulty: 7 }];
      const div = document.createElement('div');
      div.innerHTML = renderExerciseCard(name, ex);
      ex.entries = saved;
      return { labels: [...div.querySelectorAll('.form-row .field label')].map(l => l.textContent), next: div.querySelector('.rec-headline').textContent };
    };
    return { bss: read('Bulgarian Split Squat'), squat: read('Squat'), fly: read('Cable Chest Fly'), copen: read('Copenhagen Plank') };
  });
  if(!sides.bss.labels.includes('Lb / hand') || !sides.bss.labels.includes('Reps / leg') || !/lbs\/hand · 3x8\/leg/.test(sides.bss.next)) throw new Error('expected Bulgarian Split Squat labeled per hand and per leg, got: ' + JSON.stringify(sides.bss));
  if(!sides.squat.labels.includes('Lb total') || !/lbs total · 3x8/.test(sides.squat.next)) throw new Error('expected Squat labeled total, got: ' + JSON.stringify(sides.squat));
  if(!sides.fly.labels.includes('Lb / hand')) throw new Error('expected Cable Chest Fly labeled per hand (each stack), got: ' + JSON.stringify(sides.fly));
  if(!sides.copen.labels.includes('Seconds / side') || !/\/side/.test(sides.copen.next)) throw new Error('expected Copenhagen Plank seconds per side, got: ' + JSON.stringify(sides.copen));
  console.log('OK: Bulgarian Split Squat reads lb/hand and reps/leg, Squat lb total, Cable Chest Fly lb/hand, Copenhagen Plank seconds/side');

  console.log('=== 72: preseason extras never block the workout-complete popup on any day, and shared lifts complete a day from any tab ===');
  const gate = await page.evaluate(() => {
    const saved = JSON.stringify(data), savedCeleb = JSON.stringify(celebratedToday), savedPre = modes.preseason;
    const t = todayISO();
    const run = preseasonOn => {
      if(modes.preseason !== preseasonOn) toggleMode('preseason');
      data = JSON.parse(saved);
      Object.keys(data).forEach(n => { data[n].entries = data[n].entries.filter(e => e.date !== t); });
      DAY_ORDER.lower.filter(n => !PRESEASON_ONLY.has(n)).forEach(n => {
        (data[n] ||= newExerciseShell(n)).entries.push({ clientId: 'gate-' + n, date: t, weight: 50, sets: 3, reps: 8 });
      });
      celebratedToday = {};
      checkCoreWorkoutComplete('lower');
      dismissCelebration();
      return celebratedToday.lower === t;
    };
    const out = { on: run(true), off: run(false) };
    // Same for Upper and Full: main lifts alone complete the day.
    ['upper', 'full'].forEach(day => {
      data = JSON.parse(saved);
      Object.keys(data).forEach(n => { data[n].entries = data[n].entries.filter(e => e.date !== t); });
      DAY_ORDER[day].filter(n => !PRESEASON_ONLY.has(n)).forEach(n => {
        (data[n] ||= newExerciseShell(n)).entries.push({ clientId: 'gate-' + day + n, date: t, weight: 50, sets: 3, reps: 8 });
      });
      if(!modes.preseason) toggleMode('preseason');
      celebratedToday = {};
      checkCoreWorkoutComplete(day);
      dismissCelebration();
      out[day] = celebratedToday[day] === t;
    });
    data = JSON.parse(saved); celebratedToday = JSON.parse(savedCeleb);
    if(modes.preseason !== savedPre) toggleMode('preseason');
    render();
    return out;
  });
  if(!gate.on || !gate.off || !gate.upper || !gate.full) throw new Error('expected main lifts alone to complete Lower (Preseason on and off), Upper and Full, got: ' + JSON.stringify(gate));
  console.log('OK: main lifts alone complete Lower, Upper and Full; preseason extras are optional');

  // The last Upper lift logged from the Full Body tab still completes Upper.
  const crossTab = await page.evaluate(() => {
    const saved = JSON.stringify(data), savedCeleb = JSON.stringify(celebratedToday);
    const t = todayISO();
    Object.keys(data).forEach(n => { data[n].entries = data[n].entries.filter(e => e.date !== t); });
    DAY_ORDER.upper.filter(n => !PRESEASON_ONLY.has(n) && n !== 'Bench Press').forEach(n => {
      (data[n] ||= newExerciseShell(n)).entries.push({ clientId: 'x-' + n, date: t, weight: 50, sets: 3, reps: 8 });
    });
    celebratedToday = {};
    view = 'full'; selected = 'Bench Press'; render();
    document.getElementById('f-weight').value = '135';
    logEntry();
    const done = celebratedToday.upper === t;
    dismissCelebration();
    data = JSON.parse(saved); celebratedToday = JSON.parse(savedCeleb); persist(); render();
    return done;
  });
  if(!crossTab) throw new Error('expected logging the last Upper Body lift from the Full Body tab to still complete Upper Body');
  console.log('OK: finishing a day from another tab (shared lift) still fires that day\'s popup');

  console.log('=== 73: plain-language note cues steer the next weight; the log rows share one height ===');
  const cues = await page.evaluate(() => {
    const saved = { ...modes };
    MODE_DEFS.forEach(m => { modes[m.key] = false; });
    const one = (note, cons) => computeSuggestion({ trackBy: 'weight', targetReps: 8, increment: 5, conservative: cons, entries: [
      { date: '2026-09-24', weight: 100, sets: 3, reps: 8, difficulty: 7, note } ] }, 'Bench Press');
    const r = {
      up: one('Good to move up', true), easy: one('Easy', true), easyDay: one('Took an easy day', true),
      stay: one('Felt solid, stay', false), fellApart: one('Fell apart on last set', false), none: one('', false),
    };
    Object.assign(modes, saved);
    return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, [v.weight, v.noteCue || null]]));
  });
  const wantCues = { up: [105, 'up'], easy: [105, 'up'], easyDay: [100, null], stay: [100, 'hold'], fellApart: [100, 'hold'], none: [105, null] };
  if(JSON.stringify(cues) !== JSON.stringify(wantCues)) throw new Error('note cue mismatch, want ' + JSON.stringify(wantCues) + ' got ' + JSON.stringify(cues));
  await page.click('.tab:has-text("Full Body")');
  await page.locator('.pill').filter({ hasText: /^1\.\s*Squat/ }).click();
  await sleep(100);
  const heights = await page.evaluate(() => {
    const h = sel => Math.round(document.querySelector(sel).getBoundingClientRect().height);
    return { btn: h('.action-row .tool-btn'), weight: h('#f-weight'), note: h('#f-note'), date: h('#f-date'), log: h('button.log'),
      noteLabel: !!document.querySelector('.field-note label'), dateLabel: !!document.getElementById('f-date').closest('.field').querySelector('label') };
  });
  const hs = [heights.btn, heights.weight, heights.note, heights.date, heights.log];
  if(Math.max(...hs) - Math.min(...hs) > 1 || heights.noteLabel || heights.dateLabel) throw new Error('expected action buttons, inputs and Log to share one height with no Note/Date labels, got: ' + JSON.stringify(heights));
  console.log('OK: "move up"/"easy" add weight, "stay"/"fell apart" hold, "easy day" does neither; buttons, fields and Log share one height');

  console.log('=== 74: the Next tile is the same size on every exercise, with four rows and two full lines of guidance ===');
  const tiles = await page.evaluate(() => {
    const out = {};
    ['Squat', 'Bicep Curl', 'Incline Treadmill Walk', 'Lateral Raise Test'].forEach(n => {
      const ex = data[n] || newExerciseShell(n);
      const div = document.createElement('div');
      div.style.width = '330px';
      document.body.appendChild(div);
      div.innerHTML = renderExerciseCard(n, ex);
      const t = div.querySelector('.rec-box');
      out[n] = t ? { h: Math.round(t.getBoundingClientRect().height), rows: t.children.length, load: !!t.querySelector('.rec-load').textContent.trim() } : null;
      div.remove();
    });
    return out;
  });
  const tileHs = Object.values(tiles).map(t => t && t.h);
  if(tileHs.some(h => !h) || new Set(tileHs).size !== 1 || Object.values(tiles).some(t => t.rows !== 3 || !t.load)) throw new Error('expected one fixed-size three-block (four-line) Next tile on every exercise, got: ' + JSON.stringify(tiles));
  console.log('OK: Next tile is ' + tileHs[0] + 'px on a barbell lift, a dumbbell lift, cardio and a lift with no history');

  // The guidance always fills both lines with whole sentences, narrow phone or wide: Cable Chest Fly
  // with a short call and clean history used to stop at one line.
  const guide = await page.evaluate(() => {
    const fly = data['Cable Chest Fly'] || newExerciseShell('Cable Chest Fly');
    const saved = fly.entries;
    fly.entries = [{date: shiftISO(todayISO(), -7), weight: 60, sets: 3, reps: 12, difficulty: 7}, {date: shiftISO(todayISO(), -3), weight: 60, sets: 3, reps: 12, difficulty: 7}];
    data['Cable Chest Fly'] = fly;
    const out = [];
    [300, 400].forEach(w => ['Cable Chest Fly', 'Squat', 'Incline Treadmill Walk', 'Dead Hang'].forEach(n => {
      const div = document.createElement('div');
      div.style.width = w + 'px';
      document.body.appendChild(div);
      div.innerHTML = renderExerciseCard(n, data[n] || newExerciseShell(n));
      fitGuidance();
      const d = div.querySelector('.rec-desc');
      d.classList.add('fitting');
      out.push({ w, n, lines: Math.round(d.scrollHeight / parseFloat(getComputedStyle(d).lineHeight)), text: d.textContent.trim() });
      d.classList.remove('fitting');
      div.remove();
    }));
    fly.entries = saved;
    return out;
  });
  const short = guide.filter(g => g.lines !== 2 || !/\.$/.test(g.text));
  if(short.length) throw new Error('expected two full lines of whole-sentence guidance on every tile, got: ' + JSON.stringify(short));
  console.log('OK: guidance fills exactly two lines at 300px and 400px, e.g. "' + guide[0].text + '"');

  console.log('=== 75: the page, stylesheet and every script load with matching versions and no page errors ===');
  const assets = await page.evaluate(() => ({
    version: APP_VERSION,
    srcs: [...document.querySelectorAll('script[src^="js/"], link[rel="stylesheet"][href^="styles"]')].map(e => e.getAttribute('src') || e.getAttribute('href')),
    styled: getComputedStyle(document.querySelector('header')).position,
  }));
  const want = assets.version.replace(/^v/, '');
  const stale = assets.srcs.filter(u => !u.endsWith('?v=' + want));
  if(assets.srcs.length < 12 || stale.length) throw new Error('expected styles.css and every js/ file tagged ?v=' + want + ' (APP_VERSION), mismatched: ' + JSON.stringify(stale));
  if(assets.styled !== 'relative') throw new Error('expected styles.css to apply, header position is ' + assets.styled);
  if(failedLoads.length) throw new Error('expected every app file to load, failed: ' + failedLoads.join(', '));
  if(pageErrors.length) throw new Error('expected no uncaught page errors, got: ' + pageErrors.join(' | '));
  console.log('OK: ' + assets.srcs.length + ' files tagged ?v=' + want + ', all loaded, no page errors');

  console.log('\nALL SCENARIOS PASSED');
  await browser.close();
}

// Owns the whole lifecycle - starts the static server this suite needs,
// waits for it to answer, runs every scenario, then tears the server down
// whether the run passed or failed. This is what lets `npm test` (and the
// CI workflow) be a single command with no separate "start the server in
// another terminal" step to remember.
async function run(){
  const serverProcess = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: Object.assign({}, process.env, { TEST_PORT: String(PORT) }),
    stdio: 'inherit',
  });
  let exitCode = 0;
  try{
    await waitForServer(URL);
    await main();
  }catch(e){
    console.error('TEST FAILED:', e);
    exitCode = 1;
  }finally{
    serverProcess.kill();
  }
  process.exit(exitCode);
}

run();
