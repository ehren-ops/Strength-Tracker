// The program: seed data, day lists and order, care-mode lists and tips, exercise defaults and cues, checklist routines.
// Classic script sharing one global scope with the other js/NN-*.js files, run in order.

const SEED = {
  // Intentionally empty - publish this version without personal data baked in.

};

// Preseason additions (exercises with preseason:true in EXERCISE_DEFAULTS)
// sit permanently at the end of these lists rather than being conditionally
// shown/hidden by modes.preseason - only their badges/notes/target reps react
// to the toggle. Position 0 of each list is also the exercise shown by
// default when you open that tab, so power work is deliberately NOT placed
// first here even though it's meant to happen first in the session and
// visually moves to the front of the pill row when modes.preseason is on
// (see getDisplayOrder) - opening a tab should still land on the main lift.
// Preseason day mapping: Lower Body = squat day, Upper Body = upper day,
// Full Body = hinge day (RDL already lives there). Each addition is
// grouped by movement pattern with that day's main lift, not just spread
// evenly across days: Box Jumps/Trap Bar Jump/Skater Bound/Spanish Squat
// (all quad-dominant/squat-pattern) and Lateral Lunge (frontal-plane) go
// with Lower Body; Kettlebell Swings (hip-hinge, mirrors RDL) and Seated
// Calf Raise go with Full Body; Med Ball Slam goes with Upper Body.
// Copenhagen Plank (hip adductor) has no upper-body connection, so it
// lives on Extra instead of a lift day. Farmer's Carry originally lived on
// both Upper Body and Extra - every name in a day's list is a required,
// always-numbered "main lift" for that day's completion banner (see
// checkCoreWorkoutComplete), so being on two lists made it silently
// required on Upper Body while reading, visually, like an Extra accessory.
// Dropped from Upper Body for that reason; it still lives on Extra.
// Kettlebell Swings started on Lower Body (Sep 1) and is back there as the
// second hinge next to RDL, on Lower only for the same one-list reason.
// The preseason-only additions below (PRESEASON_ONLY) are hidden from the
// pill rows, numbering and completion banner whenever Preseason Prep is off
// - see activeDayOrder. Squat, Kettlebell Swings, Standing Calf Raise and
// Farmer's Carry predate preseason and only carry preseason notes, so they
// always show.
const DAY_ORDER = {
  full: ["Squat","Bench Press","Incline DB Press","RDL","Bulgarian Split Squat","Barbell Row","Cable Chest Fly","Face Pulls","Back Extension","Seated Calf Raise"],
  upper: ["Bench Press","Incline DB Press","Cable Chest Fly","Barbell Row","Cable Lat Pulldown","Face Pulls","Bicep Curl","Tricep Pushdown","Back Extension","Med Ball Slam"],
  lower: ["Squat","RDL","Bulgarian Split Squat","Hip Thrust","Kettlebell Swings","Walking Lunge","Standing Calf Raise","Box Jumps","Lateral Lunge","Trap Bar Jump","Skater Bound"],
  // Grouped by type - strength, then cardio, then core, then stretches -
  // rather than the order they were added in, so the row reads as sections
  // instead of a grab-bag. See EXTRA_CATEGORY below for the color coding.
  extra: ["Farmer's Carry","Dead Hang","Spanish Squat","Zone 2 Ride","Incline Treadmill Walk","5-Minute Core Routine","Copenhagen Plank","Thoracic Spine Stretch","Hip Stretch","Leg Stretch","Full Body Stretch"],
};
const PRESEASON_ONLY = new Set(["Box Jumps","Lateral Lunge","Trap Bar Jump","Skater Bound","Seated Calf Raise","Med Ball Slam","Copenhagen Plank"]);
function activeDayOrder(day){
  return DAY_ORDER[day].filter(name => modes.preseason || !PRESEASON_ONLY.has(name));
}
const DAY_TITLES = { full:"Full Body", upper:"Upper Body", lower:"Lower Body", extra:"Extra / Off-Day" };
const CONCERN_WORDS = ["heavy","tender","grip","pain","sore","ache","hurt"];

