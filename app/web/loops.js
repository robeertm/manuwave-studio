// Manuwave Studio 3.17 — Tab "🔁 Loop-Maschine": Generatoren starten, laufen lassen, live an allem drehen.
//
// Der Takt und alle Generatoren laufen im AudioWorklet (loops-engine.js, mit den Instrumenten aus selber-engine.js).
// Hier im Hauptthread: das Set (IndexedDB "mws_loops"), die Karten mit ihren Reglern, die Klangkette je Generator
// (Web Audio: Drive, Hochpass, Filter "Frequenz" mit Resonanz und Wobble-LFO, Tiefen/Mitten/Höhen, Echo, Hall, Panorama,
// Lautstärke), Master (DJ-Filter, Hall, Limiter), Mikrofon, Computertastatur und MIDI (auch Regler lernen), der
// Autopilot, "Den Rest übernehmen" (Gesang/Vorgabe → Tonart → passende Generatoren) und die Aufnahme in die Bibliothek.
// Zweisprachig aus sich heraus (T(de, en)), die Ansicht steht unter translate="no" (Regel aus 3.12).
import { SCHEMA, KITS, MODELS, MODEL_GROUPS, PRESETS, defaults, knobIdle, markIdle, showValue, fixText } from "./selber-presets.js";

const EN = window.MWS_LANG === "en";
const T = (de, en) => (EN ? en : de);
const q = (s, r = document) => r.querySelector(s);
const qa = (s, r = document) => [...r.querySelectorAll(s)];
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "style") e.style.cssText = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const uid = () => Math.random().toString(36).slice(2, 9);
const dbGain = (db) => (db <= -60 ? 0 : Math.pow(10, db / 20));
const MAX_GEN = 12, SPB = 16, HEADROOM = 0.6, SCOPE_N = 2048;
const COLORS = ["#ff4d94", "#22e3c3", "#7c5cff", "#ffb347", "#5cc8ff", "#b6f36a", "#ff7a59", "#e07cff", "#4dd6ff", "#ffd84d", "#8ef0c9", "#ff9ec7"];
const LS_LAST = "mws_lp_last", LS_MAP = "mws_lp_midimap", LS_KB = "mws_lp_kbsmall";
const ROOTS = EN ? ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"] : ["C", "C♯", "D", "Es", "E", "F", "F♯", "G", "As", "A", "B", "H"];
const SCALES = [["minor", "Moll", "minor"], ["major", "Dur", "major"], ["dorian", "Dorisch", "Dorian"], ["phrygian", "Phrygisch", "Phrygian"],
  ["lydian", "Lydisch", "Lydian"], ["mixolydian", "Mixolydisch", "Mixolydian"], ["harmonic", "Harmonisch Moll", "harmonic minor"],
  ["minpenta", "Moll-Pentatonik", "minor pentatonic"], ["majpenta", "Dur-Pentatonik", "major pentatonic"], ["blues", "Blues", "blues"]];
const ROOTS_EN = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const MAJORISH = ["major", "lydian", "mixolydian", "majpenta"];
const PROGS = [
  ["i6", "i – VI – III – VII", [0, 5, 2, 6]], ["i4", "i – iv – v – i", [0, 3, 4, 0]], ["i76", "i – VII – VI – VII", [0, 6, 5, 6]],
  ["pop", "I – V – vi – IV", [0, 4, 5, 3]], ["vi", "vi – IV – I – V", [5, 3, 0, 4]], ["251", "ii – V – I – I", [1, 4, 0, 0]],
  ["i3", "i – III – VII – iv", [0, 2, 6, 3]], ["iiv", "i – iv", [0, 3]], ["one", T("nur Grundton", "root only"), [0]]];
// Richtungen für "Den Rest übernehmen" und 🎲 — welche Generatoren, welche Klänge
const STYLES = {
  house: { de: "House", en: "House", bpm: 124, beat: "house", kit: "909", bass: "offbeat", bassP: "mono|Fetter Bass", chords: "stabs", chordP: "m1|House-Orgel (kurz)", arp: null, prog: "i6" },
  techno: { de: "Techno", en: "Techno", bpm: 130, beat: "techno", kit: "techno", bass: "acid", bassP: "acid|303 Klassisch (Säge)", chords: "stabs", chordP: "poly|Dunkler Drone", arp: "wave|Glasglocke", prog: "one" },
  synthwave: { de: "Synthwave", en: "Synthwave", bpm: 100, beat: "pop", kit: "80s", bass: "pulse", bassP: "minimoog|Moog-Bass klassisch", chords: "pad", chordP: "juno|Juno-Fläche (Chorus II)", arp: "juno|Juno-Glocken-Arp", prog: "i76" },
  hiphop: { de: "Hip-Hop", en: "Hip-hop", bpm: 90, beat: "hiphop", kit: "808", bass: "synco", bassP: "mono|Sub 808", chords: "half", chordP: "rhodes|Suitcase (Stereo-Tremolo)", arp: null, prog: "i4" },
  lofi: { de: "Lo-Fi", en: "Lo-fi", bpm: 82, beat: "lofi", kit: "lofi", bass: "root", bassP: "minimoog|Sub-Bass rund", chords: "half", chordP: "rhodes|Ballade (weich)", arp: null, prog: "251" },
  trap: { de: "Trap", en: "Trap", bpm: 140, beat: "trap", kit: "trap", bass: "root", bassP: "mono|Sub 808", chords: "pad", chordP: "cs80|CS-80-Fläche", arp: "fm|Marimba", prog: "i6" },
  dnb: { de: "Drum & Bass", en: "Drum & bass", bpm: 172, beat: "dnb", kit: "909", bass: "root", bassP: "mono|Reese", chords: "pad", chordP: "strings|Dunkle Celli", arp: null, prog: "i3" },
  disco: { de: "Disco / Nu-Disco", en: "Disco / nu-disco", bpm: 118, beat: "disco", kit: "80s", bass: "octave", bassP: "minimoog|Funk-Bass gezupft", chords: "offbeat", chordP: "clav|Clavinet D6", arp: "super|Supersaw-Pluck", prog: "pop" },
  pop: { de: "Pop", en: "Pop", bpm: 110, beat: "pop", kit: "80s", bass: "pulse", bassP: "jupiter|Unisono-Bass", chords: "pulse", chordP: "prophet|Prophet-Keys", arp: null, prog: "pop" },
  ambient: { de: "Ambient", en: "Ambient", bpm: 78, beat: "ambient", kit: "lofi", bass: "root", bassP: "taurus|Taurus-Drone", chords: "pad", chordP: "ppg|PPG-Fläche", arp: "wave|Glasglocke", prog: "vi" },
};

// ---- Regler-Bausteine (wie in selber-presets.js) ----
const K = (k, de, en, min, max, def, o = {}) => ({ t: "knob", k, de, en, min, max, def, ...o });
const SEL = (k, de, en, opts, def, o = {}) => ({ t: "sel", k, de, en, opts, def, ...o });
const TOG = (k, de, en, def = false, o = {}) => ({ t: "tog", k, de, en, def, ...o });
const BARS = (def, opts = [1, 2, 4, 8]) => SEL("bars", "Schleife", "Loop", opts.map(n => [n, n + (n === 1 ? " Takt" : " Takte"), n + (n === 1 ? " bar" : " bars")]), def, { regen: 1 });
const BEAT_STYLES = [["house", "House", "House"], ["techno", "Techno", "Techno"], ["breakbeat", "Breakbeat", "Breakbeat"], ["hiphop", "Hip-Hop (Boom-Bap)", "Hip-hop (boom bap)"],
  ["trap", "Trap", "Trap"], ["dnb", "Drum & Bass", "Drum & bass"], ["lofi", "Lo-Fi", "Lo-fi"], ["reggaeton", "Reggaeton", "Reggaeton"], ["pop", "Pop / Rock", "Pop / rock"],
  ["disco", "Disco", "Disco"], ["ambient", "Ambient (spärlich)", "Ambient (sparse)"]];
const RATES = [["1/4", "1/4", "1/4"], ["1/8", "1/8", "1/8"], ["1/16", "1/16", "1/16"], ["1/16T", "1/16 Triole", "1/16 triplet"], ["1/32", "1/32", "1/32"]];
const OSC_WAVES = [["sine", "Sinus", "Sine"], ["tri", "Dreieck", "Triangle"], ["saw", "Säge", "Saw"], ["square", "Rechteck / Puls", "Square / pulse"],
  ["supersaw", "Supersaw (7 Sägen)", "Supersaw (7 saws)"], ["noise", "Rauschen weiß", "White noise"], ["pink", "Rauschen rosa", "Pink noise"], ["brown", "Rauschen braun", "Brown noise"]];
const KIND = {
  beat: { icon: "🥁", de: "Beat", en: "Beat", hd: "Schlagzeug, das sich selbst ausdenkt — Stil, Dichte, Variation, Fills", he: "Drums that make themselves up — style, density, variation, fills",
    p: [SEL("style", "Stil", "Style", BEAT_STYLES, "house", { regen: 1 }), K("density", "Dichte", "Density", 0, 1, 0.5, { u: "%", regen: 1 }), K("variation", "Variation", "Variation", 0, 1, 0.3, { u: "%" }),
      K("human", "Menschlich", "Human feel", 0, 1, 0.2, { u: "%", regen: 1 }), TOG("fill", "Fills", "Fills", true, { regen: 1 }), BARS(2, [1, 2, 4])] },
  bass: { icon: "🎸", de: "Bass", en: "Bass", hd: "Basslinie zur Akkordfolge", he: "Bass line that follows the chords", ins: "bass",
    p: [SEL("style", "Spielweise", "Pattern", [["pulse", "Achtel-Puls", "8th pulse"], ["root", "Grundton lang", "Long roots"], ["offbeat", "Offbeat (House)", "Offbeat (house)"],
      ["octave", "Oktaven (Disco)", "Octaves (disco)"], ["acid", "Acid (303)", "Acid (303)"], ["synco", "Synkopiert (Funk)", "Syncopated (funk)"], ["walking", "Laufend", "Walking"]], "pulse", { regen: 1 }),
      K("density", "Dichte", "Density", 0, 1, 0.6, { u: "%", regen: 1 }), K("variation", "Variation", "Variation", 0, 1, 0.25, { u: "%" }), K("oct", "Oktave", "Octave", -2, 2, 0, { st: 1 }), BARS(2, [1, 2, 4])] },
  chords: { icon: "🎹", de: "Akkorde", en: "Chords", hd: "Akkorde in der Tonart, weich geführt", he: "Chords in key, smoothly voiced", ins: "chords",
    p: [SEL("style", "Rhythmus", "Rhythm", [["pad", "Fläche (ganzer Takt)", "Pad (whole bar)"], ["half", "Halbe", "Halves"], ["stabs", "Stabs (kurz)", "Stabs (short)"],
      ["offbeat", "Offbeat", "Offbeat"], ["pulse", "Achtel", "8ths"]], "pad", { regen: 1 }), K("color", "Farbe (7/9)", "Colour (7/9)", 0, 1, 0.3, { u: "%", regen: 1 }),
      K("density", "Dichte", "Density", 0, 1, 0.5, { u: "%", regen: 1 }), K("variation", "Variation", "Variation", 0, 1, 0.2, { u: "%" }), K("oct", "Lage", "Register", -1, 1, 0, { st: 1 }), BARS(1, [1, 2, 4])] },
  arp: { icon: "✨", de: "Arpeggio", en: "Arpeggio", hd: "Zerlegte Akkorde im Takt", he: "Broken chords in time", ins: "arp",
    p: [SEL("rate", "Noten", "Rate", RATES, "1/16", { regen: 1 }), SEL("mode", "Richtung", "Direction", [["up", "aufwärts", "up"], ["down", "abwärts", "down"], ["updown", "auf & ab", "up & down"], ["random", "zufällig", "random"]], "up", { regen: 1 }),
      K("octaves", "Oktaven", "Octaves", 1, 4, 2, { st: 1, regen: 1 }), K("gate", "Notenlänge", "Gate", 0.1, 1, 0.5, { u: "%", regen: 1 }), K("density", "Dichte", "Density", 0, 1, 0.9, { u: "%", regen: 1 }),
      K("variation", "Variation", "Variation", 0, 1, 0.15, { u: "%" }), K("oct", "Oktave", "Octave", -2, 2, 0, { st: 1 }), K("color", "Farbe (7)", "Colour (7)", 0, 1, 0, { u: "%", regen: 1 }), BARS(1, [1, 2, 4])] },
  melody: { icon: "🎶", de: "Melodie", en: "Melody", hd: "Ein Motiv, das wiederkommt und sich entwickelt", he: "A motif that returns and develops", ins: "lead",
    p: [K("density", "Dichte", "Density", 0, 1, 0.5, { u: "%", regen: 1 }), K("range", "Umfang", "Range", 2, 10, 5, { st: 1, regen: 1 }), K("variation", "Variation", "Variation", 0, 1, 0.3, { u: "%" }),
      K("oct", "Oktave", "Octave", -2, 2, 0, { st: 1 }), BARS(4)] },
  seed: { icon: "🎼", de: "Vorgabe", en: "Your bars", hd: "Spiel ein paar Takte ein — die Maschine spielt sie und spinnt sie weiter", he: "Play a few bars — the machine plays them and spins them on", ins: "lead",
    p: [BARS(2, [1, 2, 4]), K("life", "Eigenleben", "Life of its own", 0, 1, 0.4, { u: "%" }), TOG("follow", "Akkorden folgen", "Follow chords", false), K("oct", "Oktave", "Octave", -2, 2, 0, { st: 1 })] },
  osc: { icon: "〰️", de: "Oszillator", en: "Oscillator", hd: "Freier Klangerzeuger: Dauerton, Rauschen, LFO, Tor im Takt", he: "Free tone generator: drone, noise, LFO, gate in time",
    p: [SEL("wave", "Welle", "Wave", OSC_WAVES, "saw"), K("freq", "Frequenz", "Frequency", 20, 8000, 110, { c: "exp", u: "Hz" }),
      SEL("snap", "Einrasten", "Snap", [["off", "frei", "free"], ["scale", "Tonart", "to key"], ["root", "Grundton/Quinte", "root/fifth"]], "scale"),
      K("fine", "Fein", "Fine", -100, 100, 0, { u: "ct" }), K("uni", "Stimmen", "Voices", 1, 7, 1, { st: 1 }), K("det", "Verstimmung", "Detune", 0, 1, 0.15, { u: "%" }),
      K("sub", "Sub", "Sub", 0, 1, 0, { u: "%" }), K("pw", "Pulsbreite", "Pulse width", 0.05, 0.95, 0.5, { u: "%" }), K("fmr", "FM-Verhältnis", "FM ratio", 0.25, 8, 2, { c: "exp", u: "x" }),
      K("fma", "FM-Menge", "FM amount", 0, 1, 0, { u: "%" }), SEL("gate", "Tor", "Gate", [["off", "Dauerton", "drone"], ["1/4", "1/4", "1/4"], ["1/8", "1/8", "1/8"], ["1/16", "1/16", "1/16"],
        ["1/8T", "1/8 Triole", "1/8 triplet"], ["1/16T", "1/16 Triole", "1/16 triplet"], ["rand", "zufällig (1/16)", "random (1/16)"]], "off"),
      K("gatelen", "Torlänge", "Gate length", 0.05, 1, 0.5, { u: "%" }), K("glide", "Gleiten", "Glide", 0, 2, 0.08, { c: "exp0", u: "s" }), K("drift", "Drift", "Drift", 0, 1, 0, { u: "%" }),
      SEL("lshape", "LFO-Form", "LFO shape", [["sine", "Sinus", "Sine"], ["tri", "Dreieck", "Triangle"], ["saw", "Säge", "Saw"], ["square", "Rechteck", "Square"], ["sh", "Zufall (S&H)", "Random (S&H)"]], "sine"),
      K("lrate", "LFO-Tempo", "LFO rate", 0.02, 20, 0.5, { c: "exp", u: "Hz" }),
      SEL("lsync", "LFO im Takt", "LFO sync", [["off", "frei (Hz)", "free (Hz)"], ["4/1", "4 Takte", "4 bars"], ["2/1", "2 Takte", "2 bars"], ["1/1", "1 Takt", "1 bar"], ["1/2", "1/2", "1/2"],
        ["1/4", "1/4", "1/4"], ["1/8", "1/8", "1/8"], ["1/16", "1/16", "1/16"], ["1/4T", "1/4 Triole", "1/4 triplet"], ["1/8T", "1/8 Triole", "1/8 triplet"]], "off"),
      SEL("ldest", "LFO-Ziel", "LFO target", [["off", "aus", "off"], ["pitch", "Tonhöhe", "Pitch"], ["amp", "Lautstärke", "Volume"], ["pw", "Pulsbreite", "Pulse width"], ["pan", "Panorama", "Pan"], ["fm", "FM-Menge", "FM amount"]], "off"),
      K("lamt", "LFO-Menge", "LFO amount", 0, 1, 0, { u: "%" }), K("level", "Pegel", "Level", 0, 1, 0.6, { u: "%" })] },
  audio: { icon: "🎤", de: "Mikrofon-Loop", en: "Mic loop", hd: "Einsingen oder -spielen im Takt — Schichten übereinander (Overdub)", he: "Sing or play in time — layer on layer (overdub)",
    p: [BARS(2), K("level", "Pegel", "Level", 0, 1.5, 0.9, { u: "%" }), K("chop", "Stottern", "Stutter", 0, 1, 0, { u: "%" }), TOG("reverse", "Rückwärts", "Reverse", false),
      K("lat", "Versatz", "Offset", -60, 120, 0, { u: "ms", st: 1 })] },
};
const FX = [
  K("cut", "Frequenz", "Frequency", 40, 20000, 20000, { c: "exp", u: "Hz" }), K("res", "Resonanz", "Resonance", 0, 1, 0.1, { u: "%" }),
  K("hp", "Hochpass", "High-pass", 20, 4000, 20, { c: "exp", u: "Hz" }), K("lo", "Tiefen", "Lows", -15, 15, 0, { u: "dB" }), K("mid", "Mitten", "Mids", -15, 15, 0, { u: "dB" }),
  K("hi", "Höhen", "Highs", -15, 15, 0, { u: "dB" }), K("drive", "Drive", "Drive", 0, 1, 0, { u: "%" }),
  SEL("wob", "Wobble", "Wobble", [["off", "aus", "off"], ["1/1", "1 Takt", "1 bar"], ["1/2", "1/2", "1/2"], ["1/4", "1/4", "1/4"], ["1/8", "1/8", "1/8"], ["1/16", "1/16", "1/16"], ["1/4T", "1/4 Triole", "1/4 triplet"], ["1/8T", "1/8 Triole", "1/8 triplet"]], "off"),
  K("wdepth", "Tiefe", "Depth", 0, 1, 0.5, { u: "%" }),
  K("echo", "Echo", "Echo", 0, 1, 0, { u: "%" }), SEL("etime", "Echo-Zeit", "Echo time", [["1/16", "1/16", "1/16"], ["1/8", "1/8", "1/8"], ["3/16", "3/16 (pkt.)", "3/16 (dotted)"],
    ["1/4", "1/4", "1/4"], ["3/8", "3/8 (pkt.)", "3/8 (dotted)"], ["1/2", "1/2", "1/2"], ["1/8T", "1/8 Triole", "1/8 triplet"], ["1/4T", "1/4 Triole", "1/4 triplet"]], "3/16"),
  K("efb", "Feedback", "Feedback", 0, 0.92, 0.4, { u: "%" }), K("rev", "Hall", "Reverb", 0, 1, 0.15, { u: "%" }),
  K("pan", "Panorama", "Pan", -1, 1, 0, { u: "pan" }), K("vol", "Lautstärke", "Volume", -40, 6, -6, { u: "dB" }),
];
// Live-Regler in Gruppen wie auf einem Mischpultkanal
const FX_GROUPS = [["filter", "Filter", "Filter", ["cut", "res", "hp", "wob", "wdepth"]], ["tone", "Klangfarbe", "Tone", ["lo", "mid", "hi", "drive"]],
  ["space", "Raum", "Space", ["echo", "etime", "efb", "rev"]], ["mix", "Kanal", "Channel", ["pan", "vol"]]];
