/* The Cockpit: demo 04's blind-spot geometry, seen from the driver's seat.
   World frame (same as mirrors/): your car at origin facing +y. x right,
   y forward, z up, meters. Angles: degrees CCW from +x — 90 = straight ahead,
   270 = straight back.

   The view is ONE planar pinhole camera at the driver's eye (left seat), with
   a turnable head (±60°, like a neck): the cabin — pillars, roof, dash, doors,
   seats — is real 3D geometry drawn over the world, and the windows are the
   gaps. Mirrors are billboards anchored to the cabin whose glass is rendered
   by its own fixed backward camera (demo 04's cones), horizontally flipped
   like glass. Traffic is a stream of overtakers on random sides; some start
   in your lane and merge out before passing. */
"use strict";

const LANE_W = 3.4;
const CAR = { len: 4.6, wid: 1.9 };
const EYE      = { x: -0.35, y: 0.6,  z: 1.15 };
const REARVIEW = { x: 0,     y: 0.9,  z: 1.25 };
const MIR_L    = { x: -1.0,  y: 0.75, z: 0.95 };
const MIR_R    = { x: 1.0,   y: 0.75, z: 0.95 };

const FOV = { forwardHalf: 70, rearHalf: 15, sideHalf: 8, range: 70 };
const OWN_V = 29;                       // your speed (~65 mph) — scenery stream only
const HFOV = 122;                       // head-still view width: both mirrors visible
const HEAD_MAX = 60;                    // we aren't owls

const cfg = { left: 3, right: 3, pass: 5, share: 50 };

const deg = Math.PI / 180;
function angDiff(a, b) {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

/* ---------- the zone model, verbatim from demo 04 (numbers must agree) ---------- */
function zones() {
  return [
    { key: "eyes", origin: EYE, dir: 90, half: FOV.forwardHalf, color: "#3d9970" },
    { key: "glassL", origin: EYE, dir: 152, half: 31, color: "#3d9970", range: 8 },
    { key: "glassR", origin: EYE, dir: 28, half: 31, color: "#3d9970", range: 8 },
    { key: "rear", origin: REARVIEW, dir: 270, half: FOV.rearHalf, color: "#2e7fbf" },
    { key: "mirL", origin: MIR_L, dir: 270 - cfg.left, half: FOV.sideHalf, color: "#7c5cb8" },
    { key: "mirR", origin: MIR_R, dir: 270 + cfg.right, half: FOV.sideHalf, color: "#7c5cb8" },
  ];
}
function pointInZone(z, px, py) {
  const dx = px - z.origin.x, dy = py - z.origin.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.3 || d > (z.range || FOV.range)) return false;
  const ang = Math.atan2(dy, dx) / deg;
  return Math.abs(angDiff(ang, z.dir)) <= z.half;
}
function coverage(cx, cy) {
  const pts = [[cx, cy], [cx - 0.8, cy + 1.9], [cx + 0.8, cy + 1.9], [cx - 0.8, cy - 1.9], [cx + 0.8, cy - 1.9]];
  const seen = new Set();
  for (const z of zones()) {
    if (pts.some(([x, y]) => pointInZone(z, x, y))) seen.add(z.key);
  }
  return seen;
}
function blindSpan(laneX) {
  let worst = 0, cur = 0, curStart = null;
  for (let y = -26; y <= 6; y += 0.2) {
    const covered = coverage(laneX, y).size > 0;
    if (!covered) {
      if (curStart === null) curStart = y;
      cur = y - curStart + 0.2;
      if (cur > worst) worst = cur;
    } else curStart = null;
  }
  return worst;
}
function selfInMirror() {
  const pts = [];
  for (let y = -CAR.len / 2; y <= CAR.len / 2; y += 0.3) {
    pts.push([-CAR.wid / 2, y], [CAR.wid / 2, y]);
  }
  const zs = zones();
  const mL = zs.find(z => z.key === "mirL"), mR = zs.find(z => z.key === "mirR");
  return pts.some(([x, y]) => pointInZone(mL, x, y)) || pts.some(([x, y]) => pointInZone(mR, x, y));
}

/* ---------- traffic: a stream of overtakers ---------- */
const rng = LAB.mulberry32(20260705);
const PALETTE = ["#8d939b", "#a89a84", "#98a3ad", "#7f8a94", "#9b8f9e", "#87909a"];
let cars = [];              // every car is faster than you and passes
let spawnIn = 1.5;          // s until next spawn
let odo = 0;
let paused = false;
let lastInvis = null;       // invisible seconds of the last completed pass

function mkCar(o = {}) {
  const roll = rng();
  const profile = o.profile ?? (roll < 0.28 ? "quick" : roll < 0.72 ? "steady" : "lurker");
  return {
    side: o.side ?? (rng() < cfg.share / 100 ? -1 : 1),   // -1 = passes on your left
    mid: o.mid ?? (rng() < 0.4),                          // starts in YOUR lane, merges out
    prog: o.mid ? 0 : 1,                                  // lane-change progress
    y: o.y ?? -46,
    profile,
    jit: o.jit ?? (profile === "quick" ? 1.4 + 0.6 * rng() : 0.8 + 0.4 * rng()),
    lurk: profile === "lurker" ? 4 + 4 * rng() : 0,       // seconds camped at your quarter
    color: PALETTE[Math.floor(rng() * PALETTE.length)],
    col: "#8d939b",                                        // zone-painted each frame
    invis: 0,
    done: false,
    seen: new Set(),
  };
}
const ease = p => p * p * (3 - 2 * p);
const carX = c => c.side * LANE_W * ease(Math.min(1, c.prog));

function advance(dt) {
  odo += OWN_V * dt;
  spawnIn -= dt;
  if (spawnIn <= 0) {
    if (cars.length < 3 && !cars.some(c => c.y < -34)) {
      cars.push(mkCar());
      spawnIn = 4 + 8 * rng();
    } else spawnIn = 1;
  }
  for (const c of cars) {
    let v = Math.max(0.8, cfg.pass) * c.jit;
    if (c.lurk > 0 && c.y > -6.5 && c.y < -2.2) {   // a camper: sits at your rear quarter
      c.lurk -= dt;
      v = Math.min(v, 0.3);
    }
    c.y += v * dt;
    if (c.mid && c.prog === 0 && c.y > -20) c.prog = 1e-6;   // signal on, move over
    if (c.prog > 0 && c.prog < 1) c.prog = Math.min(1, c.prog + dt / 2);
    if (c.y > -30 && c.y < 8 && coverage(carX(c), c.y).size === 0) c.invis += dt;
    if (!c.done && c.y >= 8) { c.done = true; lastInvis = c.invis; }
  }
  cars = cars.filter(c => c.y < 44);
}

