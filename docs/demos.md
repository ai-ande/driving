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

Measured results (steady state, 6-minute windows, v0.2 corridor):

| Scenario | NB cars/hr | NB avg trip | NB stops/car |
|---|---|---|---|
| Free flow (reference) | — | 2:36 | 0 |
| Drivers today, 1.0× demand | 1,250 | 5:20 | 4.2 |
| Trained drivers, same lights | 1,240 | 4:32 | 2.6 |
| Trained + green wave | 1,250 | **3:17** | **0.5** |
| Drivers today, 1.5× demand | 1,300 (capped) + 213 cars stuck off-map | 6:11 | 4.8 |
| Trained drivers, 1.5× demand | **1,890 (all demand served)** | 5:11 | 3.7 |
| Trained + wave, 1.5× demand | 1,890 (all served) | 3:46 | 0.9 |

Headline: **behavior alone adds ~45% capacity to the same road**; behavior + signal
coordination gets a full rush hour within ~40 seconds of empty-road travel time. In
measured-weekday replay at the 8 AM peak, the sim's speed at the Lamar bridge lands within
a few mph of what the city's radar actually recorded in 2019 — with no tuning against it.

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
