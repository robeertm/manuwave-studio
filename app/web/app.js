import { MASTER_PRESETS, masterClean, masterKey, cutOf, autoEnd, masterDefault, decodeAudio, masterAudio } from "./mastering.js";
import { GENRE_GROUPS, familyOf, roughOf, tempoOf, composeIdea, randomGenre } from "./genres.js";
import { pickBox } from "./auswahl.js";
/* Manuwave Studio 3 — eine Musik-App, nur lokale KI.
 *
 * Produktions-Brief, die Musik-KI ACE-Step 1.5 rechnet ihn auf dem Mac. Weitergearbeitet
 * wird am aktuellen Track (ändern, neue Versionen, von Hand bearbeiten); alles Fertige
 * liegt in der Bibliothek. Kein Cloud-Dienst, kein API-Key.
 *
 * der Server hat kein Volume. Zusätzlich legt die Brücke jede Datei auf dem Mac ab.
 *
 * Seit 3.2 veredelt der Mac jeden Track: KI-Cover, Tags mit dem Copyright aus SEINEN
 * Einstellungen (⚙️ › Urheber & Rechte), unhörbares Wasserzeichen. Export als MP3 oder
 * verlustfrei erzeugt ebenfalls der Mac — der Browser gibt nie eine unveredelte Datei heraus.
 * Ältere Tracks werden im Hintergrund nachgerüstet; was nur auf dem Mac liegt, holt
 * coverState, wm (Kennung des Wasserzeichens), finishFail — IndexedDB bleibt Version 1.
 */

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const el = (t, cls, txt) => { const e = document.createElement(t); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

// Speicher-Namen seit 2.0 — bleiben, damit Brief, laufende Aufträge und Kopplung erhalten sind.
const LS_BRIDGE = "nf_bridge";            // Kopplungsschlüssel (die Berechtigung für den Mac)
const LS_PENDING = "nf_master_pending";   // laufende Aufträge — überleben ein Neuladen
const LS_BRIEF = "nf_master_brief";       // aktueller Brief
const LS_FORM = "nf_form";
const LS_OLD_KEY = "nf_api_key";          // Claude-Key aus 1.x/2.x — wird nicht mehr benutzt
const LETTERS = "ABCDEFGH";

// 3.8: Richtungen (~110 in Gruppen) und der Würfel stehen in genres.js.
const LS_GENRE_TAB = "nf_genre_tab";     // zuletzt offene Gruppe der Richtungen

// (APG) — so rechnet der Modellserver es in seinem eigenen Vergleich mit dem Python-Original
const QUALITY = {
  studio: { guidance_scale: 7.0 },
  max: { guidance_scale: 7.0, inference_steps: 80 },
  schnell: { guidance_scale: 1.0 },
};

const VOCAL_TEXT = {
  none: "Instrumental — kein Gesang.",
  female: "Mit Gesang, weibliche Stimme.",
  male: "Mit Gesang, männliche Stimme.",
  chops: "Instrumental mit Vocal-Chops (kurze Silben/Ad-libs, kein durchgehender Text).",
};
const VOCAL_TAG = { none: "instrumental", female: "female vocals", male: "male vocals", chops: "vocal chops" };
const LANG_NAMES = { de: "Deutsch", en: "Englisch", es: "Spanisch", fr: "Französisch", it: "Italienisch" };

// 3.2: Export — die Datei erzeugt der Mac (mit Cover, Tags, Wasserzeichen). Verlustfrei ist alles
// außer MP3. APE, WMA Lossless, OptimFROG und TAK fehlen, weil es auf dem Mac keinen Kodierer dafür gibt.
// 🔑 3.2.3: `apple` = was Apple-Geräte (Musik, QuickTime, Finder, iPhone) damit zeigen — gemessen mit
//    AVFoundation und der Finder-Vorschau: bei FLAC steckt das Cover drin, Apple liest dort aber nur die
//    Textkommentare; WavPack und TTA spielt Apple gar nicht ab.
const EXPORT_FORMATS = [
  { id: "mp3", name: "MP3", hint: "320 kbit/s — läuft überall, Cover überall sichtbar", lossless: false, apple: "cover" },
  { id: "flac", name: "FLAC", hint: "Standard für verlustfrei, Archiv und Vertrieb · Apple zeigt kein Cover", lossless: true, apple: "nocover" },
  { id: "alac", name: "Apple Lossless (ALAC)", hint: ".m4a — verlustfrei mit Cover in Musik, Finder, iPhone", lossless: true, apple: "cover" },
  { id: "wav", name: "WAV", hint: "unkomprimiert — DAWs, Vertrieb", lossless: true, apple: "cover" },
  { id: "aiff", name: "AIFF", hint: "unkomprimiert, mit Cover", lossless: true, apple: "cover" },
  { id: "wavpack", name: "WavPack", hint: ".wv — verlustfrei, klein · nicht auf Apple-Geräten", lossless: true, apple: "noplay" },
  { id: "tta", name: "TTA (True Audio)", hint: ".tta — verlustfrei · nicht auf Apple-Geräten", lossless: true, apple: "noplay" },
];
const APPLE_NOTE = {
  nocover: "Das Cover steckt in der Datei — aber Musik, QuickTime, Finder und iPhone zeigen bei FLAC grundsätzlich kein Cover, Apple liest dort nur Textkommentare. VLC, foobar2000, Plex, Navidrome und Android-Player zeigen es.",
  noplay: "Apple-Geräte spielen dieses Format nicht ab. Cover und Tags stehen trotzdem drin — für VLC, foobar2000 und andere.",
};
const LS_EXPORT = "nf_export";            // zuletzt gewähltes Format + Abtastrate
const LS_COVERWATCH = "nf_cover_watch";   // Tracks, deren Cover noch unterwegs ist
const LS_RIGHTS = "nf_rights";            // zuletzt vom Mac gelesene Urheberangaben (nur zur Anzeige)
const LS_FINISH_OFF = "nf_finish_off";    // Nachrüsten angehalten

const state = {
  brief: null,          // aktueller Produktions-Brief
  refs: [],
  pending: [],          // [{id, title, variant, group, created, status, message}]
  bridge: { connected: false, info: {} },
  view: "all",          // Bibliothek: "all" | "fav" | "none" | Ordner-id
  sel: new Set(),       // ausgewählte Tracks (nur sichtbare)
  lastSel: null,        // für Umschalt-Klick
  fresh: new Set(),     // in dieser Sitzung angekommen, noch nicht gehört
  pollTimer: null,
  busy: false,
  rights: null,         // Urheberangaben vom Mac (3.2)
  tools: null,          // Werkzeuge auf dem Mac (ffmpeg, audiowmark, Bildmodell)
  finishing: null,      // id des Tracks, der gerade nachgerüstet wird
  finishTimer: null,
  macOnly: [],          // Tracks, die nur im Archiv des Macs liegen
  macBetter: [],        // 3.5: Tracks, die der Mac inzwischen besser hat (aufbereitet)
};

// =============================================================================
// Kopplung mit dem Mac
// =============================================================================
function bridgeToken() { return localStorage.getItem(LS_BRIDGE) || ""; }
function setBridgeToken(t) {
  if (t) localStorage.setItem(LS_BRIDGE, t); else localStorage.removeItem(LS_BRIDGE);
  refreshBridge();
}
function takeTokenFromHash() {
  const m = (location.hash || "").match(/bridge=([A-Za-z0-9_-]{24,128})/);
  if (!m) return;
  setBridgeToken(m[1]);
  // Schlüssel sofort wieder aus der Adresszeile — er soll nicht im Verlauf stehen bleiben
  history.replaceState(null, "", location.pathname + location.search);
}

async function api(path, { method = "GET", body, raw, ctype, headers = {} } = {}) {
  const h = { ...headers };
  const t = bridgeToken();
  if (t) h["x-nf-bridge"] = t;
  let data;
  if (body !== undefined) { h["Content-Type"] = "application/json"; data = JSON.stringify(body); }
  if (raw !== undefined) { h["Content-Type"] = ctype || "application/octet-stream"; data = raw; }
  const res = await fetch(path, { method, headers: h, body: data, cache: "no-store" });
  const ct = res.headers.get("Content-Type") || "";
  const out = ct.startsWith("application/json") ? await res.json().catch(() => ({})) : null;
  return { ok: res.ok, status: res.status, data: out, res };
}

function macWriter() { return (state.bridge.connected && (state.bridge.info || {}).writer) || ""; }

// ---- 3.2: Aufträge an den Mac (Einstellungen, Export, Cover, Nachrüsten, Prüfen) ----
// Eine Brücke bekommt nur Arten, die sie kennt — darum vorher fragen, sonst wartete der Auftrag ewig.
function macCan(kind) {
  return !!state.bridge.connected && String((state.bridge.info || {}).caps || "").split(",").includes(kind);
}
async function macJob(kind, request, { upload, filename, meta, onMsg, pollMs = 700, timeoutMs = 0 } = {}) {
  const r = upload
    ? await api("/api/job/upload", { method: "POST", raw: upload, headers: { "x-nf-job": encodeURIComponent(JSON.stringify({ kind, request, meta, filename })) } })
    : await api("/api/job", { method: "POST", body: { kind, request, meta } });
  if (!r.ok) throw new Error((r.data && r.data.message) || "HTTP " + r.status);
  const id = r.data.id, t0 = Date.now();
  let missSince = 0;
  for (;;) {
    await sleep(pollMs);
    let g;
    try { g = await api("/api/render/" + id); } catch (e) { continue; }
    // 3.13: Server neu gestartet → der Mac meldet den Auftrag gleich wieder an; erst nach der Frist aufgeben
    if (g.status === 404) {
      missSince = missSince || Date.now();
      if (Date.now() - missSince < LOST_GRACE_MS) { if (onMsg) onMsg({ status: "running", message: "Server startet neu — dein Mac arbeitet weiter …" }); continue; }
      throw new Error("Auftrag verloren (Server neu gestartet?) — bitte noch einmal.");
    }
    missSince = 0;
    const j = g.data || {};
    if (onMsg) onMsg(j);
    if (j.status === "done") return j;
    if (j.status === "error" || j.status === "cancelled") {
      const e = new Error(j.message || "Fehler auf dem Mac");
      if (/^ARCHIV_FEHLT/.test(j.message || "")) e.code = "archiv";
      throw e;
    }
    if (timeoutMs && Date.now() - t0 > timeoutMs) {
      api(`/api/render/${id}/cancel`, { method: "POST" }).catch(() => {});
      throw new Error("Der Mac antwortet nicht.");
    }
  }
}
// Was der Mac über einen Track wissen muss: wo er im Archiv liegt, und alles für Tags und Cover.
function trackInfo(rec) {
  const q = rec.request || {}, r = rec.result || {};
  const seed = r.seed != null ? r.seed : q.seed;
  return { archived: r.archived || "", title: rec.title || "Track", variant: rec.variant || "", note: rec.note || "",
    caption: r.caption || q.caption || "", lyrics: q.lyrics || "", bpm: r.bpm || q.bpm || 0,
    keyscale: r.keyscale || q.keyscale || "", seed: seed != null ? seed : -1,
    created: localDay(rec.created || Date.now()), ...(rec.source === "eigen" ? { source: "eigen" } : {}) };
}
// 🔴 Audit 3.2: toISOString() ist UTC — ein Track von 00:30 Uhr wäre einen Tag zu früh datiert.
function localDay(t) { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
// Hat der Mac den Track nicht (mehr) im Archiv, schickt der Browser ihn beim zweiten Versuch mit.
async function macJobTrack(kind, rec, extra = {}, opts = {}) {
  const req = { ...trackInfo(rec), ...extra };
  try { return await macJob(kind, req, opts); }
  catch (e) {
    if (e.code !== "archiv" || !rec.blob || !["export", "nachruesten", "web"].includes(kind)) throw e;
    const cur = (await freshRec(rec.id)) || rec;   // 3.5.1: frisch und lesbar — ein altes Blob kann in Safari tot sein
    return await macJob(kind, req, { ...opts, upload: cur.blob || rec.blob });
  }
}
// Ein Archivpfad vom Mac gilt nur in der erwarteten Form — nie einen kaputten über einen guten schreiben
const goodArchived = (a) => typeof a === "string" && /^(?:[^/.][^/]{0,59}\/){1,3}renders\/[^/.][^/]*\/[^/]+\.wav$/.test(a);
async function fetchBlob(url) {
  const res = await fetch(url, { headers: { "x-nf-bridge": bridgeToken() }, cache: "no-store" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.blob();
}

//    (kein Neuladen: das unterbräche Spielen in Instrumente/Loops nach jedem Neustart des Servers).
async function serverAlive() {
  try { const r = await fetch("/version", { cache: "no-store" }); await r.text(); return r.ok; } catch (e) { return false; }
}
async function refreshBridge() {
  const alive = await serverAlive();
  if (!alive) {
    state.serverDown = true; state.bridge = { connected: false, info: {} };
    renderBridge();
    return;
  }
  state.serverDown = false;
  if (bridgeToken()) {
    try {
      const r = await api("/api/bridge/status");
      if (r.status === 401) { localStorage.removeItem(LS_BRIDGE); state.bridge = { connected: false, info: {} }; }
      else state.bridge = r.data || { connected: false, info: {} };
    } catch (e) { state.bridge = { connected: false, info: {} }; }
  } else state.bridge = { connected: false, info: {} };
  renderBridge();
  // 3.2: sobald der Mac (mit 3.2-Brücke) da ist — einmal Urheberangaben und Archiv lesen
  if (macCan("settings") && !state.rightsAsked) { state.rightsAsked = true; macJob("settings", {}, { timeoutMs: 45000 }).then(j => applySettings(j.result)).catch(() => { state.rightsAsked = false; }); }
  if (macCan("archiv") && !state.archivAsked) { state.archivAsked = true; checkMacOnly(); }
  if (macCan("midi") && !state.midiAsked) { state.midiAsked = true; setTimeout(syncMidi, 4000); }   // 3.16
  // 3.6: was gelöscht wurde, während der Mac weg war — jetzt nachholen (alle 10 s geprüft, läuft nur einmal gleichzeitig)
  else if (macCan("loeschen") && delPending().length) flushMacDeletes(true).then(checkMacOnly);
  scheduleFinish(state.finishing ? 5000 : 1500);
}

function renderBridge() {
  const pill = $("#macPill");
  const i = state.bridge.info || {};
  const paired = !!bridgeToken();
  $("#pairNote").classList.toggle("hidden", paired || !!state.serverDown);
  $("#downNote").classList.toggle("hidden", !state.serverDown);
  if (state.serverDown) {
    pill.textContent = "🔴 App antwortet nicht"; pill.className = "pill down";
    pill.title = "Manuwave Studio läuft gerade nicht — das Startfenster wieder öffnen.";
  }
  else if (!paired) { pill.textContent = "🔌 Mac koppeln"; pill.className = "pill warn"; pill.title = "Einstellungen › Mac"; }
  else if (state.bridge.connected) {
    const chip = (i.chip || "Mac").replace(/^Apple /, "");
    pill.textContent = `🟢 ${chip} bereit`;
    pill.className = "pill ok";
    pill.title = `${i.host || "Mac"} · Brief: ${i.writer || "kein Sprachmodell"} · Musik: ACE-Step 1.5 (${i.lm || "?"})`;
  } else {
    pill.textContent = "⚪ Mac schläft";
    pill.className = "pill";
    pill.title = "Gekoppelt, aber der Mac meldet sich gerade nicht — Aufträge warten auf ihn.";
  }
  const t = $("#macText");
  if (!paired) t.innerHTML = "Noch nicht gekoppelt. Auf dem Mac einmal die Brücke einrichten (siehe unten), dann den angezeigten <b>Code</b> hier eingeben.";
  else if (state.bridge.connected) t.innerHTML =
    `✅ <b>Verbunden</b> mit ${esc(i.host || "dem Mac")} — ${esc(i.chip || "")}, ${esc(String(i.ram_gb || "?"))} GB.<br>` +
    `✍️ Brief: ${i.writer ? `<b>${esc(i.writer)}</b> (Ollama)` : "<b>kein Sprachmodell</b> — Manuwave Studio baut den Brief dann aus deinen Angaben, die Musik-KI schreibt den Text"}<br>` +
    `🎵 Musik: <b>ACE-Step 1.5</b>, Sprachmodell ${esc(i.lm || "?")}, Modus ${esc(i.mode || "?")}.`;
  else t.innerHTML = "🟡 Gekoppelt, aber der Mac meldet sich gerade nicht (schläft? Dienst aus?). Aufträge warten, bis er wieder da ist.";
  $("#unpairBtn").hidden = !paired;
  // 3.26: Ordner und Brücke so, wie sie auf DIESEM Rechner heißen (Kunden: ~/ManuwaveStudio)
  if (i.home) $("#rendersDir").textContent = i.home.replace(/\\$/, "") + (i.home.includes("\\") ? "\\renders" : "/renders");
  if (i.script) $("#pairCmd").textContent = `${/\\/.test(i.script) ? "python" : "/usr/bin/python3"} ${i.script} --pair`;
  $("#setupCmd").textContent =
    `curl -fsSL ${location.origin}/bridge/neonforge_bridge.py -o ~/neonforge_bridge.py && /usr/bin/python3 ~/neonforge_bridge.py --server ${location.origin} --install`;
  $("#oldKeyBox").classList.toggle("hidden", localStorage.getItem(LS_OLD_KEY) == null);
  const dits = String(i.dits || "").split(",").filter(Boolean);
  const wrap = $("#ditWrap");
  const had = !wrap.hidden;
  wrap.hidden = !(dits.includes("xl-sft") && dits.includes("sft"));
  if (wrap.hidden !== !had) renderEstimate();
  if (!wrap.hidden && !had) {
    // Nur das Klangmodell aus den gemerkten Eingaben — nie das Ideenfeld, in das vielleicht gerade getippt wird.
    try { const f = JSON.parse(localStorage.getItem(LS_FORM) || "null"); if (f && [...$("#dit").options].some(x => x.value === f.dit)) $("#dit").value = f.dit; } catch (e) {}
  }
}

async function claimCode() {
  const code = $("#pairCode").value.trim();
  const s = $("#pairMsg");
  if (!code) return setMsg(s, "Code eingeben (z. B. KRB-DMQ).", "err");
  setMsg(s, "koppele …", "busy");
  const r = await api("/api/pair/claim", { method: "POST", body: { code } });
  if (r.ok && r.data && r.data.token) {
    setBridgeToken(r.data.token);
    $("#pairCode").value = "";
    setMsg(s, "✓ gekoppelt", "ok");
    if (/koppeln/.test($("#goMsg").dataset.msg || "")) setMsg($("#goMsg"), "", "");
    loadPending();
  } else setMsg(s, "✗ " + ((r.data && r.data.message) || "Code unbekannt"), "err");
}

function openSettings() { refreshBridge().then(loadRights); $("#settings").classList.remove("hidden"); }
function closeSettings() {
  if ($("#settings").classList.contains("hidden")) return;
  $("#settings").classList.add("hidden");
  if (rightsDirty()) autoSaveRights();        // beim Schließen nichts liegen lassen
}

// =============================================================================
// =============================================================================
function segValue(id) { const b = $(`#${id} button.on`); return b ? b.dataset.v : ""; }
function setSeg(id, v) { $$(`#${id} button`).forEach(b => b.classList.toggle("on", b.dataset.v === String(v))); }

function form() {
  return {
    idea: $("#idea").value.trim(),
    genres: $$("#genres .chip.on").map(c => c.dataset.n),     // 3.12: Name aus data-n — die Anzeige kann übersetzt sein
    vocals: segValue("vocals") || "none",
    lang: $("#lang").value,
    duration: +$("#dur").value,
    variants: Math.max(1, Math.min(4, +segValue("variants") || 1)),
    mood: $("#mood").value,
    moodLabel: $("#mood").selectedOptions[0] ? $("#mood").selectedOptions[0].textContent : "",
    bpm: +$("#bpm").value || 0,
    key: $("#key").value.trim(),
    quality: $("#quality").value,
    dit: $("#dit").value,
    smoothEnd: $("#smoothEnd").checked,
    qaReroll: $("#qaReroll").value,
  };
}
const sung = (v) => v === "female" || v === "male";

function saveForm() {
  const f = form();
  try { localStorage.setItem(LS_FORM, JSON.stringify(f)); } catch (e) {}
}
function restoreForm() {
  let f;
  try { f = JSON.parse(localStorage.getItem(LS_FORM) || "null"); } catch (e) {}
  if (!f) return;
  $("#idea").value = f.idea || "";
  $$("#genres .chip").forEach(c => c.classList.toggle("on", (f.genres || []).includes(c.dataset.n)));
  if (VOCAL_TAG[f.vocals]) setSeg("vocals", f.vocals);
  if (LANG_NAMES[f.lang]) $("#lang").value = f.lang;
  if (f.duration) $("#dur").value = f.duration;
  if (f.variants) setSeg("variants", f.variants);
  if ([...$("#mood").options].some(o => o.value === f.mood)) $("#mood").value = f.mood;
  if (f.bpm) $("#bpm").value = f.bpm;
  $("#key").value = f.key || "";
  if (QUALITY[f.quality]) $("#quality").value = f.quality;
  if ([...$("#dit").options].some(x => x.value === f.dit)) $("#dit").value = f.dit;
  if (typeof f.smoothEnd === "boolean") $("#smoothEnd").checked = f.smoothEnd;
  if (["0", "1", "2"].includes(f.qaReroll)) $("#qaReroll").value = f.qaReroll;
}

// =============================================================================
// Der Brief — geschrieben vom Sprachmodell auf dem Mac
// =============================================================================
// Gerüst fertig vorgegeben und füllt nur noch aus (gemessen in 2.1).
function skeleton(o) {
  const d = o.duration;
  let s;
  // 3.1: weniger Abschnitte je Länge. Bis 3.0 (z. B. 12 Abschnitte in 215 s) hatte die Musik-KI
  // keine Zeit mehr fürs Outro und brach ab — gemessen bei 7 von 13 Tracks ein harter Schnitt.
  // 3.14: über 4,5 min mehr Abschnitte — die Brücke verteilt sie auf Hauptteil und Anbauten
  const lang = d > 270;
  if (sung(o.vocals)) {
    s = d <= 45 ? ["Intro", "Chorus", "Outro"]
      : d < 150 ? ["Intro", "Verse 1", "Chorus", "Verse 2", "Chorus", "Outro"]
      : lang ? ["Intro", "Verse 1", "Chorus", "Verse 2", "Chorus", "Bridge", "Verse 3", "Chorus", "Chorus", "Outro"]
      : ["Intro", "Verse 1", "Chorus", "Verse 2", "Chorus", "Bridge", "Chorus", "Outro"];
  } else {
    // 3.8: Ohne Gesang richtet sich das Gerüst nach der Bauform der Richtung — ein Jazz-Stück
    const fam = familyOf(o.genres);
    s = fam === "song"
      ? (d <= 45 ? ["Intro", "Chorus", "Outro"]
        : d < 150 ? ["Intro", "Verse", "Chorus", "Solo", "Chorus", "Outro"]
        : lang ? ["Intro", "Verse 1", "Chorus", "Verse 2", "Chorus", "Solo", "Verse 3", "Chorus", "Outro"]
        : ["Intro", "Verse 1", "Chorus", "Verse 2", "Chorus", "Solo", "Outro"])
      : fam === "flow"
      ? (d <= 45 ? ["Intro", "Theme", "Outro"]
        : d < 150 ? ["Intro", "Theme", "Development", "Climax", "Outro"]
        : lang ? ["Intro", "Theme", "Development", "Interlude", "Theme 2", "Development 2", "Climax", "Outro"]
        : ["Intro", "Theme", "Development", "Interlude", "Climax", "Outro"])
      : (d <= 45 ? ["Intro", "Drop", "Outro"]
        : d < 150 ? ["Intro", "Build", "Drop", "Breakdown", "Drop 2", "Outro"]
        : lang ? ["Intro", "Build", "Drop", "Breakdown", "Build 2", "Drop 2", "Breakdown 2", "Build 3", "Drop 3", "Outro"]
        : ["Intro", "Build", "Drop", "Breakdown", "Build 2", "Drop 2", "Outro"]);
  }
  return s;
}
function skeletonText(o) {
  return skeleton(o).map(m => {
    const voc = sung(o.vocals) ? /^(Verse|Pre-Chorus|Chorus|Bridge)/.test(m) : (o.vocals === "chops" && /^(Drop|Chorus|Climax)/.test(m));
    return `[${m}] (${voc ? (sung(o.vocals) ? "Gesang" : "Vocal-Chops") : "instrumental"})`;
  }).join(", ");
}

function optionLines(o) {
  return [
    `Gesang: ${VOCAL_TEXT[o.vocals] || VOCAL_TEXT.none}`,
    sung(o.vocals) ? `Sprache des Textes: ${LANG_NAMES[o.lang] || o.lang} — ALLE Textzeilen in dieser Sprache.` : "",
    `Länge: ${o.duration} Sekunden`,
  ].filter(Boolean);
}

// 3.24: Aus deinen Songs — was der Mac gemessen hat, geht als Vorbild in den Auftrag an das Sprachmodell.
// 🔑 Kein Dateiname (Künstler/Titel), kein Liedtext, keine Melodie: ein NEUER Song im Charakter der Vorbilder.
const KEY_DE = { major: "Dur", minor: "Moll" };
function refsDone() { return state.refs.filter(r => r.status === "done" && r.result); }
function refTempos() { return refsDone().map(r => (r.result.measure || {}).bpm).filter(x => x > 0); }
// gemessene Tempi liegen nah beieinander (±6 %) → eines davon wird bestellt; sonst plant das Sprachmodell
function refTempo() {
  const t = refTempos().sort((a, b) => a - b), n = t.length;
  if (!n || t[n - 1] / t[0] > 1.12) return 0;
  return Math.round(n % 2 ? t[(n - 1) / 2] : (t[n / 2 - 1] + t[n / 2]) / 2);      // Median (bei zwei: Mitte)
}
function refMeter(a) { return a && (a.timesignature === "3" || a.timesignature === "6") ? `${a.timesignature}/${a.timesignature === "6" ? 8 : 4}` : ""; }
function refLang(a, m) { return a && a.vocal_language && m && m.vocals === "viel" ? a.vocal_language : ""; }
function refKey() {
  const ks = refsDone().map(r => (r.result.measure || {}).key).filter(k => k && !k.alt);
  if (!ks.length || ks.length !== refsDone().length) return "";
  const k0 = ks[0];
  return ks.every(k => k.root === k0.root && k.mode === k0.mode) ? `${k0.name} ${k0.mode}` : "";
}
function vorbildLines() {
  const done = refsDone();
  if (!done.length) return [];
  const out = [`Vorbilder (${done.length} Song${done.length > 1 ? "s" : ""}, vom Mac analysiert) — triff ihren gemeinsamen Charakter, aber schreibe einen NEUEN, eigenständigen Song: keine Melodie, keinen Text, keinen markanten Riff und keinen Titel übernehmen, keine Künstlernamen in den Brief.`];
  done.forEach((r, i) => {
    const a = r.result.ace || {}, m = r.result.measure || {};
    const p = [];
    if (a.caption) p.push(`Stil: ${a.caption}`);
    if (m.bpm) p.push(`gemessen ${m.bpm} BPM`);
    if (m.key) p.push(`Tonart ${m.key.name} ${m.key.mode}${m.key.alt ? ` (oder ${m.key.alt.name} ${m.key.alt.mode})` : ""}`);
    if (refMeter(a)) p.push(`Takt ${refMeter(a)}`);
    if (m.vocals) p.push(`Gesang ${m.vocals === "kaum" ? "kaum oder keiner" : m.vocals}${refLang(a, m) ? ` (${refLang(a, m)})` : ""}`);
    if (m.stems) p.push(`Anteile Drums ${m.stems.drums} %, Bass ${m.stems.bass} %, Gesang ${m.stems.vocals} %, Rest ${m.stems.other} %`);
    if (m.groove) p.push(m.groove.four_on_floor ? "Kick auf jedem Schlag (four-on-the-floor)" : m.groove.backbeat > 0.5 ? "Kick und Snare im Wechsel (Backbeat)" : "gebrochener Rhythmus");
    if (m.colour) p.push(`Klang ${m.colour}, Dynamik ${m.dynamics_db} dB`);
    if (m.chords && m.chords.names) p.push(`Akkordfolge ${m.chords.names.join("–")} (${m.chords.roman.join("–")}), je etwa ${m.chords.bars_per_chord} Takt(e)`);
    if (m.sections && m.sections.length) p.push(`Aufbau ${m.sections.map(x => `${x.label} ${x.energy} ${fmtMin(x.start)}–${fmtMin(x.end)}`).join(" · ")}`);
    out.push(`Vorbild ${i + 1}: ${p.join("; ")}`);
  });
  const bpm = refTempo();
  out.push(bpm ? `Tempo: ${bpm} BPM (gemessen, die Vorbilder liegen beieinander).` : `Tempo: im Bereich der Vorbilder (${refTempos().map(Math.round).join(", ")} BPM) passend wählen.`);
  return out;
}
function fmtMin(s) { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }

function createTask(o) {
  const lines = [];
  if (o.idea) lines.push(`Idee: ${o.idea}`);
  if (o.genres.length) lines.push(`Genre: ${o.genres.join(", ")}`);
  if (o.mood) lines.push(`Stimmung: ${o.moodLabel} (${o.mood})`);
  if (o.bpm) lines.push(`BPM: ${o.bpm}`);
  else if (o.genres.length) { const t = tempoOf(o.genres); if (t) lines.push(`Üblicher Tempobereich der Richtung: ${t[0]}–${t[1]} BPM`); }
  if (o.key) lines.push(`Tonart: ${o.key}`);
  if (roughOf(o.genres)) lines.push("Klangcharakter: rau und verzerrt ist bei dieser Richtung gewollt (verzerrte Gitarren bzw. Bässe).");
  if (!o.idea && !o.genres.length) lines.unshift(refsDone().length ? "Ein neuer Song aus den Vorbildern unten." : "Produziere einen mitreißenden elektronischen Track.");
  return [...lines, ...optionLines(o), ...vorbildLines(), `Gerüst (genau diese Abschnitte): ${skeletonText(o)}`].join("\n");
}

function refineTask(b, wish) {
  const markers = (b.lyrics.match(/^\[[^\]]+\]/gm) || []).join(", ");
  return `Aktueller Produktions-Brief:\n${JSON.stringify(briefCore(b))}\n\nÄnderungswunsch: ${wish}\n\n` +
    `Schreib den KOMPLETTEN Brief neu. Behalte, was gut ist, ändere gezielt. ` +
    `Gerüst: ${markers || "wie bisher"} — ändere es nur, wenn der Wunsch das verlangt. ` +
    `Textzeilen in der Sprache "${b.vocal_language || "en"}".`;
}

// Was der Nutzer ausdrücklich gewählt hat, gilt — ein kleines Modell vergisst es gern
function enforceChoices(b, o) {
  const VOC = /^(instrumental|female vocals?|male vocals?|vocals?|vocal chops)$/i;
  //    stehen, und die Musik-KI hätte womöglich gesungen. Jetzt: ohne Gesang fällt JEDER Stimm-Tag weg,
  //    vocals", bleiben — die machen die Stimme natürlicher, 3.1).
  const VOICE = /vocal|voice|singer|singing|choir|a ?cappella|\brap\b|spoken word/i;
  const other = o.vocals === "female" ? /\bmale\b|\bman\b|baritone|bass voice/i : /\bfemale\b|\bwoman\b|soprano/i;
  const tags = b.caption.split(",").map(t => t.trim()).filter(t => t && !VOC.test(t)
    && !(VOICE.test(t) && (!sung(o.vocals) || other.test(t))));
  tags.push(VOCAL_TAG[o.vocals] || "instrumental");
  // 3.8: Das kleine Modell kopiert Club-Grooves aus seinen Beispielen auch in Bossa Nova oder Jazz
  const keep = familyOf(o.genres) === "club" ? tags : tags.filter(t => !/four[- ]on[- ]the[- ]floor|rolling 16th/i.test(t));
  b.caption = keep.join(", ");
  b.vocal_language = sung(o.vocals) ? o.lang : "en";
  if (o.bpm) b.bpm = Math.round(Math.min(200, Math.max(60, o.bpm)));
  if (o.key) b.keyscale = o.key.slice(0, 24);
  b.duration = o.duration;
  return b;
}

// Ohne Sprachmodell (Ollama aus, Mac-Modell fehlt): der Brief entsteht aus den Angaben —
// so wie der Music Generator es macht (Stil + Idee wörtlich). Gesang mit Text geht so NICHT:
function templateBrief(o, why) {
  if (sung(o.vocals)) {
    throw new Error(`Gesang mit Text braucht das Sprachmodell auf dem Mac — ${why}. ` +
      "Starte Ollama auf dem Mac oder wähle Instrumental bzw. Vocal-Chops.");
  }
  const tags = [...o.genres.map(g => g.toLowerCase()), ...(o.mood ? o.mood.split(", ") : [])];
  refsDone().forEach(r => { if ((r.result.ace || {}).caption) tags.push(r.result.ace.caption); });
  tags.push(VOCAL_TAG[o.vocals] || "instrumental");
  if (o.idea) tags.push(o.idea);
  const words = (o.idea || o.genres[0] || "Neuer Track").split(/\s+/).slice(0, 4).join(" ");
  return normalizeBrief({
    title: words.replace(/[„“"]/g, "").slice(0, 40), caption: tags.join(", "), lyrics: skeleton(o).map(m => `[${m}]`).join("\n\n"),
    // 🔴 Tempo/Tonart der Referenz-Analyse NICHT festschreiben: gemessen schätzt sie halbes
    //    oder Zwei-Drittel-Tempo (64 statt 128, 83 statt 124 BPM). Ohne Angabe plant die Musik-KI selbst.
    bpm: o.bpm || 0, keyscale: o.key || "",
    duration: o.duration, vocal_language: sung(o.vocals) ? o.lang : "en", note: "",
    by: { who: "vorlage", why },
  });
}

// Ein Brief-Auftrag an den Mac. Wirft, wenn der Mac ihn nicht schreiben kann.
async function callMacWriter(task, say) {
  const r = await api("/api/brief", { method: "POST", body: { request: { user: task, ui_lang: window.MWS_LANG || "de" }, meta: { title: "Brief" } } });
  if (!r.ok) throw new Error((r.data && r.data.message) || `Fehler ${r.status}`);
  const id = r.data.id, t0 = Date.now();
  while (true) {
    await sleep(700);
    const s = await api("/api/render/" + id);
    const j = s.data || {};
    if (j.status === "done" && j.result) return j.result;
    if (j.status === "error" || j.status === "cancelled") throw new Error(j.message || j.status);
    const waited = (Date.now() - t0) / 1000;
    say(`✍️ Dein Mac schreibt den Brief (${macWriter() || "Sprachmodell"}) … ${Math.round(waited)} s`);
    if ((j.status === "queued" && waited > 20) || waited > 240) {
      api(`/api/render/${id}/cancel`, { method: "POST" }).catch(() => {});
      throw new Error(j.status === "queued" ? "der Mac holt den Auftrag nicht ab" : "der Mac braucht zu lange");
    }
  }
}

// Ein Brief geht an einen Rechner, der Minuten rechnet: geklemmt und ergänzt, nicht vertraut.
function normalizeBrief(b) {
  const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.min(hi, Math.max(lo, n)) : d; };
  return {
    title: String(b.title || "Ohne Titel").trim().slice(0, 80) || "Ohne Titel",
    caption: String(b.caption || "").trim().slice(0, 1200),
    lyrics: (String(b.lyrics || "").trim() || "[Intro]\n\n[Drop]\n\n[Outro]").slice(0, 6000),
    bpm: Math.round(num(b.bpm, 60, 200, 0)),
    keyscale: String(b.keyscale || "").trim().slice(0, 24),
    timesignature: ["4", "3", "6"].includes(String(b.timesignature)) ? String(b.timesignature) : "4",
    duration: Math.round(num(b.duration, 15, 600, 120)),
    vocal_language: String(b.vocal_language || "en").slice(0, 12),
    note: String(b.note || "").trim().slice(0, 1500),
    seeds: Array.isArray(b.seeds) ? b.seeds.slice(0, 8) : [],
    by: b.by && typeof b.by === "object" ? b.by : null,
  };
}
function briefCore(b) {
  const { title, caption, lyrics, bpm, keyscale, timesignature, duration, vocal_language, note } = b;
  return { title, caption, lyrics, bpm, keyscale, timesignature, duration, vocal_language, note };
}

// =============================================================================
// Nur EIN Vorgang auf einmal
// =============================================================================
//    10.10. zwei Briefe in 15 s und vier Renderings statt zwei. Jetzt sperrt ALLES,
//    was einen Vorgang startet ([data-start]), solange einer läuft.
async function exclusive(statusNode, fn) {
  if (state.busy) return;
  state.busy = true;
  $$("[data-start]").forEach(b => { b.disabled = true; });
  const say = (t) => setMsg(statusNode, t, "busy");
  try { await fn(say); }
  catch (e) { setMsg(statusNode, e.message || String(e), "err"); }
  finally {
    state.busy = false;
    $$("[data-start]").forEach(b => { b.disabled = false; });
  }
}

function needPairing(statusNode) {
  if (bridgeToken()) return false;
  setMsg(statusNode, "Erst den Mac koppeln — er schreibt und rechnet.", "err");
  openSettings();
  return true;
}

// =============================================================================
// Aktionen
// =============================================================================
function createTrack(opts = {}) {
  const node = $("#goMsg");
  if (needPairing(node)) return;
  exclusive(node, async (say) => {
    const o = form();
    saveForm();
    if (opts.genres) o.genres = opts.genres;     // 3.8: vom Würfel gezogen, ohne die Auswahl zu verändern
    // 3.24: gemessenes Tempo der Vorbilder bestellen (die Messung des Macs, nicht die Schätzung der Musik-KI) —
    //       nur wenn nichts gewählt ist und die Vorbilder beieinander liegen; die Tonart nur, wenn alle dieselbe haben
    if (refsDone().length) { if (!o.bpm && refTempo()) o.bpm = refTempo(); if (!o.key && refKey()) o.key = refKey(); }
    let b;
    if (macWriter()) {
      say(`✍️ Dein Mac schreibt den Brief (${macWriter()}) …`);
      try {
        const raw = await callMacWriter(createTask(o), say);
        b = enforceChoices(normalizeBrief(raw), o);
        b.by = { who: "mac", model: raw.writer || macWriter(), s: raw.write_s };
      } catch (e) { b = templateBrief(o, "Sprachmodell: " + e.message); }
    } else {
      b = templateBrief(o, !state.bridge.connected ? "der Mac meldet sich gerade nicht" : "kein Sprachmodell auf dem Mac");
    }
    setBrief(b);
    const n = await render(b, { n: o.variants, keep: false, source: "neu" });
    setMsg(node, `${opts.label ? opts.label + " · " : ""}✓ Brief steht — ${n} ${n === 1 ? "Version" : "Versionen"} auf dem Weg zum Mac.`, "ok");
    $("#current").scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

const LS_REFINE = "nf_refine";      // getippter Änderungswunsch — überlebt Neuladen
function refineTrack(wish) {
  const node = $("#curMsg");
  wish = (wish || $("#refineIn").value).trim();
  if (!wish) return setMsg(node, "Was soll anders werden?", "err");
  if (!state.brief) return;
  if (needPairing(node)) return;
  exclusive(node, async (say) => {
    if (!macWriter()) {
      throw new Error("Ändern braucht das Sprachmodell auf dem Mac — " +
        (state.bridge.connected ? "es läuft gerade keins (Ollama)." : "der Mac meldet sich gerade nicht.") +
        " Unter „✎ Brief von Hand bearbeiten“ kannst du selbst ändern.");
    }
    const keep = $("#keep").checked;
    const base = state.brief;
    say(`✍️ Dein Mac schreibt den Brief um (${macWriter()}) …`);
    const raw = await callMacWriter(refineTask(base, wish), say);
    // Das Modell liefert nur, was es schreibt — Länge, Takt, Sprache bleiben vom bisherigen Brief.
    const b = normalizeBrief({ ...briefCore(base), ...raw });
    b.duration = base.duration; b.timesignature = base.timesignature; b.vocal_language = base.vocal_language;
    b.seeds = keep ? base.seeds : [];
    b.by = { who: "mac", model: raw.writer || macWriter(), s: raw.write_s };
    setBrief(b);
    $("#refineIn").value = "";
    try { localStorage.removeItem(LS_REFINE); } catch (e) {}
    const n = await render(b, { n: form().variants, keep, source: "aendern" });
    setMsg(node, `✓ Geändert — ${n} ${n === 1 ? "Version" : "Versionen"} auf dem Weg.`, "ok");
  });
}

function renderAgain() {
  const node = $("#curMsg");
  if (!state.brief || needPairing(node)) return;
  exclusive(node, async () => {
    const n = await render(state.brief, { n: form().variants, keep: false, source: "neu-gewuerfelt" });
    setMsg(node, `✓ ${n} neue ${n === 1 ? "Version" : "Versionen"} auf dem Weg.`, "ok");
  });
}

function renderEdited() {
  const node = $("#editMsg");
  if (!state.brief || needPairing(node)) return;
  exclusive(node, async () => {
    const b = readEditor();
    if (!b.caption) throw new Error("Die Stilbeschreibung (Tags) ist leer.");
    setBrief(b);
    const n = await render(b, { n: form().variants, keep: $("#keep").checked, source: "von-hand" });
    setMsg(node, `✓ ${n} ${n === 1 ? "Version" : "Versionen"} auf dem Weg.`, "ok");
  });
}

// Geschätzte Rechenzeit auf dem Mac — gemessen am 10.10.2026 (M4 Pro): Planung ≈ 0,3 s je Sekunde Musik,
// Klang geführt ≈ 1,25 s/s (Standard) bzw. ≈ 2,8 s/s (XL) bei 50 Schritten, ungeführt ≈ 0,62×; Schritte linear.
function estimateSeconds(o) {
  const xl = !$("#ditWrap").hidden && o.dit === "xl-sft";
  const q = QUALITY[o.quality] || QUALITY.studio;
  const steps = q.inference_steps || 50;
  let dit = (xl ? 2.8 : 1.25) * steps / 50;
  if ((q.guidance_scale || 1) <= 1) dit *= 0.62;
  if (o.duration <= 240) return o.variants * (o.duration * (0.3 + dit) + 20);
  // 3.14: lange Titel — Hauptteil 220 s, dann je Anbau (30 s Kontext + Abschnitt) im Mittel 1,5 Versuche
  const parts = Math.ceil((o.duration - 220) / 80), part = (o.duration - 220) / parts;
  return o.variants * (220 * (0.3 + dit) + 20 + parts * 1.5 * ((30 + part) * dit + 15));
}
function renderEstimate() {
  const o = form();
  const s = estimateSeconds(o);
  const m = Math.max(1, Math.round(s / 60));
  $("#estimate").textContent = `⏱ ≈ ${m} Min. Rechenzeit auf deinem Mac für ${o.variants} ${o.variants === 1 ? "Version" : "Versionen"}` +
    (!$("#ditWrap").hidden && o.dit === "xl-sft" ? " (XL: beste Qualität, etwa 2–3× langsamer als Standard)" : "") +
    (o.duration > 240 ? ` · über 4 Min.: Hauptteil + ${Math.ceil((o.duration - 220) / 80)} angebaute Abschnitte` : "");
}

function qaLabel(qa) {
  if (!qa || typeof qa.CE !== "number") return "";
  const n = qa.CE.toFixed(1).replace(".", window.MWS_LANG === "en" ? "." : ",");
  return qa.versuche > 1 ? `🔎 Klang ${n} · beste von ${qa.versuche}` : `🔎 Klang ${n}`;
}
function randomSeed() { return Math.floor(Math.random() * 2147483647); }

async function render(b, { n, keep, source }) {
  const quality = QUALITY[$("#quality").value] || QUALITY.studio;
  const group = Math.random().toString(36).slice(2, 10);
  const seeds = [], fail = [];
  for (let i = 0; i < n; i++) {
    const seed = keep && b.seeds[i] != null ? b.seeds[i] : randomSeed();
    const request = { caption: b.caption, lyrics: b.lyrics, timesignature: b.timesignature, duration: b.duration,
      vocal_language: b.vocal_language, seed, ...quality, smooth_end: $("#smoothEnd").checked, qa_reroll: +$("#qaReroll").value };
    if (!$("#ditWrap").hidden) request.dit = $("#dit").value;
    if (b.bpm) request.bpm = b.bpm;
    if (b.keyscale) request.keyscale = b.keyscale;
    const meta = { title: b.title, note: b.note, group, variant: n > 1 ? LETTERS[i] : "", source };
    const r = await api("/api/render", { method: "POST", body: { request, meta } });
    if (!r.ok) { fail.push((r.data && r.data.message) || r.status); continue; }
    seeds.push(seed);
    // 3.13: Auftrag samt Einstellungen merken — so lässt er sich jederzeit identisch neu starten (gleicher Seed)
    state.pending.push({ id: r.data.id, title: b.title, variant: meta.variant, group, created: Date.now(), folder: targetFolder(), req: request, meta });
  }
  b.seeds = seeds;
  setBrief(b);
  savePending();
  renderQueue();
  schedulePoll(300);
  if (!seeds.length) throw new Error("✗ " + fail.join(" · "));
  return seeds.length;
}

// ---- 3.24: Aus deinen Songs: hochladen, analysieren lassen, Karten zeigen ----
const LS_REFS = "nf_refs";                   // fertige Analysen (ohne Audio) — überleben ein Neuladen
const REF_MAX = 3;
function saveRefs() {
  try { localStorage.setItem(LS_REFS, JSON.stringify(state.refs.filter(r => r.status === "done").map(({ key, name, result }) => ({ key, name, result, status: "done" })))); } catch (e) {}
}
function loadRefs() {
  try { state.refs = (JSON.parse(localStorage.getItem(LS_REFS) || "[]") || []).filter(r => r && r.result).slice(0, REF_MAX); } catch (e) { state.refs = []; }
}
async function analyzeFiles(files) {
  files = [...(files || [])];
  if (!files.length) return;
  if (needPairing($("#goMsg"))) return;
  const room = REF_MAX - state.refs.length;
  if (room <= 0) { setMsg($("#goMsg"), "Höchstens 3 Songs — zuerst einen entfernen.", "err"); return; }
  if (files.length > room) setMsg($("#goMsg"), `Nur die ersten ${room} — höchstens 3 Songs.`, "");
  await Promise.all(files.slice(0, room).map(analyzeOne));
}
async function analyzeOne(file) {
  const r = { key: "r" + Math.random().toString(36).slice(2, 9), name: file.name, status: "run", msg: "wird hochgeladen …", result: null };
  state.refs.push(r); renderRefs();
  const upd = (patch) => { Object.assign(r, patch); renderRefs(); };
  // Brücke ab 3.19 vermisst selbst; eine ältere lässt nur die Musik-KI zuhören
  const deep = macCan("analyse") || !state.bridge.connected;
  // als ArrayBuffer wie seit 2.x — ein File-Körper kam in WebKit beim Abfangen leer an (Prüfstand 3.24)
  const body = await file.arrayBuffer();
  const send = (kind) => api(`/api/analyze?kind=${kind}`, { method: "POST", raw: body, ctype: file.type || "audio/mpeg",
    headers: { "x-nf-filename": encodeURIComponent(file.name) } });
  let kind = deep ? "analyse" : "understand";
  let res = await send(kind).catch(() => null);
  if (!res || !res.ok) return upd({ status: "error", msg: "✗ " + ((res && res.data && res.data.message) || "Hochladen fehlgeschlagen") });
  let id = res.data.id;
  for (let i = 0; i < 600; i++) {
    await sleep(1500);
    if (!state.refs.includes(r)) { api(`/api/render/${id}/cancel`, { method: "POST" }).catch(() => {}); return; }
    const j = (await api("/api/render/" + id).catch(() => ({ data: {} }))).data || {};
    if (j.status === "done") {
      const out = kind === "analyse" ? (j.result || {}) : { v: 1, ace: j.result || {}, measure: { unavailable: "Brücke älter als 3.19" } };
      upd({ status: "done", msg: "", result: out }); saveRefs();
      return;
    }
    if (j.status === "error" && kind === "analyse" && /älter als/.test(j.message || "")) {     // alte Brücke: nur zuhören lassen
      kind = "understand"; res = await send(kind).catch(() => null);
      if (!res || !res.ok) return upd({ status: "error", msg: "✗ " + ((res && res.data && res.data.message) || "Hochladen fehlgeschlagen") });
      id = res.data.id; continue;
    }
    if (j.status === "error" || j.status === "cancelled") return upd({ status: "error", msg: "✗ Analyse: " + (j.message || j.status) });
    upd({ msg: j.message || (j.status === "queued" ? "wartet auf den Mac …" : "läuft …") });
  }
  upd({ status: "error", msg: "✗ Analyse: der Mac hat nicht geantwortet." });
}
function removeRef(key) { state.refs = state.refs.filter(r => r.key !== key); saveRefs(); renderRefs(); }

const STEM_COL = { drums: "#ff5fa2", bass: "#7c5cff", vocals: "#2be4c6", other: "#ffb347" };
const STEM_DE = { drums: "Drums", bass: "Bass", vocals: "Gesang", other: "Rest" };
function chip(label, value, title) {
  const c = el("span", "vb-chip"); if (title) c.title = title;
  if (label) c.append(el("span", "vb-cl", label));
  const v = el("b", "", ""); v.append(...[].concat(value)); c.append(v);
  return c;
}
function txt(s, no) { const x = el("span", "", s); if (no) x.setAttribute("translate", "no"); return x; }
function keyNodes(k) { return [txt(k.name, true), txt(" "), txt(KEY_DE[k.mode] || k.mode)]; }
function energySvg(m) {
  const e = m.energy || [], n = e.length;
  if (n < 4) return null;
  const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${n} 34`); svg.setAttribute("preserveAspectRatio", "none"); svg.setAttribute("class", "vb-energy");
  svg.setAttribute("role", "img"); svg.setAttribute("aria-label", "Energieverlauf");
  const pts = e.map((v, i) => `${i},${32 - v * 0.3}`).join(" ");
  const area = document.createElementNS(ns, "polygon"); area.setAttribute("points", `0,33 ${pts} ${n - 1},33`); area.setAttribute("class", "vb-area"); svg.append(area);
  (m.sections || []).forEach((sg, i) => {
    if (i > 0) { const l = document.createElementNS(ns, "line"); l.setAttribute("x1", sg.start); l.setAttribute("x2", sg.start); l.setAttribute("y1", 0); l.setAttribute("y2", 34); l.setAttribute("class", "vb-cut"); svg.append(l); }
  });
  return svg;
}
function refCard(r) {
  const c = el("div", "vb-card" + (r.status === "error" ? " err" : ""));
  c.dataset.key = r.key;
  const head = el("div", "vb-chead");
  head.append(txt("🎵 "), txt(r.name, true));
  const x = el("button", "ghost btn-s vb-x", "✕"); x.type = "button"; x.title = "Entfernen"; x.setAttribute("aria-label", "Entfernen"); x.onclick = () => removeRef(r.key);
  head.append(x); c.append(head);
  if (r.status !== "done") { c.append(el("p", "status" + (r.status === "error" ? " err" : " busy"), r.msg || "")); return c; }
  const a = r.result.ace || {}, m = r.result.measure || {};
  if (a.caption) { const p = el("p", "vb-style"); p.append(txt("Stil", false), txt(": "), txt(a.caption, true)); p.title = a.caption; c.append(p); }
  const chips = el("div", "vb-chips");
  if (m.bpm) chips.append(chip("", [txt(String(Math.round(m.bpm)), true), txt(" BPM", true)]));
  if (m.key) chips.append(chip("", m.key.alt ? [...keyNodes(m.key), txt(" "), txt("oder"), txt(" "), ...keyNodes(m.key.alt)] : keyNodes(m.key)));
  if (refMeter(a)) chips.append(chip("Takt", txt(refMeter(a), true)));
  if (m.vocals) chips.append(chip("Gesang", m.vocals === "kaum" ? txt("kaum") : [txt(m.vocals), ...(refLang(a, m) ? [txt(" · "), txt(refLang(a, m), true)] : [])]));
  if (m.colour) chips.append(chip("Klang", txt(m.colour)));
  if (m.groove) chips.append(chip("", txt(m.groove.four_on_floor ? "Kick auf jedem Schlag" : m.groove.backbeat > 0.5 ? "Kick und Snare im Wechsel" : "gebrochener Rhythmus")));
  c.append(chips);
  if (m.chords && m.chords.names) {
    const p = el("p", "vb-line"); p.append(txt("Akkorde"), txt(": "), txt(`${m.chords.names.join(" – ")}  (${m.chords.roman.join("–")})`, true)); c.append(p);
  }
  if (m.stems) {
    const bar = el("div", "vb-stems"), leg = el("div", "vb-legend");
    ["drums", "bass", "vocals", "other"].forEach(k => {
      const v = m.stems[k] || 0; const seg = el("span"); seg.style.width = v + "%"; seg.style.background = STEM_COL[k]; seg.title = `${STEM_DE[k]} ${v} %`; bar.append(seg);
      const l = el("span", "vb-leg"); const d = el("i"); d.style.background = STEM_COL[k]; l.append(d, txt(STEM_DE[k]), txt(` ${v} %`, true)); leg.append(l);
    });
    c.append(bar, leg);
  }
  const svg = energySvg(m);
  if (svg) c.append(svg);
  if (m.sections && m.sections.length) {
    const p = el("p", "vb-line vb-secs"); p.append(txt("Aufbau"), txt(": "));
    m.sections.forEach((sg, i) => { if (i) p.append(txt(" · ")); p.append(txt(`${sg.label} `, true), txt(sg.energy), txt(` ${fmtMin(sg.start)}`, true)); });
    c.append(p);
  }
  if (m.unavailable) c.append(el("p", "sub small", "Nur der Stil der Musik-KI — " + m.unavailable));
  return c;
}
function renderRefs() {
  const box = $("#refCards"); if (!box) return;
  box.innerHTML = "";
  state.refs.forEach(r => box.append(refCard(r)));
  $("#refBtn").disabled = state.refs.length >= REF_MAX;
  const done = refsDone(), mix = $("#refMix");
  mix.classList.toggle("hidden", !done.length);
  if (!done.length) return;
  const t = $("#refMixText"); t.innerHTML = "";
  t.append(el("b", "", "Gemeinsam"), txt(": "));
  const parts = [];
  const tp = refTempos();
  if (tp.length) parts.push([txt(tp.length > 1 && Math.max(...tp) - Math.min(...tp) >= 1 ? `${Math.round(Math.min(...tp))}–${Math.round(Math.max(...tp))} BPM` : `${Math.round(tp[0])} BPM`, true)]);
  const modes = new Set(done.map(r => ((r.result.measure || {}).key || {}).mode).filter(Boolean));
  if (modes.size === 1) parts.push([txt([...modes][0] === "minor" ? "Moll" : "Dur")]); else if (modes.size > 1) parts.push([txt("Dur und Moll gemischt")]);
  const g = done.map(r => (r.result.measure || {}).groove).filter(Boolean);
  if (g.length && g.every(x => x.four_on_floor)) parts.push([txt("Kick auf jedem Schlag")]);
  const v = done.map(r => (r.result.measure || {}).vocals).filter(Boolean);
  if (v.length && v.every(x => x === "kaum")) parts.push([txt("instrumental")]); else if (v.length && v.every(x => x !== "kaum")) parts.push([txt("mit Gesang")]);
  const col = new Set(done.map(r => (r.result.measure || {}).colour).filter(Boolean));
  if (col.size === 1) parts.push([txt("Klang"), txt(" "), txt([...col][0])]);
  parts.forEach((p, i) => { if (i) t.append(txt(" · ")); t.append(...p); });
  const bpm = refTempo(), key = refKey();
  if (bpm || key) {
    const n = el("div", "sub small vb-take");
    n.append(txt("Der neue Song bekommt"), txt(" "));
    if (bpm) n.append(txt(`${bpm} BPM`, true));
    if (bpm && key) n.append(txt(" · "));
    if (key) { const [nm, md] = key.split(" "); n.append(txt(nm, true), txt(" "), txt(KEY_DE[md])); }
    n.append(txt(" "), txt("— ändern unter „Feinheiten“."));
    t.append(n);
  }
}

// =============================================================================
// Aktueller Track + Brief-Editor
// =============================================================================
function setBrief(b) {
  state.brief = b;
  try { localStorage.setItem(LS_BRIEF, JSON.stringify(b)); } catch (e) {}
  showCurrent();
}

function showCurrent() { steady(showCurrentNow); }
function showCurrentNow() {
  const b = state.brief;
  $("#current").classList.toggle("hidden", !b && !state.pending.length);
  if (!b) return;
  $("#curTitle").textContent = b.title;
  const by = b.by || {};
  $("#curBy").textContent = by.who === "mac" ? `✍️ Brief von deinem Mac · ${by.model || "Sprachmodell"}${by.s ? ` · ${Math.round(by.s)} s` : ""}`
    : by.who === "vorlage" ? `📋 Brief aus deinen Angaben (ohne Sprachmodell)${by.why ? ` — ${by.why}` : ""}`
    : by.who === "hand" ? "✎ von Hand bearbeitet" : "";
  const meta = $("#curMeta");
  meta.innerHTML = "";
  [b.bpm ? `${b.bpm} BPM` : "BPM auto", b.keyscale || "Tonart auto", "≈ " + fmtDur(b.duration),
   b.timesignature !== "4" ? `${b.timesignature}/${b.timesignature === "6" ? 8 : 4}` : "",
   /vocals/i.test(b.caption) && !/vocal chops/i.test(b.caption) ? `Text: ${LANG_NAMES[b.vocal_language] || b.vocal_language}` : ""]
    .filter(Boolean).forEach(t => meta.append(el("span", "", t)));
  $("#curNote").textContent = b.note || "";
  $("#curNote").classList.toggle("hidden", !b.note);
  $("#curTags").textContent = b.caption;
  writeEditor(b);
}

// 🔴 showCurrent() läuft bei JEDEM Fortschritt eines Auftrags und schrieb die Felder neu → was man gerade
//    tippte, war weg. Jetzt: die Felder werden nur beschrieben, wenn ein ANDERER Brief kommt, und
//    Eingaben liegen sofort in localStorage (überleben Neuladen), bis neu gerechnet wird.
const LS_EDIT = "nf_brief_edit";
const EDIT_IDS = ["bTitle", "bCaption", "bLyrics", "bBpm", "bKey", "bTs", "bDur", "bLang"];
let editShown = { base: null, v0: null };
const briefKey = (b) => JSON.stringify([b.title, b.caption, b.lyrics, b.bpm || "", b.keyscale || "", b.timesignature || "4", b.duration, b.vocal_language || "en"]);
const editValues = () => Object.fromEntries(EDIT_IDS.map(id => [id, $("#" + id).value]));
function saveEditDraft() {
  if (!editShown.base) return;
  const v = editValues();
  try {
    if (JSON.stringify(v) === JSON.stringify(editShown.v0)) localStorage.removeItem(LS_EDIT);
    else localStorage.setItem(LS_EDIT, JSON.stringify({ base: editShown.base, v }));
  } catch (e) {}
}
function writeEditor(b) {
  const base = briefKey(b);
  if (editShown.base === base) return;          // derselbe Brief: die Felder gehören dem, der gerade tippt
  writeEditorNow(b);
  editShown = { base, v0: editValues() };
  let d = null; try { d = JSON.parse(localStorage.getItem(LS_EDIT) || "null"); } catch (e) {}
  if (d && d.base === base && d.v) {
    EDIT_IDS.forEach(id => { if (typeof d.v[id] === "string") $("#" + id).value = d.v[id]; });
    $("#bDurVal").textContent = "≈ " + fmtDur(+$("#bDur").value);
    setMsg($("#editMsg"), "✏️ Deine Änderungen von vorhin sind wieder da — noch nicht gerechnet.", "");
    checkEditor();
  } else if (d) { try { localStorage.removeItem(LS_EDIT); } catch (e) {} }
}
function writeEditorNow(b) {
  $("#bTitle").value = b.title;
  $("#bCaption").value = b.caption;
  $("#bLyrics").value = b.lyrics;
  $("#bBpm").value = b.bpm || "";
  $("#bKey").value = b.keyscale || "";
  $("#bTs").value = b.timesignature || "4";
  $("#bDur").value = b.duration;
  $("#bDurVal").textContent = "≈ " + fmtDur(b.duration);
  $("#bLang").value = b.vocal_language || "en";
  checkEditor();
}

function readEditor() {
  const prev = state.brief || {};
  const b = normalizeBrief({
    title: $("#bTitle").value, caption: $("#bCaption").value, lyrics: $("#bLyrics").value,
    bpm: +$("#bBpm").value, keyscale: $("#bKey").value, timesignature: $("#bTs").value,
    duration: +$("#bDur").value, vocal_language: $("#bLang").value, note: prev.note, seeds: prev.seeds, by: prev.by,
  });
  // 🔴 Bis 2.2 blieb die Notiz des alten Briefs stehen, auch wenn man Stil und Text ersetzt
  if (b.caption !== prev.caption || b.lyrics !== prev.lyrics) { b.note = ""; b.by = { who: "hand" }; }
  return b;
}

// Gesang im Stil, aber kein Text in der Struktur → die Musik-KI singt kaum. Genau das ist
function checkEditor() {
  const cap = $("#bCaption").value, lyr = $("#bLyrics").value;
  const wantsVoice = /vocals|gesang|stimme|singer/i.test(cap) && !/vocal chops|instrumental/i.test(cap);
  const hasText = lyr.split("\n").some(l => l.trim() && !/^\s*\[[^\]]*\]\s*$/.test(l));
  const w = $("#editWarn");
  const show = wantsVoice && !hasText;
  w.textContent = show ? "⚠️ Im Stil steht Gesang, aber die Struktur hat keine Textzeilen — so wird es fast ein Instrumental. " +
    "Schreib Zeilen unter die Marker, oder erzeuge den Track oben neu mit „Gesang ♀/♂“ — dann schreibt dein Mac den Text." : "";
  w.classList.toggle("hidden", !show);
}

// =============================================================================
// Warteschlange
// =============================================================================
function savePending() { try { localStorage.setItem(LS_PENDING, JSON.stringify(state.pending)); } catch (e) {} }
function loadPending() {
  try { state.pending = JSON.parse(localStorage.getItem(LS_PENDING) || "[]"); } catch (e) { state.pending = []; }
  if (!Array.isArray(state.pending)) state.pending = [];
  //        der Track lag fertig auf dem Server und im Mac-Archiv. Solche Einträge jetzt nachladen.
  state.pending.forEach(p => { if (p.status === "error" && /^Abholen fehlgeschlagen/.test(p.message || "")) Object.assign(p, { status: "fetch", tries: 1, retryAt: 0 }); });
  renderQueue();
  if (state.pending.length) schedulePoll(200);
}
function schedulePoll(ms) { clearTimeout(state.pollTimer); state.pollTimer = setTimeout(poll, ms); }

//    Track auf dem Server (45 min) und im Mac-Archiv lag. Beim Aufwachen liefen zwei Abfragen gleichzeitig
//    (Zeitgeber + Sichtbarkeit) und holten dasselbe doppelt. Jetzt: eine Abfrage zur Zeit, Abholen wird
//    wiederholt, und ist der Track auf dem Server weg, kommt er aus dem Mac-Archiv.
const FETCH_TRIES = 4;                // so oft vom Server, danach aus dem Mac-Archiv
let polling = false;
async function poll() {
  if (polling) { schedulePoll(1000); return; }
  polling = true;
  try { await pollOnce(); } finally { polling = false; }
}
function pollAgain() {                // aufgewacht / wieder online: wartende Abholversuche sofort
  state.pending.forEach(p => { if (p.status === "fetch") p.retryAt = 0; });
  schedulePoll(100);
}

async function pollOnce() {
  if (!state.pending.length || !bridgeToken()) return;
  const still = [];
  for (const p of state.pending) {
    if (p.status === "error" || p.status === "lost") { still.push(p); continue; }
    if (p.status === "fetch" && (macFetching.has(p.id) || Date.now() < (p.retryAt || 0))) { still.push(p); continue; }
    if (p.status === "fetch" && (p.gone || p.tries >= FETCH_TRIES)) { fromMac(p); still.push(p); continue; }
    let r;
    try { r = await api("/api/render/" + p.id); } catch (e) { still.push(p); continue; }
    if (r.status === 404 || r.status === 410) {
      if (p.status === "fetch") { p.gone = true; fromMac(p); still.push(p); continue; }
      // 🔴 3.13: nach einem Neustart des Servers kennt er den Auftrag kurz nicht — der Mac rechnet weiter und meldet
      //    ihn mit derselben Kennung wieder an. Bis 3.12 galt er sofort als verloren (und der Mac brach ab).
      p.missSince = p.missSince || Date.now();
      if (Date.now() - p.missSince < LOST_GRACE_MS) {
        p.status = "running"; p.message = "Server startet neu — dein Mac rechnet weiter …"; still.push(p); continue;
      }
      if (await autoRestart(p, "Auftrag war verloren")) { still.push(p); continue; }
      p.status = "lost"; p.message = "Auftrag verloren (Server neu gestartet)."; still.push(p); continue;
    }
    delete p.missSince;
    const j = r.data || {};
    if (j.status === "done") {
      p.archived = (j.result_meta || {}).archived || p.archived || "";
      try { await collect(p, j); }
      catch (e) { fetchFailed(p, e); still.push(p); }
      continue;
    }
    p.status = j.status; p.message = j.message; p.queue_pos = j.queue_pos;
    if (j.status === "cancelled") continue;          // von dir abgebrochen
    if (j.status === "error") await autoRestart(p, j.message);
    still.push(p);
  }
  const collected = state.pending.length - still.length;
  state.pending = still.filter(p => !collectedIds.has(p.id));
  savePending();
  renderQueue();
  if (collected > 0 && state.macOnly.length) checkMacOnly();
  const waits = state.pending.filter(p => p.status === "fetch" && !macFetching.has(p.id)).map(p => Math.max(0, (p.retryAt || 0) - Date.now()));
  if (state.pending.some(p => p.status === "queued" || p.status === "running" || !p.status)) schedulePoll(2000);
  else if (waits.length) schedulePoll(Math.max(1000, Math.min(...waits)));
}

// ---- 3.13: Abgebrochene Aufträge wieder starten (automatisch einmal, sonst per ↻) ----
const LOST_GRACE_MS = 3 * 60e3;
const AUTO_RESTARTS = 1;
async function restartJob(p) {
  if (!p.req) return false;
  const r = await api("/api/render", { method: "POST", body: { request: p.req, meta: p.meta || { title: p.title, variant: p.variant || "", group: p.group } } });
  if (!r.ok) { p.message = "Neustart nicht möglich: " + ((r.data && r.data.message) || r.status); return false; }
  Object.assign(p, { id: r.data.id, status: "queued", queue_pos: null, created: Date.now(), restarts: (p.restarts || 0) + 1,
    message: "↻ neu gestartet — gleiche Einstellungen, gleicher Seed" });
  delete p.missSince;
  return true;
}
async function autoRestart(p, why) {
  if (!p.req || (p.restarts || 0) >= AUTO_RESTARTS) return false;
  const ok = await restartJob(p);
  if (ok) setMsg($("#curMsg"), `↻ „${p.title}${p.variant ? " · " + p.variant : ""}“ wurde unterbrochen (${why || "Fehler"}) und läuft neu.`, "");
  return ok;
}

function fetchFailed(p, e) {
  const hidden = document.hidden;       // bei ausgeschaltetem Bildschirm zählt ein Abbruch nicht — der nächste Versuch kommt beim Aufwachen
  if (!hidden) p.tries = (p.tries || 0) + 1;
  p.status = "fetch";
  p.gone = /HTTP (404|410)/.test(e.message || "");
  p.retryAt = Date.now() + (hidden ? 30000 : Math.min(30000, 4000 * (p.tries || 1)));
  p.message = `Abholen unterbrochen (${e.message}) — wird nachgeladen …`;
}

// Den fertigen Track aus dem Mac-Archiv holen (läuft neben der Abfrage, die anderen Aufträge warten nicht)
const macFetching = new Set(), collectedIds = new Set();
async function fromMac(p) {
  if (macFetching.has(p.id)) return;
  if (document.hidden) { p.retryAt = Date.now() + 30000; return; }   // beim Aufwachen weiter (pollAgain)
  if (!macCan("nachruesten")) { p.message = "liegt fertig auf deinem Mac — wird nachgeladen, sobald er sich meldet"; p.retryAt = Date.now() + 15000; return; }
  macFetching.add(p.id);
  try {
    const all = await libAll();
    if (!p.archived) {                  // Einträge von vor 3.6.1 kennen ihren Archivplatz nicht: im Archiv nach Titel suchen
      const j = await macJob("archiv", {}, { timeoutMs: 60000 });
      const have = new Set(all.map(r => (r.result || {}).archived).filter(Boolean));
      const day = new Date(p.created || Date.now()).toISOString().slice(0, 10);
      const hit = ((j.result || {}).tracks || []).filter(t => !have.has(t.archived) && t.title === p.title && (t.variant || "") === (p.variant || "") && t.created >= day)
        .sort((a, b) => (a.created + a.time).localeCompare(b.created + b.time))[0];
      if (!hit) throw new Error("nicht im Mac-Archiv gefunden");
      p.archived = hit.archived;
    }
    if (!all.some(r => (r.result || {}).archived === p.archived)) {   // inzwischen über 📥 geholt? dann nicht doppelt
      p.message = "📥 wird vom Mac nachgeladen …"; renderQueue();
      await fetchFromMac({ archived: p.archived, title: p.title, variant: p.variant }, { id: p.id, created: p.created, folder: p.folder || "" });
    }
    collectedIds.add(p.id);
    state.pending = state.pending.filter(q => q.id !== p.id);
    savePending();
    renderQueue();
    await renderLibrary();
    if (state.macOnly.length) checkMacOnly();
  } catch (e) {
    p.tries = (p.tries || 0) + 1;
    p.retryAt = Date.now() + 60000;
    p.message = `Nachladen vom Mac gescheitert (${e.message}) — neuer Versuch in einer Minute`;
    if (/nicht im Mac-Archiv/.test(e.message)) Object.assign(p, { status: "error", message: "Abholen fehlgeschlagen — im Mac-Archiv nicht gefunden. Bitte neu erzeugen." });
    savePending();
    renderQueue();
    schedulePoll(p.status === "fetch" ? 61000 : 0);
  } finally { macFetching.delete(p.id); }
}

async function collect(p, j) {
  const arch = (j.result_meta || {}).archived;
  if (arch && (await libAll()).some(r => r.id === p.id || (r.result || {}).archived === arch)) return;   // schon da (📥 oder ein früherer Versuch)
  const res = await fetch(`/api/render/${p.id}/audio`, { headers: { "x-nf-bridge": bridgeToken() }, cache: "no-store" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const blob = await res.blob();
  const m = j.meta || {}, rm = j.result_meta || {};
  const rec = {
    id: p.id, created: Date.now(), title: m.title || p.title, variant: m.variant || "", group: m.group || p.group,
    note: m.note || "", request: j.request || {}, result: rm, favorite: false, blob,
    peaks: await computePeaks(blob), folder: p.folder || "",
    wm: rm.wasserzeichen || "", coverState: rm.cover === "folgt" ? "pending" : "",
  };
  // Das Cover kommt NACH dem Track (der Mac malt es, während man schon hört)
  if (j.has_cover) { try { Object.assign(rec, { cover: await fetchBlob(`/api/render/${p.id}/cover`), coverState: "done", coverAt: Date.now() }); } catch (e) {} }
  await libPut(rec);
  collectedIds.add(p.id);
  if (rec.coverState === "pending") watchCover(p.id);
  state.fresh.add(p.id);
  await renderLibrary();
}

async function cancelJob(id) {
  await api(`/api/render/${id}/cancel`, { method: "POST" }).catch(() => {});
  state.pending = state.pending.filter(p => p.id !== id);
  savePending();
  renderQueue();
}

function renderQueue() { steady(renderQueueNow); keepScreen(); }
// läuft oder ein fertiger Track noch abgeholt wird, hält die Seite den Bildschirm wach (Screen Wake Lock, Safari ab
// 16.4). Die Brücke hält zusätzlich den Mac wach (caffeinate). Wird die Seite versteckt, gibt der Browser die Sperre
// frei — beim Zurückkommen holt keepScreen sie neu.
let wakeLock = null, wakeAsking = null;
async function keepScreen() {
  const busy = () => state.pending.some(p => !p.status || p.status === "queued" || p.status === "running" || p.status === "fetch");
  if (wakeAsking) return wakeAsking;                                    // eine Anforderung zur Zeit
  wakeAsking = (async () => {
    try {
      if (busy() && !wakeLock && !document.hidden && navigator.wakeLock) {
        const l = await navigator.wakeLock.request("screen");
        l.addEventListener("release", () => { if (wakeLock === l) wakeLock = null; });
        if (wakeLock || !busy()) await l.release(); else wakeLock = l;   // inzwischen fertig → gleich wieder frei
      } else if (!busy() && wakeLock) { const w = wakeLock; wakeLock = null; await w.release(); }
    } catch (e) { /* nicht erlaubt (Akku sparen, Rahmen) — dann eben ohne */ }
    finally { wakeAsking = null; }
  })();
  return wakeAsking;
}
function renderQueueNow() {
  const box = $("#queue");
  box.innerHTML = "";
  box.classList.toggle("hidden", !state.pending.length);
  if (state.pending.length && $("#current").classList.contains("hidden")) showCurrent();
  state.pending.forEach(p => {
    const bad = p.status === "error" || p.status === "lost";
    const row = el("div", "q-row" + (bad ? " bad" : ""));
    row.append(el("span", "", p.status === "running" ? "⚙️" : bad ? "⚠️" : p.status === "fetch" ? "📥" : "⏳"));
    row.append(el("span", "q-title", p.title + (p.variant ? " · " + p.variant : "")));
    let txt = p.message || "";
    if (p.status === "queued" || !p.status) txt = p.queue_pos ? `wartet (${p.queue_pos} davor)` : (state.bridge.connected ? "wartet auf den Mac …" : "wartet — der Mac meldet sich gerade nicht");
    if ((p.status === "queued" || !p.status) && p.restarts) txt = "↻ neu gestartet · " + txt;
    const msg = el("span", "q-msg" + (p.status === "running" ? " live" : ""), txt);
    row.append(msg);
    if (bad && p.req) {
      const again = el("button", "ghost btn-s", "↻");
      again.type = "button"; again.title = "Neu starten (gleiche Einstellungen)";
      again.onclick = async () => { again.disabled = true; await restartJob(p); savePending(); renderQueue(); schedulePoll(500); };
      row.append(again);
    }
    const x = el("button", "ghost btn-s", "✕");
    x.type = "button";
    const hide = bad || p.status === "fetch";   // fertig gerechnet: nichts abzubrechen, der Track bleibt im Mac-Archiv
    x.title = bad ? "Ausblenden" : hide ? "Nicht nachladen (bleibt auf dem Mac)" : "Abbrechen";
    x.onclick = () => hide ? (state.pending = state.pending.filter(q => q !== p), savePending(), renderQueue()) : cancelJob(p.id);
    row.append(x);
    box.append(row);
  });
}

// =============================================================================
// Bibliothek (IndexedDB) + Ordner + Auswahl + Wiedergabe
// =============================================================================
let _db;
function idb() {
  if (_db) return _db;
  _db = new Promise((resolve, reject) => {
    // Dieselbe Datenbank und Version wie seit 2.0 (und umzug.js) — sonst stritten sich Fassungen.
    // Ordner hängen darum als Feld `folder` am Track; die Ordnerliste liegt in localStorage.
    const r = indexedDB.open("neonforge", 1);
    r.onupgradeneeded = () => { r.result.createObjectStore("renders", { keyPath: "id" }); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return _db;
}
async function tx(mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const t = db.transaction("renders", mode);
    const out = fn(t.objectStore("renders"));
    t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : undefined);
    t.onerror = t.onabort = () => reject(t.error || new Error("Bibliothek: Schreiben abgebrochen"));
  });
}
//    wenn ein Datensatz MIT Audio-Blob neu geschrieben wird. Danach ist jedes vorher gelesene Blob tot
//    Favorit, Nachrüsten, Export-Vermerk: jeder schrieb den ganzen Track samt 60 MB Audio neu.
//    Angaben ändern fasst sie nie wieder an. Lesen setzt beides zusammen — für den Rest der App ändert sich nichts.
//    Dieselbe Datenbank und Version 1 (umzug.js!) — alte Einträge mit eingebettetem Audio werden beim Start umgezogen.
const PARTS = { blob: "~a:", cover: "~c:", mastered: "~m:" };   // 3.7: ~m: = gemasterte Fassung (mastering.js)
const isPart = (id) => typeof id === "string" && id.startsWith("~");
function joinRec(r, parts) {
  const out = { ...r };
  for (const [f, pre] of Object.entries(PARTS)) { const p = parts.get(pre + r.id); if (p) out[f] = p.blob; }
  return out;
}
const joinAll = (list) => { const parts = new Map(list.filter(r => isPart(r.id)).map(r => [r.id, r]));
  return list.filter(r => !isPart(r.id)).map(r => joinRec(r, parts)); };
// Schreiben: ein Blob-Feld, das im Datensatz steht, wandert in seinen eigenen Eintrag (leer = Eintrag weg)
function putSplit(s, rec) {
  const t = { ...rec };
  for (const [f, pre] of Object.entries(PARTS)) {
    if (!(f in t)) continue;
    const b = t[f]; delete t[f];
    if (b) s.put({ id: pre + rec.id, part: f, blob: b }); else s.delete(pre + rec.id);
  }
  s.put(t);
}
let libReady = Promise.resolve();     // der Umzug alter Einträge läuft vor jedem Schreiben
const libPut = async (rec) => { await libReady; await tx("readwrite", s => putSplit(s, rec)); await liveRefresh([rec.id]); };
// Auch Lesen wartet den Umzug ab: ein vorher gelesenes Blob wäre in Safari danach tot.
const libAll = async () => { await libReady; return joinAll(await tx("readonly", s => s.getAll()) || []); };
async function libGet(id) { await libReady; return libGetRaw(id); }
async function libGetRaw(id) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const t = db.transaction("renders", "readonly");
    const s = t.objectStore("renders");
    const q = [id, ...Object.values(PARTS).map(pre => pre + id)].map(k => s.get(k));
    t.oncomplete = () => { const [r, ...ps] = q.map(x => x.result);
      resolve(r ? joinRec(r, new Map(ps.filter(Boolean).map(p => [p.id, p]))) : r); };
    t.onerror = t.onabort = () => reject(t.error || new Error("Bibliothek: Lesen abgebrochen"));
  });
}
const libDelMany = async (ids) => { await libReady;
  return tx("readwrite", s => { ids.forEach(id => { s.delete(id); Object.values(PARTS).forEach(pre => s.delete(pre + id)); }); }); };
async function libPatchMany(ids, patchOf) {
  await libReady;
  // Eine Transaktion für alle — get und put in derselben, damit nichts dazwischenfunkt.
  // Der Track-Eintrag trägt (nach dem Umzug) keine Blobs: patchOf sieht nur Angaben, und nur ein Patch
  // MIT blob/cover schreibt dessen eigenen Eintrag.
  const db = await idb();
  await new Promise((resolve, reject) => {
    const t = db.transaction("renders", "readwrite");
    const s = t.objectStore("renders");
    ids.forEach(id => { const g = s.get(id); g.onsuccess = () => { if (g.result) putSplit(s, { ...g.result, ...patchOf(g.result) }); }; });
    t.oncomplete = resolve;
    t.onerror = t.onabort = () => reject(t.error || new Error("Bibliothek: Schreiben abgebrochen"));
  });
  await liveRefresh(ids);
}
// Einmaliger Umzug: Einträge mit eingebettetem Audio/Cover (bis 3.5.0, auch aus umzug.js) aufteilen.
// Je Track EINE Transaktion — ganz oder gar nicht. Scheitert einer, bleibt er wie er war (nächster Start).
async function libSplitOld() {
  let ids = [];
  try { ids = (await tx("readonly", s => s.getAll()) || []).filter(r => !isPart(r.id) && (r.blob || r.cover)).map(r => r.id); } catch (e) { return; }
  if (!ids.length) return;
  const msg = $("#libMsg");
  setMsg(msg, `Bibliothek wird einmalig umgestellt (${ids.length} ${ids.length === 1 ? "Track" : "Tracks"}) …`, "busy");
  for (const id of ids) {
    try { await tx("readwrite", s => { const g = s.get(id); g.onsuccess = () => { const r = g.result; if (r && (r.blob || r.cover)) putSplit(s, r); }; }); }
    catch (e) { console.warn("Bibliothek: Umzug von " + id + " verschoben —", e && e.message); }
  }
  // Direkt nach dem Schreiben liefert Safari mitunter für Sekunden tote Blobs — erst weiter, wenn sie lesbar sind
  for (const id of ids) await freshRec(id, "blob", 6000, true);
  if ((msg.dataset.msg || "").startsWith("Bibliothek wird einmalig")) setMsg(msg, "", "");
}
// Den Datensatz frisch lesen, bis sein Blob (Audio oder Cover) wirklich lesbar ist — höchstens `ms` lang.
// Gegen Safaris tote Blobs; in Chrome ist der erste Versuch gleich der richtige.
async function freshRec(id, field = "blob", ms = 6000, raw = false) {
  const t0 = Date.now();
  let r = null;
  for (;;) {
    try { r = raw ? await libGetRaw(id) : await libGet(id); } catch (e) { r = null; }
    if (!r || !r[field] || await blobAlive(r[field]) || Date.now() - t0 > ms) return r;
    await new Promise(res => setTimeout(res, 250));
  }
}
const libPatch = (id, patch) => libPatchMany([id], () => patch);

// Zuletzt gelesener Stand je Track — Zeilen und Player reichen nie ein Blob weiter, das Safari inzwischen
const libLive = new Map();            // id → zuletzt gelesener Datensatz (dessen Blob gilt)
const liveRec = (rec) => (rec && libLive.get(rec.id)) || rec;
async function blobAlive(b) { try { await b.slice(0, 1).arrayBuffer(); return true; } catch (e) { return false; } }
async function liveRefresh(ids) {
  let all = [];
  try { all = await libAll(); } catch (e) { return; }
  const want = new Set(ids);
  all.forEach(r => { if (want.has(r.id)) libLive.set(r.id, r); });
  if (ms.rec && want.has(ms.rec.id) && libLive.has(ms.rec.id)) ms.rec = libLive.get(ms.rec.id);
  if (player.rec && want.has(player.rec.id)) {
    const r = libLive.get(player.rec.id);
    const f = player.field || "blob";
    if (!r) { /* gelöscht — stopPlayer macht renderLibrary */ }
    else if (player.waiting) player.rec = { ...r, blob: player.rec.blob };        // spielt stumm das Original, bis die Fassung kommt
    // 3.7: eine NEU abgelegte gemasterte Fassung (anderer Schlüssel) ersetzt die alte — in Safari ist die alte danach tot.
    else if (f === "mastered") { if (r.mastered && masteredOk(r) && r.masteredFor !== player.loaded) playerSwap(r); else player.rec = { ...r, mastered: player.rec.mastered }; }
    else if (r[f] && r[f] !== player.rec[f] && !(await blobAlive(player.rec[f]))) playerSwap(r);
    else player.rec = { ...r, [f]: player.rec[f] };
  }
}
// Die Wiedergabe auf das frische Blob umhängen — an derselben Stelle, im selben Zustand (spielend/pausiert)
function playerSwap(r) {
  const f = player.field || "blob";
  if (!player.audio || !player.id || player.id !== r.id || !r[f]) return;
  const at = player.lastT || player.audio.currentTime || 0, run = !player.audio.paused || player.wantPlay;
  if (player.url) URL.revokeObjectURL(player.url);
  player.url = URL.createObjectURL(r[f]);
  player.rec = r;
  if (f === "mastered") player.loaded = r.masteredFor;
  player.audio.src = player.url;
  player.audio.addEventListener("loadedmetadata", () => { player.audio.currentTime = at; paintProgress(); }, { once: true });
  if (run) player.audio.play().catch(() => {});
}

const LS_FOLDERS = "nf_folders";
const LS_VIEW = "nf_lib_view";            // "all" | "fav" | "none" | Ordner-id
function folders() {
  try { const a = JSON.parse(localStorage.getItem(LS_FOLDERS) || "[]"); return Array.isArray(a) ? a.filter(f => f && f.id && f.name) : []; }
  catch (e) { return []; }
}
function saveFolders(list) { try { localStorage.setItem(LS_FOLDERS, JSON.stringify(list)); } catch (e) {} }
function folderName(id) { const f = folders().find(x => x.id === id); return f ? f.name : ""; }
function askNewFolder() {
  const name = (prompt("Name des neuen Ordners:") || "").trim();
  if (!name) return null;
  const f = { id: "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: name.slice(0, 40) };
  saveFolders([...folders(), f]);
  return f;
}
function setView(v) {
  state.view = v;
  state.sel.clear();
  try { localStorage.setItem(LS_VIEW, v); } catch (e) {}
  renderLibrary();
}
// Neue Tracks landen im gerade geöffneten Ordner (wie beim Music Generator).
function targetFolder() { return folders().some(f => f.id === state.view) ? state.view : ""; }

function renderFolderBar(all) {
  const bar = $("#folderBar");
  const fl = folders();
  bar.innerHTML = "";
  const chip = (view, label, n, drop) => {
    const c = el("button", "chip fold" + (state.view === view ? " on" : ""), "");
    c.type = "button"; c.dataset.view = view;
    if (drop !== undefined) c.dataset.drop = drop;
    c.append(document.createTextNode(label + " "), el("b", "", String(n)));
    c.onclick = () => setView(view);
    bar.append(c);
    return c;
  };
  chip("all", "Alle", all.length);
  chip("fav", "★ Favoriten", all.filter(r => r.favorite).length);
  if (fl.length) chip("none", "Unsortiert", all.filter(r => !r.folder || !fl.some(f => f.id === r.folder)).length, "");
  fl.forEach(f => chip(f.id, "📁 " + f.name, all.filter(r => r.folder === f.id).length, f.id));
  const add = el("button", "chip ghost", "＋ Ordner");
  add.type = "button"; add.title = "Neuen Ordner anlegen";
  add.onclick = () => { const f = askNewFolder(); if (f) setView(f.id); };
  bar.append(add);
  const cur = fl.find(f => f.id === state.view);
  if (cur) {
    const ren = el("button", "ghost btn-s", "✎ Umbenennen");
    ren.type = "button";
    ren.onclick = () => {
      const name = (prompt("Neuer Name für den Ordner:", cur.name) || "").trim();
      if (name) { saveFolders(fl.map(f => f.id === cur.id ? { ...f, name: name.slice(0, 40) } : f)); renderLibrary(); }
    };
    const del = el("button", "ghost btn-s danger", "Ordner auflösen");
    del.type = "button";
    del.title = "Der Ordner verschwindet, seine Tracks bleiben (unter „Unsortiert“)";
    del.onclick = async () => {
      if (!confirm(`Ordner „${cur.name}“ auflösen?\nDie Tracks darin bleiben erhalten und stehen dann unter „Unsortiert“.`)) return;
      const ids = all.filter(r => r.folder === cur.id).map(r => r.id);
      if (ids.length) await libPatchMany(ids, () => ({ folder: "" }));
      saveFolders(fl.filter(f => f.id !== cur.id));
      setView("all");
    };
    bar.append(ren, del);
  }
}

// ---- Auswahl ----
function visibleIds() { return $$("#libList .lib-row").map(r => r.dataset.id); }
function renderSelBar() {
  const n = state.sel.size;
  $("#selBar").classList.toggle("hidden", !n);
  $("#selCount").textContent = `${n} ausgewählt`;
  const vis = visibleIds();
  const all = $("#selAll");
  all.checked = !!vis.length && vis.every(id => state.sel.has(id));
  all.indeterminate = n > 0 && !all.checked;
  $("#selAllWrap").classList.toggle("hidden", !vis.length);
  $$("#libList .lib-row").forEach(r => {
    const on = state.sel.has(r.dataset.id);
    r.classList.toggle("sel", on);
    r.querySelector(".lib-sel").checked = on;
  });
  const m = $("#selMove");
  m.innerHTML = "";
  const opt = (v, t, dis) => { const o = el("option", "", t); o.value = v; if (dis) { o.disabled = true; o.selected = true; } m.append(o); };
  opt("", "📁 In Ordner …", true);
  opt("none", "Unsortiert");
  folders().forEach(f => opt(f.id, f.name));
  opt("new", "＋ Neuer Ordner …");
}
function toggleSel(id, on, shift) {
  const vis = visibleIds();
  if (shift && state.lastSel && vis.includes(state.lastSel)) {
    // Umschalt-Klick: alles zwischen dem letzten und diesem Haken bekommt denselben Zustand
    const a = vis.indexOf(state.lastSel), b = vis.indexOf(id);
    vis.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(x => on ? state.sel.add(x) : state.sel.delete(x));
  } else if (on) state.sel.add(id); else state.sel.delete(id);
  state.lastSel = id;
  renderSelBar();
}

// 🔴 EINE Funktion zum Löschen — für den Zeilenknopf UND die Auswahl (Lehre aus der Postwache:
//    eine Regel, die nur einem der Wege galt). Auf dem Mac bleiben die Dateien liegen.
async function deleteTracks(ids) {
  if (!ids.length) return;
  const all = await libAll();
  const favs = all.filter(r => ids.includes(r.id) && r.favorite);
  const recs = all.filter(r => ids.includes(r.id) && !r.favorite);
  if (!recs.length) {
    setMsg($("#selMsg"), `★ ${favs.length === 1 ? "Favoriten" : favs.length + " Favoriten"} löschen geht nicht — erst den Stern entfernen.`, "err");
    setMsg($("#libMsg"), `★ Favoriten sind geschützt — erst den Stern entfernen, dann löschen.`, "err");
    return;
  }
  ids = recs.map(r => r.id);
  const what = recs.length === 1 ? `„${recs[0].title}${recs[0].variant ? " · " + recs[0].variant : ""}“` : `${recs.length} Tracks`;
  const arch = recs.map(r => (r.result || {}).archived).filter(goodArchived);
  if (!confirm(`${what} löschen?\n` + (favs.length ? `★ ${favs.length} ${favs.length === 1 ? "Favorit bleibt" : "Favoriten bleiben"} (geschützt).\n` : "") + (arch.length ? "Auch auf deinem Mac: Audio, Cover und Original wandern in den Papierkorb (dort bis zum Leeren zurückholbar)."
    : "Der Track liegt nur hier im Browser."))) return;
  if (player.id && ids.includes(player.id)) stopPlayer();
  await libDelMany(recs.map(r => r.id));
  ids.forEach(id => state.sel.delete(id));
  await renderLibrary();
  setMsg($("#selMsg"), "", "");
  if (arch.length) { delPendingAdd(arch); await flushMacDeletes(true); }
  checkMacOnly();
}
// Was auf dem Mac noch gelöscht werden muss (Mac gerade weg, Brücke zu alt) — wird nachgeholt, sobald er da ist,
const LS_DEL = "nf_del_pending";
function delPending() { try { const a = JSON.parse(localStorage.getItem(LS_DEL) || "[]"); return Array.isArray(a) ? a.filter(goodArchived) : []; } catch (e) { return []; } }
function delPendingSet(a) { try { if (a.length) localStorage.setItem(LS_DEL, JSON.stringify([...new Set(a)])); else localStorage.removeItem(LS_DEL); } catch (e) {} }
function delPendingAdd(a) { delPendingSet([...delPending(), ...a]); }
let delRunning = null;
async function flushMacDeletes(show = false) {
  const list = delPending();
  if (!list.length) return;
  if (!macCan("loeschen")) {
    if (show) setMsg($("#libMsg"), `Gelöscht. Auf dem Mac ${list.length === 1 ? "wird er" : "werden sie"} gelöscht, sobald er verbunden ist` +
      (state.bridge.connected ? " (Brücke ab 3.6 nötig)." : "."), "");
    return;
  }
  if (delRunning) return delRunning;
  delRunning = (async () => {
    try {
      const j = await macJob("loeschen", { archived: list }, { timeoutMs: 120000 });
      const r = j.result || {}, weg = new Set([...(r.deleted || []), ...(r.missing || [])]);
      delPendingSet(delPending().filter(a => !weg.has(a)));
      const n = (r.deleted || []).length;
      if (show || n) setMsg($("#libMsg"), n ? `🗑 ${n} ${n === 1 ? "Track" : "Tracks"} auch auf dem Mac gelöscht` +
        (r.hard ? " (endgültig — Papierkorb nicht erreichbar)." : " — liegt im Papierkorb, bis du ihn leerst.") : "✓ Gelöscht.", "ok");
    } catch (e) { if (show) setMsg($("#libMsg"), `Gelöscht — auf dem Mac noch nicht (${e.message}). Wird nachgeholt.`, "err"); }
    finally { delRunning = null; }
  })();
  return delRunning;
}
async function moveTracks(ids, target) {
  let fid = target === "none" ? "" : target;
  if (target === "new") { const f = askNewFolder(); if (!f) return renderSelBar(); fid = f.id; }
  await libPatchMany(ids, () => ({ folder: fid }));
  await renderLibrary();
  setMsg($("#selMsg"), `✓ ${ids.length} ${ids.length === 1 ? "Track" : "Tracks"} → ${fid ? "📁 " + folderName(fid) : "Unsortiert"}`, "ok");
}
async function favTracks(ids) {
  const all = await libAll();
  const allFav = all.filter(r => ids.includes(r.id)).every(r => r.favorite);
  await libPatchMany(ids, () => ({ favorite: !allFav }));
  await renderLibrary();
}
// ZIP ohne Kompression (Audio lässt sich kaum packen) — nur Standard-Browser, keine Bibliothek.
// Seit 3.2 nur noch für den Export: der Browser packt, was der Mac veredelt hat.
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
async function zipStore(files) {
  const d = new Date();
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const data = new Uint8Array(await f.blob.arrayBuffer());
    const name = new TextEncoder().encode(f.name);
    const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, 0, true); lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true); ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
    ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    parts.push(lh, name, data);
    central.push(ch, name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((s, p) => s + p.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: "application/zip" });
}

// ---- Cover (3.2) ----
function coverWatch() { try { const a = JSON.parse(localStorage.getItem(LS_COVERWATCH) || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
function setCoverWatch(a) { try { localStorage.setItem(LS_COVERWATCH, JSON.stringify(a.slice(-50))); } catch (e) {} }
let coverTimer = null;
function watchCover(id) { const a = coverWatch(); if (!a.includes(id)) a.push(id); setCoverWatch(a); clearTimeout(coverTimer); coverTimer = setTimeout(pollCovers, 3000); }
let coverPolling = false;
async function pollCovers() {
  if (coverPolling) return;
  const ids = coverWatch();
  if (!ids.length || !bridgeToken()) return;
  coverPolling = true;
  const left = [];
  let changed = false;
  for (const id of ids) {
    let r;
    try { r = await api("/api/render/" + id); } catch (e) { left.push(id); continue; }
    const j = r.data || {};
    if (r.status === 404) { await libPatch(id, { coverState: "" }); changed = true; continue; }   // Server neu gestartet — Nachrüsten holt es
    if (j.has_cover) {
      try { await libPatch(id, { cover: await fetchBlob(`/api/render/${id}/cover`), coverState: "done", coverAt: Date.now() }); changed = true; }
      catch (e) { left.push(id); }
      continue;
    }
    if (j.cover_state === "failed") { await libPatch(id, { coverState: "failed", coverError: j.cover_error || "" }); changed = true; continue; }
    left.push(id);
  }
  // 🔴 Audit 3.2: was WÄHREND dieses Durchlaufs dazukam, nicht überschreiben — nur Erledigtes austragen
  const done = new Set(ids.filter(id => !left.includes(id)));
  setCoverWatch(coverWatch().filter(id => !done.has(id)));
  coverPolling = false;
  if (changed) await renderLibrary();
  if (coverWatch().length) { clearTimeout(coverTimer); coverTimer = setTimeout(pollCovers, 4000); }
}
const coverUrls = new Map();   // id → {at, url} — eine Objekt-URL je Cover, nicht je Neuzeichnen
// 3.5.1: Safari kann ein frisch gelesenes Cover-Blob für Sekunden tot liefern — einmal frisch nachladen
async function coverRescue(id, img) {
  if (img.dataset.rescued) return;
  img.dataset.rescued = "1";
  const r = await freshRec(id, "cover");
  if (!r || !r.cover || !(await blobAlive(r.cover))) return;
  const c = coverUrls.get(id); if (c) URL.revokeObjectURL(c.url);
  const url = URL.createObjectURL(r.cover);
  coverUrls.set(id, { at: r.coverAt || 0, url });
  img.src = url;
}
function coverUrl(rec) {
  if (!rec || !rec.cover) return "";
  const at = rec.coverAt || 0, c = coverUrls.get(rec.id);
  if (c && c.at === at) return c.url;
  if (c) URL.revokeObjectURL(c.url);
  const url = URL.createObjectURL(rec.cover);
  coverUrls.set(rec.id, { at, url });
  return url;
}
function releaseCoverUrls(liveIds) {
  for (const [id, c] of coverUrls) if (!liveIds.has(id)) { URL.revokeObjectURL(c.url); coverUrls.delete(id); }
}
function coverHue(s) { let h = 0; for (const ch of String(s || "")) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; }
async function newCover(id) {
  let rec = await libGet(id);
  if (!rec || rec.coverState === "pending") return;      // läuft schon — kein zweiter Auftrag
  if (!macCan("cover")) return setMsg($("#libMsg"), "Für ein neues Cover muss dein Mac verbunden sein (Brücke 3.2).", "err");
  await libPatch(id, { coverState: "pending" });
  await renderLibrary();
  setMsg($("#libMsg"), `🎨 Neues Cover für „${rec.title}“ wird gemalt …`, "busy");
  if (coverOpen === id) setMsg($("#cvMsg"), "wird gemalt …", "busy");
  try {
    let j;
    try { j = await macJob("cover", trackInfo(rec), { pollMs: 2000, timeoutMs: 20 * 60e3 }); }
    catch (e) {
      if (e.code !== "archiv") throw e;
      await finishOne(rec);                 // Mac hat ihn nicht → erst ins Archiv (samt Cover)
      rec = await libGet(id);
      j = null;
    }
    if (j && j.has_cover) await libPatch(id, { cover: await fetchBlob(`/api/render/${j.id}/cover`), coverState: "done", coverAt: Date.now(), coverStamp: (j.result || {}).cover_stamp || "" });
    else if (j) throw new Error((j.result || {}).cover_error || "kein Cover");
    else if (!(rec && rec.cover)) throw new Error("kein Cover");
    setMsg($("#libMsg"), `✓ Neues Cover für „${rec.title}“`, "ok");
    if (coverOpen === id) setMsg($("#cvMsg"), "✓ neues Cover", "ok");
  } catch (e) {
    await libPatch(id, { coverState: rec.cover ? "done" : "failed" });
    setMsg($("#libMsg"), "✗ Cover: " + e.message, "err");
    if (coverOpen === id) setMsg($("#cvMsg"), "✗ " + e.message, "err");
  }
  await renderLibrary();
}

// ---- Cover groß (3.2.2): Vorschau beim Darüberfahren, Fenster über 🎨 ----
let peekTimer = null;
const canHover = () => window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
function peekShow(anchor, url, rec) {
  if (!canHover()) return;
  clearTimeout(peekTimer);
  peekTimer = setTimeout(() => {
    const box = $("#coverPeek");
    $("#coverPeek img").src = url;
    $("#coverPeek span").textContent = rec.title + (rec.variant ? " · " + rec.variant : "");
    box.classList.remove("hidden");
    // neben das Vorschaubild, aber immer ganz im Fenster
    const a = anchor.getBoundingClientRect(), w = box.offsetWidth, h = box.offsetHeight;
    let left = a.right + 12, top = a.top + a.height / 2 - h / 2;
    if (left + w > window.innerWidth - 8) left = Math.max(8, a.left - w - 12);
    top = Math.max(8, Math.min(window.innerHeight - h - 8, top));
    box.style.left = left + "px"; box.style.top = top + "px";
  }, 250);
}
function peekHide() { clearTimeout(peekTimer); $("#coverPeek").classList.add("hidden"); }
let coverOpen = null;           // id des Tracks im Cover-Fenster
async function openCover(id) {
  peekHide();
  const rec = await libGet(id);
  if (!rec) return;
  coverOpen = id;
  paintCoverDlg(rec);
  setMsg($("#cvMsg"), "", "");
  $("#coverDlg").classList.remove("hidden");
}
function paintCoverDlg(rec) {
  const url = coverUrl(rec);
  const painting = rec.coverState === "pending" || state.finishing === rec.id;
  $("#cvTitle").textContent = rec.title + (rec.variant ? " · " + rec.variant : "");
  $("#cvImg").hidden = !url;
  if (url) $("#cvImg").src = url;
  $("#cvEmpty").hidden = !!url;
  $("#cvEmpty").textContent = painting ? "🎨 Das Cover entsteht gerade …" : rec.coverState === "failed" ? "Das letzte Cover ist nicht gelungen." : "Noch kein Cover.";
  $("#coverDlg .cv-frame").classList.toggle("painting", painting);
  $("#cvNew").disabled = painting || !macCan("cover");
  $("#cvNew").textContent = url ? "🎨 Neues Cover malen" : "🎨 Cover malen";
  $("#cvSave").hidden = !url;
  $("#cvInfo").textContent = painting ? "Dauert etwa 1–3 Minuten — du kannst das Fenster schließen, das Cover kommt in die Bibliothek."
    : !macCan("cover") ? "Für ein neues Cover muss dein Mac verbunden sein." : "Gefällt es nicht? Ein neues Motiv kommt in etwa 1–3 Minuten.";
}
function closeCover() { coverOpen = null; $("#coverDlg").classList.add("hidden"); }
async function refreshCoverDlg() {
  if (!coverOpen) return;
  const rec = await libGet(coverOpen);
  if (rec) paintCoverDlg(rec); else closeCover();
}

// ---- Nachrüsten (3.2): ältere Tracks bekommen Cover, Tags, Wasserzeichen — einer nach dem anderen ----
// Einer nach dem anderen, weil Cover auf der Render-Spur entstehen: ein neuer Track wartet so
// höchstens auf EIN Cover, nie auf eine ganze Warteschlange.
function finishOff() { try { return localStorage.getItem(LS_FINISH_OFF) === "1"; } catch (e) { return false; } }
// 3.3: der Schriftzug, den der Mac auf die Cover setzt (Gegenstück zu stamp_text in der Brücke).
//    null = unbekannt (Angaben noch nicht vom Mac gelesen, oder Brücke vor 3.3) — dann nichts anstoßen.
function wantStamp() {
  const rg = state.rights;
  if (!state.rightsLoaded || !rg || !("cover_artist" in rg)) return null;
  return rg.cover_artist === false ? "" : String(rg.artist || "").replace(/\s+/g, " ").trim().slice(0, 40);
}
function stampStale(rec) { const w = wantStamp(); return !!rec.cover && w !== null && (rec.coverStamp || "") !== w; }
function needsFinish(rec) {
  const rg = state.rights || {};
  if (!rec.wm && rg.watermark !== false) return true;
  if (stampStale(rec) && rec.coverState !== "pending") return true;
  const img = (state.bridge.info || {}).image;
  return !rec.cover && !["pending", "failed"].includes(rec.coverState) && !!img && rg.cover !== false;
}
function finishTodo(all) {
  const now = Date.now(), watch = coverWatch();
  return all.filter(r => needsFinish(r) && !watch.includes(r.id) && !(r.finishFail && now - r.finishFail.at < 6 * 3600e3));
}
async function finishOne(rec) {
  // Ohne Audio zurück: veredelt wird die Datei auf dem Mac, und jeder Export kommt von dort.
  // (Sonst ginge jeder Track noch einmal durch den Tunnel Mac → Pi → Browser.)
  const j = await macJobTrack("nachruesten", rec, {}, { pollMs: 2500, timeoutMs: 30 * 60e3 });
  const rm = j.result_meta || j.result || {};
  const patch = { wm: rm.wasserzeichen || rec.wm || "", finishFail: null };
  if (goodArchived(rm.archived) && rm.archived !== (rec.result || {}).archived) patch.result = { ...(rec.result || {}), archived: rm.archived };
  if (j.has_cover) Object.assign(patch, { cover: await fetchBlob(`/api/render/${j.id}/cover`), coverState: "done", coverAt: Date.now(), coverStamp: rm.cover_stamp || "" });
  else if (rm.cover_error) Object.assign(patch, { coverState: "failed", coverError: rm.cover_error });
  await libPatch(rec.id, patch);
  return j;
}
function scheduleFinish(ms = 1500) { clearTimeout(state.finishTimer); state.finishTimer = setTimeout(finishNext, ms); }
async function finishNext() {
  if (state.finishing) return;
  let all = [];
  try { all = await libAll(); } catch (e) { return; }
  const todo = finishTodo(all);
  renderFinishLine(todo.length);
  if (!todo.length || finishOff() || !macCan("nachruesten")) return;
  todo.sort((a, b) => b.created - a.created);       // oben in der Liste zuerst
  const rec = todo[0];
  state.finishing = rec.id;
  renderFinishLine(todo.length);
  await renderLibrary();
  try {
    await finishOne(rec);
    //    Wasserzeichen auf dem Mac abgeschaltet), nahm ihn alle 800 ms wieder dran — jetzt Pause.
    const after = await libGet(rec.id);
    if (after && needsFinish(after)) await libPatch(rec.id, { finishFail: { at: Date.now(), msg: "nach dem Nachrüsten weiter unvollständig" } });
  } catch (e) { await libPatch(rec.id, { finishFail: { at: Date.now(), msg: String(e.message || e).slice(0, 200) } }); }
  state.finishing = null;
  await renderLibrary();
  scheduleFinish(800);
}
function renderFinishLine(n) {
  if (n == null) n = state.finishCount || 0;
  state.finishCount = n;
  const line = $("#finishLine");
  if (!n) { line.classList.add("hidden"); return; }
  line.classList.remove("hidden");
  const off = finishOff();
  $("#finishText").textContent = off ? `✨ ${n} ${n === 1 ? "Track wartet" : "Tracks warten"} auf Cover, Tags und Wasserzeichen — angehalten.`
    : !macCan("nachruesten") ? `✨ ${n} ${n === 1 ? "Track bekommt" : "Tracks bekommen"} Cover, Tags und Wasserzeichen, sobald dein Mac verbunden ist.`
    : `✨ Veredeln: ${n} ${n === 1 ? "Track" : "Tracks"} offen — Cover, Tags, Wasserzeichen${state.finishing ? " · gerade dran" : ""} …`;
  $("#finishToggle").textContent = off ? "▶︎ Weiter" : "⏸ Anhalten";
}

// ---- Vom Mac holen (3.2): Tracks, die nur im Archiv liegen ----
async function checkMacOnly() {
  if (!macCan("archiv")) { state.macOnly = []; renderMacOnly(); return; }
  try {
    await flushMacDeletes();
    const j = await macJob("archiv", {}, { timeoutMs: 60000 });
    const all = await libAll();
    const have = new Set([...all.map(r => (r.result || {}).archived).filter(Boolean), ...delPending(),
      ...state.pending.filter(p => p.status === "fetch").map(p => p.archived).filter(Boolean)]);
    const tracks = (j.result || {}).tracks || [];
    state.macOnly = tracks.filter(t => !have.has(t.archived));
    // 3.5: auf dem Mac aufbereitet (Spitzen repariert, leises Wasserzeichen, 24 Bit) — die Bibliothek hat die alte Kopie
    const rev = new Map(tracks.map(t => [t.archived, t.rev || 0]));
    state.macBetter = all.filter(r => (rev.get((r.result || {}).archived) || 0) > (r.rev || 0)).map(r => r.id);
    // 3.12: 🌐 nach dem Archiv — veröffentlicht oder zurückgezogen auch ohne diesen Browser (anderes Gerät, Terminal)
    const pub = new Map(tracks.filter(t => "web" in t).map(t => [t.archived, t.web]));
    let webChanged = false;
    for (const r of all) {
      const a = (r.result || {}).archived;
      if (!a || !pub.has(a)) continue;
      const w = pub.get(a);
      if (!!w === !!r.web && (!w || w.url === r.web.url)) continue;
      await libPatch(r.id, { web: w ? { url: w.url, slug: w.slug, at: Date.parse(w.at) || Date.now() } : null });
      webChanged = true;
    }
    if (webChanged) renderLibrary();
    // 3.12.4: die Regler auch am Mac hinterlegen — alles ohne diesen Browser (Veröffentlichen aus dem Terminal,
    // anderes Gerät) nahm bis hier das Standard-Mastering.
    const mac = new Map(tracks.map(t => [t.archived, t]));
    if (macCan("master_merken")) {
      const items = all.filter(r => r.master && mac.has((r.result || {}).archived) && mNorm(r.master) !== mNorm(mac.get(r.result.archived).master))
        .map(r => ({ archived: r.result.archived, master: r.master }));
      if (items.length) { try { await macJob("master_merken", { items }, { timeoutMs: 60000 }); } catch (e) { /* nächster Abgleich */ } }
    }
    // Online mit anderen Reglern gerechnet als jetzt eingestellt (oder ganz ohne)?
    state.webStale = all.filter(r => {
      const t = mac.get((r.result || {}).archived);
      return r.master && t && t.web && "web_master" in t && mNorm(r.master) !== mNorm(t.web_master);     // t.web: r.web ist hier evtl. erst frisch gesetzt
    }).map(r => r.id);
  } catch (e) { state.macOnly = []; state.macBetter = []; state.archivAsked = false; }
  renderMacOnly();
}
// Regler vergleichbar machen (Brücke und Browser runden und ordnen verschieden)
const M_KEYS = ["bass", "tone", "treble", "soft", "gain", "fade_in", "fade_out", "start", "end"];
function mNorm(m) {
  if (!m || typeof m !== "object") return "";
  const o = {};
  for (const k of M_KEYS) if (typeof m[k] === "number" && isFinite(m[k])) o[k] = Math.round(m[k] * 1000) / 1000;
  if (m.off === true) o.off = true;
  return JSON.stringify(o);
}
function renderStale() {
  const n = (state.webStale || []).length;
  $("#staleLine").classList.toggle("hidden", !n);
  if (n) $("#staleText").textContent = n === 1 ? "🌐 1 veröffentlichter Track klingt auf Fahrstuhlmusik anders als dein Mastering."
    : `🌐 ${n} veröffentlichte Tracks klingen auf Fahrstuhlmusik anders als dein Mastering.`;
}
async function updateStale() {
  const ids = [...(state.webStale || [])];
  const btn = $("#staleBtn"); btn.disabled = true;
  for (const id of ids) {
    const rec = await libGet(id);
    if (rec) await webRun(rec, "web");
  }
  btn.disabled = false;
  await checkMacOnly();
}
// Nach dem Speichern neuer Regler: auch am Mac hinterlegen (gebündelt, nicht bei jedem Zucken des Reglers)
const masterPush = new Map();
let masterPushTimer = 0;
function pushMasterSoon(id, m) {
  masterPush.set(id, m);
  clearTimeout(masterPushTimer);
  masterPushTimer = setTimeout(async () => {
    const batch = [...masterPush.entries()]; masterPush.clear();
    if (!macCan("master_merken")) return;
    const items = [];
    for (const [rid, mm] of batch) {
      const rec = await libGet(rid);
      if (rec && (rec.result || {}).archived) items.push({ archived: rec.result.archived, master: mm });
      if (rec && rec.web && !(state.webStale || []).includes(rid)) state.webStale = [...(state.webStale || []), rid];
    }
    if (items.length) { try { await macJob("master_merken", { items }, { timeoutMs: 60000 }); } catch (e) { /* nächster Abgleich */ } }
    renderStale();
  }, 2500);
}
function renderBetter() {
  const n = (state.macBetter || []).length;
  $("#betterLine").classList.toggle("hidden", !n);
  if (n) $("#betterText").textContent = `✨ ${n} ${n === 1 ? "Track klingt" : "Tracks klingen"} auf deinem Mac jetzt besser (abgeschnittene Spitzen repariert, leises Wasserzeichen, 24 Bit) — hier liegt noch die alte Kopie. Exporte kommen schon von der neuen.`;
}
async function fetchBetter() {
  const ids = [...(state.macBetter || [])];
  const btn = $("#betterBtn"); btn.disabled = true;
  let ok = 0;
  for (const [i, id] of ids.entries()) {
    const rec = await libGet(id);
    if (!rec) continue;
    setMsg($("#libMsg"), `✨ ${i + 1}/${ids.length} · „${rec.title}${rec.variant ? " · " + rec.variant : ""}“ — neue Fassung kommt vom Mac …`, "busy");
    try {
      const j = await macJob("nachruesten", { ...trackInfo(rec), audio: true }, { pollMs: 2000, timeoutMs: 30 * 60e3 });
      const rm = j.result_meta || {};
      const blob = await fetchBlob(`/api/render/${j.id}/audio`);
      // nur Ton, Wellenform und Fassung — Regler, Ordner, Favorit, Cover bleiben
      await libPatch(id, { blob, peaks: await computePeaks(blob), rev: rm.rev || 0, wm: rm.wasserzeichen || rec.wm || "" });
      if (ms.id === id) { msForget(); if (!$("#masterView").classList.contains("hidden")) loadMaster(id); }   // neue Fassung: alles neu
      else ms.bufs.delete(id);
      ok++;
    } catch (e) { setMsg($("#libMsg"), `✗ „${rec.title}“: ${e.message}`, "err"); }
  }
  btn.disabled = false;
  await checkMacOnly();
  await renderLibrary();
  if (ok) setMsg($("#libMsg"), `✓ ${ok} ${ok === 1 ? "Track" : "Tracks"} in der neuen Fassung`, "ok");
}
function renderMacOnly() {
  renderBetter(); renderStale();
  const n = state.macOnly.length;
  $("#macOnlyLine").classList.toggle("hidden", !n);
  if (!n) { $("#macOnlyList").classList.add("hidden"); $("#macOnlyMore").textContent = "Liste ▾"; }
  if (n) $("#macOnlyText").textContent = `📥 ${n} ${n === 1 ? "Track liegt" : "Tracks liegen"} nur auf deinem Mac: ` +
    state.macOnly.slice(0, 3).map(t => `„${t.title}${t.variant ? " · " + t.variant : ""}“`).join(", ") + (n > 3 ? " …" : "");
  // 3.6: einzeln holen oder endgültig löschen (früher hier gelöschte Songs lagen weiter auf dem Mac)
  const box = $("#macOnlyList");
  box.innerHTML = "";
  state.macOnly.forEach(t => {
    const row = el("div", "mo-row");
    row.dataset.archived = t.archived;
    row.append(el("span", "mo-title", `${t.title}${t.variant ? " · " + t.variant : ""}`),
      el("span", "mo-meta", [t.created, t.duration ? fmtDur(t.duration) : ""].filter(Boolean).join(" · ")));
    const get = el("button", "ghost btn-s", "📥"); get.type = "button"; get.title = "In die Bibliothek holen";
    get.onclick = () => fetchMacOnly([t]);
    const del = el("button", "ghost btn-s danger", "🗑"); del.type = "button"; del.title = "Auf dem Mac löschen (Papierkorb)";
    del.onclick = () => deleteMacOnly([t]);
    row.append(get, del);
    box.append(row);
  });
}
async function deleteMacOnly(list) {
  const what = list.length === 1 ? `„${list[0].title}${list[0].variant ? " · " + list[0].variant : ""}“` : `${list.length} Tracks`;
  if (!confirm(`${what} auf deinem Mac löschen?\nAudio, Cover und Original wandern in den Papierkorb (dort bis zum Leeren zurückholbar).`)) return;
  delPendingAdd(list.map(t => t.archived));
  state.macOnly = state.macOnly.filter(t => !list.includes(t));
  renderMacOnly();
  await flushMacDeletes(true);
}
// 3.6.1: einen Track aus dem Mac-Archiv in die Bibliothek legen — 📥 und Nachladen nach abgebrochenem Abholen
async function fetchFromMac(t, { id, created, folder = "" } = {}) {
  const day = (String(t.archived).match(/\/(\d{4}-\d{2}-\d{2})\//) || [])[1] || t.created || "";
  const j = await macJob("nachruesten", { archived: t.archived, title: t.title, variant: t.variant || "", created: day, audio: true }, { pollMs: 2000, timeoutMs: 30 * 60e3 });
  const rm = j.result_meta || {}, tr = rm.track || {}, tm = tr.meta || {};
  const blob = await fetchBlob(`/api/render/${j.id}/audio`);
  const rec = { id: id || j.id, created: created || Date.now(), title: tm.title || t.title, variant: tm.variant || "", group: tm.group || "",
    note: tm.note || "", request: tr.request || {}, result: { ...(tr.result || {}), archived: rm.archived || t.archived },
    favorite: false, blob, peaks: await computePeaks(blob), folder, wm: rm.wasserzeichen || "", rev: rm.rev || 0 };
  if (j.has_cover) Object.assign(rec, { cover: await fetchBlob(`/api/render/${j.id}/cover`), coverState: "done", coverAt: Date.now(), coverStamp: rm.cover_stamp || "" });
  await libPut(rec);
  state.fresh.add(rec.id);
  return rec;
}
async function fetchMacOnly(only) {
  const list = Array.isArray(only) ? [...only] : [...state.macOnly];
  const btn = $("#macOnlyBtn");
  btn.disabled = true;
  let ok = 0;
  for (const [i, t] of list.entries()) {
    // 🔴 Audit 3.2: kam der Track inzwischen auf dem normalen Weg an (Neuladen, Abholen läuft), nicht doppelt holen
    if ((await libAll()).some(r => (r.result || {}).archived === t.archived)) continue;
    setMsg($("#libMsg"), `📥 ${i + 1}/${list.length} · „${t.title}“ wird geholt (mit Cover, Tags, Wasserzeichen) …`, "busy");
    try {
      const created = Date.parse(`${t.created}T${(t.time || "120000").replace(/(\d\d)(\d\d)(\d\d)/, "$1:$2:$3")}`) || Date.now();
      await fetchFromMac(t, { created, folder: targetFolder() });
      ok++;
    } catch (e) { setMsg($("#libMsg"), `✗ „${t.title}“: ${e.message}`, "err"); }
  }
  btn.disabled = false;
  await renderLibrary();
  await checkMacOnly();
  if (ok) setMsg($("#libMsg"), `✓ ${ok} ${ok === 1 ? "Track" : "Tracks"} vom Mac geholt`, "ok");
}

// ---- Export (3.2) ----
let expIds = [];
let exporting = 0;        // laufender Export (Nummer) — 🔴 Audit 3.2: Doppelklick / Wiederöffnen startete einen zweiten
function exportPrefs() { try { return JSON.parse(localStorage.getItem(LS_EXPORT) || "{}") || {}; } catch (e) { return {}; } }
function rightsCached() { if (state.rights) return state.rights; try { return JSON.parse(localStorage.getItem(LS_RIGHTS) || "null"); } catch (e) { return null; } }
function copyrightText(rg) {
  if (!rg) return "";
  const year = String(new Date().getFullYear()), owner = rg.owner || "", artist = rg.artist || owner;
  return (rg.copyright || "").replace(/\{(jahr|year)\}/g, year).replace(/\{(inhaber|owner)\}/g, owner).replace(/\{(kuenstler|künstler|artist)\}/g, artist).trim();
}
async function openExport(ids) {
  if (!ids.length) return;
  if (exporting) { $("#exportDlg").classList.remove("hidden"); return; }   // der laufende Export bleibt sichtbar
  expIds = ids;
  const pref = exportPrefs();
  const box = $("#expFormats");
  box.innerHTML = "";
  [["Verlustbehaftet", false], ["Verlustfrei", true]].forEach(([head, lossless]) => {
    box.append(el("div", "exp-head", head));
    EXPORT_FORMATS.filter(f => f.lossless === lossless).forEach(f => {
      const lab = el("label", "exp-opt");
      const inp = el("input");
      inp.type = "radio"; inp.name = "expFmt"; inp.value = f.id; inp.id = "expFmt-" + f.id;
      inp.checked = f.id === (pref.format || "mp3");
      lab.append(inp, el("b", "", f.name), el("span", "sub", f.hint));
      box.append(lab);
    });
  });
  $("#expRate").value = String(pref.rate || 0);
  $("#expBits").value = String(pref.bits === 16 ? 16 : 24);
  $("#expMaster").checked = pref.master !== false;
  const canP = macCan("paket");
  $("#expPack").checked = canP && !!pref.paket;
  $("#expPack").disabled = !canP;
  $("#expOwnText").checked = false;
  $("#expPackTxt").textContent = canP ? "— als ZIP: Musik, Cover 3000 × 3000, Metadaten mit KI-Angaben, Liedtext, Herkunftsnachweis (PDF), Lizenzvorlage für Firmen (Word)"
    : "— braucht die Brücke 3.9 auf deinem Mac (⚙️ › Mac einrichten)";
  updPack();
  updExpNote();
  const all = await libAll();
  const recs = all.filter(r => ids.includes(r.id));
  const own = recs.filter(r => r.master).length;
  if (own) $("#expMaster").checked = true;     // 3.7: eigene Einstellungen gelten — ein früher abgewählter Haken bleibt nicht hängen
  const canM = macCan("master");
  $("#expMaster").disabled = !canM;
  $("#expMasterTxt").textContent = !canM ? "— braucht die Brücke 3.4 auf deinem Mac"
    : recs.length === 1 ? (own ? "— deine Einstellungen aus 🎚" : "— Vorschlag: weich, Ende gekürzt, −14 LUFS (anpassen mit 🎚)")
    : `— ${own ? own + " mit eigenen Einstellungen, " : ""}${recs.length - own} mit Vorschlag`;
  $("#expWhat").textContent = recs.length === 1 ? `„${recs[0].title}${recs[0].variant ? " · " + recs[0].variant : ""}“` : `${recs.length} Tracks — kommen als eine ZIP-Datei`;
  const rg = rightsCached();
  $("#expCopy").textContent = rg ? copyrightText(rg) : "Copyright aus ⚙️";
  const can = macCan("export");
  $("#expGo").disabled = !can;
  setMsg($("#expMsg"), can ? "" : "Export braucht deinen Mac (Brücke ab 3.2) — er schreibt Cover, Tags und Wasserzeichen hinein.", can ? "" : "err");
  $("#exportDlg").classList.remove("hidden");
}
function updExpNote() {
  const id = (document.querySelector("input[name=expFmt]:checked") || {}).value;
  const f = EXPORT_FORMATS.find(x => x.id === id) || {};
  const box = $("#expNote");
  box.classList.toggle("hidden", !APPLE_NOTE[f.apple]);
  $("#expNoteText").textContent = APPLE_NOTE[f.apple] || "";
}
function updPack() {
  const on = $("#expPack").checked;
  $("#expOwnTextWrap").hidden = !on;
  $("#expGo").textContent = on ? "📦 Paket schnüren" : "Exportieren";
}
function closeExport() { $("#exportDlg").classList.add("hidden"); }
async function doExport() {
  if (exporting) return;
  const run = exporting = Date.now();
  $("#expGo").disabled = true;
  const fmt = (document.querySelector("input[name=expFmt]:checked") || {}).value || "mp3";
  const rate = +$("#expRate").value || 0;
  const bits = +$("#expBits").value === 16 ? 16 : 24;
  const mastered = $("#expMaster").checked;
  const pack = $("#expPack").checked && macCan("paket");
  const ownText = pack && $("#expOwnText").checked;
  try { localStorage.setItem(LS_EXPORT, JSON.stringify({ format: fmt, rate, bits, master: mastered, paket: pack })); } catch (e) {}
  const all = await libAll();
  const order = visibleIds();
  const recs = all.filter(r => expIds.includes(r.id)).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const go = $("#expGo");
  const files = [], used = new Set();
  try {
    if (!recs.length) throw new Error("Die gewählten Tracks sind nicht mehr in der Bibliothek.");
    for (let [i, rec] of recs.entries()) {
      const pre = recs.length > 1 ? `${i + 1}/${recs.length} · ` : "";
      // Ein Cover, das gerade gemalt wird, soll mit in die Datei — kurz darauf warten
      // (gefunden im Prüfstand: ein MP3 direkt nach dem Rechnen kam ohne Cover).
      for (let t = 0; rec && rec.coverState === "pending" && t < 120; t++) {
        setMsg($("#expMsg"), `${pre}„${rec.title}“ — wartet auf das Cover, das gerade entsteht …`, "busy");
        await sleep(3000);
        rec = (await libGet(rec.id)) || rec;
      }
      setMsg($("#expMsg"), `${pre}„${rec.title}“ — dein Mac ${pack ? "schnürt das Paket" : "erzeugt die Datei"} …`, "busy");
      const extra = macCan("master") ? { bits, ...(mastered ? (rec.master ? { master: rec.master } : {}) : { master: { off: true } }) } : {};
      if (pack) extra.paket = { text_eigen: ownText };
      const j = await macJobTrack("export", rec, { format: fmt, rate, ...extra }, { timeoutMs: 15 * 60e3, onMsg: (x) => x.message && setMsg($("#expMsg"), pre + x.message, "busy") });
      const rm = j.result_meta || {};
      const blob = await fetchBlob(`/api/render/${j.id}/audio`);
      let name = rm.filename || `${safe(rec.title)}${pack ? "_Paket.zip" : "." + fmt}`;
      for (let k = 2; used.has(name); k++) name = name.replace(/(_\d+)?(\.[a-z0-9]+)$/, `_${k}$2`);
      used.add(name);
      files.push({ name, blob });
      if (goodArchived(rm.archived) && rm.archived !== (rec.result || {}).archived) {
        const cur = (await libGet(rec.id)) || rec;           // frisch lesen: nichts Älteres zurückschreiben
        await libPatch(rec.id, { result: { ...(cur.result || {}), archived: rm.archived } });
      }
      if (rm.wasserzeichen && !rec.wm) await libPatch(rec.id, { wm: rm.wasserzeichen });
    }
    const label = (EXPORT_FORMATS.find(f => f.id === fmt) || {}).name || fmt;
    if (files.length === 1) download(files[0].blob, files[0].name);
    else {
      const bytes = files.reduce((s, f) => s + f.blob.size, 0);
      if (bytes > 1.8e9) throw new Error(`Zu groß für eine ZIP (${fmtBytes(bytes)}) — bitte weniger auswählen.`);
      download(await zipStore(files), `Manuwave_Studio_${pack ? "Pakete" : safe(label)}_${new Date().toISOString().slice(0, 10)}.zip`);
    }
    setMsg($("#expMsg"), `✓ ${files.length === 1 ? files[0].name : files.length + " Dateien als ZIP"} · ${fmtBytes(files.reduce((s, f) => s + f.blob.size, 0))}`, "ok");
    setTimeout(() => { if (!exporting) closeExport(); }, 1600);
  } catch (e) {
    setMsg($("#expMsg"), "✗ " + e.message, "err");
  } finally {
    if (exporting === run) exporting = 0;
    go.disabled = !macCan("export");
    renderLibrary();
  }
}

// ---- Mastering (3.7 — neu gebaut) ----
//    Bis 3.6 wirkten die Regler nur in der Vorschau und im Export; ▶︎ in der Bibliothek spielte immer die Rohfassung.
//    Jetzt ein Weg für alles (Kette in mastering.js):
//      Regler ändern → sofort gespeichert (rec.master, Sicherheitsnetz in localStorage)
//      Bibliothek ▶︎  → spielt genau diese Fassung (fehlt sie oder ist sie veraltet: wird gerechnet, dann gespielt)
//      Export         → der Mac rechnet dieselbe Kette aus rec.master (24 Bit)
//    Ein Track ohne eigene Einstellungen spielt in der Bibliothek roh; bloßes Öffnen im Tab speichert nichts.
const MS_KNOBS = { msBass: "bass", msTone: "tone", msTreble: "treble", msSoft: "soft", msFadeIn: "fade_in", msFadeOut: "fade_out" };
const MS_ZERO = { bass: 0, tone: 0, treble: 0, soft: 0, fade_in: 0 };     // fehlende Regler = 0 (so liest sie auch der Mac)
const ms = { id: null, rec: null, buf: null, m: null, own: false, savedJson: "", hist: [], lastEdit: 0, pos: 0, ab: "B", playing: false,
  audio: null, playStart: 0, prev: null, rendering: null, renderTimer: 0, saveTimer: 0, storeTimer: 0, pending: null, run: 0,
  lufs: new Map(), peaks: null, drag: null, orig: null, raf: 0, lastAutoGain: 0, bufs: new Map() };

function fmtCut(s) { s = Math.max(0, +s || 0); const m = Math.floor(s / 60); return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0").replace(".", ",")}`; }
const msLen = () => ms.buf ? ms.buf.duration : 0;
const msStart = () => cutOf(ms.m, msLen()).start;
const msEnd = () => cutOf(ms.m, msLen()).end;
const msClean = () => masterClean(ms.m, msLen());
// Schlüssel einer gemasterten Fassung: Einstellungen + Fassung und Größe des Originals
const recKey = (rec, master) => masterKey(master, rec && rec.rev, rec && rec.blob ? rec.blob.size : 0);
const msKeyNow = () => recKey(ms.rec, msClean());
const msGain = () => ms.m.gain != null ? ms.m.gain : (ms.prev && ms.prev.key === msKeyNow() ? ms.prev.gain : ms.lastAutoGain);

// ---- Speichern: jede Änderung sofort (3.5), aber NUR echte Änderungen ----
const LS_TAB = "nf_tab";                       // "studio" | "master" | "selber" | "loops"
const LS_MS_TRACK = "nf_mastering_track";      // zuletzt gemasterter Track
const LS_MS_PENDING = "nf_mastering_pending";  // { id, m } — noch nicht in IndexedDB angekommen
function msBefore(step = false) {
  if (!ms.m) return;
  const now = Date.now();
  if (step || now - (ms.lastEdit || 0) > 700) { ms.hist.push(JSON.stringify(ms.m)); if (ms.hist.length > 60) ms.hist.shift(); }
  ms.lastEdit = step ? 0 : now;
  $("#msUndo").disabled = !ms.hist.length;
}
// Nach jeder Änderung: anzeigen, speichern, neu rechnen
function msChanged(render = true) {
  if (!ms.m) return;
  paintMaster();
  msSave();
  if (render) msSchedule();
}
function msSave() {
  if (!ms.id || !ms.m) return;
  const id = ms.id, m = msClean(), json = JSON.stringify(m);
  if (ms.own && ms.savedJson === json) return;
  ms.own = true; ms.savedJson = json;
  try { localStorage.setItem(LS_MS_PENDING, JSON.stringify({ id, m })); } catch (e) {}
  ms.pending = { id, m };
  clearTimeout(ms.saveTimer);
  ms.saveTimer = setTimeout(() => msFlush(id, m), 300);
  $("#msSavedTxt").textContent = "speichert …";
}
async function msFlush(id, m) {
  clearTimeout(ms.saveTimer);
  if (ms.pending && ms.pending.id === id && JSON.stringify(ms.pending.m) === JSON.stringify(m)) ms.pending = null;
  try {
    await libPatch(id, { master: m });
    pushMasterSoon(id, m);
    let p = null; try { p = JSON.parse(localStorage.getItem(LS_MS_PENDING) || "null"); } catch (e) {}
    if (p && p.id === id && JSON.stringify(p.m) === JSON.stringify(m)) localStorage.removeItem(LS_MS_PENDING);
    if (ms.id === id) {
      ms.rec = { ...ms.rec, master: m };
      if (!ms.pending) $("#msSavedTxt").innerHTML = '<span class="ok">✓ gespeichert</span> — so klingt der Track jetzt auch in der Bibliothek und im Export';
      msStoreSoon();
    }
    const b = document.querySelector(`#libList .lib-row[data-id="${id}"] .lib-act button.ms-btn`);
    if (b) b.classList.add("on");
  } catch (e) { $("#msSavedTxt").textContent = "✗ Speichern fehlgeschlagen — der Stand liegt im Browser und wird beim nächsten Start nachgeholt"; }
}
function msFlushNow() { if (ms.pending) return msFlush(ms.pending.id, ms.pending.m); }
// Was vor dem letzten Schließen nicht mehr in IndexedDB kam, jetzt nachholen
async function msRecoverPending() {
  let p = null; try { p = JSON.parse(localStorage.getItem(LS_MS_PENDING) || "null"); } catch (e) {}
  if (!p || !p.id || !p.m) return;
  try { if (await libGet(p.id)) await libPatch(p.id, { master: p.m }); localStorage.removeItem(LS_MS_PENDING); } catch (e) {}
}
// Die gerechnete Vorschau am Track ablegen — nur wenn sie zu den GESPEICHERTEN Einstellungen gehört
function msStoreSoon(wait = 600) { clearTimeout(ms.storeTimer); ms.storeTimer = setTimeout(msStoreNow, wait); }
async function msStoreNow() {
  clearTimeout(ms.storeTimer);
  const p = ms.prev, id = ms.id;
  if (!p || !id || !ms.own || ms.pending) return false;
  try { return await storeMastered(id, p.key, p); }
  catch (e) { return false; }         // die Bibliothek rechnet sie dann beim Abspielen selbst
}
// Tab verlassen / anderer Track: Einstellungen und gemasterte Fassung sind sicher, bevor es weitergeht
async function msLeave() {
  msStop();
  await msFlushNow();
  // eine noch wartende Rechnung (200 ms nach der letzten Änderung) jetzt machen — sonst rechnete die Bibliothek sie doppelt
  if (ms.own && ms.buf && ms.m && (!ms.prev || ms.prev.key !== msKeyNow())) { clearTimeout(ms.renderTimer); try { await msPrepare(); } catch (e) {} }
  const p = ms.rendering && ms.rendering.p;
  if (p) { try { await p; } catch (e) {} }
  await msStoreNow();
}

// ---- Vorschau: die gemasterte Fassung rechnen (dieselbe, die die Bibliothek spielt) ----
function msSchedule(wait = 200) {
  if (!ms.buf || !ms.m) return;
  clearTimeout(ms.renderTimer);
  ms.renderTimer = setTimeout(() => { msPrepare().catch(e => setMsg($("#msMsg"), "✗ Mastering nicht berechenbar: " + e.message, "err")); }, ms.prev ? wait : 0);
}
async function msPrepare() {
  for (;;) {
    if (!ms.buf || !ms.m) return null;
    const key = msKeyNow(), run = ms.run;
    if (ms.prev && ms.prev.key === key) return ms.prev;
    if (ms.rendering) {                                  // eine Rechnung zur Zeit; danach prüfen, ob sie noch passt
      if (ms.rendering.key === key) return ms.rendering.p;
      try { await ms.rendering.p; } catch (e) {}
      continue;
    }
    const m = msClean(), buf = ms.buf;
    const p = (async () => {
      const t0 = performance.now();
      const out = await masterAudio(buf, m, ms.lufs);
      if (run !== ms.run) return null;
      const prev = { ...out, key, url: URL.createObjectURL(out.blob), ms: Math.round(performance.now() - t0) };
      $("#msWave").dataset.renderMs = prev.ms;            // wie lange das Rechnen dauerte (auch für den Prüfstand)
      if (out.lufs != null) { $("#msGain").dataset.lufs = out.lufs.toFixed(2); ms.lastAutoGain = out.gain; }
      const old = ms.prev; ms.prev = prev;
      paintGain();
      if (ms.playing && ms.ab === "B") msSwap(prev);     // läuft gerade: an derselben Stelle auf die neue Fassung
      if (old) setTimeout(() => URL.revokeObjectURL(old.url), 3000);
      if (ms.own && !ms.pending) msStoreSoon();
      return prev;
    })();
    ms.rendering = { key, p };
    try { return await p; } finally { if (ms.rendering && ms.rendering.p === p) ms.rendering = null; }
  }
}

// ---- Abspielen (ein <audio>, im Klick gestartet — Safari) ----
function msAudio() {
  if (ms.audio) return ms.audio;
  const a = ms.audio = new Audio();
  a.preload = "auto";
  a.onended = () => { if (!ms.playing || a.muted) return; ms.pos = ms.ab === "B" ? msStart() : 0; msStop(false); paintMaster(); };
  return a;
}
function msNow() {
  if (!ms.playing || !ms.audio) return ms.pos;
  if (ms.audio.muted) return ms.pos;                          // wartet auf die Rechnung
  return (ms.playStart || 0) + (ms.audio.currentTime || 0);   // playStart: 0 beim Original, Schnittanfang beim Master
}
function msStop(keep = true) {
  if (keep && ms.playing) ms.pos = msNow();
  ms.playing = false;
  if (ms.audio) { ms.audio.pause(); ms.audio.muted = false; }
  cancelAnimationFrame(ms.raf);
  $("#msPlay").textContent = "▶︎ Abspielen";
}
function msOrigUrl() {
  if (!ms.orig || ms.orig.id !== ms.id || ms.orig.blob !== ms.rec.blob) {
    if (ms.orig) URL.revokeObjectURL(ms.orig.url);
    ms.orig = { id: ms.id, blob: ms.rec.blob, url: URL.createObjectURL(ms.rec.blob) };
  }
  return ms.orig.url;
}
function msLoad(url, off, start) {
  const a = msAudio();
  ms.playStart = start;
  const go = () => { try { a.currentTime = Math.max(0, off); } catch (e) {} };
  if (a.src !== url) { a.src = url; a.addEventListener("loadedmetadata", go, { once: true }); } else go();
}
function msSwap(prev) {
  const a = msAudio(), t = msNow();
  msLoad(prev.url, Math.min(prev.end - prev.start - 0.05, Math.max(0, t - prev.start)), prev.start);
  a.muted = false;
  a.play().catch(() => {});
}
// Muss im Klick laufen: das <audio> wird hier — in der Nutzeraktion — gestartet
function msPlay(at) {
  stopPlayer();                       // nie zwei Wiedergaben übereinander
  if (ms.playing) msStop(false);
  let pos = at != null ? at : ms.pos;
  if (ms.ab === "B" && (pos < msStart() || pos >= msEnd() - 0.05)) pos = msStart();
  if (pos >= msLen() - 0.05) pos = 0;
  const a = msAudio();
  ms.playing = true; ms.pos = pos;
  $("#msPlay").textContent = "⏸ Pause";
  if (ms.ab === "A") {
    msLoad(msOrigUrl(), pos, 0); a.muted = false;
    a.play().catch(() => msStop());
  } else if (ms.prev && ms.prev.key === msKeyNow()) {
    msLoad(ms.prev.url, pos - ms.prev.start, ms.prev.start); a.muted = false;
    a.play().catch(() => msStop());
  } else {
    // Noch nicht gerechnet: das Element JETZT (im Klick) stumm starten, damit Safari es nachher spielen lässt
    msLoad(msOrigUrl(), pos, 0); a.muted = true; a.play().catch(() => {});
    setMsg($("#msMsg"), "⏳ Mastering wird gerechnet …", "busy");
    msPrepare().then(prev => {
      if (($("#msMsg").dataset.msg || "").startsWith("⏳")) setMsg($("#msMsg"), "", "");
      if (!prev || !ms.playing || ms.ab !== "B" || !a.muted) return;
      msLoad(prev.url, ms.pos - prev.start, prev.start);
      a.muted = false; a.play().catch(() => msStop());
    }).catch(e => { setMsg($("#msMsg"), "✗ Mastering nicht berechenbar: " + e.message, "err"); msStop(); });
  }
  const tick = () => {
    if (!ms.playing) return;
    const t = msNow();
    if (ms.ab === "B" && !a.muted && t >= msEnd()) { ms.pos = msStart(); msStop(false); paintMaster(); return; }
    paintMasterWave(t);
    $("#msTime").textContent = `${fmtCut(t)} / ${fmtCut(msLen())}`;
    ms.raf = requestAnimationFrame(tick);
  };
  cancelAnimationFrame(ms.raf);
  tick();
}

// ---- Zeichnen ----
function msPeaks(w) {
  const d0 = ms.buf.getChannelData(0), d1 = ms.buf.numberOfChannels > 1 ? ms.buf.getChannelData(1) : d0;
  const per = Math.max(1, Math.floor(ms.buf.length / w)), out = new Float32Array(w);
  for (let i = 0; i < w; i++) { let mx = 0; for (let k = i * per, e = Math.min(ms.buf.length, k + per); k < e; k += 4) { const v = Math.max(Math.abs(d0[k]), Math.abs(d1[k])); if (v > mx) mx = v; } out[i] = mx; }
  return out;
}
function paintMasterWave(t) {
  const cv = $("#msWave"); if (!ms.buf || !ms.m) return;
  const w = Math.max(200, Math.round(cv.clientWidth * (window.devicePixelRatio || 1))), h = cv.height;
  if (cv.width !== w || !ms.peaks || ms.peaks.length !== w) { cv.width = w; ms.peaks = msPeaks(w); }
  const g = cv.getContext("2d"), L = msLen(), x = (s) => s / L * w, cs = getComputedStyle(document.body);
  g.clearRect(0, 0, w, h);
  const xs = x(msStart()), xe = x(msEnd());
  for (let i = 0; i < w; i++) {
    const a = ms.peaks[i] * (h / 2 - 2), inside = i >= xs && i <= xe;
    g.fillStyle = inside ? (cs.getPropertyValue("--neon").trim() || "#22e3c3") : "rgba(148,160,200,.35)";
    g.fillRect(i, h / 2 - a, 1, Math.max(1, a * 2));
  }
  g.fillStyle = "rgba(5,6,12,.55)"; g.fillRect(0, 0, xs, h); g.fillRect(xe, 0, w - xe, h);
  // Ein- und Ausblenden als Rampe
  g.strokeStyle = "rgba(255,179,71,.9)"; g.lineWidth = 2; g.beginPath();
  const fi = ms.m.fade_in || 0, fo = ms.m.fade_out || 0;
  g.moveTo(xs, fi ? h - 2 : 2); g.lineTo(x(msStart() + fi), 2); g.lineTo(x(msEnd() - fo), 2); g.lineTo(xe, fo ? h - 2 : 2); g.stroke();
  // Griffe
  g.fillStyle = "#ffb347";
  [xs, xe].forEach(px => { g.fillRect(px - 2, 0, 4, h); g.fillRect(px - 7, h / 2 - 12, 14, 24); });
  if (t != null) { g.fillStyle = "#fff"; g.fillRect(x(t) - 1, 0, 2, h); }
}
const sgnDb = (v, u = " dB") => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(1).replace(".", ",")}${u}`;
function paintGain() {
  if (!ms.m) return;
  $("#msGain").value = msGain();
  $("#msGainV").textContent = sgnDb(msGain()) + (ms.m.gain == null ? " (auto)" : "");
  $("#msAuto").setAttribute("aria-pressed", String(ms.m.gain == null)); $("#msAuto").classList.toggle("on", ms.m.gain == null);
}
function paintMaster() {
  const m = ms.m;
  if (!m) return;
  Object.entries(MS_KNOBS).forEach(([id, k]) => { $("#" + id).value = m[k] || 0; });
  $("#msBassV").textContent = sgnDb(m.bass || 0); $("#msTrebleV").textContent = sgnDb(m.treble || 0);
  $("#msToneV").textContent = (m.tone || 0) === 0 ? "neutral" : (m.tone < 0 ? "wärmer " : "heller ") + Math.abs(m.tone).toFixed(1).replace(".", ",");
  $("#msSoftV").textContent = (m.soft || 0) ? `−${(m.soft).toFixed(1).replace(".", ",")} dB` : "aus";
  paintGain();
  $("#msFadeInV").textContent = `${(m.fade_in || 0).toFixed(1).replace(".", ",")} s`;
  $("#msFadeOutV").textContent = `${(m.fade_out || 0).toFixed(1).replace(".", ",")} s`;
  $("#msStartTxt").textContent = fmtCut(msStart());
  $("#msEndTxt").textContent = `${fmtCut(msEnd())}${msEnd() < msLen() - 0.05 ? ` (−${(msLen() - msEnd()).toFixed(1).replace(".", ",")} s)` : ""}`;
  $("#msA").classList.toggle("on", ms.ab === "A"); $("#msA").setAttribute("aria-pressed", String(ms.ab === "A"));
  $("#msB").classList.toggle("on", ms.ab === "B"); $("#msB").setAttribute("aria-pressed", String(ms.ab === "B"));
  if (!ms.playing) $("#msTime").textContent = `${fmtCut(ms.pos)} / ${fmtCut(msLen())}`;
  $$(".ms-presets [data-preset]").forEach(b => { const p = MASTER_PRESETS[b.dataset.preset];
    b.classList.toggle("on", Object.keys(p).every(k => (m[k] || 0) === p[k])); });
  paintMasterWave(ms.playing ? msNow() : ms.pos);
}

window.mwsLibrary = {
  async add({ title, blob, bpm, keyscale, caption, duration, project, note, derived }) {
    const rec = {
      id: "sb" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), created: Date.now(), title: title || "Track", variant: "",
      group: "", note: note || "", source: derived ? "" : "eigen", derived: !!derived, sbProject: project || "",
      request: { caption: caption || "", bpm: bpm || 0, keyscale: keyscale || "", duration: Math.round(duration || 0) },
      result: { bpm: bpm || 0, keyscale: keyscale || "", duration: duration || 0, caption: caption || "" },
      favorite: false, blob, peaks: await computePeaks(blob), folder: targetFolder(), wm: "", coverState: "",
    };
    await libPut(rec);
    state.fresh.add(rec.id);
    await renderLibrary();
    scheduleFinish(600);
    return rec;
  },
  master(id) { showTab("master"); openMaster(id); },
  // 3.17: Loop-Maschine → die Musik-KI baut weiter. Läuft wie jeder Render über die Warteschlange (Fortschritt im Studio,
  // Abholen, Cover, Wasserzeichen) — der fertige Song ist ein KI-Track (Herkunft nicht "eigen").
  canWeiter: () => macCan("weiter"),
  connected: () => !!state.bridge.connected,
  dits: () => String((state.bridge.info || {}).dits || "").split(",").filter(Boolean),
  async weiter({ blob, request, title, note }) {
    const meta = { title: String(title || "Loop").slice(0, 80), variant: "", group: "", note: note || "" };
    const r = await api("/api/job/upload", { method: "POST", raw: blob, headers: { "x-nf-job": encodeURIComponent(JSON.stringify({ kind: "weiter", request, meta })) } });
    if (!r.ok) throw new Error((r.data && r.data.message) || "HTTP " + r.status);
    state.pending.push({ id: r.data.id, title: meta.title, variant: "", group: "", created: Date.now(), folder: targetFolder(), req: null, meta });
    savePending(); renderQueue(); schedulePoll(1500);
    return r.data.id;
  },
  // 3.16: Songs mit MIDI-Abbild für "Selber machen"
  async midiTracks() { return (await libAll()).filter(r => r.midi && r.midi.tracks).sort((a, b) => (b.created || 0) - (a.created || 0))
    .map(r => ({ id: r.id, title: r.title, variant: r.variant || "", bpm: r.midi.bpm || 0 })); },
  get: (id) => libGet(id),
};

// ---- 3.16: MIDI-Abbild — jeder KI-Song wird auf dem Mac in Noten übersetzt (Drums, Bass, Akkorde, Melodie) ----
// Der Mac rechnet im Hintergrund, nur wenn er sonst nichts tut; der Browser holt fertige Abbilder ab (je Abgleich 10).
const MIDI_V = 1;
async function syncMidi() {
  if (!macCan("midi") || state.midiBusy) return;
  state.midiBusy = true;
  try {
    const all = await libAll();
    const want = all.filter(r => r.source !== "eigen" && !r.derived && goodArchived((r.result || {}).archived) && !(r.midi && r.midiV === MIDI_V) && r.midiState !== "none")
      .sort((a, b) => (b.created || 0) - (a.created || 0)).slice(0, 10);
    if (!want.length) return;
    const j = await macJob("midi", { archived: want.map(r => r.result.archived) }, { timeoutMs: 90000 });
    const data = JSON.parse(await (await fetchBlob(`/api/render/${j.id}/audio`)).text());
    let changed = false;
    for (const r of want) {
      const it = (data.items || {})[r.result.archived] || {};
      if (it.state === "ok" && it.data) { await libPatch(r.id, { midi: it.data, midiFile: it.mid || "", midiV: data.v || MIDI_V, midiState: "ok" }); changed = true; }
      else if (it.state && it.state !== r.midiState) { await libPatch(r.id, { midiState: it.state }); changed = true; }
    }
    if (changed) { renderLibrary(); if (window.mwsSelber && window.mwsSelber.refreshLib) window.mwsSelber.refreshLib(); }
  } catch (e) { /* nächster Abgleich */ }
  finally { state.midiBusy = false; }
}
setInterval(syncMidi, 120000);
function downloadMidi(rec) {
  const bin = atob(rec.midiFile || ""), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([u8], { type: "audio/midi" }));
  a.download = (rec.title || "Track").replace(/[\\/:*?"<>|]+/g, "").trim() + (rec.variant ? " " + rec.variant : "") + ".mid";
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// ---- Tab, Trackwahl, Laden ----
function showTab(name) {
  const master = name === "master", selber = name === "selber", loops = name === "loops";
  if (!$("#selberView").classList.contains("hidden") && !selber && window.mwsSelber) window.mwsSelber.show(false);
  // 3.17: vierter Tab "Loop-Maschine" (web/loops.js) — läuft weiter, wenn man den Tab wechselt (wie ein Gerät)
  if (!$("#loopView").classList.contains("hidden") && !loops && window.mwsLoops) window.mwsLoops.show(false);
  $("#studioView").classList.toggle("hidden", master || selber || loops);
  $("#masterView").classList.toggle("hidden", !master);
  $("#selberView").classList.toggle("hidden", !selber);
  $("#loopView").classList.toggle("hidden", !loops);
  [["#tabStudio", !master && !selber && !loops], ["#tabMaster", master], ["#tabSelber", selber], ["#tabLoops", loops]].forEach(([id, on]) => { $(id).classList.toggle("on", on); $(id).setAttribute("aria-selected", String(on)); });
  try { localStorage.setItem(LS_TAB, master ? "master" : selber ? "selber" : loops ? "loops" : "studio"); } catch (e) {}
  if (selber) { msLeave().catch(() => {}); if (window.mwsSelber) window.mwsSelber.show(true); return; }
  if (loops) { msLeave().catch(() => {}); if (window.mwsLoops) window.mwsLoops.show(true); return; }
  if (!master) {                       // zurück ins Studio: was eingestellt ist, gilt dort sofort
    msLeave().catch(() => {}).then(() => renderLibrary());
    return;
  }
  renderMsPick();
  if (!ms.id) { let last = ""; try { last = localStorage.getItem(LS_MS_TRACK) || ""; } catch (e) {}
    libAll().then(all => { if (ms.id) return; all.sort((a, b) => b.created - a.created);
      const r = all.find(x => x.id === last) || all[0]; if (r) loadMaster(r.id); }); }
  else if (ms.buf) { ms.peaks = null; paintMaster(); }
}
async function renderMsPick() {
  let all = [];
  try { all = await libAll(); } catch (e) {}
  all.sort((a, b) => b.created - a.created);
  const sel = $("#msPick");
  sel.innerHTML = "";
  // 3.22: nach Ordnern gruppiert, sobald mehr als ein Ordner belegt ist (das Auswahlfeld sucht ab 10 Tracks)
  const opt = (r) => { const o = el("option"); o.value = r.id;
    o.textContent = `${r.title}${r.variant ? " · " + r.variant : ""}${r.master ? "  🎚" : ""}`; return o; };
  const byF = new Map(); all.forEach(r => { const f = r.folder && folderName(r.folder) ? r.folder : ""; if (!byF.has(f)) byF.set(f, []); byF.get(f).push(r); });
  if (byF.size < 2) all.forEach(r => sel.append(opt(r)));
  else [...folders().map(f => f.id), ""].filter(f => byF.has(f)).forEach(f => { const g = el("optgroup"); g.label = f ? folderName(f) : "Unsortiert"; g.dataset.icon = "📁"; byF.get(f).forEach(r => g.append(opt(r))); sel.append(g); });
  if (ms.id) sel.value = ms.id;
  $("#msEmpty").classList.toggle("hidden", !!all.length);
  $("#msBody").classList.toggle("hidden", !all.length);
  sel.disabled = !all.length;
}
// Während ein Track lädt, sind Regler und Knöpfe gesperrt — sonst zeigten sie den alten Track, und eine Änderung
// verpuffte still (Prüfstand 3.7: Bässe −3 direkt nach dem Wechsel kam nie an)
function msLock(on) {
  $$("#msBody .ms-knobs input, #msBody .ms-knobs button, #msBody .ms-presets button, #msBody .ms-cut button, #msBody .ms-ab button, #msPlay, #msReset")
    .forEach(e => { e.disabled = on; });
  if (!on) $("#msUndo").disabled = !ms.hist.length; else $("#msUndo").disabled = true;
}
// Den Track im Tab vergessen (gelöscht / neue Fassung): Wiedergabe aus, Speicher frei (WAV ≈ 40 MB, dekodiert ≈ 80 MB)
function msForget() {
  msStop(false);
  clearTimeout(ms.renderTimer); clearTimeout(ms.storeTimer);
  if (ms.prev) URL.revokeObjectURL(ms.prev.url);
  if (ms.orig) URL.revokeObjectURL(ms.orig.url);
  if (ms.audio) ms.audio.removeAttribute("src");
  ms.bufs.clear();
  ms.run++;
  Object.assign(ms, { id: null, rec: null, buf: null, m: null, prev: null, rendering: null, pending: null, orig: null, peaks: null });
}
// Aus der Bibliothek (🎚): in den Tab wechseln und den Track laden
async function openMaster(id) { showTab("master"); if (ms.id !== id) await loadMaster(id); }
async function loadMaster(id) {
  if (ms.id && ms.id !== id) await msLeave();     // der bisherige Track ist gespeichert, bevor ein anderer kommt
  const rec = await libGet(id);
  if (!rec || !rec.blob) return;
  msStop(false);
  const run = ++ms.run;
  clearTimeout(ms.renderTimer); clearTimeout(ms.storeTimer);
  if (ms.prev) { const u = ms.prev.url; setTimeout(() => URL.revokeObjectURL(u), 3000); }
  Object.assign(ms, { id, rec, buf: null, m: null, own: !!rec.master, savedJson: "", pos: 0, ab: "B", peaks: null, hist: [], lastEdit: 0,
    prev: null, rendering: null, lufs: new Map(), lastAutoGain: rec.masteredGain || 0 });
  delete $("#msGain").dataset.lufs; delete $("#msWave").dataset.renderMs;
  $("#msUndo").disabled = true;
  try { localStorage.setItem(LS_MS_TRACK, id); } catch (e) {}
  $("#msPick").value = id;
  $("#msWhat").textContent = `„${rec.title}${rec.variant ? " · " + rec.variant : ""}“`;
  setMsg($("#msMsg"), "lädt …", "busy");
  msLock(true);
  $("#msExport").disabled = !macCan("export");
  try {
    let buf = ms.bufs.get(id);
    if (!buf || ms.bufs.blobSize !== rec.blob.size) {
      let bytes;
      try { bytes = await rec.blob.arrayBuffer(); }
      catch (e) { const f = await freshRec(id); bytes = await ((f && f.blob) || rec.blob).arrayBuffer(); }   // Safari: totes Blob
      buf = await decodeAudio(bytes);
      ms.bufs.clear(); ms.bufs.set(id, buf); ms.bufs.blobSize = rec.blob.size;   // nur einer im Speicher (≈ 80 MB als Fließkomma)
    }
    if (run !== ms.run) return;
    ms.buf = buf;
    ms.m = rec.master ? { ...MS_ZERO, ...rec.master } : masterDefault(buf);
    if (rec.master) ms.savedJson = JSON.stringify(masterClean(rec.master, buf.duration));
    $("#msSavedTxt").textContent = rec.master ? "✓ deine Einstellungen — so klingt der Track auch in der Bibliothek und im Export"
      : "Vorschlag (weich, Ende gekürzt, Lautheit automatisch) — sobald du etwas änderst, gilt es auch in der Bibliothek";
    paintMaster();
    msLock(false);
    setMsg($("#msMsg"), macCan("master") ? "" : "Hören geht — für den Export mit Mastering braucht dein Mac die Brücke 3.4.", macCan("master") ? "" : "err");
    msSchedule();
  } catch (e) { setMsg($("#msMsg"), "✗ Track nicht lesbar: " + e.message, "err"); }
}
function undoMaster() {
  if (!ms.m || !ms.hist.length) return;
  ms.m = JSON.parse(ms.hist.pop());
  ms.lastEdit = 0;
  $("#msUndo").disabled = !ms.hist.length;
  msChanged();
}
function bindMaster() {
  Object.entries(MS_KNOBS).forEach(([id, k]) => $("#" + id).addEventListener("input", (e) => {
    if (!ms.m) return;
    msBefore(); ms.m[k] = +e.target.value; msChanged();
  }));
  $("#msGain").addEventListener("input", (e) => { if (!ms.m) return; msBefore(); ms.m.gain = +e.target.value; msChanged(); });
  $("#msAuto").onclick = () => { if (!ms.m) return; msBefore(true); delete ms.m.gain; msChanged(); };
  $$(".ms-presets [data-preset]").forEach(b => b.onclick = () => { if (!ms.m) return; msBefore(true); Object.assign(ms.m, MASTER_PRESETS[b.dataset.preset]); msChanged(); });
  $("#msPlay").onclick = () => { if (!ms.buf) return; if (ms.playing) msStop(); else msPlay(); };
  const ab = (v) => { if (!ms.buf) return; ms.ab = v; paintMaster(); if (ms.playing) msPlay(msNow()); };
  $("#msA").onclick = () => ab("A"); $("#msB").onclick = () => ab("B");
  $("#msAutoEnd").onclick = () => { if (!ms.buf) return; const ae = autoEnd(ms.buf);
    if (!ae) { setMsg($("#msMsg"), "Hinter dem Ende ist nichts abzuschneiden.", ""); return; }
    msBefore(true); ms.m.end = ae[0]; ms.m.fade_out = Math.max(ms.m.fade_out || 0, ae[1]);
    setMsg($("#msMsg"), `✂︎ Ende bei ${fmtCut(ae[0])} — dahinter nur noch Klangrest`, "ok");
    msChanged(); };
  $("#msFull").onclick = () => { if (!ms.m) return; msBefore(true); delete ms.m.start; delete ms.m.end; msChanged(); };
  $("#msReset").onclick = () => { if (!ms.buf) return; msBefore(true); ms.m = masterDefault(ms.buf); msChanged(); setMsg($("#msMsg"), "Vorschlag wiederhergestellt", ""); };
  $("#msUndo").onclick = undoMaster;
  pickBox($("#msPick"), { en: window.MWS_LANG === "en", title: "Track zum Mastern" });
  $("#msPick").onchange = (e) => loadMaster(e.target.value);
  $$("#tabs [data-tab]").forEach(b => b.onclick = () => showTab(b.dataset.tab));
  $("#msExport").onclick = async () => { if (!ms.id) return; const id = ms.id; await msLeave(); openExport([id]); };
  // Seite wird verlassen/versteckt: sofort schreiben (das Sicherheitsnetz in localStorage gibt es trotzdem)
  window.addEventListener("pagehide", () => { msFlushNow(); msStoreNow(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") { msFlushNow(); msStoreNow(); } });
  // Wellenform: Griffe ziehen = schneiden, sonst springen
  const cv = $("#msWave");
  const at = (e) => { const r = cv.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * msLen(); };
  cv.addEventListener("pointerdown", (e) => {
    if (!ms.buf) return;
    const r = cv.getBoundingClientRect(), px = (s) => r.left + s / msLen() * r.width, grip = 14;
    ms.drag = Math.abs(e.clientX - px(msStart())) <= grip ? "start" : Math.abs(e.clientX - px(msEnd())) <= grip ? "end" : null;
    if (ms.drag) { msBefore(true); cv.setPointerCapture(e.pointerId); e.preventDefault(); return; }
    const t = at(e);
    if (ms.playing) msPlay(t); else { ms.pos = t; paintMaster(); }
  });
  cv.addEventListener("pointermove", (e) => {
    if (!ms.drag) { const r = cv.getBoundingClientRect(), px = (s) => r.left + s / msLen() * r.width;
      cv.style.cursor = ms.buf && (Math.abs(e.clientX - px(msStart())) <= 14 || Math.abs(e.clientX - px(msEnd())) <= 14) ? "ew-resize" : "pointer"; return; }
    const t = Math.round(at(e) * 10) / 10;
    if (ms.drag === "start") ms.m.start = Math.max(0, Math.min(t, msEnd() - 1));
    else ms.m.end = Math.min(msLen(), Math.max(t, msStart() + 1));
    paintMaster();                    // beim Ziehen nur zeichnen — gespeichert und gerechnet wird beim Loslassen
  });
  const up = () => { if (ms.drag) { ms.drag = null; msChanged(); } };
  cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
  window.addEventListener("resize", () => { if (ms.buf && !$("#masterView").classList.contains("hidden")) { ms.peaks = null; paintMaster(); } });
}

// ---- Bibliothek: die gemasterte Fassung am Track ----
// Abgelegt wird nur, was zu den GESPEICHERTEN Einstellungen und zur aktuellen Fassung des Originals passt.
const storeQueue = new Map();
function storeMastered(id, key, out) {
  const prev = storeQueue.get(id) || Promise.resolve();
  const p = prev.catch(() => {}).then(() => storeMasteredNow(id, key, out));
  storeQueue.set(id, p);
  const done = () => { if (storeQueue.get(id) === p) storeQueue.delete(id); };
  p.then(done, done);
  return p;
}
// 🔴 3.7 (Durchsicht): erst lesen, dann in einer ZWEITEN Transaktion schreiben ließ zwei Aufrufer (Tab verlassen +
//    ▶︎ in der Bibliothek) dieselbe Fassung zweimal schreiben — in Safari scheitert der zweite oder tötet das Blob,
//    das der Player gerade bekam. Jetzt prüft der Schreibvorgang selbst (libPatchMany: get + put in einer Transaktion).
async function storeMasteredNow(id, key, out) {
  const size = (() => { try { return JSON.parse(key)[2]; } catch (e) { return -1; } })();
  let ok = false;
  await libPatchMany([id], (cur) => {
    if (!cur.master || masterKey(cur.master, cur.rev, size) !== key) return {};      // inzwischen anders eingestellt
    ok = true;
    if (cur.masteredFor === key) return {};                                         // liegt schon da
    return { mastered: out.blob, masteredFor: key, masteredPeaks: out.peaks, masteredDur: out.dur, masteredGain: out.gain };
  });
  return ok;
}
// Gilt die abgelegte gemasterte Fassung noch?
const masteredOk = (rec) => !!(rec && rec.master && rec.mastered && rec.masteredFor === recKey(rec, rec.master));
// Für einen Track mit eigenen Einstellungen die gemasterte Fassung sicherstellen (je Track nur eine Rechnung zur Zeit)
const masterJobs = new Map();
function ensureMastered(id) {
  if (masterJobs.has(id)) return masterJobs.get(id);
  const p = (async () => {
    for (let tries = 0; tries < 3; tries++) {
      const rec = await libGet(id);
      if (!rec || !rec.master || !rec.blob) return rec || null;
      if (masteredOk(rec) && await blobAlive(rec.mastered)) return rec;
      const key = recKey(rec, rec.master);
      let out = ms.id === id && ms.prev && ms.prev.key === key ? ms.prev : null;      // der Tab hat sie schon gerechnet
      if (!out && ms.id === id && ms.rendering && ms.rendering.key === key) { try { out = await ms.rendering.p; } catch (e) { out = null; } }   // … oder rechnet sie gerade
      if (!out) {
        let buf = ms.id === id && ms.buf && ms.bufs.blobSize === rec.blob.size ? ms.buf : null;
        if (!buf) {
          let bytes;
          try { bytes = await rec.blob.arrayBuffer(); }
          catch (e) { const f = await freshRec(id); bytes = await ((f && f.blob) || rec.blob).arrayBuffer(); }
          buf = await decodeAudio(bytes);
        }
        out = await masterAudio(buf, rec.master);
      }
      if (await storeMastered(id, key, out)) { const r = await freshRec(id, "mastered"); if (masteredOk(r)) return r; }
    }
    return await libGet(id);
  })();
  masterJobs.set(id, p);
  const done = () => masterJobs.delete(id);
  p.then(done, done);                 // nicht p.finally(): dessen Ableger würfe ungefangen, wenn p scheitert
  return p;
}
// Nach dem Laden: Tracks mit Einstellungen, deren gemasterte Fassung fehlt (vor 3.7 gemastert) oder veraltet ist,
// nach und nach im Hintergrund rechnen — einer zur Zeit, nur bei sichtbarer Seite
let warming = false;
async function warmMasters() {
  if (warming) return;
  warming = true;
  let done = 0;
  try {
    for (;;) {
      if (document.hidden) break;
      const all = await libAll();
      const failed = warmMasters.failed || (warmMasters.failed = new Map());     // id → Zeitpunkt; nach 5 min neuer Versuch
      const next = all.sort((a, b) => b.created - a.created).find(r => r.master && r.blob && !masteredOk(r) && !(Date.now() - (failed.get(r.id) || 0) < 300000));
      if (!next) break;
      let r = null;
      try { r = await ensureMastered(next.id); } catch (e) { r = null; }
      if (masteredOk(r)) { done++; failed.delete(next.id); } else failed.set(next.id, Date.now());   // nie im Kreis
      await new Promise(r => setTimeout(r, 400));
    }
  } finally { warming = false; }
  if (done) renderLibrary();
}

// ---- Urheber & Rechte (3.2) — liegen auf dem Mac, gelten für jeden Track, den er erzeugt ----
const RIGHT_FIELDS = { rOwner: "owner", rArtist: "artist", rCopy: "copyright", rAlbum: "album", rLabel: "label", rWeb: "website" };
const RIGHT_CHECKS = { rWm: "watermark", rCover: "cover", rTitle: "cover_title", rArtistCover: "cover_artist", rAi: "ai_note" };
function applySettings(res, fromMac = true) {
  if (!res || !res.rights) return;
  // 🔴 3.4.1: kommt die Antwort, während jemand tippt, NICHT überschreiben — die Eingabe gewinnt und wird gespeichert
  const typing = rightsDirty() ? rightsForm() : null;
  // 🔴 Audit 3.2: Speichern erst, wenn die Werte VOM MAC im Formular stehen — sonst hätte ein
  //    leeres Formular (Mac-Antwort zu spät) Wasserzeichen und Cover still abgeschaltet.
  if (fromMac) { state.rightsLoaded = true; $("#rSave").disabled = false; }
  // Was beim letzten Mal nicht an den Mac kam (er war weg), jetzt nachholen — einmal
  let pend = null; if (fromMac && !state.rightsPendingDone) { try { pend = JSON.parse(localStorage.getItem(LS_RIGHTS_DRAFT) || "null"); } catch (e) {} }
  state.rights = res.rights;
  state.tools = res.tools || null;
  try { localStorage.setItem(LS_RIGHTS, JSON.stringify(res.rights)); } catch (e) {}
  Object.entries(RIGHT_FIELDS).forEach(([id, k]) => { $("#" + id).value = res.rights[k] || ""; });
  Object.entries(RIGHT_CHECKS).forEach(([id, k]) => { $("#" + id).checked = res.rights[k] !== false; });
  const keep = typing || (pend && typeof pend === "object" ? pend : null);
  if (keep) {
    if (pend) state.rightsPendingDone = true;
    Object.entries(RIGHT_FIELDS).forEach(([id, k]) => { if (typeof keep[k] === "string") $("#" + id).value = keep[k]; });
    Object.entries(RIGHT_CHECKS).forEach(([id, k]) => { if (typeof keep[k] === "boolean") $("#" + id).checked = keep[k]; });
    autoSaveRights();
  }
  renderRightsPreview();
  if (fromMac) renderWriter(res.writer);
  const t = res.tools || {};
  const ok = (v) => v ? "✓" : "✗";
  $("#toolsLine").textContent = `Auf dem Mac: ffmpeg ${ok(t.ffmpeg)} · audiowmark ${ok(t.audiowmark)} · Wasserzeichen-Schlüssel ${t.key ? "✓" : "entsteht beim ersten Track"} · Bildmodell ${t.image_model || "✗ fehlt — den Installer noch einmal ausführen"}`;
}

// ---- 3.26: Sprachmodell für Brief und Liedtext — auch eines aus dem Ollama, das jemand schon hat ----
// Die Brücke bietet nur an, was sie selbst findet (eigenes Ollama + das des Nutzers auf dem Standardport);
// gewählt wird Name + Adresse aus dieser Liste. Ist das Gewählte weg, schreibt die Brücke von selbst mit dem besten anderen.
function renderWriter(w) {
  const sel = $("#wModel"), msg = $("#wMsg"), hint = $("#wHint");
  const can = macCan("writer") && w && Array.isArray(w.options);
  $("#writerBox").classList.toggle("dim", !can);
  sel.disabled = !can;
  if (!can) {
    sel.replaceChildren(new Option(macWriter() || "—", ""));
    setMsg(msg, "", "");
    hint.textContent = state.bridge.connected ? "Die Auswahl kommt mit dem nächsten Update der Brücke auf deinem Mac." : "";
    return;
  }
  const opt = (o) => new Option(`${o.name}${o.gb ? ` · ${o.gb} GB` : ""}`, o.url + " " + o.name);
  const kids = [new Option(w.using && w.auto ? `Automatisch (empfohlen) — ${w.using}` : "Automatisch (empfohlen)", "")];
  [["Von Manuwave Studio", w.options.filter(o => !o.mine)], ["Aus deinem Ollama", w.options.filter(o => o.mine)]].forEach(([label, list]) => {
    if (!list.length) return;
    // label ist ein Attribut — die Übersetzung der Seite sieht es nicht, darum hier
    const g = document.createElement("optgroup"); g.label = (window.mwsT || String)(label); g.append(...list.map(opt)); kids.push(g);
  });
  const want = w.auto ? "" : w.url + " " + w.model;
  if (want && !w.options.some(o => o.url + " " + o.name === want)) kids.push(new Option(`${w.model} — gerade nicht erreichbar`, want));
  sel.replaceChildren(...kids);
  sel.value = want;
  if (!w.using) setMsg(msg, "✗ kein Sprachmodell erreichbar — läuft Ollama?", "err");
  else if (!w.auto && w.using !== w.model) setMsg(msg, `${w.model} ist gerade nicht erreichbar — es schreibt ${w.using}`, "err");
  else setMsg(msg, `✓ schreibt: ${w.using}`, "ok");
  hint.textContent = w.options.some(o => o.mine)
    ? "Modelle aus deinem Ollama nutzt Manuwave Studio direkt, ohne sie ein zweites Mal zu laden. Denkende Modelle antworten hier ohne Denkphase."
    : w.user_ollama ? "Hast du Ollama schon selbst installiert, stehen deine Modelle hier, sobald es läuft." : "";
}
async function chooseWriter() {
  const v = $("#wModel").value, cut = v.indexOf(" ");
  const writer = v ? { url: v.slice(0, cut), model: v.slice(cut + 1) } : { model: "" };
  setMsg($("#wMsg"), "speichere auf dem Mac …", "busy");
  try { const j = await macJob("settings", { writer }, { timeoutMs: 45000 }); applySettings(j.result); refreshBridge(); }
  catch (e) { setMsg($("#wMsg"), "✗ " + e.message, "err"); }
}
function renderRightsPreview() {
  const rg = {};
  Object.entries(RIGHT_FIELDS).forEach(([id, k]) => { rg[k] = $("#" + id).value.trim(); });
  $("#rPreview").textContent = `Vorschau: Künstler „${rg.artist || rg.owner || "—"}“ · ${copyrightText(rg) || "kein Copyright-Text"}`;
}
async function loadRights() {
  const can = macCan("settings");
  $("#rightsForm").classList.toggle("dim", !can);
  if (!can) {
    const rg = rightsCached();
    if (rg) applySettings({ rights: rg }, false);
    renderWriter(null);
    $("#rSave").disabled = true;
    return setMsg($("#rightsMsg"), state.bridge.connected ? "Die Brücke auf deinem Mac ist älter als 3.2 — einmal neu einrichten (unten)." : "Dein Mac ist gerade nicht verbunden — die Angaben liegen auf ihm.", "err");
  }
  setMsg($("#rightsMsg"), "lese vom Mac …", "busy");
  try { const j = await macJob("settings", { fresh: true }, { timeoutMs: 45000 }); applySettings(j.result); setMsg($("#rightsMsg"), "", ""); }
  catch (e) { setMsg($("#rightsMsg"), "✗ " + e.message, "err"); }
}
const LS_RIGHTS_DRAFT = "nf_rights_draft";   // nur falls der Mac beim Verlassen nicht erreichbar war
function rightsForm() {
  const set = {};
  Object.entries(RIGHT_FIELDS).forEach(([id, k]) => { set[k] = $("#" + id).value.trim(); });
  Object.entries(RIGHT_CHECKS).forEach(([id, k]) => { set[k] = $("#" + id).checked; });
  return set;
}
function rightsDirty() {
  if (!state.rightsLoaded || !state.rights) return false;
  const f = rightsForm();
  return Object.keys(f).some(k => typeof f[k] === "boolean" ? f[k] !== (state.rights[k] !== false) : f[k] !== String(state.rights[k] || ""));
}
// Speichert von selbst: beim Verlassen eines Feldes, bei jedem Haken und beim Schließen der Einstellungen
function autoSaveRights() {
  clearTimeout(state.rightsTimer);
  state.rightsTimer = setTimeout(() => {
    if (!rightsDirty()) return;
    if (macCan("settings")) saveRights();
    else { try { localStorage.setItem(LS_RIGHTS_DRAFT, JSON.stringify(rightsForm())); } catch (e) {}
      setMsg($("#rSaveMsg"), "Mac nicht erreichbar — deine Änderungen sind gemerkt und werden gespeichert, sobald er da ist.", "err"); }
  }, 250);
}
async function saveRights() {
  const set = {};
  Object.entries(RIGHT_FIELDS).forEach(([id, k]) => { set[k] = $("#" + id).value.trim(); });
  Object.entries(RIGHT_CHECKS).forEach(([id, k]) => { set[k] = $("#" + id).checked; });
  if (!state.rightsLoaded || !macCan("settings")) return setMsg($("#rSaveMsg"), "Erst müssen die Angaben vom Mac gelesen sein.", "err");
  if (!set.owner) return setMsg($("#rSaveMsg"), "Ein Rechteinhaber muss drinstehen.", "err");
  setMsg($("#rSaveMsg"), "speichere auf dem Mac …", "busy");
  try {
    const j = await macJob("settings", { set }, { timeoutMs: 45000 });
    try { localStorage.removeItem(LS_RIGHTS_DRAFT); } catch (e) {}
    applySettings(j.result);
    setMsg($("#rSaveMsg"), "✓ Gespeichert — gilt für neue Tracks und jeden Export.", "ok");
    scheduleFinish();
  } catch (e) { setMsg($("#rSaveMsg"), "✗ " + e.message, "err"); }
}
async function verifyFile(file) {
  if (!file) return;
  const s = $("#verifyMsg");
  if (file.size > 60e6) return setMsg(s, "Datei größer als 60 MB.", "err");
  if (!macCan("verify")) return setMsg(s, "Dafür muss dein Mac verbunden sein (Brücke 3.2).", "err");
  setMsg(s, `Dein Mac sucht das Wasserzeichen in „${file.name}“ …`, "busy");
  try {
    const j = await macJob("verify", {}, { upload: file, filename: file.name, timeoutMs: 240000 });
    const r = j.result || {}, i = r.info || {};
    if (!r.found) return setMsg(s, `✗ Kein Wasserzeichen dieses Macs in „${file.name}“.`, "err");
    setMsg(s, `✅ Trägt dein Wasserzeichen${i.title ? `: „${i.title}${i.variant ? " · " + i.variant : ""}“` : ""}${i.owner ? " · " + i.owner : ""}${i.at ? " · gesetzt " + new Date(i.at).toLocaleDateString("de-DE") : ""}`, "ok");
  } catch (e) { setMsg(s, "✗ " + e.message, "err"); }
}

// ---- Wellenform ----
async function computePeaks(blob, n = 480) {
  try {
    const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const buf = await new Ctx(1, 2, 44100).decodeAudioData(await blob.arrayBuffer());
    const ch = buf.getChannelData(0);
    const step = Math.max(1, Math.floor(ch.length / n));
    const peaks = [];
    for (let i = 0; i < n; i++) {
      let m = 0;
      const end = Math.min(ch.length, (i + 1) * step);
      for (let k = i * step; k < end; k += 8) { const v = Math.abs(ch[k]); if (v > m) m = v; }
      peaks.push(Math.round(m * 1000) / 1000);
    }
    return peaks;
  } catch (e) { return []; }
}
function drawWave(canvas, peaks, progress) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 300, h = canvas.clientHeight || 44;
  if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const g = canvas.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  if (!peaks || !peaks.length) { g.fillStyle = "#262c47"; g.fillRect(0, h / 2 - 1, w, 2); return; }
  const max = Math.max(0.05, ...peaks);
  const bw = w / peaks.length;
  const grad = g.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, "#22e3c3"); grad.addColorStop(0.6, "#7c5cff"); grad.addColorStop(1, "#ff4d94");
  for (let i = 0; i < peaks.length; i++) {
    const bh = Math.max(1.5, (peaks[i] / max) * (h - 4));
    g.fillStyle = (i / peaks.length) <= progress ? grad : "rgba(148,160,200,.35)";
    g.fillRect(i * bw, (h - bh) / 2, Math.max(1, bw - 0.6), bh);
  }
}

// ---- Liste ruhig halten ----
// 🔴 Gemessen 10.10.2026: kam ein neuer Track an, rückte der laufende um 98 px nach unten
//    (neue Zeile oben + Warteschlangen-Zeile weg) — in Chrome UND Safari, weil die Liste neu
//    aufgebaut wird und die Scroll-Verankerung des Browsers dabei nicht greift. Lag der Track
//    unten im Bild, war er weg. Jetzt: vorher merken, wo die Zeile stand, danach zurückrücken.
function anchorTake() {
  const vh = window.innerHeight;
  const rows = $$("#libList .lib-row");
  const vis = (r) => { const b = r.getBoundingClientRect(); return b.bottom > 0 && b.top < vh; };
  let a = player.id ? rows.find(r => r.dataset.id === player.id) : null;
  if (!a || !vis(a)) a = rows.find(vis);
  return a ? { id: a.dataset.id, top: a.getBoundingClientRect().top } : null;
}
function anchorKeep(a) {
  if (!a) return;
  const r = document.querySelector(`#libList .lib-row[data-id="${CSS.escape(a.id)}"]`);
  if (!r) return;
  const d = r.getBoundingClientRect().top - a.top;
  if (Math.abs(d) > 1) window.scrollBy(0, d);
}
function steady(fn) { const a = anchorTake(); const out = fn(); anchorKeep(a); return out; }

const player = { audio: null, url: null, id: null, rec: null, raf: 0 };
function rowParts(id) {
  const row = document.querySelector(`#libList .lib-row[data-id="${CSS.escape(id)}"]`);
  return row ? { row, btn: row.querySelector(".lib-play"), cv: row.querySelector(".lib-wave") } : null;
}
const isPlaying = () => !!(player.audio && player.id && !player.audio.paused);
function paintPlaying() {
  // 🔴 3.2: der Knopf trägt das Cover — nur die Glyphe wechseln, nie den ganzen Inhalt
  const glyph = (b) => b.querySelector(".lib-glyph") || b;
  $$("#libList .lib-row.playing").forEach(r => { r.classList.remove("playing"); const b = r.querySelector(".lib-play"); b.classList.remove("on"); glyph(b).textContent = "▶︎"; });
  const p = player.id && rowParts(player.id);
  if (p) { p.row.classList.add("playing"); p.btn.classList.toggle("on", isPlaying()); glyph(p.btn).textContent = isPlaying() ? "⏸" : "▶︎"; }
  const bar = $("#nowBar");
  bar.classList.toggle("hidden", !player.id);
  document.body.classList.toggle("has-now", !!player.id);
  if (player.rec) {
    $("#nowTitle").textContent = player.rec.title + (player.rec.variant ? " · " + player.rec.variant : "");
    $("#nowPlay").textContent = isPlaying() ? "⏸" : "▶︎";
    $("#nowPlay").classList.toggle("on", isPlaying());
    const u = coverUrl(player.rec);
    $("#nowPlay").classList.toggle("has-art", !!u);
    $("#nowPlay").style.backgroundImage = u ? `linear-gradient(rgba(5,6,12,.42),rgba(5,6,12,.42)),url("${u}")` : "";
    mediaInfo(player.rec, u);
  }
}
// Sperrbildschirm / Kontrollzentrum: Titel, Künstler, Cover
function mediaInfo(rec, url) {
  if (!("mediaSession" in navigator) || !window.MediaMetadata || !rec) return;
  const rg = rightsCached() || {};
  const key = rec.id + "|" + (rec.coverAt || 0) + "|" + rec.title;
  if (mediaInfo.key === key) return;
  mediaInfo.key = key;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({ title: rec.title + (rec.variant ? " · " + rec.variant : ""),
      artist: rg.artist || rg.owner || "Manuwave Studio", album: rg.album || "Manuwave Studio",
      artwork: url ? [{ src: url, sizes: "1000x1000", type: "image/jpeg" }] : [] });
  } catch (e) {}
}
function paintProgress() {
  if (!player.id || !player.audio) return;
  const d = player.audio.duration || 0, t = player.audio.currentTime || 0;
  const p = rowParts(player.id);
  if (p) drawWave(p.cv, peaksFor(player.rec), player.waiting ? 0 : d ? t / d : 0);
  if (player.waiting) { $("#nowFill").style.width = "0%"; $("#nowTime").textContent = "🎚 wird gemastert …"; return; }
  $("#nowFill").style.width = (d ? (t / d) * 100 : 0) + "%";
  $("#nowTime").textContent = `${fmtDur(t)} / ${fmtDur(d)}`;
}
function loop() {
  cancelAnimationFrame(player.raf);
  const tick = () => { paintProgress(); if (isPlaying()) player.raf = requestAnimationFrame(tick); };
  player.raf = requestAnimationFrame(tick);
}
function stopPlayer() {
  if (player.audio) player.audio.pause();
  cancelAnimationFrame(player.raf);
  const p = player.id && rowParts(player.id);
  if (p) drawWave(p.cv, peaksFor(player.rec), 0);
  player.id = null; player.rec = null; player.waiting = false; player.loaded = null;
  if (player.audio) player.audio.muted = false;
  paintPlaying();
}
function togglePause() {
  if (!player.audio || !player.id) return;
  if (player.audio.paused) player.audio.play().catch(() => {}); else player.audio.pause();
}
// Wellenform, die zum Gespielten passt: gemasterte Fassung, wenn sie gilt, sonst das Original
const peaksFor = (rec) => (masteredOk(rec) && rec.masteredPeaks) || rec.peaks;
function play(rec, seekTo) {
  if (ms.playing) msStop();           // die Mastering-Vorschau hält an
  rec = liveRec(rec);                 // nie ein Blob, das Safari inzwischen freigegeben hat
  // 🔴 3.7 (Durchsicht): pausiert, dann gemastert, dann ▶︎ → togglePause spielte weiter das ROHE Original.
  //    Weiter/Pause nur, wenn die geladene Quelle noch die richtige ist — sonst neu starten (im selben Klick).
  const want = rec.master ? (masteredOk(rec) ? rec.masteredFor : "warten") : "roh";
  if (player.id === rec.id && (player.waiting || player.loaded === want)) {
    if (player.waiting) { if (seekTo != null) player.seekTo = seekTo; return; }   // wird gerade gemastert
    if (seekTo != null && player.audio.duration) { player.audio.currentTime = seekTo * player.audio.duration; paintProgress(); }
    else togglePause();
    return;
  }
  if (player.audio) player.audio.pause();
  if (!player.audio) {
    player.audio = new Audio();
    player.audio.preload = "auto";
    // Zustand kommt aus dem Element selbst — so stimmt die Anzeige auch bei Pause über die Medientasten.
    player.audio.onplay = () => { paintPlaying(); loop(); };
    player.audio.onpause = () => { paintPlaying(); paintProgress(); };
    player.audio.onended = () => { if (player.waiting) return; player.audio.currentTime = 0; paintPlaying(); paintProgress(); };
    player.audio.ontimeupdate = () => { if (player.audio.currentTime > 0 && !player.waiting) player.lastT = player.audio.currentTime; };
    // Blob unterwegs freigegeben (Safari): frisch lesen und an derselben Stelle weiter
    player.audio.onerror = () => { if (!player.waiting) rescuePlay(); };
  }
  const p0 = player.id && rowParts(player.id);
  if (p0 && player.rec) drawWave(p0.cv, peaksFor(player.rec), 0);
  const ready = masteredOk(rec);
  player.field = rec.master ? "mastered" : "blob";
  player.waiting = !!rec.master && !ready;
  player.loaded = rec.master ? (ready ? rec.masteredFor : "warten") : "roh";   // welche Fassung im <audio> liegt
  player.seekTo = seekTo;
  if (player.url) URL.revokeObjectURL(player.url);
  player.url = URL.createObjectURL(player.waiting ? rec.blob : rec[player.field]);
  player.audio.src = player.url;
  player.audio.muted = player.waiting;     // fehlt die gemasterte Fassung noch: im Klick stumm starten (Safari), dann umschalten
  player.id = rec.id; player.rec = rec; player.lastT = seekTo != null ? null : 0;
  state.fresh.delete(rec.id);
  const fr = rowParts(rec.id); if (fr) fr.row.classList.remove("fresh");
  if (!player.waiting) player.audio.addEventListener("loadedmetadata", () => {
    if (seekTo != null) player.audio.currentTime = seekTo * (player.audio.duration || 0);
    paintProgress();
  }, { once: true });
  paintPlaying();
  player.audio.play().catch((e) => {
    if (player.waiting) return;
    if (e && e.name === "AbortError") return;           // von einem neueren play()/pause() abgelöst — kein Fehler
    if (e && e.name === "NotAllowedError") { stopPlayer(); return; }
    rescuePlay();
  });
  if (player.waiting) masteredThenPlay(rec.id);
}
// Die gemasterte Fassung fehlt (vor 3.7 gemastert) oder ist veraltet: rechnen, ablegen, dann spielen
async function masteredThenPlay(id) {
  $("#nowTime").textContent = "🎚 wird gemastert …";
  setMsg($("#libMsg"), "🎚 Mastering wird gerechnet …", "busy");
  let r = null, err = "";
  try { r = await ensureMastered(id); } catch (e) { err = e.message; }
  if (($("#libMsg").dataset.msg || "").startsWith("🎚 Mastering wird")) setMsg($("#libMsg"), "", "");
  if (player.id !== id || !player.waiting) return;
  player.waiting = false;
  const a = player.audio;
  if (!r || !masteredOk(r)) {                 // nicht berechenbar: lieber das Original hören als nichts
    player.field = "blob"; player.loaded = "roh-ersatz";
    setMsg($("#libMsg"), "✗ Mastering nicht berechenbar" + (err ? ` (${err})` : "") + " — es spielt das Original.", "err");
    a.currentTime = 0; a.muted = false; a.play().catch(() => {});
    paintProgress(); return;
  }
  libLive.set(id, r);
  player.rec = r; player.loaded = r.masteredFor;
  if (player.url) URL.revokeObjectURL(player.url);
  player.url = URL.createObjectURL(r.mastered);
  a.src = player.url;
  const at = player.seekTo;
  a.addEventListener("loadedmetadata", () => { if (at != null) a.currentTime = at * (a.duration || 0); paintProgress(); }, { once: true });
  a.muted = false;
  a.play().catch((e) => { if (e && e.name === "NotAllowedError") stopPlayer(); });
  const row = rowParts(id); if (row) drawWave(row.cv, peaksFor(r), 0);
  if (!$("#masterView").classList.contains("hidden")) return;
  renderLibrary();
}
// Ein totes Blob (Safari) ist kein Ende: frisch lesen, bis es lesbar ist, und an derselben Stelle weiterspielen.
// Je Track einmal in 8 s — ein wirklich kaputtes Audio hält an statt endlos zu versuchen.
async function rescuePlay() {
  const id = player.id;
  if (!id) return;
  if (player.rescue && player.rescue.id === id) {
    if (player.rescue.busy) return;                                       // läuft schon (Fehler + Ablehnung kommen beide)
    if (Date.now() - player.rescue.at < 8000) { stopPlayer(); return; }  // gerade gerettet und wieder kaputt
  }
  player.rescue = { id, at: Date.now(), busy: true };
  const f = player.field || "blob";
  const r = await freshRec(id, f);
  player.rescue.busy = false;
  if (player.id !== id) return;
  if (!r || !r[f] || !(await blobAlive(r[f]))) { stopPlayer(); setMsg($("#libMsg"), "✗ Audio im Browser nicht lesbar — Seite neu laden oder „📥 Vom Mac holen“.", "err"); return; }
  libLive.set(id, r);
  player.wantPlay = true; playerSwap(r); player.wantPlay = false;
}

async function renderLibrary() {
  const box = $("#libList");
  let all = [];
  try { all = await libAll(); } catch (e) { box.textContent = "Bibliothek nicht verfügbar (privates Fenster?)."; return; }
  all.sort((a, b) => b.created - a.created);
  releaseCoverUrls(new Set(all.map(r => r.id)));
  const fl = folders();
  if (!["all", "fav", "none"].includes(state.view) && !fl.some(f => f.id === state.view)) state.view = "all";
  const list = state.view === "fav" ? all.filter(r => r.favorite)
    : state.view === "none" ? all.filter(r => !r.folder || !fl.some(f => f.id === r.folder))
    : state.view === "all" ? all : all.filter(r => r.folder === state.view);
  const ids = new Set(list.map(r => r.id));
  [...state.sel].forEach(id => { if (!ids.has(id)) state.sel.delete(id); });
  $("#libCount").textContent = all.length ? `${all.length} ${all.length === 1 ? "Track" : "Tracks"} · ${fmtBytes(all.reduce((s, r) => s + (r.blob ? r.blob.size : 0), 0))}` : "";
  libLive.clear(); all.forEach(r => libLive.set(r.id, r));
  if (player.id) { const now = all.find(r => r.id === player.id), f = player.field || "blob"; if (now) player.rec = { ...now, [f]: player.rec[f] }; }
  const anchor = anchorTake();
  renderFolderBar(all);
  box.innerHTML = "";
  if (!list.length) {
    box.append(el("div", "lib-empty", state.view === "fav" ? "Noch keine Favoriten."
      : state.view === "all" ? "Noch keine Tracks — erzeuge oben deinen ersten."
      : "Dieser Ordner ist leer. Tracks auswählen und „📁 In Ordner …“ — oder eine Zeile hierher ziehen."));
  }
  list.forEach(rec => box.append(libRow(rec, fl)));
  if (ms.id && !all.some(r => r.id === ms.id)) msForget();
  if (!$("#masterView").classList.contains("hidden")) renderMsPick();
  paintPlaying();
  paintProgress();
  renderSelBar();
  anchorKeep(anchor);
  refreshCoverDlg();
  if (all.some(r => r.master && !masteredOk(r))) setTimeout(warmMasters, 1500);
}

function libRow(rec, fl) {
  const r = rec.result || {}, q = rec.request || {};
  const seed = r.seed != null ? r.seed : q.seed;
  const row = el("div", "lib-row" + (state.fresh.has(rec.id) ? " fresh" : ""));
  row.dataset.id = rec.id;
  if (fl.length) row.draggable = true;
  const sel = el("input", "lib-sel");
  sel.type = "checkbox"; sel.title = "Auswählen (Umschalt = Bereich)"; sel.setAttribute("aria-label", "Auswählen");
  sel.onclick = (e) => toggleSel(rec.id, sel.checked, e.shiftKey);
  const pb = el("button", "lib-play lib-cover");
  pb.type = "button";
  const curl = coverUrl(rec);
  const painting = rec.coverState === "pending" || state.finishing === rec.id;
  if (curl) { const img = el("img"); img.src = curl; img.alt = ""; img.onerror = () => coverRescue(rec.id, img); pb.append(img); }
  else { pb.classList.add("no-art"); pb.style.setProperty("--h", coverHue(rec.title)); }
  if (painting) pb.classList.add("painting");
  pb.title = painting ? "Abspielen / Pause — das Cover entsteht gerade" : "Abspielen / Pause";
  pb.append(el("span", "lib-glyph", "▶︎"));
  pb.onclick = () => play(rec);
  if (curl) { pb.addEventListener("mouseenter", () => peekShow(pb, curl, rec)); pb.addEventListener("mouseleave", peekHide); }
  const mid = el("div", "lib-mid");
  const head = el("div", "lib-head");
  const title = el("span", "lib-title", rec.title + (rec.variant ? " · " + rec.variant : ""));
  title.translate = false;                 // 3.12: Titel und Notiz sind Inhalt — i18n.js lässt sie, wie sie sind
  title.title = "Klicken zum Umbenennen";
  title.onclick = async () => {
    const t = prompt("Neuer Titel:", rec.title);
    if (t && t.trim()) { await libPatch(rec.id, { title: t.trim().slice(0, 80) }); renderLibrary(); }
  };
  head.append(title);
  if (state.fresh.has(rec.id)) head.append(el("span", "badge-new", "NEU"));
  // Seit 3.0 steht die Klangqualität im Auftrag; ältere Tracks liefen alle ungeführt.
  const g = q.guidance_scale;
  const fname = state.view === "all" || state.view === "fav" ? folderName(rec.folder) : "";
  head.append(el("span", "lib-meta", [r.bpm || q.bpm ? `${r.bpm || q.bpm} BPM` : "", r.keyscale || q.keyscale || "",
    fmtDur(masteredOk(rec) && rec.masteredDur ? rec.masteredDur : r.duration_real || r.duration || q.duration || 0), seed != null ? `Seed ${seed}` : "",
    /xl/.test(r.dit || "") ? "XL" : "",
    rec.source === "eigen" ? "🎹 selbst gespielt" : rec.derived ? "🎼 nachgespielt (KI-Komposition)" : g > 1 ? (q.inference_steps > 50 ? "Maximal" : "Studio") : "ungeführt",
    r.ende ? "Ende geglättet" : "", qaLabel(r.qa), rec.midi ? "🎼 MIDI" : rec.midiState === "pending" ? "🎼 MIDI folgt" : "", rec.wm ? "🔏 Wasserzeichen" : "", rec.master ? "🎚 gemastert" : "",
    state.finishing === rec.id ? "✨ wird veredelt …" : rec.coverState === "pending" ? "🎨 Cover entsteht …" : "",
    r.render_s ? `in ${fmtDur(r.render_s)} gerechnet` : "", fname ? "📁 " + fname : ""].filter(Boolean).join(" · ")));
  const cv = el("canvas", "lib-wave");
  cv.title = "Klicken = an diese Stelle springen";
  cv.onclick = (e) => play(rec, e.offsetX / cv.clientWidth);
  mid.append(head, cv);
  if (rec.note) { const nt = el("div", "lib-note", rec.note); nt.translate = false; mid.append(nt); }
  const act = el("div", "lib-act");
  const btn = (txt, tip, fn, cls = "") => { const b = el("button", "ghost btn-s " + cls, txt); b.type = "button"; b.title = tip; b.onclick = fn; act.append(b); return b; };
  btn(rec.favorite ? "★" : "☆", "Favorit", async () => { await libPatch(rec.id, { favorite: !rec.favorite }); renderLibrary(); }, rec.favorite ? "fav" : "");
  btn("🎚", rec.master ? "Gemastert — ▶︎ spielt deine Einstellungen. Hier ändern" : "Mastern — Klang, Lautheit, Anfang/Ende einstellen; gilt dann hier und im Export", () => openMaster(rec.id), "ms-btn" + (rec.master ? " on" : ""));
  btn("⬇︎ Export", "Als MP3 oder verlustfrei (FLAC, ALAC, WAV, AIFF …) — mit Cover, Tags und Wasserzeichen", () => openExport([rec.id]));
  btn("🎨", "Cover groß ansehen — und bei Bedarf ein neues malen lassen", () => openCover(rec.id));
  btn(rec.web ? "🌐 online" : "🌐", rec.web ? `Öffentlich auf Fahrstuhlmusik: ${rec.web.url} — klicken für Link, neu veröffentlichen oder zurückziehen`
    : "Auf Fahrstuhlmusik veröffentlichen — öffentlich und kostenlos zum Anhören (gemasterte Fassung)", (e) => webTrack(rec, e.currentTarget), "web-btn" + (rec.web ? " on" : ""));
  if (rec.midi) {
    btn("🎹 Spielen", "Das MIDI-Abbild dieses Songs auf den Instrumenten öffnen — Drums, Bass, Akkorde und Melodie im Tab „Selber machen“", () => { showTab("selber"); if (window.mwsSelber) window.mwsSelber.fromMidi(rec); });
    if (rec.midiFile) btn("⬇︎ MIDI", "MIDI-Datei (4 Spuren, im Takt) — für jede DAW", () => downloadMidi(rec));
  }
  if (rec.source === "eigen" || rec.sbProject) btn("🎹 Projekt öffnen", "Das Projekt öffnen, aus dem dieser Track entstanden ist", () => { showTab("selber"); if (window.mwsSelber && rec.sbProject) window.mwsSelber.open(rec.sbProject); });
  else btn("⤴︎ Weiterarbeiten", "Diesen Track zum aktuellen machen — ändern oder neue Versionen, mit seinem Charakter", () => continueFrom(rec));
  const delBtn = btn("🗑", rec.favorite ? "★ Favorit — geschützt. Erst den Stern entfernen, dann löschen." : "Löschen — auch auf dem Mac (Papierkorb)", () => deleteTracks([rec.id]), "danger");
  delBtn.disabled = !!rec.favorite;
  row.append(sel, pb, mid, act);
  row.addEventListener("dragstart", (e) => {
    // Gezogen wird die Auswahl, wenn die Zeile dazugehört — sonst nur diese Zeile.
    const ids = state.sel.has(rec.id) ? [...state.sel] : [rec.id];
    e.dataTransfer.setData("text/plain", JSON.stringify(ids));
    e.dataTransfer.effectAllowed = "move";
  });
  requestAnimationFrame(() => drawWave(cv, peaksFor(rec), player.id === rec.id && player.audio && player.audio.duration ? player.audio.currentTime / player.audio.duration : 0));
  return row;
}

// ---- 3.10: Veröffentlichen auf Fahrstuhlmusik ----
function webMenu(rec, anchor) {
  document.querySelectorAll(".web-pop").forEach(p => p.remove());
  const pop = el("div", "web-pop");
  pop.setAttribute("role", "menu");
  const item = (txt, fn) => { const b = el("button", "", txt); b.type = "button"; b.setAttribute("role", "menuitem"); b.onclick = () => { pop.remove(); fn(); }; pop.append(b); };
  item("↗︎ Auf Fahrstuhlmusik ansehen", () => window.open(rec.web.url, "_blank", "noopener"));
  item("⟳ Neu veröffentlichen (aktuelles Mastering)", () => webRun(rec, "web"));
  item("✕ Zurückziehen", () => { if (confirm(`„${rec.title}“ von Fahrstuhlmusik nehmen?`)) webRun(rec, "web_weg"); });
  anchor.parentElement.append(pop);
  setTimeout(() => document.addEventListener("click", function off(e) { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener("click", off); } }), 0);
}
async function webTrack(rec, anchor) {
  if (!macCan("web")) return setMsg($("#libMsg"), "Veröffentlichen braucht die Brücke 3.10 auf deinem Mac (⚙️ › Mac einrichten).", "err");
  if (rec.web) return webMenu(rec, anchor);
  if (!confirm(`„${rec.title}${rec.variant ? " · " + rec.variant : ""}“ auf Fahrstuhlmusik veröffentlichen?\n\n` +
      (rec.source === "eigen" ? "Jeder kann ihn dort kostenlos anhören. Hochgeladen wird die gemasterte Fassung mit Cover und deiner Notiz, gekennzeichnet als selbst eingespielt (Cover: KI). Zurückziehen geht jederzeit."
        : "Jeder kann ihn dort kostenlos anhören. Hochgeladen wird die gemasterte Fassung mit Cover, Liedtext und deiner Notiz, gekennzeichnet als KI-erzeugt. Zurückziehen geht jederzeit."))) return;
  webRun(rec, "web");
}
async function webRun(rec, kind) {
  const node = $("#libMsg");
  const label = `${rec.title}${rec.variant ? " · " + rec.variant : ""}`;
  setMsg(node, kind === "web" ? `🌐 „${label}“ wird veröffentlicht …` : `🌐 „${label}“ wird zurückgezogen …`, "busy");
  try {
    const extra = kind === "web" && rec.master ? { master: rec.master } : {};
    const j = await macJobTrack(kind, rec, extra, { timeoutMs: 30 * 60e3, onMsg: (x) => x.message && setMsg(node, `🌐 ${label}: ${x.message}`, "busy") });
    const r = j.result || {};
    const cur = (await libGet(rec.id)) || rec;
    await libPatch(rec.id, { web: kind === "web" ? { url: r.url, slug: r.slug, at: Date.now() } : null,
      ...(goodArchived(r.archived) && r.archived !== (cur.result || {}).archived ? { result: { ...(cur.result || {}), archived: r.archived } } : {}) });
    setMsg(node, kind === "web" ? `✓ „${label}“ ist online${r.replaced ? " (alte Fassung ersetzt)" : ""}: ${r.url}` : `✓ „${label}“ ist nicht mehr öffentlich.`, "ok");
  } catch (e) { setMsg(node, "✗ " + (e.message || e), "err"); }
  renderLibrary();
}

function continueFrom(rec) {
  const q = rec.request || {}, r = rec.result || {};
  const b = normalizeBrief({
    title: rec.title, caption: q.caption, lyrics: q.lyrics, bpm: q.bpm, keyscale: q.keyscale,
    timesignature: q.timesignature, duration: q.duration, vocal_language: q.vocal_language, note: rec.note,
    seeds: r.seed != null ? [r.seed] : q.seed != null ? [q.seed] : [], by: { who: "bibliothek" },
  });
  setBrief(b);
  $("#keep").checked = true;
  setMsg($("#curMsg"), "Übernommen — „Charakter behalten“ ist an: Ändern behält den Seed dieses Tracks.", "ok");
  $("#current").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---- Würfel (3.8): schreibt eine ausführliche Idee passend zur Auswahl und erzeugt SOFORT ----
// mit einem viel filigraneren Text, alles per Zufall". Gewählt bleibt gewählt (Richtungen, Gesang,
// Sprache, Länge, Versionen, Stimmung); ist keine Richtung gewählt, zieht der Würfel eine — ohne die
// Auswahl anzufassen, damit der nächste Wurf wieder frei ist.
function rollDice() {
  if (state.busy) return;
  const o = form();
  const genres = o.genres.length ? o.genres : [randomGenre()];
  $("#idea").value = composeIdea(genres, { vocals: o.vocals, mood: o.mood }).text;
  saveForm();
  const d = $("#diceBtn"); d.classList.remove("roll"); void d.offsetWidth; d.classList.add("roll");
  createTrack({ genres, label: "🎲 " + genres.join(" + ") });
}

// ---- Richtungen: Gruppen als Reiter, darunter die Richtungen der offenen Gruppe ----
// Alle Chips stehen im DOM (versteckte Gruppen nur verborgen) — form() und restoreForm() finden sie wie bisher.
function buildGenres() {
  const tabs = $("#genreTabs"), panels = $("#genrePanels");
  GENRE_GROUPS.forEach(g => {
    const t = el("button", "gtab");
    t.type = "button"; t.dataset.g = g.id; t.setAttribute("role", "tab");
    t.append(document.createTextNode(g.name), el("b", "", ""));
    t.onclick = () => { showGenreGroup(g.id); try { localStorage.setItem(LS_GENRE_TAB, g.id); } catch (e) {} };
    tabs.append(t);
    const p = el("div", "chips gpanel");
    p.dataset.g = g.id; p.setAttribute("role", "tabpanel"); p.hidden = true;
    g.genres.forEach(x => {
      const c = el("button", "chip", x.n);
      c.type = "button"; c.dataset.n = x.n;
      c.onclick = () => { c.classList.toggle("on"); saveForm(); renderGenrePicked(); };
      p.append(c);
    });
    panels.append(p);
  });
}
function showGenreGroup(id) {
  if (!GENRE_GROUPS.some(g => g.id === id)) id = GENRE_GROUPS[0].id;
  $$("#genreTabs .gtab").forEach(t => { const on = t.dataset.g === id; t.classList.toggle("on", on); t.setAttribute("aria-selected", on); });
  $$("#genrePanels .gpanel").forEach(p => { p.hidden = p.dataset.g !== id; });
  // Auf dem Handy scrollt die Reiterleiste seitlich — den offenen Reiter in die Mitte holen, ohne die Seite zu bewegen.
  const bar = $("#genreTabs"), t = $("#genreTabs .gtab.on");
  if (bar && t) bar.scrollLeft += t.getBoundingClientRect().left - bar.getBoundingClientRect().left - (bar.clientWidth - t.offsetWidth) / 2;
}
function renderGenrePicked() {
  const on = $$("#genres .chip.on").map(c => c.dataset.n);
  $$("#genreTabs .gtab").forEach(t => {
    const n = $$(`#genrePanels .gpanel[data-g="${t.dataset.g}"] .chip.on`).length;
    t.querySelector("b").textContent = n ? String(n) : "";
  });
  const box = $("#genrePicked");
  box.textContent = "";
  if (!on.length) { box.append(el("span", "sub", "Keine Richtung gewählt — 🎲 zieht dann selbst eine.")); return; }
  box.append(el("span", "sub", "Gewählt:"));
  on.forEach(n => {
    const x = el("button", "gtag", (window.mwsT || String)(n) + " ✕");
    x.type = "button"; x.title = "Abwählen";
    x.onclick = () => { $$("#genres .chip.on").filter(c => c.dataset.n === n).forEach(c => c.classList.remove("on")); saveForm(); renderGenrePicked(); };
    box.append(x);
  });
}

// =============================================================================
// Helfer
// =============================================================================
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
// 3.12: dataset.msg = die deutsche Fassung — die englische Oberfläche (i18n.js) übersetzt textContent, Vergleiche lesen hier
function setMsg(node, msg, cls) { if (!node) return; node.textContent = msg; node.dataset.msg = msg; node.className = "status" + (cls ? " " + cls : ""); }
function fmtDur(s) { s = Math.round(+s || 0); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }
function fmtBytes(n) { return n >= 1e9 ? (n / 1e9).toFixed(1) + " GB" : n >= 1e6 ? (n / 1e6).toFixed(0) + " MB" : Math.max(1, Math.round(n / 1e3)) + " KB"; }
function safe(s) { return (s || "track").replace(/[^\wäöüÄÖÜß\- ]+/g, "").trim().replace(/\s+/g, "_").slice(0, 50) || "track"; }
function download(blob, name) {
  const a = el("a"); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// =============================================================================
// Start
// =============================================================================
// =============================================================================
// 3.23: Ein-Klick-Update — nur in der lokalen Installation (der Server sagt enabled). Der Browser fragt den eigenen
// Ein Klick: Server lädt, prüft (Probestart), tauscht, startet neu — die Seite wartet auf die neue Version und lädt neu.
// Kein confirm(): ein Dialog des Browsers setzt in Safari den Ton aus (3.19).
// =============================================================================
const LS_UPD = "mws_upd_check";
const upd = { info: null, running: false, timer: 0 };
function updWanted() { try { return localStorage.getItem(LS_UPD) !== "0"; } catch (e) { return true; } }
async function updCheck({ net = updWanted(), force = false } = {}) {
  const r = await api(`/api/update?net=${net ? 1 : 0}${force ? "&force=1" : ""}`).catch(() => null);
  if (!r || !r.ok || !r.data) return null;
  upd.info = r.data;
  updPaint();
  return r.data;
}
function updPaint() {
  const i = upd.info || {};
  $("#updBox").classList.toggle("hidden", !i.enabled);
  const pill = $("#updPill");
  pill.classList.toggle("hidden", !(i.enabled && i.newer));
  if (i.enabled && i.newer) pill.textContent = `⬆ Update ${i.latest}`;
  if (!$("#updDlg").classList.contains("hidden") && !upd.running) updFill();
}
function updFill() {
  const i = upd.info || {};
  $("#updTitle").textContent = `⬆ Update auf ${i.latest}`;
  $("#updWhat").textContent = i.published ? `Installiert: ${i.current} · neu: ${i.latest} vom ${i.published}` : `Installiert: ${i.current} · neu: ${i.latest}`;
  $("#updNotes").textContent = String(i.notes || "").replace(/\r/g, "").trim();
  const link = $("#updLink"); link.href = i.url || "#"; link.classList.toggle("hidden", !i.url);
  const go = $("#updGo");
  go.classList.toggle("hidden", !!i.needs_installer);
  go.disabled = !!i.busy;
  $("#updHint").textContent = i.needs_installer
    ? "Diese Fassung braucht den Installer (neue Bausteine): Manuwave Studio schließen, das neue ZIP laden und den Installer starten — Musik, Bibliothek und Einstellungen bleiben."
    : i.busy ? "Gerade läuft ein Auftrag — das Update geht danach."
    : "Ein Klick: lädt die neue Fassung, prüft sie, sichert die alte und startet neu. Musik, Bibliothek und Einstellungen bleiben.";
}
function updOpen() {
  if (!upd.info || !upd.info.newer) return;
  updFill();
  setMsg($("#updMsg"), "", "");
  $("#updDlg").classList.remove("hidden");
  clearInterval(upd.timer);
  upd.timer = setInterval(() => { if (!upd.running && upd.info && upd.info.busy) updCheck({ net: false }); }, 5000);
}
function updClose() {
  if (upd.running) return;
  $("#updDlg").classList.add("hidden");
  clearInterval(upd.timer);
}
async function updGo() {
  const i = upd.info; if (!i || upd.running) return;
  upd.running = true;
  $("#updGo").disabled = true; $("#updLater").disabled = true;
  const msg = $("#updMsg");
  setMsg(msg, "Lädt …", "");
  const r = await api("/api/update/apply", { method: "POST", body: { tag: i.tag } }).catch(() => null);
  if (!r || !r.ok) {
    setMsg(msg, "✗ " + ((r && r.data && r.data.message) || "Update nicht möglich"), "err");
    upd.running = false; $("#updGo").disabled = false; $("#updLater").disabled = false;
    return;
  }
  const t0 = Date.now();
  while (Date.now() - t0 < 10 * 60 * 1000) {
    await new Promise(res => setTimeout(res, 1000));
    let v = null;
    try { v = await (await fetch("/version", { cache: "no-store" })).json(); } catch (e) { /* startet gerade neu */ }
    if (v && v.version === i.latest) {
      setMsg(msg, `✓ Fertig — Manuwave Studio ${i.latest} lädt neu …`, "ok");
      setTimeout(() => location.reload(), 700);
      return;
    }
    const s = await api("/api/update?net=0").catch(() => null);
    const st = s && s.ok && s.data && s.data.state;
    if (st && st.phase === "error") {
      setMsg(msg, "✗ " + st.message, "err");
      upd.running = false; $("#updGo").disabled = false; $("#updLater").disabled = false;
      return;
    }
    if (st && st.message) setMsg(msg, st.message, "");
  }
  setMsg(msg, "✗ Der Neustart dauert ungewöhnlich lange — Manuwave Studio schließen und neu öffnen.", "err");
  upd.running = false; $("#updLater").disabled = false;
}

function init() {
  //      ist kein Programmfehler — Safari meldete ihn trotzdem als unbehandelt. Nur genau diese werden still;
  //      alles andere bleibt sichtbar.
  addEventListener("unhandledrejection", (e) => {
    const r = e.reason, msg = String((r && r.message) || r || "");
    if (r instanceof TypeError && /Load failed|access control checks|Failed to fetch|NetworkError|network connection was lost/i.test(msg)) {
      e.preventDefault(); console.warn("Abruf abgebrochen:", msg);
    }
  });
  takeTokenFromHash();
  buildGenres();
  restoreForm();
  renderGenrePicked();
  {
    let tab = ""; try { tab = localStorage.getItem(LS_GENRE_TAB) || ""; } catch (e) {}
    const first = $("#genres .chip.on");
    showGenreGroup(tab || (first ? first.closest(".gpanel").dataset.g : "techno"));
  }
  const syncDur = () => { $("#durVal").textContent = "≈ " + fmtDur(+$("#dur").value); };
  const syncLang = () => { $("#langWrap").classList.toggle("dim", !sung(segValue("vocals"))); };
  $("#dur").addEventListener("input", () => { syncDur(); saveForm(); });
  ["vocals", "variants"].forEach(id => $$(`#${id} button`).forEach(b => b.onclick = () => { setSeg(id, b.dataset.v); syncLang(); saveForm(); }));
  ["#idea", "#lang", "#mood", "#bpm", "#key", "#quality"].forEach(s => $(s).addEventListener("change", saveForm));
  syncDur(); syncLang();

  $("#goBtn").onclick = () => createTrack();
  $("#idea").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) createTrack(); });
  $("#refBtn").onclick = () => $("#refFile").click();
  $("#refFile").onchange = (e) => { analyzeFiles(e.target.files); e.target.value = ""; };
  $("#refGo").onclick = () => createTrack({ label: "🧬 Aus deinen Songs" });
  loadRefs(); renderRefs();

  $("#refineBtn").onclick = () => refineTrack();
  $("#refineIn").addEventListener("keydown", (e) => { if (e.key === "Enter") refineTrack(); });
  $$("#refineChips .chip").forEach(c => c.onclick = () => refineTrack(c.textContent));
  $("#againBtn").onclick = renderAgain;
  $("#editRender").onclick = renderEdited;
  $("#bDur").oninput = () => { $("#bDurVal").textContent = "≈ " + fmtDur(+$("#bDur").value); };
  ["#bCaption", "#bLyrics"].forEach(s => $(s).addEventListener("input", checkEditor));

  try { state.view = localStorage.getItem(LS_VIEW) || "all"; } catch (e) {}
  $("#selAll").onchange = () => { const on = $("#selAll").checked; visibleIds().forEach(id => on ? state.sel.add(id) : state.sel.delete(id)); renderSelBar(); };
  $("#selNone").onclick = () => { state.sel.clear(); renderSelBar(); setMsg($("#selMsg"), "", ""); };
  $("#selDel").onclick = () => deleteTracks([...state.sel]);
  $("#selFav").onclick = () => favTracks([...state.sel]);
  $("#selExport").onclick = () => openExport([...state.sel]);
  $("#expGo").onclick = doExport;
  $("#expPack").addEventListener("change", updPack);
  $("#cvNew").onclick = () => coverOpen && newCover(coverOpen);
  $("#cvClose").onclick = closeCover;
  $("#cvImg").onclick = closeCover;
  $("#cvSave").onclick = async () => { const r = coverOpen && await libGet(coverOpen); if (r && r.cover) download(r.cover, `${safe(r.title)}${r.variant ? "_" + r.variant : ""}_Cover.jpg`); };
  $("#coverDlg").addEventListener("click", (e) => { if (e.target.id === "coverDlg") closeCover(); });
  window.addEventListener("scroll", peekHide, { passive: true });
  $("#expCancel").onclick = closeExport;
  bindMaster();
  libReady = libSplitOld();
  msRecoverPending();
  try { const lt = localStorage.getItem(LS_TAB); if (lt === "master" || lt === "selber" || lt === "loops") showTab(lt); } catch (e) {}
  $("#expFormats").addEventListener("change", updExpNote);
  $("#expToAlac").onclick = () => { $("#expFmt-alac").checked = true; updExpNote(); $("#expFmt-alac").focus(); };
  $("#exportDlg").addEventListener("click", (e) => { if (e.target.id === "exportDlg") closeExport(); });
  $("#finishToggle").onclick = () => { try { localStorage.setItem(LS_FINISH_OFF, finishOff() ? "0" : "1"); } catch (e) {} renderFinishLine(); scheduleFinish(100); };
  $("#macOnlyBtn").onclick = () => fetchMacOnly();
  $("#macOnlyMore").onclick = () => { const l = $("#macOnlyList"); l.classList.toggle("hidden"); $("#macOnlyMore").textContent = l.classList.contains("hidden") ? "Liste ▾" : "Liste ▴"; };
  $("#betterBtn").onclick = fetchBetter;
  $("#staleBtn").onclick = updateStale;
  $("#rSave").onclick = saveRights;
  Object.keys(RIGHT_FIELDS).forEach(id => $("#" + id).addEventListener("input", renderRightsPreview));
  [...Object.keys(RIGHT_FIELDS), ...Object.keys(RIGHT_CHECKS)].forEach(id => $("#" + id).addEventListener("change", autoSaveRights));
  EDIT_IDS.forEach(id => $("#" + id).addEventListener("input", saveEditDraft));
  EDIT_IDS.forEach(id => $("#" + id).addEventListener("change", saveEditDraft));
  try { $("#refineIn").value = localStorage.getItem(LS_REFINE) || $("#refineIn").value; } catch (e) {}
  $("#refineIn").addEventListener("input", () => { try { const v = $("#refineIn").value; if (v.trim()) localStorage.setItem(LS_REFINE, v); else localStorage.removeItem(LS_REFINE); } catch (e) {} });
  let ideaT = 0; $("#idea").addEventListener("input", () => { clearTimeout(ideaT); ideaT = setTimeout(saveForm, 300); });
  $("#verifyBtn").onclick = () => $("#verifyFile").click();
  $("#verifyFile").onchange = (e) => { verifyFile(e.target.files[0]); e.target.value = ""; };
  $("#selMove").onchange = () => { const v = $("#selMove").value; if (v) moveTracks([...state.sel], v); };
  // Zeilen auf einen Ordner ziehen (Vorbild: Music Generator)
  const bar = $("#folderBar");
  bar.addEventListener("dragover", (e) => { const c = e.target.closest("[data-drop]"); if (c) { e.preventDefault(); c.classList.add("drop"); } });
  bar.addEventListener("dragleave", (e) => { const c = e.target.closest("[data-drop]"); if (c) c.classList.remove("drop"); });
  bar.addEventListener("drop", (e) => {
    const c = e.target.closest("[data-drop]");
    if (!c) return;
    e.preventDefault(); c.classList.remove("drop");
    let ids = [];
    try { ids = JSON.parse(e.dataTransfer.getData("text/plain") || "[]"); } catch (x) {}
    if (Array.isArray(ids) && ids.length) moveTracks(ids, c.dataset.drop || "none");
  });
  $("#nowPlay").onclick = togglePause;
  $("#nowStop").onclick = stopPlayer;
  $("#nowTitle").onclick = () => { const p = player.id && rowParts(player.id); if (p) p.row.scrollIntoView({ behavior: "smooth", block: "center" }); };
  $("#nowSeek").onclick = (e) => {
    const r = $("#nowSeek").getBoundingClientRect();
    if (player.audio && player.audio.duration) { player.audio.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * player.audio.duration; paintProgress(); }
  };
  document.addEventListener("keydown", (e) => {
    if (e.code !== "Space" || ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(e.target.tagName)) return;
    if (!$("#selberView").classList.contains("hidden") || !$("#loopView").classList.contains("hidden")) return;
    if (!$("#masterView").classList.contains("hidden")) { e.preventDefault(); $("#msPlay").click(); return; }   // im Mastering-Tab die Vorschau
    if (player.id) { e.preventDefault(); togglePause(); }
  });
  $("#diceBtn").onclick = rollDice;
  ["#dit", "#smoothEnd", "#qaReroll"].forEach(x => $(x).addEventListener("change", saveForm));
  ["#dur", "#quality", "#dit"].forEach(x => $(x).addEventListener("input", renderEstimate));
  ["#quality", "#dit"].forEach(x => $(x).addEventListener("change", renderEstimate));
  $$("#variants button").forEach(b => b.addEventListener("click", renderEstimate));
  renderEstimate();

  $("#macPill").onclick = openSettings;
  $("#settingsBtn").onclick = openSettings;
  $("#pairNoteBtn").onclick = openSettings;
  $("#closeSettings").onclick = closeSettings;
  $("#wModel").addEventListener("change", chooseWriter);
  // 3.23 Update
  $("#updPill").onclick = updOpen;
  $("#updLater").onclick = updClose;
  $("#updGo").onclick = updGo;
  $("#updDlg").addEventListener("click", (e) => { if (e.target.id === "updDlg") updClose(); });
  $("#updAuto").checked = updWanted();
  $("#updAuto").onchange = () => { try { localStorage.setItem(LS_UPD, $("#updAuto").checked ? "1" : "0"); } catch (e) {} if ($("#updAuto").checked) updCheck(); else updPaint(); };
  $("#updNow").onclick = async () => {
    setMsg($("#updNowMsg"), "Sucht …", "");
    const i = await updCheck({ net: true, force: true });
    if (!i) setMsg($("#updNowMsg"), "✗ Keine Antwort vom Server", "err");
    else if (i.error) setMsg($("#updNowMsg"), "✗ " + i.error, "err");
    else if (i.newer) setMsg($("#updNowMsg"), `Neue Fassung ${i.latest} — oben rechts „Update“`, "ok");
    else setMsg($("#updNowMsg"), `✓ Du hast die neueste Fassung (${i.current})`, "ok");
  };
  updCheck();
  setInterval(() => { if (updWanted()) updCheck(); }, 6 * 3600 * 1000);
  $("#settings").addEventListener("click", (e) => { if (e.target.id === "settings") closeSettings(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeSettings(); closeExport(); closeCover(); updClose(); } });
  $("#pairBtn").onclick = claimCode;
  $("#pairCode").addEventListener("keydown", (e) => { if (e.key === "Enter") claimCode(); });
  $("#unpairBtn").onclick = () => { if (confirm("Kopplung mit dem Mac in DIESEM Browser lösen?")) setBridgeToken(""); };
  $("#oldKeyDel").onclick = () => {
    if (!confirm("Den alten Claude-API-Key aus diesem Browser entfernen?\nManuwave Studio braucht ihn nicht mehr.")) return;
    localStorage.removeItem(LS_OLD_KEY);
    localStorage.removeItem("nf_model");
    renderBridge();
  };

  try { const b = JSON.parse(localStorage.getItem(LS_BRIEF) || "null"); if (b && b.caption) state.brief = normalizeBrief(b); } catch (e) {}
  showCurrent();
  refreshBridge();
  setInterval(refreshBridge, 10000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { refreshBridge(); pollAgain(); keepScreen(); } });
  addEventListener("online", pollAgain);
  // Klick/Tastendruck noch einmal versuchen, solange einer fehlt (die Brücke hält den Mac ohnehin wach)
  ["pointerdown", "keydown"].forEach(t => addEventListener(t, () => { if (!wakeLock) keepScreen(); }, { capture: true, passive: true }));
  loadPending();
  renderLibrary();
  if (coverWatch().length) setTimeout(pollCovers, 1500);
  libAll().then(all => { const w = coverWatch(); const stale = all.filter(r => r.coverState === "pending" && !w.includes(r.id)).map(r => r.id);
    if (stale.length) libPatchMany(stale, () => ({ coverState: "" })).then(renderLibrary); }).catch(() => {});
  if (!$("#ver").textContent.trim()) {
    fetch("/version").then(r => r.json()).then(v => { $("#ver").textContent = "v" + v.version + (v.commit ? " · " + v.commit : ""); }).catch(() => {});
  }
}

init();
