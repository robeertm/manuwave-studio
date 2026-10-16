#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Manuwave-Studio-Brücke — lässt den Mac die echte Musik-KI rechnen.

Manuwave Studio läuft auf einem kleinen Rechner ohne Grafikchip. ACE-Step 1.5 braucht
einen. Diese Brücke läuft auf dem Mac, holt sich Aufträge beim Manuwave-Studio-Server ab,
rechnet sie mit dem lokalen ace-server (acestep.cpp) und schickt das Ergebnis zurück.

🔑 Der Mac verbindet sich NACH AUSSEN. Er öffnet keinen Port, und der ace-server
   bleibt auf 127.0.0.1 — von außen ist auf dem Mac nichts Neues erreichbar.

    python3 neonforge_bridge.py --pair        # koppeln (zeigt einen Code)
    python3 neonforge_bridge.py --install     # als Dienst einrichten (startet mit dem Mac)
    python3 neonforge_bridge.py --uninstall   # Dienst entfernen
    python3 neonforge_bridge.py --status      # was läuft gerade?
    python3 neonforge_bridge.py               # im Vordergrund laufen lassen

Den Produktions-Brief schreibt das Sprachmodell auf dem Mac (Ollama) — seit 3.0 gibt es
in Manuwave Studio keinen Cloud-Dienst mehr.

Seit 3.2 veredelt der Mac jeden Track: unhörbares Wasserzeichen (audiowmark), Tags mit dem
Copyright aus den Einstellungen, ein KI-Cover (Bildmodell über Ollama), Export als MP3 oder
verlustfrei (FLAC, ALAC, WAV, AIFF, WavPack, TTA).

    python3 neonforge_bridge.py --nachruesten  # alle Tracks im Archiv nachträglich veredeln
    python3 neonforge_bridge.py --pruefen DATEI  # trägt diese Datei unser Wasserzeichen?

Nur Standardbibliothek, lauffähig ab Python 3.9 (das System-Python von macOS).
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
    import audioop  # Standardbibliothek bis 3.12 — das macOS-System-Python ist 3.9
except ImportError:  # ab 3.13 entfernt: dann bleibt das Ende ungeglättet (siehe smooth_end)
    audioop = None

BRIDGE_VERSION = "3.12.1"
HOME = os.path.expanduser("~")
IS_MAC, IS_WIN = sys.platform == "darwin", os.name == "nt"
EXE = ".exe" if IS_WIN else ""
# 3.11: Ablage wählbar ($MWS_HOME). Eine bestehende Installation unter ~/NeonForge bleibt, wo sie ist;
#       neue Installationen (Installer von Manuwave Studio) liegen unter ~/ManuwaveStudio.
#       🔴 Der Ordner muss im Benutzerordner liegen: Archivpfade reisen relativ zu ~ (NeonForge/renders/…).
DIR = os.environ.get("MWS_HOME") or (os.path.join(HOME, "NeonForge") if os.path.isdir(os.path.join(HOME, "NeonForge"))
                                     else os.path.join(HOME, "ManuwaveStudio"))
CONFIG = os.path.join(DIR, "bridge.json")
INFLIGHT = os.path.join(DIR, "inflight.json")    # der Auftrag, den der Modellserver gerade rechnet
RENDERS = os.path.join(DIR, "renders")
LABEL = "com.robert.neonforge-bridge"
PLIST = os.path.join(HOME, "Library", "LaunchAgents", LABEL + ".plist")
LOG = os.path.join(HOME, "Library", "Logs", "neonforge-bridge.log") if IS_MAC else os.path.join(DIR, "bridge.log")

DEFAULTS = {
    "server": "http://127.0.0.1:8104",          # lokale Installation; eine gekoppelte trägt ihre Adresse in bridge.json
    "token": "",
    # Die Musik-KI (acestep.cpp + Modelle) — legt der Installer hier ab. Ältere Installationen tragen
    # ihren Pfad (z. B. vom Music Generator) ausdrücklich in bridge.json.
    "engine_dir": os.path.join(DIR, "engine", "acestep.cpp"),
    "engine_conf": os.path.join(DIR, "engine.conf"),
    # 3.10: Veröffentlichen auf einer eigenen Fahrstuhlmusik-Seite — leer = aus (Knopf erscheint nicht)
    "web_admin": "",
    # 3.11: Cover-Weg. "" = selbst wählen: macOS → Ollama 0.32.5 (MLX), sonst → stable-diffusion.cpp (sd-server)
    "image_backend": "",
    "sd_port": 11441,
    "synth_port": 8085,
    "lm_port": 8086,
    "synth_model": "acestep-v15-sft-Q8_0.gguf",
    "idle_stop_min": 15,     # selbst gestarteten Modellserver nach so viel Leerlauf beenden
    "keep_renders": True,    # jede fertige Datei zusätzlich auf dem Mac ablegen
    # Den Produktions-Brief schreibt der Mac selbst (Ollama). Leer = selbst das beste wählen.
    "writer_url": "http://127.0.0.1:11434",
    "writer_model": "",
    # Klangführung der Musik-KI (APG), wenn der Browser keine mitschickt. 7,0 rechnet der
    # Modellserver in seinem eigenen Vergleich mit dem Python-Original für SFT; bis 2.2 lief
    # jeder Track mit 1,0 = ungeführt. 1,0 schaltet sie ab.
    "guidance_scale": 7.0,
    # 3.2: Urheberangaben für Tags und Wasserzeichen — in Manuwave Studio unter ⚙️ einstellbar.
    # Leerer Rechteinhaber = voller Name des Mac-Kontos (wird beim ersten Lauf eingetragen).
    "rights": {},
    # Bildmodell fürs Cover (Ollama). Leer = selbst wählen (FLUX.2 klein vor Z-Image).
    "image_model": "",
    #    supported", ollama#17893/#18863 — soll auf einem neuen MLX-Runner zurückkommen). Darum
    #    läuft fürs Cover ein eigenes Ollama 0.32.5 unter ~/NeonForge/tools/ollama-bild, nur bei
    #    Bedarf und auf eigenem Port — das Ollama von DocuSort bleibt unberührt.
    "image_port": 11439,
}

# Felder, die an den ace-server gehen dürfen — der Mac traut dem Server nicht blind.
ACE_FIELDS = {"caption", "lyrics", "bpm", "duration", "keyscale", "timesignature",
              "vocal_language", "seed", "inference_steps", "guidance_scale",
              "lm_temperature", "use_cot_caption"}


def log(msg: str) -> None:
    print(time.strftime("%Y-%m-%d %H:%M:%S ") + msg, flush=True)


# =============================================================================
# Einstellungen
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
    # 0600: der Schlüssel ist die Berechtigung — niemand sonst auf dem Mac liest ihn (mkstemp legt 0600 an).
    with FileLock("bridge-config"):
        fd, tmp = tempfile.mkstemp(dir=DIR, prefix=".bridge-", suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2, ensure_ascii=False)
        os.replace(tmp, CONFIG)
        os.chmod(CONFIG, 0o600)


def ensure_token(cfg: dict) -> dict:
    if not re.match(r"^[A-Za-z0-9_-]{24,128}$", cfg.get("token") or ""):
        cfg["token"] = secrets.token_urlsafe(32)      # 256 Bit
        save_config(cfg)
    return cfg


def engine_conf(cfg: dict) -> dict:
    """Was der Installer des Music Generators gemessen hat (MODE, LM_FILE)."""
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
    """Klangmodelle (DiT) im Modellordner: Kurzname → Datei, z. B. "xl-sft" → acestep-v15-xl-sft-Q8_0.gguf.
    Bei mehreren Quantisierungen gewinnt Q8_0."""
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
            "caps": caps_for(cfg), "image": find_image_model(cfg)}


# =============================================================================
# Der Brief-Schreiber: ein lokales Sprachmodell (Ollama) auf dem Mac
# =============================================================================

# Bevorzugte Modelle, in dieser Reihenfolge — instruktionsfeste, die JSON nach Schema können.
WRITER_PREFER = ("qwen2.5:14b", "qwen2.5:7b", "qwen3", "qwen2.5", "llama3.1", "llama3",
                 "gemma3", "gemma2", "mistral")
_writer_cache = {"at": 0.0, "name": ""}
_writer_lock = threading.Lock()


def find_writer(cfg: dict) -> str:
    """Name des Modells, das hier Briefe schreibt — "" heißt: kann der Mac gerade nicht.
    Gefragt wird bei jeder Abholung (alle ~25 s), deshalb eine Minute gemerkt."""
    now = time.time()
    with _writer_lock:
        if now - _writer_cache["at"] < 60:
            return _writer_cache["name"]
    name = ""
    try:
        with urllib.request.urlopen(cfg["writer_url"].rstrip("/") + "/api/tags", timeout=3) as r:
            names = [m.get("name", "") for m in json.loads(r.read()).get("models", [])]
        names = [n for n in names if n and "embed" not in n.lower()]
        want = (cfg.get("writer_model") or "").strip()
        if want and want in names:
            name = want
        else:
            for pre in WRITER_PREFER:
                hit = [n for n in names if n.startswith(pre)]
                if hit:
                    name = sorted(hit)[0]
                    break
            name = name or (names[0] if names else "")
    except Exception:
        name = ""
    with _writer_lock:
        _writer_cache.update(at=now, name=name)
    return name


