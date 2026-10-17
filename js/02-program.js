// The program: seed data, day lists and order, care-mode lists and tips, exercise defaults and cues, checklist routines.
// Classic script sharing one global scope with the other js/NN-*.js files, run in order.

const SEED = {
  // Intentionally empty - publish this version without personal data baked in.

};

// Each day's list, in planned order. Main lifts (Squat, Bench, RDL, Row) and Face Pulls and Back
// Extension run twice a week; every other accessory lives on one day, so days stay about 7 lifts. Position 0 is the lift a tab opens on, so it stays the main
// lift even though preseason power work moves to the front of the pill row (getDisplayOrder).
// Every name in a day's list counts toward that day's completion banner, so a lift lives on one
// day only (Farmer's Carry is on Extra, Kettlebell Swings on Lower). PRESEASON_ONLY lifts are
// hidden while Preseason Prep is off (activeDayOrder).
const DAY_ORDER = {
  full: ["Squat","Bench Press","RDL","Barbell Row","Cable Lat Pulldown","Face Pulls","Back Extension","Seated Calf Raise"],
  upper: ["Bench Press","Barbell Row","Incline DB Press","Push-Ups","Face Pulls","Bicep Curl","Tricep Pushdown","Back Extension","Med Ball Slam"],
  lower: ["Squat","RDL","Bulgarian Split Squat","Hip Thrust","Kettlebell Swings","Walking Lunge","Lateral Lunge","Standing Calf Raise","Box Jumps","Trap Bar Jump","Skater Bound"],
  // Full Body 2+1 (the other program): two full-body days, A and B, plus an optional C. Same lifts
  // and history as the split; preseason power work (listed last) moves to the front when it's on.
  a: ["Squat","Bench Press","RDL","Barbell Row","Bulgarian Split Squat","Face Pulls","Back Extension","Standing Calf Raise","Box Jumps"],
  b: ["RDL","Squat","Incline DB Press","Cable Lat Pulldown","Lateral Lunge","Hip Thrust","Back Extension","Seated Calf Raise","Trap Bar Jump","Skater Bound"],
  c: ["Kettlebell Swings","Walking Lunge","Push-Ups","Face Pulls","Bicep Curl","Tricep Pushdown","Med Ball Slam"],
  // Grouped by type - strength, then cardio, then core, then stretches -
  // rather than the order they were added in, so the row reads as sections
  // instead of a grab-bag. See EXTRA_CATEGORY below for the color coding.
  extra: ["Farmer's Carry","Dead Hang","Spanish Squat","Push-Ups","Cable Chest Fly","Incline Treadmill Walk","Zone 2 Ride","C2 Row","5-Minute Core Routine","Copenhagen Plank","Thoracic Spine Stretch","Hip Stretch","Leg Stretch","Full Body Stretch","Sauna","Cold Plunge","Hot Tub"],
};
const PRESEASON_ONLY = new Set(["Box Jumps","Lateral Lunge","Trap Bar Jump","Skater Bound","Seated Calf Raise","Med Ball Slam","Copenhagen Plank"]);
// Preseason lifts that stay on in season, once a week, to keep power without leg fatigue.
const IN_SEASON_KEEP = new Set(["Box Jumps"]);
// Shown only while Knee Care is on: on Extra, and after the numbered lifts on Lower and Full Body.
const KNEE_ONLY = new Set(["Spanish Squat"]);
// Preseason lifts kept on year-round on some days: side-to-side leg work on Lower, and on Full Body
// 2+1 that plus a second calf day.
const YEAR_ROUND = { lower: ["Lateral Lunge"], a: ["Lateral Lunge", "Seated Calf Raise"], b: ["Lateral Lunge", "Seated Calf Raise"], c: ["Lateral Lunge", "Seated Calf Raise"] };
function isYearRound(day, name){ return (YEAR_ROUND[day] || []).includes(name); }
// Short, optional work after a day's numbered lifts: core and grip, plus Wall Sit while Ski is on.
// Not numbered, a color of their own in the pill row, never needed for the workout-complete banner.
const FINISHERS = {
  full: ["Pallof Press", "Farmer's Carry"], upper: ["Dead Hang"], lower: ["Side Plank"],
  a: ["Pallof Press", "Farmer's Carry"], b: ["Side Plank", "Dead Hang"], c: ["Dead Bug"],
};
const SKI_FINISHERS = { lower: ["Wall Sit"], a: ["Wall Sit"] };
function finishersFor(day){
  return [...(FINISHERS[day] || []), ...((modes.preseason || modes.ski) ? (SKI_FINISHERS[day] || []) : [])];
}
// The main barbell lifts. Only these show Est. 1RM on the card; everything else shows its rep
// record, which is what an accessory actually progresses by.
const COMPOUND_LIFTS = new Set(["Squat", "Bench Press", "RDL", "Barbell Row", "Hip Thrust"]);
function activeDayOrder(day){
  const week = preseasonWeek();
  return DAY_ORDER[day].filter(name => (modes.preseason || !PRESEASON_ONLY.has(name) || (modes.ski && IN_SEASON_KEEP.has(name)) || isYearRound(day, name)) && (modes.knee || !KNEE_ONLY.has(name))
    && !(week != null && week < 3 && (EXERCISE_DEFAULTS[name] || {}).preseasonWeek3));
}
// Extra shows one group at a time, picked from buttons above its row. Mobility is a single card
// holding the stretch and core routines; each routine keeps its own history under its own name.
const EXTRA_GROUPS = [
  { key: "strength", label: "Strength" },
  { key: "cardio", label: "Cardio" },
  { key: "mobility", label: "Mobility" },
  { key: "recovery", label: "Recovery" },
];
const MOBILITY_NAME = "Mobility";
const MOBILITY_ROUTINES = [["Hip Stretch", "Hip"], ["Leg Stretch", "Leg"], ["Thoracic Spine Stretch", "Thoracic"], ["Full Body Stretch", "Full Body"], ["5-Minute Core Routine", "Core"]];
function isMobilityRoutine(name){ return MOBILITY_ROUTINES.some(([n]) => n === name); }
function extraGroupOf(name){
  if(name === MOBILITY_NAME || isMobilityRoutine(name)) return "mobility";
  const c = EXTRA_CATEGORY[name];
  return c === "cardio" || c === "recovery" ? c : "strength"; // strength, Copenhagen Plank and custom Extra exercises
}
const DAY_TITLES = { full:"Full Body", upper:"Upper Body", lower:"Lower Body", a:"Day A", b:"Day B", c:"Day C", extra:"Extra / Off-Day" };
const CLASSIC_DAYS = ["full", "upper", "lower"], FULLBODY_DAYS = ["a", "b", "c"];
const CONCERN_WORDS = ["heavy","tender","grip","pain","sore","ache","hurt"];

