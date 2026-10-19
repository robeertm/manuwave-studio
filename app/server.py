"""Manuwave Studio — Musik-KI.

Abhängigkeitsfreier Webserver (nur Python-Stdlib). Serviert die App aus ``web/`` und
vermittelt zwischen Browser und Mac. Bindet 0.0.0.0:8080 (interner Port — MUSS mit dem
Manifest übereinstimmen).

Seit 3.0.0: NUR NOCH LOKALE KI
------------------------------
Der Claude-Weiterleiter (/api/compose, API-Key, Abo-Token) und das Browser-Synth-Studio
sind weg. Den Brief schreibt das Sprachmodell auf dem Mac (Ollama), die Musik rechnet
ACE-Step auf dem Mac. Dieser Server spricht mit keinem Dienst außerhalb des eigenen Netzes.
Klangqualität: der Browser schickt guidance_scale/inference_steps mit (Studio = 7,0 —
bis 2.2 lief jeder Track ungeführt mit 1,0, siehe web/app.js QUALITY).

Seit 2.0.0: ECHTE MUSIK-KI ÜBER DEN MAC
---------------------------------------
Ein Sprachmodell kann kein Audio ausgeben, und der Browser-Synth klingt nach Browser.
ACE-Step 1.5 erzeugt echte Musik — braucht aber einen Grafikchip, den dieser Rechner
nicht hat. Also rechnet der Mac, und dieser Server vermittelt nur:

    Browser ──POST /api/render──▶ Server ◀──GET /api/bridge/next── Mac (Brücke)
                                   │                                  │ ace-server
    Browser ◀──GET …/audio──────── Server ◀──POST /api/bridge/result─┘ (127.0.0.1)

🔑 Der Mac verbindet sich NACH AUSSEN (wie die DocuSort-Brücke) — er öffnet keinen
   Port, sein ace-server bleibt auf 127.0.0.1.

🔑 Der Server hält KEIN Geheimnis. Der Container hat kein Volume, alles Geschriebene
   ist beim nächsten Deploy weg. Darum ist der Kopplungsschlüssel eine FÄHIGKEIT: wer
   ihn kennt, darf in genau diesen Namensraum Aufträge legen und Ergebnisse abholen —
   der Server kennt nur seinen Hash als Schlüssel einer Warteschlange im Speicher.
   Ein fremder Schlüssel sieht eine leere Warteschlange und erreicht keinen Mac.

Seit 2.1.0: DER MAC HAT VORRANG — AUCH BEIM BRIEF
-------------------------------------------------
Läuft auf dem Mac ein Sprachmodell (Ollama), schreibt ER den Produktions-Brief
(POST /api/brief). Briefe laufen auf
einer eigenen Spur der Brücke (lane=brief), damit sie nie hinter einem minutenlangen
Track warten. Ohne Spurangabe bekommt eine Brücke nur Tracks und Analysen.

Seit 3.2.0: COVER, TAGS, WASSERZEICHEN, EXPORT
---------------------------------------------
Der Mac veredelt jeden Track (unhörbares Wasserzeichen, Tags mit dem Copyright aus SEINEN
Einstellungen, KI-Cover) und exportiert ihn als MP3 oder verlustfrei. Neue Auftragsarten:
settings/export/verify laufen auf der Brief-Spur (schnell, ohne Grafikchip), cover/
nachruesten auf der Render-Spur (das Bildmodell teilt sich den Grafikchip mit der Musik-KI).
Eine Brücke bekommt nur Arten, die sie in x-nf-agent unter "caps" nennt — eine 3.1-Brücke
sähe sonst einen Export als Brief. Cover liegen am Auftrag (GET /api/render/<id>/cover).

Seit 2.2.0: SICHERE ADRESSE + UMZUG
-----------------------------------
eine https-Adresse (z. B. tailscale serve, echtes Zertifikat; site.json → secure_origin). Die
Startseite leitet alte http-Adressen dorthin um (nur Browser-Seiten, erkannt an
X-Forwarded-Proto). Ausnahme ?nf-umzug=1: über dieses Fenster holt web/umzug.js
Kopplung, Brief und Bibliothek von der alten Adresse ab — für den Browser ist die
neue Adresse eine neue Seite mit leerem Speicher.
"""
import hashlib
import http.server
import json
import math
import os
import re
import secrets
import socketserver
import threading
import time
import urllib.parse
import uuid

