# Changelog

All notable changes to Manuwave Studio. Versions follow the app (`server.py`); the bridge that runs on your
computer has its own number, given in brackets. Dates are ISO (YYYY-MM-DD).

## 3.22.1 — 2026-10-21 (bridge 3.17.0)

### Changed
- Hints, tooltips, comments and documentation no longer refer to other music software; the AIFF export hint now reads
  “uncompressed, with cover”.

## 3.22.0 — 2026-10-21 (bridge 3.17.0)

### Changed
- **No more long drop-down lists for instruments.** A button opens an overview instead: groups as headings, entries
  as tiles in columns (not one long column), a short description under each instrument, and a **search field** from
  ten entries on (it also searches the descriptions; accents don't matter). Typing jumps into the search, the arrow
  keys move by position on screen, Enter picks, Esc or a click outside closes. On a phone it opens as a sheet from
  the bottom.
  - *Make your own*: instrument and new track (33 instruments in five groups), sound preset, kit (classic drum
    machines / by style), pad sound (kicks, snares & claps, hi-hats & cymbals, toms, percussion, effects), projects
    and library songs.
  - Loop machine: beat kit and sets.
  - Instrument settings: piano & mallet type (pianos / mallets / bells & metal) and orchestra instrument (strings /
    brass / woodwinds).
  - Mastering: the track list, grouped by folder once more than one folder is in use.
- Short lists stay drop-downs but are now structured: echo time (straight / dotted / triplets / free) and tempo sync
  (bars / notes / triplets).
- While the overview is open, keys belong to it: Space no longer starts playback and letters don't play notes.

### Fixed
- Reloading while the computer was busy could leave the app half-loaded: the built-in web server kept only five
  waiting connections and reset the rest, so a script file went missing. It now queues up to 256.

## 3.21.0 — 2026-10-20 (bridge 3.17.0)

### Added
- **Many new instruments**, computed like the synths (no samples), in the loop machine and in *Make your own* — 232
  sounds instead of 110:
  - **Piano & grand** — concert grand, felt soft pianos (long reverb, echo, shimmer, endless), upright, honky-tonk,
    bright and dark grands, celesta, toy piano. Hammer hardness, felt, strike point, hammer and key noise, string
    stiffness, unison width, octave stretch, sustain and damper.
  - **Mallets & bells** — marimba, xylophone, vibraphone with motor, glockenspiel, music box, kalimba, tubular and
    church bells, steel drum, singing bowl, glass, gong.
  - **Choir & voices** — mixed, boys', male and female choirs, humming, chant, solo voices, pop vocal stack, whisper,
    overtone singing, robot voice; vowel a/e/i/o/u/hum (also moving), up to eight singers per note, vibrato with delay.
  - **Orchestra** — string sections, solo violin and cello, pizzicato, tremolo, horn, trumpet, trombone, tuba, brass
    section, flute, pan flute, clarinet, oboe, bassoon, saxophone, woodwind section.
  - **Wild & effects** — risers, downlifter, impact, laser, zap, wind, storm, rain, ocean, thunderstorm, crackling
    fire, alien chatter, robot speech, sonar, glitch, metal and dark drones, heartbeat, radio static, spaceship, space
    texture, time machine, underwater, insect swarm, shattering glass.
  - Plus guitars, harps, harpsichord, banjo, ukulele, hammered dulcimer, church organ and new pads and textures.
- **Every instrument has its own space:** reverb up to 30 s (size, pre-delay, highs, shimmer an octave up, freeze),
  echo in time or free in ms (feedback, tone) and *Body & width* (warmth, body, air, width — also for mono sounds).
  The tail keeps ringing after the last note.
- **Sound browser** instead of one long list: 17 categories, search (names, categories and tags), tag chips,
  ★ favourites, recent sounds and ▶︎ listen. A click selects right away — you hear it in the running loop —, the arrow
  keys browse and select, Enter or a double-click closes it. In *Make your own* it also lists *My sounds*.
- *Surprise me* now also reaches for the new instruments, depending on the style.

### Changed
- **Fuller sound.** Measured: the shared reverb's impulse response carried +24 dB of energy, so a 15 % send made the
  reverb 5.5 dB louder than the instrument itself, and the stereo side was as loud as the middle, even in the bass —
  thin and hollow. The impulse response is now normalised, the reverb return starts at 180 Hz, the bass below 120 Hz is
  kept mono, and a new **Body** control on the master adds gentle saturation, warmth around 180 Hz and a soft
  compressor (default 50 %). Measured on the demo and on rolled sets: side 17 dB below the middle (before 2.5 dB),
  bass 35–68 dB below, louder and denser without clipping. Also in *Make your own* and in generated tracks.

## 3.20.0 — 2026-10-20 (bridge 3.17.0)

### Added
- **✋ Record into any generator.** Beat, bass, chords, arpeggio, melody and the oscillator can now play what you
  played instead of making up their own pattern. Press ● on the card, ● on the keyboard bar or **R**, then play on the
  on-screen keys, the computer keyboard or a MIDI keyboard. With nothing playing there is a one-bar count-in (with a
  click while nothing else keeps time); otherwise recording starts at the generator's next loop start. Each pass is
  snapped to the grid (1/4 to 1/32, triplets, or free) and loops from the next pass on; keep playing to add more
  (overdub — the same note on the same step replaces instead of doubling), press ● again to finish. Timing counts as you
  heard it: the audio output latency is subtracted.
- On every such card: **Plays: 🤖 machine / ✋ what you played**, ↶ take back the last pass, 🗑 clear, 📌 keep the
  machine's current pattern as yours (then play on top of it). Changing the loop length repeats or trims what you played;
  changing the key transposes it; the octave knob works. Knobs that only shape the machine's pattern are dimmed.
- **Drums on a piano keyboard:** low notes follow General MIDI (pad controllers work as expected), above that every
  octave has the same layout — C kick, C♯ rim, D snare, D♯ clap, F♯ closed hat, A♯ open hat, toms on F/G/A … The keys
  are labelled while a beat is selected.
- **The oscillator is playable** (monophonic, last note wins): in drone mode a held key sets the pitch, in *what you
  played* mode it only sounds where notes are.
- **Master tone:** lows (110 Hz shelf), mids (1 kHz bell) and highs (7 kHz shelf), ±12 dB each — in the loop machine
  (recordings included) and in *Make your own* (the generated track included).

### Changed
- **+ New starts an empty set.** A generator added to an empty set — or to a set where everything is played in — waits
  for your playing instead of making up a pattern.
- **🎲 Surprise me builds around what you played:** recorded parts stay, your tempo stays, and the key and chord
  progression are read from your notes (new progression entry *✋ from your playing*).
- **🎲 starts the whole new set together, right away.** Before, only the first generator came in at once; the others
  — locked ones included — waited for the next bar, almost 3 s at slow tempos.

### Fixed
- **The layout no longer jumps while playing.** The autopilot's message changed its size with every text, which made
  the transport bar wrap (measured at 1512 px in Safari: the bar grew by 36 px and pushed everything below down). The
  message now has a fixed two-line box, the bar counter a fixed width, toggles no longer turn bold (3 px wider) when
  switched on, and the status line keeps its height.

## 3.19.0 — 2026-10-20 (bridge 3.17.0)

### Added
- **New generators fit in.** A generator added to a set takes the set's style for its sound and pattern, the loop
  length most of the others use, sits an octave away from one of the same kind, and couples its groove where the style
  does that (in hip-hop, trap, drum & bass, lo-fi, breakbeat and reggaeton the bass plays on the kick; stabs go between
  the bass notes; a second melody answers the first). If the machine is running, it comes in on the next bar and is
  mixed in. A message says what it adapted.
- **🔗 Groove** on bass, chords, arpeggio and melody: play on the kick, between the
  kicks, with or between the bass, with the chords, or answering the melody. The notes stay the generator's own; only the
  rhythm comes from the other one.

### Changed
- **Knobs with a trackpad or mouse wheel** (loop machine and *Make your own*): the knob now follows the distance you
  scroll — the whole range takes about 1500 px, a wheel notch is 2.5 % as before. Before, every scroll event moved 3 %, so
  a small trackpad swipe sent the knob to its end. A scroll that starts on the page keeps scrolling the page instead of
  turning the knobs the pointer passes over.
- **Removing a generator** no longer asks; the others keep playing, and *↶ bring back* in the message restores it.
- Pattern generators come in **on the phrase**: a 4-bar loop started in bar 6 lines up with bar 5 like the others.

### Fixed
- **■ Stop really stops.** With the autopilot on, the transport kept running after all generators stopped and the
  autopilot brought one back at the next phrase. Now the transport stops with the last generator, and stopping cancels
  the autopilot's planned re-entries.
- **Safari stopped the sound after any confirmation dialog** (the audio context was suspended and never resumed). The
  loop machine and *Make your own* now resume it right away (or on the next click when the browser requires a gesture),
  also after the screen was locked.

## 3.18.0 — 2026-10-20 (bridge 3.17.0)

New ways to shape and move sound in the loop machine, built with Manuwave's own sound engine — plus a MIDI output, so the
loop machine can also play other instruments (music software or any hardware synth).

### Added
- **🔮 Orb** on every generator: drag the dot and it moves three to six knobs at once — the direction picks which, the
  distance from the centre how much. *Motion* lets it circle by itself in time with the music, *Chaos* makes that
  restless, it keeps rolling after you let go, and *● Gesture* records a movement that then loops in time. The orb only
  picks knobs that have an effect right now and lies on top of your settings; the knobs turn visibly with it.
- **🎛 Global** on every sound generator: *Tone, Ambience, Filter, Envelope, Vibrato, Unison* — they know which controls
  of the current instrument to turn (cutoff on the analog synth, modulator levels on FM, drawbars on the organ …), so they
  work with every sound. Where an instrument has nothing to turn (the organ has no envelope), the knob is dimmed and says
  why.
- **🧬 Mutate**: a related variation of the current sound, from *subtle* to *extreme*. Pitch and play mode stay; every
  variation stays audible (tested over all factory sounds). Every mutation is kept — ⟲ brings back the original, a number
  any earlier one. Works for the drum kit (tuning, length, tone, snap) and the oscillator too.
- **New sound controls**: a group *Motion* on every generator with a **frequency shifter** (±1000 Hz, as turned,
  reversed, or opposed left/right), **vibrato** and **ensemble**; **zones** on the oscillator (four waves A–D, one knob
  or the LFO crossfades through them); **granular** on the mic loop (grain size, grains per second, spray, pitch,
  freeze); **ratchets, life and human feel** on the arpeggio; **strum** on the chords; **analog drift** on the analog
  synth (also in *Make your own*).
- **🔌 MIDI out** per generator: output, channel (the beat goes out as General MIDI drums on channel 10), optionally the
  own sound too, an offset, a test note. Notes are scheduled ahead with timestamps, so they land in time; pitch bend
  and mod wheel go along. **⏱ MIDI clock** sends tempo and start/stop. On a Mac, switch on the IAC driver in *Audio MIDI
  Setup* and your music software plays along. Needs Chrome or Edge (Safari has no Web MIDI).
- **🔒 Lock** a generator: *Surprise me* and the autopilot leave it as it is.
- **⏪ Flow capture**: the loop machine always listens. *Save what just played* puts the last 4, 8 or 16 complete bars
  into the library, exactly on the bar; *⬇ MIDI* downloads the notes of the same bars as a MIDI file (one track per
  generator).
- *Surprise me* uses the new ideas too: strummed chords for some styles, an arpeggio with life (and ratchets in techno,
  trap and drum & bass), analog drift, and a slowly circling orb.

## 3.17.2 — 2026-10-19 (bridge 3.17.0)

### Fixed
- **Loop machine lost all its lows.** Rolling *Surprise me* (or taking over, stopping, switching sets) in the middle of an
  autopilot build-up left the master high-pass at 1400 Hz — measured −45 dB below 150 Hz instead of −2 dB, and *Mix* could
  not help because it measures before that filter. Breakdowns and build-ups are now tracked effects that always end; a
  guard opens a stuck autopilot filter on the next bar. Switching the autopilot off during a breakdown now brings beat and
  bass back.
- **Plucked strings stopped after 21 ms** (in *Make your own* too): the check whether a string still rings looked at the
  empty part of its delay line. *Decay* and *Mute on release* now work.
- **Stepped knobs** (octave, semitone, voices, unison …) did not move with the mouse wheel or arrow keys — one step was
  smaller than half a notch and rounded back. Now at least one notch.
- **Pitch bend, mod wheel and sustain pedal** from a MIDI keyboard now reach the selected generator in the loop machine.

### Changed
- **Knobs turn with the automation**: pointer and arc follow the sounding value while wobble, the autopilot, an LFO, key
  snap or the gate move it; your own setting stays as a small dot on the ring. The auto mix turns the volume knob over
  visibly.
- **Knobs that have no effect right now are dimmed** and say why — oscillator 2 or 3 at level 0, pulse width without the
  pulse wave, detune with one unison voice, LFO settings without a destination or amount, glide in poly mode, arpeggiator
  settings with the arpeggiator off, and more (both in the loop machine and in *Make your own*). Turning one switches the
  missing part on where that is unambiguous, e.g. oscillator 2 gets a level.

## 3.17.1 — 2026-10-19 (bridge 3.17.0)

### Added
- **Loop machine: knobs show what is sounding.** A glowing dot and a thin arc from the set value mark the live value, and
  the number shows it: the wobble on *Frequency*, the autopilot's breakdown low-pass and build-up high-pass on *DJ
  filter*, and for the oscillator the sounding frequency (key snap, glide, drift, LFO), pulse width, FM amount, level (gate,
  LFO) and pan. The engine reports the oscillator values about 30 times a second.
- **Oscilloscopes** at every group of knobs — generator, filter, tone, space, channel (left/right after the fader),
  instrument sound, master, microphone, and an LFO trace for the oscillator. Only visible ones are drawn.
- **Auto mix**: two bars of listening (ear-weighted loudness before the fader), then each generator's volume goes to a
  target for its role and style. Runs by itself for *Surprise me*, *Take over the rest* and when the autopilot brings a
  generator in (hand-set volumes stay); the *Mix* button sets all of them.

### Changed
- The on-screen keyboard always sits at the bottom of the screen, full width, with two to five octaves depending on the
  width, and can be folded away. On screens 1800 px and wider the loop machine no longer borrows the three-column layout
  of *Make your own*, which had put the keyboard into a side column and left the cards two abreast.

## 3.17.0 — 2026-10-19 (bridge 3.17.0)

### Added
- **Loop machine** — a fourth tab. Generators run on their own: start one and it comes in on the next bar, stop it and
  it ends with the bar. Beat (eleven styles, density, variation, human feel, fills), bass (seven patterns incl. acid),
  chords (voiced close, with 7ths/9ths), arpeggio, melody (a motif that returns and develops), a free **oscillator**
  (waves, noise, 20 Hz–8 kHz with snap to key, unison, sub, FM, drift, glide, LFO, gate in time), **your bars** (play a
  few bars; the machine plays and spins them on) and a **mic loop** (sing in time after a count-in, latency
  compensated, overdub up to eight layers). Key, scale and chord progression drive all of them; a change applies from
  the next bar. Every generator has live filter, resonance, high-pass, wobble, EQ, drive, echo, reverb, pan and level,
  plus all knobs of its instrument. MIDI learn for any knob; the computer keyboard and a MIDI keyboard play the selected
  generator.
- **Take over the rest**: the key is found from your bars or your voice (the first note and strong beats weigh more; a
  relative key that already matches is kept), then beat, bass and chords join in the chosen style, and the **autopilot**
  arranges at every eight-bar phrase — swaps, breakdowns with a closing filter, build-ups to the drop, new patterns.
  *To notes* turns a sung loop into notes for a synth. *Surprise me* starts a random style.
- **AI takes over** (bridge job `weiter`): *continue the jam* captures the next 4/8/16 bars exactly from the downbeat and
  the music AI continues it to the chosen length (repaint after the end; the continuation is brought to the jam's
  loudness — measured 7 dB quieter before). *Band for your voice* repeats your mic loop to song length and runs
  ACE-Step's *complete* task with the **base** model (measured against the fine-tuned model: drums −15 vs −22 dB, bass
  −30 vs −54 dB — without the base model the bass is nearly missing); Demucs then takes out the AI's re-sung voice and
  your own voice goes back on top. The result arrives like any render and is labelled AI-generated, with a note on which
  part is yours.
