/* The Couplet: two-way arterial vs one-way pair, identical demand & signals. */
"use strict";

const ROAD_LEN = 980;                 // meters of corridor
const SIGNALS = [140, 280, 420, 560, 700, 840];
const LIMIT = 13.4;                   // 30 mph city street
const CYCLE_SPLIT = 0.6;              // main street's share of usable green
const YEL = 3.5, AR = 1;
const CAR_LEN = 4.6;

const cfg = { dem: 700, cyc: 70, wav: 28, coord: false };

let rng = LAB.mulberry32(5);
let simT = 0;
let systems = [];                     // [arterial, pair]

/* a "flow" = one direction on one street: 2 lanes, its own signal offsets */
function mkFlow(dirUp, offsets) {
  return {
    dirUp,                            // true = northbound (y increasing)
    offsets,                          // per-signal offset (s)
    lanes: [[], []],                  // car arrays, sorted by progress
    spawnAcc: 0,
    done: [],                         // {t, dur, stops}
  };
}

function offsetsFor(mode, dirUp) {
  // mode: 'rand' | 'up' | 'down'
  const r = LAB.mulberry32(999);
  return SIGNALS.map((y, i) => {
    if (mode === "rand") return r() * cfg.cyc * (i * 0.37 % 1 + 0.3);
    const d = mode === "up" ? y : (ROAD_LEN - y);
    return (d / (cfg.wav * 0.44704)) % cfg.cyc;
  });
}

function build() {
  rng = LAB.mulberry32(5);
  simT = 0;
  const mode = cfg.coord;
  systems = [
    { name: "arterial",
      // one street: NB gets the wave when coordinated; SB shares the SAME offsets
      flows: [mkFlow(true, null), mkFlow(false, null)], shared: true },
    { name: "pair",
      // two streets: each direction gets its own street and its own offsets
      flows: [mkFlow(true, null), mkFlow(false, null)], shared: false },
  ];
  retime();
}

function retime() {
  const [art, pair] = systems;
  const artOff = offsetsFor(cfg.coord ? "up" : "rand");
  art.flows[0].offsets = artOff;          // NB
  art.flows[1].offsets = artOff;          // SB shares the street's lights
  pair.flows[0].offsets = cfg.coord ? offsetsFor("up") : offsetsFor("rand");
  pair.flows[1].offsets = cfg.coord ? offsetsFor("down") : offsetsFor("rand");
}

function signalState(flow, i, t) {
  const C = cfg.cyc;
  const gMain = Math.max(10, (C - 2 * (YEL + AR)) * CYCLE_SPLIT);
  let u = (t - flow.offsets[i]) % C;
  if (u < 0) u += C;
  if (u < gMain) return "g";
  if (u < gMain + YEL) return "y";
  return "r";
}

