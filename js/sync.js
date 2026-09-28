// Turns stored surveys into flat export rows and uploads them to the backend.

import { CONFIG, APP_VERSION } from "./config.js";
import { ALL_CHECK_COLS, EXTRA_YESNO, FACADE_DAMAGE, DISTRESS_SCALE, evaluate } from "./checklist.js";
import { allSurveys, putSurvey } from "./db.js";

const yn = (v) => (v ? "Yes" : "No");

// One row per survey. Column order here is the column order in the Sheet/CSV.
export function buildRow(s) {
  const d = s.data;
  const observed = d.observation_status === "Observed";
  const result = evaluate(d.checks);
  const row = {
    survey_id: s.id,
    submitted_at: s.submittedAt,
    started_at: s.createdAt,
    block_lot: s.blockLot,
    address: s.property.address,
    observer_name: s.observer.name,
    observer_role: s.observer.role === "Other" ? `Other: ${s.observer.roleOther}` : s.observer.role,
    code_enforcement_officer: yn(s.observer.codeEnforcement),
    latitude: d.gps?.lat ?? "",
    longitude: d.gps?.lng ?? "",
    gps_accuracy_m: d.gps ? Math.round(d.gps.acc) : "",
    observation_status: d.observation_status,
    not_observed_reason: observed ? "" : d.not_observed_reason,
  };

  for (const col of ALL_CHECK_COLS) row[col] = observed ? yn(d.checks[col]) : "";
  for (const { col } of EXTRA_YESNO) row[col] = observed ? yn(d.checks[col]) : "";
  row[FACADE_DAMAGE.col] = observed ? d.facade_damage ?? "" : "";

  row.bxp_c_count = observed ? result.cCount : "";
  row.bxp_d_count = observed ? result.dCount : "";
  row.bxp_meets_vacancy_criteria = observed ? yn(result.meets) : "";
  row.bxp_criteria_met_via = observed ? result.via.join("+") : "";

  const score = DISTRESS_SCALE.find((x) => x.value === d.score);
  row.distress_score = score ? score.value : "";
  row.distress_label = score ? score.label : "";
  row.general_comments = d.comments ?? "";

  // Filled in by the backend with Drive links; locally they hold file names.
  const photo = (kind) => s.photos.filter((p) => p.kind === kind);
  row.photo_front = photo("front").map((p) => p.url || p.name).join("\n");
  row.photo_back = photo("back").map((p) => p.url || p.name).join("\n");
  row.concern_photo_count = photo("concern").length;
  row.concern_photos = photo("concern").map((p) => `${p.url || p.name} | ${p.caption || ""}`).join("\n");

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
      id: p.id, kind: p.kind, caption: p.caption || "", filename: p.name, mime: p.mime,
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

// Which properties anyone on the team has already surveyed, per the backend.
export async function fetchRemoteStatus() {
  if (!CONFIG.SYNC_URL || !navigator.onLine) return null;
  const url = `${CONFIG.SYNC_URL}?action=status&key=${encodeURIComponent(CONFIG.SHARED_KEY)}`;
  const res = await fetch(url, { redirect: "follow" });
  const json = await res.json();
  return json.ok ? json.properties : null;
}