/* head turn: 0 = facing forward, positive = looking left (degrees) */
let head = 0, headDrag = null, keyLook = 0, hookLook = null;
function headGoal() {
  if (headDrag) return headDrag.yaw;
  if (keyLook) return keyLook;
  return hookLook ?? 0;
}

/* ---------- tiny 3D pipeline ---------- */
const NEAR = 0.18;
function makeCam(pos, dirDeg, flip, focal, cx, hy) {
  const a = dirDeg * deg;
  return { px: pos.x, py: pos.y, pz: pos.z,
           fx: Math.cos(a), fy: Math.sin(a),
           rx: Math.sin(a), ry: -Math.cos(a),
           flip, focal, cx, hy };
}
function camPt(c, x, y, z) {
  const dx = x - c.px, dy = y - c.py;
  return [(dx * c.rx + dy * c.ry) * c.flip, z - c.pz, dx * c.fx + dy * c.fy];
}
function clipNear(pts) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    if (a[2] > NEAR) out.push(a);
    if ((a[2] > NEAR) !== (b[2] > NEAR)) {
      const t = (NEAR - a[2]) / (b[2] - a[2]);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, NEAR]);
    }
  }
  return out;
}
const SX = (c, p) => c.cx + p[0] / p[2] * c.focal;
const SY = (c, p) => c.hy - p[1] / p[2] * c.focal;

function poly(ctx, c, wpts, fill) {
  let pts = wpts.map(p => camPt(c, p[0], p[1], p[2]));
  if (!pts.some(p => p[2] > NEAR)) return;
  pts = clipNear(pts);
  if (pts.length < 3) return;
  ctx.beginPath();
  ctx.moveTo(SX(c, pts[0]), SY(c, pts[0]));
  for (let i = 1; i < pts.length; i++) ctx.lineTo(SX(c, pts[i]), SY(c, pts[i]));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const ch = s => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * f)));
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