// Only used to color-code Extra's pill row into visual sections (strength /
// cardio / core / stretch) - purely cosmetic grouping, not a gating flag
// like preseason/ski/knee/back, so it doesn't touch trackBy or sync.
const EXTRA_CATEGORY = {
  "Farmer's Carry": "strength",
  "Dead Hang": "strength",
  "Spanish Squat": "strength",
  "Zone 2 Ride": "cardio",
  "Incline Treadmill Walk": "cardio",
  "5-Minute Core Routine": "core",
  "Copenhagen Plank": "core",
  "Thoracic Spine Stretch": "stretch",
  "Hip Stretch": "stretch",
  "Leg Stretch": "stretch",
  "Full Body Stretch": "stretch",
};

// Fixed classification, not user-editable per exercise - no need for these
// to live on the exercise object or round-trip through Supabase like the
// ski-season fields do.
const KNEE_SENSITIVE_EXERCISES = new Set(["Squat", "Bulgarian Split Squat", "Walking Lunge", "Box Jumps", "Skater Bound"]);
const LOW_BACK_SENSITIVE_EXERCISES = new Set(["Squat", "RDL", "Barbell Row", "Kettlebell Swings", "Hip Thrust"]);
const KNEE_CARE_TIP = {
  "Squat": "Shallower depth or a box squat.",
  "Bulgarian Split Squat": "Less rear-foot elevation or a shorter range.",
  "Walking Lunge": "Shorter steps, less depth.",
  "Box Jumps": "Lower box, softer landing, slow step-down.",
  "Skater Bound": "Shorter bound, skip the landing hold.",
};
const LOW_BACK_CARE_TIP = {
  "Squat": "Lighter load or less depth.",
  "RDL": "Stop at mid-shin, not a full stretch.",
  "Barbell Row": "Chest-supported row instead.",
  "Kettlebell Swings": "Lighter bell, or hip thrust instead.",
  "Hip Thrust": "Swap to a floor glute bridge: ribs down, stop at hip level, no arching.",
};

// One form pointer and one swap per exercise, shown under the Next box. Kept to a few words each
// so the card stays short. The swap is for a busy station or an off day for that joint.
const EXERCISE_TIPS = {
  "Squat": ["Brace, knees track over toes, hips and chest rise together.", "Goblet squat or leg press."],
  "Bench Press": ["Shoulder blades pinned, bar to lower chest, feet driving.", "DB bench or Smith bench."],
  "Incline DB Press": ["30-45° bench, elbows about 45°, control the bottom.", "Landmine press or incline Smith press."],
  "RDL": ["Soft knees, hips back, bar close to the legs, flat back.", "DB RDL or cable pull-through."],
  "Bulgarian Split Squat": ["Slight forward lean, drive through the front heel.", "Reverse lunge or split squat, back foot down."],
  "Hip Thrust": ["Upper back on the bench, ribs down, 1 sec squeeze at the top.", "Floor glute bridge with the bar, or Smith hip thrust."],
  "Barbell Row": ["Hinge about 45°, brace, pull to the lower ribs, no jerk.", "Chest-supported DB row or seated cable row."],
  "Cable Chest Fly": ["Soft elbows locked in place, squeeze at the middle.", "DB fly or pec deck."],
  "Face Pulls": ["Rope to the eyes, elbows high, thumbs back at the end.", "Band pull-apart or reverse fly."],
  "Back Extension": ["Hinge at the hips, squeeze glutes, stop at a straight line.", "Reverse hyper or light good morning."],
  "Seated Calf Raise": ["Full stretch at the bottom, 1 sec pause, slow lower.", "Smith seated calf raise or DB on the knees."],
  "Cable Lat Pulldown": ["Chest up, elbows to back pockets, no swinging back.", "Assisted pull-up or single-arm pulldown."],
  "Bicep Curl": ["Elbows pinned, no swing, slow on the way down.", "Hammer curl or cable curl."],
  "Tricep Pushdown": ["Elbows tucked, full lockout, control the return.", "Overhead cable extension or close-grip push-up."],
  "Med Ball Slam": ["Reach tall, slam with the hips and abs, every rep fast.", "Kettlebell swing or rope slams."],
  "Kettlebell Swings": ["Hinge, not squat; snap the hips, arms only guide.", "Cable pull-through or DB swing."],
  "Walking Lunge": ["Long step, back knee near the floor, torso tall.", "Reverse lunge in place or step-ups."],
  "Standing Calf Raise": ["Straight knees, full stretch, pause at the top.", "Smith or leg-press calf raise."],
  "Box Jumps": ["Land soft and quiet in a half squat, step down.", "Squat jumps or fast low step-ups."],
  "Lateral Lunge": ["Sit back into the bent hip, other leg straight, chest up.", "Cossack squat or lateral band walk."],
  "Trap Bar Jump": ["Jump tall, land soft, reset before each rep.", "DB jump or bodyweight squat jump."],
  "Skater Bound": ["Push sideways off the outside leg, stick the landing.", "Lateral line hops or lateral step-ups."],
  "Spanish Squat": ["3x10 banded: band behind the knees, sit straight down, 3 sec hold.", "Wall sit or slow box squat."],
  "Farmer's Carry": ["Tall posture, shoulders packed, short quick steps.", "Suitcase carry or trap bar hold."],
  "Dead Hang": ["Active shoulders, full grip, steady breathing.", "Assisted hang with feet on a box."],
  "Copenhagen Plank": ["Hips high, body straight, top leg does the work.", "Knee-on-bench version or side plank."],
  "Lateral Raise": ["Slight lean, lead with the elbows, stop at shoulder height.", "Cable or machine lateral raise."],
  "Zone 2 Ride": ["Conversational pace, steady cadence.", "Rower or incline walk at the same effort."],
  "Incline Treadmill Walk": ["No handrails, tall posture, steady pace.", "Stair climber or Zone 2 bike."],
};