const SYNC_STEPS = { "1/16": 1, "1/8": 2, "3/16": 3, "1/4": 4, "3/8": 6, "1/2": 8, "1/1": 16, "1/8T": 4 / 3, "1/4T": 8 / 3 };

const S = {
  set: null, ready: false, ctx: null, g: null, chains: new Map(), running: false, bar: -1, step: -1, barTime: 0, spb: 2,
  sel: null, octave: 0, vel: 0.85, kbDown: new Map(), midi: null, map: {}, learn: false, learnTarget: null,
  mic: null, rec: null, auto: { log: "", plan: [], fx: [] }, states: new Map(), recArm: null, saveT: 0, msgT: 0,
  tapUsers: new Set(), barWait: [], ki: { open: false, busy: false },
};
// Abgriff hinter dem Limiter: mehrere Nutzer (Aufnahme, Mitschnitt für die KI) — an, solange einer zuhört
function tapOn(fn) { S.tapUsers.add(fn); S.g.tap.port.postMessage({ on: true }); }
function tapOff(fn) { S.tapUsers.delete(fn); if (!S.tapUsers.size && S.g) S.g.tap.port.postMessage({ on: false }); }
const nextBar = () => new Promise(res => S.barWait.push(res));

// =====================================================================================================
// Speichern
// =====================================================================================================
let _db = null;
function db() {
  if (_db) return _db;
  _db = new Promise((res, rej) => {
    let r; try { r = indexedDB.open("mws_loops", 1); } catch (e) { rej(e); return; }
    r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains("sets")) d.createObjectStore("sets", { keyPath: "id" });
      if (!d.objectStoreNames.contains("audio")) d.createObjectStore("audio", { keyPath: "id" }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return _db;
}
async function dbDo(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => { const tx = d.transaction(store, mode); const st = tx.objectStore(store); let out; const r = fn(st);
    if (r) r.onsuccess = () => { out = r.result; }; tx.oncomplete = () => res(out); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
}
const dbPut = (s, v) => dbDo(s, "readwrite", st => st.put(v));
const dbGet = (s, id) => dbDo(s, "readonly", st => st.get(id));
const dbAll = (s) => dbDo(s, "readonly", st => st.getAll());
const dbDel = (s, id) => dbDo(s, "readwrite", st => st.delete(id));
function lsGet(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* privates Fenster */ } }
function changed() { clearTimeout(S.saveT); setSaved(T("ungespeichert …", "unsaved …")); S.saveT = setTimeout(save, 800); }
async function save() {
  clearTimeout(S.saveT); if (!S.set) return;
  S.set.changed = Date.now();
  try { await dbPut("sets", JSON.parse(JSON.stringify(S.set))); lsSet(LS_LAST, S.set.id);
    setSaved(T("gespeichert ", "saved ") + new Date().toLocaleTimeString(EN ? "en-GB" : "de-DE", { hour: "2-digit", minute: "2-digit" }) + " ✓"); }
  catch (e) { setSaved(T("Speichern nicht möglich (privates Fenster?)", "Can't save (private window?)")); }
}
function setSaved(t) { const e = q("#lpSaved"); if (e) e.textContent = t; }
async function saveLayers(gen, layers) {
  try {
    const all = await dbAll("audio"); for (const a of all) if (a.set === S.set.id && a.gen === gen.id) await dbDel("audio", a.id);
    let n = 0; for (const l of layers) await dbPut("audio", { id: S.set.id + ":" + gen.id + ":" + (n++), set: S.set.id, gen: gen.id, n, bars: l.bars, bpm: l.bpm, L: l.L, R: l.R });
  } catch (e) { status(T("Schleife konnte nicht gespeichert werden: ", "Couldn't save the loop: ") + (e.message || e)); }
}
async function loadLayers(gen) {
  try { return (await dbAll("audio")).filter(a => a.set === S.set.id && a.gen === gen.id).sort((a, b) => a.n - b.n).map(a => ({ L: a.L, R: a.R, bars: a.bars, bpm: a.bpm })); }
  catch (e) { return []; }
}

// =====================================================================================================
// Set und Generatoren
// =====================================================================================================
const presetKey = (pr) => pr.model + "|" + pr.de;
const findPreset = (key) => PRESETS.find(p => presetKey(p) === key);
const modelOf = (id) => MODELS.find(m => m.id === id) || MODELS[0];
function patchFrom(key) {
  const pr = findPreset(key) || PRESETS[0];
  const m = modelOf(pr.model);
  return { model: m.id, preset: presetKey(pr), patch: Object.assign(defaults(m.engine), JSON.parse(JSON.stringify(pr.patch))), chorus: pr.ch || 0 };
}
const KIND_PRESET = { bass: "mono|Fetter Bass", chords: "prophet|Prophet-Fläche warm", arp: "poly|Glasklare Keys", melody: "mono|Leiter-Lead", seed: "poly|Glasklare Keys" };
function fxDefaults() { const o = {}; for (const p of FX) o[p.k] = p.def; return o; }
function genDefaults(kind) { const o = {}; for (const p of KIND[kind].p) o[p.k] = p.def; return o; }
function freeSlot() { const used = new Set(S.set.gens.map(g => g.slot)); for (let i = 0; i < MAX_GEN; i++) if (!used.has(i)) return i; return -1; }
function newGen(kind, o = {}) {
  const slot = freeSlot(); if (slot < 0) return null;
  const used = new Set(S.set.gens.map(g => g.color));
  const g = { id: uid(), kind, name: T(KIND[kind].de, KIND[kind].en), color: COLORS.find(c => !used.has(c)) || COLORS[slot % COLORS.length], slot,
    p: Object.assign(genDefaults(kind), o.p || {}), fx: Object.assign(fxDefaults(), o.fx || {}) };
  if (kind === "beat") { g.kit = o.kit || "909"; }
  else if (KIND[kind].ins) Object.assign(g, patchFrom(o.preset || KIND_PRESET[kind]));
  if (kind === "osc") Object.assign(g.fx, { cut: 2400, res: 0.35, vol: -10, rev: 0.25 }, o.fx || {});
  if (kind === "chords" || kind === "arp") g.fx.echo = kind === "arp" ? 0.25 : 0;
  return g;
}
function demoSet() {
  const st = STYLES.synthwave;
  S.set = { v: 1, id: uid(), name: T("Neon-Schleife", "Neon loop"), bpm: st.bpm, swing: 0.5, root: 9, scale: "minor", prog: "i76", per: 1, style: "synthwave",
    master: { vol: 0, dj: 0, revSize: 0.6, revDecay: 2.6 }, auto: { on: false, amt: 0.5 }, gens: [], created: Date.now(), changed: Date.now() };
  buildStyle(st, { onlyAdd: true });
  const o = newGen("osc", { p: { wave: "supersaw", freq: 55, snap: "root", level: 0.5, ldest: "pitch", lamt: 0.01, lrate: 0.2 }, fx: { cut: 900, res: 0.4, wob: "1/2", wdepth: 0.35 } });
  if (o) { o.name = T("Drone", "Drone"); S.set.gens.push(o); }
  return S.set;
}
function buildStyle(st, { onlyAdd = false } = {}) {
  const add = [];
  const mk = (kind, o, name) => { const g = newGen(kind, o); if (g) { if (name) g.name = name; S.set.gens.push(g); add.push(g); } return g; };
  const have = (kind) => S.set.gens.find(g => g.kind === kind);
  if (!have("beat")) mk("beat", { kit: st.kit, p: { style: st.beat } });
  else if (!onlyAdd) { const g = have("beat"); g.p.style = st.beat; g.kit = st.kit; }
  if (!have("bass")) mk("bass", { preset: st.bassP, p: { style: st.bass } });
  else if (!onlyAdd) { const g = have("bass"); g.p.style = st.bass; Object.assign(g, patchFrom(st.bassP)); }
  if (!have("chords")) mk("chords", { preset: st.chordP, p: { style: st.chords }, fx: { rev: 0.3 } });
  else if (!onlyAdd) { const g = have("chords"); g.p.style = st.chords; Object.assign(g, patchFrom(st.chordP)); }
  if (st.arp && !have("arp")) mk("arp", { preset: st.arp, fx: { echo: 0.3, rev: 0.25 } });
  return add;
}
function fixSet(s) {
  s.master = Object.assign({ vol: 0, dj: 0, revSize: 0.6, revDecay: 2.6 }, s.master || {});
  s.auto = Object.assign({ on: false, amt: 0.5 }, s.auto || {});
  s.gens = (s.gens || []).filter(g => KIND[g.kind]).slice(0, MAX_GEN);
  const used = new Set();
  for (const g of s.gens) {
    g.p = Object.assign(genDefaults(g.kind), g.p || {}); g.fx = Object.assign(fxDefaults(), g.fx || {});
    if (g.slot == null || used.has(g.slot) || g.slot >= MAX_GEN) { for (let i = 0; i < MAX_GEN; i++) if (!used.has(i)) { g.slot = i; break; } }
    used.add(g.slot);
    if (KIND[g.kind].ins && !g.patch) Object.assign(g, patchFrom(KIND_PRESET[g.kind]));
  }
  return s;
}
// Ausgleich: viele Bass-Klänge stehen eine Oktave tiefer (Oszillator 1 auf −1) — der Generator rechnet das heraus
function comp(g) { if (!g.patch || g.patch.engine !== "va") return 0; return -12 * Math.min(0, Math.round(g.patch.o1oct || 0)); }
function drumPatch(g) { const k = KITS[g.kit] || KITS["909"]; return Object.assign(defaults("drums"), { kit: JSON.parse(JSON.stringify(k.kit)), kitName: g.kit }); }
function engineGen(g) {
  const p = Object.assign({}, g.p, { comp: comp(g) });
  if (g.kind === "audio") p.lat = undefined;
  return { id: g.id, kind: g.kind, slot: g.slot, p, patch: g.kind === "beat" ? drumPatch(g) : g.patch || null };
}

// =====================================================================================================
// Audio
// =====================================================================================================
function makeIR(ctx, size, decay) {
  const sr = ctx.sampleRate, len = Math.floor(sr * clamp(decay, 0.3, 8)), pre = Math.floor(sr * (0.005 + size * 0.03));
  const buf = ctx.createBuffer(2, len + pre, sr);
  let seed = 12345;
  const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) / 4294967296) * 2 - 1; };
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c); let lp = 0;
    for (let i = 0; i < len; i++) { const t = i / sr, env = Math.pow(10, -3 * t / decay), k = 0.15 + 0.8 * Math.min(1, t / decay); const x = rnd(); lp = lp + (x - lp) * (1 - k); d[pre + i] = lp * env * 0.35; }
    for (let e = 0; e < 7; e++) { const at = pre + Math.floor(sr * (0.004 + size * 0.012 * (e + 1) + (c ? 0.0017 : 0))); if (at < d.length) d[at] += (0.5 - e * 0.06) * (e % 2 ? -1 : 1); }
  }
  return buf;
}
async function ensureAudio() {
  if (S.ctx && S.g) { if (S.ctx.state !== "running") { try { await S.ctx.resume(); } catch (e) { /* braucht eine Geste */ } } return true; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC || !window.AudioWorkletNode) { status(T("Dieser Browser kann keine Loop-Maschine (AudioWorklet fehlt).", "This browser can't run the loop machine (no AudioWorklet).")); return false; }
  try { S.ctx = new AC({ latencyHint: "interactive", sampleRate: 48000 }); } catch (e) { S.ctx = new AC({ latencyHint: "interactive" }); }
  try { await S.ctx.audioWorklet.addModule("selber-engine.js"); await S.ctx.audioWorklet.addModule("loops-engine.js"); }
  catch (e) { status(T("Klangmotor nicht geladen: ", "Sound engine failed to load: ") + (e.message || e)); S.ctx = null; return false; }
  buildGraph();
  if (S.ctx.state !== "running") { try { await S.ctx.resume(); } catch (e) { /* */ } }
  syncAll();
  for (const g of S.set.gens) if (g.kind === "audio") loadLayers(g).then(ls => { if (ls.length) post({ t: "layers", id: g.id, layers: ls }); paintCard(g); });
  meterLoop();
  return true;
}
function buildGraph() {
  const c = S.ctx;
  const node = new AudioWorkletNode(c, "mws-loops", { numberOfInputs: 1, numberOfOutputs: MAX_GEN + 1, outputChannelCount: new Array(MAX_GEN + 1).fill(2) });
  const bus = c.createGain(); bus.gain.value = HEADROOM;
  // DJ-Filter (Regler) und eigener Filter für den Autopilot, damit er den Regler nicht verstellt
  const djLP = c.createBiquadFilter(), djHP = c.createBiquadFilter(), apLP = c.createBiquadFilter(), apHP = c.createBiquadFilter();
  djLP.type = apLP.type = "lowpass"; djHP.type = apHP.type = "highpass"; djLP.frequency.value = apLP.frequency.value = 20000; djHP.frequency.value = apHP.frequency.value = 10;
  djLP.Q.value = djHP.Q.value = 1.1; apLP.Q.value = apHP.Q.value = 0.9;
  const mvol = c.createGain();
  const limiter = new AudioWorkletNode(c, "mws-limiter", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { ceil: -1.5 } });
  const tap = new AudioWorkletNode(c, "mws-tap", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
  const out = c.createGain();
  bus.connect(djLP); djLP.connect(djHP); djHP.connect(apLP); apLP.connect(apHP); apHP.connect(mvol); mvol.connect(limiter); limiter.connect(tap); tap.connect(out); out.connect(c.destination);
  const revIn = c.createGain(), rev = c.createConvolver(), revOut = c.createGain(); rev.normalize = false; revOut.gain.value = 0.8;
  revIn.connect(rev); rev.connect(revOut); revOut.connect(bus);
  const metro = c.createGain(); metro.gain.value = 0.5; node.connect(metro, MAX_GEN); metro.connect(c.destination);
  const an = c.createAnalyser(); an.fftSize = 1024; out.connect(an);
  S.g = { node, bus, djLP, djHP, apLP, apHP, mvol, limiter, tap, out, revIn, rev, revOut, metro, an, anBuf: new Float32Array(1024) };
  node.port.onmessage = (e) => onEngine(e.data);
  limiter.port.onmessage = (e) => { S.limit = e.data; };
  tap.port.onmessage = (e) => { for (const f of S.tapUsers) f(e.data); };
  applyMaster(true);
  for (const g of S.set.gens) makeChain(g);
}
function makeChain(g) {
  const c = S.ctx; if (!c || !S.g) return;
  dropChain(g.id);
  const inp = c.createGain(), drive = c.createWaveShaper(), hp = c.createBiquadFilter(), lp = c.createBiquadFilter();
  const lo = c.createBiquadFilter(), mid = c.createBiquadFilter(), hi = c.createBiquadFilter(), pan = c.createStereoPanner(), fader = c.createGain();
  hp.type = "highpass"; lp.type = "lowpass"; lo.type = "lowshelf"; lo.frequency.value = 120; mid.type = "peaking"; mid.frequency.value = 1000; mid.Q.value = 0.8; hi.type = "highshelf"; hi.frequency.value = 6000;
  drive.oversample = "2x";
  // Wobble: LFO auf die Filterfrequenz (in Cent, also in Oktaven gleichmäßig)
  const wob = c.createOscillator(), wobG = c.createGain(); wob.type = "sine"; wob.frequency.value = 1; wobG.gain.value = 0; wob.connect(wobG); wobG.connect(lp.detune); wob.start();
  // Echo (Ping-Pong) mit Ton-Filter in der Schleife
  const sEcho = c.createGain(), eIn = c.createGain(); eIn.channelCount = 1; eIn.channelCountMode = "explicit";
  const dL = c.createDelay(4), dR = c.createDelay(4), fbL = c.createGain(), fbR = c.createGain(), tone = c.createBiquadFilter(), merge = c.createChannelMerger(2), eOut = c.createGain();
  tone.type = "lowpass"; tone.frequency.value = 4500; tone.Q.value = 0.5; eOut.gain.value = 0.75;
  sEcho.connect(eIn); eIn.connect(tone); tone.connect(dL); dL.connect(merge, 0, 0); dL.connect(fbL); fbL.connect(dR); dR.connect(merge, 0, 1); dR.connect(fbR); fbR.connect(tone);
  merge.connect(eOut); eOut.connect(S.g.bus);
  const sRev = c.createGain(); sRev.connect(S.g.revIn);
  S.g.node.connect(inp, g.slot);
  inp.connect(drive); drive.connect(hp); hp.connect(lp); lp.connect(lo); lo.connect(mid); mid.connect(hi); hi.connect(pan); pan.connect(fader);
  fader.connect(S.g.bus); fader.connect(sEcho); fader.connect(sRev);
  const an = c.createAnalyser(); an.fftSize = 256; fader.connect(an);
  // 3.17.1: Oszillogramme je Reglergruppe — das Signal genau an dieser Stelle der Kette
  const scope = (src, out) => { const a = c.createAnalyser(); a.fftSize = SCOPE_N; a.smoothingTimeConstant = 0; src.connect(a, out || 0); return a; };
  const spSum = c.createGain(); eOut.connect(spSum); sRev.connect(spSum);
  const split = c.createChannelSplitter(2); fader.connect(split);
  // Lautheit für den Auto-Mix: vor dem Fader, gehörgerecht gewichtet (K-Filter: Hochpass 38 Hz + Höhenanhebung +4 dB ab 1,5 kHz)
  const kHP = c.createBiquadFilter(), kSh = c.createBiquadFilter(); kHP.type = "highpass"; kHP.frequency.value = 38; kHP.Q.value = 0.5;
  kSh.type = "highshelf"; kSh.frequency.value = 1500; kSh.gain.value = 4; hi.connect(kHP); kHP.connect(kSh);
  const wobAn = c.createAnalyser(); wobAn.fftSize = 32; wobG.connect(wobAn);
  const sc = { src: scope(inp), filt: scope(lp), tone: scope(hi), space: scope(spSum), L: scope(split, 0), R: scope(split, 1) };
  const ch = { inp, drive, hp, lp, lo, mid, hi, pan, fader, wob, wobG, sEcho, dL, dR, fbL, fbR, sRev, an, buf: new Float32Array(256), driveV: -1,
    sc, kAn: scope(kSh), wobAn, wobBuf: new Float32Array(32),
    dispose() { try { inp.disconnect(); fader.disconnect(); eOut.disconnect(); sRev.disconnect(); hi.disconnect(); wobG.disconnect(); wob.stop(); } catch (e) { /* schon weg */ } } };
  S.chains.set(g.id, ch);
  applyFx(g, true);
}
function dropChain(id) { const ch = S.chains.get(id); if (ch) { ch.dispose(); S.chains.delete(id); } }
function driveCurve(a) {
  const k = 1 + a * 24, n = 1024, cv = new Float32Array(n), norm = Math.tanh(k);
  for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; cv[i] = Math.tanh(k * x) / norm; }
  return cv;
}
function applyFx(g, now0, slow) {
  const ch = S.chains.get(g.id); if (!ch) return;
  const f = g.fx, now = S.ctx.currentTime, tc = now0 ? 0.001 : 0.025, bpm = S.set.bpm;
  ch.lp.frequency.setTargetAtTime(clamp(f.cut, 40, 20000), now, tc);
  ch.lp.Q.setTargetAtTime(0.7 + Math.pow(f.res, 2) * 17, now, tc);
  ch.hp.frequency.setTargetAtTime(clamp(f.hp, 10, 4000), now, tc);
  ch.lo.gain.setTargetAtTime(f.lo, now, tc); ch.mid.gain.setTargetAtTime(f.mid, now, tc); ch.hi.gain.setTargetAtTime(f.hi, now, tc);
  if (ch.driveV !== f.drive) { ch.drive.curve = f.drive > 0.005 ? driveCurve(f.drive) : null; ch.driveV = f.drive; }
  const wSteps = SYNC_STEPS[f.wob];
  ch.wob.frequency.setTargetAtTime(wSteps ? (bpm / 60 * 4) / wSteps : 1, now, tc);
  ch.wobG.gain.setTargetAtTime(wSteps ? f.wdepth * 3000 : 0, now, tc);
  const et = clamp((SYNC_STEPS[f.etime] || 3) * 60 / bpm / 4, 0.02, 3.9);
  ch.dL.delayTime.setTargetAtTime(et, now, 0.03); ch.dR.delayTime.setTargetAtTime(et, now, 0.03);
  ch.fbL.gain.setTargetAtTime(f.efb, now, tc); ch.fbR.gain.setTargetAtTime(f.efb, now, tc);
  ch.sEcho.gain.setTargetAtTime(f.echo, now, tc); ch.sRev.gain.setTargetAtTime(f.rev, now, tc);
  ch.pan.pan.setTargetAtTime(clamp(f.pan, -1, 1), now, tc);
  const anySolo = S.set.gens.some(x => x.solo);
  ch.fader.gain.setTargetAtTime((g.mute || (anySolo && !g.solo)) ? 0 : dbGain(f.vol), now, slow ? 0.35 : tc);
}
function applyMaster(now0) {
  if (!S.g) return;
  const m = S.set.master, now = S.ctx.currentTime, tc = now0 ? 0.001 : 0.03;
  // DJ-Filter: links Tiefpass (dunkler), rechts Hochpass (dünner), Mitte = aus
  const dj = clamp(m.dj, -1, 1);
  S.g.djLP.frequency.setTargetAtTime(dj < 0 ? 20000 * Math.pow(150 / 20000, -dj) : 20000, now, tc);
  S.g.djHP.frequency.setTargetAtTime(dj > 0 ? 10 * Math.pow(3000 / 10, dj) : 10, now, tc);
  S.g.mvol.gain.setTargetAtTime(dbGain(m.vol), now, tc);
  if (S.g.revKey !== m.revSize + ":" + m.revDecay) { S.g.rev.buffer = makeIR(S.ctx, m.revSize, m.revDecay); S.g.revKey = m.revSize + ":" + m.revDecay; }
}
const post = (m) => { if (S.g) S.g.node.port.postMessage(m); };
function syncHarmony() { const pr = (PROGS.find(p => p[0] === S.set.prog) || PROGS[0])[2]; post({ t: "harmony", root: S.set.root, scale: S.set.scale, prog: pr, per: S.set.per }); }
function syncAll() {
  post({ t: "tempo", bpm: S.set.bpm, swing: S.set.swing }); syncHarmony(); post({ t: "metro", on: !!S.metro });
  for (const g of S.set.gens) { post({ t: "gen", g: engineGen(g) }); if (g.kind === "seed" && g.seed) post({ t: "seed", id: g.id, notes: g.seed, key: g.seedKey }); }
}
function onEngine(d) {
  switch (d.t) {
    case "bar": S.bar = d.bar; S.barTime = d.time; S.spb = d.spb; autopilotBar(d); mixBar(d); paintBar(); { const w = S.barWait; S.barWait = []; for (const f of w) f(d); } break;
    case "pos": S.step = d.step; paintPos(); break;
    case "live": S.live = d.v; break;
    case "run": S.running = d.on; if (!d.on) { S.states.clear(); S.bar = -1; endAutoFx(); } paintTransport(); paintCards(); break;
    case "state": S.states.set(d.id, d); paintCard(genById(d.id)); paintTransport(); break;
    case "seedarm": status(T(`🎼 Einzählen … ab Takt ${d.at + 1} spielst du ein.`, `🎼 Count-in … you play from bar ${d.at + 1}.`)); S.recArm = { id: d.id, at: d.at, kind: "seed" }; paintCards(); break;
    case "seed": { const g = genById(d.id); S.recArm = null; if (g && d.notes.length) { g.seed = d.notes; g.seedKey = d.key; changed(); }
      status(d.notes.length ? T(`🎼 ${d.notes.length} Noten aufgenommen — die Maschine spielt sie jetzt und spinnt weiter.`, `🎼 ${d.notes.length} notes recorded — the machine plays them now and spins them on.`)
        : T("🎼 Keine Noten gehört — noch einmal ● und während der Aufnahme spielen.", "🎼 No notes heard — press ● again and play during the recording."));
      paintCards(); break; }
    case "recarm": status(T(`🎤 Einzählen … Aufnahme ab Takt ${d.at + 1}.`, `🎤 Count-in … recording from bar ${d.at + 1}.`)); S.recArm = { id: d.id, at: d.at, kind: "audio" }; paintCards(); break;
    case "recgo": status(T("🎤 Aufnahme läuft …", "🎤 Recording …")); if (S.recArm) S.recArm.go = true; paintCards(); break;
    case "recpos": if (S.recArm) { S.recArm.frac = d.frac; paintRecBar(d.id); } break;
    case "layer": { const g = genById(d.id); S.recArm = null; if (!g) break;
      const peak = d.L.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
      // sofort anzeigen, dann sichern (der Motor spielt die Schicht schon)
      g.nLayers = Math.min(8, d.overdub ? (g.nLayers || 0) + 1 : 1); g.loopBars = d.bars; g.loopBpm = d.bpm; paintCard(g);
      (async () => { const ls = d.overdub ? (await loadLayers(g)).concat([{ L: d.L, R: d.R, bars: d.bars, bpm: d.bpm }]) : [{ L: d.L, R: d.R, bars: d.bars, bpm: d.bpm }];
        await saveLayers(g, ls.slice(-8)); changed(); })();
      status(peak < 0.003 ? T("🎤 Aufgenommen — aber fast still. Ist das richtige Mikrofon freigegeben?", "🎤 Recorded — but nearly silent. Is the right microphone allowed?")
        : T("🎤 Schleife aufgenommen — läuft im Takt. ＋ legt eine weitere Schicht darüber.", "🎤 Loop recorded — playing in time. ＋ adds another layer on top."));
      break; }
  }
}
const genById = (id) => S.set.gens.find(g => g.id === id);

