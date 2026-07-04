/* The Mirrors: blind spots as a mirror-aim setting. Pure geometry, meters.
   World: your car at origin facing +y. x right, y forward. */
"use strict";

const LANE_W = 3.4;
const CAR = { len: 4.6, wid: 1.9 };
const EYE = { x: -0.35, y: 0.6 };            // driver's head
const REARVIEW = { x: 0, y: 0.9 };           // interior mirror
const MIR_L = { x: -1.0, y: 0.75 };          // side mirror housings
const MIR_R = { x: 1.0, y: 0.75 };

const FOV = { forwardHalf: 70, rearHalf: 15, sideHalf: 8, range: 70 };

const cfg = { left: 8, right: 8, pass: 5 };

const deg = Math.PI / 180;
function angDiff(a, b) {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

/* zones: origin + center direction (deg, CCW from +x) + half-fov */
function zones() {
  return [
    { key: "eyes", origin: EYE, dir: 90, half: FOV.forwardHalf, color: "#3d9970" },
    { key: "glassL", origin: EYE, dir: 152, half: 31, color: "#3d9970", range: 8 },  // side window, B-pillar caps the rearward view
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

/* which zones see a car centered at (cx, cy)? (checks corners + center) */
function coverage(cx, cy) {
  const pts = [[cx, cy], [cx - 0.8, cy + 1.9], [cx + 0.8, cy + 1.9], [cx - 0.8, cy - 1.9], [cx + 0.8, cy - 1.9]];
  const seen = new Set();
  for (const z of zones()) {
    if (pts.some(([x, y]) => pointInZone(z, x, y))) seen.add(z.key);
  }
  return seen;
}

/* blind-zone extent along an adjacent lane: contiguous uncovered span (m)
   within the "danger window" behind/beside you */
function blindSpan(laneX) {
  let worst = 0, cur = 0, curStart = null, worstRange = null;
  for (let y = -26; y <= 6; y += 0.2) {
    const covered = coverage(laneX, y).size > 0;
    if (!covered) {
      if (curStart === null) curStart = y;
      cur = y - curStart + 0.2;
      if (cur > worst) { worst = cur; worstRange = [curStart, y]; }
    } else curStart = null;
  }
  return { len: worst, range: worstRange };
}

function selfInMirror() {
  // does either side mirror's cone intersect your own car body?
  const pts = [];
  for (let y = -CAR.len / 2; y <= CAR.len / 2; y += 0.3) {
    pts.push([-CAR.wid / 2, y], [CAR.wid / 2, y]);
  }
  const zs = zones();
  const mL = zs.find(z => z.key === "mirL"), mR = zs.find(z => z.key === "mirR");
  return pts.some(([x, y]) => pointInZone(mL, x, y)) || pts.some(([x, y]) => pointInZone(mR, x, y));
}

/* ---------- animation state ---------- */
let passY = -28;   // overtaker position (left lane)
let paused = false;

/* ---------- render ---------- */
const cv = document.getElementById("mir");
const ctx = cv.getContext("2d");
const cov = document.getElementById("cov");

const SCALE = 13;  // px per meter
function W2S(r, x, y) { return [r.width / 2 + x * SCALE, r.height * 0.62 - y * SCALE]; }

function render() {
  const dpr = window.devicePixelRatio || 1;
  const r = cv.getBoundingClientRect();
  if (r.width < 80 || r.height < 80) return;
  if (cv.width !== Math.round(r.width * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, r.width, r.height);

  // road: three lanes
  const roadL = W2S(r, -1.5 * LANE_W - 0.6, 0)[0], roadR = W2S(r, 1.5 * LANE_W + 0.6, 0)[0];
  ctx.fillStyle = "#e9e5da";
  ctx.fillRect(roadL, 0, roadR - roadL, r.height);
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.setLineDash([10, 12]);
  ctx.lineWidth = 1.5;
  for (const lx of [-LANE_W / 2, LANE_W / 2]) {
    const X = W2S(r, lx, 0)[0];
    ctx.beginPath(); ctx.moveTo(X, 0); ctx.lineTo(X, r.height); ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.strokeStyle = "#c9c4b6";
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(roadL, 0); ctx.lineTo(roadL, r.height);
  ctx.moveTo(roadR, 0); ctx.lineTo(roadR, r.height); ctx.stroke();

  // vision zones
  for (const z of zones()) {
    const [ox, oy] = W2S(r, z.origin.x, z.origin.y);
    const a0 = -(z.dir + z.half) * deg, a1 = -(z.dir - z.half) * deg; // canvas y-flip
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.arc(ox, oy, (z.range || FOV.range) * SCALE, a0, a1);
    ctx.closePath();
    ctx.fillStyle = z.color + "26";
    ctx.fill();
    ctx.strokeStyle = z.color + "55";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // your car
  const [mx, my] = W2S(r, 0, 0);
  ctx.save();
  ctx.translate(mx, my);
  ctx.fillStyle = "#23303a";
  ctx.beginPath();
  ctx.roundRect(-CAR.wid / 2 * SCALE, -CAR.len / 2 * SCALE, CAR.wid * SCALE, CAR.len * SCALE, 5);
  ctx.fill();
  ctx.fillStyle = "#f2efe7";
  ctx.font = "600 9px -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("YOU", 0, 3);
  ctx.restore();
  // mirror housings
  for (const m of [MIR_L, MIR_R]) {
    const [x, y] = W2S(r, m.x, m.y);
    ctx.fillStyle = "#23303a";
    ctx.fillRect(x - 2.5, y - 2, 5, 4);
  }

  // the passing car (left lane), colored by whichever zone sees it
  const seen = coverage(-LANE_W, passY);
  const zoneColor = seen.has("mirL") || seen.has("mirR") ? "#7c5cb8"
    : seen.has("rear") ? "#2e7fbf"
    : (seen.has("eyes") || seen.has("glassL") || seen.has("glassR")) ? "#3d9970" : "#c0392b";
  const [px, py] = W2S(r, -LANE_W, passY);
  ctx.save();
  ctx.translate(px, py);
  if (seen.size === 0) {
    ctx.shadowColor = "#c0392b";
    ctx.shadowBlur = 14;
  }
  ctx.fillStyle = zoneColor;
  ctx.beginPath();
  ctx.roundRect(-CAR.wid / 2 * SCALE, -CAR.len / 2 * SCALE, CAR.wid * SCALE, CAR.len * SCALE, 5);
  ctx.fill();
  ctx.restore();
  if (seen.size === 0) {
    ctx.fillStyle = "#c0392b";
    ctx.font = "700 12px -apple-system, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("← INVISIBLE right now", px + 34, py + 4);
  }

  // labels
  ctx.fillStyle = "#8a8577";
  ctx.font = "11px -apple-system, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("↑ traffic direction", 14, 22);
}

function renderCoverageBar() {
  const dpr = window.devicePixelRatio || 1;
  const r = cov.getBoundingClientRect();
  if (!r.width) return;
  if (cov.width !== Math.round(r.width * dpr)) { cov.width = Math.round(r.width * dpr); cov.height = Math.round(r.height * dpr); }
  const c = cov.getContext("2d");
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, r.width, r.height);
  const Y0 = -26, Y1 = 8;
  const H = r.height;
  for (let px = 0; px < r.width; px++) {
    const y = Y0 + (px / r.width) * (Y1 - Y0);
    const seen = coverage(-LANE_W, y);
    let color = "#c0392b";
    if (seen.has("eyes") || seen.has("glassL") || seen.has("glassR")) color = "#3d9970";
    if (seen.has("mirL") || seen.has("mirR")) color = "#7c5cb8";
    if (seen.has("rear")) color = "#2e7fbf";
    if (seen.size === 0) color = "#c0392b";
    c.fillStyle = color;
    c.fillRect(px, 8, 1, H - 22);
  }
  // your car marker + axis labels
  const xOf = (y) => (y - Y0) / (Y1 - Y0) * r.width;
  c.fillStyle = "#23303a";
  c.fillRect(xOf(-CAR.len / 2), 4, xOf(CAR.len / 2) - xOf(-CAR.len / 2), 3);
  c.font = "9px -apple-system, sans-serif";
  c.fillStyle = "#6f6a5e";
  c.textAlign = "center";
  c.fillText("26 m behind you", xOf(-24) + 20, H - 2);
  c.fillText("alongside (YOU)", xOf(0), H - 2);
  c.fillText("ahead", xOf(6) - 10, H - 2);
  // live position cursor
  c.fillStyle = "#23303a";
  c.fillRect(xOf(passY) - 1, 6, 2, H - 18);
}

/* ---------- UI ---------- */
LAB.bindSliders({
  left: { id: "sLeft", lbl: "vLeft", fmt: v => v.toFixed(1) + "°" },
  right: { id: "sRight", lbl: "vRight", fmt: v => v.toFixed(1) + "°" },
  pass: { id: "sPass", lbl: "vPass", fmt: v => Math.round(v * 2.237) + " mph faster" },
}, cfg, () => { setPreset(null); updateDom(); });

function setPreset(id) {
  document.querySelectorAll(".preset").forEach(b => b.classList.remove("active"));
  if (id) document.getElementById(id).classList.add("active");
}
document.getElementById("pSchool").addEventListener("click", () => {
  setAngles(3, 3); setPreset("pSchool");
});
document.getElementById("pWide").addEventListener("click", () => {
  setAngles(28, 28); setPreset("pWide");
});
function setAngles(l, rr) {
  cfg.left = l; cfg.right = rr;
  document.getElementById("sLeft").value = l;
  document.getElementById("sRight").value = rr;
  document.getElementById("vLeft").textContent = l.toFixed(1) + "°";
  document.getElementById("vRight").textContent = rr.toFixed(1) + "°";
  updateDom();
}
document.getElementById("pause").addEventListener("click", () => {
  paused = !paused;
  document.getElementById("pause").textContent = paused ? "▶" : "⏸";
});

function updateDom() {
  const L = blindSpan(-LANE_W), R = blindSpan(LANE_W);
  const fmt = (b) => b.len < 0.4 ? "none" : b.len.toFixed(1) + " m";
  document.getElementById("mBlindL").textContent = fmt(L);
  document.getElementById("mBlindR").textContent = fmt(R);
  document.getElementById("bL").textContent = L.len >= CAR.len ? "hides a whole car" : "";
  document.getElementById("bR").textContent = R.len >= CAR.len ? "hides a whole car" : "";
  document.getElementById("bL").className = "base " + (L.len >= CAR.len ? "bad" : "good");
  document.getElementById("bR").className = "base " + (R.len >= CAR.len ? "bad" : "good");
  const self = selfInMirror();
  document.getElementById("mSelf").textContent = self ? "yes" : "no";
  const verdict = document.getElementById("verdict");
  if (L.len < 0.4 && R.len < 0.4) {
    verdict.innerHTML = "<b style='color:#3d9970'>Continuous hand-off: rear-view → side mirror → your own eyes. Nothing can hide.</b>";
  } else {
    verdict.innerHTML = "<b style='color:#c0392b'>A car can sit beside your rear quarter, in nothing, for seconds at a time.</b>";
  }
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!paused) {
    passY += cfg.pass * dt;
    if (passY > 12) passY = -28;
  }
  render();
  renderCoverageBar();
  requestAnimationFrame(frame);
}
updateDom();
requestAnimationFrame(frame);
