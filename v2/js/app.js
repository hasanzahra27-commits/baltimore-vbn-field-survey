import { CONFIG } from "./config.js";
import {
  INDICATORS, SECTIONS, FACADE_DAMAGE, DISTRESS_SCALE, DISTRESS_SCALE_VERSION,
  ROLES, NOT_OBSERVED_REASONS, NO_BACK_PHOTO_REASONS,
} from "./checklist.js";
import { putSurvey, allSurveys, deleteSurvey } from "./db.js";
import { parseCsv, toCsv } from "./csv.js";
import { buildRow, normalize, syncPending, fetchRemoteStatus } from "./sync.js";

const $view = document.getElementById("view");
const $pill = document.getElementById("sync-pill");
const $toast = document.getElementById("toast");

const state = {
  properties: [],
  surveys: [],
  remote: readJson("vbn2.remote", {}),
  observer: readJson("vbn2.observer", null),
  filter: "todo",
  query: "",
  current: null, // survey being edited
  syncing: false,
  syncError: null,
};

// ---------- helpers ----------

function readJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked */ }
}
const h = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const uuid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "");
const fmtClock = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { timeStyle: "short" }) : "");
const labelize = (k) => k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const safeName = (s) => s.replace(/[^\w-]+/g, "-");
const REQ = `<span class="req">required</span>`;
const OPT = `<span class="opt">optional</span>`;
const radio = (name, value, label, current) =>
  `<label><input type="radio" name="${name}" value="${h(value)}" ${current === value ? "checked" : ""}><span>${h(label)}</span></label>`;

let toastTimer;
function toast(msg) {
  $toast.textContent = msg;
  $toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove("show"), 3500);
}

// A dropdown whose last option, "Other", opens a box to type any answer.
// The stored value is just the text, whichever way it was entered.
function choiceField(name, label, options, value) {
  const other = !!value && !options.includes(value);
  return `<label class="field">${label}
      <select data-choice="${name}">
        <option value="">Choose…</option>
        ${options.map((o) => `<option ${value === o ? "selected" : ""}>${h(o)}</option>`).join("")}
        <option value="__other" ${other ? "selected" : ""}>Other (type your own)</option>
      </select>
    </label>
    <label class="field ${other ? "" : "hidden"}" data-other-for="${name}">Your answer
      <input data-choice-text="${name}" value="${other ? h(value) : ""}">
    </label>`;
}

function readChoice(root, name) {
  const sel = root.querySelector(`[data-choice="${name}"]`);
  if (sel.value !== "__other") return sel.value;
  return root.querySelector(`[data-choice-text="${name}"]`).value.trim();
}

function syncChoiceVisibility(root, sel) {
  const box = root.querySelector(`[data-other-for="${sel.dataset.choice}"]`);
  const show = sel.value === "__other";
  if (show && box.classList.contains("hidden")) setTimeout(() => box.querySelector("input").focus(), 0);
  box.classList.toggle("hidden", !show);
}

// ---------- data loading ----------

async function loadProperties() {
  try {
    const res = await fetch(CONFIG.PROPERTIES_URL, { cache: "no-cache" });
    if (!res.ok) throw new Error(res.status);
    state.properties = parseCsv(await res.text()).filter((p) => p.block_lot && p.address);
    writeJson("vbn2.properties", state.properties);
  } catch {
    state.properties = readJson("vbn2.properties", []);
    if (!state.properties.length) toast("Could not load the property list. Connect to the internet and reload.");
  }
}

