#!/usr/bin/env python3
"""Build js/demand_profile.js and js/austin_meta.js from City of Austin open data.

Sources (data.austintexas.gov, public Socrata APIs):
  i626-g7ub  Radar Traffic Counts   (15-min volumes+speeds; program ended Sept 2021)
  p53x-x73x  Traffic Signals        (live metadata: signal ids, retiming zones, LPI)
  g8w2-8uap  Traffic Signal Re-Timing (annual program log)
  b4k4-adkb  Traffic Cameras        (live snapshot JPEGs at cctv.austinmobility.io)

Demand profile = typical 2019 Tue/Wed/Thu (pre-COVID, the last full year of the
radar program), mean volume per 15-minute bin:
  northbound spawn  <- LAMAR/COLLIER  NB_in  (S Lamar feed into the corridor)
  southbound spawn  <- LAMAR/SANDRA MURAIDA SB_in (downtown feed toward the bridge)
  measured bridge speeds <- LAMAR/SANDRA MURAIDA NB_in/SB_in speed field

Usage: python3 tools/build_austin_data.py   (writes into js/)
"""
import json, math, sys, os, urllib.request, urllib.parse

BASE = "https://data.austintexas.gov/resource/"
REFLAT, REFLON = 30.2700, -97.7530
MLAT = 110950.0
MLON = 111320.0 * math.cos(math.radians(REFLAT))
OUT = os.path.join(os.path.dirname(__file__), "..", "js")

