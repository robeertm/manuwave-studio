// Manuwave Studio 3.17 — "Loop-Maschine": der Takt und alle Generatoren im Audio-Thread (AudioWorklet "mws-loops").
//
// Jeder Generator läuft für sich: man startet ihn, er setzt am nächsten Takt ein und spielt endlos weiter — Beat, Bass,
// Akkorde, Arpeggio und Melodie erfinden ihre Noten selbst (passend zu Tonart und Akkordfolge) und verändern sich von
// Durchgang zu Durchgang so stark, wie "Variation" es sagt. Der Oszillator ist ein freier Klangerzeuger (Dauerton,
// Rauschen, LFO). "Vorgabe" spielt ein paar eingespielte Takte und spinnt sie weiter; "Mikrofon" nimmt im Takt auf
// (Einsingen, Overdub) und spielt die Schleife synchron ab.
// Die Instrumente sind dieselben wie in "Selber machen" (selber-engine.js lädt vorher und legt sie in globalThis.MWS_DSP).
//   Ausgänge 0…11 = je Generator ein Stereo-Bus (Filter, EQ, Echo, Hall baut der Hauptthread mit Web Audio)
//   Ausgang  12   = Metronom (geht nie in eine Aufnahme)
//   Eingang  0    = Mikrofon (nur verbunden, wenn freigegeben)
"use strict";

const D = globalThis.MWS_DSP;
const { makeInstrument, modBlock, busy, Organ, Drums, blep, tanh, clamp, num } = D;
const TAU = Math.PI * 2;
const MAX_GEN = 12, SPB = 16;
const R = () => Math.random();
const pick = (a) => a[Math.floor(R() * a.length) % a.length];
const mod = (a, n) => ((a % n) + n) % n;

// ---------- Tonarten: 7 Stufen; "mel" = erlaubte Töne für Melodien (Pentatonik, Blues) ----------
const SCALES = {
  minor: { s: [0, 2, 3, 5, 7, 8, 10] }, major: { s: [0, 2, 4, 5, 7, 9, 11] }, dorian: { s: [0, 2, 3, 5, 7, 9, 10] },
  phrygian: { s: [0, 1, 3, 5, 7, 8, 10] }, lydian: { s: [0, 2, 4, 6, 7, 9, 11] }, mixolydian: { s: [0, 2, 4, 5, 7, 9, 10] },
  harmonic: { s: [0, 2, 3, 5, 7, 8, 11] }, minpenta: { s: [0, 2, 3, 5, 7, 8, 10], mel: [0, 3, 5, 7, 10] },
  majpenta: { s: [0, 2, 4, 5, 7, 9, 11], mel: [0, 2, 4, 7, 9] }, blues: { s: [0, 2, 3, 5, 7, 8, 10], mel: [0, 3, 5, 6, 7, 10] },
};

// ---------- Beat-Stile: je Pad 16 Zeichen — "." nie, "1"…"9" Wahrscheinlichkeit, "x" immer, "X" immer + Akzent ----------
// Pads wie im Kit: 0 Kick, 1 Snare, 2 Clap, 3 Hi-Hat zu, 4 Hi-Hat offen, 5–7 Toms, 8 Rim, 9 Kuhglocke, 10 Crash, 11 Ride,
// 12 Shaker, 13 Conga, 14 Clave, 15 Zap
const BEATS = {
  house:     { 0: "X...x...X...x...", 2: "....x.......x...", 3: "3.x.3.x.3.x.3.x2", 4: "..2...2...2...3.", 12: "2323232323232323", 8: "......2.......2." },
  techno:    { 0: "X...x...X...x...", 3: "..x...x...x...x.", 4: "..3.......3.....", 8: "...2..3....2..3.", 2: "....3.......3...", 11: "2.2.2.2.2.2.2.2.", 15: "...............2" },
  breakbeat: { 0: "X.....x..x......", 1: "....X.......X..2", 3: "x.x.x.x.x.x.x.x.", 4: "...........2....", 8: "..2.....2......." },
  hiphop:    { 0: "X......x..x..2..", 1: "....X.......X...", 3: "x.x.x.x.x.x.x.x.", 4: "..............3.", 8: ".........2......" },
  trap:      { 0: "X......x..x.....", 2: "........X.......", 1: "........x.......", 3: "xxxxxxxxx3x3xxx3", 4: "..............2.", 5: ".............2.." },
  dnb:       { 0: "X.........x..2..", 1: "....X.......X...", 3: "x.x.x.x.x.x.x.x.", 11: "2...2...2...2...", 8: ".......2......2." },
  lofi:      { 0: "X......3..x.....", 1: "....x.......x...", 3: "x.x.x.x.x.x.x.x.", 12: "..2...2...2...2.", 8: ".......2........" },
  reggaeton: { 0: "X...x...X...x...", 1: "...x..x....x..x.", 3: "x.x.x.x.x.x.x.x.", 14: "...2..2....2..2." },
  pop:       { 0: "X.....x.X.......", 1: "....X.......X...", 3: "x.x.x.x.x.x.x.x.", 4: "..............2.", 12: "2.2.2.2.2.2.2.2." },
  disco:     { 0: "X...x...X...x...", 1: "....x.......x...", 4: "..x...x...x...x.", 3: "x...x...x...x...", 9: "........2......." },
  ambient:   { 0: "X...............", 12: "..2...2...2...2.", 11: "2.......2.......", 13: ".......2.....2.." },
};
const PROB = (ch) => ch === "x" || ch === "X" ? 1 : ch >= "1" && ch <= "9" ? (+ch) / 10 : 0;

// =====================================================================================================
// 3.18: Nachbearbeitung je Generator — Frequenzverschieber (auch gegenläufig links/rechts),
// Vibrato und Ensemble (Unisono-Breite für jeden Klang). Läuft nur, wenn etwas davon an ist.
// =====================================================================================================
// Hilbert-Paar: zwei Ketten aus je vier Allpässen 2. Ordnung, deren Ausgänge über fast den ganzen Hörbereich um 90° versetzt sind
const HA = [0.6923878, 0.9360654322959, 0.9882295226860, 0.9987488452737].map(a => a * a);
const HB = [0.4021921162426, 0.8561710882420, 0.9722909545651, 0.9952884791278].map(a => a * a);
class Hilbert {
  constructor() { this.s = new Float64Array(32); this.d = 0; this.I = 0; this.Q = 0; }
  run(x) {
    const s = this.s; let a = x, b = x;
    for (let k = 0; k < 4; k++) {       // y = c·(x + y[n−2]) − x[n−2]
      let o = k * 4, y = HA[k] * (a + s[o + 3]) - s[o + 1]; s[o + 1] = s[o]; s[o] = a; s[o + 3] = s[o + 2]; s[o + 2] = y; a = y;
      o = 16 + k * 4; y = HB[k] * (b + s[o + 3]) - s[o + 1]; s[o + 1] = s[o]; s[o] = b; s[o + 3] = s[o + 2]; s[o + 2] = y; b = y;
    }
    this.I = this.d; this.d = a; this.Q = b;   // Kette A um ein Sample verzögert = Realteil, Kette B = Imaginärteil
  }
}
const rdLine = (buf, w, d) => { let rp = w - d; while (rp < 0) rp += 4096; const i0 = rp | 0, fr = rp - i0; return buf[i0 & 4095] + (buf[(i0 + 1) & 4095] - buf[i0 & 4095]) * fr; };
class Post {
  constructor(sr) {
    this.sr = sr; this.p = { shift: 0, smix: 0, smode: "up", vib: 0, ens: 0 };
    this.hL = new Hilbert(); this.hR = new Hilbert(); this.ph = 0;
    this.mx = 0; this.vb = 0; this.vk = 0; this.en = 0; this.dl = new Float32Array(4096); this.dr = new Float32Array(4096); this.w = 0; this.vph = 0; this.eph = [0, 0.37, 0.71];
  }
  set(d) { for (const k of ["shift", "smix", "vib", "ens"]) if (d[k] != null) this.p[k] = clamp(num(d[k], 0), k === "shift" ? -2000 : 0, k === "shift" ? 2000 : 1); if (d.smode) this.p.smode = d.smode; }
  active() { const p = this.p; return (p.smix > 0 && p.shift !== 0) || p.vib > 0 || p.ens > 0 || this.mx > 1e-4 || this.vk > 1e-4 || this.en > 1e-4; }
  process(L, R, n) {
    const p = this.p, sr = this.sr, mxT = p.shift !== 0 ? p.smix : 0, dual = p.smode === "dual", sgn = p.smode === "down" ? -1 : 1;
    const dph = Math.abs(p.shift) / sr, vibOn = p.vib > 0 ? 1 : 0, eT = p.ens;
    for (let i = 0; i < n; i++) {
      this.mx += (mxT - this.mx) * 0.002; this.vb += (p.vib - this.vb) * 0.002; this.vk += (vibOn - this.vk) * 0.004; this.en += (eT - this.en) * 0.002;
      let l = L[i], r = R[i];
      // Frequenzverschieber: alle Teiltöne um dieselben Hz (nicht harmonisch — metallisch, schwebend); dual = links hoch, rechts runter
      if (this.mx > 1e-4) {
        this.ph += dph; if (this.ph >= 1) this.ph -= 1;
        const c = D.sinp(this.ph + 0.25), s = D.sinp(this.ph), up = p.shift >= 0 ? sgn : -sgn;
        this.hL.run(l); this.hR.run(r);
        const wl = this.hL.I * c + up * this.hL.Q * s, wr = this.hR.I * c + (dual ? -up : up) * this.hR.Q * s;
        l += (wl - l) * this.mx; r += (wr - r) * this.mx;
      }
      // Vibrato (Tonhöhe schwingt, 5,6 Hz) und Ensemble (drei langsam schwebende Kopien, breit) aus einer Verzögerungsleitung
      if (this.vk > 1e-4 || this.en > 1e-4) {
        const w = this.w; this.dl[w] = l; this.dr[w] = r; this.w = (w + 1) & 4095;
        if (this.vk > 1e-4) {
          this.vph += 5.6 / sr; if (this.vph >= 1) this.vph -= 1;
          const d = (0.004 + 0.0009 * this.vb * D.sinp(this.vph)) * sr;   // bis ±3 % (gut ein Viertelton)
          l += (rdLine(this.dl, w, d) - l) * this.vk; r += (rdLine(this.dr, w, d) - r) * this.vk;
        }
        if (this.en > 1e-4) {
          let el = 0, er = 0;
          for (let k = 0; k < 3; k++) {
            this.eph[k] += (0.31 + k * 0.17) / sr; if (this.eph[k] >= 1) this.eph[k] -= 1;
            const m = D.sinp(this.eph[k]), d = (0.011 + k * 0.0045 + 0.0035 * m) * sr, d2 = (0.011 + k * 0.0045 - 0.0035 * m) * sr;
            el += rdLine(this.dl, w, d) * (k === 1 ? 0.6 : 1); er += rdLine(this.dr, w, d2) * (k === 0 ? 0.6 : 1);
          }
          l = l * (1 - 0.3 * this.en) + el * 0.42 * this.en; r = r * (1 - 0.3 * this.en) + er * 0.42 * this.en;
        }
      }
      L[i] = l; R[i] = r;
    }
  }
}

