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
5. Click **Save**.

## 2. Deploy it as a web app

1. Click **Deploy → New deployment**.
2. Click the gear icon and choose **Web app**.
3. Set **Execute as** to *Me*.
4. Set **Who has access** to *Anyone*. Phones send data without signing in, so this setting is required.
5. Click **Deploy** and approve the permissions it asks for (Sheets and Drive).
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

- **Columns** come from the app. If a later app version adds a field, a new column is appended automatically. Existing columns are never reordered.
- **Duplicates.** Each survey has a unique `survey_id`. If a phone resends a survey after a dropped connection, it isn't added twice.
- **Access.** The Sheet and photo folder are private to the deploying account. Share them with i-Team staff as normal Google files.
- **Security.** Anyone with the web app URL could post to it. `SHARED_KEY` blocks casual misuse, but it's visible in the public repo. Before real data collection, check with the i-Team whether storing photos of private homes in Google Drive meets City data policy.
