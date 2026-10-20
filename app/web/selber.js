// Manuwave Studio 3.15 — Tab "🎹 Selber machen": Synthesizer, Drum-Machine, Loops, Song, MIDI-Keyboard.
//
// Aufbau: der Klang entsteht in EINEM AudioWorklet (selber-engine.js) — Sequencer, Instrumente, Drums, im Takt
// auch im Hintergrund. Hier im Hauptthread: Projekt, Speichern (IndexedDB "mws_selber"), Oberfläche, Effekte
// (Web Audio: EQ, Chorus, Hall, Echo, Limiter), MIDI und Computertastatur, und "Track erzeugen" (OfflineAudioContext
// → WAV → Bibliothek; der Mac veredelt ihn wie jeden Track, mit Herkunft "selbst eingespielt", nicht KI).
// Die Oberfläche ist zweisprachig aus sich heraus (T(de, en)) und steht unter translate="no" — der Laufzeit-Übersetzer
// fasst sie nicht an (Regel aus 3.12: eine Übersetzung ändert, was der Code zurückliest).
import { SCHEMA, PAD_PARAMS, DRUM_MODELS, GM_TO_PAD, KITS, MODELS, MODEL_GROUPS, PRESETS, defaults, demoProject, knobIdle, markIdle, showValue, fixText, knobWheel, keepAudioAlive } from "./selber-presets.js";

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
const LETTERS = "ABCDEFGH";
const MAX_TRACKS = 16, SPB = 16;
const COLORS = ["#ff4d94", "#22e3c3", "#7c5cff", "#ffb347", "#5cc8ff", "#b6f36a", "#ff7a59", "#e07cff", "#4dd6ff", "#ffd84d", "#8ef0c9", "#ff9ec7", "#a3a8ff", "#ffcf99", "#7fe3ff", "#d1ff8a"];
const LS_LAST = "mws_sb_last", LS_MAP = "mws_sb_midimap", LS_UI = "mws_sb_ui";
const NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "H"];
const NOTE_EN = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const noteName = (n) => (EN ? NOTE_EN : NOTE_NAMES)[n % 12] + (Math.floor(n / 12) - 1);
const model = (id) => MODELS.find(m => m.id === id) || MODELS[0];
// 3.16: Instrument-Menü in Gruppen (Grundmodelle, Klassiker, Drums); disabled(m) sperrt Einträge
const modelOptions = (sel, disabled = () => false) => MODEL_GROUPS.map(([g, de, en]) => h("optgroup", { label: EN ? en : de },
  MODELS.filter(m => m.g === g).map(m => h("option", { value: m.id, selected: m.id === sel, disabled: disabled(m) }, EN ? m.en : m.de))));
const KIT_ORDER = ["808", "909", "606", "cr78", "80s", "trap", "techno", "lofi"];
// Werks-Preset auf eine Spur legen (Klang + Chorus des Vorbilds, z. B. Juno)
function presetChorus(t, pr) { if (pr && pr.ch != null) { t.chorus = pr.ch; applyAllTracks(); } }
const dbGain = (db) => (db <= -60 ? 0 : Math.pow(10, db / 20));

const S = {
  project: null, sel: null, pat: "A", tab: "notes", pad: 0, ready: false, built: false,
  ctx: null, g: null, playing: false, songMode: false, rec: false, metro: false, countIn: true, quant: 1,
  step: -1, playPat: "A", songIdx: 0, queued: null,
  midi: null, inputs: [], learn: false, learnTarget: null, map: {}, octave: 0, vel: 0.85, held: new Map(),
  undo: [], redo: [], saveT: 0, saved: 0, grid: 1, len: 2, noteSel: null, pr: { lo: 24, hi: 108 },
};

// =====================================================================================================
// Speichern: eigene IndexedDB (die Bibliothek der App bleibt unberührt)
// =====================================================================================================
let _db = null;
function db() {
  if (_db) return _db;
  _db = new Promise((res, rej) => {
    let r;
    try { r = indexedDB.open("mws_selber", 1); } catch (e) { rej(e); return; }
    r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains("projects")) d.createObjectStore("projects", { keyPath: "id" });
      if (!d.objectStoreNames.contains("presets")) d.createObjectStore("presets", { keyPath: "id" }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return _db;
}
async function dbDo(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => { const tx = d.transaction(store, mode); const st = tx.objectStore(store); let out; const r = fn(st);
    if (r) r.onsuccess = () => { out = r.result; }; tx.oncomplete = () => res(out); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
}
const dbPut = (store, v) => dbDo(store, "readwrite", s => s.put(v));
const dbGet = (store, id) => dbDo(store, "readonly", s => s.get(id));
const dbAll = (store) => dbDo(store, "readonly", s => s.getAll());
const dbDel = (store, id) => dbDo(store, "readwrite", s => s.delete(id));
function lsGet(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* privates Fenster */ } }

function changed(what = "notes") {
  S.project.changed = Date.now();
  clearTimeout(S.saveT);
  setSaved(T("ungespeichert …", "unsaved …"));
  S.saveT = setTimeout(save, 700);
  if (what === "notes") syncPatterns();
}
async function save() {
  clearTimeout(S.saveT);
  try { await dbPut("projects", JSON.parse(JSON.stringify(S.project))); lsSet(LS_LAST, S.project.id); S.saved = Date.now();
    const t = new Date(); setSaved(T("gespeichert ", "saved ") + t.toLocaleTimeString(EN ? "en-GB" : "de-DE", { hour: "2-digit", minute: "2-digit" }) + " ✓"); }
  catch (e) { setSaved(T("Speichern nicht möglich (privates Fenster?) — „⬇︎ Datei“ sichert das Projekt.", "Can't save (private window?) — “⬇︎ File” backs up the project.")); }
}
function setSaved(t) { const e = q("#sbSaved"); if (e) e.textContent = t; }
// Rückgängig: Schnappschüsse von Pattern + Spuren
function snap() {
  S.undo.push(JSON.stringify({ patterns: S.project.patterns, tracks: S.project.tracks, song: S.project.song }));
  if (S.undo.length > 60) S.undo.shift();
  S.redo = [];
}
function undo(back = true) {
  const from = back ? S.undo : S.redo, to = back ? S.redo : S.undo;
  const x = from.pop(); if (!x) return;
  to.push(JSON.stringify({ patterns: S.project.patterns, tracks: S.project.tracks, song: S.project.song }));
  Object.assign(S.project, JSON.parse(x));
  if (!S.project.tracks.some(t => t.id === S.sel)) S.sel = (S.project.tracks[0] || {}).id;
  syncProject(); renderAll(); changed("none");
}

// =====================================================================================================
// Projekt
// =====================================================================================================
function newTrack(modelId, name) {
  const m = model(modelId);
  const used = new Set(S.project.tracks.map(t => t.color));
  return { id: uid(), kind: m.engine === "drums" ? "drums" : "synth", model: m.id, name: name || T(m.de, m.en), color: COLORS.find(c => !used.has(c)) || COLORS[0],
    patch: Object.assign(defaults(m.engine), (PRESETS.find(p => p.model === m.id) || {}).patch || {}), presetName: (PRESETS.find(p => p.model === m.id) || {})[EN ? "en" : "de"] || "",
    vol: -8, pan: 0, mute: false, solo: false, rev: 0.12, dly: 0, eq: { lo: 0, mid: 0, hi: 0 }, chorus: (PRESETS.find(p => p.model === m.id) || {}).ch || 0 };
}
function emptyProject() {
  const p = { v: 1, id: uid(), name: T("Neues Projekt", "New project"), bpm: 120, swing: 0.5, key: "", genre: "", tracks: [], patterns: { A: { bars: 4, notes: {} } },
    song: [{ p: "A", r: 4 }], fx: { revSize: 0.55, revDecay: 2.2, dlyTime: "3/16", dlyFb: 0.35, dlyTone: 0.5 }, master: { vol: 0 }, created: Date.now(), changed: Date.now() };
  S.project = p;
  p.tracks.push(newTrack("drums", "Drums"), newTrack("mono", T("Bass", "Bass")), newTrack("poly", T("Akkorde", "Chords")));
  return p;
}
function fixProject(p) {
  p.patterns = p.patterns || { A: { bars: 4, notes: {} } };
  for (const k of Object.keys(p.patterns)) { const P = p.patterns[k]; P.bars = clamp(Math.round(P.bars || 4), 1, 16); P.notes = P.notes || {}; }
  p.song = Array.isArray(p.song) ? p.song.filter(e => p.patterns[e.p]) : [];
  p.fx = Object.assign({ revSize: 0.55, revDecay: 2.2, dlyTime: "3/16", dlyFb: 0.35, dlyTone: 0.5 }, p.fx || {});
  p.master = Object.assign({ vol: 0 }, p.master || {});
  p.tracks = (p.tracks || []).slice(0, MAX_TRACKS).map(t => {
    const m = model(t.model);
    t.patch = Object.assign(defaults(m.engine), t.patch || {}); t.patch.engine = m.engine;
    t.eq = Object.assign({ lo: 0, mid: 0, hi: 0 }, t.eq || {});
    return t;
  });
  return p;
}
const curTrack = () => S.project.tracks.find(t => t.id === S.sel) || S.project.tracks[0];
const curPat = () => S.project.patterns[S.pat] || (S.project.patterns[S.pat] = { bars: 4, notes: {} });
const notesOf = (tid, pat = S.pat) => { const P = S.project.patterns[pat] || curPat(); return P.notes[tid] || (P.notes[tid] = []); };
const patSteps = (pat = S.pat) => ((S.project.patterns[pat] || {}).bars || 4) * SPB;

// =====================================================================================================
// Audio: Graph (live und offline derselbe)
// =====================================================================================================
const HEADROOM = 0.6;                         // −4,4 dB vor dem Limiter
const SYNC_STEPS = { "1/16": 1, "1/8": 2, "3/16": 3, "1/4": 4, "3/8": 6, "1/2": 8, "1/8T": 4 / 3, "1/4T": 8 / 3 };
function engineProject(p) {
  return { bpm: p.bpm, swing: p.swing, patterns: p.patterns, song: p.song,
    tracks: p.tracks.map(t => ({ id: t.id, kind: t.kind, patch: t.patch, mute: t.mute, solo: t.solo })) };
}
// Hall: Rauschen mit Abklingen, das Höhen über die Zeit verliert (wie ein Raum), dazu frühe Reflexionen
function makeIR(ctx, size, decay) {
  const sr = ctx.sampleRate, len = Math.floor(sr * clamp(decay, 0.3, 8)), pre = Math.floor(sr * (0.005 + size * 0.03));
  const buf = ctx.createBuffer(2, len + pre, sr);
  let seed = 12345;
  const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) / 4294967296) * 2 - 1; };
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr, env = Math.pow(10, -3 * t / decay);
      const k = 0.15 + 0.8 * Math.min(1, t / decay);              // später dunkler
      const x = rnd(); lp = lp + (x - lp) * (1 - k);
      d[pre + i] = lp * env * 0.35;
    }
    for (let e = 0; e < 7; e++) { const at = pre + Math.floor(sr * (0.004 + size * 0.012 * (e + 1) + (c ? 0.0017 : 0))); if (at < d.length) d[at] += (0.5 - e * 0.06) * (e % 2 ? -1 : 1); }
  }
  return buf;
}
function buildGraph(ctx, p, bounce) {
  const node = new AudioWorkletNode(ctx, "mws-engine", { numberOfInputs: 0, numberOfOutputs: 17, outputChannelCount: new Array(17).fill(2),
    processorOptions: { project: engineProject(p), bounce } });
  const master = ctx.createGain();
  master.gain.value = HEADROOM;               // Reserve: die Summe soll selten an den Limiter stoßen (sonst klingt es gequetscht)
  const mvol = ctx.createGain(); mvol.gain.value = dbGain(p.master.vol || 0);
  const limiter = new AudioWorkletNode(ctx, "mws-limiter", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { ceil: -1.5 } });
  master.connect(mvol); mvol.connect(limiter);
  const out = ctx.createGain(); limiter.connect(out); out.connect(ctx.destination);
  // Hall
  const revIn = ctx.createGain(), rev = ctx.createConvolver(), revOut = ctx.createGain();
  rev.normalize = false; rev.buffer = makeIR(ctx, p.fx.revSize, p.fx.revDecay); revOut.gain.value = 0.8;
  revIn.connect(rev); rev.connect(revOut); revOut.connect(master);
  // Echo (Ping-Pong) mit Ton-Filter in der Schleife
  const dlyIn = ctx.createGain(); dlyIn.channelCount = 1; dlyIn.channelCountMode = "explicit"; dlyIn.channelInterpretation = "speakers";
  const dL = ctx.createDelay(4), dR = ctx.createDelay(4), fbL = ctx.createGain(), fbR = ctx.createGain(), tone = ctx.createBiquadFilter(), merge = ctx.createChannelMerger(2), dlyOut = ctx.createGain();
  tone.type = "lowpass"; tone.Q.value = 0.5;
  dlyIn.connect(tone); tone.connect(dL); dL.connect(merge, 0, 0); dL.connect(fbL); fbL.connect(dR); dR.connect(merge, 0, 1); dR.connect(fbR); fbR.connect(tone);
  merge.connect(dlyOut); dlyOut.gain.value = 0.7; dlyOut.connect(master);
  const g = { ctx, node, master, mvol, limiter, out, revIn, rev, revOut, dlyIn, dL, dR, fbL, fbR, tone, chains: [], bounce: !!bounce };
  applyFx(g, p);
  buildChains(g, p);
  if (!bounce) {
    const metro = ctx.createGain(); metro.gain.value = 0.5; node.connect(metro, 16); metro.connect(ctx.destination); g.metro = metro;
    const an = ctx.createAnalyser(); an.fftSize = 1024; out.connect(an); g.an = an; g.anBuf = new Float32Array(1024);
  }
  return g;
}
function applyFx(g, p) {
  const fx = p.fx, steps = SYNC_STEPS[fx.dlyTime] || 3, t = clamp(steps * 60 / p.bpm / 4, 0.02, 3.9), now = g.ctx.currentTime;
  g.dL.delayTime.setTargetAtTime(t, now, 0.02); g.dR.delayTime.setTargetAtTime(t, now, 0.02);
  g.fbL.gain.setTargetAtTime(clamp(fx.dlyFb, 0, 0.9), now, 0.02); g.fbR.gain.setTargetAtTime(clamp(fx.dlyFb, 0, 0.9), now, 0.02);
  g.tone.frequency.setTargetAtTime(600 + Math.pow(fx.dlyTone, 2) * 11000, now, 0.02);
}
function buildChains(g, p) {
  for (const c of g.chains) c.dispose();
  g.chains = [];
  try { g.node.disconnect(); } catch (e) { /* noch nicht verbunden */ }
  if (g.metro) g.node.connect(g.metro, 16);
  p.tracks.forEach((t, i) => g.chains.push(makeChain(g, t, i)));
}
function makeChain(g, t, i) {
  const c = g.ctx;
  const inp = c.createGain(), lo = c.createBiquadFilter(), mid = c.createBiquadFilter(), hi = c.createBiquadFilter();
  lo.type = "lowshelf"; lo.frequency.value = 120; mid.type = "peaking"; mid.frequency.value = 1000; mid.Q.value = 0.8; hi.type = "highshelf"; hi.frequency.value = 6000;
  const dry = c.createGain(), wet = c.createGain(), d1 = c.createDelay(0.1), d2 = c.createDelay(0.1), p1 = c.createStereoPanner(), p2 = c.createStereoPanner();
  const lfo1 = c.createOscillator(), lfo2 = c.createOscillator(), lg1 = c.createGain(), lg2 = c.createGain();
  d1.delayTime.value = 0.012; d2.delayTime.value = 0.017; p1.pan.value = -0.7; p2.pan.value = 0.7;
  lfo1.frequency.value = 0.6; lfo2.frequency.value = 0.83; lg1.gain.value = 0.004; lg2.gain.value = 0.005;
  lfo1.connect(lg1); lg1.connect(d1.delayTime); lfo2.connect(lg2); lg2.connect(d2.delayTime); lfo1.start(); lfo2.start();
  const pan = c.createStereoPanner(), fader = c.createGain(), sRev = c.createGain(), sDly = c.createGain();
  g.node.connect(inp, i);
  inp.connect(lo); lo.connect(mid); mid.connect(hi);
  hi.connect(dry); dry.connect(pan);
  hi.connect(d1); hi.connect(d2); d1.connect(p1); d2.connect(p2); p1.connect(wet); p2.connect(wet); wet.connect(pan);
  pan.connect(fader); fader.connect(g.master); fader.connect(sRev); sRev.connect(g.revIn); fader.connect(sDly); sDly.connect(g.dlyIn);
  let an = null;
  if (!g.bounce) { an = c.createAnalyser(); an.fftSize = 256; fader.connect(an); }
  const ch = { id: t.id, fader, pan, lo, mid, hi, dry, wet, sRev, sDly, an, buf: an ? new Float32Array(256) : null,
    dispose() { try { inp.disconnect(); fader.disconnect(); lfo1.stop(); lfo2.stop(); } catch (e) { /* schon weg */ } } };
  applyTrack(ch, t, g, true);
  return ch;
}
function applyTrack(ch, t, g, now0) {
  const now = g.ctx.currentTime, tc = now0 ? 0.001 : 0.02;
  const anySolo = S.project.tracks.some(x => x.solo);
  const audible = !t.mute && (!anySolo || t.solo);
  ch.fader.gain.setTargetAtTime(audible ? dbGain(t.vol) : 0, now, tc);
  ch.pan.pan.setTargetAtTime(clamp(t.pan, -1, 1), now, tc);
  ch.lo.gain.setTargetAtTime(t.eq.lo, now, tc); ch.mid.gain.setTargetAtTime(t.eq.mid, now, tc); ch.hi.gain.setTargetAtTime(t.eq.hi, now, tc);
  const cm = clamp(t.chorus || 0, 0, 1);
  ch.dry.gain.setTargetAtTime(1 - cm * 0.35, now, tc); ch.wet.gain.setTargetAtTime(cm * 0.6, now, tc);
  ch.sRev.gain.setTargetAtTime(clamp(t.rev, 0, 1), now, tc); ch.sDly.gain.setTargetAtTime(clamp(t.dly, 0, 1), now, tc);
}
function applyAllTracks() { if (!S.g) return; S.g.chains.forEach((ch, i) => applyTrack(ch, S.project.tracks[i], S.g)); }
async function ensureAudio() {
  if (S.ctx && S.g) { if (S.ctx.state !== "running") { try { await S.ctx.resume(); } catch (e) { /* braucht eine Geste */ } } return true; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC || !window.AudioWorkletNode) { status(T("Dieser Browser kann keine Synthesizer (AudioWorklet fehlt).", "This browser can't run the synthesizers (no AudioWorklet).")); return false; }
  try {
    S.ctx = new AC({ latencyHint: "interactive", sampleRate: 48000 });
  } catch (e) { S.ctx = new AC({ latencyHint: "interactive" }); }
  try { await S.ctx.audioWorklet.addModule("selber-engine.js"); }
  catch (e) { status(T("Klangmotor nicht geladen: ", "Sound engine failed to load: ") + (e.message || e)); return false; }
  S.g = buildGraph(S.ctx, S.project, null);
  keepAudioAlive(S.ctx, () => !!S.playing);                  // 3.19: Safari setzt den Ton bei Rückfragen aus
  S.g.node.port.onmessage = (e) => onEngine(e.data);
  S.g.limiter.port.onmessage = (e) => { S.limit = e.data; };
  if (S.ctx.state !== "running") { try { await S.ctx.resume(); } catch (e) { /* */ } }
  meterLoop();
  return true;
}
const post = (m) => { if (S.g) S.g.node.port.postMessage(m); };
function syncProject() { post({ t: "project", p: engineProject(S.project) }); if (S.g) { buildChains(S.g, S.project); applyFx(S.g, S.project); } }
let patT = 0;
function syncPatterns() { clearTimeout(patT); patT = setTimeout(() => post({ t: "patterns", patterns: S.project.patterns, song: S.project.song }), 20); }
function onEngine(d) {
  if (d.t === "pos") {
    const was = S.playPat;
    S.step = d.step; if (d.pat) S.playPat = d.pat; if (d.songIdx != null) S.songIdx = d.songIdx;
    if (S.playPat !== was) renderPatterns();
    if (d.step < 0) return;
    if (S.queued && d.pat === S.queued) { S.queued = null; renderPatterns(); }
    if (S.songMode && d.pat && d.pat !== S.pat && S.follow) { S.pat = d.pat; renderPatterns(); renderEditor(); }
    paintPlayhead(); paintPos(); paintSongPos();
  } else if (d.t === "rec") {
    const P = S.project.patterns[d.pat]; if (!P) return;
    (P.notes[d.tr] || (P.notes[d.tr] = [])).push(d.note);
    S.project.changed = Date.now(); clearTimeout(S.saveT); S.saveT = setTimeout(save, 1200);
    syncPatterns();                       // der Motor bekommt dieselbe Fassung zurück (falls inzwischen woanders editiert wurde)
    if (d.pat === S.pat && d.tr === S.sel) paintEditor();
  }
}

