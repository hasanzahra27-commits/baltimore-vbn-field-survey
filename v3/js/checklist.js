// Survey content. Wording follows the BXP Vacant Property Indicators Checklist
// (updated 1/31/25), reorganized after field testing (10/26). The `col` values
// are the column names in the export, so changing them breaks continuity with
// data already collected.
//
// `prompt` is the example text in the details box that opens when an item is
// ticked. `bxp` says which BXP group an indicator counts toward (a, b, c or d). Items
// without it are recorded but don't affect the BXP result.

export const INDICATORS = {
  // Distress
  c2_multiple_boarded_openings: { bxp: "c", text: "More than one boarded window or door",
    prompt: "Which windows or doors, and how many?" },
  c3_broken_windows: { bxp: "c", text: "One or more broken windows",
    prompt: "Which windows, and how many?" },
  x_unmonitored_open_windows_doors: { text: "Unmonitored open windows or doors",
    prompt: "Which windows or doors are open?" },
  c4_roof_missing_or_structural: { bxp: "c", text: "No roof, or roof with serious structural issues",
    prompt: "What's wrong with the roof?" },
  c5_building_structural_issues: { bxp: "c", text: "Building has serious structural issues (caving-in porch, sagging structure)",
    prompt: "What structural problems, and where?" },
  d8_poor_physical_condition: { bxp: "d", text: "Overall physical condition is bad (falling gutters, open roof, fire damage, broken porch/steps)",
    prompt: "What's in bad condition?" },
  c1_porch_covered_or_debris: { bxp: "c", text: "Porch has tent, blankets, boards, coverings to prevent seeing in, trash or debris",
    prompt: "What's on or covering the porch?" },
  d3_trash_garbage: { bxp: "d", text: "Trash or garbage (inside or outside)",
    prompt: "What kind, and where (inside, porch, yard)?" },
  d1_unkempt_grass_bushes: { bxp: "d", text: "Unkempt grass, bushes",
    prompt: "Where, and how overgrown?" },
  d4_differs_from_neighbors: { bxp: "d", text: "Marked difference from neighboring properties",
    prompt: "How does it differ from the houses around it?" },

  // Occupancy: signs no one lives there
  x_fully_blocked_off: { text: "Property is completely blocked off (cyclone fencing, all openings sealed)",
    prompt: "How is it blocked off (fencing, sealed doors or windows)?" },
  d2_accumulated_mail: { bxp: "d", text: "Mail piling up",
    prompt: "Where is the mail, and about how much?" },
  d9_lockbox_on_door: { bxp: "d", text: "Lock box on the door (front or back)",
    prompt: "Which door is the lock box on?" },
  // BXP item D5 split into three after field testing (10/28). Together they
  // still count as one D sign; see D5_PARTS.
  d5a_windows_dirty_or_clouded: { bxp: "d", text: "Windows dirty or clouded",
    prompt: "Which windows?" },
  d5b_windows_inappropriate_coverings: { bxp: "d", text: "Windows covered from inside with things that aren't curtains or blinds (blankets, towels, sheets, cardboard)",
    prompt: "Which windows, and what are they covered with?" },
  d5c_windows_no_coverings: { bxp: "d", text: "Windows have no curtains or blinds at all (bare windows)",
    prompt: "Which windows, and what can you see inside?" },
  d6_interior_storage_or_empty: { bxp: "d", text: "Interior has an overabundance of furniture (looks like storage) or is empty",
    prompt: "What can you see inside?" },
  d7_windows_open_closed_wrong_season: { bxp: "d", text: "Windows inappropriately open or closed (open in winter, closed in summer)",
    prompt: "Which windows are open or closed?" },

  // Occupancy: signs someone is there
  b1_people_seen_through_door: { text: "People seen at or through the door",
    prompt: "How many people, and what were they doing?" },
  b2_people_using_unusual_openings: {
    bxp: "b",
    text: "People going in or out without keys or through unusual openings (basement windows, previously boarded doors/windows)",
    prompt: "Where were they going in or out, and how?",
  },
  b3_other_signs_of_living: { bxp: "b", text: "Other signs someone lives there (furniture, signs of recent presence)",
    prompt: "What signs did you see?" },

  // Neighbors
  a_neighbor_says_vacant: { bxp: "a", text: "A neighbor told me this property is vacant",
    prompt: "What did they say, and how would they know (e.g. next-door neighbor)?" },
  a2_neighbor_says_occupied: { text: "A neighbor told me someone lives here",
    prompt: "What did they say, and how would they know (e.g. next-door neighbor)?" },
};

