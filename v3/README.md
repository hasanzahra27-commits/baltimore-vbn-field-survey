# VBN Field Survey tool

This is a mobile web app for field researchers to record whether sampled properties show signs of vacancy. The data is used to build a new training sample for the i-Team's Vacant Building Notice (VBN) prediction model.

This is **v3**, published at `https://hasanzahra27-commits.github.io/baltimore-vbn-field-survey/v3/`. Changes from v2:

- A 🐞 **bug button** in the header (also in the Menu). Reports go to a "Bug reports" tab in the Sheet and are emailed to `BUG_REPORT_EMAIL` in [`backend/Code.gs`](backend/Code.gs). Reports made offline send once there's signal.
- Required questions are marked with a red asterisk (*), with a "* Required" key at the bottom of each form.
- If the property couldn't be observed, everything after that answer is optional, including the reason, the location and photos.
- The BXP window item (D5) is split into three: dirty or clouded, covered with blankets/towels, and no curtains or blinds. Ticking any number of them still counts as **one** D sign, and the export keeps the old combined `d5_windows_dirty_or_coverings` column.
- The GPS note says "accurate to about N m" instead of "within N m".
- **Groups:** the i-Team can assign properties to volunteer groups, and each volunteer sees only their group's list. See [Assigning properties to groups](#assigning-properties-to-groups).
- New checklist items (not part of the BXP rule): vandalism or graffiti; alley in significant disrepair; front or back yard too overgrown to reach the property; fire or smoke damage; trash bins broken; blinds or curtains significantly broken.
- A required **occupancy rating** (Occupied / Unsure / Vacant), exported as `occupancy_rating`.
- Reworded: broken windows *or doors*; open *or missing* windows or doors; structural issues now include a cracked foundation; facade damage gives examples.
- Removed the "Was the property secured during this visit?" question and its before/after photos, since researchers don't secure properties.

**What researchers do:** enter their name, role and code-enforcement status once. Then, for each property:
1. Pick it from the list (filtered to *Not yet surveyed*).
2. Say whether they could observe it. If not, everything else is optional. Then register the location: tap **Register location** if they're there, or type where and when they observed it if filling in later.
3. Tick what they see under **Distress**, then **Occupancy** (signs no one lives there / signs someone is there / what neighbors told them). Each ticked item opens a box for details.
4. Give a 0–4 distress score (4 = blue sky vacant, 0 = no signs of distress).
5. Take as many front and back photos as needed (at least one of each, unless the back can't be photographed). Next to each, note how many houses it is from the corner and its color, so the back of a row home is easier to find. Add any other photos, each with an optional note.
6. Add comments and submit, or **Save draft and finish later**.

The app works out whether the property meets the BXP rule (A, or B, or ≥1 of C, or ≥5 of D) in the background and stores it in the export, but never shows it to the researcher. Columns listed in `HIDDEN_PROPERTY_FIELDS` in `config.js` (by default `model_score` and `sample_group`) are hidden from the survey screen too, so the model's prediction doesn't nudge what researchers record.

**Offline:** every survey, including photos, is saved on the phone first. Drafts survive closing the browser. Submitted surveys upload automatically once there's signal, and the badge in the header shows how many are waiting.

**Where the data goes:** each survey becomes a row in a Google Sheet (downloadable as CSV) and the photos go into Google Drive. See [backend/README.md](backend/README.md).

## Repo layout

| Path | What it is |
|---|---|
| `index.html`, `css/`, `js/` | The web app: plain HTML/CSS/JS with no build step |
| `js/config.js` | **The only file to edit when deploying**: upload URL and key |
| `js/checklist.js` | Survey wording and order, score labels, dropdown lists and the BXP rule |
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

## i-Team dashboard

The dashboard is at `/v3/dashboard/` (e.g. `https://hasanzahra27-commits.github.io/baltimore-vbn-field-survey/v3/dashboard/`). It's password protected and not linked from the volunteers' app. It shows, live (refreshing every minute):

- properties surveyed and still to survey, split by the surveyor's group or type. Every chart counts each property once: if it was surveyed more than once, the dashboard uses its latest survey where it could be observed (or else its latest survey)
- the share of surveys where the property could be observed
- how many Distress items were checked per survey
- net occupancy signs per survey: signs no one lives there (and a neighbor saying it's vacant) count +1; signs someone is there (and a neighbor saying it's occupied) count −1
- overall distress scores, and the occupancy rating (occupied / unsure / vacant)

Every chart can be filtered by group and surveyor type, and has a table view. The dashboard is also where the i-Team assigns properties to groups (below).

**Password.** The password is checked by the Google Apps Script, not by the page, because this repo is public. Set `DASHBOARD_PASSWORD` in `Code.gs` in the Apps Script editor (never in the repo), then deploy a new version. With no password set, the dashboard is off. The script only sends the dashboard the columns it charts: no names, comments, locations or photos.

### Assigning properties to groups

**On the dashboard (recommended):** tick properties in the table, type or pick a group name, and click **Assign selected**. Assignments are saved on a `Groups` tab in the Sheet and reach volunteers' phones within about a minute. **Remove group** takes a property out of its dashboard group.

**From a file:** click **Upload group file (CSV)** and choose a spreadsheet saved as CSV with a `block_lot` column and a `group` column (other columns are ignored). The dashboard previews what will change, including any block-lots that aren't on the property list, before you click **Apply**. Properties not in the file keep their group unless you tick the box to remove it. **Download groups** saves the current assignments in the same format, so you can edit them in Excel or Sheets and upload them again.

**Or in the property list:** add a `group` column to `data/properties.csv` and give each property a group name, such as `Group 1` or `Harlem Park team`. When volunteers open the app, they pick their group and then see only that group's properties. Staff whose role is *i-Team staff* can also pick **All groups** to see everything.

- A group set on the dashboard wins over the property list's `group` column. Removing it on the dashboard puts the property back on the list's group, if it has one.
- To move a property to another group in the list file, change its `group` value and push. To rename a group, rename it in every row; volunteers in the old group are asked to choose again.
- Leave the column out to show everyone every property.
- Each survey records the volunteer's group as `observer_group`, and the property's group as `property_group`.
- This sorts the list for convenience. It isn't a security control: anyone with the link can choose any group except **All groups**.

## Running locally

```bash
python3 tools/dev_server.py
```

Open http://localhost:8000. To test uploads, temporarily set `SYNC_URL` in `config.js` to `http://localhost:8000/api`. Surveys will then land in `dev-data/surveys.csv`, which git ignores.
