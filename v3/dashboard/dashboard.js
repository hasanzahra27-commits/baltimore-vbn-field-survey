// i-Team dashboard: live summary statistics and group assignment.
//
// The password is checked by the Apps Script backend (DASHBOARD_PASSWORD in
// backend/Code.gs), never here: this repo is public. The backend only returns
// the columns listed in COLUMNS below, so names, comments, locations and
// photos stay in the Sheet.

import { CONFIG } from "../js/config.js";
import { SECTIONS, DISTRESS_SCALE, DISTRESS_SCALE_VERSION, OCCUPANCY_RATING } from "../js/checklist.js";
import { parseCsv, toCsv } from "../js/csv.js";

const REFRESH_MS = 60_000;
const PW_KEY = "vbn3.dashboard";

// Checklist columns, straight from the app's checklist so the two never drift.
const section = (key) => SECTIONS.find((s) => s.key === key);
const groupCols = (key, title) => section(key).groups.find((g) => g.title === title)?.cols ?? [];
const DISTRESS_COLS = section("distress").groups.flatMap((g) => g.cols);
// Occupancy is net: signs of vacancy count +1, signs of occupancy count −1
// (reverse coded), so higher always means "more likely vacant".
const VACANCY_SIGNS = [...groupCols("occupancy", "Signs no one lives there"), "a_neighbor_says_vacant"];
const OCCUPIED_SIGNS = [...groupCols("occupancy", "Signs someone is there"), "a2_neighbor_says_occupied"];

const COLUMNS = [
  "block_lot", "submitted_at", "observer_role", "observer_group", "observation_status",
  "distress_scale", "distress_score", OCCUPANCY_RATING.col,
  ...DISTRESS_COLS, ...VACANCY_SIGNS, ...OCCUPIED_SIGNS,
];

const $ = (id) => document.getElementById(id);
const h = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : "–");
const fmt = (n) => n.toLocaleString();
const yes = (v) => v === "Yes";

const state = {
  password: null,
  rows: [],
  groups: {}, // block_lot → group, from the dashboard
  properties: [],
  filter: { group: "", role: "" },
  breakdown: "group",
  selected: new Set(),
  updatedAt: null,
  timer: null,
};

// ---------- backend ----------

async function post(body) {
  if (!CONFIG.SYNC_URL) throw new Error("No backend is set up (SYNC_URL in js/config.js).");
  const res = await fetch(CONFIG.SYNC_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" }, // avoids a CORS preflight
    body: JSON.stringify({ key: CONFIG.SHARED_KEY, password: state.password, ...body }),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Server responded ${res.status}`);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "Request refused");
  return json;
}

async function loadProperties() {
  const res = await fetch(`../${CONFIG.PROPERTIES_URL}`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`Couldn't load the property list (${res.status})`);
  state.properties = parseCsv(await res.text()).filter((p) => p.block_lot && p.address);
}

async function load() {
  const json = await post({ type: "dashboard", columns: COLUMNS });
  state.rows = json.rows || [];
  state.groups = json.groups || {};
  state.updatedAt = new Date();
}

// ---------- login ----------

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const btn = form.querySelector("button");
  $("login-error").textContent = "";
  state.password = form.password.value;
  btn.disabled = true;
  try {
    await Promise.all([load(), loadProperties()]);
    try { sessionStorage.setItem(PW_KEY, state.password); } catch { /* private mode */ }
    showDashboard();
  } catch (err) {
    state.password = null;
    $("login-error").textContent = err.message === "Wrong password" ? "That password isn't right." : err.message;
  } finally {
    btn.disabled = false;
  }
});

$("logout").addEventListener("click", () => {
  try { sessionStorage.removeItem(PW_KEY); } catch { /* ignore */ }
  location.reload();
});

$("refresh").addEventListener("click", () => refresh(true));