// =====================================================================================================
// Transport
// =====================================================================================================
async function play(fromSong) {
  if (!(await ensureAudio())) return;
  if (S.playing) stop();
  S.songMode = !!fromSong && S.project.song.length > 0;
  S.follow = S.songMode;
  post({ t: "tempo", bpm: S.project.bpm, swing: S.project.swing });
  post({ t: "metro", on: S.metro });
  post({ t: "play", song: S.songMode, pat: S.pat, countIn: S.rec && S.countIn, loop: true });
  S.playing = true; renderTransport();
}
function stop() {
  post({ t: "stop" });
  if (S.rec) { S.rec = false; post({ t: "rec", on: false }); }
  S.playing = false; S.step = -1; S.queued = null; renderTransport(); paintPlayhead(); paintPos(); paintSongPos(); renderPatterns();
}
async function toggleRec() {
  if (!(await ensureAudio())) return;
  const t = curTrack(); if (!t) return;
  if (S.rec) { S.rec = false; post({ t: "rec", on: false }); renderTransport(); return; }
  snap();
  S.rec = true;
  post({ t: "rec", on: true, tr: t.id, q: S.quant });
  if (!S.playing) await play(false); else renderTransport();
}
function panic() { post({ t: "panic" }); S.held.clear(); paintKeys(); }

// =====================================================================================================
// Spielen: Tastatur am Bildschirm, Computertastatur, MIDI
// =====================================================================================================
async function noteOn(n, v = S.vel, src = "ui") {
  if (!(await ensureAudio())) return;
  const t = curTrack(); if (!t) return;
  let nn = n;
  if (t.kind === "drums") { nn = GM_TO_PAD[n] != null ? GM_TO_PAD[n] : (((n - 36) % 16) + 16) % 16; S.pad = nn; }
  S.held.set(n, nn);
  post({ t: "note", tr: t.id, n: nn, v: clamp(v, 0.02, 1), on: true });
  paintKeys();
  if (t.kind === "drums" && S.tab === "sound") renderPadPanel();
}
function noteOff(n) {
  const t = curTrack(); if (!t) return;
  const nn = S.held.has(n) ? S.held.get(n) : n;
  S.held.delete(n);
  if (t.kind !== "drums") post({ t: "note", tr: t.id, n: nn, on: false });
  paintKeys();
}
// Physische Tasten (event.code) → Halbton ab C — übliche Belegung (untere Buchstabenreihe weiß, obere schwarz)
const KEYMAP = { KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16, Quote: 17 };
const kbBase = () => 60 + S.octave * 12;
function typing(e) { const t = e.target; return t && (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.isContentEditable); }
function tabVisible() { const v = q("#selberView"); return v && !v.classList.contains("hidden"); }
function onKeyDown(e) {
  if (!tabVisible() || typing(e) || e.metaKey || e.ctrlKey && e.code !== "KeyZ") {
    if (tabVisible() && !typing(e) && (e.metaKey || e.ctrlKey) && e.code === "KeyZ") { e.preventDefault(); undo(!e.shiftKey); }
    return;
  }
  if (e.ctrlKey && e.code === "KeyZ") { e.preventDefault(); undo(!e.shiftKey); return; }
  if (e.code === "Space") { e.preventDefault(); e.stopImmediatePropagation(); S.playing ? stop() : play(S.songMode); return; }
  if (e.repeat) { if (KEYMAP[e.code] != null) e.preventDefault(); return; }
  if (e.code === "KeyZ") { S.octave = clamp(S.octave - 1, -4, 4); renderKbInfo(); e.preventDefault(); return; }
  if (e.code === "KeyX") { S.octave = clamp(S.octave + 1, -4, 4); renderKbInfo(); e.preventDefault(); return; }
  if (e.code === "KeyC") { S.vel = clamp(S.vel - 0.1, 0.1, 1); renderKbInfo(); return; }
  if (e.code === "KeyV") { S.vel = clamp(S.vel + 0.1, 0.1, 1); renderKbInfo(); return; }
  if ((e.code === "Delete" || e.code === "Backspace") && S.noteSel) { e.preventDefault(); deleteSelNote(); return; }
  const k = KEYMAP[e.code];
  if (k == null) return;
  e.preventDefault();
  const t = curTrack();
  const n = t && t.kind === "drums" ? 36 + k : kbBase() + k;
  S.kbDown = S.kbDown || new Map(); S.kbDown.set(e.code, n);
  noteOn(t && t.kind === "drums" ? padNote(k) : n, S.vel, "kb");
}
// Computertaste k → GM-Note des Pads k (damit das Pad stimmt)
const PADGM = [36, 38, 39, 42, 46, 41, 45, 48, 37, 56, 49, 51, 70, 63, 75, 54, 36, 38];
function padNote(k) { return PADGM[k] || 36; }
function onKeyUp(e) {
  if (!S.kbDown || !S.kbDown.has(e.code)) return;
  const n = S.kbDown.get(e.code); S.kbDown.delete(e.code);
  const t = curTrack();
  noteOff(t && t.kind === "drums" ? padNote(KEYMAP[e.code]) : n);
}
async function initMidi() {
  if (!navigator.requestMIDIAccess) { S.midiState = "none"; renderMidi(); return; }
  try {
    S.midi = await navigator.requestMIDIAccess({ sysex: false });
    S.midi.onstatechange = () => bindMidi();
    bindMidi();
  } catch (e) { S.midiState = "denied"; renderMidi(); }
}
function bindMidi() {
  S.inputs = [];
  for (const inp of S.midi.inputs.values()) {
    if (inp.state === "disconnected") continue;
    inp.onmidimessage = (ev) => onMidi(ev, inp);
    S.inputs.push(inp);
  }
  S.midiState = S.inputs.length ? "ok" : "nodev";
  renderMidi();
}
// Mackie-Transport (Keystation im DAW-Modus): nur vom zweiten Port, damit echte hohe Tasten nicht stoppen
const MACKIE = { 91: "back", 92: "fwd", 93: "stop", 94: "play", 95: "rec", 86: "loop" };
const isDawPort = (inp) => /mackie|daw|midiin ?2|port ?2|midi ?2|\b2\)?$/i.test(inp.name || "");
function onMidi(ev, inp) {
  if (window.mwsLoopsVisible && window.mwsLoopsVisible()) return;     // 3.17: in der Loop-Maschine spielt das Keyboard dort
  const [st, d1 = 0, d2 = 0] = ev.data; const type = st & 0xf0;
  S.lastMidi = Date.now(); flashMidi();
  // Lernen: die nächste Nachricht gehört dem gewählten Regler/Knopf
  if (S.learn && S.learnTarget && (type === 0xb0 || (type === 0x90 && d2 > 0 && S.learnTarget.spec.kind === "btn"))) {
    const key = (type === 0xb0 ? "cc" : "nt") + ":" + (st & 15) + ":" + d1;
    S.map[key] = S.learnTarget.spec; lsSet(LS_MAP, S.map);
    status(T("Gelernt: ", "Learned: ") + S.learnTarget.label + " ← " + (type === 0xb0 ? "CC " + d1 : T("Taste ", "key ") + d1));
    S.learnTarget = null; renderLearn(); return;
  }
  if (type === 0x90 || type === 0x80) {
    const on = type === 0x90 && d2 > 0;
    const mk = "nt:" + (st & 15) + ":" + d1;
    if (S.map[mk]) { if (on) runMapped(S.map[mk], 127); return; }
    if (MACKIE[d1] && isDawPort(inp)) { if (on) transportCmd(MACKIE[d1]); return; }
    if (on) noteOn(d1, d2 / 127, "midi"); else noteOff(d1);
    return;
  }
  if (type === 0xb0) {
    const mk = "cc:" + (st & 15) + ":" + d1;
    if (S.map[mk]) { runMapped(S.map[mk], d2); return; }
    const t = curTrack(); if (!t) return;
    if (d1 === 1) { post({ t: "mod", tr: t.id, v: d2 / 127 }); setWheel("mod", d2 / 127); }
    else if (d1 === 64) post({ t: "pedal", tr: t.id, on: d2 >= 64 });
    else if (d1 === 7) { t.vol = Math.round((d2 / 127 * 66 - 60) * 2) / 2; applyAllTracks(); renderTracks(); changed("none"); }
    else if (d1 === 10) { t.pan = (d2 - 64) / 63; applyAllTracks(); renderTracks(); changed("none"); }
    else if (d1 === 123 || d1 === 120) panic();
    return;
  }
  if (type === 0xe0) { const v = ((d2 << 7) | d1) / 8192 - 1; const t = curTrack(); if (t) post({ t: "bend", tr: t.id, v }); setWheel("bend", v); }
}
function transportCmd(c) {
  if (c === "play") S.playing ? stop() : play(S.songMode);
  else if (c === "stop") stop();
  else if (c === "rec") toggleRec();
  else if (c === "loop") { S.songMode = !S.songMode; renderTransport(); }
  else if (c === "back") { const i = LETTERS.indexOf(S.pat); if (i > 0 && S.project.patterns[LETTERS[i - 1]]) selectPattern(LETTERS[i - 1]); }
  else if (c === "fwd") { const i = LETTERS.indexOf(S.pat); if (i < 7 && S.project.patterns[LETTERS[i + 1]]) selectPattern(LETTERS[i + 1]); }
}
// gelernte Zuordnung ausführen: {kind:"param", tr, k} | {kind:"btn", cmd} | {kind:"track", tr, k}
function runMapped(spec, v) {
  if (spec.kind === "btn") { transportCmd(spec.cmd); return; }
  const t = S.project.tracks.find(x => x.id === (spec.tr === "*" ? S.sel : spec.tr)); if (!t) return;
  if (spec.kind === "param") {
    const p = paramSpec(t, spec.k); if (!p) return;
    setParam(t, spec.k, fromPos(p, v / 127), true);
  } else if (spec.kind === "track") {
    if (spec.k === "vol") t.vol = Math.round((v / 127 * 66 - 60) * 2) / 2; else if (spec.k === "pan") t.pan = (v - 64) / 63; else t[spec.k] = v / 127;
    applyAllTracks(); renderTracks(); changed("none");
  }
}