PORT = int(os.environ.get("PORT", "8080"))
HOST = os.environ.get("HOST", "0.0.0.0")      # 3.11: lokale Installation → 127.0.0.1 (der Starter setzt das)
ROOT = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(ROOT, "web")

APP_VERSION = "3.17.2"
BRIDGE_FILE = next((p for p in (os.path.join(ROOT, "bridge", n) for n in ("neonforge_bridge.py", "manuwave_bridge.py"))
                    if os.path.isfile(p)), os.path.join(ROOT, "bridge", "manuwave_bridge.py"))
BUILD_INFO_FILE = os.path.join(WEB, "build-info.json")
INDEX_FILE = os.path.join(WEB, "index.html")
# Sichere Adresse (z. B. tailscale serve) — siehe web/umzug.js. 3.11: aus der Umgebung oder site.json neben
# server.py; leer = keine Umleitung (lokale Installationen brauchen keine).
def _site_cfg() -> dict:
    try:
        with open(os.path.join(ROOT, "site.json"), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


SECURE_ORIGIN = (os.environ.get("NF_SECURE_ORIGIN") or _site_cfg().get("secure_origin") or "").rstrip("/")

def _git_head() -> str:
    """Kurzer Commit-Hash direkt aus ``.git`` (ohne git-Binary). '' wenn nicht möglich."""
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
    """Schreibt ``web/build-info.json`` mit Commit + Build-Zeit UND backt die Version
    direkt in ``index.html`` (Footer + ``window.__BUILD__``). Beim Docker-Build
    aufgerufen (``RUN python -c "import server; server.write_build_stamp()"``), damit
    jeder Deploy einen frischen, **cache-festen** Stempel erhält: Der Footer zeigt die
    Version dann ohne Umweg über eine (evtl. gecachte) ``/api/config``-Anfrage, und
    JS/CSS bekommen einen Build-abhängigen Query-String, den kein Proxy alt ausliefert."""
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
    """Kompakte, immer sichtbare Kennung, z. B. ``v1.3.0 · abc1234 · 2026-08-05``."""
    parts = ["v" + info["version"]]
    if info.get("commit") and info["commit"] != "unknown":
        parts.append(info["commit"])
    if info.get("builtAt"):
        parts.append(info["builtAt"][:10])
    return " · ".join(parts)


def _bake_index(info: dict) -> None:
    """Version sichtbar in ``index.html`` verankern und statische Assets cache-busten.
    Idempotent — mehrfaches Aufrufen ändert nichts weiter."""
    buster = "".join(c for c in (info.get("builtAt") or "") if c.isdigit()) or info.get("commit") or "0"
    try:
        with open(INDEX_FILE, encoding="utf-8") as f:
            html = f.read()
    except Exception:
        return
    label = _version_label(info)
    # 1) Version fest in den Footer backen — unabhängig von JS/Config sofort sichtbar.
    html = re.sub(r'<span id="ver"[^>]*>.*?</span>',
                  f'<span id="ver" data-baked="1">{label}</span>', html, count=1, flags=re.S)
    # 2) Build-Info als globales Objekt (Diagnose in der Browser-Konsole).
    script = "<script>window.__BUILD__=" + json.dumps({**info, "source": "build"}) + ";</script>"
    if "window.__BUILD__" in html:
        html = re.sub(r"<script>window\.__BUILD__=.*?</script>", script, html, count=1, flags=re.S)
    else:
        html = html.replace("</head>", script + "\n</head>", 1)
    # 3) JS/CSS cache-busten (Query-String ändert die URL → Proxys laden neu).
    html = re.sub(r'(href="style\.css)(\?b=[^"]*)?(")', rf"\1?b={buster}\3", html, count=1)
    html = re.sub(r'(src="app\.js)(\?b=[^"]*)?(")', rf"\1?b={buster}\3", html, count=1)
    html = re.sub(r'(src="umzug\.js)(\?b=[^"]*)?(")', rf"\1?b={buster}\3", html, count=1)
    html = re.sub(r'(src="i18n\.js)(\?b=[^"]*)?(")', rf"\1?b={buster}\3", html, count=1)
    with open(INDEX_FILE, "w", encoding="utf-8") as f:
        f.write(html)


def _build_info() -> dict:
    """Version + Build-Herkunft für die UI/Diagnose. Bevorzugt den Docker-Build-Stempel;
    fällt lokal (ohne Stempel) auf den Live-Commit aus ``.git`` zurück."""
    info = {"version": APP_VERSION, "commit": "", "builtAt": None, "source": "dev"}
    try:
        with open(BUILD_INFO_FILE) as f:
            data = json.load(f)
        info["commit"] = data.get("commit") or ""
        info["builtAt"] = data.get("builtAt")
        info["source"] = "build"
    except Exception:
        info["commit"] = _git_head()  # lokale Entwicklung
    return info


# =============================================================================
# Echte Musik-KI: Vermittler zwischen Browser und Mac-Brücke
# =============================================================================

TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{24,128}$")
MAX_JOBS_PER_NS = 24                      # offen + fertig je Kopplung
RESULT_TTL = 45 * 60                      # fertige Ergebnisse so lange abholbar
MAX_AUDIO_BYTES = 128 * 1024 * 1024       # eine Datei (3.4: 5 min WAV/AIFF in 24 Bit ≈ 86 MB)
AUDIO_BUDGET = 512 * 1024 * 1024          # alles zusammen im Speicher
MAX_UPLOAD_BYTES = 60 * 1024 * 1024       # Referenz-Track
BRIDGE_SEEN_S = 45                        # so lange gilt der Mac als verbunden
RUNNING_STALE_S = 15 * 60                 # ohne Lebenszeichen → als verloren werten
QUEUED_TTL = 2 * 3600                     # 3.2: ein nie abgeholter Auftrag verfällt (sonst hält er Upload + Platz ewig)
NS_UPLOAD_CAP = 192 * 1024 * 1024         # 3.2: wartende Uploads je Kopplung
FILE_JSON = "application/vnd.manuwave.file+json"   # 3.16: ein JSON-ERGEBNIS als Datei (MIDI-Abbilder ~100 KB je Track)
MAX_JSON_BODY = 256 * 1024                # JSON-Körper — Briefe/Texte sind weit kleiner
DURATION_RANGE = (10.0, 600.0)   # 3.14: über 240 s baut die Brücke in Abschnitten an

# Was an den Mac durchgereicht werden darf — alles andere fällt weg. Der Browser
# bestimmt die Felder, der Mac rechnet sie: hier wird geklemmt, nicht vertraut.
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
        # 3.1: Klangmodell (Kurzname, die Brücke prüft, ob es auf dem Mac liegt) und weiches Ende
        "dit": text("dit", 24) if re.fullmatch(r"[a-z0-9][a-z0-9-]{1,23}", text("dit", 24) or "") else "",
        "smooth_end": bool(raw.get("smooth_end", True)),
        # 3.14: Klangprüfung — so oft darf die Brücke eine schwach bewertete Fassung neu würfeln (0 = aus)
        "qa_reroll": num("qa_reroll", 0, 3, 2, int),
    }
    #    use_cot_caption=False fiele dann still weg.
    auto_bei_null = {"bpm", "inference_steps", "guidance_scale", "lm_temperature"}
    return {k: v for k, v in out.items()
            if v not in ("", None) and not (k in auto_bei_null and v == 0)}