async function refreshSurveys() {
  state.surveys = (await allSurveys()).map(normalize).sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

// "todo" | "draft" | "pending" | "done"
function propertyStatus(blockLot) {
  const mine = state.surveys.filter((s) => s.blockLot === blockLot);
  if (mine.some((s) => s.state === "draft")) return "draft";
  if (mine.some((s) => s.state === "pending")) return "pending";
  if (mine.some((s) => s.state === "synced") || state.remote[blockLot]) return "done";
  return "todo";
}

const STATUS_LABEL = {
  todo: "Not yet surveyed",
  draft: "Draft",
  pending: "Saved · waiting to upload",
  done: "Surveyed",
};

// ---------- sync ----------

async function syncNow({ quiet = true } = {}) {
  if (state.syncing) return;
  state.syncing = true;
  renderPill();
  try {
    const r = await syncPending();
    state.syncError = r.error || null;
    if (!quiet && r.uploaded) toast(`Uploaded ${r.uploaded} survey${r.uploaded > 1 ? "s" : ""}.`);
    if (!quiet && r.failed) toast(`Upload failed: ${r.error}`);
    const remote = await fetchRemoteStatus().catch(() => null);
    if (remote) { state.remote = remote; writeJson("vbn2.remote", remote); }
  } finally {
    state.syncing = false;
    await refreshSurveys();
    renderPill();
    const onList = location.hash.startsWith("#/list") || !location.hash;
    if (onList && document.activeElement?.id === "search") renderListItems();
    else if (onList || location.hash.startsWith("#/menu")) render();
  }
}

function renderPill() {
  const pending = state.surveys.filter((s) => s.state === "pending").length;
  let text, cls;
  if (state.syncing) [text, cls] = ["Uploading…", "busy"];
  else if (!CONFIG.SYNC_URL) [text, cls] = [pending ? `${pending} saved on phone` : "Local only", "warn"];
  else if (!navigator.onLine) [text, cls] = [pending ? `Offline · ${pending} waiting` : "Offline", "warn"];
  else if (state.syncError && pending) [text, cls] = [`${pending} not uploaded · retry`, "bad"];
  else if (pending) [text, cls] = [`${pending} waiting`, "warn"];
  else [text, cls] = ["All uploaded ✓", "ok"];
  $pill.textContent = text;
  $pill.className = `pill ${cls}`;
}

$pill.addEventListener("click", () => {
  if (!CONFIG.SYNC_URL) return toast("No upload server is set up yet. Use Menu → Export CSV.");
  if (!navigator.onLine) return toast("You're offline. Surveys will upload when you reconnect.");
  syncNow({ quiet: false });
});

// ---------- routing ----------

function render() {
  const hash = location.hash || "#/list";
  if (!state.observer && !hash.startsWith("#/observer")) { location.hash = "#/observer"; return; }
  if (hash.startsWith("#/observer")) return renderObserver();
  if (hash.startsWith("#/menu")) return renderMenu();
  if (hash.startsWith("#/survey/")) return openSurvey(decodeURIComponent(hash.slice("#/survey/".length)));
  return renderList();
}

window.addEventListener("hashchange", () => {
  if (!location.hash.startsWith("#/survey/")) state.current = null;
  render();
  window.scrollTo(0, 0);
});

// ---------- observer ----------

function renderObserver() {
  const o = state.observer || { name: "", role: "", codeEnforcement: null };
  const role = o.role === "Other" ? o.roleOther : o.role;
  $view.innerHTML = `
    <section class="card">
      <h1>About you</h1>
      <p class="muted">Saved on this phone and attached to every survey you submit.</p>
      <form id="observer-form" novalidate>
        <label class="field">Your name ${REQ}
          <input name="name" required autocomplete="name" value="${h(o.name)}">
        </label>
        ${choiceField("role", `Your role ${REQ}`, ROLES, role)}
        <fieldset class="field">
          <legend>Are you an official code enforcement officer? ${REQ}</legend>
          <div class="seg">
            <label><input type="radio" name="codeEnforcement" value="yes" ${o.codeEnforcement === true ? "checked" : ""}><span>Yes</span></label>
            <label><input type="radio" name="codeEnforcement" value="no" ${o.codeEnforcement === false ? "checked" : ""}><span>No</span></label>
          </div>
        </fieldset>
        <p class="error" id="observer-error"></p>
        <button class="btn primary block" type="submit">Save and continue</button>
      </form>
    </section>`;
  const form = document.getElementById("observer-form");
  form.addEventListener("change", (e) => { if (e.target.dataset.choice) syncChoiceVisibility(form, e.target); });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const ce = form.codeEnforcement.value;
    const next = {
      name: form.name.value.trim(),
      role: readChoice(form, "role"),
      codeEnforcement: ce === "yes" ? true : ce === "no" ? false : null,
    };
    const err = !next.name ? "Enter your name."
      : !next.role ? "Choose or type your role."
      : next.codeEnforcement === null ? "Answer the code enforcement question."
      : "";
    document.getElementById("observer-error").textContent = err;
    if (err) return;
    state.observer = next;
    writeJson("vbn2.observer", next);
    location.hash = "#/list";
  });
}

// ---------- property list ----------

