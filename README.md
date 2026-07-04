# driving

**Claim: a few teachable changes to how people drive would eliminate most traffic — no new
lanes required. This repo turns that claim into playable, falsifiable demos.**

## Demo #1: Lamar & the Lights

A traffic simulation of the real Lamar Blvd corridor in Austin, TX — Barton Springs Rd
across the Lady Bird Lake bridge up to 15th St, with all 11 real signalized intersections
and the one-way 5th/6th couplet, built from OpenStreetMap geometry.

**Run it:** any static server, e.g.

```
python3 -m http.server 8347
# open http://localhost:8347
```

(Or enable GitHub Pages on this repo — it's a plain static site, `index.html` at root.)

**What to try, in order:**

1. Watch the *Drivers today* preset: zoom to "5th & Lamar" and watch a queue "unzip" one
   car at a time when the light turns green. That stagger is human reaction time, and it
   burns a large share of every green.
2. Click **Trained drivers**: same road, same lights, same demand — reaction 0.3s, tighter
   cushion, and coasting instead of braking. Watch stops/car and trip time fall.
3. Click **Trained + green wave**: signals re-timed so platoons surf the greens. Trips run
   within ~40s of empty-road time at full rush-hour demand.
4. Drag **Demand to 1.5×**: today's drivers cap out and pile a backlog off the map;
   trained drivers move ~45% more cars through the identical road.
5. Play with the individual sliders (reaction, cushion, acceleration, looking-ahead,
   share-of-trained-drivers) and the signal timing. Settings live in the URL hash — copy
   the link to share a scenario.

The dark strip below the map is a **time–space diagram** — the standard traffic-engineering
x-t plot. Stop-and-go waves appear as red-banded fans; a working green wave appears as
unbroken diagonal streaks.

### How the model works (honesty section)

- Car-following is the **Intelligent Driver Model** (IDM), standard in traffic research,
  plus: an explicit per-driver **reaction delay** when starting from a stop, a perception
  horizon (drivers who don't look ahead brake late and hard), and a **latest-gentle-liftoff**
  glide behavior for anticipating drivers (ease off just early enough to arrive at the line
  slowly and still rolling — the light gets time to change).
- Signals are simplified fixed-time two-phase (real Austin signals are actuated and have
  turn phases); minor crossings get a short side phase. **Through traffic only — no turns
  yet.** Demand levels are plausible rush-hour estimates, not measured counts.
- Numbers worth trusting: relative comparisons between presets. Numbers not to quote as
  fact: absolute veh/hr for the real Lamar.

Street & water geometry © [OpenStreetMap](https://www.openstreetmap.org/copyright)
contributors (ODbL), extracted via the reproducible pipeline in `tools/`
(`overpass*.ql` + `build_geometry.py` → `js/geometry.js`).

## The ideas

- [docs/thesis.md](docs/thesis.md) — the full belief system, organized: seven misconceptions,
  three sources of traffic, the teachable skills.
- [docs/evidence.md](docs/evidence.md) — which beliefs existing research supports (induced
  demand, phantom jams, wave-damping drivers, BGE mirrors…), and which are contested.
- [docs/demos.md](docs/demos.md) — the roadmap: ring-road phantom jams, merges, the mirror
  room, trucks & packs, one-way couplets. Every claim becomes a toy.
- [docs/outreach.md](docs/outreach.md) — how this reaches the world without triggering the
  ego defenses the thesis itself predicts. Never grade the person; grade the flow.

## Repo layout

```
index.html, css/, js/     the simulator (no build step, no dependencies)
js/geometry.js            generated real-street geometry (do not hand-edit)
tools/                    OSM extraction pipeline (Overpass queries + builder)
docs/                     thesis, evidence, demo roadmap, outreach plan
```