# Den Produktions-Brief schreibt — wenn er kann — der Mac selbst (lokales Sprachmodell).
# Der Browser schickt dafür nur die Aufgabe als Text; Anweisung und Antwortformat
# liegen fest in der Brücke, der Server reicht nichts anderes durch.
MAX_BRIEF_TEXT = 24000


def clean_brief_request(raw: dict) -> dict:
    if not isinstance(raw, dict):
        raise ValueError("Auftrag fehlt")
    user = raw.get("user")
    if not isinstance(user, str) or not user.strip():
        raise ValueError("Aufgabe für den Brief fehlt")
    out = {"user": user.strip()[:MAX_BRIEF_TEXT]}
    # 3.12: Sprache der Oberfläche — die Brücke schreibt die Notiz dann englisch statt deutsch
    if raw.get("ui_lang") in ("de", "en"):
        out["ui_lang"] = raw["ui_lang"]
    return out


BRIEF_LANE = {"brief", "settings", "export", "verify", "archiv", "loeschen", "web", "web_weg", "master_merken", "midi"}
NEW_KINDS = {"settings", "export", "verify", "cover", "nachruesten", "archiv", "loeschen", "web", "web_weg", "master_merken", "midi", "weiter"}
KIND_SINCE = {"loeschen": "3.6", "web": "3.10", "web_weg": "3.10", "master_merken": "3.12.3", "midi": "3.16", "weiter": "3.17"}     # ab welcher Brücke eine Art geht (für die Meldung)