// =====================================================================================================
// Generatoren starten / stoppen / ändern
// =====================================================================================================
async function startGen(g, now = false) {
  if (!(await ensureAudio())) return;
  if (g.kind === "seed" && !(g.seed && g.seed.length)) { status(T("Erst einspielen: ● drücken, nach dem Einzählen ein paar Takte spielen (Tastatur, MIDI oder unten die Tasten).", "Record first: press ●, then play a few bars after the count-in (keyboard, MIDI or the keys below).")); return; }
  if (g.kind === "audio" && !g.nLayers) { status(T("Erst aufnehmen: 🎤 freigeben, dann ● drücken.", "Record first: allow 🎤, then press ●.")); return; }
  post({ t: "start", id: g.id, now });
}
function stopGen(g, now = false) { post({ t: "stop", id: g.id, now }); }
function genOn(g) { const s = S.states.get(g.id); return !!(s && s.on); }
function genPending(g) { const s = S.states.get(g.id); return s && (s.startAt != null ? "start" : s.stopAt != null ? "stop" : null); }
function toggleGen(g) { if (genOn(g) && genPending(g) !== "stop") stopGen(g); else startGen(g); }
async function startAll() {
  if (!(await ensureAudio())) return;
  for (const g of S.set.gens) if (!genOn(g) && (g.kind !== "seed" || (g.seed && g.seed.length)) && (g.kind !== "audio" || g.nLayers)) post({ t: "start", id: g.id });
}
function stopAll(now) { if (now) { post({ t: "run", on: false }); return; } for (const g of S.set.gens) if (genOn(g)) post({ t: "stop", id: g.id }); }
function setGenParam(g, k, v, spec) {
  g.p[k] = v;
  post({ t: "gp", id: g.id, k, v, regen: !!(spec && spec.regen) });
  changed();
}
function setFx(g, k, v) { g.fx[k] = v; if (k === "vol") g.volHand = true; applyFx(g); changed(); }
function addGen(kind, o) {
  const g = newGen(kind, o);
  if (!g) { status(T("Höchstens 12 Generatoren.", "At most 12 generators.")); return null; }
  S.set.gens.push(g); changed();
  if (S.g) { makeChain(g); post({ t: "gen", g: engineGen(g) }); }
  S.sel = g.id;
  renderCards();
  return g;
}
function removeGen(g) {
  post({ t: "del", id: g.id }); dropChain(g.id);
  S.set.gens = S.set.gens.filter(x => x !== g); if (S.sel === g.id) S.sel = null;
  if (g.kind === "audio") saveLayers(g, []);
  changed(); renderCards();
}
function setSound(g, key) {
  if (g.kind === "beat") { g.kit = key; post({ t: "patch", id: g.id, patch: drumPatch(g) }); }
  else { Object.assign(g, patchFrom(key)); post({ t: "gen", g: engineGen(g) }); }
  changed(); renderCards();
}

// =====================================================================================================
// Mikrofon
// =====================================================================================================
async function micOn() {
  if (!(await ensureAudio())) return false;
  if (S.mic) return true;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { status(T("Dieser Browser gibt kein Mikrofon frei (nur über https).", "This browser can't use a microphone (https only).")); return false; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const src = S.ctx.createMediaStreamSource(stream), an = S.ctx.createAnalyser(), mon = S.ctx.createGain();
    an.fftSize = 512; mon.gain.value = 0;
    src.connect(S.g.node, 0, 0); src.connect(an); src.connect(mon); mon.connect(S.ctx.destination);
    const tr = stream.getAudioTracks()[0], set = tr && tr.getSettings ? tr.getSettings() : {};
    S.mic = { stream, src, an, mon, buf: new Float32Array(512), name: tr ? tr.label : "", inLat: typeof set.latency === "number" ? set.latency : 0.01 };
    status(T("🎤 Mikrofon frei: ", "🎤 Microphone on: ") + (S.mic.name || T("Standard", "default")) + T(" — Kopfhörer verhindern, dass die Boxen mit aufgenommen werden.", " — headphones keep the speakers out of the recording."));
    renderCards();
    return true;
  } catch (e) { status(T("Mikrofon nicht freigegeben: ", "Microphone not allowed: ") + (e.message || e)); return false; }
}
function micLatency(g) {
  const c = S.ctx; const out = (c.outputLatency || 0) + (c.baseLatency || 0);
  return Math.max(0, out + (S.mic ? S.mic.inLat : 0) + (g.p.lat || 0) / 1000);
}
async function recAudio(g, overdub) {
  if (!(await micOn())) return;
  post({ t: "audiorec", id: g.id, on: true, bars: g.p.bars, overdub: !!overdub, lat: micLatency(g) });
}
async function recSeed(g) {
  if (!(await ensureAudio())) return;
  S.sel = g.id; paintCards();
  post({ t: "seedrec", id: g.id, on: true, bars: g.p.bars });
}

// ---- Gesang → Noten (YIN auf 12 kHz) und Tonart (Krumhansl) ----
function yinNotes(L, R, sr, bars, bpm) {
  const f = 4, n = Math.floor(L.length / f), x = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < f; k++) s += (L[i * f + k] + (R ? R[i * f + k] : L[i * f + k])) * 0.5; x[i] = s / f; }
  const fs = sr / f, W = 512, maxT = Math.floor(fs / 60), minT = Math.floor(fs / 1100), hop = 96;
  const d = new Float32Array(maxT + 1), frames = [];
  let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(x[i]));
  const gate = Math.max(0.01, peak * 0.08);
  for (let p = 0; p + W + maxT < n; p += hop) {
    let rms = 0; for (let i = 0; i < W; i++) rms += x[p + i] * x[p + i]; rms = Math.sqrt(rms / W);
    if (rms < gate) { frames.push(null); continue; }
    let run = 0, best = -1;
    d[0] = 1;
    for (let t = 1; t <= maxT; t++) {
      let s = 0; for (let i = 0; i < W; i++) { const v = x[p + i] - x[p + i + t]; s += v * v; }
      run += s; d[t] = run > 0 ? s * t / run : 1;
      if (t >= minT && best < 0 && d[t] < 0.15) { while (t + 1 <= maxT) { let s2 = 0; for (let i = 0; i < W; i++) { const v = x[p + i] - x[p + i + t + 1]; s2 += v * v; } const n2 = s2 * (t + 1) / (run + s2); if (n2 < d[t]) { t++; run += s2; d[t] = n2; } else break; } best = t; break; }
    }
    if (best < 0) { frames.push(null); continue; }
    const fr = fs / best; frames.push(69 + 12 * Math.log2(fr / 440));
  }
  // glätten (Median 5), zusammenhängende Töne bilden
  const med = frames.map((v, i) => { if (v == null) return null; const w = frames.slice(Math.max(0, i - 2), i + 3).filter(z => z != null).sort((a, b) => a - b); return w[Math.floor(w.length / 2)]; });
  const hopS = hop / fs, stepS = 60 / bpm / 4, total = bars * SPB;
  const notes = []; let cur = null;
  med.forEach((m, i) => {
    const r = m == null ? null : Math.round(m);
    if (cur && (r == null || Math.abs(m - cur.n) > 0.6)) { if (cur.len * hopS > 0.07) notes.push(cur); cur = null; }
    if (r != null && !cur) cur = { n: r, at: i * hopS, len: 0, sum: 0, k: 0 };
    if (cur && r != null) { cur.len++; cur.sum += m; cur.k++; }
  });
  if (cur && cur.len * hopS > 0.07) notes.push(cur);
  const out = [];
  for (const c of notes) {
    const s = Math.round((c.at + W / fs / 2) / stepS); if (s >= total) continue;
    const l = Math.max(1, Math.round(c.len * hopS / stepS));
    const nn = Math.round(c.sum / c.k);
    if (out.length && out[out.length - 1].s === s) continue;
    out.push({ s, l: Math.min(l, total - s), n: nn, v: 0.8 });
  }
  return out;
}
// Tonart aus Noten (Krumhansl-Schmuckler). Erster Ton und betonte Zeiten zählen mehr (dort steht meist der Grundton);
// passt die Tonart, die schon eingestellt ist, genauso gut (Paralleltonart, gleiche Töne), bleibt sie.
function detectKey(notes, cur) {
  const MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88], MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  const w = new Array(12).fill(0);
  notes.forEach((n, i) => { const strong = n.s % 16 === 0 ? 1.6 : n.s % 4 === 0 ? 1.2 : 1; w[((n.n % 12) + 12) % 12] += Math.max(0.5, n.l) * strong * (i === 0 ? 2 : 1) * (i === notes.length - 1 ? 1.3 : 1); });
  if (!w.some(x => x > 0)) return null;
  const corr = (prof, r) => { const a = w, b = prof.map((_, i) => prof[((i - r) % 12 + 12) % 12]); const ma = a.reduce((x, y) => x + y) / 12, mb = b.reduce((x, y) => x + y) / 12;
    let s = 0, sa = 0, sb = 0; for (let i = 0; i < 12; i++) { s += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; } return s / Math.sqrt(sa * sb || 1); };
  let best = { r: 9, scale: "minor", c: -9 };
  for (let r = 0; r < 12; r++) { const cM = corr(MAJ, r), cm = corr(MIN, r); if (cM > best.c) best = { r, scale: "major", c: cM }; if (cm > best.c) best = { r, scale: "minor", c: cm }; }
  if (cur && (cur.scale === "major" || cur.scale === "minor") && cur.scale !== best.scale) {
    const rel = best.scale === "major" ? (best.r + 9) % 12 : (best.r + 3) % 12;      // Paralleltonart des Ergebnisses
    if (rel === cur.root) { const c2 = corr(cur.scale === "major" ? MAJ : MIN, cur.root); if (c2 > best.c - 0.12) return { r: cur.root, scale: cur.scale, c: c2 }; }
  }
  return best;
}
async function audioToNotes(g) {
  const ls = await loadLayers(g); if (!ls.length) { status(T("Noch keine Aufnahme.", "Nothing recorded yet.")); return null; }
  const ly = ls[ls.length - 1];
  status(T("🎼 Höre die Töne heraus …", "🎼 Listening for the pitches …"));
  await new Promise(r => setTimeout(r, 30));
  const notes = yinNotes(ly.L, ly.R, S.ctx ? S.ctx.sampleRate : 48000, ly.bars, ly.bpm || S.set.bpm);
  if (notes.length < 2) { status(T("🎼 Keine klare Melodie gefunden — einstimmig singen oder spielen hilft (summen geht auch).", "🎼 No clear melody found — sing or play one note at a time (humming works).")); return null; }
  return { notes, bars: ly.bars };
}
// Gesang/Spiel einer Mikrofon-Schleife → Vorgabe auf einem Synth (die Maschine spielt die Melodie und spinnt weiter)
async function micToSeed(g) {
  if (!(await ensureAudio())) return null;
  const r = await audioToNotes(g); if (!r) return null;
  const key = detectKey(r.notes, { root: S.set.root, scale: S.set.scale });
  const anyTonal = S.set.gens.some(x => ["bass", "chords", "arp", "melody", "seed"].includes(x.kind) && genOn(x));
  if (key && !anyTonal) { S.set.root = key.r; S.set.scale = key.scale; syncHarmony(); paintTransport(); }
  const sd = addGen("seed", { preset: "minimoog|Singender Lead", p: { bars: r.bars, life: 0.35 } }); if (!sd) return null;
  sd.name = T("🎼 aus dem Gesang", "🎼 from your voice");
  // Tonartbezug der Vorgabe = die Tonart, die jetzt gilt
  const prog = (PROGS.find(p => p[0] === S.set.prog) || PROGS[0])[2];
  sd.seed = r.notes; sd.seedKey = { root: S.set.root, scale: S.set.scale, prog, per: S.set.per, bar0: 0, bars: r.bars };
  post({ t: "seed", id: sd.id, notes: sd.seed, key: sd.seedKey });
  changed(); renderCards();
  status(T(`🎼 ${r.notes.length} Töne erkannt` + (key ? `, Tonart ${ROOTS[key.r]}-${key.scale === "major" ? "Dur" : "Moll"}` : "") + ` — die Vorgabe „aus dem Gesang“ spielt sie auf einem Synth.`,
    `🎼 ${r.notes.length} notes found` + (key ? `, key ${ROOTS[key.r]} ${key.scale}` : "") + ` — the “from your voice” generator plays them on a synth.`));
  return sd;
}
// 🪄 Den Rest übernehmen: Tonart aus deiner Vorgabe/deinem Gesang, dann Beat, Bass, Akkorde (und je nach Richtung Arpeggio) dazu
async function takeOver(src) {
  if (!(await ensureAudio())) return;
  let notes = null;
  if (src && src.kind === "seed" && src.seed && src.seed.length) notes = src.seed;
  if (src && src.kind === "audio") { const sd = await micToSeed(src); if (sd) notes = sd.seed; }
  if (notes && notes.length) {
    const key = detectKey(notes, { root: S.set.root, scale: S.set.scale });
    if (key) { S.set.root = key.r; S.set.scale = key.scale; }
  }
  endAutoFx();
  const st = STYLES[S.set.style] || STYLES.house;          // das Tempo bleibt deins (deine Takte und Schleifen laufen darin)
  S.set.prog = st.prog;
  if (notes && notes.length && S.set.scale === "major" && ["i6", "i4", "i76", "i3", "iiv"].includes(S.set.prog)) S.set.prog = "pop";
  syncAll();
  const added = buildStyle(st, { onlyAdd: true });
  for (const g of added) { makeChain(g); post({ t: "gen", g: engineGen(g) }); }
  renderCards(); paintTransport();
  for (const g of S.set.gens) if (["beat", "bass", "chords", "arp"].includes(g.kind)) post({ t: "start", id: g.id });
  if (src) post({ t: "start", id: src.id });
  S.set.auto.on = true; paintTransport(); changed();
  autoMix();
  status(T(`🪄 Die Maschine übernimmt: ${ROOTS[S.set.root]}-${S.set.scale === "major" ? "Dur" : "Moll"}, ${T(st.de, st.en)}, ${S.set.bpm} BPM — Beat, Bass und Akkorde setzen am nächsten Takt ein, der Autopilot arrangiert.`,
    `🪄 The machine takes over: ${ROOTS[S.set.root]} ${S.set.scale}, ${st.en}, ${S.set.bpm} BPM — beat, bass and chords come in on the next bar, the autopilot arranges.`));
}
async function surprise() {
  if (!(await ensureAudio())) return;
  const keys = Object.keys(STYLES), sk = keys[Math.floor(Math.random() * keys.length)], st = STYLES[sk];
  endAutoFx();
  stopAll(true);
  for (const g of S.set.gens.slice()) if (["beat", "bass", "chords", "arp", "melody"].includes(g.kind)) { post({ t: "del", id: g.id }); dropChain(g.id); S.set.gens = S.set.gens.filter(x => x !== g); }
  S.set.style = sk; S.set.bpm = st.bpm; S.set.root = Math.floor(Math.random() * 12); S.set.scale = Math.random() < 0.7 ? "minor" : "major"; S.set.prog = st.prog;
  if (S.set.scale === "major" && ["i6", "i4", "i76", "i3", "iiv"].includes(S.set.prog)) S.set.prog = "pop";
  const added = buildStyle(st, { onlyAdd: true });
  if (Math.random() < 0.6) { const m = newGen("melody", { preset: pickLead() }); if (m) { S.set.gens.push(m); added.push(m); } }
  for (const g of added) makeChain(g);
  syncAll(); renderCards(); paintTransport();
  for (const g of added) post({ t: "start", id: g.id });
  S.set.auto.on = true; changed();
  autoMix();                                                  // 3.17.1: nicht alle gleich laut — ausmischen, sobald sie spielen
  status(T(`🎲 ${st.de} in ${ROOTS[S.set.root]}-${S.set.scale === "major" ? "Dur" : "Moll"}, ${st.bpm} BPM — dreh an allem, was dir gefällt.`, `🎲 ${st.en} in ${ROOTS[S.set.root]} ${S.set.scale}, ${st.bpm} BPM — turn whatever you like.`));
}
function pickLead() { const L = ["mono|Leiter-Lead", "minimoog|Singender Lead", "sh101|101-Lead (PWM)", "ppg|PPG-Stimme", "odyssey|Odyssey-Sync-Lead", "cs80|Vangelis-Lead"]; return L[Math.floor(Math.random() * L.length)]; }

