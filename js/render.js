/* Canvas renderer: stylized real-geometry map + cars + signals + time-space diagram.
   World: meters, x east, y north. Screen: y down (flipped). */
"use strict";

const LANE_W = 3.4;

function speedColor(v, limit) {
  const stops = [
    [0.00, [192, 57, 43]],   // stopped - red
    [0.30, [226, 161, 60]],  // slow - amber
    [0.65, [61, 153, 112]],  // cruising - green
    [1.00, [46, 127, 191]],  // at limit - blue
  ];
  const t = Math.max(0, Math.min(1, v / limit));
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1], [t1, c1] = stops[i];
      const u = (t - t0) / (t1 - t0);
      const c = c0.map((a, k) => Math.round(a + (c1[k] - a) * u));
      return `rgb(${c[0]},${c[1]},${c[2]})`;
    }
  }
  return "rgb(46,127,191)";
}

class Renderer {
  constructor(canvas, sim) {
    this.cv = canvas;
    this.sim = sim;
    this.ctx = canvas.getContext("2d");
    this.view = { scale: 0.3, tx: 0, ty: 0 };
    this.buildScenery();
    this.tsd = null; // set by main
  }

  /* ---------- view ---------- */
  resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.cv.getBoundingClientRect();
    this.cv.width = Math.round(r.width * dpr);
    this.cv.height = Math.round(r.height * dpr);
    this.dpr = dpr;
    this.w = r.width; this.h = r.height;
  }
  fit(x0, y0, x1, y1, pad = 30) {
    if (this.w < 80 || this.h < 80) return; // layout not ready; frame loop refits
    const sx = (this.w - 2 * pad) / (x1 - x0);
    const sy = (this.h - 2 * pad) / (y1 - y0);
    this.view.scale = Math.min(sx, sy);
    this.view.tx = this.w / 2 - this.view.scale * (x0 + x1) / 2;
    this.view.ty = this.h / 2 + this.view.scale * (y0 + y1) / 2;
  }
  sx(x) { return this.view.tx + x * this.view.scale; }
  sy(y) { return this.view.ty - y * this.view.scale; }
  zoomAt(px, py, f) {
    const v = this.view;
    const ns = Math.max(0.1, Math.min(9, v.scale * f));
    const wx = (px - v.tx) / v.scale, wy = (v.ty - py) / v.scale;
    v.scale = ns;
    v.tx = px - wx * ns;
    v.ty = py + wy * ns;
  }

  /* ---------- precomputed scenery ---------- */
  buildScenery() {
    const g = this.sim.geo;
    const I = Object.fromEntries(g.intersections.map(i => [i.key, i]));
    this.I = I;
    // hand-placed parks anchored to real intersections (loose, stylized)
    const parks = [];
    const blob = (x0, y0, x1, y1, name, lx, ly) =>
      parks.push({ x0, y0, x1, y1, name, lx, ly });
    blob(-860, -1240, -600, -800, "ZILKER PARK", -730, -1020);
    blob(-50, -990, 400, -640, "BUTLER PARK", 175, -800);
    blob(-800, -340, -480, -80, "AUSTIN HIGH", -640, -210);
    blob(-170, 370, -30, 560, "DUNCAN PARK", -100, 465);
    blob(-40, 830, 155, 1010, "HOUSE PARK", 58, 920);
    blob(-15, 1140, 195, 1400, "PEASE PARK", 90, 1270);
    this.parks = parks;
    this.landmarks = [
      { t: "WHOLE FOODS", x: I.fifth.x + 165, y: (I.fifth.y + I.sixth.y) / 2 },
      { t: "ZACH THEATRE", x: I.toomey.x - 205, y: I.toomey.y - 60 },
      { t: "DOWNTOWN →", x: I.sixth.x + 690, y: I.sixth.y + 60 },
      { t: "LADY BIRD LAKE", x: 450, y: -510, lake: true },
    ];
    // lamar lane-divider guide lines (world polylines at lateral offsets)
    this.guides = [];
    const mkGuide = (pts, off, style) => {
      const out = [];
      for (let i = 0; i < pts.length; i++) {
        const p = pts[Math.max(0, i - 1)], q = pts[Math.min(pts.length - 1, i + 1)];
        const dx = q[0] - p[0], dy = q[1] - p[1];
        const L = Math.hypot(dx, dy) || 1;
        out.push([pts[i][0] + (dy / L) * off, pts[i][1] - (dx / L) * off]);
      }
      this.guides.push({ pts: out, style });
    };
    mkGuide(g.lamar, 0, "center");
    mkGuide(g.lamar, LANE_W, "dash");
    mkGuide(g.lamar, -LANE_W, "dash");
    for (const k of ["fifth", "sixth"]) mkGuide(g.roads[k].pts, 0, "dash");
    for (const k of ["barton", "cesar", "third", "ninth", "tenth", "twelfth", "fifteenth", "riverside", "toomey"])
      mkGuide(g.roads[k].pts, 0, "center");
    // bridge segment on Lamar (between Riverside and Cesar Chavez)
    this.bridge = { s0: I.riverside.sLamar + 55, s1: I.cesar.sLamar - 38 };
    // one-way arrows for 5th/6th
    this.arrows = [];
    for (const k of ["fifth", "sixth"]) {
      const road = g.roads[k];
      const path = new Path(road.pts);
      for (let s = 90; s < path.len - 60; s += 170) {
        const p = path.at(s);
        const dir = road.oneway; // +1 along pts (E), -1 against (W)
        this.arrows.push({ x: p.x, y: p.y, dx: p.dx * dir, dy: p.dy * dir });
      }
    }
  }

  /* ---------- drawing helpers ---------- */
  poly(pts, close = false) {
    const c = this.ctx;
    c.beginPath();
    c.moveTo(this.sx(pts[0][0]), this.sy(pts[0][1]));
    for (let i = 1; i < pts.length; i++) c.lineTo(this.sx(pts[i][0]), this.sy(pts[i][1]));
    if (close) c.closePath();
  }

  laneWpx() { return Math.max(LANE_W * this.view.scale, 2.4); }

  roadWidth(key) { // total drawn width in px
    const lw = this.laneWpx();
    if (key === "lamar") return lw * 4;
    if (key === "fifth" || key === "sixth") return lw * 2;
    return lw * 2;
  }

  /* ---------- main frame ---------- */
  draw() {
    const c = this.ctx, sim = this.sim, g = sim.geo;
    const sc = this.view.scale;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);
    c.fillStyle = "#f2efe7";
    c.fillRect(0, 0, this.w, this.h);

    // parks
    for (const p of this.parks) {
      c.fillStyle = "#dfe8cd";
      const x = this.sx(p.x0), y = this.sy(p.y1);
      const w = (p.x1 - p.x0) * sc, h = (p.y1 - p.y0) * sc;
      c.beginPath();
      c.roundRect(x, y, w, h, Math.min(26 * sc, w / 3, h / 3));
      c.fill();
    }

    // water
    c.fillStyle = "#a9cce0";
    c.strokeStyle = "#8fb9d3";
    c.lineWidth = 1.5;
    if (g.water.lake.length > 2) { this.poly(g.water.lake, true); c.fill(); c.stroke(); }
    for (const p of g.water.ponds) { this.poly(p, true); c.fill(); }
    c.strokeStyle = "#9cc3da";
    c.lineWidth = Math.max(2, 4 * sc);
    c.lineCap = "round"; c.lineJoin = "round";
    for (const cr of g.water.creeks) { this.poly(cr.pts); c.stroke(); }

    // --- roads: casings first, then fills (covers seams) ---
    const roads = [["lamar", g.lamar], ...Object.entries(g.roads).map(([k, r]) => [k, r.pts])];
    c.lineCap = "round"; c.lineJoin = "round";
    for (const [k, pts] of roads) {
      c.strokeStyle = k === "lamar" ? "#b7b1a2" : "#c9c4b6";
      c.lineWidth = this.roadWidth(k) + Math.max(2, 1.2 * sc);
      this.poly(pts); c.stroke();
    }
    for (const [k, pts] of roads) {
      c.strokeStyle = k === "lamar" ? "#efe9da" : "#e9e5da";
      c.lineWidth = this.roadWidth(k);
      this.poly(pts); c.stroke();
    }

    // bridge deck edges
    {
      const p = sim.lamarPath;
      const b = this.bridge;
      const edge = 2 * LANE_W + 1.2;
      for (const side of [-1, 1]) {
        c.beginPath();
        for (let s = b.s0; s <= b.s1; s += 12) {
          const q = p.at(s);
          const nx = q.dy * side * edge, ny = -q.dx * side * edge;
          const X = this.sx(q.x + nx), Y = this.sy(q.y + ny);
          s === b.s0 ? c.moveTo(X, Y) : c.lineTo(X, Y);
        }
        c.strokeStyle = "#8d8877";
        c.lineWidth = Math.max(1.5, 1.1 * sc);
        c.stroke();
      }
    }

    // lane guides
    if (sc > 0.55) {
      for (const gd of this.guides) {
        if (gd.style === "center") {
          c.strokeStyle = "rgba(214,168,60,0.75)";
          c.setLineDash([]);
          c.lineWidth = Math.max(0.8, 0.5 * sc);
        } else {
          c.strokeStyle = "rgba(255,255,255,0.8)";
          c.setLineDash([3.2 * sc, 4.5 * sc]);
          c.lineWidth = Math.max(0.8, 0.35 * sc);
        }
        this.poly(gd.pts); c.stroke();
      }
      c.setLineDash([]);
    }

    // one-way arrows on 5th/6th
    if (sc > 0.28) {
      c.fillStyle = "rgba(110,105,92,0.75)";
      const L = Math.max(7, 3.4 * sc);
      for (const a of this.arrows) {
        const X = this.sx(a.x), Y = this.sy(a.y);
        const dx = a.dx, dy = -a.dy;
        c.beginPath();
        c.moveTo(X + dx * L, Y + dy * L);
        c.lineTo(X - dx * L * 0.5 - dy * L * 0.45, Y - dy * L * 0.5 + dx * L * 0.45);
        c.lineTo(X - dx * L * 0.5 + dy * L * 0.45, Y - dy * L * 0.5 - dx * L * 0.45);
        c.fill();
      }
    }

    // stop lines when zoomed in
    if (sc > 0.9) {
      c.strokeStyle = "rgba(255,255,255,0.9)";
      c.lineWidth = Math.max(1.2, 0.8 * sc);
      for (const lane of sim.lanes) {
        for (const sg of lane.signals) {
          const p = lane.path.at(sg.s);
          const nx = p.dy, ny = -p.dx;
          const o0 = lane.offset - LANE_W / 2 + 0.4, o1 = lane.offset + LANE_W / 2 - 0.4;
          c.beginPath();
          c.moveTo(this.sx(p.x + nx * o0), this.sy(p.y + ny * o0));
          c.lineTo(this.sx(p.x + nx * o1), this.sy(p.y + ny * o1));
          c.stroke();
        }
      }
    }

    // cars
    const mixed = sim.cfg.mix > 0.02 && sim.cfg.mix < 0.98;
    for (const lane of sim.lanes) {
      for (const car of lane.cars) {
        const p = lane.path.at(car.s - car.len / 2);
        const nx = p.dy, ny = -p.dx;
        const X = this.sx(p.x + nx * lane.offset), Y = this.sy(p.y + ny * lane.offset);
        const ang = Math.atan2(-p.dy, p.dx);
        const Lpx = Math.max(car.len * sc, 3.4);
        const Wpx = Math.max(1.9 * sc, 2.3);
        c.save();
        c.translate(X, Y);
        c.rotate(ang);
        if (car.braking) {
          c.fillStyle = "rgba(233,64,50,0.4)";
          c.beginPath();
          c.roundRect(-Lpx / 2 - 2.5, -Wpx / 2 - 2.5, Lpx + 5, Wpx + 5, 3);
          c.fill();
        }
        c.fillStyle = speedColor(car.v, lane.limit);
        c.beginPath();
        c.roundRect(-Lpx / 2, -Wpx / 2, Lpx, Wpx, Math.min(2.5, Wpx / 2.5));
        c.fill();
        if (car.waiting) {
          c.strokeStyle = "#e2a13c";
          c.lineWidth = 1.4;
          c.strokeRect(-Lpx / 2 - 1.5, -Wpx / 2 - 1.5, Lpx + 3, Wpx + 3);
        }
        if (mixed && car.trained && Lpx > 4) {
          c.fillStyle = "rgba(255,255,255,0.95)";
          c.beginPath();
          c.arc(0, 0, Math.max(1, Wpx * 0.22), 0, 7);
          c.fill();
        }
        c.restore();
      }
    }

    // signal dots (Lamar-approach state), ring = cross state
    const SIGCOL = { g: "#2ecc71", y: "#f1c40f", r: "#e74c3c" };
    for (const ctrl of sim.controllers) {
      const X = this.sx(ctrl.inter.x), Y = this.sy(ctrl.inter.y);
      const r = Math.max(3.2, Math.min(6, 2.6 + sc * 2));
      c.beginPath();
      c.arc(X, Y, r + 2.2, 0, 7);
      c.fillStyle = "#fffdf7";
      c.fill();
      c.beginPath();
      c.arc(X, Y, r + 2.2, 0, 7);
      c.strokeStyle = SIGCOL[ctrl.state(sim.t, "cross")];
      c.lineWidth = 1.6;
      c.stroke();
      c.beginPath();
      c.arc(X, Y, r, 0, 7);
      c.fillStyle = SIGCOL[ctrl.state(sim.t, "main")];
      c.fill();
    }

    this.labels();
    this.chrome();
  }

  labels() {
    const c = this.ctx, g = this.sim.geo, sc = this.view.scale;
    c.textBaseline = "middle";
    const halo = (t, x, y, font, color, align = "left") => {
      c.font = font; c.textAlign = align;
      c.lineWidth = 3; c.strokeStyle = "rgba(250,248,240,0.9)";
      c.strokeText(t, x, y); c.fillStyle = color; c.fillText(t, x, y);
    };
    // park + landmark labels
    if (sc > 0.16) {
      for (const p of this.parks)
        halo(p.name, this.sx(p.lx), this.sy(p.ly), "600 9.5px -apple-system, sans-serif", "#7d9464", "center");
      for (const l of this.landmarks)
        halo(l.t, this.sx(l.x), this.sy(l.y),
          l.lake ? "italic 600 12px Georgia, serif" : "600 9.5px -apple-system, sans-serif",
          l.lake ? "#5b87a5" : "#8a8577", "center");
    }
    // street names at their west (or east) ends
    const NAME_AT = {
      barton: [-620, "Barton Springs Rd"], cesar: [-620, "W Cesar Chavez St"],
      third: [-260, "3rd St"], fifth: [-620, "W 5th St →"], sixth: [-620, "← W 6th St"],
      ninth: [-500, "9th St"], tenth: [-500, "10th St"], twelfth: [-560, "W 12th St"],
      fifteenth: [640, "W 15th St"], toomey: [-700, "Toomey Rd"], riverside: [240, "Riverside Dr"],
    };
    for (const [k, [lx, name]] of Object.entries(NAME_AT)) {
      const road = g.roads[k]; if (!road) continue;
      const pts = road.pts;
      let best = pts[0];
      for (const p of pts) if (Math.abs(p[0] - lx) < Math.abs(best[0] - lx)) best = p;
      const major = road.cls === "major";
      if (!major && sc < 0.24) continue;
      halo(name, this.sx(best[0]), this.sy(best[1]) - (this.roadWidth(k) / 2 + 7),
        `${major ? 600 : 500} ${major ? 11 : 10}px -apple-system, sans-serif`, "#6b675c", "center");
    }
    // Lamar labels rotated along the road
    for (const [s, txt] of [[260, "S  L A M A R  B L V D"], [2380, "N  L A M A R  B L V D"]]) {
      const p = this.sim.lamarPath.at(s);
      const X = this.sx(p.x), Y = this.sy(p.y);
      let ang = Math.atan2(-p.dy, p.dx);
      if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
      c.save(); c.translate(X, Y); c.rotate(ang);
      halo(txt, 0, 0, "700 11px -apple-system, sans-serif", "#8d8877", "center");
      c.restore();
    }
  }

  chrome() {
    const c = this.ctx;
    // scale bar + north arrow, bottom-left
    const y = this.h - 22;
    const m200 = 200 * this.view.scale;
    c.fillStyle = "#6f6a5e";
    c.strokeStyle = "#6f6a5e";
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(16, y); c.lineTo(16 + m200, y); c.stroke();
    c.font = "10px -apple-system, sans-serif"; c.textAlign = "left";
    c.fillText("200 m", 16, y - 8);
    // north arrow
    c.beginPath();
    c.moveTo(30, y - 52); c.lineTo(24, y - 32); c.lineTo(30, y - 38); c.lineTo(36, y - 32);
    c.closePath(); c.fill();
    c.fillText("N", 26, y - 60);
    c.textAlign = "right";
    c.fillStyle = "rgba(111,106,94,0.75)";
    c.fillText("map data © OpenStreetMap", this.w - 10, this.h - 8);
  }
}

