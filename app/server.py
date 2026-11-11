"""Manuwave Studio — Musik-KI.

Dependency-free web server (Python stdlib only). Serves the app from ``web/`` and
relays between the browser and the Mac. Binds 0.0.0.0:8080 (internal port — MUST match the
manifest).

Since 3.0.0: LOCAL AI ONLY
--------------------------
The Claude forwarder (/api/compose, API key, subscription token) and the browser synth studio
are gone. The language model on the Mac (Ollama) writes the brief, ACE-Step on the Mac renders
the music. This server talks to no service outside its own network.
Sound quality: the browser sends guidance_scale/inference_steps along (Studio = 7.0 —
up to 2.2 every track ran unguided at 1.0, see QUALITY in web/app.js).

Since 2.0.0: REAL MUSIC AI VIA THE MAC
--------------------------------------
A language model cannot output audio, and the browser synth sounds like a browser.
ACE-Step 1.5 produces real music — but needs a GPU, which this machine does not
have. So the Mac does the computing, and this server only relays:

    Browser ──POST /api/render──▶ Server ◀──GET /api/bridge/next── Mac (Brücke)
                                   │                                  │ ace-server
    Browser ◀──GET …/audio──────── Server ◀──POST /api/bridge/result─┘ (127.0.0.1)

🔑 The Mac connects OUTWARD (like other bridge agents) — it opens no
   port, its ace-server stays on 127.0.0.1.

🔑 The server holds NO secret. The container has no volume, everything written
   is gone after the next deploy. That is why the pairing key is a CAPABILITY: whoever
   knows it may queue jobs into exactly this namespace and fetch results —
   the server only knows its hash, used as the key of an in-memory queue.
   A foreign key sees an empty queue and reaches no Mac.

Since 2.1.0: THE MAC TAKES PRECEDENCE — ALSO FOR THE BRIEF
----------------------------------------------------------
If a language model (Ollama) runs on the Mac, IT writes the production brief
(POST /api/brief). Briefs run on
a lane of their own on the bridge (lane=brief), so they never wait behind a track that
takes minutes. Without a lane parameter a bridge only gets tracks and analyses.

Since 3.2.0: COVER, TAGS, WATERMARK, EXPORT
-------------------------------------------
The Mac polishes every track (inaudible watermark, tags with the copyright from ITS OWN
settings, AI cover) and exports it as MP3 or lossless. New job kinds:
settings/export/verify run on the brief lane (fast, no GPU), cover/
nachruesten (retrofit) on the render lane (the image model shares the GPU with the music AI).
A bridge only gets kinds it lists in x-nf-agent under "caps" — a 3.1 bridge
would otherwise see an export as a brief. Covers are attached to the job (GET /api/render/<id>/cover).

Since 2.2.0: SECURE ADDRESS + MOVE
----------------------------------
an https address (e.g. tailscale serve, real certificate; site.json → secure_origin). The
start page redirects old http addresses there (browser pages only, detected via
X-Forwarded-Proto). Exception ?nf-umzug=1: through that window web/umzug.js fetches
pairing, brief and library from the old address — for the browser the
new address is a new site with empty storage.
"""
import hashlib
import http.server
import json
import math
import os
import re
import secrets
import socket
import socketserver
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
import uuid

PORT = int(os.environ.get("PORT", "8080"))
HOST = os.environ.get("HOST", "0.0.0.0")      # 3.11: local install → 127.0.0.1 (the starter sets this)
ROOT = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(ROOT, "web")

