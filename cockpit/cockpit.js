/* The Cockpit: demo 04's blind-spot geometry, seen from the driver's seat.
   World frame (same as mirrors/): your car at origin facing +y. x right,
   y forward, z up, meters. Angles: degrees CCW from +x — 90 = straight ahead,
   270 = straight back.

   The view is ONE planar pinhole camera at the driver's eye (left seat), with
   a turnable head: the cabin — pillars, roof, dash, doors, seats — is real 3D
   geometry drawn over the world, and the windows are simply the gaps. Mirrors
   are billboards anchored to the cabin whose glass is rendered by its own
   fixed backward camera (demo 04's cones), horizontally flipped like glass. */
"use strict";

const LANE_W = 3.4;
const CAR = { len: 4.6, wid: 1.9 };
const EYE      = { x: -0.35, y: 0.6,  z: 1.15 };
const REARVIEW = { x: 0,     y: 0.9,  z: 1.25 };
const MIR_L    = { x: -1.0,  y: 0.75, z: 0.95 };
const MIR_R    = { x: 1.0,   y: 0.75, z: 0.95 };

const FOV = { forwardHalf: 70, rearHalf: 15, sideHalf: 8, range: 70 };
const OWN_V = 29;                       // your speed (~65 mph) — scenery stream only
const HFOV = 104;                       // head-still view width, degrees

const cfg = { left: 3, right: 3, pass: 5 };

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

/* ---------- scene state ---------- */
let odo = 0;                 // your odometer — streams dashes, posts, trees
let paused = false;
let invisT = 0, lastInvis = null;   // invisible-seconds accounting per pass

const passer = { x: -LANE_W, y: -40, color: "#c0392b" };
const ambient = [
  { x: 0, y: 32, color: "#8d939b" },        // lead, your lane (gentle bob)
  { x: LANE_W, y: 14, color: "#a89a84" },   // right lane, ahead
  { x: 0, y: -26, color: "#98a3ad" },       // follower, your lane
  { x: LANE_W, y: -45, color: "#7f8a94" },  // right lane, far back
];

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
  const list = [passer, ...ambient];
  if (opts.ownCar) list.push({ x: 0, y: 0, color: "#23303a" });
  list.map(v => ({ v, d: (v.x - cam.px) ** 2 + (v.y - cam.py) ** 2 }))
    .sort((a, b) => b.d - a.d)
    .forEach(({ v }) => drawVehicle(ctx, cam, v));
}

