/* UI wiring, presets, main loop. */
"use strict";

const sim = new Sim(GEO);
const map = document.getElementById("map");
const R = new Renderer(map, sim);
const tsd = new TSD(document.getElementById("tsd"), sim);

/* ---------- presets ---------- */
// presets change behavior + signal plan; demand is left where the user set it
const PRESETS = {
  today:   { react: 1.4, gap: 1.6, accel: 1.6, antic: 0.15, mix: 0, cycle: 90, split: 0.55, wave: false, waveMph: 30 },
  trained: { react: 0.3, gap: 1.0, accel: 2.2, antic: 0.90, mix: 1, cycle: 90, split: 0.55, wave: false, waveMph: 30 },
  city:    { react: 0.3, gap: 1.0, accel: 2.2, antic: 0.90, mix: 1, cycle: 90, split: 0.55, wave: true,  waveMph: 30 },
};

const $ = (id) => document.getElementById(id);
const sliders = {
  react:  { el: $("sReact"),  lbl: $("vReact"),  fmt: v => v.toFixed(2) + " s" },
  gap:    { el: $("sGap"),    lbl: $("vGap"),    fmt: v => v.toFixed(2) + " s" },
  accel:  { el: $("sAccel"),  lbl: $("vAccel"),  fmt: v => v.toFixed(1) + " m/s²" },
  antic:  { el: $("sAntic"),  lbl: $("vAntic"),  fmt: v => Math.round(v * 100) + "%" },
  mix:    { el: $("sMix"),    lbl: $("vMix"),    fmt: v => Math.round(v * 100) + "%" },
  cycle:  { el: $("sCycle"),  lbl: $("vCycle"),  fmt: v => Math.round(v) + " s" },
  split:  { el: $("sSplit"),  lbl: $("vSplit"),  fmt: v => Math.round(v * 100) + "%" },
  demand: { el: $("sDemand"), lbl: $("vDemand"), fmt: v => v.toFixed(2) + "×" },
};
const waveChk = $("sWave"), waveSpd = $("sWaveSpd"), waveLbl = $("vWave");

let settledAt = 0;
function applyCfg(from) {
  const c = sim.cfg;
  for (const [k, s] of Object.entries(sliders)) {
    c[k] = parseFloat(s.el.value);
    s.lbl.textContent = s.fmt(c[k]);
  }
  c.wave = waveChk.checked;
  c.waveSpeed = parseFloat(waveSpd.value) * 0.44704;
  waveLbl.textContent = c.wave ? Math.round(parseFloat(waveSpd.value)) + " mph" : "off";
  waveSpd.disabled = !c.wave;
  sim.retime();
  sim.applyDriverParams();
  if (from === "mix") sim.remix();
  if (from !== "init") { settledAt = sim.t; writeHash(); }
}
function setSliders(p) {
  for (const [k, s] of Object.entries(sliders)) if (k in p) s.el.value = p[k];
  waveChk.checked = p.wave;
  waveSpd.value = p.waveMph;
}
function activatePreset(name) {
  document.querySelectorAll(".preset").forEach(b => b.classList.remove("active"));
  if (name) {
    const btn = { today: "presetToday", trained: "presetTrained", city: "presetCity" }[name];
    $(btn).classList.add("active");
  }
}
for (const name of ["today", "trained", "city"]) {
  $({ today: "presetToday", trained: "presetTrained", city: "presetCity" }[name])
    .addEventListener("click", () => {
      setSliders(PRESETS[name]);
      sim.cfg.mix = PRESETS[name].mix;
      applyCfg("mix");
      activatePreset(name);
    });
}
for (const [k, s] of Object.entries(sliders))
  s.el.addEventListener("input", () => { applyCfg(k); activatePreset(null); });
waveChk.addEventListener("change", () => { applyCfg("wave"); activatePreset(null); });
waveSpd.addEventListener("input", () => { applyCfg("wave"); activatePreset(null); });