function step(dt) {
  for (const sys of systems) {
    for (const flow of sys.flows) {
      // spawn: demand split over 2 lanes
      flow.spawnAcc += cfg.dem / 3600 * dt;
      if (flow.spawnAcc >= 1) {
        const lane = flow.lanes[0].length <= flow.lanes[1].length ? 0 : 1;
        const list = flow.lanes[lane];
        const last = list[list.length - 1];
        if (!last || last.p - last.len > 14) {
          list.push({
            p: 0, v: Math.min(11, last ? last.v + 2 : 11), len: CAR_LEN,
            v0: LIMIT * (0.94 + rng() * 0.12),
            T: Math.max(0.7, 1.3 * (1 + 0.25 * (rng() * 2 - 1))),
            react: 0.6 + rng() * 0.8, goTimer: -1,
            born: simT, stops: 0, lastStopV: 10,
            braking: false, latch: null,
          });
          flow.spawnAcc -= 1;
        }
      }

      for (const list of flow.lanes) {
        for (let i = 0; i < list.length; i++) {
          const c = list[i];
          const lead = i > 0 ? list[i - 1] : null;
          let a = LAB.idm({ v: c.v, v0: c.v0, vl: lead ? lead.v : null,
                            gap: lead ? lead.p - lead.len - c.p : null,
                            T: c.T, aMax: 1.7, bComf: 2.0 });
          // next signal (progress-space: signals for SB are mirrored)
          let sigP = null, sigIdx = -1;
          for (let k = 0; k < SIGNALS.length; k++) {
            const pos = (flow.dirUp ? SIGNALS[k] : ROAD_LEN - SIGNALS[k]) - 8;
            if (pos >= c.p - 1 && (sigP === null || pos < sigP)) { sigP = pos; sigIdx = k; }
          }
          if (sigP !== null) {
            const st = signalState(flow, sigIdx, simT);
            const dist = sigP - c.p;
            let stop = false;
            if (st === "r") stop = true;
            else if (st === "y") {
              const cyc = Math.floor((simT - flow.offsets[sigIdx]) / cfg.cyc);
              if (!c.latch || c.latch.i !== sigIdx || c.latch.cyc !== cyc) {
                c.latch = { i: sigIdx, cyc, go: (c.v * c.v) / (2 * Math.max(0.5, dist)) > 2.6 };
              }
              stop = !c.latch.go;
            }
            if (stop && dist > -1) {
              const aSig = LAB.idm({ v: c.v, v0: c.v0, vl: 0, gap: Math.max(0.01, dist),
                                     T: 0.8, aMax: 1.7, bComf: 2.2 });
              a = Math.min(a, aSig);
            }
          }
          // startup reaction
          if (c.v < 0.35) {
            const lead2 = i > 0 ? list[i - 1] : null;
            const open = !lead2 || (lead2.p - lead2.len - c.p > 3.2) || lead2.v > 0.9;
            if (open && a > 0.05) {
              if (c.goTimer < 0) c.goTimer = 0;
              c.goTimer += dt;
              if (c.goTimer < c.react) a = Math.min(a, 0);
            } else c.goTimer = -1;
          } else c.goTimer = -1;
          c.a = Math.max(-8, Math.min(a, 3));
        }
        for (let i = list.length - 1; i >= 0; i--) {
          const c = list[i];
          c.v = Math.max(0, c.v + c.a * dt);
          c.p += c.v * dt;
          const lead = i > 0 ? list[i - 1] : null;
          if (lead && c.p > lead.p - lead.len - 0.25) {
            c.p = lead.p - lead.len - 0.25;
            c.v = Math.min(c.v, lead.v);
          }
          c.braking = c.a < -1.0;
          if (c.v < 0.4 && c.lastStopV > 2.2) { c.stops++; c.lastStopV = 0; }
          if (c.v > 2.2) c.lastStopV = c.v;
          if (c.p > ROAD_LEN) {
            flow.done.push({ t: simT, dur: simT - c.born, stops: c.stops });
            list.splice(i, 1);
          }
        }
      }
      while (flow.done.length && flow.done[0].t < simT - 150) flow.done.shift();
    }
  }
  simT += dt;
}

function flowMetrics(flow) {
  const W = Math.min(120, Math.max(simT, 30));
  const d = flow.done.filter(x => x.t > simT - W);
  if (!d.length) return { dur: NaN, stops: NaN };
  return {
    dur: d.reduce((s, x) => s + x.dur, 0) / d.length,
    stops: d.reduce((s, x) => s + x.stops, 0) / d.length,
  };
}

/* ---------- render ---------- */
const cv = document.getElementById("cp");
const ctx = cv.getContext("2d");