// =====================================================================================================
// Autopilot: arrangiert im Takt — tauscht Generatoren, Breakdown mit Filterfahrt, Steigerung vor dem Drop, frische Muster
// =====================================================================================================
function autopilotBar(d) {
  if (!S.g) return;
  const A = S.set.auto, B = d.bar, t0 = d.time, bl = d.spb, now = S.ctx.currentTime;
  // geplante Schritte für den nächsten Takt (auch nach dem Ausschalten: ein begonnener Effekt endet sauber)
  for (const p of S.auto.plan.filter(x => x.bar <= B + 1)) p.fn(Math.max(now + 0.02, t0 + bl));
  S.auto.plan = S.auto.plan.filter(x => x.bar > B + 1);
  // 3.17.2 Wächter: kein Effekt läuft, aber ein Autopilot-Filter steht nicht offen → öffnen (fehlende Tiefen nach Neuwürfeln)
  if (!S.auto.fx.length && !(S.auto.calm >= B) && (S.g.apHP.frequency.value > 11 || S.g.apLP.frequency.value < 19500)) openAutoFilters();
  if (!A || !A.on) return;
  if ((B + 1) % 8 !== 0 || B < 7) return;                // nur an Phrasengrenzen (alle 8 Takte)
  if (Math.random() > 0.35 + A.amt * 0.6) return;
  const on = S.set.gens.filter(g => genOn(g)), off = S.set.gens.filter(g => !genOn(g) && (g.kind !== "seed" || (g.seed && g.seed.length)) && (g.kind !== "audio" || g.nLayers));
  const core = on.filter(g => g.kind === "beat" || g.kind === "bass");
  const r = Math.random(), at = B + 1;
  const say = (de, en) => { S.auto.log = T(`Takt ${at + 1}: `, `Bar ${at + 1}: `) + T(de, en); renderAutoLog(); };
  if (r < 0.25 && core.length) {
    // Breakdown: Beat und Bass 4 Takte raus, Filter langsam zu und beim Wiedereinsatz auf
    for (const g of core) post({ t: "stop", id: g.id });
    const lp = S.g.apLP.frequency;
    lp.cancelScheduledValues(now); lp.setValueAtTime(lp.value, now); lp.setTargetAtTime(700, t0 + bl, bl * 1.2);
    // 3.17.2: als laufender Effekt geführt — endet sicher (Würfeln, Stopp, Autopilot aus, Set-Wechsel), Beat und Bass kommen wieder
    S.auto.fx.push({ kind: "breakdown", until: at + 4, stopped: core.map(g => g.id) });
    S.auto.plan.push({ bar: at + 4, fn: (t) => { for (const g of core) post({ t: "start", id: g.id }); lp.cancelScheduledValues(t - 0.05); lp.setValueAtTime(lp.value, t - 0.05); lp.exponentialRampToValueAtTime(20000, t + 0.02); S.auto.fx = S.auto.fx.filter(x => x.kind !== "breakdown"); S.auto.calm = at + 5; } });
    say("Breakdown — Beat und Bass setzen 4 Takte aus", "Breakdown — beat and bass drop out for 4 bars");
  } else if (r < 0.45) {
    // Steigerung: 4 Takte Hochpass hoch, dann Drop
    const hp = S.g.apHP.frequency; hp.cancelScheduledValues(now); hp.setValueAtTime(Math.max(10, hp.value), t0 + bl); hp.exponentialRampToValueAtTime(1400, t0 + bl * 5);
    S.auto.fx.push({ kind: "build", until: at + 4 });
    S.auto.plan.push({ bar: at + 4, fn: (t) => { hp.cancelScheduledValues(t - 0.05); hp.setValueAtTime(10, t); S.auto.fx = S.auto.fx.filter(x => x.kind !== "build"); S.auto.calm = at + 5; } });
    say("Steigerung — 4 Takte bis zum Drop", "Build-up — 4 bars to the drop");
  } else if (r < 0.75 && (on.length > 2 || off.length)) {
    const outG = on.filter(g => g.kind !== "beat" && g.kind !== "bass");
    const goOut = outG.length > 1 || (outG.length && off.length) ? outG[Math.floor(Math.random() * outG.length)] : null;
    const goIn = off.length ? off[Math.floor(Math.random() * off.length)] : null;
    if (goOut) post({ t: "stop", id: goOut.id });
    if (goIn) { post({ t: "start", id: goIn.id }); autoMix({ ids: [goIn.id] }); }
    say((goIn ? goIn.name + " kommt" : "") + (goIn && goOut ? ", " : "") + (goOut ? goOut.name + " geht" : ""), (goIn ? goIn.name + " comes in" : "") + (goIn && goOut ? ", " : "") + (goOut ? goOut.name + " leaves" : ""));
  } else {
    const ton = on.filter(g => ["bass", "chords", "arp", "melody", "beat"].includes(g.kind));
    if (!ton.length) return;
    const g = ton[Math.floor(Math.random() * ton.length)];
    post({ t: "gp", id: g.id, k: "_fresh", v: Date.now(), regen: true });
    say(g.name + " erfindet ein neues Muster", g.name + " invents a new pattern");
  }
}
function renderAutoLog() { const e = q("#lpAutoLog"); if (e) e.textContent = S.set.auto.on ? (S.auto.log || T("hört zu … (handelt an Phrasengrenzen, alle 8 Takte)", "listening … (acts at phrase boundaries, every 8 bars)")) : ""; }

// =====================================================================================================
// Aufnahme → Bibliothek
// =====================================================================================================
function encodeWav24(chs, sr) {
  const ch = chs.length, n = chs[0].length, bps = 3;
  const out = new DataView(new ArrayBuffer(44 + n * ch * bps));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); out.setUint32(4, 36 + n * ch * bps, true); w(8, "WAVE"); w(12, "fmt "); out.setUint32(16, 16, true); out.setUint16(20, 1, true);
  out.setUint16(22, ch, true); out.setUint32(24, sr, true); out.setUint32(28, sr * ch * bps, true); out.setUint16(32, ch * bps, true); out.setUint16(34, 24, true);
  w(36, "data"); out.setUint32(40, n * ch * bps, true);
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
    let v = Math.round(clamp(chs[c][i], -1, 1) * 8388607); if (v < 0) v += 16777216;
    out.setUint8(o, v & 255); out.setUint8(o + 1, (v >> 8) & 255); out.setUint8(o + 2, (v >> 16) & 255); o += 3;
  }
  return new Blob([out.buffer], { type: "audio/wav" });
}
async function toggleRecord() {
  if (!(await ensureAudio())) return;
  if (S.rec && S.rec.on) { await finishRecord(); return; }
  S.rec = { on: true, chunks: [], n: 0, t0: performance.now(), gens: new Set() };
  S.rec.sink = (d) => { if (S.rec && S.rec.on) { S.rec.chunks.push(d); S.rec.n += d.L.length; } };
  tapOn(S.rec.sink);
  if (!S.running) await startAll();
  paintTransport(); recTimer();
}
function recTimer() {
  if (!S.rec || !S.rec.on) return;
  for (const g of S.set.gens) if (genOn(g)) S.rec.gens.add(g.id);
  const e = q("#lpRecTime"); const sec = S.rec.n / (S.ctx ? S.ctx.sampleRate : 48000);
  if (e) e.textContent = fmtDur(sec);
  if (sec > 900) { finishRecord(); return; }
  setTimeout(recTimer, 250);
}
function fmtDur(sec) { const m = Math.floor(sec / 60), s = Math.floor(sec % 60); return m + ":" + String(s).padStart(2, "0"); }
async function finishRecord() {
  const R0 = S.rec; if (!R0) return;
  S.g.tap.port.postMessage({ flush: true });                // letztes Stück schicken lassen …
  await new Promise(r => setTimeout(r, 150));               // … und abwarten, dann erst abmelden
  tapOff(R0.sink);
  R0.on = false; paintTransport();
  const sr = S.ctx.sampleRate, n = R0.chunks.reduce((a, c) => a + c.L.length, 0);
  if (n < sr * 2) { status(T("Aufnahme zu kurz (unter 2 s) — verworfen.", "Recording too short (under 2 s) — discarded.")); S.rec = null; return; }
  const L = new Float32Array(n), R = new Float32Array(n); let o = 0;
  for (const c of R0.chunks) { L.set(c.L, o); R.set(c.R, o); o += c.L.length; }
  // Stille am Anfang/Ende kürzen, weich ein- und ausblenden
  const thr = Math.pow(10, -60 / 20); let a = 0, b = n;
  while (a < b && Math.abs(L[a]) < thr && Math.abs(R[a]) < thr) a++;
  while (b > a && Math.abs(L[b - 1]) < thr && Math.abs(R[b - 1]) < thr) b--;
  if (b - a < sr) { status(T("Die Aufnahme ist still — läuft ein Generator?", "The recording is silent — is a generator running?")); S.rec = null; return; }
  const l = L.slice(a, b), r = R.slice(a, b), fi = Math.min(480, l.length), fo = Math.min(2400, l.length);
  for (let i = 0; i < fi; i++) { l[i] *= i / fi; r[i] *= i / fi; }
  for (let i = 0; i < fo; i++) { const k = 1 - i / fo; l[l.length - fo + i] *= k; r[r.length - fo + i] *= k; }
  const blob = encodeWav24([l, r], sr);
  const used = [...R0.gens].map(id => genById(id)).filter(Boolean);
  const names = used.map(g => g.name + (g.preset ? " (" + g.preset.split("|")[1] + ")" : g.kit ? " (" + (KITS[g.kit] ? (EN ? KITS[g.kit].en : KITS[g.kit].de).split(" — ")[0] : g.kit) + ")" : ""));
  const title = (S.recTitle || "").trim().slice(0, 80) || S.set.name;
  const st = STYLES[S.set.style];
  if (!window.mwsLibrary) { status(T("Bibliothek nicht bereit.", "Library not ready.")); return; }
  const key = ROOTS_EN[S.set.root] + (MAJORISH.includes(S.set.scale) ? " major" : " minor");
  const rec = await window.mwsLibrary.add({ title, blob, bpm: S.set.bpm, keyscale: key, duration: l.length / sr,
    caption: [st ? st.en.toLowerCase() : "", "loop machine", "self-played", "synthesizer"].filter(Boolean).join(", "),
    note: T("Live gespielt mit der Loop-Maschine von Manuwave Studio — ", "Played live on the Manuwave Studio loop machine — ") + names.join(", ") });
  S.rec = null;
  status(T(`🎵 „${title}“ liegt in der Bibliothek (${fmtDur(l.length / sr)}).`, `🎵 “${title}” is in the library (${fmtDur(l.length / sr)}).`));
  const m = q("#lpMsg"); if (m && rec) m.append(" ", h("button", { type: "button", class: "ghost btn-s", text: T("🎚 Zum Mastering", "🎚 To mastering"), onclick: () => window.mwsLibrary.master(rec.id) }));
}

// =====================================================================================================
// 🤖 KI baut weiter: dein Jam wird von der Musik-KI weitergespielt, oder sie spielt die Band zu deinem Gesang.
// Der Auftrag läuft wie jeder Render über die Warteschlange im Studio (Fortschritt, Cover, Wasserzeichen); der fertige
// Song ist ein KI-Track — die Notiz sagt, was von dir ist.
// =====================================================================================================
const CAPTIONS = {
  house: "deep house, four-on-the-floor, offbeat bass, organ stabs, warm pads", techno: "techno, driving kick, acid bassline, hypnotic, dark warehouse",
  synthwave: "synthwave, retro 80s, gated drums, analog bass, lush pads, arpeggios", hiphop: "hip hop, boom bap drums, 808 bass, rhodes chords, laid-back groove",
  lofi: "lo-fi hip hop, dusty drums, mellow electric piano, warm bass, chill", trap: "trap, 808 bass, fast hi-hats, dark pads",
  dnb: "drum and bass, breakbeat, reese bass, atmospheric pads", disco: "nu-disco, funky bass, clavinet, four-on-the-floor, strings",
  pop: "pop, punchy drums, bright synths, catchy", ambient: "ambient, evolving pads, soft textures, spacious, glassy bells" };
const KI_TRACKS = [["drums", "Schlagzeug", "Drums"], ["bass", "Bass", "Bass"], ["keyboard", "Keys", "Keys"], ["synth", "Synth", "Synth"],
  ["guitar", "Gitarre", "Guitar"], ["strings", "Streicher", "Strings"], ["percussion", "Percussion", "Percussion"], ["brass", "Bläser", "Brass"]];