// =====================================================================================================
// Regler (Knob): ziehen ↕, Umschalt = fein, Doppelklick = Standard, Pfeiltasten, Mausrad
// =====================================================================================================
function toPos(p, v) {
  if (p.c === "exp") return Math.log(v / p.min) / Math.log(p.max / p.min);
  if (p.c === "exp0") return Math.sqrt(clamp(v / p.max, 0, 1));
  return (v - p.min) / (p.max - p.min);
}
function fromPos(p, x) {
  x = clamp(x, 0, 1);
  let v = p.c === "exp" ? p.min * Math.pow(p.max / p.min, x) : p.c === "exp0" ? x * x * p.max : p.min + x * (p.max - p.min);
  if (p.st) v = Math.round(v / p.st) * p.st;
  return clamp(v, p.min, p.max);
}
function fmt(p, v) {
  const u = p.u || "";
  if (p.k === "hpf" && v <= 21) return T("aus", "off");
  if (u === "Hz") return v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 1 : 2).replace(".", EN ? "." : ",") + " kHz" : (v < 10 ? v.toFixed(2) : Math.round(v)) + " Hz";
  if (u === "s") return v < 1 ? Math.round(v * 1000) + " ms" : v.toFixed(2).replace(".", EN ? "." : ",") + " s";
  if (u === "%") return p.min < 0 ? (v > 0 ? "+" : "") + Math.round(v * 100) + " %" : Math.round(v * 100) + " %";
  if (u === "st") return (v > 0 ? "+" : "") + Math.round(v * 10) / 10 + (EN ? " st" : " HT");
  if (u === "ct") return (v > 0 ? "+" : "") + Math.round(v) + " ct";
  if (u === "x") return (Math.round(v * 100) / 100).toString().replace(".", EN ? "." : ",") + "×";
  if (u === "pan") return Math.abs(v) < 0.02 ? "C" : (v < 0 ? "L " : "R ") + Math.round(Math.abs(v) * 100);
  if (u === "dB") return (v > 0 ? "+" : "") + v.toFixed(1).replace(".", EN ? "." : ",") + " dB";
  return String(Math.round(v * 100) / 100).replace(".", EN ? "." : ",");
}
function knob(p, value, onChange, opts = {}) {
  const lab = EN ? p.en : p.de;
  const id = "sbK" + uid();
  const wrap = h("div", { class: "sb-knob" + (opts.small ? " small" : ""), title: lab + T(" — an die Stelle am Bogen klicken · fein: Shift + senkrecht ziehen oder Mausrad · Alt-Klick = Standard", " — click the spot on the arc · fine: Shift + drag vertically, or the mouse wheel · Alt-click = default") });
  const R = opts.small ? 15 : 19, C = 2 * Math.PI * R, A = 0.75;     // 270°-Bogen
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const size = (R + 5) * 2; svg.setAttribute("viewBox", `0 0 ${size} ${size}`); svg.setAttribute("width", size); svg.setAttribute("height", size);
  const mk = (cls) => { const c = document.createElementNS("http://www.w3.org/2000/svg", "circle"); c.setAttribute("cx", size / 2); c.setAttribute("cy", size / 2); c.setAttribute("r", R); c.setAttribute("class", cls); svg.append(c); return c; };
  const track = mk("kt"), arc = mk("ka");
  track.setAttribute("stroke-dasharray", `${C * A} ${C}`);
  const dot = document.createElementNS("http://www.w3.org/2000/svg", "line"); dot.setAttribute("class", "kd"); svg.append(dot);
  const face = h("div", { class: "sb-kface", id, role: "slider", tabindex: "0", "aria-label": lab, "aria-valuemin": p.min, "aria-valuemax": p.max });
  face.append(svg);
  const val = h("span", { class: "sb-kval" });
  wrap.append(face, h("label", { class: "sb-klab", for: id, text: lab }), val);
  let v = value;
  const paint = () => {
    const x = clamp(toPos(p, v), 0, 1);
    const bip = p.min < 0 && p.max > 0, zero = bip ? toPos(p, 0) : 0;
    const a0 = Math.min(zero, x), a1 = Math.max(zero, x);
    arc.setAttribute("stroke-dasharray", `${Math.max(0.001, (a1 - a0) * C * A)} ${C}`);
    arc.setAttribute("stroke-dashoffset", `${-a0 * C * A}`);
    const ang = (135 + x * 270) * Math.PI / 180, cx = size / 2, cy = size / 2;
    dot.setAttribute("x1", cx + Math.cos(ang) * (R - 7)); dot.setAttribute("y1", cy + Math.sin(ang) * (R - 7));
    dot.setAttribute("x2", cx + Math.cos(ang) * (R + 1)); dot.setAttribute("y2", cy + Math.sin(ang) * (R + 1));
    val.textContent = fmt(p, v); face.setAttribute("aria-valuenow", v); face.setAttribute("aria-valuetext", fmt(p, v));
  };
  const set = (nv, fire = true) => { nv = clamp(nv, p.min, p.max); if (nv === v) return; v = nv; paint(); if (fire) onChange(v); };
  wrap.setValue = (nv) => { v = nv; paint(); };
  // 3.16: in den Regler klicken setzt den Wert dorthin (Winkel am 270°-Bogen), Ziehen folgt dem Kreis;
  // mit Shift: fein, senkrecht ziehen wie bisher. Die Lücke unten rastet am näheren Ende ein.
  const posAt = (e, prev) => {
    const r = face.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    if (dx * dx + dy * dy < 9) return prev == null ? toPos(p, v) : prev;   // genau in der Mitte: Winkel unbestimmt, Wert bleibt
    const a = ((Math.atan2(dy, dx) * 180 / Math.PI - 135) % 360 + 360) % 360;
    if (a <= 270) return a / 270;
    return prev == null ? (a > 315 ? 0 : 1) : (prev < 0.5 ? 0 : 1);   // in der Lücke: nicht von 0 nach 100 % springen
  };
  // Maus. 🔴 3.16.0 hatte beim Umbau die pointerup-Zeilen verloren: das Ziehen endete nie, der Wert klebte an der Maus.
  // Fein einstellen: Shift gedrückt halten und senkrecht ziehen, oder Mausrad. Standard: Alt-Klick (ein Doppelklick
  // setzte zurück, sobald man zweimal schnell klickte).
  let drag = null;
  face.addEventListener("pointerdown", (e) => {
    if (S.learn && opts.learn) { e.preventDefault(); learnPick(opts.learn, lab, wrap); return; }
    e.preventDefault(); face.focus();
    if (e.altKey) { set(p.def); return; }
    if (e.shiftKey) { face.setPointerCapture(e.pointerId); drag = { y: e.clientY, x0: toPos(p, v) }; return; }
    set(fromPos(p, posAt(e, null)));
  });
  face.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (!(e.buttons & 1)) { end(); return; }                     // Taste schon los (Fenster verlassen o. Ä.): nicht weiter folgen
    set(fromPos(p, drag.x0 + (drag.y - e.clientY) / 900));
  });
  const end = () => { if (drag) { drag = null; if (opts.onEnd) opts.onEnd(v); } };
  face.addEventListener("pointerup", end); face.addEventListener("pointercancel", end); face.addEventListener("lostpointercapture", end);
  // 3.17.2: gestufte Regler (Oktave, Halbton, Stimmen …) — ein Rad-/Tastenschritt war kleiner als eine halbe Stufe und wurde
  // zurückgerundet: Mausrad und Pfeiltasten taten nichts. Jetzt mindestens eine Stufe.
  const nudge = (d) => { let nv = fromPos(p, toPos(p, v) + d); if (p.st && nv === v) nv = clamp(v + Math.sign(d) * p.st, p.min, p.max); return nv; };
  knobWheel(face, p, () => v, set, toPos, fromPos);         // 3.18.1: nach Scrollweg, Seiten-Scrollen dreht nicht mit
  face.addEventListener("keydown", (e) => {
    const stp = e.shiftKey ? 0.01 : 0.05;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") { e.preventDefault(); set(nudge(stp)); }
    else if (e.key === "ArrowDown" || e.key === "ArrowLeft") { e.preventDefault(); set(nudge(-stp)); }
    else if (e.key === "Home") set(p.min); else if (e.key === "End") set(p.max); else if (e.key === "Enter") set(p.def);
  });
  paint();
  return wrap;
}
function selectBox(p, value, onChange) {
  const id = "sbS" + uid();
  const s = h("select", { id, class: "sb-sel" }, p.opts.map(([v, de, en]) => h("option", { value: String(v), selected: String(v) === String(value) }, EN ? en : de)));
  s.addEventListener("change", () => { const raw = s.value; const o = p.opts.find(x => String(x[0]) === raw); onChange(o ? o[0] : raw); });
  return h("div", { class: "sb-field" }, h("label", { for: id, text: EN ? p.en : p.de }), s);
}
function toggle(p, value, onChange) {
  const b = h("button", { type: "button", class: "sb-tog" + (value ? " on" : ""), "aria-pressed": String(!!value), text: EN ? p.en : p.de });
  b.addEventListener("click", () => { const on = !b.classList.contains("on"); b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); onChange(on); });
  return b;
}

// =====================================================================================================
// Klang-Parameter setzen
// =====================================================================================================
function paramSpec(t, k) {
  if (t.kind === "drums" && /^v\d+\./.test(k)) return PAD_PARAMS.find(p => p.k === k.split(".")[1]);
  for (const sec of SCHEMA[t.patch.engine] || []) for (const p of sec.p) if (p.k === k) return p;
  return null;
}
function setParam(t, k, v, fromMidi) {
  const idle = knobIdle(t.patch.engine, k, t.patch);           // 3.17.2: wirkte er eben noch nicht? dann gleich die Abhängigkeit dazu
  if (t.kind === "drums" && /^v\d+\./.test(k)) { const [vs, f] = k.split("."); const i = +vs.slice(1); t.patch.kit[i] = Object.assign({}, t.patch.kit[i], { [f]: v }); }
  else t.patch[k] = v;
  post({ t: "param", tr: t.id, k, v });
  if (fromMidi) { const kn = q(`[data-pk="${CSS.escape(k)}"]`); if (kn && kn.setValue && t.id === S.sel) kn.setValue(v); }
  if (idle && idle.fix && !idle.soft) {
    for (const [fk, fv] of Object.entries(idle.fix)) { t.patch[fk] = fv; post({ t: "param", tr: t.id, k: fk, v: fv }); if (t.id === S.sel) showValue(q(`#sbEditor [data-pk="${CSS.escape(fk)}"]`), fv); }
    status(T("🔌 Dazugeschaltet, damit du es hörst: ", "🔌 Switched on so you can hear it: ") + fixText(idle.fix, (x) => paramSpec(t, x), EN));
  }
  if (t.id === S.sel) markIdle(q("#sbEditor"), (x) => knobIdle(t.patch.engine, x, t.patch), EN);
  t.presetName = t.presetName && !t.presetName.endsWith(" *") ? t.presetName + " *" : t.presetName;
  changed("none");
}