// Only used to color-code Extra's pill row into visual sections (strength /
// cardio / core / stretch) - purely cosmetic grouping, not a gating flag
// like preseason/ski/knee/back, so it doesn't touch trackBy or sync.
const EXTRA_CATEGORY = {
  "Farmer's Carry": "strength",
  "Dead Hang": "strength",
  "Spanish Squat": "strength",
  "Push-Ups": "strength",
  "Cable Chest Fly": "strength",
  "Zone 2 Ride": "cardio",
  "Incline Treadmill Walk": "cardio",
  "C2 Row": "cardio",
  "5-Minute Core Routine": "core",
  "Copenhagen Plank": "core",
  "Thoracic Spine Stretch": "stretch",
  "Hip Stretch": "stretch",
  "Leg Stretch": "stretch",
  "Full Body Stretch": "stretch",
  "Sauna": "recovery",
  "Cold Plunge": "recovery",
  "Hot Tub": "recovery",
};
// Recovery: heat and cold, logged as minutes and temperature for the coach's analysis rather than
// for progression, so these cards carry no suggestion, graph or RPE, and stay out of everything
// that counts lift sessions (time off, readiness, calendar, heart rate, session order).
const RECOVERY = {
  "Sauna": { temp: 180, minutes: 15, guide: "Typical: 15-20 min at 175-195°F, 2-4× a week. After lifting or on rest days, not right before a lift." },
  "Cold Plunge": { temp: 50, minutes: 3, guide: "Typical: 2-5 min at 39-55°F. Keep it 6+ hours after a lift if building muscle is the goal." },
  "Hot Tub": { temp: 102, minutes: 15, guide: "Typical: 15-20 min at 100-104°F. Good for loosening up; hydrate after." },
};
function isRecovery(name){ return Object.prototype.hasOwnProperty.call(RECOVERY, name); }

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
  "Spanish Squat": "Tendon-friendly squat: 3x10 with a 3 sec hold at the bottom. Before squats or on off days.",
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
  "Squat": ["Brace, knees out, hips and chest rise as one.", "Goblet squat or leg press."],
  "Bench Press": ["Blades pinned, forearms vertical, legs drive.", "DB bench or Smith bench."],
  "Incline DB Press": ["30-45° bench, elbows ~45°, control the bottom.", "Landmine press or incline Smith press."],
  "RDL": ["Soft knees, hips back, bar on legs, flat back.", "DB RDL, cable pull-through, or single-leg RDL (lighter, for balance and hip stability)."],
  "Bulgarian Split Squat": ["Slight forward lean, drive through the front heel.", "Reverse lunge or split squat, back foot down."],
  "Hip Thrust": ["Upper back on bench, ribs down, 1 sec squeeze.", "Floor glute bridge with the bar, or Smith hip thrust."],
  "Barbell Row": ["Hinge ~45°, brace, pull to low ribs, no jerk.", "Chest-supported DB row or seated cable row."],
  "Cable Chest Fly": ["Soft elbows locked in place, squeeze at the middle.", "DB fly or pec deck."],
  "Face Pulls": ["Rope to eyes, elbows high, thumbs back.", "Band pull-apart or reverse fly."],
  "Back Extension": ["Hinge at hips, squeeze glutes, stop level.", "Reverse hyper or light good morning."],
  "Seated Calf Raise": ["Full stretch at the bottom, 1 sec pause, slow lower.", "Smith seated calf raise or DB on the knees."],
  "Cable Lat Pulldown": ["Chest up, elbows to back pockets, no swing.", "Assisted pull-up or single-arm pulldown."],
  "Bicep Curl": ["Elbows pinned, no swing, slow on the way down.", "Hammer curl or cable curl."],
  "Tricep Pushdown": ["Elbows tucked, full lockout, control the return.", "Overhead cable extension or close-grip push-up."],
  "Med Ball Slam": ["Reach tall, slam with hips and abs, fast reps.", "Kettlebell swing or rope slams."],
  "Kettlebell Swings": ["Hinge, not squat; snap the hips, arms only guide.", "Cable pull-through or DB swing."],
  "Walking Lunge": ["Long step, back knee near the floor, torso tall.", "Reverse lunge in place or step-ups."],
  "Standing Calf Raise": ["Straight knees, full stretch, pause at the top.", "Smith or leg-press calf raise."],
  "Box Jumps": ["Land soft and quiet in a half squat, step down.", "Squat jumps or fast low step-ups."],
  "Lateral Lunge": ["Sit into bent hip, other leg straight, chest up.", "Cossack squat or lateral band walk."],
  "Trap Bar Jump": ["Jump tall, land soft, reset before each rep.", "DB jump or bodyweight squat jump."],
  "Skater Bound": ["Push sideways off the outside leg, stick the landing.", "Lateral line hops or lateral step-ups."],
  "Spanish Squat": ["Band behind knees, sit straight down, 3 sec hold.", "Wall sit or slow box squat."],
  "Push-Ups": ["Hands shoulder width, elbows ~45°, body straight.", "Cable Chest Fly is the alternative (Extra, Strength), 10-15 reps. Incline or knee push-ups to scale."],
  "Farmer's Carry": ["Tall posture, shoulders packed, short quick steps.", "Suitcase carry or trap bar hold."],
  "Dead Hang": ["Active shoulders, full grip, steady breathing.", "Assisted hang with feet on a box."],
  "Pallof Press": ["Side-on to the cable at chest height. Press out, hold 2 sec, don't let it turn you.", "Band Pallof press."],
  "Side Plank": ["Elbow under shoulder, hips high, body in one straight line.", "Knees-down side plank."],
  "Dead Bug": ["Low back pressed down; reach opposite arm and leg slowly, breathe out.", "Feet-on-floor heel taps."],
  "Wall Sit": ["Thighs parallel, back flat on the wall, weight in the heels.", "Higher sit, knees at 60 degrees."],
  "Copenhagen Plank": ["Hips high, body straight, top leg does the work.", "Knee-on-bench version or side plank."],
  "Lateral Raise": ["Slight lean, lead with elbows, stop at shoulder.", "Cable or machine lateral raise."],
  "Zone 2 Ride": ["Conversational pace, steady cadence.", "Rower or incline walk at the same effort."],
  "Incline Treadmill Walk": ["No handrails, tall posture, steady pace.", "Stair climber or Zone 2 bike."],
  "C2 Row": ["Legs, then lean back, then arms; reverse on the way in. Damper 4-6.", "Zone 2 ride or incline walk at the same effort."],
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
  "Pallof Press": { reps: "side" },
  "Side Plank": { reps: "side" },
  "Dead Bug": { reps: "side" },
};

