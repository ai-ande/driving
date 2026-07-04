# Evidence map

How each belief in [thesis.md](thesis.md) relates to existing research. Three buckets:
**supported** (published work agrees), **partially supported** (agrees with caveats),
**contested** (mainstream guidance or law disagrees — worth demonstrating carefully).

> Citations below are from memory and should be verified before publishing anything —
> but the anchor works are famous and easy to confirm.

## Supported

**Adding lanes doesn't fix congestion (belief 1).**
"Induced demand" / "the fundamental law of road congestion": vehicle-miles traveled rises
~proportionally with lane-miles built. Duranton & Turner, *American Economic Review* 2011.
Houston's 23-lane Katy Freeway is the standard cautionary example. Related: Braess's paradox
(adding a link can slow everyone) and the Downs–Thomson paradox. This one is settled enough
that transportation economists treat it as a law.

**Traffic behaves like a wave; jams appear without any cause (belief 4, 6).**
Sugiyama et al., *New Journal of Physics* 2008: cars on a circular track, instructed to hold
steady speed, spontaneously produce a backward-traveling stop-and-go wave — the famous
"phantom jam" experiment. Follow-on theory: "jamitons" (Flynn et al., MIT). Traffic flow
theory (Lighthill–Whitham–Richards) has modeled traffic as waves since the 1950s.

**One calm driver can erase waves (beliefs 5, 6 — the heart of the thesis).**
- Bill Beaty (trafficwaves.org, late 1990s): an amateur who noticed that by leaving a large
  gap and never braking he could dissolve stop-and-go waves behind him. Closest spiritual
  ancestor to this project — an individual claiming, and demonstrating, that one driver's
  smoothness propagates.
- Stern et al., *Transportation Research Part C* 2018: a single controlled autonomous vehicle
  among ~20 human drivers on a ring road dampened the waves and cut total fuel consumption
  dramatically (~40% in-experiment).
- CIRCLES project, I-24 Nashville 2022: 100 AVs in live freeway traffic, measurable smoothing.
- "Jam-absorption driving" is now a named research literature.

**Signal timing/coordination is enormous untapped capacity (belief 7).**
Green waves, coordinated corridors, and adaptive systems (SCOOT/SCATS) are standard traffic
engineering precisely because startup lost time and bad offsets waste a large share of every
green. Each queued car adds ~2 seconds of startup headway (the "unzipping" this repo's sim
makes visible). Retiming an arterial is among the highest-ROI interventions in the field.

**People think they're above-average drivers (the ego section).**
Svenson 1981: 93% of US drivers rated themselves above the median. One of the most cited
findings in the illusory-superiority literature.

**Packing around trucks / moving bottlenecks (traffic source 3).**
"Moving bottleneck" theory (Newell and successors) formalizes how a slow large vehicle caps
the flow of everything behind it. Left-lane truck restrictions exist in many states
(including on specific Texas corridors) for this reason.

## Partially supported

**Merging behavior causes congestion (traffic source 1).**
Supported: merge turbulence at on-ramps and lane drops is a primary breakdown trigger in the
literature, and several state DOTs run "zipper merge" campaigns because drivers' sense of
politeness/queue-morality measurably reduces throughput. Caveat: the *specific* protocol in
thesis.md (accelerate-into-gap, diagonal awareness two lanes over) is plausible but not
directly studied; it's a good candidate for a dedicated demo.

**Mirrors can eliminate blind spots (belief 2).**
The BGE (Blindzone and Glare Elimination) mirror setting — Platzer, SAE paper 950601 (1995),
popularized by Car and Driver and Click & Clack — matches the thesis almost exactly,
including the continuous hand-off from center mirror to side mirror to peripheral vision.
Caveat: not "no research," but also not what driving schools teach, and studies show most
drivers set mirrors exactly the narrow way the thesis criticizes.

**One-way couplets outperform two-way arterials for flow (belief 7c).**
Traffic engineering broadly agrees one-way pairs move more vehicles with better signal
progression (Austin's 5th/6th exist for this reason). Caveat: modern urbanism often converts
one-ways *back* for walkability, retail health, and speed control — the flow argument is
right, but cities weigh other goods against it.

## Contested — handle with care

**"Turn signals only for turns, not lane changes" (belief 3).**
The law in most US states requires signaling lane changes, and safety research (e.g., SAE
2012 study on turn-signal neglect) associates signal non-use with crashes. The *defensible
core* of the belief: a signal is information, not a property claim; a lane change should be
executed on gap and speed-match, not on entitlement; braking to "let someone in" creates a
wave. Recommended framing: keep the mechanics (gap, acceleration, two-lane awareness),
drop or soften the "don't signal" prescription — or reframe it as "signal ≠ permission."
The demo can compare *entitled-signal merging* vs *gap-based merging* without telling anyone
to break the law.

**"If a person hits their brakes, they made a mistake" (belief 5, strong form).**
As rhetoric it's memorable; as a literal rule it fails obvious cases (children, debris,
emergencies — and mandatory stops). The defensible form, well supported by the wave
literature above: *unplanned* braking in flowing traffic is almost always the result of a
spacing/anticipation failure seconds earlier. The San Diego no-brakes commute is a perfect
personal proof of the weak form. Suggest always presenting the claim with the qualifier.

**"All people are terrible drivers."**
Unfalsifiable as stated, and it's the sentence most likely to trigger the exact ego defenses
the thesis itself predicts. The outreach plan (see outreach.md) deliberately never says this
to the audience; the sim lets people *discover* the headroom themselves.