- ● in the loop machine records what you hear into the library (self-played).
- Installers: optional step **Loop machine AI** (base model, 2.6 GB or 5.3 GB with `--xl`); `--skip-loopai` /
  `-SkipLoopAi`.

### Changed
- On narrow screens the four tabs wrap into two rows.
- A MIDI keyboard plays only the tab you are in (it used to sound in *Make your own* from anywhere).

## 3.16.1 — 2026-10-17 (bridge 3.16.1)

### Fixed
- The MIDI image keeps its models in its own folder (`midi/hf`, `midi/torch`) — Demucs 4.1 otherwise downloaded into
  the general Hugging Face cache outside the install folder, so uninstalling left it behind.
- Stopping the bridge while a MIDI image is being made now ends that process too (it kept running as an orphan), and
  half-written results of a hard stop are removed at the next start.
- **Knobs stuck to the mouse.** 3.16.0 lost the release handler when the knobs were rebuilt: after a click the value
  kept following the pointer. Knobs now react to the click only — the value jumps to the clicked spot on the arc and
  stays there. Fine moves: Shift + vertical drag, or the mouse wheel. The default is now Alt-click (a double-click reset
  the knob whenever you clicked twice quickly).
- In WebKit (Safari) a long instrument name still pushed mute/solo out of the track row; the row's grid column can now
  shrink.
