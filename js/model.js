/* Traffic model: IDM car-following + driver reaction delay + anticipation,
   two-phase fixed-time signals with adjustable offsets.
   Units: meters, seconds, m/s. World coords: x east, y north (from geometry.js). */
"use strict";

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- polyline path with arc-length lookup ---------- */
class Path {
  constructor(pts) {
    this.pts = pts;
    this.cum = [0];
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1];
      this.cum.push(this.cum[i - 1] + Math.hypot(dx, dy));
    }
    this.len = this.cum[this.cum.length - 1];
  }
  at(s) { // -> {x, y, dx, dy} dx/dy = unit direction of travel
    const c = this.cum;
    let lo = 0, hi = c.length - 1;
    if (s <= 0) lo = 0; else if (s >= this.len) lo = c.length - 2;
    else { while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= s) lo = m; else hi = m; } }
    const i = Math.min(lo, this.pts.length - 2);
    const seg = c[i + 1] - c[i] || 1e-9;
    const t = Math.max(0, Math.min(1, (s - c[i]) / seg));
    const p = this.pts[i], q = this.pts[i + 1];
    const dx = (q[0] - p[0]) / seg, dy = (q[1] - p[1]) / seg;
    return { x: p[0] + (q[0] - p[0]) * t, y: p[1] + (q[1] - p[1]) * t, dx, dy };
  }
  sNearest(x, y) { // arc-length of closest point (coarse, for setup only)
    let best = 1e18, bs = 0;
    for (let i = 0; i < this.pts.length - 1; i++) {
      const p = this.pts[i], q = this.pts[i + 1];
      const vx = q[0] - p[0], vy = q[1] - p[1];
      const L2 = vx * vx + vy * vy || 1e-9;
      let t = ((x - p[0]) * vx + (y - p[1]) * vy) / L2;
      t = Math.max(0, Math.min(1, t));
      const cx = p[0] + vx * t, cy = p[1] + vy * t;
      const d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (d < best) { best = d; bs = this.cum[i] + Math.sqrt(L2) * t; }
    }
    return bs;
  }
}

/* ---------- signal controller (one per intersection) ---------- */
const YELLOW = 3.5, ALLRED = 1.0, LOST = 2 * (YELLOW + ALLRED);
class Controller {
  constructor(inter, idx) {
    this.inter = inter;          // {key,name,x,y,sLamar,cls,...}
    this.idx = idx;
    this.offsetFrac = 0;         // set from seeded rng
    this.offset = 0;
    this.gMain = 40; this.gCross = 20; this.cycle = 70;
  }
  retime(cfg, sLamar0) {
    const C = cfg.cycle;
    const usable = Math.max(16, C - LOST);
    if (this.inter.cls === "major") {
      this.gMain = Math.max(8, usable * cfg.split);
      this.gCross = Math.max(8, usable - this.gMain);
    } else { // minor crossing: short semi-actuated-style side phase
      this.gCross = Math.min(12, usable * 0.35);
      this.gMain = usable - this.gCross;
    }
    this.cycle = C;
    this.offset = cfg.wave
      ? ((this.inter.sLamar - sLamar0) / cfg.waveSpeed) % C
      : this.offsetFrac * C;
  }
  // approach: 'main' (Lamar) or 'cross' -> 'g' | 'y' | 'r'
  state(t, approach) {
    let u = (t - this.offset) % this.cycle;
    if (u < 0) u += this.cycle;
    const gM = this.gMain, gC = this.gCross;
    if (approach === "main") {
      if (u < gM) return "g";
      if (u < gM + YELLOW) return "y";
      return "r";
    } else {
      const start = gM + YELLOW + ALLRED;
      if (u >= start && u < start + gC) return "g";
      if (u >= start + gC && u < start + gC + YELLOW) return "y";
      return "r";
    }
  }
}

/* ---------- driver parameter helpers ---------- */
const TRAINED = { react: 0.3, gap: 1.0, accel: 2.2, antic: 0.9 };
const S0 = 2.0;               // standstill gap (m)
const CAR_LEN = 4.6;

