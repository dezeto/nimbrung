# Nimbrung site

The product page for `nimbrung.dezeto.dev`: static HTML, CSS and one small JS
file, served by Workers static assets. No build step. Only `public/` is deployed.

## Edit

- Copy and sections: `public/index.html`. Every claim has a `src:` comment
  beside it. Change a claim only after checking the file it cites.
- Look: `public/site.css` (layout and type), `public/glass.css` (a trimmed copy
  of `docs/design/liquid-glass/glass.css`), `public/tokens.css` (copied as is
  from `docs/design/liquid-glass/tokens.css`; edit the source, then copy again).
- The two moving parts (reactions over the hero art, the QR turning into the
  join screen): `public/site.js`. The page works without it.
- The CSP in `public/_headers` allows no inline styles or scripts: no `style=""`
  attributes, no `<script>` bodies.
- The QR in `index.html` encodes `https://nimbrung.dezeto.dev/`. It was made
  with the `qrcode` package in `web/node_modules`, one `<rect>` per module,
  grouped in six rings from the centre so the reveal can stagger them.

Check locally with `npm install && npm run dev` (wrangler, port 8788), or any
static server pointed at `public/` (that one won't apply `_headers` or serve
`404.html` for misses).

## Captures still to add

Put each file in `public/img/`. Every capture has a 1× file and a `@2x` file
(DPR 2, WebP q≈80). The markup is already in `index.html` with these names,
sizes and alt texts. While a file is missing, `site.js` hides its figure (and
an empty row of figures); without JS the frame stays as a plain panel in the
ground colour. Check each alt text in `index.html` against the real capture.

| File (1×, then `@2x`) | Capture | 1× size (CSS px) | Where |
|---|---|---|---|
| `queue-dark-v1.webp`, `queue-dark-v1@2x.webp` | 1. `/` guest queue, dark | 390×844 | Guests, phone row |
| `queue-light-v1.webp`, `queue-light-v1@2x.webp` | 2. `/` guest queue, light | 390×844 | Guests, phone row (light visitors) |
| `join-v1.webp`, `join-v1@2x.webp` | 3. `/join/SORE` | 390×844 | Guests, phone row |
| `search-v1.webp`, `search-v1@2x.webp` | 4. `/search` | 390×844 | Guests, phone row |
| `lyrics-v1.webp`, `lyrics-v1@2x.webp` | 5. Lyrics sheet open | 390×844 | Guests, phone row |
| `recap-v1.webp`, `recap-v1@2x.webp` | 6. `/recap`, full page | 390 wide; captured 390×872, as the markup says | Recap. The frame shows the top 390×844; if the capture's height isn't 1100, change `height="1100"` on its `<img>` |
| `host-v1.webp`, `host-v1@2x.webp` | 7. `/host?key=…` | 1440×900 | Host |
| `room-queue-v1.webp`, `room-queue-v1@2x.webp` | 8. `/room`, queue mode | 1440×900 | Room view, and the hero's TV frame from 1024px wide |
| `room-lyrics-v1.webp`, `room-lyrics-v1@2x.webp` | 9. `/room`, lyrics mode | 1440×900 | Room view |
| `setup-sharing-v1.webp`, `setup-sharing-v1@2x.webp` | 10. Setup window, "How guests reach you" | 780×560 | Mac |
| `menubar-v1.webp`, `menubar-v1@2x.webp` | 12. Menu-bar panel | markup says 340×460 | Mac. Change `width`/`height` on its `<img>` to the real crop |

Capture 11 (setup window, Player control) has no place on the page; the plan's
Mac section shows only the Sharing step and the panel.

Budgets (plan §6): each below-fold image ≤ 120 KB, the hero room image ≤ 140 KB,
whole page ≤ 900 KB. Run the plan's scrub list on every file before it goes in.

## OG image and touch icon

`npm run og` renders `capture/og.html` to `public/og.jpg` (1200×630) and
`capture/touch-icon.html` to `public/apple-touch-icon.png` (180×180). It needs
Playwright (`npm install`) and ImageMagick's `magick`.

## Deploy

Not yet. First the jam must move off `nimbrung.dezeto.dev` (plan task T0). Then,
from an interactive terminal, never CI, the first time:

1. `npm install`
2. `npx wrangler whoami`: the account that holds the dezeto.dev zone.
3. `npm run deploy`. If wrangler offers to replace a DNS record, stop and check
   the jam has moved.

## Go public (one small commit)

Each place to change has an `AFTER PUBLIC` comment in `public/index.html`:

- the top bar button, the hero button and the status line under it;
- the closing band;
- the footer (MIT licence and source links);
- the build steps under "What you need".

Then `grep -n "isn’t public yet" public/index.html` must find nothing, and every
GitHub link must answer 200 when logged out.