// What the logged numbers mean, so a one-arm or one-leg lift is never ambiguous. weight: "hand"
// (each dumbbell, or each cable stack on a two-handle fly) or "total" (bar, stack, bell, ball, a
// single dumbbell held in both hands, or both dumbbells added together, as on calf raises). reps: "leg" or "side" for one-sided work, else
// "total". Anything not listed is total for both. Shown on the form labels, the Next line, the big
// number, the history header and in the coach's data.
const EXERCISE_SIDES = {
  "Incline DB Press": { weight: "hand" },
  "Bulgarian Split Squat": { weight: "hand", reps: "leg" },
  "Walking Lunge": { weight: "hand", reps: "steps" },  // reps are total steps, both legs together
  "Lateral Lunge": { reps: "side" },
  "Farmer's Carry": { weight: "hand" },
  "Bicep Curl": { weight: "hand" },
  "Lateral Raise": { weight: "hand" },
  "Cable Chest Fly": { weight: "hand" },
  "Skater Bound": { reps: "side" },
  "Copenhagen Plank": { reps: "side" },
};

// Every value ex.trackBy can ever hold. This list MUST stay in sync by hand
// with the Postgres check constraint exercises_track_by_check on the
// "exercises" table (Supabase project eixbpujqsectkstkqllz) - the two are
// not connected by any code, only by a person (or Claude) remembering to
// update both. Adding a new trackBy value below without also migrating
// that constraint doesn't fail loudly: the app queues the sync op fine,
// but the database rejects every attempt forever, and the only symptom is
// a growing "pending" count with no error visible anywhere in the UI. This
// exact bug shipped once already (the "checklist" type for stretch/core
// routines) and took real user data getting stuck to catch. The
// VALID_TRACK_BY_VALUES check in the Playwright suite (test2.js) asserts
// every trackBy actually used in EXERCISE_DEFAULTS/SEED appears in this
// list, so a typo or a forgotten entry here fails the regression run - but
// nothing catches a value that's in this list while the database migration
// was simply never written. Always pair a new entry here with:
//   alter table public.exercises drop constraint exercises_track_by_check;
//   alter table public.exercises add constraint exercises_track_by_check
//     check (track_by = any (array[...ALL values here...]));
const VALID_TRACK_BY_VALUES = ["weight", "duration", "reps", "checklist"];