/* ---------- car ---------- */
let CAR_ID = 0;
class Car {
  constructor(lane, rng, cfg) {
    this.id = CAR_ID++;
    this.lane = lane;
    this.s = 0;                  // position of FRONT bumper along lane
    this.v = Math.min(lane.limit, 9);
    this.len = 4.2 + rng() * 0.9;
    this.trained = rng() < cfg.mix;
    // per-driver jitter, stable across slider changes
    this.j1 = rng() * 2 - 1; this.j2 = rng() * 2 - 1; this.j3 = rng() * 2 - 1;
    this.vMul = 0.94 + rng() * 0.14;   // desired speed vs limit
    this.applyParams(cfg);
    this.goTimer = -1;           // -1 = not waiting; else seconds accumulated
    this.waiting = false;        // stopped with open road, reaction pending (render hint)
    this.braking = false;
    this.sigLatch = null;        // {ctrlIdx, cycleN, go}
    this.a = 0;
    // metrics
    this.enteredAt = -1; this.stopCount = 0; this.brakeCount = 0;
    this.lastStopV = 10; this.brakeDebounce = 0;
  }
  applyParams(cfg) {
    const p = this.trained ? TRAINED : cfg;
    this.react = Math.max(0.15, p.react * (1 + 0.3 * this.j1));
    this.T = Math.max(0.55, p.gap * (1 + 0.25 * this.j2));
    this.aMax = Math.max(0.7, p.accel * (1 + 0.2 * this.j3));
    this.antic = Math.max(0, Math.min(1, p.antic + 0.1 * this.j1));
    this.bComf = 2.6 - 1.6 * this.antic;    // anticipators plan gentle stops
    this.v0 = this.lane.limit * this.vMul * (this.trained ? 1.0 : 1.0);
  }
}

/* ---------- lane ---------- */
class Lane {
  constructor(opts) {
    Object.assign(this, opts);  // path, roadKey, dirName, idx, offset(m), limit, spawnRate(veh/s at demand 1)
    this.len = this.path.len;
    this.cars = [];             // sorted by s DESC (leader first)
    this.spawnAcc = 0;
    this.outside = 0;           // cars that couldn't enter yet
    this.signals = [];          // {s, ctrl, approach} sorted by s ASC
    this.measure = null;        // {s0, s1} for corridor metrics
  }
}

/* ---------- the simulation ---------- */
const BASE_NB = 1250, BASE_SB = 850;  // veh/h that demand=1.0 injects on Lamar

class Sim {
  constructor(geo) {
    this.geo = geo;
    this.t = 0;
    this.rng = mulberry32(20260704);
    this.cfg = {
      react: 1.4, gap: 1.6, accel: 1.6, antic: 0.15, mix: 0,
      cycle: 90, split: 0.55, wave: false, waveSpeed: 13.4,
      demand: 1.0,
      profileMode: false, timeOfDay: 8 * 60 + 15, // measured-2019 replay
    };
    this.profile = (typeof DEMAND_PROFILE !== "undefined") ? DEMAND_PROFILE : null;
    if (this.profile) {
      const comb = this.profile.nbVeh.map((v, i) => v + this.profile.sbVeh[i]);
      this.profilePeakComb = Math.max(...comb);
    }
    this.buildNetwork();
    this.completions = [];      // {t, dir, dur, stops, brakes}
    this.crossCount = [];       // {t}
    this.spillTotal = 0;
  }