- *Song from the library* is filled as soon as the tab opens (not only after loading a project).

## 3.16.0 — 2026-10-17 (bridge 3.16.0)

### Added
- **MIDI image of every AI song.** The bridge turns each AI track into notes in the background, only while the
  computer is otherwise idle (any new job stops it at once; it resumes later): Demucs separates drums, bass, vocals
  and the rest, Basic Pitch (ONNX) finds the notes, pYIN follows the bass line and per-band onsets give kick, snare and
  hi-hats. The tempo is **measured** around the requested one — the music AI rarely hits it exactly (137.94 instead of
  136 BPM in one song, three beats off after 3:45) — and every note is placed along the tracked beats. Result next to
  the WAV: `<name>.midi.json` and a type-1 MIDI file. Checked against a song with a known answer: tempo within 0.01 %,
  kicks 95 % found / 88 % right, bass 83 % (pitch class).
  - Library: 🎼 marks songs with a MIDI image; **🎹 Play** opens it on the instruments, **⬇︎ MIDI** downloads the file.
  - *Make your own*: **Song from the library** lists every song with a MIDI image. A song becomes a project with drums
    (kit chosen by genre), Minimoog bass, Prophet chords and Minimoog melody, in parts of 16 bars, played as a song.
  - Installer step **MIDI image** (optional, about 1.5 GB, `--skip-midi` / `-SkipMidi`).
  - **Honest labels stay honest:** a track rendered from a MIDI image is *not* labelled self-played — the composition
    came from the music AI. It keeps the AI label, its note names the source song, and *Create track* says so before
    you render.
