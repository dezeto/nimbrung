// The page works without this file: every step reads in full and the device
// shows the join screen. With it, the step nearest the reading line lights up
// and swaps the device's screen; the last step turns the phone into the TV.
document.documentElement.classList.add("js");

const device = document.querySelector(".story-device");
const steps = [...document.querySelectorAll(".story-steps > li")];
const screens = device ? [...device.querySelectorAll("img")] : [];
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
