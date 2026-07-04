/* The Ring: phantom traffic jams on a circular road, and jam-absorbing drivers. */
"use strict";

const RING_LEN = 400;           // meters of road
const LIMIT = 20.1;             // 45 mph
const CAR_LEN = 4.6;

const cfg = { n: 28, trained: 0, lag: 0.9, gap: 1.15, noise: 0.3 };
// trained-driver car-following — parameters found by stability scan: crisp
// response (high aMax) + generous cushion (T) + gentle planned braking (bComf)
// is string-stable at ring densities; sluggish response is what amplifies waves.
// When trained drivers are a small minority they drive as ABSORBERS: a much
// larger dynamic cushion (Tabsorb) that swallows a whole wave (Beaty's move).
const TRAINED_P = { T: 1.5, Tabsorb: 4.0, aMax: 2.4, bComf: 1.0, ema: 1.5, look2: 3 };

let rng = LAB.mulberry32(42);
let cars = [];
let simT = 0;
let brakeEvents = [];           // timestamps

function build() {
  rng = LAB.mulberry32(42);
  cars = [];
  simT = 0;
  brakeEvents = [];
  for (let i = 0; i < cfg.n; i++) {
    cars.push({
      s: (RING_LEN / cfg.n) * i,
      v: 12 + rng() * 2,
      vPerc: 13,                    // lagged perception of leader speed
      j: rng() * 2 - 1,
      noisePhase: rng() * 100,
      trained: false,
      a: 0, braking: false, brakeDebounce: 0,
    });
  }
  applyTrained();
}

function applyTrained() {
  // trained drivers spread evenly around the ring for maximum absorption
  cars.forEach(c => c.trained = false);
  const stride = cfg.n / Math.max(cfg.trained, 1);
  for (let k = 0; k < cfg.trained; k++) cars[Math.round(k * stride) % cfg.n].trained = true;
}

function step(dt) {
  const n = cars.length;
  for (let i = 0; i < n; i++) {
    const c = cars[i];
    const lead = cars[(i + 1) % n];
    const lead2 = cars[(i + 2) % n];
    let gap = lead.s - CAR_LEN - c.s;
    if (gap < -CAR_LEN) gap += RING_LEN;
    else if (i === n - 1) gap += RING_LEN; // wrap for the last->first pair
    gap = ((gap % RING_LEN) + RING_LEN) % RING_LEN;

    let a;
    if (c.trained) {
      // jam absorber (Beaty / Stern spirit): no lag, no noise, smoothed leader
      // speed, two-car lookahead, generous cushion, gentle hands. String-stable
      // IDM — waves shrink as they pass through instead of amplifying.
      c.emaLead = c.emaLead ?? lead.v;
      c.emaLead += (lead.v - c.emaLead) * (dt / TRAINED_P.ema);  // ignore leader jitter
      // watch for oscillation ahead: slow EMA + variance of the leader's speed
      c.slowLead = c.slowLead ?? lead.v;
      c.slowLead += (lead.v - c.slowLead) * (dt / 20);
      c.varLead = c.varLead ?? 0;
      c.varLead += ((lead.v - c.slowLead) ** 2 - c.varLead) * (dt / 20);
      const sigma = Math.sqrt(c.varLead);
      const vlEff = Math.min(c.emaLead, lead2.v + TRAINED_P.look2); // see beyond the leader
      // cushion widens ONLY when a wave is actually breathing ahead, and more so
      // when trained drivers are scarce (they must absorb alone)
      const scarcity = Math.max(0, 1 - 3 * (cfg.trained / n));
      const absorbNeed = Math.min(1, sigma / 2.5);
      const Teff = TRAINED_P.T + (TRAINED_P.Tabsorb - TRAINED_P.T) * scarcity * absorbNeed;
      a = LAB.idm({ v: c.v, v0: LIMIT, vl: vlEff, gap,
                    T: Teff, aMax: TRAINED_P.aMax, bComf: TRAINED_P.bComf });
      // opening a cushion is done by easing, never by braking into smooth traffic
      const urgent = gap < 2 + c.v * 1.0;
      if (!urgent && a < -0.35) a = -0.35;
    } else {
      // human: lagged view of the leader + bursts of speed-keeping noise
      c.vPerc += (lead.v - c.vPerc) * (dt / Math.max(cfg.lag, 0.05));
      const envelope = Math.sin(simT * 0.21 + c.noisePhase * 3);
      const wobble = envelope > 0.35
        ? cfg.noise * 0.8 * Math.sin(simT * 0.9 + c.noisePhase * 7)
        : 0;
      a = LAB.idm({ v: c.v, v0: LIMIT * (1 + 0.06 * c.j), vl: c.vPerc, gap,
                    T: Math.max(0.6, cfg.gap * (1 + 0.2 * c.j)), aMax: 1.35, bComf: 1.9 });
      a += wobble;
    }
    c.a = Math.max(-8, Math.min(a, 2.5));
  }
  for (const c of cars) {
    c.v = Math.max(0, c.v + c.a * dt);
    c.s = (c.s + c.v * dt) % RING_LEN;
    const braking = c.a < -1.5 && c.v > 1.5;
    if (braking && c.brakeDebounce <= 0) { brakeEvents.push(simT); c.brakeDebounce = 2; }
    c.brakeDebounce -= dt;
    c.braking = c.a < -1.0;
  }
  // hard no-overlap guard
  const order = [...cars].sort((a, b) => a.s - b.s);
  for (let i = 0; i < order.length; i++) {
    const c = order[i], lead = order[(i + 1) % order.length];
    let rear = lead.s - CAR_LEN;
    if (i === order.length - 1) rear += RING_LEN;
    if (c.s > rear - 0.2) { c.s = ((rear - 0.2) % RING_LEN + RING_LEN) % RING_LEN; c.v = Math.min(c.v, lead.v); }
  }
  simT += dt;
  while (brakeEvents.length && brakeEvents[0] < simT - 60) brakeEvents.shift();
}

