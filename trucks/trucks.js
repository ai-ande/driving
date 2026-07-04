/* Trucks & Packs: pack formation on a 3-lane loop — herding, truck fear,
   and the trained alternative (pockets + decisive passes). */
"use strict";

const STRAIGHT = 700, RADIUS = 120;
const LOOP_LEN = 2 * STRAIGHT + 2 * Math.PI * RADIUS; // ~2154 m
const LANES = 3;                      // 0 = inner/left (fast), 2 = outer/right
const CAR_LIMIT = 33.5;               // 75 mph desired-ish ceiling
const TRUCK_V0 = 25;                  // 56 mph governed

const cfg = { n: 100, trucks: 0.15, ban: true, mix: 0, herd: 0.7, fear: 0.7 };

let rng = LAB.mulberry32(11);
let cars = [], simT = 0;

function build() {
  rng = LAB.mulberry32(11);
  cars = []; simT = 0;
  for (let i = 0; i < cfg.n; i++) {
    const truck = rng() < cfg.trucks;
    cars.push({
      id: i,
      truck,
      len: truck ? 16 : 4.6,
      lane: truck ? 2 : Math.floor(rng() * LANES),
      lat: 0, // set below
      s: rng() * LOOP_LEN,
      v: truck ? 22 : 24 + rng() * 4,
      v0: truck ? TRUCK_V0 * (0.97 + rng() * 0.05) : CAR_LIMIT * (0.86 + rng() * 0.2),
      T: truck ? 1.7 : Math.max(0.75, 1.25 * (1 + 0.25 * (rng() * 2 - 1))),
      aMax: truck ? 0.7 : 1.7,
      bComf: 2.0,
      herdRoll: rng(), fearRoll: rng(),
      trained: false,
      lcCooldown: rng() * 4,
      besideTimer: 0,
      braking: false, a: 0,
    });
    cars[i].lat = cars[i].lane;
  }
  applyTrained();
}
function applyTrained() {
  const humans = cars.filter(c => !c.truck);
  humans.forEach((c, i) => { c.trained = (i / humans.length) < cfg.mix; });
}

function laneList(l) {
  return cars.filter(c => c.lane === l).sort((a, b) => a.s - b.s);
}
function wrapGap(ahead, behind) { // gap from behind's front to ahead's rear
  let g = ahead.s - ahead.len - behind.s;
  return ((g % LOOP_LEN) + LOOP_LEN) % LOOP_LEN;
}
function neighborsAt(list, s) { // in a sorted lane list, lead/lag around position s
  if (!list.length) return { lead: null, lag: null };
  let lead = null, lag = null;
  for (const c of list) { if (c.s > s) { lead = c; break; } }
  if (!lead) lead = list[0];
  for (let i = list.length - 1; i >= 0; i--) { if (list[i].s <= s) { lag = list[i]; break; } }
  if (!lag) lag = list[list.length - 1];
  return { lead, lag };
}

