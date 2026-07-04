#!/usr/bin/env python3
"""Build js/geometry.js from raw OpenStreetMap Overpass extracts.

Inputs (fetched with the .ql queries in this directory):
  osm.json        roads + traffic signals + small water polygons
  osm_water.json  Lady Bird Lake relation + creeks
  osm_extra.json  Barton Springs Rd + Sandra Muraida Way

Usage: python3 tools/build_geometry.py <data_dir> > js/geometry.js
Data (c) OpenStreetMap contributors, ODbL 1.0.
"""
import json, math, sys, os, collections

DATA = sys.argv[1] if len(sys.argv) > 1 else "."
REFLAT, REFLON = 30.2700, -97.7530
MLAT = 110950.0
MLON = 111320.0 * math.cos(math.radians(REFLAT))

def proj(lat, lon):
    return ((lon - REFLON) * MLON, (lat - REFLAT) * MLAT)  # x east, y north (m)

def load(name):
    with open(os.path.join(DATA, name)) as f:
        return json.load(f)["elements"]

els = load("osm.json") + load("osm_water.json") + load("osm_extra.json")
seen, ways, signals, rels = set(), [], [], []
for e in els:
    k = (e["type"], e["id"])
    if k in seen:
        continue
    seen.add(k)
    if e["type"] == "way" and "geometry" in e:
        ways.append(e)
    elif e["type"] == "relation":
        rels.append(e)
    elif e["type"] == "node" and e.get("tags", {}).get("highway") == "traffic_signals":
        signals.append(proj(e["lat"], e["lon"]))

def way_pts(w):
    return [proj(g["lat"], g["lon"]) for g in w["geometry"]]

BAD_HW = {None, "construction", "planned", "service", "footway", "cycleway", "path", "steps"}

# ---------------- Lamar centerline (bin by y, average x) ----------------
lam_raw = []
for w in ways:
    t = w.get("tags", {})
    if "Lamar" in t.get("name", "") and "Service" not in t.get("name", "") and t.get("highway") not in BAD_HW:
        lam_raw += way_pts(w)
bins = collections.defaultdict(list)
for x, y in lam_raw:
    bins[round(y / 12)].append(x)
lam = [(sum(v) / len(v), k * 12.0) for k, v in sorted(bins.items())]
lam = [p for p in lam if -1640 <= p[1] <= 1450]
def smooth(pts, w=2):
    out = []
    for i in range(len(pts)):
        lo, hi = max(0, i - w), min(len(pts), i + w + 1)
        out.append((sum(p[0] for p in pts[lo:hi]) / (hi - lo),
                    sum(p[1] for p in pts[lo:hi]) / (hi - lo)))
    return out
lam = smooth(smooth(lam))

def resample(pts, step):
    if len(pts) < 2:
        return pts
    out, acc = [pts[0]], 0.0
    for i in range(1, len(pts)):
        x0, y0 = out[-1] if acc == 0 else pts[i - 1]
        px, py = pts[i - 1]
        qx, qy = pts[i]
        seg = math.hypot(qx - px, qy - py)
        d = acc + seg
        while d >= step:
            t = (step - acc) / seg if seg > 0 else 0
            px, py = px + (qx - px) * t, py + (qy - py) * t
            out.append((px, py))
            seg = math.hypot(qx - px, qy - py)
            acc, d = 0.0, seg
        acc = d
    out.append(pts[-1])
    return out

lam = resample(lam, 10.0)

# ---------------- Cross streets ----------------
# key: (exact names, class). Crossing position is found from geometry, not guessed.
SPEC = {
    "barton":    ({"Barton Springs Road"}, "major"),
    "toomey":    ({"Toomey Road"}, "minor"),
    "riverside": ({"West Riverside Drive"}, "minor"),
    "cesar":     ({"West Cesar Chavez Street", "East Cesar Chavez Street"}, "major"),
    "third":     ({"West 3rd Street", "East 3rd Street"}, "minor"),
    "fifth":     ({"West 5th Street", "East 5th Street"}, "major"),
    "sixth":     ({"West 6th Street", "East 6th Street"}, "major"),
    "ninth":     ({"West 9th Street", "East 9th Street"}, "minor"),
    "tenth":     ({"West 10th Street", "East 10th Street"}, "minor"),
    "twelfth":   ({"West 12th Street", "East 12th Street"}, "major"),
    "fifteenth": ({"West 15th Street", "East 15th Street"}, "major"),
}
XWIN = 840