// =====================================================================================================
// Oberfläche
// =====================================================================================================
function status(t) { const e = q("#sbMsg"); if (e) { e.textContent = t; clearTimeout(status.t); status.t = setTimeout(() => { if (e.textContent === t) e.textContent = ""; }, 7000); } }
function shell() {
  const v = q("#selberView");
  v.innerHTML = "";
  v.append(
    h("div", { class: "sb-top" },
      h("div", { class: "sb-proj" },
        h("label", { class: "sb-cap", for: "sbName", text: T("Projekt", "Project") }),
        h("input", { id: "sbName", type: "text", maxlength: "80", class: "sb-name" }),
        h("select", { id: "sbProjects", "aria-label": T("Projekt öffnen", "Open project") }),
        h("button", { id: "sbNew", type: "button", class: "ghost btn-s", text: T("＋ Neu", "＋ New") }),
        h("button", { id: "sbDup", type: "button", class: "ghost btn-s", text: T("⧉ Kopie", "⧉ Copy") }),
        h("button", { id: "sbExport", type: "button", class: "ghost btn-s", title: T("Projekt als Datei sichern", "Back up the project as a file"), text: T("⬇︎ Datei", "⬇︎ File") }),
        h("button", { id: "sbImport", type: "button", class: "ghost btn-s", title: T("Projekt aus Datei laden", "Load a project from a file"), text: T("⬆︎ Datei", "⬆︎ File") }),
        h("input", { id: "sbImportFile", type: "file", accept: ".json,application/json", hidden: true }),
        h("button", { id: "sbDel", type: "button", class: "ghost btn-s danger", text: T("🗑", "🗑"), title: T("Projekt löschen", "Delete project") }),
        h("select", { id: "sbFromLib", class: "sb-fromlib", "aria-label": T("Song aus der Bibliothek auf die Instrumente legen", "Put a library song on the instruments"),
          title: T("Jeder KI-Song bekommt auf dem Mac ein MIDI-Abbild — hier wird daraus ein Projekt mit Drums, Bass, Akkorden und Melodie", "Every AI song gets a MIDI image on your computer — this turns it into a project with drums, bass, chords and melody") })),
      h("span", { id: "sbSaved", class: "sub small", role: "status" })),
    h("div", { id: "sbTransport", class: "sb-transport" }),
    h("div", { class: "sb-main" },
      h("div", { class: "sb-tracks-wrap" },
        h("div", { class: "sb-head" }, h("h3", { text: T("Spuren", "Tracks") }),
          h("select", { id: "sbAddModel", "aria-label": T("Instrument der neuen Spur", "Instrument for the new track") },
            modelOptions("poly")),
          h("button", { id: "sbAdd", type: "button", class: "ghost btn-s", text: T("＋ Spur", "＋ Track") })),
        h("div", { id: "sbTracks", class: "sb-tracks" })),
      h("div", { id: "sbEditor", class: "sb-editor" })),
    h("div", { id: "sbKeys", class: "sb-keys-card" }),
    h("div", { class: "sb-bottom" },
      h("div", { id: "sbSong", class: "sb-song" }),
      h("div", { id: "sbBounce", class: "sb-bounce" })),
    h("p", { id: "sbMsg", class: "status sb-msg", role: "status" }),
  );
  q("#sbName").addEventListener("input", (e) => { S.project.name = e.target.value.slice(0, 80) || T("Projekt", "Project"); changed("none"); renderProjects(); });
  q("#sbProjects").addEventListener("change", (e) => openProject(e.target.value));
  q("#sbFromLib").addEventListener("change", async (e) => { const id = e.target.value; e.target.value = ""; if (!id || !window.mwsLibrary) return;
    const rec = await window.mwsLibrary.get(id); if (rec) await fromMidi(rec); });
  q("#sbNew").onclick = async () => { await save(); stop(); emptyProject(); S.sel = S.project.tracks[0].id; S.pat = "A"; S.undo = []; await afterLoad(); status(T("Neues Projekt angelegt.", "New project created.")); };
  q("#sbDup").onclick = async () => { await save(); const c = JSON.parse(JSON.stringify(S.project)); c.id = uid(); c.name = S.project.name + T(" (Kopie)", " (copy)"); c.created = Date.now(); S.project = c; await save(); await afterLoad(); status(T("Kopie angelegt — du arbeitest jetzt in der Kopie.", "Copy created — you are now working in the copy.")); };
  q("#sbDel").onclick = async () => {
    if (!confirm(T(`Projekt „${S.project.name}“ löschen? Erzeugte Tracks in der Bibliothek bleiben.`, `Delete project “${S.project.name}”? Tracks you generated stay in the library.`))) return;
    stop(); await dbDel("projects", S.project.id).catch(() => {});
    const all = (await dbAll("projects").catch(() => [])).sort((a, b) => b.changed - a.changed);
    if (all.length) S.project = fixProject(all[0]); else { S.project = fixProject(demoProject(EN ? "en" : "de")); S.project.id = uid(); }
    await afterLoad();
  };
  q("#sbExport").onclick = () => {
    const blob = new Blob([JSON.stringify(S.project, null, 1)], { type: "application/json" });
    const a = h("a", { href: URL.createObjectURL(blob), download: (S.project.name || "projekt").replace(/[^\wäöüÄÖÜß\- ]+/g, "").trim() + ".manuwave.json" });
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };
  q("#sbImport").onclick = () => q("#sbImportFile").click();
  q("#sbImportFile").onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    try {
      const p = JSON.parse(await f.text());
      if (!p || !Array.isArray(p.tracks) || !p.patterns) throw new Error(T("keine Projektdatei", "not a project file"));
      p.id = uid(); p.name = (p.name || f.name).slice(0, 80);
      await save(); stop(); S.project = fixProject(p); await save(); await afterLoad(); status(T("Projekt geladen.", "Project loaded."));
    } catch (x) { status(T("Datei nicht lesbar: ", "Can't read file: ") + (x.message || x)); }
  };
  q("#sbAdd").onclick = () => {
    if (S.project.tracks.length >= MAX_TRACKS) { status(T("Höchstens 16 Spuren.", "At most 16 tracks.")); return; }
    snap();
    const t = newTrack(q("#sbAddModel").value);
    S.project.tracks.push(t); S.sel = t.id; syncProject(); renderAll(); changed("none");
  };
}
function renderAll() {
  if (!S.built) return;
  q("#sbName").value = S.project.name;
  renderProjects(); renderTransport(); renderTracks(); renderEditor(); renderKeys(); renderSong(); renderBounce(); renderFromLib();
}
async function renderProjects() {
  const sel = q("#sbProjects"); if (!sel) return;
  let all = []; try { all = await dbAll("projects"); } catch (e) { /* */ }
  if (!all.some(p => p.id === S.project.id)) all.push(S.project);
  all.sort((a, b) => (b.changed || 0) - (a.changed || 0));
  sel.innerHTML = "";
  for (const p of all) sel.append(h("option", { value: p.id, selected: p.id === S.project.id }, (p.id === S.project.id ? S.project.name : p.name) || "—"));
}
// ---------- 3.16: Songs aus der Bibliothek (MIDI-Abbild vom Mac) ----------
async function renderFromLib() {
  const sel = q("#sbFromLib"); if (!sel) return;
  const list = window.mwsLibrary && window.mwsLibrary.midiTracks ? await window.mwsLibrary.midiTracks().catch(() => []) : [];
  sel.innerHTML = "";
  sel.append(h("option", { value: "" }, list.length ? T(`🎼 Song aus der Bibliothek (${list.length}) …`, `🎼 Song from the library (${list.length}) …`)
    : T("🎼 Songs aus der Bibliothek: MIDI-Abbilder folgen vom Mac", "🎼 Library songs: MIDI images will come from your computer")));
  for (const r of list) sel.append(h("option", { value: r.id }, r.title + (r.variant ? " · " + r.variant : "") + (r.bpm ? ` · ${Math.round(r.bpm)} BPM` : "")));
  sel.disabled = !list.length;
}
// Welche Klänge ein Abbild bekommt — je Richtung ein passendes Kit, sonst Klassiker, die überall tragen
function kitFor(caption) {
  const c = String(caption || "").toLowerCase();
  return /trap|drill|hip.?hop|rap/.test(c) ? "trap" : /lo.?fi|chill|jazz/.test(c) ? "lofi" : /techno|industrial/.test(c) ? "techno"
    : /house|trance|edm|dance|disco|electro|club/.test(c) ? "909" : /80s|synthwave|retro|new wave/.test(c) ? "80s" : "808";
}
function trackWith(model, presetDe, name, o = {}) {
  const t = newTrack(model, name), pr = PRESETS.find(p => p.model === model && p.de === presetDe);
  if (pr) { t.patch = Object.assign(defaults(model === "drums" ? "drums" : MODELS.find(m => m.id === model).engine), JSON.parse(JSON.stringify(pr.patch))); t.presetName = EN ? pr.en : pr.de; if (pr.ch != null) t.chorus = pr.ch; }
  return Object.assign(t, o);
}
// Ein MIDI-Abbild (Spuren auf dem 1/16-Raster) → neues Projekt; Patterns zu je 16 Takten, höchstens 8 (= 128 Takte)
export function projectFromMidi(rec) {
  const M = rec.midi || {}, T0 = M.tracks || {};
  const cap = (rec.result || {}).caption || (rec.request || {}).caption || "";
  const kit = kitFor(cap);
  const drums = trackWith("drums", "", "Drums", { vol: -6, rev: 0.06 });
  drums.patch = Object.assign(defaults("drums"), { kit: JSON.parse(JSON.stringify(KITS[kit].kit)), kitName: kit }); drums.presetName = EN ? KITS[kit].en : KITS[kit].de;
  const tracks = [drums,
    trackWith("minimoog", "Moog-Bass klassisch", T("Bass", "Bass"), { vol: -9, rev: 0 }),
    trackWith("prophet", "Prophet-Keys", T("Akkorde", "Chords"), { vol: -15, rev: 0.25, chorus: 0.2 }),
    trackWith("minimoog", "Singender Lead", T("Melodie", "Melody"), { vol: -12, rev: 0.3, dly: 0.15 })];
  const src = { [tracks[0].id]: T0.drums || [], [tracks[1].id]: (T0.bass || []).map(n => ({ ...n, n: n.n + 12 })),   // Bass-Klänge stehen eine Oktave tiefer
    [tracks[2].id]: T0.chords || [], [tracks[3].id]: T0.melody || [] };
  const PAT = 16 * SPB, all = Object.values(src).flat();
  const end = all.reduce((m, n) => Math.max(m, n.s + (n.l || 1)), 0);
  const nPat = clamp(Math.ceil(end / PAT), 1, LETTERS.length);
  const patterns = {};
  for (let i = 0; i < nPat; i++) {
    const left = end - i * PAT;
    patterns[LETTERS[i]] = { bars: clamp(Math.ceil(Math.min(PAT, left) / SPB), 1, 16), notes: {} };
  }
  for (const [tid, ns] of Object.entries(src)) for (const n of ns) {
    const i = Math.floor(n.s / PAT); if (n.s < 0 || i >= nPat) continue;
    const P = patterns[LETTERS[i]], s0 = n.s - i * PAT, lim = P.bars * SPB;
    if (s0 >= lim) continue;
    (P.notes[tid] = P.notes[tid] || []).push({ s: s0, l: clamp(n.l || 1, 1, lim - s0), n: n.n, v: clamp(n.v || 0.8, 0.1, 1) });
  }
  return { v: 1, id: uid(), name: (rec.title || "Song") + T(" (MIDI-Abbild)", " (MIDI image)"), bpm: clamp(Math.round((M.bpm || 120) * 100) / 100, 40, 240),
    swing: 0.5, key: (rec.result || {}).keyscale || (rec.request || {}).keyscale || "", genre: cap.split(",")[0].trim().slice(0, 40), tracks, patterns,
    song: Object.keys(patterns).map(p => ({ p, r: 1 })), fx: { revSize: 0.55, revDecay: 2.2, dlyTime: "3/16", dlyFb: 0.3, dlyTone: 0.5 }, master: { vol: 0 },
    fromTrack: rec.id, cut: Math.ceil(end / PAT) > LETTERS.length, created: Date.now(), changed: Date.now() };
}
async function fromMidi(rec) {
  await init();
  if (!rec || !rec.midi) { status(T("Für diesen Song gibt es noch kein MIDI-Abbild — dein Mac rechnet es, sobald er frei ist.", "There is no MIDI image for this song yet — your computer makes one as soon as it is free.")); return; }
  const have = (await dbAll("projects").catch(() => [])).find(p => p.fromTrack === rec.id);
  if (have) { await openProject(have.id); status(T(`„${have.name}“ gibt es schon — geöffnet.`, `“${have.name}” already exists — opened.`)); return; }
  await save(); stop();
  S.project = fixProject(projectFromMidi(rec)); S.undo = []; S.redo = [];
  await save(); await afterLoad();
  S.songMode = true; renderTransport();          // ein ganzer Song: Wiedergabe als Song, nicht als Schleife
  status(T(`🎼 „${rec.title}“ liegt jetzt auf den Instrumenten — ${S.project.bpm} BPM, ${Object.keys(S.project.patterns).length} Teile.`, `🎼 “${rec.title}” is now on the instruments — ${S.project.bpm} BPM, ${Object.keys(S.project.patterns).length} parts.`)
    + (S.project.cut ? T(" Der Song ist länger als 128 Takte — der Rest fehlt.", " The song is longer than 128 bars — the rest is left out.") : ""));
}
async function openProject(id) {
  if (id === S.project.id) return;
  await save(); stop();
  const p = await dbGet("projects", id).catch(() => null);
  if (!p) return;
  S.project = fixProject(p); S.undo = []; S.redo = [];
  await afterLoad();
}
async function afterLoad() {
  S.sel = (S.project.tracks[0] || {}).id; S.pat = Object.keys(S.project.patterns).sort()[0] || "A"; S.noteSel = null;
  lsSet(LS_LAST, S.project.id);
  if (S.g) syncProject();
  renderAll();
}

// ---------- Transport ----------
function renderTransport() {
  const el = q("#sbTransport"); if (!el) return;
  el.innerHTML = "";
  const P = S.project;
  const bpm = h("input", { id: "sbBpm", type: "number", min: "40", max: "240", step: "0.01", value: P.bpm, class: "sb-bpm", "aria-label": "BPM" });
  bpm.addEventListener("change", () => { P.bpm = clamp(Math.round((+bpm.value || 120) * 100) / 100, 40, 240); bpm.value = P.bpm; post({ t: "tempo", bpm: P.bpm, swing: P.swing }); if (S.g) applyFx(S.g, P); changed("none"); renderSong(); });
  const tap = h("button", { type: "button", class: "ghost btn-s", text: "Tap", title: T("Im Takt tippen", "Tap the tempo") });
  tap.onclick = () => { const now = performance.now(); S.taps = (S.taps || []).filter(x => now - x < 3000); S.taps.push(now);
    if (S.taps.length >= 3) { const d = (S.taps[S.taps.length - 1] - S.taps[0]) / (S.taps.length - 1); P.bpm = clamp(Math.round(60000 / d), 40, 240); bpm.value = P.bpm; post({ t: "tempo", bpm: P.bpm }); if (S.g) applyFx(S.g, P); changed("none"); } };
  const swing = knob({ k: "swing", de: "Swing", en: "Swing", min: 0.5, max: 0.75, def: 0.5, u: "%" }, P.swing, (v) => { P.swing = v; post({ t: "tempo", bpm: P.bpm, swing: v }); changed("none"); }, { small: true });
  swing.querySelector(".sb-kval").textContent = Math.round(P.swing * 100) + " %";
  const playBtn = h("button", { id: "sbPlay", type: "button", class: "sb-tbtn" + (S.playing ? " on" : ""), title: T("Abspielen / Stopp (Leertaste)", "Play / stop (space)"), text: S.playing ? "■" : "▶︎" });
  playBtn.onclick = () => (S.learn ? learnPick({ kind: "btn", cmd: "play" }, "▶︎ " + T("Start/Stopp", "Play/stop"), playBtn) : S.playing ? stop() : play(S.songMode));
  const recBtn = h("button", { id: "sbRec", type: "button", class: "sb-tbtn rec" + (S.rec ? " on" : ""), title: T("Aufnehmen in die gewählte Spur", "Record into the selected track"), text: "●" });
  recBtn.onclick = () => (S.learn ? learnPick({ kind: "btn", cmd: "rec" }, "● " + T("Aufnahme", "Record"), recBtn) : toggleRec());
  const mode = h("div", { class: "seg small sb-mode", role: "radiogroup", "aria-label": T("Wiedergabe", "Playback") },
    h("button", { type: "button", class: S.songMode ? "" : "on", text: "Loop", title: T("Das gewählte Pattern wiederholen", "Loop the selected pattern"), onclick: () => { S.songMode = false; if (S.playing) play(false); else renderTransport(); } }),
    h("button", { type: "button", class: S.songMode ? "on" : "", text: "Song", title: T("Den Song von vorn spielen", "Play the song from the start"), onclick: () => { S.songMode = true; if (S.playing) play(true); else renderTransport(); } }));
  const metro = h("button", { type: "button", class: "sb-tog" + (S.metro ? " on" : ""), text: T("♩ Metronom", "♩ Metronome") });
  metro.onclick = () => { S.metro = !S.metro; post({ t: "metro", on: S.metro }); renderTransport(); };
  const cnt = h("button", { type: "button", class: "sb-tog" + (S.countIn ? " on" : ""), text: T("1 Takt einzählen", "1-bar count-in") });
  cnt.onclick = () => { S.countIn = !S.countIn; renderTransport(); };
  const qsel = h("select", { id: "sbQuant", "aria-label": T("Aufnahme quantisieren", "Quantize recording") },
    [[0, T("frei (nicht quantisiert)", "free (no quantize)")], [4, "1/4"], [2, "1/8"], [1, "1/16"], [0.5, "1/32"]].map(([v, l]) => h("option", { value: v, selected: +v === S.quant }, T("Raster ", "Grid ") + l)));
  qsel.onchange = () => { S.quant = +qsel.value; if (S.rec) post({ t: "rec", on: true, tr: S.sel, q: S.quant }); };
  el.append(
    h("div", { class: "sb-tgroup" }, playBtn, recBtn, h("button", { type: "button", class: "sb-tbtn ghost", title: T("Alle Töne aus", "All notes off"), text: "⏻", onclick: panic }), mode),
    h("div", { class: "sb-tgroup" }, h("label", { class: "sb-cap", for: "sbBpm", text: "BPM" }), bpm, tap, swing),
    h("div", { class: "sb-tgroup" }, metro, cnt, qsel),
    h("div", { id: "sbPatterns", class: "sb-tgroup sb-pats" }),
    h("div", { class: "sb-tgroup sb-right" }, h("span", { id: "sbPos", class: "sb-pos", text: "–" }), h("canvas", { id: "sbMeter", class: "sb-meter", width: "120", height: "14", "aria-label": T("Pegel", "Level") }),
      h("button", { id: "sbMidiPill", type: "button", class: "pill sb-midi" })),
  );
  renderPatterns(); renderMidi(); paintPos();
}
function renderPatterns() {
  const el = q("#sbPatterns"); if (!el) return;
  el.innerHTML = "";
  el.append(h("span", { class: "sb-cap", text: "Pattern" }));
  for (const L of LETTERS) {
    const ex = !!S.project.patterns[L];
    const b = h("button", { type: "button", class: "sb-pat" + (L === S.pat ? " on" : "") + (ex ? "" : " empty") + (S.playing && L === S.playPat ? " playing" : "") + (S.queued === L ? " queued" : ""),
      text: L, title: ex ? T("Pattern ", "Pattern ") + L : T("Neues Pattern ", "New pattern ") + L });
    b.onclick = () => selectPattern(L);
    el.append(b);
  }
  const bars = h("select", { id: "sbBars", "aria-label": T("Länge des Patterns", "Pattern length") },
    // 3.16: bis 16 Takte (ein MIDI-Abbild teilt den Song in 16-Takt-Teile); eine krumme Länge (letzter Teil) steht mit drin
    [...new Set([1, 2, 4, 8, 16, curPat().bars])].sort((x, y) => x - y).map(n => h("option", { value: n, selected: n === curPat().bars }, n + (n === 1 ? T(" Takt", " bar") : T(" Takte", " bars")))));
  bars.onchange = () => { snap(); curPat().bars = +bars.value; changed(); renderEditor(); renderSong(); };
  const more = h("select", { "aria-label": T("Pattern-Aktionen", "Pattern actions"), class: "sb-more" },
    h("option", { value: "" }, "⋯"), h("option", { value: "dup" }, T("Kopieren nach nächstem freien", "Copy to next free")),
    h("option", { value: "clear" }, T("Pattern leeren", "Clear pattern")), h("option", { value: "del" }, T("Pattern löschen", "Delete pattern")));
  more.onchange = () => {
    const a = more.value; more.value = "";
    if (a === "dup") { const free = [...LETTERS].find(L => !S.project.patterns[L]); if (!free) { status(T("Alle 8 Pattern belegt.", "All 8 patterns used.")); return; }
      snap(); S.project.patterns[free] = JSON.parse(JSON.stringify(curPat())); S.pat = free; changed(); renderPatterns(); renderEditor(); status(T("Kopiert nach ", "Copied to ") + free); }
    else if (a === "clear") { snap(); curPat().notes = {}; changed(); renderEditor(); }
    else if (a === "del") { if (Object.keys(S.project.patterns).length <= 1) return; snap(); delete S.project.patterns[S.pat]; S.project.song = S.project.song.filter(e => e.p !== S.pat);
      S.pat = Object.keys(S.project.patterns).sort()[0]; changed(); renderPatterns(); renderEditor(); renderSong(); }
  };
  el.append(bars, more);
}
function selectPattern(L) {
  if (!S.project.patterns[L]) { snap(); S.project.patterns[L] = { bars: curPat().bars, notes: {} }; changed(); }
  S.pat = L; S.noteSel = null;
  if (S.playing && !S.songMode) { S.queued = L; post({ t: "queue", pat: L }); }
  else if (!S.playing) post({ t: "queue", pat: L });
  S.follow = false;
  renderPatterns(); renderEditor(); renderBounce();
}
function paintPos() {
  const e = q("#sbPos"); if (!e) return;
  if (!S.playing || S.step < 0) { e.textContent = S.rec ? T("● bereit", "● ready") : "1 . 1 . 1"; return; }
  const s = S.step; e.textContent = `${S.songMode ? S.playPat + " · " : ""}${Math.floor(s / 16) + 1} . ${Math.floor(s % 16 / 4) + 1} . ${s % 4 + 1}`;
}
function renderMidi() {
  const b = q("#sbMidiPill"); if (!b) return;
  const names = S.inputs.map(i => i.name).filter(Boolean);
  const kb = T("⌨️ Computertastatur", "⌨️ Computer keyboard");
  b.className = "pill sb-midi" + (S.midiState === "ok" ? " ok" : "");
  b.textContent = S.midiState === "ok" ? "🎹 " + (names[0] || "MIDI") + (names.length > 1 ? " +" + (names.length - 1) : "") : kb;
  b.title = S.midiState === "ok" ? T("MIDI-Geräte: ", "MIDI devices: ") + names.join(", ") + T(" — die Computertastatur spielt zusätzlich.", " — the computer keyboard plays too.")
    : S.midiState === "none" ? T("Dieser Browser kann kein MIDI (Safari) — gespielt wird mit der Computertastatur. Für ein USB-Keyboard: Chrome oder Edge.", "This browser has no MIDI (Safari) — play with the computer keyboard. For a USB keyboard: Chrome or Edge.")
    : S.midiState === "denied" ? T("MIDI nicht erlaubt — gespielt wird mit der Computertastatur. Klicken, um es noch einmal zu versuchen.", "MIDI not allowed — play with the computer keyboard. Click to try again.")
    : T("Kein MIDI-Keyboard angeschlossen — gespielt wird mit der Computertastatur. Keyboard einstecken genügt, es wird sofort erkannt.", "No MIDI keyboard connected — play with the computer keyboard. Just plug one in, it's picked up right away.");
  b.onclick = () => { if (S.midiState !== "ok") initMidi(); status(b.title); };
  renderKbInfo();
}
function flashMidi() { const b = q("#sbMidiPill"); if (!b) return; b.classList.add("blink"); clearTimeout(flashMidi.t); flashMidi.t = setTimeout(() => b.classList.remove("blink"), 90); }
let meterRaf = 0;
function meterLoop() {
  cancelAnimationFrame(meterRaf);
  const tick = () => {
    meterRaf = requestAnimationFrame(tick);
    if (!tabVisible() || !S.g || !S.g.an) return;
    const c = q("#sbMeter"); if (!c) return;
    S.g.an.getFloatTimeDomainData(S.g.anBuf);
    let pk = 0; for (const x of S.g.anBuf) { const a = Math.abs(x); if (a > pk) pk = a; }
    S.mPeak = Math.max(pk, (S.mPeak || 0) * 0.92);
    const x = c.getContext("2d"), w = c.width, hh = c.height;
    x.clearRect(0, 0, w, hh);
    const db = 20 * Math.log10(S.mPeak + 1e-6), f = clamp((db + 48) / 48, 0, 1);
    const cs = getComputedStyle(document.documentElement);
    x.fillStyle = cs.getPropertyValue("--line"); x.fillRect(0, 0, w, hh);
    x.fillStyle = db > -1.5 ? cs.getPropertyValue("--pink") : db > -9 ? cs.getPropertyValue("--amber") : cs.getPropertyValue("--neon");
    x.fillRect(0, 0, w * f, hh);
    const red = S.limit && S.limit.red > 0.02;
    c.title = T("Ausgang ", "Output ") + (db > -90 ? db.toFixed(1) : "−∞") + " dBFS" + (red ? T(" · Limiter greift ", " · limiter working ") + (20 * Math.log10(1 - S.limit.red)).toFixed(1) + " dB" : "");
    // Spurpegel
    for (const ch of S.g.chains) {
      const dot = q(`.sb-trow[data-id="${ch.id}"] .sb-tlvl`); if (!dot || !ch.an) continue;
      ch.an.getFloatTimeDomainData(ch.buf); let p = 0; for (const v of ch.buf) { const a = Math.abs(v); if (a > p) p = a; }
      ch.pk = Math.max(p, (ch.pk || 0) * 0.9); dot.style.setProperty("--l", clamp((20 * Math.log10(ch.pk + 1e-6) + 48) / 48, 0, 1));
    }
  };
  tick();
}