- **18 classic instruments** in *Make your own*, each with its own factory sounds (110 in all): TB-303, Minimoog,
  Juno-60, Jupiter-8, Prophet-5, OB-Xa, SH-101, MS-20, ARP Odyssey, CS-80, Taurus, PPG Wave, DX7, M1 house organ,
  Rhodes, Wurlitzer, B3, Clavinet — our own recreations; the names refer to the instruments that inspired them.
  The instrument menu is grouped (basic models, classics, drums). Juno and other presets bring their chorus.
- **Drum kits** TR-606, CR-78, 80s (TR-707/LinnDrum style) and trap, next to TR-808, TR-909, techno and lo-fi.
- **Oscillator 3** and a **high-pass before the filter** on the analog engine.
- **Full width:** the tab uses the whole monitor; from 1800 px tracks, editor and song sit side by side. The on-screen
  keyboard shows three, four or five octaves (C2–C7, like a 61-key controller) depending on the width.
- **Knobs:** click anywhere on the arc and the value jumps there; drag along the circle (Shift = fine, vertical);
  knobs grow under the mouse.
- Pattern length up to 16 bars; tempo with two decimals.

### Fixed
- The **Level** knob had no effect on the analog, FM, electric piano and plucked-string engines (only organ and drums
  used it). It now works everywhere; the default (80 %) sounds exactly as before.