roads = {}
for key, (names, cls) in SPEC.items():
    pts, ow_e, ow_w, ow_yes, ow_tot = [], 0, 0, 0, 0
    for w in ways:
        t = w.get("tags", {})
        if t.get("name") in names and t.get("highway") not in BAD_HW:
            wp = [(x, y) for x, y in way_pts(w) if -XWIN < x < XWIN and -1640 < y < 1450]
            if len(wp) < 2:
                continue
            pts += wp
            ow_tot += 1
            if t.get("oneway") == "yes":
                ow_yes += 1
                if wp[-1][0] - wp[0][0] > 0:
                    ow_e += 1
                else:
                    ow_w += 1
    if not pts:
        print("!! no points for", key, file=sys.stderr)
        continue
    b = collections.defaultdict(list)
    for x, y in pts:
        b[round(x / 12)].append(y)
    line = [(k * 12.0, sum(v) / len(v)) for k, v in sorted(b.items())]
    line = resample(smooth(smooth(line)), 12.0)
    oneway = 0
    # one-way only if strongly one-directional; dual carriageways have both E and W oneway ways
    if ow_tot and ow_yes / ow_tot > 0.75 and (ow_e == 0 or ow_w == 0 or max(ow_e, ow_w) / (ow_e + ow_w) > 0.85):
        oneway = 1 if ow_e > ow_w else -1
    roads[key] = {"name": sorted(names)[0], "cls": cls, "pts": line, "oneway": oneway}

# ---------------- Intersections with Lamar ----------------
def seg_int(p, q, a, b):
    d1x, d1y = q[0] - p[0], q[1] - p[1]
    d2x, d2y = b[0] - a[0], b[1] - a[1]
    den = d1x * d2y - d1y * d2x
    if abs(den) < 1e-9:
        return None
    t = ((a[0] - p[0]) * d2y - (a[1] - p[1]) * d2x) / den
    u = ((a[0] - p[0]) * d1y - (a[1] - p[1]) * d1x) / den
    if 0 <= t <= 1 and 0 <= u <= 1:
        return (p[0] + t * d1x, p[1] + t * d1y)
    return None

def arc_s(pts, pt):
    best, bs, acc = 1e18, 0.0, 0.0
    for i in range(len(pts) - 1):
        px, py = pts[i]; qx, qy = pts[i + 1]
        seg = math.hypot(qx - px, qy - py)
        if seg < 1e-9:
            continue
        t = max(0.0, min(1.0, ((pt[0] - px) * (qx - px) + (pt[1] - py) * (qy - py)) / (seg * seg)))
        cx, cy = px + t * (qx - px), py + t * (qy - py)
        d = math.hypot(pt[0] - cx, pt[1] - cy)
        if d < best:
            best, bs = d, acc + t * seg
        acc += seg
    return bs, best

NAMES = {"barton": "Barton Springs Rd", "toomey": "Toomey Rd", "riverside": "Riverside Dr",
         "cesar": "Cesar Chavez St", "third": "3rd St",
         "fifth": "5th St", "sixth": "6th St", "ninth": "9th St", "tenth": "10th St",
         "twelfth": "12th St", "fifteenth": "15th St"}

inters = []
for key, r in roads.items():
    hit = None
    for i in range(len(lam) - 1):
        for j in range(len(r["pts"]) - 1):
            p = seg_int(lam[i], lam[i + 1], r["pts"][j], r["pts"][j + 1])
            if p:
                hit = p
                break
        if hit:
            break
    if not hit:
        # T intersection: snap to closest approach, extend toward Lamar
        best, bp = 1e18, None
        for q in r["pts"]:
            s, d = arc_s(lam, q)
            if d < best:
                best, bp = d, q
        if best < 90:
            s, _ = arc_s(lam, bp)
            # place on Lamar centerline
            hit = None
            acc = 0.0
            for i in range(len(lam) - 1):
                seg = math.hypot(lam[i+1][0]-lam[i][0], lam[i+1][1]-lam[i][1])
                if acc + seg >= s:
                    t = (s - acc) / seg
                    hit = (lam[i][0] + t * (lam[i+1][0]-lam[i][0]), lam[i][1] + t * (lam[i+1][1]-lam[i][1]))
                    break
                acc += seg
        if not hit:
            print("!! no crossing for", key, file=sys.stderr)
            continue
    sL, _ = arc_s(lam, hit)
    sC, _ = arc_s(r["pts"], hit)
    sig = min(math.hypot(sx - hit[0], sy - hit[1]) for sx, sy in signals) if signals else 999
    inters.append({"key": key, "name": NAMES[key], "x": round(hit[0], 1), "y": round(hit[1], 1),
                   "sLamar": round(sL, 1), "sCross": round(sC, 1), "cls": r["cls"],
                   "oneway": r["oneway"], "signalDist": round(sig, 1)})
inters.sort(key=lambda i: i["sLamar"])

# ---------------- Water ----------------
def stitch(members):
    segs = [[tuple(proj(g["lat"], g["lon"])) for g in m["geometry"]] for m in members
            if m["type"] == "way" and m.get("role") == "outer" and m.get("geometry")]
    rings, cur = [], None
    while segs:
        if cur is None:
            cur = segs.pop(0)
        if math.hypot(cur[0][0] - cur[-1][0], cur[0][1] - cur[-1][1]) < 1.0 and len(cur) > 3:
            rings.append(cur)
            cur = None
            continue
        found = False
        for i, s in enumerate(segs):
            for flip in (False, True):
                t = s[::-1] if flip else s
                if math.hypot(cur[-1][0] - t[0][0], cur[-1][1] - t[0][1]) < 1.0:
                    cur += t[1:]
                    segs.pop(i)
                    found = True
                    break
            if found:
                break
        if not found:
            rings.append(cur)
            cur = None
    if cur:
        rings.append(cur)
    return rings

