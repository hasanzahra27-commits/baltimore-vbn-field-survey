# Backend setup (Google Sheet + Drive)

The field app sends each submitted survey to a Google Apps Script attached to a Google Sheet:

- **One row per survey** goes on the `Surveys` tab. Download it any time with *File → Download → Comma-separated values (.csv)*.
- **Photos** are saved in Drive under `VBN Field Survey Photos/<block-lot>/`. The row links to each one.

This takes about 10 minutes, with no coding. Do it from the Google account that should **own the data**, ideally an i-Team account rather than a student's.

## 1. Create the Sheet and script

1. Create a new Google Sheet and name it something like *VBN Field Survey Data*.
2. In the Sheet, open **Extensions → Apps Script**.
3. Delete the sample code, then paste in the whole of [`Code.gs`](Code.gs).
4. Optional: set `SHARED_KEY` to any random word. You'll put the same word in the app in step 3.
   Set `BUG_REPORT_EMAIL` to whoever should get bug reports from the app's 🐞 button.
5. Limit the script's permissions:
   1. Click the ⚙️ **Project Settings** icon on the left.
   2. Tick **Show "appsscript.json" manifest file in editor**.
   3. Go back to the **Editor** (the `< >` icon) and open `appsscript.json`.
   4. Replace its contents with [`appsscript.json`](appsscript.json).
6. Click **Save**.

Step 5 makes the script ask only for these permissions:

| Google's wording | What it means |
|---|---|
| *See, edit, create and delete only the specific Google Drive files that you use with this app* | Only the photo folders it creates. It can't see anything else in your Drive. |
| *See, edit, create and delete only the spreadsheets that this application has been installed in* | Only this one Sheet. |
| *Connect to an external service* | Lets the script call Google's own Drive upload service. It's needed because of the narrow Drive permission. |
| *Send email as you* | Emails bug reports to `BUG_REPORT_EMAIL` (app v3 and later). It can't read your email. |

If Google asks for access to **all** of your Drive or spreadsheets, step 5 didn't save. Cancel and redo it.

## 2. Deploy it as a web app

1. Click **Deploy → New deployment**.
2. Click the gear icon and choose **Web app**.
3. Set **Execute as** to *Me*.
4. Set **Who has access** to *Anyone*. Phones send data without signing in, so this setting is required.
5. Click **Deploy**, then **Authorize access**. Google will warn *"Google hasn't verified this app"*, which is normal for your own script. Click **Advanced → Go to (project name) (unsafe)**, check the permissions match the table above, then click **Allow**.
6. Copy the **Web app URL**. It ends in `/exec`.

## 3. Connect the app

In `js/config.js`:

```js
SYNC_URL: "https://script.google.com/macros/s/XXXXXXXX/exec",
SHARED_KEY: "the-same-word-as-in-Code.gs",
```

Commit and push. Phones pick up the change the next time they open the app with signal.

## Changing the script later

Use **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**. This keeps the same URL. If you choose *New deployment* instead, you get a new URL and must update `config.js` again.

## Notes

- **Bug reports (app v3).** Each report is added to the `Bug reports` tab and, if `BUG_REPORT_EMAIL` is set, emailed from the deploying account. To hand the app over, change `BUG_REPORT_EMAIL` and deploy a new version. Google limits these emails to about 100 a day on a personal account (1,500 on Workspace); reports past that are still logged on the tab. With an older script, v3 bug reports are rejected and stay queued on the phone.
- **App v2 needs the updated script.** v2 adds photo columns (before/after securing, notes on every photo). After pulling v2, paste the new `Code.gs` and deploy a new version as above. With the old script, surveys still upload, but the new photo columns show file names instead of Drive links.
- **Columns** come from the app. If a later app version adds a field, a new column is appended automatically. Existing columns are never reordered.
- **Duplicates.** Each survey has a unique `survey_id`. If a phone resends a survey after a dropped connection, it isn't added twice.
- **Photos** are in the `VBN Field Survey Photos` folder in the deploying account's My Drive. The script remembers that folder by ID, so moving or renaming it is fine. Don't delete it: the script would keep trying to save into the deleted folder.
- **Access.** The Sheet and photo folder are private to the deploying account. Share them with i-Team staff as normal Google files.
- **Security.** Anyone with the web app URL could post to it. `SHARED_KEY` blocks casual misuse, but it's visible in the public repo. Before real data collection, check with the i-Team whether storing photos of private homes in Google Drive meets City data policy.
