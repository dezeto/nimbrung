# Fake pear-desktop API Server for the e2e suite. No network, no images.
# usage: python3 ytm-stub.py [port]   (default 26999)
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 26999
PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
NOW = {"title": "Stub Song", "artist": "Stub Artist", "album": "Stub Album", "imageSrc": PIXEL,
       "isPaused": False, "songDuration": 3600, "elapsedSeconds": 42, "videoId": "stubvideo01"}
CATALOG = {}  # videoId -> (title, artist)


def track(vid, title, artist):
    CATALOG[vid] = (title, artist)
    return vid


QUEUE = [track("stubvideo01", "Stub Song", "Stub Artist")]
QUEUE += [track("auto%07d" % i, "Autoplay Tune %d" % i, "Auto Artist %d" % i) for i in range(1, 9)]
VOLUME = {"state": 50, "isMuted": False}


def runs(*texts):
    return {"runs": [{"text": t} for t in texts]}


def panel(vid, selected):
    title, artist = CATALOG[vid]
    return {"playlistPanelVideoRenderer": {
        "videoId": vid, "selected": selected, "title": runs(title),
        "longBylineText": runs(artist, " • ", "Stub Album", " • ", "3:20"),
        "lengthText": runs("3:20"), "thumbnail": {"thumbnails": []}}}


def row(vid):
    title, artist = CATALOG[vid]
    return {"musicResponsiveListItemRenderer": {
        "playlistItemData": {"videoId": vid},
        "flexColumns": [
            {"musicResponsiveListItemFlexColumnRenderer": {"text": runs(title)}},
            {"musicResponsiveListItemFlexColumnRenderer": {"text": runs("Song", " • ", artist, " • ", "Stub Album", " • ", "3:20")}},
        ]}}


def search(query):
    q = query.strip() or "x"
    vids = [track("srch%07d" % i, "%s Result %d" % (q, i), "Search Artist %d" % i) for i in range(1, 17)]
    return {"contents": {"tabbedSearchResultsRenderer": {"tabs": [{"tabRenderer": {"content": {
        "sectionListRenderer": {"contents": [{"musicShelfRenderer": {"contents": [row(v) for v in vids]}}]}}}}]}}}


class H(BaseHTTPRequestHandler):
    def send(self, body=None):
        if body is None:
            self.send_response(204)
            self.end_headers()
            return
        data = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except ValueError:
            return {}

    def do_GET(self):
        if self.path == "/api/v1/song":
            return self.send(NOW)
        if self.path == "/api/v1/queue":
            return self.send({"items": [panel(v, i == 0) for i, v in enumerate(QUEUE)]})
        if self.path == "/api/v1/volume":
            return self.send(VOLUME)
        if self.path.startswith("/api/get?"):  # LRCLIB stand-in: every song gets the same timed lines
            # a line every 5s, with an instrumental gap (empty line) at 0:25
            return self.send({"syncedLyrics": "\n".join(
                "[%02d:%02d.00] %s" % (s // 60, s % 60, "" if n == 6 else "Stub line %d" % n)
                for n, s in ((n, (n - 1) * 5) for n in range(1, 25)))})
        self.send()

    def do_POST(self):
        b = self.body()
        if self.path.startswith("/auth/"):
            return self.send({"accessToken": "stub"})
        if self.path == "/api/v1/search":
            return self.send(search(b.get("query", "")))
        if self.path == "/api/v1/queue":
            vid = b.get("videoId")
            if vid in CATALOG:
                QUEUE.append(vid)
            return self.send()
        if self.path == "/api/v1/volume":
            VOLUME["state"] = b.get("volume", VOLUME["state"])
            return self.send()
        if self.path == "/api/v1/toggle-mute":
            VOLUME["isMuted"] = not VOLUME["isMuted"]
            return self.send()
        self.send()  # next, play, pause: accepted, no state change

    def do_DELETE(self):
        self.send()

    do_PATCH = do_DELETE

    def log_message(self, *a):
        pass


ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