// Built-in exercises that shouldn't default to weight/sets/reps when first
// created - cardio work is logged by time, distance, and incline instead.
const EXERCISE_DEFAULTS = {
  "Zone 2 Ride": { trackBy: "duration", trackDistance: true, trackSpeed: true },
  "Incline Treadmill Walk": { trackBy: "duration", trackDistance: true, trackIncline: true, trackSpeed: true },
  "Squat": {
    targetRepsSki: 5, skiTempo: "3-4 sec eccentric descent", equipment: "barbell",
    preseason: true, targetRepsPreseason: 5, preseasonTempo: "4 sec lowering",
  },
  "Bulgarian Split Squat": { targetRepsSki: 6, skiTempo: "3-4 sec eccentric descent per leg" },
  "Walking Lunge": { targetRepsSki: 8, skiTempo: "2-3 sec controlled descent each step" },
  "Bench Press": { equipment: "barbell" },
  "RDL": { equipment: "barbell" },
  "Hip Thrust": { equipment: "barbell", targetReps: 10 },
  "Barbell Row": { equipment: "barbell" },
  "Back Extension": { trackBy: "weight", autoloadLastReps: true },
  "Farmer's Carry": { unit: "sec", targetReps: 40, preseason: true, preseasonNote: "3x8 @ 60 lb, keep building load." },
  "Kettlebell Swings": { maxWeight: 35, preseason: true, preseasonPower: true, preseasonNote: "Power: do this first. 4x10 at 35 lb; add reps, then go single-arm." },
  "Standing Calf Raise": { trackBy: "weight", targetReps: 15, preseason: true, preseasonNote: "3x15, loaded. Log the total: both dumbbells added together, or the bar." },
  "Box Jumps": { trackBy: "reps", targetReps: 3, preseason: true, preseasonPower: true, preseasonNote: "4x3, 12-18 in box. Step down, never jump down; stop if speed drops. Gentler: slow 3 sec step-down." },
  "Med Ball Slam": { trackBy: "weight", targetReps: 6, preseason: true, preseasonPower: true, preseasonNote: "3x6, 10-15 lb. Stop if speed drops." },
  "Lateral Lunge": { trackBy: "weight", targetReps: 8, preseason: true, preseasonNote: "3x8 per side, bodyweight up to 30 lb DB." },
  "Copenhagen Plank": { trackBy: "reps", unit: "sec", targetReps: 20, preseason: true, preseasonNote: "3x20 sec per side, adductors." },
  "Dead Hang": { trackBy: "reps", unit: "sec", targetReps: 45 },
  "Seated Calf Raise": { trackBy: "weight", targetReps: 15, preseason: true, preseasonNote: "3x15, soleus for boot control." },
  "Trap Bar Jump": { trackBy: "weight", targetReps: 3, preseason: true, preseasonWeek3: true, preseasonPower: true, preseasonNote: "4x3 @ 95-135 lb. Stop if speed drops." },
  "Skater Bound": { trackBy: "reps", targetReps: 4, preseason: true, preseasonWeek3: true, preseasonPower: true, preseasonNote: "3x4 per side, stick each landing 2 sec." },
  "Spanish Squat": { trackBy: "reps", targetReps: 10, preseason: false, preseasonWeek3: false },
  "Thoracic Spine Stretch": { trackBy: "checklist" },
  "Hip Stretch": { trackBy: "checklist" },
  "Leg Stretch": { trackBy: "checklist" },
  "Full Body Stretch": { trackBy: "checklist" },
  "5-Minute Core Routine": { trackBy: "checklist" },
};

