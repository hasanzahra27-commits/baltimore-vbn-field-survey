// Turns stored surveys into flat export rows and uploads them to the backend.

import { CONFIG, APP_VERSION } from "./config.js";
import {
  ALL_CHECK_COLS, FACADE_DAMAGE, DISTRESS_SCALE, DISTRESS_SCALE_VERSION, D5_COL, D5_PARTS, d5Ticked, evaluate,
} from "./checklist.js";
import { allSurveys, putSurvey } from "./db.js";

const yn = (v) => (v ? "Yes" : "No");
const ynBlank = (v) => (v === true ? "Yes" : v === false ? "No" : "");

// Labels for surveys submitted with app v1, which used a 0–5 scale.
const V1_SCALE_LABELS = ["Blue sky vacant", "Severe distress", "Serious distress", "Moderate distress", "Minor signs", "No signs of distress"];

// Brings surveys saved by app v1 up to the current shape.
export function normalize(s) {
  const d = s.data;
  d.checks ??= {};
  d.details ??= {};
  d.location ??= d.gps
    ? { atProperty: true, gps: d.gps, manual: "", observedAt: "" }
    : { atProperty: null, gps: null, manual: "", observedAt: "" };
  d.finding ??= { housesFromCorner: "", countedFrom: "", frontColor: "", housesFromCornerBack: "", backColor: "" };
  d.secured ??= null;
  d.secured_details ??= "";
  d.no_back_photo ??= false;
  d.no_back_reason ??= "";
  if ("b_people_entering_without_keys" in d.checks) {
    d.checks.b2_people_using_unusual_openings ||= d.checks.b_people_entering_without_keys;
    delete d.checks.b_people_entering_without_keys;
  }
  if (!s.scaleVersion) {
    // v1 drafts used a 0–5 scale; ask again rather than guess a mapping.
    if (s.state === "draft") { d.score = null; s.scaleVersion = DISTRESS_SCALE_VERSION; }
    else s.scaleVersion = "v1 (0-5)";
  }
  if (s.observer?.role === "Other" && s.observer.roleOther) s.observer.role = s.observer.roleOther;
  return s;
}