const keyscaleEn = () => ROOTS_EN[S.set.root] + (MAJORISH.includes(S.set.scale) ? " major" : " minor");
function kiCaption(mode) {
  const st = CAPTIONS[S.set.style] || CAPTIONS.house;
  return mode === "gesang" ? st + ", lead vocals" : st + ", instrumental, evolving, builds up";
}
function kiSources() { return S.set.gens.filter(g => g.kind === "audio" && g.nLayers); }
function renderKi() {
  const el = q("#lpKi"); if (!el) return;
  el.classList.toggle("hidden", !S.ki.open); el.innerHTML = ""; if (!S.ki.open) return;
  const L = window.mwsLibrary, srcs = kiSources();
  const can = L && L.canWeiter && L.canWeiter(), conn = L && L.connected && L.connected();
  const k = S.ki; k.mode = k.mode || (srcs.length ? "gesang" : "fortsetzen"); if (k.mode === "gesang" && !srcs.length) k.mode = "fortsetzen";
  k.len = k.len || 120; k.bars = k.bars || 8; k.tracks = k.tracks || ["drums", "bass", "keyboard", "synth"]; if (k.voice == null) k.voice = true;
  if (k.capFor !== k.mode + S.set.style) { k.caption = kiCaption(k.mode); k.capFor = k.mode + S.set.style; }
  const radio = (v, de, en, dis, hint) => h("label", { class: "lp-radio" + (dis ? " dis" : ""), title: hint || "" },
    h("input", { type: "radio", name: "lpKiMode", value: v, checked: k.mode === v, disabled: dis, onchange: () => { k.mode = v; renderKi(); } }), " ", T(de, en));
  const sel = (id, opts, val, on) => { const s = h("select", { id }, opts.map(([v, t]) => h("option", { value: v, selected: String(v) === String(val) }, t))); s.onchange = () => on(s.value); return s; };
  const dits = L && L.dits ? L.dits() : [];
  el.append(
    h("div", { class: "sb-head" }, h("h3", { text: T("🤖 Die Musik-KI baut weiter", "🤖 The music AI takes it from here") }),
      h("button", { type: "button", class: "ghost btn-s", text: "✕", title: T("Schließen", "Close"), onclick: () => { S.ki.open = false; renderKi(); } })),
    h("div", { class: "lp-row" },
      radio("fortsetzen", "▶︎ Jam weiterspielen — deine Takte sind der Anfang, die KI spielt weiter", "▶︎ Continue the jam — your bars are the start, the AI plays on", false),
      radio("gesang", "🎤 Band zu deinem Gesang — die KI spielt Schlagzeug, Bass, Keys dazu", "🎤 Band for your voice — the AI plays drums, bass, keys around it", !srcs.length,
        srcs.length ? "" : T("Erst einen Mikrofon-Loop aufnehmen", "Record a mic loop first"))),
    k.mode === "fortsetzen"
      ? h("div", { class: "lp-row" }, h("span", { class: "sub small", text: T("Mitschneiden ab dem nächsten Takt:", "Capture from the next bar:") }),
          sel("lpKiBars", [[4, T("4 Takte", "4 bars")], [8, T("8 Takte", "8 bars")], [16, T("16 Takte", "16 bars")]], k.bars, (v) => { k.bars = +v; }),
          h("span", { class: "sub small", text: T("(was gerade läuft, so wie du es hörst)", "(what's playing, as you hear it)") }))
      : h("div", { class: "lp-col" },
          srcs.length > 1 ? h("div", { class: "lp-row" }, h("span", { class: "sub small", text: T("Gesang aus:", "Voice from:") }),
            sel("lpKiSrc", srcs.map(g => [g.id, g.name]), k.src || srcs[0].id, (v) => { k.src = v; })) : null,
          h("div", { class: "lp-row" }, h("span", { class: "sub small", text: T("Die KI spielt:", "The AI plays:") }),
            ...KI_TRACKS.map(([v, de, en]) => h("label", { class: "lp-chk" }, h("input", { type: "checkbox", checked: k.tracks.includes(v),
              onchange: (e) => { k.tracks = e.target.checked ? [...new Set([...k.tracks, v])] : k.tracks.filter(x => x !== v); } }), " " + T(de, en)))),
          h("label", { class: "lp-chk" }, h("input", { type: "checkbox", checked: k.voice, onchange: (e) => { k.voice = e.target.checked; } }),
            T(" deine echte Stimme bleibt vorn (sonst singt die KI neu)", " keep your real voice up front (otherwise the AI re-sings it)")),
          h("textarea", { id: "lpKiLyrics", rows: "2", maxlength: "3000", placeholder: T("Was du singst (optional) — hilft der KI beim Mitgehen", "What you sing (optional) — helps the AI follow"), oninput: (e) => { k.lyrics = e.target.value; } }, k.lyrics || ""),
          dits.length && !dits.some(d => /base/.test(d)) ? h("p", { class: "sub small lp-warn", text: T("Hinweis: das Base-Modell der Musik-KI fehlt auf deinem Mac — es geht trotzdem, aber der Bass wird schwächer. Der Installer lädt es (Schritt „Loop-Maschine-KI“).",
            "Note: the music AI's base model is missing on your computer — it still works, but the bass gets weaker. The installer downloads it (step “Loop machine AI”).") }) : null),
    h("div", { class: "lp-row" },
      h("label", { class: "lbl-in" }, h("span", { class: "sub small", text: T("Songlänge", "Song length") }),
        sel("lpKiLen", [[60, "1:00"], [90, "1:30"], [120, "2:00"], [180, "3:00"], [240, "4:00"]], k.len, (v) => { k.len = +v; })),
      h("input", { id: "lpKiCap", type: "text", maxlength: "500", value: k.caption, style: "flex:1 1 280px", "aria-label": T("Beschreibung für die KI (Englisch wirkt am besten)", "Description for the AI (English works best)"),
        title: T("Beschreibung für die KI (Englisch wirkt am besten)", "Description for the AI (English works best)"), oninput: (e) => { k.caption = e.target.value; } }),
      h("button", { id: "lpKiGo", type: "button", class: "primary", disabled: !can || k.busy, text: k.busy ? T("läuft …", "running …") : T("🤖 Los", "🤖 Go"), onclick: kiGo })),
    h("p", { id: "lpKiMsg", class: "sub small", role: "status", text: !conn ? T("Dafür muss dein Mac gekoppelt sein — er rechnet die Musik-KI.", "Your computer must be paired for this — it runs the music AI.")
      : !can ? T("Deine Mac-Brücke ist zu alt — bitte aktualisieren (ab 3.17).", "Your computer's bridge is too old — please update (3.17+).")
      : T(`Tempo ${S.set.bpm} BPM, ${ROOTS[S.set.root]}-${MAJORISH.includes(S.set.scale) ? "Dur" : "Moll"} — dauert auf dem Mac etwa so lange wie der Song (mit Gesang etwas länger). Fortschritt und Ergebnis im Tab „Studio“.`,
        `Tempo ${S.set.bpm} BPM, ${keyscaleEn()} — takes about as long as the song on your computer (a bit longer with vocals). Progress and result in the “Studio” tab.`) }));
}
function kiMsg(t) { const e = q("#lpKiMsg"); if (e) e.textContent = t; status(t); }
async function captureBars(n) {
  if (!(await ensureAudio())) throw new Error(T("Kein Ton", "No audio"));
  if (!S.set.gens.some(genOn)) throw new Error(T("Erst etwas starten — es läuft nichts, was die KI weiterspielen könnte.", "Start something first — nothing is playing for the AI to continue."));
  const chunks = [], sink = (d) => chunks.push(d);
  tapOn(sink);
  try {
    const b = await nextBar();
    const t0 = b.time, t1 = t0 + n * b.spb, sr = S.ctx.sampleRate;
    kiMsg(T(`🎙 Schneide ${n} Takte mit (bis ${fmtDur(t1 - t0)}) …`, `🎙 Capturing ${n} bars (${fmtDur(t1 - t0)}) …`));
    while (S.ctx.currentTime < t1 + 0.45) await new Promise(r => setTimeout(r, 100));
    S.g.tap.port.postMessage({ flush: true }); await new Promise(r => setTimeout(r, 150));
    const N = Math.round((t1 - t0) * sr), Lb = new Float32Array(N), Rb = new Float32Array(N);
    for (const c of chunks) { const off = Math.round((c.t0 - t0) * sr); for (let i = 0; i < c.L.length; i++) { const j = off + i; if (j >= 0 && j < N) { Lb[j] = c.L[i]; Rb[j] = c.R[i]; } } }
    return { L: Lb, R: Rb, sr, bars: n };
  } finally { tapOff(sink); }
}
async function kiGo() {
  const k = S.ki, L = window.mwsLibrary;
  if (k.busy || !L || !L.canWeiter()) return;
  k.busy = true; renderKi();
  try {
    let blob, request, note;
    const title = (S.recTitle || "").trim() || S.set.name;
    if (k.mode === "fortsetzen") {
      const c = await captureBars(k.bars);
      let pk = 0; for (let i = 0; i < c.L.length; i++) pk = Math.max(pk, Math.abs(c.L[i]), Math.abs(c.R[i]));
      if (pk < 0.003) throw new Error(T("Der Mitschnitt ist still.", "The capture is silent."));
      blob = encodeWav24([c.L, c.R], c.sr);
      request = { mode: "fortsetzen", caption: (k.caption || kiCaption("fortsetzen")).slice(0, 500), bpm: S.set.bpm, keyscale: keyscaleEn(), duration: Math.max(k.len, Math.ceil(c.L.length / c.sr) + 20) };
      note = T(`Aus der Loop-Maschine: die ersten ${k.bars} Takte selbst gespielt (${S.set.gens.filter(genOn).map(g => g.name).join(", ")}), danach von der Musik-KI weitergespielt.`,
        `From the loop machine: the first ${k.bars} bars self-played (${S.set.gens.filter(genOn).map(g => g.name).join(", ")}), then continued by the music AI.`);
    } else {
      const g = genById(k.src) || kiSources()[0]; if (!g) throw new Error(T("Kein Mikrofon-Loop.", "No mic loop."));
      const ls = await loadLayers(g); if (!ls.length) throw new Error(T("Der Loop ist leer.", "The loop is empty."));
      const n = ls[0].L.length, Lm = new Float32Array(n), Rm = new Float32Array(n);
      for (const l of ls) for (let i = 0; i < n; i++) { Lm[i] += l.L[i] || 0; Rm[i] += (l.R || l.L)[i] || 0; }
      let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(Lm[i]), Math.abs(Rm[i]));
      if (pk < 0.003) throw new Error(T("Der Loop ist still.", "The loop is silent."));
      if (pk > 0.98) { const s = 0.98 / pk; for (let i = 0; i < n; i++) { Lm[i] *= s; Rm[i] *= s; } }
      blob = encodeWav24([Lm, Rm], S.ctx ? S.ctx.sampleRate : 48000);
      if (!k.tracks.length) throw new Error(T("Wähle mindestens ein Instrument für die KI.", "Pick at least one instrument for the AI."));
      request = { mode: "gesang", caption: (k.caption || kiCaption("gesang")).slice(0, 500), bpm: Math.round(ls[0].bpm || S.set.bpm), keyscale: keyscaleEn(), duration: k.len,
        tracks: k.tracks, stimme: k.voice ? "original" : "ki", ...(k.lyrics && k.lyrics.trim() ? { lyrics: k.lyrics.trim().slice(0, 3000) } : {}) };
      note = k.voice ? T("Aus der Loop-Maschine: Gesang selbst eingesungen, Begleitung von der Musik-KI.", "From the loop machine: vocals self-sung, accompaniment by the music AI.")
        : T("Aus der Loop-Maschine: nach einem selbst eingesungenen Loop von der Musik-KI gesungen und gespielt.", "From the loop machine: sung and played by the music AI after a self-sung loop.");
    }
    kiMsg(T("📤 Schicke es an deinen Mac …", "📤 Sending it to your computer …"));
    await L.weiter({ blob, request, title, note });
    kiMsg(T(`🤖 Dein Mac baut „${title}“ — Fortschritt und Ergebnis im Tab „Studio“. Du kannst hier weiterspielen.`, `🤖 Your computer is building “${title}” — progress and result in the “Studio” tab. You can keep playing here.`));
  } catch (e) { kiMsg(T("Nicht möglich: ", "Not possible: ") + (e.message || e)); }
  finally { k.busy = false; const b = q("#lpKiGo"); if (b) { b.disabled = !(L && L.canWeiter()); b.textContent = T("🤖 Los", "🤖 Go"); } }
}

// =====================================================================================================
// Spielen: Computertastatur, MIDI (Noten in den gewählten Generator, Regler lernen)
// =====================================================================================================
const KEYMAP = { KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16, Quote: 17 };
const PADGM = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0, 1];
function playTarget() {
  const g = genById(S.sel);
  if (g && g.kind !== "osc" && g.kind !== "audio") return g;
  return S.set.gens.find(x => x.kind === "seed") || S.set.gens.find(x => KIND[x.kind].ins) || null;
}
async function noteOn(n, v) {
  if (!(await ensureAudio())) return;
  const g = playTarget(); if (!g) { status(T("Zum Spielen eine „Vorgabe“ oder einen Klang-Generator hinzufügen.", "Add “Your bars” or a sound generator to play.")); return; }
  const nn = g.kind === "beat" ? PADGM[((n - 60) % 18 + 18) % 18] : n;
  post({ t: "note", id: g.id, n: nn, v, on: true }); paintKey(n, true); return nn;
}
function noteOff(n, nn) { const g = playTarget(); if (g) post({ t: "note", id: g.id, n: nn != null ? nn : n, on: false }); paintKey(n, false); }
function typing(e) { const t = e.target; return t && (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.isContentEditable); }
function tabVisible() { const v = q("#loopView"); return v && !v.classList.contains("hidden"); }
window.mwsLoopsVisible = tabVisible;
function onKeyDown(e) {
  if (!tabVisible() || typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.code === "Space") { e.preventDefault(); e.stopImmediatePropagation(); if (S.set.gens.some(genOn)) stopAll(false); else startAll(); return; }
  if (e.repeat) { if (KEYMAP[e.code] != null) e.preventDefault(); return; }
  if (e.code === "KeyZ") { S.octave = clamp(S.octave - 1, -3, 3); renderKeys(); e.preventDefault(); return; }
  if (e.code === "KeyX") { S.octave = clamp(S.octave + 1, -3, 3); renderKeys(); e.preventDefault(); return; }
  const k = KEYMAP[e.code]; if (k == null) return;
  e.preventDefault();
  const n = 60 + S.octave * 12 + k;
  noteOn(n, S.vel).then(nn => S.kbDown.set(e.code, { n, nn }));
}
function onKeyUp(e) { const x = S.kbDown.get(e.code); if (!x) return; S.kbDown.delete(e.code); noteOff(x.n, x.nn); }
async function initMidi() {
  if (!navigator.requestMIDIAccess) return;
  try { S.midi = await navigator.requestMIDIAccess({ sysex: false }); S.midi.addEventListener("statechange", bindMidi); bindMidi(); } catch (e) { /* abgelehnt: Computertastatur */ }
}
function bindMidi() {
  for (const inp of S.midi.inputs.values()) { if (inp.__lp) continue; inp.__lp = true; inp.addEventListener("midimessage", (ev) => onMidi(ev)); }
  const n = [...S.midi.inputs.values()].filter(i => i.state !== "disconnected").length;
  const e = q("#lpMidi"); if (e) e.textContent = n ? "🎹 MIDI ✓" : "";
}
const midiHeld = new Map();
function onMidi(ev) {
  if (!tabVisible()) return;
  const [st, d1 = 0, d2 = 0] = ev.data, type = st & 0xf0;
  if (S.learn && S.learnTarget && type === 0xb0) {
    S.map["cc:" + (st & 15) + ":" + d1] = S.learnTarget.spec; lsSet(LS_MAP, S.map);
    status(T("Gelernt: ", "Learned: ") + S.learnTarget.label + " ← CC " + d1); S.learnTarget.el.classList.remove("learn-pick"); S.learnTarget = null; return;
  }
  if (type === 0x90 || type === 0x80) {
    const on = type === 0x90 && d2 > 0;
    if (on) noteOn(d1, d2 / 127).then(nn => midiHeld.set(d1, nn)); else { noteOff(d1, midiHeld.get(d1)); midiHeld.delete(d1); }
    return;
  }
  if (type === 0xe0) { const g = playTarget(); if (g) post({ t: "bend", id: g.id, v: ((d2 << 7) | d1) / 8192 - 1 }); return; }
  if (type === 0xb0 && !S.map["cc:" + (st & 15) + ":" + d1] && (d1 === 1 || d1 === 64)) {
    const g = playTarget(); if (g) post(d1 === 1 ? { t: "mod", id: g.id, v: d2 / 127 } : { t: "pedal", id: g.id, on: d2 >= 64 }); return;
  }
  if (type === 0xb0) {
    const sp = S.map["cc:" + (st & 15) + ":" + d1]; if (!sp) return;
    const g = genById(sp.id); if (!g) return;
    const spec = (sp.fx ? FX : KIND[g.kind].p).find(p => p.k === sp.k); if (!spec || spec.t !== "knob") return;
    const v = fromPos(spec, d2 / 127);
    if (sp.fx) setFx(g, sp.k, v); else setGenParam(g, sp.k, v, spec);
    const kn = q(`[data-lk="${g.id}:${sp.fx ? "fx" : "p"}:${sp.k}"]`); if (kn && kn.setValue) kn.setValue(v);
  }
}