def lane_of(kind: str) -> str:
    """Zwei Spuren: Briefe sind in Sekunden fertig und sollen nicht hinter
    minutenlangen Renderings warten — die Brücke holt sie auf einer eigenen Spur.
    Seit 3.2 auch Einstellungen, Export und Prüfen (schnell, ohne Grafikchip)."""
    return "brief" if kind in BRIEF_LANE else "render"


# ---- 3.2: Angaben zu einem Track der Bibliothek (Tags, Cover, Archiv auf dem Mac) ----
FORMATS = ("mp3", "flac", "alac", "wav", "aiff", "wavpack", "tta")
RATES = (0, 44100, 48000)
#         Die Brücke prüft ohnehin selbst, dass die Datei in IHREM renders/ liegt.
ARCHIVED_RE = re.compile(r"^(?:[^/\x00.][^/\x00]{0,59}/){1,3}renders/[^/\x00.][^/\x00]{0,39}/[^/\x00]{1,200}\.wav$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def clean_track(raw) -> dict:
    """Der Mac sucht den Track in SEINEM Archiv — der Pfad ist nur ein Hinweis, die Brücke
    prüft selbst, dass er in ~/NeonForge/renders liegt. Hier wird geklemmt, nicht vertraut."""
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
    if raw.get("source") == "eigen":
        out["source"] = "eigen"
    if not out.get("title"):
        raise ValueError("Titel fehlt")
    return out


WEITER_TRACKS = ("drums", "bass", "keyboard", "synth", "guitar", "strings", "percussion", "brass", "woodwinds", "fx", "backing_vocals")


def clean_weiter(raw) -> dict:
    """3.17: Loop-Maschine → Musik-KI. Nur bekannte Felder in ihren Grenzen (die Brücke prüft noch einmal)."""
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
        s = raw.get("set")
        if not isinstance(s, dict):
            return {}
        keep = {}
        for k in ("owner", "artist", "copyright", "album", "label", "website"):
            if isinstance(s.get(k), str):
                keep[k] = s[k].strip()[:200]
        for k in ("ai_note", "watermark", "cover", "cover_title", "cover_artist"):
            if isinstance(s.get(k), bool):
                keep[k] = s[k]
        return {"set": keep}
    if kind in ("verify", "archiv"):
        return {}
    if kind == "master_merken":
        # 3.12.3: Mastering-Regler je Archivpfad an den Mac — nur Zahlen in ihren Grenzen (die Brücke prüft noch einmal)
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
        # 3.16: MIDI-Abbilder abholen — nur Archivpfade in der erwarteten Form (die Brücke prüft selbst noch einmal)
        lst = (raw or {}).get("archived") if isinstance(raw, dict) else None
        keep = [a for a in (lst if isinstance(lst, list) else []) if isinstance(a, str) and ARCHIVED_RE.match(a) and ".." not in a]
        if not keep:
            raise ValueError("Keine Tracks")
        return {"archived": keep[:40]}
    if kind == "loeschen":
        # 3.6: nur Archivpfade in der erwarteten Form — die Brücke prüft selbst noch einmal, dass sie in renders/ liegen
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
        # 3.4: Bittiefe und Mastering-Regler — nur Zahlen in ihren Grenzen (die Brücke prüft noch einmal)
        out["bits"] = 16 if (raw or {}).get("bits") in (16, "16") else 24
        m = clean_master((raw or {}).get("master"))
        if m is not None:
            out["master"] = m
        # 3.9: Veröffentlichungspaket — nur bekannte Schalter (die Brücke prüft noch einmal)
        pk = (raw or {}).get("paket")
        if isinstance(pk, dict):
            out["paket"] = {"text_eigen": pk.get("text_eigen") is True}
    if kind == "web":
        # 3.10: Veröffentlichen — die Regler gehören dazu (die Seite bekommt die gemasterte Fassung)
        m = clean_master((raw or {}).get("master"))
        if m is not None:
            out["master"] = m
    if kind == "nachruesten":
        # bleibt seine Kopie, sonst ginge jeder Track (40 MB) noch einmal durch den Tunnel.
        out["audio"] = (raw or {}).get("audio") is True
    return out


MASTER_KEYS = {"bass": (-12, 12), "tone": (-6, 6), "treble": (-12, 12), "soft": (0, 8), "gain": (-24, 12),
               "fade_in": (0, 10), "fade_out": (0, 15), "start": (0, 3600), "end": (0, 3600)}


def clean_master(raw):
    if not isinstance(raw, dict):
        return None
    out = {}
    for k, (lo, hi) in MASTER_KEYS.items():
        v = raw.get(k)
        if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v):
            out[k] = max(lo, min(hi, float(v)))
    if raw.get("off") is True:
        out["off"] = True
    return out


