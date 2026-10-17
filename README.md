# Manuwave Studio

**Make complete songs — music, lyrics and cover art — with AI that runs entirely on your own computer.**
No subscription, no cloud, no upload. Describe an idea (or roll the dice), and Manuwave Studio writes a
production brief, renders the track with ACE-Step 1.5, paints a cover, and lets you master and export it.
Or make the music yourself: synthesizers, a drum machine and a MIDI keyboard, right in the browser.

[![License: Source-Available](https://img.shields.io/badge/license-source--available-informational)](LICENSE)
![macOS](https://img.shields.io/badge/macOS-Apple%20silicon-black)
![Windows · Linux](https://img.shields.io/badge/Windows%20·%20Linux-NVIDIA%20(experimental)-76b900)

Listen to music made with it on **[Fahrstuhlmusik](https://fahrstuhlmusik.maro-datacenter.de)** — the project's
hobby showcase, where you can also share your own tracks.

![Studio](docs/screenshots/studio.png)

> The interface speaks **English and German** — it follows your browser language, and the button in the top bar switches it. The dice writes its ideas in the language you use.

> What changed in each version: [CHANGELOG.md](CHANGELOG.md).

## What it does

| | |
|---|---|
| 🎼 **Idea → song** | One sentence is enough. A local language model turns it into a brief: sound tags, tempo, key, structure and original lyrics. |
| 🎲 **Dice** | Picks from 114 styles in 11 groups — from melodic techno to bossa nova, metal, film score — and writes a detailed idea, then renders right away. |
| 🎶 **Music AI** | [ACE-Step 1.5](https://huggingface.co/ACE-Step/Ace-Step1.5) via [acestep.cpp](https://github.com/ServeurpersoCom/acestep.cpp) renders instruments, vocals and mix in one pass. |
| 🎨 **Cover art** | FLUX.2 [klein] 4B (macOS) or Z-Image Turbo (Windows/Linux) paints a cover that fits the mood. |
| 🔎 **Quality check** | A listening-judgement model ([Meta Audiobox Aesthetics](https://github.com/facebookresearch/audiobox-aesthetics)) rates every finished take on your computer. Weak takes are rendered again automatically (up to twice, your choice) and the best one is kept; discarded takes stay in `renders/_verworfen` so you can check the verdict. |
| ⏱ **Long tracks** | Up to 10 minutes. Beyond 4 minutes the music AI gets unstable, so the studio renders a main part and then extends it section by section, continuing from the last 30 seconds and crossfading the seam. |
| 🎚 **Mastering** | Bass, tone, treble, softness, fades, auto-loudness to −14 LUFS — what you hear is what you export. |
| ⬇️ **Export** | MP3, FLAC, ALAC, WAV, AIFF, WavPack, TTA — with cover, tags and lyrics embedded. |
| 📦 **Release package** | One ZIP with the mastered file, a 3000 × 3000 cover, upload metadata with AI-disclosure checkboxes, lyrics, a proof-of-origin PDF and a licence template (these two documents are in German for now). |
| 🎹 **Make your own** | A third tab with ten synthesizers and a drum machine — every knob included — plus a piano roll, patterns, a song arranger and a loop recorder. Play it with a USB/MIDI keyboard or the computer keyboard. *Create track* renders your piece into the library, where it is mastered, exported and published like any other track. |
| 🔏 **Honest by design** | Every file is labelled in its tags — “AI-generated”, or “self-played” for what you made in *Make your own* (then only the cover counts as AI); an inaudible watermark (macOS/Linux) proves where it came from. |

![Mastering](docs/screenshots/mastering.png)

## Make your own

![Make your own](docs/screenshots/selber.png)

| | |
|---|---|
| 🎛 **Synthesizers** | Analog poly and mono (two oscillators plus sub, ladder filter, two envelopes, two LFOs, unison, glide), acid bass with accent and slide, supersaw, wavetable (six sets: analog, pulse width, sync, wavefolder, vowels, glass), string machine, 4-operator FM with eight algorithms, electric piano, tonewheel organ with nine drawbars, percussion and rotary speaker, and a plucked string (Karplus-Strong). 40 factory sounds; save your own. Arpeggiator on every synth. |
| 🥁 **Drum machine** | 16 pads, all synthesized (no samples) — 808, 909, techno and lo-fi kits, each pad with level, pan, tune, decay, tone and snap. Step grid with accents. |
| 🎼 **Patterns & song** | Eight patterns (1–8 bars) per project, piano roll and step grid, swing, quantize, undo. Chain patterns into a song. Up to 16 tracks with volume, pan, EQ, chorus and sends to a shared reverb and tempo-synced delay. |
| 🎹 **MIDI** | Any class-compliant USB/MIDI keyboard (for example the M-Audio Keystation 61 MK3): velocity, pitch bend, mod wheel, sustain pedal, volume fader, transport buttons in DAW mode, and *MIDI learn* for every knob. Web MIDI needs Chrome or Edge; without it (Safari) the computer keyboard plays (A W S E D … = C … C, Z/X octave). |
| ⏺ **Recording** | One-bar count-in, metronome, quantize to 1/4…1/32, overdub in a loop — every take can be undone. |
| 🎵 **Create track** | Renders the arrangement faster than real time into a 24-bit/48 kHz WAV with a −1.5 dBFS limiter and puts it in the library. Projects are saved in the browser; back them up as a file. |

The sound runs in one AudioWorklet (band-limited oscillators, zero-delay-feedback filters), so timing stays tight even
when the tab is in the background, and the offline render is sample-identical to what you hear.

![Synthesizer](docs/screenshots/synth.png)

## Requirements

| | macOS | Windows / Linux |
|---|---|---|
| Hardware | Apple silicon (M1–M4), 16 GB RAM recommended (8 GB works with smaller models) | NVIDIA GPU, RTX 20xx or newer, 8 GB VRAM; driver ≥ 550 |
| System | macOS 14 or newer | Windows 10/11 · Ubuntu/Debian x86_64 |
| Disk | about 25 GB (+1 GB for the optional quality check) | about 25 GB (+1 GB for the optional quality check) |
| Status | ✅ tested | ⚠️ experimental — built and checked in CI, not yet run on real NVIDIA hardware by the maintainer |

## Install

1. Download the latest release ZIP (or `git clone` this repository) and unpack it.
2. Run the installer for your system:
   - **macOS:** double-click `install/macos/Install Manuwave Studio.command`
     (Homebrew is installed if missing — macOS asks for your password once).
   - **Windows:** double-click `install\windows\Install Manuwave Studio.bat`.
   - **Linux:** `./install/linux/install.sh`
3. The installer downloads everything from the original sources (about 15–20 GB of models), builds what needs
   building, and creates a **Manuwave Studio** launcher (Desktop on macOS/Windows, app menu on Linux).
   Interrupted? Just run it again — downloads resume and finished steps are skipped.

Everything lives in `~/ManuwaveStudio` (`%USERPROFILE%\ManuwaveStudio` on Windows). Your music is stored there
under `renders/` and in your browser's library.

<details><summary>Installer options</summary>

| Option | Effect |
|---|---|
| `--lm 0.6B \| 1.7B \| 4B` | size of the music AI's planning model (default: chosen by RAM) |
| `--xl` | the larger, better-sounding XL model (+3 GB) |
| `--skip-writer`, `--skip-image` | skip the language model or the cover model |
| `--skip-qa` | skip the quality check (PyTorch + rating model, about 1 GB; runs on the CPU) |
| `--no-start` | don't start the app at the end |
| `--home DIR` | install somewhere else (must be inside your home folder) |

Windows: `-Lm`, `-Xl`, `-SkipWriter`, `-SkipImage`, `-SkipQa`, `-NoStart`.
</details>

## How it works

```
Browser (UI, library)  ⇄  app server (127.0.0.1:8104)  ⇄  bridge  ─┬─ ace-server  (ACE-Step 1.5, GPU)
                                                                  ├─ Ollama      (Qwen 2.5 — brief & lyrics)
                                                                  ├─ cover model (FLUX.2 klein / Z-Image Turbo)
                                                                  ├─ quality check (Audiobox Aesthetics, CPU, optional)
                                                                  └─ ffmpeg · audiowmark (mastering, tags, watermark)
```

The app server only brokers jobs; the **bridge** does the work and starts each model only while it's needed.
Nothing listens on your network — everything binds to `127.0.0.1`.

![Release package](docs/screenshots/package.png)

## Using your music

- **Licences:** ACE-Step 1.5 (MIT; its model card explicitly allows commercial use of generated music),
  FLUX.2 [klein] 4B and Z-Image Turbo (Apache-2.0). See [THIRD_PARTY.md](THIRD_PARTY.md).
- **Copyright:** in many countries purely AI-generated content is not protected by copyright. Your own
  contributions — lyrics you write, your selection and mastering — can be. The release package records them.
- **Distribution:** services such as DistroKid accept AI-assisted music if you disclose it; the release package
  contains ready-to-tick AI credits. Some platforms (e.g. Bandcamp) don't accept AI-generated music.
- **Self-played tracks** (*Make your own*) are your own work: the tags, the release package and Fahrstuhlmusik say
  “self-played”, and only the cover is declared as AI.
- This is not legal advice.

## Uninstall

Quit the launcher, then delete `~/ManuwaveStudio` (and on macOS, optionally, the Homebrew packages listed in
`install/macos/install.sh`). Nothing else is installed.

## Licence

**Source-available, not open source** — see [LICENSE](LICENSE). You may run it for yourself; you may not
redistribute or modify it without permission. Music you make is yours.