// =====================================================================================================
// Generatoren
// =====================================================================================================
// 3.19: Muster-Generatoren setzen phrasengenau ein — ihre Schleife beginnt auf einem Vielfachen ihrer Länge (Takt 0, 4, 8 …),
// wie die der anderen; vorher lief ein später gestarteter 4-Takt-Generator gegen die übrigen verschoben
const PHRASE = new Set(["beat", "bass", "chords", "arp", "melody"]);
const phraseStart = (g, B) => PHRASE.has(g.kind) ? B - mod(B - g.eng.zero, g.bars()) : B;
const TAKE = new Set(["beat", "bass", "chords", "arp", "melody", "osc"]);
const QG = { off: 0, "1/32": 0.5, "1/16": 1, "1/16T": 2 / 3, "1/8": 2, "1/8T": 4 / 3, "1/4": 4 };
const r3 = (x) => Math.round(x * 1000) / 1000;
class Gen {
  constructor(eng, g) {
    this.eng = eng; this.id = g.id; this.kind = g.kind; this.slot = g.slot;
    this.p = Object.assign({}, g.p || {});
    this.ins = g.patch ? makeInstrument(eng, g.patch) : null;
    this.on = false; this.startAt = null; this.stopAt = null; this.startBar = 0;
    this.pat = null; this.dirty = true; this.loops = 0; this.cache = null;
    this.seed = Array.isArray(g.seed) ? g.seed : null; this.seedKey = g.seedKey || null;
    this.layers = []; this.mute = false;
    this.post = null; this.ext = false; this.local = true;   // 3.18: Nachbearbeitung, MIDI-Ausgang (ext), interner Klang dabei (local)
    this.own = Array.isArray(g.own) ? g.own : []; this.liveAt = new Map();   // 3.20: Eingespieltes (Schritte ab Schleifenanfang), letzte Live-Anschläge
    this.fade = 1; this.fadeTo = 1; this.fadeD = 0; this.fadeIn = 0; this.fadeOut = 0;   // 3.25: Blende (Autopilot) — Pegel, Ziel, Schritt je Sample, Takte
  }
  bars() { return clamp(Math.round(num(this.p.bars, 2)), 1, 8); }
  // Noten für den globalen Takt B — einmal je Takt aufgelöst (Tonart/Akkord gelten ab dem nächsten Takt)
  notesFor(B) {
    if (this.p.src === "own") return this.ownFor(B);
    if (this.cache && this.cache.B === B) return this.cache.n;
    const L = this.bars(), inLoop = mod(B - this.startBar, L);
    if (inLoop === 0 || !this.pat || this.pat.length !== L) {
      if (this.dirty || !this.pat || this.pat.length !== L) { this.pat = this.make(L); this.dirty = false; this.loops = 0; }
      else if (this.loops > 0 && !this._noVary) this.vary();
      if (!this._noVary) this.loops++;
    }
    const raw = this.pat[inLoop] || [];
    let n = [];
    for (const e of raw) { const m = this.resolve(e, B); if (m != null && m >= 0 && m <= 127) n.push({ s: e.s, l: e.l, v: e.v, n: m }); }
    if (this.p.lock && this.p.lock !== "off") n = this.lockTo(B, n);
    this.cache = { B, n };
    return n;
  }
  // Die Tonhöhen bleiben die eigenen (der Ton, der an dieser Stelle gerade klänge), nur der Rhythmus kommt vom anderen.
  lockTo(B, n) {
    const lk = this.p.lock, comp = lk.endsWith("~"), src = comp ? lk.slice(0, -1) : lk;
    if (!n.length || this._locking) return n;
    const g = this.eng.gens.find(x => x !== this && x.on && !x.mute && !x._locking && (src === "kick" ? x.kind === "beat" : x.kind === src));
    if (!g) return n;                                   // Quelle spielt nicht: eigener Rhythmus
    this._locking = true;
    let on;
    try { on = g.notesFor(B).filter(e => src !== "kick" || e.n === 0).map(e => Math.round(e.s * 4) / 4); } finally { this._locking = false; }
    on = [...new Set(on)].sort((a, b) => a - b);
    if (comp) { const gaps = []; for (let s = 0; s < 16; s += 2) if (!on.some(o => Math.abs(o - s) < 1)) gaps.push(s); on = gaps; }
    if (!on.length) return comp ? [] : n;
    const groups = new Map();
    for (const e of n) { const k = Math.round(e.s * 4) / 4; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
    const starts = [...groups.keys()].sort((a, b) => a - b), out = [];
    on.forEach((s, i) => {
      let k = starts[0]; for (const t of starts) if (t <= s + 1e-6) k = t;
      const len = Math.max(0.3, Math.min(((i + 1 < on.length ? on[i + 1] : 16) - s) * 0.9, comp ? 1.8 : 8));
      for (const e of groups.get(k)) out.push({ s, l: len, v: e.v, n: e.n });
    });
    return out;
  }
  // 3.20: das Eingespielte — genau so, wie es gespielt (und ins Raster gerückt) wurde; Tonhöhen ziehen bei einem Tonartwechsel mit
  ownFor(B) {
    if (this.cache && this.cache.B === B) return this.cache.n;
    const L = this.bars(), inLoop = mod(B - this.startBar, L), beat = this.kind === "beat";
    const sh = beat ? 0 : this.ownShift() + 12 * Math.round(num(this.p.oct, 0)), n = [];
    for (const e of this.own) {
      const b = Math.floor(e.s / SPB + 1e-9); if (b !== inLoop) continue;
      const m = e.n + sh; if (m >= 0 && m <= 127) n.push({ s: e.s - b * SPB, l: e.l, v: e.v, n: m });
    }
    this.cache = { B, n, lived: true };
    return n;
  }
  // Grundton beim Einspielen (okey) → jetziger Grundton: kürzester Weg (−5 … +6 Halbtöne)
  ownShift() { return this.p.okey == null ? 0 : mod(this.eng.harm.root - this.p.okey + 5, 12) - 5; }
  make() { return []; }
  vary() {}
  resolve(e) { return e.n; }
}

// ---- Beat ----
class BeatGen extends Gen {
  make(L) {
    const st = BEATS[this.p.style] || BEATS.house, out = [];
    for (let b = 0; b < L; b++) out.push(this.bar(st, b, L));
    return out;
  }
  bar(st, b, L) {
    const dens = num(this.p.density, 0.5), hum = num(this.p.human, 0.2), ev = [];
    for (const pad of Object.keys(st)) {
      const row = st[pad];
      for (let s = 0; s < 16; s++) {
        const ch = row[s]; let pr = PROB(ch);
        if (ch !== "x" && ch !== "X") pr = clamp(pr * dens * 2, 0, 1);
        if (pr > 0 && R() < pr) ev.push({ s, l: 1, n: +pad, v: clamp((ch === "X" ? 0.98 : ch === "x" ? 0.85 : 0.55 + R() * 0.25) - R() * hum * 0.25, 0.1, 1) });
      }
    }
    // dichter = Geisternoten auf Snare/Hats
    if (dens > 0.65) for (let s = 1; s < 16; s += 2) if (R() < (dens - 0.65) * 0.8) ev.push({ s, l: 1, n: R() < 0.5 ? 3 : 1, v: 0.25 + R() * 0.15 });
    // Fill im letzten Takt der Schleife
    const fill = Math.round(num(this.p.fill, 1));
    if (fill && b === L - 1 && L >= 2) {
      for (let i = ev.length - 1; i >= 0; i--) if (ev[i].s >= 12 && ev[i].n !== 0) ev.splice(i, 1);
      const roll = pick([[1, 1, 1, 1], [7, 6, 5, 5], [1, 7, 6, 5], [2, 1, 2, 1]]);
      for (let k = 0; k < 4; k++) ev.push({ s: 12 + k, l: 1, n: roll[k], v: 0.6 + k * 0.1 });
    }
    if (b === 0 && fill && this.loops > 0 && R() < 0.5) ev.push({ s: 0, l: 1, n: 10, v: 0.7 });
    for (const e of ev) e.s = clamp(e.s + (e.s > 0 ? (R() - 0.5) * hum * 0.08 : 0), 0, 15.95);
    return ev;
  }
  vary() {
    const v = num(this.p.variation, 0.3); if (v <= 0) return;
    const st = BEATS[this.p.style] || BEATS.house, L = this.pat.length;
    for (let b = 0; b < L; b++) if (R() < v) this.pat[b] = this.bar(st, b, L);
  }
}

// ---- Tonhöhen relativ zum aktuellen Akkord (Bass, Akkorde, Arpeggio, Melodie) ----
function scaleNote(S, k) { return S[mod(k, 7)] + 12 * Math.floor(k / 7); }
class ToneGen extends Gen {
  base() { return 60; }
  resolve(e, B) {
    const H = this.eng.harm, S = (SCALES[H.scale] || SCALES.minor).s;
    let cd = H.prog.length ? H.prog[mod(Math.floor(B / H.per), H.prog.length)] : 0;
    if (cd > 3) cd -= 7;                             // Akkordgrundton in die nächste Oktave (VI, VII liegen unter I, nicht fast eine Oktave darüber)
    let m = this.base() + H.root + scaleNote(S, cd + e.d) + 12 * (num(e.o, 0) + Math.round(num(this.p.oct, 0)));
    if (e.c) m += e.c;
    if (this.melodic) m = this.snapMel(m);
    return m;
  }
  snapMel(m) {
    const H = this.eng.harm, mel = (SCALES[H.scale] || {}).mel; if (!mel) return m;
    const pc = mod(m - H.root, 12); if (mel.includes(pc)) return m;
    for (let k = 1; k < 3; k++) { if (mel.includes(mod(pc - k, 12))) return m - k; if (mel.includes(mod(pc + k, 12))) return m + k; }
    return m;
  }
}

class BassGen extends ToneGen {
  base() { return 36 + Math.round(num(this.p.comp, 0)); }
  make(L) { const o = []; for (let b = 0; b < L; b++) o.push(this.bar(b)); return o; }
  bar() {
    const st = this.p.style || "pulse", dens = num(this.p.density, 0.6), ev = [];
    const add = (s, l, d, v, o = 0) => ev.push({ s, l, d, v, o });
    switch (st) {
      case "root": add(0, 8, 0, 0.9); if (R() < dens) add(8, 6, pick([0, 0, 4]), 0.8); else add(8, 7, 0, 0.75); break;
      case "offbeat": for (let s = 2; s < 16; s += 4) add(s, 1.6, R() < 0.15 * dens ? 4 : 0, s === 2 ? 0.9 : 0.8); break;
      case "octave": for (let s = 0; s < 16; s += 2) add(s, 1.6, 0, 0.85, (s / 2) % 2); break;
      case "acid": {
        const pool = [0, 0, 0, 2, 4, 6, -1, -3, 3];
        for (let s = 0; s < 16; s++) {
          if (s > 0 && R() > 0.35 + dens * 0.55) continue;
          const slide = R() < 0.25, acc = R() < 0.3;
          const d = pick(pool); add(s, slide ? 1.3 : 0.75, d, acc ? 0.97 : 0.7, d <= 2 && R() < 0.2 ? 1 : 0);
        }
        break;
      }
      case "synco": { const r = pick([[0, 3, 6, 10, 12], [0, 3, 7, 10, 14], [0, 6, 8, 11, 14], [0, 2, 6, 10, 13]]);
        for (const s of r) if (s === 0 || R() < 0.45 + dens * 0.5) add(s, 1.5, pick([0, 0, 0, 4, 7, 2]), s === 0 ? 0.92 : 0.78); break; }
      case "walking": { const path = pick([[0, 2, 4, 5], [0, 4, 5, 6], [0, -1, -2, -3], [0, 2, 3, 4]]); for (let k = 0; k < 4; k++) add(k * 4, 3.5, path[k], k ? 0.78 : 0.9); break; }
      default: for (let s = 0; s < 16; s += 2) if (s % 4 === 0 || R() < dens) add(s, 1.7, (s === 14 && R() < 0.3) ? 4 : 0, s % 4 === 0 ? 0.88 : 0.72);
    }
    return ev;
  }
  vary() {
    const v = num(this.p.variation, 0.25); if (v <= 0) return;
    for (let b = 0; b < this.pat.length; b++) {
      if (R() < v * 0.6) { this.pat[b] = this.bar(b); continue; }
      // Oktavsprung nur bei tiefen Stufen (wie bei acid) — sonst landet der Bass zwei Oktaven über dem Grundton
      for (const e of this.pat[b]) if (e.s > 0 && R() < v * 0.3) { e.d = pick([0, 2, 4, 7, -3]); if (e.d > 2) e.o = 0; }
    }
  }
}

class ChordGen extends ToneGen {
  base() { return 48; }
  make(L) { const o = []; for (let b = 0; b < L; b++) o.push(this.bar(b)); return o; }
  voicing() {
    const ext = num(this.p.color, 0.3);
    const d = [0, 2, 4]; if (ext > 0.25) d.push(6); if (ext > 0.7) d.push(8);
    return d;
  }
  bar() {
    const st = this.p.style || "pad", ev = [], vs = this.voicing(), dens = num(this.p.density, 0.5), strum = num(this.p.strum, 0);
    // 3.18 Strum: die Töne eines Akkords nacheinander anschlagen, abwechselnd auf- und abwärts
    let dir = 1;
    const hit = (s, l, v) => {
      const gap = strum * 0.45, n = vs.length;
      vs.forEach((d, j) => { const o = (dir > 0 ? j : n - 1 - j) * gap; if (s + o < 15.9) ev.push({ s: s + o, l: Math.max(0.3, l - o), d, v: v * (1 - j * strum * 0.06) }); });
      if (strum > 0) dir = -dir;
    };
    switch (st) {
      case "half": hit(0, 7.6, 0.75); hit(8, 7.6, 0.68); break;
      case "stabs": { const r = pick([[0, 3, 6, 10, 14], [2, 6, 10, 14], [0, 3, 7, 10, 12], [3, 6, 11, 14]]);
        for (const s of r) if (R() < 0.5 + dens * 0.5) hit(s, 0.9, 0.82); break; }
      case "offbeat": for (let s = 4; s < 16; s += 8) hit(s, 1.2, 0.8); if (dens > 0.5) { hit(6, 0.7, 0.55); hit(14, 0.7, 0.55); } break;
      case "pulse": for (let s = 0; s < 16; s += 2) hit(s, 1.5, s % 4 === 0 ? 0.78 : 0.62); break;
      default: hit(0, 15.8, 0.7);
    }
    return ev;
  }
  // enge Lage um die Mitte: jede Stimme in ein Oktavfenster legen (weiche Stimmführung)
  resolve(e, B) {
    const m = super.resolve(e, B); if (m == null) return m;
    const lo = 54 + Math.round(num(this.p.oct, 0)) * 12 + Math.round(num(this.p.comp, 0));
    let x = m; while (x < lo) x += 12; while (x >= lo + 12 + (e.d >= 6 ? 7 : 0)) x -= 12;
    return x;
  }
  vary() { const v = num(this.p.variation, 0.2); if (v > 0) for (let b = 0; b < this.pat.length; b++) if (R() < v * 0.5) this.pat[b] = this.bar(b); }
}

const ARP_STEPS = { "1/8": 2, "1/16": 1, "1/16T": 2 / 3, "1/32": 0.5, "1/4": 4 };
class ArpGen extends ToneGen {
  base() { return 60; }
  make(L) { this.idx = 0; const o = []; for (let b = 0; b < L; b++) o.push(this.bar(b)); return o; }
  bar() {
    const step = ARP_STEPS[this.p.rate] || 1, gate = num(this.p.gate, 0.5), oct = clamp(Math.round(num(this.p.octaves, 2)), 1, 4);
    const dens = num(this.p.density, 0.9), mode = this.p.mode || "up", rat = num(this.p.ratchet, 0);
    let tones = []; for (let o = 0; o < oct; o++) for (const d of [0, 2, 4]) tones.push(d + 7 * o);
    if (num(this.p.color, 0) > 0.5) tones.push(6, 13);
    tones.sort((a, b) => a - b);
    if (mode === "down") tones.reverse();
    if (mode === "updown") tones = tones.concat(tones.slice(1, -1).reverse());
    const ev = [];
    for (let s = 0, i = 0; s < 16 - 1e-6; s += step, i++) {
      if (R() > dens) continue;
      const d = mode === "random" ? pick(tones) : tones[(this.idx++) % tones.length];
      // 3.18 Ratschen — ein Schritt zerfällt in 2–4 Wiederholungen (Leben und Menschlich: notesFor)
      const v = i % 4 === 0 ? 0.85 : 0.65 + R() * 0.1;
      if (rat > 0 && R() < rat * 0.45 && step >= 0.5) {
        const k = pick([2, 2, 3, 4]), sub = step / k;
        for (let j = 0; j < k; j++) ev.push({ s: s + j * sub, l: Math.max(0.12, sub * 0.7), d, v: v * (1 - j * 0.16) });
      } else ev.push({ s, l: Math.max(0.2, step * gate), d, v });
    }
    return ev;
  }
  vary() { const v = num(this.p.variation, 0.15); if (v > 0) for (let b = 0; b < this.pat.length; b++) if (R() < v * 0.5) this.pat[b] = this.bar(b); }
  // Leben: die Dynamik wandert in einer langsamen Welle über 4 Takte und streut; Menschlich: jede Note ein wenig neben dem Raster —
  // beides bei jedem Durchgang neu (das Muster selbst bleibt, wie es ist)
  notesFor(B) {
    const n = super.notesFor(B), c = this.cache; if (c.lived) return n; c.lived = true;
    const life = num(this.p.life, 0), hum = num(this.p.human, 0);
    if (life > 0 || hum > 0) for (const e of n) {
      if (life > 0) e.v = clamp(e.v * (1 - life * 0.55 * (0.5 + 0.5 * Math.sin(TAU * (B * 16 + e.s) / 64))) + (R() - 0.5) * life * 0.25, 0.12, 1);
      if (hum > 0 && e.s > 0) e.s = clamp(e.s + (R() - 0.5) * hum * 0.35, 0, 15.95);
    }
    return n;
  }
}

// Melodie: ein Motiv, das wiederkommt (A A' A B) — starke Zeiten auf Akkordtöne, sonst Schritte
class MelodyGen extends ToneGen {
  constructor(eng, g) { super(eng, g); this.melodic = true; }
  base() { return 60; }
  motif() {
    const dens = num(this.p.density, 0.5), rng = clamp(Math.round(num(this.p.range, 5)), 2, 10);
    const rh = []; for (let s = 0; s < 16; s += 2) if (s === 0 || R() < 0.25 + dens * 0.6) rh.push(s);
    if (dens > 0.6) for (let s = 1; s < 16; s += 2) if (R() < (dens - 0.6) * 0.8) rh.push(s);
    rh.sort((a, b) => a - b);
    let d = pick([0, 2, 4, 7]); const ev = [];
    rh.forEach((s, i) => {
      const strong = s % 4 === 0;
      if (strong && R() < 0.7) d = pick([0, 2, 4, 7].filter(x => Math.abs(x - d) <= rng)) ?? d;
      else d = clamp(d + pick([-2, -1, -1, 1, 1, 2, 0]), -2, rng);
      const next = rh[i + 1] != null ? rh[i + 1] : 16;
      ev.push({ s, l: Math.max(0.5, (next - s) * (0.6 + R() * 0.35)), d, v: strong ? 0.85 : 0.7 });
    });
    return ev;
  }
  make(L) {
    const A = this.motif(), B2 = this.motif(), out = [];
    for (let b = 0; b < L; b++) {
      const src = (b % 4 === 3) ? B2 : A;
      out.push(src.map(e => ({ ...e, d: b % 4 === 1 && e.s >= 8 ? e.d + pick([-1, 1, 2]) : e.d })));
    }
    return out;
  }
  vary() {
    const v = num(this.p.variation, 0.3); if (v <= 0) return;
    for (const bar of this.pat) for (const e of bar) if (R() < v * 0.25) e.d = clamp(e.d + pick([-2, -1, 1, 2]), -3, 11);
    if (R() < v * 0.3) { const b = Math.floor(R() * this.pat.length); this.pat[b] = this.motif(); }
  }
}

// Vorgabe: eingespielte Noten (absolut) → Stufen in der Tonart bei der Aufnahme. Die Maschine spielt sie und spinnt weiter.
function toDeg(n, root, S) {
  const rel = n - (48 + root), o = Math.floor(rel / 12), pc = rel - 12 * o;
  let k = S.indexOf(pc), c = 0;
  if (k < 0) { for (let j = 6; j >= 0; j--) if (S[j] < pc) { k = j; break; } c = pc - S[k]; }
  return { d: k + 7 * o, c };
}
class SeedGen extends ToneGen {
  constructor(eng, g) { super(eng, g); this.orig = null; this.setSeed(this.seed, this.seedKey); }
  base() { return 48; }
  bars() { return this.seedBars || clamp(Math.round(num(this.p.bars, 2)), 1, 8); }
  setSeed(notes, key) {
    this.seed = notes; this.seedKey = key; this.dirty = true;
    if (!notes || !notes.length) { this.orig = null; return; }
    const root = key ? key.root : this.eng.harm.root, S = (SCALES[key ? key.scale : this.eng.harm.scale] || SCALES.minor).s;
    const L = clamp(Math.round(num(key && key.bars, this.p.bars || 2)), 1, 8); this.seedBars = L;
    const bars = []; for (let b = 0; b < L; b++) bars.push([]);
    for (const n of notes) {
      const b = clamp(Math.floor(n.s / SPB), 0, L - 1), dc = toDeg(n.n, root, S);
      // Akkord, der bei der Aufnahme lief: davon wegrechnen, damit "Akkorden folgen" die Vorgabe mitnimmt
      const cd0 = key && key.prog && key.prog.length ? key.prog[mod(Math.floor(((key.bar0 || 0) + b) / (key.per || 1)), key.prog.length)] : 0;
      bars[b].push({ s: n.s - b * SPB, l: n.l, v: n.v, d: dc.d, c: dc.c, cd0 });
    }
    this.orig = bars;
  }
  make() { return this.orig ? this.orig.map(b => b.map(e => ({ ...e }))) : [[]]; }
  resolve(e, B) {
    const H = this.eng.harm, S = (SCALES[H.scale] || SCALES.minor).s;
    let d = e.d;
    if (this.p.follow) { const cd = H.prog.length ? H.prog[mod(Math.floor(B / H.per), H.prog.length)] : 0; d += cd - (e.cd0 || 0); }
    return 48 + H.root + scaleNote(S, d) + (e.c || 0) + 12 * Math.round(num(this.p.oct, 0)) + Math.round(num(this.p.comp, 0));
  }
  // "Eigenleben": 0 = spielt die Vorgabe genau, 1 = spinnt frei weiter. Jeder vierte Durchgang kehrt zum Original zurück.
  vary() {
    const v = num(this.p.life, 0.4); if (!this.orig || v <= 0) return;
    if (this.loops % 4 === 0) { this.pat = this.make(); return; }
    const answer = this.loops % 2 === 1;
    for (const bar of this.pat) {
      for (const e of bar) {
        if (R() < v * 0.35) e.d += pick([-2, -1, 1, 2]);
        if (R() < v * 0.08) e.d += pick([-7, 7]);
      }
      if (R() < v * 0.25 && bar.length > 1) {          // Rhythmus: eine Note teilen
        const i = Math.floor(R() * bar.length), e = bar[i];
        if (e.l >= 2) { const h = e.l / 2; e.l = h; bar.push({ ...e, s: e.s + h, d: e.d + pick([-1, 1, 2]) }); }
      }
      if (R() < v * 0.15 && bar.length > 2) bar.splice(1 + Math.floor(R() * (bar.length - 1)), 1);
      bar.sort((a, b) => a.s - b.s);
    }
    if (answer && R() < 0.4 + v * 0.4) { const sh = pick([-2, 2, 3, -3]); for (const bar of this.pat) for (const e of bar) e.d += sh; }
    // Ende der Antwort zurück auf den Grundton (klingt "abgeschlossen")
    const last = this.pat[this.pat.length - 1]; if (answer && last && last.length) { const e = last[last.length - 1]; e.d = Math.round(e.d / 7) * 7; e.c = 0; }
  }
}

// ---- Oszillator: freier Klangerzeuger ----
const OSC_SYNC = { "1/1": 4, "1/2": 2, "1/4": 1, "1/8": 0.5, "1/16": 0.25, "1/4T": 2 / 3, "1/8T": 1 / 3, "2/1": 8, "4/1": 16 };
const GATE = { "1/4": 4, "1/8": 2, "1/16": 1, "1/8T": 4 / 3, "1/16T": 2 / 3, rand: 1 };
class OscGen extends Gen {
  constructor(eng, g) {
    super(eng, g);
    this.ph = new Float64Array(7); for (let i = 0; i < 7; i++) this.ph[i] = R();
    this.sph = 0; this.mph = 0; this.lph = 0; this.lsh = 0; this.f = num(this.p.freq, 110); this.amp = 0; this.gEnv = 0; this.gNext = 0; this.gOff = 0;
    this.pink = new Float64Array(7); this.brown = 0; this.drift = 0; this.driftT = 0; this.tri = 0; this.dc = 0; this.lvl = 0;
    this.held = []; this.kEnv = 0;                    // 3.20: gespielte Töne (Tastatur oder Eingespieltes), Hüllkurve dazu
  }
  notesFor(B) { return this.p.src === "own" ? this.ownFor(B) : []; }
  // 3.20: einstimmig — der zuletzt gedrückte Ton klingt, beim Loslassen der davor (wie ein Monosynth)
  key(on, n) { const i = this.held.indexOf(n); if (i >= 0) this.held.splice(i, 1); if (on) this.held.push(n); }
  target() {
    let f = num(this.p.freq, 110);
    const snap = this.p.snap || "off";
    if (snap !== "off") {
      const H = this.eng.harm, S = (SCALES[H.scale] || SCALES.minor).s;
      const m = 69 + 12 * Math.log2(f / 440);
      let best = Math.round(m), bd = 99;
      for (let k = Math.floor(m) - 2; k <= Math.ceil(m) + 2; k++) {
        const pc = mod(k - H.root, 12);
        if (snap === "root" ? pc !== 0 && pc !== 7 : !S.includes(pc)) continue;
        if (Math.abs(k - m) < bd) { bd = Math.abs(k - m); best = k; }
      }
      f = 440 * Math.pow(2, (best - 69) / 12);
    }
    return f * Math.pow(2, num(this.p.fine, 0) / 1200);
  }
  render(L, R2, a, b) {
    const p = this.p, sr = this.eng.sr, wave = p.wave || "saw";
    const glide = num(p.glide, 0.05), gc = glide > 0 ? Math.exp(-1 / (glide * sr)) : 0;
    const uni = wave === "supersaw" ? 7 : clamp(Math.round(num(p.uni, 1)), 1, 7), det = num(p.det, 0.15), sub = num(p.sub, 0), pwB = num(p.pw, 0.5);
    // der Dauerton spielt beim Drücken den Ton und kehrt beim Loslassen zurück; ungestartet klingt er nur beim Spielen
    const kn = this.held.length ? this.held[this.held.length - 1] : null, own = p.src === "own", playing = this.on && !this.mute;
    const keyed = own || (kn != null && !playing);
    const tgt = kn != null ? 440 * Math.pow(2, (kn - 69) / 12 + num(p.fine, 0) / 1200) : this.target();
    const fmR = num(p.fmr, 2), fmA = num(p.fma, 0), lvlT = (playing || (kn != null && !this.mute)) ? num(p.level, 0.7) : 0;
    const lr = OSC_SYNC[p.lsync] ? (this.eng.bpm / 60) / OSC_SYNC[p.lsync] : num(p.lrate, 0.5), ldest = p.ldest || "off", lamt = num(p.lamt, 0), lsh = p.lshape || "sine";
    const drift = num(p.drift, 0), gate = GATE[p.gate] ? GATE[p.gate] * this.eng.sps : 0, gl = num(p.gatelen, 0.5);
    const norm = 0.22 / Math.pow(uni, 0.55);
    // 3.18 Zonen — vier Wellen nebeneinander, ein Regler (oder der LFO) blendet stufenlos von A über B, C nach D
    const zones = !!p.zones, zw = zones ? [p.za || "sine", p.zb || "saw", p.zc || "square", p.zd || "noise"] : null, zpos = num(p.zpos, 0);
    this.lAmp = 0;                                     // 3.17.1: was gerade klingt, für die Regler (live)
    for (let i = a; i < b; i++) {
      this.lvl += (lvlT - this.lvl) * 0.0015;
      if (this.lvl < 1e-5 && lvlT === 0) { continue; }
      // LFO
      this.lph += lr / sr; if (this.lph >= 1) { this.lph -= 1; this.lsh = R() * 2 - 1; }
      const lv = lsh === "tri" ? 1 - 4 * Math.abs(this.lph - 0.5) : lsh === "saw" ? 1 - 2 * this.lph : lsh === "square" ? (this.lph < 0.5 ? 1 : -1) : lsh === "sh" ? this.lsh : D.sinp(this.lph);
      // Drift: langsames Wandern der Tonhöhe
      if (drift > 0) { if (--this.driftT <= 0) { this.driftT = sr * (0.3 + R() * 1.2); this.dTgt = (R() * 2 - 1) * drift * 0.6; } this.drift += ((this.dTgt || 0) - this.drift) * 0.00005; }
      this.f = gc ? tgt + (this.f - tgt) * gc : tgt;
      let semis = this.drift + (ldest === "pitch" ? lv * lamt * 12 : 0);
      const f = this.f * (semis ? Math.pow(2, semis / 12) : 1);
      const pw = clamp(pwB + (ldest === "pw" ? lv * lamt * 0.45 : 0), 0.03, 0.97);
      const fma = fmA + (ldest === "fm" ? (lv * 0.5 + 0.5) * lamt : 0);
      let s = 0;
      if (zones) {
        const z = clamp(zpos + (ldest === "zone" ? lv * lamt * 1.5 : 0), 0, 3), z0 = Math.min(2, Math.floor(z)), zf = z - z0;
        this.mph += f * fmR / sr; if (this.mph >= 1) this.mph -= 1;
        const fm = fma > 0 ? D.sinp(this.mph) * fma * 2.5 : 0;
        for (let u = 0; u < uni; u++) {
          const off = uni === 1 ? 0 : (u / (uni - 1) - 0.5) * 2, fu = f * Math.pow(2, off * det * 0.5 / 12), dt = Math.min(0.45, fu / sr);
          let ph = this.ph[u] + dt; if (ph >= 1) ph -= 1; this.ph[u] = ph;
          const pp = fm ? ph + fm - Math.floor(ph + fm) : ph;
          s += (zf < 0.999 ? this.zwave(zw[z0], pp, dt, pw) * (1 - zf) : 0) + (zf > 0.001 ? this.zwave(zw[z0 + 1], pp, dt, pw) * zf : 0);
        }
        s *= norm * 4.5;
        if (sub > 0) { this.sph += f * 0.5 / sr; if (this.sph >= 1) this.sph -= 1; s += D.sinp(this.sph) * sub * 0.8; }
        this.lZ = z;
      } else if (wave === "noise" || wave === "pink" || wave === "brown") {
        const w = R() * 2 - 1;
        if (wave === "noise") s = w * 0.5;
        else if (wave === "pink") { const P = this.pink; P[0] = 0.99886 * P[0] + w * 0.0555179; P[1] = 0.99332 * P[1] + w * 0.0750759; P[2] = 0.969 * P[2] + w * 0.153852;
          P[3] = 0.8665 * P[3] + w * 0.3104856; P[4] = 0.55 * P[4] + w * 0.5329522; P[5] = -0.7616 * P[5] - w * 0.016898; s = (P[0] + P[1] + P[2] + P[3] + P[4] + P[5] + P[6] + w * 0.5362) * 0.11; P[6] = w * 0.115926; }
        else { this.brown = (this.brown + w * 0.02) * 0.998; s = this.brown * 2.5; }
        s *= 2;
      } else {
        // FM-Modulator (Sinus) moduliert die Phase
        this.mph += f * fmR / sr; if (this.mph >= 1) this.mph -= 1;
        const fm = fma > 0 ? D.sinp(this.mph) * fma * 2.5 : 0;
        for (let u = 0; u < uni; u++) {
          const off = uni === 1 ? 0 : (u / (uni - 1) - 0.5) * 2, fu = f * Math.pow(2, off * det * 0.5 / 12), dt = Math.min(0.45, fu / sr);
          let ph = this.ph[u] + dt; if (ph >= 1) ph -= 1; this.ph[u] = ph;
          const pp = fm ? ph + fm - Math.floor(ph + fm) : ph;
          let v;
          if (wave === "sine") v = D.sinp(pp);
          else if (wave === "tri") v = 1 - 4 * Math.abs(pp - 0.5);
          else if (wave === "square") { v = pp < pw ? 1 : -1; v += blep(pp, dt); let t2 = pp - pw; if (t2 < 0) t2 += 1; v -= blep(t2, dt); }
          else { v = 2 * pp - 1; v -= blep(pp, dt); }
          s += v;
        }
        s *= norm * 4.5;
        if (sub > 0) { this.sph += f * 0.5 / sr; if (this.sph >= 1) this.sph -= 1; s += D.sinp(this.sph) * sub * 0.8; }
      }
      // Rhythmus-Tor (im Takt), sonst Dauerton
      let gEnv = 1;
      if (gate > 0) {
        const pos = this.eng.clock + i;
        if (pos >= this.gNext) { this.gNext = pos + gate; this.gOff = pos + gate * gl; this.gOpen = p.gate === "rand" ? R() < 0.6 : true; }
        const want = pos < this.gOff && this.gOpen !== false ? 1 : 0;
        this.gEnv += (want - this.gEnv) * (want ? 0.02 : 0.004); gEnv = this.gEnv;
      }
      if (keyed) { const want = kn != null ? 1 : 0; this.kEnv += (want - this.kEnv) * (want ? 0.004 : 0.0012); gEnv *= this.kEnv; }
      let amp = this.lvl * gEnv * (ldest === "amp" ? 1 - lamt * (0.5 - 0.5 * lv) : 1);
      // Gleichanteil weg (Braun-Rauschen, Sub)
      const y = s * amp; this.dc += (y - this.dc) * 0.0005; const o = tanh((y - this.dc) * 1.2) * 0.85;
      const pan = ldest === "pan" ? clamp(lv * lamt, -1, 1) : 0;
      L[i] += o * (1 - pan) * 0.5 * 1.41; R2[i] += o * (1 + pan) * 0.5 * 1.41;
      if (i === b - 1) { this.lF = f; this.lPw = pw; this.lFm = fma; this.lAmp = amp; this.lPan = pan; this.lLfo = ldest !== "off" ? lv : 0; }
    }
  }
  // alle Wellen mit dem Grundton in gleicher Phase wie der Sinus — sonst löscht sich beim Überblenden der Grundton aus (Säge war gegenphasig)
  zwave(w, pp, dt, pw) {
    if (w === "sine") return D.sinp(pp);
    if (w === "tri") { const t = pp + 0.25; return 1 - 4 * Math.abs(t - Math.floor(t) - 0.5); }
    if (w === "square") { let v = pp < pw ? 1 : -1; v += blep(pp, dt); let t2 = pp - pw; if (t2 < 0) t2 += 1; return v - blep(t2, dt); }
    if (w === "noise") return R() * 2 - 1;
    return 1 - 2 * pp + blep(pp, dt);
  }
  // 3.17.1: klingende Werte (Frequenz mit Einrasten/Gleiten/Drift/LFO, Pulsbreite, FM, Pegel mit Tor und LFO, Panorama, LFO-Ausschlag; 3.18 Zone)
  live() { return this.active() ? [this.lF || this.f, this.lPw ?? num(this.p.pw, 0.5), this.lFm ?? num(this.p.fma, 0), this.lAmp || 0, this.lPan || 0, this.lLfo || 0, this.p.zones ? this.lZ ?? num(this.p.zpos, 0) : null] : null; }
  active() { return this.on || this.lvl > 1e-5; }
}

// ---- Mikrofon-Schleife: Schichten (Overdub), synchron zum Takt; bei anderem Tempo läuft sie schneller/langsamer ----
// 3.18 Granular — aus der gesungenen Schleife wird eine Wolke kurzer Körner: Größe, Dichte, Streuung,
// Tonhöhe, Einfrieren. Die Körner lesen aus der Summe aller Schichten (einmal je Änderung gemischt).
const GMAX = 48;
class AudioGen extends Gen {
  constructor(eng, g) { super(eng, g); this.layers = []; this.g = 0; this.layV = 0; this.mixV = -1; this.gm = 0; this.gT = 0; this.gn = 0; this.fz = null;
    this.gr = []; for (let k = 0; k < GMAX; k++) this.gr.push({ st: 0, age: 0, len: 1, rate: 1, pan: 0 }); }
  notesFor() { return []; }
  mixLayers() {
    const lay = this.layers, n = lay[0].L.length, l = new Float32Array(n), r = new Float32Array(n);
    for (const ly of lay) for (let i = 0; i < n && i < ly.L.length; i++) { l[i] += ly.L[i]; r[i] += ly.R[i]; }
    this.mL = l; this.mR = r; this.mixV = this.layV;
  }
  render(L, R2, a, b) {
    const lay = this.layers; if (!lay.length) return;
    const want = this.on && !this.mute ? num(this.p.level, 0.9) : 0;
    const bars = lay[0].bars, steps = bars * SPB, len = lay[0].L.length;
    const rev = !!this.p.reverse, chop = num(this.p.chop, 0);
    const gran = num(this.p.gran, 0), sr = this.eng.sr;
    if ((gran > 0 || this.gm > 1e-4) && this.mixV !== this.layV) this.mixLayers();
    const gsize = clamp(num(this.p.gsize, 0.12), 0.01, 0.6) * sr, gdens = clamp(num(this.p.gdens, 20), 1, 120), spray = num(this.p.gspray, 0.2);
    const grate = Math.pow(2, Math.round(num(this.p.gpitch, 0)) / 12), gnorm = 1 / Math.sqrt(Math.max(1, gdens * gsize / sr * 0.75));
    if (this.p.gfreeze) { if (this.fz == null) this.fz = this.lastX || 0; } else this.fz = null;
    for (let i = a; i < b; i++) {
      this.g += (want - this.g) * 0.003; this.gm += (gran - this.gm) * 0.002;
      if (this.g < 1e-5 && want === 0) continue;
      // Position aus dem Takt (nicht aus einem eigenen Zähler) — bleibt synchron, auch nach Tempowechsel
      let st = mod(this.eng.posAt(i) - this.startBar * SPB, steps);
      // Stottern: in manchen Schlägen wird das erste Stück des Schlags wiederholt (Beat-Repeat) — je Schlag fest gewürfelt
      if (chop > 0) { const gb = Math.floor(this.eng.posAt(i) / 4); if (gb !== this.chopBeat) { this.chopBeat = gb; this.chopOn = R() < chop * 0.6; this.chopLen = pick([0.5, 1, 1, 2]); }
        if (this.chopOn) { const beat = Math.floor(st / 4) * 4; st = beat + mod(st - beat, this.chopLen); } }
      let x = st / steps * len; if (rev) x = len - 1 - x;
      const i0 = Math.floor(x), fr = x - i0, i1 = i0 + 1 >= len ? 0 : i0 + 1;
      let l = 0, r = 0;
      for (const ly of lay) { l += ly.L[i0] + (ly.L[i1] - ly.L[i0]) * fr; r += ly.R[i0] + (ly.R[i1] - ly.R[i0]) * fr; }
      this.lastX = x;
      if (this.gm > 1e-4 && this.mL) {
        // neues Korn fällig? (Abstand schwankt ±50 %, damit es nicht wie ein Raster klingt)
        if (--this.gT <= 0 && gran > 0) {
          this.gT = sr / gdens * (0.5 + R());
          if (this.gn < GMAX) {
            const q = this.gr[this.gn++], base = this.fz != null ? this.fz : x;
            q.st = mod(base - R() * spray * len * 0.5, len); q.age = 0; q.len = gsize * (0.75 + R() * 0.5); q.rate = grate * (1 + (R() - 0.5) * 0.012); q.pan = (R() * 2 - 1) * (0.25 + spray * 0.5);
          }
        }
        let cl = 0, cr = 0; const mL = this.mL, mR = this.mR;
        for (let k = 0; k < this.gn; k++) {
          const q = this.gr[k];
          if (q.age >= q.len) { const t = this.gr[--this.gn]; this.gr[this.gn] = q; this.gr[k] = t; k--; continue; }
          const e = D.sinp(q.age / q.len * 0.5), env = e * e, px = mod(q.st + q.age * q.rate, len), j0 = px | 0, jf = px - j0, j1 = j0 + 1 >= len ? 0 : j0 + 1;
          const sl = (mL[j0] + (mL[j1] - mL[j0]) * jf) * env, sr2 = (mR[j0] + (mR[j1] - mR[j0]) * jf) * env;
          cl += sl * (1 - q.pan); cr += sr2 * (1 + q.pan); q.age++;
        }
        l += (cl * gnorm - l) * this.gm; r += (cr * gnorm - r) * this.gm;
      }
      L[i] += l * this.g; R2[i] += r * this.g;
    }
  }
  active() { return this.layers.length && (this.on || this.g > 1e-5); }
}

const KINDS = { beat: BeatGen, bass: BassGen, chords: ChordGen, arp: ArpGen, melody: MelodyGen, seed: SeedGen, osc: OscGen, audio: AudioGen };

// =====================================================================================================
// Der Motor
// =====================================================================================================
class Loops extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sr = sampleRate; this.clock = 0; this.bpm = 120; this.swing = 0.5; this.sps = this.sr * 60 / 120 / 4;
    this.playing = false; this.blockPos = -1;        // für die Instrumente: Arpeggiator läuft frei
    this.run = false; this.pos = 0; this.lastBar = -1; this.lastStep = -1;
    this.harm = { root: 9, scale: "minor", prog: [0, 5, 2, 6], per: 1 };
    this.gens = []; this.offs = []; this.nid = 1; this.metro = false; this.click = [];
    this.bufL = []; this.bufR = []; for (let i = 0; i < MAX_GEN; i++) { this.bufL.push(new Float32Array(128)); this.bufR.push(new Float32Array(128)); }
    this.rec = null; this.seedRec = null; this.liveHeld = new Map();
    this.nev = []; this.cap = false;                 // 3.18: Noten nach außen (MIDI-Ausgang, Flow Capture)
    this.zero = 0; this.take = null;                 // 3.20: Phrasenanfang, laufendes Einspielen
    this.port.onmessage = (e) => this.msg(e.data);
  }
  gen(id) { return this.gens.find(g => g.id === id); }
  posAt(i) { return this.pos0 + i / this.sps; }
  msg(d) {
    switch (d.t) {
      case "tempo": this.bpm = clamp(num(d.bpm, 120), 40, 220); this.sps = this.sr * 60 / this.bpm / 4; if (d.swing != null) this.swing = clamp(d.swing, 0.5, 0.75); break;
      case "harmony": this.harm = { root: mod(Math.round(num(d.root, 9)), 12), scale: SCALES[d.scale] ? d.scale : "minor",
        prog: Array.isArray(d.prog) && d.prog.length ? d.prog.map(x => Math.round(x)) : [0], per: clamp(Math.round(num(d.per, 1)), 1, 8) };
        break;                                       // gilt ab dem nächsten Takt (der laufende ist schon aufgelöst)
      case "gen": {
        const old = this.gen(d.g.id);
        const C = KINDS[d.g.kind]; if (!C) break;
        if (old && old.kind === d.g.kind) {           // gleicher Generator: Einstellungen übernehmen, weiterlaufen
          old.p = Object.assign({}, d.g.p || {}); old.slot = d.g.slot; old.dirty = !!d.regen || old.dirty; old.cache = null;
          if (Array.isArray(d.g.own)) old.own = d.g.own;
          if (d.g.patch && old.ins) { if (old.ins.p.engine !== d.g.patch.engine) { old.ins.panic(); old.ins = makeInstrument(this, d.g.patch); } else old.ins.setPatch(d.g.patch); }
          break;
        }
        if (old) this.del(old.id);
        if (this.gens.length >= MAX_GEN) break;
        this.gens.push(new C(this, d.g));
        break;
      }
      case "seed": { const g = this.gen(d.id); if (g && g.setSeed) { g.setSeed(d.notes, d.key); g.cache = null; } break; }
      // 3.20: Eingespieltes setzen (Rückgängig, Leeren, Länge geändert)
      case "own": { const g = this.gen(d.id); if (!g) break; g.own = Array.isArray(d.own) ? d.own : []; if (d.okey !== undefined) g.p.okey = d.okey; g.cache = null; break; }
      case "take": { const g = this.gen(d.id); if (!g) break;
        if (!d.on) { if (this.take && this.take.id === g.id) this.takeEnd(); break; }
        if (TAKE.has(g.kind)) this.takeBegin(g, d);
        break; }
      case "freeze": { const g = this.gen(d.id); if (g && TAKE.has(g.kind) && g.p.src !== "own") this.freeze(g); break; }
      case "gp": { const g = this.gen(d.id); if (!g) break; g.p[d.k] = d.v; if (d.regen) g.dirty = true; g.cache = null; break; }
      case "patch": { const g = this.gen(d.id); if (!g || !g.ins) break; if (g.ins.p.engine !== d.patch.engine) { g.ins.panic(); g.ins = makeInstrument(this, d.patch); } else g.ins.setPatch(d.patch); break; }
      case "param": { const g = this.gen(d.id); if (g && g.ins) g.ins.set(d.k, d.v); break; }
      case "bend": { const g = this.gen(d.id); if (g && g.ins) g.ins.bend = clamp(num(d.v, 0), -1, 1); break; }
      case "mod": { const g = this.gen(d.id); if (g && g.ins) g.ins.mw = clamp(num(d.v, 0), 0, 1); break; }
      case "pedal": { const g = this.gen(d.id); if (g && g.ins && g.ins.pedal) g.ins.pedal(!!d.on); break; }
      case "del": this.del(d.id); break;
      // 3.18: Nachbearbeitung (Frequenzverschieber, Vibrato, Ensemble) · MIDI-Ausgang je Generator · Noten mitschneiden
      case "post": { const g = this.gen(d.id); if (!g) break; if (!g.post) g.post = new Post(this.sr); g.post.set(d.p || {}); break; }
      case "ext": { const g = this.gen(d.id); if (!g) break;
        if (g.ext && !d.on) for (const o of this.offs) if (o.g === g) this.nev.push([g.id, 0, o.n, 0, currentTime]);
        g.ext = !!d.on; g.local = d.local !== false || !d.on;
        if (g.ext && !g.local && g.ins) g.ins.allOff();
        break; }
      case "cap": this.cap = !!d.on; break;
      case "start": { const g = this.gen(d.id); if (!g) break; if (!this.run) this.begin(); g.stopAt = null; g.fadeOut = 0; g.fadeIn = num(d.fade, 0);
        if (g.on && g.fadeTo === 0) { this.fadeGo(g, 1, g.fadeIn || 1); this.state(g); break; }   // blendet gerade aus → wieder hoch
        if (d.now || !this.playingAny()) { g.startAt = null; g.on = true; g.startBar = phraseStart(g, this.barNow()); g.dirty = g.dirty || !g.pat; g.cache = null; this.fadeStart(g); }
        else g.startAt = this.barNow() + 1;
        this.state(g); break; }
      case "stop": { const g = this.gen(d.id); if (!g) break; g.startAt = null; g.fadeOut = d.now ? 0 : num(d.fade, 0); if (this.take && this.take.id === g.id && !g.on) this.takeEnd(); if (d.now) { this.halt(g); } else g.stopAt = this.barNow() + 1; this.state(g); if (d.now) this.idleEnd(); break; }
      case "mute": { const g = this.gen(d.id); if (g) g.mute = !!d.on; break; }
      case "run": if (d.on) this.begin(); else this.end(); break;
      case "metro": this.metro = !!d.on; break;
      case "note": { const g = this.gen(d.id); if (!g) break;
        if (d.on) g.liveAt.set(d.n, this.pos);
        this.takeNote(g, d.n, d.v, !!d.on);
        if (g.kind === "osc") { g.key(!!d.on, d.n); break; }
        if (!g.ins) break;
        if (g.ext || this.cap) this.nev.push([g.id, d.on ? 1 : 0, d.n, d.on ? clamp(num(d.v, 0.8), 0.02, 1) : 0, currentTime]);
        if (d.on) { if (g.local) g.ins.input(true, d.n, clamp(num(d.v, 0.8), 0.02, 1), -1 - d.n); this.seedNote(g, d.n, d.v, true); }
        else { if (g.local) g.ins.input(false, d.n, 0, -1 - d.n); this.seedNote(g, d.n, 0, false); }
        break; }
      case "seedrec": { const g = this.gen(d.id); if (!g || g.kind !== "seed") break;
        if (!d.on) { this.seedRec = null; break; }
        const fresh = !this.run; if (fresh) { this.begin(); this.zero = 1; }
        const bars = clamp(Math.round(num(d.bars, 2)), 1, 8), at = fresh ? 1 : this.barNow() + 2;   // ein ganzer Takt Einzählen
        this.seedRec = { id: g.id, bars, from: at * SPB, to: (at + bars) * SPB, notes: [], open: new Map(), bar0: at };
        this.halt(g); this.port.postMessage({ t: "seedarm", id: g.id, at }); break; }
      case "audiorec": { const g = this.gen(d.id); if (!g || g.kind !== "audio") break;
        if (!d.on) { this.rec = null; break; }
        const fresh = !this.run; if (fresh) { this.begin(); this.zero = 1; }
        let bars = clamp(Math.round(num(d.bars, 2)), 1, 8);
        if (d.overdub && g.layers.length) bars = g.layers[0].bars;
        // ein ganzer Takt Einzählen; Overdub setzt am Schleifenanfang ein (sonst läge die neue Schicht verschoben)
        let at = fresh ? 1 : this.barNow() + 2;
        if (d.overdub && g.layers.length) { while (mod(at - g.startBar, bars) !== 0) at++; }
        const lat = Math.max(0, Math.round(num(d.lat, 0) * this.sr));
        this.rec = { id: g.id, bars, at, lat, overdub: !!d.overdub && g.layers.length > 0, startClock: null, len: 0, L: null, R: null, w: 0 };
        this.port.postMessage({ t: "recarm", id: g.id, at }); break; }
      case "layers": { const g = this.gen(d.id); if (!g || g.kind !== "audio") break; g.layers = (d.layers || []).map(x => ({ L: x.L, R: x.R || x.L, bars: x.bars, bpm: x.bpm })); g.layV++; break; }
      case "undolayer": { const g = this.gen(d.id); if (g && g.layers && g.layers.length) { g.layers.pop(); g.layV++; } break; }
      case "panic": for (const g of this.gens) if (g.ins) g.ins.panic(); this.offs = []; break;
    }
  }
  playingAny() { return this.gens.some(g => g.on); }
  // 3.19: der letzte Generator ist gestoppt → Takt anhalten (lief vorher leer weiter; der Autopilot holte dann wieder jemanden herein)
  idleEnd() { if (this.run && !this.gens.some(g => g.on || g.startAt != null) && !this.rec && !this.seedRec && !this.take) this.end(); }
  barNow() { return Math.floor(this.pos / SPB + 1e-9); }
  begin() { if (this.run) return; this.run = true; this.pos = 0; this.zero = 0; this.lastBar = -1; this.lastStep = -1; this.port.postMessage({ t: "run", on: true }); }
  end() {
    if (this.take) this.takeEnd();
    this.run = false; for (const g of this.gens) this.halt(g);
    this.rec = null; this.seedRec = null; this.port.postMessage({ t: "run", on: false });
  }
  halt(g) {
    if (this.take && this.take.id === g.id) this.takeEnd();
    g.on = false; g.stopAt = null; g.cache = null;
    for (const o of this.offs) if (o.g === g) { if (g.ins) g.ins.input(false, o.n, 0, o.id); else if (g.key) g.key(false, o.n); if (g.ext || this.cap) this.nev.push([g.id, 0, o.n, 0, currentTime]); }
    this.offs = this.offs.filter(o => o.g !== g);
    if (g.ins && g.ins.allOff) g.ins.allOff();
  }
  del(id) { const g = this.gen(id); if (!g) return; this.halt(g); if (g.ins) g.ins.panic(); this.gens = this.gens.filter(x => x !== g); if (this.rec && this.rec.id === id) this.rec = null; }
  state(g) { this.port.postMessage({ t: "state", id: g.id, on: g.on, startAt: g.startAt, stopAt: g.stopAt, startBar: g.startBar, fading: g.on && g.fadeTo !== g.fade ? (g.fadeTo ? "in" : "out") : null }); }
  // 3.25: Blende — der Autopilot nimmt Generatoren sanft heraus und herein (Takte), von Hand bleibt es sofort
  fadeGo(g, to, bars) { g.fadeTo = to; g.fadeD = 1 / Math.max(1, bars * SPB * this.sps); }
  fadeStart(g) { if (g.fadeIn > 0) { g.fade = Math.min(g.fade, 0.0001); this.fadeGo(g, 1, g.fadeIn); } else { g.fade = g.fadeTo = 1; g.fadeD = 0; } g.fadeIn = 0; }
  swingOff(s) { const r = Math.round(s); if (Math.abs(s - r) > 0.01 || (r & 1) === 0) return 0; return (this.swing - 0.5) * 2; }
  seedNote(g, n, v, on) {
    const sr = this.seedRec; if (!sr || sr.id !== g.id) return;
    const p = this.pos;
    if (on) { if (p >= sr.from - 0.5 && p < sr.to) sr.open.set(n, { s: Math.max(0, p - sr.from), v: clamp(num(v, 0.8), 0.05, 1) }); }
    else { const o = sr.open.get(n); if (!o) return; sr.open.delete(n); sr.notes.push({ s: o.s, l: Math.max(0.25, p - sr.from - o.s), n, v: o.v }); }
  }
  finishSeed() {
    const sr = this.seedRec; this.seedRec = null; if (!sr) return;
    const total = sr.bars * SPB;
    for (const [n, o] of sr.open) sr.notes.push({ s: o.s, l: Math.max(0.25, total - o.s), n, v: o.v });
    // auf 1/16 einrasten (leicht: Mitte zählt), alles in die Länge
    const notes = sr.notes.map(x => ({ s: Math.min(total - 0.25, Math.round(x.s * 4) / 4 >= total ? 0 : Math.round(x.s)), l: Math.max(0.5, Math.round(x.l * 2) / 2), n: x.n, v: Math.round(x.v * 100) / 100 }))
      .map(x => ({ ...x, s: Math.min(total - 1, x.s) })).sort((a, b) => a.s - b.s);
    const g = this.gen(sr.id);
    const key = { root: this.harm.root, scale: this.harm.scale, prog: this.harm.prog.slice(), per: this.harm.per, bar0: sr.bar0, bars: sr.bars };
    if (g && notes.length) { g.setSeed(notes, key); g.on = true; g.startBar = sr.bar0 + sr.bars; g.startAt = null; g.cache = null; g.loops = 0; this.state(g); }
    this.port.postMessage({ t: "seed", id: sr.id, notes, key });
  }
  // ---------- 3.20 ✋ Selbst einspielen ----------
  // Läuft nichts: ein Takt Einzählen, dann ab Takt 1. Läuft die Musik: ab dem nächsten Schleifenanfang des Generators (höchstens
  // 4 Takte warten). Jede Runde wird ins Raster gerückt und ab der nächsten mitgespielt — weiterspielen legt neue Töne dazu
  // (Overdub), bis ● noch einmal gedrückt wird. Der Zeitpunkt zählt so, wie man ihn gehört hat (Ausgabeverzögerung abgezogen).
  takeBegin(g, d) {
    if (this.take) this.takeEnd();
    const L = clamp(Math.round(num(d.bars, g.bars())), 1, 8), over = g.p.src === "own" && g.own.length > 0, prevSrc = g.p.src || "auto";
    g.p.bars = L; g.p.src = "own"; g.cache = null;
    if (!over) { g.own = []; g.p.okey = g.kind === "beat" ? null : this.harm.root; }
    else if (g.p.okey == null && g.kind !== "beat") g.p.okey = this.harm.root;
    const fresh = !this.run; let at;
    if (fresh) { this.begin(); this.zero = 1; at = 1; }
    else { at = this.barNow() + 1; const st = Math.min(L, 4), ref = g.on ? g.startBar : this.zero; while (mod(at - ref, st) !== 0) at++; }
    g.stopAt = null; if (!g.on) g.startAt = at;
    this.take = { id: g.id, at, lat: clamp(num(d.lat, 0), 0, 0.5), notes: [], open: new Map(), pass: 0, over, prevSrc, click: false };
    this.state(g);
    this.port.postMessage({ t: "takearm", id: g.id, at, over, bars: L, okey: g.p.okey, fresh });
  }
  takeNote(g, n, v, on) {
    const tk = this.take; if (!tk || tk.id !== g.id) return;
    const p = this.pos - tk.lat * this.sr / this.sps;
    if (on) { if (p >= tk.at * SPB - 0.5) tk.open.set(n, { p, v: clamp(num(v, 0.8), 0.05, 1) }); return; }
    const o = tk.open.get(n); if (!o) return; tk.open.delete(n); tk.notes.push({ p: o.p, l: p - o.p, n, v: o.v });
  }
  takeMerge(final) {
    const tk = this.take, g = tk && this.gen(tk.id); if (!g) return;
    if (final) { const now = this.pos - tk.lat * this.sr / this.sps; for (const [n, o] of tk.open) tk.notes.push({ p: o.p, l: Math.max(0.25, now - o.p), n, v: o.v }); tk.open.clear(); }
    const L = g.bars(), total = L * SPB, q = QG[g.p.q] ?? 1, beat = g.kind === "beat";
    const sh = beat ? 0 : g.ownShift() + 12 * Math.round(num(g.p.oct, 0));
    let added = 0;
    for (const x of tk.notes) {
      const rel = mod(x.p - g.startBar * SPB, total);
      let s = q ? Math.round(rel / q) * q : rel; if (s >= total - 1e-6) s -= total;
      const l = beat ? 1 : Math.min(total, q ? Math.max(q, Math.round(x.l / q) * q) : Math.max(0.25, x.l)), nn = beat ? x.n : x.n - sh;
      // derselbe Ton an derselben Stelle (Overdub über das schon Eingespielte): ersetzen statt verdoppeln
      const same = g.own.find(e => e.n === nn && Math.abs(e.s - s) < (q ? q / 2 : 0.25));
      if (same) { same.v = Math.round(x.v * 100) / 100; if (!beat) same.l = r3(l); }
      else { g.own.push({ s: r3(s), l: r3(l), n: nn, v: Math.round(x.v * 100) / 100 }); added++; }
    }
    tk.notes = []; g.own.sort((a, b) => a.s - b.s || a.n - b.n); g.cache = null;
    if (!final) tk.pass++;
    this.port.postMessage({ t: "own", id: g.id, own: g.own.map(e => ({ ...e })), pass: tk.pass, added, okey: g.p.okey, src: g.p.src, final: !!final });
  }
  takeEnd() {
    const tk = this.take; if (!tk) return;
    this.takeMerge(true); this.take = null;
    const g = this.gen(tk.id);
    if (g && !tk.over && !g.own.length) { g.p.src = tk.prevSrc; g.cache = null; }   // nichts gespielt: wie vorher
    this.port.postMessage({ t: "takeend", id: tk.id, src: g ? g.p.src : null, n: g ? g.own.length : 0 });
  }
  // 📌 Das Muster, das die Maschine gerade spielt, als Eingespieltes übernehmen — dann lässt sich darüber weiterspielen
  freeze(g) {
    const L = g.bars(), Bn = this.barNow(), B0 = g.on ? Bn - mod(Bn - g.startBar, L) : Bn, out = [], beat = g.kind === "beat";
    const o12 = beat ? 0 : 12 * Math.round(num(g.p.oct, 0));
    g._noVary = true;
    try { for (let b = 0; b < L; b++) { g.cache = null; for (const e of g.notesFor(B0 + b)) out.push({ s: r3(b * SPB + e.s), l: r3(beat ? 1 : e.l), n: e.n - o12, v: Math.round(num(e.v, 0.8) * 100) / 100 }); } }
    finally { g._noVary = false; }
    if (!g.on) g.startBar = B0;
    g.own = out.sort((a, b) => a.s - b.s || a.n - b.n); g.p.src = "own"; g.p.okey = beat ? null : this.harm.root; g.cache = null;
    this.port.postMessage({ t: "own", id: g.id, own: g.own.map(e => ({ ...e })), pass: 0, added: out.length, okey: g.p.okey, src: "own", final: true, frozen: true });
  }
  // Ereignisse eines Abschnitts [p0, p1) des aktuellen Takts B
  gather(B, p0, p1, frame0, ev) {
    for (let gi = 0; gi < this.gens.length; gi++) {
      const g = this.gens[gi];
      if (!g.on || g.mute || (!g.ins && g.kind !== "osc")) continue;
      const list = g.notesFor(B), own = g.p.src === "own";
      for (const nt of list) {
        const at = nt.s + (g.kind === "beat" || g.kind === "bass" ? this.swingOff(nt.s) : 0);
        if (at >= p0 && at < p1) {
          // 3.20: eben live denselben Ton angeschlagen (kurz vor dieser Stelle) → nicht doppelt
          if (own) { const la = g.liveAt.get(nt.n), ab = B * SPB + at; if (la != null && la <= ab + 0.05 && la > ab - 1) continue; }
          const f = frame0 + Math.floor((at - p0) * this.sps), id = this.nid++;
          ev.push({ f, g, n: nt.n, v: num(nt.v, 0.8), on: true, id });
          if (g.kind !== "beat") this.offs.push({ at: this.clock + f + Math.max(16, Math.round(num(nt.l, 1) * this.sps) - 8), g, n: nt.n, id });
        }
      }
    }
  }
  barStart(B, frame) {
    // Starts/Stopps am Taktanfang
    let stopped = false;
    for (const g of this.gens) {
      if (g.startAt != null && B >= g.startAt) { g.on = true; g.startAt = null; g.startBar = phraseStart(g, B); g.cache = null; this.fadeStart(g); this.state(g); }
      if (g.stopAt != null && B >= g.stopAt) {
        if (g.fadeOut > 0) { g.stopAt = null; this.fadeGo(g, 0, g.fadeOut); g.fadeOut = 0; this.state(g); }   // spielt weiter, bis die Blende unten ist
        else { this.halt(g); this.state(g); stopped = true; }
      }
    }
    if (stopped) this.idleEnd();
    const tk = this.take;
    if (tk) {
      const g = this.gen(tk.id);
      if (g && g.on && B > tk.at && mod(B - g.startBar, g.bars()) === 0) this.takeMerge(false);
      // Einzählen und Klick beim Einspielen, solange sonst nichts den Takt vorgibt (noch nichts eingespielt, kein anderer spielt)
      tk.click = !!g && !g.own.length && !this.gens.some(x => x !== g && x.on && !x.mute);
    }
    const sr = this.seedRec; if (sr && B === sr.bar0 + sr.bars) this.finishSeed();
    const rc = this.rec;
    if (rc && rc.startClock == null && B === rc.at) {
      rc.startClock = this.clock + frame + rc.lat; rc.len = Math.round(rc.bars * SPB * this.sps); rc.L = new Float32Array(rc.len); rc.R = new Float32Array(rc.len); rc.w = 0; rc.bpm = this.bpm;
      this.port.postMessage({ t: "recgo", id: rc.id });
    }
    this.port.postMessage({ t: "bar", bar: B, time: currentTime + frame / this.sr, spb: this.sps * SPB / this.sr });
  }
  process(inputs, outputs) {
    const N = 128;
    for (let i = 0; i < MAX_GEN; i++) { this.bufL[i].fill(0); this.bufR[i].fill(0); }
    const ev = [];
    this.pos0 = this.pos;
    if (this.run) {
      let frame = 0;
      while (frame < N) {
        const B = Math.floor(this.pos / SPB + 1e-9), local = this.pos - B * SPB;
        if (B !== this.lastBar) { this.lastBar = B; this.barStart(B, frame); }
        const toEnd = SPB - local;
        const chunk = Math.min(N - frame, Math.max(1, Math.ceil(toEnd * this.sps - 1e-6)));
        const p1 = local + chunk / this.sps;
        this.gather(B, local, Math.min(p1, SPB), frame, ev);
        // Metronom (an) oder Einzählen vor einer Aufnahme
        const tk = this.take;
        const counting = (this.rec && this.rec.startClock == null && B === this.rec.at - 1) || (this.seedRec && B === this.seedRec.bar0 - 1) || (tk && tk.click && B >= tk.at - 1);
        if (this.metro || counting) {
          let k = Math.ceil(local / 4 - 1e-9) * 4;
          for (; k < p1 && k < SPB; k += 4) this.click.push({ f: k === 0 ? 1760 : 1320, t: 0, n: Math.floor(this.sr * 0.05), d: frame + Math.floor((k - local) * this.sps) });
        }
        this.pos = B * SPB + p1; frame += chunk;
        if (p1 >= SPB - 1e-9) this.pos = (B + 1) * SPB;
      }
      const step = Math.floor(this.pos);
      if (step !== this.lastStep) { this.lastStep = step; this.port.postMessage({ t: "pos", step }); }
    }
    // fällige Note-Aus
    if (this.offs.length) {
      const end = this.clock + N, keep = [];
      for (const o of this.offs) { if (o.at < end) ev.push({ f: Math.max(0, o.at - this.clock), g: o.g, n: o.n, on: false, id: o.id }); else keep.push(o); }
      this.offs = keep;
    }
    for (const g of this.gens) if (g.ins && g.ins.clockBlock) { for (const x of g.ins.clockBlock(this.clock, this.clock + N)) ev.push({ f: clamp(x.f, 0, N - 1), g, arp: x.tick ? 1 : 2 }); }
    ev.sort((x, y) => x.f - y.f || (x.on === false ? -1 : 1));
    let at = 0;
    const runTo = (to) => {
      if (to <= at) return;
      for (const g of this.gens) {
        const L = this.bufL[g.slot], R2 = this.bufR[g.slot]; if (!L) continue;
        if (g.ins) {
          if (!busy(g.ins)) continue;
          if (g.ins.l1) modBlock(g.ins, at, to);
          g.ins.render(L, R2, at, to);
          if (!(g.ins instanceof Organ || g.ins instanceof Drums)) { const k = num(g.ins.p.vol, 0.8) / 0.8; if (k !== 1) for (let i = at; i < to; i++) { L[i] *= k; R2[i] *= k; } }
          if (g.ins.spaceRun) g.ins.spaceRun(L, R2, at, to);           // 3.21: Raum je Instrument
        } else if (g.render) g.render(L, R2, at, to);
      }
      at = to;
    };
    for (const e of ev) {
      runTo(Math.min(N, e.f));
      const ins = e.g.ins; if (!ins) { if (e.g.key && !e.arp) e.g.key(e.on, e.n); continue; }
      if (!e.arp && (e.g.ext || this.cap)) this.nev.push([e.g.id, e.on ? 1 : 0, e.n, e.on ? e.v : 0, currentTime + e.f / this.sr]);
      if (!e.arp && !e.g.local) continue;            // MIDI-Ausgang ohne eigenen Klang: das externe Gerät spielt
      this.evAt = this.clock + e.f;                  // genauer Zeitpunkt (für den Prüfstand)
      if (e.arp === 1) ins.arpTick();
      else if (e.arp === 2) { if (ins.arpNote != null) { ins.noteOff(ins.arpNote, -7); ins.arpNote = null; } }
      else if (e.on) ins.input(true, e.n, e.v, e.id);
      else ins.input(false, e.n, 0, e.id);
    }
    runTo(N);
    for (const g of this.gens) if (g.post && g.post.active()) { const L = this.bufL[g.slot], R2 = this.bufR[g.slot]; if (L) g.post.process(L, R2, N); }
    // 3.25: Blende je Generator (quadratisch — klingt gleichmäßiger als linear); unten angekommen → aus. Ausgeblendet bleibt
    // der Pegel bei 0, bis er wieder startet — sonst kämen Ausklang und Hall nach dem Aus noch einmal laut
    let faded = false;
    for (const g of this.gens) {
      if (g.fade === 1 && g.fadeTo === 1) continue;
      const L = this.bufL[g.slot], R2 = this.bufR[g.slot]; if (!L) continue;
      const up = g.fadeTo > g.fade, moving = g.fade !== g.fadeTo;
      for (let i = 0; i < N; i++) {
        if (g.fade !== g.fadeTo) g.fade = up ? Math.min(g.fadeTo, g.fade + g.fadeD) : Math.max(g.fadeTo, g.fade - g.fadeD);
        const k = g.fade * g.fade; L[i] *= k; R2[i] *= k;
      }
      if (moving && g.fade === g.fadeTo) { if (g.fadeTo === 0 && g.on) { this.halt(g); faded = true; } this.state(g); }
    }
    if (faded) this.idleEnd();
    if (this.nev.length) { this.port.postMessage({ t: "nev", ev: this.nev }); this.nev = []; }
    // Mikrofon aufnehmen (mit Laufzeitausgleich: der Ton kommt um "lat" später an, als er gespielt wurde)
    const rc = this.rec;
    if (rc && rc.startClock != null) {
      const inp = inputs[0] || [], iL = inp[0], iR = inp[1] || inp[0];
      for (let i = 0; i < N; i++) {
        const k = this.clock + i - rc.startClock;
        if (k >= 0 && k < rc.len) { rc.L[k] = iL ? iL[i] : 0; rc.R[k] = iR ? iR[i] : 0; rc.w = k + 1; }
      }
      if (rc.w >= rc.len || this.clock + N - rc.startClock >= rc.len) {
        this.rec = null;
        const g = this.gen(rc.id);
        const layer = { L: rc.L, R: rc.R, bars: rc.bars, bpm: rc.bpm };
        if (g) {
          if (!rc.overdub) { g.layers = [layer]; g.startBar = rc.at; }
          else g.layers.push(layer);
          if (g.layers.length > 8) g.layers.shift();
          g.layV++; g.on = true; g.startAt = null; this.state(g);
        }
        this.port.postMessage({ t: "layer", id: rc.id, L: rc.L.slice(), R: rc.R.slice(), bars: rc.bars, bpm: rc.bpm, overdub: rc.overdub, startBar: rc.at });
      } else if ((this.clock >> 7) % 24 === 0) this.port.postMessage({ t: "recpos", id: rc.id, frac: rc.w / rc.len });
    }
    for (let gi = 0; gi < MAX_GEN && gi < outputs.length - 1; gi++) {
      const out = outputs[gi]; if (!out || !out[0]) continue;
      const L = this.bufL[gi], R2 = this.bufR[gi];
      for (let i = 0; i < N; i++) { let l = L[i], r = R2[i]; if (l !== l || l > 8 || l < -8) l = 0; if (r !== r || r > 8 || r < -8) r = 0; out[0][i] = l; if (out[1]) out[1][i] = r; }
    }
    const mo = outputs[MAX_GEN];
    if (mo && mo[0] && this.click.length) {
      for (const c of this.click) for (let i = 0; i < N; i++) {
        if (c.t >= c.n) break; if (c.d > 0) { c.d--; continue; }
        const s = Math.sin(TAU * c.f * c.t / this.sr) * Math.exp(-c.t / (this.sr * 0.012)) * 0.35; mo[0][i] += s; if (mo[1]) mo[1][i] += s; c.t++;
      }
      this.click = this.click.filter(c => c.t < c.n);
    }
    // 3.17.1: etwa 30× je Sekunde die klingenden Werte der Oszillatoren an die Oberfläche (die Regler zeigen sie)
    if ((this.clock >> 7) % 12 === 0) {
      let v = null;
      for (const g of this.gens) if (g.live) { const x = g.live(); if (x) (v || (v = {}))[g.id] = x; }
      if (v || this.liveWas) this.port.postMessage({ t: "live", v: v || {} });
      this.liveWas = !!v;
    }
    this.clock += N;
    return true;
  }
}
registerProcessor("mws-loops", Loops);