def soda(dataset, **params):
    qs = urllib.parse.urlencode({("$" + k if not k.startswith("$") else k): v
                                 for k, v in params.items()})
    url = BASE + dataset + ".json?" + qs
    req = urllib.request.Request(url, headers={"User-Agent": "driving-sim-research/0.1"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())

# ---------------- demand profile ----------------
def radar_series(intname, detname):
    rows = soda("i626-g7ub",
        select="timebin, avg(volume) AS vol, avg(speed) AS spd, count(1) AS n",
        where=f"intname='{intname}' AND detname='{detname}' AND year='2019' "
              f"AND day_of_week in ('2','3','4')",
        group="timebin", order="timebin", limit="200")
    out = {}
    for r in rows:
        if r.get("timebin"):
            out[r["timebin"]] = (float(r["vol"]), float(r["spd"]), int(r["n"]))
    return out

def build_profile():
    print("fetching radar series (3 queries)...", file=sys.stderr)
    nb_feed = radar_series("LAMARCOLLIER", "NB_in")          # volumes for NB spawn
    sb_feed = radar_series("LAMARSANDRA MURAIDA", "SB_in")   # volumes for SB spawn
    nb_bridge = radar_series("LAMARSANDRA MURAIDA", "NB_in") # measured bridge speeds

    bins = [f"{h:02d}:{m:02d}" for h in range(24) for m in (0, 15, 30, 45)]
    def series(src, idx):
        vals = []
        for b in bins:
            v = src.get(b)
            vals.append(round(v[idx], 1) if v else None)
        # fill occasional gaps by neighbor interpolation
        for i, v in enumerate(vals):
            if v is None:
                lo = next((vals[j] for j in range(i - 1, -1, -1) if vals[j] is not None), 0)
                hi = next((vals[j] for j in range(i + 1, len(vals)) if vals[j] is not None), lo)
                vals[i] = round((lo + hi) / 2, 1)
        return vals

    prof = {
        "bins": bins,
        # veh/h (15-min counts x4). Spawn feeds use the BRIDGE sensor (mid-corridor):
        # it includes traffic that turned onto Lamar from Barton Springs/Riverside,
        # which the upstream Collier sensor never sees. Both directions are thus
        # "bridge-calibrated" — exact at the bridge, slightly generous at the entries.
        "nbVeh": [round(v * 4) for v in series(nb_bridge, 0)],
        "sbVeh": [round(v * 4) for v in series(sb_feed, 0)],
        "nbVehCollier": [round(v * 4) for v in series(nb_feed, 0)],  # upstream reference
        # measured speeds at the bridge (mph, radar reports mph)
        "nbSpeedMph": series(nb_bridge, 1),
        "sbSpeedMph": series(sb_feed, 1),
        "samplesPerBin": {
            "nb": round(sum(v[2] for v in nb_bridge.values()) / max(1, len(nb_bridge))),
            "sb": round(sum(v[2] for v in sb_feed.values()) / max(1, len(sb_feed))),
        },
        "meta": {
            "source": "City of Austin Radar Traffic Counts (data.austintexas.gov/d/i626-g7ub)",
            "profile": "Mean of Tue/Wed/Thu 2019 per 15-min bin",
            "nbSensor": "Lamar & Sandra Muraida NB_in (at the bridge)",
            "sbSensor": "Lamar & Sandra Muraida SB_in (at the bridge)",
            "speedSensor": "Lamar & Sandra Muraida (at the bridge)",
            "note": "Radar count program ended Sept 2021; this is a historical baseline.",
        },
    }
    peak_nb = max(prof["nbVeh"]); peak_i = prof["nbVeh"].index(peak_nb)
    print(f"NB bridge peak {peak_nb} veh/h at {bins[peak_i]}; "
          f"SB bridge peak {max(prof['sbVeh'])} veh/h at {bins[prof['sbVeh'].index(max(prof['sbVeh']))]}",
          file=sys.stderr)
    print("      time  NB@Collier  NB@bridge   (turn-in gain)", file=sys.stderr)
    for tb in ("07:00", "07:30", "08:00", "08:30", "09:00", "12:00", "17:00", "17:30"):
        i = bins.index(tb)
        c, b = prof["nbVehCollier"][i], prof["nbVeh"][i]
        print(f"      {tb}   {c:5d}       {b:5d}      ({b - c:+d})", file=sys.stderr)
    with open(os.path.join(OUT, "demand_profile.js"), "w") as f:
        f.write("// GENERATED by tools/build_austin_data.py -- do not edit.\n")
        f.write("// Typical-weekday demand measured by City of Austin radar sensors (2019).\n")
        f.write("const DEMAND_PROFILE = " + json.dumps(prof) + ";\n")

# ---------------- per-intersection metadata ----------------
# verified live cameras near each intersection (from b4k4-adkb, July 2026)
CAMERA_FOR = {
    "barton": 379, "toomey": 54, "riverside": 97, "cesar": 315,
    "fifth": 346, "sixth": 345, "ninth": 314, "twelfth": 94, "fifteenth": 666,
}

def corridor_intersections():
    """Read intersection keys + local coords from the generated geometry."""
    with open(os.path.join(OUT, "geometry.js")) as f:
        s = f.read()
    geo = json.loads(s[s.index("const GEO = ") + 12:].rstrip().rstrip(";"))
    return {i["key"]: (i["x"], i["y"]) for i in geo["intersections"]}

def build_meta():
    inters = corridor_intersections()
    print("fetching signals (bounding box)...", file=sys.stderr)
    lat0, lat1 = REFLAT - 1500 / MLAT, REFLAT + 1600 / MLAT
    lon0, lon1 = REFLON - 950 / MLON, REFLON + 950 / MLON
    sigs = soda("p53x-x73x",
        select="signal_id,location_name,corridor_retiming_zone,leading_pedestrian_interval,"
               "signal_status,turn_on_date,location",
        where=f"signal_status='TURNED_ON' AND within_box(location, {lat1}, {lon0}, {lat0}, {lon1})",
        limit="500")
    for s in sigs:  # project to local meters once
        try:
            lon, lat = s["location"]["coordinates"]
            s["_x"], s["_y"] = (lon - REFLON) * MLON, (lat - REFLAT) * MLAT
        except Exception:
            s["_x"] = s["_y"] = 1e9

    print("fetching retiming log...", file=sys.stderr)
    retime = soda("g8w2-8uap", select="system_name,scheduled_fy,retime_status,status_date",
                  where="retime_status='COMPLETED'", order="status_date DESC", limit="500")
    latest_retime = {}
    for r in retime:
        nm = (r.get("system_name") or "").strip().upper()
        if nm and nm not in latest_retime:
            latest_retime[nm] = {"fy": r.get("scheduled_fy"), "date": (r.get("status_date") or "")[:10]}

    print("fetching cameras...", file=sys.stderr)
    cams = {}
    cam_rows = soda("b4k4-adkb", select="camera_id,location_name,camera_status,screenshot_address,location",
                    where="camera_status='TURNED_ON'", limit="1200")
    for c in cam_rows:
        try:
            cams[int(c["camera_id"])] = c
        except Exception:
            pass

    meta = {}
    for key, (ix, iy) in inters.items():
        entry = {}
        # nearest live signal to the geometric intersection (they sit within ~40 m);
        # wider fallback requires LAMAR in the name (e.g. 15th is filed as LAMAR/PARKWAY)
        best, bd = None, 1e18
        for s in sigs:
            d = (s["_x"] - ix) ** 2 + (s["_y"] - iy) ** 2
            if d < bd:
                bd, best = d, s
        if best and bd >= 120 ** 2:
            lam = [s for s in sigs if "LAMAR" in s["location_name"].upper()]
            best2, bd2 = None, 1e18
            for s in lam:
                d = (s["_x"] - ix) ** 2 + (s["_y"] - iy) ** 2
                if d < bd2:
                    bd2, best2 = d, s
            if best2 and bd2 < 260 ** 2:
                best, bd = best2, bd2
        if best and bd < 260 ** 2:
            zone = (best.get("corridor_retiming_zone") or "").strip()
            rt = latest_retime.get(zone.upper())
            entry.update({
                "signalId": best["signal_id"],
                "signalName": best["location_name"].strip(),
                "signalDist": round(math.sqrt(bd)),
                "zone": zone or None,
                "lpi": best.get("leading_pedestrian_interval") == "True",
                "retimedFY": rt["fy"] if rt else None,
                "retimedDate": rt["date"] if rt else None,
            })
        cam_id = CAMERA_FOR.get(key)
        if cam_id and cam_id in cams:
            c = cams[cam_id]
            lon, lat = c["location"]["coordinates"]
            entry["camera"] = {
                "id": cam_id,
                "name": c["location_name"].strip(),
                "url": c.get("screenshot_address") or f"https://cctv.austinmobility.io/image/{cam_id}.jpg",
                "x": round((lon - REFLON) * MLON, 1),
                "y": round((lat - REFLAT) * MLAT, 1),
            }
        meta[key] = entry
        print(f"  {key:10s} signal={entry.get('signalId','?'):>4} zone={entry.get('zone')} "
              f"retimed={entry.get('retimedFY')} cam={cam_id if 'camera' in entry else '-'}", file=sys.stderr)

    out = {
        "intersections": meta,
        "sources": {
            "signals": "data.austintexas.gov/d/p53x-x73x",
            "retiming": "data.austintexas.gov/d/g8w2-8uap",
            "cameras": "data.austintexas.gov/d/b4k4-adkb",
        },
    }
    with open(os.path.join(OUT, "austin_meta.js"), "w") as f:
        f.write("// GENERATED by tools/build_austin_data.py -- do not edit.\n")
        f.write("// Live signal metadata + camera feeds, City of Austin open data.\n")
        f.write("const AUSTIN_META = " + json.dumps(out) + ";\n")

if __name__ == "__main__":
    build_profile()
    build_meta()
    print("wrote js/demand_profile.js, js/austin_meta.js", file=sys.stderr)