function renderList() {
  const counts = { todo: 0, done: 0, all: state.properties.length };
  for (const p of state.properties) {
    const st = propertyStatus(p.block_lot);
    if (st === "todo" || st === "draft") counts.todo++; else counts.done++;
  }
  $view.innerHTML = `
    <div class="observer-line">Surveying as <a href="#/observer"><strong>${h(state.observer.name)}</strong></a> · ${h(state.observer.role)}</div>
    <div class="search-wrap">
      <input type="search" id="search" placeholder="Search address or block-lot" value="${h(state.query)}" autocomplete="off">
    </div>
    <div class="tabs" role="tablist">
      ${[["todo", "Not yet surveyed"], ["done", "Surveyed"], ["all", "All"]].map(([k, l]) =>
        `<button type="button" role="tab" data-filter="${k}" aria-selected="${state.filter === k}">${l} <span class="count">${counts[k]}</span></button>`).join("")}
    </div>
    <ul class="plist" id="plist"></ul>`;
  const search = document.getElementById("search");
  search.addEventListener("input", () => { state.query = search.value; renderListItems(); });
  $view.querySelectorAll("[data-filter]").forEach((b) => b.addEventListener("click", () => {
    state.filter = b.dataset.filter;
    renderList();
  }));
  renderListItems();
}

function renderListItems() {
  const q = state.query.trim().toLowerCase();
  const items = state.properties.filter((p) => {
    const st = propertyStatus(p.block_lot);
    if (state.filter === "todo" && !(st === "todo" || st === "draft")) return false;
    if (state.filter === "done" && !(st === "pending" || st === "done")) return false;
    return !q || `${p.address} ${p.block_lot} ${p.neighborhood || ""}`.toLowerCase().includes(q);
  });
  document.getElementById("plist").innerHTML = items.length
    ? items.map((p) => {
      const st = propertyStatus(p.block_lot);
      return `<li><a href="#/survey/${encodeURIComponent(p.block_lot)}">
          <span class="addr">${h(p.address)}</span>
          <span class="meta">Block-lot ${h(p.block_lot)}${p.neighborhood ? ` · ${h(p.neighborhood)}` : ""}</span>
          <span class="badge ${st}">${STATUS_LABEL[st]}</span>
        </a></li>`;
    }).join("")
    : `<li class="empty">${state.properties.length ? "No properties match." : "No properties loaded."}</li>`;
}

// ---------- survey ----------

function newSurvey(property) {
  return normalize({
    id: uuid(),
    blockLot: property.block_lot,
    property,
    state: "draft",
    scaleVersion: DISTRESS_SCALE_VERSION,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    observer: { ...state.observer },
    data: {
      observation_status: null,
      not_observed_reason: "",
      checks: {},
      facade_damage: null,
      score: null,
      comments: "",
    },
    photos: [],
  });
}

function openSurvey(blockLot) {
  const property = state.properties.find((p) => p.block_lot === blockLot);
  if (!property) { $view.innerHTML = `<section class="card"><p>Property ${h(blockLot)} is not in the list.</p><a class="btn" href="#/list">Back</a></section>`; return; }
  if (!state.current || state.current.blockLot !== blockLot) {
    state.current = state.surveys.find((s) => s.blockLot === blockLot && s.state === "draft") || newSurvey(property);
  }
  renderSurvey();
}

function priorSurveyNote(blockLot) {
  const mine = state.surveys.filter((s) => s.blockLot === blockLot && s.state !== "draft");
  const remote = state.remote[blockLot];
  if (!mine.length && !remote) return "";
  const who = remote ? `${remote.count} survey${remote.count > 1 ? "s" : ""} on file, last ${fmtTime(remote.last_submitted_at)}${remote.last_observer ? ` by ${h(remote.last_observer)}` : ""}`
    : `You submitted a survey on ${fmtTime(mine[0].submittedAt)}`;
  return `<div class="notice">Already surveyed: ${who}. You can still submit another one.</div>`;
}

// A checkbox; once ticked, it opens a box for details on that item.
function indicatorRow(col, d) {
  return `<div class="item">
    <label class="check">
      <input type="checkbox" data-check="${col}" ${d.checks[col] ? "checked" : ""}>
      <span class="box" aria-hidden="true"></span>
      <span class="txt">${h(INDICATORS[col].text)}</span>
    </label>
    <div class="details" data-details-for="${col}">
      <textarea data-detail="${col}" rows="2" placeholder="Details (optional): ${h(INDICATORS[col].prompt)}">${h(d.details[col])}</textarea>
    </div>
  </div>`;
}

function photoGroup(kind, addLabel, col = "", big = false) {
  return `<div class="pgroup" data-kind="${kind}" data-col="${col}" data-add="${h(addLabel)}" data-big="${big ? 1 : ""}"></div>`;
}