/* axis-aligned box, painter-sorted faces (bottom face never visible here) */
function box(ctx, c, x0, x1, y0, y1, z0, z1, cols) {
  const P = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
             [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const faces = [
    { i: [0, 1, 5, 4], col: cols.end },   // rear
    { i: [3, 2, 6, 7], col: cols.end },   // front
    { i: [0, 3, 7, 4], col: cols.side },  // left
    { i: [1, 2, 6, 5], col: cols.side },  // right
    { i: [4, 5, 6, 7], col: cols.top },
  ];
  const depth = f => f.i.reduce((s, k) => s + camPt(c, ...P[k])[2], 0);
  faces.map(f => ({ f, z: depth(f) })).sort((a, b) => b.z - a.z)
    .forEach(({ f }) => poly(ctx, c, f.i.map(k => P[k]), f.col));
}

function drawVehicle(ctx, c, v) {
  const w = CAR.wid * 0.49, l = CAR.len / 2;
  poly(ctx, c, [[v.x - w - 0.12, v.y - l - 0.15, 0.01], [v.x + w + 0.12, v.y - l - 0.15, 0.01],
                [v.x + w + 0.12, v.y + l + 0.15, 0.01], [v.x - w - 0.12, v.y + l + 0.15, 0.01]],
       "rgba(35,48,58,0.16)");
  box(ctx, c, v.x - w, v.x + w, v.y - l, v.y + l, 0.24, 0.92,
      { top: shade(v.color, 1.22), side: v.color, end: shade(v.color, 0.76) });
  box(ctx, c, v.x - w * 0.8, v.x + w * 0.8, v.y - l * 0.55 - 0.25, v.y + l * 0.3 - 0.25, 0.92, 1.4,
      { top: shade(v.color, 1.1), side: "#3a4754", end: "#333f4a" });
  // wheels on the camera-facing flank, foreshortened like the flank itself
  const fx = c.px < v.x ? v.x - w : v.x + w;
  for (const wy of [v.y - 1.42, v.y + 1.42]) {
    const p = camPt(c, fx, wy, 0.31);
    if (p[2] <= NEAR) continue;
    const r = 0.31 * c.focal / p[2];
    const fs = Math.abs(c.px - fx) / Math.hypot(c.px - fx, c.py - wy);
    if (r * fs < 0.7) continue;
    ctx.fillStyle = "#1c2126";
    ctx.beginPath();
    ctx.ellipse(SX(c, p), SY(c, p), r * fs, r, 0, 0, 7);
    ctx.fill();
  }
}

/* deterministic scatter for trees (no Math.random — stable across frames) */
function hash01(k) { const s = Math.sin(k * 127.1) * 43758.5453; return s - Math.floor(s); }
function ridgeZ(az) {
  return Math.max(1.5, 7 + 4 * Math.sin(az * 0.11) + 2.4 * Math.sin(az * 0.31 + 2) + 1.3 * Math.sin(az * 0.71 + 5));
}

/* one full scene render through one camera into one clipped viewport */
function renderWorld(ctx, cam, bb /*{x0,y0,x1,y1}*/, opts = {}) {
  // sky + ground split at the camera's horizon row
  let g = ctx.createLinearGradient(0, bb.y0, 0, cam.hy);
  g.addColorStop(0, "#9ec4e0"); g.addColorStop(1, "#eceadb");
  ctx.fillStyle = g;
  ctx.fillRect(bb.x0, bb.y0, bb.x1 - bb.x0, Math.max(0, cam.hy - bb.y0));
  g = ctx.createLinearGradient(0, cam.hy, 0, bb.y1);
  g.addColorStop(0, "#b6bd9e"); g.addColorStop(1, "#a2ab8b");
  ctx.fillStyle = g;
  ctx.fillRect(bb.x0, cam.hy, bb.x1 - bb.x0, Math.max(0, bb.y1 - cam.hy));

  // low sun, up-left of the road
  const sun = camPt(cam, 500 * Math.cos(118 * deg), 500 * Math.sin(118 * deg), 130);
  if (sun[2] > NEAR) {
    const sx = SX(cam, sun), sy = SY(cam, sun), R = cam.focal * 0.13;
    const rg = ctx.createRadialGradient(sx, sy, 0, sx, sy, R);
    rg.addColorStop(0, "rgba(255,251,236,0.95)");
    rg.addColorStop(0.35, "rgba(255,251,236,0.5)");
    rg.addColorStop(1, "rgba(255,251,236,0)");
    ctx.fillStyle = rg;
    ctx.fillRect(sx - R, sy - R, 2 * R, 2 * R);
  }

  // distant ridge, a function of world azimuth so every view lines up
  const halfAng = Math.atan(((bb.x1 - bb.x0) / 2) / cam.focal) / deg + 8;
  const pts = [];
  for (let a = -halfAng; a <= halfAng; a += 3) {
    const az = (cam.flip < 0 ? -a : a) + Math.atan2(cam.fy, cam.fx) / deg;
    const p = camPt(cam, cam.px + 460 * Math.cos(az * deg), cam.py + 460 * Math.sin(az * deg), ridgeZ(az));
    if (p[2] > NEAR) pts.push([SX(cam, p), SY(cam, p)]);
  }
  if (pts.length > 2) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], cam.hy + 1);
    for (const [x, y] of pts) ctx.lineTo(x, y);
    ctx.lineTo(pts[pts.length - 1][0], cam.hy + 1);
    ctx.closePath();
    ctx.fillStyle = "#c8c4ae";
    ctx.fill();
  }

  // road: asphalt, edge lines, streaming lane dashes
  const RW = 1.5 * LANE_W + 0.8;
  poly(ctx, cam, [[-RW, -160, 0], [RW, -160, 0], [RW, 240, 0], [-RW, 240, 0]], "#cfc9bb");
  for (const ex of [-RW + 0.25, RW - 0.25]) {
    poly(ctx, cam, [[ex - 0.07, -160, 0.002], [ex + 0.07, -160, 0.002], [ex + 0.07, 240, 0.002], [ex - 0.07, 240, 0.002]], "#eee9dc");
  }
  for (const lx of [-LANE_W / 2, LANE_W / 2]) {
    const k0 = Math.floor((odo - 160) / 12), k1 = Math.ceil((odo + 240) / 12);
    for (let k = k0; k <= k1; k++) {
      const y = k * 12 - odo;
      poly(ctx, cam, [[lx - 0.07, y, 0.003], [lx + 0.07, y, 0.003], [lx + 0.07, y + 3, 0.003], [lx - 0.07, y + 3, 0.003]], "#fbf9f2");
    }
  }

  // roadside posts and trees (world-fixed, streaming past)
  for (let k = Math.floor((odo - 140) / 26); k <= Math.ceil((odo + 260) / 26); k++) {
    const y = k * 26 - odo;
    for (const x of [-7.2, 7.2]) {
      const b = camPt(cam, x, y, 0), t = camPt(cam, x, y, 1.05);
      if (b[2] <= NEAR || t[2] <= NEAR) continue;
      ctx.strokeStyle = "#8a8577";
      ctx.lineWidth = Math.max(0.8, 0.06 * cam.focal / b[2]);
      ctx.beginPath();
      ctx.moveTo(SX(cam, b), SY(cam, b));
      ctx.lineTo(SX(cam, t), SY(cam, t));
      ctx.stroke();
    }
  }
  for (let k = Math.floor((odo - 140) / 34); k <= Math.ceil((odo + 260) / 34); k++) {
    const h = hash01(k);
    const y = k * 34 + h * 12 - odo;
    const x = (h < 0.5 ? -1 : 1) * (11 + 14 * hash01(k * 7 + 1));
    const r = 1.7 + 1.9 * hash01(k * 13 + 2);
    const b = camPt(cam, x, y, 0), tp = camPt(cam, x, y, r * 1.1);
    if (b[2] <= NEAR) continue;
    const pr = r * cam.focal / b[2];
    if (pr < 0.8) continue;
    ctx.strokeStyle = "#7a6a55";
    ctx.lineWidth = Math.max(0.8, 0.14 * cam.focal / b[2]);
    ctx.beginPath();
    ctx.moveTo(SX(cam, b), SY(cam, b));
    ctx.lineTo(SX(cam, tp), SY(cam, tp));
    ctx.stroke();
    const cpt = camPt(cam, x, y, r * 1.1 + r * 0.55);
    ctx.fillStyle = h < 0.5 ? "#8fa77a" : "#84a06f";
    ctx.beginPath();
    ctx.arc(SX(cam, cpt), SY(cam, cpt), pr * 0.62, 0, 7);
    ctx.fill();
  }

  // vehicles, far to near
  const list = cars.map(c => ({ x: carX(c), y: c.y, color: c.col }));
  if (opts.ownCar) list.push({ x: 0, y: 0, color: "#23303a" });
  list.map(v => ({ v, d: (v.x - cam.px) ** 2 + (v.y - cam.py) ** 2 }))
    .sort((a, b) => b.d - a.d)
    .forEach(({ v }) => drawVehicle(ctx, cam, v));
}

/* ---------- the cabin, as geometry in car space (cosmetic — zones don't see it) ----------
   The B-pillar sits at your shoulder (y ≈ 0.5), so a glance shows: your window,
   pillar, then the rear door's separate window — not one endless pane. */