/* ---------- URL hash state ---------- */
function writeHash() {
  clearTimeout(writeHash.t);
  writeHash.t = setTimeout(() => {
    const c = sim.cfg;
    const h = ["r" + c.react, "g" + c.gap, "a" + c.accel, "n" + c.antic, "m" + c.mix,
               "c" + c.cycle, "s" + c.split, "w" + (c.wave ? 1 : 0), "v" + waveSpd.value,
               "d" + c.demand].join("_");
    history.replaceState(null, "", "#" + h);
  }, 300);
}
function readHash() {
  if (!location.hash) return false;
  const m = {};
  for (const part of location.hash.slice(1).split("_")) {
    const v = parseFloat(part.slice(1));
    if (!isNaN(v)) m[part[0]] = v;
  }
  if (!("r" in m)) return false;
  setSliders({ react: m.r, gap: m.g, accel: m.a, antic: m.n, mix: m.m,
               cycle: m.c, split: m.s, wave: m.w === 1, waveMph: m.v, demand: m.d });
  return true;
}

/* ---------- sim controls ---------- */
let speed = 2, paused = false;
document.querySelectorAll("#speeds button").forEach(b =>
  b.addEventListener("click", () => {
    speed = parseInt(b.dataset.speed, 10);
    document.querySelectorAll("#speeds button").forEach(x => x.classList.toggle("active", x === b));
    if (paused) togglePause();
  }));
const pauseBtn = $("pause");
function togglePause() {
  paused = !paused;
  pauseBtn.textContent = paused ? "▶" : "⏸";
}
pauseBtn.addEventListener("click", togglePause);
$("reset").addEventListener("click", () => { sim.reset(); baseline = null; renderBaseline(); ffUntil = 400; });

/* ---------- views / zoom / pan ---------- */
const VIEWS = {
  full:     [-880, -1290, 860, 1440],
  downtown: [-480, -520, 700, 1260],
  fifth:    [-380, -140, 320, 330],
};
let currentView = "full";
function setView(name) {
  currentView = name;
  R.fit(...VIEWS[name]);
  document.querySelectorAll("#views button").forEach(b => b.classList.toggle("active", b.dataset.view === name));
}
document.querySelectorAll("#views button").forEach(b =>
  b.addEventListener("click", () => setView(b.dataset.view)));

map.addEventListener("wheel", (e) => {
  e.preventDefault();
  const r = map.getBoundingClientRect();
  R.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0016));
  currentView = null;
  document.querySelectorAll("#views button").forEach(b => b.classList.remove("active"));
}, { passive: false });
let drag = null;
map.addEventListener("pointerdown", (e) => {
  drag = { x: e.clientX, y: e.clientY };
  map.classList.add("dragging");
  map.setPointerCapture(e.pointerId);
});
map.addEventListener("pointermove", (e) => {
  if (!drag) return;
  R.view.tx += e.clientX - drag.x;
  R.view.ty += e.clientY - drag.y;
  drag = { x: e.clientX, y: e.clientY };
  currentView = null;
});
map.addEventListener("pointerup", () => { drag = null; map.classList.remove("dragging"); });

$("tstoggle").addEventListener("click", () => {
  const w = $("tswrap");
  w.classList.toggle("collapsed");
  $("tstoggle").textContent = w.classList.contains("collapsed") ? "show" : "hide";
});

