"""Local test server: serves the app and mimics the Apps Script backend.

    python3 tools/dev_server.py            # then open http://localhost:8000
    Set SYNC_URL in js/config.js to "http://localhost:8000/api" to test uploads.

Uploaded surveys go to dev-data/surveys.csv, photos to dev-data/photos/ and
bug reports to dev-data/bugs.csv (no email is sent).
"""
import base64, csv, json, os, re, sys
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = ROOT
DATA = os.path.join(ROOT, "dev-data")
CSV_PATH = os.path.join(DATA, "surveys.csv")
BUGS_PATH = os.path.join(DATA, "bugs.csv")


def read_rows(path=CSV_PATH):
    if not os.path.exists(path):
        return [], []
    with open(path, newline="", encoding="utf-8") as f:
        r = csv.DictReader(f)
        return list(r.fieldnames or []), list(r)


def write_rows(header, rows, path=CSV_PATH):
    os.makedirs(DATA, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=header)
        w.writeheader()
        w.writerows(rows)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=APP, **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def reply(self, obj):
        body = json.dumps(obj).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urlparse(self.path)
        if u.path != "/api":
            return super().do_GET()
        _, rows = read_rows()
        props = {}
        for r in rows:
            p = props.setdefault(r["block_lot"], {"count": 0, "last_submitted_at": "", "last_observer": ""})
            p["count"] += 1
            if r["submitted_at"] > p["last_submitted_at"]:
                p["last_submitted_at"], p["last_observer"] = r["submitted_at"], r["observer_name"]
        self.reply({"ok": True, "properties": props})

    def do_POST(self):
        if urlparse(self.path).path != "/api":
            return self.send_error(404)
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if body.get("type") == "bug":
            # Same as saveBug_ in Code.gs, minus the email.
            report = body["report"]
            header, rows = read_rows(BUGS_PATH)
            if not any(r["report_id"] == report["report_id"] for r in rows):
                report["received_at"] = datetime.now(timezone.utc).isoformat()
                header += [k for k in report if k not in header]
                rows.append(report)
                write_rows(header, rows, BUGS_PATH)
                print(f"Bug report from {report.get('reporter_name')}: {report.get('description')}")
            return self.reply({"ok": True})
        row, photos = body["row"], body.get("photos", [])
        header, rows = read_rows()
        if any(r["survey_id"] == row["survey_id"] for r in rows):
            return self.reply({"ok": True, "duplicate": True, "photoUrls": {}})
        folder = os.path.join(DATA, "photos", re.sub(r"[^\w-]+", "-", row["block_lot"]))
        os.makedirs(folder, exist_ok=True)
        urls = {}
        for p in photos:
            with open(os.path.join(folder, p["filename"]), "wb") as f:
                f.write(base64.b64decode(p["data"]))
            urls[p["id"]] = f"http://localhost:{PORT}/dev-data/photos/{os.path.basename(folder)}/{p['filename']}"
        # Same as linkPhotos_ in Code.gs: swap file names in the row for links.
        for p in photos:
            for k, v in row.items():
                if isinstance(v, str) and p["filename"] in v:
                    row[k] = v.replace(p["filename"], urls[p["id"]])
        row["received_at"] = datetime.now(timezone.utc).isoformat()
        header += [k for k in row if k not in header]
        rows.append(row)
        write_rows(header, rows)
        print(f"Received survey {row['survey_id']} for {row['block_lot']} ({len(photos)} photos)")
        self.reply({"ok": True, "photoUrls": urls})


PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
if __name__ == "__main__":
    print(f"Serving app on http://localhost:{PORT}  (backend at /api)")
    ThreadingHTTPServer(("", PORT), Handler).serve_forever()
