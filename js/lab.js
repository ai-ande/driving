/* lab.js — shared physics + UI helpers for the Driving Lab demos.
   Units: meters, seconds, m/s. */
"use strict";

const LAB = {};

LAB.mulberry32 = function (seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

LAB.speedColor = function (v, limit) {
  const stops = [
    [0.00, [192, 57, 43]], [0.30, [226, 161, 60]],
    [0.65, [61, 153, 112]], [1.00, [46, 127, 191]],
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
};

/* Intelligent Driver Model acceleration.
   o = {v, v0, vl, gap, T, aMax, bComf, s0} */
LAB.idm = function (o) {
  const s0 = o.s0 ?? 2.0;
  const free = 1 - Math.pow(o.v / Math.max(o.v0, 0.1), 4);
  if (o.gap == null) return o.aMax * free;
  const dv = o.v - o.vl;
  const sStar = s0 + Math.max(0, o.v * o.T + (o.v * dv) / (2 * Math.sqrt(o.aMax * o.bComf)));
  return o.aMax * (free - (sStar / Math.max(o.gap, 0.01)) * (sStar / Math.max(o.gap, 0.01)));
};

/* draw one car as a speed-colored capsule with brake halo (canvas px coords) */
LAB.drawCar = function (c, x, y, ang, lenPx, widPx, v, limit, opts = {}) {
  c.save();
  c.translate(x, y);
  c.rotate(ang);
  if (opts.braking) {
    c.fillStyle = "rgba(233,64,50,0.4)";
    c.beginPath();
    c.roundRect(-lenPx / 2 - 2.5, -widPx / 2 - 2.5, lenPx + 5, widPx + 5, 3);
    c.fill();
  }
  c.fillStyle = opts.color || LAB.speedColor(v, limit);
  c.beginPath();
  c.roundRect(-lenPx / 2, -widPx / 2, lenPx, widPx, Math.min(3, widPx / 2.5));
  c.fill();
  if (opts.ring) {
    c.strokeStyle = opts.ring;
    c.lineWidth = 1.6;
    c.strokeRect(-lenPx / 2 - 2, -widPx / 2 - 2, lenPx + 4, widPx + 4);
  }
  if (opts.dot) {
    c.fillStyle = opts.dot;
    c.beginPath(); c.arc(0, 0, Math.max(1.2, widPx * 0.24), 0, 7); c.fill();
  }
  c.restore();
};

/* time-space strip: shift-left accumulator, newest column on the right.
   opts: { w, h, rows: [{y (0..1), label, band?}], axisLeft, axisRight }
   rows with labels get a paper gutter on the left so positions have names. */
LAB.Strip = class {
  constructor(canvas, opts = {}) {
    this.cv = canvas;
    this.opts = opts;
    this.rows = opts.rows || [];
    this.gutter = this.rows.some(r => r.label) ? (opts.gutter || 78) : 0;
    this.off = document.createElement("canvas");
    this.off.width = opts.w || 640;
    this.off.height = opts.h || 150;
    this.o = this.off.getContext("2d");
    this.o.fillStyle = "#131a21";
    this.o.fillRect(0, 0, this.off.width, this.off.height);
  }
  column(marks) { // marks: [{y (0..1), color, size?, alpha?}]
    const W = this.off.width, H = this.off.height;
    this.o.drawImage(this.off, -1, 0);
    this.o.fillStyle = "#131a21";
    this.o.fillRect(W - 1, 0, 1, H);
    for (const r of this.rows) { // landmark rows sit under the data
      this.o.fillStyle = r.band ? "rgba(180,180,190,0.28)" : "rgba(255,255,255,0.06)";
      this.o.fillRect(W - 1, Math.round(r.y * (H - 2)), 1, r.band ? 2 : 1);
    }
    for (const m of marks) {
      const size = m.size || 1.8;
      this.o.globalAlpha = m.alpha ?? 0.92;
      this.o.fillStyle = m.color;
      this.o.fillRect(size > 2 ? W - 2 : W - 1, Math.round(m.y * (H - 2)) - size / 2,
                      size > 2 ? 2 : 1, size);
    }
    this.o.globalAlpha = 1;
  }
  blit() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.cv.getBoundingClientRect();
    if (!r.width) return;
    if (this.cv.width !== Math.round(r.width * dpr)) {
      this.cv.width = Math.round(r.width * dpr);
      this.cv.height = Math.round(r.height * dpr);
    }
    const c = this.cv.getContext("2d");
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const G = this.gutter, H = r.height;
    if (G) {
      c.fillStyle = "#fffdf7";
      c.fillRect(0, 0, G, H);
      c.strokeStyle = "#d8d3c6";
      c.lineWidth = 1;
      c.beginPath(); c.moveTo(G - 0.5, 0); c.lineTo(G - 0.5, H); c.stroke();
      c.font = "9px -apple-system, sans-serif";
      c.textBaseline = "middle";
      for (const row of this.rows) {
        if (!row.label) continue;
        const y = row.y * H;
        c.fillStyle = "#6f6a5e";
        c.textAlign = "right";
        c.fillText(row.label, G - 8, y);
        c.fillStyle = "#d8d3c6";
        c.fillRect(G - 5, y - 0.5, 5, 1);
      }
    }
    c.imageSmoothingEnabled = false;
    c.drawImage(this.off, G, 0, r.width - G, H);
    c.font = "10px -apple-system, sans-serif";
    c.textBaseline = "alphabetic";
    if (this.opts.axisLeft) {
      c.textAlign = "left";
      c.fillStyle = "rgba(242,239,231,0.75)";
      c.fillText(this.opts.axisLeft, G + 8, H - 9);
    }
    if (this.opts.axisRight) {
      c.textAlign = "right";
      c.fillStyle = "rgba(242,239,231,0.95)";
      c.fillText(this.opts.axisRight, r.width - 8, H - 9);
    }
  }
};

LAB.fmtMph = (ms) => Math.round(ms * 2.23694) + " mph";
LAB.fmtTime = (s) => isNaN(s) ? "–" : Math.floor(s / 60) + ":" + String(Math.round(s % 60)).padStart(2, "0");

/* slider binder: spec = {id: {lbl, fmt, onchange}} reading .value into cfg[key] */
LAB.bindSliders = function (spec, cfg, onAny) {
  for (const [key, s] of Object.entries(spec)) {
    const el = document.getElementById(s.id), lbl = document.getElementById(s.lbl);
    const update = () => {
      cfg[key] = parseFloat(el.value);
      if (lbl) lbl.textContent = s.fmt(cfg[key]);
    };
    el.addEventListener("input", () => { update(); (s.onchange || onAny || (() => {}))(key); });
    update();
  }
};

/* the lab nav strip. rel = "" on the root page, "../" inside a demo directory */
LAB.nav = function (current, rel) {
  rel = rel ?? (current === "01" ? "" : "../");
  const demos = [
    ["01", "The Lights", ""],
    ["02", "The Ring", "ring/"],
    ["03", "The Merge", "merge/"],
    ["04", "The Mirrors", "mirrors/"],
    ["05", "Trucks & Packs", "trucks/"],
    ["06", "The Couplet", "couplet/"],
  ];
  const el = document.createElement("nav");
  el.id = "labnav";
  el.innerHTML = `<b>THE DRIVING LAB</b>` + demos.map(([n, t, path]) =>
    `<a href="${rel + (path || "./")}" class="${n === current ? "here" : ""}"><span>${n}</span> ${t}</a>`).join("") +
    `<a class="gh" href="https://github.com/ai-ande/driving">about</a>`;
  document.body.prepend(el);
};