function renderSurvey() {
  const s = state.current;
  const d = s.data;
  const p = s.property;
  const loc = d.location;
  const f = d.finding;
  const hidden = CONFIG.HIDDEN_PROPERTY_FIELDS || [];
  const extra = Object.entries(p).filter(([k, v]) => !["block_lot", "address", ...hidden].includes(k) && v !== "");

  $view.innerHTML = `
    <form id="survey" novalidate>
      <section class="card prop">
        <a href="#/list" class="back">← All properties</a>
        <h1>${h(p.address)}</h1>
        <p class="muted">Block-lot <strong>${h(p.block_lot)}</strong></p>
        ${extra.length ? `<dl class="facts">${extra.map(([k, v]) => `<dt>${h(labelize(k))}</dt><dd>${h(v)}</dd>`).join("")}</dl>` : ""}
        ${priorSurveyNote(s.blockLot)}
        <div class="visit"><div><span class="muted">Started</span> ${fmtTime(s.createdAt)}</div></div>
        <p class="muted small key">Questions marked ${REQ} must be answered before you can submit. Everything marked ${OPT} can be skipped.</p>
      </section>

      <section class="card" id="sec-status">
        <h2>Could you observe the property? ${REQ}</h2>
        <div class="seg">
          ${radio("observation_status", "Observed", "Yes", d.observation_status)}
          ${radio("observation_status", "Could not observe", "No", d.observation_status)}
        </div>
        <div data-show="notObserved" class="sub">
          ${choiceField("not_observed_reason", `Why not? ${REQ}`, NOT_OBSERVED_REASONS, d.not_observed_reason)}
        </div>
        <p class="error" data-err="status"></p>
      </section>

      <section class="card" id="sec-location" data-show="answered">
        <h2>Location</h2>
        <fieldset class="field">
          <legend>Are you at the property right now? ${REQ}</legend>
          <div class="seg">
            ${radio("at_property", "yes", "Yes, I'm here", loc.atProperty === true ? "yes" : loc.atProperty === false ? "no" : "")}
            ${radio("at_property", "no", "No, filling in later", loc.atProperty === true ? "yes" : loc.atProperty === false ? "no" : "")}
          </div>
        </fieldset>
        <div data-show="atYes">
          <div id="gps-box"></div>
        </div>
        <div data-show="atNo">
          <label class="field">Where were you when you observed it? ${REQ}
            <input data-loc="manual" value="${h(loc.manual)}" placeholder="e.g. in front of the house; alley behind; corner of X and Y">
          </label>
          <label class="field">When did you observe it? ${REQ}
            <input type="datetime-local" data-loc="observedAt" value="${h(loc.observedAt)}">
          </label>
        </div>
        <p class="error" data-err="location"></p>
      </section>

      ${SECTIONS.map((sec) => `
        <section class="card crit" data-show="observed">
          <h2>${h(sec.title)} ${OPT}</h2>
          <p class="muted small intro">${h(sec.intro)} Tick everything that applies.</p>
          ${sec.groups.map((g) => `
            ${g.title ? `<h3>${h(g.title)}</h3>` : ""}
            ${g.intro ? `<p class="muted small intro">${h(g.intro)}</p>` : ""}
            <div class="items">${g.cols.map((col) => indicatorRow(col, d)).join("")}</div>`).join("")}
          ${sec.facade ? `
            <fieldset class="field facade">
              <legend>${h(FACADE_DAMAGE.label)} ${OPT}</legend>
              <div class="seg">${FACADE_DAMAGE.options.map((o) => radio("facade_damage", o, o, d.facade_damage)).join("")}</div>
              <div class="details" data-show="facadeDamage">
                <textarea data-detail="${FACADE_DAMAGE.col}" rows="2" placeholder="Details (optional): ${h(FACADE_DAMAGE.prompt)}">${h(d.details[FACADE_DAMAGE.col])}</textarea>
              </div>
            </fieldset>` : ""}
        </section>`).join("")}

      <section class="card" id="sec-score" data-show="observed">
        <h2>Overall distress score ${REQ}</h2>
        <div class="scale">
          ${DISTRESS_SCALE.map((x) => `
            <label class="scale-opt">
              <input type="radio" name="score" value="${x.value}" ${d.score === x.value ? "checked" : ""}>
              <span class="num">${x.value}</span>
              <span class="lbl"><strong>${h(x.label)}</strong><small>${h(x.hint)}</small></span>
            </label>`).join("")}
        </div>
        <p class="error" data-err="score"></p>
      </section>

      <section class="card" id="sec-photos" data-show="answered">
        <h2>Photos</h2>
        <p class="muted small">Take as many as you need. Add a note to each one so we know what it shows.</p>
        <div class="photo-slot">
          <div class="photo-label">Front <span class="req" data-show="observed">required · at least 1</span><span class="opt" data-show="notObserved">optional</span></div>
          ${photoGroup("front", "Add front photo", "", true)}
          <div class="two">
            <label class="field">Houses from the corner ${OPT}
              <input type="number" inputmode="numeric" min="0" data-find="housesFromCorner" value="${h(f.housesFromCorner)}">
            </label>
            <label class="field">Counted from which corner? ${OPT}
              <input data-find="countedFrom" value="${h(f.countedFrom)}" placeholder="e.g. N Fulton Ave">
            </label>
            <label class="field">Front color ${OPT}
              <input data-find="frontColor" value="${h(f.frontColor)}" placeholder="e.g. red brick, blue door">
            </label>
          </div>
        </div>
        <div class="photo-slot">
          <div class="photo-label">Back <span class="req" data-show="backRequired">required · at least 1</span><span class="opt" data-show="backOptional">optional</span></div>
          ${photoGroup("back", "Add back photo", "", true)}
          <div class="two">
            <label class="field">Houses from the corner (counted in back) ${OPT}
              <input type="number" inputmode="numeric" min="0" data-find="housesFromCornerBack" value="${h(f.housesFromCornerBack)}">
            </label>
            <label class="field">Back color ${OPT}
              <input data-find="backColor" value="${h(f.backColor)}" placeholder="e.g. white siding">
            </label>
          </div>
          <div data-show="observed">
            <label class="check compact">
              <input type="checkbox" data-flag="no_back_photo" ${d.no_back_photo ? "checked" : ""}>
              <span class="box" aria-hidden="true"></span>
              <span class="txt">I couldn't photograph the back</span>
            </label>
            <div data-show="noBack" class="sub">
              ${choiceField("no_back_reason", `Why not? ${REQ}`, NO_BACK_PHOTO_REASONS, d.no_back_reason)}
            </div>
          </div>
        </div>
        <div class="photo-slot" data-show="observed">
          <div class="photo-label">Was the property secured during this visit? ${OPT}</div>
          <p class="muted small">For example, boarded or locked after illegal occupants were found.</p>
          <div class="seg">
            ${radio("secured", "yes", "Yes", d.secured === true ? "yes" : d.secured === false ? "no" : "")}
            ${radio("secured", "no", "No", d.secured === true ? "yes" : d.secured === false ? "no" : "")}
          </div>
          <div data-show="secured" class="sub">
            <label class="field">What was done, and by whom? ${OPT}
              <textarea data-field="secured_details" rows="2">${h(d.secured_details)}</textarea>
            </label>
            <div class="photo-label">Before ${OPT}</div>
            ${photoGroup("secure_before", "Add before photo")}
            <div class="photo-label">After ${OPT}</div>
            ${photoGroup("secure_after", "Add after photo")}
          </div>
        </div>
        <div class="photo-slot">
          <div class="photo-label">Other photos ${OPT}</div>
          ${photoGroup("concern", "Add another photo")}
        </div>
        <p class="error" data-err="photos"></p>
      </section>

      <section class="card" data-show="answered">
        <h2>General comments ${OPT}</h2>
        <textarea name="comments" rows="4" placeholder="Anything else notable about this property">${h(d.comments)}</textarea>
      </section>

      <div class="actions">
        <button type="submit" class="btn primary block">Submit survey</button>
        <button type="button" class="btn block" id="save-draft">Save draft and finish later</button>
        <p class="muted small center" id="save-status">${s.updatedAt ? `Draft saved ${fmtClock(s.updatedAt)}` : ""}</p>
        <button type="button" class="btn ghost block" id="discard">Discard this survey</button>
      </div>
    </form>`;

  bindSurvey();
  renderPhotos();
  renderGps();
  applyVisibility();
}

