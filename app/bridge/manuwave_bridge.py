#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Manuwave Studio bridge — lets the Mac run the real music AI.

Manuwave Studio runs on a small machine without a GPU. ACE-Step 1.5 needs
one. This bridge runs on the Mac, picks up jobs from the Manuwave Studio server,
computes them with the local ace-server (acestep.cpp) and sends the result back.

🔑 The Mac connects OUTWARD. It opens no port, and the ace-server
   stays on 127.0.0.1 — nothing new becomes reachable on the Mac from outside.

    python3 manuwave_bridge.py --pair        # pair (shows a code)
    python3 manuwave_bridge.py --install     # set up as a service (starts with the Mac)
    python3 manuwave_bridge.py --uninstall   # remove the service
    python3 manuwave_bridge.py --status      # what is running right now?
    python3 manuwave_bridge.py               # run in the foreground

The production brief is written by the language model on the Mac (Ollama) — since 3.0 there is
no cloud service in Manuwave Studio any more.

Since 3.2 the Mac refines every track: inaudible watermark (audiowmark), tags with the
copyright from the settings, an AI cover (image model via Ollama), export as MP3 or
lossless (FLAC, ALAC, WAV, AIFF, WavPack, TTA).

    python3 manuwave_bridge.py --nachruesten  # retroactively refine all tracks in the archive
    python3 manuwave_bridge.py --pruefen DATEI  # does this file carry our watermark?