function metrics() {
  const vs = cars.map(c => c.v);
  const avg = vs.reduce((s, v) => s + v, 0) / vs.length;
  const min = Math.min(...vs), max = Math.max(...vs);
  // waves: contiguous clusters running well below the current mean flow
  const thresh = Math.min(4, 0.45 * avg);
  let waves = 0;
  const bySlot = [...cars].sort((a, b) => a.s - b.s).map(c => c.v < thresh);
  for (let i = 0; i < bySlot.length; i++) if (bySlot[i] && !bySlot[(i - 1 + bySlot.length) % bySlot.length]) waves++;
  return { avg, min, max, waves,
           brakesPerMin: brakeEvents.length * (60 / Math.min(60, Math.max(simT, 10))) / cars.length };
}

/* ---------- render ---------- */
const cv = document.getElementById("ring");
const ctx = cv.getContext("2d");
const tsd = new LAB.Strip(document.getElementById("tsd"), {
  rows: [{ y: 0.985, label: "start line" }],
  gutter: 64,
  axisLeft: "\u2190 ~4 min ago", axisRight: "now \u2192",
});
let lastSample = 0;

function render() {
  const dpr = window.devicePixelRatio || 1;
  const r = cv.getBoundingClientRect();
  if (r.width < 80 || r.height < 80) return; // layout not ready
  if (cv.width !== Math.round(r.width * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, r.width, r.height);
  const cx = r.width / 2, cy = r.height / 2 - 6;
  const R = Math.min(r.width, r.height) * 0.40;
  // road
  ctx.strokeStyle = "#c9c4b6";
  ctx.lineWidth = 30;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke();
  ctx.strokeStyle = "#e9e5da";
  ctx.lineWidth = 26;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke();
  ctx.setLineDash([6, 9]);
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, R + 8, 0, 7); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, R - 8, 0, 7); ctx.stroke();
  ctx.setLineDash([]);
  // direction arrow
  ctx.fillStyle = "#8a8577";
  ctx.font = "11px -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("→ traffic flows counter-clockwise", cx, cy - R - 26);
  // cars
  const pxPerM = (2 * Math.PI * R) / RING_LEN;
  for (const c of cars) {
    const th = (c.s / RING_LEN) * 2 * Math.PI;
    const x = cx + R * Math.cos(th), y = cy - R * Math.sin(th);
    const ang = -(th + Math.PI / 2);
    LAB.drawCar(ctx, x, y, ang, Math.max(CAR_LEN * pxPerM, 6), Math.max(2.2 * pxPerM, 4),
      c.v, LIMIT, { braking: c.braking, dot: c.trained ? "#fff" : null });
  }
}

