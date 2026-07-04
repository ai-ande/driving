/* The Merge: on-ramp behavior — creep & courtesy-brake vs speed-matched zipper. */
"use strict";

const ROAD_LEN = 1800;
const RAMP_JOIN = 700, RAMP_END = 1000;   // acceleration lane alongside lane 1
const LIMIT = 29;                          // 65 mph
const CAR_LEN = 4.6;

const cfg = { match: 0.2, gapAcc: 0.35, polite: 0.6, moveOver: 0.2, main: 1700, ramp: 600 };

let rng = LAB.mulberry32(7);
let cars = [], simT = 0, nextId = 1;
let spawnAcc = { m0: 0, m1: 0, r: 0 };
let events = { thru: [], brakes: [], waits: [], failed: 0 };

function build() {
  rng = LAB.mulberry32(7);
  cars = []; simT = 0; nextId = 1;
  spawnAcc = { m0: 0, m1: 0, r: 0 };
  events = { thru: [], brakes: [], waits: [], failed: 0 };
}

function mkCar(lane, x, v) {
  return {
    id: nextId++, lane, x, v, len: CAR_LEN,
    j: rng() * 2 - 1, pol: rng(), lat: lane, // lat = visual lane position (tweens)
    v0: LIMIT * (0.94 + rng() * 0.12),
    T: Math.max(0.7, 1.3 * (1 + 0.25 * (rng() * 2 - 1))),
    aMax: 1.7, bComf: 2.0,
    bornAt: simT, mergedAt: lane === 2 ? null : simT,
    braking: false, brakeDebounce: 0, stoppedAtEnd: false,
  };
}

function laneCars(l) { return cars.filter(c => (c.lane === l)).sort((a, b) => b.x - a.x); }