def clip_poly(poly, xmin, ymin, xmax, ymax):
    def clip_edge(pts, inside, isect):
        out = []
        for i in range(len(pts)):
            a, b = pts[i - 1], pts[i]
            ia, ib = inside(a), inside(b)
            if ib:
                if not ia:
                    out.append(isect(a, b))
                out.append(b)
            elif ia:
                out.append(isect(a, b))
        return out
    p = poly
    for edge in range(4):
        if not p:
            return []
        if edge == 0:
            p = clip_edge(p, lambda q: q[0] >= xmin, lambda a, b: (xmin, a[1] + (b[1]-a[1]) * (xmin-a[0]) / (b[0]-a[0])))
        elif edge == 1:
            p = clip_edge(p, lambda q: q[0] <= xmax, lambda a, b: (xmax, a[1] + (b[1]-a[1]) * (xmax-a[0]) / (b[0]-a[0])))
        elif edge == 2:
            p = clip_edge(p, lambda q: q[1] >= ymin, lambda a, b: (a[0] + (b[0]-a[0]) * (ymin-a[1]) / (b[1]-a[1]), ymin))
        else:
            p = clip_edge(p, lambda q: q[1] <= ymax, lambda a, b: (a[0] + (b[0]-a[0]) * (ymax-a[1]) / (b[1]-a[1]), ymax))
    return p

lake = []
for r in rels:
    if r.get("tags", {}).get("name") == "Lady Bird Lake":
        rings = stitch(r["members"])
        rings.sort(key=len, reverse=True)
        for ring in rings[:1]:
            c = clip_poly(ring, -940, -1000, 850, 400)
            if len(c) > 3:
                lake = resample(c, 18.0)
print("lake ring pts:", len(lake), file=sys.stderr)

ponds = []
for w in ways:
    t = w.get("tags", {})
    if t.get("natural") == "water" and w["geometry"][0] == w["geometry"][-1]:
        p = way_pts(w)
        xs, ys = [q[0] for q in p], [q[1] for q in p]
        if min(xs) > -940 and max(xs) < 850 and min(ys) > -1640 and max(ys) < 1450 and len(p) > 5:
            ponds.append(resample(p, 15.0))

creeks = []
for w in ways:
    t = w.get("tags", {})
    if t.get("waterway") in ("river", "stream") and t.get("name") in ("Shoal Creek", "West Bouldin Creek"):
        p = [(x, y) for x, y in way_pts(w) if -940 < x < 850 and -1640 < y < 1450]
        if len(p) > 4:
            creeks.append({"name": t.get("name"), "pts": resample(p, 15.0)})

# ---------------- Emit ----------------
def rnd(pts):
    return [[round(x, 1), round(y, 1)] for x, y in pts]

geo = {
    "attribution": "Road & water geometry (c) OpenStreetMap contributors (ODbL)",
    "ref": {"lat": REFLAT, "lon": REFLON},
    "lamar": rnd(lam),
    "roads": {k: {"name": r["name"], "cls": r["cls"], "oneway": r["oneway"], "pts": rnd(r["pts"])}
              for k, r in roads.items()},
    "intersections": inters,
    "water": {"lake": rnd(lake), "ponds": [rnd(p) for p in ponds],
              "creeks": [{"name": c["name"], "pts": rnd(c["pts"])} for c in creeks]},
}
print("// GENERATED by tools/build_geometry.py -- do not edit by hand.")
print("// Real street geometry: Lamar Blvd corridor, Austin TX.")
print("// Data (c) OpenStreetMap contributors, ODbL 1.0 -- openstreetmap.org/copyright")
print("const GEO = " + json.dumps(geo) + ";")

# report
print("\n=== INTERSECTIONS (s along Lamar from south end) ===", file=sys.stderr)
prev = None
for i in inters:
    gap = "" if prev is None else "  (+%dm)" % (i["sLamar"] - prev)
    ow = {0: "two-way", 1: "one-way EB", -1: "one-way WB"}[i["oneway"]]
    print("  s=%6.0f  y=%6.0f  %-18s %-6s %-10s signal@%.0fm%s" %
          (i["sLamar"], i["y"], i["name"], i["cls"], ow, i["signalDist"], gap), file=sys.stderr)
print("Lamar length: %.0f m, %d pts" % (sum(math.hypot(lam[i+1][0]-lam[i][0], lam[i+1][1]-lam[i][1]) for i in range(len(lam)-1)), len(lam)), file=sys.stderr)
print("ponds: %d, creeks: %d" % (len(ponds), len(creeks)), file=sys.stderr)