- A triangle wave under deep FM (phase running backwards) drifted into a large DC offset (peak +7 dBFS).
- In the track list a long instrument name pushed the mute/solo buttons out of the row.
- Four factory sounds peaked above 0 dBFS on a chord; every factory sound now stays below −0.5 dBFS.

## 3.15.0 — 2026-10-17 (bridge 3.15.0)

### Added
- **Make your own** — a third tab for making music by hand, in the browser:
  - **Ten synthesizers with every knob:** analog poly and mono (two oscillators, sub, noise, hard sync, FM, unison up
    to seven voices with detune and stereo width, drive, 24 dB ladder or 12 dB state-variable filter in low-pass,
    high-pass, band-pass and notch, filter and amp envelopes, two LFOs with tempo sync and sample & hold, glide,
    poly/mono/legato), acid bass (accent, slide), supersaw, wavetable (six band-limited sets), string machine,
    4-operator FM (eight algorithms, feedback, per-operator envelopes and velocity), electric piano (tine, bell, bark,
    tremolo), tonewheel organ (nine drawbars, percussion, key click, vibrato/chorus, rotary speaker with inertia) and a
    plucked string (Karplus-Strong with body resonance). An arpeggiator (up, down, up & down, as played, random;
    1/4–1/32 and triplets; 1–4 octaves; latch) on every synth. 40 factory sounds; your own sounds can be saved.
  - **Drum machine:** 16 synthesized pads (808/909-style kicks, snares, clap, hats with choke, toms, rim, cowbell,
    cymbals, shaker, tambourine, conga, clave, zap, lo-fi noise), four kits, per-pad level, pan, tune, decay, tone, snap.
  - **Sequencer:** up to 16 tracks, eight patterns of 1–8 bars, piano roll and step grid, swing, quantize, transpose,
    undo/redo, song arranger. Mixer with volume, pan, mute/solo, three-band EQ, chorus, shared reverb and tempo-synced
    ping-pong delay, limiter at −1.5 dBFS.
  - **Playing and recording:** Web MIDI (velocity, pitch bend, mod wheel, sustain, CC 7 volume, transport buttons from
    a keyboard's DAW port, MIDI learn for every knob), the computer keyboard as a fallback (A W S E D … = one octave,
    Z/X octave, C/V velocity), an on-screen keyboard, loop recording with count-in, metronome and quantize.
  - **Create track:** renders the song or a looped pattern offline into a 24-bit/48 kHz WAV and adds it to the
    library — then mastering, export, release package and publishing work as for every track.
  - Projects are stored in the browser (own IndexedDB, autosave) and can be backed up and restored as a file. A demo
    project opens the first time.
  - The engine is one AudioWorklet: sequencer, instruments and drums run on the audio thread, so timing holds when the
    tab is in the background, and the offline render matches what you hear sample for sample.

