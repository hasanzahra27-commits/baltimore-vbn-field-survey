# Handing off the VBN Field Survey app

This guide moves the app from the student team to the **Baltimore i-Team**. If DHCD later wants to keep the app running, the i-Team follows the same four steps to pass it on to DHCD.

There's nothing to install and no coding. It takes about an hour in total.

## Before you start

- **Accounts.** The i-Team needs a **Google account** and a free **GitHub account** (sign up at github.com). Use team accounts, not one person's own, so the app doesn't depend on any one person.
- **Who does what.** The current owners (Zahra and Emma) handle the parts marked **Students**. The i-Team handles the parts marked **i-Team**.
- **Pause surveying.** Ask researchers to stop submitting surveys during the handoff. Each of them should open the app and check that the badge at the top says **All uploaded ✓**.
- **Only v3 matters.** The repo has three versions of the app. The current one is in the `v3` folder. You can ignore `v1` (the main folder) and `v2`.

## 1. Set up the results spreadsheet (i-Team, about 10 minutes)

Follow [v3/backend/README.md](v3/backend/README.md), signed in to the i-Team Google account. You'll create a new Google Sheet, paste in the upload script, and get a **web app address** ending in `/exec`. Keep that address for step 3.

When the guide says to paste `Code.gs`, also fill in `BUG_REPORT_EMAIL` with the i-Team contact who should get bug reports.

## 2. Copy over the results collected so far (Students and i-Team, about 10 minutes)

1. **Students:** share the current results Sheet and the **VBN Field Survey Photos** folder in Google Drive with the i-Team account.
2. **i-Team:** in the new Sheet, add a tab named exactly `Surveys`. Rename the empty first tab if there is one.
3. **i-Team:** in the old Sheet, open the **Surveys** tab, click the grey box in the top-left corner to select everything, and copy it. In the new Sheet's `Surveys` tab, click cell A1 and paste. Do the same for the **Bug reports** tab if the old Sheet has one.
4. **i-Team:** in Google Drive, right-click the shared photo folder, choose **Download**, then upload the downloaded folder to the i-Team's Drive so you have your own copy.

The photo links in the copied rows still point to the students' Drive. Students: keep the original photo folder and leave it shared.

## 3. Move the app to the i-Team (Students and i-Team, about 15 minutes)

1. **Students:** on github.com, open the repo and go to **Settings**, then **General**. Scroll to the bottom, click **Transfer**, and enter the i-Team's GitHub username.
2. **i-Team:** accept the transfer from the email GitHub sends.
3. **i-Team:** in the repo, go to **Settings**, then **Pages**. Check it says **Deploy from a branch**, branch **main**, folder **/ (root)**.
4. **i-Team:** connect the app to your new Sheet. Open `v3/js/config.js` and click the pencil ✏️ to edit it. Replace the address between the quotes after `SYNC_URL:` with your web app address from step 1. Click **Commit changes**.

The app's link changes to `https://<i-Team GitHub username>.github.io/baltimore-vbn-field-survey/v3/`, and **the old link stops working**. Send researchers the new link and ask them to add it to their phone's Home Screen again.

## 4. Add the real property list and check bug reports (i-Team, about 10 minutes)

1. **Property list.** Make a spreadsheet with columns `block_lot` and `address`, plus optional columns like `neighborhood`. Download it as a CSV file. In the repo, open `v3/data`, click **Add file**, then **Upload files**, upload it as `properties.csv` to replace the old one, and click **Commit changes**.
2. **Bug reports.** In the app, tap 🐞 and send a test report. It should appear on a **Bug reports** tab in your Sheet and arrive by email.

**Note:** the repo is **public**, so anyone online can see `properties.csv`. Before uploading the real list, check with the City whether addresses can be public. Don't include model scores or other sensitive columns. Also confirm that storing photos of private homes in Google Drive meets City data policy.

## After the handoff

Keeping the app running takes one person:

- **Update the property list** when the sample changes, as in step 4.
- **Read the results** in the Google Sheet. To export them, choose **File → Download → Comma-separated values (.csv)**.
- **Respond to bug reports** that arrive by email.

There are no servers to run and nothing to pay for.