  buildNetwork() {
    const geo = this.geo;
    const lamarPath = new Path(geo.lamar);
    this.lamarPath = lamarPath;
    // only real signals get controllers (3rd St is unsignalized; 15th passes over Lamar)
    this.controllers = geo.intersections.filter(it => it.signalized).map((it, i) => {
      const c = new Controller(it, i);
      c.offsetFrac = mulberry32(1000 + i * 77)();
      return c;
    });
    this.sLamar0 = this.controllers[0].inter.sLamar;

    const lanes = [];
    const LANE_W = 3.4;
    const mk = (opts) => { const l = new Lane(opts); lanes.push(l); return l; };

    // --- Lamar: 2 lanes each way. Right-hand traffic: lanes sit on the right of centerline.
    const lamarRev = new Path(geo.lamar.slice().reverse());
    const LAMAR_LIMIT = 15.6; // 35 mph
    // rush-hour-ish base demand (veh/s per lane at demand=1)
    const nbRate = BASE_NB / 3600 / 2, sbRate = BASE_SB / 3600 / 2;
    this.lamarLanes = { NB: [], SB: [] };
    for (let i = 0; i < 2; i++) {
      this.lamarLanes.NB.push(mk({ path: lamarPath, roadKey: "lamar", dirName: "NB", idx: i,
        offset: (0.5 + i) * LANE_W, limit: LAMAR_LIMIT, spawnRate: nbRate, group: "NB" }));
      this.lamarLanes.SB.push(mk({ path: lamarRev, roadKey: "lamar", dirName: "SB", idx: i,
        offset: (0.5 + i) * LANE_W, limit: LAMAR_LIMIT, spawnRate: sbRate, group: "SB" }));
    }

    // --- cross streets
    // demand (veh/h per direction at demand=1)
    // third: 0 — no signal there in reality (City signal registry + OSM), so no
    // simulated cross traffic. fifteenth keeps flowing: it bridges OVER Lamar.
    const XDEMAND = { barton: 380, cesar: 520, third: 0, fifth: 900, sixth: 900,
                      ninth: 60, tenth: 70, twelfth: 260, fifteenth: 380, toomey: 0, riverside: 0 };
    const XLIMIT = 13.4; // 30 mph
    this.crossLanes = {};
    for (const [key, road] of Object.entries(geo.roads)) {
      const inter = geo.intersections.find(i => i.key === key);
      if (!inter) continue;
      const rate = (XDEMAND[key] || 0) / 3600;
      const fwd = new Path(road.pts);                       // W->E
      const rev = new Path(road.pts.slice().reverse());     // E->W
      const two = road.oneway === 0;
      const nlanes = (key === "fifth" || key === "sixth") ? 2 : 1;
      const list = [];
      const addDir = (path, dirName, r) => {
        for (let i = 0; i < nlanes; i++) {
          list.push(mk({ path, roadKey: key, dirName, idx: i,
            offset: (two ? 0.5 + i : i - (nlanes - 1) / 2) * LANE_W,
            limit: XLIMIT, spawnRate: r / nlanes, group: "cross" }));
        }
      };
      if (two) { addDir(fwd, "EB", rate); addDir(rev, "WB", rate); }
      else if (road.oneway === 1) addDir(fwd, "EB", rate);
      else addDir(rev, "WB", rate);
      this.crossLanes[key] = list;
    }

    // --- attach signals to lanes
    const crossHalf = (key) => {
      const road = geo.roads[key];
      const nl = (key === "fifth" || key === "sixth") ? 2 : (road.oneway === 0 ? 2 : 1);
      return nl * LANE_W / 2 + 5.5;
    };
    const lamarHalf = 2 * LANE_W + 5.5;
    for (const ctrl of this.controllers) {
      const it = ctrl.inter;
      const setback = crossHalf(it.key);
      // Lamar approaches
      for (const l of this.lamarLanes.NB) {
        l.signals.push({ s: it.sLamar - setback, ctrl, approach: "main" });
      }
      for (const l of this.lamarLanes.SB) {
        l.signals.push({ s: (lamarPath.len - it.sLamar) - setback, ctrl, approach: "main" });
      }
      // cross approaches
      for (const l of (this.crossLanes[it.key] || [])) {
        const sC = l.path.sNearest(it.x, it.y);
        l.signals.push({ s: sC - lamarHalf, ctrl, approach: "cross" });
      }
    }
    for (const l of lanes) l.signals.sort((a, b) => a.s - b.s);

    // --- corridor measurement window on Lamar
    const s0 = geo.intersections[0].sLamar - 130;
    const s1 = geo.intersections[geo.intersections.length - 1].sLamar + 50;
    this.measureNB = { s0, s1 };
    this.measureSB = { s0: lamarPath.len - s1, s1: lamarPath.len - s0 };
    for (const l of this.lamarLanes.NB) l.measure = this.measureNB;
    for (const l of this.lamarLanes.SB) l.measure = this.measureSB;
    this.freeFlow = (s1 - s0) / LAMAR_LIMIT;

    this.lanes = lanes;
    this.retime();
  }