### Changed
- **Honest labels for self-played music.** Tracks from *Make your own* carry the origin `eigen` to the bridge: they are
  stored as `selbst_…` in the archive, the tags say "music self-played in Manuwave Studio" (only an AI cover is
  mentioned), the release package ticks nothing as AI music, the proof of origin and the licence template describe
  the track as the author's own work, and Fahrstuhlmusik labels it "self-played".
- The library marks these tracks “🎹 self-played” and offers *Open project* instead of *Continue working*.

## 3.14.0 — 2026-10-17 (bridge 3.14.0)

### Added
- **Quality check.** A listening-judgement model ([Meta Audiobox Aesthetics](https://github.com/facebookresearch/audiobox-aesthetics),
  CC-BY 4.0) rates every finished take on your computer's CPU (content enjoyment, usefulness, complexity, production
  quality, 1–10). A take below 7.2 is rendered again with a new plan — up to twice, set under *Details › Quality
  check* (2× / 1× / off) — and the best one is kept. Discarded takes stay in `renders/_verworfen` with their ratings.
  The library shows “🔎 Sound 7.6 · best of 2”. The threshold can be changed with `qa_min_ce` in `bridge.json`.
  Why this model: on the maintainer's archive all kept tracks scored 7.4–7.8 and the one he called unbearable 6.9,
  while simple signal measures (clicks, tempo, key) could not tell them apart.
