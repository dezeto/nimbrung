// The page works without this file. It adds the two moments: reactions over
// the hero's artwork, and the QR turning into the join screen. Only transform
// and opacity move. Under Reduce Motion nothing moves; taps fade in and out.
const root = document.documentElement;
const still = matchMedia("(prefers-reduced-motion: reduce)");
const motion = !still.matches;
root.classList.add("js");
if (motion) root.classList.add("motion");

// A capture that isn't there yet keeps its frame and hides the image.
for (const img of document.querySelectorAll(".shot-img")) {
  const missing = () => img.closest(".shot")?.classList.add("is-missing");
  if (img.complete && img.naturalWidth === 0 && img.currentSrc) missing();
  else img.addEventListener("error", missing, { once: true });
}

// ===== Moment 1: reactions float over the artwork =====
const mock = document.querySelector(".mock");
const stage = mock?.querySelector(".mock-stage");
const art = mock?.querySelector(".mock-art");
const GUESTS = ["Rina", "Bima", "Sari", "Dewi", "Putri", "Yoga", "Andi"];
const MAX_ON_SCREEN = 8;
let heroVisible = false;
let timer = 0;

function float(emoji, name, fromX) {
  if (!stage || stage.querySelectorAll(".is-live").length >= MAX_ON_SCREEN) return;
  const el = document.createElement("span");
  el.className = "float-reaction is-live";
  el.textContent = emoji;
  const chip = document.createElement("span");
  chip.textContent = name;
  el.append(chip);
  stage.append(el);
  // Start over the bottom of the art: 120px up, a small sway, scale 0.6 → 1 → 0.9.
  const x = fromX - el.offsetWidth / 2;
  const y = art.offsetTop + art.offsetHeight - el.offsetHeight + 20;
  const sway = (Math.random() < 0.5 ? -1 : 1) * 12;
  const at = (dx, dy, s) => `translate(${x + dx}px, ${y + dy}px) scale(${s})`;
  const frames = motion
    ? [
        { transform: at(0, 0, 0.6), opacity: 0 },
        { transform: at(sway / 2, -24, 1), opacity: 1, offset: 0.18 },
        { transform: at(-sway, -72, 1), opacity: 1, offset: 0.6 },
        { transform: at(sway, -120, 0.9), opacity: 0 },
      ]
    : [
        { transform: at(0, -60, 1), opacity: 0 },
        { transform: at(0, -60, 1), opacity: 1, offset: 0.2 },
        { transform: at(0, -60, 1), opacity: 1, offset: 0.7 },
        { transform: at(0, -60, 1), opacity: 0 },
      ];
  el.animate(frames, { duration: 2400, easing: "linear", fill: "forwards" }).finished.then(
    () => el.remove(),
    () => el.remove(),
  );
}

const buttons = mock ? [...mock.querySelectorAll(".mock-reacts .react")] : [];
const centreOf = (btn) => btn.offsetLeft + btn.offsetWidth / 2;
const pick = (list) => list[Math.floor(Math.random() * list.length)];

function someoneReacts(btn = pick(buttons), name = pick(GUESTS)) {
  float(btn.dataset.r, name, centreOf(btn) + (Math.random() * 24 - 12));
}

// The first burst: five different reactions from five different guests.
const shuffled = (list) => list.map((v) => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map((p) => p[1]);

function loop() {
  clearTimeout(timer);
  if (!heroVisible || document.hidden) return;
  timer = setTimeout(() => {
    someoneReacts();
    loop();
  }, 6000 + Math.random() * 3000);
}

for (const btn of buttons) {
  btn.addEventListener("click", () => float(btn.dataset.r, "You", centreOf(btn)));
}

if (mock && motion) {
  let burst = false;
  new IntersectionObserver(
    ([entry]) => {
      heroVisible = entry.isIntersecting;
      if (heroVisible && !burst) {
        burst = true;
        const who = shuffled(GUESTS);
        shuffled(buttons).slice(0, 5).forEach((btn, i) => setTimeout(() => someoneReacts(btn, who[i]), 200 + i * 340));
      }
      loop();
    },
    { threshold: 0.3 },
  ).observe(mock);
  document.addEventListener("visibilitychange", loop);
}

// ===== Moment 2: the QR turns into the join screen, once =====
const moment = document.querySelector(".moment");
const again = moment?.querySelector(".qr-again");

if (moment && motion) {
  const io = new IntersectionObserver(
    ([entry]) => {
      if (!entry.isIntersecting) return;
      io.disconnect();
      moment.classList.add("is-joined", "is-played");
    },
    { threshold: 0.5 },
  );
  io.observe(moment.querySelector(".moment-stage"));

  // The QR stays useful: one button brings it back, and the join screen again.
  again?.addEventListener("click", () => {
    const showQr = !moment.classList.toggle("is-joined");
    again.textContent = showQr ? "Show the join screen" : "Show the QR code";
  });
}