// =====================================================================================================
// Regler (wie in "Selber machen": Klick an den Bogen setzt, Shift+senkrecht = fein, Mausrad, Alt-Klick = Standard)
// =====================================================================================================
function toPos(p, v) { if (p.c === "exp") return Math.log(v / p.min) / Math.log(p.max / p.min); if (p.c === "exp0") return Math.sqrt(clamp(v / p.max, 0, 1)); return (v - p.min) / (p.max - p.min); }
function fromPos(p, x) { x = clamp(x, 0, 1); let v = p.c === "exp" ? p.min * Math.pow(p.max / p.min, x) : p.c === "exp0" ? x * x * p.max : p.min + x * (p.max - p.min); if (p.st) v = Math.round(v / p.st) * p.st; return clamp(v, p.min, p.max); }
function fmt(p, v) {
  const u = p.u || "", dec = EN ? "." : ",";
  if (p.k === "hp" && v <= 21) return T("aus", "off");
  if (p.k === "cut" && v >= 19900) return T("offen", "open");
  if (u === "Hz") return v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 1 : 2).replace(".", dec) + " kHz" : (v < 10 ? v.toFixed(2).replace(".", dec) : Math.round(v)) + " Hz";
  if (u === "s") return v < 1 ? Math.round(v * 1000) + " ms" : v.toFixed(2).replace(".", dec) + " s";
  if (u === "ms") return (v > 0 ? "+" : "") + Math.round(v) + " ms";
  if (u === "%") return Math.round(v * 100) + " %";
  if (u === "ct") return (v > 0 ? "+" : "") + Math.round(v) + " ct";
  if (u === "x") return (Math.round(v * 100) / 100).toString().replace(".", dec) + "×";
  if (u === "pan") return Math.abs(v) < 0.02 ? "C" : (v < 0 ? "L " : "R ") + Math.round(Math.abs(v) * 100);
  if (u === "dB") return (v > 0 ? "+" : "") + v.toFixed(1).replace(".", dec) + " dB";
  return String(Math.round(v * 100) / 100).replace(".", dec);
}
function knob(p, value, onChange, opts = {}) {
  const lab = EN ? p.en : p.de, id = "lpK" + uid();
  const wrap = h("div", { class: "sb-knob small", title: lab + T(" — an die Stelle am Bogen klicken · fein: Shift + senkrecht ziehen oder Mausrad · Alt-Klick = Standard", " — click the spot on the arc · fine: Shift + drag vertically, or the mouse wheel · Alt-click = default") });
  if (opts.lk) wrap.dataset.lk = opts.lk;
  const R = 15, C = 2 * Math.PI * R, A = 0.75, size = (R + 5) * 2;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("viewBox", `0 0 ${size} ${size}`); svg.setAttribute("width", size); svg.setAttribute("height", size);
  const mk = (cls) => { const c = document.createElementNS("http://www.w3.org/2000/svg", "circle"); c.setAttribute("cx", size / 2); c.setAttribute("cy", size / 2); c.setAttribute("r", R); c.setAttribute("class", cls); svg.append(c); return c; };
  const track = mk("kt"), arc = mk("ka"), marc = mk("km"); track.setAttribute("stroke-dasharray", `${C * A} ${C}`);
  const dot = document.createElementNS("http://www.w3.org/2000/svg", "line"); dot.setAttribute("class", "kd"); svg.append(dot);
  // 3.17.2: dreht die Automatik (Wobble, Autopilot, LFO, Einrasten, Tor …), dreht sich der Regler mit: Zeiger und Bogen zeigen,
  // was KLINGT; die eigene Einstellung bleibt als kleiner Punkt am Ring stehen (+ dünner Bogen dorthin) — wie ein Motorregler
  const mdot = document.createElementNS("http://www.w3.org/2000/svg", "circle"); mdot.setAttribute("class", "kl"); mdot.setAttribute("r", "3"); svg.append(mdot);
  marc.style.visibility = mdot.style.visibility = "hidden";
  const face = h("div", { class: "sb-kface", id, role: "slider", tabindex: "0", "aria-label": lab, "aria-valuemin": p.min, "aria-valuemax": p.max }); face.append(svg);
  const val = h("span", { class: "sb-kval" });
  wrap.append(face, h("label", { class: "sb-klab", for: id, text: lab }), val);
  let v = value, live = null, liveShown = false, liveT = 0, touchT = 0;
  const paint = () => {
    const x = clamp(toPos(p, liveShown ? live : v), 0, 1), bip = p.min < 0 && p.max > 0, zero = bip ? toPos(p, 0) : 0, a0 = Math.min(zero, x), a1 = Math.max(zero, x);
    arc.setAttribute("stroke-dasharray", `${Math.max(0.001, (a1 - a0) * C * A)} ${C}`); arc.setAttribute("stroke-dashoffset", `${-a0 * C * A}`);
    const ang = (135 + x * 270) * Math.PI / 180, cx = size / 2, cy = size / 2;
    dot.setAttribute("x1", cx + Math.cos(ang) * (R - 7)); dot.setAttribute("y1", cy + Math.sin(ang) * (R - 7)); dot.setAttribute("x2", cx + Math.cos(ang) * (R + 1)); dot.setAttribute("y2", cy + Math.sin(ang) * (R + 1));
    if (!liveShown) val.textContent = fmt(p, v);
    face.setAttribute("aria-valuenow", v); face.setAttribute("aria-valuetext", fmt(p, v));
  };
  const paintLive = () => {
    const x0 = clamp(toPos(p, v), 0, 1), x1 = live == null ? x0 : clamp(toPos(p, live), 0, 1), show = Math.abs(x1 - x0) > 0.006;
    if (show !== liveShown) { liveShown = show; marc.style.visibility = mdot.style.visibility = show ? "visible" : "hidden"; wrap.classList.toggle("mod", show); }
    paint();                                            // Zeiger und Bogen: klingender Wert (oder eingestellter, wenn nichts dreht)
    if (!show) return;
    const a0 = Math.min(x0, x1), a1 = Math.max(x0, x1), cx = size / 2, ang = (135 + x0 * 270) * Math.PI / 180;
    marc.setAttribute("stroke-dasharray", `${Math.max(0.001, (a1 - a0) * C * A)} ${C}`); marc.setAttribute("stroke-dashoffset", `${-a0 * C * A}`);
    mdot.setAttribute("cx", cx + Math.cos(ang) * R); mdot.setAttribute("cy", cx + Math.sin(ang) * R);
    // die Zahl zeigt den klingenden Wert (ruhig: höchstens ~8× je Sekunde); kurz nach dem Drehen den eingestellten
    const now = performance.now();
    if (now - touchT > 1500 && now - liveT > 120) { liveT = now; val.textContent = fmt(p, live); }
  };
  const set = (nv) => { nv = clamp(nv, p.min, p.max); touchT = performance.now(); if (nv === v) return; v = nv; paintLive(); val.textContent = fmt(p, v); onChange(v); };
  wrap.setValue = (nv) => { v = nv; paintLive(); };
  // sichtbar hinüberdrehen (Auto-Mix): in ~0,4 s vom alten zum neuen Wert, wie von Hand
  wrap.glideTo = (nv) => {
    const a = toPos(p, v), b = toPos(p, nv), t0 = performance.now();
    const step = (now) => { const k = Math.min(1, (now - t0) / 400), e = k * k * (3 - 2 * k); v = k >= 1 ? nv : fromPos(p, a + (b - a) * e); paintLive(); if (!liveShown) val.textContent = fmt(p, v); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  };
  wrap.setLive = (lv) => { live = lv == null || !isFinite(lv) ? null : lv; paintLive(); };
  wrap.liveValue = () => (liveShown ? live : null);
  const posAt = (e) => {
    const r = face.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    if (dx * dx + dy * dy < 9) return toPos(p, v);
    const a = ((Math.atan2(dy, dx) * 180 / Math.PI - 135) % 360 + 360) % 360;
    return a <= 270 ? a / 270 : (a > 315 ? 0 : 1);
  };
  let drag = null;
  face.addEventListener("pointerdown", (e) => {
    if (S.learn && opts.learn) { e.preventDefault(); if (S.learnTarget) S.learnTarget.el.classList.remove("learn-pick"); S.learnTarget = { spec: opts.learn, label: lab, el: wrap }; wrap.classList.add("learn-pick");
      status(T(`MIDI lernen: jetzt am Controller drehen für „${lab}“`, `MIDI learn: now turn a controller for “${lab}”`)); return; }
    e.preventDefault(); face.focus();
    if (e.altKey) { set(p.def); return; }
    if (e.shiftKey) { try { face.setPointerCapture(e.pointerId); } catch (x) { /* kein aktiver Zeiger */ } drag = { y: e.clientY, x0: toPos(p, v) }; return; }
    set(fromPos(p, posAt(e)));
  });
  face.addEventListener("pointermove", (e) => { if (!drag) return; if (!(e.buttons & 1)) { drag = null; return; } set(fromPos(p, drag.x0 + (drag.y - e.clientY) / 900)); });
  const end = () => { drag = null; };
  face.addEventListener("pointerup", end); face.addEventListener("pointercancel", end); face.addEventListener("lostpointercapture", end);
  // 3.17.2: gestufte Regler (Oktave, Halbton, Stimmen …) — ein Rad-/Tastenschritt war kleiner als eine halbe Stufe und wurde
  // zurückgerundet: Mausrad und Pfeiltasten taten nichts. Jetzt mindestens eine Stufe.
  const nudge = (d) => { let nv = fromPos(p, toPos(p, v) + d); if (p.st && nv === v) nv = clamp(v + Math.sign(d) * p.st, p.min, p.max); return nv; };
  face.addEventListener("wheel", (e) => { e.preventDefault(); set(nudge(-Math.sign(e.deltaY) * (e.shiftKey ? 0.005 : 0.03))); }, { passive: false });
  face.addEventListener("keydown", (e) => {
    const stp = e.shiftKey ? 0.01 : 0.05;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") { e.preventDefault(); set(nudge(stp)); }
    else if (e.key === "ArrowDown" || e.key === "ArrowLeft") { e.preventDefault(); set(nudge(-stp)); }
    else if (e.key === "Enter") set(p.def);
  });
  paint();
  return wrap;
}
function selectBox(p, value, onChange) {
  const id = "lpS" + uid();
  const s = h("select", { id, class: "sb-sel" }, p.opts.map(([v, de, en]) => h("option", { value: String(v), selected: String(v) === String(value) }, EN ? en : de)));
  s.addEventListener("change", () => { const o = p.opts.find(x => String(x[0]) === s.value); onChange(o ? o[0] : s.value); });
  return h("div", { class: "sb-field" }, h("label", { for: id, text: EN ? p.en : p.de }), s);
}
function toggle(p, value, onChange) {
  const b = h("button", { type: "button", class: "sb-tog" + (value ? " on" : ""), "aria-pressed": String(!!value), text: EN ? p.en : p.de });
  b.addEventListener("click", () => { const on = !b.classList.contains("on"); b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); onChange(on); });
  return b;
}
// 3.17.2: Regler der Loop-Maschine selbst, die gerade nicht wirken (Muster wie knobIdle für die Instrumente)
function loopIdle(g, pk) {
  const num = (x, d) => (typeof x === "number" ? x : d), [w, k] = pk.split(":"), p = g.p, f = g.fx, R = (de, en, fix) => ({ de, en, fix: fix && { [w]: fix } });
  if (w === "s") { const r = g.patch ? knobIdle(g.patch.engine, k, g.patch) : null; return r && { ...r, fix: r.fix && { s: r.fix } }; }
  if (w === "fx") {
    if (k === "wdepth" && !SYNC_STEPS[f.wob]) return R("wirkt, sobald Wobble läuft", "works once wobble runs", { wob: "1/4" });
    if ((k === "etime" || k === "efb") && !(f.echo > 0)) return R("wirkt, sobald Echo über 0 ist", "works once echo is above 0", { echo: 0.25 });
    return null;
  }
  if (g.kind !== "osc") return null;
  const wave = p.wave || "saw", noise = /noise|pink|brown/.test(wave), lsync = p.lsync && p.lsync !== "off";
  if (noise && /^(freq|snap|fine|uni|det|sub|pw|fmr|fma|glide|drift)$/.test(k)) return R("wirkt nicht bei Rauschen (Welle)", "has no effect on noise (wave)");
  if (k === "pw" && wave !== "square") return R("wirkt bei Welle Rechteck/Puls", "works with the square/pulse wave", { wave: "square" });
  if (k === "uni" && wave === "supersaw") return R("Supersaw hat immer 7 Stimmen", "supersaw always has 7 voices");
  if (k === "det" && wave !== "supersaw" && !(num(p.uni, 1) > 1)) return R("wirkt ab 2 Stimmen", "works from 2 voices", { uni: 3 });
  if (k === "fmr" && !(num(p.fma, 0) > 0) && p.ldest !== "fm") return R("wirkt, sobald die FM-Menge über 0 ist", "works once the FM amount is above 0", { fma: 0.3 });
  if (k === "gatelen" && (p.gate || "off") === "off") return R("wirkt, sobald das Tor läuft", "works once the gate runs", { gate: "1/8" });
  if (/^(lshape|lrate|lsync|lamt)$/.test(k) && (p.ldest || "off") === "off") return R("wirkt, sobald der LFO ein Ziel hat (LFO-Ziel: aus)", "works once the LFO has a target (LFO target: off)");
  if (k === "ldest" && !(num(p.lamt, 0) > 0)) return { ...R("wirkt, sobald die LFO-Menge über 0 ist", "works once the LFO amount is above 0", { lamt: 0.3 }), opener: true };   // Einschalter: hell
  if (/^(lshape|lrate|lsync)$/.test(k) && !(num(p.lamt, 0) > 0)) return R("wirkt, sobald die LFO-Menge über 0 ist", "works once the LFO amount is above 0", { lamt: 0.3 });
  if (k === "lrate" && lsync) return R("läuft im Takt — „LFO im Takt“ auf frei stellen", "runs in tempo — set “LFO sync” to free");
  return null;
}
function specOf(g, pk) {
  const [w, k] = pk.split(":");
  if (w === "fx") return FX.find(x => x.k === k);
  if (w === "s") { for (const sec of SCHEMA[g.patch.engine] || []) for (const q of sec.p) if (q.k === k) return q; return null; }
  return KIND[g.kind].p.find(x => x.k === k);
}
function markCard(g) { const c = q("#lpCard-" + g.id); if (c) markIdle(c, (pk) => loopIdle(g, pk), EN); }
// vor dem Setzen fragen: wirkte der Regler gerade nicht? → nach dem Setzen die Abhängigkeit dazuschalten, sichtbar
function withFix(g, pk, apply) {
  const idle = loopIdle(g, pk);
  apply();
  if (idle && idle.fix && !idle.soft) {
    const [w] = pk.split(":"), fix = idle.fix[w], c = q("#lpCard-" + g.id);
    for (const [fk, fv] of Object.entries(fix)) {
      if (w === "fx") setFx(g, fk, fv);
      else if (w === "s") { g.patch[fk] = fv; post({ t: "param", id: g.id, k: fk, v: fv }); changed(); }
      else setGenParam(g, fk, fv, specOf(g, "p:" + fk));
      if (c) showValue(c.querySelector(`[data-pk="${w}:${fk}"]`), fv);
    }
    status(T("🔌 Dazugeschaltet, damit du es hörst: ", "🔌 Switched on so you can hear it: ") + fixText(fix, (x) => specOf(g, w + ":" + x), EN));
  }
  markCard(g);
}
function control(g, p, isFx) {
  const val = isFx ? g.fx[p.k] : g.p[p.k], pk = (isFx ? "fx:" : "p:") + p.k;
  const cb = (v) => withFix(g, pk, () => (isFx ? setFx(g, p.k, v) : setGenParam(g, p.k, v, p)));
  let el;
  if (p.t === "knob") el = knob(p, val, cb, { lk: `${g.id}:${isFx ? "fx" : "p"}:${p.k}`, learn: { id: g.id, k: p.k, fx: !!isFx } });
  else if (p.t === "sel") el = selectBox(p, val, (v) => { cb(v); if (p.k === "bars" && g.kind === "seed") paintCard(g); });
  else el = toggle(p, val, cb);
  el.dataset.pk = pk;
  return el;
}

// =====================================================================================================
// Oberfläche
// =====================================================================================================
function status(t) { const e = q("#lpMsg"); S.msgAt = Date.now(); if (e) { e.textContent = t; clearTimeout(S.msgT); S.msgT = setTimeout(() => { if (e.textContent === t) e.textContent = ""; }, 12000); } }
function shell() {
  const v = q("#loopView"); v.innerHTML = "";
  v.append(
    h("div", { class: "sb-top" },
      h("div", { class: "sb-proj" },
        h("label", { class: "sb-cap", for: "lpName", text: T("Set", "Set") }),
        h("input", { id: "lpName", type: "text", maxlength: "80", class: "sb-name" }),
        h("select", { id: "lpSets", "aria-label": T("Set öffnen", "Open set") }),
        h("button", { id: "lpNew", type: "button", class: "ghost btn-s", text: T("＋ Neu", "＋ New") }),
        h("button", { id: "lpDel", type: "button", class: "ghost btn-s danger", text: "🗑", title: T("Set löschen", "Delete set") })),
      h("span", { id: "lpSaved", class: "sub small", role: "status" })),
    h("div", { id: "lpTransport", class: "sb-transport lp-transport" }),
    h("div", { id: "lpKi", class: "lp-ki hidden" }),
    h("div", { class: "lp-addbar" }, h("span", { class: "sb-cap", text: T("＋ Generator", "＋ Generator") }),
      ...Object.keys(KIND).map(k => h("button", { type: "button", class: "ghost btn-s lp-add", "data-kind": k, title: T(KIND[k].hd, KIND[k].he), text: KIND[k].icon + " " + T(KIND[k].de, KIND[k].en),
        onclick: () => { const g = addGen(k); if (g && k === "audio") micOn(); } })),
      h("span", { class: "spacer" }),
      h("button", { id: "lpKiOpen", type: "button", class: "ghost btn-s lp-kibtn", title: T("Die Musik-KI auf deinem Mac spielt deinen Jam weiter oder die Band zu deinem Gesang", "The music AI on your computer continues your jam or plays the band for your voice"),
        text: T("🤖 KI baut weiter", "🤖 AI takes over"), onclick: () => { S.ki.open = !S.ki.open; renderKi(); if (S.ki.open) q("#lpKi").scrollIntoView({ block: "nearest" }); } }),
      h("button", { id: "lpSurprise", type: "button", class: "ghost btn-s", title: T("Eine zufällige Richtung, Tonart und Generatoren — sofort", "A random style, key and generators — right away"), text: T("🎲 Überrasch mich", "🎲 Surprise me"), onclick: surprise })),
    h("div", { id: "lpCards", class: "lp-cards" }),
    h("p", { id: "lpMsg", class: "status sb-msg", role: "status" }),
    h("p", { class: "sub small lp-help", text: T("Start: ▶︎ auf einer Karte — der Generator setzt am nächsten Takt ein und läuft, bis du ■ drückst. Leertaste startet/stoppt alle. Die Computertastatur (A W S E D … K) spielt den gewählten Generator, Y/X (deutsch: Z/X) wechselt die Oktave. Jeder Regler lässt sich per „MIDI lernen“ auf einen Drehregler deines Controllers legen.",
      "Start: ▶︎ on a card — the generator comes in on the next bar and runs until you press ■. Space starts/stops all. The computer keyboard (A W S E D … K) plays the selected generator, Z/X changes octave. Every knob can be put on a controller knob via “MIDI learn”.") }),
    // 3.17.1: die Tastatur immer unten (klebt am unteren Rand, einklappbar)
    h("div", { id: "lpKeys", class: "lp-keys" }),
  );
  q("#lpName").addEventListener("input", (e) => { S.set.name = e.target.value.slice(0, 80) || "Set"; changed(); renderSets(); });
  q("#lpSets").addEventListener("change", (e) => openSet(e.target.value));
  q("#lpNew").onclick = async () => { await save(); stopAll(true); for (const g of S.set.gens) { post({ t: "del", id: g.id }); dropChain(g.id); } demoSet(); S.set.name = T("Neues Set", "New set"); await afterLoad(); status(T("Neues Set angelegt.", "New set created.")); };
  q("#lpDel").onclick = async () => {
    if (!confirm(T(`Set „${S.set.name}“ löschen? Aufgenommene Tracks in der Bibliothek bleiben.`, `Delete set “${S.set.name}”? Tracks you recorded stay in the library.`))) return;
    stopAll(true); for (const g of S.set.gens) { post({ t: "del", id: g.id }); dropChain(g.id); if (g.kind === "audio") await saveLayers(g, []); }
    await dbDel("sets", S.set.id).catch(() => {});
    const all = (await dbAll("sets").catch(() => [])).sort((a, b) => b.changed - a.changed);
    S.set = all.length ? fixSet(all[0]) : demoSet(); await afterLoad();
  };
}
async function renderSets() {
  const sel = q("#lpSets"); if (!sel) return;
  const all = (await dbAll("sets").catch(() => [])).sort((a, b) => (b.changed || 0) - (a.changed || 0));
  if (!all.some(s => s.id === S.set.id)) all.unshift(S.set);
  sel.innerHTML = ""; for (const s of all) sel.append(h("option", { value: s.id, selected: s.id === S.set.id }, s.id === S.set.id ? S.set.name : s.name));
}
async function openSet(id) {
  if (id === S.set.id) return;
  await save(); stopAll(true);
  for (const g of S.set.gens) { post({ t: "del", id: g.id }); dropChain(g.id); }
  const s = await dbGet("sets", id).catch(() => null); if (!s) return;
  S.set = fixSet(s); await afterLoad();
}
async function afterLoad() {
  if (S.auto) endAutoFx(); S.states.clear(); S.sel = null; S.auto = { log: "", plan: [], fx: [] };
  q("#lpName").value = S.set.name;
  for (const g of S.set.gens) if (g.kind === "audio") { const ls = await loadLayers(g); g.nLayers = ls.length; if (ls.length) { g.loopBars = ls[0].bars; g.loopBpm = ls[0].bpm; } }
  if (S.g) {
    for (const g of S.set.gens) makeChain(g);
    syncAll(); applyMaster();
    for (const g of S.set.gens) if (g.kind === "audio" && g.nLayers) loadLayers(g).then(ls => post({ t: "layers", id: g.id, layers: ls }));
  }
  renderTransport(); renderCards(); renderSets(); renderKeys(); save();
}