const CABIN = [
  // roof + windshield header (the header runs the full width to meet the rails —
  // no sky through the corners)
  { c: "#161c22", q: [[-0.80, 1.02, 1.42], [0.80, 1.02, 1.42], [0.80, -1.35, 1.40], [-0.80, -1.35, 1.40]] },
  { c: "#1b222a", q: [[-0.66, 1.18, 1.36], [0.66, 1.18, 1.36], [0.80, 1.02, 1.42], [-0.80, 1.02, 1.42]] },
  // roof side rails, down to the window tops
  { c: "#1b222a", q: [[-0.80, 1.02, 1.40], [-0.80, -1.35, 1.40], [-0.86, -1.35, 1.33], [-0.86, 1.02, 1.33]] },
  { c: "#1b222a", q: [[0.80, 1.02, 1.40], [0.80, -1.35, 1.40], [0.86, -1.35, 1.33], [0.86, 1.02, 1.33]] },
  // A-pillars: each one's top edge butts the header/rail corner — attached, not floating
  // (the right one is raked forward so the right window and its mirror stay in view)
  { c: "#232b33", q: [[-0.84, 1.62, 0.98], [-0.66, 1.18, 1.36], [-0.80, 1.02, 1.42], [-0.92, 1.35, 0.93]] },
  { c: "#232b33", q: [[0.84, 1.62, 0.98], [0.66, 1.18, 1.36], [0.80, 1.02, 1.42], [0.93, 1.80, 0.94]] },
  // dash: top surface + face toward you
  { c: "#2a323b", q: [[-0.90, 1.15, 0.96], [0.90, 1.15, 0.96], [0.84, 1.60, 0.99], [-0.84, 1.60, 0.99]] },
  { c: "#20272e", q: [[-0.90, 1.15, 0.58], [0.90, 1.15, 0.58], [0.90, 1.15, 0.96], [-0.90, 1.15, 0.96]] },
  // front doors below the beltline (glass above, up to the B-pillar at your shoulder)
  { c: "#262e36", q: [[-0.90, 1.40, 0.95], [-0.88, 0.43, 0.95], [-0.88, 0.43, 0.22], [-0.90, 1.40, 0.22]] },
  { c: "#262e36", q: [[0.90, 1.60, 0.95], [0.88, 0.43, 0.95], [0.88, 0.43, 0.22], [0.90, 1.60, 0.22]] },
  // B-pillars, right behind your shoulder
  { c: "#1d242b", q: [[-0.88, 0.55, 0.90], [-0.88, 0.43, 0.90], [-0.85, 0.43, 1.36], [-0.85, 0.55, 1.36]] },
  { c: "#1d242b", q: [[0.88, 0.55, 0.90], [0.88, 0.43, 0.90], [0.85, 0.43, 1.36], [0.85, 0.55, 1.36]] },
  // rear doors below their glass, C-pillars, rear seatback + headrests
  { c: "#242c34", q: [[-0.88, 0.43, 0.95], [-0.86, -2.10, 0.95], [-0.86, -2.10, 0.28], [-0.88, 0.43, 0.28]] },
  { c: "#242c34", q: [[0.88, 0.43, 0.95], [0.86, -2.10, 0.95], [0.86, -2.10, 0.28], [0.88, 0.43, 0.28]] },
  { c: "#1d242b", q: [[-0.86, -1.30, 0.92], [-0.84, -1.58, 0.92], [-0.84, -1.58, 1.36], [-0.86, -1.30, 1.36]] },
  { c: "#1d242b", q: [[0.86, -1.30, 0.92], [0.84, -1.58, 0.92], [0.84, -1.58, 1.36], [0.86, -1.30, 1.36]] },
  { c: "#2b333c", q: [[-0.82, -1.30, 0.35], [0.82, -1.30, 0.35], [0.82, -1.30, 1.04], [-0.82, -1.30, 1.04]] },
  { c: "#242c34", q: [[-0.55, -1.28, 1.04], [-0.25, -1.28, 1.04], [-0.25, -1.28, 1.26], [-0.55, -1.28, 1.26]] },
  { c: "#242c34", q: [[0.25, -1.28, 1.04], [0.55, -1.28, 1.04], [0.55, -1.28, 1.26], [0.25, -1.28, 1.26]] },
  // passenger seat + headrest (you look past it out the right window)
  { c: "#2b333c", q: [[0.12, -0.30, 0.30], [0.62, -0.30, 0.30], [0.62, -0.30, 1.06], [0.12, -0.30, 1.06]] },
  { c: "#242c34", q: [[0.22, -0.28, 1.10], [0.52, -0.28, 1.10], [0.52, -0.28, 1.30], [0.22, -0.28, 1.30]] },
  // the glass itself — faint, but it makes "through a window" read as through a window
  { c: "rgba(168,198,220,0.09)", q: [[-0.84, 1.62, 0.98], [0.84, 1.62, 0.98], [0.66, 1.18, 1.36], [-0.66, 1.18, 1.36]] },
  { c: "rgba(168,198,220,0.12)", q: [[-0.89, 1.33, 0.95], [-0.87, 0.55, 0.95], [-0.85, 0.55, 1.33], [-0.87, 1.26, 1.33]] },
  { c: "rgba(168,198,220,0.12)", q: [[0.89, 1.56, 0.95], [0.87, 0.55, 0.95], [0.85, 0.55, 1.33], [0.87, 1.48, 1.33]] },
  { c: "rgba(168,198,220,0.12)", q: [[-0.88, 0.43, 0.95], [-0.86, -1.30, 0.95], [-0.84, -1.30, 1.33], [-0.86, 0.43, 1.33]] },
  { c: "rgba(168,198,220,0.12)", q: [[0.88, 0.43, 0.95], [0.86, -1.30, 0.95], [0.84, -1.30, 1.33], [0.86, 0.43, 1.33]] },
  // instrument pod: an upright binnacle behind the wheel, not a slab on the dash
  { c: "#1a212a", q: [[-0.62, 1.10, 0.92], [-0.08, 1.10, 0.92], [-0.08, 1.17, 0.64], [-0.62, 1.17, 0.64]] },
];
/* the dash screen: an upright panel in the center stack, toed toward the driver */
const BEZEL_Q  = [[-0.08, 1.075, 0.925], [0.28, 1.13, 0.925], [0.28, 1.15, 0.705], [-0.08, 1.095, 0.705]];
const SCREEN_Q = [[-0.055, 1.079, 0.895], [0.255, 1.126, 0.895], [0.255, 1.142, 0.735], [-0.055, 1.095, 0.735]];
const GAUGES = [{ p: [-0.475, 1.09, 0.80], frac: 0.29 }, { p: [-0.235, 1.09, 0.80], frac: 0.54 }];
const WHEEL = { C: [-0.35, 1.0, 0.81], R: 0.19, v: [0, -Math.sin(25 * deg), Math.cos(25 * deg)] };
/* mirrors are oriented 3D rectangles angled at the driver, bolted to the sail
   panel at each front window's leading corner (cabin art — the glass CONTENT
   still comes from demo 04's cone origins, unchanged) */
const RV_C = [-0.02, 1.25, 1.30];       // glass centers
const ML_C = [-1.04, 1.37, 1.05];
const MR_C = [1.04, 1.58, 1.05];
const SAIL_L = [[-0.872, 1.42, 0.95], [-0.872, 1.16, 0.95], [-0.872, 1.42, 1.22]];
const SAIL_R = [[0.872, 1.64, 0.95], [0.872, 1.34, 0.95], [0.872, 1.64, 1.22]];
const ARM_L = [[-0.875, 1.31, 0.99], [-0.875, 1.41, 0.99], [-1.04, 1.40, 1.04], [-1.04, 1.33, 1.04]];
const ARM_R = [[0.875, 1.48, 0.99], [0.875, 1.58, 0.99], [1.04, 1.62, 1.04], [1.04, 1.54, 1.04]];