/* ---------- time-space diagram ---------- */
class TSD {
  constructor(canvas, sim) {
    this.cv = canvas; this.sim = sim;
    this.ctx = canvas.getContext("2d");
    this.off = document.createElement("canvas");
    this.off.width = 640; this.off.height = 170;
    this.octx = this.off.getContext("2d");
    this.octx.fillStyle = "#131a21";
    this.octx.fillRect(0, 0, this.off.width, this.off.height);
    this.lastSample = 0;
  }
  yOf(s) {
    const m = this.sim.measureNB;
    return this.off.height * (1 - (s - m.s0) / (m.s1 - m.s0));
  }
  sample() {
    const o = this.octx, sim = this.sim, W = this.off.width, H = this.off.height;
    o.drawImage(this.off, -1, 0);
    o.fillStyle = "#131a21";
    o.fillRect(W - 1, 0, 1, H);
    // signal rows
    for (const ctrl of sim.controllers) {
      const st = ctrl.state(sim.t, "main");
      if (st === "g") continue;
      o.fillStyle = st === "r" ? "#c0392b" : "#a97b23";
      o.fillRect(W - 1, this.yOf(ctrl.inter.sLamar) - 0.5, 1, 1.6);
    }
    // northbound cars
    for (const lane of sim.lamarLanes.NB) {
      for (const car of lane.cars) {
        if (car.s < sim.measureNB.s0 || car.s > sim.measureNB.s1) continue;
        o.fillStyle = speedColor(car.v, lane.limit);
        o.globalAlpha = 0.9;
        o.fillRect(W - 1, this.yOf(car.s), 1, 1);
      }
    }
    o.globalAlpha = 1;
  }
  maybeSample() {
    if (this.sim.t - this.lastSample >= 0.5) {
      this.sample();
      this.lastSample = this.sim.t;
    }
  }
  blit() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.cv.getBoundingClientRect();
    if (r.width === 0) return;
    if (this.cv.width !== Math.round(r.width * dpr)) {
      this.cv.width = Math.round(r.width * dpr);
      this.cv.height = Math.round(r.height * dpr);
    }
    const c = this.ctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.imageSmoothingEnabled = false;
    c.drawImage(this.off, 0, 0, r.width, r.height);
  }
}