function renderTransport() {
  const el = q("#lpTransport"); if (!el || !S.set) return;
  el.innerHTML = "";
  const any = S.set.gens.some(genOn);
  const num = (id, val, min, max, step, onCh, lab, w = 64) => { const i = h("input", { id, type: "number", min, max, step, value: val, style: `width:${w}px` }); i.onchange = () => { const v = clamp(+i.value || val, min, max); i.value = v; onCh(v); }; return h("label", { class: "sb-tgroup lbl-in" }, h("span", { class: "sb-cap", text: lab }), i); };
  const sel = (id, opts, val, onCh, lab) => { const s = h("select", { id, "aria-label": lab }, opts.map(([v, t]) => h("option", { value: v, selected: String(v) === String(val) }, t))); s.onchange = () => onCh(s.value); return s; };
  el.append(
    h("div", { class: "sb-tgroup" },
      h("button", { id: "lpPlayAll", type: "button", class: "sb-tbtn" + (any ? " on" : ""), title: T("Alle starten (Leertaste)", "Start all (space)"), text: "▶︎", onclick: () => startAll() }),
      h("button", { id: "lpStopAll", type: "button", class: "sb-tbtn", title: T("Alle am Taktende stoppen — Doppelklick: sofort", "Stop all at the end of the bar — double-click: now"), text: "■", onclick: () => stopAll(false), ondblclick: () => stopAll(true) }),
      h("button", { id: "lpRec", type: "button", class: "sb-tbtn rec" + (S.rec && S.rec.on ? " on" : ""), title: T("Aufnahme: alles, was du hörst, als Track in die Bibliothek", "Record: everything you hear, as a track in the library"), text: "●", onclick: toggleRecord }),
      h("span", { id: "lpRecTime", class: "lp-rectime" + (S.rec && S.rec.on ? " on" : ""), text: S.rec && S.rec.on ? "0:00" : "" }),
      h("span", { id: "lpBar", class: "lp-bar", "aria-label": T("Takt", "Bar") })),
    h("div", { class: "sb-tgroup" },
      num("lpBpm", S.set.bpm, 40, 220, 1, (v) => { S.set.bpm = v; post({ t: "tempo", bpm: v, swing: S.set.swing }); for (const g of S.set.gens) applyFx(g); changed(); }, "BPM"),
      num("lpSwing", Math.round((S.set.swing - 0.5) * 200), 0, 50, 1, (v) => { S.set.swing = 0.5 + v / 200; post({ t: "tempo", bpm: S.set.bpm, swing: S.set.swing }); changed(); }, "Swing %", 54),
      h("button", { id: "lpMetro", type: "button", class: "sb-tog" + (S.metro ? " on" : ""), text: T("Metronom", "Metronome"), onclick: () => { S.metro = !S.metro; post({ t: "metro", on: S.metro }); paintTransport(); } })),
    h("div", { class: "sb-tgroup" },
      h("span", { class: "sb-cap", text: T("Tonart", "Key") }),
      sel("lpRoot", ROOTS.map((r, i) => [i, r]), S.set.root, (v) => { S.set.root = +v; syncHarmony(); changed(); }, T("Grundton", "Root")),
      sel("lpScale", SCALES.map(([k, de, en]) => [k, T(de, en)]), S.set.scale, (v) => { S.set.scale = v; syncHarmony(); changed(); }, T("Tonleiter", "Scale")),
      sel("lpProg", PROGS.map(([k, n]) => [k, n]), S.set.prog, (v) => { S.set.prog = v; syncHarmony(); changed(); }, T("Akkordfolge", "Chord progression")),
      sel("lpPer", [[1, T("1 Takt je Akkord", "1 bar per chord")], [2, T("2 Takte je Akkord", "2 bars per chord")], [4, T("4 Takte je Akkord", "4 bars per chord")]], S.set.per, (v) => { S.set.per = +v; syncHarmony(); changed(); }, T("Takte je Akkord", "Bars per chord"))),
    h("div", { class: "sb-tgroup lp-master" },
      knob(K("dj", "DJ-Filter", "DJ filter", -1, 1, 0, { u: "%" }), S.set.master.dj, (v) => { S.set.master.dj = v; applyMaster(); changed(); }, { lk: "master:dj" }),
      knob(K("revDecay", "Hall-Länge", "Reverb length", 0.4, 8, 2.6, { c: "exp", u: "s" }), S.set.master.revDecay, (v) => { S.set.master.revDecay = Math.round(v * 10) / 10; applyMaster(); changed(); }),
      knob(K("mvol", "Summe", "Master", -24, 6, 0, { u: "dB" }), S.set.master.vol, (v) => { S.set.master.vol = v; applyMaster(); changed(); }),
      h("canvas", { id: "lpMeter", class: "lp-meter", width: 14, height: 54, "aria-hidden": "true" }), scopeCv("master:out", { cls: "big", title: T("Oszillogramm der Summe (nach dem Begrenzer)", "Oscilloscope of the master (after the limiter)") })),
    h("div", { class: "sb-tgroup lp-auto" },
      h("button", { id: "lpAuto", type: "button", class: "sb-tog" + (S.set.auto.on ? " on" : ""), title: T("Der Autopilot arrangiert: alle 8 Takte tauscht er Generatoren, baut Breakdowns, Steigerungen und neue Muster", "The autopilot arranges: every 8 bars it swaps generators, builds breakdowns, build-ups and new patterns"),
        text: T("🪄 Autopilot", "🪄 Autopilot"), onclick: () => { S.set.auto.on = !S.set.auto.on; if (!S.set.auto.on) resetAuto(); paintTransport(); changed(); } }),
      knob(K("amt", "Mut", "Boldness", 0, 1, 0.5, { u: "%" }), S.set.auto.amt, (v) => { S.set.auto.amt = v; changed(); }),
      h("button", { id: "lpMix", type: "button", class: "sb-tog" + (S.mix ? " on" : ""), title: T("Auto-Mix: hört 2 Takte zu und stellt die Lautstärke jedes Generators so ein, dass es zusammen gut klingt (auch von Hand verstellte)", "Auto mix: listens for 2 bars and sets each generator's volume so it sounds good together (hand-set ones too)"),
        text: T("🎚 Ausmischen", "🎚 Mix"), onclick: () => autoMix({ manual: true }) }),
      sel("lpStyle", Object.entries(STYLES).map(([k, s]) => [k, T(s.de, s.en)]), S.set.style || "house", (v) => { S.set.style = v; changed(); }, T("Richtung für „Rest übernehmen“", "Style for “take over the rest”")),
      h("span", { id: "lpAutoLog", class: "sub small lp-autolog" })),
    h("div", { class: "sb-tgroup sb-right" },
      h("input", { id: "lpTitle", type: "text", maxlength: "80", placeholder: T("Titel der Aufnahme", "Recording title"), value: S.recTitle || S.set.name, oninput: (e) => { S.recTitle = e.target.value; } }),
      h("button", { id: "lpLearn", type: "button", class: "sb-tog" + (S.learn ? " on" : ""), title: T("Regler anklicken, dann am MIDI-Controller drehen", "Click a knob, then turn a knob on your MIDI controller"), text: T("🎛 MIDI lernen", "🎛 MIDI learn"),
        onclick: () => { S.learn = !S.learn; if (!S.learn && S.learnTarget) { S.learnTarget.el.classList.remove("learn-pick"); S.learnTarget = null; } paintTransport(); } }),
      h("span", { id: "lpMidi", class: "sub small" })),
  );
  renderAutoLog(); paintBar();
  if (S.midi) bindMidi();
}
// Zustände der Leiste nachziehen, ohne sie neu zu bauen (sonst gingen Fokus und Eingaben verloren)
function paintTransport() {
  if (!q("#lpTransport") || !S.set) return;
  const tog = (id, on) => { const e = q(id); if (e) { e.classList.toggle("on", !!on); e.setAttribute("aria-pressed", String(!!on)); } };
  tog("#lpPlayAll", S.set.gens.some(genOn)); tog("#lpRec", S.rec && S.rec.on); tog("#lpAuto", S.set.auto.on); tog("#lpLearn", S.learn); tog("#lpMetro", S.metro); tog("#lpMix", !!S.mix);
  const rt = q("#lpRecTime"); if (rt) { rt.classList.toggle("on", !!(S.rec && S.rec.on)); if (!(S.rec && S.rec.on)) rt.textContent = ""; }
  const val = (id, v) => { const e = q(id); if (e && document.activeElement !== e && String(e.value) !== String(v)) e.value = v; };
  val("#lpBpm", S.set.bpm); val("#lpSwing", Math.round((S.set.swing - 0.5) * 200)); val("#lpRoot", S.set.root); val("#lpScale", S.set.scale);
  val("#lpProg", S.set.prog); val("#lpPer", S.set.per); val("#lpStyle", S.set.style || "house");
  renderAutoLog(); paintBar();
}
// 3.17.2: Autopilot-Effekte beenden — Filter auf, vom Breakdown angehaltene Generatoren wieder an (wenn der Takt läuft und gewünscht)
function openAutoFilters() {
  if (!S.g) return;
  const now = S.ctx.currentTime;
  for (const [f, v] of [[S.g.apLP.frequency, 20000], [S.g.apHP.frequency, 10]]) { f.cancelScheduledValues(now); f.setValueAtTime(f.value, now); f.setTargetAtTime(v, now, 0.05); }
}
function endAutoFx({ restart = false } = {}) {
  const fx = S.auto.fx || [];
  if (restart && S.running) for (const x of fx) for (const id of x.stopped || []) { const g = genById(id); if (g && !genOn(g)) post({ t: "start", id }); }
  S.auto.fx = []; S.auto.plan = []; S.auto.calm = -1;
  openAutoFilters();
}
function resetAuto() {
  endAutoFx({ restart: true }); S.auto.log = "";
}
function paintBar() {
  const e = q("#lpBar"); if (!e) return;
  e.textContent = S.running && S.bar >= 0 ? T("Takt ", "Bar ") + (S.bar + 1) + " · " + (Math.floor(Math.max(0, S.step) % 16 / 4) + 1) : T("steht", "stopped");
}
function paintPos() {
  paintBar();
  for (const g of S.set.gens) {
    const bar = q(`#lpCard-${g.id} .lp-prog i`); if (!bar) continue;
    const st = S.states.get(g.id), len = (g.kind === "seed" && g.seedKey ? g.seedKey.bars : g.kind === "audio" && g.loopBars ? g.loopBars : g.p.bars || 1) * SPB;
    const sb = st && st.on && st.startBar != null ? st.startBar : 0;
    const x = st && st.on ? (((S.step - sb * SPB) % len) + len) % len / len : 0;
    bar.style.transform = `scaleX(${x})`;
  }
}

function soundSelect(g) {
  if (g.kind === "beat") {
    const s = h("select", { class: "lp-sound", "aria-label": T("Kit", "Kit") }, Object.entries(KITS).map(([k, kt]) => h("option", { value: k, selected: k === g.kit }, EN ? kt.en : kt.de)));
    s.onchange = () => setSound(g, s.value); return s;
  }
  const s = h("select", { class: "lp-sound", "aria-label": T("Klang", "Sound") },
    MODEL_GROUPS.filter(([gr]) => gr !== "drums").map(([gr, de, en]) => h("optgroup", { label: EN ? en : de },
      MODELS.filter(m => m.g === gr).flatMap(m => PRESETS.filter(p => p.model === m.id).map(p => h("option", { value: presetKey(p), selected: presetKey(p) === g.preset }, (EN ? m.en : m.de).split(" · ")[0] + " — " + (EN ? p.en : p.de)))))));
  s.onchange = () => setSound(g, s.value); return s;
}
function renderCards() {
  const el = q("#lpCards"); if (!el) return;
  el.innerHTML = "";
  if (!S.set.gens.length) el.append(h("p", { class: "sub lp-empty", text: T("Noch kein Generator — oben einen hinzufügen, 🎲 drücken oder 🎤 einsingen.", "No generator yet — add one above, press 🎲, or sing into 🎤.") }));
  for (const g of S.set.gens) el.append(card(g));
  paintCards();
}
function card(g) {
  const k = KIND[g.kind];
  const c = h("section", { id: "lpCard-" + g.id, class: "lp-card" + (S.sel === g.id ? " sel" : ""), style: `--knob:${g.color};--gc:${g.color}`, "data-kind": g.kind,
    onpointerdown: (e) => { if (S.sel !== g.id && !e.target.closest("select,input")) { S.sel = g.id; qa(".lp-card").forEach(x => x.classList.toggle("sel", x.id === "lpCard-" + g.id)); renderKeys(); } } });
  const name = h("input", { type: "text", class: "lp-gname", value: g.name, maxlength: "40", "aria-label": T("Name", "Name") });
  name.onchange = () => { g.name = name.value.trim().slice(0, 40) || T(k.de, k.en); changed(); };
  const play = h("button", { type: "button", class: "lp-go", "data-go": g.id, title: T("Start / Stopp (am Takt) — Doppelklick: sofort", "Start / stop (on the bar) — double-click: now"),
    onclick: () => toggleGen(g), ondblclick: () => { if (genOn(g)) stopGen(g, true); else startGen(g, true); } });
  c.append(h("header", { class: "lp-chead" }, play, h("span", { class: "lp-icon", text: k.icon }), name,
    h("button", { type: "button", class: "ghost btn-s lp-mute" + (g.mute ? " on" : ""), title: T("Stumm (läuft weiter)", "Mute (keeps running)"), text: "M", onclick: (e) => { g.mute = !g.mute; e.target.classList.toggle("on", g.mute); applyFx(g); changed(); } }),
    h("button", { type: "button", class: "ghost btn-s lp-solo" + (g.solo ? " on" : ""), title: T("Solo", "Solo"), text: "S", onclick: (e) => { g.solo = !g.solo; e.target.classList.toggle("on", g.solo); for (const x of S.set.gens) applyFx(x); changed(); } }),
    h("button", { type: "button", class: "ghost btn-s lp-x", title: T("Generator entfernen", "Remove generator"), text: "✕", onclick: () => { if (confirm(T(`„${g.name}“ entfernen?`, `Remove “${g.name}”?`))) removeGen(g); } })));
  c.append(h("div", { class: "lp-prog", "aria-hidden": "true" }, h("i"), h("canvas", { class: "lp-gmeter", width: 120, height: 4 })));
  c.append(h("p", { class: "sub small lp-hint", text: T(k.hd, k.he) }));
  // Klangquelle
  if (g.kind === "beat" || k.ins) {
    const row = h("div", { class: "lp-row" }, soundSelect(g));
    if (k.ins) row.append(h("button", { type: "button", class: "ghost btn-s", title: T("Alle Regler dieses Klangs", "All controls of this sound"), text: T("🎛 Klang", "🎛 Sound"),
      onclick: () => { g.openSynth = !g.openSynth; renderSynth(g, c); } }));
    c.append(row);
  }
  // eigene Knöpfe je Art
  if (g.kind === "seed") {
    const info = h("span", { class: "sub small lp-seedinfo" });
    c.append(h("div", { class: "lp-row" },
      h("button", { type: "button", class: "primary btn-s lp-recbtn", "data-rec": g.id, text: T("● Einspielen", "● Record"), title: T("Nach einem Takt Einzählen spielst du die Takte ein — danach spielt die Maschine sie und spinnt weiter", "After a one-bar count-in you play the bars — then the machine plays them and spins them on"), onclick: () => recSeed(g) }),
      h("button", { type: "button", class: "ghost btn-s", text: T("🪄 Rest übernehmen", "🪄 Take over the rest"), title: T("Tonart aus deinen Noten, dann Beat, Bass und Akkorde in der gewählten Richtung dazu", "Key from your notes, then beat, bass and chords in the chosen style"), onclick: () => { if (!(g.seed && g.seed.length)) { status(T("Erst einspielen.", "Record first.")); return; } takeOver(g); } }),
      info));
  }
  if (g.kind === "audio") {
    c.append(h("div", { class: "lp-row" },
      h("button", { type: "button", class: "ghost btn-s lp-micbtn", text: S.mic ? "🎤 ✓" : T("🎤 Freigeben", "🎤 Allow"), title: S.mic ? S.mic.name : T("Mikrofon freigeben", "Allow the microphone"), onclick: () => micOn() }),
      h("button", { type: "button", class: "primary btn-s lp-recbtn", "data-rec": g.id, text: T("● Aufnehmen", "● Record"), onclick: () => recAudio(g, false) }),
      h("button", { type: "button", class: "ghost btn-s", "data-od": g.id, text: T("＋ Overdub", "＋ Overdub"), title: T("Eine weitere Schicht darüber", "Another layer on top"), onclick: () => { if (!g.nLayers) { status(T("Erst aufnehmen.", "Record first.")); return; } recAudio(g, true); } }),
      h("button", { type: "button", class: "ghost btn-s", text: "↶", title: T("Letzte Schicht weg", "Remove the last layer"), onclick: async () => { const ls = await loadLayers(g); if (!ls.length) return; ls.pop(); post({ t: "undolayer", id: g.id }); g.nLayers = ls.length; await saveLayers(g, ls); paintCard(g); } }),
      h("button", { type: "button", class: "ghost btn-s", text: T("🎼 In Noten", "🎼 To notes"), title: T("Die gesungene/gespielte Melodie heraushören — ein Synth spielt sie und die Maschine spinnt weiter", "Hear out the sung/played melody — a synth plays it and the machine spins it on"), onclick: () => micToSeed(g) }),
      h("button", { type: "button", class: "ghost btn-s", text: T("🪄 Rest übernehmen", "🪄 Take over the rest"), onclick: () => { if (!g.nLayers) { status(T("Erst aufnehmen.", "Record first.")); return; } takeOver(g); } }),
      h("label", { class: "lp-mon" }, h("input", { type: "checkbox", onchange: (e) => { if (S.mic) S.mic.mon.gain.value = e.target.checked ? 1 : 0; } }), T(" mithören", " monitor")),
      h("canvas", { class: "lp-micmeter", width: 60, height: 6, "aria-hidden": "true" }), scopeCv("mic:in", { title: T("Oszillogramm des Mikrofons", "Oscilloscope of the microphone") }),
      h("span", { class: "sub small lp-layers" })));
  }
  // Auswahlfelder zuerst in einer Zeile, darunter die Regler
  const sels = k.p.filter(p => p.t !== "knob"), kn = k.p.filter(p => p.t === "knob");
  const gp = h("div", { class: "lp-gen" });
  if (sels.length) { const r = h("div", { class: "lp-sels" }); for (const p of sels) r.append(control(g, p, false)); gp.append(r); }
  const kr = h("div", { class: "lp-knobs" }); for (const p of kn) kr.append(control(g, p, false)); gp.append(kr);
  c.append(h("h4", { class: "lp-h4" }, h("span", { text: T("Generator", "Generator") }), scopeCv(g.id + ":src"),
    g.kind === "osc" ? scopeCv(g.id + ":lfo", { cls: "lfo", title: T("LFO — sein Ausschlag über die letzten Sekunden", "LFO — its swing over the last seconds") }) : null), gp);
  const fx = h("div", { class: "lp-fx" });
  for (const [id, de, en, keys] of FX_GROUPS) {
    const grp = h("div", { class: "lp-group", "data-g": id }, h("div", { class: "lp-gcapr" }, h("span", { class: "lp-gcap", text: T(de, en) }), scopeCv(g.id + ":" + id)));
    const row = h("div", { class: "lp-knobs" }); for (const key of keys) row.append(control(g, FX.find(p => p.k === key), true)); grp.append(row); fx.append(grp);
  }
  c.append(h("h4", { text: T("Klang live", "Live sound") }), fx);
  c.append(h("div", { class: "lp-synth" }));
  if (g.openSynth) renderSynth(g, c);
  markIdle(c, (pk) => loopIdle(g, pk), EN);
  return c;
}
// Alle Regler des gewählten Instruments (wie in "Selber machen")
function renderSynth(g, c) {
  const box = q(".lp-synth", c); if (!box) return;
  box.innerHTML = "";
  if (!g.openSynth || !g.patch) return;
  box.append(h("h4", { class: "lp-h4" }, h("span", { text: T("Klang des Instruments", "Instrument sound") }), scopeCv(g.id + ":src")));
  for (const sec of SCHEMA[g.patch.engine] || []) {
    const row = h("div", { class: "lp-knobs" });
    for (const p of sec.p) {
      const cb = (v) => withFix(g, "s:" + p.k, () => { g.patch[p.k] = v; post({ t: "param", id: g.id, k: p.k, v }); changed(); });
      const el = p.t === "knob" ? knob(p, g.patch[p.k] ?? p.def, cb) : p.t === "sel" ? selectBox(p, g.patch[p.k] ?? p.def, cb) : toggle(p, g.patch[p.k] ?? p.def, cb);
      el.dataset.pk = "s:" + p.k; row.append(el);
    }
    box.append(h("h4", { text: EN ? sec.en : sec.de }), row);
  }
  markCard(g);
}
function paintCards() { for (const g of S.set.gens) paintCard(g); }
function paintCard(g) {
  if (!g) return;
  const c = q("#lpCard-" + g.id); if (!c) return;
  const on = genOn(g), pend = genPending(g);
  const b = q(".lp-go", c);
  b.textContent = on ? "■" : "▶︎";
  b.classList.toggle("on", on); b.classList.toggle("wait", !!pend);
  c.classList.toggle("on", on); c.classList.toggle("wait", !!pend);
  b.setAttribute("aria-label", (on ? T("Stoppen", "Stop") : T("Starten", "Start")) + " " + g.name);
  const arm = S.recArm && S.recArm.id === g.id;
  const rb = q(".lp-recbtn", c); if (rb) { rb.classList.toggle("armed", !!arm); rb.classList.toggle("going", !!(arm && arm.go)); }
  if (g.kind === "seed") { const i = q(".lp-seedinfo", c); if (i) i.textContent = arm ? T("Einzählen …", "Count-in …") : g.seed ? T(`${g.seed.length} Noten · ${g.seedKey ? g.seedKey.bars : g.p.bars} Takte`, `${g.seed.length} notes · ${g.seedKey ? g.seedKey.bars : g.p.bars} bars`) : T("noch leer", "empty"); }
  if (g.kind === "audio") {
    const i = q(".lp-layers", c); if (i) i.textContent = arm ? (arm.go ? T("nimmt auf …", "recording …") : T("Einzählen …", "count-in …")) : g.nLayers ? T(`${g.nLayers} Schicht${g.nLayers > 1 ? "en" : ""} · ${g.loopBars} Takte`, `${g.nLayers} layer${g.nLayers > 1 ? "s" : ""} · ${g.loopBars} bars`) : T("noch leer", "empty");
    const m = q(".lp-micbtn", c); if (m) m.textContent = S.mic ? "🎤 ✓" : T("🎤 Freigeben", "🎤 Allow");
  }
}
function paintRecBar() { /* Fortschritt steht im Takt-Balken der Karte */ }