function showDashboard() {
  $("login-view").classList.add("hidden");
  $("dash-view").classList.remove("hidden");
  $("logout").classList.remove("hidden");
  $("refresh").classList.remove("hidden");
  renderAll();
  clearInterval(state.timer);
  state.timer = setInterval(() => { if (!document.hidden) refresh(false); }, REFRESH_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(false); });
}

async function refresh(loud) {
  try {
    await load();
    if (loud) await loadProperties();
    renderAll();
    if (loud) toast("Updated.");
  } catch (err) {
    $("updated").textContent = `Couldn't update: ${err.message}. Retrying in a minute.`;
  }
}

// ---------- filters ----------

const groupOfProperty = (p) => (state.groups[p.block_lot] || p[CONFIG.GROUP_COLUMN] || "").trim();
const groupLabel = (g) => g || "No group";

function allGroups() {
  const names = new Set([...state.properties.map(groupOfProperty), ...state.rows.map((r) => r.observer_group)]);
  names.delete("");
  return [...names].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function syncSelect(sel, options, allLabel) {
  const keep = sel.value;
  sel.innerHTML = `<option value="">${h(allLabel)}</option>` + options.map((o) => `<option>${h(o)}</option>`).join("");
  sel.value = options.includes(keep) ? keep : "";
}

$("f-group").addEventListener("change", (e) => { state.filter.group = e.target.value; renderStats(); });
$("f-role").addEventListener("change", (e) => { state.filter.role = e.target.value; renderStats(); });
document.querySelectorAll('input[name="breakdown"]').forEach((r) => r.addEventListener("change", (e) => {
  state.breakdown = e.target.value;
  renderStats();
}));

// ---------- stats ----------

function renderAll() {
  const roles = [...new Set(state.rows.map((r) => r.observer_role).filter(Boolean))].sort();
  syncSelect($("f-group"), allGroups(), "All groups");
  syncSelect($("f-role"), roles, "All surveyor types");
  state.filter.group = $("f-group").value;
  state.filter.role = $("f-role").value;
  renderStats();
  renderGroups();
}

// One survey per property, so every count is a count of properties. If a
// property was surveyed more than once, use its latest survey where it could
// be observed, or else its latest survey.
function onePerProperty(rows) {
  const best = new Map();
  for (const r of rows) {
    const cur = best.get(r.block_lot);
    const better = !cur
      || (r.observation_status === "Observed") > (cur.observation_status === "Observed")
      || ((r.observation_status === "Observed") === (cur.observation_status === "Observed") && r.submitted_at > cur.submitted_at);
    if (better) best.set(r.block_lot, r);
  }
  return [...best.values()];
}

function renderStats() {
  const { group, role } = state.filter;
  const latest = onePerProperty(state.rows);
  const repeats = state.rows.length - latest.length;
  const rows = latest.filter((r) => (!group || r.observer_group === group) && (!role || r.observer_role === role));
  const observed = rows.filter((r) => r.observation_status === "Observed");
  const inScope = group ? state.properties.filter((p) => groupOfProperty(p) === group) : state.properties;
  const scopeIds = new Set(inScope.map((p) => p.block_lot));
  const surveyedInScope = rows.filter((r) => scopeIds.has(r.block_lot)).length;
  const anySurvey = new Set(latest.map((r) => r.block_lot));

  $("updated").textContent = `Updated ${state.updatedAt.toLocaleTimeString([], { timeStyle: "short" })}, refreshes every minute${repeats ? ` · ${fmt(repeats)} repeat ${repeats === 1 ? "survey" : "surveys"} of the same properties not counted twice` : ""}`;

  $("tiles").innerHTML = [
    tile("Properties surveyed", fmt(rows.length), `${pct(surveyedInScope, inScope.length)} of ${fmt(inScope.length)} ${group ? `in ${h(group)}` : "on the list"}`),
    // Whoever surveyed them: a property done by anyone isn't left to do.
    tile("Still to survey", fmt(inScope.filter((p) => !anySurvey.has(p.block_lot)).length), group ? `in ${h(group)}` : "on the list"),
    tile("Could be observed", pct(observed.length, rows.length), `${fmt(observed.length)} of ${fmt(rows.length)} properties surveyed`),
  ].join("");

  // Properties surveyed, broken down by the surveyor's group or type.
  const key = state.breakdown === "group" ? (r) => groupLabel(r.observer_group) : (r) => r.observer_role || "Not recorded";
  const byCat = new Map();
  for (const r of rows) byCat.set(key(r), (byCat.get(key(r)) || 0) + 1);
  const cats = [...byCat].sort((a, b) => b[1] - a[1]);
  barChart($("c-breakdown"), cats.map(([label, n]) => ({ label, value: n })),
    { unit: "properties", total: rows.length, colLabel: state.breakdown === "group" ? "Group" : "Surveyor type" });

  // Distress items ticked per observed survey.
  const distress = observed.map((r) => DISTRESS_COLS.filter((c) => yes(r[c])).length);
  barChart($("c-distress"), histogram(distress, 0).map(([v, n]) => ({ label: `${v} item${v === 1 ? "" : "s"}`, value: n })),
    { unit: "properties", total: distress.length, colLabel: "Items checked" });

  // Net occupancy signs.
  const net = observed.map((r) => VACANCY_SIGNS.filter((c) => yes(r[c])).length - OCCUPIED_SIGNS.filter((c) => yes(r[c])).length);
  barChart($("c-occupancy"), histogram(net, Math.min(0, ...net)).map(([v, n]) => ({ label: v > 0 ? `+${v}` : String(v), value: n })),
    { unit: "properties", total: net.length, colLabel: "Net signs" });

  // Distress score, current 0–4 scale only.
  const scored = observed.filter((r) => r.distress_scale === DISTRESS_SCALE_VERSION && r.distress_score !== "");
  const older = observed.filter((r) => r.distress_score !== "" && r.distress_scale !== DISTRESS_SCALE_VERSION).length;
  $("score-note").textContent = `0 = no signs of distress, 4 = blue sky vacant${older ? ` · ${fmt(older)} properties on the old 0–5 scale left out` : ""}`;
  barChart($("c-score"), DISTRESS_SCALE.slice().sort((a, b) => a.value - b.value).map((x) => ({
    label: `${x.value} · ${x.label}`, value: scored.filter((r) => Number(r.distress_score) === x.value).length,
  })), { unit: "properties", total: scored.length, colLabel: "Score" });

  // Occupancy rating.
  const ratings = OCCUPANCY_RATING.options.map((o) => ({ label: o, value: observed.filter((r) => r[OCCUPANCY_RATING.col] === o).length }));
  const unrated = observed.filter((r) => !OCCUPANCY_RATING.options.includes(r[OCCUPANCY_RATING.col])).length;
  if (unrated) ratings.push({ label: "Not recorded", value: unrated, tip: `${fmt(unrated)} properties surveyed before the rating was added` });
  barChart($("c-rating"), ratings, { unit: "properties", total: observed.length, colLabel: "Rating" });
}

const tile = (label, value, sub) => `<div class="tile"><p class="label">${h(label)}</p><p class="value">${value}</p><p class="sub">${sub}</p></div>`;

// Counts per whole number from `from` to the largest value, gaps included.
function histogram(values, from) {
  if (!values.length) return [];
  const max = Math.max(...values);
  const out = [];
  for (let v = from; v <= max; v++) out.push([v, values.filter((x) => x === v).length]);
  return out;
}

// Horizontal bars, value at the tip, hover/focus tooltip, and a table view.
function barChart(el, bars, { unit, total, colLabel }) {
  if (!total || !bars.length) { el.innerHTML = `<p class="empty-chart">No surveys yet${state.filter.group || state.filter.role ? " for this filter" : ""}.</p>`; return; }
  const max = Math.max(...bars.map((b) => b.value), 1);
  el.innerHTML = `
    <div class="bars">${bars.map((b) => `
      <div class="bar-label" title="${h(b.label)}">${h(b.label)}</div>
      <div class="bar-track" tabindex="0" data-tip="${h(`${b.label}: ${b.tip || `${fmt(b.value)} ${unit}`} (${pct(b.value, total)})`)}">
        <div class="bar" style="width:${(b.value / max) * 85}%"></div>
        <span class="bar-value">${fmt(b.value)}</span>
      </div>`).join("")}
    </div>
    <details class="table-view"><summary>Show as table</summary>
      <table><thead><tr><th>${h(colLabel)}</th><th class="num">${h(unit[0].toUpperCase() + unit.slice(1))}</th><th class="num">Share</th></tr></thead>
      <tbody>${bars.map((b) => `<tr><td>${h(b.label)}</td><td class="num">${fmt(b.value)}</td><td class="num">${pct(b.value, total)}</td></tr>`).join("")}</tbody></table>
    </details>`;
}

// One tooltip for every bar.
const $tip = $("tip");
function showTip(target, x, y) {
  $tip.textContent = target.dataset.tip;
  $tip.hidden = false;
  const r = $tip.getBoundingClientRect();
  $tip.style.left = `${Math.min(x + 12, innerWidth - r.width - 8)}px`;
  $tip.style.top = `${Math.max(8, y - r.height - 10)}px`;
}
document.addEventListener("pointermove", (e) => {
  const t = e.target.closest?.("[data-tip]");
  if (t) showTip(t, e.clientX, e.clientY); else $tip.hidden = true;
});
document.addEventListener("focusin", (e) => {
  const t = e.target.closest?.("[data-tip]");
  if (!t) { $tip.hidden = true; return; }
  const r = t.getBoundingClientRect();
  showTip(t, r.left + 40, r.top);
});
document.addEventListener("focusout", () => { $tip.hidden = true; });

// ---------- group assignment ----------

function shownProperties() {
  const q = $("g-search").value.trim().toLowerCase();
  const f = $("g-filter").value;
  return state.properties.filter((p) => {
    const g = groupOfProperty(p);
    if (f === "__none" ? g : f && g !== f) return false;
    return !q || `${p.address} ${p.block_lot} ${p.neighborhood || ""}`.toLowerCase().includes(q);
  });
}

function renderGroups() {
  const groups = allGroups();
  const filterSel = $("g-filter");
  const keep = filterSel.value;
  filterSel.innerHTML = `<option value="">All properties</option><option value="__none">No group</option>` +
    groups.map((g) => `<option>${h(g)}</option>`).join("");
  filterSel.value = [...filterSel.options].some((o) => o.value === keep) ? keep : "";
  $("g-names").innerHTML = groups.map((g) => `<option value="${h(g)}">`).join("");
  renderGroupRows();
}

function renderGroupRows() {
  const counts = {};
  for (const r of state.rows) counts[r.block_lot] = (counts[r.block_lot] || 0) + 1;
  const shown = shownProperties();
  $("g-rows").innerHTML = shown.map((p) => {
    const g = groupOfProperty(p);
    const sel = state.selected.has(p.block_lot);
    return `<tr class="${sel ? "selected" : ""}">
      <td><input type="checkbox" data-bl="${h(p.block_lot)}" ${sel ? "checked" : ""} aria-label="Select ${h(p.address)}"></td>
      <td>${h(p.address)}</td><td>${h(p.block_lot)}</td><td>${h(p.neighborhood || "")}</td>
      <td class="${g ? "" : "nogroup"}">${h(groupLabel(g))}</td><td class="num">${counts[p.block_lot] || 0}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="6" class="muted">No properties match.</td></tr>`;
  const all = $("g-all");
  const shownSel = shown.filter((p) => state.selected.has(p.block_lot)).length;
  all.checked = shown.length > 0 && shownSel === shown.length;
  all.indeterminate = shownSel > 0 && shownSel < shown.length;
  $("g-count").textContent = `${fmt(state.selected.size)} selected`;
}

$("g-search").addEventListener("input", renderGroupRows);
$("g-filter").addEventListener("change", renderGroupRows);
$("g-rows").addEventListener("change", (e) => {
  const bl = e.target.dataset.bl;
  if (!bl) return;
  if (e.target.checked) state.selected.add(bl); else state.selected.delete(bl);
  renderGroupRows();
});
$("g-all").addEventListener("change", (e) => {
  for (const p of shownProperties()) {
    if (e.target.checked) state.selected.add(p.block_lot); else state.selected.delete(p.block_lot);
  }
  renderGroupRows();
});

async function assign(group) {
  $("g-error").textContent = "";
  if (!state.selected.size) { $("g-error").textContent = "Tick at least one property first."; return; }
  const n = state.selected.size;
  const buttons = [$("g-assign"), $("g-clear")];
  buttons.forEach((b) => { b.disabled = true; });
  try {
    const json = await post({ type: "assign", assignments: [...state.selected].map((block_lot) => ({ block_lot, group })) });
    state.groups = json.groups || {};
    state.selected.clear();
    renderAll();
    toast(group ? `${fmt(n)} ${n === 1 ? "property" : "properties"} assigned to ${group}.` : `Group removed from ${fmt(n)} ${n === 1 ? "property" : "properties"}.`);
  } catch (err) {
    $("g-error").textContent = `Couldn't save: ${err.message}`;
  } finally {
    buttons.forEach((b) => { b.disabled = false; });
  }
}

$("g-assign").addEventListener("click", () => {
  const name = $("g-name").value.trim();
  if (!name) { $("g-error").textContent = "Type a group name, or pick an existing one."; return; }
  assign(name);
});
// Removing the dashboard's assignment puts a property back on the group in the
// property list file, if that file has one.
$("g-clear").addEventListener("click", () => assign(""));

// ---------- group file upload ----------

// Block-lots are compared without case or extra spaces ("0001  001" = "0001 001").
const normBL = (v) => String(v ?? "").trim().replace(/\s+/g, " ").toUpperCase();
const pick = (row, names) => { for (const n of names) if (n in row) return row[n]; return undefined; };
let pending = null; // parsed upload awaiting Apply

$("g-file").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  $("g-error").textContent = "";
  try {
    pending = parseGroupFile(await file.text(), file.name);
    renderPreview();
  } catch (err) {
    pending = null;
    $("g-preview").classList.add("hidden");
    $("g-error").textContent = err.message;
  }
});

function parseGroupFile(text, name) {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error(`${name} has no rows.`);
  const BL = ["block_lot", "blocklot", "block-lot", "block_lot_id"];
  const GROUP = ["group", "team", "group_name"];
  if (pick(rows[0], BL) === undefined || pick(rows[0], GROUP) === undefined) {
    throw new Error(`${name} needs a "block_lot" column and a "group" column. Its columns are: ${Object.keys(rows[0]).join(", ")}.`);
  }
  const byNorm = new Map(state.properties.map((p) => [normBL(p.block_lot), p.block_lot]));
  const assign = new Map(); // list block_lot → group (a later row wins)
  const notFound = [];
  let blank = 0;
  for (const r of rows) {
    const raw = pick(r, BL);
    const group = String(pick(r, GROUP) ?? "").trim();
    if (!String(raw ?? "").trim()) continue;
    if (!group) { blank++; continue; }
    const bl = byNorm.get(normBL(raw));
    if (bl) assign.set(bl, group); else notFound.push(raw);
  }
  if (!assign.size) throw new Error(`None of the block-lots in ${name} are on the property list${notFound.length ? ` (e.g. ${notFound.slice(0, 3).join(", ")})` : ""}.`);
  return { name, assign, notFound, blank };
}

function renderPreview() {
  const { name, assign, notFound, blank } = pending;
  const perGroup = new Map();
  let changes = 0;
  for (const [bl, g] of assign) {
    perGroup.set(g, (perGroup.get(g) || 0) + 1);
    if (groupOfProperty(state.properties.find((p) => p.block_lot === bl)) !== g) changes++;
  }
  const missing = state.properties.filter((p) => !assign.has(p.block_lot)).length;
  const el = $("g-preview");
  el.innerHTML = `
    <h3>Ready to apply ${h(name)}</h3>
    <ul>
      ${[...perGroup].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
        .map(([g, n]) => `<li><b>${h(g)}</b>: ${fmt(n)} ${n === 1 ? "property" : "properties"}</li>`).join("")}
    </ul>
    <p class="small">${fmt(changes)} of these change group.${missing ? ` ${missing === 1 ? "1 property on the list isn't" : `${fmt(missing)} properties on the list aren't`} in the file; ${missing === 1 ? "it keeps its" : "they keep their"} current group.` : ""}</p>
    ${notFound.length ? `<p class="small warn-text">${notFound.length === 1 ? "1 block-lot in the file isn't" : `${fmt(notFound.length)} block-lots in the file aren't`} on the property list and will be skipped: ${h(notFound.slice(0, 5).join(", "))}${notFound.length > 5 ? "…" : ""}</p>` : ""}
    ${blank ? `<p class="small warn-text">${blank === 1 ? "1 row has" : `${fmt(blank)} rows have`} no group and will be skipped.</p>` : ""}
    <div class="actions-row">
      ${missing ? `<label class="inline"><input type="checkbox" id="g-replace"> Also remove the group from the ${fmt(missing)} properties not in the file</label>` : ""}
    </div>
    <div class="actions-row">
      <button type="button" class="btn small primary" id="g-apply">Apply</button>
      <button type="button" class="btn small ghost" id="g-cancel">Cancel</button>
    </div>`;
  el.classList.remove("hidden");
  $("g-cancel").addEventListener("click", () => { pending = null; el.classList.add("hidden"); });
  $("g-apply").addEventListener("click", applyUpload);
}

async function applyUpload() {
  const btn = $("g-apply");
  btn.disabled = true;
  const assignments = [...pending.assign].map(([block_lot, group]) => ({ block_lot, group }));
  if ($("g-replace")?.checked) {
    for (const p of state.properties) if (!pending.assign.has(p.block_lot)) assignments.push({ block_lot: p.block_lot, group: "" });
  }
  try {
    const json = await post({ type: "assign", assignments });
    state.groups = json.groups || {};
    state.selected.clear();
    const n = pending.assign.size;
    pending = null;
    $("g-preview").classList.add("hidden");
    renderAll();
    toast(`Groups updated for ${fmt(n)} ${n === 1 ? "property" : "properties"}.`);
  } catch (err) {
    $("g-error").textContent = `Couldn't save: ${err.message}`;
    btn.disabled = false;
  }
}

// The current groups as a CSV to edit and upload again.
$("g-download").addEventListener("click", () => {
  const rows = state.properties.map((p) => ({
    block_lot: p.block_lot, group: groupOfProperty(p), address: p.address, neighborhood: p.neighborhood ?? "",
  }));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["\ufeff" + toCsv(rows)], { type: "text/csv" }));
  a.download = `vbn-groups_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// ---------- misc ----------

let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3500);
}

// Stay logged in for this browser tab.
(async () => {
  let saved = null;
  try { saved = sessionStorage.getItem(PW_KEY); } catch { /* private mode */ }
  if (!saved) return;
  state.password = saved;
  try {
    await Promise.all([load(), loadProperties()]);
    showDashboard();
  } catch {
    state.password = null;
  }
})();