function step(dt) {
  // ---- spawns
  spawnAcc.m0 += cfg.main / 2 / 3600 * dt;
  spawnAcc.m1 += cfg.main / 2 / 3600 * dt;
  spawnAcc.r += cfg.ramp / 3600 * dt;
  const lanes = [laneCars(0), laneCars(1), laneCars(2)];
  const trySpawn = (lane, key, v) => {
    if (spawnAcc[key] < 1) return;
    const list = lanes[lane];
    const last = list[list.length - 1];
    if (!last || last.x - last.len > 15) {
      const c = mkCar(lane, 0, v);
      c.v = last ? Math.min(c.v, last.v + 2) : v;
      cars.push(c); list.push(c);
      spawnAcc[key] -= 1;
    }
  };
  trySpawn(0, "m0", 27); trySpawn(1, "m1", 26); trySpawn(2, "r", 15);

  // local mainline speed near the merge zone (what a smart merger matches)
  const zone = lanes[1].filter(c => c.x > RAMP_JOIN - 100 && c.x < RAMP_END + 50);
  const vMainLocal = zone.length ? zone.reduce((s, c) => s + c.v, 0) / zone.length : LIMIT * 0.9;

  // ---- lane changes (evaluated before dynamics)
  // 1) ramp cars merging into lane 1
  for (const c of lanes[2]) {
    if (c.x < RAMP_JOIN || c.x > RAMP_END) continue;
    const desperation = c.stoppedAtEnd ? 0.35 : 0;
    const acc = Math.min(1, cfg.gapAcc + desperation);
    const { lead, lag } = neighbors(lanes[1], c.x);
    const leadGap = lead ? lead.x - lead.len - c.x : 1e9;
    const lagGap = lag ? c.x - c.len - lag.x : 1e9;
    const needLead = 2 + c.v * (0.9 - 0.55 * acc);
    const needLag = 2 + (lag ? lag.v : 0) * (1.0 - 0.62 * acc);
    if (leadGap > needLead && lagGap > needLag) {
      c.lane = 1; c.mergedAt = simT;
      events.waits.push({ t: simT, wait: simT - c.bornAt });
      lanes[1].push(c); lanes[1].sort((a, b) => b.x - a.x);
      lanes[2].splice(lanes[2].indexOf(c), 1);
    }
  }
  // 2) mainline right-lane cars making room by moving left
  for (const c of lanes[1]) {
    if (c.x < RAMP_JOIN - 260 || c.x > RAMP_END - 30) continue;
    if (c.pol > cfg.moveOver) continue;
    const rampNear = lanes[2].some(r => r.x > RAMP_JOIN - 60 && Math.abs(r.x - c.x) < 90);
    if (!rampNear) continue;
    const { lead, lag } = neighbors(lanes[0], c.x);
    const leadGap = lead ? lead.x - lead.len - c.x : 1e9;
    const lagGap = lag ? c.x - c.len - lag.x : 1e9;
    if (leadGap > 4 + c.v * 0.7 && lagGap > 4 + (lag ? lag.v : 0) * 0.7) {
      c.lane = 0;
      lanes[0].push(c); lanes[0].sort((a, b) => b.x - a.x);
      lanes[1].splice(lanes[1].indexOf(c), 1);
    }
  }

  // ---- dynamics
  for (let l = 0; l < 3; l++) {
    const list = lanes[l];
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const lead = i > 0 ? list[i - 1] : null;
      let a = LAB.idm({ v: c.v, v0: c.v0, vl: lead ? lead.v : null,
                        gap: lead ? lead.x - lead.len - c.x : null,
                        T: c.T, aMax: c.aMax, bComf: c.bComf });
      if (l === 2) {
        // ramp: chase the merge target speed, and stop at the ramp end if unmerged
        const vTarget = cfg.match * vMainLocal + (1 - cfg.match) * 13;
        if (c.x > 250 && c.v > vTarget + 0.5) a = Math.min(a, -1.2);
        if (c.x > 250 && c.v < vTarget && (!lead || lead.x - lead.len - c.x > c.v * 1.2))
          a = Math.max(a, Math.min(1.9, 0.8 * (vTarget - c.v)));
        const wallGap = RAMP_END - 2 - c.x;
        const aWall = LAB.idm({ v: c.v, v0: c.v0, vl: 0, gap: Math.max(0.01, wallGap),
                                T: 0.9, aMax: c.aMax, bComf: 2.4 });
        a = Math.min(a, aWall);
        if (wallGap < 8 && c.v < 0.5) c.stoppedAtEnd = true;
      }
      if (l === 1 && cfg.polite > 0.02) {
        // courtesy braking: yield to a merger who would slot in AHEAD of you.
        // (braking for a merger behind you just stops the highway next to them)
        if (c.pol < cfg.polite) {
          const m = lanes[2].find(r => r.x > Math.max(RAMP_JOIN - 20, c.x + 2) && r.x < c.x + 60);
          if (m) {
            const aPol = LAB.idm({ v: c.v, v0: c.v0, vl: m.v, gap: Math.max(0.5, m.x - c.x),
                                   T: 1.1, aMax: c.aMax, bComf: 1.6 });
            a = Math.max(Math.min(a, aPol), -2.2); // yields, but not panic
          }
        }
      }
      c.a = Math.max(-8, Math.min(a, 3));
    }
    // integrate
    for (let i = list.length - 1; i >= 0; i--) {
      const c = list[i];
      c.v = Math.max(0, c.v + c.a * dt);
      c.x += c.v * dt;
      const lead = i > 0 ? list[i - 1] : null;
      if (lead && c.x > lead.x - lead.len - 0.25) {
        c.x = lead.x - lead.len - 0.25;
        c.v = Math.min(c.v, lead.v);
      }
      const braking = c.a < -1.3 && c.v > 2;
      if (braking && c.brakeDebounce <= 0 && c.lane !== 2 && c.x < RAMP_END + 250) {
        events.brakes.push({ t: simT }); c.brakeDebounce = 2.5;
      }
      c.brakeDebounce -= dt;
      c.braking = c.a < -1.0;
      // visual lane tween
      c.lat += (c.lane - c.lat) * Math.min(1, dt * 3.5);
      if (c.x - c.len > ROAD_LEN) {
        if (c.lane !== 2) events.thru.push({ t: simT });
        cars.splice(cars.indexOf(c), 1);
        list.splice(i, 1);
      }
    }
  }
  simT += dt;
  const cut = simT - 130;
  for (const k of ["thru", "brakes", "waits"]) {
    while (events[k].length && events[k][0].t < cut) events[k].shift();
  }
}

