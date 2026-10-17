# Changelog

All notable changes to Manuwave Studio. Versions follow the app (`server.py`); the bridge that runs on your
computer has its own number, given in brackets. Dates are ISO (YYYY-MM-DD).

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