/* ---------- metrics DOM ---------- */
let baseline = null;
$("pin").addEventListener("click", () => {
  const m = sim.metrics();
  baseline = { thru: m.NB.thru, time: m.NB.time, stops: m.NB.stops };
  renderBaseline();
});
const fmtTime = (s) => isNaN(s) ? "–" : Math.floor(s / 60) + ":" + String(Math.round(s % 60)).padStart(2, "0");
function renderBaseline() {
  const ids = [["bThru", "thru"], ["bTime", "time"], ["bStops", "stops"]];
  for (const [id] of ids) { $(id).textContent = ""; $(id).className = "base"; }
  if (!baseline) return;
  const m = sim.metrics();
  $("bThru").textContent = "was " + baseline.thru;
  $("bTime").textContent = "was " + fmtTime(baseline.time);
  $("bStops").textContent = "was " + (isNaN(baseline.stops) ? "–" : baseline.stops.toFixed(1));
}
function updateMetrics() {
  const m = sim.metrics();
  $("mThru").textContent = m.NB.thru;
  $("mTime").textContent = fmtTime(m.NB.time);
  $("mStops").textContent = isNaN(m.NB.stops) ? "–" : m.NB.stops.toFixed(1);
  $("ffnote").textContent = "(free-flow " + fmtTime(m.freeFlow) + ")";
  $("mThruS").textContent = m.SB.thru;
  $("mTimeS").textContent = fmtTime(m.SB.time);
  $("mStopsS").textContent = isNaN(m.SB.stops) ? "–" : m.SB.stops.toFixed(1);
  $("mThruX").textContent = m.cross;
  $("mCars").textContent = m.cars;
  $("spill").textContent = m.outside > 4 ? "⚠ " + m.outside + " cars backed up beyond the map edge" : "";
  const settling = sim.t - settledAt < 90 && settledAt > 0;
  document.querySelector(".scorehead h2").textContent = "Northbound Lamar" + (settling ? " (settling…)" : "");
  if (baseline) {
    const d = (a, b, lowerBetter) => {
      if (isNaN(a) || isNaN(b) || b === 0) return "";
      const pct = Math.round((a / b - 1) * 100);
      const good = lowerBetter ? pct < 0 : pct > 0;
      return { txt: (pct >= 0 ? "+" : "") + pct + "%", cls: good ? "good" : "bad" };
    };
    const m2 = sim.metrics();
    const rows = [["bThru", m2.NB.thru, baseline.thru, false, baseline.thru],
                  ["bTime", m2.NB.time, baseline.time, true, fmtTime(baseline.time)],
                  ["bStops", m2.NB.stops, baseline.stops, true, isNaN(baseline.stops) ? "–" : baseline.stops.toFixed(1)]];
    for (const [id, cur, base, lower, baseTxt] of rows) {
      const dd = d(cur, base, lower);
      $(id).textContent = "was " + baseTxt + (dd ? " (" + dd.txt + ")" : "");
      $(id).className = "base " + (dd ? dd.cls : "");
    }
  }
}

/* ---------- boot & loop ---------- */
let ffUntil = 400; // fast-forward morning traffic to here on boot/reset

if (!readHash()) setSliders(PRESETS.today);
applyCfg("init");
sim.cfg.mix = parseFloat(sliders.mix.el.value);
R.resize();
setView("full");

window.addEventListener("resize", () => {
  R.resize();
  if (currentView) R.fit(...VIEWS[currentView]);
});

let last = performance.now(), acc = 0, metricTimer = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  // self-heal canvas size (first layout, panel resizes, dpi changes)
  const rect = map.getBoundingClientRect();
  if (Math.abs(rect.width - R.w) > 1 || Math.abs(rect.height - R.h) > 1) {
    R.resize();
    if (currentView) R.fit(...VIEWS[currentView]);
  }
  const ff = sim.t < ffUntil;
  if (!paused) {
    acc += dt * (ff ? 60 : speed);
    const h = 1 / 30;
    let steps = 0;
    const maxSteps = ff ? 320 : 40 * speed;
    while (acc >= h && steps < maxSteps) {
      sim.step(h);
      tsd.maybeSample();
      steps++;
      acc -= h;
    }
    acc = Math.min(acc, 0.5);
  }
  R.draw();
  tsd.blit();
  metricTimer += dt;
  if (metricTimer > 0.33) { updateMetrics(); metricTimer = 0; }
  $("clock").textContent = (ff ? "⏩ " : "") + fmtTime(sim.t);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