function render() {
  const dpr = window.devicePixelRatio || 1;
  const r = cv.getBoundingClientRect();
  if (r.width < 80 || r.height < 80) return;
  if (cv.width !== Math.round(r.width * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, r.width, r.height);
  const H = r.height, W = r.width;
  const m = 46;
  const yOf = (p) => H - m - (p / ROAD_LEN) * (H - 2 * m);

  // layout: arterial center-left, pair streets center-right
  const xArt = W * 0.27;
  const xA = W * 0.62, xB = W * 0.78;
  const laneW = 9;

  const drawStreet = (x, nLanes) => {
    ctx.fillStyle = "#c9c4b6";
    ctx.fillRect(x - (nLanes * laneW) / 2 - 2, m - 14, nLanes * laneW + 4, H - 2 * m + 28);
    ctx.fillStyle = "#e9e5da";
    ctx.fillRect(x - (nLanes * laneW) / 2, m - 14, nLanes * laneW, H - 2 * m + 28);
  };
  drawStreet(xArt, 4);
  drawStreet(xA, 2);
  drawStreet(xB, 2);
  // centerline on arterial
  ctx.strokeStyle = "rgba(214,168,60,0.9)";
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(xArt, m - 14); ctx.lineTo(xArt, H - m + 14); ctx.stroke();

  // cross streets + signals
  const [art, pair] = systems;
  for (let k = 0; k < SIGNALS.length; k++) {
    const y = yOf(SIGNALS[k]);
    ctx.strokeStyle = "#ddd8cc";
    ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(30, y); ctx.lineTo(W - 30, y); ctx.stroke();
    const dot = (x, flow) => {
      const st = signalState(flow, k, simT);
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, 7);
      ctx.fillStyle = st === "g" ? "#2ecc71" : st === "y" ? "#f1c40f" : "#e74c3c";
      ctx.fill();
      ctx.strokeStyle = "#fffdf7";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    };
    dot(xArt - 2.6 * laneW, art.flows[0]);   // arterial (shared offsets)
    dot(xA - 1.6 * laneW, pair.flows[0]);
    dot(xB + 1.6 * laneW, pair.flows[1]);
  }

  // cars
  const drawFlow = (flow, xCenter, sideSign) => {
    flow.lanes.forEach((list, li) => {
      const x = xCenter + sideSign * (laneW / 2 + li * laneW);
      for (const c of list) {
        const y = yOf(flow.dirUp ? c.p - c.len / 2 : ROAD_LEN - (c.p - c.len / 2));
        LAB.drawCar(ctx, x, y, Math.PI / 2, Math.max(4, c.len * (H - 2 * m) / ROAD_LEN), 5.5,
          c.v, LIMIT, { braking: c.braking });
      }
    });
  };
  drawFlow(art.flows[0], xArt, +1);   // NB on right side of centerline
  drawFlow(art.flows[1], xArt, -1);   // SB on left
  drawFlow(pair.flows[0], xA, 0.001 ? +1 : +1); // A street NB (2 lanes centered-ish)
  drawFlow(pair.flows[1], xB, -1);

  // labels
  ctx.fillStyle = "#6b675c";
  ctx.font = "600 12px -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("TWO-WAY ARTERIAL", xArt, 24);
  ctx.fillText("ONE-WAY PAIR", (xA + xB) / 2, 24);
  ctx.font = "10px -apple-system, sans-serif";
  ctx.fillStyle = "#8a8577";
  ctx.fillText("↑ NB · SB ↓ (shared lights)", xArt, 38);
  ctx.fillText("↑ NB street", xA, 38);
  ctx.fillText("SB street ↓", xB, 38);
}

/* ---------- UI ---------- */
LAB.bindSliders({
  dem: { id: "sDem", lbl: "vDem", fmt: v => Math.round(v) + " veh/h", onchange: () => {} },
  cyc: { id: "sCyc", lbl: "vCyc", fmt: v => Math.round(v) + " s", onchange: retime },
  wav: { id: "sWav", lbl: "vWav", fmt: v => Math.round(v) + " mph", onchange: retime },
}, cfg);

function setPreset(id) {
  document.querySelectorAll(".preset").forEach(b => b.classList.remove("active"));
  if (id) document.getElementById(id).classList.add("active");
}
document.getElementById("pUncoord").addEventListener("click", () => { cfg.coord = false; retime(); setPreset("pUncoord"); });
document.getElementById("pCoord").addEventListener("click", () => { cfg.coord = true; retime(); setPreset("pCoord"); });

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
  const [art, pair] = systems;
  const fmt = (m) => isNaN(m.dur) ? "–" : LAB.fmtTime(m.dur) + " · " + m.stops.toFixed(1);
  const aNB = flowMetrics(art.flows[0]), aSB = flowMetrics(art.flows[1]);
  const bNB = flowMetrics(pair.flows[0]), bSB = flowMetrics(pair.flows[1]);
  document.getElementById("aNB").textContent = fmt(aNB);
  document.getElementById("aSB").textContent = fmt(aSB);
  document.getElementById("bNB").textContent = fmt(bNB);
  document.getElementById("bSB").textContent = fmt(bSB);
  document.getElementById("ffC").textContent = LAB.fmtTime(ROAD_LEN / (LIMIT * 0.97));
  const v = document.getElementById("verdictC");
  if (!cfg.coord) v.textContent = "Timing is random: geometry can't help either side yet.";
  else v.innerHTML = "<b>The pair gives BOTH directions the wave; the arterial had to choose.</b>";
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
