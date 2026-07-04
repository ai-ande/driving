# Demo roadmap — every claim becomes a playable proof

Principle: no lectures. Each demo is a toy the visitor plays with, where the *discovery* is
theirs. Sliders change one believable human behavior; the metrics and the picture do the
arguing.

## v0.2 — Lamar & the Lights ✅ (this repo)

**Claims tested:** #7 (red-light behavior + signal timing), #5 partially (anticipation /
coasting), the "ripple" core idea, and the trained-share thought experiment.

Real geometry: Lamar Blvd from Barton Springs Rd to 15th St, the corridor's 9 real
signalized intersections, one-way 5th/6th couplet, Lady Bird Lake, Shoal Creek — all from
OpenStreetMap. v0.2 integrated City of Austin open data: measured 2019 weekday demand
replay (radar counts), per-intersection signal records, live camera views, optional live
TomTom speeds — and the data *corrected the map*: 3rd St has no signal, and 15th St passes
over Lamar on a bridge (both had been simulated as red lights in v0.1).

Physics: Intelligent Driver Model (standard car-following used in research) + explicit
human reaction delay at startup + a "looking ahead" behavior that converts late hard braking
into early gentle coasting (latest-gentle-liftoff).

v0.3 added the two missing pieces of downtown reality: a **turn-arrow/pedestrian phase
allowance** at major crossings (cycle time neither through movement gets, default 12 s,
pending the city's real timing sheets) and **distraction at reds** (a share of stopped
drivers miss the launch by 1–4 s — the phone-check holes that make the back of a queue
never move before the light turns red again). With those in, the sim reproduces the
corridor's observed failure mode: at measured 2019 volumes, 37 of 40 greens at 5th & Lamar
end with stopped cars left behind, and the queue periodically reaches back across the
Cesar Chavez bridge — exactly what regulars report. At 1.3× (≈ today's volumes) the AM
peak collapses outright.

Measured results (steady state, 6-minute windows, v0.3 corridor):

| Scenario | NB cars/hr | NB avg trip | NB stops/car |
|---|---|---|---|
| Free flow (reference) | — | 2:36 | 0 |
| Drivers today, 1.0× demand | **860 (saturated)** + slow off-map backlog | 8:25 | 6.8 |
| Trained drivers, same lights | 1,240 (all demand served) | 4:58 | 3.6 |
| Trained + green wave | 1,240 (all served) | **3:23** | **0.6** |
| Drivers today, 1.5× demand | 870 (capped) + **787 cars stuck off-map** | 7:33* | 6.3 |
| Trained drivers, 1.5× demand | 1,600 | 7:05 | 5.1 |
| Trained + wave, 1.5× demand | 1,680 | 4:53 | 1.6 |

\* shorter than 1.0× only because most of the delay has been pushed off-map (787 queued
outside the corridor vs 9).

Headline: with real-world signal overhead and phone-level distraction, **today's drivers
get ~860 veh/h out of a corridor that trained drivers move ~1,650–1,700 through — roughly
double** — and with a green wave the same rush runs near free-flow. Calibration
philosophy: the "today" parameters are tuned to reproduce the corridor's *observed*
failure (5th St backing up to the bridge at real volumes), not an idealized
textbook saturation flow. In measured-weekday replay the sim's bridge speed brackets the
2019 radar measurement (slightly fast at 1.0×, slightly slow at 1.4×).

Next polish ideas: the city's real timing plans via public-records request ("Austin's
actual plan" preset); click-a-car "ride along" camera; per-intersection timing editors;
turn movements; pedestrian phases; actuated (sensor) signals.

## v0.2 — The Ring Road (phantom jams)

**Claims:** #4, #5, #6 — traffic as a wave; brakes as the wave source; one driver as damper.
Recreates the Sugiyama circle experiment: N cars, no lights, no reason to stop. Sliders for
reaction time, following gap, anticipation; a "make one driver trained" button. Watch the
wave be born from nothing, then watch one calm car erase it. This is the purest, most
shareable version of the core idea — 30-second video material.

## v0.3 — The Merge (on-ramp / lane drop)

**Claims:** traffic source #1, belief #3 mechanics.
A freeway on-ramp and a construction lane-drop. Behavior sliders: zipper discipline,
speed-match vs brake-in, "politeness braking," early vs late merging. Metrics: throughput,
wave frequency upstream. Tests the accelerate-into-gap protocol against entitled-signal
merging honestly.

## v0.4 — The Mirror Room (blind spots)

**Claim:** #2. Not a traffic sim — an interactive top-down car with draggable mirror angles
showing the actual coverage cones and the hand-off sequence as a car overtakes. Two presets:
"driving school" vs "wide." A passing car either vanishes into the blind zone or never
disappears. Instantly checkable by anyone in their own car; highest practical-conversion
demo of the set.

## v0.5 — Trucks & Packs

**Claims:** traffic source #3. Mixed traffic with heavy vehicles, a pack-formation tendency
slider ("comfort of the herd"), truck lane policy toggle. Metrics: speed distribution,
pack size, time-to-pass.

## v0.6 — One-Way Couplet vs Two-Way Arterial

**Claim:** #7c. Same demand on (a) one bidirectional arterial vs (b) a 5th/6th-style pair,
both with best-effort signal progression. Austin's own grid is the case study.

## Someday

- Mixed-autonomy: what % of AI cars driving "trained" fixes a city (the mix slider, scaled).
- A first-person "no brakes" game: drive the corridor, score = fewest brake presses
  (the San Diego game, playable).
- Import any city corridor from OSM automatically (the build pipeline already mostly does this).