export const FACADE_DAMAGE = {
  col: "x_facade_damage",
  label: "State of facade damage",
  prompt: "What damage, and where?",
  options: ["None", "Minor", "Moderate", "Severe"],
};

// Display order: the most objective, visible things first; hearsay last.
export const SECTIONS = [
  {
    key: "distress",
    title: "Distress",
    intro: "The building's physical condition, as you see it from outside.",
    groups: [{
      cols: [
        "c2_multiple_boarded_openings", "c3_broken_windows", "x_unmonitored_open_windows_doors",
        "c4_roof_missing_or_structural", "c5_building_structural_issues", "d8_poor_physical_condition",
        "c1_porch_covered_or_debris", "d3_trash_garbage", "d1_unkempt_grass_bushes", "d4_differs_from_neighbors",
      ],
    }],
    facade: true,
  },
  {
    key: "occupancy",
    title: "Occupancy",
    intro: "Whether anyone seems to be living there.",
    groups: [
      {
        title: "Signs no one lives there",
        cols: [
          "x_fully_blocked_off", "d2_accumulated_mail", "d9_lockbox_on_door",
          "d5a_windows_dirty_or_clouded", "d5b_windows_inappropriate_coverings", "d5c_windows_no_coverings",
          "d6_interior_storage_or_empty", "d7_windows_open_closed_wrong_season",
        ],
      },
      {
        title: "Signs someone is there",
        cols: ["b1_people_seen_through_door", "b2_people_using_unusual_openings", "b3_other_signs_of_living"],
      },
      {
        title: "What neighbors told you",
        intro: "Only if you spoke with a neighbor.",
        cols: ["a_neighbor_says_vacant", "a2_neighbor_says_occupied"],
      },
    ],
  },
];

// Serious and Moderate were merged after field testing, and the numbers run
// the other way from app v1: here 4 = blue sky vacant, 0 = no distress.
// Surveys from v1 used 0–5 with 0 = blue sky vacant; the export's
// distress_scale column says which one a row used.
export const DISTRESS_SCALE_VERSION = "v2 (0-4, 4 = blue sky vacant)";
export const DISTRESS_SCALE = [
  { value: 4, label: "Blue sky vacant", hint: "Open to the sky or collapsing; uninhabitable" },
  { value: 3, label: "Severe distress", hint: "Major structural damage; open or boarded" },
  { value: 2, label: "Moderate distress", hint: "Clear signs of neglect" },
  { value: 1, label: "Minor signs", hint: "Small upkeep issues; looks lived-in" },
  { value: 0, label: "No signs of distress", hint: "Well kept" },
];

// Every dropdown also offers "Other", which opens a box to type your own answer.
export const ROLES = [
  "Student volunteer",
  "i-Team staff",
  "DHCD staff",
  "Rebuild Metro",
  "Other City staff",
];

export const NOT_OBSERVED_REASONS = [
  "Could not find property",
  "Unsafe to approach",
  "View blocked / no access",
  "Property demolished / vacant lot",
];

export const NO_BACK_PHOTO_REASONS = [
  "Could not find the back",
  "No access to the back or alley",
  "Unsafe to approach",
];

export const ALL_CHECK_COLS = Object.keys(INDICATORS);

// The three window items that were one BXP item (D5) in app v1 and v2. The
// export also keeps the old combined column, so data stays comparable.
export const D5_COL = "d5_windows_dirty_or_coverings";
export const D5_PARTS = ["d5a_windows_dirty_or_clouded", "d5b_windows_inappropriate_coverings", "d5c_windows_no_coverings"];
export const d5Ticked = (checks) => D5_PARTS.some((col) => checks[col]);

// Applies the BXP rule: vacant if A, or B, or ≥1 of C, or ≥5 of D.
export function evaluate(checks) {
  const count = (g) => ALL_CHECK_COLS.filter((col) => INDICATORS[col].bxp === g && checks[col]).length
    // Any number of the D5 window items counts as one sign.
    - (g === "d" ? Math.max(0, D5_PARTS.filter((col) => checks[col]).length - 1) : 0);
  const a = count("a") > 0;
  const b = count("b") > 0;
  const cCount = count("c");
  const dCount = count("d");
  const via = [];
  if (a) via.push("A");
  if (b) via.push("B");
  if (cCount >= 1) via.push("C");
  if (dCount >= 5) via.push("D");
  return { meets: via.length > 0, via, cCount, dCount };
}