/* ---------- oriented glass: a rectangle in car space facing the driver ---------- */
function norm3(v) { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; }
function cross3(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function glassQuad(C, w, h, biasY) {
  // normal points at the driver's eye, biased rearward like real mirror glass
  const n = norm3([EYE.x - C[0], EYE.y - C[1] + biasY, EYE.z - C[2]]);
  const u = norm3(cross3([0, 0, 1], n));
  const v = cross3(n, u);
  const q = (su, sv) => [C[0] + u[0] * su + v[0] * sv, C[1] + u[1] * su + v[1] * sv, C[2] + u[2] * su + v[2] * sv];
  return [q(-w / 2, h / 2), q(w / 2, h / 2), q(w / 2, -h / 2), q(-w / 2, -h / 2)];  // TL TR BR BL
}

function drawCabin(ctx, cam) {
  CABIN.map(o => {
    const z = o.q.reduce((s, p) => s + camPt(cam, ...p)[2], 0);
    return { o, z };
  }).sort((a, b) => b.z - a.z)
    .forEach(({ o }) => poly(ctx, cam, o.q, o.c));

  // gauges, projected onto the pod
  for (const g of GAUGES) {
    const p = camPt(cam, ...g.p);
    if (p[2] <= NEAR) continue;
    const gx = SX(cam, p), gy = SY(cam, p), r = 0.055 * cam.focal / p[2];
    if (gx < -60 || gx > ctx.canvas.width + 60) continue;
    ctx.fillStyle = "#0d1116";
    ctx.beginPath(); ctx.arc(gx, gy, r, 0, 7); ctx.fill();
    ctx.strokeStyle = "#46525d";
    ctx.lineWidth = Math.max(1, r * 0.05);
    ctx.stroke();
    ctx.strokeStyle = "#77828c";
    ctx.lineWidth = Math.max(0.8, r * 0.035);
    const ga = f => (210 - 240 * f) * deg;
    for (let i = 0; i <= 6; i++) {
      const a = ga(i / 6);
      ctx.beginPath();
      ctx.moveTo(gx + Math.cos(a) * r * 0.76, gy - Math.sin(a) * r * 0.76);
      ctx.lineTo(gx + Math.cos(a) * r * 0.92, gy - Math.sin(a) * r * 0.92);
      ctx.stroke();
    }
    const na = ga(g.frac);
    ctx.strokeStyle = "#d95f4b";
    ctx.lineWidth = Math.max(1.2, r * 0.06);
    ctx.beginPath();
    ctx.moveTo(gx, gy);
    ctx.lineTo(gx + Math.cos(na) * r * 0.8, gy - Math.sin(na) * r * 0.8);
    ctx.stroke();
  }

  // the dash screen: demo 04's top-down view, affine-mapped into its bezel
  // (drawn after the sorted quads so the dash never overpaints it)
  poly(ctx, cam, BEZEL_Q, "#10151a");
  const sp = SCREEN_Q.map(p => camPt(cam, ...p));
  if (sp.every(p => p[2] > NEAR)) {
    const s = sp.map(p => [SX(cam, p), SY(cam, p)]);
    drawMinimap(mmx, { x: 0, y: 0, w: mm.width, h: mm.height });
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(s[0][0], s[0][1]);
    for (let i = 1; i < 4; i++) ctx.lineTo(s[i][0], s[i][1]);
    ctx.closePath();
    ctx.clip();
    ctx.transform((s[1][0] - s[0][0]) / mm.width, (s[1][1] - s[0][1]) / mm.width,
                  (s[3][0] - s[0][0]) / mm.height, (s[3][1] - s[0][1]) / mm.height,
                  s[0][0], s[0][1]);
    ctx.drawImage(mm, 0, 0);
    ctx.restore();
  }

  // steering wheel: a tilted ring in 3D, directly in front of YOUR seat
  const Cw = camPt(cam, ...WHEEL.C);
  if (Cw[2] > NEAR) {
    const rim = [];
    let behind = false;
    for (let th = 0; th < 360; th += 12) {
      const p = camPt(cam,
        WHEEL.C[0] + WHEEL.R * Math.cos(th * deg),
        WHEEL.C[1] + WHEEL.R * Math.sin(th * deg) * WHEEL.v[1],
        WHEEL.C[2] + WHEEL.R * Math.sin(th * deg) * WHEEL.v[2]);
      if (p[2] <= NEAR) { behind = true; break; }
      rim.push([SX(cam, p), SY(cam, p)]);
    }
    if (!behind) {
      const lw = 0.032 * cam.focal / Cw[2];
      ctx.strokeStyle = "#0a0e13";
      ctx.lineWidth = lw;
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(rim[0][0], rim[0][1]);
      for (const [x, y] of rim) ctx.lineTo(x, y);
      ctx.closePath();
      ctx.stroke();
      ctx.strokeStyle = "#2c3641";           // rim highlight so it reads against the pod
      ctx.lineWidth = Math.max(1, lw * 0.22);
      ctx.stroke();
      ctx.lineCap = "round";
      ctx.lineWidth = lw * 0.75;
      for (const a of [200, 340, 90]) {
        const p1 = camPt(cam,
          WHEEL.C[0] + WHEEL.R * 0.92 * Math.cos(a * deg),
          WHEEL.C[1] + WHEEL.R * 0.92 * Math.sin(a * deg) * WHEEL.v[1],
          WHEEL.C[2] + WHEEL.R * 0.92 * Math.sin(a * deg) * WHEEL.v[2]);
        ctx.beginPath();
        ctx.moveTo(SX(cam, Cw), SY(cam, Cw));
        ctx.lineTo(SX(cam, p1), SY(cam, p1));
        ctx.stroke();
      }
      ctx.lineCap = "butt";
      ctx.fillStyle = "#1a2129";
      ctx.beginPath();
      ctx.arc(SX(cam, Cw), SY(cam, Cw), lw * 1.1, 0, 7);
      ctx.fill();
    }
  }
}

/* ---------- mirrors: real angled rectangles with texture-mapped glass ---------- */
const texL = document.createElement("canvas"); texL.width = 300; texL.height = 195;
const texR = document.createElement("canvas"); texR.width = 300; texR.height = 195;
const texRV = document.createElement("canvas"); texRV.width = 460; texRV.height = 145;

function renderMirrorTex(tex, pos, dirDeg, hFovDeg, opts = {}) {
  const tx = tex.getContext("2d");
  tx.setTransform(1, 0, 0, 1, 0, 0);
  const cam = makeCam(pos, dirDeg, -1, (tex.width / 2) / Math.tan(hFovDeg / 2 * deg),
                      tex.width / 2, tex.height * 0.44);
  renderWorld(tx, cam, { x0: 0, y0: 0, x1: tex.width, y1: tex.height }, { ownCar: opts.ownCar });
  if (opts.headrests) {                 // the rear-view sees a hint of your own cabin
    tx.fillStyle = "rgba(24,30,36,0.55)";
    for (const fx of [0.26, 0.62]) {
      tx.beginPath();
      tx.roundRect(tex.width * fx, tex.height * 0.84, tex.width * 0.13, tex.height * 0.3, 6);
      tx.fill();
    }
  }
  const glare = tx.createLinearGradient(0, 0, tex.width, tex.height);
  glare.addColorStop(0, "rgba(255,255,255,0.14)");
  glare.addColorStop(0.28, "rgba(255,255,255,0.03)");
  glare.addColorStop(1, "rgba(255,255,255,0)");
  tx.fillStyle = glare;
  tx.fillRect(0, 0, tex.width, tex.height);
}

/* project the glass quad, draw housing + mapped glass; returns screen bbox for drag */
function drawGlassPanel(ctx, cam, quad, tex, W, H) {
  const ps = quad.map(p => camPt(cam, ...p));
  if (ps.some(p => p[2] <= 0.2)) return null;
  const s = ps.map(p => [SX(cam, p), SY(cam, p)]);
  const xs = s.map(q => q[0]), ys = s.map(q => q[1]);
  const bb = { x: Math.min(...xs), y: Math.min(...ys) };
  bb.w = Math.max(...xs) - bb.x;
  bb.h = Math.max(...ys) - bb.y;
  if (bb.w < 10 || bb.x > W + 40 || bb.x + bb.w < -40 || bb.y > H + 40) return null;
  const cx = (xs[0] + xs[1] + xs[2] + xs[3]) / 4, cy = (ys[0] + ys[1] + ys[2] + ys[3]) / 4;
  ctx.beginPath();                       // housing: the same shape, a little bigger
  for (let i = 0; i < 4; i++) {
    const hx = cx + (s[i][0] - cx) * 1.16, hy = cy + (s[i][1] - cy) * 1.22;
    i ? ctx.lineTo(hx, hy) : ctx.moveTo(hx, hy);
  }
  ctx.closePath();
  ctx.fillStyle = "#161c22";
  ctx.fill();
  ctx.strokeStyle = "#39434d";
  ctx.lineWidth = 1;
  ctx.stroke();
  const glass = new Path2D();
  glass.moveTo(s[0][0], s[0][1]);
  for (let i = 1; i < 4; i++) glass.lineTo(s[i][0], s[i][1]);
  glass.closePath();
  ctx.save();
  ctx.clip(glass);
  ctx.transform((s[1][0] - s[0][0]) / tex.width, (s[1][1] - s[0][1]) / tex.width,
                (s[3][0] - s[0][0]) / tex.height, (s[3][1] - s[0][1]) / tex.height,
                s[0][0], s[0][1]);
  ctx.drawImage(tex, 0, 0);
  ctx.restore();
  ctx.strokeStyle = "#0d1116";
  ctx.lineWidth = 1.5;
  ctx.stroke(glass);
  return bb;
}

/* ---------- the dash screen: demo 04's top-down view, live ---------- */
const mm = document.createElement("canvas");
mm.width = 240; mm.height = 108;
const mmx = mm.getContext("2d");

function drawMinimap(ctx, r) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  ctx.fillStyle = "#131a21";
  ctx.fillRect(r.x, r.y, r.w, r.h);

  const Y0 = -34, Y1 = 12;
  const k = r.w / (Y1 - Y0);                       // isotropic px/m
  const mx = wy => r.x + (wy - Y0) * k;
  const my = wx => r.y + r.h * 0.5 + wx * k;

  ctx.fillStyle = "#1f2830";
  ctx.fillRect(r.x, my(-1.5 * LANE_W), r.w, 3 * LANE_W * k);
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.setLineDash([3, 4]);
  ctx.lineWidth = 1;
  for (const lx of [-LANE_W / 2, LANE_W / 2]) {
    ctx.beginPath();
    ctx.moveTo(r.x, my(lx));
    ctx.lineTo(r.x + r.w, my(lx));
    ctx.stroke();
  }
  ctx.setLineDash([]);

  for (const z of zones()) {
    const R = Math.min(z.range || FOV.range, 44);
    ctx.fillStyle = z.color + "30";
    ctx.beginPath();
    ctx.moveTo(mx(z.origin.y), my(z.origin.x));
    for (let a = z.dir - z.half; ; a += 4) {
      if (a > z.dir + z.half) a = z.dir + z.half;
      ctx.lineTo(mx(z.origin.y + Math.sin(a * deg) * R), my(z.origin.x + Math.cos(a * deg) * R));
      if (a >= z.dir + z.half) break;
    }
    ctx.closePath();
    ctx.fill();
  }

  const carRect = (v, col) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.roundRect(mx(v.y - CAR.len / 2), my(v.x - CAR.wid / 2), CAR.len * k, CAR.wid * k, 2);
    ctx.fill();
  };
  carRect({ x: 0, y: 0 }, "#e8e4d8");
  for (const c of cars) carRect({ x: carX(c), y: c.y }, c.col);

  ctx.fillStyle = "#5f6b76";
  ctx.font = "600 7px -apple-system, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("TOP VIEW — DEMO 04", r.x + 5, r.y + 10);
  ctx.restore();
}