// Shows and hides the parts of the form that depend on earlier answers.
function applyVisibility() {
  const d = state.current.data;
  const observed = d.observation_status === "Observed";
  const when = {
    answered: !!d.observation_status,
    observed,
    notObserved: d.observation_status === "Could not observe",
    atYes: d.location.atProperty === true,
    atNo: d.location.atProperty === false,
    facadeDamage: !!d.facade_damage && d.facade_damage !== "None",
    noBack: d.no_back_photo,
    backRequired: observed && !d.no_back_photo,
    backOptional: !(observed && !d.no_back_photo),
    secured: d.secured === true,
  };
  document.querySelectorAll("#survey [data-show]").forEach((el) => el.classList.toggle("hidden", !when[el.dataset.show]));
  document.querySelectorAll("#survey [data-details-for]").forEach((el) =>
    el.classList.toggle("hidden", !d.checks[el.dataset.detailsFor]));
}

let saveTimer;
function autosave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDraft, 300);
}

async function saveDraft() {
  clearTimeout(saveTimer);
  const s = state.current;
  if (!s || s.state !== "draft") return;
  s.updatedAt = new Date().toISOString();
  await putSurvey(s);
  await refreshSurveys();
  const el = document.getElementById("save-status");
  if (el && state.current === s) el.textContent = `Draft saved ${fmtClock(s.updatedAt)}`;
}

