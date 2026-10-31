/**
 * VBN Field Survey — Google Apps Script backend.
 *
 * Receives surveys from the field app, appends one row per survey to the
 * "Surveys" tab of the spreadsheet this script is bound to, and saves photos
 * to a Drive folder (one sub-folder per block-lot). See backend/README.md.
 */

// Must match SHARED_KEY in js/config.js. Leave both empty to disable.
const SHARED_KEY = '';

// Who gets an email when a researcher taps the 🐞 bug button. Separate
// several addresses with commas. Change this when the app is handed over;
// leave it empty to only log reports on the "Bug reports" tab. It lives here,
// not in the app, so the address isn't published in the public repo.
const BUG_REPORT_EMAIL = '';

// Password for the i-Team dashboard (dashboard/ in the app). Set it here in
// the Apps Script editor only, never in the public repo. Leave it empty to
// turn the dashboard off.
const DASHBOARD_PASSWORD = '';

const SHEET_NAME = 'Surveys';
const BUG_SHEET_NAME = 'Bug reports';
const GROUP_SHEET_NAME = 'Groups';
const PHOTO_FOLDER_NAME = 'VBN Field Survey Photos';

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const body = JSON.parse(e.postData.contents);
    if (SHARED_KEY && body.key !== SHARED_KEY) return json_({ ok: false, error: 'Invalid key' });
    if (body.type === 'bug') return json_(saveBug_(body.report));
    if (body.type === 'dashboard' || body.type === 'assign') {
      if (!DASHBOARD_PASSWORD) return json_({ ok: false, error: 'The dashboard is turned off. Set DASHBOARD_PASSWORD in Code.gs.' });
      if (body.password !== DASHBOARD_PASSWORD) return json_({ ok: false, error: 'Wrong password' });
      if (body.type === 'assign') saveGroups_(body.assignments || []);
      return json_({ ok: true, rows: body.type === 'dashboard' ? readSurveys_(body.columns || []) : undefined, groups: readGroups_() });
    }

    const row = body.row;
    if (!row || !row.survey_id || !row.block_lot) return json_({ ok: false, error: 'Missing survey_id or block_lot' });

    const sheet = getSheet_();
    // Phones retry until they get a reply, so the same survey can arrive twice.
    if (findSurvey_(sheet, row.survey_id)) return json_({ ok: true, duplicate: true, photoUrls: {} });

    const photos = body.photos || [];
    const photoUrls = savePhotos_(row, photos);
    linkPhotos_(row, photos, photoUrls);
    row.received_at = new Date().toISOString();

    appendRow_(sheet, row);
    return json_({ ok: true, photoUrls: photoUrls });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// GET ?action=status → which block-lots already have surveys, so every
// researcher's list shows them as surveyed.
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (SHARED_KEY && p.key !== SHARED_KEY) return json_({ ok: false, error: 'Invalid key' });
  if (p.action !== 'status') return json_({ ok: true, service: 'VBN Field Survey backend' });

  const sheet = getSheet_();
  const properties = {};
  if (sheet.getLastRow() > 1) {
    const values = sheet.getDataRange().getValues();
    const head = values[0];
    const iBL = head.indexOf('block_lot');
    const iAt = head.indexOf('submitted_at');
    const iObs = head.indexOf('observer_name');
    values.slice(1).forEach((r) => {
      const bl = String(r[iBL]);
      if (!bl) return;
      const at = r[iAt] instanceof Date ? r[iAt].toISOString() : String(r[iAt]);
      const cur = properties[bl] || { count: 0, last_submitted_at: '', last_observer: '' };
      cur.count++;
      if (at > cur.last_submitted_at) { cur.last_submitted_at = at; cur.last_observer = String(r[iObs]); }
      properties[bl] = cur;
    });
  }
  return json_({ ok: true, properties: properties, groups: readGroups_() });
}

// Dashboard data: only the columns the dashboard asks for, so names,
// comments, locations and photo links never leave the Sheet.
function readSurveys_(columns) {
  const sheet = getSheet_();
  if (sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getDisplayValues();
  const head = values[0];
  const keep = columns.filter((c) => head.indexOf(c) !== -1);
  return values.slice(1).map((r) => {
    const o = {};
    keep.forEach((c) => { o[c] = r[head.indexOf(c)]; });
    return o;
  });
}

// Group assignments made on the dashboard, one row per block-lot. They
// override the "group" column of the app's property list.
function groupSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(GROUP_SHEET_NAME) || ss.insertSheet(GROUP_SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['block_lot', 'group', 'assigned_at']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function readGroups_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(GROUP_SHEET_NAME);
  const groups = {};
  if (!sheet || sheet.getLastRow() < 2) return groups;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getDisplayValues().forEach((r) => {
    if (r[0]) groups[r[0]] = r[1];
  });
  return groups;
}

// An empty group puts the property back on the list's own "group" column.
function saveGroups_(assignments) {
  const sheet = groupSheet_();
  const current = readGroups_();
  const now = new Date().toISOString();
  assignments.forEach((a) => {
    if (a && a.block_lot) current[String(a.block_lot)] = String(a.group || '');
  });
  const rows = Object.keys(current).filter((bl) => current[bl]).map((bl) => [bl, current[bl], now]);
  if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).clearContent();
  if (rows.length) sheet.getRange(2, 1, rows.length, 3).setNumberFormat('@').setValues(rows);
}