/* ---------- status pill (HUD) ---------- */
function focusCar() {
  let best = null;
  for (const c of cars) {
    if (c.y < -34 || c.y > 10) continue;
    if (!best || Math.abs(c.y) < Math.abs(best.y)) best = c;
  }
  return best;
}
function statusOf(c) {
  const sideTxt = c.side < 0 ? "left" : "right";
  const seen = c.seen;
  if (seen.has("mirL") || seen.has("mirR")) return { txt: `in your ${sideTxt} side mirror`, col: "#7c5cb8" };
  if (seen.has("rear")) return { txt: "in your rear-view mirror", col: "#2e7fbf" };
  if (seen.size > 0) {
    return c.y > 6 ? { txt: "ahead — your own eyes", col: "#3d9970" }
                   : { txt: `beside you (${sideTxt}) — your own eyes`, col: "#3d9970" };
  }
  return { txt: `INVISIBLE — off your ${sideTxt} rear quarter`, col: "#c0392b" };
}
function drawStatus(ctx, st, t) {
  ctx.font = "600 12px -apple-system, sans-serif";
  const w = ctx.measureText(st.txt).width + 34;
  const x = 16, y = 12, h = 24;
  const invisible = st.col === "#c0392b";
  ctx.globalAlpha = invisible ? 0.82 + 0.18 * Math.sin(t * 7) : 1;
  ctx.fillStyle = invisible ? "#c0392b" : "rgba(255,253,247,0.94)";
  ctx.strokeStyle = st.col;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 12);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = invisible ? "#fff" : st.col;
  ctx.beginPath();
  ctx.arc(x + 14, y + h / 2, 4, 0, 7);
  ctx.fill();
  ctx.fillStyle = invisible ? "#fff" : "#23303a";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(st.txt, x + 24, y + h / 2 + 0.5);
  ctx.globalAlpha = 1;
  if (Math.abs(head) > 28) {
    ctx.font = "600 11px -apple-system, sans-serif";
    ctx.fillStyle = "rgba(255,253,247,0.95)";
    const msg = "shoulder check — the numbers only count head-still glass";
    const w2 = ctx.measureText(msg).width + 16;
    ctx.beginPath();
    ctx.roundRect(x, y + h + 6, w2, 20, 10);
    ctx.fill();
    ctx.fillStyle = "#6f6a5e";
    ctx.fillText(msg, x + 8, y + h + 16.5);
  }
  ctx.textBaseline = "alphabetic";
}