const yesNo = (v) => (v === "yes" ? true : v === "no" ? false : null);

function bindSurvey() {
  const form = document.getElementById("survey");
  const s = state.current;
  const d = s.data;
  const onChange = (e) => {
    const t = e.target;
    if (t.type === "file") {
      const files = [...(t.files || [])];
      t.value = "";
      if (files.length) addPhotos(t.dataset.kind, t.dataset.col, files);
      return;
    }
    if (t.dataset.choice) {
      syncChoiceVisibility(form, t);
      d[t.dataset.choice] = readChoice(form, t.dataset.choice);
    } else if (t.dataset.choiceText) d[t.dataset.choiceText] = readChoice(form, t.dataset.choiceText);
    else if (t.dataset.check) d.checks[t.dataset.check] = t.checked;
    else if (t.dataset.detail) d.details[t.dataset.detail] = t.value;
    else if (t.dataset.flag) d[t.dataset.flag] = t.checked;
    else if (t.dataset.field) d[t.dataset.field] = t.value;
    else if (t.dataset.loc) d.location[t.dataset.loc] = t.value;
    else if (t.dataset.find) d.finding[t.dataset.find] = t.value;
    else if (t.name === "observation_status") d.observation_status = t.value;
    else if (t.name === "at_property") d.location.atProperty = yesNo(t.value);
    else if (t.name === "secured") d.secured = yesNo(t.value);
    else if (t.name === "facade_damage") d.facade_damage = t.value;
    else if (t.name === "score") d.score = Number(t.value);
    else if (t.name === "comments") d.comments = t.value;
    else if (t.dataset.caption) {
      const photo = s.photos.find((p) => p.id === t.dataset.caption);
      if (photo) photo.caption = t.value;
    } else return;
    const err = t.closest("section")?.querySelector("[data-err]");
    if (err) err.textContent = "";
    if (e.type === "change") applyVisibility();
    autosave();
  };
  form.addEventListener("change", onChange);
  form.addEventListener("input", (e) => { if (e.target.matches("textarea, input:not([type=radio]):not([type=checkbox]):not([type=file])")) onChange(e); });
  form.addEventListener("click", (e) => {
    const rm = e.target.closest("[data-remove]");
    if (!rm) return;
    if (!confirm("Remove this photo?")) return;
    s.photos = s.photos.filter((p) => p.id !== rm.dataset.remove);
    renderPhotos();
    autosave();
  });
  form.addEventListener("submit", (e) => { e.preventDefault(); submitSurvey(); });
  document.getElementById("save-draft").addEventListener("click", async () => {
    await saveDraft();
    state.current = null;
    toast("Draft saved. Open the property again, or use the Menu, to finish it.");
    location.hash = "#/list";
  });
  document.getElementById("discard").addEventListener("click", async () => {
    if (!confirm("Discard this survey and its photos?")) return;
    clearTimeout(saveTimer);
    await deleteSurvey(s.id);
    await refreshSurveys();
    state.current = null;
    location.hash = "#/list";
  });
}

// ---------- GPS ----------

// Only runs when the researcher taps "Register location", so the stamp is
// where they actually stood, not where they were when they opened the form.
function captureGps() {
  const s = state.current;
  if (!("geolocation" in navigator)) { s.gpsError = "Location isn't available on this device. Choose “No” above and type it in."; return renderGps(); }
  s.gpsError = "locating";
  renderGps();
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      s.data.location.gps = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, at: new Date(pos.timestamp).toISOString() };
      s.gpsError = null;
      if (state.current === s) {
        renderGps();
        const err = document.querySelector('[data-err="location"]');
        if (err) err.textContent = "";
      }
      autosave();
    },
    (err) => {
      s.gpsError = err.code === 1
        ? "Location is blocked for this site, so your phone won't ask again. To turn it on: on iPhone, go to Settings → Privacy & Security → Location Services → Safari Websites → While Using the App. On Android, tap the icon left of the web address → Permissions → Location → Allow. Then tap Register location again, or choose “No” above and type it in."
        : "Couldn't get a location. Try again, or choose “No” above and type it in.";
      if (state.current === s) renderGps();
    },
    // maximumAge 0: never reuse a position from the last house.
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
  );
}