# Ein kleines Modell schreibt nur dann einen brauchbaren Brief, wenn man ihm wenig
# Spielraum lässt: Tags in Gruppen mit Mindestzahl (sonst kommen 8 statt 20), Text als
# Liste von Abschnitten (sonst klebt die Hook am Marker), und das Gerüst gibt der
# Browser vor (sonst ignoriert es die Länge). Gemessen an qwen2.5:7b am 10.10.2026.
WRITER_SYSTEM = """Du bist ein erfahrener Produzent und Songwriter für jede Richtung — von Techno und House über Pop,
Hip-Hop, Rock und Jazz bis Orchester und Filmmusik. Du schreibst den
Produktions-Brief für die Musik-KI ACE-Step 1.5. Alle Tags auf ENGLISCH, konkret, keine Künstler- oder Songnamen.
Die genannte Richtung bestimmt Klänge, Groove und Tempo — schreib einem Jazz-Stück keine Synths und keinem Rock-Song einen Drop.
Die Beispiele unten sind nur Muster: übernimm KEINES, das nicht zur Richtung passt. Klänge, die die Idee nennt, haben
Vorrang — übersetze sie ins Englische (z. B. „Kontrabass" → "upright bass", „Besen-Schlagzeug" → "brushed drums").
- genre_tags: Genre + Subgenre ("melodic techno", "progressive house", "indie rock", "bossa nova", "cinematic orchestral")
- rhythm_tags: Groove — Club: ("four-on-the-floor", "rolling 16th hi-hats", "shuffled groove", "broken beat");
  andere Richtungen: ("laid-back backbeat", "swing feel", "bossa nova groove", "half-time groove", "driving rock beat", "rubato, no fixed beat")
- instrument_tags: konkrete Klänge ("analog bassline", "detuned supersaw lead", "acid 303 line", "plucked arpeggio", "warm pads", "rumbling sub bass", "vocal chops",
  "fingerpicked acoustic guitar", "upright bass", "brushed drums", "string section", "overdriven electric guitar", "brass section")
- production_tags: wie der fertige Mix KLINGT, nicht wie er gebaut ist ("warm analog mix", "polished production",
  "wide stereo", "deep clean bass", "crisp clear highs", "natural dynamics", "lush reverb", "punchy kick").
  KEINE Technik-Wörter (kein "sidechain compression", "parallel compression", "tape saturation", "loud master")
  und nichts Kratziges ("distorted", "bitcrushed", "lo-fi", "harsh") — außer die Aufgabe verlangt es ausdrücklich.
- mood_tags: Stimmung ("hypnotic", "euphoric", "dark", "driving", "uplifting", "melancholic", "peak-time").
  Bei Gesang zusätzlich EIN Tag, der die Stimme natürlich beschreibt ("warm natural female vocals",
  "intimate breathy vocals", "soulful expressive male vocals") — keine Effekte wie "autotune", "vocoder".
- sections: GENAU das vorgegebene Gerüst, in dieser Reihenfolge, mit denselben Markern. lines = die Textzeilen des Abschnitts.
  Instrumentale Abschnitte bekommen lines = [].
  Gesangsabschnitte: 4 eigene, singbare Zeilen (3–8 Wörter), mit Reimen, in der SPRACHE, die die Aufgabe nennt.
  Jeder [Chorus] ist bei jedem Auftreten WORTGLEICH und enthält die Hook. Strophen erzählen weiter und wiederholen keine Zeile.
  Vocal-Chops: nur kurze Silben oder einzelne Wörter ("oh-oh", "hey"), höchstens 2 Zeilen.
  Eigener Text, nie ein bekannter Songtext.
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
        "genre_tags": dict(_TAGS, minItems=2, maxItems=4),
        "rhythm_tags": dict(_TAGS, minItems=2, maxItems=4),
        "instrument_tags": dict(_TAGS, minItems=4, maxItems=8),
        "production_tags": dict(_TAGS, minItems=3, maxItems=5),
        "mood_tags": dict(_TAGS, minItems=3, maxItems=5),
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


NOTE_DE = "- note: 2–4 Sätze AUF DEUTSCH (auch wenn der Songtext englisch ist)"
NOTE_EN = "- note: 2–4 Sätze AUF ENGLISCH (die Oberfläche ist englisch)"


def writer_system(ui_lang: str = "de") -> str:
    """3.12: bei englischer Oberfläche schreibt das Modell die Notiz englisch — sonst wie bisher deutsch."""
    return WRITER_SYSTEM.replace(NOTE_DE, NOTE_EN) if ui_lang == "en" else WRITER_SYSTEM


def assemble_brief(raw: dict) -> dict:
    """Antwort des Modells → der Brief, den der Browser kennt (caption, lyrics, bpm, …)."""
    seen, tags = set(), []
    for g in TAG_GROUPS:
        for t in raw.get(g) or []:
            t = re.sub(r"\s+", " ", str(t)).strip(" ,.;")
            if t and len(t) <= 60 and t.lower() not in seen:
                seen.add(t.lower())
                tags.append(t)
    parts = []
    for sec in (raw.get("sections") or [])[:24]:
        if not isinstance(sec, dict):
            continue
        marker = re.sub(r"[\[\]]", "", str(sec.get("marker") or "")).strip()[:30]
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
    """Was ein kleines Modell gern falsch macht (gemessen): Strophenzeilen doppelt
    („Meer der Freiheit, / Meer der Freiheit, …"), Refrains mit 7 Zeilen derselben Hook.
    Im Refrain ist eine wiederholte Hook-Zeile gewollt — dort zählt nur die Länge."""
    out = []
    for head, lines in _blocks(brief.get("lyrics") or ""):
        norm = [x.lower().strip(" ,.!?") for x in lines]
        if len(lines) > 6:
            out.append("%s hat %d Zeilen" % (head, len(lines)))
        if not head.lower().startswith(("[chorus", "[hook")) and len(set(norm)) < len(norm):
            out.append("%s wiederholt Zeilen" % head)
    words = re.findall(r"[a-zäöüß]+", (brief.get("note") or "").lower())
    if ui_lang == "en":
        # 3.12: englische Oberfläche → die Notiz soll englisch sein
        if len(words) >= 8 and sum(w in DE_WORDS for w in words) >= 4:
            out.append("note not in English")
    elif len(words) >= 8 and sum(w in DE_WORDS for w in words) < 2:
        out.append("Notiz nicht deutsch")
    return out


DE_WORDS = {"der", "die", "das", "und", "mit", "ein", "eine", "ist", "im", "den", "dem", "des", "zu",
            "auf", "für", "sich", "wird", "von", "nicht", "einen", "einem", "durch", "über"}


def _collapse_repeats(brief: dict) -> None:
    """Letzter Ausweg: direkt wiederholte Zeilen außerhalb des Refrains zusammenfassen."""
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


# compression, distorted stab layers, loud club master"). Die Musik-KI nimmt das wörtlich.
# Steht so etwas nicht ausdrücklich in der Aufgabe, fliegt es aus den Tags.
HARSH_TAG = re.compile(r"distort|bitcrush|lo-?fi|harsh|saturat|overdriv|clipping|crush|"
                       r"loud (club )?master|brickwall|parallel (drum )?compression|sidechain", re.I)
WANTS_HARSH = re.compile(r"verzerr|distort|lo-?fi|industrial|hard ?techno|hardgroove|hardstyle|dreckig|dirty|rough|kratz|crunch|"
                         r"noise|saturat|sidechain|pump|\brock\b|metal|punk|grunge|shoegaze|dubstep|neurofunk|phonk|drill|gabber|hardcore", re.I)


def soften_caption(brief: dict, user: str) -> list:
    """Kratzige/technische Tags entfernen, wenn die Aufgabe sie nicht verlangt. Gibt die
    entfernten zurück (fürs Log)."""
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
    req = urllib.request.Request(cfg["writer_url"].rstrip("/") + "/api/chat",
                                 data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=240) as r:
        answer = json.loads(r.read())
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
    # Ein Fehlgriff ist Zufall der Stichprobe — ein zweiter Wurf behebt ihn meist.
    # Höchstens zwei Würfe: der Brief soll in Sekunden stehen, nicht in Minuten.
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
# Verbindung zum Manuwave-Studio-Server
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

    def progress(self, jid, message) -> bool:
        """True, wenn der Browser abbrechen will."""
        try:
            _, r = self._req("POST", "/api/bridge/progress/" + jid, body={"message": message}, timeout=15)
            return bool((r or {}).get("cancel"))
        except Exception:
            return False

    def meta(self, jid, meta):
        self._req("POST", "/api/bridge/meta/" + jid, body=meta, timeout=30)

    def _send(self, jid, data, ctype):
        """Ein Ergebnis zum Server — mit Geduld. 🔴 12.10.2026: ein 41-MB-Track (16 min gerechnet)
        scheiterte nach festen 300 s („urlopen error timed out"), weil der Tunnel Mac → Pi über ein
        Relais lief und nebenbei ein großer Download ihn auslastete (0,42 statt 1,9 MB/s).
        Jetzt: Frist nach Größe (mindestens 60 KB/s), drei Versuche; ein 409 beim Wiederholen heißt
        „ist schon angekommen". Der Track liegt ohnehin im Archiv."""
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
# Der lokale Modellserver (ace-server)
# =============================================================================

class Cancelled(Exception):
    pass


class Engine:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.own = []                # selbst gestartete Prozesse — nur DIE werden später beendet
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
        """Modellserver starten, falls er nicht läuft — genauso wie „Music Generator ON"."""
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
                raise RuntimeError("Modellserver ist nicht hochgekommen — Log in ~/NeonForge/")
        self.last_used = time.time()

    def maybe_stop_idle(self) -> None:
        """Nur selbst Gestartetes beenden — einen vom Music Generator gestarteten
        Modellserver fassen wir nie an, der gehört jemand anderem."""
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

    # ---- HTTP zum ace-server ----
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

    # ---- Verwaiste Aufträge ----
    # 🔴 GEMESSEN: stirbt die Brücke mitten in einem Auftrag (Dienst-Neustart, Mac
    #    schläft ein, Prozess beendet), rechnet der Modellserver den Auftrag trotzdem
    #    zu Ende — für niemanden. Er nimmt nur einen auf einmal, also stand alles
    #    Neue dahinter: ein 15-s-Track brauchte 3:41 statt einer Minute.
    #    Darum wird der laufende Auftrag auf der Platte vermerkt und beim Beenden
    #    UND beim nächsten Start abgebrochen.
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
        """Einen vermerkten Auftrag beim Modellserver abbrechen. True, wenn es einen gab."""
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
            pass   # Modellserver aus → nichts mehr zu tun
        cls._clear_inflight()
        return True

    def _wait(self, base, job_id, label, t0, tick):
        """Auf einen Auftrag des Modellservers warten. tick() → True heißt abbrechen."""
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
        """Einen Teil aus einer multipart/mixed-Antwort holen (audio/ oder application/json)."""
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

    def render(self, request: dict, tick):
        req = {k: v for k, v in request.items() if k in ACE_FIELDS}
        req["duration"] = max(10.0, min(300.0, float(req.get("duration") or 90)))
        if int(req.get("seed", -1)) < 0:
            req["seed"] = random.randint(0, 2 ** 31 - 1)
        req.setdefault("lyrics", "[Instrumental]")
        req.setdefault("use_cot_caption", False)
        # Klangführung: ohne Angabe (ältere Browser-Fassung) gilt die eingestellte, nicht 1,0.
        if not req.get("guidance_scale"):
            req["guidance_scale"] = float(self.cfg.get("guidance_scale") or 1.0)
        req["output_format"] = "wav16"
        #    flache Spitzen je Track, bis zu 23 Samples am Stück. 0 = nur auf die Spitze normalisieren.
        req["peak_clip"] = 0
        req["synth_model"] = self.cfg["synth_model"]
        # Klangmodell nach Wunsch (z. B. "xl-sft") — nur, was auf der Platte liegt UND der laufende
        # Modellserver kennt (er liest seinen Ordner nur beim Start).
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
        # 1) Sprachmodell: plant Aufbau, Tempo, Tonart — und erzeugt die Audio-Codes
        _, raw = self._http("POST", self.lm + "/lm", body=req)
        _, raw = self._wait(self.lm, str(json.loads(raw)["id"]), "Komposition", t0, tick)
        enriched = json.loads(raw)
        enriched = enriched[0] if isinstance(enriched, list) else enriched
        if not enriched.get("audio_codes"):
            raise RuntimeError("Das Sprachmodell hat keine Audio-Codes geliefert.")
        enriched["output_format"] = "wav16"
        enriched["peak_clip"] = 0
        enriched["synth_model"] = req["synth_model"]
        # Die Klang-Regler gehören der Synthese. Der Modellserver reicht sie über /lm durch
        # (gemessen) — hier trotzdem ausdrücklich, damit es nicht an seinem Echo hängt.
        for k in ("guidance_scale", "inference_steps"):
            if req.get(k):
                enriched[k] = req[k]
        # 2) Synthese: daraus wird Klang
        _, raw = self._http("POST", self.synth + "/synth", body=enriched)
        ctype, raw = self._wait(self.synth, str(json.loads(raw)["id"]), "Klang", t0, tick)
        audio = self._part(ctype, raw, "audio/")
        meta = {k: enriched.get(k) for k in ("bpm", "duration", "keyscale", "timesignature",
                                            "vocal_language", "lyrics", "caption")}
        meta["seed"] = req["seed"]
        meta["peak_clip"] = 0          # 3.4: ohne Clipping gerechnet — das Mastering muss nichts reparieren
        # 3.4: derselbe Seed ergibt NICHT dasselbe Stück (gemessen: Korrelation 0,06) — die Komposition
        #      des Sprachmodells aufheben, damit ein Track später ohne neues Würfeln neu klingen kann.
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
        """Die Klangmodelle, die der laufende Modellserver kennt (None = unbekannt)."""
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
# Weiches Ende
# =============================================================================
# der Pegel in 0,1–0,2 s von voller Lautstärke auf Stille (oft gefolgt von Sekunden Stille,
# weil das Sprachmodell der Musik-KI vor der Länge aufhört). Die Songs des Music Generators
# klangen dagegen über 2–10 s aus. Ein harter Schnitt in den letzten 12 s wird darum weich
# ausgeblendet und die Stille dahinter gekürzt. Ein Track, der schon ausklingt, bleibt unberührt.
def smooth_end(audio: bytes, fade_s: float = 4.0, tail_s: float = 0.8):
    """→ (audio, info|None). info sagt, was geändert wurde."""
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
    if (n - last) * 0.1 > 12:              # endet früh oder klingt lang aus — nicht anfassen
        return audio, None
    quiet = next((i for i in range(last + 1, n) if dbs[i] < med - 30), n)
    if quiet - last > 5:                   # mehr als 0,5 s vom Lauten ins Stille = klingt schon aus
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
# Veredeln (seit 3.2): Urheber, Wasserzeichen, Tags, Cover, Export
# =============================================================================
# copierschutz wasserzeichen bekommen, jeder song der auf meinem rechner erzeugt wird muss
#
# 🔑 Darum steht KEIN Name im Code. Die Angaben gehören zu DIESEM Mac (bridge.json →
#    "rights"), sind in Manuwave Studio unter ⚙️ einstellbar, und beim ersten Lauf trägt die
#    Brücke den vollen Namen des Mac-Kontos als Rechteinhaber ein.
# 🔑 Das Wasserzeichen (audiowmark, mit eigenem Schlüssel) ist UNHÖRBAR und übersteht
#    MP3, Umrechnen und Ausschneiden — es verhindert kein Kopieren (das kann keine
#    abspielbare Datei), aber es BEWEIST die Herkunft: wer den Schlüssel hat, liest aus
#    jeder Kopie, welcher Track es ist. Tags dagegen kann jeder löschen.
# 🔑 Das Cover malt ein Bildmodell auf dem Mac (Ollama, z. B. FLUX.2 klein) — wie beim
#    Brief keine Cloud. Fehlt es, bleibt der Track ohne Cover, statt zu scheitern.

TOOLS_BIN = os.path.join(DIR, "tools", "bin")
WM_KEY = os.path.join(DIR, "wasserzeichen.key")      # 0600 — ohne ihn ist kein Zeichen mehr lesbar
WM_REG = os.path.join(DIR, "wasserzeichen.json")     # Kennung → Titel, Datei, Rechteinhaber
ORIG_DIR = os.path.join(RENDERS, "_original_vor_wasserzeichen")
WM_MAGIC = "4e4601"
#    und gemessen weiter lesbar nach MP3 320/128, nach +10 dB Bass/+9 dB Höhen + Limiter + 44,1 kHz + MP3 192
#    (Wert 2,4 bei Schwelle 0,7). In bridge.json als "wm_strength" änderbar.
WM_STRENGTH = 3
AUFBEREITET_V = 2       # Fassung der Archiv-Aufbereitung (adeclip wenn beschnitten + leises Zeichen + 24 Bit)
TAGS_VERSION = 1
CAPS = "settings,export,cover,verify,nachruesten,archiv,master,loeschen,paket,web"


def caps_for(cfg: dict) -> str:
    """Was diese Brücke kann — „web" nur, wenn eine Fahrstuhlmusik-Verwaltung eingetragen ist."""
    return CAPS if (cfg.get("web_admin") or "").strip() else CAPS.replace(",web", "")

RIGHTS_DEFAULTS = {
    "owner": "",            # Rechteinhaber — leer: voller Name des Mac-Kontos (beim ersten Lauf eingetragen)
    "artist": "",           # Künstlername — leer: der Rechteinhaber
    "copyright": "© {jahr} {inhaber}. Alle Rechte vorbehalten.",
    "album": "",            # leer: jeder Track ist eine Single (Album = Titel)
    "label": "",
    "website": "",
    "ai_note": True,
    "watermark": True,
    "cover": True,
    "cover_title": True,    # der Titel als Schrift aufs Cover (FLUX.2 klein schreibt sauber)
    "cover_artist": True,   # 3.3: der Künstlername als fester Schriftzug unten aufs Cover (nur wenn einer eingetragen ist)
}
RIGHTS_TEXT = {"owner": 120, "artist": 120, "copyright": 200, "album": 120, "label": 120, "website": 200}
RIGHTS_BOOL = ("ai_note", "watermark", "cover", "cover_title", "cover_artist")

# Bevorzugte Bildmodelle (Ollama, nur macOS). Beide Apache 2.0 — die Bilder dürfen verkauft werden.
IMAGE_PREFER = ("x/flux2-klein:4b", "x/flux2-klein", "x/z-image-turbo")

# Ausgabeformate. Verlustfrei ist alles außer MP3. 🔴 APE (Monkey's Audio), WMA Lossless,
# OptimFROG und TAK fehlen bewusst: dafür hat ffmpeg keinen Kodierer.
FORMATS = {
    # 3.4: MP3 und AIFF bekommen ihren ID3-Block von UNS (id3v23) — ffmpeg schrieb Songtext und Kommentar
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
RATES = (0, 44100, 48000)   # 0 = wie das Original (48 kHz)

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
    """ace-server: macOS/Linux build/ace-server, Windows (MSVC) build/Release/ace-server.exe, fertige Pakete build/bin/."""
    root = os.path.join(cfg["engine_dir"], "build")
    for p in (os.path.join(root, "ace-server" + EXE), os.path.join(root, "Release", "ace-server" + EXE),
              os.path.join(root, "bin", "ace-server" + EXE), os.path.join(root, "bin", "Release", "ace-server" + EXE)):
        if os.path.isfile(p) and os.access(p, os.X_OK):
            return p
    return ""


def img_to_jpeg(cfg: dict, src: str, dst: str, size: int, quality: int, square: bool = False) -> None:
    """Bild → JPEG. macOS: sips (an Bord). Sonst ffmpeg. size = längste Kante (square: exakt size × size)."""
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
    """Länge einer Audiodatei. macOS: afinfo; sonst ffprobe (oder ffmpeg)."""
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
    """Pfad eines Werkzeugs — launchd startet uns mit fast leerem PATH, darum ausdrücklich suchen."""
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
    """Bildmodelle im eigenen Modellordner — am Manifest erkannt, ohne laufenden Server
    (die Brücke fragt das bei jeder Abholung, alle ~25 s)."""
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


# ---- 3.11: Cover unter Windows/Linux — stable-diffusion.cpp (sd-server) mit Z-Image Turbo (Apache-2.0) ----
# Ollama kann ab 0.32.6 keine Bilder mehr, und 0.32.5 malte nur unter macOS (MLX). Unter Windows/Linux malt
# deshalb sd-server (leejet/stable-diffusion.cpp, MIT) — Dateien legt der Installer in tools/sd und models/sd:
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
    """Startet das Bild-Ollama nur für die Dauer eines Covers und räumt danach ab.
    🔴 OLLAMA_NOPRUNE: ein Ollama räumt beim Start „unbenutzte" Blobs weg — im eigenen
       Ordner (Hardlinks) wäre das harmlos, aber nie riskieren. Ein Waise vom letzten Lauf
       (Brücke abgestürzt) wird über die PID-Datei beendet, bevor ein neuer startet."""
    def __init__(self, cfg):
        self.dir = img_dir(cfg)
        self.port = int(cfg.get("image_port") or 11439)
        # je Port eine eigene PID-Datei: ein Prüfstand (anderer Port, gleicher Ordner) darf beim
        # Aufräumen nie den Bild-Server des echten Dienstes treffen
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
        # Audit 3.2: zwei Prozesse (Dienst + Terminal) teilen Port und PID-Datei — einer nach dem anderen
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
        """Beim Start der Brücke: einen Waisen beenden — aber nur, wenn gerade NIEMAND malt
        (sonst träfe es das Terminal-„--nachruesten" mitten im Bild)."""
        with FileLock("bild-server", blocking=False) as l:
            if l.held:
                self.kill_orphan()


class SdServer:
    """sd-server nur für die Dauer eines Covers (wie ImageServer). Spricht die A1111-kompatible Schnittstelle."""

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
        for _ in range(240):                      # Modelle laden dauert — bis zu 2 Minuten
            try:
                with urllib.request.urlopen(self.url + "/sdapi/v1/sd-models", timeout=2) as r:
                    if r.status == 200:
                        return self
            except urllib.error.HTTPError:
                return self                       # antwortet = läuft (Pfad gibt es nicht in jeder Fassung)
            except Exception:
                pass
            if self.proc.poll() is not None:
                break
            time.sleep(0.5)
        self.__exit__()
        raise RuntimeError("sd-server startet nicht — siehe %s" % os.path.join(DIR, "sd-server.log"))

    def generate(self, prompt: str, seed: int) -> str:
        """→ PNG als base64. Zuerst /sdapi/v1/txt2img, sonst OpenAI-artig /v1/images/generations."""
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
            "writer": find_writer(cfg)}


def _run(args, timeout=600):
    r = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError("%s: %s" % (os.path.basename(args[0]), (r.stderr or r.stdout).strip()[-300:]))
    return r


class Scratch:
    """Ein Arbeitsordner, der auch bei Fehlern wieder verschwindet."""

    def __enter__(self):
        import tempfile
        self.dir = tempfile.mkdtemp(prefix="neonforge-")
        return self

    def path(self, name):
        return os.path.join(self.dir, name)

    def __exit__(self, *exc):
        import shutil
        shutil.rmtree(self.dir, ignore_errors=True)
        return False


# ---- Wasserzeichen ------------------------------------------------------------

def wm_key(cfg: dict) -> str:
    aw = tool(cfg, "audiowmark")
    if not aw:
        raise RuntimeError("audiowmark fehlt auf dem Mac — Wasserzeichen nicht möglich")
    if not os.path.isfile(WM_KEY):
        os.makedirs(DIR, exist_ok=True)
        with FileLock("wasserzeichen-schluessel"):
            if not os.path.isfile(WM_KEY):     # 🔴 nie einen schon benutzten Schlüssel überschreiben
                _run([aw, "gen-key", WM_KEY, "--name", "neonforge"], timeout=30)
                log("Wasserzeichen-Schlüssel angelegt: %s — SICHERN, ohne ihn ist kein Zeichen mehr lesbar" % WM_KEY)
    os.chmod(WM_KEY, 0o600)
    return aw


def wm_payload(owner: str) -> str:
    """128 Bit: Kennung NF+Fassung · Rechteinhaber (4 Byte Hash) · Zeit · Zufall."""
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
    with _reg_lock, FileLock("wasserzeichen-verzeichnis"):
        d = reg_load()
        d[payload] = info
        _write_atomic(WM_REG, json.dumps(d, indent=1, ensure_ascii=False).encode("utf-8"))
        os.chmod(WM_REG, 0o600)


def wm_strength(cfg: dict, dur: float = 180.0) -> int:
    """Stärke nach Länge: die Erkennung sammelt über die Dauer. 🔴 Gemessen: Stärke 3 reicht bei 3,5 min
    selbst nach +10 dB Bass/+9 dB Höhen/Limiter/44,1 kHz/MP3 192 (Wert 2,4), bei 15 s aber nicht
    (0,36 < 0,7). Darum Stärke 3 ab 3 min, darunter mehr (30 s → 10, 60 s → 6, 2 min → 4) — höchstens 10."""
    try:
        base = max(1, min(20, int(cfg.get("wm_strength") or WM_STRENGTH)))
    except (TypeError, ValueError):
        base = WM_STRENGTH
    # gemessen nach harter Kette: 15 s/10 → 1,25 · 30 s/7 → 0,89 (zu knapp) · 60 s/5 → 1,93 · 120 s/4 → 3,76
    return max(base, min(10, int(round(base * (180.0 / max(float(dur or 180.0), 1.0)) ** 0.65))))


def _wav_seconds(audio: bytes) -> float:
    try:
        with wave.open(io.BytesIO(wav_plain(audio))) as w:
            return w.getnframes() / float(w.getframerate() or 1)
    except Exception:
        return 180.0


def wm_embed(cfg: dict, audio: bytes, info: dict, payload: str = ""):
    """→ (Audio mit Zeichen, Kennung). info landet im Verzeichnis (Titel, Datei …).
    payload: eine schon vergebene Kennung erneut setzen (3.4: reparierter Track bleibt derselbe)."""
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
    # Nie stiller schlechter: Format und Länge müssen bleiben, sonst lieber ohne Zeichen.
    with wave.open(io.BytesIO(audio)) as a, wave.open(io.BytesIO(out)) as b:
        if a.getparams()[:4] != b.getparams()[:4]:
            raise RuntimeError("Wasserzeichen hat das Format verändert (%s → %s)" % (a.getparams()[:4], b.getparams()[:4]))
    reg_add(payload, dict(info, owner=owner, staerke=strength, at=datetime.datetime.now().isoformat(timespec="seconds")))
    return out, payload


def wm_detect(cfg: dict, path: str) -> dict:
    """Liest das Zeichen aus einer beliebigen Audiodatei (ffmpeg macht vorher WAV daraus)."""
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
    # audiowmark 0.6.5 schreibt je Fundstelle {"bits", "rating", "quality", "error", "type"} —
    # auch Rauschen ohne Zeichen taucht dort auf (Wert ~0,15), darum zählt nur der beste.
    best, score = {}, 0.0
    for m in res.get("matches") or []:
        v = float(m.get("rating", m.get("quality", 0)) or 0)
        if v > score:
            best, score = m, v
    payload = str(best.get("bits") or "")
    # Gemessen: echte Zeichen 1,2–1,4 (auch nach MP3 96 kbit/s und Ausschnitt), ohne Zeichen
    # oder mit fremdem Schlüssel 0,17. Ein Treffer zählt erst ab 0,7 UND mit unserer Kennung.
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
    """Nur die gesungenen Zeilen — Marker wie [Chorus] fallen weg, Absätze bleiben."""
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
    if r["ai_note"]:
        tags["ai"] = "KI-erzeugt mit Manuwave Studio (Musik: ACE-Step 1.5%s)" % (
            ", Cover: " + info["cover_model"] if info.get("cover_model") else "")
        tags["comment"] = tags["ai"]
    return {k: v for k, v in tags.items() if v}


def _u16(s: str) -> bytes:
    return s.encode("utf-16")          # mit BOM


def id3v23(tags: dict, cover: bytes = None) -> bytes:
    """ID3v2.3 von Hand (UTF-16) — für WAV; dieselben Felder, die ffmpeg ins MP3 schreibt."""
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
    """WAV: alte Tags raus, LIST/INFO (Windows, DAWs) + id3-Block (Musik-Apps) hinein."""
    if audio[:4] != b"RIFF" or audio[8:12] != b"WAVE":
        raise RuntimeError("keine WAV-Datei")
    pos, keep = 12, []
    while pos + 8 <= len(audio):
        cid = audio[pos:pos + 4]
        size = struct.unpack("<I", audio[pos + 4:pos + 8])[0]
        end = min(len(audio), pos + 8 + size + (size % 2))      # samt Füllbyte
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
    """APEv2 von Hand — für WavPack und TTA, die ffmpeg ohne Cover schreibt."""
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
#    und ließ die Schilder weg. Nur für Titel, die es sicher schreibt: lateinische Großbuchstaben,
#    Ziffern, wenige Zeichen — Umlaute und lange Titel bleiben ohne Schrift.
COVER_TITLE_OK = re.compile(r"^[A-Z0-9][A-Z0-9 '&!?.,-]{0,31}$")
COVER_TITLE = (" The title \"%s\" appears once at the top in clean, elegant album-cover typography."
               " Square album cover composition, high detail, professional artwork."
               " No other text, no signs, no logo, no watermark.")


def cover_title(info: dict, r: dict) -> str:
    t = re.sub(r"\s+", " ", (info.get("title") or "")).strip().upper()
    return t if r.get("cover_title", True) and COVER_TITLE_OK.match(t) else ""


#    Schrift-Träger werden zu Licht, Klangwörter fallen weg.
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
    """Das Motiv (ohne Schrift-Anweisung) — vom Sprachmodell, sonst aus den Stil-Tags."""
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
            req = urllib.request.Request(cfg["writer_url"].rstrip("/") + "/api/chat", data=json.dumps(body).encode(),
                                         method="POST", headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=120) as r:
                p = json.loads(json.loads(r.read()).get("message", {}).get("content") or "{}").get("prompt", "")
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


#    Cover ist schlimmer als keiner. Darum liest die Texterkennung von macOS (Vision, nf-ocr) jedes
#    Bild: mit Titel zählt nur der EXAKTE Titel, ohne Titel höchstens 3 Zeichen Schein-Schrift.
def _letters(t: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (t or "").upper())


NF_OCR_SWIFT = r'''// Manuwave Studio: liest Schrift aus einem Bild (Vision-Framework von macOS, nur lokal).
// Ausgabe: JSON-Liste der erkannten Zeilen. Gebraucht, um die Titelschrift auf KI-Covern zu prüfen.
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
req.usesLanguageCorrection = false          // NICHT korrigieren — wir wollen sehen, was wirklich dasteht
try? VNImageRequestHandler(cgImage: cg, options: [:]).perform([req])
let lines = (req.results ?? []).compactMap { $0.topCandidates(1).first?.string }
let data = try! JSONSerialization.data(withJSONObject: lines, options: [])
print(String(data: data, encoding: .utf8)!)
'''
NF_STEMPEL_SWIFT = r'''// Manuwave Studio: setzt den Künstlernamen als festen Schriftzug unten mittig aufs Cover (nur lokal, AppKit).
// Aufruf: nf-stempel ein.jpg aus.jpg "NAME". Das Bildmodell schreibt nicht immer fehlerfrei — dieser Schriftzug schon.
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
// Ein sanfter dunkler Verlauf unten, damit der Schriftzug auf jedem Motiv lesbar bleibt
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
let x = (W - s.size().width + size * 0.38) / 2      // die Sperrung hängt auch hinter dem letzten Buchstaben
s.draw(at: NSPoint(x: x, y: H * 0.045))
NSGraphicsContext.current = nil
guard let out = ctx.makeImage(),
      let data = NSBitmapImageRep(cgImage: out).representation(using: .jpeg, properties: [.compressionFactor: 0.9])
else { exit(1) }
do { try data.write(to: URL(fileURLWithPath: a[2]), options: .atomic) } catch { exit(1) }
'''
_built = {}


def _swift_tool(cfg: dict, name: str, source: str) -> str:
    """Kleine macOS-Werkzeuge gehören zu Manuwave Studio: fehlt eins, baut die Brücke es einmal selbst (swiftc)."""
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
    """→ Liste der erkannten Zeilen, oder None, wenn keine Texterkennung da ist."""
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
        return True                       # ohne Texterkennung: wie bisher
    seen = _letters(" ".join(lines))
    return seen == _letters(shown) if shown else len(seen) <= 3


def make_cover(cfg: dict, info: dict, tick=None) -> dict:
    """→ {"jpeg", "prompt", "model", "s", "text", "text_ok", "tries"}. Wirft, wenn kein Bildmodell da ist."""
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
    # Erst zweimal mit Titel, dann zweimal ohne Schrift — das erste Bild, das die Prüfung besteht, gilt.
    plan = ([shown, shown] if shown else []) + ["", ""]
    if not ensure_ocr(cfg):
        # 3.11: ohne Texterkennung (Windows/Linux) lässt sich ein verschriebener Titel nicht erkennen —
        #       dann lieber gar keine Schrift auf dem Bild (der Künstlername kommt, wo möglich, als Schriftzug)
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
                # 1000 px, JPEG — so klein, dass es in jede Datei passt (macOS: sips, sonst ffmpeg)
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


# ---- Archiv: finden, veredeln -------------------------------------------------

def rel_home(path: str) -> str:
    """Pfad relativ zu ~ — zwischen zwei ECHTEN Pfaden. 🔴 Gefunden im Prüfstand 12.10.2026:
    archive_path() liefert realpath (/private/var/…), HOME war /var/… (Symlink) → relpath ergab
    „../../../../private/var/…", der Browser speicherte das, und der nächste Export fand nichts mehr.
    Gleiches träfe ein ~/NeonForge, das per Symlink auf einer anderen Platte liegt."""
    return os.path.relpath(os.path.realpath(path), os.path.realpath(HOME))


def archive_path(rel: str) -> str:
    """Pfad aus dem Browser (relativ zu ~) → echte Datei NUR innerhalb von renders/."""
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
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".neonforge-", suffix=".tmp")
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
    """Was wir über einen Track wissen: zuerst sein .json im Archiv, dann was der Browser schickt
    (der Browser gewinnt beim TITEL — dort wird umbenannt)."""
    d = _read_json(wav_path[:-4] + ".json") if wav_path else {}
    req, meta, res = d.get("request") or {}, d.get("meta") or {}, d.get("result") or {}
    g = given or {}
    # Erzeugt ist ein Track an dem Tag, unter dem er im Archiv liegt — der Browser kennt nur
    # den Tag, an dem ER ihn bekommen hat (nach einem Umzug ein anderer).
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
    }