/* ---------- main frame ---------- */
const cv = document.getElementById("cab");
const ctx = cv.getContext("2d");
let L = null;

function render(t) {
  const dpr = window.devicePixelRatio || 1;
  const r = cv.getBoundingClientRect();
  if (r.width < 100 || r.height < 100) return;
  if (cv.width !== Math.round(r.width * dpr)) {
    cv.width = Math.round(r.width * dpr);
    cv.height = Math.round(r.height * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = r.width, H = r.height;
  const focal = (W / 2) / Math.tan(HFOV / 2 * deg);
  // you lean a little into a glance (cosmetic — the zone model's eye never moves)
  const eye = { x: EYE.x - 0.10 * head / HEAD_MAX, y: EYE.y, z: EYE.z };
  const cam = makeCam(eye, 90 + head, 1, focal, W / 2, 0.45 * H);
  L = { W, H };

  for (const c of cars) {
    c.seen = coverage(carX(c), c.y);
    c.col = c.seen.has("mirL") || c.seen.has("mirR") ? "#7c5cb8"
      : c.seen.has("rear") ? "#2e7fbf"
      : c.seen.size > 0 ? "#3d9970" : "#c0392b";
  }

  renderWorld(ctx, cam, { x0: 0, y0: 0, x1: W, y1: H }, {});

  // side mirrors live OUTSIDE: sail panel + arm + angled housing, drawn before
  // the cabin so pillars and doors occlude them like anything else out the window
  renderMirrorTex(texL, MIR_L, 270 - cfg.left, 2 * FOV.sideHalf, { ownCar: true });
  renderMirrorTex(texR, MIR_R, 270 + cfg.right, 2 * FOV.sideHalf, { ownCar: true });
  poly(ctx, cam, SAIL_L, "#212930");
  poly(ctx, cam, ARM_L, "#1a2127");
  L.mLr = drawGlassPanel(ctx, cam, glassQuad(ML_C, 0.20, 0.13, -0.5), texL, W, H);
  poly(ctx, cam, SAIL_R, "#212930");
  poly(ctx, cam, ARM_R, "#1a2127");
  L.mRr = drawGlassPanel(ctx, cam, glassQuad(MR_C, 0.20, 0.13, -0.5), texR, W, H);

  drawCabin(ctx, cam);

  // the rear-view lives INSIDE, hanging off the header — drawn over the cabin
  const s0 = camPt(cam, RV_C[0], RV_C[1], 1.33), s1 = camPt(cam, RV_C[0] - 0.02, RV_C[1] - 0.06, 1.40);
  if (s0[2] > NEAR && s1[2] > NEAR) {
    ctx.strokeStyle = "#161c22";
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(SX(cam, s0), SY(cam, s0));
    ctx.lineTo(SX(cam, s1), SY(cam, s1));
    ctx.stroke();
  }
  renderMirrorTex(texRV, REARVIEW, 270, 2 * FOV.rearHalf, { headrests: true });
  L.rv = drawGlassPanel(ctx, cam, glassQuad(RV_C, 0.27, 0.085, -0.9), texRV, W, H);

  // cabin vignette
  const vg = ctx.createRadialGradient(W / 2, H * 0.46, H * 0.35, W / 2, H * 0.5, H * 0.95);
  vg.addColorStop(0, "rgba(10,14,18,0)");
  vg.addColorStop(1, "rgba(10,14,18,0.26)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  const f = focusCar();
  if (f) drawStatus(ctx, statusOf(f), t);
}

/* ---------- DOM metrics ---------- */
function updateDom() {
  const Lb = blindSpan(-LANE_W), Rb = blindSpan(LANE_W);
  const fmt = b => b < 0.4 ? "none" : b.toFixed(1) + " m";
  document.getElementById("spans").innerHTML =
    `Blind zone beside you (from the top view): left <b>${fmt(Lb)}</b> · right <b>${fmt(Rb)}</b>` +
    (Math.max(Lb, Rb) >= CAR.len ? " — enough to hide a whole car." : ".");
  document.getElementById("mSelf").textContent = selfInMirror() ? "yes" : "no";
  const verdict = document.getElementById("verdict");
  if (Lb < 0.4 && Rb < 0.4) {
    verdict.innerHTML = "<b style='color:#3d9970'>Continuous hand-off: rear-view → side mirror → your own eyes. Nothing can hide, on either side.</b>";
  } else {
    verdict.innerHTML = "<b style='color:#c0392b'>A car can sit beside your rear quarter, in nothing, for seconds at a time.</b>";
  }
}

function updateLive() {
  const f = focusCar();
  const el = document.getElementById("mWhere");
  if (!f) {
    el.textContent = "–";
    el.style.color = "";
    document.getElementById("bWhere").textContent = "waiting for traffic";
  } else {
    const st = statusOf(f);
    el.textContent = f.seen.has("mirL") || f.seen.has("mirR") ? "side mirror"
      : f.seen.has("rear") ? "rear-view"
      : f.seen.size > 0 ? "your own eyes" : "NOWHERE";
    el.style.color = st.col;
    const d = f.y, sideTxt = f.side < 0 ? "left" : "right";
    document.getElementById("bWhere").textContent =
      d < -1 ? `${Math.round(-d)} m back (${sideTxt})` : d > 5 ? `${Math.round(d)} m ahead` : `beside you (${sideTxt})`;
  }
  const iv = lastInvis ?? (f ? f.invis : null);
  document.getElementById("mInvis").textContent = iv === null ? "–" : iv.toFixed(1) + " s";
  document.getElementById("bInvis").textContent = lastInvis === null ? "measuring…" : "last completed pass";
}

/* ---------- UI ---------- */
LAB.bindSliders({
  left: { id: "sLeft", lbl: "vLeft", fmt: v => v.toFixed(1) + "°" },
  right: { id: "sRight", lbl: "vRight", fmt: v => v.toFixed(1) + "°" },
  pass: { id: "sPass", lbl: "vPass", fmt: v => Math.round(v * 2.237) + " mph faster" },
  share: { id: "sShare", lbl: "vShare", fmt: v => Math.round(v) + "% left" },
}, cfg, () => { setPreset(null); lastInvis = null; updateDom(); });

function setPreset(id) {
  document.querySelectorAll(".preset").forEach(b => b.classList.remove("active"));
  if (id) document.getElementById(id).classList.add("active");
}
function setAngles(l, rr) {
  cfg.left = l; cfg.right = rr;
  document.getElementById("sLeft").value = l;
  document.getElementById("sRight").value = rr;
  document.getElementById("vLeft").textContent = l.toFixed(1) + "°";
  document.getElementById("vRight").textContent = rr.toFixed(1) + "°";
  lastInvis = null;
  for (const c of cars) c.invis = 0;
  updateDom();
}
document.getElementById("pSchool").addEventListener("click", () => { setAngles(3, 3); setPreset("pSchool"); });
document.getElementById("pWide").addEventListener("click", () => { setAngles(19, 19); setPreset("pWide"); });
document.getElementById("pause").addEventListener("click", () => {
  paused = !paused;
  document.getElementById("pause").textContent = paused ? "▶" : "⏸";
});

/* pointer: drag a mirror to aim it; drag anywhere else to turn your head */
let mirDrag = null;
const inRect = (m, x, y) => m && x >= m.x && x <= m.x + m.w && y >= m.y && y <= m.y + m.h;
cv.addEventListener("pointerdown", e => {
  if (!L) return;
  const b = cv.getBoundingClientRect();
  const x = e.clientX - b.left, y = e.clientY - b.top;
  cv.setPointerCapture(e.pointerId);
  if (inRect(L.mLr, x, y)) mirDrag = { side: "left", x0: e.clientX, v0: cfg.left };
  else if (inRect(L.mRr, x, y)) mirDrag = { side: "right", x0: e.clientX, v0: cfg.right };
  else headDrag = { x0: e.clientX, yaw0: head, yaw: head };
});
cv.addEventListener("pointermove", e => {
  const b = cv.getBoundingClientRect();
  const x = e.clientX - b.left, y = e.clientY - b.top;
  if (mirDrag) {
    const d = (e.clientX - mirDrag.x0) * 0.1;
    const v = Math.max(0, Math.min(40, mirDrag.v0 + (mirDrag.side === "left" ? -d : d)));
    cfg[mirDrag.side] = Math.round(v * 2) / 2;
    const cap = mirDrag.side === "left" ? "Left" : "Right";
    document.getElementById("s" + cap).value = cfg[mirDrag.side];
    document.getElementById("v" + cap).textContent = cfg[mirDrag.side].toFixed(1) + "°";
    setPreset(null);
    lastInvis = null;
    updateDom();
    return;
  }
  if (headDrag) {
    headDrag.yaw = Math.max(-HEAD_MAX, Math.min(HEAD_MAX, headDrag.yaw0 + (e.clientX - headDrag.x0) * 0.35));
    return;
  }
  cv.style.cursor = (inRect(L && L.mLr, x, y) || inRect(L && L.mRr, x, y)) ? "ew-resize" : "grab";
});
const endDrag = () => { mirDrag = null; headDrag = null; };
cv.addEventListener("pointerup", endDrag);
cv.addEventListener("pointercancel", endDrag);

window.addEventListener("keydown", e => {
  if (e.key === "ArrowLeft") { keyLook = HEAD_MAX; e.preventDefault(); }
  if (e.key === "ArrowRight") { keyLook = -HEAD_MAX; e.preventDefault(); }
});
window.addEventListener("keyup", e => {
  if ((e.key === "ArrowLeft" && keyLook > 0) || (e.key === "ArrowRight" && keyLook < 0)) keyLook = 0;
});

/* ---------- loop ---------- */
let last = performance.now(), domTick = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  head += (headGoal() - head) * (1 - Math.exp(-7 * dt));   // glance, then ease back
  if (!paused) advance(dt);
  render(now / 1000);
  domTick += dt;
  if (domTick > 0.15) { domTick = 0; updateLive(); }
  requestAnimationFrame(frame);
}
updateDom();
requestAnimationFrame(frame);

/* console hooks for tests and clip scripting:
   COCKPIT.jump(-12)          one car parked 12 m back on the left
   COCKPIT.jump(-12, 1, true) ...on the right, mid-lane-change
   COCKPIT.look(60)           hold a head turn (null releases)
   COCKPIT.tick(3)            advance the sim 3 s synchronously (rAF-throttle-proof) */
window.COCKPIT = {
  jump: (y, side = -1, mid = false) => {
    cars = [mkCar({ y, side, mid, jit: 1 })];
    if (mid) cars[0].prog = 0;
  },
  look: d => {
    hookLook = d === null ? null : Math.max(-HEAD_MAX, Math.min(HEAD_MAX, d));
    if (hookLook !== null) head = hookLook;
  },
  tick: s => { for (let t = 0; t < s; t += 1 / 60) advance(1 / 60); },
  state: () => ({ head, odo, cars: cars.map(c => ({ y: +c.y.toFixed(1), x: +carX(c).toFixed(2), side: c.side, mid: c.mid, prog: +c.prog.toFixed(2), invis: +c.invis.toFixed(2), seen: [...c.seen] })) }),
};