function step(dt) {
  const lanes = [laneList(0), laneList(1), laneList(2)];

  // ---- lane-change decisions
  for (const c of cars) {
    c.lcCooldown -= dt;
    if (c.lcCooldown > 0) continue;
    const list = lanes[c.lane];
    const idx = list.indexOf(c);
    const lead = list.length > 1 ? list[(idx + 1) % list.length] : null;
    const gapLead = lead ? wrapGap(lead, c) : 1e9;
    const heldUp = lead && gapLead < Math.max(14, c.v * 1.6) && lead.v < c.v0 - 1.5;

    const tryMove = (target) => {
      if (target < 0 || target >= LANES) return false;
      if (c.truck && cfg.ban && target < 2) return false;
      const { lead: tl, lag: tg } = neighborsAt(lanes[target], c.s);
      const leadGap = tl ? wrapGap(tl, c) : 1e9;
      const lagGap = tg ? wrapGap(c, tg) : 1e9;
      let needLead = 3 + c.v * 0.55, needLag = 3 + (tg ? tg.v : 0) * 0.6;
      if (!c.trained && !c.truck && lead && lead.truck) {
        needLead *= 1 + 1.6 * cfg.fear;
        needLag *= 1 + 1.6 * cfg.fear;
      }
      if (leadGap > needLead && lagGap > needLag) {
        lanes[c.lane].splice(lanes[c.lane].indexOf(c), 1);
        c.lane = target;
        lanes[target].push(c);
        lanes[target].sort((a, b) => a.s - b.s);
        c.lcCooldown = 3.5;
        return true;
      }
      return false;
    };

    if (c.trained && !c.truck) {
      // decisive when a pass genuinely pays; CALM when the road is dense —
      // at high density every lane change perturbs followers and seeds packs,
      // so the trained move is to hold lane and cushion. (Doing less, on purpose.)
      const dense = cfg.n / (LANES * LOOP_LEN) > 0.0145; // ~94+ vehicles on this loop
      if (dense && !(lead && lead.truck && lead.v < c.v0 - 6)) {
        // stay put unless parked behind a truck; smooth following does the rest
      } else if (heldUp) {
        // MOBIL-style incentive: a pass must actually BUY speed, not just space
        const laneGain = (l) => {
          if (l < 0 || l >= LANES) return -1;
          const { lead: tl } = neighborsAt(lanes[l], c.s);
          const hw = tl ? wrapGap(tl, c) : LOOP_LEN;
          const vAhead = (!tl || hw > c.v * 4) ? c.v0 : tl.v;
          return vAhead - lead.v > 2.5 ? hw : -1;
        };
        const hl = laneGain(c.lane - 1), hr = laneGain(c.lane + 1);
        if (hl < 0 && hr < 0) { /* no lane buys anything: hold and follow smoothly */ }
        else if (hl >= hr) { if (!tryMove(c.lane - 1)) { if (hr > 0) tryMove(c.lane + 1); } }
        else { if (!tryMove(c.lane + 1)) { if (hl > 0) tryMove(c.lane - 1); } }
      } else if (c.lane < LANES - 1) {
        const { lead: tl } = neighborsAt(lanes[c.lane + 1], c.s);
        const rightHeadway = tl ? wrapGap(tl, c) : LOOP_LEN;
        if (rightHeadway > Math.max(220, c.v * 8) && (!tl || tl.v > c.v0 - 1)) tryMove(c.lane + 1);
      }
    } else if (!c.truck) {
      // human: only bothers if held up, and herding says maybe not even then
      if (heldUp && !(lead && lead.truck && c.fearRoll < cfg.fear * 0.55)) {
        if (c.herdRoll > cfg.herd || gapLead < c.v * 0.7) {
          if (!tryMove(c.lane - 1)) tryMove(c.lane + 1);
        } else c.lcCooldown = 2.5; // content in the clump
      }
    } else if (c.truck && !cfg.ban) {
      if (heldUp) tryMove(c.lane - 1); // elephant race
    } else if (c.truck && cfg.ban && c.lane < 2) {
      tryMove(c.lane + 1);
    }
  }

  // ---- car-following
  for (let l = 0; l < LANES; l++) {
    const list = lanes[l];
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const lead = list.length > 1 ? list[(i + 1) % list.length] : null;
      const gap = lead ? wrapGap(lead, c) : 1e9;
      let a = LAB.idm({ v: c.v, v0: c.v0, vl: lead ? lead.v : null,
                        gap: lead ? gap : null, T: c.T, aMax: c.aMax, bComf: c.bComf });
      // trained anti-camping: never linger alongside someone
      if (c.trained && !c.truck) {
        let beside = false;
        for (const other of cars) {
          if (other === c || Math.abs(other.lane - c.lane) !== 1) continue;
          let d = Math.abs(other.s - c.s);
          d = Math.min(d, LOOP_LEN - d);
          if (d < 7) { beside = true; break; }
        }
        c.besideTimer = beside ? c.besideTimer + dt : 0;
        // clear the overlap by slipping AHEAD when there is room; never by
        // braking in traffic (that snowballs the whole loop into a pack)
        if (c.besideTimer > 2.5 && gap > c.v * 2.2) a += 0.5;
      }
      c.a = Math.max(-8, Math.min(a, 2.5));
    }
    for (const c of list) {
      c.v = Math.max(0, c.v + c.a * dt);
      c.s = (c.s + c.v * dt) % LOOP_LEN;
      c.braking = c.a < -1.2;
      c.lat += (c.lane - c.lat) * Math.min(1, dt * 3);
    }
    // no-overlap guard
    for (let i = 0; i < list.length; i++) {
      const c = list[i], lead = list.length > 1 ? list[(i + 1) % list.length] : null;
      if (lead && lead !== c) {
        const g = wrapGap(lead, c);
        if (g < 0.3 || g > LOOP_LEN - 30) {
          c.s = ((lead.s - lead.len - 0.3) % LOOP_LEN + LOOP_LEN) % LOOP_LEN;
          c.v = Math.min(c.v, lead.v);
        }
      }
    }
  }
  simT += dt;
}

