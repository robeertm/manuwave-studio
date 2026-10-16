# Changelog

All notable changes to Manuwave Studio. Versions follow the app (`server.py`); the bridge that runs on your
computer has its own number, given in brackets. Dates are ISO (YYYY-MM-DD).

## 3.13.0 — 2026-10-16 (bridge 3.13.0)

### Fixed
- **A server restart no longer kills a running render.** The job queue lives in memory, so after a restart (an update,
  for example) the server didn't know the job and told the bridge to cancel it — minutes of rendering were lost. Now
  the server answers “unknown”, the bridge registers the job again under the same ID (`/api/bridge/adopt/<id>`) and
  keeps rendering; the browser receives the result as usual.

### Added
- **Interrupted jobs restart.** The browser waits up to three minutes when the server doesn't know a job (it is being
  re-registered). A render that fails without you cancelling it restarts once automatically — same settings, same
  seed, so the same track. After that, **↻** next to the job restarts it whenever you like.
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
