# Third-party components

The installers fetch these components from their original sources. Nothing below is redistributed in this
repository, except the engine binaries that this project's CI builds from unmodified upstream sources
(release `engine-b7ba6d9`, with the redistributable NVIDIA CUDA runtime libraries).

| Component | Used for | License | Source |
|---|---|---|---|
| ACE-Step 1.5 (models) | music generation | MIT — the model card states generated music may be used commercially | [ACE-Step/Ace-Step1.5](https://huggingface.co/ACE-Step/Ace-Step1.5), GGUF: [Serveurperso/ACE-Step-1.5-GGUF](https://huggingface.co/Serveurperso/ACE-Step-1.5-GGUF) |
| acestep.cpp | music engine (C++/ggml) | MIT | [ServeurpersoCom/acestep.cpp](https://github.com/ServeurpersoCom/acestep.cpp) |
| Meta Audiobox Aesthetics (code + checkpoint) | optional quality check — rates each take | CC-BY 4.0 (parts MIT) | [facebookresearch/audiobox-aesthetics](https://github.com/facebookresearch/audiobox-aesthetics), checkpoint: [facebook/audiobox-aesthetics](https://huggingface.co/facebook/audiobox-aesthetics) |
| PyTorch / torchaudio | runs the quality check (CPU) and Demucs | BSD-3-Clause | [pytorch/pytorch](https://github.com/pytorch/pytorch) |
| uv | creates the Python environments of the quality check and the MIDI image | MIT / Apache-2.0 | [astral-sh/uv](https://github.com/astral-sh/uv) |
| Demucs (htdemucs) | optional MIDI image — separates drums, bass, vocals and the rest | MIT | [facebookresearch/demucs](https://github.com/facebookresearch/demucs) |
| Basic Pitch | optional MIDI image — note detection (ONNX model) | Apache-2.0 | [spotify/basic-pitch](https://github.com/spotify/basic-pitch) |
| ONNX Runtime | runs Basic Pitch | MIT | [microsoft/onnxruntime](https://github.com/microsoft/onnxruntime) |
| librosa, resampy, mir_eval, pretty_midi, SciPy, soundfile | MIDI image — beat tracking, pYIN bass line, MIDI file | ISC, ISC, MIT, MIT, BSD-3-Clause, BSD-3-Clause | [librosa](https://github.com/librosa/librosa), [pretty-midi](https://github.com/craffel/pretty-midi) |
| Ollama | runs the language model (and, on macOS, the image model) | MIT | [ollama/ollama](https://github.com/ollama/ollama) |
| Qwen2.5 Instruct (7B / 3B) | production briefs and lyrics | Apache-2.0 (7B), Qwen Research License (3B — non-commercial) | [Qwen](https://huggingface.co/Qwen) |
| FLUX.2 [klein] 4B | cover art on macOS | Apache-2.0 | [black-forest-labs/FLUX.2-klein-4B](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B) |
| Z-Image Turbo | cover art on Windows/Linux | Apache-2.0 | [Tongyi-MAI/Z-Image-Turbo](https://huggingface.co/Tongyi-MAI/Z-Image-Turbo), GGUF: [leejet/Z-Image-Turbo-GGUF](https://huggingface.co/leejet/Z-Image-Turbo-GGUF) |
| Qwen3-4B-Instruct-2507 (GGUF) | text encoder for Z-Image | Apache-2.0 | [unsloth/Qwen3-4B-Instruct-2507-GGUF](https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF) |
| stable-diffusion.cpp | runs Z-Image on Windows/Linux | MIT | [leejet/stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp) |
| audiowmark + zita-resampler | inaudible watermark (macOS/Linux) | GPL-3.0 — built on your machine from the official sources | [uplex.de/audiowmark](https://uplex.de/audiowmark/), [zita-resampler](https://kokkinizita.linuxaudio.org/linuxaudio/) |
| FFmpeg | mastering and export | LGPL/GPL (depending on build) | Homebrew (macOS), your distribution (Linux), [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds) (Windows) |
| Homebrew, uv | installing the above (macOS / Windows) | BSD-2-Clause / MIT-Apache | [brew.sh](https://brew.sh), [astral-sh/uv](https://github.com/astral-sh/uv) |

The macOS installer's approach (Apple command line tools, pinned engine revision, resumable model downloads) was
inspired by the MIT-licensed [music-generator](https://github.com/rabbitfiremediacreation/music-generator).

**Note on the 3B language model:** machines with less than 16 GB RAM get `qwen2.5:3b-instruct`, whose license is
non-commercial. If you plan to sell music made there, install `qwen2.5:7b-instruct` instead (or write your own lyrics).