/* ---------- the cabin, as geometry in car space (cosmetic — zones don't see it) ---------- */
const CABIN = [
  // roof + windshield header
  { c: "#161c22", q: [[-0.72, 1.02, 1.42], [0.72, 1.02, 1.42], [0.80, -1.35, 1.40], [-0.80, -1.35, 1.40]] },
  { c: "#1b222a", q: [[-0.66, 1.18, 1.36], [0.66, 1.18, 1.36], [0.72, 1.02, 1.42], [-0.72, 1.02, 1.42]] },
  // roof side rails, down to the window tops
  { c: "#1b222a", q: [[-0.80, 1.02, 1.40], [-0.80, -1.35, 1.40], [-0.86, -1.35, 1.33], [-0.86, 1.02, 1.33]] },
  { c: "#1b222a", q: [[0.80, 1.02, 1.40], [0.80, -1.35, 1.40], [0.86, -1.35, 1.33], [0.86, 1.02, 1.33]] },
  // A-pillars
  { c: "#232b33", q: [[-0.84, 1.62, 0.98], [-0.66, 1.18, 1.36], [-0.72, 1.02, 1.40], [-0.92, 1.35, 0.93]] },
  { c: "#232b33", q: [[0.84, 1.62, 0.98], [0.66, 1.18, 1.36], [0.72, 1.02, 1.40], [0.92, 1.35, 0.93]] },
  // dash: top surface + face toward you
  { c: "#2a323b", q: [[-0.90, 1.15, 0.96], [0.90, 1.15, 0.96], [0.84, 1.60, 0.99], [-0.84, 1.60, 0.99]] },
  { c: "#20272e", q: [[-0.90, 1.15, 0.58], [0.90, 1.15, 0.58], [0.90, 1.15, 0.96], [-0.90, 1.15, 0.96]] },
  // front doors below the beltline
  { c: "#262e36", q: [[-0.90, 1.40, 0.95], [-0.88, -1.10, 0.95], [-0.88, -1.10, 0.22], [-0.90, 1.40, 0.22]] },
  { c: "#262e36", q: [[0.90, 1.40, 0.95], [0.88, -1.10, 0.95], [0.88, -1.10, 0.22], [0.90, 1.40, 0.22]] },
  // B-pillars
  { c: "#1d242b", q: [[-0.87, -0.92, 0.90], [-0.87, -1.08, 0.90], [-0.85, -1.08, 1.36], [-0.85, -0.92, 1.36]] },
  { c: "#1d242b", q: [[0.87, -0.92, 0.90], [0.87, -1.08, 0.90], [0.85, -1.08, 1.36], [0.85, -0.92, 1.36]] },
  // rear doors below glass, C-pillars, rear seatback
  { c: "#242c34", q: [[-0.88, -1.08, 0.95], [-0.86, -2.10, 0.95], [-0.86, -2.10, 0.28], [-0.88, -1.08, 0.28]] },
  { c: "#242c34", q: [[0.88, -1.08, 0.95], [0.86, -2.10, 0.95], [0.86, -2.10, 0.28], [0.88, -1.08, 0.28]] },
  { c: "#1d242b", q: [[-0.86, -1.95, 0.92], [-0.84, -2.18, 0.92], [-0.84, -2.18, 1.36], [-0.86, -1.95, 1.36]] },
  { c: "#1d242b", q: [[0.86, -1.95, 0.92], [0.84, -2.18, 0.92], [0.84, -2.18, 1.36], [0.86, -1.95, 1.36]] },
  { c: "#2b333c", q: [[-0.82, -1.30, 0.35], [0.82, -1.30, 0.35], [0.82, -1.30, 1.04], [-0.82, -1.30, 1.04]] },
  // passenger seat + headrest (you look past it out the right window)
  { c: "#2b333c", q: [[0.12, -0.30, 0.30], [0.62, -0.30, 0.30], [0.62, -0.30, 1.06], [0.12, -0.30, 1.06]] },
  { c: "#242c34", q: [[0.22, -0.28, 1.10], [0.52, -0.28, 1.10], [0.52, -0.28, 1.30], [0.22, -0.28, 1.30]] },
  // instrument pod + the dash screen's bezel (tablet-style, above the dash)
  { c: "#10151a", q: [[-0.62, 1.14, 0.94], [-0.08, 1.14, 0.94], [-0.08, 1.24, 0.68], [-0.62, 1.24, 0.68]] },
  { c: "#10151a", q: [[0.03, 1.405, 1.16], [0.53, 1.405, 1.16], [0.53, 1.405, 0.93], [0.03, 1.405, 0.93]] },
];
const SCREEN_Q = [[0.06, 1.40, 1.13], [0.50, 1.40, 1.13], [0.50, 1.40, 0.955], [0.06, 1.40, 0.955]];
const GAUGES = [{ p: [-0.475, 1.17, 0.875], frac: 0.29 }, { p: [-0.235, 1.17, 0.875], frac: 0.54 }];
const WHEEL = { C: [-0.35, 1.0, 0.81], R: 0.19, v: [0, -Math.sin(25 * deg), Math.cos(25 * deg)] };
const RV_A = [-0.02, 1.25, 1.32];       // where the drawn mirrors hang (cabin art;
const ML_A = [-1.03, 1.30, 1.01];       //  the glass CONTENT still comes from demo 04's
const MR_A = [1.03, 1.30, 1.01];        //  cone origins, unchanged)

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

  // the dash screen: demo 04's top-down view, affine-mapped onto the console
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
      ctx.strokeStyle = "#10151b";
      ctx.lineWidth = lw;
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(rim[0][0], rim[0][1]);
      for (const [x, y] of rim) ctx.lineTo(x, y);
      ctx.closePath();
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

/* ---------- mirrors: billboards anchored to the cabin ---------- */
function mirrorRect(cam, anchor, physW, ratio, minW, maxW, W, H) {
  const p = camPt(cam, anchor[0], anchor[1], anchor[2]);
  if (p[2] < 0.24) return null;
  const w = Math.max(minW, Math.min(maxW, physW * cam.focal / p[2]));
  const x = SX(cam, p), y = SY(cam, p);
  if (x < -w || x > W + w || y < -w || y > H + w) return null;
  return { x: x - w / 2, y: y - w * ratio / 2, w, h: w * ratio };
}