const LOW_ACCURACY_M = 50;

function renderGps() {
  const el = document.getElementById("gps-box");
  if (!el) return;
  const s = state.current;
  const g = s.data.location.gps;
  if (s.gpsError === "locating") {
    el.innerHTML = `<button type="button" class="btn camera" disabled>Finding your location…</button>`;
    return;
  }
  el.innerHTML = `
    ${g ? `<div class="gps-ok">📍 Location registered at ${fmtClock(g.at)} <span class="muted">(within ${Math.round(g.acc)} m)</span></div>
      ${g.acc > LOW_ACCURACY_M ? `<p class="notice">That's not very precise. Step outside or wait a few seconds, then tap Update.</p>` : ""}` : ""}
    ${s.gpsError ? `<p class="error">${h(s.gpsError)}</p>` : ""}
    <button type="button" class="btn ${g ? "small" : "camera"}" id="gps-btn">${g ? "Update location" : "📍 Register location"}</button>`;
  document.getElementById("gps-btn").addEventListener("click", captureGps);
}

// ---------- photos ----------

const objectUrls = [];

function renderPhotos() {
  objectUrls.splice(0).forEach((u) => URL.revokeObjectURL(u));
  const s = state.current;
  const thumb = (p) => {
    if (!p.blob) return `<div class="thumb uploaded">Uploaded</div>`;
    const url = URL.createObjectURL(p.blob);
    objectUrls.push(url);
    return `<img class="thumb" src="${url}" alt="">`;
  };
  document.querySelectorAll("#survey .pgroup").forEach((g) => {
    const { kind, col } = g.dataset;
    const photos = s.photos.filter((p) => p.kind === kind && (kind === "concern" || (p.col || "") === col));
    g.innerHTML = `
      ${photos.map((p) => `<div class="photo-row">${thumb(p)}
          <div class="photo-btns grow">
            <input type="text" data-caption="${p.id}" value="${h(p.caption)}" placeholder="Note (optional): what does this show?">
            <button type="button" class="btn small ghost" data-remove="${p.id}">Remove</button>
          </div></div>`).join("")}
      <label class="btn camera ${g.dataset.big && !photos.length ? "" : "secondary"}">${photos.length ? "＋" : "📷"} ${h(g.dataset.add)}
        <input type="file" accept="image/*" multiple data-kind="${kind}" data-col="${col}" hidden>
      </label>`;
  });
}

async function addPhotos(kind, col, files) {
  const s = state.current;
  for (const file of files) {
    let blob = file;
    try { blob = await compressImage(file); } catch { /* keep the original if the browser can't decode it */ }
    const id = uuid();
    const ext = blob.type === "image/jpeg" ? "jpg" : (file.name.split(".").pop() || "jpg");
    s.photos.push({
      id,
      kind,
      col: col || "",
      caption: "",
      blob,
      mime: blob.type || "image/jpeg",
      name: `${safeName(s.blockLot)}_${kind}_${s.id.slice(0, 8)}-${id.slice(0, 6)}.${ext}`,
      takenAt: new Date().toISOString(),
    });
  }
  if (state.current === s) {
    renderPhotos();
    document.querySelector('[data-err="photos"]').textContent = "";
    autosave();
  }
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, CONFIG.PHOTO_MAX_PX / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", CONFIG.PHOTO_QUALITY);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("decode failed")); };
    img.src = url;
  });
}

// ---------- submit ----------