// Every value ex.trackBy can hold. Must match the exercises_track_by_check constraint in the
// database: a value missing there makes every sync of that exercise fail quietly (a growing
// "pending" count). Pair a new value here with a migration that rewrites the constraint.
const VALID_TRACK_BY_VALUES = ["weight", "duration", "reps", "checklist"];

// Built-in exercises that shouldn't default to weight/sets/reps when first
// created - cardio work is logged by time, distance, and incline instead.
const EXERCISE_DEFAULTS = {
  "Zone 2 Ride": { trackBy: "duration", trackDistance: true, trackSpeed: true },
  "Incline Treadmill Walk": { trackBy: "duration", trackDistance: true, trackIncline: true, trackSpeed: true },
  "C2 Row": { trackBy: "duration", trackDistance: true, trackSpeed: true, rowing: true, trackSpm: true },
  "Pallof Press": { trackBy: "weight", targetReps: 10, repRange: "10-15" },
  "Side Plank": { trackBy: "reps", unit: "sec", targetReps: 30 },
  "Dead Bug": { trackBy: "reps", targetReps: 8 },
  "Wall Sit": { trackBy: "reps", unit: "sec", targetReps: 45 },
  "Squat": { targetRepsStrength: 5,
    targetRepsSki: 5, skiTempo: "3-4 sec eccentric descent", equipment: "barbell",
    preseason: true, targetRepsPreseason: 5, preseasonTempo: "4 sec lowering",
  },
  "Bulgarian Split Squat": { targetRepsSki: 6, skiTempo: "3-4 sec eccentric descent per leg", repRange: "8-12" },
  "Walking Lunge": { targetRepsSki: 8, skiTempo: "2-3 sec controlled descent each step" },
  "Bench Press": { equipment: "barbell", targetRepsStrength: 5 },
  "RDL": { equipment: "barbell", targetRepsStrength: 5 },
  "Hip Thrust": { equipment: "barbell", targetReps: 10 },
  "Barbell Row": { equipment: "barbell", targetRepsStrength: 5 },
  "Back Extension": { trackBy: "weight", autoloadLastReps: true, repRange: "10-15" },
  // Accessories progress by reps inside a range before adding weight (double progression): +5 lb is
  // 3% on a squat but a third of a light dumbbell, so these earn it at the top of the range.
  "Incline DB Press": { repRange: "8-12" },
  "Cable Chest Fly": { repRange: "10-15" },
  "Face Pulls": { repRange: "12-15" },
  "Cable Lat Pulldown": { repRange: "8-12" },
  "Bicep Curl": { repRange: "8-12" },
  "Tricep Pushdown": { repRange: "10-15" },
  "Lateral Raise": { repRange: "12-15" },
  "Farmer's Carry": { unit: "sec", targetReps: 40, preseason: true, preseasonNote: "3x8 @ 60 lb, keep building load." },
  "Kettlebell Swings": { maxWeight: 35, preseason: true, preseasonPower: true, preseasonNote: "Power: do this first. 4x10 at 35 lb; add reps, then go single-arm." },
  "Standing Calf Raise": { trackBy: "weight", targetReps: 15, repRange: "12-20", preseason: true, preseasonNote: "3x15, loaded. Log the total: both dumbbells added together, or the bar." },
  "Box Jumps": { trackBy: "reps", targetReps: 3, preseason: true, preseasonPower: true, preseasonNote: "4x3, 12-18 in box. Step down, never jump down; stop if speed drops. Gentler: slow 3 sec step-down.", inSeasonNote: "In season: 3x3, first in the session, full rest between jumps. Skip it the day before a big ski day." },
  "Med Ball Slam": { trackBy: "weight", targetReps: 6, preseason: true, preseasonPower: true, preseasonNote: "3x6, 10-15 lb. Stop if speed drops." },
  "Lateral Lunge": { trackBy: "weight", targetReps: 8, preseason: true, preseasonNote: "3x8 per side, bodyweight up to 30 lb DB." },
  "Copenhagen Plank": { trackBy: "reps", unit: "sec", targetReps: 20, preseason: true, preseasonNote: "3x20 sec per side, adductors." },
  "Dead Hang": { trackBy: "reps", unit: "sec", targetReps: 45 },
  "Seated Calf Raise": { trackBy: "weight", targetReps: 15, repRange: "12-20", preseason: true, preseasonNote: "3x15, soleus for boot control." },
  "Trap Bar Jump": { trackBy: "weight", targetReps: 3, preseason: true, preseasonWeek3: true, preseasonPower: true, preseasonNote: "4x3 @ 95-135 lb. Stop if speed drops." },
  "Skater Bound": { trackBy: "reps", targetReps: 4, preseason: true, preseasonWeek3: true, preseasonPower: true, preseasonNote: "3x4 per side, stick each landing 2 sec." },
  "Spanish Squat": { trackBy: "reps", targetReps: 10, preseason: false, preseasonWeek3: false },
  "Push-Ups": { trackBy: "reps", targetReps: 12 },
  "Sauna": { trackBy: "duration" },
  "Cold Plunge": { trackBy: "duration" },
  "Hot Tub": { trackBy: "duration" },
  "Thoracic Spine Stretch": { trackBy: "checklist" },
  "Hip Stretch": { trackBy: "checklist" },
  "Leg Stretch": { trackBy: "checklist" },
  "Full Body Stretch": { trackBy: "checklist" },
  "5-Minute Core Routine": { trackBy: "checklist" },
  "Shoulder Rehab": { trackBy: "checklist" }, // items and phases live in js/05b-shoulder-rehab.js
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
// Fails loudly at startup if a default uses a trackBy missing from the list above.
Object.entries(EXERCISE_DEFAULTS).forEach(([exName, preset]) => {
  if(preset.trackBy && !VALID_TRACK_BY_VALUES.includes(preset.trackBy)){
    console.error(`"${exName}" uses trackBy "${preset.trackBy}", which is not in VALID_TRACK_BY_VALUES and almost certainly is not allowed by the exercises_track_by_check database constraint either - cloud sync for this exercise will fail silently. Add it to both VALID_TRACK_BY_VALUES and the database constraint.`);
  }
});
// Defaults filled onto an exercise saved before they existed: additive metadata only, never
// fields that would reinterpret logged sessions.
const BACKFILL_KEYS = ["targetRepsSki", "skiTempo", "equipment", "unit", "targetReps", "trackSpeed", "preseason", "preseasonNote", "preseasonTempo", "targetRepsPreseason", "preseasonWeek3", "preseasonPower", "trackBy", "autoloadLastReps", "repRange", "inSeasonNote", "rowing", "trackSpm", "targetRepsStrength"];
// App-authored copy and targets (never synced, never edited in the UI): always refreshed from
// EXERCISE_DEFAULTS, so a wording or number change reaches devices that already have the lift.
const ALWAYS_SYNC_KEYS = ["preseason", "preseasonNote", "preseasonTempo", "targetRepsPreseason", "preseasonWeek3", "preseasonPower", "trackBy", "autoloadLastReps", "repRange", "inSeasonNote", "rowing", "trackSpm", "targetRepsStrength"];
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

// Tabs follow the program: its lift days, then Extra and Overview.
function tabOrder(){ return [...programDays(), "extra", "overview"]; }

// Bumped by hand every release, with every ?v= in index.html (scenario 75 checks they match).
const APP_VERSION = "v123";
const APP_UPDATED = "Oct 15, 2026";

