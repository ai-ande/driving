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
const profChk = $("sProfile"), todSlider = $("sTod"), profLbl = $("vProfile");

const fmtClock = (min) => {
  min = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(min / 60), m = Math.floor(min % 60);
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

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
  c.profileMode = profChk.checked && !!sim.profile;
  todSlider.disabled = !c.profileMode;
  sliders.demand.el.disabled = c.profileMode;
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
profChk.addEventListener("change", () => {
  if (profChk.checked && !sim.profile) { profChk.checked = false; return; }
  if (profChk.checked) sim.cfg.timeOfDay = parseFloat(todSlider.value);
  applyCfg("profile");
});
let todDragging = false;
todSlider.addEventListener("pointerdown", () => { todDragging = true; });
todSlider.addEventListener("pointerup", () => { todDragging = false; });
todSlider.addEventListener("input", () => {
  sim.cfg.timeOfDay = parseFloat(todSlider.value);
  settledAt = sim.t;
});

/* ---------- URL hash state ---------- */
function writeHash() {
  clearTimeout(writeHash.t);
  writeHash.t = setTimeout(() => {
    const c = sim.cfg;
    const h = ["r" + c.react, "g" + c.gap, "a" + c.accel, "n" + c.antic, "m" + c.mix,
               "c" + c.cycle, "s" + c.split, "w" + (c.wave ? 1 : 0), "v" + waveSpd.value,
               "d" + c.demand, "p" + (c.profileMode ? 1 : 0),
               "t" + Math.round(c.timeOfDay)].join("_");
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
  if (m.p === 1) {
    profChk.checked = true;
    if ("t" in m) { todSlider.value = m.t; sim.cfg.timeOfDay = m.t; }
  }
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
  // measured-weekday replay: sync slider to advancing clock, show rates + validation chip
  if (sim.cfg.profileMode && sim.profile) {
    if (!todDragging) todSlider.value = sim.cfg.timeOfDay;
    const nb = Math.round(sim.profileValue(sim.profile.nbVeh, sim.cfg.timeOfDay));
    const sb = Math.round(sim.profileValue(sim.profile.sbVeh, sim.cfg.timeOfDay));
    profLbl.textContent = `${fmtClock(sim.cfg.timeOfDay)} · NB ${nb} / SB ${sb} veh/h`;
    const mNB = sim.measuredBridgeMph("NB"), mSB = sim.measuredBridgeMph("SB");
    const sNB = sim.simBridgeMph("NB"), sSB = sim.simBridgeMph("SB");
    const f = (v) => v == null ? "–" : Math.round(v);
    $("bridgeChip").textContent =
      `Speed at the bridge — sim: ${f(sNB)} / ${f(sSB)} mph · measured 2019: ${f(mNB)} / ${f(mSB)} (NB/SB)`;
  } else {
    profLbl.textContent = sim.profile ? "off" : "data unavailable";
    $("bridgeChip").textContent = "";
  }
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
  $("clock").textContent = (ff ? "⏩ " : "") +
    (sim.cfg.profileMode ? fmtClock(sim.cfg.timeOfDay) : fmtTime(sim.t));
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* ---------- intersection info card (real signal records + live cameras) ---------- */
const card = $("infocard"), cardTitle = $("cardTitle"), cardBody = $("cardBody");
let camTimer = null;
function closeCard() {
  card.hidden = true;
  R.selectedKey = null;
  if (camTimer) { clearInterval(camTimer); camTimer = null; }
}
$("cardClose").addEventListener("click", closeCard);
function openCard(key, px, py) {
  const it = sim.geo.intersections.find(i => i.key === key);
  const meta = (typeof AUSTIN_META !== "undefined" && AUSTIN_META.intersections[key]) || {};
  R.selectedKey = key;
  cardTitle.textContent = it.name + " & Lamar";
  const rows = [];
  if (it.bridge) {
    rows.push(`<div class="row"><b>Grade-separated:</b> ${it.name} passes <b>over</b> Lamar on a bridge — no signal, no conflict. (Found via OSM bridge tags; confirmed by the city signal registry.)</div>`);
  } else if (!it.signalized) {
    rows.push(`<div class="row"><b>No traffic signal here</b> — verified against the City of Austin signal registry.</div>`);
  }
  if (meta.signalId && !it.bridge && it.signalized) {
    rows.push(`<div class="row">City signal <b>#${meta.signalId}</b> — ${meta.signalName}</div>`);
    if (meta.zone) rows.push(`<div class="row">Retiming corridor: <b>${meta.zone}</b>${meta.retimedFY ? ` · last retimed FY${meta.retimedFY}` : ""}${meta.retimedDate ? ` (${meta.retimedDate})` : ""}</div>`);
    rows.push(`<div class="row">Leading pedestrian interval: <b>${meta.lpi ? "yes" : "no"}</b></div>`);
  } else if (meta.signalId && meta.signalDist > 120) {
    rows.push(`<div class="row">Nearest city signal: #${meta.signalId} ${meta.signalName} (~${meta.signalDist} m away)</div>`);
  }
  if (meta.camera) {
    rows.push(`<img id="camImg" alt="live camera" src="${meta.camera.url}?t=${Date.now()}">` +
      `<div class="camcap">LIVE · City of Austin camera #${meta.camera.id} — ${meta.camera.name}` +
      ` <a href="${meta.camera.url}" target="_blank" rel="noopener">open</a></div>`);
  } else {
    rows.push(`<div class="row dim">No city camera at this corner.</div>`);
  }
  rows.push(`<div class="row dim" style="margin-top:6px">Sources: City of Austin open data (signals, retiming, cameras)</div>`);
  cardBody.innerHTML = rows.join("");
  card.hidden = false;
  const r = card.getBoundingClientRect();
  card.style.left = Math.min(Math.max(8, px + 18), window.innerWidth - r.width - 12) + "px";
  card.style.top = Math.min(Math.max(60, py - 40), window.innerHeight - r.height - 12) + "px";
  if (camTimer) clearInterval(camTimer);
  if (meta.camera) {
    camTimer = setInterval(() => {
      const img = $("camImg");
      if (img) img.src = meta.camera.url + "?t=" + Date.now();
    }, 5000);
  }
}
let downAt = null;
map.addEventListener("pointerdown", (e) => { downAt = { x: e.clientX, y: e.clientY }; });
map.addEventListener("pointerup", (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) return;
  const r = map.getBoundingClientRect();
  const px = e.clientX - r.left, py = e.clientY - r.top;
  let best = null, bd = 1e9;
  for (const it of sim.geo.intersections) {
    const d = Math.hypot(R.sx(it.x) - px, R.sy(it.y) - py);
    if (d < bd) { bd = d; best = it; }
  }
  if (typeof AUSTIN_META !== "undefined") {
    for (const [key, m] of Object.entries(AUSTIN_META.intersections)) {
      if (!m.camera) continue;
      const d = Math.hypot(R.sx(m.camera.x) - px, R.sy(m.camera.y) - py);
      if (d < bd) { bd = d; best = sim.geo.intersections.find(i => i.key === key); }
    }
  }
  if (best && bd < 18) openCard(best.key, e.clientX, e.clientY);
  else closeCard();
});

/* ---------- optional live speeds (TomTom Flow Segment Data) ---------- */
const ttKey = $("ttKey"), ttOut = $("ttOut");
ttKey.value = localStorage.getItem("tomtomKey") || "";
$("ttGo").addEventListener("click", async () => {
  const key = ttKey.value.trim();
  if (!key) { ttOut.innerHTML = `<span class="err">Paste a TomTom API key first (free at developer.tomtom.com).</span>`; return; }
  localStorage.setItem("tomtomKey", key);
  ttOut.textContent = "Fetching live segments…";
  const ref = sim.geo.ref;
  const pts = [0.18, 0.38, 0.55, 0.72, 0.9].map(f => {
    const p = sim.lamarPath.at(f * sim.lamarPath.len);
    return [ref.lat + p.y / 110950, ref.lon + p.x / (111320 * Math.cos(ref.lat * Math.PI / 180))];
  });
  try {
    const res = await Promise.all(pts.map(([la, lo]) =>
      fetch(`https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json?point=${la.toFixed(6)},${lo.toFixed(6)}&unit=MPH&key=${encodeURIComponent(key)}`)
        .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })));
    const cur = res.map(r => r.flowSegmentData.currentSpeed);
    const ff = res.map(r => r.flowSegmentData.freeFlowSpeed);
    const avg = (a) => Math.round(a.reduce((s, v) => s + v, 0) / a.length);
    const m = sim.metrics();
    const simMph = isNaN(m.NB.time) ? null :
      Math.round((sim.measureNB.s1 - sim.measureNB.s0) / m.NB.time * 2.23694);
    ttOut.innerHTML = `Lamar right now (TomTom): <b>${avg(cur)} mph</b> · free-flow ${avg(ff)} mph` +
      (simMph ? ` — sim northbound: <b>${simMph} mph</b>` : "") +
      ` <span class="dim">(${new Date().toLocaleTimeString()})</span>`;
  } catch (err) {
    ttOut.innerHTML = `<span class="err">Live fetch failed (${err.message}). Check the key — or the daily free quota.</span>`;
  }
});