- **Long tracks up to 10 minutes.** Beyond 4 minutes the music AI gets unstable (official guidance: 2–4 min), so the
  bridge renders a 220-second main part and then extends it in sections of up to 80 seconds: each extension continues
  from the last 30 seconds (repaint beyond the source end), rebuilds the last 4 of them itself and is crossfaded over
  one second. With the quality check, each section gets up to two attempts and the better one stays. Lyrics sections
  are distributed over the parts by position; the structure for long songs gets more sections.
- Installers: optional step *Quality check* (about 1 GB: Python via uv, CPU-only PyTorch, the rating model) — skip
  with `--skip-qa` / `-SkipQa`.

### Changed
- **Briefs with fewer, consistent tags:** 1–2 genres that fit together, 3–6 instruments, no tempo or key inside the
  tags; instrumental sections get a short description of what happens (`[Drop - full energy, supersaw lead]`).
  The ACE-Step tutorial: conflicting styles degrade the result, and structure tags guide instrumentals.
- The language model plans a little less wildly: `lm_temperature` 0.8 (was 0.85), `lm_top_k` 60 (was off) —
  within the range the ACE-Step docs call typical. The bridge now passes `lm_top_k`, `lm_top_p` and `lm_cfg_scale`.

## 3.13.0 — 2026-10-16 (bridge 3.13.0)

### Fixed
- **A server restart no longer kills a running render.** The job queue lives in memory, so after a restart (an update,
  for example) the server didn't know the job and told the bridge to cancel it — minutes of rendering were lost. Now
  the server answers “unknown”, the bridge registers the job again under the same ID (`/api/bridge/adopt/<id>`) and
  keeps rendering; the browser receives the result as usual.

### Added
- **Interrupted jobs restart.** The browser waits up to three minutes when the server doesn't know a job (it is being
  re-registered). A render that fails without you cancelling it restarts once automatically with the same settings
  and seed (the language model plans anew, so the result is a new take, not a copy). After that, **↻** next to the job restarts it whenever you like.
- Short jobs (brief, export, publishing) also wait out a server restart instead of failing at once.

## 3.12.5 — 2026-10-16 (bridge 3.12.4)

### Fixed
- **Deleting a published track now also takes it off Fahrstuhlmusik.** Until now a deleted track went to the trash on
  your computer but kept playing on the website. If the site can't be reached at that moment, the track stays in the
  delete queue and the bridge tries again the next time it connects.

