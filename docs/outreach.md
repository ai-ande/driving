# Getting the ideas out

## The strategic problem (from the thesis itself)

The thesis predicts its own distribution failure: driving is fused to ego, so any message
shaped like "you drive wrong" activates the exact defense mechanisms it describes. That
prediction is the marketing strategy:

**Never grade the person. Grade the flow. Blame physics. Let them discover.**

- The sim never says "you"; it says "drivers today" — everyone's favorite villain is *other
  drivers*, so the audience walks in agreeing.
- The visitor moves the sliders themselves. Self-discovered conclusions bypass the defenses
  that lectures trigger.
- Frame as a **game that can be won** ("can you beat rush hour without adding a lane?"),
  not a scolding. Hope beats blame: the surprising message is "traffic is optional," which
  is *good news*, not an accusation.
- Keep one honest disclaimer visible (it's a simplified model) — credibility is the asset.

## Proven precedents to model

- **Bill Beaty — trafficwaves.org** (1998): one amateur, one webpage, decades of citations.
  The "single calm driver erases waves" idea already went viral once, pre-YouTube. Reach out;
  he's the movement's folk hero and validation.
- **CGP Grey — "The Simple Solution to Traffic"** (~30M views): the audience for this exact
  topic is enormous. This project is "the playable version of that video."
- **Nicky Case & Vi Hart — "Parable of the Polygons"**: the gold standard for
  slider-essay persuasion on a charged topic (segregation!) without triggering defenses.
  Explorable explanations are the genre this belongs to.
- **Practical Engineering (Grady Hillhouse, Texas)**: traffic videos with millions of views;
  plausible collaborator — he loves interactive companions.

## Format ladder (cheap → ambitious)

1. **Shareable challenge links** — the sim already encodes settings in the URL hash. "Here's
   Lamar at 1.5× demand. Fix it without touching the lights." Every share is a puzzle.
2. **30-second vertical clips** — screen-record the A/B flip: same road, counter goes
   1,300 → 1,880, backlog vanishes. Caption: "We didn't add a lane. We changed the drivers."
   TikTok/Reels/Shorts + the time-space diagram for the engineering crowd.
3. **The explorable essay** — thesis.md rewritten as a scrolly page with the sim embedded at
   each claim. One belief per section, one interactive proof per belief (demos v0.2–v0.6 as
   they land).
4. **The game** — score mode, leaderboards per corridor, "import your own city" (the OSM
   pipeline generalizes).

## Channels, in order

1. **r/Austin** — "I simulated every light on Lamar from Barton Springs to 15th" is
   local-famous material; Austinites have *feelings* about Lamar. Local press (Austin
   Monitor, KUT, Towers.net) trawls r/Austin.
2. **Hacker News (Show HN)** — real OSM geometry + IDM physics + honest methodology is
   exactly HN-shaped. Expect and welcome the "well actually" crowd; evidence.md is the armor.
3. **r/dataisbeautiful / r/citiesskylines / traffic-engineering Twitter/Bluesky** — the
   time-space diagram is the hook for the technical audience.
4. **Austin Transportation & Public Works** — the city runs an annual signal-retiming
   program. A polite email: "I built a public visualization of the Lamar corridor; happy to
   add your real timing plans." Even a reply is a story ("city engineer reacts").
5. **UT Austin Center for Transportation Research** — potential validation, data, or a
   student project partnership.
6. **YouTubers** (CGP Grey, Practical Engineering, Not Just Bikes adjacent) once v0.2's ring
   road exists — it's made for video.

## Framing kit

- Taglines to test: "Traffic is a choice." / "The road isn't full. The green light is." /
  "We don't need more lanes. We need 0.3 seconds." / "Beat rush hour."
- The three-act demo script: (1) watch today's queue unzip car-by-car at 5th & Lamar,
  (2) slide reaction to 0.3s and watch the queue leave as one, (3) look up at the counter.
- Pre-empt the two instant objections: "it's just a sim" → methodology footnote + open
  source; "people will never change" → the mix slider showing 20% trained already helps
  (and AIs will be a growing share of drivers — they can be *taught this today*).

## What would change a skeptic's mind (keep us honest)

- Order-of-magnitude sanity vs published saturation flows (~1,800–1,900 veh/hr/lane at
  signals; the sim's "today" lands near it, "trained" is a claim *about the ceiling*).
- A real-world micro-test someday: one instrumented "trained" car in a queue, measured
  discharge improvement. (This is Beaty's experiment and Stern's paper, at a stoplight.)
- Inviting a traffic engineer to tear it apart publicly, then fixing what they find.