class FileLock:
    """Sperre — auch über Prozesse (Dienst + „--nachruesten" im Terminal). Schlüssel ist der ECHTE
    Pfad (Audit 3.2: über einen Symlink hätte dieselbe Datei zwei Sperren gehabt) oder ein Name."""

    def __init__(self, key, blocking=True):
        # 3.11: Windows kennt kein fcntl — dort sperrt msvcrt.locking das erste Byte der Sperrdatei
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
            self.held = False          # nur bei blocking=False: jemand anderes hält sie
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
    """24-Bit-WAV mit dem einfachen PCM-Kopf (Format 1) statt WAVE_FORMAT_EXTENSIBLE (65534).
    🔴 3.5: ffmpeg und audiowmark schreiben ab 24 Bit den erweiterten Kopf — das wave-Modul von
    Python 3.9 (die Brücke läuft mit /usr/bin/python3) kennt ihn nicht: „unknown format: 65534"."""
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
    """Original → (adeclip) → 1 dB Luft → 24 Bit mit Dreiecks-Dither. → {"spitze_db", "pegel_db"}"""
    ff = tool(cfg, "ffmpeg")
    with Scratch() as s:
        fl = s.path("f.wav")
        _run([ff, "-v", "error", "-y", "-i", src] + (["-af", "adeclip"] if declip else []) + ["-c:a", "pcm_f32le", fl], timeout=900)
        # 🔴 NICHT volumedetect: das rechnet in 16 Bit und meldet höchstens 0,0 dB — die rekonstruierten
        #    Spitzen liegen darüber (gemessen +1,47 dB), es gäbe zu wenig Luft und neues Clipping.
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
    """3.4/3.5: das Archiv auf den besten Stand bringen — aus dem UNMARKIERTEN Original:
    • vor 3.4 hat der Modellserver JEDEN Track hart beschnitten (peak_clip 10) → adeclip
      (🔴 auf der markierten Datei wirkt es nicht: das Zeichen verrauscht die flachen Stellen — gemessen)
    • vor 3.5 war das Wasserzeichen zu laut (Stärke 10) → DIESELBE Kennung leise neu setzen
    • 24 Bit statt 16 (die Reparatur rechnet in Fließkomma)
    Scheitert etwas oder ist das Zeichen danach nicht lesbar, bleibt die alte Datei. → dict oder None."""
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
    """3.5: eine neue Version eines Tracks in bester Qualität — DERSELBE Inhalt (nicht neu gerechnet:
    derselbe Seed ergibt ein anderes Stück, gemessen), aus dem unmarkierten Original aufbereitet,
    24 Bit, eigenes leises Wasserzeichen, Cover übernommen. Erscheint in der App unter „📥 Vom Mac holen". → Pfad"""
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
    _write_atomic(o2, clean)                    # auch Version C behält ihr unmarkiertes Original
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
    # Cover übernehmen: der unbeschriftete Rohling, der Schriftzug kommt beim Veredeln neu drauf
    raw = _read_bytes(raw_cover_path(wav_path)) or _read_bytes(wav_path[:-4] + ".jpg")
    if raw:
        _write_atomic(raw_cover_path(new), raw)
        _write_atomic(new[:-4] + ".jpg", raw)
        nd["cover"] = dict(d.get("cover") or {}, stamp="")
    _write_atomic(new[:-4] + ".json", json.dumps(nd, indent=2, ensure_ascii=False).encode("utf-8"))
    _write_atomic(new, wav_with_tags(audio, track_tags(cfg, info_from_archive(new)), raw))
    veredeln(cfg, new, None, want_cover=False, backup=False)   # Schriftzug + Tags mit fertigem Cover
    log("Version %s angelegt: %s (aus %s)" % (variant, os.path.basename(new), os.path.basename(wav_path)))
    return new