/* ---------- UI ---------- */
LAB.bindSliders({
  n: { id: "sN", lbl: "vN", fmt: v => Math.round(v) + "", onchange: () => { cfg.trained = Math.min(cfg.trained, cfg.n); document.getElementById("sTrained").value = cfg.trained; document.getElementById("sTrained").max = cfg.n; build(); setPreset(null); } },
  trained: { id: "sTrained", lbl: "vTrained", fmt: v => Math.round(v) + " of " + cfg.n, onchange: () => { applyTrained(); setPreset(null); } },
  lag: { id: "sLag", lbl: "vLag", fmt: v => v.toFixed(2) + " s" },
  gap: { id: "sGap", lbl: "vGap", fmt: v => v.toFixed(2) + " s" },
  noise: { id: "sNoise", lbl: "vNoise", fmt: v => Math.round(v * 100) + "%" },
}, cfg);

function setPreset(id) {
  document.querySelectorAll(".preset").forEach(b => b.classList.remove("active"));
  if (id) document.getElementById(id).classList.add("active");
}
document.getElementById("pToday").addEventListener("click", () => {
  cfg.trained = 0; document.getElementById("sTrained").value = 0; document.getElementById("vTrained").textContent = "0 of " + cfg.n;
  applyTrained(); setPreset("pToday");
});
document.getElementById("pOne").addEventListener("click", () => {
  cfg.trained = 1; document.getElementById("sTrained").value = 1; document.getElementById("vTrained").textContent = "1 of " + cfg.n;
  applyTrained(); setPreset("pOne");
});
document.getElementById("pAll").addEventListener("click", () => {
  cfg.trained = cfg.n; document.getElementById("sTrained").value = cfg.n; document.getElementById("vTrained").textContent = cfg.n + " of " + cfg.n;
  applyTrained(); setPreset("pAll");
});

let speed = 2, paused = false;
document.querySelectorAll("#speeds button").forEach(b => b.addEventListener("click", () => {
  speed = parseInt(b.dataset.speed, 10);
  document.querySelectorAll("#speeds button").forEach(x => x.classList.toggle("active", x === b));
}));
document.getElementById("pause").addEventListener("click", () => {
  paused = !paused;
  document.getElementById("pause").textContent = paused ? "▶" : "⏸";
});
document.getElementById("reset").addEventListener("click", build);
document.getElementById("tstoggle").addEventListener("click", () => {
  const w = document.getElementById("tswrap");
  w.classList.toggle("collapsed");
  document.getElementById("tstoggle").textContent = w.classList.contains("collapsed") ? "show" : "hide";
});

function updateDom() {
  const m = metrics();
  const mph = (v) => Math.round(v * 2.23694);
  document.getElementById("avgSpeed").textContent = mph(m.avg) + " mph";
  document.getElementById("mSpeed").textContent = mph(m.avg);
  document.getElementById("mWaves").textContent = m.waves;
  document.getElementById("mBrakes").textContent = m.brakesPerMin.toFixed(1);
  document.getElementById("mSwing").textContent = mph(m.min) + "–" + mph(m.max) + " mph";
  const flag = document.getElementById("waveflag");
  if (m.waves > 0) { flag.textContent = "☹ stop-and-go wave on the road"; flag.style.color = "#c0392b"; }
  else { flag.textContent = "☺ smooth"; flag.style.color = "#3d9970"; }
  document.getElementById("clock").textContent = LAB.fmtTime(simT);
}

build();
let last = performance.now(), acc = 0, domTimer = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!paused) {
    acc += dt * speed;
    const h = 1 / 30;
    let steps = 0;
    while (acc >= h && steps < 200) {
      step(h);
      if (simT - lastSample >= 0.4) {
        lastSample = simT;
        tsd.column(cars.map(c => c.trained
          ? { y: 1 - c.s / RING_LEN, color: "#fffdf7", size: 2.6, alpha: 1 }
          : { y: 1 - c.s / RING_LEN, color: LAB.speedColor(c.v, LIMIT) }));
      }
      steps++; acc -= h;
    }
    acc = Math.min(acc, 0.4);
  }
  render();
  tsd.blit();
  domTimer += dt;
  if (domTimer > 0.3) { updateDom(); domTimer = 0; }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
