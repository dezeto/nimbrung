# Fake YouTube Music player + LRCLIB for the product-site screenshots (site/capture/shoot.mjs).
# Grown from web/apps/web/e2e/ytm-stub.py. Songs and lyrics are invented except the one playing (see SONGS); artwork is generated here.
# Artwork is generated here (gradients), nothing is fetched.
# usage: python3 stub.py PORT
import json, math, random, struct, sys, time, zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

PORT = int(sys.argv[1])
# Invented timed lyrics for the song that is playing, in LRCLIB's "[mm:ss.xx] line" shape.
LYRICS = [
    (10, "Lampu jalan mulai menyala"), (16, "Di ujung gang yang kita kenal"), (22, "Kopi dingin di atas meja"),
    (28, "Kau tertawa, aku pura-pura lupa"), (36, ""), (42, "Senja di Kemang, pelan-pelan turun"),
    (49, "Awan jingga di atas atap"), (56, "Kita duduk tanpa bicara"), (63, "Biar lagu ini yang bercerita"),
    (70, "Nyalakan saja satu lagi lampu"), (77, "Biar malam tak terlalu cepat datang"), (84, "Senja di Kemang, jangan pergi dulu"),
    (91, "Masih ada yang belum sempat kita bilang"), (99, ""), (105, "Angin membawa wangi hujan"),
    (112, "Di bawah langit yang mulai biru"), (119, "Kita pulang pelan-pelan"), (126, "Sambil menghitung lampu"),
    (133, "Senja di Kemang, terima kasih"), (140, "Untuk malam yang tak mau selesai"),
]
SYNCED = "\n".join("[%02d:%02d.00] %s" % (t // 60, t % 60, x) for t, x in LYRICS)
PLAIN = "\n".join(x for _, x in LYRICS if x)
# The song playing is one real title (Future, Red Velvet, 3:36). It has no lyrics here: real lyrics
# aren't reproduced, so the lyrics shots switch to the invented Senja di Kemang (the last entry).
SONGS = [
    ("Future", "Red Velvet", "Start-Up OST Part 1", 216),
    ("Lampu Kota", "Orkes Malam", "Lampu Kota", 203),
    ("Kopi Pagi", "Teman Sebangku", "Kopi Pagi", 188),
    ("Neon Slowdance", "Kaca Pagi", "Neon Slowdance", 226),
    ("Jalan Pulang", "Rumah Kaca", "Jalan Pulang", 241),
    ("Hujan Pertama", "Dara Ayu", "Hujan Pertama", 207),
    ("Paper Planes in June", "Wren Holloway", "Paper Planes", 198),
    ("Midnight Kitchen", "Juno & The Lanterns", "Late Light", 234),
    ("Pelan-Pelan Saja", "Rafi Mahendra", "Pelan", 243),
    ("Golden Hour Again", "Sable Coast", "Golden Hour Again", 222),
    ("Tidal", "Ines Varga", "Tidal", 195),
    ("Bintang Jatuh", "Nara Putri", "Bintang Jatuh", 219),
    ("Langit Jingga", "Kelana", "Langit Jingga", 205),
    ("Warung Malam", "Sendu", "Warung Malam", 226),
    ("Roller Rink", "Dot Matrix Hearts", "Roller Rink", 193),
    ("Everything Is Fine", "Cassia Lowe", "Everything Is Fine", 237),
    ("Mangga Muda", "Gigi Kenanga", "Mangga Muda", 182),
    ("Overnight Train", "Marlo Finch", "Overnight Train", 249),
    ("Soft Static", "Elio Park", "Soft Static", 214),
    ("Sunday Slow Down", "Pale Harbor", "Sunday", 208),
    ("Rumah di Ujung Jalan", "Laras & Kawan", "Rumah", 228),
    ("Lemonade Summer", "Hollis Reed", "Lemonade Summer", 184),
    ("Hello Again, Tuesday", "Pocket Orchestra", "Tuesday", 191),
    ("Slow Hands, Warm Light", "Teman Hujan", "Warm Light", 211),
    ("Senja di Kemang", "Laut Biru", "Senja", 214),  # song00024: the only one with lyrics
]
CATALOG = {}  # vid -> (title, artist, album, seconds, index)
for i, (t, a, al, d) in enumerate(SONGS):
    CATALOG["song%05d" % i] = (t, a, al, d, i)
VIDS = list(CATALOG)

QUEUE = []   # videoIds, played rows included, like the real app
CUR = [0]
STARTED = [time.time()]
PAUSED = [False]
VOLUME = {"state": 62, "isMuted": False}


def mmss(s):
    return "%d:%02d" % (s // 60, s % 60)


def runs(*texts):
    return {"runs": [{"text": t} for t in texts]}


def art_url(vid):
    return "http://127.0.0.1:%d/art/%s.png" % (PORT, vid)


def thumbs(vid):
    return {"thumbnails": [{"url": art_url(vid), "width": 544, "height": 544}]}


def png(w, h, rows):
    raw = b"".join(b"\x00" + bytes(r) for r in rows)
    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b"")


ART = {}


def art(vid):
    """A generated cover: diagonal gradient, a soft glow, a disc and a stripe, seeded by the song."""
    if vid in ART:
        return ART[vid]
    rnd = random.Random(CATALOG[vid][4] * 104729 + 31)
    n = 300
    h1, h2 = rnd.random(), (rnd.random() + 0.35 + rnd.random() * 0.3) % 1

    def hsv(h, s, v):
        i = int(h * 6) % 6
        f = h * 6 - int(h * 6)
        p, q, t = v * (1 - s), v * (1 - f * s), v * (1 - (1 - f) * s)
        r, g, b = [(v, t, p), (q, v, p), (p, v, t), (p, q, v), (t, p, v), (v, p, q)][i]
        return r * 255, g * 255, b * 255

    c1, c2 = hsv(h1, 0.62, 0.92), hsv(h2, 0.7, 0.55)
    glow = hsv((h1 + 0.08) % 1, 0.3, 1.0)
    disc = hsv((h1 + 0.92) % 1, 0.28, 0.98)
    gx, gy = rnd.uniform(0.2, 0.8) * n, rnd.uniform(0.15, 0.5) * n
    dx, dy, dr = rnd.uniform(0.3, 0.7) * n, rnd.uniform(0.5, 0.78) * n, rnd.uniform(0.14, 0.24) * n
    sy, sh = rnd.uniform(0.25, 0.7) * n, rnd.uniform(0.03, 0.07) * n
    rows = []
    for y in range(n):
        row = []
        for x in range(n):
            t = (x + y) / (2.0 * n)
            col = [c1[k] * (1 - t) + c2[k] * t for k in range(3)]
            g = max(0.0, 1 - math.hypot(x - gx, y - gy) / (0.55 * n)) ** 2 * 0.55
            col = [col[k] * (1 - g) + glow[k] * g for k in range(3)]
            sa = max(0.0, min(1.0, (sh - abs(y - (sy + 0.15 * (x - n / 2)))) / 2.0)) * 0.22
            col = [col[k] * (1 - sa) + 255 * sa for k in range(3)]
            d = math.hypot(x - dx, y - dy)
            if d < dr:
                a = min(1.0, (dr - d) / 1.5) * 0.92
                shade = 1 - 0.18 * (d / dr)
                col = [col[k] * (1 - a) + disc[k] * shade * a for k in range(3)]
            row += [max(0, min(255, int(v))) for v in col]
        rows.append(row)
    ART[vid] = png(n, n, rows)
    return ART[vid]


def now_json():
    if not QUEUE:
        return None
    vid = QUEUE[CUR[0]]
    t, a, al, d, _ = CATALOG[vid]
    el = min(d - 2, time.time() - STARTED[0])
    return {"title": t, "artist": a, "album": al, "imageSrc": art_url(vid), "isPaused": PAUSED[0],
            "songDuration": d, "elapsedSeconds": el, "videoId": vid}


def panel(idx, vid):
    t, a, al, d, _ = CATALOG[vid]
    return {"playlistPanelVideoRenderer": {
        "videoId": vid, "selected": idx == CUR[0], "title": runs(t),
        "longBylineText": runs(a, " • ", al, " • ", mmss(d)),
        "lengthText": runs(mmss(d)), "thumbnail": thumbs(vid)}}


def row(vid):
    t, a, al, d, _ = CATALOG[vid]
    return {"musicResponsiveListItemRenderer": {
        "playlistItemData": {"videoId": vid},
        "thumbnail": {"musicThumbnailRenderer": {"thumbnail": thumbs(vid)}},
        "flexColumns": [
            {"musicResponsiveListItemFlexColumnRenderer": {"text": runs(t)}},
            {"musicResponsiveListItemFlexColumnRenderer": {"text": runs("Song", " • ", a, " • ", al, " • ", mmss(d))}},
        ]}}


def search(query):
    q = query.strip().lower()
    hits = [v for v in VIDS if q and (q in CATALOG[v][0].lower() or q in CATALOG[v][1].lower())]
    if q == "santai":  # a mood query: YouTube answers with a mix of unrelated titles
        hits = ["song%05d" % i for i in (11, 12, 2, 17, 18, 20)]
        return {"contents": {"tabbedSearchResultsRenderer": {"tabs": [{"tabRenderer": {"content": {
            "sectionListRenderer": {"contents": [{"musicShelfRenderer": {"contents": [row(v) for v in hits]}}]}}}}]}}}
    for v in VIDS:
        if len(hits) >= 8:
            break
        if v not in hits:
            hits.append(v)
    return {"contents": {"tabbedSearchResultsRenderer": {"tabs": [{"tabRenderer": {"content": {
        "sectionListRenderer": {"contents": [{"musicShelfRenderer": {"contents": [row(v) for v in hits]}}]}}}}]}}}


def advance():
    if CUR[0] + 1 < len(QUEUE):
        CUR[0] += 1
        STARTED[0] = time.time()


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
        u = urlparse(self.path)
        if u.path.startswith("/art/"):
            data = art(u.path[5:].split(".")[0])
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if u.path == "/ctl/seek":  # seconds into the current song
            STARTED[0] = time.time() - float(parse_qs(u.query).get("s", ["0"])[0])
            return self.send({"ok": True})
        if u.path == "/ctl/next":
            advance()
            return self.send({"ok": True})
        if u.path == "/ctl/queue":
            return self.send({"cur": CUR[0], "queue": QUEUE})
        if u.path == "/ctl/ids":
            return self.send(VIDS)
        if u.path == "/api/v1/song":
            return self.send(now_json())
        if u.path == "/api/v1/queue":
            return self.send({"items": [panel(i, v) for i, v in enumerate(QUEUE)]} if QUEUE else None)
        if u.path == "/api/v1/volume":
            return self.send(VOLUME)
        if u.path == "/api/get":  # LRCLIB exact match: only the song that is playing has lyrics
            q = parse_qs(u.query)
            if q.get("track_name", [""])[0] == "Senja di Kemang":
                return self.send({"trackName": "Senja di Kemang", "artistName": "Laut Biru", "syncedLyrics": SYNCED, "plainLyrics": PLAIN})
            self.send_response(404)
            self.end_headers()
            return
        if u.path == "/api/search":  # LRCLIB search: nothing else is known
            return self.send([])
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
                if b.get("insertPosition") == "INSERT_AFTER_CURRENT_VIDEO" and QUEUE:
                    QUEUE.insert(CUR[0] + 1, vid)
                else:
                    QUEUE.append(vid)
            return self.send()
        if self.path == "/api/v1/next":
            advance()
            return self.send()
        if self.path == "/api/v1/volume":
            VOLUME["state"] = b.get("volume", VOLUME["state"])
            return self.send()
        if self.path == "/api/v1/toggle-mute":
            VOLUME["isMuted"] = not VOLUME["isMuted"]
            return self.send()
        if self.path == "/ctl/set":  # {"queue":[vid..], "cur":0}
            QUEUE[:] = b["queue"]
            CUR[0] = b.get("cur", 0)
            STARTED[0] = time.time()
            return self.send({"ok": True})
        self.send()

    def do_DELETE(self):
        i = int(self.path.rsplit("/", 1)[-1]) if self.path.startswith("/api/v1/queue/") else -1
        if 0 <= i < len(QUEUE) and i != CUR[0]:
            QUEUE.pop(i)
            if i < CUR[0]:
                CUR[0] -= 1
        self.send()

    def do_PATCH(self):
        b = self.body()
        i = int(self.path.rsplit("/", 1)[-1])
        if 0 <= i < len(QUEUE) and "toIndex" in b:
            v = QUEUE.pop(i)
            QUEUE.insert(b["toIndex"], v)
        self.send()

    def log_message(self, *a):
        pass


ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