function drawMirror(ctx, r, pos, dirDeg, hFovDeg, opts = {}) {
  const pad = Math.max(3, r.w * 0.035);
  ctx.fillStyle = "#161c22";
  ctx.beginPath();
  ctx.roundRect(r.x - pad, r.y - pad, r.w + 2 * pad, r.h + 2 * pad, 10);
  ctx.fill();
  ctx.strokeStyle = "#3a444e";
  ctx.lineWidth = 1;
  ctx.stroke();

  const glass = new Path2D();
  glass.roundRect(r.x, r.y, r.w, r.h, 7);
  const focal = (r.w / 2) / Math.tan(hFovDeg / 2 * deg);
  const cam = makeCam(pos, dirDeg, -1, focal, r.x + r.w / 2, r.y + r.h * 0.44);
  ctx.save();
  ctx.clip(glass);
  renderWorld(ctx, cam, { x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h }, { ownCar: opts.ownCar });
  if (opts.headrests) {                 // the rear-view sees a hint of your own cabin
    ctx.fillStyle = "rgba(24,30,36,0.55)";
    for (const fx of [0.26, 0.62]) {
      ctx.beginPath();
      ctx.roundRect(r.x + r.w * fx, r.y + r.h * 0.84, r.w * 0.13, r.h * 0.3, 4);
      ctx.fill();
    }
  }
  const glare = ctx.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h);
  glare.addColorStop(0, "rgba(255,255,255,0.14)");
  glare.addColorStop(0.28, "rgba(255,255,255,0.03)");
  glare.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glare;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.restore();
  ctx.strokeStyle = "#0d1116";
  ctx.lineWidth = 1.5;
  ctx.stroke(glass);
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
  for (const v of ambient) carRect(v, "#5c666f");
  carRect({ x: 0, y: 0 }, "#e8e4d8");
  carRect(passer, passer.color);

  ctx.fillStyle = "#5f6b76";
  ctx.font = "600 7px -apple-system, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("TOP VIEW — DEMO 04", r.x + 5, r.y + 10);
  ctx.restore();
}

/* ---------- status pill (HUD) ---------- */
function statusOf(seen) {
  if (seen.has("mirL") || seen.has("mirR")) return { txt: "in your side mirror", col: "#7c5cb8" };
  if (seen.has("rear")) return { txt: "in your rear-view mirror", col: "#2e7fbf" };
  if (seen.size > 0) {
    return passer.y > 6 ? { txt: "ahead — your own eyes", col: "#3d9970" }
                        : { txt: "beside you — your own eyes", col: "#3d9970" };
  }
  return { txt: "INVISIBLE — in none of your glass", col: "#c0392b" };
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
  // you lean into a glance: the eye slides a little toward the window you're
  // checking (cosmetic — the zone model's eye point never moves)
  const eye = { x: EYE.x - 0.20 * head / 115, y: EYE.y, z: EYE.z };
  const cam = makeCam(eye, 90 + head, 1, focal, W / 2, 0.45 * H);
  L = { W, H };

  const seen = coverage(passer.x, passer.y);
  passer.color = seen.has("mirL") || seen.has("mirR") ? "#7c5cb8"
    : seen.has("rear") ? "#2e7fbf"
    : seen.size > 0 ? "#3d9970" : "#c0392b";

  renderWorld(ctx, cam, { x0: 0, y0: 0, x1: W, y1: H }, {});
  drawCabin(ctx, cam);

  // mirrors: bezels ride the cabin; glass stays demo 04's cones
  L.rv = mirrorRect(cam, RV_A, 0.30, 0.32, 120, 0.24 * W, W, H);
  if (L.rv) {
    const s0 = camPt(cam, RV_A[0], RV_A[1], 1.34), s1 = camPt(cam, RV_A[0] - 0.02, RV_A[1] - 0.06, 1.40);
    if (s0[2] > NEAR && s1[2] > NEAR) {
      ctx.strokeStyle = "#161c22";
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(SX(cam, s0), SY(cam, s0));
      ctx.lineTo(SX(cam, s1), SY(cam, s1));
      ctx.stroke();
    }
    drawMirror(ctx, L.rv, REARVIEW, 270, 2 * FOV.rearHalf, { headrests: true });
  }
  L.mLr = mirrorRect(cam, ML_A, 0.185, 0.64, 76, 0.15 * W, W, H);
  if (L.mLr) drawMirror(ctx, L.mLr, MIR_L, 270 - cfg.left, 2 * FOV.sideHalf, { ownCar: true });
  L.mRr = mirrorRect(cam, MR_A, 0.185, 0.64, 76, 0.15 * W, W, H);
  if (L.mRr) drawMirror(ctx, L.mRr, MIR_R, 270 + cfg.right, 2 * FOV.sideHalf, { ownCar: true });

  // cabin vignette
  const vg = ctx.createRadialGradient(W / 2, H * 0.46, H * 0.35, W / 2, H * 0.5, H * 0.95);
  vg.addColorStop(0, "rgba(10,14,18,0)");
  vg.addColorStop(1, "rgba(10,14,18,0.26)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  drawStatus(ctx, statusOf(seen), t);
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
    verdict.innerHTML = "<b style='color:#3d9970'>Continuous hand-off: rear-view → side mirror → your own eyes. Nothing can hide.</b>";
  } else {
    verdict.innerHTML = "<b style='color:#c0392b'>A car can sit beside your rear quarter, in nothing, for seconds at a time.</b>";
  }
}

