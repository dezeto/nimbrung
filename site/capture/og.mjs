// Renders capture/og.html to public/og.jpg (1200×630) and capture/touch-icon.html
// to public/apple-touch-icon.png (180×180). Needs `npm install` (playwright) and,
// for the JPEG, ImageMagick's `magick` on PATH.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const browser = await chromium.launch();

const og = await browser.newPage({ viewport: { width: 1200, height: 630 }, colorScheme: "dark" });
await og.goto("file://" + here("./og.html"));
await og.evaluate(() => document.fonts.ready);
await og.screenshot({ path: here("./og.png") });

const icon = await browser.newPage({ viewport: { width: 180, height: 180 } });
await icon.goto("file://" + here("./touch-icon.html"));
await icon.screenshot({ path: here("../public/apple-touch-icon.png") });

await browser.close();
execFileSync("magick", [here("./og.png"), "-strip", "-quality", "84", "-sampling-factor", "4:2:0", here("../public/og.jpg")]);
execFileSync("rm", [here("./og.png")]);
console.log("wrote public/og.jpg and public/apple-touch-icon.png");