// One row per survey. Column order here is the column order in the Sheet/CSV.
export function buildRow(s) {
  normalize(s);
  const d = s.data;
  const observed = d.observation_status === "Observed";
  const result = evaluate(d.checks);
  const loc = d.location;
  const gps = loc.atProperty ? loc.gps : null;
  const f = d.finding;
  const details = d.details;
  const row = {
    survey_id: s.id,
    submitted_at: s.submittedAt,
    started_at: s.createdAt,
    block_lot: s.blockLot,
    address: s.property.address,
    observer_name: s.observer.name,
    observer_role: s.observer.role === "Other" ? `Other: ${s.observer.roleOther}` : s.observer.role,
    code_enforcement_officer: yn(s.observer.codeEnforcement),
    observation_status: d.observation_status,
    not_observed_reason: observed ? "" : d.not_observed_reason,
    location_method: loc.atProperty === true ? "GPS at property" : loc.atProperty === false ? "Entered by hand later" : "",
    latitude: gps?.lat ?? "",
    longitude: gps?.lng ?? "",
    gps_accuracy_m: gps ? Math.round(gps.acc) : "",
    location_entered_by_hand: loc.atProperty === false ? loc.manual : "",
    observed_at: loc.atProperty ? gps?.at ?? "" : loc.observedAt ?? "",
    houses_from_corner_front: f.housesFromCorner ?? "",
    counted_from_corner: f.countedFrom ?? "",
    front_color: f.frontColor ?? "",
    houses_from_corner_back: f.housesFromCornerBack ?? "",
    back_color: f.backColor ?? "",
  };

  // Each indicator is followed by the researcher's notes on it, if ticked.
  for (const col of ALL_CHECK_COLS) {
    row[col] = observed ? yn(d.checks[col]) : "";
    row[`${col}_details`] = observed && d.checks[col] ? details[col] ?? "" : "";
    // Same combined column as v1 and v2, so window answers line up across versions.
    if (col === D5_PARTS.at(-1)) row[D5_COL] = observed ? yn(d5Ticked(d.checks)) : "";
  }
  row[FACADE_DAMAGE.col] = observed ? d.facade_damage ?? "" : "";
  row[`${FACADE_DAMAGE.col}_details`] = observed && d.facade_damage && d.facade_damage !== "None" ? details[FACADE_DAMAGE.col] ?? "" : "";

  // Calculated here only; the researcher never sees the result.
  row.bxp_c_count = observed ? result.cCount : "";
  row.bxp_d_count = observed ? result.dCount : "";
  row.bxp_meets_vacancy_criteria = observed ? yn(result.meets) : "";
  row.bxp_criteria_met_via = observed ? result.via.join("+") : "";

  const scaleVersion = s.scaleVersion || "v1 (0-5)";
  const labels = scaleVersion === DISTRESS_SCALE_VERSION
    ? Object.fromEntries(DISTRESS_SCALE.map((x) => [x.value, x.label]))
    : V1_SCALE_LABELS;
  const scored = observed && d.score != null;
  row.distress_scale = scored ? scaleVersion : "";
  row.distress_score = scored ? d.score : "";
  row.distress_label = scored ? labels[d.score] ?? "" : "";

  row.secured_during_visit = observed ? ynBlank(d.secured) : "";
  row.secured_details = observed && d.secured ? d.secured_details ?? "" : "";
  row.general_comments = d.comments ?? "";

  // Photo cells hold "file | note" lines. The backend swaps each file name
  // for its Drive link.
  const photo = (kind) => s.photos.filter((p) => p.kind === kind);
  const lines = (list) => list.map((p) => [p.url || p.name, p.caption].filter(Boolean).join(" | ")).join("\n");
  row.photo_front = lines(photo("front"));
  row.photo_back = lines(photo("back"));
  row.no_back_photo_reason = observed && d.no_back_photo && !photo("back").length ? d.no_back_reason ?? "" : "";
  row.photo_secured_before = lines(photo("secure_before"));
  row.photo_secured_after = lines(photo("secure_after"));
  row.concern_photo_count = photo("concern").length;
  row.concern_photos = lines(photo("concern"));

  for (const [k, v] of Object.entries(s.property)) {
    if (k !== "block_lot" && k !== "address") row[`property_${k}`] = v;
  }
  row.device_timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  row.app_version = APP_VERSION;
  return row;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function upload(survey) {
  const photos = await Promise.all(
    survey.photos.map(async (p) => ({
      id: p.id, kind: p.kind, col: p.col || "", caption: p.caption || "", filename: p.name, mime: p.mime,
      data: await blobToBase64(p.blob),
    })),
  );
  // text/plain avoids a CORS preflight, which Apps Script cannot answer.
  const res = await fetch(CONFIG.SYNC_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ key: CONFIG.SHARED_KEY, row: buildRow(survey), photos }),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Server responded ${res.status}`);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "Upload rejected");

  survey.state = "synced";
  survey.syncedAt = new Date().toISOString();
  survey.lastError = null;
  // Keep the Drive links, drop the image data to free phone storage.
  survey.photos = survey.photos.map((p) => ({ ...p, blob: null, url: json.photoUrls?.[p.id] || "" }));
  await putSurvey(survey);
}

let running = false;

// Uploads every survey waiting in the queue. Returns { uploaded, failed, error }.
export async function syncPending() {
  if (running || !CONFIG.SYNC_URL || !navigator.onLine) return { uploaded: 0, failed: 0 };
  running = true;
  let uploaded = 0, failed = 0, error = null;
  try {
    const pending = (await allSurveys()).filter((s) => s.state === "pending");
    for (const s of pending) {
      try {
        await upload(s);
        uploaded++;
      } catch (e) {
        failed++;
        error = e.message;
        s.lastError = e.message;
        await putSurvey(s);
      }
    }
  } finally {
    running = false;
  }
  return { uploaded, failed, error };
}

// Bug reports wait in localStorage until there's signal, like surveys do.
const BUG_KEY = "vbn3.bugs";
const readBugs = () => { try { return JSON.parse(localStorage.getItem(BUG_KEY)) || []; } catch { return []; } };
const writeBugs = (list) => { try { localStorage.setItem(BUG_KEY, JSON.stringify(list)); } catch { /* storage full or blocked */ } };

export const pendingBugCount = () => readBugs().length;

export function queueBug(report) {
  writeBugs([...readBugs(), report]);
}

// Sends every queued bug report. The backend saves each to the "Bug reports"
// tab and emails it to BUG_REPORT_EMAIL in Code.gs. Returns how many were sent.
export async function sendPendingBugs() {
  if (!CONFIG.SYNC_URL || !navigator.onLine) return 0;
  let sent = 0;
  for (const report of readBugs()) {
    const res = await fetch(CONFIG.SYNC_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ key: CONFIG.SHARED_KEY, type: "bug", report }),
      redirect: "follow",
    });
    const json = res.ok ? await res.json() : { ok: false, error: `Server responded ${res.status}` };
    if (!json.ok) throw new Error(json.error || "Bug report rejected");
    writeBugs(readBugs().filter((r) => r.report_id !== report.report_id));
    sent++;
  }
  return sent;
}

// Which properties anyone on the team has already surveyed, per the backend.
export async function fetchRemoteStatus() {
  if (!CONFIG.SYNC_URL || !navigator.onLine) return null;
  const url = `${CONFIG.SYNC_URL}?action=status&key=${encodeURIComponent(CONFIG.SHARED_KEY)}`;
  const res = await fetch(url, { redirect: "follow" });
  const json = await res.json();
  return json.ok ? json.properties : null;
}
