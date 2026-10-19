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