// Content for the checklist-type "exercises" above: not logged sets, just a
// daily checklist of stretches/moves with a collapsible how-to per item.
const CHECKLIST_ROUTINES = {
  "Thoracic Spine Stretch": {
    intro: "Mobility for the mid-back - tightness here shows up a lot from cycling, skiing tuck, and running posture.",
    items: [
      { name: "Cat-Cow", dose: "10 reps", description: "On hands and knees, arch your back up toward the ceiling on the exhale, then let it sag down on the inhale, leading with your chest.", variation: "Seated Cat-Cow: do the same spinal movement seated in a chair if you're short on floor space." },
      { name: "Thread the Needle", dose: "8 reps each side", description: "From hands and knees, slide one arm under your body and rotate your chest toward the floor, then reverse and reach that arm toward the ceiling.", variation: "Yoga flow: pair with a rotation to Extended Side Stretch for more shoulder opening." },
      { name: "Open Book Rotation", dose: "8 reps each side", description: "Lying on your side with knees bent, open your top arm across your body like turning a page, following it with your eyes and chest.", variation: "Add a 2-3 second hold at full rotation for a deeper stretch." },
      { name: "Foam Roller Thoracic Extension", dose: "60 sec", description: "Place a foam roller horizontally under your shoulder blades, support your head with your hands, and gently extend backward over the roller.", variation: "No roller? Do a doorway or wall thoracic extension instead." },
      { name: "Doorway Chest Opener", dose: "30 sec each side", description: "Place your forearm on a doorframe at shoulder height and gently rotate your body away from it to open the chest and front shoulder.", variation: "Yoga version: Cow Face Pose (Gomukhasana) arms for a deeper chest and shoulder stretch." },
    ],
  },
  "Hip Stretch": {
    intro: "Hip mobility - the usual tight spot from biking, skiing, and running.",
    items: [
      { name: "90/90 Hip Stretch", dose: "45 sec each side", description: "Sit with your front leg bent 90° in front of you and back leg bent 90° to the side, then lean your torso forward over the front shin.", variation: "Yoga version: this is essentially a seated Pigeon variation - stay upright for a gentler stretch." },
      { name: "Couch Stretch", dose: "45 sec each side", description: "Kneel with your back foot up on a couch or bench behind you, back knee bent, and drive your hips forward to stretch the front of the hip and quad.", variation: "Elevate the back foot less if it's too intense at first." },
      { name: "Pigeon Pose", dose: "45 sec each side", description: "Front leg bent in front of you, back leg extended straight behind, hips squared forward, fold over the front leg.", variation: "Reclined Figure-4 (lying on your back) is a gentler alternative to full Pigeon." },
      { name: "Standing Figure-4 Stretch", dose: "30 sec each side", description: "Cross one ankle over the opposite knee while standing, then sit your hips back like sitting in a chair.", variation: "Hold onto a wall or chair for balance if needed." },
      { name: "World's Greatest Stretch", dose: "5 reps each side", description: "From a lunge position, drop your back knee down, rotate your torso and reach the same-side arm toward the ceiling.", variation: "Skip the rotation and just hold the lunge for a simpler hip-flexor-only version." },
    ],
  },
  "Leg Stretch": {
    intro: "Glutes and quads - the muscles doing most of the work in squats, lunges, and pedaling.",
    items: [
      { name: "Kneeling Quad Stretch", dose: "30 sec each side", description: "Kneel on one knee, grab the back foot of that leg, and gently pull the heel toward your glute while keeping hips forward.", variation: "Standing Quad Stretch works the same muscle if kneeling bothers your knees." },
      { name: "Standing Quad Stretch", dose: "30 sec each side", description: "Standing on one leg, grab your other ankle behind you and pull the heel toward your glute, knees close together.", variation: "Hold a wall or chair for balance." },
      { name: "Lying Figure-4 Glute Stretch", dose: "45 sec each side", description: "Lying on your back, cross one ankle over the opposite knee, then pull the uncrossed thigh toward your chest.", variation: "Yoga version: Reclined Pigeon - same position, held longer with slow breathing." },
      { name: "Frog Stretch", dose: "45 sec", description: "On hands and knees, widen your knees out to the sides and sink your hips back toward your heels to stretch the inner thighs and hips.", variation: "Come up onto forearms for a deeper version once it feels comfortable." },
      { name: "Runner's Lunge with Quad Pull", dose: "30 sec each side", description: "From a lunge, drop the back knee down and grab that back foot to add a quad stretch to the hip flexor stretch.", variation: "Skip the foot pull if balance is tough - the lunge alone still stretches the hip flexor." },
    ],
  },
  "Full Body Stretch": {
    intro: "A quick full-body cooldown when you don't need to target anything specific.",
    items: [
      { name: "Downward Dog", dose: "30 sec", description: "Hands and feet on the floor, hips lifted high to form an inverted V, pedaling the heels to stretch calves and hamstrings.", variation: "Bend the knees generously if the hamstrings are tight - the priority is a long spine, not straight legs." },
      { name: "Standing Forward Fold", dose: "30 sec", description: "Feet hip-width, hinge at the hips and let your upper body hang toward the floor, knees soft.", variation: "Yoga version: Ragdoll Pose, holding opposite elbows and gently swaying side to side." },
      { name: "Cat-Cow", dose: "10 reps", description: "On hands and knees, arch and round the spine slowly with your breath.", variation: "A seated version works too if you're short on floor space." },
      { name: "Child's Pose", dose: "45 sec", description: "Kneel and sit back onto your heels, reaching your arms forward and resting your forehead on the floor.", variation: "Widen the knees for more room for your torso if that's more comfortable." },
      { name: "Standing Side Bend", dose: "20 sec each side", description: "Reach one arm overhead and lean sideways at the waist, feeling the stretch down your side body.", variation: "Add a slight forward lean for more lat stretch." },
    ],
  },
  "5-Minute Core Routine": {
    intro: "A short core circuit - run through each move once for about 5 minutes total.",
    items: [
      { name: "Plank", dose: "30-45 sec", description: "Forearms and toes on the floor, body in a straight line from head to heels, brace your core.", variation: "Drop to knees if a full plank isn't sustainable yet - same bracing pattern." },
      { name: "Dead Bug", dose: "10 reps each side", description: "Lying on your back, arms up and knees bent 90°, slowly extend the opposite arm and leg toward the floor while keeping your low back flat.", variation: "Keep both feet on the floor and just do the arm reach if the full movement is too hard at first." },
      { name: "Bird Dog", dose: "10 reps each side", description: "From hands and knees, extend the opposite arm and leg straight out, keeping hips level.", variation: "Add a 2 second hold at full extension for more of a stability challenge." },
      { name: "Side Plank", dose: "20 sec each side", description: "Forearm and stacked feet on the floor, hips lifted so your body forms a straight line.", variation: "Drop the bottom knee to the floor for a more supported version." },
      { name: "Bicycle Crunches", dose: "20 reps", description: "Hands behind your head, alternate bringing opposite elbow to opposite knee in a pedaling motion.", variation: "Slow the tempo way down for more control and less momentum." },
    ],
  },
};
// One-time startup guard: if a new trackBy value ever gets added to
// EXERCISE_DEFAULTS without updating VALID_TRACK_BY_VALUES (and the
// matching database constraint), fail loudly in the console the moment the
// app loads instead of surfacing only as a silently stuck sync queue days
// later. Whoever is testing a new exercise type would see this immediately.
Object.entries(EXERCISE_DEFAULTS).forEach(([exName, preset]) => {
  if(preset.trackBy && !VALID_TRACK_BY_VALUES.includes(preset.trackBy)){
    console.error(`"${exName}" uses trackBy "${preset.trackBy}", which is not in VALID_TRACK_BY_VALUES and almost certainly is not allowed by the exercises_track_by_check database constraint either - cloud sync for this exercise will fail silently. Add it to both VALID_TRACK_BY_VALUES and the database constraint.`);
  }
});
// Fields that are safe to backfill onto an exercise that already existed
// locally before this default existed: purely additive metadata that never
// reinterprets anything already logged (unlike trackBy/trackDistance, which
// would misrepresent already-logged weight/sets/reps entries if changed).
const BACKFILL_KEYS = ["targetRepsSki", "skiTempo", "equipment", "unit", "targetReps", "trackSpeed", "preseason", "preseasonNote", "preseasonTempo", "targetRepsPreseason", "preseasonWeek3", "preseasonPower", "trackBy", "autoloadLastReps"];
// These preseason fields are pure app-authored copy: never synced to
// Supabase (see exerciseToRow, which has no preseason_* columns) and
// never user-editable through any UI. Unlike the rest of BACKFILL_KEYS,
// which protect real logged/synced state by only filling in a value the
// first time it's missing, these should always mirror EXERCISE_DEFAULTS -
// otherwise a later wording or number edit (e.g. dropping a knee-specific
// load reduction once the knee wasn't an issue anymore) would silently
// never reach anyone who already had the exercise locally.
const ALWAYS_SYNC_KEYS = ["preseason", "preseasonNote", "preseasonTempo", "targetRepsPreseason", "preseasonWeek3", "preseasonPower", "trackBy", "autoloadLastReps"];
function newExerciseShell(name){
  return Object.assign({ trackBy: "weight", entries: [] }, EXERCISE_DEFAULTS[name]);
}
function backfillExerciseDefaults(){
  Object.entries(EXERCISE_DEFAULTS).forEach(([name, preset]) => {
    const ex = data[name];
    if(!ex) return;
    let changed = false;
    BACKFILL_KEYS.forEach(key => {
      if(preset[key] === undefined) return;
      const shouldSet = ALWAYS_SYNC_KEYS.includes(key) ? ex[key] !== preset[key] : ex[key] === undefined;
      if(shouldSet){
        ex[key] = preset[key];
        changed = true;
      }
    });
    if(changed){
      persist();
      enqueueOp({ id: genId(), type: "upsert_exercise", payload: { name } });
    }
  });
}

const TAB_ORDER = ["full","upper","lower","extra","overview"];

// Both bumped BY HAND with every shipped change - neither is derived from
// git, so nothing enforces it and both have drifted before (APP_UPDATED
// sat on "Sep 17, 2026" across several version bumps because only
// APP_VERSION was part of the habit). v23 picked up its count from this
// file's git history (22 prior commits touching index.html at the time),
// so it keeps counting forward rather than restarting at v1.
const APP_VERSION = "v65";
const APP_UPDATED = "Oct 2, 2026";