def stamp_text(r: dict) -> str:
    """Was als Schriftzug aufs Cover gehört: der Künstlername — nie der bürgerliche Name des Inhabers."""
    return re.sub(r"\s+", " ", str(r.get("artist") or "")).strip()[:40] if r.get("cover_artist", True) else ""


def raw_cover_path(wav_path: str) -> str:
    return wav_path[:-4] + ".roh.jpg"


def apply_stamp(cfg: dict, wav_path: str) -> bool:
    """Bringt den Schriftzug auf dem Cover auf den Stand der Einstellungen. Gemalt wird nichts:
    das unbeschriftete Bild liegt als .roh.jpg daneben, das .jpg ist immer das fertige Cover.
    → True, wenn sich das .jpg geändert hat."""
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
                # 🔴 Der Rohling fehlt, das Bild trägt schon einen Namen — ein zweiter Schriftzug
                #    darüber wäre schlimmer als der alte. Ein neues Cover (🎨) löst das.
                log("Cover %s: Rohling fehlt, Schriftzug „%s\" bleibt" % (os.path.basename(cpath), have))
                return False
            _write_atomic(rpath, _read_bytes(cpath))     # noch nie beschriftet: das .jpg IST der Rohling
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
    """Bringt EINE Datei im Archiv auf den Stand: Wasserzeichen, Tags, Cover daneben.
    🔴 Audit 3.2: die Sperre gilt nur fürs Schreiben — das Cover wird OHNE sie gemalt (bis zu
       Minuten), sonst wartete ein Export desselben Tracks (und mit ihm die ganze Brief-Spur)."""
    with FileLock(wav_path):
        out = _mark_and_tag(cfg, wav_path, given, tick, backup)
    try:
        if aufbereiten(cfg, wav_path):
            out["changed"].append("aufbereitet")
    except Exception as e:  # noqa: BLE001 — die alte Datei bleibt, alles andere geht weiter
        log("Aufbereiten %s fehlgeschlagen: %s" % (os.path.basename(wav_path), e))
    r = rights(cfg)
    cpath = wav_path[:-4] + ".jpg"
    if want_cover and r["cover"] and os.path.isfile(cpath) and not new_cover:
        # Ein Cover von vor der Schriftprüfung: einmal lesen — steht ein falscher Titel drauf, neu malen
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
        if new_cover:   # anderes Motiv: neuer Zufallswert, neue Beschreibung
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
        # auch beim Export (want_cover=False): der Schriftzug kostet keinen Grafikchip, und eine Datei
        # direkt nach dem Umbenennen soll schon den neuen Namen tragen
        if apply_stamp(cfg, wav_path) and "cover" not in out["changed"]:
            out["changed"].append("schriftzug")
    except Exception as e:  # noqa: BLE001 — das Cover bleibt dann ohne Namen, der Rest geht weiter
        log("Schriftzug für %s fehlgeschlagen: %s" % (os.path.basename(wav_path), e))
    if os.path.isfile(cpath):
        with FileLock(wav_path):
            again = _mark_and_tag(cfg, wav_path, given, None, backup)     # fertiges Cover in die Tags
        out["changed"] += [x for x in again["changed"] if x not in out["changed"]]
    out["cover"] = os.path.isfile(cpath)
    out["stamp"] = str((_read_json(wav_path[:-4] + ".json").get("cover") or {}).get("stamp") or "")
    return out


