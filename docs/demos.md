# The Driving Lab — every claim becomes a playable proof

Principle: no lectures. Each demo is a toy the visitor plays with, where the *discovery* is
theirs. Sliders change one believable human behavior; the metrics and the picture do the
arguing. **All seven demos are built** and linked by the nav strip on every page. And one
principle above all: when the model disagrees with the thesis, the page says so (see 05).

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

## 02 — The Ring ✅ (`ring/`)

**Claims:** #4, #5, #6 — traffic as a wave; driving style as the wave source; calm drivers
as absorbers. Recreates the Sugiyama circle: 28 cars, no lights, no reason to stop — a
stop-and-go wave is born from nothing within minutes (0–29 mph swings) and orbits backward,
drawn live in a position-vs-time spiral diagram. Trained drivers act as variance-gated jam
absorbers (they widen their cushion only when a wave approaches, so they never destabilize
smooth flow). Measured dose-response: **4 of 28 trained cuts hard braking ~65% and speed
swing ~32%**; the full fleet is glass-smooth; below ~19 cars the ring can't jam at all.
Calibrated against the Stern 2018 field experiment (variance/fuel reduction, not magic
erasure) — the honest version of the one-driver story.

## 03 — The Merge ✅ (`merge/`)

**Claims:** traffic source #1, belief #3 mechanics. Two-lane highway + on-ramp; sliders for
merger speed-matching and gap acceptance, mainline courtesy-braking vs make-room-by-moving.
At 1,700+600 veh/h: creep-and-courtesy runs the merge at 37 mph with ~93 fleet brake
taps/min; the speed-matched zipper holds 60 mph with ~7. At 1,900+650 today collapses
(11 mph, 8-minute ramp waits) while trained serves everything. Modeling lesson learned:
courtesy-braking for a merger *behind* you deadlocks the highway — real courtesy yields
only to someone slotting in ahead.

## 04 — The Mirrors ✅ (`mirrors/`)

**Claim:** #2. Pure geometry, no traffic: vision cones (windshield, side glass capped by
the B-pillar, rear-view, two side mirrors with live-adjustable aim), an animated overtaker
colored by whoever sees it, and a deterministic coverage bar sweeping the whole pass.
Driving-school aim (~3° out, your own flank visible): a **4-meter fully-invisible zone** at
your rear quarter. BGE wide aim (~28°): continuous rear-view → mirror → eyes hand-off,
zero gap — and over-rotating past ~32° reopens a small one. Instantly checkable in a real
car.

## 05 — Trucks & Packs ✅ with an open question (`trucks/`)

**Claims:** traffic source #3 — *partially unsupported by our model, and the page says so.*
Three-lane loop, governed trucks, herding + truck-fear sliders, left-lane ban toggle. What
holds up: elephant races ~double the boxed-in count; density dominates at the extremes; and
lane-change churn seeds packs, so calm lane-holding beats eager hopping ("doing less" wins
again — three separate trained-driver strategies that moved MORE all made things worse).
What doesn't: IDM + gap-acceptance produces only mild packs (8–16 vehicles), not the giant
rolling globs of the thesis. Either real packs need unmodeled mechanisms (defensive closing
against cut-ins, rubbernecking) or this source is smaller than believed. Kept honest rather
than tuned into submission.

## 06 — The Couplet ✅ (`couplet/`)

**Claim:** #7c. Split-screen race: a two-way arterial vs the same lane-count as a one-way
pair, identical drivers/demand/signal hardware. Uncoordinated: all four flows equal
(~130–150s trips). Coordinated: the arterial must choose a direction (NB 86s/0.3 stops, SB
still 152s/2.8) while **the pair waves both directions** (85s/84s, ~0.2 stops — within 10
seconds of free-flow). Why Austin's 5th/6th exist; the walkability trade-off is noted on
the page.

## 07 — The Cockpit ✅ (`cockpit/`)

**Claim:** #2, again — demo 04 from the driver's seat. Same zone constants as The Mirrors
(16° flat side glass, 30° rear-view, ±70° head-still eyes), so the blind-zone numbers
agree; the new thing is the view. A software-3D cockpit (vanilla canvas): one first-person
camera in the driver's seat with a turnable head — drag the road or hold ←/→ to glance,
and the view eases back when you let go — inside a 3D cabin (pillars, roof, dash, doors,
seats; the windows are the gaps). Mirrors are cabin-anchored billboards whose glass is
rendered by demo 04's cone cameras, horizontally flipped like real glass: a rear-view and
two live-aimable side mirrors (drag to aim), a stream of overtakers on random sides (bias
slider; some start in your lane and merge out before passing), and the dash screen
literally running demo 04's top-down view as ground truth. The wide preset is tuned (19°
on this page's flat-glass cones) so the canonical BGE relay is visible on the glass
itself: rear-view middle → rear-view edge overlapping the side mirror's inner edge →
sweep across the side mirror → window — never in nothing, on either side. The glance is the
shoulder check made literal — turning your head finds the "invisible" car with your own
eyes, and the page says out loud that the coverage numbers stay head-still on purpose.
With school aim you watch the passer leave the side mirror
*while still behind your shoulder* and go invisible for measured seconds (the "invisible
per pass" metric); with BGE aim the hand-off rear-view → mirror → window never breaks. The
school-aim mirror also shows your own rear door — glass spent on your own paint. Honesty
notes on the page: pillars are drawn but not modeled as blockers, windows are flat
projections, real right-side mirrors are convex.

## Someday

- Mixed-autonomy: what % of AI cars driving "trained" fixes a city (the mix slider, scaled).
- A first-person "no brakes" game: drive the corridor, score = fewest brake presses
  (the San Diego game, playable).
- Import any city corridor from OSM automatically (the build pipeline already mostly does this).
- Turn movements + pedestrians in demo 01 (the biggest known gap vs the real 5th & Lamar).
- "Austin's actual plan" preset once the signal-timing records request comes back.
- A better pack model for demo 05 (cut-in defense, rubbernecking) to settle its open question.