// ---- Tastatur am Bildschirm (2 Oktaven) ----
function renderKeys() {
  const el = q("#lpKeys"); if (!el) return;
  el.innerHTML = "";
  const g = playTarget();
  // 3.17.1: so viele Oktaven, wie die Breite hergibt (die Tastatur liegt unten über die ganze Breite), mittig um C4
  const w = el.clientWidth || (q("#loopView") || el).clientWidth || 800, octs = w >= 1600 ? 5 : w >= 1150 ? 4 : w >= 760 ? 3 : 2;
  const lo = 60 + S.octave * 12 - Math.floor((octs - 1) / 2) * 12;
  S.kbOcts = octs;
  el.classList.toggle("small", !!S.kbSmall);
  const whites = octs * 7 + 1, kb = h("div", { class: "lp-kb", style: `--bw:${(58 / whites).toFixed(3)}%` });   // schwarze Taste ≈ 0,58 × weiße
  for (let n = lo; n < lo + octs * 12 + 1; n++) {
    const blk = [1, 3, 6, 8, 10].includes(n % 12);
    const k = h("button", { type: "button", class: "lp-key" + (blk ? " blk" : ""), "data-n": n, "aria-label": ROOTS[n % 12] + (Math.floor(n / 12) - 1) });
    let held = null;
    k.addEventListener("pointerdown", async (e) => { e.preventDefault(); try { k.setPointerCapture(e.pointerId); } catch (x) { /* kein aktiver Zeiger */ } held = await noteOn(n, S.vel); });
    const up = () => { if (held !== null) { noteOff(n, held); held = null; } };
    k.addEventListener("pointerup", up); k.addEventListener("pointercancel", up); k.addEventListener("lostpointercapture", up);
    kb.append(k);
  }
  el.append(h("div", { class: "lp-kbhead" }, h("span", { class: "sb-cap", text: T("Spielen", "Play") }),
    h("span", { class: "sub small", text: g ? T("→ ", "→ ") + g.name + (g.kind === "seed" ? T(" (● nimmt auf)", " (● records)") : "") : T("kein spielbarer Generator", "no playable generator") }),
    h("span", { class: "sub small", text: T(`Oktave ${S.octave >= 0 ? "+" : ""}${S.octave} (Y/X)`, `Octave ${S.octave >= 0 ? "+" : ""}${S.octave} (Z/X)`) }),
    h("button", { id: "lpKbFold", type: "button", class: "ghost btn-s lp-kbfold", "aria-expanded": String(!S.kbSmall), title: T("Tastatur ein-/ausklappen (sie bleibt unten)", "Fold/unfold the keyboard (it stays at the bottom)"),
      text: S.kbSmall ? "▴" : "▾", onclick: () => { S.kbSmall = !S.kbSmall; lsSet(LS_KB, S.kbSmall); renderKeys(); } })), kb);
}
function paintKey(n, on) { const k = q(`.lp-key[data-n="${n}"]`); if (k) k.classList.toggle("down", on); }

// =====================================================================================================
// 3.17.1: Oszillogramme — überall, wo es etwas zu regeln gibt: das Signal genau an dieser Stelle der Kette
// =====================================================================================================
const scopeSeen = typeof IntersectionObserver === "function" ? new IntersectionObserver((es) => { for (const e of es) e.target._vis = e.isIntersecting; }) : null;
function scopeCv(key, opts = {}) {
  const cv = h("canvas", { class: "lp-scope" + (opts.cls ? " " + opts.cls : ""), "data-sc": key, width: 1, height: 1, "aria-hidden": "true",
    title: opts.title || T("Oszillogramm: das Signal an dieser Stelle", "Oscilloscope: the signal at this point") });
  if (scopeSeen) scopeSeen.observe(cv);
  return cv;
}
// Welle zeichnen: Spalten mit Min/Max (wie ein echtes Oszilloskop, Rauschen wird zur Fläche), Start am steigenden Nulldurchgang
function drawWave(x, buf, W, H, scale, color, len) {
  let st = 0;
  for (let i = 1; i < buf.length - len; i++) if (buf[i - 1] < 0 && buf[i] >= 0) { st = i; break; }
  const per = len / W, mid = H / 2;
  x.strokeStyle = color; x.lineWidth = Math.max(1, H / 22); x.beginPath();
  for (let c = 0; c < W; c++) {
    let lo = 1, hi = -1; const a = st + Math.floor(c * per), b = Math.max(a + 1, st + Math.floor((c + 1) * per));
    for (let i = a; i < b; i++) { const v = buf[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    const y1 = mid - clamp(hi * scale, -1, 1) * mid * 0.92, y2 = mid - clamp(lo * scale, -1, 1) * mid * 0.92;
    if (c === 0) x.moveTo(c + 0.5, y1); else x.lineTo(c + 0.5, y1);
    if (y2 - y1 > 1) x.lineTo(c + 0.5, y2);
  }
  x.stroke();
}
function drawScopes() {
  const dpr = Math.min(2, window.devicePixelRatio || 1), buf = S.scBuf || (S.scBuf = new Float32Array(SCOPE_N));
  for (const cv of qa(".lp-scope")) {
    if (cv._vis === false || !cv.isConnected) continue;
    const W = Math.round(cv.clientWidth * dpr), H = Math.round(cv.clientHeight * dpr); if (!W || !H) continue;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const x = cv.getContext("2d"); x.clearRect(0, 0, W, H);
    x.strokeStyle = "rgba(140,150,190,.18)"; x.lineWidth = 1; x.beginPath(); x.moveTo(0, H / 2 + 0.5); x.lineTo(W, H / 2 + 0.5); x.stroke();
    const [id, what] = cv.dataset.sc.split(":");
    if (id === "master") { if (S.g) { S.g.an.getFloatTimeDomainData(S.g.anBuf); drawWave(x, S.g.anBuf, W, H, 1.6, "#22e3c3", 512); } continue; }
    if (id === "mic") { if (S.mic) { S.mic.an.getFloatTimeDomainData(S.mic.buf); drawWave(x, S.mic.buf, W, H, 2.5, "#ff4d94", 256); } continue; }
    const g = genById(id), ch = S.chains.get(id); if (!g || !ch) continue;
    if (what === "lfo") {
      const hs = S.lfoHist && S.lfoHist[id]; if (!hs || !hs.length) continue;
      x.strokeStyle = g.color; x.lineWidth = Math.max(1, H / 18); x.beginPath();
      for (let i = 0; i < hs.length; i++) { const px = W - (hs.length - 1 - i) * (W / 119), py = H / 2 - hs[i] * H * 0.42; if (i) x.lineTo(px, py); else x.moveTo(px, py); }
      x.stroke(); continue;
    }
    if (what === "mix") {                              // Kanal: links und rechts (Panorama sichtbar), feste Skala (Lautstärke sichtbar)
      ch.sc.L.getFloatTimeDomainData(buf); drawWave(x, buf, W, H, 2.2, g.color, 1024);
      ch.sc.R.getFloatTimeDomainData(buf); x.globalAlpha = 0.55; drawWave(x, buf, W, H, 2.2, "#e8ecff", 1024); x.globalAlpha = 1; continue;
    }
    const an = ch.sc[{ src: "src", filter: "filt", tone: "tone", space: "space" }[what]]; if (!an) continue;
    an.getFloatTimeDomainData(buf);
    let pk = 0; for (let i = 0; i < SCOPE_N; i += 2) { const v = Math.abs(buf[i]); if (v > pk) pk = v; }
    cv._pk = Math.max(pk, (cv._pk || 0) * 0.94);      // Form zählt hier, nicht der Pegel: sanft nachgeführte Verstärkung
    if (cv._pk < 2e-4) continue;
    drawWave(x, buf, W, H, 0.9 / Math.max(cv._pk, 0.004), g.color, 1024);
  }
}

// =====================================================================================================
// 3.17.1: Was gerade klingt, steht an den Reglern — Wobble, Autopilot-Filter, Oszillator (Einrasten, Gleiten, Drift, LFO, Tor)
// =====================================================================================================
function liveTick() {
  if (!S.g || !S.set) return;
  const kn = (key) => { const e = q(`[data-lk="${key}"]`); return e && e.setLive ? e : null; };
  for (const g of S.set.gens) {
    const ch = S.chains.get(g.id); if (!ch) continue;
    const on = genOn(g), k = kn(`${g.id}:fx:cut`);
    if (k) {
      let lv = null;
      if (on && SYNC_STEPS[g.fx.wob] && g.fx.wdepth > 0) { ch.wobAn.getFloatTimeDomainData(ch.wobBuf); lv = clamp(g.fx.cut * Math.pow(2, ch.wobBuf[ch.wobBuf.length - 1] / 1200), 40, 20000); }
      k.setLive(lv);
    }
    if (g.kind !== "osc") continue;
    const L = on && S.live ? S.live[g.id] : null;
    for (const [key, i] of [["freq", 0], ["pw", 1], ["fma", 2], ["level", 3]]) { const e = kn(`${g.id}:p:${key}`); if (e) e.setLive(L ? L[i] : null); }
    const pe = kn(`${g.id}:fx:pan`); if (pe) pe.setLive(L && L[4] ? clamp(g.fx.pan + L[4], -1, 1) : null);
    const hs = (S.lfoHist || (S.lfoHist = {}))[g.id] || (S.lfoHist[g.id] = []);
    hs.push(L && g.p.ldest !== "off" ? L[5] : 0); if (hs.length > 120) hs.shift();
  }
  // Autopilot-Filter (Breakdown zu, Steigerung Hochpass) auf dem DJ-Filter-Regler: links = Tiefpass, rechts = Hochpass
  const dk = kn("master:dj");
  if (dk) {
    const lp = S.g.apLP.frequency.value, hp = S.g.apHP.frequency.value, dj = S.set.master.dj;
    let lv = null;
    if (hp > 11) lv = clamp(Math.log(hp / 10) / Math.log(300), 0, 1);
    else if (lp < 19500) lv = -clamp(Math.log(lp / 20000) / Math.log(150 / 20000), 0, 1);
    if (lv != null && Math.sign(lv) === Math.sign(dj) && Math.abs(dj) > Math.abs(lv)) lv = dj;
    dk.setLive(lv);
  }
}

// =====================================================================================================
// 3.17.1: Auto-Mix — misst 2 Takte lang, wie laut jeder Generator wirklich ist (vor dem Fader, gehörgerecht),
// und stellt die Lautstärke auf einen Zielpegel je Rolle und Richtung. Beat und Bass tragen, Flächen liegen darunter.
// =====================================================================================================
const MIX_TARGET = { beat: -17, bass: -19, chords: -26, arp: -27, melody: -22, seed: -22, osc: -27, audio: -18 };
const MIX_STYLE = { ambient: { beat: -6, chords: 4, osc: 4, arp: 2 }, lofi: { beat: -2, chords: 2 }, techno: { beat: 1, bass: 1, chords: -2 }, house: { beat: 1 },
  trap: { bass: 2, beat: 1 }, hiphop: { bass: 1, beat: 1 }, dnb: { beat: 1, bass: 1 }, synthwave: { chords: 1, arp: 1 }, disco: { bass: 1 }, pop: { melody: 1 } };
const mixTarget = (g) => (MIX_TARGET[g.kind] ?? -24) + ((MIX_STYLE[S.set.style] || {})[g.kind] || 0);
function autoMix({ ids = null, manual = false } = {}) {
  if (!S.g || !S.set) return;
  if (manual && !S.set.gens.some(genOn) && !S.set.gens.some(genPending)) { status(T("Erst Generatoren starten — der Auto-Mix hört dem zu, was läuft.", "Start some generators first — the auto mix listens to what is playing.")); return; }
  const want = S.set.gens.filter(g => (!ids || ids.includes(g.id)) && (manual || !g.volHand)).map(g => g.id);
  if (!want.length) return;
  if (manual) for (const g of S.set.gens) if (want.includes(g.id)) g.volHand = false;
  if (S.mix && !manual) { for (const id of want) if (!S.mix.ids.includes(id)) S.mix.ids.push(id); return; }
  S.mix = { ids: want, phase: "wait", acc: {}, waited: 0 };
  status(T("🎚 Auto-Mix hört 2 Takte zu …", "🎚 Auto mix is listening for 2 bars …")); paintTransport();
}
function mixBar(d) {
  const M = S.mix; if (!M) return;
  if (M.phase === "wait") {
    if (M.ids.some(id => { const g = genById(id); return g && genOn(g); })) { M.phase = "listen"; M.from = d.bar; M.acc = {}; }
    else if (++M.waited > 8) { S.mix = null; paintTransport(); }
    return;
  }
  if (d.bar - M.from >= 2) finishMix();
}
function mixMeasure() {
  const M = S.mix; if (!M || M.phase !== "listen") return;
  const buf = S.mixBuf || (S.mixBuf = new Float32Array(SCOPE_N));
  for (const id of M.ids) {
    const g = genById(id), ch = S.chains.get(id); if (!g || !ch || !genOn(g)) continue;
    ch.kAn.getFloatTimeDomainData(buf); let ss = 0; for (let i = 0; i < SCOPE_N; i++) ss += buf[i] * buf[i];
    const pw = ss / SCOPE_N; if (pw > 1e-7) (M.acc[id] || (M.acc[id] = [])).push(pw);
  }
}
function finishMix() {
  const M = S.mix; S.mix = null; const done = [];
  for (const id of M.ids) {
    const g = genById(id), a = M.acc[id]; if (!g || !a || a.length < 12) continue;
    a.sort((x, y) => y - x);
    const top = a.slice(0, Math.max(1, Math.round(a.length * 0.25)));     // 3.17.2: lauteste 25 % (aktiver Pegel) — mit 60 % maß der Auto-Mix kurze Stabs 8 dB zu leise und drehte sie an den Anschlag
    const L = 10 * Math.log10(top.reduce((x, y) => x + y, 0) / top.length);
    const v = clamp(Math.round((mixTarget(g) - L) * 2) / 2, -40, 6);
    g.mixL = Math.round(L * 10) / 10; g.fx.vol = v; applyFx(g, false, true);
    const k = q(`[data-lk="${g.id}:fx:vol"]`); if (k && k.glideTo) k.glideTo(v); else if (k && k.setValue) k.setValue(v);
    done.push(`${g.name} ${v > 0 ? "+" : ""}${String(v).replace(".", EN ? "." : ",")} dB`);
  }
  if (done.length) {
    changed();
    const e = q("#lpMsg"), prev = e ? e.textContent : "", msg = T("🎚 Ausgemischt: ", "🎚 Mixed: ") + done.join(" · ");
    status(prev && !prev.startsWith("🎚") && Date.now() - (S.msgAt || 0) < 12000 ? prev + " — " + msg : msg);
  }
  paintTransport();
}

// ---- Pegel ----
function meterLoop() {
  if (S.meterOn) return; S.meterOn = true;
  let fr = 0;
  const tick = () => {
    if (!S.g) { S.meterOn = false; return; }
    if (tabVisible()) {
      liveTick(); mixMeasure(); if (++fr % 2 === 0) drawScopes();
      const cv = q("#lpMeter");
      if (cv) { S.g.an.getFloatTimeDomainData(S.g.anBuf); let pk = 0; for (const v of S.g.anBuf) pk = Math.max(pk, Math.abs(v));
        const x = cv.getContext("2d"), H = cv.height, db = 20 * Math.log10(pk + 1e-9), f = clamp((db + 48) / 48, 0, 1);
        x.clearRect(0, 0, cv.width, H); x.fillStyle = db > -2 ? "#ff4d94" : db > -9 ? "#ffb347" : "#22e3c3"; x.fillRect(2, H * (1 - f), cv.width - 4, H * f); }
      for (const g of S.set.gens) {
        const ch = S.chains.get(g.id), cvs = q(`#lpCard-${g.id} .lp-gmeter`); if (!ch || !cvs) continue;
        ch.an.getFloatTimeDomainData(ch.buf); let ss = 0; for (const v of ch.buf) ss += v * v;
        const db = 10 * Math.log10(ss / ch.buf.length + 1e-12), f = clamp((db + 54) / 54, 0, 1), x = cvs.getContext("2d");
        x.clearRect(0, 0, cvs.width, cvs.height); x.fillStyle = g.color; x.fillRect(0, 0, cvs.width * f, cvs.height);
      }
      if (S.mic) { const cvs = q(".lp-micmeter"); if (cvs) { S.mic.an.getFloatTimeDomainData(S.mic.buf); let pk = 0; for (const v of S.mic.buf) pk = Math.max(pk, Math.abs(v));
        const f = clamp((20 * Math.log10(pk + 1e-9) + 50) / 50, 0, 1), x = cvs.getContext("2d"); x.clearRect(0, 0, cvs.width, cvs.height); x.fillStyle = pk > 0.9 ? "#ff4d94" : "#22e3c3"; x.fillRect(0, 0, cvs.width * f, cvs.height); } }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// =====================================================================================================
// Start
// =====================================================================================================
async function init() {
  if (S.ready) return; S.ready = true;
  S.map = lsGet(LS_MAP, {}) || {}; S.kbSmall = !!lsGet(LS_KB, false);
  let s = null; const last = lsGet(LS_LAST, null);
  try { if (last) s = await dbGet("sets", last); if (!s) { const all = await dbAll("sets"); all.sort((a, b) => (b.changed || 0) - (a.changed || 0)); s = all[0]; } } catch (e) { /* kein IndexedDB */ }
  S.set = s ? fixSet(s) : demoSet();
  shell();
  await afterLoad();
  document.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("resize", () => { clearTimeout(S.kbT); S.kbT = setTimeout(() => { const v = q("#loopView"); if (!v || v.classList.contains("hidden")) return;
    const w = q("#lpKeys").clientWidth, octs = w >= 1600 ? 5 : w >= 1150 ? 4 : w >= 760 ? 3 : 2; if (octs !== S.kbOcts) renderKeys(); }, 200); });
  document.addEventListener("keyup", onKeyUp, true);
  document.addEventListener("visibilitychange", () => { if (document.hidden) for (const [code, x] of [...S.kbDown]) { S.kbDown.delete(code); noteOff(x.n, x.nn); } });
  initMidi();
}
export function showLoops(on) {
  const app = document.getElementById("app"); if (app) app.classList.toggle("lp-wide", !!on);
  if (on) init();
  else for (const [code, x] of [...S.kbDown]) { S.kbDown.delete(code); noteOff(x.n, x.nn); }
}
if (tabVisible()) showLoops(true);
window.mwsLoops = { show: showLoops, state: S, startAll, stopAll, addGen: (k, o) => addGen(k, o), takeOver, surprise, yinNotes, detectKey, autoMix, mixTarget, running: () => S.set && S.set.gens.some(genOn) };
