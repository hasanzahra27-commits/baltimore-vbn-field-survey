// Survey content. Wording follows the BXP Vacant Property Indicators Checklist
// (updated 1/31/25). The `col` values are the column names in the export, so
// changing them breaks continuity with data already collected.

export const CRITERIA = [
  {
    key: "a",
    title: "A. Neighbor tells you it's vacant",
    rule: "Counts on its own",
    items: [{ col: "a_neighbor_says_vacant", text: "A neighbor told me this property is vacant" }],
  },
  {
    key: "b",
    title: "B. You see people",
    rule: "Counts on its own",
    items: [
      {
        col: "b_people_entering_without_keys",
        text: "People going in and out without keys or through unusual openings (basement windows, previously boarded doors/windows)",
      },
    ],
  },
  {
    key: "c",
    title: "C. Obvious signs",
    rule: "1 or more = vacant",
    threshold: 1,
    items: [
      { col: "c1_porch_covered_or_debris", text: "Porch has tent, blankets, boards, coverings to prevent seeing in, trash or debris" },
      { col: "c2_multiple_boarded_openings", text: "More than one boarded window or door" },
      { col: "c3_broken_windows", text: "One or more broken windows" },
      { col: "c4_roof_missing_or_structural", text: "No roof, or roof with serious structural issues" },
      { col: "c5_building_structural_issues", text: "Building has serious structural issues (caving-in porch, sagging structure)" },
    ],
  },
  {
    key: "d",
    title: "D. Subtle signs",
    rule: "5 or more = vacant",
    threshold: 5,
    items: [
      { col: "d1_unkempt_grass_bushes", text: "Unkempt grass, bushes" },
      { col: "d2_accumulated_mail", text: "Accumulated mail" },
      { col: "d3_trash_garbage", text: "Trash or garbage (inside or outside)" },
      { col: "d4_differs_from_neighbors", text: "Marked difference from neighboring properties" },
      { col: "d5_windows_dirty_or_coverings", text: "Windows dirty, clouded, inappropriate interior coverings (blankets, towels) or no coverings" },
      { col: "d6_interior_storage_or_empty", text: "Interior has an overabundance of furniture (looks like storage) or is empty" },
      { col: "d7_windows_open_closed_wrong_season", text: "Windows inappropriately open or closed (open in winter, closed in summer, broken)" },
      { col: "d8_poor_physical_condition", text: "Overall physical condition is bad (falling gutters, open roof, fire damage, broken porch/steps)" },
      { col: "d9_lockbox_on_door", text: "Lock box on the door (front or back)" },
    ],
  },
];

// Extra indicators raised by the i-Team (meeting 9/15/26).
export const EXTRA_YESNO = [
  { col: "x_unmonitored_open_windows_doors", text: "Unmonitored open windows or doors" },
];

export const FACADE_DAMAGE = {
  col: "x_facade_damage",
  label: "State of facade damage",
  options: ["None", "Minor", "Moderate", "Severe"],
};

export const DISTRESS_SCALE = [
  { value: 0, label: "Blue sky vacant", hint: "Open to the sky or collapsing; uninhabitable" },
  { value: 1, label: "Severe distress", hint: "Major structural damage; open or boarded" },
  { value: 2, label: "Serious distress", hint: "Several clear signs of vacancy or neglect" },
  { value: 3, label: "Moderate distress", hint: "Some signs of neglect; occupancy unclear" },
  { value: 4, label: "Minor signs", hint: "Small upkeep issues; looks lived-in" },
  { value: 5, label: "No signs of distress", hint: "Well kept; clearly occupied" },
];

export const ROLES = [
  "Student volunteer",
  "i-Team staff",
  "DHCD staff",
  "Rebuild Metro",
  "Other City staff",
  "Other",
];

export const NOT_OBSERVED_REASONS = [
  "Could not find property",
  "Unsafe to approach",
  "View blocked / no access",
  "Property demolished / vacant lot",
  "Other",
];

export const ALL_CHECK_COLS = CRITERIA.flatMap((c) => c.items.map((i) => i.col));

// Applies the BXP rule: vacant if A, or B, or ≥1 of C, or ≥5 of D.
export function evaluate(checks) {
  const count = (key) => CRITERIA.find((c) => c.key === key).items.filter((i) => checks[i.col]).length;
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