  retime() {
    for (const c of this.controllers) c.retime(this.cfg, this.sLamar0);
  }
  applyDriverParams() {
    for (const l of this.lanes) for (const c of l.cars) c.applyParams(this.cfg);
  }
  remix() { // re-roll trained flags to match mix slider (deterministic-ish)
    for (const l of this.lanes) for (const c of l.cars) {
      c.trained = ((c.id * 2654435761 >>> 16) % 1000) / 1000 < this.cfg.mix;
      c.applyParams(this.cfg);
    }
  }

  /* ---------- measured-2019 demand profile ---------- */
  profileValue(arr, minutes) {
    const i = Math.floor(minutes / 15) % 96;
    const j = (i + 1) % 96;
    const f = (minutes % 15) / 15;
    return arr[i] + (arr[j] - arr[i]) * f;
  }
  demandMult(lane) {
    const cfg = this.cfg;
    if (!cfg.profileMode || !this.profile) return cfg.demand;
    const t = cfg.timeOfDay;
    if (lane.group === "NB") return this.profileValue(this.profile.nbVeh, t) / BASE_NB;
    if (lane.group === "SB") return this.profileValue(this.profile.sbVeh, t) / BASE_SB;
    // cross streets: no per-street counts — reuse the corridor's time-of-day shape,
    // scaled so its busiest moment matches the slider's 1.0x levels
    const comb = this.profileValue(this.profile.nbVeh, t) + this.profileValue(this.profile.sbVeh, t);
    return comb / this.profilePeakComb;
  }
  measuredBridgeMph(dir) {
    if (!this.profile) return null;
    const arr = dir === "NB" ? this.profile.nbSpeedMph : this.profile.sbSpeedMph;
    return this.profileValue(arr, this.cfg.timeOfDay);
  }
  sampleBridgeSpeed() { // rolling window: radar-style mean speed at the bridge
    if (!this.bridgeBuf) this.bridgeBuf = { NB: [], SB: [] };
    const r = this.geo.intersections.find(i => i.key === "riverside");
    const c = this.geo.intersections.find(i => i.key === "cesar");
    for (const dir of ["NB", "SB"]) {
      let s0 = r.sLamar + 60, s1 = c.sLamar - 40;
      if (dir === "SB") { const L = this.lamarPath.len; [s0, s1] = [L - s1, L - s0]; }
      let sum = 0, n = 0;
      for (const l of this.lamarLanes[dir]) {
        for (const car of l.cars) if (car.s >= s0 && car.s <= s1) { sum += car.v; n++; }
      }
      const buf = this.bridgeBuf[dir];
      if (n > 0) buf.push(sum / n);
      if (buf.length > 240) buf.shift(); // ~2 min at 0.5 s sampling
    }
  }
  simBridgeMph(dir) {
    const buf = this.bridgeBuf && this.bridgeBuf[dir];
    if (!buf || buf.length < 6) return null;
    return (buf.reduce((s, v) => s + v, 0) / buf.length) * 2.23694; // m/s -> mph
  }

