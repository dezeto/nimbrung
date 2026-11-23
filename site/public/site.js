// The page works without this file: every step reads in full and the device
// shows the join screen. With it, the step nearest the reading line lights up
// and swaps the device's screen; the last step turns the phone into the TV.
document.documentElement.classList.add("js");

// The captures come in four colour sets (the playing song's cover tints the app);
// the HTML names indigo, and each visit gets one at random.
// ponytail: the hero's indigo shots are already fetching by now, so a non-indigo
// visit downloads them twice; pick the set in a Worker if that ever matters.
const set = ["indigo", "rose", "ocean", "aurora"][Math.floor(Math.random() * 4)];
if (set !== "indigo") {
  for (const el of document.querySelectorAll('[src*="-v5-indigo"], [srcset*="-v5-indigo"]')) {
    if (el.srcset) el.srcset = el.srcset.replaceAll("-v5-indigo", `-v5-${set}`);
    if (el.getAttribute("src")) el.src = el.getAttribute("src").replaceAll("-v5-indigo", `-v5-${set}`);
  }
}

const device = document.querySelector(".story-device");
const steps = [...document.querySelectorAll(".story-steps > li")];
// The device's screens and the blurred glow behind it, both keyed by data-step
const screens = [...document.querySelectorAll(".story-stage img[data-step]")];
const wide = matchMedia("(min-width: 1024px)");
let current = -1;

function show(step) {
  if (step === current) return;
  current = step;
  steps.forEach((li, i) => li.classList.toggle("is-on", i === step));
  screens.forEach((img) => img.classList.toggle("is-on", Number(img.dataset.step) === step));
  device.classList.toggle("is-tv", step === steps.length - 1);
}

// The reading line: on a laptop, mid-screen beside the device, crossed by the
// step's centre (its words sit there); on a phone, in the strip under the
// pinned device, crossed by the step's top. The last step across it wins.
function update() {
  const line = innerHeight * (wide.matches ? 0.6 : 0.82);
  let step = 0;
  steps.forEach((li, i) => {
    const r = li.getBoundingClientRect();
    if ((wide.matches ? r.top + r.height / 2 : r.top) < line) step = i;
  });
  show(step);
}

if (device && steps.length) {
  let queued = false;
  const onScroll = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      update();
    });
  };
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onScroll);
  update();
}