APP_VERSION = "3.29.0"
BRIDGE_FILE = os.path.join(ROOT, "bridge", "manuwave_bridge.py")
# Bridges installed by earlier versions fetch their update under the file name they were installed with.
BRIDGE_PATHS = ("/bridge/manuwave_bridge.py", "/bridge/" + ("neon" + "forge") + "_bridge.py")   # names-ok
BUILD_INFO_FILE = os.path.join(WEB, "build-info.json")
INDEX_FILE = os.path.join(WEB, "index.html")
# Secure address (e.g. tailscale serve) — see web/umzug.js. 3.11: from the environment or site.json next to
# server.py; empty = no redirect (local installs need none).
def _site_cfg() -> dict:
    try:
        with open(os.path.join(ROOT, "site.json"), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


SECURE_ORIGIN = (os.environ.get("NF_SECURE_ORIGIN") or _site_cfg().get("secure_origin") or "").rstrip("/")

def _git_head() -> str:
    """Short commit hash read directly from ``.git`` (no git binary). '' if not possible."""
    try:
        with open(os.path.join(ROOT, ".git", "HEAD")) as f:
            ref = f.read().strip()
        if ref.startswith("ref:"):
            with open(os.path.join(ROOT, ".git", ref[4:].strip())) as f:
                return f.read().strip()[:7]
        return ref[:7]
    except Exception:
        return ""


def write_build_stamp() -> dict:
    """Writes ``web/build-info.json`` with commit + build time AND bakes the version
    directly into ``index.html`` (footer + ``window.__BUILD__``). Called during the Docker build
    (``RUN python -c "import server; server.write_build_stamp()"``) so that
    every deploy gets a fresh, **cache-proof** stamp: the footer then shows the
    version without a detour through a (possibly cached) ``/api/config`` request, and
    JS/CSS get a build-dependent query string that no proxy serves stale."""
    import datetime
    commit = os.environ.get("GIT_COMMIT", "").strip()[:7] or _git_head() or "unknown"
    built = (datetime.datetime.now(datetime.timezone.utc)
             .replace(microsecond=0).isoformat().replace("+00:00", "Z"))
    info = {"version": APP_VERSION, "commit": commit, "builtAt": built}
    with open(BUILD_INFO_FILE, "w") as f:
        json.dump(info, f)
    _bake_index(info)
    return info


def _version_label(info: dict) -> str:
    """Compact, always visible identifier, e.g. ``v1.3.0 · abc1234 · 2026-08-05``."""
    parts = ["v" + info["version"]]
    if info.get("commit") and info["commit"] != "unknown":
        parts.append(info["commit"])
    if info.get("builtAt"):
        parts.append(info["builtAt"][:10])
    return " · ".join(parts)


def _bake_index(info: dict) -> None:
    """Anchor the version visibly in ``index.html`` and cache-bust static assets.
    Idempotent — calling it repeatedly changes nothing further."""
    buster = "".join(c for c in (info.get("builtAt") or "") if c.isdigit()) or info.get("commit") or "0"
    try:
        with open(INDEX_FILE, encoding="utf-8") as f:
            html = f.read()
    except Exception:
        return
    label = _version_label(info)
    # 1) Bake the version into the footer — visible immediately, independent of JS/config.
    html = re.sub(r'<span id="ver"[^>]*>.*?</span>',
                  f'<span id="ver" data-baked="1">{label}</span>', html, count=1, flags=re.S)
    # 2) Build info as a global object (diagnostics in the browser console).
    script = "<script>window.__BUILD__=" + json.dumps({**info, "source": "build"}) + ";</script>"
    if "window.__BUILD__" in html:
        html = re.sub(r"<script>window\.__BUILD__=.*?</script>", script, html, count=1, flags=re.S)
    else:
        html = html.replace("</head>", script + "\n</head>", 1)
    # 3) Cache-bust JS/CSS (the query string changes the URL → proxies reload).
    html = re.sub(r'(href="style\.css)(\?b=[^"]*)?(")', rf"\1?b={buster}\3", html, count=1)
    html = re.sub(r'(src="app\.js)(\?b=[^"]*)?(")', rf"\1?b={buster}\3", html, count=1)
    html = re.sub(r'(src="umzug\.js)(\?b=[^"]*)?(")', rf"\1?b={buster}\3", html, count=1)
    html = re.sub(r'(src="i18n\.js)(\?b=[^"]*)?(")', rf"\1?b={buster}\3", html, count=1)
    with open(INDEX_FILE, "w", encoding="utf-8") as f:
        f.write(html)


def _build_info() -> dict:
    """Version + build origin for the UI/diagnostics. Prefers the Docker build stamp;
    falls back locally (without a stamp) to the live commit from ``.git``."""
    info = {"version": APP_VERSION, "commit": "", "builtAt": None, "source": "dev"}
    try:
        with open(BUILD_INFO_FILE) as f:
            data = json.load(f)
        info["commit"] = data.get("commit") or ""
        info["builtAt"] = data.get("builtAt")
        info["source"] = "build"
    except Exception:
        info["commit"] = _git_head()  # local development
    return info


# =============================================================================
# Real music AI: relay between browser and Mac bridge
# =============================================================================

TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{24,128}$")
MAX_JOBS_PER_NS = 24                      # open + finished per pairing
RESULT_TTL = 45 * 60                      # finished results stay fetchable this long
MAX_AUDIO_BYTES = 128 * 1024 * 1024       # one file (3.4: 5 min WAV/AIFF at 24 bit ≈ 86 MB)
AUDIO_BUDGET = 512 * 1024 * 1024          # everything combined in memory
MAX_UPLOAD_BYTES = 60 * 1024 * 1024       # reference track
BRIDGE_SEEN_S = 45                        # the Mac counts as connected for this long
RUNNING_STALE_S = 15 * 60                 # no sign of life → treat as lost
QUEUED_TTL = 2 * 3600                     # 3.2: a job that is never picked up expires (otherwise it holds upload + slot forever)
NS_UPLOAD_CAP = 192 * 1024 * 1024         # 3.2: waiting uploads per pairing
FILE_JSON = "application/vnd.manuwave.file+json"   # 3.16: a JSON RESULT as a file (MIDI images ~100 KB per track)
MAX_JSON_BODY = 256 * 1024                # JSON body — briefs/texts are far smaller
DURATION_RANGE = (10.0, 600.0)   # 3.14: beyond 240 s the bridge builds in sections

# What may be passed through to the Mac — everything else is dropped. The browser
# decides the fields, the Mac computes them: values are clamped here, not trusted.
def clean_render_request(raw: dict) -> dict:
    if not isinstance(raw, dict):
        raise ValueError("Auftrag fehlt")

    def text(k, limit):
        v = raw.get(k)
        return v.strip()[:limit] if isinstance(v, str) else ""

    def num(k, lo, hi, default, cast=float):
        try:
            v = cast(raw.get(k))
        except (TypeError, ValueError, OverflowError):
            return default
        if v == 0 and default == 0:
            return 0
        return max(lo, min(hi, v))

    caption = text("caption", 1200)
    if not caption:
        raise ValueError("Stilbeschreibung (caption) fehlt")
    lyrics = text("lyrics", 6000) or "[Instrumental]"
    out = {
        "caption": caption,
        "lyrics": lyrics,
        "duration": num("duration", *DURATION_RANGE, 90.0),
        "bpm": num("bpm", 40, 220, 0, int),
        "keyscale": text("keyscale", 24),
        "timesignature": text("timesignature", 4),
        "vocal_language": text("vocal_language", 12),
        "seed": num("seed", -1, 2**31 - 1, -1, int),
        "inference_steps": num("inference_steps", 10, 100, 0, int),
        "guidance_scale": num("guidance_scale", 1.0, 15.0, 0),
        "lm_temperature": num("lm_temperature", 0.1, 2.0, 0),
        "use_cot_caption": bool(raw.get("use_cot_caption", False)),
        # 3.1: sound model (short name, the bridge checks whether it exists on the Mac) and soft ending
        "dit": text("dit", 24) if re.fullmatch(r"[a-z0-9][a-z0-9-]{1,23}", text("dit", 24) or "") else "",
        "smooth_end": bool(raw.get("smooth_end", True)),
        # 3.14: sound check — how often the bridge may re-roll a poorly rated version (0 = off)
        "qa_reroll": num("qa_reroll", 0, 3, 2, int),
    }
    # For these fields 0 means "the model decides" → don't send it at all.
    # 🔴 Not a blanket "everything that == 0": in Python False == 0, and
    #    use_cot_caption=False would silently drop out.
    auto_bei_null = {"bpm", "inference_steps", "guidance_scale", "lm_temperature"}
    return {k: v for k, v in out.items()
            if v not in ("", None) and not (k in auto_bei_null and v == 0)}


# The production brief is written — if it can — by the Mac itself (local language model).
# The browser only sends the task as text; instruction and response format
# are fixed in the bridge, the server passes nothing else through.
MAX_BRIEF_TEXT = 24000


def clean_brief_request(raw: dict) -> dict:
    if not isinstance(raw, dict):
        raise ValueError("Auftrag fehlt")
    user = raw.get("user")
    if not isinstance(user, str) or not user.strip():
        raise ValueError("Aufgabe für den Brief fehlt")
    out = {"user": user.strip()[:MAX_BRIEF_TEXT]}
    # 3.12: UI language — the bridge then writes the note in English instead of German
    if raw.get("ui_lang") in ("de", "en"):
        out["ui_lang"] = raw["ui_lang"]
    return out


BRIEF_LANE = {"brief", "settings", "export", "verify", "archiv", "loeschen", "web", "web_weg", "master_merken", "midi"}
# Kinds since 3.2 — only for bridges that know them (x-nf-agent "caps")
NEW_KINDS = {"settings", "export", "verify", "cover", "nachruesten", "archiv", "loeschen", "web", "web_weg", "master_merken", "midi", "weiter", "analyse"}
KIND_SINCE = {"loeschen": "3.6", "web": "3.10", "web_weg": "3.10", "master_merken": "3.12.3", "midi": "3.16", "weiter": "3.17", "analyse": "3.19"}     # from which bridge version a kind works (for the message)


def lane_of(kind: str) -> str:
    """Two lanes: briefs finish in seconds and must not wait behind
    renderings that take minutes — the bridge fetches them on a lane of their own.
    Since 3.2 also settings, export and verify (fast, no GPU)."""
    return "brief" if kind in BRIEF_LANE else "render"


# ---- 3.2: details of a library track (tags, cover, archive on the Mac) ----
FORMATS = ("mp3", "flac", "alac", "wav", "aiff", "wavpack", "tta")
RATES = (0, 44100, 48000)
# 3.11.1: free choice of location (up to 3 levels below ~, no dot at the start of a level → no "..", nothing hidden).
#         The bridge checks anyway that the file lies in ITS renders/.
ARCHIVED_RE = re.compile(r"^(?:[^/\x00.][^/\x00]{0,59}/){1,3}renders/[^/\x00.][^/\x00]{0,39}/[^/\x00]{1,200}\.wav$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def clean_track(raw) -> dict:
    """The Mac looks for the track in ITS archive — the path is only a hint, the bridge
    itself checks that it lies in the previous install folder's renders directory. Clamped here, not trusted."""
    if not isinstance(raw, dict):
        raise ValueError("Track-Angaben fehlen")
    out = {}
    a = raw.get("archived")
    if isinstance(a, str) and ARCHIVED_RE.match(a) and ".." not in a:
        out["archived"] = a
    for k, limit in (("title", 120), ("variant", 4), ("note", 2000), ("caption", 1200),
                     ("lyrics", 6000), ("keyscale", 24)):
        v = raw.get(k)
        if isinstance(v, str) and v.strip():
            out[k] = v.strip()[:limit]
    c = raw.get("created")
    if isinstance(c, str) and DATE_RE.match(c[:10]):
        out["created"] = c[:10]
    for k, lo, hi in (("bpm", 0, 300), ("seed", -1, 2**31 - 1)):
        try:
            v = int(raw.get(k))
            if lo <= v <= hi:
                out[k] = v
        except (TypeError, ValueError, OverflowError):
            pass
    if raw.get("source") == "eigen":          # 3.15: played in the "Make it yourself" tab
        out["source"] = "eigen"
    if not out.get("title"):
        raise ValueError("Titel fehlt")
    return out


WEITER_TRACKS = ("drums", "bass", "keyboard", "synth", "guitar", "strings", "percussion", "brass", "woodwinds", "fx", "backing_vocals")


def clean_weiter(raw) -> dict:
    """3.17: loop machine → music AI. Only known fields within their limits (the bridge checks again)."""
    raw = raw if isinstance(raw, dict) else {}
    mode = raw.get("mode")
    if mode not in ("fortsetzen", "gesang"):
        raise ValueError("Unbekannter Weg")
    out = {"mode": mode}
    for k, n in (("caption", 500), ("lyrics", 3000)):
        if isinstance(raw.get(k), str) and raw[k].strip():
            out[k] = raw[k].strip()[:n]
    ks = raw.get("keyscale")
    if isinstance(ks, str) and re.match(r"^[A-G](?:#|b)? (?:major|minor)$", ks.strip()):
        out["keyscale"] = ks.strip()
    for k, lo, hi in (("bpm", 40, 220), ("duration", 20, 240)):
        try:
            v = float(raw.get(k))
        except (TypeError, ValueError):
            continue
        if lo <= v <= hi:
            out[k] = int(round(v)) if k == "bpm" else round(v, 1)
    tr = raw.get("tracks")
    if isinstance(tr, list):
        out["tracks"] = [t for t in tr if t in WEITER_TRACKS][:8]
    if raw.get("stimme") in ("original", "ki"):
        out["stimme"] = raw["stimme"]
    if isinstance(raw.get("seed"), int) and 0 <= raw["seed"] < 2 ** 31:
        out["seed"] = raw["seed"]
    return out


def clean_job(kind: str, raw) -> dict:
    if kind == "weiter":
        return clean_weiter(raw)
    if kind == "settings":
        raw = raw if isinstance(raw, dict) else {}
        # 3.26: choice of brief writer (name + Ollama address; the bridge only accepts what it offers itself)
        w = raw.get("writer")
        if isinstance(w, dict):
            return {"writer": {"model": str(w.get("model") or "")[:120], "url": str(w.get("url") or "")[:80]}}
        # 3.27: mastering presets (the bridge checks each preset again itself)
        if isinstance(raw.get("master_presets"), list):
            ps = []
            for p in raw["master_presets"][:40]:
                if isinstance(p, dict):
                    m = clean_master(p.get("m")) or {}
                    ps.append({"id": str(p.get("id") or "")[:24], "name": str(p.get("name") or "")[:40], "fav": p.get("fav") is True,
                               "m": {k: m[k] for k in ("bass", "tone", "treble", "soft", "fade_in", "fade_out", "eq", "mono_bass", "breite", "ziel", "haerte", "zisch", "komp") if k in m}})
            return {"master_presets": ps, "master_vorgabe": str(raw.get("master_vorgabe") or "")[:24]}
        s = raw.get("set")
        if not isinstance(s, dict):
            return {"fresh": True} if raw.get("fresh") is True else {}
        keep = {}
        for k in ("owner", "artist", "copyright", "album", "label", "website"):
            if isinstance(s.get(k), str):
                keep[k] = s[k].strip()[:200]
        # 🔴 3.4: "cover_artist" (3.3) was missing here — switching it off never reached the Mac
        for k in ("ai_note", "watermark", "cover", "cover_title", "cover_artist"):
            if isinstance(s.get(k), bool):
                keep[k] = s[k]
        return {"set": keep}
    if kind in ("verify", "archiv"):
        return {}
    if kind == "master_merken":
        # 3.12.3: mastering controls per archive path to the Mac — only numbers in range (the bridge checks again)
        lst = (raw or {}).get("items") if isinstance(raw, dict) else None
        keep = []
        for it in (lst if isinstance(lst, list) else [])[:500]:
            a = it.get("archived") if isinstance(it, dict) else None
            m = clean_master(it.get("master")) if isinstance(it, dict) else None
            if isinstance(a, str) and ARCHIVED_RE.match(a) and ".." not in a and m is not None:
                keep.append({"archived": a, "master": m})
        if not keep:
            raise ValueError("Keine Regler")
        return {"items": keep}
    if kind == "midi":
        # 3.16: fetch MIDI images — only archive paths in the expected form (the bridge checks again itself)
        lst = (raw or {}).get("archived") if isinstance(raw, dict) else None
        keep = [a for a in (lst if isinstance(lst, list) else []) if isinstance(a, str) and ARCHIVED_RE.match(a) and ".." not in a]
        if not keep:
            raise ValueError("Keine Tracks")
        return {"archived": keep[:40]}
    if kind == "loeschen":
        # 3.6: only archive paths in the expected form — the bridge checks again itself that they lie in renders/
        lst = (raw or {}).get("archived") if isinstance(raw, dict) else None
        keep = [a for a in (lst if isinstance(lst, list) else [])
                if isinstance(a, str) and ARCHIVED_RE.match(a) and ".." not in a]
        if not keep:
            raise ValueError("Nichts zu löschen")
        return {"archived": keep[:500]}
    out = clean_track(raw)
    if kind == "export":
        fmt = (raw or {}).get("format")
        if fmt not in FORMATS:
            raise ValueError("Unbekanntes Format")
        out["format"] = fmt
        try:
            rate = int((raw or {}).get("rate") or 0)
        except (TypeError, ValueError, OverflowError):
            rate = 0
        out["rate"] = rate if rate in RATES else 0
        # 3.4: bit depth and mastering controls — only numbers within their limits (the bridge checks again)
        out["bits"] = 16 if (raw or {}).get("bits") in (16, "16") else 24
        m = clean_master((raw or {}).get("master"))
        if m is not None:
            out["master"] = m
        # 3.9: release package — only known switches (the bridge checks again)
        pk = (raw or {}).get("paket")
        if isinstance(pk, dict):
            out["paket"] = {"text_eigen": pk.get("text_eigen") is True}
            if pk.get("ui_lang") in ("de", "en"):      # 3.29: language of the texts inside the package
                out["paket"]["ui_lang"] = pk["ui_lang"]
    if kind == "web":
        # 3.10: publishing — the controls are part of it (the page gets the mastered version)
        m = clean_master((raw or {}).get("master"))
        if m is not None:
            out["master"] = m
    if kind == "nachruesten":
        # Audio only if the browser gets the track NEW ("Fetch from Mac") — when retrofitting
        # it keeps its own copy, otherwise every track (40 MB) would go through the tunnel again.
        out["audio"] = (raw or {}).get("audio") is True
    return out


MASTER_KEYS = {"bass": (-12, 12), "tone": (-6, 6), "treble": (-12, 12), "soft": (0, 8), "gain": (-24, 12),
               "fade_in": (0, 10), "fade_out": (0, 15), "start": (0, 3600), "end": (0, 3600)}


# 3.27: equalizer — up to 8 bands behind the quick controls (like eqClean in mastering.js)
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
    if not isinstance(raw, dict):
        return None
    out = {}
    for k, (lo, hi) in MASTER_KEYS.items():
        v = raw.get(k)
        if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v):
            out[k] = max(lo, min(hi, float(v)))
    eq = clean_eq(raw.get("eq"))
    if eq:
        out["eq"] = eq
    for k, (lo, hi) in (("mono_bass", (60, 200)), ("breite", (50, 150))):
        v = raw.get(k)
        if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and lo <= v <= hi:
            out[k] = int(round(v))
    if raw.get("ziel") in ("leise", "club"):
        out["ziel"] = raw["ziel"]
    for k in ("haerte", "zisch", "komp"):            # 3.28: dynamics strengths 0–10 (the bridge rounds to half steps)
        v = raw.get(k)
        if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and 0 < v <= 10:
            out[k] = float(v)
    if raw.get("off") is True:
        out["off"] = True
    return out


def clean_meta(raw) -> dict:
    """Accompanying info for finding it again (title, producer's note, group)."""
    if not isinstance(raw, dict):
        return {}
    keep = {}
    for k, limit in (("title", 120), ("note", 2000), ("group", 40), ("variant", 4), ("source", 40)):
        v = raw.get(k)
        if isinstance(v, str) and v.strip():
            keep[k] = v.strip()[:limit]
    return keep


def clean_agent(raw: str) -> dict:
    """What the bridge says about itself (x-nf-agent header) — short and known fields only."""
    try:
        data = json.loads(urllib.parse.unquote(raw or "{}"))
    except Exception:
        return {}
    if not isinstance(data, dict):
        return {}
    keep = {}
    for k in ("host", "chip", "ram_gb", "lm", "mode", "engine", "version", "busy", "writer", "dits",
              "caps", "image", "home", "script"):
        v = data.get(k)
        if isinstance(v, (str, int, float, bool)):
            keep[k] = v if not isinstance(v, str) else v[:400 if k == "caps" else 80]
    return keep


class Broker:
    """In-memory queues, one namespace per pairing (hash of the key)."""

    def __init__(self):
        self.cv = threading.Condition()
        self.jobs: dict = {}          # id -> job
        self.bridges: dict = {}       # ns -> {"seen": t, "info": {...}}

    # ---- Helpers ----------------------------------------------------------
    @staticmethod
    def ns_for(token: str):
        token = (token or "").strip()
        if not TOKEN_RE.match(token):
            return None
        return hashlib.sha256(token.encode()).hexdigest()[:32]

    def _sweep(self, now: float) -> None:
        """Forget old results, end orphaned runs, cap memory."""
        for jid, j in list(self.jobs.items()):
            if j["status"] in ("done", "error", "cancelled") and now - j["updated"] > RESULT_TTL:
                del self.jobs[jid]
            elif j["status"] == "running" and now - j["updated"] > RUNNING_STALE_S:
                j.update(status="error", message="Der Mac hat sich nicht mehr gemeldet.",
                         updated=now, upload=None)
            elif j["status"] == "queued" and now - j["created"] > QUEUED_TTL:
                j.update(status="error", message="Der Mac hat den Auftrag zwei Stunden nicht abgeholt.",
                         updated=now, upload=None)
        # Memory budget: release the oldest finished audios and covers first.
        # 🔴 3.2 (audit): covers counted but were never released — so every sweep
        #    cleared the audios of ALL pairings and still never got under budget.
        total = self.bytes_held()
        if total > AUDIO_BUDGET:
            for j in sorted(self.jobs.values(), key=lambda x: x["updated"]):
                if total <= AUDIO_BUDGET:
                    break
                if j["status"] not in ("done", "error", "cancelled"):
                    continue
                for k in ("audio", "cover"):
                    if j.get(k):
                        total -= len(j[k])
                        j[k] = None
                        j["expired"] = True

    def busy(self) -> bool:
        """3.23: is any job running or waiting? Then no update — the queue lives in memory only."""
        with self.cv:
            return any(j["status"] in ("queued", "running") for j in self.jobs.values())

    def bytes_held(self, ns: str = None) -> int:
        return sum(len(j.get("audio") or b"") + len(j.get("cover") or b"") + len(j.get("upload") or b"")
                   for j in self.jobs.values() if ns is None or j["ns"] == ns)

    @staticmethod
    def public(j: dict) -> dict:
        """What the browser learns about a job — without bytes."""
        out = {k: j.get(k) for k in ("id", "kind", "status", "message", "created", "updated",
                                    "request", "meta", "result_meta", "result", "expired")}
        out["has_audio"] = bool(j.get("audio"))
        out["bytes"] = len(j.get("audio") or b"")
        out["mime"] = j.get("mime") or "audio/wav"
        out["has_cover"] = bool(j.get("cover"))
        out["cover_state"] = j.get("cover_state")      # None | "done" | "failed"
        out["cover_error"] = j.get("cover_error")
        out["queue_pos"] = j.get("queue_pos")
        return out

    # ---- Browser ----------------------------------------------------------
    def submit(self, ns: str, kind: str, request: dict, meta: dict, upload: bytes = None) -> dict:
        now = time.time()
        with self.cv:
            self._sweep(now)
            mine = [j for j in self.jobs.values() if j["ns"] == ns]
            if len([j for j in mine if j["status"] in ("queued", "running")]) >= MAX_JOBS_PER_NS:
                raise OverflowError("Zu viele offene Aufträge — warte, bis einige fertig sind.")
            if upload is not None:
                waiting = sum(len(j.get("upload") or b"") for j in mine)
                if waiting + len(upload) > NS_UPLOAD_CAP or self.bytes_held() + len(upload) > AUDIO_BUDGET:
                    raise OverflowError("Zu viele Dateien unterwegs — warte, bis der Mac sie abgeholt hat.")
            # Evict the oldest finished job so the namespace does not fill up
            if len(mine) >= MAX_JOBS_PER_NS:
                done = sorted((j for j in mine if j["status"] not in ("queued", "running")),
                              key=lambda x: x["updated"])
                for j in done[: len(mine) - MAX_JOBS_PER_NS + 1]:
                    self.jobs.pop(j["id"], None)
            jid = uuid.uuid4().hex[:16]
            job = {"id": jid, "ns": ns, "kind": kind, "status": "queued", "message": "",
                   "created": now, "updated": now, "request": request, "meta": meta,
                   "result_meta": None, "result": None, "audio": None, "upload": upload,
                   "cancel": False}
            self.jobs[jid] = job
            self.cv.notify_all()
            return self.public(job)

    def get(self, ns: str, jid: str):
        with self.cv:
            j = self.jobs.get(jid)
            if not j or j["ns"] != ns:
                return None
            if j["status"] == "queued":
                ahead = [x for x in self.jobs.values()
                         if x["ns"] == ns and x["status"] in ("queued", "running")
                         and lane_of(x["kind"]) == lane_of(j["kind"])
                         and x["created"] < j["created"]]
                j["queue_pos"] = len(ahead)
            else:
                j["queue_pos"] = None
            return j

    def list(self, ns: str) -> list:
        with self.cv:
            self._sweep(time.time())
            return [self.public(j) for j in sorted(self.jobs.values(), key=lambda x: x["created"])
                    if j["ns"] == ns]

    def cancel(self, ns: str, jid: str) -> bool:
        with self.cv:
            j = self.jobs.get(jid)
            if not j or j["ns"] != ns or j["status"] not in ("queued", "running"):
                return False
            if j["status"] == "queued":
                j["status"] = "cancelled"
                j["upload"] = None
            j["cancel"] = True             # if it is already running, the Mac learns of it at the next sign of life
            j["updated"] = time.time()
            self.cv.notify_all()
            return True

    def bridge_state(self, ns: str) -> dict:
        with self.cv:
            b = self.bridges.get(ns)
            now = time.time()
            connected = bool(b and now - b["seen"] < BRIDGE_SEEN_S)
            mine = [j for j in self.jobs.values() if j["ns"] == ns]
            return {"connected": connected,
                    "seen_s": round(now - b["seen"]) if b else None,
                    "info": (b or {}).get("info", {}),
                    "queued": sum(1 for j in mine if j["status"] == "queued"),
                    "running": sum(1 for j in mine if j["status"] == "running")}

    # ---- Mac bridge -------------------------------------------------------
    def next_for_bridge(self, ns: str, info: dict, wait: float, lane: str = "render"):
        deadline = time.time() + wait
        taker = str(info.get("host") or "?")
        with self.cv:
            # 🔑 Whoever asks for work is working on nothing — the bridge strictly takes one
            #    job at a time. So if one is still "running" on EXACTLY
            #    this Mac, the bridge died along the way (restart, sleep, kill).
            #    Instead of leaving it as "running" for 15 minutes: requeue it —
            #    once. If it takes the bridge down a second time, it is an error.
            now = time.time()
            for j in self.jobs.values():
                # 🔴 only in THE lane that is asking: the brief lane works in parallel to the
                #    render lane, its asking says nothing about a running track.
                if (j["ns"] == ns and j["status"] == "running" and j.get("taken_by") == taker
                        and lane_of(j["kind"]) == lane):
                    if j.get("attempts", 1) >= 2:
                        j.update(status="error", updated=now,
                                 message="Der Mac ist bei diesem Auftrag zweimal ausgestiegen.")
                    else:
                        j.update(status="queued", updated=now, message="Mac war kurz weg — läuft neu an …")
            while True:
                now = time.time()
                self.bridges[ns] = {"seen": now, "info": info}
                self._sweep(now)
                caps = set(str(info.get("caps") or "").split(","))
                # 🔴 3.2 (audit): a bridge that cannot handle a kind never picked it up — the job
                #    waited forever and held a slot. Now it says what the cause is.
                for j in self.jobs.values():
                    if (j["ns"] == ns and j["status"] == "queued" and lane_of(j["kind"]) == lane
                            and j["kind"] in NEW_KINDS and j["kind"] not in caps):
                        j.update(status="error", updated=now, upload=None,
                                 message="Die Brücke auf deinem Mac ist älter als %s — einmal neu einrichten (⚙️ › Mac einrichten)."
                                 % KIND_SINCE.get(j["kind"], "3.2"))
                queued = sorted((j for j in self.jobs.values()
                                 if j["ns"] == ns and j["status"] == "queued"
                                 and lane_of(j["kind"]) == lane
                                 and (j["kind"] not in NEW_KINDS or j["kind"] in caps)),
                                key=lambda x: x["created"])
                if queued:
                    j = queued[0]
                    j.update(status="running", message="Mac übernimmt …", updated=now,
                             taken_by=taker, attempts=j.get("attempts", 0) + 1)
                    return j
                left = deadline - now
                if left <= 0:
                    return None
                self.cv.wait(timeout=min(left, 5.0))

    def _bridge_job(self, ns: str, jid: str):
        j = self.jobs.get(jid)
        return j if j and j["ns"] == ns else None

    def adopt(self, ns: str, jid: str, kind: str, request: dict, meta: dict, taker: str) -> bool:
        """3.13: The bridge re-registers a job it is currently computing but that this server no longer knows after a
        restart (the queue lives in memory only). Same id — the browser keeps polling for it and
        gets the result as if nothing had happened."""
        with self.cv:
            now = time.time()
            j = self.jobs.get(jid)
            if j:
                return j["ns"] == ns
            if sum(1 for x in self.jobs.values() if x["ns"] == ns) >= MAX_JOBS_PER_NS:
                return False
            self.jobs[jid] = {"id": jid, "ns": ns, "kind": kind, "status": "running",
                              "message": "Server war neu gestartet — dein Mac rechnet weiter …",
                              "created": now, "updated": now, "request": request, "meta": meta,
                              "result_meta": None, "result": None, "audio": None, "upload": None,
                              "cancel": False, "taken_by": taker, "attempts": 1, "adopted": True}
            self.cv.notify_all()
            return True

    def progress(self, ns: str, jid: str, message: str) -> dict:
        with self.cv:
            now = time.time()
            self.bridges.setdefault(ns, {"seen": now, "info": {}})["seen"] = now
            j = self._bridge_job(ns, jid)
            if not j:
                # 3.13: until now unknown meant: cancel. After every restart of this server a running
                #    render died mid-computation. Now the bridge re-registers it (adopt).
                return {"cancel": False, "unknown": True}
            if j["status"] == "running":
                j["message"] = (message or "")[:120]
                j["updated"] = now
            return {"cancel": bool(j["cancel"])}

    def set_cover(self, ns: str, jid: str, data: bytes = None, error: str = "") -> bool:
        """The cover arrives after the track — hence also for an already finished job."""
        with self.cv:
            j = self._bridge_job(ns, jid)
            if not j or j["status"] not in ("running", "done"):
                return False
            if data:
                j.update(cover=data, cover_state="done", cover_error=None)
            else:
                j.update(cover_state="failed", cover_error=(error or "kein Cover")[:200])
            # A finished job keeps aging (otherwise a late-delivered cover would keep it alive forever)
            if j["status"] == "running":
                j["updated"] = time.time()
            self._sweep(time.time())
            self.cv.notify_all()
            return True

    def finish(self, ns: str, jid: str, audio: bytes = None, result=None, result_meta=None,
               mime: str = None) -> bool:
        with self.cv:
            j = self._bridge_job(ns, jid)
            if not j or j["status"] != "running":
                return False
            if j["cancel"]:
                j.update(status="cancelled", updated=time.time())
                return True
            j.update(status="done", message="", audio=audio, result=result,
                     result_meta=result_meta if isinstance(result_meta, dict) else None,
                     upload=None, updated=time.time(), mime=mime or "audio/wav")
            self._sweep(time.time())
            self.cv.notify_all()
            return True

    def fail(self, ns: str, jid: str, message: str) -> bool:
        with self.cv:
            j = self._bridge_job(ns, jid)
            if not j or j["status"] != "running":
                return False
            j.update(status="cancelled" if j["cancel"] else "error",
                     message=(message or "Fehler auf dem Mac")[:300], upload=None,
                     updated=time.time())
            return True


BROKER = Broker()


# ---- 3.23: one-click update (local install only) ---------------------------
# The local install (the starter sets MWS_HOME, next to it bridge.json, the app lives in MWS_HOME/app) asks GitHub for
# the latest release — only when the browser wants it. One click downloads the release ZIP, verifies it (compiled, a test
# start on a free port reports the new version), backs up the old app to app.prev, swaps the files and restarts
# the server (POSIX: execv, same process id — the starter notices nothing; Windows: exit with 75, the starter
# restarts it). The bridge notices its changed code by itself and restarts as soon as it has nothing to do.
# If a version needs new building blocks (INSTALL_REV higher than the installed state), only the installer can do it.
# In the container (Pi) all of this is off: there is no MWS_HOME there, rollout goes through the workshop broker.
UPDATE_REPO = "robeertm/manuwave-studio"
UPDATE_API = (os.environ.get("MWS_UPDATE_API") or "https://api.github.com").rstrip("/")             # test bench: simulated
UPDATE_RAW = (os.environ.get("MWS_UPDATE_RAW") or "https://raw.githubusercontent.com").rstrip("/")
UPDATE_HOSTS = {"api.github.com", "codeload.github.com", "github.com", "raw.githubusercontent.com",
                urllib.parse.urlparse(UPDATE_API).hostname, urllib.parse.urlparse(UPDATE_RAW).hostname}
INSTALL_REV = 1                 # installer revision this version needs (the installer writes MWS_HOME/install_rev)
UPDATE_CACHE_S = 6 * 3600       # ask GitHub at most every 6 hours
UPDATE_MAX_BYTES = 300 * 1024 * 1024
TAG_RE = re.compile(r"^v(\d{1,4})\.(\d{1,4})\.(\d{1,4})$")


def _vtuple(v: str):
    m = TAG_RE.match("v" + (v or "").lstrip("v"))
    return tuple(int(x) for x in m.groups()) if m else None


def mws_home() -> str:
    """The local install THIS server belongs to — otherwise "" (container, development, git clone)."""
    home = os.environ.get("MWS_HOME") or ""
    if not home or not os.path.isfile(os.path.join(home, "bridge.json")):
        return ""
    try:
        if os.path.realpath(os.path.join(home, "app")) != os.path.realpath(ROOT):
            return ""
    except OSError:
        return ""
    return home


def respawn_needed() -> bool:
    """3.24.1: Windows starters up to 3.24.0 never recognised exit code 75 (Start-Process -PassThru
    without a kept handle → ExitCode stays empty) — server and bridge simply stayed down after an update or
    new code. Only the starter from 3.24.1 on sets MWS_SUPERVISED=1 and restarts reliably; under an older
    one the program restarts itself."""
    if os.environ.get("MWS_TEST_RESPAWN") == "1":          # test bench: take this path on POSIX too
        return True
    return os.name == "nt" and os.environ.get("MWS_SUPERVISED") != "1"


def spawn_detached(argv: list, cwd: str, log_name: str) -> None:
    """Start the successor detached — it survives the end of this process and of the old starter."""
    home = mws_home() or cwd
    try:
        err = open(os.path.join(home, log_name), "ab")
    except OSError:
        err = subprocess.DEVNULL
    if os.name == "nt":
        kw = {"creationflags": subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP}
    else:
        kw = {"start_new_session": True}
    subprocess.Popen(argv, cwd=cwd, stdin=subprocess.DEVNULL, stdout=err, stderr=err, close_fds=True, **kw)


def restart_self(code: int = 75) -> None:
    """Restart with the code on disk. POSIX: execv (same process id, the starter keeps it);
    Windows with starter 3.24.1+: exit with 75 — the starter restarts; under an older one: restart itself."""
    try:
        sys.stdout.flush()
        sys.stderr.flush()
    except Exception:  # noqa: BLE001
        pass
    if respawn_needed():
        spawn_detached([sys.executable, os.path.join(ROOT, "server.py")], ROOT, "app.restart.log")
        os._exit(0)
    if os.name == "nt":
        os._exit(code)
    os.chdir(ROOT)
    os.execv(sys.executable, [sys.executable, os.path.join(ROOT, "server.py")])


def _fetch(url: str, limit: int, timeout: float = 20.0) -> bytes:
    host = urllib.parse.urlparse(url).hostname or ""
    if urllib.parse.urlparse(url).scheme not in ("https", "http") or host not in UPDATE_HOSTS:
        raise ValueError("Adresse nicht erlaubt: %s" % host)
    req = urllib.request.Request(url, headers={"User-Agent": "Manuwave-Studio/" + APP_VERSION,
                                               "Accept": "application/vnd.github+json, */*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = r.read(limit + 1)
    if len(data) > limit:
        raise ValueError("Datei zu groß")
    return data


def _free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


class Updater:
    def __init__(self):
        self.lock = threading.Lock()
        self.cache = None              # (time, data)
        self.state = {"phase": "idle", "message": "", "tag": ""}

    def installed_rev(self, home: str) -> int:
        try:
            with open(os.path.join(home, "install_rev"), encoding="utf-8") as f:
                return int(f.read().strip() or "0")
        except (OSError, ValueError):
            return 0

    def info(self, net: bool = True, force: bool = False) -> dict:
        home = mws_home()
        out = {"enabled": bool(home), "current": APP_VERSION, "state": dict(self.state)}
        if not home:
            return out
        now = time.time()
        if net and (force or not self.cache or now - self.cache[0] > UPDATE_CACHE_S):
            try:
                rel = json.loads(_fetch(UPDATE_API + "/repos/%s/releases/latest" % UPDATE_REPO, 2 * 1024 * 1024, 15))
                tag = str(rel.get("tag_name") or "")
                if not TAG_RE.match(tag):
                    raise ValueError("unbekannte Fassung %r" % tag[:20])
                rev = INSTALL_REV
                try:            # does the new version need the installer? It says so in its server.py
                    src = _fetch("%s/%s/%s/app/server.py" % (UPDATE_RAW, UPDATE_REPO, tag), 4 * 1024 * 1024, 15).decode("utf-8", "replace")
                    m = re.search(r"^INSTALL_REV = (\d+)", src, re.M)
                    rev = int(m.group(1)) if m else rev
                except Exception:  # noqa: BLE001
                    pass
                data = {"latest": tag[1:], "tag": tag, "notes": str(rel.get("body") or "")[:20000],
                        "url": str(rel.get("html_url") or ""), "zip": str(rel.get("zipball_url") or ""),
                        "published": str(rel.get("published_at") or "")[:10], "install_rev": rev, "error": ""}
                self.cache = (now, data)
            except Exception as e:  # noqa: BLE001
                data = dict(self.cache[1]) if self.cache else {}
                data["error"] = "GitHub nicht erreichbar (%s)" % type(e).__name__
                self.cache = (now - UPDATE_CACHE_S + 600, data)        # try again in 10 minutes
        if self.cache:
            out.update(self.cache[1])
        newer = bool(out.get("latest")) and (_vtuple(out["latest"]) or (0,)) > (_vtuple(APP_VERSION) or (0,))
        out["newer"] = newer
        out["needs_installer"] = newer and int(out.get("install_rev") or 0) > self.installed_rev(home)
        out["busy"] = BROKER.busy()
        return out

    def start(self, tag: str) -> tuple:
        home = mws_home()
        if not home:
            return 404, {"error": "off", "message": "Update gibt es nur in der lokalen Installation."}
        with self.lock:
            if self.state["phase"] not in ("idle", "error"):
                return 409, {"error": "running", "message": "Das Update läuft schon."}
            cur = self.info(net=False)
            if not cur.get("tag") or cur["tag"] != tag:
                return 409, {"error": "stale", "message": "Erst nach Updates suchen."}
            if (_vtuple(tag) or (0,)) <= (_vtuple(APP_VERSION) or (0,)):
                return 409, {"error": "not_newer", "message": "Diese Fassung ist schon da."}
            if int(cur.get("install_rev") or 0) > self.installed_rev(home):
                return 409, {"error": "needs_installer",
                             "message": "Diese Fassung braucht den Installer (neue Bausteine)."}
            if BROKER.busy():
                return 409, {"error": "busy", "message": "Gerade läuft ein Auftrag — das Update geht danach."}
            self.state = {"phase": "download", "message": "Lädt …", "tag": tag}
        threading.Thread(target=self._run, args=(home, tag, cur.get("zip") or ""), name="update", daemon=True).start()
        return 202, {"ok": True, "state": dict(self.state)}

    def _set(self, phase: str, message: str) -> None:
        self.state = dict(self.state, phase=phase, message=message)
        print("Update %s: %s" % (self.state.get("tag"), message), flush=True)

    def _run(self, home: str, tag: str, zip_url: str) -> None:
        import shutil
        import subprocess
        import zipfile
        work = os.path.join(home, "update")
        stage = os.path.join(work, "neu")
        try:
            shutil.rmtree(work, ignore_errors=True)
            os.makedirs(stage)
            data = _fetch(zip_url or "%s/repos/%s/zipball/%s" % (UPDATE_API, UPDATE_REPO, tag), UPDATE_MAX_BYTES, 300)
            self._set("check", "Prüft die neue Fassung …")
            zpath = os.path.join(work, tag + ".zip")
            with open(zpath, "wb") as f:
                f.write(data)
            with zipfile.ZipFile(zpath) as z:
                names = z.namelist()
                top = names[0].split("/")[0] if names else ""
                for n in names:
                    if n.startswith("/") or ".." in n.split("/") or "\\" in n or not n.startswith(top + "/"):
                        raise ValueError("ungültiger Pfad im ZIP")
                z.extractall(stage)
            src = os.path.join(stage, top)
            new_app = os.path.join(src, "app")
            with open(os.path.join(new_app, "server.py"), encoding="utf-8") as f:
                code = f.read()
            m = re.search(r'^APP_VERSION = "([^"]+)"', code, re.M)
            if not m or "v" + m.group(1) != tag:
                raise ValueError("Das ZIP enthält nicht die Fassung %s" % tag)
            m = re.search(r"^INSTALL_REV = (\d+)", code, re.M)
            if m and int(m.group(1)) > self.installed_rev(home):
                raise ValueError("Diese Fassung braucht den Installer (neue Bausteine)")
            import py_compile
            for d, _, fs in os.walk(new_app):
                for fn in fs:
                    if fn.endswith(".py"):
                        try:
                            py_compile.compile(os.path.join(d, fn), doraise=True)
                        except py_compile.PyCompileError:
                            raise ValueError("Die neue Fassung lässt sich nicht übersetzen (%s)" % fn)
            # Trial start: the new version must answer on a free port before it replaces the old one
            port = _free_port()
            env = {k: v for k, v in os.environ.items() if k != "MWS_HOME"}
            env.update(HOST="127.0.0.1", PORT=str(port))
            probe = subprocess.Popen([sys.executable, "server.py"], cwd=new_app, env=env,
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                seen = ""
                for _ in range(120):
                    time.sleep(0.25)
                    if probe.poll() is not None:
                        break
                    try:
                        with urllib.request.urlopen("http://127.0.0.1:%d/version" % port, timeout=2) as r:
                            seen = json.loads(r.read()).get("version", "")
                        break
                    except Exception:  # noqa: BLE001
                        continue
            finally:
                probe.terminate()
                try:
                    probe.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    probe.kill()
            if "v" + seen != tag:
                raise ValueError("Die neue Fassung startet nicht")
            self._set("install", "Installiert …")
            prev = os.path.join(home, "app.prev")
            shutil.rmtree(prev, ignore_errors=True)
            shutil.copytree(ROOT, prev, ignore=shutil.ignore_patterns("__pycache__"))
            try:
                _sync_tree(new_app, ROOT)
            except Exception:
                _sync_tree(prev, ROOT)        # half swapped: restore the old app
                raise
            _copy_launchers(src, home)
            shutil.rmtree(work, ignore_errors=True)
            self._set("restart", "Startet neu …")
            threading.Timer(0.8, restart_self).start()
        except Exception as e:  # noqa: BLE001
            shutil.rmtree(work, ignore_errors=True)
            self._set("error", "Update nicht möglich: %s" % ((str(e) or type(e).__name__)[:200]))


def _sync_tree(src: str, dst: str) -> None:
    """dst becomes src: copy new and changed files, delete vanished ones (caches and the
    build stamp stay). Copies into the existing folders — on Windows the folder of the
    running server cannot be renamed."""
    import shutil
    keep = {"build-info.json"}
    for d, dirs, fs in os.walk(src):
        dirs[:] = [x for x in dirs if x != "__pycache__"]
        rel = os.path.relpath(d, src)
        os.makedirs(os.path.join(dst, rel), exist_ok=True)
        for fn in fs:
            shutil.copy2(os.path.join(d, fn), os.path.join(dst, rel, fn))
    for d, dirs, fs in os.walk(dst, topdown=False):
        if "__pycache__" in d.split(os.sep):
            continue
        rel = os.path.relpath(d, dst)
        for fn in fs:
            if fn not in keep and not os.path.exists(os.path.join(src, rel, fn)):
                os.remove(os.path.join(d, fn))
        if rel != "." and not os.path.exists(os.path.join(src, rel)) and not os.listdir(d):
            os.rmdir(d)


def _copy_launchers(src: str, home: str) -> None:
    """The starters sit next to the app (the installer put them there) — they take effect from the next start."""
    import shutil
    pairs = {"darwin": [("install/macos/Manuwave Studio.command", "Manuwave Studio.command")],
             "linux": [("install/linux/manuwave-studio.sh", "manuwave-studio.sh")],
             "win32": [("install/windows/Manuwave Studio.ps1", "Manuwave Studio.ps1"),
                       ("install/windows/Manuwave Studio.bat", "Manuwave Studio.bat")]}.get(sys.platform, [])
    for a, b in pairs:
        s, d = os.path.join(src, *a.split("/")), os.path.join(home, b)
        if os.path.isfile(s) and os.path.isfile(d):
            shutil.copy2(s, d)
            if not b.endswith((".ps1", ".bat")):
                os.chmod(d, 0o755)


UPDATER = Updater()


# ---- Pairing by code --------------------------------------------------------
# 🔴 localStorage is per ADDRESS. The workshop links apps with the hostname
#    under which one opened them oneself — a pairing link for one address
#    is invisible under another, and on a phone it is different anyway.
#    Hence: the bridge offers a short code, every device types it in.
#    The code lives 10 minutes in memory; guessing is throttled (31^6 ≈ 887 million
#    codes against 20 attempts per 10 min).
#    Behind Docker's port forwarding all senders look the same — the throttle
#    then applies to all of them together. That is stricter, not looser.
PAIR_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"   # without 0/O, 1/I/L
PAIR_TTL = 10 * 60
PAIR_TRIES = 20                                      # per sender and time window


class Pairing:
    def __init__(self):
        self.lock = threading.Lock()
        self.codes: dict = {}      # code -> (token, expires)
        self.tries: dict = {}      # ip -> [timestamps]

    def offer(self, token: str) -> str:
        with self.lock:
            now = time.time()
            for c, (t, exp) in list(self.codes.items()):
                if exp < now or t == token:
                    del self.codes[c]
            code = "".join(secrets.choice(PAIR_ALPHABET) for _ in range(6))
            self.codes[code] = (token, now + PAIR_TTL)
            return code[:3] + "-" + code[3:]

    def claim(self, ip: str, code: str):
        """Token for the code — or None. Throttles per sender."""
        with self.lock:
            now = time.time()
            recent = [t for t in self.tries.get(ip, []) if now - t < PAIR_TTL]
            if len(recent) >= PAIR_TRIES:
                raise PermissionError("Zu viele Versuche — in ein paar Minuten noch einmal.")
            recent.append(now)
            self.tries[ip] = recent
            key = re.sub(r"[^A-Z0-9]", "", (code or "").upper())
            hit = self.codes.get(key)
            if not hit or hit[1] < now:
                return None
            return hit[0]


PAIRING = Pairing()


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=WEB, **k)

    def log_message(self, fmt, *args):  # quiet log, errors are in the body
        pass

    def end_headers(self):
        # Never cache static assets hard: ``no-cache`` forces revalidation,
        # so a new deploy is guaranteed to serve a fresh index.html/app.js and
        # the browser does not hold on to an old version (e.g. v1.0.0). JSON responses set
        # their own ``no-store`` header (flag ``_cc``) and are skipped here.
        if not getattr(self, "_cc", False):
            self.send_header("Cache-Control", "no-cache")
        self._cc = False
        super().end_headers()

    # ---- Helpers ----------------------------------------------------------
    def _json(self, code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self._cc = True
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        # 🔴 3.2 (audit): without a limit /api/pair/claim (no key) also read every body into memory
        try:
            length = int(self.headers.get("Content-Length", "0") or "0")
        except ValueError:
            return {}
        if length <= 0 or length > MAX_JSON_BODY:
            return {}
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
        except Exception:
            return {}
        return data if isinstance(data, dict) else {}

    def _raw_body(self, limit: int):
        """Raw bytes (audio). None if too large — then nothing is read at all."""
        try:
            length = int(self.headers.get("Content-Length", "0") or "0")
        except ValueError:
            return None
        if length <= 0 or length > limit:
            return None
        return self.rfile.read(length)

    def _bytes(self, code, data: bytes, ctype: str, filename: str = None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        if filename:
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self._cc = True
        self.end_headers()
        self.wfile.write(data)

    def _ns(self):
        """Namespace from the pairing key — or 401 and None."""
        ns = Broker.ns_for(self.headers.get("x-nf-bridge", ""))
        if not ns:
            self._json(401, {"error": "no_bridge",
                             "message": "Kein gültiger Kopplungsschlüssel — Mac-Brücke in den Einstellungen koppeln."})
        return ns

    def _update_apply(self):
        """3.23: only from the app's own page (Host and Origin = 127.0.0.1/localhost) and only with the key from
        bridge.json — a foreign web page can send neither the key nor the x-nf-bridge header."""
        home = mws_home()
        host = (self.headers.get("Host") or "").rsplit(":", 1)[0].lower()
        origin = (self.headers.get("Origin") or "").lower()
        allowed = {"http://127.0.0.1:%d" % PORT, "http://localhost:%d" % PORT}
        try:
            with open(os.path.join(home, "bridge.json"), encoding="utf-8") as f:
                token = str(json.load(f).get("token") or "")
        except (OSError, ValueError, TypeError):
            token = ""
        given = self.headers.get("x-nf-bridge", "").strip()
        if (not home or host not in ("127.0.0.1", "localhost") or (origin and origin not in allowed)
                or not token or not secrets.compare_digest(given.encode(), token.encode())):
            self._json(403, {"error": "forbidden", "message": "Update nur aus Manuwave Studio auf diesem Rechner."})
            return
        code, out = UPDATER.start(str(self._read_body().get("tag") or ""))
        self._json(code, out)

    # ---- GET --------------------------------------------------------------
    def do_GET(self):
        path = self.path.split("?")[0]
        if self.path == "/healthz":
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"ok")
            return
        if path in ("/version", "/api/version"):
            self._json(200, _build_info())
            return
        if path == "/api/update":
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            self._json(200, UPDATER.info(net=q.get("net") != ["0"], force=q.get("force") == ["1"]))
            return
        if path in BRIDGE_PATHS:
            # The Mac bridge is part of the app and has the same version — so the Mac
            # always fetches exactly the counterpart of the running server.
            try:
                with open(BRIDGE_FILE, "rb") as f:
                    data = f.read()
            except OSError:
                self._json(404, {"error": "bridge_missing"})
                return
            self._bytes(200, data, "text/x-python; charset=utf-8", os.path.basename(path))
            return
        if path.startswith("/api/render") or path.startswith("/api/bridge") or path == "/api/renders":
            return self._get_api(path)
        if path in ("/", "/index.html"):
            umleitung = self._zur_sicheren_adresse()
            if umleitung:
                self.send_response(302)
                self.send_header("Location", umleitung)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            self.path = "/index.html"
        return super().do_GET()

    def _zur_sicheren_adresse(self):
        """Since 2.2: whoever opens the start page in the browser via an old http address lands
        on the https address (tailscale serve). Detected via X-Forwarded-Proto — tailscale serve sets it
        ONLY on the https path (measured 10.10.2026), so no loop.

        🔴 Exception ?nf-umzug=1: that is the move window that fetches the data from the OLD
           address (web/umzug.js). If it were redirected, nobody could reach that data any more.
        Browser pages only (Accept: text/html), never /api, never the bridge, never from the Pi itself.
        302 instead of 301 — a 301 is remembered by the browser permanently."""
        if not SECURE_ORIGIN or self.headers.get("X-Forwarded-Proto", "").lower() == "https":
            return None
        if "text/html" not in (self.headers.get("Accept") or ""):
            return None
        query = urllib.parse.urlparse(self.path).query
        if urllib.parse.parse_qs(query).get("nf-umzug") == ["1"]:
            return None
        host = (self.headers.get("Host") or "").split(":")[0].lower()
        if host in ("localhost", "127.0.0.1", ""):
            return None
        return SECURE_ORIGIN + "/" + (("?" + query) if query else "")

    def _get_api(self, path):
        ns = self._ns()
        if not ns:
            return
        if path == "/api/bridge/status":
            self._json(200, BROKER.bridge_state(ns))
            return
        if path == "/api/renders":
            self._json(200, {"jobs": BROKER.list(ns)})
            return
        if path == "/api/bridge/next":
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            try:
                wait = max(0.0, min(30.0, float(q.get("wait", ["25"])[0])))
            except ValueError:
                wait = 25.0
            info = clean_agent(self.headers.get("x-nf-agent", ""))
            # Without a parameter: render lane — a 2.0 bridge knows no briefs and gets none.
            lane = "brief" if q.get("lane", [""])[0] == "brief" else "render"
            j = BROKER.next_for_bridge(ns, info, wait, lane)
            if not j:
                self.send_response(204)
                self._cc = True
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                return
            self._json(200, {"id": j["id"], "kind": j["kind"], "request": j["request"],
                             "meta": j["meta"], "has_upload": bool(j.get("upload")),
                             "filename": (j.get("meta") or {}).get("filename", "upload")})
            return
        m = re.match(r"^/api/bridge/upload/([0-9a-f]{16})$", path)
        if m:
            j = BROKER.get(ns, m.group(1))
            if not j or not j.get("upload"):
                self._json(404, {"error": "not_found"})
                return
            self._bytes(200, j["upload"], "application/octet-stream")
            return
        m = re.match(r"^/api/render/([0-9a-f]{16})(/audio|/cover)?$", path)
        if m:
            j = BROKER.get(ns, m.group(1))
            if not j:
                self._json(404, {"error": "not_found", "message": "Auftrag unbekannt (Server neu gestartet?)."})
                return
            if m.group(2) == "/cover":
                if not j.get("cover"):
                    self._json(404, {"error": "no_cover", "message": "Kein Cover (noch nicht)."})
                    return
                self._bytes(200, j["cover"], "image/jpeg")
                return
            if m.group(2):
                if not j.get("audio"):
                    self._json(410 if j.get("expired") else 404,
                               {"error": "no_audio", "message": "Kein Audio (mehr) vorhanden."})
                    return
                self._bytes(200, j["audio"], j.get("mime") or "audio/wav")
                return
            self._json(200, Broker.public(j))
            return
        self._json(404, {"error": "unbekannter Endpunkt"})

    # ---- POST -------------------------------------------------------------
    def do_POST(self):
        path = self.path.split("?")[0]
        if path == "/api/update/apply":
            return self._update_apply()
        if path == "/api/pair/claim":
            # Without a key — that is exactly what the code is for.
            try:
                token = PAIRING.claim(self.client_address[0], str(self._read_body().get("code", "")))
            except PermissionError as e:
                self._json(429, {"error": "too_many", "message": str(e)})
                return
            if not token:
                self._json(404, {"error": "bad_code", "message": "Code unbekannt oder abgelaufen."})
                return
            self._json(200, {"token": token})
            return
        if path == "/api/pair/offer":
            ns = self._ns()
            if ns:
                self._json(200, {"code": PAIRING.offer(self.headers.get("x-nf-bridge", "").strip()),
                                 "expires_s": PAIR_TTL})
            return
        if (path.startswith("/api/render") or path.startswith("/api/bridge")
                or path in ("/api/analyze", "/api/brief", "/api/job", "/api/job/upload")):
            return self._post_api(path)
        self._json(404, {"error": "unbekannter Endpunkt"})

    def _post_api(self, path):
        ns = self._ns()
        if not ns:
            return
        # ---- Browser ----
        if path == "/api/render":
            data = self._read_body()
            try:
                req = clean_render_request(data.get("request"))
            except ValueError as e:
                self._json(400, {"error": "bad_request", "message": str(e)})
                return
            try:
                job = BROKER.submit(ns, "render", req, clean_meta(data.get("meta")))
            except OverflowError as e:
                self._json(429, {"error": "busy", "message": str(e)})
                return
            self._json(200, job)
            return
        if path == "/api/brief":
            data = self._read_body()
            try:
                req = clean_brief_request(data.get("request"))
            except ValueError as e:
                self._json(400, {"error": "bad_request", "message": str(e)})
                return
            try:
                job = BROKER.submit(ns, "brief", req, clean_meta(data.get("meta")))
            except OverflowError as e:
                self._json(429, {"error": "busy", "message": str(e)})
                return
            self._json(200, job)
            return
        if path in ("/api/job", "/api/job/upload"):
            # 3.2: settings, export, cover, retrofit, check watermark.
            # With a file: raw data in the body, the details in x-nf-job (URL-encoded JSON).
            if path == "/api/job":
                data = self._read_body()
                upload = None
            else:
                try:
                    data = json.loads(urllib.parse.unquote(self.headers.get("x-nf-job", "") or "{}"))
                except Exception:      # also RecursionError with absurdly nested JSON
                    data = {}
                if not isinstance(data, dict) or data.get("kind") not in ("verify", "export", "nachruesten", "weiter"):
                    self._json(400, {"error": "bad_request", "message": "Unbekannte Auftragsart."})
                    return
                upload = self._raw_body(MAX_AUDIO_BYTES)
                if upload is None:
                    self._json(413, {"error": "too_big", "message": "Datei fehlt oder ist größer als %d MB." % (MAX_AUDIO_BYTES // (1024 * 1024))})
                    return
            kind = data.get("kind") if isinstance(data, dict) else None
            if kind not in NEW_KINDS or kind == "analyse" or (kind in ("verify", "weiter") and upload is None) \
                    or (upload is not None and kind not in ("verify", "export", "nachruesten", "web", "weiter")):
                self._json(400, {"error": "bad_request", "message": "Unbekannte Auftragsart."})
                return
            try:
                req = clean_job(kind, data.get("request"))
            except ValueError as e:
                self._json(400, {"error": "bad_request", "message": str(e)})
                return
            meta = clean_meta(data.get("meta"))
            if kind == "verify":
                name = re.sub(r"[^\w.\- ]+", "_", str(data.get("filename") or "upload"))[:120] or "upload"
                meta.update(filename=name, title=name)
            try:
                job = BROKER.submit(ns, kind, req, meta, upload=upload)
            except OverflowError as e:
                self._json(429, {"error": "busy", "message": str(e)})
                return
            self._json(200, job)
            return
        if path == "/api/analyze":
            audio = self._raw_body(MAX_UPLOAD_BYTES)
            if audio is None:
                self._json(413, {"error": "too_big", "message": "Datei fehlt oder ist größer als 60 MB."})
                return
            name = urllib.parse.unquote(self.headers.get("x-nf-filename", "upload"))[:120]
            name = re.sub(r"[^\w.\- ]+", "_", name) or "upload"
            # 3.24: "analyse" = music AI listens AND the Mac measures (tempo, key, chords, structure …) — from bridge 3.19
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            kind = "analyse" if q.get("kind") == ["analyse"] else "understand"
            try:
                job = BROKER.submit(ns, kind, {}, {"filename": name, "title": name}, upload=audio)
            except OverflowError as e:
                self._json(429, {"error": "busy", "message": str(e)})
                return
            self._json(200, job)
            return
        m = re.match(r"^/api/render/([0-9a-f]{16})/cancel$", path)
        if m:
            self._json(200, {"ok": BROKER.cancel(ns, m.group(1))})
            return
        # ---- Mac bridge ----
        m = re.match(r"^/api/bridge/adopt/([0-9a-f]{16})$", path)
        if m:
            data = self._read_body()
            kind = data.get("kind")
            try:
                if kind == "render":
                    req = clean_render_request(data.get("request"))
                elif kind == "brief":
                    req = clean_brief_request(data.get("request"))
                elif kind in NEW_KINDS and kind not in ("verify", "analyse"):
                    req = clean_job(kind, data.get("request"))
                else:
                    raise ValueError("Unbekannte Auftragsart.")
            except ValueError as e:
                self._json(400, {"error": "bad_request", "message": str(e)})
                return
            taker = str(clean_agent(self.headers.get("x-nf-agent", "")).get("host") or "?")
            ok = BROKER.adopt(ns, m.group(1), kind, req, clean_meta(data.get("meta")), taker)
            self._json(200 if ok else 409, {"ok": ok})
            return
        m = re.match(r"^/api/bridge/(progress|meta|result|error|cover)/([0-9a-f]{16})$", path)
        if not m:
            self._json(404, {"error": "unbekannter Endpunkt"})
            return
        what, jid = m.groups()
        if what == "progress":
            self._json(200, BROKER.progress(ns, jid, str(self._read_body().get("message", ""))))
            return
        if what == "error":
            ok = BROKER.fail(ns, jid, str(self._read_body().get("message", "")))
            self._json(200 if ok else 404, {"ok": ok})
            return
        if what == "cover":
            ctype = (self.headers.get("Content-Type") or "").lower()
            if ctype.startswith("image/"):
                data = self._raw_body(8 * 1024 * 1024)
                if data is None:
                    self._json(413, {"error": "too_big"})
                    return
                ok = BROKER.set_cover(ns, jid, data=data)
            else:
                ok = BROKER.set_cover(ns, jid, error=str(self._read_body().get("error", "")))
            self._json(200 if ok else 409, {"ok": ok})
            return
        if what == "meta":
            data = self._read_body()
            with BROKER.cv:
                j = BROKER._bridge_job(ns, jid)
                if j:
                    j["pending_meta"] = data if isinstance(data, dict) else None
            self._json(200 if j else 404, {"ok": bool(j)})
            return
        # result: audio bytes (render, export), ZIP (3.9: release package), JSON file (3.16: MIDI images,
        #         larger than a JSON body) or JSON (understand, settings …)
        ctype = (self.headers.get("Content-Type") or "").lower()
        if ctype.startswith("audio/") or ctype.split(";")[0].strip() in ("application/zip", FILE_JSON):
            audio = self._raw_body(MAX_AUDIO_BYTES)
            if audio is None:
                self._json(413, {"error": "too_big"})
                return
            with BROKER.cv:
                j = BROKER._bridge_job(ns, jid)
                meta = (j or {}).get("pending_meta")
            base_ct = ctype.split(";")[0].strip()
            mime = "application/json" if base_ct == FILE_JSON else base_ct if (re.fullmatch(r"audio/[\w.+-]{1,40}", base_ct) or base_ct == "application/zip") else "audio/wav"
            ok = BROKER.finish(ns, jid, audio=audio, result_meta=meta, mime=mime)
        else:
            data = self._read_body()
            ok = BROKER.finish(ns, jid, result=data.get("result"), result_meta=data.get("result_meta"))
        self._json(200 if ok else 409, {"ok": ok})


class Server(socketserver.ThreadingTCPServer):
    # 🔴 3.24.1: on Windows SO_REUSEADDR does NOT mean "skip TIME_WAIT" (Windows does that anyway), but
    #    "a second process may additionally bind the same port" — without error. Two servers on one port
    #    split browser and bridge: jobs arrived at one, the bridge asked the other.
    allow_reuse_address = os.name != "nt"
    daemon_threads = True
    # 3.22: queue instead of 5 (default) — on load the browser fetches ~20 files at once; under load
    # the server reset surplus connections (60 simultaneous: 25 aborts), a missing module file crippled the app
    request_queue_size = 256


def _bind() -> "Server":
    """A successor starts while its predecessor still holds the port — wait briefly instead of giving up."""
    for i in range(60):
        try:
            return Server((HOST, PORT), Handler)
        except OSError as e:
            busy = e.errno in (98, 48, 10048) or getattr(e, "winerror", None) == 10048
            if not busy or i == 59:
                if busy:
                    print(f"Port {PORT} ist belegt — läuft Manuwave Studio schon? Dann dort weiterarbeiten.", flush=True)
                raise
            time.sleep(0.25)
    raise RuntimeError("unreachable")


if __name__ == "__main__":
    with _bind() as httpd:
        b = _build_info()
        print(f"Manuwave Studio v{b['version']} ({b['commit'] or '?'}, built {b['builtAt'] or 'local'}) "
              f"on :{PORT}", flush=True)
        httpd.serve_forever()
