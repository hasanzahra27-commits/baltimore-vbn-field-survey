// Deployment settings. This is the only file the i-Team needs to edit.
export const CONFIG = {
  // Web app URL of the Google Apps Script backend (see backend/README.md).
  // Leave empty to run without uploading: surveys stay on the phone and can
  // be exported from the menu as a CSV.
  SYNC_URL: "https://script.google.com/macros/s/AKfycbzP8mCy32mHUEl1cyx6kNUkIBjCm2X-oGBf1QYikNTgbvHLIrwfW-oZBu4yNmBFjdIb/exec",

  // Must match SHARED_KEY in backend/Code.gs. Because this repo is public,
  // this is only a speed bump against stray submissions, not real security.
  SHARED_KEY: "",

  // Property list. Required columns: block_lot, address. Any other columns
  // are shown to the researcher as pre-filled property info and copied into
  // the export with a "property_" prefix.
  PROPERTIES_URL: "data/properties.csv",

  // Property-list columns that are exported but never shown to researchers,
  // so the model's prediction doesn't nudge what they record.
  HIDDEN_PROPERTY_FIELDS: ["model_score", "sample_group"],

  // How often to retry uploads and refresh "already surveyed" status while online.
  SYNC_INTERVAL_MS: 60_000,

  // Photos are resized before saving so uploads work on weak mobile signal.
  PHOTO_MAX_PX: 1600,
  PHOTO_QUALITY: 0.8,
};

export const APP_VERSION = "3.0.0";