  /* ---------- one physics step ---------- */
  step(dt) {
    const t = this.t;
    if (this.cfg.profileMode) this.cfg.timeOfDay = (this.cfg.timeOfDay + dt / 60) % 1440;
    if ((this.bridgeClock = (this.bridgeClock || 0) + dt) >= 0.5) {
      this.bridgeClock = 0;
      this.sampleBridgeSpeed();
    }
    for (const lane of this.lanes) {
      const cars = lane.cars;
      // spawn
      lane.spawnAcc += lane.spawnRate * this.demandMult(lane) * dt;
      if (lane.spawnAcc >= 1) {
        lane.spawnAcc -= 1;
        lane.outside++;
      }
      if (lane.outside > 0) {
        const last = cars[cars.length - 1];
        if (!last || last.s - last.len > 16) {
          const c = new Car(lane, this.rng, this.cfg);
          c.v = last ? Math.min(c.v, last.v + 2) : Math.min(lane.limit, 11);
          cars.push(c);
          lane.outside--;
        }
      }

      // dynamics (leader first)
      for (let i = 0; i < cars.length; i++) {
        const c = cars[i];
        const leader = i > 0 ? cars[i - 1] : null;
        this.carAccel(c, leader, i > 1 ? cars[i - 2] : null, t);
      }
      // integrate + bookkeeping
      for (let i = cars.length - 1; i >= 0; i--) {
        const c = cars[i];
        c.v = Math.max(0, c.v + c.a * dt);
        c.s += c.v * dt;
        const leader = i > 0 ? cars[i - 1] : null;
        if (leader) { // hard no-overlap guard
          const rear = leader.s - leader.len;
          if (c.s > rear - 0.25) { c.s = rear - 0.25; c.v = Math.min(c.v, leader.v); }
        }
        // metrics: stops & brakes
        const braking = c.a < -1.0 && c.v > 1.5;
        if (braking && c.brakeDebounce <= 0) { c.brakeCount++; c.brakeDebounce = 2.0; }
        c.brakeDebounce -= dt;
        c.braking = c.a < -1.0 || (c.v < 0.3 && this.nearRed(c));
        if (c.v < 0.4 && c.lastStopV > 2.2) { c.stopCount++; c.lastStopV = 0; }
        if (c.v > 2.2) c.lastStopV = c.v;
        // corridor window
        if (lane.measure) {
          if (c.enteredAt < 0 && c.s >= lane.measure.s0 && c.s < lane.measure.s1) {
            c.enteredAt = t; c.stopCount = 0; c.brakeCount = 0;
          } else if (c.enteredAt >= 0 && c.s >= lane.measure.s1) {
            this.completions.push({ t, dir: lane.dirName, dur: t - c.enteredAt,
                                    stops: c.stopCount, brakes: c.brakeCount });
            c.enteredAt = -2; // done
          }
        }
        // despawn
        if (c.s - c.len > lane.len) {
          if (lane.roadKey !== "lamar") this.crossCount.push({ t });
          cars.splice(i, 1);
        }
      }
    }
    // trim metric buffers
    const cutoff = t - 330;
    while (this.completions.length && this.completions[0].t < cutoff) this.completions.shift();
    while (this.crossCount.length && this.crossCount[0].t < cutoff) this.crossCount.shift();
    this.t += dt;
  }

  nearRed(c) {
    const sig = this.nextSignal(c);
    return sig && sig.s - c.s < 25 && sig.ctrl.state(this.t, sig.approach) !== "g";
  }
  nextSignal(c) {
    for (const sg of c.lane.signals) if (sg.s >= c.s - 2) return sg;
    return null;
  }

