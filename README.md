# VBN Field Survey tool

This is a mobile web app for field researchers to record whether sampled properties show signs of vacancy. The data is used to build a new training sample for the i-Team's Vacant Building Notice (VBN) prediction model.

**What researchers do:** enter their name, role and code-enforcement status once. Then, for each property:
1. Pick it from the list (filtered to *Not yet surveyed*).
2. Tick the BXP vacancy indicators (sections A–D), plus unmonitored open windows/doors and facade damage.
3. Give a 0–5 distress score (0 = blue sky vacant, 5 = no signs of distress).
4. Take the front and back photos (required) and any notable-concern photos with captions.
5. Add comments and submit.

The app shows whether the property meets the BXP rule (A, or B, or ≥1 of C, or ≥5 of D). It stores both the individual ticks and the calculated result.

**Offline:** every survey, including photos, is saved on the phone first. Drafts survive closing the browser. Submitted surveys upload automatically once there's signal, and the badge in the header shows how many are waiting.

**Where the data goes:** each survey becomes a row in a Google Sheet (downloadable as CSV) and the photos go into Google Drive. See [backend/README.md](backend/README.md).

## Repo layout

| Path | What it is |
|---|---|
| `index.html`, `css/`, `js/` | The web app: plain HTML/CSS/JS with no build step |
| `js/config.js` | **The only file to edit when deploying**: upload URL and key |
| `js/checklist.js` | Survey wording, score labels, role list and the BXP rule |
| `data/properties.csv` | Property list. **Currently fake sample data.** |
| `backend/Code.gs` | Google Apps Script that receives surveys |
| `tools/dev_server.py` | Local test server that mimics the backend |

## Publishing the app (GitHub Pages)

1. On GitHub, go to **Settings → Pages**. Set *Source* to *Deploy from a branch*, *Branch* to `main`, and the folder to `/ (root)`.
2. The app will be at `https://hasanzahra27-commits.github.io/baltimore-vbn-field-survey/`.
3. On a phone, open that link and use **Add to Home Screen**, so it opens like an app and works offline.

This repo is public so Pages is free. It contains only code and **fake** sample addresses — keep real property lists and survey data out of it (they live in the Google Sheet).

## Replacing the property list

Replace `data/properties.csv` and push. The only required columns are `block_lot` and `address`. Any other columns, such as `neighborhood` or `model_score`, appear on the survey page as pre-filled info and are copied into the export as `property_<column>`. Phones pick up the new list the next time they open the app with signal. They can also use **Menu → Refresh property list**.

## Running locally

```bash
python3 tools/dev_server.py
```

Open http://localhost:8000. To test uploads, temporarily set `SYNC_URL` in `config.js` to `http://localhost:8000/api`. Surveys will then land in `dev-data/surveys.csv`, which git ignores.