function metrics() {
  const humans = cars.filter(c => !c.truck);
  const vs = humans.map(c => c.v).sort((a, b) => a - b);
  const avg = vs.reduce((s, v) => s + v, 0) / Math.max(1, vs.length);
  const p10 = vs[Math.floor(vs.length * 0.1)] || 0;
  // packs: cluster all vehicles by longitudinal proximity (any lane)
  const byS = [...cars].sort((a, b) => a.s - b.s);
  let biggest = 1, cur = 1;
  for (let i = 1; i < byS.length + 1; i++) {
    const prev = byS[(i - 1) % byS.length], c = byS[i % byS.length];
    let d = c.s - prev.s;
    if (d < 0) d += LOOP_LEN;
    if (d < 26) { cur++; biggest = Math.max(biggest, cur); }
    else cur = 1;
  }
  // boxed-in: held up AND someone alongside
  let boxed = 0;
  for (const c of humans) {
    const list = laneList(c.lane);
    const idx = list.indexOf(c);
    const lead = list.length > 1 ? list[(idx + 1) % list.length] : null;
    if (!lead || wrapGap(lead, c) > Math.max(14, c.v * 1.6) || lead.v > c.v0 - 1.5) continue;
    const blocked = cars.some(o => o !== c && Math.abs(o.lane - c.lane) === 1 &&
      Math.min(Math.abs(o.s - c.s), LOOP_LEN - Math.abs(o.s - c.s)) < 8);
    if (blocked) boxed++;
  }
  const vDesired = humans.reduce((s, c) => s + c.v0, 0) / Math.max(1, humans.length);
  return { avg, p10, biggest, boxed, lostPct: Math.max(0, 1 - avg / vDesired) };
}

/* ---------- render: stadium track ---------- */
const cv = document.getElementById("tr");
const ctx = cv.getContext("2d");

function sToPose(s, laneLat) {
  // stadium: straight (bottom, ->+x), arc right, straight (top, -x), arc left
  const A = STRAIGHT, C = Math.PI * RADIUS;
  const off = (1.05 - laneLat) * 11; // lane offset in world meters (inner lane = bigger radius shrink)
  s = ((s % LOOP_LEN) + LOOP_LEN) % LOOP_LEN;
  if (s < A) return { x: s - A / 2, y: -RADIUS + off, ang: 0, straight: true };
  if (s < A + C) {
    const t = (s - A) / C * Math.PI;
    const r = RADIUS - off;
    return { x: A / 2 + Math.sin(t) * r, y: -Math.cos(t) * r, ang: t, straight: false };
  }
  if (s < 2 * A + C) return { x: A / 2 - (s - A - C), y: RADIUS - off, ang: Math.PI, straight: true };
  const t = (s - 2 * A - C) / C * Math.PI;
  const r = RADIUS - off;
  return { x: -A / 2 - Math.sin(t) * r, y: Math.cos(t) * r, ang: Math.PI + t, straight: false };
}