// ---------- Spuren (Mischpult) ----------
function renderTracks() {
  const el = q("#sbTracks"); if (!el) return;
  el.innerHTML = "";
  const anySolo = S.project.tracks.some(t => t.solo);
  S.project.tracks.forEach((t, i) => {
    const row = h("div", { class: "sb-trow" + (t.id === S.sel ? " on" : "") + (t.mute || (anySolo && !t.solo) ? " quiet" : ""), "data-id": t.id, style: `--c:${t.color}` });
    const name = h("button", { type: "button", class: "sb-tname", title: T("Spur wählen", "Select track") },
      h("span", { class: "sb-tdot" }), h("span", { class: "sb-tn", text: t.name }), h("small", { class: "sub", text: T(model(t.model).de, model(t.model).en) }));
    name.onclick = () => { S.sel = t.id; S.noteSel = null; renderTracks(); renderEditor(); renderKeys(); if (S.rec) post({ t: "rec", on: true, tr: t.id, q: S.quant }); };
    name.ondblclick = () => { const n = prompt(T("Name der Spur", "Track name"), t.name); if (n && n.trim()) { t.name = n.trim().slice(0, 40); changed("none"); renderTracks(); } };
    const mute = h("button", { type: "button", class: "sb-ms" + (t.mute ? " on" : ""), title: T("Stumm", "Mute"), text: "M", "aria-pressed": String(!!t.mute) });
    mute.onclick = () => { t.mute = !t.mute; post({ t: "track", tr: t.id, set: { mute: t.mute } }); applyAllTracks(); renderTracks(); changed("none"); };
    const solo = h("button", { type: "button", class: "sb-ms solo" + (t.solo ? " on" : ""), title: T("Solo", "Solo"), text: "S", "aria-pressed": String(!!t.solo) });
    solo.onclick = () => { t.solo = !t.solo; S.project.tracks.forEach(x => post({ t: "track", tr: x.id, set: { solo: x.solo } })); applyAllTracks(); renderTracks(); changed("none"); };
    const vol = knob({ k: "vol", de: "Lautstärke", en: "Volume", min: -60, max: 6, def: -8, u: "dB", st: 0.5 }, t.vol, (v) => { t.vol = v; applyAllTracks(); changed("none"); }, { small: true, learn: { kind: "track", tr: t.id, k: "vol" } });
    const pan = knob({ k: "pan", de: "Panorama", en: "Pan", min: -1, max: 1, def: 0, u: "pan" }, t.pan, (v) => { t.pan = v; applyAllTracks(); changed("none"); }, { small: true, learn: { kind: "track", tr: t.id, k: "pan" } });
    const rev = knob({ k: "rev", de: "Hall", en: "Reverb", min: 0, max: 1, def: 0.12, u: "%" }, t.rev, (v) => { t.rev = v; applyAllTracks(); changed("none"); }, { small: true, learn: { kind: "track", tr: t.id, k: "rev" } });
    const dly = knob({ k: "dly", de: "Echo", en: "Delay", min: 0, max: 1, def: 0, u: "%" }, t.dly, (v) => { t.dly = v; applyAllTracks(); changed("none"); }, { small: true, learn: { kind: "track", tr: t.id, k: "dly" } });
    const tools = h("div", { class: "sb-ttools" },
      h("button", { type: "button", class: "ghost btn-s", title: T("Nach oben", "Move up"), text: "↑", disabled: i === 0, onclick: () => moveTrack(i, -1) }),
      h("button", { type: "button", class: "ghost btn-s", title: T("Nach unten", "Move down"), text: "↓", disabled: i === S.project.tracks.length - 1, onclick: () => moveTrack(i, 1) }),
      h("button", { type: "button", class: "ghost btn-s danger", title: T("Spur löschen", "Delete track"), text: "✕", onclick: () => delTrack(t) }));
    row.append(h("div", { class: "sb-trow1" }, name, h("span", { class: "sb-tlvl", "aria-hidden": "true" }), mute, solo), h("div", { class: "sb-trow2" }, vol, pan, rev, dly, tools));
    el.append(row);
  });
}
function moveTrack(i, d) {
  const a = S.project.tracks, j = i + d; if (j < 0 || j >= a.length) return;
  snap(); [a[i], a[j]] = [a[j], a[i]]; syncProject(); renderTracks(); changed("none");
}
function delTrack(t) {
  const n = Object.values(S.project.patterns).reduce((s, P) => s + ((P.notes[t.id] || []).length), 0);
  if (n && !confirm(T(`Spur „${t.name}“ mit ${n} Noten löschen?`, `Delete track “${t.name}” with ${n} notes?`))) return;
  snap();
  S.project.tracks = S.project.tracks.filter(x => x !== t);
  for (const P of Object.values(S.project.patterns)) delete P.notes[t.id];
  if (S.sel === t.id) S.sel = (S.project.tracks[0] || {}).id;
  syncProject(); renderAll(); changed("none");
}

// ---------- Editor einer Spur: Noten | Klang | Effekte ----------
function renderEditor() {
  const el = q("#sbEditor"); if (!el) return;
  el.innerHTML = "";
  const t = curTrack();
  if (!t) { el.append(h("p", { class: "sub", text: T("Leg links eine Spur an.", "Add a track on the left.") })); return; }
  const m = model(t.model);
  const msel = h("select", { id: "sbModel", "aria-label": T("Instrument", "Instrument") }, modelOptions(t.model, (x) => (x.engine === "drums") !== (t.kind === "drums")));
  msel.onchange = () => {
    snap();
    const nm = model(msel.value), pr = PRESETS.find(p => p.model === nm.id);
    t.model = nm.id; t.patch = Object.assign(defaults(nm.engine), pr ? JSON.parse(JSON.stringify(pr.patch)) : {}); t.presetName = pr ? (EN ? pr.en : pr.de) : "";
    presetChorus(t, pr);
    post({ t: "patch", tr: t.id, patch: t.patch }); changed("none"); renderTracks(); renderEditor();
  };
  const user = S.userPresets || [];
  const presets = PRESETS.filter(p => p.model === t.model);
  const psel = h("select", { id: "sbPreset", "aria-label": T("Klang (Preset)", "Sound (preset)") },
    h("option", { value: "" }, t.presetName || T("— eigener Klang —", "— custom sound —")),
    h("optgroup", { label: T("Werksklänge", "Factory sounds") }, presets.map((p, i) => h("option", { value: "f" + i }, EN ? p.en : p.de))),
    user.filter(p => p.model === t.model).length ? h("optgroup", { label: T("Meine Klänge", "My sounds") }, user.filter(p => p.model === t.model).map(p => h("option", { value: "u" + p.id }, p.name))) : null);
  psel.onchange = () => {
    const v = psel.value; if (!v) return;
    let patch, name, fac = null;
    if (v[0] === "f") { const p = fac = presets[+v.slice(1)]; patch = p.patch; name = EN ? p.en : p.de; }
    else { const p = user.find(x => "u" + x.id === v); patch = p.patch; name = p.name; }
    snap();
    if (t.kind === "drums") t.patch = Object.assign(defaults("drums"), JSON.parse(JSON.stringify(patch)));
    else t.patch = Object.assign(defaults(m.engine), JSON.parse(JSON.stringify(patch)));
    t.patch.engine = m.engine; t.presetName = name;
    presetChorus(t, fac);
    post({ t: "patch", tr: t.id, patch: t.patch }); changed("none"); renderEditor();
  };
  const savePre = h("button", { type: "button", class: "ghost btn-s", text: T("💾 Als Klang merken", "💾 Save sound"), title: T("Diesen Klang unter „Meine Klänge“ speichern", "Save this sound under “My sounds”") });
  savePre.onclick = async () => {
    const n = prompt(T("Name für diesen Klang", "Name for this sound"), (t.presetName || "").replace(/ \*$/, "") || T(m.de, m.en)); if (!n) return;
    const p = { id: uid(), model: t.model, name: n.slice(0, 40), patch: JSON.parse(JSON.stringify(t.patch)), created: Date.now() };
    try { await dbPut("presets", p); S.userPresets = await dbAll("presets"); t.presetName = p.name; changed("none"); renderEditor(); status(T("Klang gespeichert.", "Sound saved.")); }
    catch (e) { status(T("Speichern nicht möglich.", "Can't save.")); }
  };
  const tabs = h("div", { class: "seg small sb-etabs", role: "tablist" },
    ...[["notes", t.kind === "drums" ? T("🥁 Rhythmus", "🥁 Beat") : T("🎼 Noten", "🎼 Notes")], ["sound", T("🎛 Klang", "🎛 Sound")], ["fx", T("🎚 Effekte", "🎚 Effects")]]
      .map(([k, l]) => h("button", { type: "button", role: "tab", class: S.tab === k ? "on" : "", "aria-selected": String(S.tab === k), text: l, onclick: () => { S.tab = k; lsSet(LS_UI, { tab: k }); renderEditor(); } })));
  el.append(h("div", { class: "sb-ehead", style: `--c:${t.color}` },
    h("span", { class: "sb-tdot" }), h("b", { class: "sb-etitle", text: t.name }), msel, psel, savePre, tabs),
    h("p", { class: "sub small sb-ehint", text: (EN ? m.he : m.hd) + (m.g === "classic" ? T(" · Eigener Nachbau, der Name nennt das Vorbild.", " · Our own recreation; the name refers to the original.") : "") }));
  const body = h("div", { id: "sbEBody", class: "sb-ebody" });
  el.append(body);
  if (S.tab === "notes") (t.kind === "drums" ? renderDrumGrid : renderPianoRoll)(body, t);
  else if (S.tab === "sound") renderSound(body, t);
  else renderFx(body, t);
}

