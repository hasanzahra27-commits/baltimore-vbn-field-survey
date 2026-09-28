import { CONFIG } from "./config.js";
import {
  CRITERIA, EXTRA_YESNO, FACADE_DAMAGE, DISTRESS_SCALE, ROLES, NOT_OBSERVED_REASONS, evaluate,
} from "./checklist.js";
import { putSurvey, allSurveys, deleteSurvey } from "./db.js";
import { parseCsv, toCsv } from "./csv.js";
import { buildRow, syncPending, fetchRemoteStatus } from "./sync.js";

const $view = document.getElementById("view");
const $pill = document.getElementById("sync-pill");
const $toast = document.getElementById("toast");

const state = {
  properties: [],
  surveys: [],
  remote: readJson("vbn.remote", {}),
  observer: readJson("vbn.observer", null),
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
const labelize = (k) => k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const safeName = (s) => s.replace(/[^\w-]+/g, "-");

let toastTimer;
function toast(msg) {
  $toast.textContent = msg;
  $toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove("show"), 3500);
}

// ---------- data loading ----------

async function loadProperties() {
  try {
    const res = await fetch(CONFIG.PROPERTIES_URL, { cache: "no-cache" });
    if (!res.ok) throw new Error(res.status);
    state.properties = parseCsv(await res.text()).filter((p) => p.block_lot && p.address);
    writeJson("vbn.properties", state.properties);
  } catch {
    state.properties = readJson("vbn.properties", []);
    if (!state.properties.length) toast("Could not load the property list. Connect to the internet and reload.");
  }
}