function render() {
  const dpr = window.devicePixelRatio || 1;
  const r = cv.getBoundingClientRect();
  if (r.width < 80 || r.height < 80) return;
  if (cv.width !== Math.round(r.width * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, r.width, r.height);
  const SC = Math.min(r.width / (STRAIGHT + 2 * RADIUS + 80), r.height / (2 * RADIUS + 120));
  const X = (x) => r.width / 2 + x * SC;
  const Y = (y) => r.height / 2 + y * SC;

  // track: draw three lane rings
  ctx.lineCap = "round";
  for (const [w, col] of [[38 * SC, "#c9c4b6"], [34 * SC, "#e9e5da"]]) {
    ctx.strokeStyle = col;
    ctx.lineWidth = w;
    ctx.beginPath();
    for (let s = 0; s <= LOOP_LEN; s += 12) {
      const p = sToPose(s, 1);
      s === 0 ? ctx.moveTo(X(p.x), Y(p.y)) : ctx.lineTo(X(p.x), Y(p.y));
    }
    ctx.closePath();
    ctx.stroke();
  }
  // lane dividers
  ctx.setLineDash([7, 9]);
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.lineWidth = 1;
  for (const lat of [0.5, 1.5]) {
    ctx.beginPath();
    for (let s = 0; s <= LOOP_LEN; s += 12) {
      const p = sToPose(s, lat);
      s === 0 ? ctx.moveTo(X(p.x), Y(p.y)) : ctx.lineTo(X(p.x), Y(p.y));
    }
    ctx.closePath();
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.fillStyle = "#8a8577";
  ctx.font = "11px -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("outer lane = right lane · traffic runs clockwise", r.width / 2, Y(0) + 4);

  // vehicles
  for (const c of cars) {
    const p = sToPose(c.s - c.len / 2, c.lat);
    LAB.drawCar(ctx, X(p.x), Y(p.y), p.ang, Math.max(c.len * SC, 6), Math.max((c.truck ? 2.5 : 1.9) * SC, 4),
      c.v, CAR_LIMIT, {
        braking: c.braking,
        color: c.truck ? "#a9834f" : null,
        dot: c.trained ? "#fff" : null,
      });
  }
}

/* ---------- UI ---------- */
LAB.bindSliders({
  n: { id: "sN", lbl: "vN", fmt: v => Math.round(v) + "", onchange: build },
  trucks: { id: "sTrucks", lbl: "vTrucks", fmt: v => Math.round(v * 100) + "%", onchange: build },
  mix: { id: "sMix", lbl: "vMix", fmt: v => Math.round(v * 100) + "%", onchange: () => { applyTrained(); setPreset(null); } },
  herd: { id: "sHerd", lbl: "vHerd", fmt: v => Math.round(v * 100) + "%" },
  fear: { id: "sFear", lbl: "vFear", fmt: v => Math.round(v * 100) + "%" },
}, cfg, () => setPreset(null));
document.getElementById("sBan").addEventListener("change", () => {
  cfg.ban = document.getElementById("sBan").checked;
  document.getElementById("vBan").textContent = cfg.ban ? "on" : "off";
  setPreset(null);
});
document.getElementById("vBan").textContent = "on";

function setPreset(id) {
  document.querySelectorAll(".preset").forEach(b => b.classList.remove("active"));
  if (id) document.getElementById(id).classList.add("active");
}
document.getElementById("pToday").addEventListener("click", () => {
  cfg.mix = 0; cfg.herd = 0.6; cfg.fear = 0.6;
  syncSliders(); applyTrained(); setPreset("pToday");
});
document.getElementById("pTrained").addEventListener("click", () => {
  cfg.mix = 1; cfg.herd = 0.6; cfg.fear = 0.6; // herd/fear now moot: everyone trained
  syncSliders(); applyTrained(); setPreset("pTrained");
});
function syncSliders() {
  for (const [k, id, fmt] of [["mix", "sMix", v => Math.round(v * 100) + "%"], ["herd", "sHerd", v => Math.round(v * 100) + "%"], ["fear", "sFear", v => Math.round(v * 100) + "%"]]) {
    document.getElementById(id).value = cfg[k];
    document.getElementById("v" + id.slice(1)).textContent = fmt(cfg[k]);
  }
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

function updateDom() {
  const m = metrics();
  document.getElementById("mSpeed").textContent = Math.round(m.avg * 2.237) + " mph";
  document.getElementById("mP10").textContent = Math.round(m.p10 * 2.237) + " mph";
  document.getElementById("mPack").textContent = m.biggest + " vehicles";
  document.getElementById("mBoxed").textContent = m.boxed;
  document.getElementById("mLost").textContent = Math.round(m.lostPct * 100) + "%";
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
    while (acc >= h && steps < 200) { step(h); steps++; acc -= h; }
    acc = Math.min(acc, 0.4);
  }
  render();
  domTimer += dt;
  if (domTimer > 0.35) { updateDom(); domTimer = 0; }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