// Abgriff für die Aufnahme: sammelt die Summe hinter dem Limiter und schickt sie in Stücken (je ~0,34 s) an den Hauptthread
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.on = false; this.n = 0; this.L = new Float32Array(16384); this.R = new Float32Array(16384);
    this.port.onmessage = (e) => { const d = e.data || {}; if (d.flush && this.n) this.flush(); if (d.on != null) { if (!d.on && this.n) this.flush(); this.on = !!d.on; } }; }
  flush() { this.port.postMessage({ L: this.L.slice(0, this.n), R: this.R.slice(0, this.n), t0: this.t0 }); this.n = 0; }
  process(inputs, outputs) {
    const inp = inputs[0] || [], L = inp[0], R2 = inp[1] || inp[0];
    const o = outputs[0]; if (o && o[0] && L) { o[0].set(L); if (o[1]) o[1].set(R2 || L); }
    // t0 = Zeit des ersten Samples im Stück (damit der Hauptthread taktgenau schneiden kann)
    if (this.on && L) { if (this.n === 0) this.t0 = currentTime; this.L.set(L, this.n); this.R.set(R2 || L, this.n); this.n += L.length; if (this.n >= 16384 - 128) this.flush(); }
    return true;
  }
}
registerProcessor("mws-tap", Tap);