// ---------- Klang: alle Regler des Motors ----------
function renderSound(body, t) {
  const learnBtn = h("button", { type: "button", class: "sb-tog" + (S.learn ? " on" : ""), text: T("🎛 MIDI-Lernen", "🎛 MIDI learn"),
    title: T("Einschalten, Regler anklicken, am Keyboard einen Drehregler/Fader bewegen — fertig.", "Turn on, click a knob, move a knob/fader on your keyboard — done.") });
  learnBtn.onclick = () => { S.learn = !S.learn; S.learnTarget = null; renderEditor(); renderTransport(); };
  const learnInfo = h("span", { id: "sbLearnInfo", class: "sub small" });
  body.append(h("div", { class: "sb-row" }, learnBtn, learnInfo,
    h("button", { type: "button", class: "ghost btn-s", text: T("↺ Grundklang", "↺ Init sound"), title: T("Alle Regler auf Standard", "All knobs to default"),
      onclick: () => { snap(); const keep = t.kind === "drums" ? { kit: t.patch.kit, kitName: t.patch.kitName } : {}; t.patch = Object.assign(defaults(t.patch.engine), keep); t.presetName = ""; post({ t: "patch", tr: t.id, patch: t.patch }); changed("none"); renderEditor(); } })));
  renderLearn();
  const grid = h("div", { class: "sb-panels" });
  for (const sec of SCHEMA[t.patch.engine] || []) {
    const panel = h("section", { class: "sb-panel" + (sec.draw ? " draw" : "") }, h("h4", { text: EN ? sec.en : sec.de }));
    const ctl = h("div", { class: "sb-ctl" });
    for (const p of sec.p) {
      const cur = t.patch[p.k] ?? p.def;
      let w;
      if (p.t === "sel") w = selectBox(p, cur, (v) => { setParam(t, p.k, v); });
      else if (p.t === "tog") w = toggle(p, cur, (v) => setParam(t, p.k, v));
      else if (sec.draw) w = drawbar(p, cur, (v) => setParam(t, p.k, v));
      else w = knob(p, cur, (v) => setParam(t, p.k, v), { learn: { kind: "param", tr: "*", k: p.k } });
      w.dataset.pk = p.k;
      ctl.append(w);
    }
    panel.append(ctl); grid.append(panel);
  }
  body.append(grid);
  if (t.kind === "drums") renderPadPanel(body);
  markIdle(grid, (x) => knobIdle(t.patch.engine, x, t.patch), EN);   // 3.17.2: was gerade nicht wirkt, ist abgedunkelt und sagt warum
}
function learnPick(spec, label, el) {
  S.learnTarget = { spec, label }; renderLearn();
  qa(".sb-knob.learning, .sb-tbtn.learning").forEach(x => x.classList.remove("learning")); if (el) el.classList.add("learning");
}
function drawbar(p, v, onChange) {
  const id = "sbD" + uid();
  const inp = h("input", { id, type: "range", min: 0, max: 8, step: 1, value: v, class: "sb-drawbar", "aria-label": p.de, orient: "vertical" });
  const val = h("span", { class: "sb-kval", text: String(v) });
  inp.addEventListener("input", () => { val.textContent = inp.value; onChange(+inp.value); });
  const w = h("div", { class: "sb-dbar" }, inp, h("label", { for: id, class: "sb-klab", text: EN ? p.en : p.de }), val);
  w.setValue = (x) => { inp.value = x; val.textContent = String(x); };
  return w;
}
function renderLearn() {
  const e = q("#sbLearnInfo"); if (!e) return;
  const n = Object.keys(S.map).length;
  e.textContent = S.learn ? (S.learnTarget ? T("Jetzt am Keyboard drehen/drücken für „", "Now move/press on the keyboard for “") + S.learnTarget.label + T("“ …", "” …") : T("Regler anklicken, der gelernt werden soll.", "Click the knob to learn."))
    : n ? n + T(" gelernte MIDI-Zuordnungen", " learned MIDI mappings") : "";
  if (!S.learn) qa(".sb-knob.learning").forEach(x => x.classList.remove("learning"));
  if (S.learn && n) {
    if (!q("#sbLearnClear")) e.after(h("button", { id: "sbLearnClear", type: "button", class: "ghost btn-s", text: T("Zuordnungen löschen", "Clear mappings"), onclick: () => { S.map = {}; lsSet(LS_MAP, S.map); renderLearn(); q("#sbLearnClear").remove(); } }));
  }
}
function renderPadPanel(bodyIn) {
  const t = curTrack(); if (!t || t.kind !== "drums") return;
  const body = bodyIn || q("#sbEBody"); if (!body) return;
  let box = q("#sbPadPanel", body);
  if (!box) { box = h("section", { id: "sbPadPanel", class: "sb-panel sb-padpanel" }); body.append(box); }
  box.innerHTML = "";
  const kitSel = h("select", { id: "sbKit", "aria-label": T("Kit", "Kit") }, [...KIT_ORDER, ...Object.keys(KITS).filter(k => !KIT_ORDER.includes(k))].filter(k => KITS[k])
    .map(k => h("option", { value: k, selected: k === t.patch.kitName }, EN ? KITS[k].en : KITS[k].de)));
  kitSel.onchange = () => { snap(); t.patch.kit = JSON.parse(JSON.stringify(KITS[kitSel.value].kit)); t.patch.kitName = kitSel.value; post({ t: "patch", tr: t.id, patch: t.patch }); changed("none"); renderEditor(); };
  const pads = h("div", { class: "sb-pads" });
  t.patch.kit.forEach((k, i) => {
    const nm = DRUM_MODELS.find(d => d[0] === k.model);
    const b = h("button", { type: "button", class: "sb-padbtn" + (i === S.pad ? " on" : ""), text: nm ? (EN ? nm[2] : nm[1]) : k.model });
    b.onpointerdown = () => { S.pad = i; ensureAudio().then(() => post({ t: "note", tr: t.id, n: i, v: 0.9, on: true })); renderPadPanel(); };
    pads.append(b);
  });
  const k = t.patch.kit[S.pad] || {};
  const msel = h("select", { "aria-label": T("Klang des Pads", "Pad sound") }, DRUM_MODELS.map(([v, de, en]) => h("option", { value: v, selected: v === k.model }, EN ? en : de)));
  msel.onchange = () => { setParam(t, "v" + S.pad + ".model", msel.value); renderPadPanel(); };
  const ctl = h("div", { class: "sb-ctl" });
  for (const p of PAD_PARAMS) { const kk = "v" + S.pad + "." + p.k; const w = knob(p, k[p.k] ?? p.def, (v) => setParam(t, kk, v), { learn: { kind: "param", tr: "*", k: kk } }); w.dataset.pk = kk; ctl.append(w); }
  box.append(h("h4", { text: T("Kit & Pads", "Kit & pads") }), h("div", { class: "sb-row" }, h("label", { class: "sb-cap", for: "sbKit", text: "Kit" }), kitSel),
    pads, h("div", { class: "sb-row" }, h("b", { text: T("Pad ", "Pad ") + (S.pad + 1) }), msel), ctl);
}

// ---------- Effekte der Spur + gemeinsame Effekte ----------
function renderFx(body, t) {
  const sec = (title, kids) => h("section", { class: "sb-panel" }, h("h4", { text: title }), h("div", { class: "sb-ctl" }, kids));
  const tk = (p, v, set) => knob(p, v, (x) => { set(x); applyAllTracks(); changed("none"); }, { learn: { kind: "track", tr: t.id, k: p.k } });
  const fx = S.project.fx;
  const gk = (p, v, set, rebuildIR) => knob(p, v, (x) => { set(x); if (S.g) { applyFx(S.g, S.project); if (rebuildIR) { clearTimeout(S.irT); S.irT = setTimeout(() => { S.g.rev.buffer = makeIR(S.ctx, fx.revSize, fx.revDecay); }, 250); } } changed("none"); });
  const dsel = h("select", { "aria-label": T("Echo-Zeit", "Delay time") }, Object.keys(SYNC_STEPS).map(k => h("option", { value: k, selected: k === fx.dlyTime }, k)));
  dsel.onchange = () => { fx.dlyTime = dsel.value; if (S.g) applyFx(S.g, S.project); changed("none"); };
  body.append(h("div", { class: "sb-panels" },
    sec(T("Klangregelung der Spur", "Track EQ"), [
      tk({ k: "eqlo", de: "Bässe", en: "Low", min: -12, max: 12, def: 0, u: "dB", st: 0.5 }, t.eq.lo, (v) => (t.eq.lo = v)),
      tk({ k: "eqmid", de: "Mitten", en: "Mid", min: -12, max: 12, def: 0, u: "dB", st: 0.5 }, t.eq.mid, (v) => (t.eq.mid = v)),
      tk({ k: "eqhi", de: "Höhen", en: "High", min: -12, max: 12, def: 0, u: "dB", st: 0.5 }, t.eq.hi, (v) => (t.eq.hi = v)),
      tk({ k: "chorus", de: "Chorus / Ensemble", en: "Chorus / ensemble", min: 0, max: 1, def: 0, u: "%" }, t.chorus || 0, (v) => (t.chorus = v))]),
    sec(T("Hall (alle Spuren)", "Reverb (all tracks)"), [
      gk({ k: "revSize", de: "Raumgröße", en: "Room size", min: 0, max: 1, def: 0.55, u: "%" }, fx.revSize, (v) => (fx.revSize = v), true),
      gk({ k: "revDecay", de: "Nachhall", en: "Decay", min: 0.4, max: 8, def: 2.2, c: "exp", u: "s" }, fx.revDecay, (v) => (fx.revDecay = v), true)]),
    sec(T("Echo (alle Spuren)", "Delay (all tracks)"), [
      h("div", { class: "sb-field" }, h("span", { text: T("Zeit (im Takt)", "Time (synced)") }), dsel),
      gk({ k: "dlyFb", de: "Wiederholungen", en: "Feedback", min: 0, max: 0.9, def: 0.35, u: "%" }, fx.dlyFb, (v) => (fx.dlyFb = v)),
      gk({ k: "dlyTone", de: "Ton", en: "Tone", min: 0, max: 1, def: 0.5, u: "%" }, fx.dlyTone, (v) => (fx.dlyTone = v))]),
    sec(T("Summe", "Master"), [
      knob({ k: "mvol", de: "Gesamtpegel", en: "Master level", min: -24, max: 6, def: 0, u: "dB", st: 0.5 }, S.project.master.vol, (v) => { S.project.master.vol = v; if (S.g) S.g.mvol.gain.setTargetAtTime(dbGain(v), S.ctx.currentTime, 0.02); changed("none"); }),
      h("p", { class: "sub small", text: T("Am Ende sitzt ein Limiter bei −1,5 dBFS — nichts übersteuert, auch nicht im fertigen Track.", "A limiter at −1.5 dBFS sits at the end — nothing clips, not in the finished track either.") })]),
  ));
}

// ---------- Pianoroll ----------
function renderPianoRoll(body, t) {
  const bar = h("div", { class: "sb-row sb-prbar" });
  const gsel = h("select", { "aria-label": T("Raster", "Grid") }, [[4, "1/4"], [2, "1/8"], [1, "1/16"], [0.5, "1/32"]].map(([v, l]) => h("option", { value: v, selected: +v === S.grid }, T("Raster ", "Grid ") + l)));
  gsel.onchange = () => { S.grid = +gsel.value; paintEditor(); };
  const lsel = h("select", { "aria-label": T("Länge neuer Noten", "New note length") }, [[0.5, "1/32"], [1, "1/16"], [2, "1/8"], [4, "1/4"], [8, "1/2"], [16, T("1 Takt", "1 bar")]].map(([v, l]) => h("option", { value: v, selected: +v === S.len }, T("Note ", "Note ") + l)));
  lsel.onchange = () => { S.len = +lsel.value; };
  const vel = h("input", { id: "sbVel", type: "range", min: 0.05, max: 1, step: 0.01, value: S.noteSel ? S.noteSel.v : S.vel, "aria-label": T("Anschlag", "Velocity") });
  vel.oninput = () => { if (S.noteSel) { S.noteSel.v = +vel.value; changed(); paintEditor(); } else S.vel = +vel.value; };
  const op = (label, title, fn) => h("button", { type: "button", class: "ghost btn-s", text: label, title, onclick: fn });
  bar.append(gsel, lsel, h("label", { class: "sb-cap", for: "sbVel", text: T("Anschlag", "Velocity") }), vel,
    op(T("⇥ Quantisieren", "⇥ Quantize"), T("Alle Noten dieser Spur aufs Raster", "Snap all notes of this track to the grid"), () => { snap(); for (const n of notesOf(t.id)) { n.s = Math.round(n.s / S.grid) * S.grid; n.l = Math.max(S.grid, Math.round(n.l / S.grid) * S.grid); } changed(); paintEditor(); }),
    op("−12", T("Eine Oktave tiefer", "One octave down"), () => transpose(t, -12)), op("−1", T("Halbton tiefer", "Semitone down"), () => transpose(t, -1)),
    op("+1", T("Halbton höher", "Semitone up"), () => transpose(t, 1)), op("+12", T("Eine Oktave höher", "One octave up"), () => transpose(t, 12)),
    op(T("Leeren", "Clear"), T("Alle Noten dieser Spur im Pattern löschen", "Delete all notes of this track in the pattern"), () => { snap(); curPat().notes[t.id] = []; S.noteSel = null; changed(); paintEditor(); }),
    op("↶", T("Rückgängig (⌘Z)", "Undo (⌘Z)"), () => undo(true)));
  const wrap = h("div", { class: "sb-roll", id: "sbRoll" });
  const keys = h("canvas", { class: "sb-rkeys", id: "sbRKeys", width: "44", height: "10" });
  const sc = h("div", { class: "sb-rscroll", id: "sbRScroll" });
  const cv = h("canvas", { id: "sbRoll2", class: "sb-rgrid", width: "10", height: "10", "aria-label": T("Pianoroll: klicken = Note setzen, ziehen = Länge, Doppelklick = löschen", "Piano roll: click = add note, drag = length, double-click = delete") });
  sc.append(cv); wrap.append(keys, sc);
  body.append(bar, wrap, h("p", { class: "sub small", text: T("Klicken setzt eine Note, Ziehen nach rechts macht sie länger, eine Note ziehen verschiebt sie, Doppelklick oder Entf löscht. ● nimmt auf, was du spielst — in Schleife, Schicht über Schicht.",
    "Click adds a note, drag right to lengthen, drag a note to move it, double-click or Delete removes it. ● records what you play — looping, layer upon layer.") }));
  setupRoll(t);
  paintEditor();
  // zur Mitte der Noten scrollen
  const ns = notesOf(t.id); const mid = ns.length ? Math.round(ns.reduce((a, n) => a + n.n, 0) / ns.length) : 60;
  const rowH = 12; wrap.scrollTop = Math.max(0, (S.pr.hi - mid - 10) * rowH);
}
function transpose(t, d) { snap(); for (const n of notesOf(t.id)) n.n = clamp(n.n + d, 0, 127); changed(); paintEditor(); }
const ROW = 12;
function rollGeom() {
  const sc = q("#sbRScroll"), steps = patSteps();
  const avail = Math.max(300, (sc ? sc.clientWidth : 600));
  const cw = Math.max(14, Math.floor(avail / steps));
  return { steps, cw, rows: S.pr.hi - S.pr.lo + 1, w: cw * steps, hgt: (S.pr.hi - S.pr.lo + 1) * ROW };
}
function setupRoll(t) {
  const cv = q("#sbRoll2"); if (!cv) return;
  let act = null;
  const at = (e) => { const r = cv.getBoundingClientRect(); const G = rollGeom(); const x = e.clientX - r.left, y = e.clientY - r.top;
    return { step: x / G.cw, n: S.pr.hi - Math.floor(y / ROW), x, y, G }; };
  const hit = (p) => { const ns = notesOf(t.id); for (let i = ns.length - 1; i >= 0; i--) { const n = ns[i]; if (n.n === p.n && p.step >= n.s && p.step < n.s + n.l) return n; } return null; };
  cv.addEventListener("pointerdown", (e) => {
    e.preventDefault(); cv.setPointerCapture(e.pointerId);
    const p = at(e), n = hit(p);
    if (n) {
      S.noteSel = n; const edge = (n.s + n.l - p.step) * p.G.cw < 7;
      snap(); act = { mode: edge ? "len" : "move", n, ds: p.step - n.s, n0: n.n, s0: n.s };
      if (!edge) audition(t, n.n, n.v);
    } else {
      snap();
      const s = Math.floor(p.step / S.grid) * S.grid;
      const nn = { s, l: S.len, n: p.n, v: +(q("#sbVel") || { value: S.vel }).value || S.vel };
      notesOf(t.id).push(nn); S.noteSel = nn; act = { mode: "len", n: nn, created: true };
      audition(t, nn.n, nn.v);
    }
    const vel = q("#sbVel"); if (vel && S.noteSel) vel.value = S.noteSel.v;
    paintEditor();
  });
  cv.addEventListener("pointermove", (e) => {
    if (!act) { const p = at(e), n = hit(p); cv.style.cursor = n ? ((n.s + n.l - p.step) * p.G.cw < 7 ? "ew-resize" : "grab") : "crosshair"; return; }
    const p = at(e), n = act.n, steps = p.G.steps;
    if (act.mode === "len") { const end = Math.max(n.s + S.grid / 2, Math.ceil(p.step / S.grid) * S.grid); n.l = clamp(Math.round((end - n.s) * 1000) / 1000, S.grid / 2, steps - n.s); }
    else { const s = clamp(Math.round((p.step - act.ds) / S.grid) * S.grid, 0, steps - S.grid / 2); const nn = clamp(p.n, S.pr.lo, S.pr.hi);
      if (nn !== n.n) audition(t, nn, n.v); n.s = s; n.n = nn; }
    paintEditor();
  });
  const up = () => { if (act) { act = null; changed(); } };
  cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
  cv.addEventListener("dblclick", (e) => { const n = hit(at(e)); if (n) { snap(); curPat().notes[t.id] = notesOf(t.id).filter(x => x !== n); S.noteSel = null; changed(); paintEditor(); } });
  cv.addEventListener("contextmenu", (e) => { e.preventDefault(); const n = hit(at(e)); if (n) { snap(); curPat().notes[t.id] = notesOf(t.id).filter(x => x !== n); S.noteSel = null; changed(); paintEditor(); } });
  const keys = q("#sbRKeys");
  keys.addEventListener("pointerdown", (e) => { const r = keys.getBoundingClientRect(); const n = S.pr.hi - Math.floor((e.clientY - r.top) / ROW); S.rollKey = n; noteOn(n, S.vel); });
  const kup = () => { if (S.rollKey != null) { noteOff(S.rollKey); S.rollKey = null; } };
  keys.addEventListener("pointerup", kup); keys.addEventListener("pointerleave", kup);
}
function deleteSelNote() {
  const t = curTrack(); if (!t || !S.noteSel) return;
  snap(); curPat().notes[t.id] = notesOf(t.id).filter(x => x !== S.noteSel); S.noteSel = null; changed(); paintEditor();
}
let audT = 0;
function audition(t, n, v) {
  ensureAudio().then(() => { post({ t: "note", tr: t.id, n, v, on: true }); clearTimeout(audT); const nn = n; audT = setTimeout(() => post({ t: "note", tr: t.id, n: nn, on: false }), 220); });
}
function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim() || "#888"; }
function paintEditor() {
  const t = curTrack(); if (!t) return;
  if (t.kind === "drums") { paintGrid(); return; }
  const cv = q("#sbRoll2"); if (!cv) return;
  const G = rollGeom(), dpr = window.devicePixelRatio || 1;
  cv.style.width = G.w + "px"; cv.style.height = G.hgt + "px"; cv.width = G.w * dpr; cv.height = G.hgt * dpr;
  const x = cv.getContext("2d"); x.setTransform(dpr, 0, 0, dpr, 0, 0);
  const line = css("--line"), panel = css("--panel"), panel2 = css("--panel2"), sub = css("--sub");
  for (let n = S.pr.hi, r = 0; n >= S.pr.lo; n--, r++) { const black = [1, 3, 6, 8, 10].includes(n % 12); x.fillStyle = black ? "#0e101b" : "#1a1e33"; x.fillRect(0, r * ROW, G.w, ROW);
    if (n % 12 === 0) { x.fillStyle = "#3a4166"; x.fillRect(0, r * ROW + ROW - 1, G.w, 1); } }
  for (let s = 0; s <= G.steps; s += Math.min(1, S.grid)) {      // Takt hell, Schlag mittel, Raster schwach
    const X = Math.round(s * G.cw) + 0.5; x.strokeStyle = s % 16 === 0 ? sub : "#4a5280"; x.globalAlpha = s % 16 === 0 ? 0.9 : s % 4 === 0 ? 0.75 : s % S.grid === 0 ? 0.3 : 0;
    x.beginPath(); x.moveTo(X, 0); x.lineTo(X, G.hgt); x.stroke();
  }
  x.globalAlpha = 1;
  // die anderen Spuren blass dahinter (Orientierung)
  for (const o of S.project.tracks) { if (o.id === t.id || o.kind === "drums") continue; x.fillStyle = o.color; x.globalAlpha = 0.13;
    for (const n of (curPat().notes[o.id] || [])) { const r = S.pr.hi - n.n; if (r < 0 || n.n < S.pr.lo) continue; x.fillRect(n.s * G.cw, r * ROW + 3, n.l * G.cw, ROW - 6); } }
  x.globalAlpha = 1;
  for (const n of notesOf(t.id)) {
    const r = S.pr.hi - n.n; if (r < 0 || n.n < S.pr.lo) continue;
    x.globalAlpha = 0.45 + 0.55 * n.v; x.fillStyle = t.color;
    const X = n.s * G.cw + 1, W = Math.max(3, n.l * G.cw - 2);
    roundRect(x, X, r * ROW + 1, W, ROW - 2, 3); x.fill();
    if (n === S.noteSel) { x.globalAlpha = 1; x.strokeStyle = css("--ink"); x.lineWidth = 1.5; roundRect(x, X, r * ROW + 1, W, ROW - 2, 3); x.stroke(); }
  }
  x.globalAlpha = 1;
  // Tasten links
  const k = q("#sbRKeys"); if (k) { k.style.height = G.hgt + "px"; k.width = 44 * dpr; k.height = G.hgt * dpr; const y = k.getContext("2d"); y.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (let n = S.pr.hi, r = 0; n >= S.pr.lo; n--, r++) { const black = [1, 3, 6, 8, 10].includes(n % 12); const down = [...S.held.values()].includes(n);
      y.fillStyle = down ? t.color : black ? "#1a1d2e" : "#dfe4f5"; y.fillRect(0, r * ROW, black ? 30 : 44, ROW - 1);
      if (n % 12 === 0) { y.fillStyle = "#0a0b12"; y.font = "9px ui-sans-serif,system-ui"; y.fillText(noteName(n), 26, r * ROW + 9); } } }
  paintPlayhead();
}
function roundRect(x, X, Y, W, H, r) { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + W, Y, X + W, Y + H, r); x.arcTo(X + W, Y + H, X, Y + H, r); x.arcTo(X, Y + H, X, Y, r); x.arcTo(X, Y, X + W, Y, r); x.closePath(); }
function paintPlayhead() {
  const ph = q("#sbHead") || (() => { const sc = q("#sbRScroll") || q("#sbGridScroll"); if (!sc) return null; const d = h("div", { id: "sbHead", class: "sb-head-line" }); sc.append(d); return d; })();
  if (!ph) return;
  const t = curTrack();
  const show = S.playing && S.step >= 0 && S.playPat === S.pat;
  ph.style.display = show ? "block" : "none";
  if (!show) return;
  const cw = t && t.kind === "drums" ? gridCw() : rollGeom().cw;
  ph.style.transform = `translateX(${(S.step + (t && t.kind === "drums" ? 0 : 0)) * cw + (t && t.kind === "drums" ? GRID_LABEL : 0)}px)`;
  ph.style.width = cw + "px";
}