Standard library only, runs on Python 3.9 and up (the macOS system Python).
"""
from __future__ import annotations

import argparse
import datetime
import math
import threading
import email
import email.policy
import hashlib
import json
import os
import platform
import random
import re
import secrets
import socket
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import wave
import io
try:
    import audioop  # standard library up to 3.12 — the macOS system Python is 3.9
except ImportError:  # removed in 3.13: the end is then left unsmoothed (see smooth_end)
    audioop = None

BRIDGE_VERSION = "3.23.0"
HOME = os.path.expanduser("~")
IS_MAC, IS_WIN = sys.platform == "darwin", os.name == "nt"
EXE = ".exe" if IS_WIN else ""
# 3.11: location selectable ($MWS_HOME). An existing install in the previous install folder stays where it is;
#       new installs (installer of Manuwave Studio) live under ~/ManuwaveStudio.
#       🔴 The folder must be inside the user folder: archive paths travel relative to ~ (<previous install folder>/renders/…).
# Names of earlier installs (the product's previous name). They are only ever recognised, never created:
# built from parts so the old name does not appear in this file.
_PREV = "Neon" + "Forge"                      # names-ok
DIR = os.environ.get("MWS_HOME") or (os.path.join(HOME, _PREV) if os.path.isdir(os.path.join(HOME, _PREV))
                                     else os.path.join(HOME, "ManuwaveStudio"))
CONFIG = os.path.join(DIR, "bridge.json")
# 3.20 (App 3.26): this is how the app shows the folder (customers: ~/ManuwaveStudio) — instead of a fixed path in texts
def shown_path(p: str) -> str:
    """Path as a human would type it: ~/… (Windows: %USERPROFILE%\\…)."""
    if not os.path.abspath(p).startswith(HOME + os.sep):
        return p
    return ("%USERPROFILE%\\" if IS_WIN else "~/") + os.path.relpath(p, HOME)


SHOWN_DIR = shown_path(DIR)
INFLIGHT = os.path.join(DIR, "inflight.json")    # the job the model server is currently computing
RENDERS = os.path.join(DIR, "renders")
# 3.23: the macOS service has a neutral name. A service that an earlier install already registered under its
# old label keeps it (no second service, no re-registration): label, plist and log follow what exists.
LABEL_NEW = "app.manuwave-studio.bridge"
_AGENTS = os.path.join(HOME, "Library", "LaunchAgents")


def _prev_label() -> str:
    """Label of a service registered by an earlier install (any '<vendor>.<previous name>-bridge'), else ''."""
    try:
        for name in sorted(os.listdir(_AGENTS)):
            if name.endswith(".plist") and name[:-6].endswith(_PREV.lower() + "-bridge"):
                return name[:-6]
    except OSError:
        pass
    return ""


LABEL_PREV = _prev_label() if IS_MAC else ""
LABEL = LABEL_PREV or LABEL_NEW
PLIST = os.path.join(_AGENTS, LABEL + ".plist")
_LOGNAME = (_PREV.lower() + "-bridge.log") if LABEL_PREV else "manuwave-studio-bridge.log"
LOG = os.path.join(HOME, "Library", "Logs", _LOGNAME) if IS_MAC else os.path.join(DIR, "bridge.log")
BRIDGE_NAMES = ("manuwave_bridge.py", _PREV.lower() + "_bridge.py")   # file names an installed bridge may have

DEFAULTS = {
    "server": "http://127.0.0.1:8104",          # local install; a paired one carries its address in bridge.json
    "token": "",
    # The music AI (acestep.cpp + models) — the installer puts it here. Older installs carry
    # their path (e.g. from an earlier installer) explicitly in bridge.json.
    "engine_dir": os.path.join(DIR, "engine", "acestep.cpp"),
    "engine_conf": os.path.join(DIR, "engine.conf"),
    # 3.10: publishing to a dedicated elevator-music site — empty = off (button does not appear)
    "web_admin": "",
    # 3.11: cover route. "" = choose automatically: macOS → Ollama 0.32.5 (MLX), otherwise → stable-diffusion.cpp (sd-server)
    "image_backend": "",
    "sd_port": 11441,
    "synth_port": 8085,
    "lm_port": 8086,
    "synth_model": "acestep-v15-sft-Q8_0.gguf",
    "idle_stop_min": 15,     # stop a model server we started ourselves after this much idle time
    "keep_renders": True,    # additionally keep every finished file on the Mac
    # The Mac writes the production brief itself (Ollama). Empty = pick the best one automatically.
    "writer_url": "http://127.0.0.1:11434",
    "writer_model": "",
    "writer_model_url": "",  # 3.20: which Ollama hosts the chosen model (empty = our own)
    # Sound guidance of the music AI (APG), when the browser does not send one. 7.0 is what the
    # model server computes in its own comparison against the Python original for SFT; up to 2.2 every
    # track ran with 1.0 = unguided. 1.0 switches it off.
    "guidance_scale": 7.0,
    # 3.2: copyright details for tags and watermark — adjustable in Manuwave Studio under ⚙️.
    # Empty rights holder = full name of the Mac account (filled in on the first run).
    "rights": {},
    # Image model for the cover (Ollama). Empty = pick automatically (FLUX.2 klein before Z-Image).
    "image_model": "",
    # 🔴 From 0.32.6 on, Ollama can NO LONGER generate images ("image generation models are not currently
    #    supported", ollama#17893/#18863 — supposed to return on a new MLX runner). Therefore
    #    a dedicated Ollama 0.32.5 runs for the cover under <previous install folder>/tools/ollama-bild, only when
    #    needed and on its own port — the Ollama used by DocuSort stays untouched.
    "image_port": 11439,
}

# Fields that may go to the ace-server — the Mac does not blindly trust the server.
ACE_FIELDS = {"caption", "lyrics", "bpm", "duration", "keyscale", "timesignature",
              "vocal_language", "seed", "inference_steps", "guidance_scale",
              "lm_temperature", "use_cot_caption", "lm_top_k", "lm_top_p", "lm_cfg_scale"}
# 3.14: the language model plans somewhat less wildly (ACE-Step INFERENCE.md: top_k "typical 40–100"; server default
# was temperature 0.85 without top_k). Fewer total failures in the composition — variety is preserved via the seed.
LM_DEFAULTS = {"lm_temperature": 0.8, "lm_top_k": 60}


def log(msg: str) -> None:
    print(time.strftime("%Y-%m-%d %H:%M:%S ") + msg, flush=True)


# =============================================================================
# Settings
# =============================================================================

def load_config() -> dict:
    cfg = dict(DEFAULTS)
    try:
        with open(CONFIG, encoding="utf-8") as f:
            cfg.update(json.load(f))
    except (OSError, ValueError):
        pass
    return cfg


def save_config(cfg: dict) -> None:
    import tempfile
    os.makedirs(DIR, exist_ok=True)
    # 0600: the key is the permission — nobody else on the Mac can read it (mkstemp creates 0600).
    # 3.2: own temp name + lock, because the service and "--nachruesten" can both write.
    with FileLock("bridge-config"):
        fd, tmp = tempfile.mkstemp(dir=DIR, prefix=".bridge-", suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2, ensure_ascii=False)
        os.replace(tmp, CONFIG)
        os.chmod(CONFIG, 0o600)


def ensure_token(cfg: dict) -> dict:
    if not re.match(r"^[A-Za-z0-9_-]{24,128}$", cfg.get("token") or ""):
        cfg["token"] = secrets.token_urlsafe(32)      # 256 bits
        save_config(cfg)
    return cfg


def engine_conf(cfg: dict) -> dict:
    """What the installer of an earlier version measured (MODE, LM_FILE)."""
    conf = {}
    try:
        with open(cfg["engine_conf"], encoding="utf-8") as f:
            for line in f:
                if "=" in line:
                    k, v = line.split("=", 1)
                    conf[k.strip()] = v.strip()
    except OSError:
        pass
    return conf


DIT_RE = re.compile(r"^acestep-v15-(.+?)-(Q\d_\w+|Q\d_0|BF16)\.gguf$")


def dit_files(cfg: dict) -> dict:
    """Sound models (DiT) in the model folder: short name → file, e.g. "xl-sft" → acestep-v15-xl-sft-Q8_0.gguf.
    With several quantisations, Q8_0 wins."""
    out = {}
    try:
        names = sorted(os.listdir(os.path.join(cfg["engine_dir"], "models")))
    except OSError:
        return out
    for f in names:
        m = DIT_RE.match(f)
        if m and (m.group(1) not in out or m.group(2) == "Q8_0"):
            out[m.group(1)] = f
    return out


def agent_info(cfg: dict, busy: bool) -> dict:
    conf = engine_conf(cfg)
    lm = conf.get("LM_FILE", "")
    m = re.search(r"lm-([0-9.]+B)", lm)
    try:
        chip = subprocess.run(["sysctl", "-n", "machdep.cpu.brand_string"], capture_output=True,
                              text=True, timeout=3).stdout.strip()
        ram = int(subprocess.run(["sysctl", "-n", "hw.memsize"], capture_output=True,
                                 text=True, timeout=3).stdout.strip()) // (1024 ** 3)
    except Exception:
        chip, ram = platform.machine(), 0
    return {"host": socket.gethostname().split(".")[0], "chip": chip, "ram_gb": ram,
            "lm": m.group(1) if m else (lm or "?"), "mode": conf.get("MODE", "?"),
            "engine": "ACE-Step 1.5", "version": BRIDGE_VERSION, "busy": busy,
            "writer": find_writer(cfg), "dits": ",".join(sorted(dit_files(cfg)))[:80],
            "caps": caps_for(cfg), "image": find_image_model(cfg), "home": SHOWN_DIR,
            "script": shown_path(os.path.abspath(__file__))}


# =============================================================================
# The brief writer: a local language model (Ollama) on the Mac
# =============================================================================

# Preferred models, in this order — instruction-following ones that can produce JSON to a schema.
WRITER_PREFER = ("qwen2.5:14b", "qwen2.5:7b", "qwen3", "qwen2.5", "llama3.1", "llama3",
                 "gemma3", "gemma2", "mistral")
# 3.20 (App 3.26): the Ollama someone already runs themselves (default port) also provides brief writers — selectable under ⚙️.
# Only these fixed addresses on this machine are queried, never one from the browser.
USER_OLLAMA = "http://127.0.0.1:11434"
# Image and embedding models do not write text (older Ollama versions report no capabilities → go by name)
NOT_WRITER = re.compile(r"embed|flux|z-image|stable-diffusion|sdxl|whisper", re.I)
_writer_cache = {"at": 0.0, "list": [], "pick": None}
_writer_lock = threading.Lock()


def _norm_url(u: str) -> str:
    return (u or "").strip().rstrip("/").replace("://localhost:", "://127.0.0.1:")


def writer_sources(cfg: dict) -> list:
    """The Ollama addresses that may write briefs: the installation's own first, then the user's."""
    own = _norm_url(cfg.get("writer_url") or DEFAULTS["writer_url"])
    more = cfg.get("writer_also", [USER_OLLAMA])
    out = [own]
    for u in (more if isinstance(more, list) else []):
        u = _norm_url(str(u))
        if u.startswith("http://127.0.0.1:") and u not in out:
            out.append(u)
    return out


def _ollama_get(url: str, path: str, body=None, timeout=3):
    req = urllib.request.Request(url + path, data=json.dumps(body).encode() if body is not None else None,
                                 method="POST" if body is not None else "GET",
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def _writer_models(url: str) -> list:
    """Models of an Ollama address that can write text — [] if it is not running."""
    try:
        tags = _ollama_get(url, "/api/tags").get("models", [])
    except Exception:
        return []
    out = []
    for m in tags:
        name = m.get("name", "")
        if not name or NOT_WRITER.search(name):
            continue
        try:
            caps = _ollama_get(url, "/api/show", {"model": name}).get("capabilities") or []
        except Exception:
            caps = []
        if caps and "completion" not in caps:
            continue
        out.append({"name": name, "url": url, "thinking": "thinking" in caps,
                    "gb": round((m.get("size") or 0) / 1e9, 1)})
    return out


def _pick_auto(found: list, own: str):
    for group in ([w for w in found if w["url"] == own], [w for w in found if w["url"] != own]):
        names = [w["name"] for w in group]
        for pre in WRITER_PREFER:
            hit = sorted(n for n in names if n.startswith(pre))
            if hit:
                return next(w for w in group if w["name"] == hit[0])
        if group:
            return group[0]
    return None


def writer_state(cfg: dict, fresh: bool = False) -> dict:
    """What is available and who is writing right now. Queried on every poll (every ~25 s),
    so cached for a minute. If the chosen model is gone (user's Ollama off), the best other one
    writes automatically — the choice stays saved and applies again as soon as it is back."""
    now = time.time()
    with _writer_lock:
        if not fresh and now - _writer_cache["at"] < 60:
            return dict(_writer_cache)
    srcs = writer_sources(cfg)
    found = [w for u in srcs for w in _writer_models(u)]
    want = (cfg.get("writer_model") or "").strip()
    want_url = _norm_url(cfg.get("writer_model_url") or srcs[0])
    pick = next((w for w in found if w["name"] == want and w["url"] == want_url), None) if want else None
    pick = pick or _pick_auto(found, srcs[0])
    with _writer_lock:
        _writer_cache.update(at=now, list=found, pick=pick)
        return dict(_writer_cache)


def find_writer(cfg: dict) -> str:
    """Name of the model that writes briefs here — "" means: the machine cannot right now."""
    pick = writer_state(cfg)["pick"]
    return pick["name"] if pick else ""


def writer_chat(cfg: dict, body: dict, timeout: int) -> dict:
    """A request to the brief writer. Thinking models (Qwen 3 …) otherwise answer only after a long
    thinking phase — for tags and lyrics that brings nothing but waiting time, so off."""
    pick = writer_state(cfg)["pick"]
    if not pick:
        raise RuntimeError("Kein Sprachmodell erreichbar (Ollama)")
    body = dict(body, model=pick["name"])
    if pick.get("thinking"):
        body["think"] = False
    return _ollama_get(pick["url"], "/api/chat", body, timeout=timeout)


def writer_settings(cfg: dict, fresh: bool = False) -> dict:
    st = writer_state(cfg, fresh)
    own = writer_sources(cfg)[0]
    pick = st["pick"] or {}
    return {"auto": not (cfg.get("writer_model") or "").strip(), "model": (cfg.get("writer_model") or "").strip(),
            "url": _norm_url(cfg.get("writer_model_url") or own) if cfg.get("writer_model") else "",
            "using": pick.get("name", ""), "using_url": pick.get("url", ""),
            "options": [dict(w, mine=w["url"] != own) for w in st["list"]],
            "user_ollama": any(u != own for u in writer_sources(cfg))}


def set_writer(cfg: dict, want) -> None:
    """Choice from ⚙️: {"model": "", …} = automatic, otherwise name + address from the offered list."""
    if not isinstance(want, dict):
        raise RuntimeError("Ungültige Modellwahl")
    name, url = str(want.get("model") or "").strip(), _norm_url(str(want.get("url") or ""))
    if name:
        found = writer_state(cfg, fresh=True)["list"]
        if not any(w["name"] == name and w["url"] == url for w in found):
            raise RuntimeError("Dieses Sprachmodell ist gerade nicht erreichbar")
    with _cfg_lock:
        cfg["writer_model"], cfg["writer_model_url"] = name, url if name else ""
        save_config(cfg)
    writer_state(cfg, fresh=True)
    log("Brief-Schreiber: %s" % (name or "automatisch"))


# A small model only writes a usable brief if it is given little
# leeway: tags in groups with a minimum count (otherwise 8 come out instead of 20), lyrics as
# a list of sections (otherwise the hook sticks to the marker), and the browser supplies
# the skeleton (otherwise it ignores the length). Measured with qwen2.5:7b on 10.10.2026.
WRITER_SYSTEM = """Du bist ein erfahrener Produzent und Songwriter für jede Richtung — von Techno und House über Pop,
Hip-Hop, Rock und Jazz bis Orchester und Filmmusik. Du schreibst den
Produktions-Brief für die Musik-KI ACE-Step 1.5. Alle Tags auf ENGLISCH, konkret, keine Künstler- oder Songnamen.
Die genannte Richtung bestimmt Klänge, Groove und Tempo — schreib einem Jazz-Stück keine Synths und keinem Rock-Song einen Drop.
Die Beispiele unten sind nur Muster: übernimm KEINES, das nicht zur Richtung passt. Klänge, die die Idee nennt, haben
Vorrang — übersetze sie ins Englische (z. B. „Kontrabass" → "upright bass", „Besen-Schlagzeug" → "brushed drums").
- genre_tags: 1–2 Tags, Genre + Subgenre, die ZUSAMMENPASSEN ("melodic techno", "progressive house", "indie rock",
  "bossa nova", "cinematic orchestral"). Keine widersprüchlichen Stile — die Musik-KI kann Widersprüche nicht auflösen.
- rhythm_tags: Groove — Club: ("four-on-the-floor", "rolling 16th hi-hats", "shuffled groove", "broken beat");
  andere Richtungen: ("laid-back backbeat", "swing feel", "bossa nova groove", "half-time groove", "driving rock beat", "rubato, no fixed beat")
- instrument_tags: 3–6 konkrete Klänge, die zur Richtung gehören — lieber wenige tragende als viele ("analog bassline", "detuned supersaw lead", "acid 303 line", "plucked arpeggio", "warm pads", "rumbling sub bass", "vocal chops",
  "fingerpicked acoustic guitar", "upright bass", "brushed drums", "string section", "overdriven electric guitar", "brass section")
- production_tags: wie der fertige Mix KLINGT, nicht wie er gebaut ist ("warm analog mix", "polished production",
  "wide stereo", "deep clean bass", "crisp clear highs", "natural dynamics", "lush reverb", "punchy kick").
  KEINE Technik-Wörter (kein "sidechain compression", "parallel compression", "tape saturation", "loud master")
  und nichts Kratziges ("distorted", "bitcrushed", "lo-fi", "harsh") — außer die Aufgabe verlangt es ausdrücklich.
- mood_tags: Stimmung ("hypnotic", "euphoric", "dark", "driving", "uplifting", "melancholic", "peak-time").
  Bei Gesang zusätzlich EIN Tag, der die Stimme natürlich beschreibt ("warm natural female vocals",
  "intimate breathy vocals", "soulful expressive male vocals") — keine Effekte wie "autotune", "vocoder".
- sections: GENAU das vorgegebene Gerüst, in dieser Reihenfolge, mit denselben Markern. lines = die Textzeilen des Abschnitts.
  Instrumentale Abschnitte bekommen lines = [] — und hinter den Marker eine kurze englische Beschreibung, was dort
  passiert (2–5 Wörter): "Intro - soft filtered pads", "Build - rising arpeggio, snare roll", "Drop - full energy, supersaw lead",
  "Breakdown - piano and strings only", "Outro - pads fade out". So weiß die Musik-KI, wohin der Track will.
  Gesangsabschnitte: 4 eigene, singbare Zeilen (3–8 Wörter), mit Reimen, in der SPRACHE, die die Aufgabe nennt.
  Jeder [Chorus] ist bei jedem Auftreten WORTGLEICH und enthält die Hook. Strophen erzählen weiter und wiederholen keine Zeile.
  Vocal-Chops: nur kurze Silben oder einzelne Wörter ("oh-oh", "hey"), höchstens 2 Zeilen.
  Eigener Text, nie ein bekannter Songtext.
- Keine Zahlen für Tempo oder Tonart in den Tags — dafür gibt es bpm und keyscale.
- bpm passend zum Genre (Techno 125–135, Hard Techno 140–155, Trance 136–142, Psytrance 140–148,
  Melodic/Deep House 118–124, Drum & Bass 170–176, Hip-Hop 85–98, Downtempo 85–110). Nennt die Aufgabe
  ein Tempo oder einen Tempobereich, gilt das.
- keyscale in englischer Notation ("A minor", "F# minor", "C major"); Moll für dunkel/emotional.
- title: kurz, einprägsam.
- note: 2–4 Sätze AUF DEUTSCH (auch wenn der Songtext englisch ist): die Idee, der Aufbau, die wichtigsten Sound-Entscheidungen.
Antworte nur mit dem JSON-Objekt."""

_TAGS = {"type": "array", "items": {"type": "string"}}
WRITER_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        # 3.14: fewer, coherent tags (ACE-Step tutorial: contradictory styles degrade the result) —
        # previously up to 26 tags; a failed track carried 19, including trance + glockenspiel + piano + "open-ended"
        "genre_tags": dict(_TAGS, minItems=1, maxItems=2),
        "rhythm_tags": dict(_TAGS, minItems=1, maxItems=3),
        "instrument_tags": dict(_TAGS, minItems=3, maxItems=6),
        "production_tags": dict(_TAGS, minItems=2, maxItems=4),
        "mood_tags": dict(_TAGS, minItems=2, maxItems=4),
        "sections": {"type": "array", "items": {
            "type": "object",
            "properties": {"marker": {"type": "string"}, "lines": dict(_TAGS, maxItems=6)},
            "required": ["marker", "lines"]}},
        "bpm": {"type": "integer"},
        "keyscale": {"type": "string"},
        "note": {"type": "string"},
    },
    "required": ["title", "genre_tags", "rhythm_tags", "instrument_tags", "production_tags",
                 "mood_tags", "sections", "bpm", "keyscale", "note"],
}
TAG_GROUPS = ("genre_tags", "rhythm_tags", "instrument_tags", "production_tags", "mood_tags")
# 3.14: tempo and key belong in bpm/keyscale, not in the tags (ACE-Step tutorial)
NUMERIC_TAG = re.compile(r"\b\d{2,3}\s*bpm\b|\b[A-G][#b♯♭]?\s*(?:major|minor|dur|moll)\b", re.I)


NOTE_DE = "- note: 2–4 Sätze AUF DEUTSCH (auch wenn der Songtext englisch ist)"
NOTE_EN = "- note: 2–4 Sätze AUF ENGLISCH (die Oberfläche ist englisch)"


def writer_system(ui_lang: str = "de") -> str:
    """3.12: with an English UI the model writes the note in English — otherwise German as before."""
    return WRITER_SYSTEM.replace(NOTE_DE, NOTE_EN) if ui_lang == "en" else WRITER_SYSTEM


def assemble_brief(raw: dict) -> dict:
    """Model answer → the brief the browser knows (caption, lyrics, bpm, …)."""
    seen, tags = set(), []
    for g in TAG_GROUPS:
        for t in raw.get(g) or []:
            t = re.sub(r"\s+", " ", str(t)).strip(" ,.;")
            if t and len(t) <= 60 and t.lower() not in seen and not NUMERIC_TAG.search(t):
                seen.add(t.lower())
                tags.append(t)
    parts = []
    for sec in (raw.get("sections") or [])[:24]:
        if not isinstance(sec, dict):
            continue
        marker = re.sub(r"[\[\]]", "", str(sec.get("marker") or "")).strip()[:60]   # 3.14: "Drop - full energy, …"
        if not marker:
            continue
        lines = [re.sub(r"\s+", " ", str(x)).strip() for x in (sec.get("lines") or [])]
        lines = [x[:120] for x in lines if x][:12]
        parts.append("[%s]" % marker + ("\n" + "\n".join(lines) if lines else ""))
    out = {"title": str(raw.get("title") or "").strip()[:80],
           "caption": ", ".join(tags[:35]),
           "lyrics": "\n\n".join(parts),
           "keyscale": str(raw.get("keyscale") or "").strip()[:24],
           "note": str(raw.get("note") or "").strip()[:1500]}
    try:
        out["bpm"] = int(raw.get("bpm"))
    except (TypeError, ValueError):
        pass
    return out


def _blocks(lyrics: str):
    for blk in lyrics.split("\n\n"):
        z = blk.split("\n")
        yield z[0], z[1:]


def brief_defects(brief: dict, ui_lang: str = "de") -> list:
    """What a small model likes to get wrong (measured): verse lines doubled
    ("Meer der Freiheit, / Meer der Freiheit, …"), choruses with 7 lines of the same hook.
    In the chorus a repeated hook line is intended — there only the length counts."""
    out = []
    for head, lines in _blocks(brief.get("lyrics") or ""):
        norm = [x.lower().strip(" ,.!?") for x in lines]
        if len(lines) > 6:
            out.append("%s hat %d Zeilen" % (head, len(lines)))
        if not head.lower().startswith(("[chorus", "[hook")) and len(set(norm)) < len(norm):
            out.append("%s wiederholt Zeilen" % head)
    # The note is supposed to be German — measured: with English lyrics it came out English ("Autumn Melody").
    words = re.findall(r"[a-zäöüß]+", (brief.get("note") or "").lower())
    if ui_lang == "en":
        # 3.12: English UI → the note should be English
        if len(words) >= 8 and sum(w in DE_WORDS for w in words) >= 4:
            out.append("note not in English")
    elif len(words) >= 8 and sum(w in DE_WORDS for w in words) < 2:
        out.append("Notiz nicht deutsch")
    return out


DE_WORDS = {"der", "die", "das", "und", "mit", "ein", "eine", "ist", "im", "den", "dem", "des", "zu",
            "auf", "für", "sich", "wird", "von", "nicht", "einen", "einem", "durch", "über"}


def _collapse_repeats(brief: dict) -> None:
    """Last resort: merge directly repeated lines outside the chorus."""
    parts = []
    for head, lines in _blocks(brief.get("lyrics") or ""):
        if not head.lower().startswith(("[chorus", "[hook")):
            keep = []
            for x in lines:
                if not keep or keep[-1].lower().strip(" ,.!?") != x.lower().strip(" ,.!?"):
                    keep.append(x)
            lines = keep
        parts.append("\n".join([head] + lines[:6]))
    brief["lyrics"] = "\n\n".join(parts)


# Listening tests found the output sounding technical or oddly digital (10.10.2026): briefs from the small model
# carried mix craft and harshness as sound wishes ("tape saturation, parallel drum
# compression, distorted stab layers, loud club master"). The music AI takes that literally.
# Unless something like that is explicitly in the task, it gets removed from the tags.
HARSH_TAG = re.compile(r"distort|bitcrush|lo-?fi|harsh|saturat|overdriv|clipping|crush|"
                       r"loud (club )?master|brickwall|parallel (drum )?compression|sidechain", re.I)
# 3.8: directions that include distortion count as a request (the browser writes "verzerrt" into the task for them).
WANTS_HARSH = re.compile(r"verzerr|distort|lo-?fi|industrial|hard ?techno|hardgroove|hardstyle|dreckig|dirty|rough|kratz|crunch|"
                         r"noise|saturat|sidechain|pump|\brock\b|metal|punk|grunge|shoegaze|dubstep|neurofunk|phonk|drill|gabber|hardcore", re.I)


def soften_caption(brief: dict, user: str) -> list:
    """Remove harsh/technical tags if the task does not ask for them. Returns the
    removed ones (for the log)."""
    if WANTS_HARSH.search(user or ""):
        return []
    tags = [t.strip() for t in (brief.get("caption") or "").split(",") if t.strip()]
    gone = [t for t in tags if HARSH_TAG.search(t)]
    if gone:
        brief["caption"] = ", ".join(t for t in tags if not HARSH_TAG.search(t))
    return gone


def _ask_writer(cfg: dict, model: str, user: str, temperature: float, ui_lang: str = "de") -> dict:
    body = {"model": model, "stream": False, "format": WRITER_SCHEMA,
            "messages": [{"role": "system", "content": writer_system(ui_lang)},
                         {"role": "user", "content": user}],
            "options": {"temperature": temperature, "num_ctx": 8192}}
    answer = writer_chat(cfg, body, 240)
    try:
        raw = json.loads((answer.get("message") or {}).get("content") or "")
    except ValueError:
        raise RuntimeError("Das Sprachmodell hat keinen lesbaren Brief geliefert")
    brief = assemble_brief(raw if isinstance(raw, dict) else {})
    if not brief["caption"] or not brief["lyrics"]:
        raise RuntimeError("Der Brief des Sprachmodells ist unvollständig")
    return brief


def write_brief(cfg: dict, user: str, ui_lang: str = "de") -> dict:
    model = find_writer(cfg)
    if not model:
        raise RuntimeError("Kein Sprachmodell auf dem Mac erreichbar (Ollama)")
    t0 = time.monotonic()
    # A miss is down to sampling chance — a second attempt usually fixes it.
    # At most two attempts: the brief should be ready in seconds, not minutes.
    best, best_def, tries = None, None, 0
    for temperature in (0.8, 0.9):
        tries += 1
        brief = _ask_writer(cfg, model, user, temperature, ui_lang)
        defects = brief_defects(brief, ui_lang)
        if best is None or len(defects) < len(best_def):
            best, best_def = brief, defects
        if not defects:
            break
    if best_def:
        _collapse_repeats(best)
    gone = soften_caption(best, user)
    if gone:
        log("aus dem Brief genommen (nicht verlangt): %s" % ", ".join(gone))
    best.update(writer=model, write_s=round(time.monotonic() - t0, 1), tries=tries)
    return best


# =============================================================================
# Connection to the Manuwave Studio server
# =============================================================================

class Server:
    def __init__(self, cfg: dict):
        self.base = cfg["server"].rstrip("/")
        self.token = cfg["token"]
        self.cfg = cfg

    def _req(self, method, path, body=None, raw=None, ctype=None, timeout=40, extra=None):
        h = {"x-nf-bridge": self.token}
        h.update(extra or {})
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            h["Content-Type"] = "application/json"
        elif raw is not None:
            data = raw
            h["Content-Type"] = ctype or "application/octet-stream"
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=h)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            payload = r.read()
            if r.status == 204:
                return 204, None
            ct = r.headers.get("Content-Type", "")
            return r.status, (json.loads(payload) if ct.startswith("application/json") else payload)

    def next_job(self, busy=False, lane="render"):
        agent = urllib.parse.quote(json.dumps(agent_info(self.cfg, busy)))
        return self._req("GET", "/api/bridge/next?wait=25&lane=" + lane, timeout=45,
                         extra={"x-nf-agent": agent})

    def progress(self, jid, message, job=None) -> bool:
        """True if the browser wants to cancel."""
        try:
            _, r = self._req("POST", "/api/bridge/progress/" + jid, body={"message": message}, timeout=15)
            r = r or {}
            if r.get("unknown") and job is not None:
                self.adopt(job)          # 3.13: server restarted → keep computing instead of aborting
                return False
            return bool(r.get("cancel"))
        except Exception:
            return False

    def adopt(self, job) -> None:
        """3.13: The server no longer knows the job (restarted, its queue lived only in memory).
        Up to 3.12 that meant "cancel" — a deploy cost a half-computed track that way. Now the job is
        registered again under the same ID; the browser receives the result as usual."""
        try:
            agent = urllib.parse.quote(json.dumps(agent_info(self.cfg, True)))
            self._req("POST", "/api/bridge/adopt/" + job["id"], timeout=15, extra={"x-nf-agent": agent},
                      body={k: job.get(k) for k in ("kind", "request", "meta")})
            log("Server war neu gestartet — Auftrag %s wieder angemeldet, es wird weitergerechnet" % job["id"])
        except Exception as e:  # noqa: BLE001 — again at the next sign of life
            log("Wiederanmelden von %s noch nicht möglich: %s" % (job["id"], e))

    def meta(self, jid, meta):
        self._req("POST", "/api/bridge/meta/" + jid, body=meta, timeout=30)

    def _send(self, jid, data, ctype):
        """Send a result to the server — with patience. 🔴 12.10.2026: a 41 MB track (16 min computed)
        failed after a fixed 300 s ("urlopen error timed out"), because the tunnel Mac → Pi ran over a
        relay and a large download was saturating it at the same time (0.42 instead of 1.9 MB/s).
        Now: deadline by size (at least 60 KB/s), three attempts; a 409 on retry means
        "already arrived". The track is in the archive anyway."""
        timeout = max(300, len(data) // 60000 + 60)
        for attempt in range(3):
            try:
                self._req("POST", "/api/bridge/result/" + jid, raw=data, ctype=ctype, timeout=timeout)
                return
            except urllib.error.HTTPError as e:
                if e.code == 409 and attempt:
                    return
                raise
            except Exception as e:  # noqa: BLE001
                if attempt == 2:
                    raise RuntimeError("Übergabe an Manuwave Studio dreimal zu langsam (%s) — der Track liegt auf dem "
                                       "Mac im Archiv; in der Bibliothek über „📥 Vom Mac holen“ holen" % e)
                log("Übergabe %s gescheitert (%s, %.0f MB) — neuer Versuch" % (jid, e, len(data) / 1e6))
                time.sleep(5 * (attempt + 1))

    def result_audio(self, jid, audio):
        self._send(jid, audio, "audio/wav")

    def result_file(self, jid, data, mime):
        self._send(jid, data, mime)

    def cover(self, jid, jpeg):
        self._req("POST", "/api/bridge/cover/" + jid, raw=jpeg, ctype="image/jpeg", timeout=120)

    def cover_failed(self, jid, message):
        try:
            self._req("POST", "/api/bridge/cover/" + jid, body={"error": message[:200]}, timeout=15)
        except Exception:
            pass

    def result_json(self, jid, result):
        self._req("POST", "/api/bridge/result/" + jid, body={"result": result}, timeout=30)

    def error(self, jid, message):
        try:
            self._req("POST", "/api/bridge/error/" + jid, body={"message": message[:300]}, timeout=15)
        except Exception:
            pass

    def upload(self, jid) -> bytes:
        _, data = self._req("GET", "/api/bridge/upload/" + jid, timeout=120)
        return data

    def pair_code(self) -> dict:
        _, r = self._req("POST", "/api/pair/offer", body={}, timeout=15)
        return r


# =============================================================================
# The local model server (ace-server)
# =============================================================================

class Cancelled(Exception):
    pass


class Engine:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.own = []                # processes we started ourselves — only THOSE are stopped later
        self.last_used = time.time()

    @property
    def synth(self):
        return "http://127.0.0.1:%d" % self.cfg["synth_port"]

    @property
    def lm(self):
        conf = engine_conf(self.cfg)
        if conf.get("MODE") == "split":
            return "http://127.0.0.1:%d" % self.cfg["lm_port"]
        return self.synth

    @staticmethod
    def _up(base) -> bool:
        try:
            with urllib.request.urlopen(base + "/health", timeout=3) as r:
                return r.status == 200
        except Exception:
            return False

    def ensure(self, report) -> None:
        """Start the model server if it is not running — exactly like the earlier "ON" switch."""
        conf = engine_conf(self.cfg)
        binary = engine_binary(self.cfg)
        models = os.path.join(self.cfg["engine_dir"], "models")
        if not binary:
            raise RuntimeError("Musik-KI nicht installiert (ace-server fehlt in %s) — erst den Installer von "
                               "Manuwave Studio ausführen." % os.path.join(self.cfg["engine_dir"], "build"))
        need = [(self.synth, self.cfg["synth_port"], {})]
        if conf.get("MODE") == "split":
            need.append((self.lm, self.cfg["lm_port"], {"GGML_BACKEND": "CPU"}))
        started = False
        for base, port, env in need:
            if self._up(base):
                continue
            report("Musik-KI auf dem Mac wird gestartet …")
            os.makedirs(DIR, exist_ok=True)
            logf = open(os.path.join(DIR, "ace-server-%d.log" % port), "ab")
            p = subprocess.Popen([binary, "--host", "127.0.0.1", "--port", str(port),
                                  "--models", models, "--max-batch", "1"],
                                 stdout=logf, stderr=logf, stdin=subprocess.DEVNULL,
                                 env={**os.environ, **env}, **({"creationflags": 0x00000200} if IS_WIN else {"start_new_session": True}))
            self.own.append(p)
            started = True
            log("ace-server gestartet (Port %d, PID %d)" % (port, p.pid))
        if started:
            for _ in range(240):
                if all(self._up(b) for b, _, _ in need):
                    break
                time.sleep(0.5)
            else:
                raise RuntimeError("Modellserver ist nicht hochgekommen — Log in %s" % SHOWN_DIR)
        self.last_used = time.time()

    def model_file(self, report, *wishes) -> str:
        """3.17: the first sound model from `wishes` (short names like "xl-base") that is on disk. If the running
        model server does not know it yet (it reads its folder only at startup) and we started it ourselves, it restarts.
        → file name or "" (then the configured model applies)."""
        files = dit_files(self.cfg)
        for w in wishes:
            f = files.get(w)
            if not f:
                continue
            known = self.known_dits()
            if known is None or f in known:
                return f
            if self.own:
                self.stop_own("neues Klangmodell %s" % f)
                self.ensure(report)
                known = self.known_dits()
                if known is None or f in known:
                    return f
        return ""

    def stop_own(self, why: str) -> None:
        for p in self.own:
            if p.poll() is None:
                p.terminate()
                try:
                    p.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    p.kill()
                log("ace-server beendet (%s, PID %d)" % (why, p.pid))
        self.own = []

    def maybe_stop_idle(self) -> None:
        """Only stop what we started ourselves — a model server started by another
        program is never touched, it belongs to someone else."""
        if not self.own:
            return
        if time.time() - self.last_used < self.cfg["idle_stop_min"] * 60:
            return
        for p in self.own:
            if p.poll() is None:
                p.terminate()
                try:
                    p.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    p.kill()
                log("ace-server nach Leerlauf beendet (PID %d)" % p.pid)
        self.own = []

    # ---- HTTP to the ace-server ----
    @staticmethod
    def _http(method, url, body=None, raw=None, ctype=None, timeout=60):
        h = {}
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            h["Content-Type"] = "application/json"
        elif raw is not None:
            data, h["Content-Type"] = raw, ctype
        req = urllib.request.Request(url, data=data, method=method, headers=h)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.headers.get("Content-Type", ""), r.read()

    # ---- Orphaned jobs ----
    # 🔴 MEASURED: if the bridge dies in the middle of a job (service restart, Mac
    #    goes to sleep, process killed), the model server still computes the job
    #    to the end — for nobody. It takes only one at a time, so everything
    #    new queued up behind it: a 15 s track took 3:41 instead of a minute.
    #    Therefore the running job is noted on disk and aborted on shutdown
    #    AND at the next start.
    @staticmethod
    def _note_inflight(base, job_id) -> None:
        try:
            os.makedirs(DIR, exist_ok=True)
            with open(INFLIGHT, "w", encoding="utf-8") as f:
                json.dump({"base": base, "id": job_id, "pid": os.getpid()}, f)
        except OSError:
            pass

    @staticmethod
    def _clear_inflight() -> None:
        try:
            os.remove(INFLIGHT)
        except OSError:
            pass

    @classmethod
    def cancel_inflight(cls, reason: str) -> bool:
        """Abort a noted job on the model server. True if there was one."""
        try:
            with open(INFLIGHT, encoding="utf-8") as f:
                rec = json.load(f)
        except (OSError, ValueError):
            return False
        try:
            cls._http("POST", rec["base"] + "/job?" + urllib.parse.urlencode(
                {"id": rec["id"], "cancel": 1}), timeout=5)
            log("verwaisten Auftrag %s beim Modellserver abgebrochen (%s)" % (rec["id"], reason))
        except Exception:
            pass   # model server off → nothing left to do
        cls._clear_inflight()
        return True

    def _wait(self, base, job_id, label, t0, tick):
        """Wait for a model server job. tick() → True means abort."""
        self._note_inflight(base, job_id)
        try:
            return self._wait_inner(base, job_id, label, t0, tick)
        finally:
            self._clear_inflight()

    def _wait_inner(self, base, job_id, label, t0, tick):
        last = 0.0
        while True:
            _, raw = self._http("GET", base + "/job?" + urllib.parse.urlencode({"id": job_id}))
            st = str(json.loads(raw).get("status", "")).lower()
            if st == "done":
                return self._http("GET", base + "/job?" + urllib.parse.urlencode(
                    {"id": job_id, "result": 1}), timeout=300)
            if any(w in st for w in ("err", "fail", "cancel")):
                raise RuntimeError("%s fehlgeschlagen: %s" % (label, raw.decode(errors="replace")[:200]))
            now = time.monotonic()
            if now - last >= 2.0:
                last = now
                el = int(now - t0)
                if tick("%d:%02d · %s" % (el // 60, el % 60, label)):
                    try:
                        self._http("POST", base + "/job?" + urllib.parse.urlencode(
                            {"id": job_id, "cancel": 1}), timeout=5)
                    except Exception:
                        pass
                    raise Cancelled()
            time.sleep(1.0)

    @staticmethod
    def _part(ctype, raw, want):
        """Fetch a part from a multipart/mixed response (audio/ or application/json)."""
        if ctype.startswith(want):
            return raw
        if "multipart" not in ctype:
            raise RuntimeError("unerwartete Antwort: " + ctype)
        msg = email.message_from_bytes(("Content-Type: %s\r\n\r\n" % ctype).encode() + raw,
                                       policy=email.policy.HTTP)
        for part in msg.iter_parts():
            if part.get_content_type().startswith(want):
                return part.get_payload(decode=True)
        raise RuntimeError("kein %s-Teil in der Antwort" % want)

    def repaint(self, request: dict, src_wav: bytes, tick):
        """3.14: Extend — repaint with source audio (multipart/form-data: request + audio). The language model is
        skipped; caption and lyrics steer the new part. → WAV of the whole window (source + new)."""
        return self.with_source(request, src_wav, tick, "Anbau")

    def with_source(self, request: dict, src_wav: bytes, tick, label: str):
        """3.17: every task with source audio (repaint, complete, …) — the model server receives request + audio."""
        boundary = "mws" + uuid.uuid4().hex
        body = b"".join([
            ("--%s\r\nContent-Disposition: form-data; name=\"request\"\r\nContent-Type: application/json\r\n\r\n" % boundary).encode(),
            json.dumps(request).encode(), b"\r\n",
            ("--%s\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"kontext.wav\"\r\nContent-Type: audio/wav\r\n\r\n" % boundary).encode(),
            src_wav, b"\r\n", ("--%s--\r\n" % boundary).encode()])
        t0 = time.monotonic()
        _, raw = self._http("POST", self.synth + "/synth", raw=body, ctype="multipart/form-data; boundary=" + boundary, timeout=120)
        ctype, raw = self._wait(self.synth, str(json.loads(raw)["id"]), label, t0, tick)
        self.last_used = time.time()
        return self._part(ctype, raw, "audio/")

    def render(self, request: dict, tick):
        req = {k: v for k, v in request.items() if k in ACE_FIELDS}
        req["duration"] = max(10.0, min(300.0, float(req.get("duration") or 90)))
        if int(req.get("seed", -1)) < 0:
            req["seed"] = random.randint(0, 2 ** 31 - 1)
        req.setdefault("lyrics", "[Instrumental]")
        req.setdefault("use_cot_caption", False)
        for k, v in LM_DEFAULTS.items():
            req.setdefault(k, v)
        # Sound guidance: if not given (older browser version), the configured one applies, not 1.0.
        if not req.get("guidance_scale"):
            req["guidance_scale"] = float(self.cfg.get("guidance_scale") or 1.0)
        req["output_format"] = "wav16"
        # 🔴 3.4: otherwise the model server normalises "to loudness" and HARD-clips the top 0.001 %
        #    of the samples (peak_clip=10, audio-io.h: "hard clip the rest") — measured 116–215
        #    flat peaks per track, up to 23 samples in a row. 0 = normalise to the peak only.
        req["peak_clip"] = 0
        req["synth_model"] = self.cfg["synth_model"]
        # Sound model on request (e.g. "xl-sft") — only what is on disk AND known to the running
        # model server (it reads its folder only at startup).
        wish = str(request.get("dit") or "")
        dit_note = ""
        if wish:
            f = dit_files(self.cfg).get(wish)
            known = self.known_dits()
            if f and (known is None or f in known):
                req["synth_model"] = f
            else:
                dit_note = ("Klangmodell %s nicht verfügbar — %s benutzt" % (wish, req["synth_model"]))
        lm_file = engine_conf(self.cfg).get("LM_FILE")
        if lm_file:
            req["lm_model"] = lm_file
        t0 = time.monotonic()
        # 1) Language model: plans structure, tempo, key — and generates the audio codes
        _, raw = self._http("POST", self.lm + "/lm", body=req)
        _, raw = self._wait(self.lm, str(json.loads(raw)["id"]), "Komposition", t0, tick)
        enriched = json.loads(raw)
        enriched = enriched[0] if isinstance(enriched, list) else enriched
        if not enriched.get("audio_codes"):
            raise RuntimeError("Das Sprachmodell hat keine Audio-Codes geliefert.")
        enriched["output_format"] = "wav16"
        enriched["peak_clip"] = 0
        enriched["synth_model"] = req["synth_model"]
        # The sound controls belong to the synthesis. The model server passes them through via /lm
        # (measured) — explicit here anyway, so it does not depend on its echo.
        for k in ("guidance_scale", "inference_steps"):
            if req.get(k):
                enriched[k] = req[k]
        # 2) Synthesis: this turns into sound
        _, raw = self._http("POST", self.synth + "/synth", body=enriched)
        ctype, raw = self._wait(self.synth, str(json.loads(raw)["id"]), "Klang", t0, tick)
        audio = self._part(ctype, raw, "audio/")
        meta = {k: enriched.get(k) for k in ("bpm", "duration", "keyscale", "timesignature",
                                            "vocal_language", "lyrics", "caption")}
        meta["seed"] = req["seed"]
        meta["peak_clip"] = 0          # 3.4: computed without clipping — mastering does not have to repair anything
        # 3.4: the same seed does NOT yield the same piece (measured: correlation 0.06) — keep the composition
        #      of the language model so a track can later sound new again without rerolling.
        if enriched.get("audio_codes"):
            meta["audio_codes"] = enriched["audio_codes"]
        meta["guidance_scale"] = req.get("guidance_scale")
        meta["dit"] = req["synth_model"]
        if dit_note:
            meta["dit_hinweis"] = dit_note
        if request.get("smooth_end", True):
            audio, info = smooth_end(audio)
            if info:
                meta["ende"] = info
        meta["render_s"] = round(time.monotonic() - t0, 1)
        try:
            with wave.open(io.BytesIO(audio)) as w:
                meta["duration_real"] = round(w.getnframes() / float(w.getframerate()), 2)
        except Exception:
            pass
        self.last_used = time.time()
        return audio, meta

    def known_dits(self):
        """The sound models known to the running model server (None = unknown)."""
        try:
            _, raw = self._http("GET", self.synth + "/props", timeout=5)
            return set((json.loads(raw).get("models") or {}).get("dit") or [])
        except Exception:
            return None

    def understand(self, audio: bytes, filename: str, tick):
        boundary = "nf" + uuid.uuid4().hex
        name = re.sub(r"[^\w.\- ]+", "_", filename or "upload")
        body = (("--%s\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"%s\"\r\n"
                 "Content-Type: application/octet-stream\r\n\r\n" % (boundary, name)).encode()
                + audio + ("\r\n--%s--\r\n" % boundary).encode())
        _, raw = self._http("POST", self.lm + "/understand", raw=body,
                            ctype="multipart/form-data; boundary=" + boundary, timeout=120)
        ctype, raw = self._wait(self.lm, str(json.loads(raw)["id"]), "Analyse", time.monotonic(), tick)
        data = json.loads(self._part(ctype, raw, "application/json"))
        data = data[0] if isinstance(data, list) else data
        self.last_used = time.time()
        keep = {k: data.get(k) for k in ("caption", "lyrics", "bpm", "keyscale", "timesignature",
                                        "vocal_language", "duration")}
        return {k: v for k, v in keep.items() if v not in (None, "")}


# =============================================================================
# Soft ending
# =============================================================================
# Song endings were often cut off (listening tests, 10.10.2026) — measured: on 7 of 13 tracks the level dropped
# from full volume to silence within 0.1–0.2 s (often followed by seconds of silence,
# because the music model's language model stops before the target length). Earlier songs,
# by contrast, faded out over 2–10 s. A hard cut in the last 12 s is therefore faded out smoothly
# and the silence behind it is shortened. A track that already fades out is left untouched.
def smooth_end(audio: bytes, fade_s: float = 4.0, tail_s: float = 0.8):
    """→ (audio, info|None). info says what was changed."""
    if audioop is None:
        return audio, None
    try:
        with wave.open(io.BytesIO(audio)) as w:
            params = w.getparams()
            frames = w.readframes(w.getnframes())
    except Exception:
        return audio, None
    sw, ch, sr = params.sampwidth, params.nchannels, params.framerate
    if sw != 2 or sr <= 0:
        return audio, None
    fb = sw * ch
    blk = int(sr * 0.1) * fb
    n = len(frames) // blk
    if n < 80:
        return audio, None
    dbs = [20 * math.log10(max(audioop.rms(frames[i * blk:(i + 1) * blk], sw), 1) / 32768.0) for i in range(n)]
    med = sorted(dbs)[n // 2]
    loud = [i for i in range(n) if dbs[i] > med - 6]
    if not loud:
        return audio, None
    last = loud[-1]
    if (n - last) * 0.1 > 12:              # ends early or fades out slowly — leave alone
        return audio, None
    quiet = next((i for i in range(last + 1, n) if dbs[i] < med - 30), n)
    if quiet - last > 5:                   # more than 0.5 s from loud to silence = already fading out
        return audio, None
    cut = min(quiet * blk, len(frames))
    fade = int(min(fade_s, last * 0.1 / 2) * sr) * fb
    start = max(0, cut - fade)
    out = bytearray(frames[:start])
    step = int(sr * 0.01) * fb
    pos = start
    while pos < cut:
        chunk = frames[pos:min(pos + step, cut)]
        t = (pos - start + len(chunk) / 2) / float(cut - start)
        out += audioop.mul(chunk, sw, math.cos(t * math.pi / 2) ** 2)
        pos += step
    out += b"\0" * min(int(tail_s * sr) * fb, len(frames) - cut)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(ch)
        w.setsampwidth(sw)
        w.setframerate(sr)
        w.writeframes(bytes(out))
    return buf.getvalue(), {"schnitt_vor_ende_s": round((n - quiet) * 0.1, 1),
                            "ausblende_s": round((cut - start) / float(fb * sr), 1),
                            "stille_gekuerzt_s": round(max(0.0, (len(frames) - cut) / float(fb * sr) - tail_s), 1)}


# =============================================================================
# Finishing (since 3.2): author, watermark, tags, cover, export
# =============================================================================
# Every generated song gets a cover, tags, a copy-protection watermark and the owner's copyright notice.
# Because the program is distributed, rights details (copyright etc.) must be configurable.
#
# 🔑 That is why there is NO name in the code. The details belong to THIS Mac (bridge.json →
#    "rights"), can be set in Manuwave Studio under ⚙️, and on first run the bridge enters the
#    full name of the Mac account as rights holder.
# 🔑 The watermark (audiowmark, with its own key) is INAUDIBLE and survives MP3, resampling and
#    cutting — it does not prevent copying (no playable file can), but it PROVES provenance:
#    whoever holds the key can read from any copy which track it is.
#    Tags, by contrast, can be deleted by anyone.
# 🔑 The cover is painted by an image model on the Mac (Ollama, e.g. FLUX.2 klein) — like the
#    brief, no cloud. If it is missing, the track stays without a cover instead of failing.

TOOLS_BIN = os.path.join(DIR, "tools", "bin")
WM_KEY = os.path.join(DIR, "wasserzeichen.key")      # 0600 — without it no mark can be read any more
WM_REG = os.path.join(DIR, "wasserzeichen.json")     # ID → title, file, rights holder
ORIG_DIR = os.path.join(RENDERS, "_original_vor_wasserzeichen")
WM_MAGIC = "4e4601"                                  # "NF", version 1
# 🔴 3.5: Strength 10 (audiowmark default) was only 22 dB below the music in the 1.5–3 kHz range — audible
#    as crackling that sounds like a decoding error, even in quiet passages. Strength 3: 32 dB below,
#    and still readable as measured after MP3 320/128, after +10 dB bass/+9 dB treble + limiter + 44.1 kHz + MP3 192
#    (value 2.4 at threshold 0.7). Changeable in bridge.json as "wm_strength".
WM_STRENGTH = 3
AUFBEREITET_V = 2       # version of the archive processing (adeclip if clipped + quiet mark + 24 bit)
TAGS_VERSION = 1
CAPS = "settings,export,cover,verify,nachruesten,archiv,master,loeschen,paket,web,master_merken,midi,weiter,analyse,writer,presets,dynamik"


def caps_for(cfg: dict) -> str:
    """What this bridge can do — "web" only if an elevator-music manager is configured."""
    return CAPS if (cfg.get("web_admin") or "").strip() else CAPS.replace(",web", "")

RIGHTS_DEFAULTS = {
    "owner": "",            # rights holder — empty: full name of the Mac account (entered on first run)
    "artist": "",           # artist name — empty: the rights holder
    "copyright": "© {jahr} {inhaber}. Alle Rechte vorbehalten.",
    "album": "",            # empty: every track is a single (album = title)
    "label": "",
    "website": "",
    "ai_note": True,        # machine-readable "AI-generated" note in the tags
    "watermark": True,
    "cover": True,
    "cover_title": True,    # the title as lettering on the cover (FLUX.2 klein renders text cleanly)
    "cover_artist": True,   # 3.3: the artist name as fixed lettering at the bottom of the cover (only if one is set)
}
RIGHTS_TEXT = {"owner": 120, "artist": 120, "copyright": 200, "album": 120, "label": 120, "website": 200}
RIGHTS_BOOL = ("ai_note", "watermark", "cover", "cover_title", "cover_artist")

# Preferred image models (Ollama, macOS only). Both Apache 2.0 — the images may be sold.
IMAGE_PREFER = ("x/flux2-klein:4b", "x/flux2-klein", "x/z-image-turbo")

# Output formats. Everything except MP3 is lossless. 🔴 APE (Monkey's Audio), WMA Lossless,
# OptimFROG and TAK are deliberately missing: ffmpeg has no encoder for them.
FORMATS = {
    # 3.4: MP3 and AIFF get their ID3 block from US (id3v23) — ffmpeg wrote lyrics and comment
    #      as TXXX:USLT / TXXX:comment, which no player reads (measured: Apple "lyrics: nil").
    "mp3":     {"ext": "mp3",  "mime": "audio/mpeg",     "name": "MP3 · 320 kbit/s", "tags": "id3",
                "args": ["-c:a", "libmp3lame", "-b:a", "320k", "-write_id3v2", "0", "-write_id3v1", "0"]},
    "flac":    {"ext": "flac", "mime": "audio/flac",     "name": "FLAC", "tags": "ffmpeg",
                "args": ["-c:a", "flac", "-compression_level", "8"], "s16": ["-sample_fmt", "s16"],
                "s24": ["-sample_fmt", "s32", "-bits_per_raw_sample", "24"]},
    "alac":    {"ext": "m4a",  "mime": "audio/mp4",      "name": "Apple Lossless (ALAC)", "tags": "ffmpeg",
                "args": ["-c:a", "alac"], "s16": ["-sample_fmt", "s16p"],
                "s24": ["-sample_fmt", "s32p", "-bits_per_raw_sample", "24"]},
    "wav":     {"ext": "wav",  "mime": "audio/wav",      "name": "WAV", "tags": "wav",
                "args": [], "s16": ["-c:a", "pcm_s16le"], "s24": ["-c:a", "pcm_s24le"]},
    "aiff":    {"ext": "aiff", "mime": "audio/aiff",     "name": "AIFF", "tags": "aiff",
                "args": ["-write_id3v2", "0"], "s16": ["-c:a", "pcm_s16be"], "s24": ["-c:a", "pcm_s24be"]},
    "wavpack": {"ext": "wv",   "mime": "audio/x-wavpack", "name": "WavPack", "tags": "ape",
                "args": ["-c:a", "wavpack"], "s16": ["-sample_fmt", "s16p"],
                "s24": ["-sample_fmt", "s32p", "-bits_per_raw_sample", "24"]},
    "tta":     {"ext": "tta",  "mime": "audio/x-tta",    "name": "TTA (True Audio)", "tags": "ape",
                "args": ["-c:a", "tta"], "s16": ["-sample_fmt", "s16"],
                "s24": ["-sample_fmt", "s32", "-bits_per_raw_sample", "24"]},
}
RATES = (0, 44100, 48000)   # 0 = same as the original (48 kHz)

_cfg_lock = threading.Lock()
_reg_lock = threading.Lock()


def save_config_locked(cfg: dict) -> None:
    with _cfg_lock:
        save_config(cfg)


def _account_name() -> str:
    try:
        return subprocess.run(["id", "-F"], capture_output=True, text=True, timeout=3).stdout.strip()[:120]
    except Exception:
        return ""


def rights(cfg: dict) -> dict:
    r = dict(RIGHTS_DEFAULTS)
    r.update({k: v for k, v in (cfg.get("rights") or {}).items() if k in RIGHTS_DEFAULTS})
    if not str(r.get("owner") or "").strip():
        name = _account_name()
        if name:
            r["owner"] = name
            cfg["rights"] = r
            save_config_locked(cfg)
            log("Rechteinhaber eingetragen: %s (änderbar in Manuwave Studio › ⚙️)" % name)
    return r


def clean_rights(raw) -> dict:
    out = {}
    if not isinstance(raw, dict):
        return out
    for k, limit in RIGHTS_TEXT.items():
        v = raw.get(k)
        if isinstance(v, str):
            out[k] = re.sub(r"[\x00-\x1f]+", " ", v).strip()[:limit]
    for k in RIGHTS_BOOL:
        if isinstance(raw.get(k), bool):
            out[k] = raw[k]
    return out


def engine_binary(cfg: dict) -> str:
    """ace-server: macOS/Linux build/ace-server, Windows (MSVC) build/Release/ace-server.exe, prebuilt packages build/bin/."""
    root = os.path.join(cfg["engine_dir"], "build")
    for p in (os.path.join(root, "ace-server" + EXE), os.path.join(root, "Release", "ace-server" + EXE),
              os.path.join(root, "bin", "ace-server" + EXE), os.path.join(root, "bin", "Release", "ace-server" + EXE)):
        if os.path.isfile(p) and os.access(p, os.X_OK):
            return p
    return ""


def img_to_jpeg(cfg: dict, src: str, dst: str, size: int, quality: int, square: bool = False) -> None:
    """Image → JPEG. macOS: sips (built in). Otherwise ffmpeg. size = longest edge (square: exactly size × size)."""
    if IS_MAC:
        dim = ["-z", str(size), str(size)] if square else ["-Z", str(size)]
        _run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", str(quality), *dim, src, "--out", dst], timeout=120)
        return
    ff = tool(cfg, "ffmpeg")
    if not ff:
        raise RuntimeError("ffmpeg fehlt — Cover lässt sich nicht umwandeln")
    vf = ("scale=%d:%d:flags=lanczos" % (size, size)) if square else \
        ("scale='if(gt(iw,ih),%d,-2)':'if(gt(iw,ih),-2,%d)':flags=lanczos" % (size, size))
    q = max(2, min(31, int(round(31 - quality * 0.29))))          # 88 → q≈5, 92 → q≈4
    _run([ff, "-v", "error", "-y", "-i", src, "-frames:v", "1", "-vf", vf, "-q:v", str(q), dst], timeout=120)


def media_seconds(cfg: dict, path: str) -> float:
    """Duration of an audio file. macOS: afinfo; otherwise ffprobe (or ffmpeg)."""
    if IS_MAC and os.path.exists("/usr/bin/afinfo"):
        out = subprocess.run(["/usr/bin/afinfo", path], capture_output=True, text=True, timeout=60).stdout
        m = re.search(r"estimated duration:\s*([\d.]+)", out)
        if m:
            return float(m.group(1))
    fp = tool(cfg, "ffprobe")
    if fp:
        out = subprocess.run([fp, "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path],
                             capture_output=True, text=True, timeout=60).stdout.strip()
        try:
            return float(out)
        except ValueError:
            pass
    return 0.0


def tool(cfg: dict, name: str) -> str:
    """Path of a tool — launchd starts us with an almost empty PATH, so search explicitly."""
    for c in (cfg.get("tool_" + name) or "", os.path.join(TOOLS_BIN, name + EXE),
              "/opt/homebrew/bin/" + name, "/usr/local/bin/" + name):
        if c and os.path.isfile(c) and os.access(c, os.X_OK):
            return c
    import shutil
    return shutil.which(name) or ""


IMG_DIR = os.path.join(DIR, "tools", "ollama-bild")


def img_dir(cfg: dict) -> str:
    return cfg.get("image_dir") or IMG_DIR


def image_models(cfg: dict) -> list:
    """Image models in the own model folder — detected via the manifest, without a running server
    (the bridge asks this on every poll, every ~25 s)."""
    root = os.path.join(img_dir(cfg), "models", "manifests", "registry.ollama.ai")
    out = []
    for dp, _, fs in os.walk(root):
        for f in fs:
            rel = os.path.relpath(os.path.join(dp, f), root).split(os.sep)
            if len(rel) == 3:
                out.append("%s/%s:%s" % tuple(rel))
            elif len(rel) == 2:
                out.append("%s:%s" % tuple(rel))
    return sorted(out)


# ---- 3.11: Cover on Windows/Linux — stable-diffusion.cpp (sd-server) with Z-Image Turbo (Apache-2.0) ----
# Ollama can no longer do images as of 0.32.6, and 0.32.5 only painted on macOS (MLX). On Windows/Linux
# sd-server (leejet/stable-diffusion.cpp, MIT) therefore paints — the installer places the files
# in tools/sd and models/sd:
#   z_image_turbo-Q4_K.gguf (leejet/Z-Image-Turbo-GGUF) · ae.safetensors (FLUX.1-schnell-VAE, Apache-2.0)
#   Qwen3-4B-Instruct-2507-Q4_K_M.gguf (unsloth, Apache-2.0)
SD_DIR = os.path.join(DIR, "tools", "sd")
SD_MODELS = os.path.join(DIR, "models", "sd")
SD_FILES = {"diffusion": "z_image_turbo-Q4_K.gguf", "vae": "ae.safetensors", "llm": "Qwen3-4B-Instruct-2507-Q4_K_M.gguf"}
SD_LABEL = "z-image-turbo (stable-diffusion.cpp)"


def image_backend(cfg: dict) -> str:
    b = (cfg.get("image_backend") or "").strip()
    return b if b in ("ollama", "sdcpp") else ("ollama" if IS_MAC else "sdcpp")


def sd_binary(cfg: dict) -> str:
    for p in (os.path.join(SD_DIR, "sd-server" + EXE), os.path.join(SD_DIR, "bin", "sd-server" + EXE)):
        if os.path.isfile(p) and os.access(p, os.X_OK):
            return p
    return ""


def find_image_model(cfg: dict) -> str:
    if image_backend(cfg) == "sdcpp":
        ok = sd_binary(cfg) and all(os.path.isfile(os.path.join(SD_MODELS, f)) for f in SD_FILES.values())
        return SD_LABEL if ok else ""
    if not os.access(os.path.join(img_dir(cfg), "ollama"), os.X_OK):
        return ""
    names = image_models(cfg)
    want = (cfg.get("image_model") or "").strip()
    if want and want in names:
        return want
    for pre in IMAGE_PREFER:
        hit = [n for n in names if n == pre or n.startswith(pre + ":")]
        if hit:
            return hit[0]
    return ""


class ImageServer:
    """Starts the image Ollama only for the duration of one cover and cleans up afterwards.
    🔴 OLLAMA_NOPRUNE: an Ollama removes "unused" blobs on startup — harmless in its own
       folder (hardlinks), but never risk it. An orphan from the last run
       (bridge crashed) is terminated via the PID file before a new one starts."""
    def __init__(self, cfg):
        self.dir = img_dir(cfg)
        self.port = int(cfg.get("image_port") or 11439)
        # one PID file per port: a test rig (other port, same folder) must never hit the real
        # service's image server when cleaning up
        self.PID = os.path.join(self.dir, "serve-%d.pid" % self.port)
        self.url = "http://127.0.0.1:%d" % self.port
        self.proc = None

    def kill_orphan(self):
        try:
            pid = int(open(self.PID).read().strip())
            cmd = subprocess.run(["ps", "-o", "command=", "-p", str(pid)], capture_output=True, text=True).stdout
            if "ollama-bild" in cmd:
                os.kill(pid, 15)
                time.sleep(1)
        except (OSError, ValueError):
            pass
        try:
            os.remove(self.PID)
        except OSError:
            pass

    def __enter__(self):
        # Audit 3.2: two processes (service + terminal) share port and PID file — one after the other
        self.lock = FileLock("bild-server").__enter__()
        self.kill_orphan()
        env = dict(os.environ, OLLAMA_HOST="127.0.0.1:%d" % self.port, OLLAMA_MODELS=os.path.join(self.dir, "models"),
                   OLLAMA_NOPRUNE="1", OLLAMA_KEEP_ALIVE="0")
        logf = open(os.path.join(self.dir, "serve-%d.log" % self.port), "ab")
        self.proc = subprocess.Popen([os.path.join(self.dir, "ollama"), "serve"], env=env,
                                     stdout=logf, stderr=logf, stdin=subprocess.DEVNULL)
        logf.close()
        with open(self.PID, "w") as f:
            f.write(str(self.proc.pid))
        for _ in range(60):
            try:
                with urllib.request.urlopen(self.url + "/api/version", timeout=2) as r:
                    if r.status == 200:
                        return self
            except Exception:
                pass
            if self.proc.poll() is not None:
                break
            time.sleep(0.5)
        self.__exit__()
        raise RuntimeError("Bild-Server startet nicht (Port %d belegt?)" % self.port)

    def __exit__(self, *exc):
        try:
            if self.proc and self.proc.poll() is None:
                self.proc.terminate()
                try:
                    self.proc.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    self.proc.kill()
            try:
                os.remove(self.PID)
            except OSError:
                pass
        finally:
            if getattr(self, "lock", None):
                self.lock.__exit__()
                self.lock = None
        return False

    def cleanup_at_start(self):
        """On bridge start: terminate an orphan — but only if NOBODY is painting right now
        (otherwise it would hit the terminal "--nachruesten" in the middle of an image)."""
        with FileLock("bild-server", blocking=False) as l:
            if l.held:
                self.kill_orphan()


class SdServer:
    """sd-server only for the duration of one cover (like ImageServer). Speaks the A1111-compatible interface."""

    def __init__(self, cfg):
        self.cfg = cfg
        self.port = int(cfg.get("sd_port") or 11441)
        self.url = "http://127.0.0.1:%d" % self.port
        self.proc = None

    def __enter__(self):
        self.lock = FileLock("bild-server").__enter__()
        m = lambda k: os.path.join(SD_MODELS, SD_FILES[k])
        args = [sd_binary(self.cfg), "--diffusion-model", m("diffusion"), "--vae", m("vae"), "--llm", m("llm"),
                "--cfg-scale", "1.0", "--steps", "8", "--offload-to-cpu", "--listen-ip", "127.0.0.1", "--listen-port", str(self.port)]
        logf = open(os.path.join(DIR, "sd-server.log"), "ab")
        self.proc = subprocess.Popen(args, stdout=logf, stderr=logf, stdin=subprocess.DEVNULL)
        logf.close()
        for _ in range(240):                      # loading models takes a while — up to 2 minutes
            try:
                with urllib.request.urlopen(self.url + "/sdapi/v1/sd-models", timeout=2) as r:
                    if r.status == 200:
                        return self
            except urllib.error.HTTPError:
                return self                       # responds = running (the path does not exist in every version)
            except Exception:
                pass
            if self.proc.poll() is not None:
                break
            time.sleep(0.5)
        self.__exit__()
        raise RuntimeError("sd-server startet nicht — siehe %s" % os.path.join(DIR, "sd-server.log"))

    def generate(self, prompt: str, seed: int) -> str:
        """→ PNG as base64. First /sdapi/v1/txt2img, otherwise OpenAI-style /v1/images/generations."""
        tries = [("/sdapi/v1/txt2img", {"prompt": prompt, "width": 1024, "height": 1024, "steps": 8, "cfg_scale": 1.0, "seed": seed},
                  lambda a: (a.get("images") or [None])[0]),
                 ("/v1/images/generations", {"prompt": prompt, "size": "1024x1024", "n": 1, "response_format": "b64_json", "seed": seed},
                  lambda a: ((a.get("data") or [{}])[0]).get("b64_json"))]
        last = None
        for path, body, pick in tries:
            req = urllib.request.Request(self.url + path, data=json.dumps(body).encode(), method="POST",
                                         headers={"Content-Type": "application/json"})
            try:
                with urllib.request.urlopen(req, timeout=900) as r:
                    b64 = pick(json.loads(r.read()))
                if b64:
                    return b64.split(",", 1)[-1] if b64.startswith("data:") else b64
            except urllib.error.HTTPError as e:
                last = e
                if e.code not in (404, 405):
                    raise
        raise RuntimeError("sd-server lieferte kein Bild (%s)" % last)

    def __exit__(self, *exc):
        try:
            if self.proc and self.proc.poll() is None:
                self.proc.terminate()
                try:
                    self.proc.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    self.proc.kill()
        finally:
            if getattr(self, "lock", None):
                self.lock.__exit__()
                self.lock = None
        return False


def tools_state(cfg: dict) -> dict:
    return {"ffmpeg": bool(tool(cfg, "ffmpeg")), "audiowmark": bool(tool(cfg, "audiowmark")),
            "key": os.path.isfile(WM_KEY), "image_model": find_image_model(cfg),
            "writer": find_writer(cfg), "midi": bool(midi_python())}


def _run(args, timeout=600):
    r = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError("%s: %s" % (os.path.basename(args[0]), (r.stderr or r.stdout).strip()[-300:]))
    return r


class Scratch:
    """A working folder that disappears again even on errors."""

    def __enter__(self):
        import tempfile
        self.dir = tempfile.mkdtemp(prefix="mws-")
        return self

    def path(self, name):
        return os.path.join(self.dir, name)

    def __exit__(self, *exc):
        import shutil
        shutil.rmtree(self.dir, ignore_errors=True)
        return False


# ---- Watermark ----------------------------------------------------------------

def wm_key(cfg: dict) -> str:
    aw = tool(cfg, "audiowmark")
    if not aw:
        raise RuntimeError("audiowmark fehlt auf dem Mac — Wasserzeichen nicht möglich")
    if not os.path.isfile(WM_KEY):
        os.makedirs(DIR, exist_ok=True)
        with FileLock("wasserzeichen-schluessel"):
            if not os.path.isfile(WM_KEY):     # 🔴 never overwrite a key that is already in use
                _run([aw, "gen-key", WM_KEY, "--name", "manuwave"], timeout=30)
                log("Wasserzeichen-Schlüssel angelegt: %s — SICHERN, ohne ihn ist kein Zeichen mehr lesbar" % WM_KEY)
    os.chmod(WM_KEY, 0o600)
    return aw


def wm_payload(owner: str) -> str:
    """128 bits: ID NF+version · rights holder (4-byte hash) · time · random."""
    oid = hashlib.sha256(owner.strip().lower().encode("utf-8")).hexdigest()[:8]
    return WM_MAGIC + oid + "%08x" % (int(time.time()) & 0xFFFFFFFF) + secrets.token_hex(5)


def reg_load() -> dict:
    try:
        with open(WM_REG, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def reg_add(payload: str, info: dict) -> None:
    # Audit 3.2: service and "--nachruesten" both write to it — lock across processes
    with _reg_lock, FileLock("wasserzeichen-verzeichnis"):
        d = reg_load()
        d[payload] = info
        _write_atomic(WM_REG, json.dumps(d, indent=1, ensure_ascii=False).encode("utf-8"))
        os.chmod(WM_REG, 0o600)


def wm_strength(cfg: dict, dur: float = 180.0) -> int:
    """Strength by length: detection accumulates over the duration. 🔴 Measured: strength 3 suffices at 3.5 min
    even after +10 dB bass/+9 dB treble/limiter/44.1 kHz/MP3 192 (value 2.4), but not at 15 s
    (0.36 < 0.7). Hence strength 3 from 3 min, more below that (30 s → 10, 60 s → 6, 2 min → 4) — at most 10."""
    try:
        base = max(1, min(20, int(cfg.get("wm_strength") or WM_STRENGTH)))
    except (TypeError, ValueError):
        base = WM_STRENGTH
    # measured after harsh chain: 15 s/10 → 1.25 · 30 s/7 → 0.89 (too tight) · 60 s/5 → 1.93 · 120 s/4 → 3.76
    return max(base, min(10, int(round(base * (180.0 / max(float(dur or 180.0), 1.0)) ** 0.65))))


def _wav_seconds(audio: bytes) -> float:
    try:
        with wave.open(io.BytesIO(wav_plain(audio))) as w:
            return w.getnframes() / float(w.getframerate() or 1)
    except Exception:
        return 180.0


def wm_embed(cfg: dict, audio: bytes, info: dict, payload: str = ""):
    """→ (audio with mark, ID). info ends up in the registry (title, file …).
    payload: set an already assigned ID again (3.4: a repaired track stays the same)."""
    aw = wm_key(cfg)
    owner = rights(cfg)["owner"]
    payload = payload or wm_payload(owner)
    strength = wm_strength(cfg, _wav_seconds(audio))
    with Scratch() as s:
        src, dst = s.path("in.wav"), s.path("out.wav")
        with open(src, "wb") as f:
            f.write(audio)
        _run([aw, "add", "--quiet", "--key", WM_KEY, "--strength", str(strength), src, dst, payload], timeout=600)
        with open(dst, "rb") as f:
            out = wav_plain(f.read())
    # Never silently worse: format and length must stay, otherwise better without a mark.
    with wave.open(io.BytesIO(audio)) as a, wave.open(io.BytesIO(out)) as b:
        if a.getparams()[:4] != b.getparams()[:4]:
            raise RuntimeError("Wasserzeichen hat das Format verändert (%s → %s)" % (a.getparams()[:4], b.getparams()[:4]))
    reg_add(payload, dict(info, owner=owner, staerke=strength, at=datetime.datetime.now().isoformat(timespec="seconds")))
    return out, payload


def wm_detect(cfg: dict, path: str) -> dict:
    """Reads the mark from any audio file (ffmpeg turns it into WAV first)."""
    aw = wm_key(cfg)
    ff = tool(cfg, "ffmpeg")
    with Scratch() as s:
        wav = path
        if not path.lower().endswith(".wav") and ff:
            wav = s.path("in.wav")
            _run([ff, "-v", "error", "-y", "-i", path, "-vn", "-ac", "2", "-c:a", "pcm_s16le", wav], timeout=300)
        js = s.path("out.json")
        _run([aw, "get", "--quiet", "--key", WM_KEY, "--json", js, wav], timeout=600)
        with open(js, encoding="utf-8") as f:
            res = json.load(f)
    # audiowmark 0.6.5 writes, per hit, {"bits", "rating", "quality", "error", "type"} —
    # noise without a mark shows up there too (value ~0.15), so only the best counts.
    best, score = {}, 0.0
    for m in res.get("matches") or []:
        v = float(m.get("rating", m.get("quality", 0)) or 0)
        if v > score:
            best, score = m, v
    payload = str(best.get("bits") or "")
    # Measured: real marks 1.2–1.4 (even after MP3 96 kbit/s and trimming), without a mark
    # or with a foreign key 0.17. A hit only counts from 0.7 AND with our ID.
    found = score >= 0.7 and payload.startswith(WM_MAGIC)
    info = reg_load().get(payload) if found else None
    return {"found": found, "score": round(score, 3), "id": payload if found else "",
            "info": info or {}, "known": bool(info)}


# ---- Tags ---------------------------------------------------------------------

KEY_SHORT = {"major": "", "minor": "m", "dur": "", "moll": "m"}


def _short_key(k: str) -> str:
    m = re.match(r"^\s*([A-Ga-g])\s*([#b♯♭]?)\s*(major|minor|dur|moll)?\s*$", k or "", re.I)
    if not m:
        return (k or "").strip()[:8]
    acc = {"♯": "#", "♭": "b"}.get(m.group(2), m.group(2))
    return m.group(1).upper() + acc + KEY_SHORT.get((m.group(3) or "major").lower(), "")


def _sung_lines(lyrics: str) -> str:
    """Only the sung lines — markers like [Chorus] are dropped, paragraphs stay."""
    out, blank = [], False
    for line in (lyrics or "").splitlines():
        line = line.strip()
        if re.match(r"^\[.*\]$", line):
            blank = bool(out)
            continue
        if not line:
            blank = bool(out)
            continue
        if blank:
            out.append("")
        out.append(line)
        blank = False
    return "\n".join(out)


def _fill(template: str, year: str, owner: str, artist: str) -> str:
    out = template or ""
    for k, v in (("{jahr}", year), ("{year}", year), ("{inhaber}", owner), ("{owner}", owner),
                 ("{kuenstler}", artist), ("{künstler}", artist), ("{artist}", artist)):
        out = out.replace(k, v)
    return re.sub(r"\s{2,}", " ", out).strip()


def track_tags(cfg: dict, info: dict) -> dict:
    """info: title, variant, created (ISO), caption, lyrics, bpm, keyscale, seed."""
    r = rights(cfg)
    created = str(info.get("created") or datetime.date.today().isoformat())[:10]
    year = created[:4]
    owner = r["owner"].strip()
    artist = (r["artist"] or owner).strip()
    title = (info.get("title") or "Manuwave Studio").strip()
    if info.get("variant"):
        title += " (Version %s)" % info["variant"]
    first = (info.get("caption") or "").split(",")[0].strip()
    genre = " ".join(w[:1].upper() + w[1:] for w in first.split()) if first and len(first) < 40 else ""
    tags = {
        "title": title, "artist": artist, "album_artist": artist,
        "album": (r["album"] or (info.get("title") or "").strip() or title),
        "genre": genre, "date": created, "year": year,
        "copyright": _fill(r["copyright"], year, owner, artist),
        "publisher": r["label"], "website": r["website"],
        "encoded_by": "Manuwave Studio", "lyrics": _sung_lines(info.get("lyrics") or ""),
        "bpm": str(int(info["bpm"])) if str(info.get("bpm") or "").isdigit() and int(info["bpm"]) > 0 else "",
        "key": _short_key(info.get("keyscale") or ""),
        "comment": "",
    }
    if info.get("source") == "eigen":
        # 3.15: played in by hand — the music is not AI; only an AI cover is mentioned
        tags["encoded_by"] = "Manuwave Studio (selbst eingespielt)"
        if r["ai_note"]:
            tags["ai"] = "Musik selbst eingespielt in Manuwave Studio%s" % (
                ", Cover: KI-erzeugt (" + info["cover_model"] + ")" if info.get("cover_model") else "")
            tags["comment"] = tags["ai"]
    elif r["ai_note"]:
        tags["ai"] = "KI-erzeugt mit Manuwave Studio (Musik: ACE-Step 1.5%s)" % (
            ", Cover: " + info["cover_model"] if info.get("cover_model") else "")
        tags["comment"] = tags["ai"]
    return {k: v for k, v in tags.items() if v}


def _u16(s: str) -> bytes:
    return s.encode("utf-16")          # with BOM


def id3v23(tags: dict, cover: bytes = None) -> bytes:
    """ID3v2.3 by hand (UTF-16) — for WAV; the same fields ffmpeg writes into the MP3."""
    frames = []

    def frame(fid, body):
        frames.append(fid.encode() + struct.pack(">I", len(body)) + b"\0\0" + body)

    def text(fid, v):
        if v:
            frame(fid, b"\x01" + _u16(v))
    for fid, k in (("TIT2", "title"), ("TPE1", "artist"), ("TPE2", "album_artist"), ("TALB", "album"),
                   ("TCON", "genre"), ("TYER", "year"), ("TBPM", "bpm"), ("TKEY", "key"),
                   ("TCOP", "copyright"), ("TPUB", "publisher"), ("TENC", "encoded_by")):
        text(fid, tags.get(k, ""))
    if tags.get("website", "").startswith(("http://", "https://")):
        frame("WOAR", tags["website"].encode("latin-1", "replace"))
    if tags.get("comment"):
        frame("COMM", b"\x01deu" + _u16("") + b"\0\0" + _u16(tags["comment"]))
    if tags.get("lyrics"):
        frame("USLT", b"\x01xxx" + _u16("") + b"\0\0" + _u16(tags["lyrics"]))
    if tags.get("ai"):
        frame("TXXX", b"\x01" + _u16("AI_GENERATED") + b"\0\0" + _u16(tags["ai"]))
    if cover:
        frame("APIC", b"\x00image/jpeg\x00\x03\x00" + cover)
    body = b"".join(frames)
    n = len(body)
    size = bytes([(n >> 21) & 0x7F, (n >> 14) & 0x7F, (n >> 7) & 0x7F, n & 0x7F])
    return b"ID3\x03\x00\x00" + size + body


def _chunk(cid: bytes, data: bytes) -> bytes:
    return cid + struct.pack("<I", len(data)) + data + (b"\0" if len(data) % 2 else b"")


def wav_with_tags(audio: bytes, tags: dict, cover: bytes = None) -> bytes:
    """WAV: old tags out, LIST/INFO (Windows, DAWs) + id3 block (music apps) in."""
    if audio[:4] != b"RIFF" or audio[8:12] != b"WAVE":
        raise RuntimeError("keine WAV-Datei")
    pos, keep = 12, []
    while pos + 8 <= len(audio):
        cid = audio[pos:pos + 4]
        size = struct.unpack("<I", audio[pos + 4:pos + 8])[0]
        end = min(len(audio), pos + 8 + size + (size % 2))      # including pad byte
        if cid not in (b"LIST", b"id3 ", b"ID3 "):
            part = audio[pos:end]
            if len(part) % 2:
                part += b"\0"
            keep.append(part)
        pos = end
    info = b""
    for cid, k in ((b"INAM", "title"), (b"IART", "artist"), (b"IPRD", "album"), (b"IGNR", "genre"),
                   (b"ICRD", "date"), (b"ICOP", "copyright"), (b"ICMT", "comment"), (b"ISFT", "encoded_by")):
        if tags.get(k):
            info += _chunk(cid, tags[k].encode("utf-8") + b"\0")
    body = b"WAVE" + b"".join(keep)
    if info:
        body += _chunk(b"LIST", b"INFO" + info)
    body += _chunk(b"id3 ", id3v23(tags, cover))
    return b"RIFF" + struct.pack("<I", len(body)) + body


def apev2(tags: dict, cover: bytes = None) -> bytes:
    """APEv2 by hand — for WavPack and TTA, which ffmpeg writes without a cover."""
    items = []

    def item(key, val, binary=False):
        items.append(struct.pack("<II", len(val), 2 if binary else 0) + key.encode("ascii") + b"\0" + val)
    for key, k in (("Title", "title"), ("Artist", "artist"), ("Album Artist", "album_artist"), ("Album", "album"),
                   ("Genre", "genre"), ("Year", "date"), ("BPM", "bpm"), ("Key", "key"), ("Copyright", "copyright"),
                   ("Publisher", "publisher"), ("Comment", "comment"), ("Lyrics", "lyrics"),
                   ("Encoded By", "encoded_by"), ("AI_GENERATED", "ai")):
        if tags.get(k):
            item(key, tags[k].encode("utf-8"))
    if tags.get("website"):
        item("Weblink", tags["website"].encode("utf-8"))
    if cover:
        item("Cover Art (Front)", b"cover.jpg\0" + cover, binary=True)
    body = b"".join(items)
    size = len(body) + 32

    def hf(flags):
        return b"APETAGEX" + struct.pack("<IIII", 2000, size, len(items), flags) + b"\0" * 8
    return hf(0xA0000000) + body + hf(0x80000000)


# ---- Cover --------------------------------------------------------------------

COVER_SYSTEM = """You write ONE prompt for an image model that paints album cover art.
Read the song (title, style tags, lyrics, producer note) and invent a single striking, specific
visual scene that captures its theme and mood — one clear focal subject, a setting, light and colour
palette, and an art style that suits the music (e.g. cinematic photo, analog film still, neon-lit
illustration, oil painting, minimal graphic). 35 to 70 words, English, one paragraph.
Describe ONLY what can be SEEN. Never mention sounds, music, beats, bass, instruments being played,
genres or mixing — an image model cannot paint them.
Avoid anything that usually carries writing: signs, neon signs, billboards, posters, screens,
books, labels, number plates. Never ask for text, letters, titles, logos or watermarks."""
COVER_SCHEMA = {"type": "object", "properties": {"prompt": {"type": "string"}}, "required": ["prompt"]}
COVER_SUFFIX = (" Square album cover composition, high detail, professional artwork. "
                "No text, no letters, no typography, no logo, no watermark.")
# 🔑 Measured 12.10.2026: without a title the image model invents signs with pseudo-lettering (made-up words);
#    WITH the real title as typography it wrote a three-word title twice without error
#    and left the signs out. Only for titles it writes reliably: Latin capitals,
#    digits, few characters — umlauts and long titles stay without lettering.
COVER_TITLE_OK = re.compile(r"^[A-Z0-9][A-Z0-9 '&!?.,-]{0,31}$")
COVER_TITLE = (" The title \"%s\" appears once at the top in clean, elegant album-cover typography."
               " Square album cover composition, high detail, professional artwork."
               " No other text, no signs, no logo, no watermark.")


def cover_title(info: dict, r: dict) -> str:
    t = re.sub(r"\s+", " ", (info.get("title") or "")).strip().upper()
    return t if r.get("cover_title", True) and COVER_TITLE_OK.match(t) else ""


# 🔴 Measured 12.10.2026: despite the instruction, qwen2.5:7b wrote "neon signs" and "rumbling bass" into
#    the scene — and FLUX painted pseudo-lettering on the signs (made-up words). So filter hard here:
#    lettering carriers become light, sound words are dropped.
TEXT_CARRIERS = re.compile(r"\b(?:neon\s+)?(?:signs?|signboards?|billboards?|posters?|banners?|placards?|"
                           r"screens?|labels?|books?|newspapers?|number\s+plates?|license\s+plates?)\b", re.I)
SOUND_WORDS = re.compile(r"\b(?:rumbling|thumping|pulsing|echoing|humming|beats?|basslines?|sub-?bass|bass|"
                         r"hi-?hats?|drums?|melod(?:y|ies)|music(?:al)?|sounds?|rhythm(?:ic)?|songs?)\b", re.I)


def scrub_prompt(p: str) -> str:
    p = TEXT_CARRIERS.sub("neon glow", p)
    p = SOUND_WORDS.sub("", p)
    p = re.sub(r"\s+([,.])", r"\1", re.sub(r"\s{2,}", " ", p))
    return re.sub(r"(,\s*){2,}", ", ", p).strip()


def cover_scene(cfg: dict, info: dict) -> str:
    """The scene (without lettering instruction) — from the language model, otherwise from the style tags."""
    title = (info.get("title") or "").strip()
    caption = (info.get("caption") or "").strip()
    lyr = _sung_lines(info.get("lyrics") or "")
    writer = find_writer(cfg)
    if writer:
        user = "Title: %s\nStyle tags: %s\nLyrics (excerpt): %s\nProducer note: %s" % (
            title, caption[:600], "\n".join(lyr.splitlines()[:10]) or "(instrumental)",
            (info.get("note") or "")[:500])
        body = {"model": writer, "stream": False, "format": COVER_SCHEMA,
                "messages": [{"role": "system", "content": COVER_SYSTEM}, {"role": "user", "content": user}],
                "options": {"temperature": 0.8, "num_ctx": 4096}}
        try:
            p = json.loads(writer_chat(cfg, body, 120).get("message", {}).get("content") or "{}").get("prompt", "")
            p = scrub_prompt(re.sub(r"\s+", " ", str(p)).strip())
            if 40 <= len(p) <= 900:
                return p.rstrip(".") + "."
        except Exception as e:  # noqa: BLE001
            log("Cover-Beschreibung vom Sprachmodell fehlgeschlagen (%s) — nehme die Stil-Tags" % e)
    tags = scrub_prompt(", ".join(t.strip() for t in caption.split(",")[:8] if t.strip()))
    return ("Atmospheric album cover artwork, mood: %s. Cinematic lighting, rich colours, evocative "
            "scene." % (tags or "dreamy, nocturnal"))


def cover_prompt(cfg: dict, info: dict) -> str:
    shown = cover_title(info, rights(cfg))
    return cover_scene(cfg, info) + ((COVER_TITLE % shown) if shown else COVER_SUFFIX)


# 🔴 Measured 12.10.2026 on a real archive: a two-word title came back misspelled in several variants
#    — the image model misspells longer words. A wrong title on the
#    cover is worse than none. So the macOS text recognition (Vision, OCR helper) reads every
#    image: with a title only the EXACT title counts, without a title at most 3 characters of pseudo-lettering.
def _letters(t: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (t or "").upper())


NF_OCR_SWIFT = r'''// Manuwave Studio: reads text from an image (macOS Vision framework, local only).
// Output: JSON list of the recognized lines. Used to check the title lettering on AI-generated covers.
import Foundation
import Vision
import AppKit

guard CommandLine.arguments.count > 1,
      let img = NSImage(contentsOfFile: CommandLine.arguments[1]),
      let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    print("[]"); exit(1)
}
let req = VNRecognizeTextRequest()
req.recognitionLevel = .accurate
req.usesLanguageCorrection = false          // do NOT autocorrect — we want to see what is really there
try? VNImageRequestHandler(cgImage: cg, options: [:]).perform([req])
let lines = (req.results ?? []).compactMap { $0.topCandidates(1).first?.string }
let data = try! JSONSerialization.data(withJSONObject: lines, options: [])
print(String(data: data, encoding: .utf8)!)
'''
NF_STEMPEL_SWIFT = r'''// Manuwave Studio: stamps the artist name as fixed lettering at the bottom center of the cover (local only, AppKit).
// Usage: nf-stempel in.jpg out.jpg "NAME". The image model does not always spell correctly — this lettering always does.
import Foundation
import AppKit

let a = CommandLine.arguments
guard a.count > 3, let img = NSImage(contentsOfFile: a[1]),
      let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { exit(1) }
let w = cg.width, h = cg.height
let W = CGFloat(w), H = CGFloat(h)
let srgb = CGColorSpace(name: CGColorSpace.sRGB)!
guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: srgb,
                          bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { exit(1) }
ctx.draw(cg, in: CGRect(x: 0, y: 0, width: W, height: H))
// A soft dark gradient at the bottom keeps the lettering readable on any artwork
let grad = CGGradient(colorsSpace: srgb, colors: [CGColor(red: 0, green: 0, blue: 0, alpha: 0.5),
                                                   CGColor(red: 0, green: 0, blue: 0, alpha: 0)] as CFArray,
                      locations: [0, 1])!
ctx.drawLinearGradient(grad, start: CGPoint(x: 0, y: 0), end: CGPoint(x: 0, y: H * 0.18), options: [])
NSGraphicsContext.current = NSGraphicsContext(cgContext: ctx, flipped: false)
var size = H * 0.034
func styled(_ size: CGFloat) -> NSAttributedString {
    let font = NSFont(name: "AvenirNext-DemiBold", size: size) ?? NSFont.systemFont(ofSize: size, weight: .semibold)
    let shadow = NSShadow()
    shadow.shadowColor = NSColor(white: 0, alpha: 0.75)
    shadow.shadowBlurRadius = size * 0.4
    shadow.shadowOffset = .zero
    return NSAttributedString(string: a[3], attributes: [.font: font, .foregroundColor: NSColor(white: 1, alpha: 0.94),
                                                         .kern: size * 0.38, .shadow: shadow])
}
var s = styled(size)
while s.size().width > W * 0.84 && size > 8 { size *= 0.92; s = styled(size) }
let x = (W - s.size().width + size * 0.38) / 2      // the letter-spacing also trails after the last letter
s.draw(at: NSPoint(x: x, y: H * 0.045))
NSGraphicsContext.current = nil
guard let out = ctx.makeImage(),
      let data = NSBitmapImageRep(cgImage: out).representation(using: .jpeg, properties: [.compressionFactor: 0.9])
else { exit(1) }
do { try data.write(to: URL(fileURLWithPath: a[2]), options: .atomic) } catch { exit(1) }
'''
_built = {}


def _swift_tool(cfg: dict, name: str, source: str) -> str:
    """Small macOS tools belong to Manuwave Studio: if one is missing, the bridge builds it once itself (swiftc)."""
    path = tool(cfg, name)
    if path or _built.get(name):
        return path
    _built[name] = True
    swiftc = "/usr/bin/swiftc" if os.path.exists("/usr/bin/swiftc") else ""
    if not swiftc:
        return ""
    try:
        os.makedirs(TOOLS_BIN, exist_ok=True)
        with Scratch() as s:
            src = s.path(name + ".swift")
            with open(src, "w", encoding="utf-8") as f:
                f.write(source)
            _run([swiftc, "-O", "-o", os.path.join(TOOLS_BIN, name), src], timeout=300)
        log("Werkzeug %s gebaut (%s)" % (name, TOOLS_BIN))
    except Exception as e:  # noqa: BLE001
        log("Werkzeug %s nicht baubar (%s)" % (name, e))
    return tool(cfg, name)


def ensure_ocr(cfg: dict) -> str:
    return _swift_tool(cfg, "nf-ocr", NF_OCR_SWIFT)


def cover_text(cfg: dict, jpeg: bytes):
    """→ List of recognized lines, or None if no text recognition is available."""
    ocr = ensure_ocr(cfg)
    if not ocr:
        return None
    with Scratch() as s:
        f = s.path("c.jpg")
        with open(f, "wb") as fh:
            fh.write(jpeg)
        try:
            out = subprocess.run([ocr, f], capture_output=True, text=True, timeout=60).stdout
            lines = json.loads(out or "[]")
            return [str(x) for x in lines] if isinstance(lines, list) else None
        except Exception:
            return None


def cover_text_ok(lines, shown: str) -> bool:
    if lines is None:
        return True                       # without text recognition: as before
    seen = _letters(" ".join(lines))
    return seen == _letters(shown) if shown else len(seen) <= 3


def make_cover(cfg: dict, info: dict, tick=None) -> dict:
    """→ {"jpeg", "prompt", "model", "s", "text", "text_ok", "tries"}. Raises if no image model is available."""
    model = find_image_model(cfg)
    if not model:
        raise RuntimeError("Kein Bildmodell installiert (macOS: tools/ollama-bild mit x/flux2-klein:4b, "
                           "Windows/Linux: tools/sd + models/sd) — den Installer erneut ausführen")
    t0 = time.monotonic()
    if tick:
        tick("Cover: Motiv wird beschrieben …")
    scene = cover_scene(cfg, info)
    shown = cover_title(info, rights(cfg))
    base_seed = int(info.get("seed") or 0) % 2147483647 or random.randint(1, 2147483646)
    # First twice with the title, then twice without lettering — the first image that passes the check wins.
    plan = ([shown, shown] if shown else []) + ["", ""]
    if not ensure_ocr(cfg):
        # 3.11: without text recognition (Windows/Linux) a misspelled title cannot be detected —
        #       so better no lettering at all on the image (the artist name is added, where possible, as an overlay)
        plan = [""]
    import base64
    best = None
    sd = image_backend(cfg) == "sdcpp"
    with (SdServer(cfg) if sd else ImageServer(cfg)) as img:
        for n, title in enumerate(plan):
            if tick:
                tick("Cover wird gemalt (%s)%s …" % (model, " — Versuch %d" % (n + 1) if n else ""))
            prompt = scene + ((COVER_TITLE % title) if title else COVER_SUFFIX)
            seed = (base_seed + 7919 * n) % 2147483647 or 1
            if sd:
                b64 = img.generate(prompt, seed)
            else:
                body = {"model": model, "prompt": prompt, "stream": False, "keep_alive": 0,
                        "width": 1024, "height": 1024, "options": {"seed": seed}}
                req = urllib.request.Request(img.url + "/api/generate", data=json.dumps(body).encode(),
                                             method="POST", headers={"Content-Type": "application/json"})
                with urllib.request.urlopen(req, timeout=900) as r:
                    ans = json.loads(r.read())
                b64 = ans.get("image") or (ans.get("images") or [None])[0]
            if not b64:
                raise RuntimeError("Das Bildmodell hat kein Bild geliefert")
            with Scratch() as s:
                src, dst = s.path("cover.png"), s.path("cover.jpg")
                with open(src, "wb") as f:
                    f.write(base64.b64decode(b64))
                # 1000 px, JPEG — small enough to fit into any file (macOS: sips, otherwise ffmpeg)
                img_to_jpeg(cfg, src, dst, 1000, 88)
                with open(dst, "rb") as f:
                    jpeg = f.read()
            if jpeg[:2] != b"\xff\xd8":
                raise RuntimeError("Cover ist kein JPEG")
            lines = cover_text(cfg, jpeg)
            ok = cover_text_ok(lines, title)
            best = {"jpeg": jpeg, "prompt": prompt, "model": model, "text": lines or [], "text_ok": ok,
                    "tries": n + 1, "title": title}
            if ok:
                break
            log("Cover-Schrift verworfen (%s): %s" % ("Titel „%s\"" % title if title else "ohne Schrift",
                                                    " / ".join(lines or [])[:80]))
    best["s"] = round(time.monotonic() - t0, 1)
    return best


# ---- Archive: find, refine -------------------------------------------------

def rel_home(path: str) -> str:
    """Path relative to ~ — between two REAL paths. 🔴 Found in the test bench 12.10.2026:
    archive_path() returns realpath (/private/var/…), HOME was /var/… (symlink) → relpath gave
    "../../../../private/var/…", the browser stored that, and the next export found nothing anymore.
    The same would hit a previous install folder that lives on another disk via symlink."""
    return os.path.relpath(os.path.realpath(path), os.path.realpath(HOME))


def archive_path(rel: str) -> str:
    """Path from the browser (relative to ~) → real file ONLY inside renders/."""
    if not isinstance(rel, str) or not rel.endswith(".wav"):
        return ""
    p = os.path.realpath(os.path.join(HOME, rel))
    root = os.path.realpath(RENDERS) + os.sep
    return p if p.startswith(root) and os.path.isfile(p) and os.sep + "_" not in p[len(root) - 1:] else ""


def _read_json(path: str) -> dict:
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def _read_bytes(path: str):
    try:
        with open(path, "rb") as f:
            return f.read()
    except OSError:
        return None


def _write_atomic(path: str, data: bytes) -> None:
    import tempfile
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".mws-", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise


def info_from_archive(wav_path: str, given: dict = None) -> dict:
    """What we know about a track: first its .json in the archive, then what the browser sends
    (the browser wins for the TITLE — that is where renaming happens)."""
    d = _read_json(wav_path[:-4] + ".json") if wav_path else {}
    req, meta, res = d.get("request") or {}, d.get("meta") or {}, d.get("result") or {}
    g = given or {}
    # A track is created on the day under which it sits in the archive — the browser only knows
    # the day IT received it (a different one after a move).
    m = re.search(r"/(\d{4}-\d{2}-\d{2})/", wav_path or "")
    created = m.group(1) if m else (g.get("created") or "")
    return {
        "title": g.get("title") or meta.get("title") or "",
        "variant": g.get("variant") if "variant" in g else meta.get("variant", ""),
        "note": g.get("note") or meta.get("note") or "",
        "caption": res.get("caption") or req.get("caption") or g.get("caption") or "",
        "lyrics": req.get("lyrics") or g.get("lyrics") or "",
        "bpm": res.get("bpm") or req.get("bpm") or g.get("bpm") or "",
        "keyscale": res.get("keyscale") or req.get("keyscale") or g.get("keyscale") or "",
        "seed": res.get("seed") if res.get("seed") is not None else (req.get("seed") or g.get("seed") or 0),
        "created": created,
        "cover_model": (d.get("cover") or {}).get("model", ""),
        "source": "eigen" if (meta.get("source") == "eigen" or g.get("source") == "eigen") else "",
    }


class FileLock:
    """Lock — also across processes (service + "--nachruesten" in the terminal). The key is the REAL
    path (audit 3.2: via a symlink the same file would have had two locks) or a name."""

    def __init__(self, key, blocking=True):
        # 3.11: Windows has no fcntl — there msvcrt.locking locks the first byte of the lock file
        if IS_WIN:
            import msvcrt
            self.fcntl, self.msvcrt = None, msvcrt
        else:
            import fcntl
            self.fcntl, self.msvcrt = fcntl, None
        self.blocking = blocking
        d = os.path.join(DIR, "locks")
        os.makedirs(d, exist_ok=True)
        if os.sep in key:
            key = os.path.realpath(key)
        self.lock = os.path.join(d, hashlib.sha1(key.encode("utf-8")).hexdigest()[:16] + ".lock")
        self.held = False

    def __enter__(self):
        self.fh = open(self.lock, "w")
        try:
            if self.msvcrt:
                while True:
                    try:
                        self.msvcrt.locking(self.fh.fileno(), self.msvcrt.LK_NBLCK, 1)
                        break
                    except OSError:
                        if not self.blocking:
                            raise
                        time.sleep(0.2)
            else:
                self.fcntl.flock(self.fh, self.fcntl.LOCK_EX | (0 if self.blocking else self.fcntl.LOCK_NB))
            self.held = True
        except OSError:
            self.held = False          # only with blocking=False: someone else holds it
        return self

    def __exit__(self, *exc):
        if self.held:
            if self.msvcrt:
                try:
                    self.fh.seek(0)
                    self.msvcrt.locking(self.fh.fileno(), self.msvcrt.LK_UNLCK, 1)
                except OSError:
                    pass
            else:
                self.fcntl.flock(self.fh, self.fcntl.LOCK_UN)
        self.fh.close()
        return False


def wav_plain(data: bytes) -> bytes:
    """24-bit WAV with the plain PCM header (format 1) instead of WAVE_FORMAT_EXTENSIBLE (65534).
    🔴 3.5: ffmpeg and audiowmark write the extended header from 24 bit on — the wave module of
    Python 3.9 (the bridge runs with /usr/bin/python3) does not know it: "unknown format: 65534"."""
    if data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        return data
    pos, out = 12, []
    while pos + 8 <= len(data):
        cid = data[pos:pos + 4]
        size = struct.unpack("<I", data[pos + 4:pos + 8])[0]
        body = data[pos + 8:pos + 8 + size]
        if cid == b"fmt " and len(body) >= 40 and struct.unpack("<H", body[:2])[0] == 0xFFFE \
                and struct.unpack("<H", body[24:26])[0] == 1:
            body = struct.pack("<H", 1) + body[2:16]
        out.append(cid + struct.pack("<I", len(body)) + body + (b"\0" if len(body) % 2 else b""))
        pos += 8 + size + (size % 2)
    rest = b"WAVE" + b"".join(out)
    return b"RIFF" + struct.pack("<I", len(rest)) + rest


def _clean_master_audio(cfg: dict, src: str, declip: bool, out: str) -> dict:
    """Original → (adeclip) → 1 dB headroom → 24 bit with triangular dither. → {"spitze_db", "pegel_db"}"""
    ff = tool(cfg, "ffmpeg")
    with Scratch() as s:
        fl = s.path("f.wav")
        _run([ff, "-v", "error", "-y", "-i", src] + (["-af", "adeclip"] if declip else []) + ["-c:a", "pcm_f32le", fl], timeout=900)
        # 🔴 NOT volumedetect: it computes in 16 bit and reports at most 0.0 dB — the reconstructed
        #    peaks lie above that (measured +1.47 dB), there would be too little headroom and new clipping.
        p = subprocess.run([ff, "-hide_banner", "-nostats", "-i", fl, "-af",
                            "astats=measure_perchannel=none:measure_overall=Peak_level", "-f", "null", "-"],
                           capture_output=True, text=True, timeout=600)
        mv = re.findall(r"Peak level dB:\s*(-?[\d.]+)", p.stderr)
        peak = float(mv[-1]) if mv else 0.0
        gain = min(0.0, -1.0 - peak)
        _run([ff, "-v", "error", "-y", "-i", fl, "-af", "volume=%.2fdB,aresample=dither_method=triangular" % gain,
              "-c:a", "pcm_s24le", out], timeout=900)
    _write_atomic(out, wav_plain(_read_bytes(out)))
    return {"spitze_db": round(peak, 2), "pegel_db": round(gain, 2)}


def aufbereiten(cfg: dict, wav_path: str):
    """3.4/3.5: bring the archive to the best state — from the UNMARKED original:
    • before 3.4 the model server hard-clipped EVERY track (peak_clip 10) → adeclip
      (🔴 on the marked file it does not work: the mark makes the flat spots noisy — measured)
    • before 3.5 the watermark was too loud (strength 10) → set the SAME ID again, quietly
    • 24 bit instead of 16 (the repair computes in floating point)
    If anything fails or the mark is unreadable afterwards, the old file stays. → dict or None."""
    jpath = wav_path[:-4] + ".json"
    d = _read_json(jpath)
    if (d.get("aufbereitet") or {}).get("v") == AUFBEREITET_V:
        return None
    wm = d.get("wasserzeichen") or {}
    clipped = (d.get("result") or {}).get("peak_clip") != 0
    try:
        target = wm_strength(cfg, wav_duration(wav_path))
    except Exception:
        target = wm_strength(cfg)
    laut = int(wm.get("staerke") or 10) != target
    if not (clipped or laut):
        return None
    orig = os.path.join(ORIG_DIR, os.path.basename(os.path.dirname(wav_path)), os.path.basename(wav_path))
    payload = wm.get("id", "")
    if not (os.path.isfile(orig) and tool(cfg, "ffmpeg") and payload):
        return None
    with Scratch() as s:
        out = s.path("r.wav")
        info_a = _clean_master_audio(cfg, orig, clipped, out)
        audio = _read_bytes(out)
        info = info_from_archive(wav_path)
        audio, _ = wm_embed(cfg, audio, {"title": info["title"], "variant": info["variant"], "archived": rel_home(wav_path),
                                         "created": info["created"], "aufbereitet": AUFBEREITET_V}, payload=payload)
        chk = s.path("chk.wav")
        with open(chk, "wb") as f:
            f.write(audio)
        if wm_detect(cfg, chk).get("id") != payload:
            raise RuntimeError("Wasserzeichen nach dem Aufbereiten nicht lesbar — alte Datei bleibt")
    with FileLock(wav_path):
        d = _read_json(jpath)
        tags = d.get("tags") or track_tags(cfg, info_from_archive(wav_path))
        _write_atomic(wav_path, wav_with_tags(audio, tags, _read_bytes(wav_path[:-4] + ".jpg")))
        d["aufbereitet"] = dict(info_a, v=AUFBEREITET_V, at=datetime.datetime.now().isoformat(timespec="seconds"),
                                adeclip=clipped, bits=24, wm_staerke=target)
        d["wasserzeichen"] = dict(d.get("wasserzeichen") or {}, staerke=target)
        _write_atomic(jpath, json.dumps(d, indent=2, ensure_ascii=False).encode("utf-8"))
    log("Aufbereitet: %s · %sWasserzeichen leise (Stärke %d) · 24 Bit · Pegel %+.1f dB"
        % (os.path.basename(wav_path), "Spitzen rekonstruiert (bis %+.1f dB) · " % info_a["spitze_db"] if clipped else "",
           target, info_a["pegel_db"]))
    return d["aufbereitet"]


def hq_version(cfg: dict, wav_path: str, variant: str = "C") -> str:
    """3.5: a new version of a track in best quality — the SAME content (not re-rendered:
    the same seed gives a different piece, measured), refined from the unmarked original,
    24 bit, own quiet watermark, cover taken over. Appears in the app under "📥 Vom Mac holen". → path"""
    orig = os.path.join(ORIG_DIR, os.path.basename(os.path.dirname(wav_path)), os.path.basename(wav_path))
    if not os.path.isfile(orig):
        raise RuntimeError("Kein unmarkiertes Original für %s" % os.path.basename(wav_path))
    variant = re.sub(r"[^A-Z0-9]", "", variant.upper())[:3] or "C"
    d = _read_json(wav_path[:-4] + ".json")
    meta, res = dict(d.get("meta") or {}), dict(d.get("result") or {})
    title = meta.get("title") or "Manuwave Studio"
    safe = re.sub(r"[^\w\- äöüÄÖÜß]+", "", title).strip().replace(" ", "_")[:50] or "Manuwave_Studio"
    folder = os.path.dirname(wav_path)
    base = "%s_%s_%s_%s" % (time.strftime("%H%M%S"), safe, variant, res.get("seed", meta.get("seed", "")))
    new = os.path.join(folder, base + ".wav")
    clipped = res.get("peak_clip") != 0
    with Scratch() as s:
        out = s.path("c.wav")
        info_a = _clean_master_audio(cfg, orig, clipped, out)
        clean = _read_bytes(out)
    o2 = os.path.join(ORIG_DIR, os.path.basename(folder), base + ".wav")
    os.makedirs(os.path.dirname(o2), exist_ok=True)
    _write_atomic(o2, clean)                    # version C also keeps its unmarked original
    target = wm_strength(cfg, _wav_seconds(clean))
    audio, payload = wm_embed(cfg, clean, {"title": title, "variant": variant, "archived": rel_home(new),
                                           "created": os.path.basename(folder)})
    von = (meta.get("variant") or "").strip()
    meta.update(variant=variant, source="hq",
                note=((meta.get("note") or "").strip() + "\n\nVersion %s: derselbe Track wie Version %s, aus dem unmarkierten "
                      "Original aufbereitet (%s24 Bit, leises Wasserzeichen)." % (variant, von or "?", "abgeschnittene Spitzen rekonstruiert, " if clipped else "")).strip())
    res.update(peak_clip=0, hq_von=rel_home(wav_path))
    nd = {"request": d.get("request") or {}, "meta": meta, "result": res,
          "wasserzeichen": {"id": payload, "at": datetime.datetime.now().isoformat(timespec="seconds"), "staerke": target},
          "aufbereitet": dict(info_a, v=AUFBEREITET_V, at=datetime.datetime.now().isoformat(timespec="seconds"),
                              adeclip=clipped, bits=24, wm_staerke=target)}
    if d.get("master"):
        nd["master"] = d["master"]
    # Take over the cover: the unlettered blank; the lettering is applied anew during refinement
    raw = _read_bytes(raw_cover_path(wav_path)) or _read_bytes(wav_path[:-4] + ".jpg")
    if raw:
        _write_atomic(raw_cover_path(new), raw)
        _write_atomic(new[:-4] + ".jpg", raw)
        nd["cover"] = dict(d.get("cover") or {}, stamp="")
    _write_atomic(new[:-4] + ".json", json.dumps(nd, indent=2, ensure_ascii=False).encode("utf-8"))
    _write_atomic(new, wav_with_tags(audio, track_tags(cfg, info_from_archive(new)), raw))
    veredeln(cfg, new, None, want_cover=False, backup=False)   # lettering + tags with the finished cover
    log("Version %s angelegt: %s (aus %s)" % (variant, os.path.basename(new), os.path.basename(wav_path)))
    return new


def stamp_text(r: dict) -> str:
    """What belongs on the cover as lettering: the artist name — never the owner's legal name."""
    return re.sub(r"\s+", " ", str(r.get("artist") or "")).strip()[:40] if r.get("cover_artist", True) else ""


def raw_cover_path(wav_path: str) -> str:
    return wav_path[:-4] + ".roh.jpg"


def apply_stamp(cfg: dict, wav_path: str) -> bool:
    """Brings the lettering on the cover up to date with the settings. Nothing is painted:
    the unlettered image sits next to it as .roh.jpg, the .jpg is always the finished cover.
    → True if the .jpg changed."""
    cpath, rpath, jpath = wav_path[:-4] + ".jpg", raw_cover_path(wav_path), wav_path[:-4] + ".json"
    want = stamp_text(rights(cfg))
    with FileLock(wav_path):
        if not os.path.isfile(cpath):
            return False
        d = _read_json(jpath)
        dc = d.get("cover") if isinstance(d.get("cover"), dict) else {}
        have = str(dc.get("stamp") or "")
        if have == want:
            return False
        if not os.path.isfile(rpath):
            if have:
                # 🔴 The blank is missing, the image already carries a name — a second lettering
                #    on top would be worse than the old one. A new cover (🎨) solves this.
                log("Cover %s: Rohling fehlt, Schriftzug „%s\" bleibt" % (os.path.basename(cpath), have))
                return False
            _write_atomic(rpath, _read_bytes(cpath))     # never lettered yet: the .jpg IS the blank
        if want:
            st = _swift_tool(cfg, "nf-stempel", NF_STEMPEL_SWIFT)
            if not st:
                return False
            with Scratch() as s:
                out = s.path("c.jpg")
                _run([st, rpath, out, want], timeout=60)
                data = _read_bytes(out)
            if not data or data[:2] != b"\xff\xd8":
                raise RuntimeError("Schriftzug: kein JPEG")
        else:
            data = _read_bytes(rpath)
        _write_atomic(cpath, data)
        d["cover"] = dict(dc, stamp=want)
        _write_atomic(jpath, json.dumps(d, indent=2, ensure_ascii=False).encode("utf-8"))
    log("Cover %s: %s" % (os.path.basename(cpath), ("Schriftzug „%s\"" % want) if want else "Schriftzug entfernt"))
    return True


def _cover_hash(cpath: str) -> str:
    data = _read_bytes(cpath)
    return hashlib.sha1(data).hexdigest()[:12] if data else ""


def veredeln(cfg: dict, wav_path: str, given: dict = None, want_cover: bool = True, tick=None,
             backup: bool = True, new_cover: bool = False) -> dict:
    """Brings ONE file in the archive up to date: watermark, tags, cover alongside.
    🔴 Audit 3.2: the lock only covers writing — the cover is painted WITHOUT it (up to
       minutes), otherwise an export of the same track would wait (and with it the whole brief lane)."""
    with FileLock(wav_path):
        out = _mark_and_tag(cfg, wav_path, given, tick, backup)
    try:
        if aufbereiten(cfg, wav_path):
            out["changed"].append("aufbereitet")
    except Exception as e:  # noqa: BLE001 — the old file stays, everything else continues
        log("Aufbereiten %s fehlgeschlagen: %s" % (os.path.basename(wav_path), e))
    r = rights(cfg)
    cpath = wav_path[:-4] + ".jpg"
    if want_cover and r["cover"] and os.path.isfile(cpath) and not new_cover:
        # A cover from before the lettering check: read it once — if a wrong title is on it, repaint
        dc = _read_json(wav_path[:-4] + ".json").get("cover") or {}
        if "text_ok" not in dc:
            lines = cover_text(cfg, _read_bytes(raw_cover_path(wav_path)) or _read_bytes(cpath) or b"")
            info0 = info_from_archive(wav_path, given)
            seen = _letters(" ".join(lines or []))
            ok = lines is None or len(seen) <= 3 or seen == _letters(cover_title(info0, r))
            with FileLock(wav_path):
                d = _read_json(wav_path[:-4] + ".json")
                d["cover"] = dict(d.get("cover") or {}, text=lines or [], text_ok=ok)
                _write_atomic(wav_path[:-4] + ".json", json.dumps(d, indent=2, ensure_ascii=False).encode("utf-8"))
            if not ok:
                log("Cover %s trägt falsche Schrift (%s) — wird neu gemalt" % (os.path.basename(cpath), " / ".join(lines)[:60]))
                new_cover = True
    if (want_cover and r["cover"] and not os.path.isfile(cpath)) or new_cover:
        info = info_from_archive(wav_path, given)
        if new_cover:   # different scene: new random value, new description
            info["seed"] = random.randint(1, 2147483646)
        try:
            c = make_cover(cfg, info, tick)
        except Exception as e:  # noqa: BLE001
            out["cover_error"] = str(e)[:200]
            log("Cover für %s fehlgeschlagen: %s" % (os.path.basename(wav_path), e))
        else:
            with FileLock(wav_path):
                if new_cover or not os.path.isfile(cpath):
                    _write_atomic(raw_cover_path(wav_path), c["jpeg"])
                    _write_atomic(cpath, c["jpeg"])
                    d = _read_json(wav_path[:-4] + ".json")
                    d["cover"] = {"model": c["model"], "prompt": c["prompt"], "s": c["s"], "text": c["text"],
                                  "text_ok": c["text_ok"], "tries": c["tries"], "title": c["title"], "stamp": ""}
                    _write_atomic(wav_path[:-4] + ".json", json.dumps(d, indent=2, ensure_ascii=False).encode("utf-8"))
            out["cover"] = True
            out["changed"].append("cover")
    try:
        # also on export (want_cover=False): the lettering costs no graphics chip, and a file
        # right after renaming should already carry the new name
        if apply_stamp(cfg, wav_path) and "cover" not in out["changed"]:
            out["changed"].append("schriftzug")
    except Exception as e:  # noqa: BLE001 — the cover then stays without a name, the rest continues
        log("Schriftzug für %s fehlgeschlagen: %s" % (os.path.basename(wav_path), e))
    if os.path.isfile(cpath):
        with FileLock(wav_path):
            again = _mark_and_tag(cfg, wav_path, given, None, backup)     # finished cover into the tags
        out["changed"] += [x for x in again["changed"] if x not in out["changed"]]
    out["cover"] = os.path.isfile(cpath)
    out["stamp"] = str((_read_json(wav_path[:-4] + ".json").get("cover") or {}).get("stamp") or "")
    return out


def _mark_and_tag(cfg, wav_path, given, tick, backup) -> dict:
    """Watermark (if none yet) and tags — under the file lock."""
    r = rights(cfg)
    jpath = wav_path[:-4] + ".json"
    cpath = wav_path[:-4] + ".jpg"
    d = _read_json(jpath)
    out = {"marked": bool(d.get("wasserzeichen")), "changed": []}
    # A rename in the browser also applies in the archive (audit 3.2: otherwise the title jumped back)
    g = given or {}
    meta = d.get("meta") if isinstance(d.get("meta"), dict) else {}
    d["meta"] = meta
    for k in ("title", "variant"):
        if isinstance(g.get(k), str) and g[k].strip() and meta.get(k) != g[k].strip():
            meta[k] = g[k].strip()
            out["changed"].append("titel")
    info = info_from_archive(wav_path, given)
    info["cover_model"] = (d.get("cover") or {}).get("model", "")
    rel = rel_home(wav_path)
    audio = None
    if r["watermark"] and not d.get("wasserzeichen"):
        try:
            # 🔴 Audit 3.2: a track may ALREADY be marked (resubmitted from the browser, crash
            #    between WAV and .json) — a second mark with the same key partly erases the
            #    first. So look first, then set.
            if tick:
                tick("Wasserzeichen …")
            found = wm_detect(cfg, wav_path)
            if found["found"]:
                d["wasserzeichen"] = {"id": found["id"], "at": datetime.datetime.now().isoformat(timespec="seconds"),
                                      "erkannt": True}
            else:
                with open(wav_path, "rb") as f:
                    audio = f.read()
                if backup:
                    bfile = os.path.join(ORIG_DIR, os.path.basename(os.path.dirname(wav_path)), os.path.basename(wav_path))
                    os.makedirs(os.path.dirname(bfile), exist_ok=True)
                    if not os.path.exists(bfile) or os.path.getsize(bfile) != len(audio):
                        _write_atomic(bfile, audio)       # atomic: never a half-written original
                staerke = wm_strength(cfg, _wav_seconds(audio))
                audio, payload = wm_embed(cfg, audio, {"title": info["title"], "variant": info["variant"],
                                                       "archived": rel, "created": info["created"]})
                d["wasserzeichen"] = {"id": payload, "at": datetime.datetime.now().isoformat(timespec="seconds"),
                                      "staerke": staerke}
            out["marked"] = True
            out["changed"].append("wasserzeichen")
        except Exception as e:  # noqa: BLE001
            # Tags and cover continue anyway — the failure is reported, not swallowed
            out["wm_error"] = (str(e) or type(e).__name__)[:200]
            log("Wasserzeichen für %s fehlgeschlagen: %s" % (os.path.basename(wav_path), e))
            audio = None
    tags = track_tags(cfg, info)
    ch = _cover_hash(cpath)
    if out["changed"] or d.get("tags") != tags or d.get("tags_cover", "") != ch:
        if audio is None:
            with open(wav_path, "rb") as f:
                audio = f.read()
        # First the WAV, THEN the .json with the ID: if the WAV fails, the .json claims
        # nothing false; if the process dies in between, the detection finds the mark next
        # time and carries it over (instead of setting a second one).
        _write_atomic(wav_path, wav_with_tags(audio, tags, _read_bytes(cpath)))
        d["tags"], d["tags_version"], d["tags_cover"] = tags, TAGS_VERSION, ch
        _write_atomic(jpath, json.dumps(d, indent=2, ensure_ascii=False).encode("utf-8"))
        out["changed"].append("tags")
    elif out["changed"]:
        _write_atomic(jpath, json.dumps(d, indent=2, ensure_ascii=False).encode("utf-8"))
    out["id"] = (d.get("wasserzeichen") or {}).get("id", "")
    return out


def archive_upload(cfg: dict, audio: bytes, given: dict) -> str:
    """A track the Mac does not (or no longer) have comes from the browser — into the archive."""
    created = str(given.get("created") or datetime.date.today().isoformat())[:10]
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", created):
        created = datetime.date.today().isoformat()
    folder = os.path.join(RENDERS, created)
    os.makedirs(folder, exist_ok=True)
    # 🔴 3.7: if the browser sent the same track again (page reloaded / tab closed before it fetched the result of
    #    the retrofit), another copy was created each time ("aus-browser_…_2.wav", "_3" …) — they showed up as
    #    "only on your Mac". Now the Mac recognizes it by the checksum of the UPLOADED audio (the file in the
    #    archive changes during refinement, so the checksum is stored in the .json) and reuses the existing slot.
    digest = hashlib.sha256(audio).hexdigest()
    try:
        names = sorted(os.listdir(folder))
    except OSError:
        names = []
    for n in names:
        if (n.startswith("aus-browser_") or n.startswith("selbst_")) and n.endswith(".json"):
            wav0 = os.path.join(folder, n[:-5] + ".wav")
            if os.path.isfile(wav0) and _read_json(os.path.join(folder, n)).get("upload_sha256") == digest:
                log("derselbe Track kam schon einmal aus dem Browser — %s wird weiterbenutzt" % rel_home(wav0))
                return wav0
    clean = lambda v, n: re.sub(r"[^\w\-äöüÄÖÜß]+", "", str(v or "").replace(" ", "_"))[:n]  # noqa: E731
    eigen = given.get("source") == "eigen"
    base = ("selbst_" if eigen else "aus-browser_") + "%s%s_%s" % (clean(given.get("title"), 50) or "Manuwave_Studio",
                                    ("_" + clean(given.get("variant"), 4)) if clean(given.get("variant"), 4) else "",
                                    clean(given.get("seed"), 12) or secrets.token_hex(3))
    # Audit 3.2: never overwrite an existing file (same title, variant, seed on the same day)
    for n in range(100):
        wav = os.path.join(folder, base + ("" if n == 0 else "_%d" % (n + 1)) + ".wav")
        try:
            fd = os.open(wav, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
            break
        except FileExistsError:
            continue
    with os.fdopen(fd, "wb") as f:
        f.write(audio)
    meta = {k: given.get(k) for k in ("title", "variant", "note") if given.get(k)}
    if eigen:
        meta["source"] = "eigen"
    req = {k: given.get(k) for k in ("caption", "lyrics", "bpm", "keyscale", "seed") if given.get(k)}
    with open(wav[:-4] + ".json", "w", encoding="utf-8") as f:
        json.dump({"request": req, "meta": meta, "result": {},
                   "herkunft": "selbst eingespielt in Manuwave Studio" if eigen else "aus dem Browser nachgereicht", "upload_sha256": digest},
                  f, indent=2, ensure_ascii=False)
    return wav


def all_archived() -> list:
    out = []
    for root, dirs, files in os.walk(RENDERS):
        dirs[:] = [x for x in dirs if not x.startswith("_")]
        out += [os.path.join(root, f) for f in files if f.endswith(".wav")]
    return sorted(out)


# ---- Mastering (3.4) -------------------------------------------------------------
# The idea: tracks can be mastered in the app, trimmed, and tone/treble/bass adjusted,
# live while listening, and only then exported.
# The browser plays the chain LIVE with Web Audio, the Mac computes the SAME chain with ffmpeg on export.
# 🔑 Measured: ffmpeg's lowshelf/highshelf (t=s:w=1) and equalizer (t=q) are the RBJ biquads that
#    Web Audio also uses — deviation ≤ 0.005 dB. That is why the export sounds like the preview.
#    Order and frequencies here and in app.js (MASTER_CHAIN) must stay the same.
MASTER_RANGES = {"bass": (-12.0, 12.0), "tone": (-6.0, 6.0), "treble": (-12.0, 12.0), "soft": (0.0, 8.0),
                 "gain": (-24.0, 12.0), "fade_in": (0.0, 10.0), "fade_out": (0.0, 15.0)}
MASTER_DEFAULT = {"bass": 0.0, "tone": 0.0, "treble": 0.0, "soft": 2.0, "fade_in": 0.0}
MASTER_LIMIT_DB = -1.5      # peak limit: even an MP3 stays below 0 dBFS on playback
MASTER_TARGET_LUFS = -14.0  # loudness as on the big streaming services — louder gets turned down there anyway
# 3.27: selectable loudness target — streaming −14, quiet −16, club −9 (like ZIELE in mastering.js)
ZIELE = {"streaming": -14.0, "leise": -16.0, "club": -9.0}
EQ_BUTTER4 = (0.5411961, 1.3065630)        # 4th-order high/low-pass = two Butterworth stages
MONO_BASS, BREITE = (60, 200), (50, 150)

# 3.28: Dynamics — dynamic EQ against AI harshness, de-esser, compressor (like DYN_STUFEN/dynamik in mastering.js).
# 🔑 All three = acompressor (core identical since ffmpeg 5.1, the browser recomputes it line by line — measured
#    bit-identical, the bands −140 dB). adynamicequalizer/deesser compute differently per ffmpeg version → not used.
#    Band stages: out = x − bandpass(x) + acompressor(bandpass(x)). Thresholds relative to the loudness target.
DYN_KEYS, DYN_MAX, DYN_AUSGLEICH = ("haerte", "zisch", "komp"), 10.0, 6.0
DYN_STUFEN = {
    "haerte": dict(f=3200, q=1.0, ratio=3, knee=2, att=5, rel=80, thr=lambda s: -5 - 1.1 * s),
    "zisch": dict(f=7000, q=1.4, ratio=4, knee=2, att=1, rel=40, thr=lambda s: -7 - 1.0 * s),
    "komp": dict(ratio=2, knee=2.82843, att=30, rel=250, thr=lambda s: 4 - 1.2 * s),
}


def dyn_stufen(m: dict) -> list:
    z = ZIELE.get(m.get("ziel"), MASTER_TARGET_LUFS)
    out = []
    for k in DYN_KEYS:
        s = m.get(k) or 0
        if s > 0:
            d = DYN_STUFEN[k]
            p = {x: d[x] for x in d if x != "thr"}
            p.update(k=k, thr=round(10 ** (max(-59.0, min(0.0, z + d["thr"](s))) / 20), 6))
            out.append(p)
    return out


def dyn_filters(m: dict) -> list:
    f = []
    for i, p in enumerate(dyn_stufen(m)):
        comp = ("acompressor=threshold=%.6f:ratio=%g:attack=%g:release=%g:knee=%g:makeup=1:detection=rms:link=average:mix=1"
                % (p["thr"], p["ratio"], p["att"], p["rel"], p["knee"]))
        if p.get("f"):              # take the band out, compress it alone, put it back (unique names per stage)
            a = "dy%d" % i
            f.append("aformat=channel_layouts=stereo,asplit=2[{a}x][{a}b];[{a}b]bandpass=f={f}:t=q:w={q:g},asplit=2[{a}p][{a}q];"
                     "[{a}q]{c}[{a}c];[{a}x][{a}p][{a}c]amerge=inputs=3,pan=stereo|c0=c0-c2+c4|c1=c1-c3+c5".format(
                         a=a, f=p["f"], q=p["q"], c=comp))
        else:
            f.append(comp)
    return f


# 3.27: Equalizer — up to 8 bands after the quick controls (like eqClean in mastering.js)
EQ_TYPES = {"lc": "highpass", "ls": "lowshelf", "pk": "peaking", "hs": "highshelf", "hc": "lowpass"}
EQ_MAX, EQ_F, EQ_G, EQ_Q = 8, (20, 20000), (-12.0, 12.0), (0.3, 8.0)


def clean_eq(raw) -> list:
    if not isinstance(raw, list):
        return []
    out = []
    for b in raw[:EQ_MAX]:
        if not isinstance(b, dict) or b.get("t") not in EQ_TYPES:
            continue
        f, g, q = b.get("f"), b.get("g", 0), b.get("q", 1)
        if not isinstance(f, (int, float)) or isinstance(f, bool) or not math.isfinite(f):
            continue
        f = int(round(max(EQ_F[0], min(EQ_F[1], f))))
        g = g if isinstance(g, (int, float)) and not isinstance(g, bool) and math.isfinite(g) else 0
        q = q if isinstance(q, (int, float)) and not isinstance(q, bool) and math.isfinite(q) else 1
        t = b["t"]
        if t in ("lc", "hc"):
            out.append({"t": t, "f": f})
            continue
        g = round(max(EQ_G[0], min(EQ_G[1], float(g))), 1)
        if g == 0:
            continue
        if t == "pk":
            out.append({"t": t, "f": f, "g": g, "q": round(max(EQ_Q[0], min(EQ_Q[1], float(q))), 2)})
        else:
            out.append({"t": t, "f": f, "g": g})
    return out


def clean_master(raw):
    """Only known controls, within their limits. → dict or None."""
    if not isinstance(raw, dict):
        return None
    num = lambda v: isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)  # noqa: E731
    m = {}
    for k, (lo, hi) in MASTER_RANGES.items():
        if num(raw.get(k)):
            m[k] = max(lo, min(hi, float(raw[k])))
    for k in ("start", "end"):
        if num(raw.get(k)) and raw[k] >= 0:
            m[k] = round(float(raw[k]), 3)
    eq = clean_eq(raw.get("eq"))
    if eq:
        m["eq"] = eq
    mb, br = raw.get("mono_bass"), raw.get("breite")
    if num(mb) and mb >= MONO_BASS[0]:
        m["mono_bass"] = int(round(min(MONO_BASS[1], mb)))
    if num(br) and int(round(br)) != 100:
        m["breite"] = int(round(max(BREITE[0], min(BREITE[1], br))))
    if raw.get("ziel") in ZIELE and raw.get("ziel") != "streaming":
        m["ziel"] = raw["ziel"]
    for k in DYN_KEYS:                             # 3.28: strength 0–10 in half steps (like masterClean)
        if num(raw.get(k)):
            r = math.floor(min(DYN_MAX, float(raw[k])) * 2 + 0.5) / 2
            if r > 0:
                m[k] = r
    if raw.get("off") is True:
        m["off"] = True
    return m


# 3.27: Mastering presets — they live here (bridge.json) so they apply to every browser and every export without a browser.
# A preset is a whole sound: quick controls, EQ and fades — never trim or level (those belong to the track).
PRESET_KEYS = ("bass", "tone", "treble", "soft", "fade_in", "fade_out", "eq", "mono_bass", "breite", "ziel", "haerte", "zisch", "komp")
PRESET_MAX = 40


def preset_klang(m) -> dict:
    m = clean_master(m) or {}
    return {k: m[k] for k in PRESET_KEYS if k in m}


def clean_presets(raw) -> list:
    out, ids = [], set()
    for p in (raw if isinstance(raw, list) else [])[:PRESET_MAX]:
        if not isinstance(p, dict):
            continue
        pid = str(p.get("id") or "")[:24]
        name = re.sub(r"\s+", " ", str(p.get("name") or "")).strip()[:40]
        if not re.fullmatch(r"[a-z0-9]{4,24}", pid) or not name or pid in ids:
            continue
        ids.add(pid)
        out.append({"id": pid, "name": name, "fav": p.get("fav") is True, "m": preset_klang(p.get("m"))})
    return out


def master_vorgabe(cfg) -> dict:
    """The sound new tracks get: the preset chosen as default, otherwise nothing (= the old default)."""
    v = cfg.get("master_vorgabe") or ""
    if v == "mein_sound":
        return (mein_sound() or {}).get("m") or {}
    return next((p["m"] for p in clean_presets(cfg.get("master_presets")) if p["id"] == v), {})


_mein_sound_cache = {"at": 0.0, "wert": None}


def mein_sound():
    """'My Sound': the median of your mastering controls across all archive tracks you mastered yourself."""
    if time.time() - _mein_sound_cache["at"] < 300:
        return _mein_sound_cache["wert"]
    werte = {k: [] for k in ("bass", "tone", "treble", "soft", "fade_in", "fade_out") + DYN_KEYS}
    n = 0
    for root, dirs, files in os.walk(RENDERS):
        dirs[:] = [x for x in dirs if not x.startswith("_")]
        for fn in files:
            if not fn.endswith(".json"):
                continue
            m = clean_master(_read_json(os.path.join(root, fn)).get("master"))
            if not m or m.get("off"):
                continue
            n += 1
            for k in werte:
                werte[k].append(m.get(k, 0.0))
    wert = None
    if n >= 3:
        med = lambda xs: sorted(xs)[len(xs) // 2] if len(xs) % 2 else sum(sorted(xs)[len(xs) // 2 - 1:len(xs) // 2 + 1]) / 2  # noqa: E731
        wert = {"n": n, "m": {k: round(med(v) * 2) / 2 for k, v in werte.items() if v and med(v) != 0}}
    _mein_sound_cache.update(at=time.time(), wert=wert)
    return wert


def _wav_frames(path: str):
    with wave.open(path) as w:
        return w.getparams(), w.readframes(w.getnframes())


def auto_end(path: str):
    """Where the music really ends. After the end, the music AI often still delivers seconds of quiet
    sound garbage (measured: -28...-57 dB, hump at 150-400 Hz), audible as a sound artifact at the end
    of the tracks. -> (end_s, fade_out_s) or None. Same calculation as autoEnd() in app.js."""
    try:
        params, frames = _wav_frames(path)
    except Exception:
        return None
    sw, ch, sr = params.sampwidth, params.nchannels, params.framerate
    if sw not in (2, 3, 4) or audioop is None or sr <= 0:
        return None
    full = float(1 << (8 * sw - 1))           # 3.5: the archive also has 24 bit
    blk = int(sr * 0.1) * sw * ch
    n = len(frames) // blk
    if n < 50:
        return None
    dbs = [20 * math.log10(max(audioop.rms(frames[i * blk:(i + 1) * blk], sw), 1) / full) for i in range(n)]
    med = sorted(dbs)[n // 2]
    last = max((i for i in range(n) if dbs[i] > med - 20), default=-1)
    if last < 0:
        return None
    dur = len(frames) / float(sw * ch * sr)
    end = min(dur, (last + 1) * 0.1 + 0.3)
    if dur - end < 0.5:          # nothing worth keeping after it
        return None
    return round(end, 2), 1.0


def master_settings(path: str, given) -> dict:
    """The controls for an export: what the browser sends, otherwise what is stored on the track,
    otherwise the default (soft, trim the end, loudness automatic)."""
    m = clean_master(given)
    if m is None:
        m = clean_master((_read_json(path[:-4] + ".json")).get("master"))   # 3.27: also the default stamped at creation
    if m is None:
        m = dict(MASTER_DEFAULT)
        ae = auto_end(path)
        if ae:
            m["end"], m["fade_out"] = ae
    return m


def master_filters(m: dict, dur: float, gain=None, ausgleich=0.0, bis_dynamik=False) -> list:
    """ffmpeg filters in the same order as the Web Audio chain in the browser.
    3.28: after the level comes the dynamics, then `ausgleich` dB (the loudness the dynamics took), fades, limiter.
    `bis_dynamik` ends after the dynamics — used to measure the compensation."""
    f = []
    start = max(0.0, min(m.get("start", 0.0), dur))
    end = m.get("end") or dur
    end = max(start + 1.0, min(end, dur))
    if start > 0.0005 or end < dur - 0.0005:
        f += ["atrim=start=%.4f:end=%.4f" % (start, end), "asetpts=PTS-STARTPTS"]
    if m.get("bass"):
        f.append("lowshelf=f=100:g=%.2f:t=s:w=1" % m["bass"])
    if m.get("tone"):                          # Tone color: - warm, + bright (tilt around ~1 kHz)
        f.append("lowshelf=f=300:g=%.2f:t=s:w=1" % (-m["tone"] / 2))
        f.append("highshelf=f=3000:g=%.2f:t=s:w=1" % (m["tone"] / 2))
    if m.get("soft"):                          # Take out harshness at 3.5 kHz - "softer"
        f.append("equalizer=f=3500:t=q:w=0.8:g=%.2f" % -m["soft"])
    if m.get("treble"):
        f.append("highshelf=f=8000:g=%.2f:t=s:w=1" % m["treble"])
    for b in clean_eq(m.get("eq")):              # 3.27: equalizer - same RBJ biquads as Web Audio
        if b["t"] in ("lc", "hc"):                 # 4th order: two Butterworth stages
            f += ["%s=f=%d:poles=2:t=q:w=%.7f" % ("highpass" if b["t"] == "lc" else "lowpass", b["f"], q) for q in EQ_BUTTER4]
        elif b["t"] == "pk":
            f.append("equalizer=f=%d:t=q:w=%.2f:g=%.2f" % (b["f"], b["q"], b["g"]))
        else:
            f.append("%s=f=%d:g=%.2f:t=s:w=1" % ("lowshelf" if b["t"] == "ls" else "highshelf", b["f"], b["g"]))
    mono, breite = m.get("mono_bass") or 0, (m.get("breite") or 100) / 100.0
    if mono or breite != 1:                        # 3.27: mid/side - like eqNodes in the browser (exactly linear)
        f.append("pan=stereo|c0=0.5*c0+0.5*c1|c1=0.5*c0-0.5*c1")
        if mono:
            f += ["highpass=f=%d:poles=2:t=q:w=%.7f:c=FR" % (mono, q) for q in EQ_BUTTER4]
        f.append("pan=stereo|c0=c0+%.6f*c1|c1=c0-%.6f*c1" % (breite, breite))
    if gain is not None:
        f.append("volume=%.2fdB" % gain)
        f += dyn_filters(m)
        if bis_dynamik:
            return f
        if ausgleich:
            f.append("volume=%.2fdB" % ausgleich)
        L = end - start
        if m.get("fade_in"):
            f.append("afade=t=in:st=0:d=%.3f:curve=qsin" % min(m["fade_in"], L / 2))
        if m.get("fade_out"):
            fo = min(m["fade_out"], L / 2)
            f.append("afade=t=out:st=%.3f:d=%.3f:curve=qsin" % (L - fo, fo))
        f.append("alimiter=limit=%.5f:attack=1:release=60:level=0:latency=1" % (10 ** (MASTER_LIMIT_DB / 20)))
    return f


def measure_lufs(ff: str, path: str, filters: list) -> float:
    """Integrated loudness (EBU R128) after EQ, before level and limiter."""
    p = subprocess.run([ff, "-hide_banner", "-nostats", "-i", path, "-af", ",".join(filters + ["ebur128=framelog=quiet"]),
                        "-f", "null", "-"], capture_output=True, text=True, timeout=600)
    m = re.findall(r"I:\s+(-?[\d.]+) LUFS", p.stderr)
    if not m:
        raise RuntimeError("Lautheit nicht messbar")
    return float(m[-1])


def master_kette(ff: str, wav_path: str, m: dict, tick=None):
    """The whole mastering chain of an export -> (ffmpeg filters, info). Measures loudness (if 'Auto') and,
    3.28, the compensation after the dynamics - same calculation as masterAudio/renderMaster in the browser."""
    mi = {}
    dur = wav_duration(wav_path)
    gain, lufs = m.get("gain"), None
    if gain is None:
        if tick:
            tick("Lautheit wird gemessen …")
        lufs = measure_lufs(ff, wav_path, master_filters(m, dur))
        gain = max(MASTER_RANGES["gain"][0], min(MASTER_RANGES["gain"][1], ZIELE.get(m.get("ziel"), MASTER_TARGET_LUFS) - lufs))
        mi["lufs_vorher"] = round(lufs, 1)
    gain = round(gain, 2)
    ausgleich = 0.0
    if dyn_stufen(m) and lufs is not None:          # 3.28: loudness taken by compressor & co. is added back afterwards
        if tick:
            tick("Dynamik wird gemessen …")
        nach = measure_lufs(ff, wav_path, master_filters(m, dur, gain, bis_dynamik=True))
        ausgleich = round(max(0.0, min(DYN_AUSGLEICH, lufs + gain - nach)), 2)
        mi["ausgleich"] = ausgleich
    mi.update(gain=gain, settings=m)
    return master_filters(m, dur, gain, ausgleich), mi


def wav_duration(path: str) -> float:
    with wave.open(path) as w:
        return w.getnframes() / float(w.getframerate() or 1)


# ---- Export -------------------------------------------------------------------

def aiff_with_id3(data: bytes, tag: bytes) -> bytes:
    """Appends an ID3 block as an 'ID3 ' chunk to an AIFF file (so Apple reads it too)."""
    if data[:4] != b"FORM" or data[8:12] not in (b"AIFF", b"AIFC"):
        return data
    chunk = b"ID3 " + struct.pack(">I", len(tag)) + tag + (b"\0" if len(tag) % 2 else b"")
    body = data[8:8 + struct.unpack(">I", data[4:8])[0]] + chunk
    return b"FORM" + struct.pack(">I", len(body)) + body


def export_track(cfg: dict, wav_path: str, fmt: str, rate: int, info: dict, tick=None,
                 master=None, bits: int = 24) -> dict:
    ff = tool(cfg, "ffmpeg")
    if not ff:
        raise RuntimeError("ffmpeg fehlt auf dem Mac — Export nicht möglich (brew install ffmpeg)")
    f = FORMATS[fmt]
    tags = track_tags(cfg, info)
    cpath = wav_path[:-4] + ".jpg"
    cover = _read_bytes(cpath)
    m = master_settings(wav_path, master)
    chain, mi = master_kette(ff, wav_path, m, tick) if not m.get("off") else ([], {})
    if tick:
        tick("Export %s …" % f["name"])
    with Scratch() as s:
        dst = s.path("out." + f["ext"])
        args = [ff, "-v", "error", "-y", "-i", wav_path]
        if cover and f["tags"] == "ffmpeg":
            args += ["-i", cpath, "-map", "0:a", "-map", "1:v", "-c:v", "copy", "-disposition:v:0", "attached_pic",
                     "-metadata:s:v", "title=Album cover", "-metadata:s:v", "comment=Cover (front)"]
        else:
            args += ["-map", "0:a"]
        args += ["-map_metadata", "-1"]
        # Finally always resample to the target rate (high-quality default resampler - soxr is missing in the
        # Homebrew ffmpeg, measured) with triangular dither: the float chain becomes clean 16 or 24 bit.
        chain = chain + ["aresample=%d:filter_size=64:phase_shift=10:cutoff=0.97:dither_method=triangular" % (rate or 48000)]
        args += ["-af", ",".join(chain)]
        args += f["args"] + f.get("s24" if bits == 24 else "s16", [])
        if f["tags"] == "ffmpeg":
            md = {"title": tags.get("title"), "artist": tags.get("artist"), "album_artist": tags.get("album_artist"),
                  "album": tags.get("album"), "genre": tags.get("genre"), "date": tags.get("date"),
                  "copyright": tags.get("copyright"), "publisher": tags.get("publisher"),
                  "comment": tags.get("comment"), "encoded_by": tags.get("encoded_by"), "lyrics": tags.get("lyrics")}
            if fmt == "flac":
                md.pop("lyrics")
                md.update(LYRICS=tags.get("lyrics"), BPM=tags.get("bpm"), INITIALKEY=tags.get("key"),
                          AI_GENERATED=tags.get("ai"), WEBSITE=tags.get("website"))
            for k, v in md.items():
                if v:
                    args += ["-metadata", "%s=%s" % (k, v)]
        args += ["-fflags", "+bitexact", dst]
        _run(args, timeout=900)
        with open(dst, "rb") as fh:
            data = fh.read()
    if f["tags"] == "wav":
        data = wav_with_tags(data, tags, cover)
    elif f["tags"] == "ape":
        data += apev2(tags, cover)
    elif f["tags"] == "id3":
        data = id3v23(tags, cover) + data
    elif f["tags"] == "aiff":
        data = aiff_with_id3(data, id3v23(tags, cover))
    name = re.sub(r"[^\w\-äöüÄÖÜß ()]+", "", tags.get("title", "track")).strip().replace(" ", "_")[:80] or "track"
    return {"data": data, "mime": f["mime"], "filename": "%s.%s" % (name, f["ext"]), "format": fmt,
            "rate": rate or 48000, "bits": 16 if fmt == "mp3" else bits, "cover": bool(cover), "bytes": len(data),
            "master": mi}


# =============================================================================
# 3.9: Release package — everything needed to publish or license a track
# =============================================================================
# One ZIP per track: audio (mastered as chosen in the export), cover at 3000 × 3000 (distributors require it),
# upload metadata incl. AI disclosure, lyrics, provenance record (PDF) and a license TEMPLATE for companies
# (Word, to be filled in). Model licenses checked against the model cards on 2026-10-15.
# Language: opts["ui_lang"] == "en" -> every text and every file name in the ZIP is English; anything else -> German
# (unchanged behaviour). Texts are picked per call with T(german, english) inside release_package.
MODEL_LICENSES = (
    ("flux2-klein", "FLUX.2 [klein] 4B (Black Forest Labs)", "Apache 2.0", "https://huggingface.co/black-forest-labs/FLUX.2-klein-4B"),
    ("z-image", "Z-Image Turbo (Tongyi-MAI)", "Apache 2.0", "https://huggingface.co/Tongyi-MAI/Z-Image-Turbo"),
)
ACE_LICENSE = ("ACE-Step 1.5", "MIT — laut Modellkarte ausdrücklich für kommerzielle Nutzung der erzeugten Musik",
               "https://huggingface.co/ACE-Step/Ace-Step1.5")
LANG_DE = {"en": "Englisch", "de": "Deutsch", "es": "Spanisch", "fr": "Französisch", "it": "Italienisch"}
# English counterparts for the package texts (the shared LANG_DE above stays German)
LANG_EN = {"en": "English", "de": "German", "es": "Spanish", "fr": "French", "it": "Italian"}
ACE_LICENSE_EN = "MIT — expressly for commercial use of the generated music, according to the model card"

NF_PDF_SWIFT = r'''// Manuwave Studio: HTML → PDF (A4) with AppKit, local only. Usage: nf-pdf in.html out.pdf
import AppKit
let a = CommandLine.arguments
guard a.count == 3, let html = try? Data(contentsOf: URL(fileURLWithPath: a[1])),
      let attr = try? NSAttributedString(data: html, options: [.documentType: NSAttributedString.DocumentType.html,
        .characterEncoding: String.Encoding.utf8.rawValue], documentAttributes: nil) else { exit(1) }
let pi = NSPrintInfo()
pi.paperSize = NSSize(width: 595.28, height: 841.89)
pi.topMargin = 56; pi.bottomMargin = 56; pi.leftMargin = 56; pi.rightMargin = 56
pi.horizontalPagination = .fit; pi.verticalPagination = .automatic
pi.isVerticallyCentered = false; pi.isHorizontallyCentered = false
pi.jobDisposition = .save
pi.dictionary()[NSPrintInfo.AttributeKey.jobSavingURL] = URL(fileURLWithPath: a[2])
let w = pi.paperSize.width - pi.leftMargin - pi.rightMargin
let tv = NSTextView(frame: NSRect(x: 0, y: 0, width: w, height: 10))
tv.textStorage?.setAttributedString(attr)
tv.isVerticallyResizable = true
tv.textContainer?.containerSize = NSSize(width: w, height: .greatestFiniteMagnitude)
tv.layoutManager?.ensureLayout(for: tv.textContainer!)
tv.sizeToFit()
let op = NSPrintOperation(view: tv, printInfo: pi)
op.showsPrintPanel = false; op.showsProgressPanel = false
exit(op.run() ? 0 : 1)
'''

PAKET_CSS = ("body{font-family:Helvetica,Arial,sans-serif;font-size:10.5pt;color:#1d1f24;line-height:1.35}"
             "h1{font-size:17pt;margin:0 0 4pt}h2{font-size:12pt;margin:14pt 0 4pt;color:#3a2f8f}"
             "p{margin:0 0 6pt}.klein{font-size:8.5pt;color:#555}table{border-collapse:collapse;width:100%}"
             "td{border:1px solid #c9cbd3;padding:3pt 5pt;vertical-align:top}td.k{width:32%;color:#444;background:#f3f3f7}"
             "pre{font-family:Menlo,Courier,monospace;font-size:8.5pt;white-space:pre-wrap}")


def _h(s) -> str:
    return (str(s if s is not None else "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;"))


def _rows(pairs) -> str:
    return "<table>" + "".join("<tr><td class='k'>%s</td><td>%s</td></tr>" % (_h(k), v) for k, v in pairs if v not in (None, "")) + "</table>"


def _fmt_dur(sec) -> str:
    sec = int(round(float(sec or 0)))
    return "%d:%02d" % (sec // 60, sec % 60)


def _audio_seconds(cfg: dict, data: bytes, ext: str, fallback: float) -> float:
    if data[:4] == b"RIFF":
        try:
            return _wav_seconds(data)
        except Exception:  # noqa: BLE001
            pass
    try:
        with Scratch() as s:
            p = s.path("a." + ext)
            with open(p, "wb") as f:
                f.write(data)
            sec = media_seconds(cfg, p)
            if sec:
                return sec
    except Exception:  # noqa: BLE001
        pass
    return fallback


def _cover_3000(cfg: dict, cpath: str):
    """Distributors require at least 3000 × 3000 px. The cover is generated at 1000 px
    and upscaled here (sips, Lanczos) — the read-me says so."""
    if not os.path.isfile(cpath):
        return None
    with Scratch() as s:
        dst = s.path("c.jpg")
        img_to_jpeg(cfg, cpath, dst, 3000, 92, square=True)
        return _read_bytes(dst)


def _html_to(cfg: dict, html: str, kind: str):
    """HTML -> PDF (own tool nf-pdf) or DOCX (textutil). -> (bytes, extension); fallback: HTML."""
    with Scratch() as s:
        src = s.path("d.html")
        with open(src, "w", encoding="utf-8") as f:
            f.write(html)
        try:
            if kind == "pdf":
                tool_pdf = _swift_tool(cfg, "nf-pdf", NF_PDF_SWIFT)
                if tool_pdf:
                    dst = s.path("d.pdf")
                    _run([tool_pdf, src, dst], timeout=120)
                    data = _read_bytes(dst)
                    if data and data[:4] == b"%PDF":
                        return data, "pdf"
            else:
                dst = s.path("d.docx")
                _run(["/usr/bin/textutil", "-convert", "docx", "-inputencoding", "UTF-8", src, "-output", dst], timeout=120)
                data = _read_bytes(dst)
                if data and data[:2] == b"PK":
                    return data, "docx"
        except Exception as e:  # noqa: BLE001
            log("Paket: %s nicht erzeugbar (%s) — HTML statt dessen" % (kind, e))
    return html.encode("utf-8"), "html"


def release_package(cfg: dict, path: str, res: dict, info: dict, opts: dict, fin: dict, own_master: bool = False) -> dict:
    """Builds the ZIP from a finished export (res) — opts: {"text_eigen": bool, "ui_lang": "de"|"en"}. own_master: the user
    set the master in 🎚 (otherwise it is the automatic suggestion — and the record must not present that as their work)."""
    import hashlib
    import zipfile
    import io
    en = opts.get("ui_lang") == "en"        # anything but "en" -> German, exactly as before

    def T(de, en_):
        return en_ if en else de

    def kv(de, en_, value):
        return "%-35s%s" % (T(de, en_), value)
    r = rights(cfg)
    d = _read_json(path[:-4] + ".json")
    req, meta, result = d.get("request") or {}, d.get("meta") or {}, d.get("result") or {}
    tags = track_tags(cfg, dict(info, cover_model=(d.get("cover") or {}).get("model", "")))
    owner = r["owner"].strip() or "—"
    artist = (r["artist"] or owner).strip()
    title = tags.get("title") or info.get("title") or "Track"
    created = info.get("created") or ""
    ext = res["filename"].rsplit(".", 1)[-1]
    qual = "320 kbit/s" if res["format"] == "mp3" else T("%s Bit", "%s-bit") % res["bits"]
    audio = res["data"]
    sha = hashlib.sha256(audio).hexdigest()
    dur = _audio_seconds(cfg, audio, ext, wav_duration(path))
    lines = _sung_lines(info.get("lyrics") or "")
    caption_tags = [t.strip().lower() for t in (info.get("caption") or "").split(",") if t.strip()]
    instrumental = not lines.strip() or ("instrumental" in caption_tags and len(lines.splitlines()) < 3)
    text_eigen = bool(opts.get("text_eigen")) and not instrumental
    lang_code = str(req.get("vocal_language") or result.get("vocal_language") or "en")
    lang = LANG_EN.get(lang_code, "English") if en else LANG_DE.get(lang_code, "Englisch")
    ace = (ACE_LICENSE[0], ACE_LICENSE_EN, ACE_LICENSE[2]) if en else ACE_LICENSE
    cover_model = (d.get("cover") or {}).get("model", "")
    cov_lic = next(((n, l, u) for k, n, l, u in MODEL_LICENSES if k in cover_model), None)
    imported = meta.get("source") == "import"
    eigen = meta.get("source") == "eigen" or info.get("source") == "eigen"     # 3.15: self-performed in the studio
    herkunft = meta.get("herkunft") or {}
    mastered = res.get("master") or {}
    wm = (d.get("wasserzeichen") or {}).get("id") or fin.get("id") or ""
    auf = d.get("aufbereitet") or {}
    safe = re.sub(r"[^\w\-äöüÄÖÜß ()]+", "", title).strip()[:80] or "Track"
    # file names inside the ZIP (German as before; English when ui_lang == "en")
    f_meta = T("Metadaten.txt", "Metadata.txt")
    f_lyrics = T("Liedtext.txt", "Lyrics.txt")
    f_prov = T("Herkunftsnachweis", "Provenance")
    f_lic = T("Lizenz_Vorlage_Firmen", "License_Template_Companies")
    f_readme = T("Lies_mich.txt", "Read_me.txt")
    today = datetime.date.today().isoformat()
    year = (created or today)[:4]
    cpy = tags.get("copyright") or ""

    # ---- Upload metadata ----
    cover_label = cov_lic[0] if cov_lic else cover_model or T("Bildmodell", "image model")
    ki = [
        T("[ ] Musik — selbst eingespielt (Synthesizer und Drum-Machine in Manuwave Studio, keine KI)",
          "[ ] Music — self-performed (synthesizer and drum machine in Manuwave Studio, no AI)"),
        T("[ ] Gesamter Ton / Aufnahme — selbst eingespielt", "[ ] Entire audio / recording — self-performed"),
        T("[ ] Liedtext — entfällt (instrumental)", "[ ] Lyrics — not applicable (instrumental)") if instrumental else (
            T("[ ] Liedtext — von %s selbst geschrieben", "[ ] Lyrics — written by %s personally") % owner),
        T("[x] Cover — mit KI erzeugt (%s)", "[x] Cover — AI-generated (%s)") % cover_label,
        T("Nicht als KI anzugeben: Mastering in Manuwave Studio", "Not to be declared as AI: mastering in Manuwave Studio"),
    ] if eigen else [
        T("[x] Musik — mit KI erzeugt (%s)", "[x] Music — AI-generated (%s)") % ace[0],
        T("[x] Gesamter Ton / Aufnahme — mit KI erzeugt", "[x] Entire audio / recording — AI-generated")
        + ((T(" (inkl. Gesang)", " (incl. vocals)")) if not instrumental else ""),
        (T("[ ] Liedtext — von %s selbst geschrieben", "[ ] Lyrics — written by %s personally") % owner) if text_eigen else
        (T("[ ] Liedtext — entfällt (instrumental)", "[ ] Lyrics — not applicable (instrumental)") if instrumental
         else T("[x] Liedtext — mit KI erzeugt", "[x] Lyrics — AI-generated")),
        T("[x] Cover — mit KI erzeugt (%s)", "[x] Cover — AI-generated (%s)") % cover_label,
        T("Nicht als KI anzugeben (KI-gestütztes Mixing/Mastering zählt bei Vertrieben in der Regel nicht): Mastering in Manuwave Studio",
          "Not to be declared as AI (AI-assisted mixing/mastering usually does not count for distributors): mastering in Manuwave Studio"),
    ]
    meta_txt = "\n".join([
        T("VERÖFFENTLICHUNG — METADATEN FÜRS HOCHLADEN", "RELEASE — UPLOAD METADATA"),
        T("„%s“ · %s · erstellt %s mit Manuwave Studio", "“%s” · %s · created %s with Manuwave Studio") % (title, artist, today),
        "",
        kv("Songtitel (Song title):", "Song title:", title),
        kv("Künstler (Artist):", "Artist:", artist),
        kv("Art:", "Type:", "Single" + ("" if (tags.get("album") or title) == title.split(" (Version")[0] else " · Album: %s" % tags.get("album"))),
        kv("Genre (primär):", "Genre (primary):", (tags.get("genre") or "—")
           + T("   ← beim Vertrieb aus dessen Liste wählen", "   ← pick from the distributor's list when uploading")),
        kv("Sprache des Textes:", "Language of the lyrics:", "Instrumental" if instrumental else lang),
        kv("Explizite Inhalte:", "Explicit content:", T("Nein (bitte prüfen)", "No (please check)")),
        kv("Dauer:", "Duration:", _fmt_dur(dur)),
        kv("BPM / Tonart:", "BPM / Key:", "%s / %s" % (tags.get("bpm") or "—", tags.get("key") or "—")),
        kv("Erzeugt am:", "Created on:", created or "—"),
        kv("Songwriter (echter Name):", "Songwriter (real name):", owner),
        kv("Textdichter:", "Lyricist:", (owner) if text_eigen else ("—" if instrumental else T(
            "keiner (KI-Text) — siehe KI-Angaben", "none (AI lyrics) — see AI disclosure"))),
        kv("Copyright (©):", "Copyright (©):", cpy or "—"),
        kv("Aufnahme (℗):", "Recording (℗):", "℗ %s %s" % (year, artist)),
        kv("ISRC / UPC:", "ISRC / UPC:", T("vergibt der Vertrieb", "assigned by the distributor")),
        kv("Cover:", "Cover:", "%s — 3000 × 3000 px, JPG, RGB" % ("Cover_3000x3000.jpg")),
        kv("Datei:", "File:", "%s (%s, %s, %d Hz)" % (res["filename"], res["format"].upper(), qual, res["rate"])),
        "",
        T("KI-ANGABEN (wie Vertriebe sie abfragen — Stand Oktober 2026, beim Hochladen prüfen):",
          "AI DISCLOSURE (as distributors ask for it — as of October 2026, check when uploading):"),
        *("  " + x for x in ki),
        "",
        T("WICHTIG", "IMPORTANT"),
        T("  • Keine Nachahmung anderer Künstler, keine Massen-Uploads — sonst sperren Vertriebe und Plattformen.",
          "  • No imitation of other artists, no mass uploads — otherwise distributors and platforms will block you."),
        *([T("  • Selbst eingespielte Musik: bei einer Verwertungsgesellschaft anmeldbar, auch Plattformen ohne KI-Musik nehmen sie.",
             "  • Self-performed music: can be registered with a collecting society, and platforms without AI music accept it too.")]
          if eigen else [
        T("  • Manche Plattformen und Musikbibliotheken nehmen (Stand Oktober 2026) keine KI-erzeugte Musik — vorher deren Regeln lesen.",
          "  • Some platforms and music libraries do not accept AI-generated music (as of October 2026) — read their rules first."),
        T("  • Verwertungsgesellschaften: rein KI-erzeugte Teile sind nicht anmeldbar%s.",
          "  • Collecting societies: purely AI-generated parts cannot be registered%s.") % (
              T(" — dein eigener Text kann es sein", " — your own lyrics may be") if text_eigen else "")]),
        T("  • Wasserzeichen-Kennung (unhörbar im Audio): %s", "  • Watermark ID (inaudible in the audio): %s") % (wm or "—"),
        T("  • SHA-256 der Audiodatei: %s", "  • SHA-256 of the audio file: %s") % sha,
    ]) + "\n"

    # ---- Provenance record ----
    program_name = T("Früheres lokales Programm, übernommen in Manuwave Studio", "Earlier local program, imported into Manuwave Studio")
    cover_row = ("Cover",
                 ("%s — %s<br><span class='klein'>%s</span>" % (_h(cov_lic[0]), _h(cov_lic[1]), _h(cov_lic[2]))) if cov_lic else _h(cover_model or "—"))
    entstehung = [
        (T("Erzeugt am", "Created on"), _h(created or "—")),
        (T("Musik und Gesang", "Music and vocals"), "%s — %s<br><span class='klein'>%s · %s: %s</span>" % (
            _h(ace[0]), _h(ace[1]), _h(ace[2]), T("Modell", "Model"), _h(result.get("dit") or req.get("dit") or "ACE-Step 1.5"))),
        (T("Programm", "Program"), _h(program_name if imported else T("Manuwave Studio (lokal auf dem Mac, keine Cloud)",
                                                                       "Manuwave Studio (local on the Mac, no cloud)"))),
        ("Seed", _h(result.get("seed", req.get("seed", "")))),
        (T("Schritte / Führung", "Steps / Guidance"), _h("%s / %s" % (
            req.get("inference_steps") or T("Standard", "default"),
            req.get("guidance_scale") or result.get("guidance_scale") or T("Standard", "default")))),
        cover_row,
    ]
    if eigen:
        entstehung = [
            (T("Erzeugt am", "Created on"), _h(created or "—")),
            (T("Musik", "Music"), _h(T("selbst eingespielt von %s — Synthesizer und Drum-Machine von Manuwave Studio (Klang wird im Browser "
                                       "berechnet, keine Samples, keine KI)",
                                       "self-performed by %s — synthesizer and drum machine from Manuwave Studio (sound is computed "
                                       "in the browser, no samples, no AI)") % owner)),
            (T("Programm", "Program"), _h(T("Manuwave Studio · Tab „Selber machen“", "Manuwave Studio · “Make your own” tab"))),
            cover_row,
        ]
    if imported and herkunft:
        entstehung.append((T("Ursprung", "Origin"), _h(T("%s, Eintrag %s, Datei %s, erzeugt %s", "%s, entry %s, file %s, created %s") % (
            herkunft.get("programm", ""), herkunft.get("id", ""), herkunft.get("datei", ""), herkunft.get("erzeugt", "")))))
    mensch = ([T("Komposition, Einspielung, Klanggestaltung und Arrangement: %s",
                 "Composition, performance, sound design and arrangement: %s") % owner] if eigen else
              [T("Idee, Vorgaben (Richtung, Länge, Stimme) und Auswahl dieser Fassung aus den erzeugten Versionen: %s",
                 "Idea, specifications (direction, length, voice) and selection of this version from the generated versions: %s") % owner])
    if text_eigen:
        mensch.insert(0, T("Liedtext: von %s selbst geschrieben", "Lyrics: written by %s personally") % owner)
    ms_names = {"bass": T("Bässe %+.1f dB", "Bass %+.1f dB"), "tone": T("Tonfarbe %+.1f", "Tone %+.1f"),
                "treble": T("Höhen %+.1f dB", "Treble %+.1f dB"), "soft": T("Weich %.0f", "Soft %.0f"),
                "fade_in": T("Einblenden %.1f s", "Fade-in %.1f s"), "fade_out": T("Ausblenden %.1f s", "Fade-out %.1f s"),
                "start": T("Start bei %.1f s", "Start at %.1f s"), "end": T("Ende bei %.1f s", "End at %.1f s"),
                "gain": T("Pegel %+.1f dB", "Level %+.1f dB")}
    ms_txt = ", ".join(ms_names[k] % float(v) for k, v in (mastered.get("settings") or {}).items()
                       if k in ms_names and isinstance(v, (int, float)) and float(v) != 0)
    bearbeitung_auto = ""
    if mastered and own_master:
        mensch.append(T("Mastering: eigene Einstellungen von %s%s", "Mastering: own settings by %s%s") % (
            owner, (" (%s)" % ms_txt) if ms_txt else ""))
    elif mastered:
        bearbeitung_auto = T("Mastering automatisch (Manuwave-Studio-Vorschlag%s), Ziel −14 LUFS",
                             "Mastering automatic (Manuwave Studio suggestion%s), target −14 LUFS") % ((": " + ms_txt) if ms_txt else "")
    bearbeitung = []
    if auf.get("adeclip"):
        bearbeitung.append(T("abgeschnittene Spitzen rekonstruiert (adeclip, bis %+.1f dB)",
                             "clipped peaks reconstructed (adeclip, up to %+.1f dB)") % (auf.get("spitze_db") or 0))
    if auf.get("bits"):
        bearbeitung.append(T("%s Bit", "%s-bit") % auf["bits"])
    if bearbeitung_auto:
        bearbeitung.append(bearbeitung_auto)
    if mastered.get("gain") is not None:
        bearbeitung.append(T("Pegel %+.1f dB%s", "Level %+.1f dB%s") % (mastered["gain"], (
            T(" (vorher %.1f LUFS)", " (before: %.1f LUFS)") % mastered["lufs_vorher"]) if mastered.get("lufs_vorher") is not None else ""))
    nachweis = ("<html><head><meta charset='utf-8'><style>%s</style></head><body>" % PAKET_CSS
                + T("<h1>Herkunftsnachweis</h1><p><b>„%s“</b> · %s</p>", "<h1>Provenance record</h1><p><b>“%s”</b> · %s</p>") % (_h(title), _h(artist))
                + T("<p class='klein'>Erstellt am %s von Manuwave Studio. Dieser Nachweis beschreibt, wie der Track entstanden ist, "
                    "und belegt über Wasserzeichen und Prüfsumme, dass die gelieferte Datei dieser Track ist.</p>",
                    "<p class='klein'>Created on %s by Manuwave Studio. This record describes how the track was made "
                    "and uses watermark and checksum to prove that the delivered file is this track.</p>") % _h(today)
                + "<h2>Track</h2>" + _rows([
                    (T("Titel", "Title"), _h(title)), (T("Künstler", "Artist"), _h(artist)), (T("Rechteinhaber", "Rights holder"), _h(owner)),
                    (T("Dauer", "Duration"), _h(_fmt_dur(dur))),
                    (T("Tempo / Tonart", "Tempo / Key"), _h("%s BPM / %s" % (tags.get("bpm") or "—", tags.get("keyscale") or info.get("keyscale") or "—"))),
                    (T("Sprache", "Language"), _h("Instrumental" if instrumental else lang)), ("Copyright", _h(cpy))])
                + ((T("<h2>Entstehung</h2>", "<h2>Creation</h2>")) if eigen else T("<h2>Entstehung (KI)</h2>", "<h2>Creation (AI)</h2>"))
                + _rows(entstehung)
                + T("<h2>Menschlicher Anteil</h2><p>", "<h2>Human contribution</h2><p>") + "<br>".join("• " + _h(x) for x in mensch) + "</p>"
                + ((T("<h2>Bearbeitung</h2><p>%s</p>", "<h2>Processing</h2><p>%s</p>") % _h(" · ".join(bearbeitung))) if bearbeitung else "")
                + T("<h2>Datei und Nachweis</h2>", "<h2>File and verification</h2>") + _rows([
                    (T("Datei", "File"), _h("%s · %s · %s · %d Hz · %.1f MB" % (res["filename"], res["format"].upper(), qual, res["rate"], len(audio) / 1e6))),
                    ("SHA-256", "<span class='klein'>%s</span>" % _h(sha)),
                    (T("Wasserzeichen", "Watermark"), _h(wm or "—") + T(
                        "<br><span class='klein'>unhörbar (audiowmark), übersteht MP3 und Bearbeitung; prüfen auf dem Mac: "
                        "python3 %s --pruefen &lt;Datei&gt;</span>",
                        "<br><span class='klein'>inaudible (audiowmark), survives MP3 and editing; verify on the Mac: "
                        "python3 %s --pruefen &lt;file&gt;</span>") % _h(shown_path(os.path.abspath(__file__)))),
                    (T("Archiv", "Archive"), _h(rel_home(path)))])
                + T("<h2>Beschreibung beim Erzeugen</h2><p class='klein'>%s</p>", "<h2>Description at generation</h2><p class='klein'>%s</p>")
                % _h(info.get("caption") or "—")
                + (T("<h2>Liedtext</h2><pre>%s</pre>", "<h2>Lyrics</h2><pre>%s</pre>") % _h(info.get("lyrics")) if not instrumental else "")
                + (T("<h2>Rechtlicher Hinweis</h2><p class='klein'>Die Musik ist selbst eingespielt und damit ein eigenes Werk von %s. "
                     "KI-erzeugt ist nur das Cover (Lizenz siehe oben). Dieser Nachweis ist keine Rechtsberatung.</p></body></html>",
                     "<h2>Legal notice</h2><p class='klein'>The music is self-performed and therefore an original work by %s. "
                     "Only the cover is AI-generated (license see above). This record is not legal advice.</p></body></html>") % _h(owner)
                   if eigen else
                   T("<h2>Rechtlicher Hinweis</h2><p class='klein'>Rein KI-erzeugte Bestandteile sind in Deutschland nach derzeitiger "
                     "Auffassung nicht urheberrechtlich geschützt; geschützt sein können die menschlichen Beiträge oben. Die eingesetzten "
                     "Modelle erlauben die kommerzielle Nutzung (Lizenzen siehe oben, geprüft am 15.10.2026). Dieser Nachweis ist "
                     "keine Rechtsberatung.</p></body></html>",
                     "<h2>Legal notice</h2><p class='klein'>Purely AI-generated components are, under the current prevailing view in "
                     "Germany, not protected by copyright; the human contributions above may be protected. The models used "
                     "permit commercial use (licenses see above, checked on 15 October 2026). This record is "
                     "not legal advice.</p></body></html>")))

    # ---- License template for companies ----
    blank = "______________________________"
    lizenz = ("<html><head><meta charset='utf-8'><style>%s</style></head><body>" % PAKET_CSS
              + T("<h1>Nutzungslizenz für Musik</h1><p class='klein'>VORLAGE — vor der ersten Verwendung rechtlich prüfen lassen. "
                  "Linien ausfüllen, Zutreffendes ankreuzen, Nichtzutreffendes streichen.</p>",
                  "<h1>Music Usage License</h1><p class='klein'>TEMPLATE — have it legally reviewed before first use. "
                  "Fill in the lines, tick what applies, strike out what does not.</p>")
              + T("<h2>Vertragsparteien</h2>", "<h2>Parties</h2>") + _rows([
                  (T("Lizenzgeber", "Licensor"), _h(T("%s (Künstlername: %s)", "%s (artist name: %s)") % (owner, artist))
                   + T("<br>Anschrift: ", "<br>Address: ") + blank),
                  (T("Lizenznehmer", "Licensee"), T("Name/Firma: ", "Name/company: ") + blank + T("<br>Anschrift: ", "<br>Address: ") + blank)])
              + T("<h2>§ 1 Gegenstand</h2>", "<h2>§ 1 Subject matter</h2>") + _rows([
                  (T("Titel", "Title"), _h(T("„%s“ von %s", "“%s” by %s") % (title, artist))), (T("Dauer", "Duration"), _h(_fmt_dur(dur))),
                  (T("Datei", "File"), _h(res["filename"])), ("SHA-256", "<span class='klein'>%s</span>" % _h(sha)),
                  (T("Wasserzeichen", "Watermark"), _h(wm or "—"))])
              + T("<h2>§ 2 Eingeräumte Rechte</h2><p>Der Lizenzgeber räumt dem Lizenznehmer ein <b>einfaches (nicht ausschließliches), "
                  "nicht übertragbares</b> Recht ein, den Titel für folgende Zwecke zu nutzen (Zutreffendes ankreuzen):</p>"
                  "<p>☐ Hintergrundmusik in eigenen Geschäftsräumen &nbsp; ☐ Veranstaltungen &nbsp; ☐ Telefon-Warteschleife<br>"
                  "☐ eigene Online-Videos und Social Media &nbsp; ☐ Podcast &nbsp; ☐ Werbung (Medium: ",
                  "<h2>§ 2 Rights granted</h2><p>The licensor grants the licensee a <b>simple (non-exclusive), "
                  "non-transferable</b> right to use the title for the following purposes (tick what applies):</p>"
                  "<p>☐ Background music on own business premises &nbsp; ☐ Events &nbsp; ☐ Telephone hold music<br>"
                  "☐ Own online videos and social media &nbsp; ☐ Podcast &nbsp; ☐ Advertising (medium: ") + blank + ")</p>"
              + T("<p>Gebiet: ☐ Deutschland ☐ EU ☐ weltweit &nbsp;·&nbsp; Dauer: ☐ unbefristet ☐ bis ",
                  "<p>Territory: ☐ Germany ☐ EU ☐ worldwide &nbsp;·&nbsp; Term: ☐ unlimited ☐ until ") + blank + "</p>"
              + T("<h2>§ 3 Nicht gestattet</h2><p>Weiterverkauf oder Weiterlizenzierung der Musik als solche; Veröffentlichung als eigene "
                  "Musik; Anmeldung bei einer Verwertungsgesellschaft oder bei Content-ID-Systemen; Verwendung zum Training von KI-Modellen.</p>",
                  "<h2>§ 3 Not permitted</h2><p>Resale or sub-licensing of the music as such; publication as one's own "
                  "music; registration with a collecting society or with automated content-recognition systems; use for training AI models.</p>")
              + T("<h2>§ 4 Vergütung</h2><p>Einmalig ", "<h2>§ 4 Remuneration</h2><p>One-time fee of ") + blank
              + T(" €, fällig bei Unterzeichnung — zzgl. gesetzlicher Umsatzsteuer, "
                  "bei Kleinunternehmerregelung stattdessen: „Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.“</p>",
                  " €, due on signature — plus statutory VAT; "
                  "under the small-business exemption instead: “No VAT is charged pursuant to § 19 UStG (German VAT Act).”</p>")
              + T("<h2>§ 5 Verwertungsgesellschaften</h2><p>Der Titel ist bei keiner Verwertungsgesellschaft angemeldet. "
                  "Für die vereinbarte Nutzung fallen nach Kenntnis des Lizenzgebers keine Vergütungen an Verwertungsgesellschaften an. "
                  "Bei Rückfragen einer Verwertungsgesellschaft stellt der Lizenzgeber diese Lizenz und den Herkunftsnachweis zur Verfügung.</p>",
                  "<h2>§ 5 Collecting societies</h2><p>The title is not registered with any collecting society. "
                  "To the licensor's knowledge, no remuneration is payable to collecting societies for the agreed use. "
                  "If a collecting society makes enquiries, the licensor will provide this license and the provenance record.</p>")
              + (T("<h2>§ 6 Entstehung</h2><p>Der Titel wurde vom Lizenzgeber selbst komponiert und eingespielt (Synthesizer und "
                   "Drum-Machine von Manuwave Studio, keine KI). Der Lizenzgeber versichert, dass er keine bestehenden Werke bewusst "
                   "nachgeahmt hat.</p>",
                   "<h2>§ 6 Origin</h2><p>The title was composed and performed by the licensor personally (synthesizer and "
                   "drum machine from Manuwave Studio, no AI). The licensor warrants that they have not knowingly "
                   "imitated any existing works.</p>") if eigen else
                 T("<h2>§ 6 Entstehung mit KI</h2><p>Der Titel wurde mit Hilfe künstlicher Intelligenz erzeugt (Musik: %s%s). "
                   "Der Lizenzgeber versichert, dass die eingesetzten Werkzeuge die kommerzielle Nutzung erlauben und dass er keine "
                   "bestehenden Werke oder Künstler bewusst nachgeahmt hat. Der Lizenznehmer nimmt zur Kenntnis, dass rein KI-erzeugte "
                   "Bestandteile nach derzeitiger Rechtslage keinen urheberrechtlichen Schutz genießen.</p>",
                   "<h2>§ 6 Origin with AI</h2><p>The title was created with the help of artificial intelligence (music: %s%s). "
                   "The licensor warrants that the tools used permit commercial use and that they have not knowingly imitated "
                   "any existing works or artists. The licensee acknowledges that purely AI-generated components "
                   "currently enjoy no copyright protection under the applicable legal situation.</p>") % (
                    _h(ace[0]), (_h(T("; Liedtext: %s", "; lyrics: %s") % owner) if text_eigen else "")))
              + T("<h2>§ 7 Haftung</h2><p>Der Lizenzgeber haftet für Vorsatz und grobe Fahrlässigkeit. Werden gegen den Lizenznehmer "
                  "Ansprüche Dritter wegen der vertragsgemäßen Nutzung erhoben, informieren sich die Parteien unverzüglich.</p>",
                  "<h2>§ 7 Liability</h2><p>The licensor is liable for intent and gross negligence. If third parties assert claims "
                  "against the licensee because of use in accordance with the contract, the parties will inform each other without delay.</p>")
              + T("<h2>§ 8 Schluss</h2><p>Es gilt deutsches Recht. Änderungen bedürfen der Textform.</p>",
                  "<h2>§ 8 Final provisions</h2><p>German law applies. Amendments require text form.</p>")
              + T("<p><br>Ort, Datum: ", "<p><br>Place, date: ") + blank + "<br><br><br>" + blank + " &nbsp;&nbsp;&nbsp; " + blank
              + T("<br>Lizenzgeber (%s) &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Lizenznehmer</p>",
                  "<br>Licensor (%s) &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Licensee</p>") % _h(owner)
              + "</body></html>")

    nachweis_b, n_ext = _html_to(cfg, nachweis, "pdf")
    lizenz_b, l_ext = _html_to(cfg, lizenz, "docx")
    cover = _cover_3000(cfg, path[:-4] + ".jpg")
    readme = "\n".join([
        T("„%s“ — Veröffentlichungspaket", "“%s” — Release package") % title, "",
        "%-34s %s" % (res["filename"], T("die Musik (%s, gemastert wie im Export gewählt; Cover und Tags stecken drin)",
                                          "the music (%s, mastered as chosen in the export; cover and tags embedded)") % res["format"].upper()),
        ("%-34s %s" % ("Cover_3000x3000.jpg", T("das Cover in 3000 × 3000 px für Vertriebe (aus 1000 px hochgerechnet)",
                                                 "the cover at 3000 × 3000 px for distributors (upscaled from 1000 px)")))
        if cover else T("(kein Cover vorhanden)", "(no cover available)"),
        "%-34s %s" % (f_meta, T("alle Angaben fürs Hochladen, inkl. KI-Angaben zum Abhaken",
                                "all details for uploading, incl. AI disclosure checklist to tick off")),
        ("%-34s %s" % (f_lyrics, T("nur die gesungenen Zeilen (für Liedtext-Felder)", "only the sung lines (for lyrics fields)")))
        if not instrumental else "",
        "%-34s %s" % (f_prov + "." + n_ext, T("wie der Track entstanden ist, Prüfsumme, Wasserzeichen",
                                              "how the track was made, checksum, watermark")),
        "%-34s %s" % (f_lic + "." + l_ext, T("Vorlage zum Ausfüllen, wenn du den Track an Firmen lizenzierst",
                                             "template to fill in when you license the track to companies")),
        "", T("Hinweis: Das ist eine Arbeitshilfe, keine Rechtsberatung. Erstellt %s mit Manuwave Studio.",
              "Note: This is a working aid, not legal advice. Created %s with Manuwave Studio.") % today,
    ]).replace("\n\n\n", "\n\n") + "\n"
    folder = safe.replace(" ", "_")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        def put(name, data, compress=True):
            zi = zipfile.ZipInfo("%s/%s" % (folder, name), date_time=time.localtime()[:6])
            zi.compress_type = zipfile.ZIP_DEFLATED if compress else zipfile.ZIP_STORED
            zi.external_attr = 0o644 << 16
            z.writestr(zi, data)
        put(res["filename"], audio, compress=False)
        if cover:
            put("Cover_3000x3000.jpg", cover, compress=False)
        put(f_meta, meta_txt.encode("utf-8"))
        if not instrumental:
            put(f_lyrics, (lines.strip() + "\n").encode("utf-8"))
        put(f_prov + "." + n_ext, nachweis_b)
        put(f_lic + "." + l_ext, lizenz_b)
        put(f_readme, readme.encode("utf-8"))
    data = buf.getvalue()
    # What applied to the package is also stored on the track — a later package says the same
    with FileLock(path):
        dj = _read_json(path[:-4] + ".json")
        dj["veroeffentlichung"] = {"text_eigen": text_eigen, "at": datetime.datetime.now().isoformat(timespec="seconds"),
                                   "sha256": sha, "datei": res["filename"]}
        _write_atomic(path[:-4] + ".json", json.dumps(dj, indent=2, ensure_ascii=False).encode("utf-8"))
    return {"data": data, "mime": "application/zip", "filename": T("%s_Paket.zip", "%s_Package.zip") % folder, "bytes": len(data),
            "pdf": n_ext == "pdf", "docx": l_ext == "docx", "cover3000": bool(cover), "sha256": sha}


# =============================================================================
# 3.10: 🌐 Publishing to the public listening site (public page, administration only inside the tailnet)
# =============================================================================
# Optional public page for free listening, limited to what the owner chooses to release.
# The Mac sends the MASTERED version as a 24-bit WAV (the site converts exactly once to MP3 320),
# plus cover and metadata, to the site's admin endpoint. It is reachable only via Tailscale
# and checks the Tailscale login — there is no key that could get lost.
# The same track (same archive path) replaces the old version when published again.
def _web(cfg, method, path, body=None, raw=None, ctype=None, timeout=60):
    base = (cfg.get("web_admin") or "").strip().rstrip("/")
    if not base:
        raise RuntimeError("Keine Fahrstuhlmusik-Seite eingetragen (bridge.json → web_admin)")
    h = {}
    data = None
    if body is not None:
        data, h["Content-Type"] = json.dumps(body).encode(), "application/json"
    if raw is not None:
        data, h["Content-Type"] = raw, ctype or "application/octet-stream"
    req = urllib.request.Request(base + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read() or b"{}").get("error") or e.reason
        except ValueError:
            msg = e.reason
        raise RuntimeError("Fahrstuhlmusik: %s (%s)" % (msg, e.code))
    except urllib.error.URLError as e:
        raise RuntimeError("Fahrstuhlmusik nicht erreichbar (%s) — ist Tailscale auf dem Mac an?" % getattr(e, "reason", e))


# ---- 3.12: Sing-along lyrics — timings of the sung lines (request: scrollable lyrics for karaoke) ----
# whisper.cpp listens to the PUBLISHED version (mastered, i.e. trimmed at the start) and returns words with times;
# an alignment (Needleman-Wunsch) maps them onto the known lyrics. Measured on a sample track: the lyrics as a
# hint (--prompt) and without context carry-over (-mc 0) also finds the second verse; a vocal filter did not help.
# Filler from instrumental parts ("Thank you.") stays without a partner and does no harm. Without whisper, the site estimates.
WHISPER_MODEL = os.path.join(DIR, "models", "whisper", "ggml-large-v3-turbo-q5_0.bin")
_WORD = re.compile(r"[^\w']+", re.U)


def _words(text: str) -> list:
    return [w for w in _WORD.sub(" ", (text or "").lower()).replace("'", "").split() if w]


def _similar(a: str, b: str) -> bool:
    if a == b:
        return True
    if min(len(a), len(b)) >= 4 and (a.startswith(b) or b.startswith(a)):
        return True
    import difflib
    return len(a) >= 3 and difflib.SequenceMatcher(None, a, b).ratio() >= 0.75


def align_lyrics(lyrics: str, heard: list, duration: float) -> dict:
    """lyrics: lyrics with [markers]; heard: [(word, start, end)] → {"lines": [{t, e, l}], "coverage": fraction}."""
    lines = [x.strip() for x in (lyrics or "").split("\n") if x.strip() and not re.fullmatch(r"\[.*\]", x.strip())]
    L = [(w, i) for i, ln in enumerate(lines) for w in _words(ln)]
    R = [(w, t0, t1) for (txt, t0, t1) in heard for w in _words(txt)]
    if not L or not R:
        return {"lines": [], "coverage": 0.0}
    n, m = len(L), len(R)
    GAP, MIS, HIT = -0.6, -1.0, 2.0
    sc = [[0.0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        sc[i][0] = i * GAP
    for j in range(1, m + 1):
        sc[0][j] = j * GAP * 0.3                     # heard words without lyrics (filler) are cheap
    for i in range(1, n + 1):
        li = L[i - 1][0]
        row, prev = sc[i], sc[i - 1]
        for j in range(1, m + 1):
            d = prev[j - 1] + (HIT if _similar(li, R[j - 1][0]) else MIS)
            row[j] = max(d, prev[j] + GAP, row[j - 1] + GAP * 0.3)
    hits = {}                                       # index in the lyrics → (start, end)
    i, j = n, m
    while i > 0 and j > 0:
        same = _similar(L[i - 1][0], R[j - 1][0])
        if sc[i][j] == sc[i - 1][j - 1] + (HIT if same else MIS):
            if same:
                hits[i - 1] = R[j - 1][1:]
            i, j = i - 1, j - 1
        elif sc[i][j] == sc[i - 1][j] + GAP:
            i -= 1
        else:
            j -= 1
    out, anchored = [], 0
    for k, ln in enumerate(lines):
        idx = [x for x in range(n) if L[x][1] == k]
        got = [(x, hits[x]) for x in idx if x in hits]
        if len(got) >= max(1, len(idx) // 3):
            anchored += 1
            first_pos = idx.index(got[0][0])
            t0 = got[0][1][0] - 0.35 * first_pos
            t1 = got[-1][1][1]
            # At the start after music, whisper stretches the first word over the whole pause — then compute from the line end
            if t1 - t0 > len(idx) * 0.9 + 1.0:
                t0 = t1 - len(idx) * 0.45 - 0.3
            out.append({"t": max(0.0, t0), "e": t1, "l": ln, "a": True})
        else:
            out.append({"t": None, "e": None, "l": ln, "a": False})
    known = [k for k, x in enumerate(out) if x["a"]]
    if not known:
        return {"lines": [], "coverage": 0.0}
    for k, x in enumerate(out):                     # spread gaps evenly between the neighbours
        if x["t"] is not None:
            continue
        a = max((q for q in known if q < k), default=None)
        b = min((q for q in known if q > k), default=None)
        if a is not None and b is not None:
            x["t"] = out[a]["e"] + (out[b]["t"] - out[a]["e"]) * (k - a) / (b - a)
        elif a is not None:
            x["t"] = min(duration or 1e9, out[a]["e"] + 3.0 * (k - a))
        else:
            x["t"] = max(0.0, out[b]["t"] - 3.0 * (b - k))
        x["e"] = x["t"] + 2.5
    last = -1.0
    for x in out:                                   # never backwards
        x["t"] = round(max(x["t"], last + 0.3), 2)
        x["e"] = round(max(x["e"], x["t"]), 2)
        last = x["t"]
        x.pop("a", None)
    return {"lines": out, "coverage": round(anchored / len(lines), 2)}


def _wav_seconds(data: bytes) -> float:
    import io
    try:
        with wave.open(io.BytesIO(data)) as w:
            return w.getnframes() / float(w.getframerate() or 1)
    except Exception:  # noqa: BLE001
        return 0.0


def lyrics_timing(cfg: dict, wav_bytes: bytes, lyrics: str, lang: str, duration: float) -> dict:
    """Timings for the lyrics from the finished version. {} if whisper is missing or recognises too little."""
    cli = tool(cfg, "whisper-cli")
    model = cfg.get("whisper_model") or WHISPER_MODEL
    if not cli or not os.path.isfile(model) or not (lyrics or "").strip():
        return {}
    ff = tool(cfg, "ffmpeg")
    import tempfile
    tmp = tempfile.mkdtemp(prefix="mws-karaoke-")
    try:
        src, w16 = os.path.join(tmp, "in.wav"), os.path.join(tmp, "a16.wav")
        with open(src, "wb") as f:
            f.write(wav_bytes)
        subprocess.run([ff, "-v", "error", "-y", "-i", src, "-ar", "16000", "-ac", "1", w16], check=True, timeout=300)
        hint = " ".join(dict.fromkeys(x.strip() for x in lyrics.split("\n") if x.strip() and not x.strip().startswith("[")))[:600]
        cmd = [cli, "-m", model, "-f", w16, "-ml", "1", "-sow", "-mc", "0", "-oj", "-of", os.path.join(tmp, "out"), "-np",
               "-l", lang if re.fullmatch(r"[a-z]{2}", lang or "") else "auto", "--prompt", hint]
        subprocess.run(cmd, capture_output=True, timeout=900)
        try:
            seg = json.load(open(os.path.join(tmp, "out.json"), encoding="utf-8", errors="replace"))["transcription"]
        except (OSError, ValueError, KeyError):
            return {}
        heard = [(x.get("text", ""), x["offsets"]["from"] / 1000.0, x["offsets"]["to"] / 1000.0) for x in seg if (x.get("text") or "").strip()]
        res = align_lyrics(lyrics, heard, duration)
        if res["coverage"] < 0.3:
            log("Mitsingen: zu wenig erkannt (%.0f %%) — die Seite schätzt" % (res["coverage"] * 100))
            return {}
        res["source"] = "whisper large-v3-turbo · %d %% erkannt" % round(res["coverage"] * 100)
        return res
    finally:
        import shutil
        shutil.rmtree(tmp, ignore_errors=True)


# ---- 3.12.2: Bilingual note (request: the text describing the titles is not translated when the English version of
# the site is selected) — notes are sometimes German, sometimes English; the missing language is written by the
# language model on the Mac. Without a model it stays empty and the site then shows the one that exists.
TRANSLATE_SYSTEM = {
    "en": "Translate the user's German text into natural, fluent English. Keep music terms (breakdown, drop, BPM, synth, "
          "pads) as they are, keep names and titles unchanged, fix obvious typos. Reply with the translation only.",
    "de": "Übersetze den englischen Text des Nutzers in natürliches, flüssiges Deutsch. Musikbegriffe (Breakdown, Drop, BPM, "
          "Synth, Pads) bleiben, Namen und Titel bleiben unverändert, offensichtliche Tippfehler korrigieren. Antworte nur mit "
          "der Übersetzung.",
}


def is_german(text: str) -> bool:
    words = re.findall(r"[a-zäöüß]+", (text or "").lower())
    return sum(w in DE_WORDS for w in words) >= 2 or bool(re.search(r"[äöüß]", text or ""))


def translate_text(cfg: dict, text: str, target: str) -> str:
    model = find_writer(cfg)
    if not model or not (text or "").strip():
        return ""
    body = {"model": model, "stream": False,
            "messages": [{"role": "system", "content": TRANSLATE_SYSTEM[target]}, {"role": "user", "content": text}],
            "options": {"temperature": 0.2, "num_ctx": 4096}}
    answer = writer_chat(cfg, body, 180)
    out = ((answer.get("message") or {}).get("content") or "").strip().strip('"„“”')
    # Accept only what is really in the target language and does not merely repeat the original
    if not out or out == text.strip() or is_german(out) != (target == "de"):
        return ""
    return out[:1500]


def note_languages(cfg: dict, note: str) -> tuple:
    """→ (note_de, note_en). The language of the note is detected, the other one is translated."""
    note = (note or "").strip()
    if not note:
        return "", ""
    de = is_german(note)
    try:
        other = translate_text(cfg, note, "en" if de else "de")
    except Exception as e:  # noqa: BLE001
        log("Notiz nicht übersetzt: %s" % e)
        other = ""
    return (note, other) if de else (other, note)


def web_publish(cfg, path, req, tick=None):
    # 3.12.3: without controls sent along (publishing without the browser), the default mastering applied up to now and
    # the track's own controls were missing online. Now: the controls the studio stored on the Mac.
    given = clean_master(req.get("master"))
    if given is None:
        given = clean_master(_read_json(path[:-4] + ".json").get("master"))
    fin = veredeln(cfg, path, req, want_cover=False, tick=tick)
    if rights(cfg)["watermark"] and not fin["id"]:
        raise RuntimeError("Wasserzeichen fehlt — Veröffentlichen abgebrochen")
    info = info_from_archive(path, req)
    d = _read_json(path[:-4] + ".json")
    if tick:
        tick("Gemasterte Fassung für die Seite …")
    res = export_track(cfg, path, "wav", 0, info, tick, master=given, bits=24)
    tags = track_tags(cfg, dict(info, cover_model=(d.get("cover") or {}).get("model", "")))
    cov = (d.get("cover") or {}).get("model", "")
    cov_name = next((n.split(" (")[0] for k, n, _l, _u in MODEL_LICENSES if k in cov), cov)
    lang = (d.get("request") or {}).get("vocal_language") or (d.get("result") or {}).get("vocal_language") or ""
    lyrics = tags.get("lyrics") or ""
    # 3.12.1: public without "(Version A)" — the owner could not change that version label anywhere
    title = re.sub(r"\s*\(Version [A-Z]\)$", "", tags.get("title") or info.get("title") or "Track")
    meta = {"title": title, "artist": tags.get("artist") or "",
            "genre": tags.get("genre") or "", "bpm": tags.get("bpm") or "0", "key": tags.get("key") or "", "lyrics": lyrics,
            "note": info.get("note") or "", "language": (LANG_DE.get(lang, lang) if lyrics.strip() else "Instrumental"),
            "tools": ("Manuwave Studio · selbst eingespielt" if info.get("source") == "eigen" else "Manuwave Studio · ACE-Step 1.5")
            + (" · " + cov_name if cov_name else ""),
            "ai_note": ("Musik selbst eingespielt" + (" · Cover KI-erzeugt" if cov_name else "")) if info.get("source") == "eigen" else "KI-erzeugt",
            "ext_id": rel_home(path)}
    if meta["note"]:
        if tick:
            tick("Notiz wird übersetzt …")
        meta["note_de"], meta["note_en"] = note_languages(cfg, meta["note"])
    if tick:
        tick("Übertrage an Fahrstuhlmusik …")
    r = _web(cfg, "POST", "/api/admin/track", meta)
    tid = r["id"]
    _web(cfg, "PUT", "/api/admin/track/%s/audio" % tid, raw=res["data"], ctype="audio/wav", timeout=900)
    jpeg = _read_bytes(path[:-4] + ".jpg")
    if jpeg:
        _web(cfg, "PUT", "/api/admin/track/%s/cover" % tid, raw=jpeg, ctype="image/jpeg", timeout=300)
    if tick:
        tick("Fahrstuhlmusik wandelt um …")
    f = _web(cfg, "POST", "/api/admin/track/%s/fertig" % tid, {}, timeout=900)
    if lyrics.strip():
        # 3.12: sing-along timings — a failure here does not stop the publication
        try:
            if tick:
                tick("Liedtext wird an die Musik angelegt …")
            tm = lyrics_timing(cfg, res["data"], lyrics, lang, _wav_seconds(res["data"]))
            if tm.get("lines"):
                _web(cfg, "PUT", "/api/admin/track/%s/timing" % (f.get("id") or tid), {"lines": tm["lines"], "source": tm["source"]})
                log("Mitsingen: %d Zeilen, %s" % (len(tm["lines"]), tm["source"]))
        except Exception as e:  # noqa: BLE001
            log("Mitsingen nicht möglich: %s" % e)
    with FileLock(path):
        d = _read_json(path[:-4] + ".json")
        d["oeffentlich"] = {"id": f.get("id") or tid, "slug": f.get("slug", ""), "url": f.get("url", ""),
                            "at": datetime.datetime.now().isoformat(timespec="seconds"), "master": given}
        _write_atomic(path[:-4] + ".json", json.dumps(d, indent=2, ensure_ascii=False).encode("utf-8"))
    log("Veröffentlicht: %s → %s%s" % (meta["title"], f.get("url", ""), " (ersetzt)" if r.get("replaces") else ""))
    return {"url": f.get("url", ""), "slug": f.get("slug", ""), "id": f.get("id") or tid, "replaced": bool(r.get("replaces"))}


def web_withdraw(cfg, path):
    d = _read_json(path[:-4] + ".json")
    pub = d.get("oeffentlich") or {}
    if pub.get("id"):
        try:
            _web(cfg, "POST", "/api/admin/track/%s/zurueckziehen" % pub["id"], {"reason": "Vom Künstler zurückgezogen"})
        except RuntimeError as e:
            if "(404)" not in str(e):            # already gone = goal reached
                raise
    with FileLock(path):
        d = _read_json(path[:-4] + ".json")
        d.pop("oeffentlich", None)
        _write_atomic(path[:-4] + ".json", json.dumps(d, indent=2, ensure_ascii=False).encode("utf-8"))
    log("Von Fahrstuhlmusik zurückgezogen: %s" % os.path.basename(path))
    return {"withdrawn": True}


# =============================================================================
# Storage on the Mac
# =============================================================================

# =============================================================================
# 3.14: Sound check — a listening-judgement model rates each version, weak ones are re-rolled
# =============================================================================
# An audio aesthetics model (CC-BY 4.0) predicts four values (1–10) from the audio: CE enjoyment, CU usefulness,
# PC complexity, PQ production quality — trained on human judgements. Measured on 16.10.2026 on the maintainer's archive:
# all kept tracks CE 7.39–7.79, the one deleted as failed 6.87 — simple signal measures
# (clicks, tempo, key) did NOT separate them. Runs in its own environment ($MWS_HOME/qa, PyTorch) on the CPU so that
# the GPU stays free; if it is missing, the check is simply off.
QA_MIN_CE = 7.2
QA_DIR = os.path.join(DIR, "qa")
QA_SCRIPT = r"""
import json, os, subprocess, sys
import numpy as np, torch
torch.set_num_threads(max(1, (os.cpu_count() or 4) // 2))
from audiobox_aesthetics.infer import initialize_predictor
pred = initialize_predictor()
for path in sys.argv[1:]:
    raw = subprocess.run([os.environ.get("MWS_FFMPEG", "ffmpeg"), "-v", "error", "-i", path, "-ac", "1", "-ar", "16000",
                          "-f", "f32le", "-"], capture_output=True, check=True).stdout
    x = torch.from_numpy(np.frombuffer(raw, dtype=np.float32).copy()).unsqueeze(0)
    r = pred.forward([{"path": x, "sample_rate": 16000}])[0]
    print(json.dumps({k: round(float(v), 3) for k, v in r.items()}), flush=True)
"""


def qa_python() -> str:
    p = os.path.join(QA_DIR, "Scripts", "python.exe") if IS_WIN else os.path.join(QA_DIR, "bin", "python")
    return p if os.path.isfile(p) else ""


def qa_score_file(cfg: dict, path: str):
    """→ {"CE":…, "CU":…, "PC":…, "PQ":…} or None (not installed / error — then continue without a check)."""
    py = qa_python()
    if not py:
        return None
    script = os.path.join(QA_DIR, "score.py")
    try:
        if _read_bytes(script) != QA_SCRIPT.encode():
            _write_atomic(script, QA_SCRIPT.encode())
        env = dict(os.environ, HF_HOME=os.path.join(QA_DIR, "hf"), MWS_FFMPEG=tool(cfg, "ffmpeg") or "ffmpeg",
                   PYTORCH_ENABLE_MPS_FALLBACK="1")
        r = subprocess.run([py, script, path], capture_output=True, timeout=900, env=env)
        lines = [x for x in r.stdout.decode(errors="replace").splitlines() if x.startswith("{")]
        if r.returncode != 0 or not lines:
            log("Klangprüfung nicht möglich: %s" % r.stderr.decode(errors="replace").strip()[-200:])
            return None
        return json.loads(lines[-1])
    except Exception as e:  # noqa: BLE001
        log("Klangprüfung nicht möglich: %s" % e)
        return None


def qa_score(cfg: dict, audio: bytes):
    with Scratch() as s:
        p = s.path("probe.wav")
        with open(p, "wb") as f:
            f.write(audio)
        return qa_score_file(cfg, p)


def qa_min(cfg: dict) -> float:
    try:
        return float(cfg.get("qa_min_ce") or QA_MIN_CE)
    except (TypeError, ValueError):
        return QA_MIN_CE


def put_aside(job: dict, audio: bytes, meta: dict) -> str:
    """Set aside a discarded version (renders/_verworfen/<day>/) — to listen later whether the threshold is right.
    Underscore folders do not belong to the archive (library, "fetch from the Mac")."""
    folder = os.path.join(RENDERS, "_verworfen", datetime.date.today().isoformat())
    os.makedirs(folder, exist_ok=True)
    title = (job.get("meta") or {}).get("title") or "Manuwave Studio"
    safe = re.sub(r"[^\w\- äöüÄÖÜß]+", "", title).strip().replace(" ", "_")[:50] or "Manuwave_Studio"
    base = os.path.join(folder, "%s_%s_%s" % (time.strftime("%H%M%S"), safe, meta.get("seed", "")))
    with open(base + ".wav", "wb") as f:
        f.write(audio)
    with open(base + ".json", "w", encoding="utf-8") as f:
        json.dump({"request": job.get("request"), "meta": job.get("meta"), "result": {k: v for k, v in meta.items() if k != "audio_codes"}},
                  f, indent=2, ensure_ascii=False)
    return base + ".wav"


def render_checked(cfg: dict, eng, srv, job: dict, tick):
    """Render, rate, re-roll on a weak rating (new seed = new plan from the language model) —
    at most `qa_reroll` times, the best version is kept."""
    request = job.get("request") or {}
    audio, meta = eng.render(request, tick)
    if not qa_python():
        return audio, meta
    try:
        extra = max(0, min(3, int(request.get("qa_reroll", cfg.get("qa_reroll", 2)))))
    except (TypeError, ValueError):
        extra = 2
    floor = qa_min(cfg)
    tick("Klangprüfung …")
    cands = [(qa_score(cfg, audio), audio, meta)]
    while extra and (cands[-1][0] or {}).get("CE", 99) < floor and len(cands) <= extra:
        ce = cands[-1][0]["CE"]
        if tick("Klangprüfung %.1f — unter %.1f, neue Fassung (%d/%d) …" % (ce, floor, len(cands), extra)):
            raise Cancelled()
        log("Klangprüfung %.2f < %.2f — würfle neu (%d/%d)" % (ce, floor, len(cands), extra))
        a2, m2 = eng.render(dict(request, seed=-1), tick)
        tick("Klangprüfung …")
        cands.append((qa_score(cfg, a2), a2, m2))
    best = max(range(len(cands)), key=lambda i: (cands[i][0] or {}).get("CE", -1))
    for i, (sc, a, m) in enumerate(cands):
        if i != best:
            put_aside(job, a, dict(m, qa=sc))
    sc, audio, meta = cands[best]
    if sc:
        meta["qa"] = dict(sc, schwelle=floor, versuche=len(cands), alle=[round((c[0] or {}).get("CE", 0), 2) for c in cands])
        log("Klangprüfung: Hörgenuss %.2f, Qualität %.2f (%d Fassung%s, beste behalten)" % (
            sc.get("CE", 0), sc.get("PQ", 0), len(cands), "" if len(cands) == 1 else "en"))
    return audio, meta


# =============================================================================
# 3.14: Long tracks — main part in one pass, then append section by section
# =============================================================================
# According to its tutorial, ACE-Step 1.5 is stable at 2–4 min; beyond that, repetitions and tempo jumps (issue #1203, XL > 3 min).
# Repaint extends beyond the source end (acestep.cpp ARCHITECTURE.md: end > source duration = outpaint), but cuts
# the seam hard — therefore: the last LONG_CTX s as source, recompute from LONG_OVERLAP before its end (the model
# builds the transition itself) and crossfade equal-power within the source itself (both sides are the same piece there).
LONG_SINGLE = 240.0    # up to here a single pass as before
LONG_MAIN = 220.0      # main part of a long track
LONG_PART = 80.0       # per extension (officially 3–90 s)
LONG_CTX = 30.0
LONG_OVERLAP = 4.0
LONG_FADE = 1.0
LONG_TRIES = 2         # attempts per extension; with the sound check the best one is kept
# Overhang: every segment (except the last) is computed LONG_OVERHANG s longer and this remainder is thrown away.
# 🔴 Measured in the first real test (16.10.2026, 380 s): the model plans the 220 s main part as a whole song
#    with an outro (last 20 s −17.6 dB versus −13 dB before), and the extension attached to an ending (+7 dB after the seam).
LONG_OVERHANG = 20.0
SECTION_WEIGHT = {"intro": 0.6, "outro": 0.6, "build": 0.7, "pre-chorus": 0.7, "bridge": 0.8, "interlude": 0.7}


def wav_info(audio: bytes):
    with wave.open(io.BytesIO(audio)) as w:
        return w.getparams(), w.readframes(w.getnframes())


def wav_bytes(params, frames: bytes) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(params.nchannels)
        w.setsampwidth(params.sampwidth)
        w.setframerate(params.framerate)
        w.writeframes(frames)
    return buf.getvalue()


def wav_cut(audio: bytes, seconds: float) -> bytes:
    """Keep the first `seconds`."""
    p, fr = wav_info(audio)
    fs = p.nchannels * p.sampwidth
    return wav_bytes(p, fr[: min(len(fr), int(seconds * p.framerate) * fs)])


def wav_seconds(audio: bytes) -> float:
    with wave.open(io.BytesIO(audio)) as w:
        return w.getnframes() / float(w.getframerate())


def wav_tail(audio: bytes, seconds: float):
    """→ (WAV of the last `seconds`, actual length in s)"""
    p, fr = wav_info(audio)
    fs = p.nchannels * p.sampwidth
    n = min(len(fr) // fs, int(seconds * p.framerate))
    return wav_bytes(p, fr[len(fr) - n * fs:]), n / p.framerate


def stitch(a: bytes, o: bytes, ctx_s: float, overlap: float = LONG_OVERLAP, fade: float = LONG_FADE) -> bytes:
    """Existing `a` + repaint result `o` (starts with the last ctx_s seconds of a). Cut `overlap` before the
    end of a; before that `fade` seconds crossfaded equal-power (sin/cos) — there a and o are the same piece."""
    import array
    pa, fa = wav_info(a)
    po, fo = wav_info(o)
    if (pa.nchannels, pa.sampwidth, pa.framerate) != (po.nchannels, po.sampwidth, po.framerate) or pa.sampwidth != 2:
        raise RuntimeError("Anbau: Tonformat passt nicht (%s / %s)" % (pa[:3], po[:3]))
    ch, sr = pa.nchannels, pa.framerate
    la = len(fa) // (2 * ch)
    cut_a = la - int(overlap * sr)
    cut_o = int(round((ctx_s - overlap) * sr))
    f = int(fade * sr)
    if cut_a - f < 0 or cut_o - f < 0 or len(fo) // (2 * ch) <= cut_o:
        raise RuntimeError("Anbau: zu kurz zum Überblenden")
    xa = array.array("h", fa[(cut_a - f) * 2 * ch: cut_a * 2 * ch])
    xo = array.array("h", fo[(cut_o - f) * 2 * ch: cut_o * 2 * ch])
    mix = array.array("h", bytes(len(xa) * 2))
    for i in range(len(xa)):
        t = (i // ch) / max(1, f)
        v = xa[i] * math.cos(t * math.pi / 2) + xo[i] * math.sin(t * math.pi / 2)
        mix[i] = max(-32768, min(32767, int(v)))
    return wav_bytes(pa, fa[: (cut_a - f) * 2 * ch] + mix.tobytes() + fo[cut_o * 2 * ch:])


def plan_long(lyrics: str, total: float):
    """Distribute the sections of the lyrics over main part and extensions (by rough weight per section type).
    → (lyrics of main part, [(lyrics, description) per extension], length per extension)"""
    blocks = [x.strip() for x in (lyrics or "").split("\n\n") if x.strip()]
    n = max(1, math.ceil((total - LONG_MAIN) / LONG_PART))
    part = (total - LONG_MAIN) / n
    if not blocks:
        return "[Instrumental]", [("[Instrumental]", "") for _ in range(n)], part
    w = []
    for blk in blocks:
        head = blk.split("\n")[0].strip("[] ").lower()
        w.append(next((v for k, v in SECTION_WEIGHT.items() if head.startswith(k)), 1.0))
    tot, acc, starts = sum(w), 0.0, []
    for x in w:
        starts.append(acc / tot * total)
        acc += x
    # distribute by POSITION, never by text — a chorus occurs several times with identical words
    k_main = max(1, sum(1 for st in starts if st < LONG_MAIN - 10))
    main = blocks[:k_main]
    parts, used = [], k_main
    for i in range(n):
        hi = LONG_MAIN + (i + 1) * part - 10
        k = len(blocks) if i == n - 1 else max(used, sum(1 for st in starts if st < hi))
        mine, used = blocks[used:k], k
        desc = ", ".join(m.split(" - ", 1)[1] for m in (b.split("\n")[0].strip("[] ") for b in mine) if " - " in m)
        parts.append(("\n\n".join(mine) or "[Instrumental]", desc))
    return "\n\n".join(main), parts, part


def render_long(cfg: dict, eng, srv, job: dict, tick):
    request = job.get("request") or {}
    total = min(600.0, float(request.get("duration") or 0))
    main_lyrics, parts, part_s = plan_long(request.get("lyrics") or "", total)
    # Main part: no soft fade-out — it is extended at its end
    sub = dict(job, request=dict(request, duration=LONG_MAIN + LONG_OVERHANG, lyrics=main_lyrics, smooth_end=False))
    audio, meta = render_checked(cfg, eng, srv, sub, tick)
    audio = wav_cut(audio, LONG_MAIN)             # drop the outro of the main part — it continues here
    floor, qa_on = qa_min(cfg), bool(qa_python())
    tries = LONG_TRIES if qa_on else 1
    stats = []
    for i, (lyr, desc) in enumerate(parts):
        ctx, ctx_s = wav_tail(audio, LONG_CTX)
        caption = (request.get("caption") or "") + ((", " + desc) if desc else "")
        last = i == len(parts) - 1
        extra = 0.0 if last else LONG_OVERHANG
        req = {"task_type": "repaint", "caption": caption, "lyrics": lyr,
               "repainting_start": round(ctx_s - LONG_OVERLAP, 3), "repainting_end": round(ctx_s + part_s + extra, 3),
               "inference_steps": int(request.get("inference_steps") or 50), "guidance_scale": float(request.get("guidance_scale") or 7.0),
               "synth_model": os.path.basename(meta.get("dit") or cfg["synth_model"]), "output_format": "wav16", "peak_clip": 0}
        for k in ("bpm", "keyscale", "timesignature", "vocal_language"):
            if meta.get(k) or request.get(k):
                req[k] = meta.get(k) or request.get(k)
        cands = []
        for t in range(tries):
            if tick("Langer Titel: Teil %d/%d, Versuch %d …" % (i + 2, len(parts) + 1, t + 1)):
                raise Cancelled()
            out = eng.repaint(dict(req, seed=random.randint(0, 2 ** 31 - 1)), ctx, tick)
            joined = stitch(audio, out, ctx_s)
            if extra:
                joined = wav_cut(joined, wav_seconds(joined) - extra)
            sc = qa_score(cfg, joined) if qa_on else None
            cands.append((sc, joined))
            if not qa_on or (sc or {}).get("CE", 0) >= floor:
                break
        best = max(cands, key=lambda c: (c[0] or {}).get("CE", -1))
        audio = best[1]
        stats.append({"versuche": len(cands), "CE": [round((c[0] or {}).get("CE", 0), 2) for c in cands]})
        log("Langer Titel: Teil %d/%d angebaut (%d Versuch%s)" % (i + 2, len(parts) + 1, len(cands), "" if len(cands) == 1 else "e"))
    if request.get("smooth_end", True):
        audio, info = smooth_end(audio)
        if info:
            meta["ende"] = info
    with wave.open(io.BytesIO(audio)) as w:
        meta["duration_real"] = round(w.getnframes() / float(w.getframerate()), 2)
    meta["duration"] = total
    meta["teile"] = {"haupt_s": LONG_MAIN, "anbau_s": round(part_s, 1), "anbauten": stats}
    if qa_on:
        sc = qa_score(cfg, audio)
        if sc:
            meta["qa"] = dict(meta.get("qa") or {}, **sc)
    return audio, meta


# =============================================================================
# 3.17: Loop machine → the music AI keeps building
# =============================================================================
# Two ways — sing something in or give a few bars, the machine takes over the rest:
#   continue — your jam is the beginning, the music AI keeps playing (repaint backwards, from the end of the jam).
#                🔑 measured 19.10.2026: beginning = jam (correlation 1.00), continuation in time (122.3 instead of 124 BPM),
#                but 7 dB quieter than the jam → the continuation is brought to the level of the jam.
#   vocals     — a sung-in loop is repeated to song length and completed (complete): the AI plays
#                drums, bass, keys … along. 🔑 measured: XL-Base −15/−30 dB drums/bass, XL-SFT −22/−54 (bass missing)
#                → Base, if available. The AI newly sings along (17 dB below the band, smeared) → Demucs removes its
#                voice, YOUR voice goes on top at a fitting volume (can be turned off: "stimme": "ki").
WEITER_MAX = 240.0
WEITER_TRACKS = ("drums", "bass", "keyboard", "synth", "guitar", "strings", "percussion", "brass", "woodwinds", "fx", "backing_vocals")


def pcm16_48k(audio: bytes) -> bytes:
    """Any PCM WAV (16/24/32 bit, mono/stereo, any rate) → 16 bit, stereo, 48 kHz."""
    p, fr = wav_info(audio)
    if p.comptype != "NONE":
        raise RuntimeError("Quelle: nur unkomprimiertes WAV")
    if audioop is None:
        if (p.sampwidth, p.nchannels, p.framerate) != (2, 2, 48000):
            raise RuntimeError("Quelle: dieses Python kann das Tonformat nicht wandeln (audioop fehlt)")
        return audio
    if p.sampwidth != 2:
        fr = audioop.lin2lin(fr, p.sampwidth, 2)
    if p.nchannels == 1:
        fr = audioop.tostereo(fr, 2, 1, 1)
    elif p.nchannels != 2:
        raise RuntimeError("Quelle: mehr als zwei Kanäle")
    if p.framerate != 48000:
        fr, _ = audioop.ratecv(fr, 2, 2, p.framerate, 48000, None)
    import types
    return wav_bytes(types.SimpleNamespace(nchannels=2, sampwidth=2, framerate=48000), fr)


def wav_loop(audio: bytes, seconds: float) -> bytes:
    """Repeat a loop until `seconds` are filled (the loop is bar-exact — no crossfade needed)."""
    p, fr = wav_info(audio)
    fs = p.nchannels * p.sampwidth
    want = int(seconds * p.framerate) * fs
    out = fr * (want // max(1, len(fr)) + 1)
    return wav_bytes(p, out[:want])


def _rms_active(fr: bytes) -> float:
    """RMS only over the loud passages (vocals have pauses — they must not push the level down)."""
    win, vals = 4800 * 4, []
    for i in range(0, len(fr) - win, win):
        vals.append(audioop.rms(fr[i:i + win], 2))
    if not vals:
        return 0.0
    vals.sort()
    top = vals[len(vals) // 2:] or vals
    return sum(top) / len(top)


def _normalize(fr: bytes, ceil: float = 0.89) -> bytes:
    pk = audioop.max(fr, 2) if fr else 0
    return audioop.mul(fr, 2, ceil * 32767 / pk) if pk > ceil * 32767 else fr


def level_match(audio: bytes, from_s: float, ramp_s: float = 0.5) -> bytes:
    """Bring the continuation (from `from_s`) to the level of the jam before it — smoothly over `ramp_s`."""
    if audioop is None:
        return audio
    p, fr = wav_info(audio)
    if p.sampwidth != 2:
        return audio
    fs = p.nchannels * 2
    cut = int(from_s * p.framerate) * fs
    a, b = fr[:cut], fr[cut:]
    ra, rb = _rms_active(a), _rms_active(b)
    if ra <= 0 or rb <= 0:
        return audio
    g = max(0.5, min(2.8, ra / rb))
    if abs(g - 1) < 0.06:
        return audio
    n_ramp = min(len(b) // fs, int(ramp_s * p.framerate))
    head = b[:n_ramp * fs]
    import array
    x = array.array("h", head)
    for i in range(len(x)):
        k = 1 + (g - 1) * ((i // p.nchannels) / max(1, n_ramp))
        x[i] = max(-32768, min(32767, int(x[i] * k)))
    tail = audioop.mul(b[n_ramp * fs:], 2, g)
    return wav_bytes(p, _normalize(a + x.tobytes() + tail))


def voice_on_top(cfg: dict, band_with_ai_voice: bytes, voice: bytes, tick) -> (bytes, str):
    """Demucs removes the newly sung AI voice from the band, your voice goes on top. → (audio, note)"""
    py = midi_python()
    if not py or audioop is None:
        return band_with_ai_voice, "ohne Demucs: die KI-Stimme bleibt"
    import shutil
    import tempfile
    tmp = tempfile.mkdtemp(prefix="mws-stimme-")
    try:
        src = os.path.join(tmp, "band.wav")
        _write_atomic(src, band_with_ai_voice)
        env = dict(os.environ, TORCH_HOME=os.path.join(MIDI_DIR, "torch"), HF_HOME=os.path.join(MIDI_DIR, "hf"), PYTORCH_ENABLE_MPS_FALLBACK="1")
        tick("Deine Stimme kommt nach vorn …")
        args = [py, "-m", "demucs", "--two-stems", "vocals", "-o", tmp] + (["-d", "mps"] if sys.platform == "darwin" else [])
        r = subprocess.run(args + [src], capture_output=True, env=env, timeout=900)
        stem = os.path.join(tmp, "htdemucs", "band", "no_vocals.wav")
        if r.returncode != 0 or not os.path.isfile(stem):
            return band_with_ai_voice, "Demucs fehlgeschlagen — die KI-Stimme bleibt"
        band = pcm16_48k(_read_bytes(stem))
        pb, fb = wav_info(band)
        pv, fv = wav_info(pcm16_48k(voice))
        n = min(len(fb), len(fv))
        fb, fv = fb[:n], fv[:n]
        rb, rv = _rms_active(fb), _rms_active(fv)
        # Vocals up front: active voice ~2 dB below the band — measured (Demucs): voice −16 dB, drums −17, mix −13
        g = (rb * 0.8 / rv) if rv > 0 else 1.0
        g = max(0.25, min(6.0, g))
        mix = audioop.add(audioop.mul(fb, 2, 0.85), audioop.mul(fv, 2, g * 0.85), 2)
        return wav_bytes(pb, _normalize(mix)), "deine Stimme über der KI-Band"
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def render_weiter(cfg: dict, eng, srv, job: dict, tick):
    request = job.get("request") or {}
    mode = request.get("mode")
    data = srv.upload(job["id"])
    if not (data[:4] == b"RIFF" and data[8:12] == b"WAVE"):
        raise RuntimeError("Quelle ist kein WAV")
    src = pcm16_48k(data)
    src_s = wav_seconds(src)
    if src_s < 2:
        raise RuntimeError("Quelle zu kurz (unter 2 s)")
    total = max(src_s + 10, min(WEITER_MAX, float(request.get("duration") or 90)))
    seed = int(request.get("seed") if isinstance(request.get("seed"), int) and request.get("seed") >= 0 else random.randint(0, 2 ** 31 - 1))
    base = {"caption": request.get("caption") or "instrumental", "inference_steps": 50, "seed": seed,
            "guidance_scale": float(cfg.get("guidance_scale") or 7.0), "output_format": "wav16", "peak_clip": 0, "timesignature": "4"}
    for k in ("bpm", "keyscale"):
        if request.get(k):
            base[k] = request[k]
    t0 = time.monotonic()
    meta = {"seed": seed, "caption": base["caption"], "bpm": base.get("bpm"), "keyscale": base.get("keyscale"),
            "weiter": {"mode": mode, "quelle_s": round(src_s, 2)}}
    if mode == "gesang":
        model = eng.model_file(tick, "xl-base", "base", "xl-sft", "sft") or cfg["synth_model"]
        if "base" not in model:
            meta["weiter"]["hinweis"] = "ohne Base-Modell gerechnet — der Bass wird schwächer (Installer: Loop-Maschine-KI)"
        tracks = [t for t in (request.get("tracks") or []) if t in WEITER_TRACKS] or ["drums", "bass", "keyboard", "synth"]
        canvas = wav_loop(src, total)
        req = dict(base, task_type="complete", track=" | ".join(tracks), lyrics=request.get("lyrics") or "", synth_model=model)
        tick("Die Musik-KI spielt die Band zu deinem Gesang …")
        audio = eng.with_source(req, canvas, tick, "Band zum Gesang")
        if request.get("stimme", "original") == "original":
            audio, note = voice_on_top(cfg, audio, canvas, tick)
            meta["weiter"]["stimme"] = note
    elif mode == "fortsetzen":
        model = eng.model_file(tick, "xl-sft", "sft") or cfg["synth_model"]
        req = dict(base, task_type="repaint", lyrics=request.get("lyrics") or "[Instrumental]",
                   repainting_start=round(src_s, 3), repainting_end=round(total, 3), synth_model=model)
        tick("Die Musik-KI spielt deinen Jam weiter …")
        audio = eng.with_source(req, src, tick, "Weiterspielen")
        audio = level_match(audio, src_s)
    else:
        raise RuntimeError("Unbekannter Weg: %s" % mode)
    meta["dit"] = model
    if request.get("smooth_end", True):
        audio, info = smooth_end(audio)
        if info:
            meta["ende"] = info
    meta["render_s"] = round(time.monotonic() - t0, 1)
    meta["duration_real"] = round(wav_seconds(audio), 2)
    meta["peak_clip"] = 0
    eng.last_used = time.time()
    return audio, meta


def archive(cfg, job, audio, meta) -> str:
    if not cfg.get("keep_renders", True):
        return ""
    day = datetime.date.today().isoformat()
    folder = os.path.join(RENDERS, day)
    os.makedirs(folder, exist_ok=True)
    title = (job.get("meta") or {}).get("title") or "Manuwave Studio"
    safe = re.sub(r"[^\w\- äöüÄÖÜß]+", "", title).strip().replace(" ", "_")[:50] or "Manuwave_Studio"
    var = (job.get("meta") or {}).get("variant", "")
    base = "%s_%s%s_%s" % (time.strftime("%H%M%S"), safe, ("_" + var) if var else "", meta.get("seed", ""))
    wav = os.path.join(folder, base + ".wav")
    with open(wav, "wb") as f:
        f.write(audio)
    begleit = {"request": job.get("request"), "meta": job.get("meta"), "result": meta}
    vorgabe = master_vorgabe(cfg)
    if vorgabe:                     # 3.27: "default for new tracks" — applies from creation on, even without a browser
        m = dict(vorgabe)
        ae = auto_end(wav)
        if ae and "fade_out" not in m:
            m["end"], m["fade_out"] = ae
        elif ae:
            m["end"] = ae[0]
        begleit["master"] = m
    with open(os.path.join(folder, base + ".json"), "w", encoding="utf-8") as f:
        json.dump(begleit, f, indent=2, ensure_ascii=False)
    return wav


# =============================================================================
# Jobs around finishing
# =============================================================================

class NeedUpload(Exception):
    pass


# The browser recognises this prefix and sends the track along on the second attempt.
ARCHIV_FEHLT = "ARCHIV_FEHLT: Der Mac hat diesen Track nicht (mehr) — der Browser schickt ihn mit."
MAX_FILE = 64 * 1024 * 1024
MAX_EXPORT = 120 * 1024 * 1024   # 3.4: 24 bit — the server accepts up to 128 MB


def job_source(cfg: dict, srv, job: dict) -> str:
    req = job.get("request") or {}
    path = archive_path(req.get("archived") or "")
    if path:
        return path
    if job.get("has_upload"):
        data = srv.upload(job["id"])
        if not (data[:4] == b"RIFF" and data[8:12] == b"WAVE"):
            raise RuntimeError("Der mitgeschickte Track ist keine WAV-Datei")
        path = archive_upload(cfg, data, req)
        log("aus dem Browser ins Archiv übernommen: %s (gesucht war: %s)" % (rel_home(path), req.get("archived") or "—"))
        return path
    log("Archiv: %s nicht gefunden (%s) — der Browser schickt den Track mit" % (req.get("archived") or "kein Pfad", job.get("kind")))
    raise NeedUpload()


def archive_list() -> list:
    """What is in this Mac's archive, so the browser can fetch what it is missing
    (new device, aborted handover, deleted library)."""
    out = []
    for p in all_archived():
        d = _read_json(p[:-4] + ".json")
        meta, res = d.get("meta") or {}, d.get("result") or {}
        m = re.search(r"/(\d{4}-\d{2}-\d{2})/(\d{6})?", p)
        out.append({"archived": rel_home(p), "title": meta.get("title") or os.path.basename(p)[:-4],
                    "variant": meta.get("variant", ""), "created": m.group(1) if m else "",
                    "time": (m.group(2) or "") if m else "", "duration": res.get("duration_real") or res.get("duration") or 0,
                    "cover": os.path.isfile(p[:-4] + ".jpg"), "wm": (d.get("wasserzeichen") or {}).get("id", ""),
                    "stamp": str((d.get("cover") or {}).get("stamp") or ""),
                    "rev": int((d.get("aufbereitet") or {}).get("v") or 0),
                    # 3.12: published? — the browser reconciles its 🌐 with this (also after publishing without it)
                    "web": {k: (d.get("oeffentlich") or {}).get(k, "") for k in ("url", "slug", "at")} if (d.get("oeffentlich") or {}).get("url") else None,
                    # 3.12.3: which controls the Mac knows and which ones the online version was rendered with
                    "master": d.get("master"), "web_master": (d.get("oeffentlich") or {}).get("master"),
                    # 3.16: MIDI image — "ok" (with version), "pending", "failed", "none" (by hand / not set up)
                    "midi": midi_state(p, d), "midi_v": MIDI_V})
    return out


# ---- 3.16: MIDI-Abbild jedes KI-Tracks (every AI-generated song gets a MIDI image and
# is automatically available on the instruments too) ------------------------------------------
# Own environment $MWS_HOME/midi (installer step "MIDI image"): Demucs (MIT) separates drums/bass/vocals/rest,
# Basic Pitch (Apache-2.0, ONNX) detects the notes, pYIN the bass, per-band onsets the drums.
# 🔑 Computed ONLY when the bridge is otherwise idle — if a job arrives, it is aborted and restarted later.
# Result next to the WAV: <name>.midi.json (tracks on the 1/16 grid, like the projects in "Selber machen") + <name>.mid.
MIDI_DIR = os.path.join(DIR, "midi")
MIDI_V = 1                      # version of the image — higher = everything is recomputed
MIDI_SCRIPT = r'''"""Manuwave Studio 3.16 — MIDI image of a track: separate stems (Demucs), detect notes (Basic Pitch),
drums from per-band onsets, everything snapped to the tempo grid.

    python transcribe.py <audio> <out.json> <out.mid> [bpm]

Output: JSON with tracks on the 1/16 grid (like the projects in the build-it-yourself tab) and a MIDI file (type 1).
"""
import json, os, subprocess, sys, warnings, logging
warnings.filterwarnings("ignore")
logging.disable(logging.WARNING)
import numpy as np
import torch

SR = 44100
FF = os.environ.get("MWS_FFMPEG", "ffmpeg")
DEV = os.environ.get("MWS_MIDI_DEVICE", "cpu")
torch.set_num_threads(max(1, (os.cpu_count() or 4) // 2))


def load(path, sr=SR, ch=2):
    raw = subprocess.run([FF, "-v", "error", "-i", path, "-ac", str(ch), "-ar", str(sr), "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, ch).T.copy()


def separate(wav):
    from demucs.pretrained import get_model
    from demucs.apply import apply_model
    model = get_model("htdemucs")
    model.eval()
    x = torch.from_numpy(wav)
    ref = x.mean(0)
    x = (x - ref.mean()) / (ref.std() + 1e-8)
    with torch.no_grad():
        out = apply_model(model, x[None], device=DEV, split=True, overlap=0.15, progress=False)[0]
    out = out * (ref.std() + 1e-8) + ref.mean()
    return {name: out[i].mean(0).numpy() for i, name in enumerate(model.sources)}


def notes_of(mono, lo, hi, onset=0.5, frame=0.3, min_ms=80):
    """Basic Pitch (ONNX) on one stem → [(start, end, pitch, strength)]."""
    import tempfile, soundfile as sf
    from basic_pitch import ICASSP_2022_MODEL_PATH
    from basic_pitch.inference import predict, Model
    onnx = os.path.join(os.path.dirname(ICASSP_2022_MODEL_PATH), "nmp.onnx")
    global _BP
    try:
        _BP
    except NameError:
        _BP = Model(onnx)
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        tmp = f.name
    try:
        sf.write(tmp, mono, SR)
        _, _, ev = predict(tmp, _BP, onset_threshold=onset, frame_threshold=frame, minimum_note_length=min_ms,
                           minimum_frequency=lo, maximum_frequency=hi, melodia_trick=True)
    finally:
        os.remove(tmp)
    return [(float(s), float(e), int(p), float(a)) for s, e, p, a, *_ in ev]


def bass_line(x):
    """Monophonic bass line with pYIN (fundamental tracker) — Basic Pitch often picked up overtones on low notes.
    Pitch = rounded semitone over voiced frames; new note on pitch change or a new attack in the bass stem."""
    import librosa
    sr, hop = 11025, 128
    y = librosa.resample(x.astype(np.float32), orig_sr=SR, target_sr=sr)
    f0, voiced, prob = librosa.pyin(y, fmin=28, fmax=330, sr=sr, frame_length=2048, hop_length=hop, fill_na=np.nan)
    rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=hop)[0]
    gate = max(1e-4, np.percentile(rms[rms > 0], 60) * 0.25) if (rms > 0).any() else 1e-4
    on = set(librosa.onset.onset_detect(y=y, sr=sr, hop_length=hop, delta=0.12, wait=4).tolist())
    midi = np.where(voiced & (rms[:len(f0)] > gate), np.round(librosa.hz_to_midi(np.nan_to_num(f0, nan=1.0))), -1)
    out, cur, start, amp = [], -1, 0, []
    for i, m in enumerate(midi.tolist() + [-1]):
        if m != cur or (i in on and cur >= 0 and i - start > 2):
            if cur >= 0 and i - start >= 4:          # at least ~45 ms
                out.append((start * hop / sr, i * hop / sr, int(cur), float(min(1, np.mean(amp) / (gate * 8)))))
            cur, start, amp = m, i, []
        if i < len(rms):
            amp.append(rms[i])
    return out


def mono_line(ev, prefer="strong"):
    """One voice: overlapping notes → only one per point in time (the strongest or the lowest)."""
    ev = sorted(ev, key=lambda n: n[0])
    out = []
    for n in ev:
        if out and n[0] < out[-1][1] - 0.03:
            last = out[-1]
            better = (n[3] > last[3]) if prefer == "strong" else (n[2] < last[2])
            if better:
                out[-1] = (last[0], max(last[0] + 0.03, n[0]), last[2], last[3])
                out.append(n)
            continue
        out.append(n)
    return [n for n in out if n[1] - n[0] >= 0.05]


def drum_hits(x):
    """Drum stem → [(time, "kick"|"snare"|"hat", strength)]. Separate onsets per band (a single shared detector
    did not hear the hi-hats under the kick): low = kick, mid = snare/clap, high = hi-hat. Silent parts do not count."""
    import librosa
    sr, hop = SR // 2, 256
    y = x[::2].astype(np.float32)
    S = np.abs(librosa.stft(y, n_fft=1024, hop_length=hop))
    f = librosa.fft_frequencies(sr=sr, n_fft=1024)
    D = librosa.amplitude_to_db(S, ref=np.max)
    total = librosa.amplitude_to_db(S.sum(0), ref=np.max)                     # level of the stem per frame
    bands = (("kick", (f >= 30) & (f < 130), 0.10), ("snare", (f >= 180) & (f < 3500), 0.2), ("hat", f >= 7000, 0.10))
    found = {}
    for name, m, delta in bands:
        env = librosa.onset.onset_strength(S=D[m], sr=sr, hop_length=hop)
        on = librosa.onset.onset_detect(onset_envelope=env, sr=sr, hop_length=hop, delta=delta, wait=2)
        band_db = librosa.amplitude_to_db(S[m].sum(0), ref=np.max)
        pk = env.max() + 1e-9
        found[name] = [(float(i * hop / sr), float(min(1, 0.35 + 0.65 * env[i] / pk))) for i in on
                       if total[min(len(total) - 1, i + 1)] > -40 and band_db[min(len(band_db) - 1, i + 1)] > -45]
    kicks = [t for t, _ in found["kick"]]
    near = lambda t, ts, d: any(abs(t - u) < d for u in ts)
    hits = [(t, "kick", v) for t, v in found["kick"]]
    # a kick's attack also clicks in the mid band — a snare only counts without a kick or when clearly strong
    hits += [(t, "snare", v) for t, v in found["snare"] if not near(t, kicks, 0.03) or v > 0.8]
    snares = [t for t, k, _ in hits if k == "snare"]
    hits += [(t, "hat", v) for t, v in found["hat"] if not near(t, snares, 0.03)]
    return hits


def tempo_and_beats(mix, drums, prior):
    """True tempo + beat times. 🔑 The music model does not hit the requested tempo exactly (measured: 137.96 instead of 136 —
    already 3 beats off after 3:45). Hence: fine search ±6 % around the prior, then the beat tracker."""
    import librosa
    sr, hop = SR // 2, 128
    loud = np.sqrt((drums ** 2).mean()) > 0.25 * np.sqrt((mix ** 2).mean())   # does the drum stem carry the beat?
    env = librosa.onset.onset_strength(y=drums if loud else mix, sr=sr, hop_length=hop)    # both already at 22.05 kHz
    t = np.arange(len(env)) * hop / sr
    e = env - env.mean()
    def coh(b):
        return abs((e * np.exp(2j * np.pi * t / (60.0 / b))).sum())
    cands = []
    # only ±6 % around the prior: half/double would otherwise win with eighth-note hi-hats (measured: 202.6 instead of 101.3)
    for p in ([prior] if prior else [librosa.feature.tempo(onset_envelope=env, sr=sr, hop_length=hop)[0]]):
        if 60 <= p <= 200:
            cands += list(np.arange(p * 0.94, p * 1.06, 0.01))
    if not cands:
        cands = list(np.arange(70, 180, 0.02))
    bpm = float(max(cands, key=coh))
    _, bt = librosa.beat.beat_track(onset_envelope=env, sr=sr, hop_length=hop, start_bpm=bpm, tightness=800, units="time")
    beat = 60.0 / bpm
    if len(bt) > 16 and abs(np.median(np.diff(bt)) / beat - 1) < 0.03:
        return bpm, np.asarray(bt, dtype=float)
    ph = float(np.angle((e * np.exp(2j * np.pi * t / beat)).sum()) / (2 * np.pi) * beat) % beat
    return bpm, np.arange(ph, t[-1] + beat, beat)


def beat_pos(times, beats, bpm):
    """Time → position in beats, along the tracked beats (linear beyond the edges)."""
    times = np.asarray(times, dtype=float)
    idx = np.arange(len(beats), dtype=float)
    beat = 60.0 / bpm
    out = np.interp(times, beats, idx)
    lo, hi = times < beats[0], times > beats[-1]
    out[lo] = (times[lo] - beats[0]) / beat
    out[hi] = idx[-1] + (times[hi] - beats[-1]) / beat
    return out


def downbeat(beats, bpm, events, changes=()):
    """Which beat is the "1"? Kicks on 1 and 3, snares/clap on 2 and 4, bass changes on the 1 → offset 0…3.
    🔑 With four-on-the-floor the kicks are equal on all quarter notes — then snares and bass changes decide."""
    ch = beat_pos(list(changes), beats, bpm) if len(changes) else np.array([])
    k = beat_pos([t for t, n, _ in events if n == "kick"], beats, bpm) if events else np.array([])
    sn = beat_pos([t for t, n, _ in events if n == "snare"], beats, bpm) if events else np.array([])
    def score(o):
        return (np.cos(np.pi * (k - o)).sum() if len(k) else 0) + (np.cos(np.pi * (sn - o - 1)).sum() if len(sn) else 0) \
            + (0.5 * np.cos(np.pi * (k - o) / 2).sum() if len(k) else 0) + (1.5 * np.cos(np.pi * (ch - o) / 2).sum() if len(ch) else 0)
    return max(range(4), key=score)


def main():
    src, out_json, out_mid = sys.argv[1], sys.argv[2], sys.argv[3]
    bpm = float(sys.argv[4]) if len(sys.argv) > 4 and float(sys.argv[4]) > 0 else 0
    import time
    t0 = time.time()
    wav = load(src)
    dur = wav.shape[1] / SR
    cache = os.environ.get("MWS_MIDI_STEMS")          # development only: cache the separated stems
    if cache and os.path.exists(cache):
        st = dict(np.load(cache))
    else:
        st = separate(wav)
        if cache:
            np.savez(cache, **st)
    t_sep = time.time() - t0
    drums = drum_hits(st["drums"])
    bpm, beats = tempo_and_beats(wav.mean(0)[::2], st["drums"][::2], bpm)
    bass = bass_line(st["bass"])
    mel = mono_line(notes_of(st["vocals"], 80, 1100, onset=0.5, frame=0.35, min_ms=100))
    oth = [n for n in notes_of(st["other"], 55, 3000, onset=0.55, frame=0.35, min_ms=110) if n[3] > 0.3]
    chg = [b[0] for a, b in zip(bass, bass[1:]) if b[2] % 12 != a[2] % 12]        # bass change (pitch class)
    db = downbeat(beats, bpm, drums, chg)
    first = min([e[0] for e in bass + mel + oth] + [t for t, *_ in drums] + [beats[0]])
    shift = db - 4 * int(np.ceil((db - float(beat_pos([first], beats, bpm)[0])) / 4))   # bar 1 starts before the first note
    q = lambda t: int(round((float(beat_pos([t], beats, bpm)[0]) - shift) * 4))
    # time of step 0 in the original (beat "shift" along the tracked beats, linear outside)
    off = round(float(np.interp(shift, np.arange(len(beats)), beats)) if 0 <= shift < len(beats) else float(beats[0] + shift * 60.0 / bpm), 3)
    step = 60.0 / bpm / 4
    def notes(ev, cap=None):
        o = []
        for s, e, p, a in ev:
            st_ = q(s)
            o.append({"s": st_, "l": max(1, q(e) - st_), "n": p, "v": round(min(1.0, 0.45 + a * 0.6), 2)})
        o.sort(key=lambda n: (n["s"], n["n"]))
        if cap:   # at most cap notes striking at the same time (the loudest)
            keep, by = [], {}
            for n in o:
                by.setdefault(n["s"], []).append(n)
            for s_, g in by.items():
                keep += sorted(g, key=lambda n: -n["v"])[:cap]
            o = sorted(keep, key=lambda n: (n["s"], n["n"]))
        # same pitch on the same step only once
        seen, uniq = set(), []
        for n in o:
            if (n["s"], n["n"]) not in seen:
                seen.add((n["s"], n["n"])); uniq.append(n)
        return uniq
    pad = {"kick": 0, "snare": 1, "hat": 3}
    dr, seen = [], set()
    for t, k, v in sorted(drums):
        s_ = q(t)
        if (s_, pad[k]) in seen:
            continue
        seen.add((s_, pad[k])); dr.append({"s": s_, "n": pad[k], "v": round(v, 2), "l": 1})
    res = {"v": 1, "bpm": round(bpm, 2), "offset": round(off, 3), "duration": round(dur, 2), "steps_per_beat": 4,
           "tracks": {"drums": dr, "bass": notes(bass), "chords": notes(oth, cap=5), "melody": notes(mel)},
           "stats": {"separate_s": round(t_sep, 1), "total_s": round(time.time() - t0, 1), "device": DEV}}
    # MIDI file (type 1) on the grid, tempo = bpm — can be dragged into any DAW
    import pretty_midi
    pm = pretty_midi.PrettyMIDI(initial_tempo=bpm)
    sec = lambda s: max(0.0, s * step)
    for name, prog, drum in (("Melody", 81, False), ("Chords", 4, False), ("Bass", 38, False), ("Drums", 0, True)):
        inst = pretty_midi.Instrument(program=prog, is_drum=drum, name=name)
        for n in res["tracks"][name.lower()]:
            pitch = {0: 36, 1: 38, 3: 42}[n["n"]] if drum else n["n"]
            inst.notes.append(pretty_midi.Note(velocity=int(n["v"] * 127), pitch=pitch, start=sec(n["s"]), end=sec(n["s"] + n["l"])))
        pm.instruments.append(inst)
    pm.write(out_mid)
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(res, f, separators=(",", ":"))
    print(json.dumps({k: len(v) for k, v in res["tracks"].items()} | res["stats"] | {"bpm": res["bpm"], "offset": res["offset"]}), flush=True)


if __name__ == "__main__":
    main()
'''
_job_active = threading.Event()   # the render track is busy right now (set in run())
_midi_first = []                  # requested by the browser — handled first
_midi_lock = threading.Lock()
_midi_proc = None                 # running compute process — SIGTERM takes it along (else it runs on as an orphan)


# ---- 3.19 (App 3.24): "Aus deinen Songs" — analyse an uploaded song ------------------------------------------
# Runs in the same environment as the MIDI image and uses its helpers (transcribe.py). Style features only.
ANALYSE_SCRIPT = r'''"""Manuwave Studio 3.24 — measure an uploaded song (for the "from your own songs" feature): tempo, key, chord loop,
structure, energy curve, stem shares, vocals, timbre, groove. Style traits only — no melody, no lyrics.

    python analyse.py <audio> <out.json>

Uses the helpers of the MIDI image (transcribe.py alongside): loading, Demucs separation, tempo, drum onsets.
"""
import json, os, sys, warnings, logging
warnings.filterwarnings("ignore")
logging.disable(logging.WARNING)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from transcribe import SR, load, separate, tempo_and_beats, drum_hits, beat_pos

MAX_S = 360                       # nothing longer is measured (compute time); the beginning carries the character
NOTES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
# Krumhansl-Kessler profiles (major, minor)
KK_MAJ = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KK_MIN = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
ROMAN = ["I", "bII", "II", "bIII", "III", "IV", "#IV", "V", "bVI", "VI", "bVII", "VII"]
STEP = {"major": {0: "I", 2: "II", 4: "III", 5: "IV", 7: "V", 9: "VI", 11: "VII"},
        "minor": {0: "I", 2: "II", 3: "III", 5: "IV", 7: "V", 8: "VI", 10: "VII"}}


def roman(d, q, mode):
    """Scale degree relative to the key (in minor, relative to the natural minor scale); minor chord written in lowercase."""
    s = STEP[mode].get(d) or ROMAN[d]
    return s.lower() if q == "m" else s


def tempo_estimate(mix, drums):
    """Tempo without a prior. 🔑 librosa's estimator picked 116 (two thirds) for drum & bass (172). Hence the whole
    family counts: phase coherence and autocorrelation of the onset signal at b, b/2 and 2b. Between b and 2b
    coherence decides; on a tie, the tempo between 90 and 180 (D&B 172 instead of 86, trance 138 instead of 69)."""
    import librosa
    sr, hop = SR // 2, 128
    loud = np.sqrt((drums ** 2).mean()) > 0.25 * np.sqrt((mix ** 2).mean())
    env = librosa.onset.onset_strength(y=drums if loud else mix, sr=sr, hop_length=hop)
    e = env - env.mean()
    t = np.arange(len(e)) * hop / sr
    grid = np.arange(40.0, 360.01, 0.25)
    coh = np.array([abs((e * np.exp(2j * np.pi * t / (60.0 / b))).sum()) for b in grid])
    ac = librosa.autocorrelate(e, max_size=int(sr / hop * 1.6))
    lag = 60.0 / grid * sr / hop
    acv = np.interp(lag, np.arange(len(ac)), ac, left=0, right=0)
    sel = (grid >= 60) & (grid <= 200)
    cn, an = coh / (coh[sel].max() + 1e-9), np.maximum(0, acv) / (acv[sel].max() + 1e-9)
    val = lambda arr, b: float(np.interp(b, grid, arr)) if 40 <= b <= 360 else 0.0
    def score(b):
        return val(cn, b) + val(an, b) + 0.5 * (val(cn, b / 2) + val(an, b / 2)) + 0.5 * (val(cn, 2 * b) + val(an, 2 * b))
    cands = grid[(grid >= 70) & (grid <= 180)]
    sc = np.array([score(b) for b in cands])
    best = float(cands[int(np.argmax(sc))])
    conf = float(sc.max() / (np.sort(sc)[-40:].mean() + 1e-9))
    for alt in (best * 2, best / 2):
        if 90 <= alt <= 180 and not 90 <= best <= 180 and val(cn, alt) >= 0.8 * val(cn, best):
            best = alt
            break
    return best, min(1.0, conf / 2)


def key_of(chroma, bass_chroma=None, bars=None, upper_chroma=None):
    """Key. Krumhansl-Kessler alone confused the fifth (C instead of G) and the relative key (F major instead of A minor). Hence the
    six best candidates are additionally scored by the core pitch of the upper voices, the bass and the tonic chord.
    🔑 The bass alone was misleading: in an A-minor trance track it played F most (the VI degree)."""
    v = chroma / (chroma.sum() + 1e-9)
    sc = {}
    for r in range(12):
        for prof, mode in ((KK_MAJ, "major"), (KK_MIN, "minor")):
            sc[(r, mode)] = float(np.corrcoef(v, np.roll(prof, r))[0, 1])
    bc = bass_chroma / (bass_chroma.sum() + 1e-9) if bass_chroma is not None else None
    uc = upper_chroma / (upper_chroma.sum() + 1e-9) if upper_chroma is not None else None
    seq = [b for b in (bars or []) if b]
    first = seq[0] if seq else None
    def total(k):
        r, mode = k
        x = sc[k]
        if uc is not None:
            x += 0.8 * float(uc[r])
        if bc is not None:
            x += 0.3 * float(bc[r])
        q = "m" if mode == "minor" else ""
        fits = lambda c: c[0] == r and c[1] in (q, "?")          # an unclear third counts for both modes
        if seq:
            x += 0.4 * sum(1 for c in seq if fits(c)) / len(seq)
        if first and fits(first):
            x += 0.1
        return x
    top = sorted(sc, key=sc.get, reverse=True)[:6]
    ranked = sorted(top, key=total, reverse=True)
    k = ranked[0]
    alt = ranked[1] if len(ranked) > 1 and total(ranked[0]) - total(ranked[1]) < 0.04 else None
    return k[0], k[1], sc[k], alt


def chords_per_beat(chroma_beats):
    """Major/minor triad per beat (templates), weak beats = none."""
    tmpl = []
    for r in range(12):
        for q, iv in (("", (0, 4, 7)), ("m", (0, 3, 7))):
            v = np.zeros(12)
            for i in iv:
                v[(r + i) % 12] = 1
            tmpl.append((r, q, v / np.linalg.norm(v)))
    out = []
    for c in chroma_beats.T:
        n = np.linalg.norm(c)
        if n < 1e-6:
            out.append(None)
            continue
        s = [(float(np.dot(c / n, v)), r, q) for r, q, v in tmpl]
        sc, r, q = max(s)
        if sc <= 0.6:
            out.append(None)
            continue
        cn = c / n
        maj3, min3 = cn[(r + 4) % 12], cn[(r + 3) % 12]
        # third barely audible (power chord, fifths pads): mode is resolved later from the key
        out.append((r, q if abs(maj3 - min3) > 0.25 * cn[r] else "?"))
    return out


DIATONIC = {"major": {0: "", 2: "m", 4: "m", 5: "", 7: "", 9: "m", 11: "m"},
            "minor": {0: "m", 2: "m", 3: "", 5: "m", 7: "m", 8: "", 10: ""}}


def settle(chord, root, mode):
    """Chord with an unclear third → mode of that degree in the key (in A minor: Am instead of A)."""
    if not chord or chord[1] != "?":
        return chord
    return (chord[0], DIATONIC[mode].get((chord[0] - root) % 12, ""))


def loop_of(bar_chords, root, mode):
    """Chord progression: merge identical bars, then the most frequent sequence of four changes (with fewer changes, the
    existing ones). 🔑 Counted per bar, a trance track with 2–4 bars per chord showed only "Am–Am–Am–Am"."""
    from collections import Counter
    runs = []
    for c in bar_chords:
        if not c:
            continue
        if runs and runs[-1][0] == c:
            runs[-1][1] += 1
        else:
            runs.append([c, 1])
    if not runs:
        return None
    chords = [c for c, _ in runs]
    if len(set(chords)) == 1:
        loop, share = [chords[0]], 1.0
    elif len(chords) >= 5:
        grams = Counter(tuple(chords[i:i + 4]) for i in range(len(chords) - 3))
        g, n = grams.most_common(1)[0]
        # equally good readings of the same loop: the one starting on the root (otherwise the display fluctuated
        # between F#m–A–Em–G and Bm–D–A–Em, depending on the run)
        tonic = [x for x, k in grams.most_common() if k >= 0.6 * n and x[0][0] == root]
        if tonic and g[0][0] != root:
            g = tonic[0]
            n = grams[g]
        loop, share = list(g), n / max(1, len(chords) - 3)
        if loop[2:] == loop[:2]:                       # A–B–A–B → A–B
            loop = loop[:2]
    else:
        loop, share = chords[:4], 0.0
    per_bar = float(np.median([n for _, n in runs])) if runs else 1.0
    return {"names": [NOTES[r] + ("m" if q == "m" else "") for r, q in loop],
            "roman": [roman((r - root) % 12, "m" if q == "m" else "", mode) for r, q in loop],
            "bars_per_chord": per_bar, "share": round(share, 2)}


def sections_of(y, sr, beats_s, energy_db):
    """Structure: sections via repetition (chroma + timbre per beat); identical parts get the same letter."""
    import librosa
    hop = 512
    bf = librosa.time_to_frames(beats_s, sr=sr, hop_length=hop)
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=hop)
    mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13, hop_length=hop)
    F = np.vstack([librosa.util.normalize(chroma, axis=0), librosa.util.normalize(mfcc[1:], axis=1)])
    Fs = librosa.util.sync(F, bf, aggregate=np.median)
    dur = len(y) / sr
    k = int(np.clip(round(dur / 28), 3, 10))
    if Fs.shape[1] <= k + 1:
        return []
    bounds = librosa.segment.agglomerative(Fs, k)
    bt = librosa.frames_to_time(librosa.util.fix_frames(bf, x_max=F.shape[1]), sr=sr, hop_length=hop)
    starts = sorted(set([0.0] + [float(bt[min(b, len(bt) - 1)]) for b in bounds if b > 0]))
    segs = []
    for i, s in enumerate(starts):
        e = starts[i + 1] if i + 1 < len(starts) else dur
        if e - s < 4 and segs:                                # attach slivers to the previous section
            segs[-1]["end"] = round(e, 1)
            continue
        segs.append({"start": round(s, 1), "end": round(e, 1)})
    # detect identical parts: mean features per section, similarity > 0.92 → same letter
    def feat(sg):
        a = int(np.searchsorted(bt, sg["start"]))
        b = max(a + 1, int(np.searchsorted(bt, sg["end"])))
        v = Fs[:, a:b].mean(1)
        return v / (np.linalg.norm(v) + 1e-9)
    labels, protos = [], []
    for sg in segs:
        v = feat(sg)
        sims = [float(np.dot(v, p)) for p in protos]
        if sims and max(sims) > 0.92:
            labels.append(int(np.argmax(sims)))
        else:
            protos.append(v)
            labels.append(len(protos) - 1)
    lo, hi = np.percentile(energy_db, 10), np.percentile(energy_db, 95)
    for sg, lb in zip(segs, labels):
        a, b = int(sg["start"]), max(int(sg["start"]) + 1, int(sg["end"]))
        lv = float(np.mean(energy_db[a:b])) if b <= len(energy_db) else float(np.mean(energy_db[a:]))
        x = (lv - lo) / max(1e-6, hi - lo)
        sg["label"] = chr(65 + min(lb, 25))
        sg["energy"] = "voll" if x > 0.75 else "mittel" if x > 0.45 else "ruhig"
    return segs


def main():
    import librosa
    src, out_json = sys.argv[1], sys.argv[2]
    wav = load(src)
    full = wav.shape[1] / SR
    wav = wav[:, :MAX_S * SR]
    dur = wav.shape[1] / SR
    st = separate(wav)
    mix = wav.mean(0)
    # stem shares (energy), vocals over time
    en = {k: float((v.astype(np.float64) ** 2).sum()) for k, v in st.items()}
    tot = sum(en.values()) + 1e-12
    stems = {k: round(100 * en[k] / tot) for k in ("drums", "bass", "vocals", "other") if k in en}
    win = SR // 2
    n = len(mix) // win
    rm = lambda x: np.sqrt((x[:n * win].reshape(n, win).astype(np.float64) ** 2).mean(1) + 1e-12)
    vr, mr = rm(st["vocals"]), rm(mix)
    voc_share = float(((vr > 0.2 * mr) & (mr > 10 ** (-40 / 20))).mean()) if n else 0.0
    vocals = "viel" if voc_share > 0.45 else "etwas" if voc_share > 0.15 else "kaum"
    # tempo and beats (no prior), half/double checked
    est, conf = tempo_estimate(mix[::2], st["drums"][::2])
    bpm, beats = tempo_and_beats(mix[::2], st["drums"][::2], est)    # fine search ±6 % around the estimate + beats
    # Groove: kick on every beat? 🔑 The beat tracker sometimes locks onto offbeat hi-hats — hence the position
    # of the kicks relative to their own most frequent phase counts, not the phase of the beats.
    hits = drum_hits(st["drums"])
    kicks = beat_pos([t for t, k, _ in hits if k == "kick"], beats, bpm)
    kv = np.array([v for t, k, v in hits if k == "kick"])
    covered, phase, even_odd = 0.0, 0.0, 1.0
    if len(kicks) > 4:
        phase = float(np.angle(np.exp(2j * np.pi * kicks).mean()) / (2 * np.pi)) % 1
        d = ((kicks - phase + 0.5) % 1) - 0.5
        on = np.abs(d) < 0.15
        idx = np.round(kicks[on] - phase).astype(int)
        # only count beats on which the drums play — breakdowns without a kick would otherwise lower the share
        dr = st["drums"].astype(np.float64)
        bi = (np.asarray(beats) * SR).astype(int)
        bl = max(1, int(SR * 60 / bpm))
        brms = np.array([np.sqrt((dr[i:i + bl] ** 2).mean() + 1e-12) if i < len(dr) else 0 for i in bi])
        active = brms > 0.15 * np.percentile(brms, 90) if len(brms) else brms
        act_idx = set(np.nonzero(active)[0].tolist())
        covered = len(set(idx.tolist()) & act_idx) / max(1, len(act_idx))
        # kick and snare alternating: on every second beat the "kick" is only the low-end part of the snare — weaker
        ev, od = kv[on][idx % 2 == 0], kv[on][idx % 2 == 1]
        if len(ev) and len(od):
            even_odd = float(min(ev.mean(), od.mean()) / max(ev.mean(), od.mean()))
    four = covered > 0.6 and even_odd > 0.7
    snares = beat_pos([t for t, k, _ in hits if k == "snare"], beats, bpm)
    # backbeat: snares one quarter note off the kicks, every second beat
    backbeat = float(np.mean(np.abs((((snares - phase) % 2) - 1)) < 0.2)) if len(snares) > 8 and not four else 0.0
    if not four and covered > 0.6 and even_odd <= 0.7:
        backbeat = 1.0                                     # kick and snare alternating
    # key from everything except drums, chords from bass + rest per beat
    sr = 22050
    harm = librosa.resample((st["bass"] + st["other"] + 0.5 * st["vocals"]).astype(np.float32), orig_sr=SR, target_sr=sr)
    hop = 512
    chroma = librosa.feature.chroma_cqt(y=harm, sr=sr, hop_length=hop)
    # Chords without the bass: its fifth partial (major third) turned A minor into A major.
    # 🔑 If the upper part carries hardly anything (a trance track: other 3 %, vocals 10 % — the separation put the synths with the bass),
    #    chords derived from it are chance and flip the key. Then use the whole harmonic signal; the third decides the key.
    up_share = (stems.get("other", 0) + stems.get("vocals", 0)) / 100.0
    upper_sig = st["other"] + 0.5 * st["vocals"] if up_share >= 0.15 else st["bass"] + st["other"] + 0.5 * st["vocals"]
    upper = librosa.resample(upper_sig.astype(np.float32), orig_sr=SR, target_sr=sr)
    chroma_up = librosa.feature.chroma_cqt(y=upper, sr=sr, hop_length=hop)
    bf = librosa.time_to_frames(beats, sr=sr, hop_length=hop)
    cb = librosa.util.sync(chroma_up, librosa.util.fix_frames(bf, x_max=chroma_up.shape[1]), aggregate=np.median)
    pb = chords_per_beat(cb)
    if up_share < 0.15:                                  # measured with bass: do not trust the third
        pb = [(c[0], "?") if c else None for c in pb]
    bars = []
    for i in range(0, len(pb) - 3, 4):                     # most frequent chord per bar
        cs = [c for c in pb[i:i + 4] if c]
        bars.append(max(set(cs), key=cs.count) if cs else None)
    bass_y = librosa.resample(st["bass"].astype(np.float32), orig_sr=SR, target_sr=sr)
    bass_c = librosa.feature.chroma_cqt(y=bass_y, sr=sr, hop_length=hop, fmin=librosa.note_to_hz("C1"), n_octaves=5).sum(1)
    root, mode, kconf, kalt = key_of(chroma.sum(1), bass_c, bars, chroma_up.sum(1))
    bars = [settle(b, root, mode) for b in bars]
    loop = loop_of(bars, root, mode)
    # loudness, dynamics, timbre, energy curve (per second)
    y = librosa.resample(mix.astype(np.float32), orig_sr=SR, target_sr=sr)
    sec = sr
    m = len(y) // sec
    e = np.sqrt((y[:m * sec].reshape(m, sec).astype(np.float64) ** 2).mean(1) + 1e-12)
    edb = 20 * np.log10(e)
    loud = float(20 * np.log10(np.sqrt((y.astype(np.float64) ** 2).mean()) + 1e-12))
    dyn = float(np.percentile(edb, 90) - np.percentile(edb, 10)) if m > 4 else 0.0
    cent = float(np.median(librosa.feature.spectral_centroid(y=y, sr=sr, hop_length=1024)))
    colour = "hell" if cent > 2600 else "warm" if cent > 1500 else "dunkel"
    lo, hi = np.percentile(edb, 5), edb.max()
    curve = [int(round(100 * min(1, max(0, (v - lo) / max(1e-6, hi - lo))))) for v in edb]
    secs = sections_of(y, sr, beats, edb)
    out = {"v": 1, "duration": round(full, 1), "measured_s": round(dur, 1),
           "bpm": round(float(bpm), 1), "bpm_conf": round(conf, 2),
           "key": {"root": int(root), "name": NOTES[root], "mode": mode, "conf": round(kconf, 2),
                   "alt": {"root": int(kalt[0]), "name": NOTES[kalt[0]], "mode": kalt[1]} if kalt else None},
           "chords": loop, "stems": stems, "vocals": vocals, "vocal_share": round(voc_share, 2),
           "groove": {"four_on_floor": bool(four), "kick_cover": round(min(1.0, covered), 2), "kick_even": round(even_odd, 2), "backbeat": round(backbeat, 2)},
           "loudness_db": round(loud, 1), "dynamics_db": round(dyn, 1), "brightness_hz": int(cent), "colour": colour,
           "energy": curve[:600], "sections": secs}
    with open(out_json, "w") as f:
        json.dump(out, f)


if __name__ == "__main__":
    main()
'''


def analyse_measure(cfg: dict, audio: bytes, filename: str) -> dict:
    """Tempo, key, chords, structure, energy, stem shares, vocals, timbre, groove. Without the MIDI environment
    (installer with --skip-midi) → {"unavailable": …} — the music AI still listens."""
    py = midi_python()
    if not py:
        return {"unavailable": "MIDI-Umgebung fehlt (Installer-Schritt „MIDI image“)"}
    for name, code in (("transcribe.py", MIDI_SCRIPT), ("analyse.py", ANALYSE_SCRIPT)):
        p = os.path.join(MIDI_DIR, name)
        if _read_bytes(p) != code.encode():
            _write_atomic(p, code.encode())
    ext = os.path.splitext(filename or "")[1].lower()
    ext = ext if re.match(r"^\.[a-z0-9]{2,5}$", ext) else ".audio"
    work = os.path.join(MIDI_DIR, "analyse-" + uuid.uuid4().hex[:8])
    os.makedirs(work, exist_ok=True)
    src, out = os.path.join(work, "song" + ext), os.path.join(work, "ergebnis.json")
    try:
        with open(src, "wb") as f:
            f.write(audio)
        env = dict(os.environ, MWS_FFMPEG=tool(cfg, "ffmpeg") or "ffmpeg", TORCH_HOME=os.path.join(MIDI_DIR, "torch"),
                   HF_HOME=os.path.join(MIDI_DIR, "hf"), MWS_MIDI_DEVICE="mps" if sys.platform == "darwin" else "cpu",
                   PYTORCH_ENABLE_MPS_FALLBACK="1")
        t0 = time.time()
        r = subprocess.run([py, os.path.join(MIDI_DIR, "analyse.py"), src, out], env=env, capture_output=True, timeout=900)
        if r.returncode != 0 or not os.path.isfile(out):
            msg = (r.stderr.decode(errors="replace").strip().splitlines() or ["?"])[-1]
            log("Vermessen nicht möglich (%s): %s" % (filename, msg[-200:]))
            return {"unavailable": "Vermessen nicht möglich: " + msg[-160:]}
        data = _read_json(out)
        log("Vermessen in %.0f s: %s · %s BPM · %s %s" % (time.time() - t0, filename, data.get("bpm"),
            (data.get("key") or {}).get("name"), (data.get("key") or {}).get("mode")))
        return data
    except subprocess.TimeoutExpired:
        return {"unavailable": "Vermessen dauerte zu lange"}
    finally:
        for p in (src, out):
            try:
                os.remove(p)
            except OSError:
                pass
        try:
            os.rmdir(work)
        except OSError:
            pass


def analyse_job(cfg: dict, eng, srv, job: dict, tick) -> dict:
    """Job "analyse": the music AI listens (style, meter, language) and the Mac analyses the song.
    🔑 Do NOT pass on the recognised lyrics — references yield a new song, not a re-sung one."""
    upload = srv.upload(job["id"])
    name = job.get("filename") or "upload"
    try:
        ace = eng.understand(upload, name, tick)
        ace.pop("lyrics", None)
    except Exception as e:  # noqa: BLE001
        ace = {"unavailable": (str(e) or type(e).__name__)[:160]}
    tick("Dein Mac vermisst den Song (Tempo, Tonart, Akkorde, Aufbau) …")
    measure = analyse_measure(cfg, upload, name)
    if ace.get("unavailable") and measure.get("unavailable"):
        raise RuntimeError("Analyse nicht möglich: %s · %s" % (ace["unavailable"], measure["unavailable"]))
    out = {"v": 1, "ace": ace, "measure": measure}
    srv.result_json(job["id"], out)
    return out


def midi_python() -> str:
    p = os.path.join(MIDI_DIR, "Scripts", "python.exe") if IS_WIN else os.path.join(MIDI_DIR, "bin", "python")
    return p if os.path.isfile(p) else ""


def midi_state(path: str, d: dict = None) -> str:
    d = d if d is not None else _read_json(path[:-4] + ".json")
    if ((d.get("meta") or {}).get("source") or (d.get("request") or {}).get("source")) == "eigen":
        return "none"                                   # played by hand: the notes already exist in the project
    if (_read_json(path[:-4] + ".midi.json").get("v") or 0) == MIDI_V and os.path.isfile(path[:-4] + ".mid"):
        return "ok"
    fail = _read_json(path[:-4] + ".midi.fail")
    if fail.get("v") == MIDI_V and time.time() - float(fail.get("at") or 0) < 7 * 86400:
        return "failed"
    return "pending" if midi_python() else "none"


def _midi_busy() -> bool:
    if _job_active.is_set() or os.path.exists(INFLIGHT):
        return True
    with FileLock("bild-server", blocking=False) as l:     # someone painting (cover, image work)? Then stay out.
        return not l.held


def midi_make(cfg: dict, path: str) -> str:
    """Compute one image. → "ok", "stopped" (a job interrupted) or "failed"."""
    py = midi_python()
    script = os.path.join(MIDI_DIR, "transcribe.py")
    if _read_bytes(script) != MIDI_SCRIPT.encode():
        _write_atomic(script, MIDI_SCRIPT.encode())
    d = _read_json(path[:-4] + ".json")
    bpm = (d.get("request") or {}).get("bpm") or (d.get("result") or {}).get("bpm") or 0
    tmp_j, tmp_m = path[:-4] + ".midi.json.tmp", path[:-4] + ".mid.tmp"
    # Models into the own folder (Demucs 4.1 downloads via the Hugging Face hub): uninstalling = deleting the folder
    env = dict(os.environ, MWS_FFMPEG=tool(cfg, "ffmpeg") or "ffmpeg", TORCH_HOME=os.path.join(MIDI_DIR, "torch"), HF_HOME=os.path.join(MIDI_DIR, "hf"),
               MWS_MIDI_DEVICE="mps" if sys.platform == "darwin" else "cpu", PYTORCH_ENABLE_MPS_FALLBACK="1")
    t0 = time.time()
    kw = {} if IS_WIN else {"preexec_fn": lambda: os.nice(10)}
    global _midi_proc
    proc = _midi_proc = subprocess.Popen([py, script, path, tmp_j, tmp_m, str(int(bpm) if bpm else 0)], stdout=subprocess.PIPE,
                                         stderr=subprocess.PIPE, env=env, **kw)
    try:
        while proc.poll() is None:
            if _job_active.is_set() or os.path.exists(INFLIGHT) or time.time() - t0 > 1800:
                proc.kill()
                proc.wait()
                return "stopped"
            time.sleep(0.5)
        out, err = proc.communicate()
        if proc.returncode != 0 or not os.path.isfile(tmp_j) or not os.path.isfile(tmp_m):
            msg = err.decode(errors="replace").strip().splitlines()[-1:] or ["?"]
            _write_atomic(path[:-4] + ".midi.fail", json.dumps({"v": MIDI_V, "at": time.time(), "error": msg[0][-300:]}).encode())
            log("MIDI-Abbild nicht möglich (%s): %s" % (os.path.basename(path), msg[0][-200:]))
            return "failed"
        data = _read_json(tmp_j)
        data["v"] = MIDI_V
        _write_atomic(path[:-4] + ".midi.json", json.dumps(data, separators=(",", ":")).encode())
        os.replace(tmp_m, path[:-4] + ".mid")
        try:
            os.remove(path[:-4] + ".midi.fail")
        except OSError:
            pass
        log("MIDI-Abbild fertig in %.0f s: %s (%s BPM, %s)" % (time.time() - t0, os.path.basename(path), data.get("bpm"),
            ", ".join("%s %d" % (k, len(v)) for k, v in (data.get("tracks") or {}).items())))
        return "ok"
    finally:
        _midi_proc = None
        for t in (tmp_j, tmp_m):
            try:
                os.remove(t)
            except OSError:
                pass


def midi_kill() -> None:
    """When the bridge exits: take the compute process along."""
    p = _midi_proc
    if p is not None and p.poll() is None:
        try:
            p.kill()
            p.wait(timeout=5)
        except Exception:  # noqa: BLE001
            pass


def midi_cleanup() -> int:
    """Clean up partial results of a hard-killed run (.midi.json.tmp / .mid.tmp). → count."""
    n = 0
    for root, dirs, files in os.walk(RENDERS):
        for f in files:
            if f.endswith(".midi.json.tmp") or f.endswith(".mid.tmp"):
                try:
                    os.remove(os.path.join(root, f))
                    n += 1
                except OSError:
                    pass
    return n


def midi_lane(cfg: dict) -> None:
    """Background: give every AI track its image — requested ones first, then the newest. Only when idle."""
    if midi_cleanup():
        log("MIDI: halbe Ergebnisse eines abgebrochenen Laufs entfernt")
    time.sleep(30)
    while True:
        try:
            if not midi_python() or cfg.get("midi") is False or _midi_busy():
                time.sleep(20)
                continue
            with _midi_lock:
                want = [p for p in _midi_first if os.path.isfile(p)]
            todo = want + [p for p in sorted(all_archived(), reverse=True) if p not in want]
            nxt = next((p for p in todo if midi_state(p) == "pending"), None)
            if not nxt:
                time.sleep(60)
                continue
            res = midi_make(cfg, nxt)
            if res != "stopped":
                with _midi_lock:
                    if nxt in _midi_first:
                        _midi_first.remove(nxt)
            time.sleep(2 if res == "ok" else 20)
        except Exception as e:  # noqa: BLE001
            log("MIDI-Spur: %s" % e)
            time.sleep(60)


def midi_result(paths: list) -> bytes:
    """Job "midi": for each requested track, the render (JSON + .mid as base64) or its state.
    Unfinished ones move to the front. Sent as a JSON file (a render is ~100 KB — too big for the JSON body)."""
    import base64
    items = {}
    for rel in paths[:40]:
        p = os.path.realpath(os.path.join(HOME, rel))
        if not p.startswith(os.path.realpath(RENDERS) + os.sep) or not os.path.isfile(p):
            items[rel] = {"state": "missing"}
            continue
        st = midi_state(p)
        if st == "ok":
            items[rel] = {"state": "ok", "data": _read_json(p[:-4] + ".midi.json"),
                          "mid": base64.b64encode(_read_bytes(p[:-4] + ".mid") or b"").decode()}
        else:
            items[rel] = {"state": st}
            if st == "pending":
                with _midi_lock:
                    if p not in _midi_first:
                        _midi_first.append(p)
    return json.dumps({"items": items, "v": MIDI_V}, separators=(",", ":")).encode()


# ---- 3.6: Deletion (deleted songs must really be deleted) ----------------------------
# Up to 3.5 the app only deleted its browser copy; the archive stayed and "📥 Fetch from Mac" offered the track again.
# Now EVERYTHING of a track goes to the Mac's trash: WAV, .json, cover (.jpg + raw .roh.jpg) and the
# unmarked original. Trash instead of immediate removal: recoverable until emptied. If moving fails
# (permissions), the files are deleted for good — deleted means deleted. The watermark registry keeps its entry:
# an already distributed copy should keep proving its origin.
TRASH = os.path.join(HOME, ".Trash")


def track_files(path: str) -> list:
    """All files of an archive track (the WAV first)."""
    base = path[:-4]
    out = [path] + [base + s for s in (".json", ".jpg", ".roh.jpg", ".midi.json", ".mid") if os.path.isfile(base + s)]
    orig = os.path.join(ORIG_DIR, os.path.basename(os.path.dirname(path)), os.path.basename(path))
    if os.path.isfile(orig):
        out.append(orig)
    return out


def remember_masters(items: list) -> dict:
    """3.12.3: The mastering controls live in the browser (IndexedDB). The studio reports them here so that everything
    that runs without the browser (publishing from the terminal, a second device) uses the same controls."""
    saved, missing = 0, []
    for it in items[:500]:
        if not isinstance(it, dict):
            continue
        p = archive_path(it.get("archived"))
        m = clean_master(it.get("master"))
        if not p or m is None:
            missing.append(it.get("archived"))
            continue
        with FileLock(p):
            d = _read_json(p[:-4] + ".json")
            if d.get("master") == m:
                continue
            d["master"] = m
            _write_atomic(p[:-4] + ".json", json.dumps(d, indent=2, ensure_ascii=False).encode("utf-8"))
            saved += 1
    if saved:
        log("Mastering-Regler vom Studio übernommen: %d Track%s" % (saved, "" if saved == 1 else "s"))
    return {"saved": saved, "missing": missing}


def delete_tracks(rels: list, cfg=None) -> dict:
    import shutil
    done, missing, hard, web_off = [], [], 0, 0
    ziel = os.path.join(TRASH, "Manuwave Studio gelöscht " + time.strftime("%Y-%m-%d %H.%M.%S"))
    for rel in rels[:500]:
        p = archive_path(rel)
        if not p:
            missing.append(rel)          # already gone — for the browser that is the same as deleted
            continue
        # 3.12.4: deleted also means: no longer public. Until here a deleted track sat in the trash and kept running
        # on the site. If withdrawing fails (site/Tailscale unreachable), the track stays put: the
        # browser keeps it in its deletion list and retries on the next connect.
        pub = _read_json(p[:-4] + ".json").get("oeffentlich") or {}
        if pub.get("id") and not ((cfg or {}).get("web_admin") or "").strip():
            log("%s war veröffentlicht, aber keine Fahrstuhlmusik-Seite eingetragen — dort bitte von Hand zurückziehen" % os.path.basename(p))
        elif pub.get("id"):
            try:
                _web(cfg, "POST", "/api/admin/track/%s/zurueckziehen" % pub["id"], {"reason": "Vom Künstler gelöscht"})
                web_off += 1
            except RuntimeError as e:
                if "(404)" not in str(e):
                    log("Löschen von %s verschoben — erst von Fahrstuhlmusik nehmen: %s" % (os.path.basename(p), e))
                    continue
            log("Von Fahrstuhlmusik zurückgezogen (gelöscht): %s" % os.path.basename(p))
        with FileLock(p):                # never in the middle of a refine/export
            day = os.path.basename(os.path.dirname(p))
            for f in track_files(p):
                name = ("Original_" if f.startswith(os.path.realpath(ORIG_DIR) + os.sep) or f.startswith(ORIG_DIR + os.sep) else "") + os.path.basename(f)
                try:
                    os.makedirs(os.path.join(ziel, day), exist_ok=True)
                    shutil.move(f, os.path.join(ziel, day, name))
                except OSError:
                    try:
                        os.remove(f)
                        hard += 1
                    except FileNotFoundError:
                        pass
        done.append(rel)
        log("Gelöscht: %s (%s)" % (os.path.basename(p), "Papierkorb" if not hard else "endgültig"))
    return {"deleted": done, "missing": missing, "trash": rel_home(ziel) if os.path.isdir(ziel) else "", "hard": hard, "web_off": web_off}


def settings_result(cfg: dict) -> dict:
    return {"rights": rights(cfg), "tools": tools_state(cfg), "version": BRIDGE_VERSION,
            "writer": writer_settings(cfg), "home": SHOWN_DIR,
            "master": {"presets": clean_presets(cfg.get("master_presets")), "vorgabe": cfg.get("master_vorgabe") or "",
                       "mein_sound": mein_sound()},
            "formats": [{"id": k, "name": v["name"], "ext": v["ext"], "lossless": k != "mp3"}
                        for k, v in FORMATS.items()]}


def tool_job(cfg: dict, srv, job: dict) -> None:
    """Quick jobs of the brief lane: settings, export, watermark check.
    They do not touch the GPU (covers are made on the render lane)."""
    kind, jid, req = job.get("kind"), job["id"], job.get("request") or {}
    tick = lambda m: srv.progress(jid, m, job)  # noqa: E731
    if kind == "archiv":
        srv.result_json(jid, {"tracks": archive_list()})
    elif kind == "midi":
        rels = req.get("archived")
        srv.result_file(jid, midi_result(rels if isinstance(rels, list) else []), "application/vnd.manuwave.file+json")
    elif kind == "master_merken":
        srv.result_json(jid, remember_masters(req.get("items") if isinstance(req.get("items"), list) else []))
    elif kind == "loeschen":
        rels = req.get("archived")
        srv.result_json(jid, delete_tracks(rels if isinstance(rels, list) else [], cfg))
    elif kind == "settings":
        if isinstance(req.get("set"), dict):
            with _cfg_lock:
                r = dict(RIGHTS_DEFAULTS)
                r.update(cfg.get("rights") or {})
                r.update(clean_rights(req["set"]))
                cfg["rights"] = r
                save_config(cfg)
            log("Urheberangaben geändert")
        if "writer" in req:
            set_writer(cfg, req["writer"])
        if isinstance(req.get("master_presets"), list):
            with _cfg_lock:
                cfg["master_presets"] = clean_presets(req["master_presets"])
                v = str(req.get("master_vorgabe") or "")
                ids = {p["id"] for p in cfg["master_presets"]} | {"mein_sound"}
                cfg["master_vorgabe"] = v if v in ids else ""
                save_config(cfg)
            log("Mastering-Presets: %d, Standard: %s" % (len(cfg["master_presets"]), cfg["master_vorgabe"] or "—"))
        elif req.get("fresh"):
            writer_state(cfg, fresh=True)
        srv.result_json(jid, settings_result(cfg))
    elif kind == "verify":
        data = srv.upload(jid)
        ext = re.sub(r"[^.a-z0-9]", "", os.path.splitext(job.get("filename") or "")[1].lower())[:6] or ".bin"
        with Scratch() as s:
            probe = s.path("probe" + ext)
            with open(probe, "wb") as f:
                f.write(data)
            tick("Wasserzeichen wird gesucht …")
            res = wm_detect(cfg, probe)
        log("Prüfung %s: %s (%.2f)" % (job.get("filename"), "unser Zeichen" if res["found"] else "keins", res["score"]))
        srv.result_json(jid, res)
    elif kind in ("web", "web_weg"):
        path = job_source(cfg, srv, job)
        res = web_publish(cfg, path, req, tick) if kind == "web" else web_withdraw(cfg, path)
        srv.result_json(jid, dict(res, archived=rel_home(path)))
    elif kind == "export":
        fmt = req.get("format")
        if fmt not in FORMATS:
            raise RuntimeError("Unbekanntes Format")
        rate = int(req.get("rate") or 0)
        rate = rate if rate in RATES else 0
        path = job_source(cfg, srv, job)
        fin = veredeln(cfg, path, req, want_cover=False, tick=tick)
        if rights(cfg)["watermark"] and not fin["id"]:
            # every song must carry a watermark, so none leaves without one either
            raise RuntimeError("Wasserzeichen fehlt (%s) — Export abgebrochen" % (fin.get("wm_error") or "unbekannt"))
        given = clean_master(req.get("master"))
        if given is not None:
            # The controls belong to the track: a later export (other device, terminal) sounds the same
            with FileLock(path):
                d = _read_json(path[:-4] + ".json")
                if d.get("master") != given:
                    d["master"] = given
                    _write_atomic(path[:-4] + ".json", json.dumps(d, indent=2, ensure_ascii=False).encode("utf-8"))
        bits = 16 if int(req.get("bits") or 24) == 16 else 24
        res = export_track(cfg, path, fmt, rate, info_from_archive(path, req), tick, master=given, bits=bits)
        if isinstance(req.get("paket"), dict):
            # 3.9: release package — the same file, plus 3000 px cover, metadata, proof, license template
            if tick:
                tick("Veröffentlichungspaket wird geschnürt …")
            pk = release_package(cfg, path, res, info_from_archive(path, req), req["paket"], fin,
                                 own_master=given is not None and not given.get("off"))
            res = dict(res, data=pk["data"], mime=pk["mime"], filename=pk["filename"], bytes=pk["bytes"])
            res["paket"] = {k: pk[k] for k in ("pdf", "docx", "cover3000", "sha256")}
        if len(res["data"]) > MAX_EXPORT:
            raise RuntimeError("Datei zu groß (%d MB) — 16 Bit oder ein komprimiertes Format wählen" % (len(res["data"]) // 1e6))
        meta = {k: res[k] for k in ("filename", "format", "rate", "bits", "cover", "bytes", "master")}
        if res.get("paket"):
            meta["paket"] = res["paket"]
        meta.update(wasserzeichen=fin["id"], archived=rel_home(path))
        srv.meta(jid, meta)
        srv.result_file(jid, res["data"], res["mime"])
        log("Export %s · %s · %.1f MB" % (res["filename"], FORMATS[fmt]["name"], len(res["data"]) / 1e6))
    else:
        raise RuntimeError("Unbekannter Auftrag: %s" % kind)


def finish_job(cfg: dict, srv, job: dict, tick) -> None:
    """Render lane: retrofit an existing track or paint it a new cover."""
    kind, jid, req = job.get("kind"), job["id"], job.get("request") or {}
    path = job_source(cfg, srv, job)
    fin = veredeln(cfg, path, req, want_cover=True, tick=tick, new_cover=(kind == "cover"))
    jpeg = _read_bytes(path[:-4] + ".jpg")
    if jpeg:
        try:
            srv.cover(jid, jpeg)
        except Exception as e:  # noqa: BLE001 — the cover is in the archive; the job is done anyway
            log("Cover-Übergabe %s gescheitert: %s" % (jid, e))
    d = _read_json(path[:-4] + ".json")
    meta = {"archived": rel_home(path), "wasserzeichen": fin["id"], "cover": bool(jpeg),
            "cover_error": fin.get("cover_error", ""), "cover_model": (d.get("cover") or {}).get("model", ""),
            "wm_error": fin.get("wm_error", ""), "cover_stamp": fin.get("stamp", ""),
            "rev": int((d.get("aufbereitet") or {}).get("v") or 0),
            # what the browser needs to put a track back into the library
            "track": {"request": d.get("request") or {}, "meta": d.get("meta") or {}, "result": d.get("result") or {}}}
    if kind == "nachruesten" and req.get("audio"):
        srv.meta(jid, meta)
        srv.result_audio(jid, _read_bytes(path))
    else:   # cover or retrofit: the browser keeps its copy, only ID + cover travel
        srv.result_json(jid, meta)
    log("%s: %s · %s" % ("Neues Cover" if kind == "cover" else "Nachgerüstet", os.path.basename(path),
                          ", ".join(fin["changed"]) or "war schon vollständig"))


# =============================================================================
# Main loop
# =============================================================================

def _on_term(signum, frame):
    # launchctl stop / logout / kill send SIGTERM: take the running job along at the
    # model server instead of letting it keep computing as an orphan.
    Engine.cancel_inflight("Brücke wird beendet")
    midi_kill()                     # 3.16.1: do not let the MIDI render keep computing as an orphan either
    sys.exit(0)


# 3.18 (App 3.23): new code on disk (one-click update, installer, new version from the server) → the bridge restarts
# itself as soon as it is idle. POSIX: execv (same process ID — starter and launchd keep it),
# Windows: exit with 75, the starter restarts it. Own model servers and the MIDI computation are stopped beforehand.
_CODE_FILE = os.path.abspath(__file__)
_brief_active = threading.Event()   # the brief lane is working


def _code_sha() -> str:
    try:
        with open(_CODE_FILE, "rb") as f:
            return hashlib.sha256(f.read()).hexdigest()
    except OSError:
        return ""


_CODE_SHA = _code_sha()
_code_seen = [0.0]


def code_changed() -> bool:
    now = time.time()
    if now - _code_seen[0] < 20:
        return False
    _code_seen[0] = now
    cur = _code_sha()
    return bool(cur) and cur != _CODE_SHA


def restart_bridge(eng) -> None:
    log("Neuer Code auf der Platte — die Brücke startet neu")
    try:
        eng.stop_own("Brücke startet neu")
    except Exception:  # noqa: BLE001
        pass
    try:
        sys.stdout.flush()
        sys.stderr.flush()
    except Exception:  # noqa: BLE001
        pass
    # 🔴 3.19.1: Windows starters up to 3.24.0 never recognized code 75 (ExitCode empty without a retained handle) — the
    #    bridge simply stayed off after new code, "no more songs". Only the starter from 3.24.1 sets MWS_SUPERVISED=1;
    #    under an older one the bridge starts its successor itself.
    if os.environ.get("MWS_TEST_RESPAWN") == "1" or (IS_WIN and os.environ.get("MWS_SUPERVISED") != "1"):
        try:
            err = open(os.path.join(DIR, "bridge.restart.log"), "ab")
        except OSError:
            err = subprocess.DEVNULL
        kw = ({"creationflags": subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP} if IS_WIN
              else {"start_new_session": True})
        subprocess.Popen([sys.executable, _CODE_FILE] + sys.argv[1:], cwd=os.path.dirname(_CODE_FILE),
                         stdin=subprocess.DEVNULL, stdout=err, stderr=err, close_fds=True, **kw)
        os._exit(0)
    if IS_WIN:
        os._exit(75)
    os.execv(sys.executable, [sys.executable, _CODE_FILE] + sys.argv[1:])


def brief_lane(cfg: dict) -> None:
    """Second lane: write briefs while the first may be computing for minutes.
    It does not touch the model server — only the local language model."""
    srv = Server(cfg)
    backoff = 2
    while True:
        try:
            st, job = srv.next_job(lane="brief")
            backoff = 2
        except Exception:  # network down, server deploying … — the main lane already logs that
            time.sleep(backoff)
            backoff = min(60, backoff * 2)
            continue
        if st == 204 or not job:
            continue
        _brief_active.set()
        try:
            _brief_job(cfg, srv, job)
        finally:
            _brief_active.clear()


def _brief_job(cfg: dict, srv, job: dict) -> None:
    jid = job["id"]
    if job.get("kind") not in (None, "brief"):
        Awake.hold(cfg)
        try:
            tool_job(cfg, srv, job)
        except NeedUpload:
            srv.error(jid, ARCHIV_FEHLT)
        except Exception as e:  # noqa: BLE001
            srv.error(jid, str(e) or type(e).__name__)
            log("Fehler bei %s (%s): %s" % (jid, job.get("kind"), e))
        finally:
            Awake.release(cfg)
        return
    log("Brief %s wird geschrieben (%s)" % (jid, find_writer(cfg) or "kein Modell"))
    try:
        srv.progress(jid, "Dein Mac schreibt den Brief …", job)
        brief = write_brief(cfg, (job.get("request") or {}).get("user") or "", (job.get("request") or {}).get("ui_lang") or "de")
        srv.result_json(jid, brief)
        log("Brief fertig in %.0f s: %s" % (brief.get("write_s", 0), brief.get("title", "")))
    except Exception as e:  # noqa: BLE001
        msg = str(e) or type(e).__name__
        if isinstance(e, urllib.error.URLError) and "127.0.0.1" in str(getattr(e, "reason", "")):
            msg = "Sprachmodell auf dem Mac nicht erreichbar"
        srv.error(jid, msg)
        log("Brief-Fehler bei %s: %s" % (jid, msg))


def run(cfg: dict) -> None:
    import signal
    signal.signal(signal.SIGTERM, _on_term)
    srv = Server(cfg)
    eng = Engine(cfg)
    log("Manuwave-Studio-Brücke %s · Server %s · Ablage %s · Brief-Schreiber %s" % (
        BRIDGE_VERSION, cfg["server"], RENDERS, find_writer(cfg) or "keiner"))
    threading.Thread(target=brief_lane, args=(cfg,), name="brief", daemon=True).start()
    threading.Thread(target=midi_lane, args=(cfg,), name="midi", daemon=True).start()    # 3.16: MIDI renders when idle
    # Did the last bridge die without cleaning up (crash, power loss, kill -9)?
    Engine.cancel_inflight("vom letzten Lauf übrig")
    ImageServer(cfg).cleanup_at_start()
    backoff = 2
    while True:
        try:
            st, job = srv.next_job()
            backoff = 2
        except urllib.error.HTTPError as e:
            if e.code == 401:
                log("Server lehnt den Schlüssel ab — neu koppeln: manuwave_bridge.py --pair")
            else:
                log("Server antwortet %d — neuer Versuch in %d s" % (e.code, backoff))
            time.sleep(backoff)
            backoff = min(60, backoff * 2)
            continue
        except Exception as e:  # network down, Mac just woke up, server deploying right now …
            log("Server nicht erreichbar (%s) — neuer Versuch in %d s" % (type(e).__name__, backoff))
            time.sleep(backoff)
            backoff = min(60, backoff * 2)
            eng.maybe_stop_idle()
            continue
        if st == 204 or not job:
            if code_changed() and not _brief_active.is_set() and not _job_active.is_set() and _midi_proc is None:
                restart_bridge(eng)
            eng.maybe_stop_idle()
            continue
        jid = job["id"]
        title = (job.get("meta") or {}).get("title", "")
        log("Auftrag %s (%s) %s" % (jid, job.get("kind"), title))
        tick = lambda msg: srv.progress(jid, msg, job)  # noqa: E731
        _job_active.set()          # 3.16: the MIDI lane stops immediately
        Awake.hold(cfg)
        try:
            # Only music and analysis need the model server — a cover or retrofit does not.
            # 🔴 Otherwise it would load ~8 GB just for one image, and the image model would not get the memory.
            if job.get("kind") not in ("nachruesten", "cover"):
                eng.ensure(lambda m: srv.progress(jid, m, job))
            if job.get("kind") == "understand":
                upload = srv.upload(jid)
                result = eng.understand(upload, job.get("filename") or "upload", tick)
                srv.result_json(jid, result)
                log("Analyse fertig: %s" % json.dumps(result, ensure_ascii=False)[:160])
            elif job.get("kind") == "analyse":
                analyse_job(cfg, eng, srv, job, tick)
            elif job.get("kind") in ("nachruesten", "cover"):
                finish_job(cfg, srv, job, tick)
            else:
                long_ = float((job.get("request") or {}).get("duration") or 0) > LONG_SINGLE
                if job.get("kind") == "weiter":        # 3.17: from the loop machine
                    audio, meta = render_weiter(cfg, eng, srv, job, tick)
                else:
                    audio, meta = (render_long if long_ else render_checked)(cfg, eng, srv, job, tick)
                path = archive(cfg, job, audio, meta)
                cover_next = False
                # 3.2: refine first (watermark + tags), THEN deliver — so no
                # track leaves the Mac without a mark. If refining fails, the track still goes
                # out (throwing away a quarter hour of compute would be worse) and says so;
                # "retrofit" makes up for it later.
                try:
                    if path:
                        meta["archived"] = rel_home(path)
                        # 3.5: the unmarked original stays (backup=True) — without it a track can
                        #      never be cleanly reprocessed again (found with a real track)
                        fin = veredeln(cfg, path, None, want_cover=False, tick=tick, backup=True)
                        meta["wasserzeichen"] = fin["id"]
                        if fin.get("wm_error"):
                            meta["veredeln_fehler"] = fin["wm_error"]
                        audio = _read_bytes(path) or audio
                        cover_next = rights(cfg)["cover"] and bool(find_image_model(cfg))
                    elif rights(cfg)["watermark"]:
                        info = {"title": (job.get("meta") or {}).get("title", ""), "archived": ""}
                        audio, meta["wasserzeichen"] = wm_embed(cfg, audio, info)
                        audio = wav_with_tags(audio, track_tags(cfg, dict(info_from_archive("", job.get("meta")),
                                                                         **{k: meta.get(k) for k in ("caption", "bpm", "keyscale", "seed")})))
                except Exception as e:  # noqa: BLE001
                    meta["veredeln_fehler"] = (str(e) or type(e).__name__)[:200]
                    log("Veredeln fehlgeschlagen (%s) — Track geht ohne Wasserzeichen raus" % e)
                if cover_next:
                    meta["cover"] = "folgt"
                srv.meta(jid, meta)
                srv.result_audio(jid, audio)
                log("fertig in %.0f s · %.1f s Audio · %s" % (meta.get("render_s", 0),
                    meta.get("duration_real", 0), path or "nicht abgelegt"))
                if cover_next:
                    # The cover comes AFTER the track: the track is audible immediately, the image follows.
                    try:
                        fin = veredeln(cfg, path, None, want_cover=True, tick=None, backup=False)
                        jpeg = _read_bytes(path[:-4] + ".jpg")
                        if jpeg:
                            srv.cover(jid, jpeg)
                            log("Cover fertig: %s" % os.path.basename(path[:-4] + ".jpg"))
                        else:
                            srv.cover_failed(jid, fin.get("cover_error") or "kein Cover")
                    except Exception as e:  # noqa: BLE001
                        srv.cover_failed(jid, str(e) or type(e).__name__)
                        log("Cover fehlgeschlagen: %s" % e)
        except NeedUpload:
            srv.error(jid, ARCHIV_FEHLT)
        except Cancelled:
            srv.error(jid, "abgebrochen")
            log("abgebrochen: " + jid)
        except Exception as e:  # noqa: BLE001
            msg = str(e) or type(e).__name__
            if isinstance(e, urllib.error.URLError) and "127.0.0.1" in str(getattr(e, "reason", "")):
                msg = "Modellserver auf dem Mac nicht erreichbar"
            srv.error(jid, msg)
            log("Fehler bei %s: %s" % (jid, msg))
        finally:
            _job_active.clear()
            Awake.release(cfg)


class Awake:
    """3.7: The machine must not sleep while a job is running — even if Safari is in the background.
    On 13.10. the screen went off at 17:49; the Mac kept computing, but Safari aborted fetching a finished track at 18:10.
    As long as the bridge has a job — and 3 min after, so the browser still fetches the
    finished track —, `caffeinate` keeps the Mac AND the screen awake (-d -i -m). `-w` ends it
    by itself when the bridge dies. Disable: "wach_halten": false in bridge.json.
    If the user locks the Mac themselves, nothing can prevent that — then the page catches up on unlock (3.6.1)."""
    NACHLAUF_S = 180
    _lock = threading.Lock()
    _n = 0
    _proc = None
    _timer = None

    @classmethod
    def hold(cls, cfg: dict) -> None:
        if cfg.get("wach_halten") is False or sys.platform != "darwin":
            return
        with cls._lock:
            cls._n += 1
            if cls._timer:
                cls._timer.cancel()
                cls._timer = None
            if cls._proc is None or cls._proc.poll() is not None:
                try:
                    cls._proc = subprocess.Popen(["/usr/bin/caffeinate", "-d", "-i", "-m", "-w", str(os.getpid())],
                                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                except OSError as e:
                    cls._proc = None
                    log("Wachhalten nicht möglich (%s)" % e)

    @classmethod
    def release(cls, cfg: dict) -> None:
        if cfg.get("wach_halten") is False or sys.platform != "darwin":
            return
        with cls._lock:
            cls._n = max(0, cls._n - 1)
            if cls._n == 0 and cls._proc is not None:
                t = threading.Timer(cls.NACHLAUF_S, lambda: cls._stop(t))
                t.daemon = True
                cls._timer = t
                t.start()

    @classmethod
    def _stop(cls, me) -> None:
        # 🔴 Review 3.7: an already fired timer that is waiting for the lock can no longer be cancelled —
        #    only the CURRENT one may stop (otherwise the grace period of a newer job would be lost)
        with cls._lock:
            if cls._timer is not me:
                return
            cls._timer = None
            if cls._n == 0 and cls._proc is not None:
                p, cls._proc = cls._proc, None
                p.terminate()
                try:
                    p.wait(2)
                except Exception:  # noqa: BLE001
                    p.kill()


# =============================================================================
# Pairing, service on/off, status
# =============================================================================

def pair(cfg: dict) -> None:
    cfg = ensure_token(cfg)
    link = cfg["server"].rstrip("/") + "/#bridge=" + cfg["token"]
    try:
        code = Server(cfg).pair_code().get("code", "")
    except Exception as e:  # noqa: BLE001
        code = ""
        print("Code konnte nicht geholt werden (%s) — der Link funktioniert trotzdem." % e)
    print("\n  Manuwave Studio koppeln")
    print("  ─────────────────")
    if code:
        print("  Code (10 Minuten gültig):  %s" % code)
        print("  → in Manuwave Studio: ⚙️ Einstellungen › Mac-Brücke › Code eingeben")
    print("  Oder diesen Link auf dem Gerät öffnen:\n  %s\n" % link)
    if sys.platform == "darwin":
        # The dialog runs with a timeout — without it --install would hang until someone clicks OK.
        subprocess.run(["open", link], check=False)
        if code:
            subprocess.run(["osascript", "-e",
                            'display dialog "Manuwave-Studio-Kopplungscode:\\n\\n%s\\n\\nIn Manuwave Studio unter '
                            '⚙️ Einstellungen › Mac-Brücke eingeben (10 Minuten gültig). Auf diesem Mac '
                            'ist der Browser schon gekoppelt." buttons {"OK"} default button "OK" '
                            'with title "Manuwave Studio" giving up after 300' % code], check=False,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def install_target(here: str) -> str:
    """Where the installed copy of the bridge lives: an installed bridge keeps the file name it already has
    (the service points at it); anything else (a fresh download) is installed under the current name."""
    name = os.path.basename(here)
    return os.path.join(DIR, name if name in BRIDGE_NAMES else BRIDGE_NAMES[0])


def install(cfg: dict) -> None:
    cfg = ensure_token(cfg)
    os.makedirs(DIR, exist_ok=True)
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    here = os.path.abspath(__file__)
    target = install_target(here)
    if here != target:
        with open(here, "rb") as src, open(target, "wb") as dst:
            dst.write(src.read())
        os.chmod(target, 0o755)
    # Template like other launchd user services: system Python, start at
    # login, restart on crash, log under ~/Library/Logs.
    plist = """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>%s</string>
  <key>ProgramArguments</key>
  <array><string>/usr/bin/python3</string><string>%s</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>%s</string>
  <key>StandardErrorPath</key><string>%s</string>
</dict></plist>
""" % (LABEL, target, LOG, LOG)
    os.makedirs(os.path.dirname(PLIST), exist_ok=True)
    with open(PLIST, "w", encoding="utf-8") as f:
        f.write(plist)
    uid = os.getuid()
    service = "gui/%d/%s" % (uid, LABEL)
    subprocess.run(["launchctl", "bootout", service], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    # 🔴 bootout returns BEFORE the old service is torn down. An immediate bootstrap
    #    then fails with "5: Input/output error" — and the old one is gone anyway.
    #    So wait until launchd has really forgotten it, and retry if necessary.
    for _ in range(40):
        if subprocess.run(["launchctl", "print", service], stdout=subprocess.DEVNULL,
                          stderr=subprocess.DEVNULL).returncode != 0:
            break
        time.sleep(0.25)
    for attempt in range(5):
        r = subprocess.run(["launchctl", "bootstrap", "gui/%d" % uid, PLIST], capture_output=True, text=True)
        if r.returncode == 0:
            break
        time.sleep(1 + attempt)
    if r.returncode != 0:
        print("launchctl: " + (r.stderr or r.stdout).strip())
        sys.exit(1)
    print("Dienst %s läuft. Log: %s" % (LABEL, LOG))


def uninstall() -> None:
    subprocess.run(["launchctl", "bootout", "gui/%d/%s" % (os.getuid(), LABEL)],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        os.remove(PLIST)
    except OSError:
        pass
    print("Dienst entfernt. Deine Tracks in %s bleiben liegen." % RENDERS)


def status(cfg: dict) -> None:
    r = subprocess.run(["launchctl", "print", "gui/%d/%s" % (os.getuid(), LABEL)],
                       capture_output=True, text=True)
    m = re.search(r"state = (\w+)", r.stdout)
    print("Dienst:       %s" % (m.group(1) if m else "nicht eingerichtet"))
    print("Server:       %s" % cfg["server"])
    print("gekoppelt:    %s" % ("ja" if cfg.get("token") else "nein"))
    eng = Engine(cfg)
    print("Musik-KI:     %s" % ("läuft" if Engine._up(eng.synth) else "aus (startet bei Bedarf)"))
    print("Brief:        %s" % (("Mac · " + find_writer(cfg)) if find_writer(cfg)
                                else "kein Sprachmodell auf dem Mac (Ollama) — Brief aus den Angaben"))
    n = sum(len([f for f in fs if f.endswith(".wav")]) for _, _, fs in os.walk(RENDERS)) \
        if os.path.isdir(RENDERS) else 0
    print("Tracks:       %d in %s" % (n, RENDERS))


def nachruesten_cli(cfg: dict) -> None:
    import signal
    # Aborting (kill/launchctl) should take the image server along: SystemExit runs through the with blocks
    signal.signal(signal.SIGTERM, lambda *a: sys.exit(143))
    files = all_archived()
    print("%d Tracks im Archiv · Rechteinhaber: %s · Bildmodell: %s" % (
        len(files), rights(cfg)["owner"] or "?", find_image_model(cfg) or "keins (ohne Cover)"))
    ok = bad = 0
    for i, p in enumerate(files, 1):
        t0 = time.monotonic()
        try:
            fin = veredeln(cfg, p, None, want_cover=True)
            ok += 1
            print("%2d/%d %s · %s%s · %.0f s" % (i, len(files), os.path.basename(p), ", ".join(fin["changed"]) or "schon vollständig",
                                              (" · Cover: " + fin["cover_error"]) if fin.get("cover_error") else "",
                                              time.monotonic() - t0), flush=True)
        except Exception as e:  # noqa: BLE001
            bad += 1
            print("%2d/%d %s · FEHLER: %s" % (i, len(files), os.path.basename(p), e), flush=True)
    print("fertig: %d veredelt, %d Fehler. Unmarkierte Originale: %s" % (ok, bad, ORIG_DIR))


def main() -> None:
    ap = argparse.ArgumentParser(description="Manuwave-Studio-Brücke: der Mac rechnet die echte Musik-KI.")
    ap.add_argument("--server", help="Manuwave-Studio-Adresse, z. B. http://127.0.0.1:8104")
    ap.add_argument("--pair", action="store_true", help="koppeln: zeigt einen Code und öffnet den Link")
    ap.add_argument("--install", action="store_true", help="als Dienst einrichten (startet mit dem Mac)")
    ap.add_argument("--uninstall", action="store_true", help="Dienst entfernen")
    ap.add_argument("--status", action="store_true", help="Zustand anzeigen")
    ap.add_argument("--nachruesten", action="store_true",
                    help="alle Tracks im Archiv veredeln: Wasserzeichen, Tags, Cover")
    ap.add_argument("--pruefen", metavar="DATEI", help="trägt diese Datei unser Wasserzeichen?")
    ap.add_argument("--hq", metavar="ARCHIV-WAV", help="neue Version in bester Qualität anlegen (derselbe Inhalt)")
    ap.add_argument("--variante", default="C", help="Name der neuen Version für --hq (Standard C)")
    a = ap.parse_args()
    cfg = load_config()
    if a.server:
        cfg["server"] = a.server.rstrip("/")
        save_config(ensure_token(cfg))
    if a.uninstall:
        return uninstall()
    if a.status:
        return status(cfg)
    if a.pruefen:
        res = wm_detect(cfg, a.pruefen)
        if res["found"]:
            i = res["info"]
            print("✅ Unser Wasserzeichen (Wert %.2f) · Kennung %s" % (res["score"], res["id"]))
            print("   %s%s · %s · %s" % (i.get("title", "unbekannt"), (" · " + i["variant"]) if i.get("variant") else "",
                                        i.get("owner", "?"), i.get("at", "?")) if i else "   (nicht im Verzeichnis dieses Macs)")
        else:
            print("✗ Kein Wasserzeichen dieses Macs gefunden (Wert %.2f)" % res["score"])
        return
    if a.nachruesten:
        return nachruesten_cli(cfg)
    if a.hq:
        print(hq_version(cfg, os.path.abspath(os.path.expanduser(a.hq)), a.variante))
        return
    if a.install:
        install(cfg)
        pair(cfg)
        return
    if a.pair:
        return pair(cfg)
    cfg = ensure_token(cfg)
    try:
        run(cfg)
    except KeyboardInterrupt:
        Engine.cancel_inflight("Strg-C")
        log("beendet")


if __name__ == "__main__":
    main()

