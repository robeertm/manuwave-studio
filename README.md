# Manuwave Studio

**Make complete songs — music, lyrics and cover art — with AI that runs entirely on your own computer.**
No subscription, no cloud, no upload. Describe an idea (or roll the dice), and Manuwave Studio writes a
production brief, renders the track with ACE-Step 1.5, paints a cover, and lets you master and export it.

[![License: Source-Available](https://img.shields.io/badge/license-source--available-informational)](LICENSE)
![macOS](https://img.shields.io/badge/macOS-Apple%20silicon-black)
![Windows · Linux](https://img.shields.io/badge/Windows%20·%20Linux-NVIDIA%20(experimental)-76b900)

Listen to music made with it on **[Fahrstuhlmusik](https://fahrstuhlmusik.maro-datacenter.de)** — the project's
hobby showcase, where you can also share your own tracks.

![Studio](docs/screenshots/studio.png)

> The interface is in **German** for now; an English translation is planned. This README and the installers are in English.

## What it does

| | |
|---|---|
| 🎼 **Idea → song** | One sentence is enough. A local language model turns it into a brief: sound tags, tempo, key, structure and original lyrics. |
| 🎲 **Dice** | Picks from 114 styles in 11 groups — from melodic techno to bossa nova, metal, film score — and writes a detailed idea, then renders right away. |
| 🎶 **Music AI** | [ACE-Step 1.5](https://huggingface.co/ACE-Step/Ace-Step1.5) via [acestep.cpp](https://github.com/ServeurpersoCom/acestep.cpp) renders instruments, vocals and mix in one pass. |
| 🎨 **Cover art** | FLUX.2 [klein] 4B (macOS) or Z-Image Turbo (Windows/Linux) paints a cover that fits the mood. |
| 🎚 **Mastering** | Bass, tone, treble, softness, fades, auto-loudness to −14 LUFS — what you hear is what you export. |
| ⬇️ **Export** | MP3, FLAC, ALAC, WAV, AIFF, WavPack, TTA — with cover, tags and lyrics embedded. |
| 📦 **Release package** | One ZIP with the mastered file, a 3000 × 3000 cover, upload metadata with AI-disclosure checkboxes, lyrics, a proof-of-origin PDF and a licence template. |
| 🔏 **Honest by design** | Every file is labelled “AI-generated” in its tags; an inaudible watermark (macOS/Linux) proves where it came from. |

![Mastering](docs/screenshots/mastering.png)

## Requirements

| | macOS | Windows / Linux |
|---|---|---|
| Hardware | Apple silicon (M1–M4), 16 GB RAM recommended (8 GB works with smaller models) | NVIDIA GPU, RTX 20xx or newer, 8 GB VRAM; driver ≥ 550 |
| System | macOS 14 or newer | Windows 10/11 · Ubuntu/Debian x86_64 |
| Disk | about 25 GB | about 25 GB |
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
| `--no-start` | don't start the app at the end |
| `--home DIR` | install somewhere else (must be inside your home folder) |

Windows: `-Lm`, `-Xl`, `-SkipWriter`, `-SkipImage`, `-NoStart`.
</details>

## How it works

```
Browser (UI, library)  ⇄  app server (127.0.0.1:8104)  ⇄  bridge  ─┬─ ace-server  (ACE-Step 1.5, GPU)
                                                                  ├─ Ollama      (Qwen 2.5 — brief & lyrics)
                                                                  ├─ cover model (FLUX.2 klein / Z-Image Turbo)
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
- This is not legal advice.

## Uninstall

Quit the launcher, then delete `~/ManuwaveStudio` (and on macOS, optionally, the Homebrew packages listed in
`install/macos/install.sh`). Nothing else is installed.

## Licence

**Source-available, not open source** — see [LICENSE](LICENSE). You may run it for yourself; you may not
redistribute or modify it without permission. Music you make is yours.
