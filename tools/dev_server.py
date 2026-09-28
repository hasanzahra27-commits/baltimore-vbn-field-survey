"""Local test server: serves the app and mimics the Apps Script backend.

    python3 tools/dev_server.py            # then open http://localhost:8000
    Set SYNC_URL in js/config.js to "http://localhost:8000/api" to test uploads.

Uploaded surveys go to dev-data/surveys.csv and photos to dev-data/photos/.
"""
import base64, csv, json, os, re, sys
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = ROOT
DATA = os.path.join(ROOT, "dev-data")
CSV_PATH = os.path.join(DATA, "surveys.csv")


def read_rows():
    if not os.path.exists(CSV_PATH):
        return [], []
    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        r = csv.DictReader(f)
        return list(r.fieldnames or []), list(r)


def write_rows(header, rows):
    os.makedirs(DATA, exist_ok=True)
    with open(CSV_PATH, "w", newline="", encoding="utf-8") as f:
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
        by = lambda k: [p for p in photos if p["kind"] == k]
        row["photo_front"] = "\n".join(urls[p["id"]] for p in by("front"))
        row["photo_back"] = "\n".join(urls[p["id"]] for p in by("back"))
        row["concern_photos"] = "\n".join(f"{urls[p['id']]} | {p.get('caption', '')}" for p in by("concern"))
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