def _mark_and_tag(cfg, wav_path, given, tick, backup) -> dict:
    """Wasserzeichen (falls noch keins) und Tags — unter der Sperre der Datei."""
    r = rights(cfg)
    jpath = wav_path[:-4] + ".json"
    cpath = wav_path[:-4] + ".jpg"
    d = _read_json(jpath)
    out = {"marked": bool(d.get("wasserzeichen")), "changed": []}
    # Eine Umbenennung im Browser gilt auch im Archiv (Audit 3.2: sonst sprang der Titel zurück)
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
            # 🔴 Audit 3.2: ein Track kann SCHON markiert sein (aus dem Browser nachgereicht, Absturz
            #    zwischen WAV und .json) — ein zweites Zeichen mit demselben Schlüssel löscht das erste
            #    teilweise aus. Also erst nachsehen, dann setzen.
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
                        _write_atomic(bfile, audio)       # atomar: nie ein halbes Original
                staerke = wm_strength(cfg, _wav_seconds(audio))
                audio, payload = wm_embed(cfg, audio, {"title": info["title"], "variant": info["variant"],
                                                       "archived": rel, "created": info["created"]})
                d["wasserzeichen"] = {"id": payload, "at": datetime.datetime.now().isoformat(timespec="seconds"),
                                      "staerke": staerke}
            out["marked"] = True
            out["changed"].append("wasserzeichen")
        except Exception as e:  # noqa: BLE001
            # Tags und Cover gehen trotzdem weiter — das Fehlen wird gemeldet, nicht verschluckt
            out["wm_error"] = (str(e) or type(e).__name__)[:200]
            log("Wasserzeichen für %s fehlgeschlagen: %s" % (os.path.basename(wav_path), e))
            audio = None
    tags = track_tags(cfg, info)
    ch = _cover_hash(cpath)
    if out["changed"] or d.get("tags") != tags or d.get("tags_cover", "") != ch:
        if audio is None:
            with open(wav_path, "rb") as f:
                audio = f.read()
        # Erst die WAV, DANN die .json mit der Kennung: scheitert die WAV, behauptet die .json
        # nichts Falsches; stirbt der Prozess dazwischen, findet die Erkennung das Zeichen beim
        # nächsten Mal und trägt es nach (statt ein zweites zu setzen).
        _write_atomic(wav_path, wav_with_tags(audio, tags, _read_bytes(cpath)))
        d["tags"], d["tags_version"], d["tags_cover"] = tags, TAGS_VERSION, ch
        _write_atomic(jpath, json.dumps(d, indent=2, ensure_ascii=False).encode("utf-8"))
        out["changed"].append("tags")
    elif out["changed"]:
        _write_atomic(jpath, json.dumps(d, indent=2, ensure_ascii=False).encode("utf-8"))
    out["id"] = (d.get("wasserzeichen") or {}).get("id", "")
    return out


def archive_upload(cfg: dict, audio: bytes, given: dict) -> str:
    """Ein Track, den der Mac nicht (mehr) hat, kommt aus dem Browser — ab ins Archiv."""
    created = str(given.get("created") or datetime.date.today().isoformat())[:10]
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", created):
        created = datetime.date.today().isoformat()
    folder = os.path.join(RENDERS, created)
    os.makedirs(folder, exist_ok=True)
    # 🔴 3.7: schickte der Browser denselben Track noch einmal (Seite neu geladen / Tab zu, bevor er das Ergebnis des
    #    Archiv ändert sich beim Veredeln, darum steht die Summe in der .json) und nimmt den vorhandenen Platz.
    digest = hashlib.sha256(audio).hexdigest()
    try:
        names = sorted(os.listdir(folder))
    except OSError:
        names = []
    for n in names:
        if n.startswith("aus-browser_") and n.endswith(".json"):
            wav0 = os.path.join(folder, n[:-5] + ".wav")
            if os.path.isfile(wav0) and _read_json(os.path.join(folder, n)).get("upload_sha256") == digest:
                log("derselbe Track kam schon einmal aus dem Browser — %s wird weiterbenutzt" % rel_home(wav0))
                return wav0
    clean = lambda v, n: re.sub(r"[^\w\-äöüÄÖÜß]+", "", str(v or "").replace(" ", "_"))[:n]  # noqa: E731
    base = "aus-browser_%s%s_%s" % (clean(given.get("title"), 50) or "Manuwave_Studio",
                                    ("_" + clean(given.get("variant"), 4)) if clean(given.get("variant"), 4) else "",
                                    clean(given.get("seed"), 12) or secrets.token_hex(3))
    # Audit 3.2: nie eine vorhandene Datei überschreiben (gleicher Titel, Variante, Seed am selben Tag)
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
    req = {k: given.get(k) for k in ("caption", "lyrics", "bpm", "keyscale", "seed") if given.get(k)}
    with open(wav[:-4] + ".json", "w", encoding="utf-8") as f:
        json.dump({"request": req, "meta": meta, "result": {}, "herkunft": "aus dem Browser nachgereicht", "upload_sha256": digest},
                  f, indent=2, ensure_ascii=False)
    return wav


def all_archived() -> list:
    out = []
    for root, dirs, files in os.walk(RENDERS):
        dirs[:] = [x for x in dirs if not x.startswith("_")]
        out += [os.path.join(root, f) for f in files if f.endswith(".wav")]
    return sorted(out)


# ---- Mastering (3.4) -------------------------------------------------------------
# tonfarbe höhen bässe regulieren können, live wenn man sie hört um dann erst zu exportieren".
# Der Browser spielt die Kette LIVE mit Web Audio, der Mac rechnet beim Export DIESELBE Kette mit ffmpeg.
# 🔑 Gemessen: ffmpegs lowshelf/highshelf (t=s:w=1) und equalizer (t=q) sind die RBJ-Biquads, die
#    auch Web Audio benutzt — Abweichung ≤ 0,005 dB. Darum klingt der Export wie die Vorschau.
#    Reihenfolge und Frequenzen hier und in app.js (MASTER_CHAIN) müssen gleich bleiben.
MASTER_RANGES = {"bass": (-12.0, 12.0), "tone": (-6.0, 6.0), "treble": (-12.0, 12.0), "soft": (0.0, 8.0),
                 "gain": (-24.0, 12.0), "fade_in": (0.0, 10.0), "fade_out": (0.0, 15.0)}
MASTER_DEFAULT = {"bass": 0.0, "tone": 0.0, "treble": 0.0, "soft": 2.0, "fade_in": 0.0}
MASTER_LIMIT_DB = -1.5      # Spitzen-Grenze: auch ein MP3 bleibt beim Abspielen unter 0 dBFS
MASTER_TARGET_LUFS = -14.0  # Lautheit wie bei Spotify/Apple Music — lauter wird dort ohnehin leiser gedreht


def clean_master(raw):
    """Nur bekannte Regler, in ihren Grenzen. → dict oder None."""
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
    if raw.get("off") is True:
        m["off"] = True
    return m


def _wav_frames(path: str):
    with wave.open(path) as w:
        return w.getparams(), w.readframes(w.getnframes())


def auto_end(path: str):
    """Wo die Musik wirklich aufhört. Nach dem Ende liefert die Musik-KI oft noch Sekunden leisen
    Klangmüll (gemessen: −28…−57 dB, Buckel bei 150–400 Hz) — Rückmeldung: „am ende der titel kommt noch
    ein soundartefakt". → (ende_s, ausblende_s) oder None. Gleiche Rechnung wie autoEnd() in app.js."""
    try:
        params, frames = _wav_frames(path)
    except Exception:
        return None
    sw, ch, sr = params.sampwidth, params.nchannels, params.framerate
    if sw not in (2, 3, 4) or audioop is None or sr <= 0:
        return None
    full = float(1 << (8 * sw - 1))           # 3.5: das Archiv hat auch 24 Bit
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
    if dur - end < 0.5:          # nichts Nennenswertes dahinter
        return None
    return round(end, 2), 1.0


def master_settings(path: str, given) -> dict:
    """Die Regler für einen Export: was der Browser schickt, sonst was am Track gespeichert ist,
    sonst die Vorgabe (weich, Ende abschneiden, Lautheit automatisch)."""
    m = clean_master(given)
    if m is None:
        m = clean_master((_read_json(path[:-4] + ".json")).get("master"))
    if m is None:
        m = dict(MASTER_DEFAULT)
        ae = auto_end(path)
        if ae:
            m["end"], m["fade_out"] = ae
    return m


def master_filters(m: dict, dur: float, gain=None) -> list:
    """ffmpeg-Filter in derselben Reihenfolge wie die Web-Audio-Kette im Browser."""
    f = []
    start = max(0.0, min(m.get("start", 0.0), dur))
    end = m.get("end") or dur
    end = max(start + 1.0, min(end, dur))
    if start > 0.0005 or end < dur - 0.0005:
        f += ["atrim=start=%.4f:end=%.4f" % (start, end), "asetpts=PTS-STARTPTS"]
    if m.get("bass"):
        f.append("lowshelf=f=100:g=%.2f:t=s:w=1" % m["bass"])
    if m.get("tone"):                          # Tonfarbe: − warm, + hell (Kippen um ~1 kHz)
        f.append("lowshelf=f=300:g=%.2f:t=s:w=1" % (-m["tone"] / 2))
        f.append("highshelf=f=3000:g=%.2f:t=s:w=1" % (m["tone"] / 2))
    if m.get("soft"):
        f.append("equalizer=f=3500:t=q:w=0.8:g=%.2f" % -m["soft"])
    if m.get("treble"):
        f.append("highshelf=f=8000:g=%.2f:t=s:w=1" % m["treble"])
    if gain is not None:
        f.append("volume=%.2fdB" % gain)
        L = end - start
        if m.get("fade_in"):
            f.append("afade=t=in:st=0:d=%.3f:curve=qsin" % min(m["fade_in"], L / 2))
        if m.get("fade_out"):
            fo = min(m["fade_out"], L / 2)
            f.append("afade=t=out:st=%.3f:d=%.3f:curve=qsin" % (L - fo, fo))
        f.append("alimiter=limit=%.5f:attack=1:release=60:level=0:latency=1" % (10 ** (MASTER_LIMIT_DB / 20)))
    return f


def measure_lufs(ff: str, path: str, filters: list) -> float:
    """Integrierte Lautheit (EBU R128) nach EQ, vor Pegel und Limiter."""
    p = subprocess.run([ff, "-hide_banner", "-nostats", "-i", path, "-af", ",".join(filters + ["ebur128=framelog=quiet"]),
                        "-f", "null", "-"], capture_output=True, text=True, timeout=600)
    m = re.findall(r"I:\s+(-?[\d.]+) LUFS", p.stderr)
    if not m:
        raise RuntimeError("Lautheit nicht messbar")
    return float(m[-1])


def wav_duration(path: str) -> float:
    with wave.open(path) as w:
        return w.getnframes() / float(w.getframerate() or 1)


# ---- Export -------------------------------------------------------------------

def aiff_with_id3(data: bytes, tag: bytes) -> bytes:
    """Hängt einen ID3-Block als „ID3 "-Chunk an eine AIFF-Datei (so liest ihn auch Apple)."""
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
    mi = {}
    if not m.get("off"):
        dur = wav_duration(wav_path)
        gain = m.get("gain")
        if gain is None:
            if tick:
                tick("Lautheit wird gemessen …")
            lufs = measure_lufs(ff, wav_path, master_filters(m, dur))
            gain = max(MASTER_RANGES["gain"][0], min(MASTER_RANGES["gain"][1], MASTER_TARGET_LUFS - lufs))
            mi["lufs_vorher"] = round(lufs, 1)
        chain = master_filters(m, dur, round(gain, 2))
        mi.update(gain=round(gain, 2), settings=m)
    else:
        chain = []
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
        # Zum Schluss immer auf die Zielrate (Hochwertiger Standard-Umrechner — soxr fehlt im Homebrew-
        # ffmpeg, gemessen) mit Dreiecks-Dither: aus der Fließkomma-Kette wird sauber 16 oder 24 Bit.
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
# 3.9: Veröffentlichungspaket — alles, was man zum Veröffentlichen oder Lizenzieren braucht
# =============================================================================
# Eine ZIP je Track: Audio (gemastert, wie im Export gewählt), Cover 3000 × 3000 (Vertriebe verlangen das),
# Metadaten fürs Hochladen inkl. KI-Angaben, Liedtext, Herkunftsnachweis (PDF) und eine Lizenz-VORLAGE
# für Firmen (Word, zum Ausfüllen). Lizenzen der Modelle am 15.10.2026 an den Modellkarten geprüft.
MODEL_LICENSES = (
    ("flux2-klein", "FLUX.2 [klein] 4B (Black Forest Labs)", "Apache 2.0", "https://huggingface.co/black-forest-labs/FLUX.2-klein-4B"),
    ("z-image", "Z-Image Turbo (Tongyi-MAI)", "Apache 2.0", "https://huggingface.co/Tongyi-MAI/Z-Image-Turbo"),
)
ACE_LICENSE = ("ACE-Step 1.5", "MIT — laut Modellkarte ausdrücklich für kommerzielle Nutzung der erzeugten Musik",
               "https://huggingface.co/ACE-Step/Ace-Step1.5")