def clean_meta(raw) -> dict:
    """Begleitinfos fürs Wiederfinden (Titel, Notiz des Produzenten, Gruppe)."""
    if not isinstance(raw, dict):
        return {}
    keep = {}
    for k, limit in (("title", 120), ("note", 2000), ("group", 40), ("variant", 4), ("source", 40)):
        v = raw.get(k)
        if isinstance(v, str) and v.strip():
            keep[k] = v.strip()[:limit]
    return keep


def clean_agent(raw: str) -> dict:
    """Was die Brücke über sich sagt (Kopfzeile x-nf-agent) — kurz und nur Bekanntes."""
    try:
        data = json.loads(urllib.parse.unquote(raw or "{}"))
    except Exception:
        return {}
    if not isinstance(data, dict):
        return {}
    keep = {}
    for k in ("host", "chip", "ram_gb", "lm", "mode", "engine", "version", "busy", "writer", "dits",
              "caps", "image"):
        v = data.get(k)
        if isinstance(v, (str, int, float, bool)):
            keep[k] = v if not isinstance(v, str) else v[:400 if k == "caps" else 80]
    return keep


class Broker:
    """Warteschlangen im Speicher, je Kopplung ein Namensraum (Hash des Schlüssels)."""

    def __init__(self):
        self.cv = threading.Condition()
        self.jobs: dict = {}          # id -> Auftrag
        self.bridges: dict = {}       # ns -> {"seen": t, "info": {...}}

    # ---- Hilfen -----------------------------------------------------------
    @staticmethod
    def ns_for(token: str):
        token = (token or "").strip()
        if not TOKEN_RE.match(token):
            return None
        return hashlib.sha256(token.encode()).hexdigest()[:32]

    def _sweep(self, now: float) -> None:
        """Alte Ergebnisse vergessen, verwaiste Läufe beenden, Speicher deckeln."""
        for jid, j in list(self.jobs.items()):
            if j["status"] in ("done", "error", "cancelled") and now - j["updated"] > RESULT_TTL:
                del self.jobs[jid]
            elif j["status"] == "running" and now - j["updated"] > RUNNING_STALE_S:
                j.update(status="error", message="Der Mac hat sich nicht mehr gemeldet.",
                         updated=now, upload=None)
            elif j["status"] == "queued" and now - j["created"] > QUEUED_TTL:
                j.update(status="error", message="Der Mac hat den Auftrag zwei Stunden nicht abgeholt.",
                         updated=now, upload=None)
        # Speicherbudget: älteste fertige Audios und Cover zuerst loslassen.
        # 🔴 3.2 (Audit): Cover zählten mit, wurden aber nie freigegeben — dann räumte jedes Aufräumen
        #    die Audios ALLER Kopplungen weg und kam trotzdem nie unters Budget.
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

    def bytes_held(self, ns: str = None) -> int:
        return sum(len(j.get("audio") or b"") + len(j.get("cover") or b"") + len(j.get("upload") or b"")
                   for j in self.jobs.values() if ns is None or j["ns"] == ns)

    @staticmethod
    def public(j: dict) -> dict:
        """Was der Browser über einen Auftrag erfährt — ohne Bytes."""
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
            # Ältestes Fertiges verdrängen, damit der Namensraum nicht volläuft
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
            j["cancel"] = True             # läuft er schon, erfährt es der Mac beim nächsten Lebenszeichen
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

    # ---- Mac-Brücke -------------------------------------------------------
    def next_for_bridge(self, ns: str, info: dict, wait: float, lane: str = "render"):
        deadline = time.time() + wait
        taker = str(info.get("host") or "?")
        with self.cv:
            # 🔑 Wer nach Arbeit fragt, arbeitet an nichts — die Brücke holt strikt einen
            #    diesem Mac, ist die Brücke dabei gestorben (Neustart, Schlaf, kill).
            #    einmal. Wirft er die Brücke ein zweites Mal um, ist er ein Fehler.
            now = time.time()
            for j in self.jobs.values():
                # 🔴 nur in DER Spur, die gerade fragt: die Brief-Spur arbeitet parallel zur
                #    Render-Spur, ihr Fragen sagt über einen laufenden Track nichts.
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
                # 🔴 3.2 (Audit): eine Brücke, die eine Art nicht kann, holte sie nie ab — der Auftrag
                #    wartete ewig und belegte einen Platz. Jetzt sagt er, woran es liegt.
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
        """3.13: Die Brücke meldet einen Auftrag wieder an, den sie gerade rechnet, den dieser Server aber nach einem
        Neustart nicht mehr kennt (die Warteschlange liegt nur im Speicher). Gleiche Kennung — der Browser fragt
        weiter nach ihr und bekommt das Ergebnis, als wäre nichts gewesen."""
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
                # 3.13: bis hier hieß unbekannt: abbrechen. Nach jedem Neustart dieses Servers starb so ein laufender
                #    Render mitten in der Rechnung. Jetzt meldet die Brücke ihn wieder an (adopt).
                return {"cancel": False, "unknown": True}
            if j["status"] == "running":
                j["message"] = (message or "")[:120]
                j["updated"] = now
            return {"cancel": bool(j["cancel"])}

    def set_cover(self, ns: str, jid: str, data: bytes = None, error: str = "") -> bool:
        """Das Cover kommt nach dem Track — darum auch an einen schon fertigen Auftrag."""
        with self.cv:
            j = self._bridge_job(ns, jid)
            if not j or j["status"] not in ("running", "done"):
                return False
            if data:
                j.update(cover=data, cover_state="done", cover_error=None)
            else:
                j.update(cover_state="failed", cover_error=(error or "kein Cover")[:200])
            # Ein fertiger Auftrag altert weiter (sonst hielte ein nachgereichtes Cover ihn ewig am Leben)
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