async function submitSurvey() {
  const s = state.current;
  const d = s.data;
  const loc = d.location;
  const errors = {};
  if (!d.observation_status) errors.status = "Answer whether you could observe the property.";
  else if (d.observation_status !== "Observed" && !d.not_observed_reason) errors.status = "Choose or type why you couldn't observe the property.";

  if (d.observation_status) {
    if (loc.atProperty === null) errors.location = "Answer whether you're at the property.";
    else if (loc.atProperty && !loc.gps) errors.location = "Tap Register location, or choose “No” and type it in.";
    else if (!loc.atProperty && (!loc.manual.trim() || !loc.observedAt)) errors.location = "Enter where and when you observed the property.";
  }

  if (d.observation_status === "Observed") {
    if (d.score == null) errors.score = "Choose a distress score.";
    const has = (k) => s.photos.some((p) => p.kind === k);
    const missing = [];
    if (!has("front")) missing.push("front");
    if (!has("back") && !d.no_back_photo) missing.push("back");
    if (missing.length) errors.photos = `Add a ${missing.join(" and ")} photo.`;
    else if (!has("back") && !d.no_back_reason) errors.photos = "Choose or type why you couldn't photograph the back.";
  }

  document.querySelectorAll("[data-err]").forEach((el) => { el.textContent = errors[el.dataset.err] || ""; });
  const first = Object.keys(errors)[0];
  if (first) {
    document.querySelector(`[data-err="${first}"]`).closest("section").scrollIntoView({ behavior: "smooth", block: "center" });
    toast("A few things are missing — see the red notes.");
    return;
  }

  clearTimeout(saveTimer);
  s.state = "pending";
  s.observer = { ...state.observer };
  s.submittedAt = s.updatedAt = new Date().toISOString();
  await putSurvey(s);
  await refreshSurveys();
  state.current = null;
  toast(CONFIG.SYNC_URL && navigator.onLine ? "Survey saved. Uploading…" : "Survey saved on this phone. It will upload when you're online.");
  location.hash = "#/list";
  syncNow();
}

// ---------- menu ----------

function renderMenu() {
  const submitted = state.surveys.filter((s) => s.state !== "draft");
  const drafts = state.surveys.filter((s) => s.state === "draft" && s.updatedAt);
  const row = (s) => {
    const tag = s.state === "draft" ? `a href="#/survey/${encodeURIComponent(s.blockLot)}"` : "div";
    return `<li>
      <${tag} class="row">
        <span class="addr">${h(s.property.address)}</span>
        <span class="meta">${fmtTime(s.submittedAt || s.updatedAt)}${s.lastError && s.state === "pending" ? ` · <span class="bad-text">${h(s.lastError)}</span>` : ""}</span>
        <span class="badge ${s.state === "synced" ? "done" : s.state}">${{ draft: "Draft", pending: "Waiting to upload", synced: "Uploaded" }[s.state]}</span>
      </${tag.split(" ")[0]}></li>`;
  };
  $view.innerHTML = `
    <section class="card">
      <h1>Menu</h1>
      <div class="menu-btns">
        <button type="button" class="btn" id="m-sync">Upload now</button>
        <button type="button" class="btn" id="m-export">Export my surveys (CSV)</button>
        <a class="btn" href="#/observer">Change observer details</a>
        <button type="button" class="btn" id="m-reload">Refresh property list</button>
      </div>
      ${CONFIG.SYNC_URL ? "" : `<p class="notice">No upload server is configured, so surveys stay on this phone. Export the CSV to share them.</p>`}
    </section>
    ${drafts.length ? `<section class="card"><h2>Drafts</h2><ul class="plist">${drafts.map(row).join("")}</ul></section>` : ""}
    <section class="card"><h2>Submitted from this phone</h2>
      ${submitted.length ? `<ul class="plist">${submitted.map(row).join("")}</ul>` : `<p class="muted">Nothing yet.</p>`}
    </section>`;
  document.getElementById("m-sync").addEventListener("click", () => $pill.click());
  document.getElementById("m-export").addEventListener("click", exportCsv);
  document.getElementById("m-reload").addEventListener("click", async () => {
    await loadProperties();
    toast(`${state.properties.length} properties loaded.`);
  });
}

function exportCsv() {
  const rows = state.surveys.filter((s) => s.state !== "draft").map(buildRow);
  if (!rows.length) return toast("No submitted surveys on this phone yet.");
  const blob = new Blob(["﻿" + toCsv(rows)], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `vbn-surveys_${safeName(state.observer.name)}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- start ----------

async function init() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  navigator.storage?.persist?.().catch(() => {});
  if (state.observer?.role === "Other" && state.observer.roleOther) {
    state.observer = { ...state.observer, role: state.observer.roleOther };
    writeJson("vbn2.observer", state.observer);
  }
  await Promise.all([loadProperties(), refreshSurveys()]);
  renderPill();
  render();
  window.addEventListener("online", () => { renderPill(); syncNow(); });
  window.addEventListener("offline", renderPill);
  setInterval(() => syncNow(), CONFIG.SYNC_INTERVAL_MS);
  syncNow();
}

init();