LANG_DE = {"en": "Englisch", "de": "Deutsch", "es": "Spanisch", "fr": "Französisch", "it": "Italienisch"}

NF_PDF_SWIFT = r'''// Manuwave Studio: HTML → PDF (A4) mit AppKit, nur lokal. Aufruf: nf-pdf ein.html aus.pdf
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
    """Vertriebe (Spotify über DistroKid & Co.) verlangen mind. 3000 × 3000 px. Das Cover entsteht mit 1000 px
    und wird hier hochgerechnet (sips, Lanczos) — steht so im Lies-mich."""
    if not os.path.isfile(cpath):
        return None
    with Scratch() as s:
        dst = s.path("c.jpg")
        img_to_jpeg(cfg, cpath, dst, 3000, 92, square=True)
        return _read_bytes(dst)


def _html_to(cfg: dict, html: str, kind: str):
    """HTML → PDF (eigenes Werkzeug nf-pdf) oder DOCX (textutil). → (bytes, endung); Rückfall: HTML."""
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
    """Baut die ZIP aus einem fertigen Export (res) — opts: {"text_eigen": bool}. own_master: der Nutzer hat in 🎚 eingestellt
    (sonst ist es der automatische Vorschlag — und das darf der Nachweis nicht als seine Arbeit ausgeben)."""
    import hashlib
    import zipfile
    import io
    r = rights(cfg)
    d = _read_json(path[:-4] + ".json")
    req, meta, result = d.get("request") or {}, d.get("meta") or {}, d.get("result") or {}
    tags = track_tags(cfg, dict(info, cover_model=(d.get("cover") or {}).get("model", "")))
    owner = r["owner"].strip() or "—"
    artist = (r["artist"] or owner).strip()
    title = tags.get("title") or info.get("title") or "Track"
    created = info.get("created") or ""
    ext = res["filename"].rsplit(".", 1)[-1]
    qual = "320 kbit/s" if res["format"] == "mp3" else "%s Bit" % res["bits"]
    audio = res["data"]
    sha = hashlib.sha256(audio).hexdigest()
    dur = _audio_seconds(cfg, audio, ext, wav_duration(path))
    lines = _sung_lines(info.get("lyrics") or "")
    caption_tags = [t.strip().lower() for t in (info.get("caption") or "").split(",") if t.strip()]
    instrumental = not lines.strip() or ("instrumental" in caption_tags and len(lines.splitlines()) < 3)
    text_eigen = bool(opts.get("text_eigen")) and not instrumental
    lang = LANG_DE.get(str(req.get("vocal_language") or result.get("vocal_language") or "en"), "Englisch")
    cover_model = (d.get("cover") or {}).get("model", "")
    cov_lic = next(((n, l, u) for k, n, l, u in MODEL_LICENSES if k in cover_model), None)
    imported = meta.get("source") == "import"
    herkunft = meta.get("herkunft") or {}
    mastered = res.get("master") or {}
    wm = (d.get("wasserzeichen") or {}).get("id") or fin.get("id") or ""
    auf = d.get("aufbereitet") or {}
    safe = re.sub(r"[^\w\-äöüÄÖÜß ()]+", "", title).strip()[:80] or "Track"
    today = datetime.date.today().isoformat()
    year = (created or today)[:4]
    cpy = tags.get("copyright") or ""

    # ---- Metadaten fürs Hochladen ----
    ki = [
        "[x] Musik — mit KI erzeugt (%s)" % ACE_LICENSE[0],
        "[x] Gesamter Ton / Aufnahme — mit KI erzeugt" + (" (inkl. Gesang)" if not instrumental else ""),
        ("[ ] Liedtext — von %s selbst geschrieben" % owner) if text_eigen else
        ("[ ] Liedtext — entfällt (instrumental)" if instrumental else "[x] Liedtext — mit KI erzeugt"),
        "[x] Cover — mit KI erzeugt (%s)" % (cov_lic[0] if cov_lic else cover_model or "Bildmodell"),
        "Nicht als KI anzugeben (KI-gestütztes Mixing/Mastering zählt laut DistroKid nicht): Mastering in Manuwave Studio",
    ]
    meta_txt = "\n".join([
        "VERÖFFENTLICHUNG — METADATEN FÜRS HOCHLADEN",
        "„%s“ · %s · erstellt %s mit Manuwave Studio" % (title, artist, today),
        "",
        "Songtitel (Song title):            %s" % title,
        "Künstler (Artist):                 %s" % artist,
        "Art:                               Single" + ("" if (tags.get("album") or title) == title.split(" (Version")[0] else " · Album: %s" % tags.get("album")),
        "Genre (primär):                    %s   ← beim Vertrieb aus dessen Liste wählen" % (tags.get("genre") or "—"),
        "Sprache des Textes:                %s" % ("Instrumental" if instrumental else lang),
        "Explizite Inhalte:                 Nein (bitte prüfen)",
        "Dauer:                             %s" % _fmt_dur(dur),
        "BPM / Tonart:                      %s / %s" % (tags.get("bpm") or "—", tags.get("key") or "—"),
        "Erzeugt am:                        %s" % (created or "—"),
        "Songwriter (echter Name):          %s" % owner,
        "Textdichter:                       %s" % ((owner) if text_eigen else ("—" if instrumental else "keiner (KI-Text) — siehe KI-Angaben")),
        "Copyright (©):                     %s" % (cpy or "—"),
        "Aufnahme (℗):                      ℗ %s %s" % (year, artist),
        "ISRC / UPC:                        vergibt der Vertrieb",
        "Cover:                             %s — 3000 × 3000 px, JPG, RGB" % ("Cover_3000x3000.jpg"),
        "Datei:                             %s (%s, %s, %d Hz)" % (res["filename"], res["format"].upper(), qual, res["rate"]),
        "",
        "KI-ANGABEN (z. B. DistroKid „AI credits“ — Stand Oktober 2026, beim Hochladen prüfen):",
        *("  " + x for x in ki),
        "",
        "WICHTIG",
        "  • Keine Nachahmung anderer Künstler, keine Massen-Uploads — sonst sperren Vertriebe und Plattformen.",
        "  • Bandcamp, AudioJungle und Pond5 nehmen (Stand Oktober 2026) keine KI-erzeugte Musik.",
        "  • GEMA: rein KI-erzeugte Teile sind nicht anmeldbar%s." % (" — dein eigener Text kann es sein" if text_eigen else ""),
        "  • Wasserzeichen-Kennung (unhörbar im Audio): %s" % (wm or "—"),
        "  • SHA-256 der Audiodatei: %s" % sha,
    ]) + "\n"

    # ---- Herkunftsnachweis ----
    entstehung = [
        ("Erzeugt am", _h(created or "—")),
        ("Musik und Gesang", "%s — %s<br><span class='klein'>%s · Modell: %s</span>" % (
            _h(ACE_LICENSE[0]), _h(ACE_LICENSE[1]), _h(ACE_LICENSE[2]), _h(result.get("dit") or req.get("dit") or "ACE-Step 1.5"))),
        ("Programm", _h("Music Generator (lokal), übernommen in Manuwave Studio" if imported else "Manuwave Studio (lokal auf dem Mac, keine Cloud)")),
        ("Seed", _h(result.get("seed", req.get("seed", "")))),
        ("Schritte / Führung", _h("%s / %s" % (req.get("inference_steps") or "Standard", req.get("guidance_scale") or result.get("guidance_scale") or "Standard"))),
        ("Cover", ("%s — %s<br><span class='klein'>%s</span>" % (_h(cov_lic[0]), _h(cov_lic[1]), _h(cov_lic[2]))) if cov_lic else _h(cover_model or "—")),
    ]
    if imported and herkunft:
        entstehung.append(("Ursprung", _h("%s, Eintrag %s, Datei %s, erzeugt %s" % (herkunft.get("programm", ""), herkunft.get("id", ""),
                                                                                 herkunft.get("datei", ""), herkunft.get("erzeugt", "")))))
    mensch = ["Idee, Vorgaben (Richtung, Länge, Stimme) und Auswahl dieser Fassung aus den erzeugten Versionen: %s" % owner]
    if text_eigen:
        mensch.insert(0, "Liedtext: von %s selbst geschrieben" % owner)
    ms_names = {"bass": "Bässe %+.1f dB", "tone": "Tonfarbe %+.1f", "treble": "Höhen %+.1f dB", "soft": "Weich %.0f",
                "fade_in": "Einblenden %.1f s", "fade_out": "Ausblenden %.1f s", "start": "Start bei %.1f s", "end": "Ende bei %.1f s",
                "gain": "Pegel %+.1f dB"}
    ms_txt = ", ".join(ms_names[k] % float(v) for k, v in (mastered.get("settings") or {}).items()
                       if k in ms_names and isinstance(v, (int, float)) and float(v) != 0)
    bearbeitung_auto = ""
    if mastered and own_master:
        mensch.append("Mastering: eigene Einstellungen von %s%s" % (owner, (" (%s)" % ms_txt) if ms_txt else ""))
    elif mastered:
        bearbeitung_auto = "Mastering automatisch (Manuwave-Studio-Vorschlag%s), Ziel −14 LUFS" % ((": " + ms_txt) if ms_txt else "")
    bearbeitung = []
    if auf.get("adeclip"):
        bearbeitung.append("abgeschnittene Spitzen rekonstruiert (adeclip, bis %+.1f dB)" % (auf.get("spitze_db") or 0))
    if auf.get("bits"):
        bearbeitung.append("%s Bit" % auf["bits"])
    if bearbeitung_auto:
        bearbeitung.append(bearbeitung_auto)
    if mastered.get("gain") is not None:
        bearbeitung.append("Pegel %+.1f dB%s" % (mastered["gain"], (" (vorher %.1f LUFS)" % mastered["lufs_vorher"]) if mastered.get("lufs_vorher") is not None else ""))
    nachweis = ("<html><head><meta charset='utf-8'><style>%s</style></head><body>" % PAKET_CSS
                + "<h1>Herkunftsnachweis</h1><p><b>„%s“</b> · %s</p>" % (_h(title), _h(artist))
                + "<p class='klein'>Erstellt am %s von Manuwave Studio. Dieser Nachweis beschreibt, wie der Track entstanden ist, "
                  "und belegt über Wasserzeichen und Prüfsumme, dass die gelieferte Datei dieser Track ist.</p>" % _h(today)
                + "<h2>Track</h2>" + _rows([
                    ("Titel", _h(title)), ("Künstler", _h(artist)), ("Rechteinhaber", _h(owner)), ("Dauer", _h(_fmt_dur(dur))),
                    ("Tempo / Tonart", _h("%s BPM / %s" % (tags.get("bpm") or "—", tags.get("keyscale") or info.get("keyscale") or "—"))),
                    ("Sprache", _h("Instrumental" if instrumental else lang)), ("Copyright", _h(cpy))])
                + "<h2>Entstehung (KI)</h2>" + _rows(entstehung)
                + "<h2>Menschlicher Anteil</h2><p>" + "<br>".join("• " + _h(x) for x in mensch) + "</p>"
                + ("<h2>Bearbeitung</h2><p>%s</p>" % _h(" · ".join(bearbeitung)) if bearbeitung else "")
                + "<h2>Datei und Nachweis</h2>" + _rows([
                    ("Datei", _h("%s · %s · %s · %d Hz · %.1f MB" % (res["filename"], res["format"].upper(), qual, res["rate"], len(audio) / 1e6))),
                    ("SHA-256", "<span class='klein'>%s</span>" % _h(sha)),
                    ("Wasserzeichen", _h(wm or "—") + "<br><span class='klein'>unhörbar (audiowmark), übersteht MP3 und Bearbeitung; prüfen auf dem Mac: "
                     "python3 ~/NeonForge/neonforge_bridge.py --pruefen &lt;Datei&gt;</span>"),
                    ("Archiv", _h(rel_home(path)))])
                + "<h2>Beschreibung beim Erzeugen</h2><p class='klein'>%s</p>" % _h(info.get("caption") or "—")
                + ("<h2>Liedtext</h2><pre>%s</pre>" % _h(info.get("lyrics")) if not instrumental else "")
                + "<h2>Rechtlicher Hinweis</h2><p class='klein'>Rein KI-erzeugte Bestandteile sind in Deutschland nach derzeitiger "
                  "Auffassung nicht urheberrechtlich geschützt; geschützt sein können die menschlichen Beiträge oben. Die eingesetzten "
                  "Modelle erlauben die kommerzielle Nutzung (Lizenzen siehe oben, geprüft am 15.10.2026). Dieser Nachweis ist "
                  "keine Rechtsberatung.</p></body></html>")

    # ---- Lizenzvorlage für Firmen ----
    blank = "______________________________"
    lizenz = ("<html><head><meta charset='utf-8'><style>%s</style></head><body>" % PAKET_CSS
              + "<h1>Nutzungslizenz für Musik</h1><p class='klein'>VORLAGE — vor der ersten Verwendung rechtlich prüfen lassen. "
                "Linien ausfüllen, Zutreffendes ankreuzen, Nichtzutreffendes streichen.</p>"
              + "<h2>Vertragsparteien</h2>" + _rows([
                  ("Lizenzgeber", _h("%s (Künstlername: %s)" % (owner, artist)) + "<br>Anschrift: " + blank),
                  ("Lizenznehmer", "Name/Firma: " + blank + "<br>Anschrift: " + blank)])
              + "<h2>§ 1 Gegenstand</h2>" + _rows([
                  ("Titel", _h("„%s“ von %s" % (title, artist))), ("Dauer", _h(_fmt_dur(dur))),
                  ("Datei", _h(res["filename"])), ("SHA-256", "<span class='klein'>%s</span>" % _h(sha)),
                  ("Wasserzeichen", _h(wm or "—"))])
              + "<h2>§ 2 Eingeräumte Rechte</h2><p>Der Lizenzgeber räumt dem Lizenznehmer ein <b>einfaches (nicht ausschließliches), "
                "nicht übertragbares</b> Recht ein, den Titel für folgende Zwecke zu nutzen (Zutreffendes ankreuzen):</p>"
                "<p>☐ Hintergrundmusik in eigenen Geschäftsräumen &nbsp; ☐ Veranstaltungen &nbsp; ☐ Telefon-Warteschleife<br>"
                "☐ eigene Online-Videos und Social Media &nbsp; ☐ Podcast &nbsp; ☐ Werbung (Medium: " + blank + ")</p>"
                "<p>Gebiet: ☐ Deutschland ☐ EU ☐ weltweit &nbsp;·&nbsp; Dauer: ☐ unbefristet ☐ bis " + blank + "</p>"
              + "<h2>§ 3 Nicht gestattet</h2><p>Weiterverkauf oder Weiterlizenzierung der Musik als solche; Veröffentlichung als eigene "
                "Musik; Anmeldung bei einer Verwertungsgesellschaft oder bei Content-ID-Systemen; Verwendung zum Training von KI-Modellen.</p>"
              + "<h2>§ 4 Vergütung</h2><p>Einmalig " + blank + " €, fällig bei Unterzeichnung — zzgl. gesetzlicher Umsatzsteuer, "
                "bei Kleinunternehmerregelung stattdessen: „Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.“</p>"
              + "<h2>§ 5 Verwertungsgesellschaften</h2><p>Der Titel ist bei keiner Verwertungsgesellschaft (z. B. GEMA) angemeldet. "
                "Für die vereinbarte Nutzung fallen nach Kenntnis des Lizenzgebers keine Vergütungen an Verwertungsgesellschaften an. "
                "Bei Rückfragen einer Verwertungsgesellschaft stellt der Lizenzgeber diese Lizenz und den Herkunftsnachweis zur Verfügung.</p>"
              + "<h2>§ 6 Entstehung mit KI</h2><p>Der Titel wurde mit Hilfe künstlicher Intelligenz erzeugt (Musik: %s%s). "
                "Der Lizenzgeber versichert, dass die eingesetzten Werkzeuge die kommerzielle Nutzung erlauben und dass er keine "
                "bestehenden Werke oder Künstler bewusst nachgeahmt hat. Der Lizenznehmer nimmt zur Kenntnis, dass rein KI-erzeugte "
                "Bestandteile nach derzeitiger Rechtslage keinen urheberrechtlichen Schutz genießen.</p>" % (
                    _h(ACE_LICENSE[0]), (_h("; Liedtext: %s" % owner) if text_eigen else ""))
              + "<h2>§ 7 Haftung</h2><p>Der Lizenzgeber haftet für Vorsatz und grobe Fahrlässigkeit. Werden gegen den Lizenznehmer "
                "Ansprüche Dritter wegen der vertragsgemäßen Nutzung erhoben, informieren sich die Parteien unverzüglich.</p>"
              + "<h2>§ 8 Schluss</h2><p>Es gilt deutsches Recht. Änderungen bedürfen der Textform.</p>"
              + "<p><br>Ort, Datum: " + blank + "<br><br><br>" + blank + " &nbsp;&nbsp;&nbsp; " + blank +
                "<br>Lizenzgeber (%s) &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Lizenznehmer</p>" % _h(owner)
              + "</body></html>")

    nachweis_b, n_ext = _html_to(cfg, nachweis, "pdf")
    lizenz_b, l_ext = _html_to(cfg, lizenz, "docx")
    cover = _cover_3000(cfg, path[:-4] + ".jpg")
    readme = "\n".join([
        "„%s“ — Veröffentlichungspaket" % title, "",
        "%-34s die Musik (%s, gemastert wie im Export gewählt; Cover und Tags stecken drin)" % (res["filename"], res["format"].upper()),
        ("%-34s das Cover in 3000 × 3000 px für Vertriebe (aus 1000 px hochgerechnet)" % "Cover_3000x3000.jpg") if cover else "(kein Cover vorhanden)",
        "%-34s alle Angaben fürs Hochladen, inkl. KI-Angaben zum Abhaken" % "Metadaten.txt",
        ("%-34s nur die gesungenen Zeilen (für Liedtext-Felder)" % "Liedtext.txt") if not instrumental else "",
        "%-34s wie der Track entstanden ist, Prüfsumme, Wasserzeichen" % ("Herkunftsnachweis." + n_ext),
        "%-34s Vorlage zum Ausfüllen, wenn du den Track an Firmen lizenzierst" % ("Lizenz_Vorlage_Firmen." + l_ext),
        "", "Hinweis: Das ist eine Arbeitshilfe, keine Rechtsberatung. Erstellt %s mit Manuwave Studio." % today,
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
        put("Metadaten.txt", meta_txt.encode("utf-8"))
        if not instrumental:
            put("Liedtext.txt", (lines.strip() + "\n").encode("utf-8"))
        put("Herkunftsnachweis." + n_ext, nachweis_b)
        put("Lizenz_Vorlage_Firmen." + l_ext, lizenz_b)
        put("Lies_mich.txt", readme.encode("utf-8"))
    data = buf.getvalue()
    # Was beim Paket galt, steht auch am Track — ein späteres Paket sagt dasselbe
    with FileLock(path):
        dj = _read_json(path[:-4] + ".json")
        dj["veroeffentlichung"] = {"text_eigen": text_eigen, "at": datetime.datetime.now().isoformat(timespec="seconds"),
                                   "sha256": sha, "datei": res["filename"]}
        _write_atomic(path[:-4] + ".json", json.dumps(dj, indent=2, ensure_ascii=False).encode("utf-8"))
    return {"data": data, "mime": "application/zip", "filename": "%s_Paket.zip" % folder, "bytes": len(data),
            "pdf": n_ext == "pdf", "docx": l_ext == "docx", "cover3000": bool(cover), "sha256": sha}


# =============================================================================
# 3.10: 🌐 Veröffentlichen auf Fahrstuhlmusik (öffentliche Seite, Verwaltung nur im Tailnet)
# =============================================================================
# Der Mac schickt die GEMASTERTE Fassung als 24-Bit-WAV (die Seite wandelt genau einmal in MP3 320),
# dazu Cover und Angaben, an den Verwaltungs-Eingang der Seite. Der ist nur über Tailscale erreichbar
# und prüft die Tailscale-Anmeldung — es gibt keinen Schlüssel, den man verlieren könnte.
# Derselbe Track (gleicher Archivpfad) ersetzt beim erneuten Veröffentlichen die alte Fassung.
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


# whisper.cpp hört die VERÖFFENTLICHTE Fassung (gemastert, also mit Schnitt am Anfang) und liefert Wörter mit Zeiten;
# Hinweis (--prompt) und ohne Kontextverschleppung (-mc 0) findet auch die zweite Strophe; ein Gesangsfilter half nicht.
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
    """lyrics: Liedtext mit [Markern]; heard: [(wort, start, ende)] → {"lines": [{t, e, l}], "coverage": Anteil}."""
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
        sc[0][j] = j * GAP * 0.3                     # Gehörtes ohne Text (Füller) kostet wenig
    for i in range(1, n + 1):
        li = L[i - 1][0]
        row, prev = sc[i], sc[i - 1]
        for j in range(1, m + 1):
            d = prev[j - 1] + (HIT if _similar(li, R[j - 1][0]) else MIS)
            row[j] = max(d, prev[j] + GAP, row[j - 1] + GAP * 0.3)
    hits = {}                                       # Index im Liedtext → (start, ende)
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
            # Am Anfang nach Musik dehnt whisper das erste Wort über die ganze Pause — dann vom Zeilenende rechnen
            if t1 - t0 > len(idx) * 0.9 + 1.0:
                t0 = t1 - len(idx) * 0.45 - 0.3
            out.append({"t": max(0.0, t0), "e": t1, "l": ln, "a": True})
        else:
            out.append({"t": None, "e": None, "l": ln, "a": False})
    known = [k for k, x in enumerate(out) if x["a"]]
    if not known:
        return {"lines": [], "coverage": 0.0}
    for k, x in enumerate(out):                     # Lücken gleichmäßig zwischen den Nachbarn verteilen
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
    for x in out:                                   # nie rückwärts
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
    """Zeiten für den Liedtext aus der fertigen Fassung. {} wenn whisper fehlt oder zu wenig erkannt wird."""
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


def web_publish(cfg, path, req, tick=None):
    given = clean_master(req.get("master"))
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
    title = re.sub(r"\s*\(Version [A-Z]\)$", "", tags.get("title") or info.get("title") or "Track")
    meta = {"title": title, "artist": tags.get("artist") or "",
            "genre": tags.get("genre") or "", "bpm": tags.get("bpm") or "0", "key": tags.get("key") or "", "lyrics": lyrics,
            "note": info.get("note") or "", "language": (LANG_DE.get(lang, lang) if lyrics.strip() else "Instrumental"),
            "tools": "Manuwave Studio · ACE-Step 1.5" + (" · " + cov_name if cov_name else ""),
            "ai_note": "KI-erzeugt", "ext_id": rel_home(path)}
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
        # 3.12: Zeiten zum Mitsingen — ein Fehler hier hält die Veröffentlichung nicht auf
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
            if "(404)" not in str(e):            # schon weg = Ziel erreicht
                raise
    with FileLock(path):
        d = _read_json(path[:-4] + ".json")
        d.pop("oeffentlich", None)
        _write_atomic(path[:-4] + ".json", json.dumps(d, indent=2, ensure_ascii=False).encode("utf-8"))
    log("Von Fahrstuhlmusik zurückgezogen: %s" % os.path.basename(path))
    return {"withdrawn": True}


# =============================================================================
# Ablage auf dem Mac
# =============================================================================

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
    with open(os.path.join(folder, base + ".json"), "w", encoding="utf-8") as f:
        json.dump({"request": job.get("request"), "meta": job.get("meta"), "result": meta},
                  f, indent=2, ensure_ascii=False)
    return wav


# =============================================================================
# Aufträge rund ums Veredeln
# =============================================================================

class NeedUpload(Exception):
    pass


# Der Browser erkennt diesen Anfang und schickt den Track beim zweiten Versuch mit.
ARCHIV_FEHLT = "ARCHIV_FEHLT: Der Mac hat diesen Track nicht (mehr) — der Browser schickt ihn mit."
MAX_FILE = 64 * 1024 * 1024
MAX_EXPORT = 120 * 1024 * 1024   # 3.4: 24 Bit — der Server nimmt bis 128 MB


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
    """Was im Archiv dieses Macs liegt — damit der Browser holen kann, was ihm fehlt
    (neues Gerät, abgebrochene Übergabe, gelöschte Bibliothek)."""
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
                    # 3.12: veröffentlicht? — der Browser gleicht sein 🌐 damit ab (auch nach Veröffentlichen ohne ihn)
                    "web": {k: (d.get("oeffentlich") or {}).get(k, "") for k in ("url", "slug", "at")} if (d.get("oeffentlich") or {}).get("url") else None})
    return out


# Jetzt geht ALLES eines Tracks in den Papierkorb des Macs: WAV, .json, Cover (.jpg + Rohling .roh.jpg) und das
# unmarkierte Original. Papierkorb statt sofort weg: bis zum Leeren zurückholbar. Klappt das Verschieben nicht
# (Rechte), wird endgültig gelöscht — gelöscht heißt gelöscht. Das Wasserzeichen-Verzeichnis behält seinen Eintrag:
# eine schon verbreitete Kopie soll ihre Herkunft weiter beweisen.
TRASH = os.path.join(HOME, ".Trash")


def track_files(path: str) -> list:
    """Alle Dateien eines Archiv-Tracks (die WAV zuerst)."""
    base = path[:-4]
    out = [path] + [base + s for s in (".json", ".jpg", ".roh.jpg") if os.path.isfile(base + s)]
    orig = os.path.join(ORIG_DIR, os.path.basename(os.path.dirname(path)), os.path.basename(path))
    if os.path.isfile(orig):
        out.append(orig)
    return out


def delete_tracks(rels: list) -> dict:
    import shutil
    done, missing, hard = [], [], 0
    ziel = os.path.join(TRASH, "Manuwave Studio gelöscht " + time.strftime("%Y-%m-%d %H.%M.%S"))
    for rel in rels[:500]:
        p = archive_path(rel)
        if not p:
            missing.append(rel)          # schon weg — für den Browser ist das dasselbe wie gelöscht
            continue
        with FileLock(p):                # nie mitten in ein Veredeln/Exportieren hinein
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
    return {"deleted": done, "missing": missing, "trash": rel_home(ziel) if os.path.isdir(ziel) else "", "hard": hard}


def settings_result(cfg: dict) -> dict:
    return {"rights": rights(cfg), "tools": tools_state(cfg), "version": BRIDGE_VERSION,
            "formats": [{"id": k, "name": v["name"], "ext": v["ext"], "lossless": k != "mp3"}
                        for k, v in FORMATS.items()]}


def tool_job(cfg: dict, srv, job: dict) -> None:
    """Schnelle Aufträge der Brief-Spur: Einstellungen, Export, Wasserzeichen prüfen.
    Sie rühren den Grafikchip nicht an (Cover entstehen auf der Render-Spur)."""
    kind, jid, req = job.get("kind"), job["id"], job.get("request") or {}
    tick = lambda m: srv.progress(jid, m)  # noqa: E731
    if kind == "archiv":
        srv.result_json(jid, {"tracks": archive_list()})
    elif kind == "loeschen":
        rels = req.get("archived")
        srv.result_json(jid, delete_tracks(rels if isinstance(rels, list) else []))
    elif kind == "settings":
        if isinstance(req.get("set"), dict):
            with _cfg_lock:
                r = dict(RIGHTS_DEFAULTS)
                r.update(cfg.get("rights") or {})
                r.update(clean_rights(req["set"]))
                cfg["rights"] = r
                save_config(cfg)
            log("Urheberangaben geändert")
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
            raise RuntimeError("Wasserzeichen fehlt (%s) — Export abgebrochen" % (fin.get("wm_error") or "unbekannt"))
        given = clean_master(req.get("master"))
        if given is not None:
            # Die Regler gehören zum Track: ein späterer Export (anderes Gerät, Terminal) klingt genauso
            with FileLock(path):
                d = _read_json(path[:-4] + ".json")
                if d.get("master") != given:
                    d["master"] = given
                    _write_atomic(path[:-4] + ".json", json.dumps(d, indent=2, ensure_ascii=False).encode("utf-8"))
        bits = 16 if int(req.get("bits") or 24) == 16 else 24
        res = export_track(cfg, path, fmt, rate, info_from_archive(path, req), tick, master=given, bits=bits)
        if isinstance(req.get("paket"), dict):
            # 3.9: Veröffentlichungspaket — dieselbe Datei, dazu Cover 3000 px, Metadaten, Nachweis, Lizenzvorlage
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
    """Render-Spur: einen vorhandenen Track nachrüsten oder ihm ein neues Cover malen."""
    kind, jid, req = job.get("kind"), job["id"], job.get("request") or {}
    path = job_source(cfg, srv, job)
    fin = veredeln(cfg, path, req, want_cover=True, tick=tick, new_cover=(kind == "cover"))
    jpeg = _read_bytes(path[:-4] + ".jpg")
    if jpeg:
        try:
            srv.cover(jid, jpeg)
        except Exception as e:  # noqa: BLE001 — das Cover liegt im Archiv; der Auftrag ist trotzdem fertig
            log("Cover-Übergabe %s gescheitert: %s" % (jid, e))
    d = _read_json(path[:-4] + ".json")
    meta = {"archived": rel_home(path), "wasserzeichen": fin["id"], "cover": bool(jpeg),
            "cover_error": fin.get("cover_error", ""), "cover_model": (d.get("cover") or {}).get("model", ""),
            "wm_error": fin.get("wm_error", ""), "cover_stamp": fin.get("stamp", ""),
            "rev": int((d.get("aufbereitet") or {}).get("v") or 0),
            # was der Browser braucht, um einen Track neu in die Bibliothek zu legen
            "track": {"request": d.get("request") or {}, "meta": d.get("meta") or {}, "result": d.get("result") or {}}}
    if kind == "nachruesten" and req.get("audio"):
        srv.meta(jid, meta)
        srv.result_audio(jid, _read_bytes(path))
    else:   # Cover oder Nachrüsten: der Browser behält seine Kopie, nur Kennung + Cover reisen
        srv.result_json(jid, meta)
    log("%s: %s · %s" % ("Neues Cover" if kind == "cover" else "Nachgerüstet", os.path.basename(path),
                          ", ".join(fin["changed"]) or "war schon vollständig"))


# =============================================================================
# Hauptschleife
# =============================================================================

def _on_term(signum, frame):
    # launchctl stop / Abmelden / kill schicken SIGTERM: den laufenden Auftrag beim
    # Modellserver mitnehmen, statt ihn als Waise rechnen zu lassen.
    Engine.cancel_inflight("Brücke wird beendet")
    sys.exit(0)


def brief_lane(cfg: dict) -> None:
    """Zweite Spur: Briefe schreiben, während die erste vielleicht minutenlang rechnet.
    Sie fasst den Modellserver nicht an — nur das lokale Sprachmodell."""
    srv = Server(cfg)
    backoff = 2
    while True:
        try:
            st, job = srv.next_job(lane="brief")
            backoff = 2
        except Exception:  # Netz weg, Server deployt … — die Hauptspur protokolliert das schon
            time.sleep(backoff)
            backoff = min(60, backoff * 2)
            continue
        if st == 204 or not job:
            continue
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
            continue
        log("Brief %s wird geschrieben (%s)" % (jid, find_writer(cfg) or "kein Modell"))
        try:
            srv.progress(jid, "Dein Mac schreibt den Brief …")
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
    # Ist die letzte Brücke ohne Aufräumen gestorben (Absturz, Strom, kill -9)?
    Engine.cancel_inflight("vom letzten Lauf übrig")
    ImageServer(cfg).cleanup_at_start()
    backoff = 2
    while True:
        try:
            st, job = srv.next_job()
            backoff = 2
        except urllib.error.HTTPError as e:
            if e.code == 401:
                log("Server lehnt den Schlüssel ab — neu koppeln: neonforge_bridge.py --pair")
            else:
                log("Server antwortet %d — neuer Versuch in %d s" % (e.code, backoff))
            time.sleep(backoff)
            backoff = min(60, backoff * 2)
            continue
        except Exception as e:  # Netz weg, Mac aufgewacht, Server deployt gerade …
            log("Server nicht erreichbar (%s) — neuer Versuch in %d s" % (type(e).__name__, backoff))
            time.sleep(backoff)
            backoff = min(60, backoff * 2)
            eng.maybe_stop_idle()
            continue
        if st == 204 or not job:
            eng.maybe_stop_idle()
            continue
        jid = job["id"]
        title = (job.get("meta") or {}).get("title", "")
        log("Auftrag %s (%s) %s" % (jid, job.get("kind"), title))
        tick = lambda msg: srv.progress(jid, msg)  # noqa: E731
        Awake.hold(cfg)
        try:
            # Nur Musik und Analyse brauchen den Modellserver — ein Cover oder Nachrüsten nicht.
            # 🔴 Sonst lüde er ~8 GB nur für ein Bild, und das Bildmodell bekäme den Speicher nicht.
            if job.get("kind") not in ("nachruesten", "cover"):
                eng.ensure(lambda m: srv.progress(jid, m))
            if job.get("kind") == "understand":
                upload = srv.upload(jid)
                result = eng.understand(upload, job.get("filename") or "upload", tick)
                srv.result_json(jid, result)
                log("Analyse fertig: %s" % json.dumps(result, ensure_ascii=False)[:160])
            elif job.get("kind") in ("nachruesten", "cover"):
                finish_job(cfg, srv, job, tick)
            else:
                audio, meta = eng.render(job.get("request") or {}, tick)
                path = archive(cfg, job, audio, meta)
                cover_next = False
                # 3.2: erst veredeln (Wasserzeichen + Tags), DANN ausliefern — so verlässt kein
                # Track den Mac ohne Zeichen. Scheitert das Veredeln, geht der Track trotzdem
                # raus (eine Viertelstunde Rechenzeit wegwerfen wäre schlimmer) und sagt es;
                try:
                    if path:
                        meta["archived"] = rel_home(path)
                        # 3.5: das unmarkierte Original bleibt (backup=True) — ohne es lässt sich ein Track
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
                    # Das Cover kommt NACH dem Track: der Track ist sofort hörbar, das Bild folgt.
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
            Awake.release(cfg)


class Awake:
    """3.7: Der Rechner soll nicht schlafen, solange ein Auftrag läuft — auch wenn Safari im Hintergrund ist.
    Am 13.10. ging um 17:49 der Bildschirm aus; der Mac rechnete weiter, aber Safari brach um 18:10 das Abholen
    von „Euphoric Ascent · A" ab. Solange die Brücke einen Auftrag hat — und 3 min danach, damit der Browser den
    fertigen Track noch abholt —, hält `caffeinate` den Mac UND den Bildschirm wach (-d -i -m). `-w` beendet es
    von selbst, wenn die Brücke stirbt. Abschalten: "wach_halten": false in bridge.json.
    Sperrt der Nutzer den Mac selbst, kann das nichts verhindern — dann holt die Seite beim Entsperren nach (3.6.1)."""
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
        # 🔴 Durchsicht 3.7: ein schon ausgelöster Zeitgeber, der auf die Sperre wartet, lässt sich nicht mehr abbrechen —
        #    nur der AKTUELLE darf stoppen (sonst fiele der Nachlauf eines neueren Auftrags weg)
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
# Koppeln, Dienst ein/aus, Status
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
        # Der Dialog läuft mit Frist — ohne sie hinge --install, bis jemand OK klickt.
        subprocess.run(["open", link], check=False)
        if code:
            subprocess.run(["osascript", "-e",
                            'display dialog "Manuwave-Studio-Kopplungscode:\\n\\n%s\\n\\nIn Manuwave Studio unter '
                            '⚙️ Einstellungen › Mac-Brücke eingeben (10 Minuten gültig). Auf diesem Mac '
                            'ist der Browser schon gekoppelt." buttons {"OK"} default button "OK" '
                            'with title "Manuwave Studio" giving up after 300' % code], check=False,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def install(cfg: dict) -> None:
    cfg = ensure_token(cfg)
    os.makedirs(DIR, exist_ok=True)
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    target = os.path.join(DIR, "neonforge_bridge.py")
    here = os.path.abspath(__file__)
    if here != target:
        with open(here, "rb") as src, open(target, "wb") as dst:
            dst.write(src.read())
        os.chmod(target, 0o755)
    # Vorlage 1:1 wie die übrigen com.robert.*-Dienste: System-Python, Start mit dem
    # Login, bei Absturz neu, Log unter ~/Library/Logs.
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
    # 🔴 bootout kehrt zurück, BEVOR der alte Dienst abgebaut ist. Ein sofortiges bootstrap
    #    Also warten, bis launchd ihn wirklich vergessen hat, und notfalls nachfassen.
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
    # Abbrechen (kill/launchctl) soll den Bild-Server mitnehmen: SystemExit läuft durch die with-Blöcke
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