# ---- Kopplung per Code ------------------------------------------------------
#    unter dem man sie selbst geöffnet hat — ein Kopplungslink für die eine Adresse
#    ist unter einer anderen unsichtbar, und auf dem Handy ist sie ohnehin anders.
#    Darum: die Brücke bietet einen kurzen Code an, jedes Gerät tippt ihn ein.
#    Der Code lebt 10 Minuten im Speicher; Raten ist gedrosselt (31^6 ≈ 887 Mio.
#    Codes gegen 20 Versuche je 10 min).
#    Hinter Dockers Portweiterleitung sehen alle Absender gleich aus — die Drossel
#    wirkt dann für alle zusammen. Das ist strenger, nicht lockerer.
PAIR_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"   # ohne 0/O, 1/I/L
PAIR_TTL = 10 * 60
PAIR_TRIES = 20                                      # je Absender und Zeitfenster


class Pairing:
    def __init__(self):
        self.lock = threading.Lock()
        self.codes: dict = {}      # code -> (token, expires)
        self.tries: dict = {}      # ip -> [zeitpunkte]

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
        """Token zum Code — oder None. Drosselt je Absender."""
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

    def log_message(self, fmt, *args):  # ruhiger Log, Fehler stehen im Body
        pass

    def end_headers(self):
        # Statische Assets nie hart cachen: ``no-cache`` erzwingt eine Revalidierung,
        # sodass ein neuer Deploy garantiert frische index.html/app.js ausliefert und
        # der Browser keine alte Version (z. B. v1.0.0) festhält. JSON-Antworten setzen
        # ihren eigenen ``no-store``-Header (Flag ``_cc``) und werden hier übersprungen.
        if not getattr(self, "_cc", False):
            self.send_header("Cache-Control", "no-cache")
        self._cc = False
        super().end_headers()

    # ---- Helfer -----------------------------------------------------------
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
        # 🔴 3.2 (Audit): ohne Grenze las auch /api/pair/claim (ohne Schlüssel) jeden Körper in den Speicher
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
        """Rohe Bytes (Audio). None, wenn zu groß — dann wird gar nicht erst gelesen."""
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
        """Namensraum aus dem Kopplungsschlüssel — oder 401 und None."""
        ns = Broker.ns_for(self.headers.get("x-nf-bridge", ""))
        if not ns:
            self._json(401, {"error": "no_bridge",
                             "message": "Kein gültiger Kopplungsschlüssel — Mac-Brücke in den Einstellungen koppeln."})
        return ns

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
        if path in ("/bridge/neonforge_bridge.py", "/bridge/manuwave_bridge.py"):
            # Die Mac-Brücke gehört zur App und hat dieselbe Version — so holt der Mac
            # sich immer genau das Gegenstück zum laufenden Server.
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
        """Seit 2.2: wer die Startseite über eine alte http-Adresse im Browser öffnet, landet
        auf der https-Adresse (tailscale serve). Erkannt an X-Forwarded-Proto — den setzt
        tailscale serve NUR auf dem https-Weg (gemessen 10.10.2026), also keine Schleife.

        🔴 Ausnahme ?nf-umzug=1: das ist das Umzugsfenster, das die Daten von der ALTEN
           Adresse holt (web/umzug.js). Leitete es um, käme niemand mehr an sie heran.
        Nur Browser-Seiten (Accept: text/html), nie /api, nie die Brücke, nie vom Pi selbst.
        302 statt 301 — eine 301 merkt sich der Browser dauerhaft."""
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
            # Ohne Angabe: Render-Spur — eine Brücke von 2.0 kennt keine Briefe und bekommt keine.
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
        if path == "/api/pair/claim":
            # Ohne Schlüssel — genau dafür ist der Code da.
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
            # 3.2: Einstellungen, Export, Cover, Nachrüsten, Wasserzeichen prüfen.
            # Mit Datei: Rohdaten im Körper, die Angaben in x-nf-job (URL-kodiertes JSON).
            if path == "/api/job":
                data = self._read_body()
                upload = None
            else:
                try:
                    data = json.loads(urllib.parse.unquote(self.headers.get("x-nf-job", "") or "{}"))
                except Exception:      # auch RecursionError bei absurd verschachteltem JSON
                    data = {}
                if not isinstance(data, dict) or data.get("kind") not in ("verify", "export", "nachruesten", "weiter"):
                    self._json(400, {"error": "bad_request", "message": "Unbekannte Auftragsart."})
                    return
                upload = self._raw_body(MAX_AUDIO_BYTES)
                if upload is None:
                    self._json(413, {"error": "too_big", "message": "Datei fehlt oder ist größer als %d MB." % (MAX_AUDIO_BYTES // (1024 * 1024))})
                    return
            kind = data.get("kind") if isinstance(data, dict) else None
            if kind not in NEW_KINDS or (kind in ("verify", "weiter") and upload is None) \
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
            try:
                job = BROKER.submit(ns, "understand", {}, {"filename": name, "title": name}, upload=audio)
            except OverflowError as e:
                self._json(429, {"error": "busy", "message": str(e)})
                return
            self._json(200, job)
            return
        m = re.match(r"^/api/render/([0-9a-f]{16})/cancel$", path)
        if m:
            self._json(200, {"ok": BROKER.cancel(ns, m.group(1))})
            return
        # ---- Mac-Brücke ----
        m = re.match(r"^/api/bridge/adopt/([0-9a-f]{16})$", path)
        if m:
            data = self._read_body()
            kind = data.get("kind")
            try:
                if kind == "render":
                    req = clean_render_request(data.get("request"))
                elif kind == "brief":
                    req = clean_brief_request(data.get("request"))
                elif kind in NEW_KINDS and kind not in ("verify",):
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
        # result: Audio-Bytes (render, export), ZIP (3.9: Veröffentlichungspaket), JSON-Datei (3.16: MIDI-Abbilder,
        #         größer als ein JSON-Körper) oder JSON (understand, settings …)
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
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    with Server((HOST, PORT), Handler) as httpd:
        b = _build_info()
        print(f"Manuwave Studio v{b['version']} ({b['commit'] or '?'}, built {b['builtAt'] or 'local'}) "
              f"on :{PORT}", flush=True)
        httpd.serve_forever()