// Bug reports from app v3+. Each is logged on its own tab first, so nothing is
// lost if the email can't be sent (e.g. the daily email quota is used up).
function saveBug_(report) {
  if (!report || !report.report_id || !report.description) return { ok: false, error: 'Missing report_id or description' };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(BUG_SHEET_NAME) || ss.insertSheet(BUG_SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['report_id']);
    sheet.setFrozenRows(1);
  }
  if (findSurvey_(sheet, report.report_id)) return { ok: true, duplicate: true };
  report.received_at = new Date().toISOString();
  report.emailed_to = BUG_REPORT_EMAIL;
  appendRow_(sheet, report);

  if (BUG_REPORT_EMAIL) {
    const lines = Object.keys(report).map((k) => k + ': ' + report[k]);
    MailApp.sendEmail({
      to: BUG_REPORT_EMAIL,
      subject: 'VBN Field Survey bug: ' + String(report.description).slice(0, 60),
      body: 'A researcher reported a problem with the VBN Field Survey app.\n\n' + lines.join('\n') +
        '\n\nAll reports are also on the "' + BUG_SHEET_NAME + '" tab of ' + ss.getUrl(),
      replyTo: BUG_REPORT_EMAIL.split(',')[0].trim(),
    });
  }
  return { ok: true };
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['survey_id']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function findSurvey_(sheet, id) {
  if (sheet.getLastRow() < 2) return false;
  return !!sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).createTextFinder(id).matchEntireCell(true).findNext();
}

// Columns come from the app, so new fields added to the app appear as new
// columns automatically; existing columns are never reordered.
function appendRow_(sheet, row) {
  const lastCol = sheet.getLastColumn();
  const header = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  const missing = Object.keys(row).filter((k) => header.indexOf(k) === -1);
  if (missing.length) {
    sheet.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
    header.push.apply(header, missing);
  }
  // Store everything as text so block-lots like "0001 001" keep their zeros.
  const values = header.map((h) => (row[h] === undefined || row[h] === null ? '' : String(row[h])));
  const r = sheet.getLastRow() + 1;
  sheet.getRange(r, 1, 1, values.length).setNumberFormat('@').setValues([values]);
}

// Photos are saved through the Drive API with the narrow "drive.file" scope,
// so the script can only see files and folders it created itself — never
// the rest of the account's Drive. Folder IDs are remembered in script
// properties because drive.file cannot search for existing folders by name.
function savePhotos_(row, photos) {
  const urls = {};
  if (!photos.length) return urls;
  const blockLot = String(row.block_lot).replace(/[^\w-]+/g, '-');
  const root = folderId_('ROOT', PHOTO_FOLDER_NAME, null);
  const folder = folderId_('BL:' + blockLot, blockLot, root);
  photos.forEach((p) => {
    const file = uploadFile_(p, folder);
    urls[p.id] = file.webViewLink;
  });
  return urls;
}

// The app writes each photo's file name into the row (photo_front, etc.);
// swap those names for Drive links so the row works for any photo column.
function linkPhotos_(row, photos, urls) {
  photos.forEach((p) => {
    if (!urls[p.id]) return;
    Object.keys(row).forEach((k) => {
      if (typeof row[k] === 'string' && row[k].indexOf(p.filename) !== -1) row[k] = row[k].split(p.filename).join(urls[p.id]);
    });
  });
}

function folderId_(key, name, parentId) {
  const props = PropertiesService.getScriptProperties();
  const known = props.getProperty(key);
  if (known) return known;
  const meta = { name: name, mimeType: 'application/vnd.google-apps.folder' };
  if (parentId) meta.parents = [parentId];
  const res = driveFetch_('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(meta),
  });
  props.setProperty(key, res.id);
  return res.id;
}

function uploadFile_(photo, parentId) {
  const boundary = 'vbn' + Utilities.getUuid();
  const meta = { name: photo.filename, parents: [parentId], description: photo.caption || '' };
  const head = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(meta) + '\r\n--' + boundary + '\r\nContent-Type: ' + (photo.mime || 'image/jpeg') + '\r\n\r\n';
  const tail = '\r\n--' + boundary + '--';
  const bytes = Utilities.newBlob(head).getBytes()
    .concat(Utilities.base64Decode(photo.data))
    .concat(Utilities.newBlob(tail).getBytes());
  return driveFetch_('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
    method: 'post',
    contentType: 'multipart/related; boundary=' + boundary,
    payload: bytes,
  });
}

function driveFetch_(url, options) {
  options.headers = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };
  options.muteHttpExceptions = true;
  const res = UrlFetchApp.fetch(url, options);
  if (res.getResponseCode() >= 300) throw new Error('Drive error ' + res.getResponseCode() + ': ' + res.getContentText());
  return JSON.parse(res.getContentText());
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