  carAccel(c, leader, leader2, t) {
    const cfg = this.cfg;
    // --- IDM vs leader (with 1-step anticipation of leader's speed for lookers-ahead)
    let a = c.aMax * (1 - Math.pow(c.v / Math.max(c.v0, 0.1), 4));
    let constraint = 1e9;
    if (leader) {
      const gap = Math.max(0.01, leader.s - leader.len - c.s);
      let vl = leader.v;
      if (c.antic > 0.4 && leader2) {
        // read the car ahead of the car ahead: use leader's projected speed
        vl = Math.min(vl, Math.max(0, leader.v + leader.a * (0.8 * c.antic)));
      }
      const dv = c.v - vl;
      const sStar = S0 + Math.max(0, c.v * c.T + (c.v * dv) / (2 * Math.sqrt(c.aMax * c.bComf)));
      a = Math.min(a, c.aMax * (1 - Math.pow(c.v / Math.max(c.v0, 0.1), 4) - (sStar / gap) * (sStar / gap)));
      constraint = gap;
    }

    // --- signal wall
    const sig = this.nextSignal(c);
    if (sig) {
      const dist = sig.s - c.s;
      const st = sig.ctrl.state(t, sig.approach);
      let stopHere = false;
      if (dist > -1) {
        if (st === "r") stopHere = dist > -1;
        else if (st === "y") {
          // latch a go/stop decision per cycle
          const cyc = Math.floor((t - sig.ctrl.offset) / sig.ctrl.cycle);
          if (!c.sigLatch || c.sigLatch.ctrlIdx !== sig.ctrl.idx || c.sigLatch.cycleN !== cyc) {
            const need = (c.v * c.v) / (2 * Math.max(0.5, dist));
            c.sigLatch = { ctrlIdx: sig.ctrl.idx, cycleN: cyc, go: need > 2.6 };
          }
          stopHere = !c.sigLatch.go;
        } else {
          // green: don't block the box — hold at line if exit side is jammed
          if (leader && dist < 26 && dist > -1) {
            const exitGap = (leader.s - leader.len) - sig.s;
            const boxLen = 18;
            if (leader.v < 0.8 && exitGap < boxLen) stopHere = true;
          }
        }
      }
      if (stopHere) {
        // perception horizon: low-anticipation drivers ignore far-away reds
        const ttl = dist / Math.max(c.v, 0.5);
        const horizon = 3.2 + 10 * c.antic;
        if (ttl < horizon || dist < 45) {
          // anticipators use latest-gentle-liftoff: hold speed, then glide in,
          // arriving at the line slow-but-rolling (the light gets time to change)
          const VC = 2.2, B_COAST = 1.05;
          const bReq = (c.v * c.v - VC * VC) / (2 * Math.max(dist - 2, 0.5));
          if (c.antic > 0.35 && dist > 12 && c.v > VC && bReq < B_COAST) {
            a = Math.min(a, bReq > 0.12 ? -bReq : 0.25); // glide / stop charging the red
          } else {
            const gap = Math.max(0.01, dist);
            const dv = c.v;
            const sStar = S0 * 0.6 + Math.max(0, c.v * c.T * 0.6 + (c.v * dv) / (2 * Math.sqrt(c.aMax * c.bComf)));
            const aSig = c.aMax * (1 - Math.pow(c.v / Math.max(c.v0, 0.1), 4) - (sStar / gap) * (sStar / gap));
            a = Math.min(a, aSig);
          }
          constraint = Math.min(constraint, dist);
        }
      }
    }

    // --- reaction delay when starting from stop
    if (c.v < 0.35) {
      const openAhead = !leader || (leader.s - leader.len - c.s > S0 + 1.2) || leader.v > 0.9;
      const sigOk = !sig || sig.s - c.s < -1 || sig.ctrl.state(t, sig.approach) === "g" ||
                    (sig.s - c.s > 30);
      if (openAhead && sigOk && a > 0.05) {
        if (c.goTimer < 0) c.goTimer = 0;
        c.goTimer += 1 / 30;
        if (c.goTimer < c.react) { a = Math.min(a, 0); c.waiting = true; }
        else c.waiting = false;
      } else { c.goTimer = -1; c.waiting = false; }
    } else { c.goTimer = -1; c.waiting = false; }

    c.a = Math.max(-8, Math.min(a, 3.5));
  }

  /* ---------- rolling metrics ---------- */
  metrics() {
    // window = 2 signal cycles so platooned arrivals don't alias against the cycle
    const t = this.t, W = Math.max(160, 2 * this.cfg.cycle), from = t - W;
    const out = {};
    for (const dir of ["NB", "SB"]) {
      const cs = this.completions.filter(c => c.dir === dir && c.t >= from);
      const n = cs.length;
      out[dir] = {
        thru: Math.round(n * 3600 / Math.min(W, Math.max(t, 30))),
        time: n ? cs.reduce((s, c) => s + c.dur, 0) / n : NaN,
        stops: n ? cs.reduce((s, c) => s + c.stops, 0) / n : NaN,
        brakes: n ? cs.reduce((s, c) => s + c.brakes, 0) / n : NaN,
      };
    }
    const xc = this.crossCount.filter(c => c.t >= from).length;
    out.cross = Math.round(xc * 3600 / Math.min(W, Math.max(t, 30)));
    out.cars = this.lanes.reduce((s, l) => s + l.cars.length, 0);
    out.outside = this.lanes.reduce((s, l) => s + l.outside, 0);
    out.freeFlow = this.freeFlow;
    return out;
  }

  reset() {
    for (const l of this.lanes) { l.cars = []; l.spawnAcc = 0; l.outside = 0; }
    this.completions = []; this.crossCount = [];
    this.bridgeBuf = null;
    this.t = 0;
  }
}