// ---------- Drum-Raster ----------
const GRID_LABEL = 112;
function gridCw() { const sc = q("#sbGridScroll"); const steps = patSteps(); return Math.max(18, Math.floor(((sc ? sc.clientWidth : 700) - GRID_LABEL) / Math.min(steps, 32))); }
function renderDrumGrid(body, t) {
  const bar = h("div", { class: "sb-row" },
    h("span", { class: "sub small", text: T("Klick = Schlag · Umschalt-Klick = Akzent · Alt-Klick = leise · Ziehen malt", "Click = hit · Shift-click = accent · Alt-click = soft · Drag paints") }),
    h("button", { type: "button", class: "ghost btn-s", text: T("Leeren", "Clear"), onclick: () => { snap(); curPat().notes[t.id] = []; changed(); paintGrid(); } }),
    h("button", { type: "button", class: "ghost btn-s", text: "↶", title: T("Rückgängig (⌘Z)", "Undo (⌘Z)"), onclick: () => undo(true) }));
  const sc = h("div", { class: "sb-gridscroll", id: "sbGridScroll" });
  const grid = h("div", { class: "sb-grid", id: "sbGrid" });
  sc.append(grid);
  body.append(bar, sc);
  const steps = patSteps();
  t.patch.kit.forEach((k, i) => {
    const nm = DRUM_MODELS.find(d => d[0] === k.model);
    const lab = h("button", { type: "button", class: "sb-glab" + (i === S.pad ? " on" : ""), text: nm ? (EN ? nm[2] : nm[1]) : k.model, title: T("Anhören und Pad wählen", "Listen and select pad") });
    lab.onpointerdown = () => { S.pad = i; ensureAudio().then(() => post({ t: "note", tr: t.id, n: i, v: 0.9, on: true })); qa(".sb-glab").forEach((b, j) => b.classList.toggle("on", j === i)); };
    const row = h("div", { class: "sb-grow", "data-pad": i }, lab);
    for (let s = 0; s < steps; s++) row.append(h("button", { type: "button", class: "sb-cell" + (s % 4 === 0 ? " beat" : "") + (Math.floor(s / 4) % 2 ? " odd" : ""), "data-s": s, "aria-label": `${nm ? nm[1] : k.model} ${s + 1}` }));
    grid.append(row);
  });
  let paint = null;
  const cellAt = (e) => { const el = document.elementFromPoint(e.clientX, e.clientY); return el && el.classList.contains("sb-cell") ? el : null; };
  const apply = (cell, mode, v) => {
    const pad = +cell.parentNode.dataset.pad, s = +cell.dataset.s, ns = notesOf(t.id);
    const ex = ns.find(n => n.n === pad && Math.abs(n.s - s) < 0.01);
    if (mode === "on") { if (ex) ex.v = v; else ns.push({ s, l: 1, n: pad, v }); }
    else if (ex) curPat().notes[t.id] = ns.filter(n => n !== ex);
  };
  grid.addEventListener("pointerdown", (e) => {
    const cell = e.target.closest(".sb-cell"); if (!cell) return;
    e.preventDefault(); snap();
    const pad = +cell.parentNode.dataset.pad, s = +cell.dataset.s;
    const ex = notesOf(t.id).find(n => n.n === pad && Math.abs(n.s - s) < 0.01);
    const v = e.shiftKey ? 1 : e.altKey ? 0.45 : 0.82;
    paint = { mode: ex && !e.shiftKey && !e.altKey ? "off" : "on", v };
    apply(cell, paint.mode, v);
    if (paint.mode === "on") ensureAudio().then(() => post({ t: "note", tr: t.id, n: pad, v, on: true }));
    paintGrid(); grid.setPointerCapture(e.pointerId);
  });
  grid.addEventListener("pointermove", (e) => { if (!paint) return; const c = cellAt(e); if (c) { apply(c, paint.mode, paint.v); paintGrid(); } });
  const up = () => { if (paint) { paint = null; changed(); } };
  grid.addEventListener("pointerup", up); grid.addEventListener("pointercancel", up);
  paintGrid();
}
function paintGrid() {
  const t = curTrack(); const grid = q("#sbGrid"); if (!grid || !t) return;
  const cw = gridCw();
  grid.style.setProperty("--cw", cw + "px");
  const on = new Map();
  for (const n of notesOf(t.id)) on.set(n.n + ":" + Math.round(n.s), n.v);
  qa(".sb-grow", grid).forEach(row => {
    const pad = row.dataset.pad;
    qa(".sb-cell", row).forEach(c => { const v = on.get(pad + ":" + c.dataset.s); c.classList.toggle("on", v != null); c.style.setProperty("--v", v == null ? 0 : v); c.classList.toggle("acc", v != null && v > 0.95); });
  });
  paintPlayhead();
}

// ---------- Tastatur am Bildschirm ----------
function renderKeys() {
  const el = q("#sbKeys"); if (!el) return;
  el.innerHTML = "";
  const t = curTrack();
  const oct = h("div", { class: "sb-row" },
    h("b", { class: "sb-cap", text: T("Spielen", "Play") }),
    h("span", { id: "sbKbInfo", class: "sub small" }),
    h("span", { class: "spacer" }),
    h("span", { class: "sb-wheels" },
      h("label", { class: "sb-cap", for: "sbBendW", text: "Pitch" }), h("input", { id: "sbBendW", type: "range", min: -1, max: 1, step: 0.01, value: 0, class: "sb-wheel" }),
      h("label", { class: "sb-cap", for: "sbModW", text: "Mod" }), h("input", { id: "sbModW", type: "range", min: 0, max: 1, step: 0.01, value: 0, class: "sb-wheel" })));
  const octs = kbOctaves();
  const kb = h("div", { class: "sb-kb", id: "sbKb", "aria-label": T("Tastatur", "Keyboard"), "data-oct": String(S.octave), "data-octs": String(octs) });
  el.append(oct, kb);
  const bw = q("#sbBendW"), mw = q("#sbModW");
  bw.oninput = () => { const tt = curTrack(); if (tt) post({ t: "bend", tr: tt.id, v: +bw.value }); };
  bw.onchange = bw.onpointerup = () => { bw.value = 0; const tt = curTrack(); if (tt) post({ t: "bend", tr: tt.id, v: 0 }); };
  mw.oninput = () => { const tt = curTrack(); if (tt) post({ t: "mod", tr: tt.id, v: +mw.value }); };
  const lo = (octs >= 4 ? 36 : 48) + S.octave * 12, n0 = lo, n1 = lo + octs * 12;
  const whites = []; for (let n = n0; n <= n1; n++) if (![1, 3, 6, 8, 10].includes(n % 12)) whites.push(n);
  const W = 100 / whites.length;
  let wi = 0;
  for (let n = n0; n <= n1; n++) {
    const black = [1, 3, 6, 8, 10].includes(n % 12);
    const k = h("button", { type: "button", class: "sb-key" + (black ? " b" : " w"), "data-n": n, tabindex: "-1", "aria-label": noteName(n) });
    if (black) k.style.left = `calc(${wi * W}% - ${W * 0.3}%)`, k.style.width = `${W * 0.6}%`;
    else { k.style.left = `${wi * W}%`; k.style.width = `${W}%`; if (n % 12 === 0) k.append(h("span", { text: noteName(n) })); wi++; }
    kb.append(k);
  }
  let down = null;
  const kn = (e) => { const el2 = document.elementFromPoint(e.clientX, e.clientY); const k = el2 && el2.closest && el2.closest(".sb-key"); return k ? +k.dataset.n : null; };
  const vy = (e, k) => { const r = k.getBoundingClientRect(); return clamp(0.35 + 0.65 * (e.clientY - r.top) / r.height, 0.2, 1); };
  kb.addEventListener("pointerdown", (e) => { const n = kn(e); if (n == null) return; e.preventDefault(); kb.setPointerCapture(e.pointerId); down = n; noteOn(n, vy(e, e.target.closest(".sb-key"))); });
  kb.addEventListener("pointermove", (e) => { if (down == null) return; const n = kn(e); if (n != null && n !== down) { noteOff(down); down = n; noteOn(n, S.vel); } });
  const up = () => { if (down != null) { noteOff(down); down = null; } };
  kb.addEventListener("pointerup", up); kb.addEventListener("pointercancel", up);
  renderKbInfo(); paintKeys();
  if (t && t.kind === "drums") el.classList.add("drums"); else el.classList.remove("drums");
}
// 3 Oktaven am Handy, 4 am Laptop, 5 (61 Tasten, C2–C7 wie ein Keystation 61) auf breiten Monitoren
function kbOctaves() { const w = (q("#sbKeys") || {}).clientWidth || innerWidth; return w >= 1250 ? 5 : w >= 860 ? 4 : 3; }
function renderKbInfo() {
  const e = q("#sbKbInfo"); if (!e) return;
  const t = curTrack();
  const midi = S.midiState === "ok";
  const ger = !EN;
  const keys = ger ? "A W S E D F T G Z H U J K" : "A W S E D F T G Y H U J K";
  e.textContent = (t ? T("→ ", "→ ") + t.name + " · " : "") + (midi ? T("MIDI-Keyboard bereit · ", "MIDI keyboard ready · ") : "") +
    (t && t.kind === "drums" ? T("Computertastatur: A S D F … = Pads", "Computer keyboard: A S D F … = pads")
      : T(`Computertastatur: ${keys} = C … C · ${ger ? "Y" : "Z"}/X Oktave (${S.octave >= 0 ? "+" : ""}${S.octave}) · C/V Anschlag ${Math.round(S.vel * 100)} %`,
        `Computer keyboard: ${keys} = C … C · Z/X octave (${S.octave >= 0 ? "+" : ""}${S.octave}) · C/V velocity ${Math.round(S.vel * 100)} %`)) +
    T(" · Leertaste = Start/Stopp", " · Space = play/stop");
  if (q("#sbKb") && q("#sbKb").dataset.oct !== String(S.octave)) { q("#sbKb").dataset.oct = String(S.octave); if (q("#sbKb").children.length) renderKeys(); }
}
function paintKeys() {
  const held = new Set(S.held.keys());
  qa("#sbKb .sb-key").forEach(k => k.classList.toggle("down", held.has(+k.dataset.n)));
  const t = curTrack(); if (t && t.kind !== "drums" && S.tab === "notes") { const k = q("#sbRKeys"); if (k) paintEditor(); }
}
function setWheel(w, v) { const e = q(w === "mod" ? "#sbModW" : "#sbBendW"); if (e) e.value = v; }