function neighbors(list, x) { // list sorted by x desc
  let lead = null, lag = null;
  for (const c of list) {
    if (c.x >= x) lead = c;
    else { lag = c; break; }
  }
  return { lead, lag };
}

function metrics() {
  const W = Math.min(120, Math.max(simT, 20));
  const zone = cars.filter(c => c.lane !== 2 && c.x > RAMP_JOIN && c.x < RAMP_END + 60);
  const failed = cars.filter(c => c.lane === 2 && c.stoppedAtEnd && c.v < 0.5).length;
  const rampQ = cars.filter(c => c.lane === 2).length;
  return {
    thru: Math.round(events.thru.length * 3600 / W),
    wait: events.waits.length ? events.waits.reduce((s, w) => s + w.wait, 0) / events.waits.length : NaN,
    brakes: +(events.brakes.length * 60 / W).toFixed(1),
    zoneSpeed: zone.length ? zone.reduce((s, c) => s + c.v, 0) / zone.length : NaN,
    failed, rampQ,
  };
}

/* ---------- render ---------- */
const cv = document.getElementById("hw");
const ctx = cv.getContext("2d");
const tsd = new LAB.Strip(document.getElementById("tsd"), {
  rows: [
    { y: 1 - RAMP_JOIN / ROAD_LEN, label: "ramp joins", band: true },
    { y: 1 - RAMP_END / ROAD_LEN, label: "lane ends", band: true },
  ],
  gutter: 74,
  axisLeft: "\u2190 ~4 min ago", axisRight: "now \u2192",
});
let lastSample = 0;

const LANE_PX = 30;
function laneY(latLane, H) {
  const mid = H * 0.44;
  // lane 0 (left/top), lane 1, ramp (2) below with taper toward the join
  return mid + (latLane - 0.5) * LANE_PX;
}
function rampYOffset(x, H) { // extra offset for the approach section of the ramp
  if (x >= RAMP_JOIN) return 0;
  const t = Math.max(0, Math.min(1, (RAMP_JOIN - x) / 350));
  return t * 2.2 * LANE_PX;
}