## 3.12.4 — 2026-10-16 (bridge 3.12.3)

### Fixed
- **Published tracks could go online without your mastering.** Mastering settings lived only in the browser, so
  anything published without it (from a terminal, another device) used the default mastering. The studio now sends
  your settings to the bridge whenever they change, and the bridge uses them when none are sent along.

### Added
- The library shows when published tracks sound different online than your current mastering:
  “🌐 N published tracks sound different on Fahrstuhlmusik than your mastering” with **⟳ Update online**, which
  re-publishes them one after another (same address, ratings kept).
- Bridge job `master_merken` and the archive listing now report the stored settings and the ones the online version
  was rendered with.

## 3.12.3 — 2026-10-16 (bridge 3.12.2)

### Changed
- Publishing sends the track note in English and German; the missing language is translated by the local language
  model.

## 3.12.2 — 2026-10-16 (bridge 3.12.1)

### Changed
- Publishing drops the “(Version X)” suffix from titles.

## 3.12.1 — 2026-10-15 (bridge 3.12.0; includes 3.12.0)

### Added
- **English interface.** The app follows your browser language; the button in the top bar switches between English
  and German. Titles, notes and lyrics are left as they are.
- The dice writes its ideas in the language you use; all 114 styles and their sounds are available in English. With
  the English interface the language model writes the track note in English.
- **Sing-along lyrics** for published tracks: whisper.cpp hears the vocals and the bridge aligns each lyric line to
  the music (estimated timing when too little is recognised).
- English screenshots in the README.

### Fixed
- Leftover German texts, labels with a capital first letter, English quotation marks.

## 3.11.1 — 2026-10-15 — first public release

### Added
- Public repository with installers for macOS, Windows and Linux, CI and a workflow that builds the acestep.cpp
  engine (macOS Metal, Linux/Windows CUDA and Vulkan).
- Archive paths of every visible storage folder up to three levels below your home folder.

### Engine workflow (after 3.11.1)
- Checks out the full commit SHA of acestep.cpp.
- CUDA 12.8 (driver ≥ 550), Windows on Visual Studio 2022, architectures for RTX 20 to RTX 50.
- Full LunarG Vulkan SDK on Windows; one platform can be built on demand.

## Before the public release

Development started on 2026-10-10. The main steps, briefly:

- **3.11.0** — Runs on macOS, Windows and Linux: neutral defaults, data folder via `$MWS_HOME`, ffmpeg instead of
  macOS-only tools, cover art on Windows/Linux via stable-diffusion.cpp (Z-Image Turbo).
- **3.10** — Publish to Fahrstuhlmusik: the mastered 24-bit file with cover and details; re-publishing replaces the
  online version instead of adding a second one.
- **3.9** — Release package: one ZIP with the mastered track, a 3000 × 3000 cover, upload metadata with
  AI-disclosure checkboxes, lyrics, a proof-of-origin PDF and a licence template.
- **3.8** — All 114 styles in 11 groups; the dice renders right away.
- **3.7** — Mastering rebuilt: what you set is what you hear in the library, the preview and the export; a real
  sample-peak limiter at −1.5 dB.
- **3.6** — Deleting means deleting: a track goes to the trash on your computer too, with its cover and original.
- **3.5** — Mastering as its own tab with instant saving; a quieter watermark whose strength depends on track length;
  fixes for Safari.
- **3.4** — Live mastering, no more clipping, repair of older tracks, lyrics embedded in MP3.
- **3.3** — Artist name and title lettering on the cover; a hint when Apple players can't show FLAC covers.
- **3.2** — Cover art, tags, inaudible watermark, export in many formats, rights holder settings.
- **3.1** — Library with folders and selection, the larger XL model, soft endings instead of cut-off ones.
- **3.0** — One music app with local AI only and guided sound settings.
- **2.x** — The computer's own language model writes the brief; secure address.
- **1.x** — First version: an idea becomes a brief, the music AI renders it.
