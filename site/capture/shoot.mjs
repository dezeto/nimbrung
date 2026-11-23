// Takes the nine product-site screenshots from a demo jam and writes them to site/public/img/ as WebP.
//
// Start the demo first (ports are fixed on purpose: never 8080 or 26538, never a real jam):
//   python3 site/capture/demo-stub.py 26971 &
//   server/…/nimbrung -listen 127.0.0.1:8191 -ytm http://127.0.0.1:26971 -lyrics http://127.0.0.1:26971 \
//     -name "Rina's rooftop" -code SORE -host-key demo-host-key-7d2e9b -public-url https://jam.example.com \
//     -state-file "" -max-adds 0 -skip-votes 3 -poll 250ms -token-file <scratch>/token.json
// then: node site/capture/shoot.mjs           (seeds the jam, shoots everything; run once per fresh server)
//       node site/capture/shoot.mjs --shots   (only shoots, on a jam that is already seeded)
// Env: BASE (default http://127.0.0.1:8191), STUB (http://127.0.0.1:26971), OUT (scratch dir for the PNGs),
//      ONLY=name,name to shoot a few. Needs cwebp (/opt/homebrew/bin/cwebp) and the web workspace's playwright-core.
import { execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { chromium, request } = await import(join(here, "../../web/node_modules/playwright-core/index.mjs"));

const BASE = process.env.BASE ?? "http://127.0.0.1:8191";
const STUB = process.env.STUB ?? "http://127.0.0.1:26971";
const OUT = process.env.OUT ?? join(tmpdir(), "nimbrung-site-shots");
const IMG = join(here, "../public/img");
const HOST_KEY = "demo-host-key-7d2e9b";
const ONLY = process.env.ONLY?.split(",");
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const song = (n) => "song" + String(n).padStart(5, "0");
const stub = async (path, data, tries = 4) => {
  try {
    return await (await fetch(STUB + path, data ? { method: "POST", body: JSON.stringify(data) } : {})).json();
  } catch (e) {
    if (tries <= 1) throw e;
    await sleep(300);                            // the stub is a tiny http.server; it sometimes resets a fresh connection
    return stub(path, data, tries - 1);
  }
};
const call = async (ctx, method, path, body) => {
  const res = await ctx[method](BASE + "/api" + path, body ? { data: body } : {});
  if (!res.ok()) throw new Error(`${method} ${path} -> ${res.status()} ${await res.text()}`);
};

const FACES = { Rina: "🦊", Bima: "🐼", Sari: "🐸", Dewi: "🦄", Putri: "🐙", Yoga: "🐯", Andi: "🎧" };
const guests = {};
const joinAs = async (name) => {
  guests[name] = await request.newContext();
  await call(guests[name], "post", "/join", { code: "SORE", name, avatar: FACES[name] });
};

const browser = await chromium.launch();
const phone = (scheme = "dark", state) =>
  browser.newContext({ storageState: state, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme, isMobile: true, hasTouch: true });
const laptop = () => browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "dark" });
const wanted = (name) => !ONLY || ONLY.includes(name);

/** PNG -> name-v2.webp (1x, downscaled, <= max1x KB) and name-v2@2x.webp (<= 300 KB), lowering the quality as needed. */
function encode(name, w1, max1x = 120) {
  const png = join(OUT, name + ".png");
  const run = (out, resize, max) => {
    for (let q = 80; q >= 30; q -= 5) {
      execFileSync("/opt/homebrew/bin/cwebp", ["-quiet", "-q", String(q), "-m", "6", ...(resize ? ["-resize", String(resize), "0"] : []), png, "-o", out]);
      const kb = statSync(out).size / 1024;
      if (kb <= max) return { q, kb };
    }
    return { q: 30, kb: statSync(out).size / 1024 };
  };
  const a = run(join(IMG, `${name}-v2.webp`), w1, max1x);
  const b = run(join(IMG, `${name}-v2@2x.webp`), 0, 300);
  console.log(`${name}: 1x q${a.q} ${a.kb.toFixed(0)} KB, 2x q${b.q} ${b.kb.toFixed(0)} KB`);
}