function updateLive(seen) {
  const st = statusOf(seen);
  const el = document.getElementById("mWhere");
  el.textContent = seen.has("mirL") || seen.has("mirR") ? "side mirror"
    : seen.has("rear") ? "rear-view"
    : seen.size > 0 ? "your own eyes" : "NOWHERE";
  el.style.color = st.col;
  const d = passer.y;
  document.getElementById("bWhere").textContent =
    d < -1 ? Math.round(-d) + " m back" : d > 5 ? Math.round(d) + " m ahead" : "beside you";
  const iv = lastInvis ?? invisT;
  document.getElementById("mInvis").textContent = iv.toFixed(1) + " s";
  document.getElementById("bInvis").textContent = lastInvis === null ? "measuring…" : "at this speed difference";
}

/* ---------- UI ---------- */
LAB.bindSliders({
  left: { id: "sLeft", lbl: "vLeft", fmt: v => v.toFixed(1) + "°" },
  right: { id: "sRight", lbl: "vRight", fmt: v => v.toFixed(1) + "°" },
  pass: { id: "sPass", lbl: "vPass", fmt: v => Math.round(v * 2.237) + " mph faster" },
}, cfg, () => { setPreset(null); lastInvis = null; invisT = 0; updateDom(); });

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
  lastInvis = null; invisT = 0;
  updateDom();
}
document.getElementById("pSchool").addEventListener("click", () => { setAngles(3, 3); setPreset("pSchool"); });
document.getElementById("pWide").addEventListener("click", () => { setAngles(28, 28); setPreset("pWide"); });
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
    lastInvis = null; invisT = 0;
    updateDom();
    return;
  }
  if (headDrag) {
    headDrag.yaw = Math.max(-115, Math.min(115, headDrag.yaw0 + (e.clientX - headDrag.x0) * 0.35));
    return;
  }
  cv.style.cursor = (inRect(L && L.mLr, x, y) || inRect(L && L.mRr, x, y)) ? "ew-resize" : "grab";
});
const endDrag = () => { mirDrag = null; headDrag = null; };
cv.addEventListener("pointerup", endDrag);
cv.addEventListener("pointercancel", endDrag);

window.addEventListener("keydown", e => {
  if (e.key === "ArrowLeft") { keyLook = 100; e.preventDefault(); }
  if (e.key === "ArrowRight") { keyLook = -100; e.preventDefault(); }
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
  if (!paused) {
    odo += OWN_V * dt;
    passer.y += cfg.pass * dt;
    if (passer.y > 35) { lastInvis = invisT; invisT = 0; passer.y = -40; }
    ambient[0].y = 32 + 2.2 * Math.sin(odo * 0.05);
    if (passer.y > -30 && passer.y < 8 && coverage(passer.x, passer.y).size === 0) invisT += dt;
  }
  render(now / 1000);
  domTick += dt;
  if (domTick > 0.15) { domTick = 0; updateLive(coverage(passer.x, passer.y)); }
  requestAnimationFrame(frame);
}
updateDom();
requestAnimationFrame(frame);

/* console hook for tests and clip scripting: COCKPIT.jump(-4) parks the passer
   in the school-aim blind zone; COCKPIT.look(90) holds a head turn (null releases) */
window.COCKPIT = {
  jump: y => { passer.y = y; },
  look: d => {                     // instant for scripting; spring applies on release
    hookLook = d === null ? null : Math.max(-115, Math.min(115, d));
    if (hookLook !== null) head = hookLook;
  },
  state: () => ({ passY: passer.y, odo, head, seen: [...coverage(passer.x, passer.y)] }),
};