async function refreshSurveys() {
  state.surveys = (await allSurveys()).sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
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
  draft: "In progress",
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
    if (remote) { state.remote = remote; writeJson("vbn.remote", remote); }
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
  const o = state.observer || { name: "", role: "", roleOther: "", codeEnforcement: null };
  $view.innerHTML = `
    <section class="card">
      <h1>About you</h1>
      <p class="muted">Saved on this phone and attached to every survey you submit.</p>
      <form id="observer-form" novalidate>
        <label class="field">Your name
          <input name="name" required autocomplete="name" value="${h(o.name)}">
        </label>
        <label class="field">Your role
          <select name="role" required>
            <option value="">Choose…</option>
            ${ROLES.map((r) => `<option ${o.role === r ? "selected" : ""}>${h(r)}</option>`).join("")}
          </select>
        </label>
        <label class="field ${o.role === "Other" ? "" : "hidden"}" id="role-other">Describe your role
          <input name="roleOther" value="${h(o.roleOther)}">
        </label>
        <fieldset class="field">
          <legend>Are you an official code enforcement officer?</legend>
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
  form.role.addEventListener("change", () =>
    document.getElementById("role-other").classList.toggle("hidden", form.role.value !== "Other"));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const ce = form.codeEnforcement.value;
    const next = {
      name: form.name.value.trim(),
      role: form.role.value,
      roleOther: form.roleOther.value.trim(),
      codeEnforcement: ce === "yes" ? true : ce === "no" ? false : null,
    };
    const err = !next.name ? "Enter your name."
      : !next.role ? "Choose your role."
      : next.role === "Other" && !next.roleOther ? "Describe your role."
      : next.codeEnforcement === null ? "Answer the code enforcement question."
      : "";
    document.getElementById("observer-error").textContent = err;
    if (err) return;
    state.observer = next;
    writeJson("vbn.observer", next);
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
  return {
    id: uuid(),
    blockLot: property.block_lot,
    property,
    state: "draft",
    createdAt: new Date().toISOString(),
    updatedAt: null,
    observer: { ...state.observer },
    data: {
      observation_status: "Observed",
      not_observed_reason: "",
      checks: {},
      facade_damage: null,
      score: null,
      comments: "",
      gps: null,
    },
    photos: [],
  };
}

function openSurvey(blockLot) {
  const property = state.properties.find((p) => p.block_lot === blockLot);
  if (!property) { $view.innerHTML = `<section class="card"><p>Property ${h(blockLot)} is not in the list.</p><a class="btn" href="#/list">Back</a></section>`; return; }
  if (!state.current || state.current.blockLot !== blockLot) {
    state.current = state.surveys.find((s) => s.blockLot === blockLot && s.state === "draft") || newSurvey(property);
  }
  renderSurvey();
  if (!state.current.data.gps) captureGps();
}

function priorSurveyNote(blockLot) {
  const mine = state.surveys.filter((s) => s.blockLot === blockLot && s.state !== "draft");
  const remote = state.remote[blockLot];
  if (!mine.length && !remote) return "";
  const who = remote ? `${remote.count} survey${remote.count > 1 ? "s" : ""} on file, last ${fmtTime(remote.last_submitted_at)}${remote.last_observer ? ` by ${h(remote.last_observer)}` : ""}`
    : `You submitted a survey on ${fmtTime(mine[0].submittedAt)}`;
  return `<div class="notice">Already surveyed: ${who}. You can still submit another one.</div>`;
}

function renderSurvey() {
  const s = state.current;
  const d = s.data;
  const p = s.property;
  const extra = Object.entries(p).filter(([k, v]) => !["block_lot", "address"].includes(k) && v !== "");
  const observed = d.observation_status === "Observed";

  $view.innerHTML = `
    <form id="survey" novalidate class="${observed ? "" : "not-observed"}">
      <section class="card prop">
        <a href="#/list" class="back">← All properties</a>
        <h1>${h(p.address)}</h1>
        <p class="muted">Block-lot <strong>${h(p.block_lot)}</strong></p>
        ${extra.length ? `<dl class="facts">${extra.map(([k, v]) => `<dt>${h(labelize(k))}</dt><dd>${h(v)}</dd>`).join("")}</dl>` : ""}
        ${priorSurveyNote(s.blockLot)}
        <div class="visit">
          <div><span class="muted">Started</span> ${fmtTime(s.createdAt)}</div>
          <div id="gps-line"></div>
        </div>
      </section>

      <section class="card" id="sec-status">
        <h2>Could you observe the property?</h2>
        <div class="seg">
          <label><input type="radio" name="observation_status" value="Observed" ${observed ? "checked" : ""}><span>Yes, observed</span></label>
          <label><input type="radio" name="observation_status" value="Could not observe" ${observed ? "" : "checked"}><span>Could not observe</span></label>
        </div>
        <div class="only-not-observed">
          <label class="field">Reason
            <select name="not_observed_reason">
              <option value="">Choose…</option>
              ${NOT_OBSERVED_REASONS.map((r) => `<option ${d.not_observed_reason === r ? "selected" : ""}>${h(r)}</option>`).join("")}
            </select>
          </label>
          <p class="muted small">Add details in the comments below.</p>
        </div>
        <p class="error" data-err="status"></p>
      </section>

      ${CRITERIA.map((c) => `
        <section class="card only-observed crit" data-crit="${c.key}">
          <div class="crit-head"><h2>${h(c.title)}</h2><span class="rule">${h(c.rule)}</span></div>
          ${c.items.map((i) => checkRow(i, d.checks)).join("")}
          ${c.threshold ? `<p class="tally" data-tally="${c.key}"></p>` : ""}
        </section>`).join("")}

      <section class="card only-observed">
        <h2>Other indicators</h2>
        ${EXTRA_YESNO.map((i) => checkRow(i, d.checks)).join("")}
        <fieldset class="field">
          <legend>${h(FACADE_DAMAGE.label)}</legend>
          <div class="seg">
            ${FACADE_DAMAGE.options.map((o) => `<label><input type="radio" name="facade_damage" value="${h(o)}" ${d.facade_damage === o ? "checked" : ""}><span>${h(o)}</span></label>`).join("")}
          </div>
        </fieldset>
      </section>

      <section class="card only-observed result" id="result"></section>

      <section class="card only-observed" id="sec-score">
        <h2>Overall distress score <span class="req">required</span></h2>
        <div class="scale">
          ${DISTRESS_SCALE.map((x) => `
            <label class="scale-opt s${x.value}">
              <input type="radio" name="score" value="${x.value}" ${d.score === x.value ? "checked" : ""}>
              <span class="num">${x.value}</span>
              <span class="lbl"><strong>${h(x.label)}</strong><small>${h(x.hint)}</small></span>
            </label>`).join("")}
        </div>
        <p class="error" data-err="score"></p>
      </section>

      <section class="card" id="sec-photos">
        <h2>Photos</h2>
        <div id="photos"></div>
        <p class="error" data-err="photos"></p>
      </section>

      <section class="card">
        <h2>General comments</h2>
        <textarea name="comments" rows="4" placeholder="Anything else notable about this property">${h(d.comments)}</textarea>
      </section>

      <div class="actions">
        <button type="submit" class="btn primary block">Submit survey</button>
        <button type="button" class="btn ghost block" id="discard">Discard this survey</button>
      </div>
    </form>
    <div class="sticky-result only-observed-sticky" id="sticky-result"></div>`;

  bindSurvey();
  renderPhotos();
  renderGps();
  updateResult();
}

function checkRow(item, checks) {
  return `<label class="check">
    <input type="checkbox" data-check="${item.col}" ${checks[item.col] ? "checked" : ""}>
    <span class="box" aria-hidden="true"></span>
    <span class="txt">${h(item.text)}</span>
  </label>`;
}

function updateResult() {
  const s = state.current;
  const observed = s.data.observation_status === "Observed";
  const r = evaluate(s.data.checks);
  const c = CRITERIA.find((x) => x.key === "c");
  const dd = CRITERIA.find((x) => x.key === "d");
  const tc = document.querySelector('[data-tally="c"]');
  const td = document.querySelector('[data-tally="d"]');
  if (tc) tc.textContent = `${r.cCount} of ${c.items.length} ticked${r.cCount >= 1 ? " · criteria met" : ""}`;
  if (td) td.textContent = `${r.dCount} of ${dd.items.length} ticked${r.dCount >= 5 ? " · criteria met" : ` · ${5 - r.dCount} more needed`}`;
  const html = r.meets
    ? `<strong>Meets BXP vacancy criteria</strong><span>via ${r.via.join(" + ")}</span>`
    : `<strong>Does not meet BXP vacancy criteria</strong><span>C: ${r.cCount}/1 · D: ${r.dCount}/5</span>`;
  const res = document.getElementById("result");
  res.className = `card only-observed result ${r.meets ? "yes" : "no"}`;
  res.innerHTML = `<h2>BXP result (calculated)</h2><div class="result-line">${html}</div>`;
  const sticky = document.getElementById("sticky-result");
  sticky.className = `sticky-result ${r.meets ? "yes" : "no"} ${observed ? "" : "hidden"}`;
  sticky.innerHTML = r.meets ? `BXP: vacant (via ${r.via.join(" + ")})` : `BXP: not vacant · C ${r.cCount}/1 · D ${r.dCount}/5`;
}

let saveTimer;
function autosave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const s = state.current;
    if (!s || s.state !== "draft") return;
    s.updatedAt = new Date().toISOString();
    await putSurvey(s);
    await refreshSurveys();
  }, 300);
}

function bindSurvey() {
  const form = document.getElementById("survey");
  const s = state.current;
  const onChange = (e) => {
    const t = e.target;
    if (t.dataset.check) s.data.checks[t.dataset.check] = t.checked;
    else if (t.name === "observation_status") {
      s.data.observation_status = t.value;
      form.classList.toggle("not-observed", t.value !== "Observed");
    } else if (t.name === "not_observed_reason") s.data.not_observed_reason = t.value;
    else if (t.name === "facade_damage") s.data.facade_damage = t.value;
    else if (t.name === "score") s.data.score = Number(t.value);
    else if (t.name === "comments") s.data.comments = t.value;
    else if (t.dataset.caption) {
      const photo = s.photos.find((p) => p.id === t.dataset.caption);
      if (photo) photo.caption = t.value;
    } else return;
    const err = t.closest("section")?.querySelector("[data-err]");
    if (err) err.textContent = "";
    updateResult();
    autosave();
  };
  form.addEventListener("change", onChange);
  form.addEventListener("input", (e) => { if (e.target.name === "comments" || e.target.dataset.caption) onChange(e); });
  form.addEventListener("submit", (e) => { e.preventDefault(); submitSurvey(); });
  document.getElementById("discard").addEventListener("click", async () => {
    if (!confirm("Discard this survey and its photos?")) return;
    await deleteSurvey(s.id);
    await refreshSurveys();
    state.current = null;
    location.hash = "#/list";
  });
}

// ---------- GPS ----------

function captureGps() {
  const s = state.current;
  if (!("geolocation" in navigator)) { s.gpsError = "Location not available on this device"; return renderGps(); }
  s.gpsError = "locating";
  renderGps();
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      s.data.gps = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, at: new Date(pos.timestamp).toISOString() };
      s.gpsError = null;
      if (state.current === s) renderGps();
      if (s.updatedAt) autosave(); // don't create a draft just by opening a property
    },
    (err) => {
      s.gpsError = err.code === 1 ? "Location permission denied" : "Could not get location";
      if (state.current === s) renderGps();
    },
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 },
  );
}

function renderGps() {
  const el = document.getElementById("gps-line");
  if (!el) return;
  const s = state.current;
  const g = s.data.gps;
  el.innerHTML = g
    ? `<span class="muted">Location</span> captured (±${Math.round(g.acc)} m) <button type="button" class="link" id="gps-retry">Update</button>`
    : s.gpsError === "locating"
      ? `<span class="muted">Location</span> finding…`
      : `<span class="muted">Location</span> ${h(s.gpsError || "not captured")} <button type="button" class="link" id="gps-retry">Try again</button>`;
  document.getElementById("gps-retry")?.addEventListener("click", captureGps);
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
  const slot = (kind, label) => {
    const p = s.photos.find((x) => x.kind === kind);
    return `<div class="photo-slot">
      <div class="photo-label">${label} <span class="req only-observed-inline">required</span></div>
      ${p ? `<div class="photo-row">${thumb(p)}
          <div class="photo-btns">
            <label class="btn small">Retake<input type="file" accept="image/*" capture="environment" data-photo="${kind}" hidden></label>
            <button type="button" class="btn small ghost" data-remove="${p.id}">Remove</button>
          </div></div>`
        : `<label class="btn camera">📷 Take ${label.toLowerCase()} photo<input type="file" accept="image/*" capture="environment" data-photo="${kind}" hidden></label>`}
    </div>`;
  };
  const concerns = s.photos.filter((p) => p.kind === "concern");
  document.getElementById("photos").innerHTML = `
    ${slot("front", "Front")}
    ${slot("back", "Back")}
    <div class="photo-slot">
      <div class="photo-label">Notable concerns <span class="muted small">optional</span></div>
      ${concerns.map((p) => `<div class="photo-row">${thumb(p)}
          <div class="photo-btns grow">
            <input type="text" data-caption="${p.id}" value="${h(p.caption)}" placeholder="What does this show?">
            <button type="button" class="btn small ghost" data-remove="${p.id}">Remove</button>
          </div></div>`).join("")}
      <label class="btn camera secondary">＋ Add concern photo<input type="file" accept="image/*" capture="environment" data-photo="concern" hidden></label>
    </div>`;

  const box = document.getElementById("photos");
  box.querySelectorAll("[data-photo]").forEach((input) => input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    await addPhoto(input.dataset.photo, file);
  }));
  box.querySelectorAll("[data-remove]").forEach((b) => b.addEventListener("click", () => {
    s.photos = s.photos.filter((p) => p.id !== b.dataset.remove);
    renderPhotos();
    autosave();
  }));
}

async function addPhoto(kind, file) {
  const s = state.current;
  let blob = file;
  try { blob = await compressImage(file); } catch { /* keep the original if the browser can't decode it */ }
  const n = s.photos.filter((p) => p.kind === kind).length + 1;
  const ext = blob.type === "image/jpeg" ? "jpg" : (file.name.split(".").pop() || "jpg");
  const photo = {
    id: uuid(),
    kind,
    caption: "",
    blob,
    mime: blob.type || "image/jpeg",
    name: `${safeName(s.blockLot)}_${kind}${kind === "concern" ? `-${n}` : ""}_${s.id.slice(0, 8)}.${ext}`,
    takenAt: new Date().toISOString(),
  };
  if (kind === "concern") s.photos.push(photo);
  else s.photos = [...s.photos.filter((p) => p.kind !== kind), photo];
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
  const errors = {};
  if (d.observation_status === "Observed") {
    if (d.score == null) errors.score = "Choose a distress score.";
    const missing = ["front", "back"].filter((k) => !s.photos.some((p) => p.kind === k));
    if (missing.length) errors.photos = `Add a ${missing.join(" and ")} photo.`;
  } else if (!d.not_observed_reason) errors.status = "Choose why you couldn't observe the property.";

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
  const drafts = state.surveys.filter((s) => s.state === "draft");
  const row = (s) => {
    const tag = s.state === "draft" ? `a href="#/survey/${encodeURIComponent(s.blockLot)}"` : "div";
    return `<li>
      <${tag} class="row">
        <span class="addr">${h(s.property.address)}</span>
        <span class="meta">${fmtTime(s.submittedAt || s.updatedAt)}${s.lastError && s.state === "pending" ? ` · <span class="bad-text">${h(s.lastError)}</span>` : ""}</span>
        <span class="badge ${s.state === "synced" ? "done" : s.state}">${{ draft: "In progress", pending: "Waiting to upload", synced: "Uploaded" }[s.state]}</span>
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
    ${drafts.length ? `<section class="card"><h2>In progress</h2><ul class="plist">${drafts.map(row).join("")}</ul></section>` : ""}
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
  await Promise.all([loadProperties(), refreshSurveys()]);
  renderPill();
  render();
  window.addEventListener("online", () => { renderPill(); syncNow(); });
  window.addEventListener("offline", renderPill);
  setInterval(() => syncNow(), CONFIG.SYNC_INTERVAL_MS);
  syncNow();
}

init();