async function seed() {
  // Three faces are taken when the join screen is shot, so it happens before the rest arrive.
  for (const n of ["Rina", "Dewi", "Putri"]) await joinAs(n);
  if (wanted("join")) {
    const ctx = await phone();
    const page = await ctx.newPage();
    await stub("/ctl/seek?s=62");
    await page.goto(BASE + "/join/SORE");
    await page.getByLabel("Your name").waitFor();
    await sleep(2500);
    await page.screenshot({ path: join(OUT, "join.png") });
    await ctx.close();
  }
  for (const n of ["Bima", "Sari", "Yoga", "Andi"]) await joinAs(n);

  // The opener and autoplay rows have no owner, so they read as Autoplay.
  await stub("/ctl/set", { queue: [13, 14, 15, 16, 19, 23].map(song), cur: 0 });
  await sleep(800);
  const history = [[5, "Dewi"], [7, "Putri"], [9, "Yoga"], [10, "Andi"], [6, "Rina"], [8, "Sari"], [21, "Bima"], [0, "Rina"]];
  for (const [s, who] of history) { await call(guests[who], "post", "/queue", { videoId: song(s) }); await sleep(150); }
  const reactions = [
    { fire: 3, heart: 2 }, { heart: 4, clap: 2 }, { fire: 9, heart: 6, dance: 5, party: 3 },
    { laugh: 3, clap: 3 }, { dance: 5, fire: 2 }, { heart: 3, party: 2 }, { clap: 4, laugh: 1 },
  ];
  const names = Object.keys(guests);
  for (let i = 0; i <= reactions.length; i++) {
    await stub("/ctl/next");
    await sleep(1200);                           // the poll sees the new song
    let k = 0;
    for (const [kind, n] of Object.entries(reactions[i] ?? {}))
      for (let j = 0; j < n; j++) { await call(guests[names[k++ % names.length]], "post", "/reactions", { reaction: kind }); await sleep(30); }
    await sleep(600);
  }
  // Up next, in play order: Bima's own song is second.
  for (const [s, who] of [[1, "Dewi"], [2, "Bima"], [3, "Putri"], [4, "Andi"], [22, "Yoga"]]) { await call(guests[who], "post", "/queue", { videoId: song(s) }); await sleep(200); }
  for (const [who, text] of [["Rina", "ok who put this on, it's perfect"], ["Bima", "Rina has taste tonight"], ["Dewi", "mine is next, no skipping"], ["Yoga", "this bit gets me every time"]]) {
    await call(guests[who], "post", "/comments", { text }); await sleep(300);
  }
  await call(guests.Sari, "post", "/skip");
  await call(guests.Yoga, "post", "/nudges", { nudge: "louder" });
  await call(guests.Andi, "post", "/nudges", { nudge: "louder" });
  await sleep(1500);
}

// A burst of reactions from other guests, then the shot while they float.
const burst = async (list = [["Dewi", "fire"], ["Putri", "heart"], ["Yoga", "party"], ["Andi", "fire"], ["Rina", "heart"]]) => {
  for (const [n, r] of list) { await call(guests[n], "post", "/reactions", { reaction: r }); await sleep(60); }
};

