# Nimbrung site

The product page for `nimbrung.dezeto.dev`: static HTML, CSS and one small JS
file, served by Workers static assets. No build step. Only `public/` is deployed.

## Edit

Three parts: the hero (the host page on the laptop and the guest queue on a
phone, with reactions rising behind the title), the story (four steps; the
device pins while they scroll, each step swaps its screen, and the last turns
the phone into the TV), and the closing call. Everything else lives in the repo README.

- Copy: `public/index.html`. Every claim has a `src:` comment beside it. Change
  a claim only after checking the file it cites.
- Look: `public/site.css` alone: the app's flat ground (dark, or bright-room light), hairlines
  between sections, red for the one filled action. `public/tokens.css` and
  `public/glass.css` are only for `404.html` now.
- The story's scrolling: `public/site.js`. Without it every step reads in full
  and the device shows the join screen. Under Reduce Motion the device snaps
  to the TV instead of growing.
- Short links in `public/_redirects`: `/pear` (pear-desktop's latest release)
  and `/download` (the latest Nimbrung.zip), for places that can't hold a link,
  like the GitHub description.
- The CSP in `public/_headers` allows no inline styles or scripts: no `style=""`
  attributes, no `<script>` bodies.

Check locally with `npm install && npm run dev` (wrangler, port 8788), or any
static server pointed at `public/` (that one won't apply `_headers` or serve
`404.html` for misses).

## Screenshots

Every picture is a capture of the real app on a demo jam: `capture/shoot.mjs`
(its header says how to start the demo) writes them to `public/img/` as WebP,
1× and `@2x`. The page uses `queue-dark`/`queue-light` (hero), `join`,
`search`, `lyrics` and `room-queue` (story). The others (`host`, `recap`,
`room-lyrics`) aren't on the page now; `/img/*` is cached as immutable, so give
a changed capture a new version (`-v5` next) when it changes.

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

## Public

The page now links to the public repo. After the repo turns public, every
GitHub link in `public/index.html` must answer 200 when logged out:

```sh
grep -o 'https://github.com/[^"#]*' public/index.html | sort -u | xargs -n1 curl -so /dev/null -w '%{http_code} %{url}\n'
```