// ---------- Song ----------
function songSteps() { return S.project.song.reduce((a, e) => a + Math.max(1, e.r) * patSteps(e.p), 0); }
function fmtDur(sec) { const m = Math.floor(sec / 60), s = Math.round(sec % 60); return m + ":" + String(s).padStart(2, "0"); }
function renderSong() {
  const el = q("#sbSong"); if (!el) return;
  el.innerHTML = "";
  const P = S.project;
  const sec = songSteps() * 60 / P.bpm / 4;
  el.append(h("div", { class: "sb-head" }, h("h3", { text: T("🧩 Song", "🧩 Song") }), h("span", { class: "sub small", text: P.song.length ? T("Länge ", "Length ") + fmtDur(sec) : "" }),
    h("button", { type: "button", class: "ghost btn-s", text: T("▶︎ Song spielen", "▶︎ Play song"), onclick: () => { S.songMode = true; play(true); } })));
  const list = h("div", { class: "sb-songlist", id: "sbSongList" });
  P.song.forEach((e, i) => {
    const ps = h("select", { "aria-label": T("Pattern", "Pattern") }, Object.keys(P.patterns).sort().map(L => h("option", { value: L, selected: L === e.p }, L)));
    ps.onchange = () => { snap(); e.p = ps.value; changed(); renderSong(); };
    const rep = h("input", { type: "number", min: 1, max: 64, value: e.r, class: "sb-rep", "aria-label": T("Wiederholungen", "Repeats") });
    rep.onchange = () => { snap(); e.r = clamp(Math.round(+rep.value || 1), 1, 64); rep.value = e.r; changed(); renderSong(); };
    list.append(h("div", { class: "sb-sitem" + (S.playing && S.songMode && S.songIdx === i ? " playing" : ""), "data-i": i },
      h("span", { class: "sb-snum", text: String(i + 1) }), ps, h("span", { text: "×" }), rep,
      h("button", { type: "button", class: "ghost btn-s", text: "↑", disabled: i === 0, title: T("Früher", "Earlier"), onclick: () => { snap(); [P.song[i - 1], P.song[i]] = [P.song[i], P.song[i - 1]]; changed(); renderSong(); } }),
      h("button", { type: "button", class: "ghost btn-s", text: "↓", disabled: i === P.song.length - 1, title: T("Später", "Later"), onclick: () => { snap(); [P.song[i + 1], P.song[i]] = [P.song[i], P.song[i + 1]]; changed(); renderSong(); } }),
      h("button", { type: "button", class: "ghost btn-s danger", text: "✕", title: T("Entfernen", "Remove"), onclick: () => { snap(); P.song.splice(i, 1); changed(); renderSong(); renderBounce(); } })));
  });
  el.append(list, h("button", { type: "button", class: "ghost btn-s", text: T("＋ Teil anhängen", "＋ Add part"), onclick: () => { snap(); P.song.push({ p: S.pat, r: 2 }); changed(); renderSong(); renderBounce(); } }),
    h("p", { class: "sub small", text: T("Ein Song ist eine Folge von Pattern. Im Loop-Modus spielt nur das gewählte Pattern.", "A song is a chain of patterns. Loop mode plays only the selected pattern.") }));
}
function paintSongPos() { qa("#sbSongList .sb-sitem").forEach(r => r.classList.toggle("playing", S.playing && S.songMode && +r.dataset.i === S.songIdx)); }

// ---------- Track erzeugen ----------
function renderBounce() {
  const el = q("#sbBounce"); if (!el) return;
  el.innerHTML = "";
  const P = S.project;
  const what = h("select", { id: "sbBWhat", "aria-label": T("Was", "What") },
    h("option", { value: "song", disabled: !P.song.length, selected: !!P.song.length }, T("den ganzen Song", "the whole song")),
    ...[1, 2, 4, 8].map(n => h("option", { value: "pat" + n, selected: !P.song.length && n === 4 }, T(`Pattern ${S.pat} × ${n}`, `pattern ${S.pat} × ${n}`))));
  const title = h("input", { id: "sbBTitle", type: "text", maxlength: "80", value: (P.name || "").replace(/ \((Demo|demo)\)$/, ""), placeholder: T("Titel", "Title") });
  const genre = h("input", { id: "sbBGenre", type: "text", maxlength: "60", value: P.genre || "", placeholder: T("z. B. Synthwave", "e.g. synthwave") });
  genre.onchange = () => { P.genre = genre.value.trim().slice(0, 60); changed("none"); };
  const keyIn = h("input", { id: "sbBKey", type: "text", maxlength: "16", value: P.key || "", placeholder: T("z. B. A minor", "e.g. A minor") });
  keyIn.onchange = () => { P.key = keyIn.value.trim().slice(0, 16); changed("none"); };
  const tail = h("select", { id: "sbBTail", "aria-label": T("Ausklang", "Tail") }, [[1, "1 s"], [3, "3 s"], [6, "6 s"]].map(([v, l]) => h("option", { value: v, selected: v === 3 }, T("Ausklang ", "Tail ") + l)));
  const go = h("button", { id: "sbBGo", type: "button", class: "primary", text: T("🎵 Track erzeugen", "🎵 Create track") });
  const msg = h("span", { id: "sbBMsg", class: "status", role: "status" });
  go.onclick = () => bounce();
  el.append(h("div", { class: "sb-head" }, h("h3", { text: T("🎵 Track erzeugen", "🎵 Create track") })),
    h("div", { class: "sb-bgrid" },
      h("label", { class: "lbl" }, T("Titel", "Title"), title),
      h("label", { class: "lbl" }, T("Was", "What"), what),
      h("label", { class: "lbl" }, T("Genre (optional)", "Genre (optional)"), genre),
      h("label", { class: "lbl" }, T("Tonart (optional)", "Key (optional)"), keyIn),
      h("label", { class: "lbl" }, T("Ende", "End"), tail)),
    h("div", { class: "sb-row" }, go, msg),
    // 3.16: ein Projekt aus dem MIDI-Abbild eines KI-Songs bleibt KI — die Noten hat die Musik-KI geschrieben
    P.fromTrack ? h("p", { class: "sub small sb-derived", text: T("🎼 Dieses Projekt beruht auf dem MIDI-Abbild eines KI-Songs. Der Track wird darum als „KI-erzeugt“ gekennzeichnet, nicht als „selbst eingespielt“ — die Komposition stammt von der Musik-KI, auch wenn du Klänge und Noten änderst.",
      "🎼 This project is based on the MIDI image of an AI song. The track is therefore labelled “AI-generated”, not “self-played” — the composition comes from the music AI, even if you change sounds and notes.") })
    : h("p", { class: "sub small", text: T("Der Browser rechnet dein Stück Sample für Sample (schneller als Echtzeit) und legt es in die Bibliothek. Dann kannst du es mastern, exportieren und veröffentlichen wie jeden Track — dein Mac gibt ihm Cover, Tags und Wasserzeichen und vermerkt „selbst eingespielt“ statt „KI-erzeugt“.",
      "The browser renders your piece sample by sample (faster than real time) and puts it in the library. Master, export and publish it like any track — your computer adds cover, tags and watermark and marks it “self-played”, not “AI-generated”.") }));
}
function encodeWav24(buf) {
  const ch = buf.numberOfChannels, n = buf.length, sr = buf.sampleRate, bps = 3;
  const out = new DataView(new ArrayBuffer(44 + n * ch * bps));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); out.setUint32(4, 36 + n * ch * bps, true); w(8, "WAVE"); w(12, "fmt "); out.setUint32(16, 16, true); out.setUint16(20, 1, true);
  out.setUint16(22, ch, true); out.setUint32(24, sr, true); out.setUint32(28, sr * ch * bps, true); out.setUint16(32, ch * bps, true); out.setUint16(34, 24, true);
  w(36, "data"); out.setUint32(40, n * ch * bps, true);
  const data = []; for (let c = 0; c < ch; c++) data.push(buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
    let v = Math.round(clamp(data[c][i], -1, 1) * 8388607); if (v < 0) v += 16777216;
    out.setUint8(o, v & 255); out.setUint8(o + 1, (v >> 8) & 255); out.setUint8(o + 2, (v >> 16) & 255); o += 3;
  }
  return new Blob([out.buffer], { type: "audio/wav" });
}
async function bounce() {
  const P = S.project, go = q("#sbBGo"), msg = q("#sbBMsg");
  const what = q("#sbBWhat").value, tail = +q("#sbBTail").value || 3;
  const title = (q("#sbBTitle").value || P.name || "Track").trim().slice(0, 80);
  const song = what === "song" && P.song.length;
  const loops = song ? 1 : +what.slice(3) || 4;
  const steps = song ? songSteps() : patSteps() * loops;
  if (!steps) { msg.textContent = T("Nichts zu rechnen — der Song ist leer.", "Nothing to render — the song is empty."); return; }
  const anyNotes = Object.values(P.patterns).some(p => Object.values(p.notes).some(a => a.length));
  if (!anyNotes) { msg.textContent = T("Noch keine Noten — spiel oder klick erst etwas ein.", "No notes yet — play or click something in first."); return; }
  if (!window.mwsLibrary) { msg.textContent = T("Bibliothek nicht bereit.", "Library not ready."); return; }
  const secs = steps * 60 / P.bpm / 4 + tail;
  if (secs > 900) { msg.textContent = T("Länger als 15 Minuten — bitte kürzer.", "Longer than 15 minutes — please shorten it."); return; }
  go.disabled = true; msg.textContent = T("Rechne … ", "Rendering … ") + fmtDur(secs);
  const t0 = performance.now();
  try {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const ctx = new OAC(2, Math.ceil(secs * 48000), 48000);
    await ctx.audioWorklet.addModule("selber-engine.js");
    buildGraph(ctx, P, { song: !!song, pattern: S.pat, loops });
    const buf = await ctx.startRendering();
    // stille Nachlaufzeit kürzen (unter −70 dB), aber nie mitten in den Ausklang
    let end = buf.length; const thr = Math.pow(10, -70 / 20); const L = buf.getChannelData(0), R = buf.getChannelData(1);
    const musicEnd = Math.floor((secs - tail) * 48000);
    while (end > musicEnd + 4800 && Math.abs(L[end - 1]) < thr && Math.abs(R[end - 1]) < thr) end--;
    let peak = 0; for (let i = 0; i < end; i++) { const a = Math.max(Math.abs(L[i]), Math.abs(R[i])); if (a > peak) peak = a; }
    if (peak < 1e-4) throw new Error(T("Das Ergebnis ist still — sind alle Spuren stumm?", "The result is silent — are all tracks muted?"));
    const cut = ctx.createBuffer ? ctx.createBuffer(2, end, 48000) : new AudioBuffer({ length: end, numberOfChannels: 2, sampleRate: 48000 });
    cut.getChannelData(0).set(L.subarray(0, end)); cut.getChannelData(1).set(R.subarray(0, end));
    // weiches Ende: letzte 50 ms ausblenden (kein Knacks)
    const fade = Math.min(2400, end); for (let c = 0; c < 2; c++) { const d = cut.getChannelData(c); for (let i = 0; i < fade; i++) d[end - fade + i] *= 1 - i / fade; }
    const blob = encodeWav24(cut);
    const used = P.tracks.filter(t => !t.mute && Object.values(P.patterns).some(p => (p.notes[t.id] || []).length)).map(t => t.name);
    const derived = !!P.fromTrack;            // 3.16: aus dem MIDI-Abbild eines KI-Songs → bleibt KI-gekennzeichnet
    const caption = [P.genre, derived ? "" : "self-played", "synthesizer"].filter(Boolean).join(", ");
    const src = P.name.replace(/ \((MIDI-Abbild|MIDI image)\)$/, "");
    const rec = await window.mwsLibrary.add({
      title, blob, bpm: P.bpm, keyscale: P.key || "", caption, duration: end / 48000, project: P.id, derived,
      note: derived ? T(`Auf den Instrumenten von Manuwave Studio nachgespielt — nach dem MIDI-Abbild des KI-Songs „${src}“ (Komposition KI-erzeugt) — `,
        `Replayed on the Manuwave Studio instruments — from the MIDI image of the AI song “${src}” (composition AI-generated) — `) + used.join(", ")
        : T("Selbst eingespielt in Manuwave Studio — ", "Self-played in Manuwave Studio — ") + used.join(", "),
    });
    msg.textContent = T(`Fertig in ${((performance.now() - t0) / 1000).toFixed(1)} s — „${title}“ liegt in der Bibliothek (${fmtDur(end / 48000)}).`,
      `Done in ${((performance.now() - t0) / 1000).toFixed(1)} s — “${title}” is in the library (${fmtDur(end / 48000)}).`);
    msg.append(" ", h("button", { type: "button", class: "ghost btn-s", text: T("🎚 Zum Mastering", "🎚 To mastering"), onclick: () => window.mwsLibrary.master(rec.id) }));
  } catch (e) {
    msg.textContent = T("Erzeugen fehlgeschlagen: ", "Rendering failed: ") + (e.message || e);
  } finally { go.disabled = false; }
}

// =====================================================================================================
// Start
// =====================================================================================================
async function init() {
  if (S.ready) return;
  S.ready = true;
  S.map = lsGet(LS_MAP, {}) || {};
  const ui = lsGet(LS_UI, {}) || {}; if (ui.tab) S.tab = ui.tab;
  let p = null;
  const last = lsGet(LS_LAST, null);
  try { if (last) p = await dbGet("projects", last); if (!p) { const all = await dbAll("projects"); all.sort((a, b) => (b.changed || 0) - (a.changed || 0)); p = all[0]; } } catch (e) { /* kein IndexedDB */ }
  if (!p) { p = demoProject(EN ? "en" : "de"); p.id = uid(); p.created = p.changed = Date.now(); }
  S.project = fixProject(p);
  try { S.userPresets = await dbAll("presets"); } catch (e) { S.userPresets = []; }
  S.sel = (S.project.tracks.find(t => t.kind !== "drums") || S.project.tracks[0] || {}).id;
  S.pat = Object.keys(S.project.patterns).sort().find(L => L === "B") || Object.keys(S.project.patterns).sort()[0];
  shell(); S.built = true; renderAll();
  if (!last) save();
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("resize", () => {
    if (!tabVisible()) return;
    paintEditor();
    const kb = q("#sbKb"); if (kb && kb.dataset.octs !== String(kbOctaves())) renderKeys();
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden) { for (const n of [...S.held.keys()]) noteOff(n); } });
  initMidi();
}
export function showSelber(on) {
  const v = q("#selberView"); if (!v) return;
  const app = document.getElementById("app"); if (app) app.classList.toggle("sb-wide", !!on);   // 3.16: volle Breite (auch ohne :has)
  if (on) { init().then(() => { paintEditor(); }); }
  else { if (S.held.size) for (const n of [...S.held.keys()]) noteOff(n); }
}
if (tabVisible()) showSelber(true);
window.mwsSelber = { show: showSelber, state: S, stop: () => stop(), buildGraph, fromMidi: async (rec) => { await init(); await fromMidi(rec); }, refreshLib: () => renderFromLib(),
  async open(id) { await init(); if (id && id !== S.project.id) { const p = await dbGet("projects", id).catch(() => null); if (p) { await openProject(id); } else status(T("Das Projekt gibt es in diesem Browser nicht mehr.", "That project no longer exists in this browser.")); } } };