async function shots() {
  const bima = await guests.Bima.storageState();

  for (const scheme of ["dark", "light"]) {
    const name = `queue-${scheme}`;
    if (!wanted(name)) continue;
    const ctx = await phone(scheme, bima), page = await ctx.newPage();
    await page.goto(BASE + "/");
    await page.getByRole("heading", { name: "Up next" }).waitFor();
    await stub("/ctl/seek?s=62");
    await page.evaluate(() => window.scrollTo(0, 130));
    await sleep(1200);
    await call(guests.Dewi, "post", "/comments", { text: "turn it up a little!!" });
    await sleep(1500);
    await burst();
    await sleep(Number(process.env.FLOAT_MS ?? 750));
    await page.screenshot({ path: join(OUT, name + ".png") });
    await ctx.close();
    await sleep(11000);                          // reaction rate window
  }

  if (wanted("search")) {
    const ctx = await phone("dark", bima), page = await ctx.newPage();
    await stub("/ctl/seek?s=62");
    await page.goto(BASE + "/search");
    await page.getByRole("searchbox").fill("santai");
    await page.getByText("Bintang Jatuh").waitFor();
    await sleep(1500);
    await page.screenshot({ path: join(OUT, "search.png") });
    await ctx.close();
  }

  if (wanted("recap")) {
    const ctx = await phone("dark", bima), page = await ctx.newPage();
    // The server has only known this jam for a minute or two, so spread the songs over a real night
    // in the browser's copy of /api/recap (one song every 3m35s). Nothing else is changed.
    await page.route("**/api/recap", async (route) => {
      const res = await route.fetch(), d = await res.json();
      const now = Date.parse(d.now), n = d.played.length;
      d.played.forEach((p, i) => { p.startedAt = new Date(now - (n - i) * 215000).toISOString(); });
      await route.fulfill({ response: res, json: d });
    });
    await page.goto(BASE + "/recap");
    await page.getByText("What played").waitFor();
    await sleep(1500);
    // Grow the viewport to the page so the fixed backdrop covers all of it (a fullPage capture leaves a dark band at the bottom).
    const h = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
    await page.setViewportSize({ width: 390, height: h });
    await sleep(800);
    await page.screenshot({ path: join(OUT, "recap.png") });
    await ctx.close();
  }

  // The host and room pages are opened from localhost with no X-Forwarded-For, which is how the app tells the host's own computer.
  const lap = await laptop();
  if (wanted("host")) {
    const h = await lap.newPage();
    await stub("/ctl/seek?s=62");
    await h.goto(BASE + `/host?key=${HOST_KEY}`);
    await h.getByRole("switch", { name: "Ask to join" }).waitFor();
    await sleep(2500);
    await h.screenshot({ path: join(OUT, "host.png") });
    const html = await h.content(), text = await h.innerText("body");
    console.log("host page: key in html:", html.includes(HOST_KEY), "| localhost/127.0.0.1 in text:", /localhost|127\.0\.0\.1/.test(text), "| URL:", h.url());
    await h.close();
  }
  const r = await lap.newPage();
  await stub("/ctl/seek?s=62");
  await r.goto(BASE + "/room");
  await sleep(3000);
  // The song playing has no lyrics here, so the room view opens on the queue.
  if (wanted("room-queue")) {
    await call(guests.Dewi, "post", "/comments", { text: "this one's for the rooftop" });
    await sleep(6500);                           // the pill stays, the toast is gone
    await burst([["Rina", "fire"], ["Putri", "heart"], ["Andi", "party"]]);
    await sleep(350);
    await r.screenshot({ path: join(OUT, "room-queue.png") });
  }
  const text = await r.innerText("body");
  console.log("room page: localhost/127.0.0.1 in text:", /localhost|127\.0\.0\.1/.test(text));

  // Lyrics last: the invented Senja di Kemang (song 24, the only song with lyrics) starts
  // right after the current one, so Up next and who added what stay as they were.
  if (wanted("lyrics") || wanted("room-lyrics")) {
    const { cur, queue } = await stub("/ctl/queue");
    queue.splice(cur + 1, 0, song(24));
    await stub("/ctl/set", { queue, cur: cur + 1 });
    await stub("/ctl/seek?s=62");
    await sleep(2500);                           // the poll sees the new song, the lyrics load
  }
  if (wanted("lyrics")) {
    const ctx = await phone("dark", bima), page = await ctx.newPage();
    await page.goto(BASE + "/");
    await page.getByRole("heading", { name: "Up next" }).waitFor();
    await stub("/ctl/seek?s=62");
    await page.getByRole("button", { name: /lyrics/i }).first().click();
    await sleep(2500);
    await page.screenshot({ path: join(OUT, "lyrics.png") });
    await ctx.close();
  }
  if (wanted("room-lyrics")) {
    await r.reload();
    await sleep(3500);
    await r.screenshot({ path: join(OUT, "room-lyrics.png") });
  }
  await lap.close();
}

if (!process.argv.includes("--shots")) await seed();
else for (const n of Object.keys(FACES)) { guests[n] = await request.newContext({ storageState: join(OUT, `guest-${n}.json`) }); }
for (const n of Object.keys(guests)) await guests[n].storageState({ path: join(OUT, `guest-${n}.json`) });
await shots();
await browser.close();

for (const [name, w, max] of [["queue-dark", 390], ["queue-light", 390], ["join", 390], ["search", 390], ["lyrics", 390], ["recap", 390], ["host", 1440], ["room-queue", 1440, 140], ["room-lyrics", 1440]])
  if (wanted(name)) encode(name, w, max);
