/**
 * VBN Field Survey — Google Apps Script backend.
 *
 * Receives surveys from the field app, appends one row per survey to the
 * "Surveys" tab of the spreadsheet this script is bound to, and saves photos
 * to a Drive folder (one sub-folder per block-lot). See backend/README.md.
 */

// Must match SHARED_KEY in js/config.js. Leave both empty to disable.
const SHARED_KEY = '';

const SHEET_NAME = 'Surveys';
const PHOTO_FOLDER_NAME = 'VBN Field Survey Photos';

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const body = JSON.parse(e.postData.contents);
    if (SHARED_KEY && body.key !== SHARED_KEY) return json_({ ok: false, error: 'Invalid key' });

    const row = body.row;
    if (!row || !row.survey_id || !row.block_lot) return json_({ ok: false, error: 'Missing survey_id or block_lot' });

    const sheet = getSheet_();
    // Phones retry until they get a reply, so the same survey can arrive twice.
    if (findSurvey_(sheet, row.survey_id)) return json_({ ok: true, duplicate: true, photoUrls: {} });

    const photoUrls = savePhotos_(row, body.photos || []);
    const byKind = (kind) => (body.photos || []).filter((p) => p.kind === kind);
    row.photo_front = byKind('front').map((p) => photoUrls[p.id]).join('\n');
    row.photo_back = byKind('back').map((p) => photoUrls[p.id]).join('\n');
    row.concern_photos = byKind('concern').map((p) => photoUrls[p.id] + ' | ' + (p.caption || '')).join('\n');
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
  return json_({ ok: true, properties: properties });
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

function savePhotos_(row, photos) {
  const urls = {};
  if (!photos.length) return urls;
  const root = getFolder_(DriveApp.getRootFolder(), PHOTO_FOLDER_NAME);
  const folder = getFolder_(root, String(row.block_lot).replace(/[^\w-]+/g, '-'));
  photos.forEach((p) => {
    const blob = Utilities.newBlob(Utilities.base64Decode(p.data), p.mime || 'image/jpeg', p.filename);
    const file = folder.createFile(blob);
    if (p.caption) file.setDescription(p.caption);
    urls[p.id] = file.getUrl();
  });
  return urls;
}

function getFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