function render() {
  const dpr = window.devicePixelRatio || 1;
  const r = cv.getBoundingClientRect();
  if (r.width < 80 || r.height < 80) return;
  if (cv.width !== Math.round(r.width * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, r.width, r.height);
  const W = r.width, H = r.height;
  const sx = (x) => x / ROAD_LEN * W;

  // mainline road
  const roadTop = laneY(0, H) - LANE_PX / 2 - 3;
  const roadBot = laneY(1, H) + LANE_PX / 2 + 3;
  ctx.fillStyle = "#c9c4b6";
  ctx.fillRect(0, roadTop - 2, W, roadBot - roadTop + 4);
  ctx.fillStyle = "#e9e5da";
  ctx.fillRect(0, roadTop, W, roadBot - roadTop);
  // ramp + acceleration lane
  ctx.beginPath();
  const rampTopY = (x) => laneY(2, H) + rampYOffset(x, H) - LANE_PX / 2;
  ctx.moveTo(sx(RAMP_JOIN - 380), rampTopY(RAMP_JOIN - 380) + LANE_PX + 6);
  for (let x = RAMP_JOIN - 380; x <= RAMP_END; x += 20) ctx.lineTo(sx(x), rampTopY(x));
  ctx.lineTo(sx(RAMP_END + 70), roadBot);
  ctx.lineTo(sx(RAMP_JOIN - 380), roadBot);
  ctx.closePath();
  ctx.fillStyle = "#e9e5da";
  ctx.fill();
  ctx.strokeStyle = "#c9c4b6";
  ctx.lineWidth = 2;
  ctx.stroke();
  // lane markings
  ctx.setLineDash([9, 12]);
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(0, laneY(0.5, H)); ctx.lineTo(W, laneY(0.5, H));
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(sx(RAMP_JOIN), laneY(1.5, H)); ctx.lineTo(sx(RAMP_END), laneY(1.5, H));
  ctx.stroke();
  ctx.setLineDash([]);
  // ramp end chevrons
  ctx.fillStyle = "rgba(192,57,43,0.5)";
  for (let k = 0; k < 4; k++) {
    const x = sx(RAMP_END + 8 + k * 16);
    ctx.beginPath();
    ctx.moveTo(x, roadBot + 2 + k * 0);
    ctx.lineTo(x + 8, roadBot + LANE_PX * 0.5);
    ctx.lineTo(x, roadBot + LANE_PX);
    ctx.closePath();
  }
  ctx.fill();
  // labels
  ctx.fillStyle = "#8a8577";
  ctx.font = "11px -apple-system, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("→ 65 mph mainline", 12, roadTop - 8);
  ctx.fillText("on-ramp", sx(RAMP_JOIN - 360), rampTopY(RAMP_JOIN - 360) + LANE_PX + 20);
  ctx.textAlign = "center";
  ctx.fillText("acceleration lane ends", sx(RAMP_END), roadBot + LANE_PX + 16);
  // merge zone shading
  ctx.fillStyle = "rgba(46,127,191,0.06)";
  ctx.fillRect(sx(RAMP_JOIN), roadTop, sx(RAMP_END) - sx(RAMP_JOIN), roadBot - roadTop + LANE_PX);

  // cars
  const pxPerM = W / ROAD_LEN;
  for (const c of cars) {
    const y = laneY(c.lat, H) + (c.lane === 2 ? rampYOffset(c.x, H) : c.lat > 1.02 ? rampYOffset(c.x, H) * (c.lat - 1) : 0);
    LAB.drawCar(ctx, sx(c.x - c.len / 2), y, 0, Math.max(c.len * pxPerM, 5), 7,
      c.v, LIMIT, { braking: c.braking });
  }
}

/* ---------- UI ---------- */
LAB.bindSliders({
  match: { id: "sMatch", lbl: "vMatch", fmt: v => Math.round(v * 100) + "%" },
  gapAcc: { id: "sGapAcc", lbl: "vGapAcc", fmt: v => Math.round(v * 100) + "%" },
  polite: { id: "sPolite", lbl: "vPolite", fmt: v => Math.round(v * 100) + "%" },
  moveOver: { id: "sMoveOver", lbl: "vMoveOver", fmt: v => Math.round(v * 100) + "%" },
  main: { id: "sMain", lbl: "vMain", fmt: v => Math.round(v) + " veh/h" },
  ramp: { id: "sRamp", lbl: "vRamp", fmt: v => Math.round(v) + " veh/h" },
}, cfg, () => setPreset(null));

const PRESETS = {
  pToday: { match: 0.2, gapAcc: 0.35, polite: 0.6, moveOver: 0.2 },
  pTrained: { match: 0.95, gapAcc: 0.8, polite: 0.05, moveOver: 0.8 },
};
function setPreset(id) {
  document.querySelectorAll(".preset").forEach(b => b.classList.remove("active"));
  if (id) document.getElementById(id).classList.add("active");
}
for (const [id, p] of Object.entries(PRESETS)) {
  document.getElementById(id).addEventListener("click", () => {
    Object.assign(cfg, p);
    for (const [k, sid] of [["match", "sMatch"], ["gapAcc", "sGapAcc"], ["polite", "sPolite"], ["moveOver", "sMoveOver"]]) {
      document.getElementById(sid).value = p[k];
      document.getElementById(sid).dispatchEvent(new Event("input"));
    }
    Object.assign(cfg, p);
    setPreset(id);
  });
}

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
  document.getElementById("mThru").textContent = isNaN(m.thru) ? "–" : m.thru;
  document.getElementById("mWait").textContent = isNaN(m.wait) ? "–" : Math.round(m.wait) + " s";
  document.getElementById("mBrakes").textContent = m.brakes;
  document.getElementById("mSpeed").textContent = isNaN(m.zoneSpeed) ? "–" : LAB.fmtMph(m.zoneSpeed);
  document.getElementById("mFailed").textContent = m.failed;
  document.getElementById("spill").textContent = m.rampQ > 18 ? "⚠ ramp queue backing up: " + m.rampQ + " cars" : "";
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
        tsd.column(cars.filter(c => c.lane === 1).map(c => ({ y: 1 - c.x / ROAD_LEN, color: LAB.speedColor(c.v, LIMIT) })));
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
