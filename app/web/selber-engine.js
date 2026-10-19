// Manuwave Studio 3.15 — "Selber machen": der Klangmotor im Audio-Thread (AudioWorklet).
//
// EIN Prozessor trägt alles, was im Takt sein muss: den Sequencer (Pattern, Song, Swing, Aufnahme, Metronom),
// alle Instrumente jeder Spur und die Drum-Machine. Darum läuft der Takt auch dann sauber, wenn der Tab im
// Hintergrund liegt (ein Zeitgeber im Hauptthread würde dort gedrosselt), und "Track erzeugen" rechnet in einem
// OfflineAudioContext Sample für Sample dasselbe wie das Live-Spiel.
//   Ausgänge 0…15  = je Spur ein Stereo-Bus (Effekte, Lautstärke, Panorama baut der Hauptthread mit Web Audio)
//   Ausgang  16    = Metronom (geht nie in einen fertigen Track)
// Klang: Oszillatoren mit PolyBLEP (kein Aliasing-Kratzen), Wavetables bandbegrenzt je Oktave, Kaskaden-Filter
// mit sanfter Sättigung, Hüllkurven exponentiell. Pegel bewusst niedrig — der Limiter sitzt am Ende der Kette.
"use strict";

const TAU = Math.PI * 2;
const SIN_N = 4096;
const SIN = new Float32Array(SIN_N + 1);
for (let i = 0; i <= SIN_N; i++) SIN[i] = Math.sin(TAU * i / SIN_N);
function sinp(ph) {              // Phase 0…1 (beliebig) → sin
  ph -= Math.floor(ph);
  const x = ph * SIN_N, i = x | 0, f = x - i;
  return SIN[i] + (SIN[i + 1] - SIN[i]) * f;
}
function tanh(x) {               // weiche Sättigung, ab |x| = 3 flach
  if (x > 3) return 1; if (x < -3) return -1;
  const x2 = x * x; return x * (27 + x2) / (27 + 9 * x2);
}
function blep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}
const mtof = (n) => 440 * Math.pow(2, (n - 69) / 12);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const num = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);

let seed = 22222;
function rnd() { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) / 4294967296) * 2 - 1; }

// ---------- Hüllkurve ----------
class Env {
  constructor() { this.st = 0; this.v = 0; this.a = 0.01; this.dc = 0; this.s = 1; this.rc = 0; }
  set(a, d, s, r, sr) {
    this.ai = 1 / Math.max(1, a * sr);
    this.dc = Math.exp(-4.6 / Math.max(1, d * sr));
    this.s = clamp(s, 0, 1);
    this.rc = Math.exp(-4.6 / Math.max(1, r * sr));
  }
  on(legato) { if (!legato || this.st === 0 || this.st === 4) this.st = 1; }
  off() { if (this.st !== 0) this.st = 4; }
  kill() { this.st = 0; this.v = 0; }
  next() {
    switch (this.st) {
      case 1: this.v += this.ai; if (this.v >= 1) { this.v = 1; this.st = 2; } break;
      case 2: this.v = this.s + (this.v - this.s) * this.dc; if (Math.abs(this.v - this.s) < 1e-4) { this.v = this.s; this.st = 3; } break;
      case 3: this.v = this.s; break;
      case 4: this.v *= this.rc; if (this.v < 1e-4) { this.v = 0; this.st = 0; } break;
    }
    return this.v;
  }
}

// ---------- Filter ----------
// Kaskade aus vier TPT-Einpolfiltern mit aufgelöster Rückkopplung (24 dB, "Leiter") — Sättigung am Eingang.
class Ladder {
  constructor() { this.s1 = 0; this.s2 = 0; this.s3 = 0; this.s4 = 0; }
  run(x, g, k, drive) {
    const G = g / (1 + g), b = 1 / (1 + g);
    const G2 = G * G, G3 = G2 * G, G4 = G3 * G;
    const S = G3 * b * this.s1 + G2 * b * this.s2 + G * b * this.s3 + b * this.s4;
    const y4 = (G4 * x + S) / (1 + k * G4);
    let u = tanh((x * (1 + k * 0.45) - k * y4) * drive) / (drive > 1 ? Math.sqrt(drive) : 1);
    let v = (u - this.s1) * G, y = v + this.s1; this.s1 = y + v;
    v = (y - this.s2) * G; y = v + this.s2; this.s2 = y + v;
    v = (y - this.s3) * G; y = v + this.s3; this.s3 = y + v;
    v = (y - this.s4) * G; y = v + this.s4; this.s4 = y + v;
    return y;
  }
  reset() { this.s1 = this.s2 = this.s3 = this.s4 = 0; }
}
// Zustandsvariablen-Filter (Simper) — 12 dB Tief-, Hoch-, Bandpass, Kerbe
class SVF {
  constructor() { this.a = 0; this.b = 0; }
  run(x, g, k, mode) {
    const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
    const v3 = x - this.b, v1 = a1 * this.a + a2 * v3, v2 = this.b + a2 * this.a + a3 * v3;
    this.a = 2 * v1 - this.a; this.b = 2 * v2 - this.b;
    if (this.a > 1e6 || this.a < -1e6 || this.a !== this.a) { this.a = 0; this.b = 0; return 0; }
    switch (mode) {
      case 1: return x - k * v1 - v2;        // Hochpass
      case 2: return v1;                     // Bandpass
      case 3: return x - k * v1;             // Kerbe
      default: return v2;                    // Tiefpass
    }
  }
  reset() { this.a = this.b = 0; }
}
// einfacher Biquad (RBJ) für Drums und Körper-Resonanzen
class Biquad {
  constructor() { this.x1 = this.x2 = this.y1 = this.y2 = 0; this.b0 = 1; this.b1 = this.b2 = this.a1 = this.a2 = 0; }
  bp(f, q, sr) { const w = TAU * clamp(f, 10, sr * 0.45) / sr, al = Math.sin(w) / (2 * q), c = Math.cos(w), a0 = 1 + al;
    this.b0 = al / a0; this.b1 = 0; this.b2 = -al / a0; this.a1 = -2 * c / a0; this.a2 = (1 - al) / a0; return this; }
  hp(f, q, sr) { const w = TAU * clamp(f, 10, sr * 0.45) / sr, al = Math.sin(w) / (2 * q), c = Math.cos(w), a0 = 1 + al;
    this.b0 = (1 + c) / 2 / a0; this.b1 = -(1 + c) / a0; this.b2 = this.b0; this.a1 = -2 * c / a0; this.a2 = (1 - al) / a0; return this; }
  lp(f, q, sr) { const w = TAU * clamp(f, 10, sr * 0.45) / sr, al = Math.sin(w) / (2 * q), c = Math.cos(w), a0 = 1 + al;
    this.b0 = (1 - c) / 2 / a0; this.b1 = (1 - c) / a0; this.b2 = this.b0; this.a1 = -2 * c / a0; this.a2 = (1 - al) / a0; return this; }
  run(x) { const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y; return y; }
}

// ---------- Wavetables: 16 Bilder je Satz, je Oktave bandbegrenzt (per FFT) ----------
const WT_N = 2048, WT_FRAMES = 16, WT_LEVELS = 11;
function fft(re, im, inv) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = TAU / len * (inv ? 1 : -1), wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const ar = re[i + j], ai = im[i + j], br = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci, bi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j] = ar + br; im[i + j] = ai + bi; re[i + j + len / 2] = ar - br; im[i + j + len / 2] = ai - bi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
// Zeitbereichs-Formen je Satz: f(x 0…1, m 0…1 = Bildposition) → −1…1
const WT_SHAPES = {
  analog(x, m) {             // Sinus → Dreieck → Sägezahn → Rechteck → schmaler Puls
    const s = Math.sin(TAU * x), tr = 1 - 4 * Math.abs(x - 0.5) , sw = 2 * x - 1, sq = x < 0.5 ? 1 : -1, pu = x < 0.12 ? 1 : -1;
    const seq = [s, -tr, sw, sq, pu], p = m * 4, i = Math.min(3, Math.floor(p)), f = p - i;
    return seq[i] * (1 - f) + seq[i + 1] * f;
  },
  pwm(x, m) { return x < 0.5 - m * 0.47 ? 1 : -1; },
  sync(x, m) { const r = 1 + m * 7; const p = (x * r) % 1; return (2 * p - 1) * (1 - x * 0.3); },
  fold(x, m) { let v = Math.sin(TAU * x) * (1 + m * 6); for (let k = 0; k < 6; k++) { if (v > 1) v = 2 - v; else if (v < -1) v = -2 - v; } return v; },
  vocal(x, m) {              // Vokale A → E → I → O → U, Formanten bei 110 Hz Grundton gedacht
    const V = [[730, 1090, 2440], [530, 1840, 2480], [270, 2290, 3010], [570, 840, 2410], [300, 870, 2240]];
    const p = m * 4, i = Math.min(3, Math.floor(p)), f = p - i;
    const F = V[i].map((v, k) => v * (1 - f) + V[i + 1][k] * f);
    let s = 0;
    for (let h = 1; h <= 40; h++) {
      const fr = h * 110; let a = 0;
      for (let k = 0; k < 3; k++) { const bw = 60 + k * 50; a += (k === 0 ? 1 : 0.6 / k) / (1 + Math.pow((fr - F[k]) / bw, 2)); }
      s += a * Math.sin(TAU * h * x) / Math.sqrt(h);
    }
    return s;
  },
  bell(x, m) {               // glasig: hohe Teiltöne kommen nach vorn
    let s = Math.sin(TAU * x);
    const P = [[3, 0.6], [5, 0.45], [7, 0.4], [9, 0.3], [12, 0.35], [15, 0.25], [19, 0.2]];
    for (const [h, a] of P) s += a * m * 1.4 * Math.sin(TAU * h * x + h);
    return s;
  },
};
const WT = {};
function wavetable(name) {
  if (WT[name]) return WT[name];
  const shape = WT_SHAPES[name] || WT_SHAPES.analog;
  const frames = [];
  const re = new Float64Array(WT_N), im = new Float64Array(WT_N);
  for (let fi = 0; fi < WT_FRAMES; fi++) {
    const m = fi / (WT_FRAMES - 1);
    for (let i = 0; i < WT_N; i++) { re[i] = shape(i / WT_N, m); im[i] = 0; }
    fft(re, im, false);
    re[0] = 0; im[0] = 0;                                  // kein Gleichanteil
    const specR = Float64Array.from(re), specI = Float64Array.from(im);
    const levels = [];
    let norm = 0;
    for (let L = 0; L < WT_LEVELS; L++) {
      const maxH = Math.max(1, Math.floor((WT_N / 2 - 1) / Math.pow(2, L)));
      for (let h = 0; h < WT_N; h++) {
        const hh = h <= WT_N / 2 ? h : WT_N - h;
        const keep = hh <= maxH;
        re[h] = keep ? specR[h] : 0; im[h] = keep ? specI[h] : 0;
      }
      fft(re, im, true);
      const t = new Float32Array(WT_N + 1);
      for (let i = 0; i < WT_N; i++) t[i] = re[i] / WT_N;
      t[WT_N] = t[0];
      if (L === 0) { for (let i = 0; i < WT_N; i++) norm = Math.max(norm, Math.abs(t[i])); norm = norm || 1; }
      for (let i = 0; i <= WT_N; i++) t[i] /= norm;
      levels.push(t);
    }
    frames.push(levels);
  }
  return (WT[name] = frames);
}
function wtLevel(f, sr) {          // Oktavstufe so wählen, dass kein Teilton über Nyquist liegt
  const base = sr / 2 / (WT_N / 2 - 1);
  let L = f <= base ? 0 : Math.ceil(Math.log2(f / base)); if (L >= WT_LEVELS) L = WT_LEVELS - 1;
  return L;
}
function wtRead(tab, pos, ph, L) {
  const p = clamp(pos, 0, 1) * (WT_FRAMES - 1), fi = Math.min(WT_FRAMES - 2, p | 0), ff = p - fi;
  ph -= Math.floor(ph);
  const x = ph * WT_N, i = x | 0, fr = x - i;
  const a = tab[fi][L], b = tab[fi + 1][L];
  const va = a[i] + (a[i + 1] - a[i]) * fr, vb = b[i] + (b[i + 1] - b[i]) * fr;
  return va + (vb - va) * ff;
}

// ---------- LFO (je Instrument, wie bei den meisten Synthesizern) ----------
const SHAPE = { sine: 0, tri: 1, saw: 2, square: 3, sh: 4 };
class LFO {
  constructor() { this.ph = 0; this.v = 0; this.sh = 0; }
  next(rate, shape, sr) {
    const old = this.ph; this.ph += rate / sr; if (this.ph >= 1) { this.ph -= 1; this.sh = rnd(); }
    switch (shape) {
      case 1: return 1 - 4 * Math.abs(this.ph - 0.5);
      case 2: return 1 - 2 * this.ph;
      case 3: return this.ph < 0.5 ? 1 : -1;
      case 4: return this.sh;
      default: return sinp(this.ph);
    }
  }
}
const SYNC_BEATS = { "1/1": 4, "1/2": 2, "1/2T": 4 / 3, "1/4": 1, "1/4T": 2 / 3, "1/8": 0.5, "1/8T": 1 / 3, "1/16": 0.25, "1/16T": 1 / 6, "2/1": 8, "4/1": 16 };
function lfoRate(rate, sync, bpm) { const b = SYNC_BEATS[sync]; return b ? (bpm / 60) / b : rate; }

// =====================================================================================================
// Instrumente — gemeinsame Hülle: Stimmenverwaltung, Haltepedal, Arpeggiator, Pitchbend, Modulationsrad
// =====================================================================================================
const ARP_RATE = { "1/4": 4, "1/8": 2, "1/8T": 4 / 3, "1/16": 1, "1/16T": 2 / 3, "1/32": 0.5 };
class Instrument {
  constructor(eng, patch) {
    this.eng = eng; this.sr = eng.sr; this.p = {}; this.voices = []; this.bend = 0; this.mw = 0;
    this.sustain = false; this.held = new Map(); this.sustained = new Set(); this.order = 0;
    this.arpHeld = []; this.arpIdx = 0; this.arpNote = null; this.arpNext = 0; this.arpOffAt = 0; this.arpUp = true;
    this.setPatch(patch || {});
  }
  setPatch(p) { this.p = Object.assign({}, p); this.update(); }
  set(k, v) { this.p[k] = v; this.update(k); }
  update() {}
  // --- Eingang (Live-Tasten UND Sequencer laufen hier durch — der Arpeggiator sieht beide) ---
  input(on, n, v, id) {
    const arp = this.p.arp && this.p.arp !== "off";
    if (arp) {
      if (on) {
        if (this.p.arplatch && !this.arpHeld.some(h => h.down)) this.arpHeld = [];
        this.arpHeld = this.arpHeld.filter(h => h.n !== n);
        this.arpHeld.push({ n, v, down: true, at: this.order++ });
        if (this.arpHeld.length === 1 && !this.eng.playing) this.arpNext = 0;   // frei laufend: sofort
      } else {
        const h = this.arpHeld.find(x => x.n === n);
        if (h) { if (this.p.arplatch) h.down = false; else this.arpHeld = this.arpHeld.filter(x => x.n !== n); }
        if (!this.arpHeld.length && this.arpNote != null) { this.noteOff(this.arpNote, -7); this.arpNote = null; }
      }
      return;
    }
    if (on) this.noteOn(n, v, id); else this.release(n, id);
  }
  release(n, id) {
    if (this.sustain) { this.sustained.add(id + ":" + n); return; }
    this.noteOff(n, id);
  }
  pedal(on) {
    this.sustain = on;
    if (!on) { for (const k of this.sustained) { const [id, n] = k.split(":").map(Number); this.noteOff(n, id); } this.sustained.clear(); }
  }
  arpStep() { return ARP_RATE[this.p.arprate] || 1; }
  arpTick() {                 // nächste Note des Arpeggiators
    if (this.arpNote != null) { this.noteOff(this.arpNote, -7); this.arpNote = null; }
    const list = this.arpHeld.slice();
    if (!list.length) return;
    const oct = clamp(Math.round(num(this.p.arpoct, 1)), 1, 4);
    let seq = [];
    const mode = this.p.arp;
    const base = mode === "order" ? list.sort((a, b) => a.at - b.at) : list.sort((a, b) => a.n - b.n);
    for (let o = 0; o < oct; o++) for (const h of base) seq.push({ n: h.n + 12 * o, v: h.v });
    if (mode === "down") seq.reverse();
    let pick;
    if (mode === "random") pick = seq[Math.floor((rnd() * 0.5 + 0.5) * seq.length) % seq.length];
    else if (mode === "updown" && seq.length > 1) {
      const ud = seq.concat(seq.slice(1, -1).reverse());
      pick = ud[this.arpIdx % ud.length];
    } else pick = seq[this.arpIdx % seq.length];
    this.arpIdx++;
    this.arpNote = pick.n;
    this.noteOn(pick.n, pick.v, -7);
    this.arpOffAt = this.eng.clock + Math.max(8, this.arpStep() * this.eng.sps * clamp(num(this.p.arpgate, 0.5), 0.05, 1));
  }
  // vom Motor je Block aufgerufen (Arpeggiator-Takt)
  clockBlock(from, to) {
    if (!this.p.arp || this.p.arp === "off") { if (this.arpNote != null) { this.noteOff(this.arpNote, -7); this.arpNote = null; } return []; }
    const ev = [];
    if (this.arpNote != null && this.arpOffAt >= from && this.arpOffAt < to) { ev.push({ f: this.arpOffAt - from, off: true }); }
    if (!this.arpHeld.length) return ev;
    const stepLen = this.arpStep();
    if (this.eng.playing && this.eng.blockPos >= 0) {
      // im Takt: auf jedem Vielfachen der Notenlänge (Position im Pattern zu Blockbeginn)
      const p0 = this.eng.blockPos, p1 = p0 + (to - from) / this.eng.sps;
      let k = Math.ceil(p0 / stepLen - 1e-9) * stepLen;
      for (; k < p1; k += stepLen) ev.push({ f: Math.floor((k - p0) * this.eng.sps), tick: true });
    } else {
      if (this.arpNext < from) this.arpNext = from;
      while (this.arpNext < to) { ev.push({ f: this.arpNext - from, tick: true }); this.arpNext += stepLen * this.eng.sps; }
    }
    return ev;
  }
  allOff() { for (const v of this.voices) if (v.active) v.release(); this.arpHeld = []; this.arpNote = null; this.sustained.clear(); }
  panic() { for (const v of this.voices) v.kill(); this.arpHeld = []; this.arpNote = null; this.sustained.clear(); }
  // --- Stimmenzuteilung ---
  pickVoice(n, id) {
    const max = clamp(Math.round(num(this.p.voices, 8)), 1, 16);
    const mono = this.p.mode === "mono" || this.p.mode === "legato";
    if (mono) {
      let v = this.voices[0];
      if (!v) { v = this.makeVoice(); this.voices.push(v); }
      return v;
    }
    let v = this.voices.find(x => !x.active);
    if (!v && this.voices.length < max) { v = this.makeVoice(); this.voices.push(v); }
    if (!v) {          // stehlen: zuerst die älteste losgelassene, sonst die älteste
      let best = null;
      for (const x of this.voices) if (x.released && (!best || x.t < best.t)) best = x;
      if (!best) for (const x of this.voices) if (!best || x.t < best.t) best = x;
      v = best;
    }
    return v;
  }
  noteOn(n, v, id) {
    const mono = this.p.mode === "mono" || this.p.mode === "legato";
    if (mono) {
      this.held.set(id + ":" + n, { n, v, id, at: this.order++ });
      const voice = this.pickVoice(n, id);
      const legato = voice.active && !voice.released && this.p.mode === "legato";
      const glide = voice.active && !voice.released && num(this.p.glide, 0) > 0;
      voice.start(n, v, id, legato, glide || (this.p.mode === "legato" && voice.active), this.order++);
      return;
    }
    const voice = this.pickVoice(n, id);
    voice.start(n, v, id, false, num(this.p.glide, 0) > 0 && voice.active, this.order++);
  }
  noteOff(n, id) {
    const mono = this.p.mode === "mono" || this.p.mode === "legato";
    if (mono) {
      this.held.delete(id + ":" + n);
      const voice = this.voices[0];
      if (!voice || !voice.active) return;
      if (voice.n === n) {
        let last = null; for (const h of this.held.values()) if (!last || h.at > last.at) last = h;
        if (last) voice.start(last.n, last.v, last.id, true, true, this.order++);
        else voice.release();
      }
      return;
    }
    for (const voice of this.voices) if (voice.active && !voice.released && voice.n === n && (voice.id === id || id == null)) { voice.release(); break; }
  }
  render(L, R, a, b) { for (const v of this.voices) if (v.active) v.render(L, R, a, b); }
  pitchMul() { return Math.pow(2, this.bend * num(this.p.pb, 2) / 12); }
}

// ---------------- Virtuell-Analog (auch Wavetable, Supersaw, Acid, Strings) ----------------
const WAVE = { saw: 0, square: 1, pulse: 1, tri: 2, sine: 3, wt: 4, noise: 5 };
const FTYPE = { lp24: 0, lp12: 1, hp12: 2, bp12: 3, notch: 4 };
const LDEST = { off: 0, pitch: 1, cut: 2, pw: 3, amp: 4, pan: 5, wt: 6 };
class VAVoice {
  constructor(ins) {
    this.ins = ins; this.active = false; this.released = false; this.t = 0;
    this.amp = new Env(); this.fenv = new Env();
    this.ph1 = new Float64Array(7); this.ph2 = new Float64Array(7); this.ph3 = new Float64Array(7); this.phs = 0;
    this.hp = new Float64Array(4);        // Hochpass vor dem Filter (2 × einpolig, L/R)
    this.fL = new Ladder(); this.fR = new Ladder(); this.sL = new SVF(); this.sR = new SVF();
    this.freq = 440; this.target = 440; this.vel = 1; this.n = 60; this.id = 0;
    this.tri1 = 0; this.tri2 = 0;
  }
  start(n, v, id, legato, glide, t) {
    const ins = this.ins, p = ins.p;
    this.n = n; this.id = id; this.vel = v; this.t = t; this.released = false;
    this.target = mtof(n);
    if (!glide || !this.active) this.freq = this.target;
    if (!this.active) {
      for (let i = 0; i < 7; i++) { this.ph1[i] = (rnd() * 0.5 + 0.5); this.ph2[i] = (rnd() * 0.5 + 0.5); this.ph3[i] = (rnd() * 0.5 + 0.5); }
      if (p.uni <= 1) { this.ph1[0] = 0; this.ph2[0] = 0; }
      this.hp.fill(0);
      this.fL.reset(); this.fR.reset(); this.sL.reset(); this.sR.reset();
    }
    this.active = true;
    ins.envSet(this);
    this.amp.on(legato); this.fenv.on(legato);
  }
  release() { this.released = true; this.amp.off(); this.fenv.off(); }
  kill() { this.active = false; this.amp.kill(); this.fenv.kill(); }
  render(L, R, a, b) {
    const ins = this.ins, p = ins.p, sr = ins.sr, m = ins.mod;
    const uni = clamp(Math.round(num(p.uni, 1)), 1, 7);
    const det = num(p.unidet, 0.2) * 0.5, spread = num(p.unispread, 0.5);
    const w1 = WAVE[p.o1w] ?? 0, w2 = WAVE[p.o2w] ?? 0;
    const l1 = num(p.o1lvl, 0.8), l2 = num(p.o2lvl, 0), lsub = num(p.sub, 0), lno = num(p.noise, 0);
    // 3.16: dritter Oszillator (Minimoog, Taurus) — ohne Wavetable, läuft frei (kein Sync)
    const l3 = num(p.o3lvl, 0), w3 = l3 > 0 ? (WAVE[p.o3w] ?? 0) : 0;
    const r3 = Math.pow(2, num(p.o3oct, 0) + (num(p.o3semi, 0) + num(p.o3fine, 0) / 100) / 12);
    // 3.16: Hochpass vor dem Filter (Juno, MS-20) — zwei einpolige Stufen, 12 dB/Okt.
    const hpf = num(p.hpf, 20), hpA = hpf > 21 ? 1 - Math.exp(-2 * Math.PI * Math.min(hpf, sr * 0.2) / sr) : 0;
    const r1 = Math.pow(2, num(p.o1oct, 0) + (num(p.o1semi, 0) + num(p.o1fine, 0) / 100) / 12);
    const r2 = Math.pow(2, num(p.o2oct, 0) + (num(p.o2semi, 0) + num(p.o2fine, 0) / 100) / 12);
    const sync = p.o2sync ? 1 : 0, fmA = num(p.fm, 0) * 3;
    const tab = (w1 === 4 || w2 === 4) ? wavetable(p.wtset || "analog") : null;
    const ftype = FTYPE[p.ftype] ?? 0, res = num(p.res, 0.2), fenvA = num(p.fenv, 0.3), fkey = num(p.fkey, 0.3);
    const fvel = num(p.fvel, 0.3), drive = 1 + num(p.drive, 0) * 6, dsq = Math.sqrt(drive);
    const velA = 1 - num(p.velamp, 0.5) * (1 - this.vel);
    const glideC = num(p.glide, 0) > 0 ? Math.exp(-1 / (num(p.glide, 0.1) * sr * 0.25)) : 0;
    const baseOct = Math.log2(Math.max(20, num(p.cut, 2000)) / 20) + (this.n - 60) / 12 * fkey + (this.vel - 0.7) * fvel * 3;
    const norm = 0.3 / Math.pow(uni, 0.62);
    const accent = this.vel > 0.94 ? num(p.accent, 0) : 0;
    const k24 = res * 4.1 + accent * 0.6, k12 = 2 - 1.96 * res;
    const wtEnv = num(p.wtenv, 0), wtLfo = num(p.wtlfo, 0);
    const pw1b = num(p.o1pw, 0.5), pw2b = num(p.o2pw, 0.5);
    const bendM = ins.pitchMul();
    const dms = this.dms || (this.dms = new Float64Array(7)), pans = this.pans || (this.pans = new Float64Array(7));
    for (let u = 0; u < uni; u++) { const off = uni === 1 ? 0 : (u / (uni - 1) - 0.5) * 2; dms[u] = Math.pow(2, off * det / 12); pans[u] = off * spread; }
    const tri1 = this.tr1 || (this.tr1 = new Float64Array(7)), tri2 = this.tr2 || (this.tr2 = new Float64Array(7)), tri3 = this.tr3 || (this.tr3 = new Float64Array(7));
    const ampAcc = 1 + accent * 0.5;
    const stereo = uni > 1 && spread > 0;          // ohne Stereobreite reicht ein Filter (halbe Rechenzeit)
    let g = this.g || 0.1;
    const fNow = this.freq * bendM * Math.max(1, det > 0 ? Math.pow(2, det / 12) : 1);
    const lv1 = tab ? wtLevel(fNow * r1 * 1.06, sr) : 0, lv2 = tab ? wtLevel(fNow * r2 * 1.06, sr) : 0;
    for (let i = a; i < b; i++) {
      if (glideC) this.freq = this.target + (this.freq - this.target) * glideC;
      const f0 = this.freq * m.pitch[i] * bendM;
      const e = this.amp.next(), fe = this.fenv.next();
      if (this.amp.st === 0) { this.active = false; break; }
      const pw1 = clamp(pw1b + m.pw[i], 0.03, 0.97), pw2 = clamp(pw2b + m.pw[i], 0.03, 0.97);
      const wtpos = tab ? clamp(m.wt[i] + wtEnv * fe + wtLfo * m.lfo2[i] * 0.5, 0, 1) : 0;
      let sl = 0, sr2 = 0;
      for (let u = 0; u < uni; u++) {
        const fA = f0 * r1 * dms[u], fB = f0 * r2 * dms[u];
        const dtA = fA / sr, dtB = fB / sr;
        let o2 = 0;
        if (l2 > 0 || fmA > 0) {
          let ph = this.ph2[u];
          o2 = osc(w2, ph, dtB, pw2, tab, wtpos, lv2, sr, tri2, u);
          ph += dtB; if (ph >= 1) ph -= 1; this.ph2[u] = ph;
        }
        let ph = this.ph1[u];
        const dA = fmA > 0 ? dtA * (1 + fmA * o2) : dtA;
        const o1 = osc(w1, ph, dA > 0 ? dA : -dA || 1e-6, pw1, tab, wtpos, lv1, sr, tri1, u, dA < 0 ? -1 : 1);
        ph += dA; if (ph >= 1) { ph -= 1; if (sync) this.ph2[u] = 0; } else if (ph < 0) ph += 1;
        this.ph1[u] = ph;
        let s = o1 * l1 + o2 * l2;
        if (l3 > 0) {
          const dtC = f0 * r3 * dms[u] / sr;
          let p3 = this.ph3[u];
          s += osc(w3 === 4 ? 0 : w3, p3, dtC, pw1, null, 0, 0, sr, tri3, u) * l3;
          p3 += dtC; if (p3 >= 1) p3 -= 1; this.ph3[u] = p3;
        }
        const pan = pans[u];
        sl += s * (1 - pan); sr2 += s * (1 + pan);
      }
      sl *= norm; sr2 *= norm;
      if (lsub > 0) {
        const dts = f0 * r1 * 0.5 / sr;
        this.phs += dts; if (this.phs >= 1) this.phs -= 1;
        let sq = this.phs < 0.5 ? 1 : -1; sq += blep(this.phs, dts); let t2 = this.phs - 0.5; if (t2 < 0) t2 += 1; sq -= blep(t2, dts);
        sl += sq * lsub * 0.3; sr2 += sq * lsub * 0.3;
      }
      if (lno > 0) { const nz = rnd() * lno * 0.25; sl += nz; sr2 += nz; }
      if (hpA) {
        const hp = this.hp;
        hp[0] += hpA * (sl - hp[0]); sl -= hp[0]; hp[1] += hpA * (sl - hp[1]); sl -= hp[1];
        if (stereo) { hp[2] += hpA * (sr2 - hp[2]); sr2 -= hp[2]; hp[3] += hpA * (sr2 - hp[3]); sr2 -= hp[3]; }
      }
      // Filter (Steuerrate: alle 4 Samples)
      if ((i & 3) === 0 || i === a) {
        const oct = baseOct + fenvA * fe * 7 + m.cut[i] + accent * 1.2;
        const fc = clamp(20 * Math.pow(2, oct), 20, sr * 0.45);
        g = Math.tan(Math.PI * fc / sr);
      }
      let yl, yr;
      if (ftype === 0) { yl = this.fL.run(sl, g, k24, drive); yr = stereo ? this.fR.run(sr2, g, k24, drive) : yl; }
      else {
        const md = ftype - 1;
        const xl = drive > 1 ? tanh(sl * drive) / dsq : sl, xr = drive > 1 ? tanh(sr2 * drive) / dsq : sr2;
        yl = this.sL.run(xl, g, k12, md); yr = stereo ? this.sR.run(xr, g, k12, md) : yl;
      }
      const amp = e * velA * m.amp[i] * ampAcc;
      const pn = m.pan[i];
      L[i] += yl * amp * (1 - pn); R[i] += yr * amp * (1 + pn);
    }
    this.g = g;
  }
}
// ein Oszillatorwert
function osc(w, ph, dt, pw, tab, wtpos, f, sr, tri, u, dir = 1) {   // dir: -1, wenn tiefe FM die Phase rückwärts laufen lässt
  switch (w) {
    case 0: return 2 * ph - 1 - blep(ph, dt);
    case 1: { let v = ph < pw ? 1 : -1; v += blep(ph, dt); let t = ph - pw; if (t < 0) t += 1; v -= blep(t, dt); return v; }
    case 2: {   // Dreieck aus integriertem, bandbegrenztem Rechteck (leicht leckend gegen Gleichanteil)
      let v = ph < 0.5 ? 1 : -1; v += blep(ph, dt); let t = ph - 0.5; if (t < 0) t += 1; v -= blep(t, dt);
      tri[u] = tri[u] * 0.9998 + v * 4 * dt * dir; return tri[u];
    }
    case 3: return sinp(ph);
    case 4: return tab ? wtRead(tab, wtpos, ph, f) : 0;      // f = Oktavstufe (je Block)
    case 5: return rnd();
  }
  return 0;
}
class VA extends Instrument {
  constructor(eng, patch) { super(eng, patch); this.l1 = new LFO(); this.l2 = new LFO(); this.cutS = null; }
  makeVoice() { return new VAVoice(this); }
  update() {
    for (const v of this.voices) if (v.active) this.envSet(v);
    if (this.p.o1w === "wt" || this.p.o2w === "wt") wavetable(this.p.wtset || "analog");
  }
  envSet(v) {
    const p = this.p, sr = this.sr;
    v.amp.set(num(p.aa, 0.005), num(p.ad, 0.3), num(p.as, 0.7), num(p.ar, 0.3), sr);
    v.fenv.set(num(p.fa, 0.005), num(p.fd, 0.4), num(p.fs, 0.3), num(p.fr, 0.4), sr);
  }
}
// gemeinsame Modulation je Block (LFOs, Rad) → Arrays, die alle Stimmen lesen
function modBlock(ins, a, b) {
  const p = ins.p, sr = ins.sr, bpm = ins.eng.bpm;
  const m = ins.mod || (ins.mod = { pitch: new Float32Array(128), cut: new Float32Array(128), pw: new Float32Array(128),
    amp: new Float32Array(128), pan: new Float32Array(128), wt: new Float32Array(128), lfo2: new Float32Array(128) });
  const r1 = lfoRate(num(p.l1rate, 4), p.l1sync, bpm), r2 = lfoRate(num(p.l2rate, 0.5), p.l2sync, bpm);
  const s1 = SHAPE[p.l1shape] ?? 0, s2 = SHAPE[p.l2shape] ?? 0;
  const d1 = LDEST[p.l1dest] ?? 0, d2 = LDEST[p.l2dest] ?? 0;
  const a1 = num(p.l1amt, 0), a2 = num(p.l2amt, 0);
  const mw = ins.mw || 0, mwd = p.mw || "vib";
  const wtb = num(p.wtpos, 0);
  const acc = ins.acc || (ins.acc = new Float64Array(7));     // pitch, cut, pw, amp, pan, wt
  if (!d1 && !d2 && !(mw > 0)) {                              // nichts moduliert: Konstanten, LFOs laufen nur weiter
    m.pitch.fill(1, a, b); m.cut.fill(0, a, b); m.pw.fill(0, a, b); m.amp.fill(1, a, b); m.pan.fill(0, a, b); m.wt.fill(wtb, a, b);
    const n = b - a;
    ins.l1.ph = (ins.l1.ph + n * r1 / sr) % 1; ins.l2.ph = (ins.l2.ph + n * r2 / sr) % 1;
    if (wtLfo(ins)) for (let i = a; i < b; i++) m.lfo2[i] = ins.l2.next(0, s2, sr), ins.l2.ph = (ins.l2.ph + r2 / sr) % 1;
    return m;
  }
  for (let i = a; i < b; i++) {
    const v1 = ins.l1.next(r1, s1, sr), v2 = ins.l2.next(r2, s2, sr);
    acc[1] = 0; acc[2] = 0; acc[3] = 0; acc[4] = 1; acc[5] = 0; acc[6] = wtb;
    if (d1) modAdd(acc, d1, v1, a1);
    if (d2) modAdd(acc, d2, v2, a2);
    if (mw > 0) { if (mwd === "vib") acc[1] += v1 * mw * 0.6; else if (mwd === "cut") acc[2] += mw * 3; else if (mwd === "wt") acc[6] += mw * 0.6; }
    m.pitch[i] = acc[1] === 0 ? 1 : Math.pow(2, acc[1] / 12); m.cut[i] = acc[2]; m.pw[i] = acc[3]; m.amp[i] = acc[4];
    m.pan[i] = clamp(acc[5], -0.95, 0.95); m.wt[i] = acc[6]; m.lfo2[i] = v2;
  }
  return m;
}
function wtLfo(ins) { return num(ins.p.wtlfo, 0) > 0 && (ins.p.o1w === "wt" || ins.p.o2w === "wt"); }
function modAdd(acc, d, v, amt) {
  switch (d) {
    case 1: acc[1] += v * amt * 2; break;               // bis ±2 Halbtöne
    case 2: acc[2] += v * amt * 4; break;               // bis ±4 Oktaven
    case 3: acc[3] += v * amt * 0.45; break;
    case 4: acc[4] *= 1 - amt * 0.5 * (1 - v); break;
    case 5: acc[5] += v * amt * 0.8; break;
    case 6: acc[6] += v * amt * 0.5; break;
  }
}

// ---------------- FM, vier Operatoren ----------------
// Algorithmen: wer moduliert wen (4 = oberster). carriers = Operatoren, die man hört.
const ALGOS = [
  { mods: { 1: [2], 2: [3], 3: [4] }, car: [1] },            // 1: 4→3→2→1
  { mods: { 1: [2], 2: [3, 4] }, car: [1] },                 // 2: (3+4)→2→1
  { mods: { 1: [2, 3], 3: [4] }, car: [1] },                 // 3: 2→1, 4→3→1
  { mods: { 1: [2, 4], 2: [3] }, car: [1] },                 // 4: 3→2→1, 4→1
  { mods: { 1: [2], 3: [4] }, car: [1, 3] },                 // 5: zwei Paare
  { mods: { 1: [4], 2: [4], 3: [4] }, car: [1, 2, 3] },      // 6: 4 → 1,2,3
  { mods: { 3: [4] }, car: [1, 2, 3] },                      // 7: 4→3, dazu 1 und 2
  { mods: {}, car: [1, 2, 3, 4] },                           // 8: alle hörbar (Orgel)
];
class FMVoice {
  constructor(ins) {
    this.ins = ins; this.active = false; this.released = false; this.t = 0;
    this.env = [new Env(), new Env(), new Env(), new Env()]; this.ph = new Float64Array(4);
    this.out = new Float64Array(5); this.fb1 = 0; this.fb2 = 0; this.freq = 440; this.target = 440; this.vel = 1; this.n = 60; this.id = 0;
  }
  start(n, v, id, legato, glide, t) {
    this.n = n; this.id = id; this.vel = v; this.t = t; this.released = false; this.target = mtof(n);
    if (!glide || !this.active) this.freq = this.target;
    if (!this.active) { this.ph.fill(0); this.fb1 = this.fb2 = 0; }
    this.active = true; this.ins.envSet(this);
    for (const e of this.env) e.on(legato);
  }
  release() { this.released = true; for (const e of this.env) e.off(); }
  kill() { this.active = false; for (const e of this.env) e.kill(); }
  render(L, R, a, b) {
    const ins = this.ins, p = ins.p, sr = ins.sr, m = ins.mod;
    const al = ALGOS[clamp(Math.round(num(p.algo, 1)), 1, 8) - 1];
    const ratio = [], lvl = [], vs = [];
    for (let k = 1; k <= 4; k++) {
      ratio.push(num(p["op" + k + "ratio"], 1) * Math.pow(2, num(p["op" + k + "fine"], 0) / 1200));
      const vsens = num(p["op" + k + "vel"], 0.5);
      vs.push(1 - vsens * (1 - this.vel));
      lvl.push(num(p["op" + k + "lvl"], k === 1 ? 1 : 0.5));
    }
    const fb = num(p.fb, 0) * 1.6;
    const carGain = 0.3 / Math.sqrt(al.car.length);
    const glideC = num(p.glide, 0) > 0 ? Math.exp(-1 / (num(p.glide, 0.1) * sr * 0.25)) : 0;
    const keyScale = 1 - clamp((this.n - 60) / 48, -0.5, 1) * num(p.ksc, 0);
    const gain = this.gain || (this.gain = new Float64Array(4)), ev = this.ev || (this.ev = new Float64Array(4));
    const srcs = this.srcs || (this.srcs = [null, null, null, null]);
    for (let k = 1; k <= 4; k++) { const car = al.car.indexOf(k) >= 0; gain[k - 1] = lvl[k - 1] * vs[k - 1] * (car ? 1 : 4 * keyScale); srcs[k - 1] = al.mods[k] || null; }
    const cars = al.car, bendM = ins.pitchMul(), o = this.out;
    for (let i = a; i < b; i++) {
      if (glideC) this.freq = this.target + (this.freq - this.target) * glideC;
      const f = this.freq * m.pitch[i] * bendM;
      let alive = false;
      for (let k = 0; k < 4; k++) { ev[k] = this.env[k].next(); if (this.env[k].st !== 0) alive = true; }
      if (!alive) { this.active = false; break; }
      for (let k = 4; k >= 1; k--) {               // von oben nach unten: 4, 3, 2, 1
        let modIn = 0;
        const src = srcs[k - 1];
        if (src) for (let j = 0; j < src.length; j++) modIn += o[src[j]];
        if (k === 4) modIn += (this.fb1 + this.fb2) * 0.5 * fb;
        const ph = this.ph[k - 1];
        const val = sinp(ph + modIn / TAU) * ev[k - 1] * gain[k - 1];
        o[k] = val;
        let np = ph + f * ratio[k - 1] / sr; if (np >= 1) np -= Math.floor(np); this.ph[k - 1] = np;
        if (k === 4) { this.fb2 = this.fb1; this.fb1 = val; }
      }
      let s = 0; for (let j = 0; j < cars.length; j++) s += o[cars[j]];
      s *= carGain * m.amp[i];
      const pn = m.pan[i];
      L[i] += s * (1 - pn); R[i] += s * (1 + pn);
    }
  }
}
class FM extends Instrument {
  constructor(eng, patch) { super(eng, patch); this.l1 = new LFO(); this.l2 = new LFO(); }
  makeVoice() { return new FMVoice(this); }
  update() { for (const v of this.voices) if (v.active) this.envSet(v); }
  envSet(v) {
    const p = this.p;
    for (let k = 1; k <= 4; k++) v.env[k - 1].set(num(p["op" + k + "att"], 0.002), num(p["op" + k + "dec"], 0.6), num(p["op" + k + "sus"], 0.5), num(p["op" + k + "rel"], 0.4), this.sr);
  }
}

// ---------------- E-Piano (Zinke + Glocke + Biss, Tremolo) ----------------
class EPVoice {
  constructor(ins) { this.ins = ins; this.active = false; this.released = false; this.t = 0; this.ph = 0; this.pm = 0; this.pb = 0;
    this.e = 1; this.ie = 1; this.be = 1; this.rel = 0; this.n = 60; this.vel = 1; this.id = 0; this.lp = 0; }
  start(n, v, id, legato, glide, t) {
    this.n = n; this.id = id; this.vel = v; this.t = t; this.released = false; this.active = true;
    this.ph = 0; this.pm = 0; this.pb = 0; this.e = 1; this.ie = 1; this.be = 1; this.att = 0;
    const p = this.ins.p, sr = this.ins.sr;
    const dec = num(p.decay, 4) * Math.pow(2, -(n - 60) / 24);            // hohe Töne klingen kürzer
    this.dc = Math.exp(-6.9 / (Math.max(0.2, dec) * sr));
    this.ic = Math.exp(-4.6 / (Math.max(0.05, num(p.tinedec, 0.6)) * sr));
    this.bc = Math.exp(-4.6 / (0.15 * sr));
  }
  release() { this.released = true; this.rc = Math.exp(-4.6 / (Math.max(0.02, num(this.ins.p.rel, 0.25)) * this.ins.sr)); }
  kill() { this.active = false; }
  render(L, R, a, b) {
    const ins = this.ins, p = ins.p, sr = ins.sr, m = ins.mod;
    const tine = num(p.tine, 0.5) * (0.4 + this.vel), bell = num(p.bell, 0.3) * this.vel, bark = 1 + num(p.bark, 0.4) * this.vel * this.vel * 5;
    const tone = clamp(num(p.tone, 0.7), 0.05, 1), lpc = Math.exp(-TAU * (300 + tone * tone * 12000) / sr);
    const gain = 0.32 * (0.35 + 0.65 * this.vel);
    for (let i = a; i < b; i++) {
      const f = mtof(this.n) * m.pitch[i] * ins.pitchMul();
      this.e *= this.dc; this.ie *= this.ic; this.be *= this.bc;
      if (this.released) { this.e *= this.rc; }
      if (this.att < 1) this.att = Math.min(1, this.att + 1 / (0.0015 * sr));
      if (this.e < 1e-4) { this.active = false; break; }
      const mod = sinp(this.pm) * tine * this.ie * 2.2;
      let s = Math.sin(TAU * this.ph + mod) + sinp(this.pb) * bell * this.be * 0.5;
      s = tanh(s * bark) / Math.sqrt(bark);
      this.lp = s + (this.lp - s) * lpc;
      const out = this.lp * this.e * this.att * gain * m.amp[i];
      const pn = m.pan[i];
      L[i] += out * (1 - pn); R[i] += out * (1 + pn);
      this.ph += f / sr; this.pm += f / sr; this.pb += f * 14.0 / sr;
      if (this.ph > 1) this.ph -= 1; if (this.pm > 1) this.pm -= 1; if (this.pb > 1) this.pb -= 1;
    }
  }
}
class EP extends Instrument {
  constructor(eng, patch) { super(eng, patch); this.l1 = new LFO(); this.l2 = new LFO(); }
  makeVoice() { return new EPVoice(this); }
  envSet() {}
}

// ---------------- Tonrad-Orgel (Zugriegel, Perkussion, Klick, Vibrato/Chorus, Leslie) ----------------
const DRAW = [0.5, 1.5, 1, 2, 3, 4, 5, 6, 8];
class OrganVoice {
  constructor(ins) { this.ins = ins; this.active = false; this.released = false; this.t = 0; this.ph = new Float64Array(9);
    this.e = 0; this.pe = 0; this.ck = 0; this.n = 60; this.id = 0; this.vel = 1; this.perc = false; this.cf = new Biquad(); }
  start(n, v, id, legato, glide, t) {
    const ins = this.ins, p = ins.p, sr = ins.sr;
    this.n = n; this.id = id; this.vel = v; this.t = t; this.released = false;
    if (!this.active) for (let i = 0; i < 9; i++) this.ph[i] = rnd() * 0.5 + 0.5;
    this.active = true; this.e = this.e || 0;
    // Perkussion nur, wenn keine andere Taste gehalten wird (Single Trigger)
    this.perc = !!p.perc && !ins.voices.some(x => x !== this && x.active && !x.released);
    this.pe = this.perc ? 1 : 0;
    this.pc = Math.exp(-4.6 / ((p.percfast ? 0.25 : 1.0) * sr));
    this.ck = num(p.click, 0.3); this.cf.bp(2500 + rnd() * 800, 0.8, sr);
  }
  release() { this.released = true; }
  kill() { this.active = false; this.e = 0; }
  render(L, R, a, b) {
    const ins = this.ins, p = ins.p, sr = ins.sr, m = ins.mod;
    const g = []; let tot = 0;
    for (let k = 0; k < 9; k++) { const d = clamp(num(p["db" + (k + 1)], k < 3 ? 8 : 0), 0, 8); const v = d <= 0 ? 0 : Math.pow(10, (d - 8) * 3 / 20); g.push(v); tot += v; }
    const percH = p.perc3 ? 3 : 2, percL = p.percsoft ? 0.5 : 1;
    const norm = 0.22 / Math.max(1, Math.sqrt(tot));
    const atk = 1 / (0.004 * sr), rel = 1 / (0.03 * sr);
    const f0 = mtof(this.n);
    for (let i = a; i < b; i++) {
      if (this.released) { this.e -= rel; if (this.e <= 0) { this.e = 0; this.active = false; break; } }
      else if (this.e < 1) this.e = Math.min(1, this.e + atk);
      const pm = m.pitch[i] * ins.pitchMul();
      let s = 0;
      for (let k = 0; k < 9; k++) {
        if (g[k] > 0) s += sinp(this.ph[k]) * g[k];
        this.ph[k] += f0 * DRAW[k] * pm / sr; if (this.ph[k] >= 1) this.ph[k] -= 1;
      }
      s *= norm;
      if (this.pe > 1e-4) { s += Math.sin(TAU * this.ph[2] * percH) * this.pe * 0.18 * percL; this.pe *= this.pc; }
      if (this.ck > 1e-3) { s += this.cf.run(rnd()) * this.ck * 0.5; this.ck *= 0.996; }
      s *= this.e;
      L[i] += s; R[i] += s;
    }
  }
}
class Organ extends Instrument {
  constructor(eng, patch) {
    super(eng, patch); this.l1 = new LFO(); this.l2 = new LFO();
    const sr = this.sr;
    this.vbuf = new Float32Array(2048); this.vi = 0; this.vph = 0;
    this.lbuf = [new Float32Array(4096), new Float32Array(4096)]; this.li = 0;
    this.hornPh = 0; this.drumPh = 0.25; this.hornRate = 0.8; this.drumRate = 0.7; this.lpS = 0;
    this.tmpL = new Float32Array(128); this.tmpR = new Float32Array(128);
  }
  makeVoice() { return new OrganVoice(this); }
  envSet() {}
  render(L, R, a, b) {
    const tL = this.tmpL, tR = this.tmpR; tL.fill(0, a, b); tR.fill(0, a, b);
    for (const v of this.voices) if (v.active) v.render(tL, tR, a, b);
    const p = this.p, sr = this.sr;
    const vib = p.vib || "off", vdepth = { v1: 0.25, v2: 0.5, v3: 0.9, c1: 0.25, c2: 0.5, c3: 0.9 }[vib] || 0, chorus = vib[0] === "c";
    const drv = 1 + num(p.drive, 0) * 8;
    const les = p.leslie || "off";
    const fast = les === "fast" || (les !== "off" && this.mw > 0.5);
    const hornT = fast ? 6.7 : 0.8, drumT = fast ? 5.9 : 0.67;
    const hornA = 1 / (0.7 * sr), drumA = 1 / (3.5 * sr);
    const lpc = Math.exp(-TAU * 800 / sr);
    const vol = num(p.vol, 0.8);
    for (let i = a; i < b; i++) {
      let s = tL[i];
      // Vibrato-Scanner: modulierte Verzögerung um ~1 ms, 6,9 Hz
      if (vdepth > 0) {
        this.vbuf[this.vi] = s;
        this.vph += 6.9 / sr; if (this.vph >= 1) this.vph -= 1;
        const d = (0.0012 + sinp(this.vph) * 0.0009 * vdepth) * sr;
        let rp = this.vi - d; while (rp < 0) rp += 2048;
        const i0 = rp | 0, fr = rp - i0, w = this.vbuf[i0] + (this.vbuf[(i0 + 1) & 2047] - this.vbuf[i0]) * fr;
        this.vi = (this.vi + 1) & 2047;
        s = chorus ? (s + w) * 0.6 : w;
      }
      if (drv > 1) s = tanh(s * drv) / Math.pow(drv, 0.6);
      s *= vol * 1.15;
      if (les === "off") { L[i] += s; R[i] += s; continue; }
      // Leslie: Bass-Trommel unter 800 Hz, Horn darüber — je Amplitude + Doppler, mit Trägheit
      this.hornRate += (hornT - this.hornRate) * hornA * 6; this.drumRate += (drumT - this.drumRate) * drumA * 6;
      this.hornPh += this.hornRate / sr; if (this.hornPh >= 1) this.hornPh -= 1;
      this.drumPh += this.drumRate / sr; if (this.drumPh >= 1) this.drumPh -= 1;
      this.lpS = s + (this.lpS - s) * lpc;
      const lo = this.lpS, hi = s - lo;
      const hs = sinp(this.hornPh), hc = sinp(this.hornPh + 0.25), ds = sinp(this.drumPh);
      const buf0 = this.lbuf[0], buf1 = this.lbuf[1];
      buf0[this.li] = hi; buf1[this.li] = lo;
      const hl = rdDelay(buf0, this.li, (0.0012 + 0.0004 * hs) * sr) * (1 + 0.35 * hc), hr = rdDelay(buf0, this.li, (0.0012 - 0.0004 * hs) * sr) * (1 - 0.35 * hc);
      const dl = rdDelay(buf1, this.li, (0.002 + 0.0003 * ds) * sr) * (1 + 0.15 * ds), dr = rdDelay(buf1, this.li, (0.002 - 0.0003 * ds) * sr) * (1 - 0.15 * ds);
      this.li = (this.li + 1) & 4095;
      L[i] += hl + dl; R[i] += hr + dr;
    }
  }
}

function rdDelay(buf, w, d) { let rp = w - d; while (rp < 0) rp += 4096; const i0 = rp | 0, fr = rp - i0; return buf[i0 & 4095] + (buf[(i0 + 1) & 4095] - buf[i0 & 4095]) * fr; }

// ---------------- Gezupfte Saite (Karplus-Strong) mit Körper ----------------
class PluckVoice {
  constructor(ins) { this.ins = ins; this.active = false; this.released = false; this.t = 0; this.buf = new Float32Array(4096);
    this.w = 0; this.lp = 0; this.n = 60; this.id = 0; this.vel = 1; this.life = 0; this.ap = 0; }
  start(n, v, id, legato, glide, t) {
    const ins = this.ins, p = ins.p, sr = ins.sr;
    this.n = n; this.id = id; this.vel = v; this.t = t; this.released = false; this.active = true;
    const f = mtof(n);
    this.D = clamp(sr / f - 0.5, 2, 4000);
    const N = Math.ceil(this.D) + 2;
    const bright = clamp(num(p.bright, 0.6) * (0.6 + 0.5 * v * num(p.velb, 0.6) + (1 - num(p.velb, 0.6)) * 0.4), 0.05, 1);
    const c = Math.exp(-TAU * (200 + bright * bright * 12000) / sr);
    let lp = 0;
    const pos = clamp(num(p.pos, 0.2), 0.02, 0.5), pd = Math.max(1, Math.round(this.D * pos));
    const tmp = new Float32Array(N);
    for (let i = 0; i < N; i++) { const x = rnd(); lp = x + (lp - x) * c; tmp[i] = lp; }
    this.buf.fill(0);
    for (let i = 0; i < N; i++) this.buf[i] = (tmp[i] - (i >= pd ? tmp[i - pd] : 0)) * (0.35 + 0.35 * v);
    this.w = N; this.lp = 0; this.life = 0;
    const dec = Math.max(0.1, num(p.decay, 3));
    this.rho = Math.pow(10, -3 / (f * dec));                   // −60 dB nach "decay" Sekunden
    this.damp = clamp(num(p.damp, 0.4), 0, 0.98);
    this.gain = 0.55;
  }
  release() { this.released = true; }
  kill() { this.active = false; }
  render(L, R, a, b) {
    const ins = this.ins, sr = ins.sr, m = ins.mod, buf = this.buf;
    const relRho = this.released ? Math.pow(10, -3 / (mtof(this.n) * Math.max(0.05, num(ins.p.rel, 0.3)))) : 1;
    for (let i = a; i < b; i++) {
      const D = this.D / (m.pitch[i] * ins.pitchMul());
      let rp = this.w - D; while (rp < 0) rp += 4096;
      const i0 = rp | 0, fr = rp - i0;
      const x = buf[i0 & 4095] + (buf[(i0 + 1) & 4095] - buf[i0 & 4095]) * fr;
      this.lp = x * (1 - this.damp) + this.lp * this.damp;
      const y = (x * 0.5 + this.lp * 0.5) * this.rho * relRho;
      buf[this.w & 4095] = y; this.w = (this.w + 1) & 4095;
      const out = x * this.gain * m.amp[i];
      L[i] += out; R[i] += out;
      this.life++;
      if ((this.life & 1023) === 0) {
        // 3.17.2: die schwingende Strecke messen (die letzten D Werte HINTER dem Schreibzeiger) — vorher las die Prüfung
        const st = Math.max(1, Math.floor(this.D / 64)); let e = 0;
        for (let k = 0; k < 64; k++) e += Math.abs(buf[(this.w - 1 - k * st + 8192) & 4095]);
        if (e < 1e-4) { this.active = false; break; }
      }
    }
  }
}
class Pluck extends Instrument {
  constructor(eng, patch) {
    super(eng, patch); this.l1 = new LFO(); this.l2 = new LFO();
    this.b1 = new Biquad(); this.b2 = new Biquad(); this.b3 = new Biquad(); this.tmp = new Float32Array(128); this.update();
  }
  makeVoice() { return new PluckVoice(this); }
  envSet() {}
  update() { const sr = this.sr; if (!this.b1) return; this.b1.bp(110, 2.5, sr); this.b2.bp(220, 3, sr); this.b3.bp(2600, 1.2, sr); }
  render(L, R, a, b) {
    const t = this.tmp; t.fill(0, a, b);
    for (const v of this.voices) if (v.active) v.render(t, t, a, b);
    const body = num(this.p.body, 0.3);
    for (let i = a; i < b; i++) {
      let s = t[i] * 0.5;
      if (body > 0) s += (this.b1.run(s) * 1.2 + this.b2.run(s) * 0.8 + this.b3.run(s) * 0.4) * body;
      L[i] += s; R[i] += s;
    }
  }
}

// =====================================================================================================
// Drum-Machine — 16 Stimmen, alle synthetisch (keine Samples). Bausteine wie bei den Klassikern.
// =====================================================================================================
const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800];
// Jede Hüllkurve ist ein mitlaufender Faktor (statt exp() je Sample): x *= k, k = exp(−1/(τ·sr))
function dk(tau, sr) { return Math.exp(-1 / (Math.max(1e-4, tau) * sr)); }
class Hit {
  constructor(eng, slot, model, v, prm) {
    const sr = eng.sr;
    this.sr = sr; this.slot = slot; this.model = model; this.v = v; this.n = 0; this.done = false;
    this.ph = new Float64Array(8); this.f1 = new Biquad(); this.f2 = new Biquad();
    const tune = Math.pow(2, num(prm.tune, 0) / 12), dec = Math.max(0.05, num(prm.dec, 1)), tone = clamp(num(prm.tone, 0.5), 0, 1), snap = clamp(num(prm.snap, 0.5), 0, 1);
    this.tune = tune; this.tone = tone; this.snap = snap;
    this.e1 = 1; this.e2 = 1; this.e3 = 1;          // drei Hüllkurven-Zustände
    this.max = Math.floor(sr * 4);                  // Sicherheitsgrenze
    const M = model;
    switch (M) {
      case "kick808": case "kick909": case "kickacoustic": {
        const k909 = M === "kick909";
        this.base = (k909 ? 52 : 46) * tune; this.sweep = (k909 ? 4 : 2.6) * (0.6 + tone);
        this.k1 = dk((k909 ? 0.32 : 0.55) * dec, sr); this.k2 = dk(k909 ? 0.012 : 0.03, sr); this.k3 = dk(0.003, sr);
        this.clickA = snap * (k909 ? 1 : 0.5); this.drv = 1 + tone * 1.5; this.max = Math.floor((3 * dec + 0.2) * sr); break;
      }
      case "snare": case "snare909":
        this.f1.hp(1500 + tone * 4000, 0.7, sr);
        this.k1 = dk(0.06 * dec, sr); this.k2 = dk((M === "snare909" ? 0.12 : 0.17) * dec, sr); this.k3 = dk(0.01, sr);
        this.max = Math.floor((0.8 * dec + 0.1) * sr); break;
      case "clap":
        this.f1.bp(1100 * tune + tone * 800, 1.6, sr); this.k1 = dk(0.11 * dec, sr); this.k2 = dk(0.0035, sr);
        this.max = Math.floor((0.9 * dec + 0.05) * sr); break;
      case "hatc": case "hato": case "cymbal": case "ride": case "crash": {
        this.f1.bp(8000 * tune * (0.7 + tone * 0.6), 1.2, sr); this.f2.hp(6000 * tune * (0.6 + tone * 0.5), 0.7, sr);
        const tau = M === "hatc" ? 0.035 : M === "hato" ? 0.28 : M === "ride" ? 0.7 : 1.1;
        this.k1 = dk(tau * dec, sr); this.k2 = dk(0.4 * dec, sr);
        this.mul = tune * (M === "ride" ? 1.4 : M === "crash" ? 1.15 : 1);
        this.amp = M === "hatc" ? 1.3 : 1; this.max = Math.floor((tau * dec * 7 + 0.02) * sr); break;
      }
      case "tom": case "tomlo": case "tommid": case "tomhi":
        this.f1.lp(4000, 0.7, sr); this.base = (M === "tomlo" ? 90 : M === "tomhi" ? 190 : 130) * tune;
        this.k1 = dk(0.32 * dec, sr); this.k2 = dk(0.04, sr); this.k3 = dk(0.02, sr); this.max = Math.floor((2 * dec + 0.1) * sr); break;
      case "conga":
        this.base = 330 * tune; this.k1 = dk(0.18 * dec, sr); this.k2 = dk(0.008, sr); this.max = Math.floor((1.2 * dec + 0.05) * sr); break;
      case "rim": case "clave":
        this.f1.bp((M === "clave" ? 2500 : 1700) * tune, 6, sr); this.base = (M === "clave" ? 2500 : 1700) * tune;
        this.k1 = dk((M === "clave" ? 0.025 : 0.012) * dec, sr); this.max = Math.floor((0.3 * dec + 0.02) * sr); break;
      case "cowbell":
        this.f1.bp(2640 * tune, 2.5, sr); this.k1 = dk(0.012, sr); this.k2 = dk(0.14 * dec, sr); this.max = Math.floor((1 * dec + 0.05) * sr); break;
      case "shaker": case "tamb":
        this.f1.hp(5000 + tone * 4000, 0.9, sr); this.k1 = dk((M === "tamb" ? 0.08 : 0.045) * dec, sr); this.k2 = dk(0.05, sr);
        this.att = 1 / (0.008 * sr); this.max = Math.floor((0.6 * dec + 0.05) * sr); break;
      case "zap":
        this.base = tune; this.k1 = dk(0.12 * dec, sr); this.k2 = dk(0.03 * dec, sr); this.max = Math.floor((0.8 * dec + 0.05) * sr); break;
      case "lofi":
        this.q = 6 - Math.round(tone * 4); this.k1 = dk(0.05 * dec, sr); this.max = Math.floor((0.5 * dec + 0.05) * sr); break;
      default: this.done = true;
    }
  }
  next() {                                          // nächstes Sample (Mono)
    const sr = this.sr, M = this.model;
    if (++this.n > this.max) { this.done = true; return 0; }
    let s = 0;
    switch (M) {
      case "kick808": case "kick909": case "kickacoustic": {
        this.ph[0] += this.base * (1 + this.sweep * this.e2) / sr;
        const body = sinp(this.ph[0]) * this.e1;
        const click = (rnd() * 0.5 + sinp(this.ph[0] * 5)) * this.e3 * this.clickA;
        s = tanh((body * this.drv + click) * 1.4) * 0.9;
        this.e1 *= this.k1; this.e2 *= this.k2; this.e3 *= this.k3; break;
      }
      case "snare": case "snare909": {
        const pe = 1 + 0.3 * this.e3;
        this.ph[0] += 185 * this.tune * pe / sr; this.ph[1] += 330 * this.tune * pe / sr;
        const tonal = (sinp(this.ph[0]) * 0.6 + sinp(this.ph[1]) * 0.35) * this.e1;
        const nz = this.f1.run(rnd()) * this.e2 * (0.6 + this.snap);
        s = (tonal * (1.2 - this.snap * 0.5) + nz * 1.1) * 0.75;
        this.e1 *= this.k1; this.e2 *= this.k2; this.e3 *= this.k3; break;
      }
      case "clap": {
        const t = this.n / sr;
        if (t < 0.03 && (this.n % Math.round(0.0105 * sr)) === 0) this.e2 = 1;     // drei kurze Stöße …
        const tail = t >= 0.021 ? this.e1 : 0;                                       // … dann der Hall
        s = this.f1.run(rnd()) * ((t < 0.03 ? this.e2 * 1.3 : 0) + tail * 0.9) * 1.2;
        this.e2 *= this.k2; if (t >= 0.021) this.e1 *= this.k1; break;
      }
      case "hatc": case "hato": case "cymbal": case "ride": case "crash": {
        let m = 0;
        for (let k = 0; k < 6; k++) { let ph = this.ph[k] + METAL[k] * this.mul / sr; if (ph >= 1) ph -= 1; this.ph[k] = ph; m += ph < 0.5 ? 1 : -1; }
        m = m / 6 * (1 - this.snap * 0.4) + rnd() * this.snap * 0.4;
        let x = this.f2.run(this.f1.run(m));
        if (M === "ride") { this.ph[6] += 2900 * this.tune / sr; x += sinp(this.ph[6]) * 0.08 * this.e2; this.e2 *= this.k2; }
        s = x * this.e1 * this.amp * (this.n < 72 ? this.n / 72 : 1);
        this.e1 *= this.k1; break;
      }
      case "tom": case "tomlo": case "tommid": case "tomhi":
        this.ph[0] += this.base * (1 + 0.6 * this.e2) / sr;
        s = (sinp(this.ph[0]) + this.f1.run(rnd()) * 0.15 * this.e3) * this.e1 * 0.8;
        this.e1 *= this.k1; this.e2 *= this.k2; this.e3 *= this.k3; break;
      case "conga":
        this.ph[0] += this.base * (1 + 0.15 * this.e2) / sr; s = sinp(this.ph[0]) * this.e1 * 0.8;
        this.e1 *= this.k1; this.e2 *= this.k2; break;
      case "rim": case "clave":
        this.ph[0] += this.base / sr; s = (sinp(this.ph[0]) * 0.7 + this.f1.run(rnd()) * 0.6) * this.e1; this.e1 *= this.k1; break;
      case "cowbell": {
        this.ph[0] += 540 * this.tune / sr; this.ph[1] += 800 * this.tune / sr;
        if (this.ph[0] >= 1) this.ph[0] -= 1; if (this.ph[1] >= 1) this.ph[1] -= 1;
        const sq = (this.ph[0] < 0.5 ? 1 : -1) + (this.ph[1] < 0.5 ? 1 : -1);
        s = this.f1.run(sq) * (0.6 * this.e1 + 0.4 * this.e2) * 0.9; this.e1 *= this.k1; this.e2 *= this.k2; break;
      }
      case "shaker": case "tamb": {
        const att = Math.min(1, this.n * this.att);
        s = this.f1.run(rnd()) * att * this.e1 * 0.9;
        if (M === "tamb") { this.ph[0] += 7000 / sr; s += sinp(this.ph[0]) * 0.05 * this.e2; this.e2 *= this.k2; }
        this.e1 *= this.k1; break;
      }
      case "zap":
        this.ph[0] += (80 + 2400 * this.e2) * this.base / sr; s = sinp(this.ph[0]) * this.e1 * 0.7;
        this.e1 *= this.k1; this.e2 *= this.k2; break;
      case "lofi": s = Math.round(rnd() * this.q) / this.q * this.e1 * 0.6; this.e1 *= this.k1; break;
    }
    if (this.e1 < 2e-5 && this.n > 256) this.done = true;
    return s * this.v;
  }
}
class Drums {
  constructor(eng, patch) { this.eng = eng; this.sr = eng.sr; this.hits = []; this.p = {}; this.voices = []; this.setPatch(patch || {}); }
  setPatch(p) { this.p = JSON.parse(JSON.stringify(p || {})); if (!Array.isArray(this.p.kit)) this.p.kit = []; }
  set(k, v) {
    const m = /^v(\d+)\.(\w+)$/.exec(k);
    if (m) { const s = +m[1]; this.p.kit[s] = Object.assign({}, this.p.kit[s] || {}, { [m[2]]: v }); }
    else this.p[k] = v;
  }
  input(on, n, v) { if (on) this.noteOn(n, v); }
  noteOn(slot, v) {
    const k = this.p.kit[slot]; if (!k || !k.model) return;
    // Choke: geschlossene Hi-Hat würgt die offene ab
    if (k.model === "hatc") for (const h of this.hits) if (h.model === "hato") h.choke = true;
    if (this.hits.length > 48) this.hits.shift();
    this.hits.push(new Hit(this.eng, slot, k.model, clamp(v, 0, 1) * num(k.lvl, 0.8), k));
  }
  noteOff() {}
  pedal() {}
  clockBlock() { return []; }
  allOff() {}
  panic() { this.hits = []; }
  render(L, R, a, b) {
    const drive = 1 + num(this.p.drive, 0) * 5;
    const vol = num(this.p.vol, 0.8);
    for (const h of this.hits) {
      const pan = clamp(num((this.p.kit[h.slot] || {}).pan, 0), -1, 1);
      const gl = (1 - pan) * 0.5 * vol, gr = (1 + pan) * 0.5 * vol;
      for (let i = a; i < b; i++) {
        let s = h.next();
        if (h.choke) { h.cv = (h.cv == null ? 1 : h.cv * 0.995); s *= h.cv; if (h.cv < 1e-3) h.done = true; }
        if (h.done) break;
        L[i] += s * gl; R[i] += s * gr;
      }
    }
    if (drive > 1) for (let i = a; i < b; i++) { L[i] = tanh(L[i] * drive) / Math.sqrt(drive); R[i] = tanh(R[i] * drive) / Math.sqrt(drive); }
    this.hits = this.hits.filter(h => !h.done);
  }
}

// Hat ein Instrument gerade etwas zu tun? (Orgel: Leslie-Nachhall noch 1,5 s)
function busy(ins) {
  if (ins.hits) return ins.hits.length > 0;
  for (let i = 0; i < ins.voices.length; i++) if (ins.voices[i].active) { ins.idle = 0; return true; }
  if (ins.lbuf) { ins.idle = (ins.idle || 0) + 1; return ins.idle < 600; }
  return false;
}

const ENGINES = { va: VA, fm: FM, ep: EP, organ: Organ, pluck: Pluck, drums: Drums };
function makeInstrument(eng, patch) {
  const C = ENGINES[(patch || {}).engine] || VA;
  return new C(eng, patch);
}

// =====================================================================================================
// Der Motor: Sequencer + Instrumente
// =====================================================================================================
const MAX_TRACKS = 16, STEPS_PER_BAR = 16;
class Engine extends AudioWorkletProcessor {
  constructor(opts) {
    super();
    const o = (opts && opts.processorOptions) || {};
    this.sr = sampleRate; this.clock = 0; this.bpm = 120; this.swing = 0.5; this.sps = this.sr * 60 / 120 / 4;
    this.tracks = []; this.ins = []; this.patterns = {}; this.song = [];
    this.playing = false; this.pos = 0; this.pat = "A"; this.queued = null; this.songMode = false; this.songIdx = 0; this.songRep = 0;
    this.metro = false; this.rec = null; this.recOpen = new Map(); this.offs = []; this.nid = 1; this.lastStep = -999;
    this.bounce = o.bounce || null; this.loopSong = false; this.countIn = 0;
    this.bufL = []; this.bufR = [];
    for (let i = 0; i < MAX_TRACKS; i++) { this.bufL.push(new Float32Array(128)); this.bufR.push(new Float32Array(128)); }
    this.click = [];
    if (o.project) this.load(o.project);
    if (this.bounce) {
      this.songMode = !!this.bounce.song && this.song.length > 0; this.pat = this.bounce.pattern || "A"; this.songIdx = 0; this.songRep = 0;
      if (this.songMode) this.pat = this.song[0].p;
      this.start(0); this.loopsLeft = this.bounce.loops || 1;
    }
    this.port.onmessage = (e) => this.msg(e.data);
  }
  load(p) {
    this.bpm = clamp(num(p.bpm, 120), 30, 300); this.swing = clamp(num(p.swing, 0.5), 0.5, 0.8);
    this.sps = this.sr * 60 / this.bpm / 4;
    this.patterns = p.patterns || {}; this.song = Array.isArray(p.song) ? p.song : [];
    const old = new Map(this.tracks.map((t, i) => [t.id, this.ins[i]]));
    this.tracks = (p.tracks || []).slice(0, MAX_TRACKS);
    this.ins = this.tracks.map(t => {
      const was = old.get(t.id);
      if (was && was.p && was.p.engine === (t.patch || {}).engine) { was.setPatch(t.patch); return was; }
      if (was) was.panic();
      return makeInstrument(this, t.patch);
    });
  }
  idx(id) { return this.tracks.findIndex(t => t.id === id); }
  msg(d) {
    switch (d.t) {
      case "project": this.load(d.p); break;
      case "patterns": this.patterns = d.patterns || {}; if (d.song) this.song = d.song; break;
      case "patch": { const i = this.idx(d.tr); if (i >= 0) { this.tracks[i].patch = d.patch; const ins = this.ins[i];
        if (ins.p.engine !== d.patch.engine) { ins.panic(); this.ins[i] = makeInstrument(this, d.patch); } else ins.setPatch(d.patch); } break; }
      case "param": { const i = this.idx(d.tr); if (i >= 0) this.ins[i].set(d.k, d.v); break; }
      case "tempo": this.bpm = clamp(num(d.bpm, 120), 30, 300); this.sps = this.sr * 60 / this.bpm / 4; if (d.swing != null) this.swing = clamp(d.swing, 0.5, 0.8); break;
      case "track": { const i = this.idx(d.tr); if (i >= 0) Object.assign(this.tracks[i], d.set); break; }
      case "play": this.songMode = !!d.song; this.loopSong = !!d.loop; if (d.pat) this.pat = d.pat; this.songIdx = 0; this.songRep = 0;
        if (this.songMode && this.song.length) this.pat = this.song[0].p;
        this.countIn = d.countIn ? STEPS_PER_BAR : 0; this.start(-this.countIn); break;
      case "stop": this.stopAll(); break;
      case "queue": if (this.playing && !this.songMode) this.queued = d.pat; else this.pat = d.pat; break;
      case "metro": this.metro = !!d.on; break;
      case "rec": if (this.rec && !d.on) this.closeRec(); this.rec = d.on ? { tr: d.tr, q: num(d.q, 0) } : null; this.recOpen.clear(); break;
      case "note": { const i = this.idx(d.tr); if (i < 0) break; const ins = this.ins[i];
        if (d.on) { ins.input(true, d.n, clamp(num(d.v, 0.8), 0.01, 1), -1 - d.n); this.recNoteOn(d.tr, d.n, d.v); }
        else { ins.input(false, d.n, 0, -1 - d.n); this.recNoteOff(d.tr, d.n); }
        break; }
      case "bend": { const i = this.idx(d.tr); if (i >= 0) this.ins[i].bend = clamp(d.v, -1, 1); break; }
      case "mod": { const i = this.idx(d.tr); if (i >= 0) this.ins[i].mw = clamp(d.v, 0, 1); break; }
      case "pedal": { const i = this.idx(d.tr); if (i >= 0) this.ins[i].pedal(!!d.on); break; }
      case "panic": for (const ins of this.ins) ins.panic(); this.offs = []; break;
    }
  }
  start(from) { this.playing = true; this.pos = from; this.lastStep = -999; this.queued = null; for (const ins of this.ins) if (ins.arpHeld) ins.arpIdx = 0; }
  stopAll() {
    this.playing = false; this.rec && this.closeRec(); this.recOpen.clear();
    for (const o of this.offs) { const i = this.idx(o.tr); if (i >= 0) this.ins[i].input(false, o.n, 0, o.id); }
    this.offs = [];
    this.port.postMessage({ t: "pos", step: -1 });
  }
  patLen(name) { const p = this.patterns[name]; return clamp(Math.round(num(p && p.bars, 4)), 1, 16) * STEPS_PER_BAR; }
  // --- Aufnahme ---
  recNoteOn(tr, n, v) {
    if (!this.rec || this.rec.tr !== tr || !this.playing || this.pos < 0) return;
    const len = this.patLen(this.pat);
    this.recOpen.set(n, { s: ((this.pos % len) + len) % len, v: clamp(num(v, 0.8), 0.05, 1), pat: this.pat, at: this.pos });
  }
  recNoteOff(tr, n) {
    if (!this.rec || this.rec.tr !== tr) return;
    const o = this.recOpen.get(n); if (!o) return;
    this.recOpen.delete(n);
    this.recPush(tr, n, o, Math.max(0.25, this.pos - o.at));
  }
  recPush(tr, n, o, l) {
    const q = this.rec.q, len = this.patLen(o.pat);
    let s = o.s;
    if (q > 0) { s = Math.round(s / q) * q; if (s >= len) s -= len; l = Math.max(q, Math.round(l / q) * q); }
    const t = this.tracks[this.idx(tr)];
    const note = { s: Math.round(s * 1000) / 1000, l: Math.round(Math.min(l, len) * 1000) / 1000, n, v: Math.round(o.v * 100) / 100 };
    if (t && t.kind === "drums") note.l = 1;
    const P = this.patterns[o.pat] || (this.patterns[o.pat] = { bars: 4, notes: {} });
    P.notes = P.notes || {};
    (P.notes[tr] || (P.notes[tr] = [])).push(note);
    this.port.postMessage({ t: "rec", pat: o.pat, tr, note });
  }
  closeRec() { for (const [n, o] of this.recOpen) this.recPush(this.rec.tr, n, o, Math.max(0.25, this.pos - o.at)); this.recOpen.clear(); }
  swingOff(s) {
    const r = Math.round(s);
    if (Math.abs(s - r) > 0.01 || (r & 1) === 0) return 0;
    return (this.swing - 0.5) * 2;
  }
  // Ereignisse (Note an/aus) für einen Abschnitt [p0, p1) im aktuellen Pattern
  gather(p0, p1, frame0, ev) {
    const P = this.patterns[this.pat]; if (!P || !P.notes) return;
    const len = this.patLen(this.pat);
    const anySolo = this.tracks.some(t => t.solo);
    for (let ti = 0; ti < this.tracks.length; ti++) {
      const t = this.tracks[ti];
      if (t.mute || (anySolo && !t.solo)) continue;
      const list = P.notes[t.id]; if (!list || !list.length) continue;
      for (const nt of list) {
        if (nt.s >= len) continue;
        const at = nt.s + this.swingOff(nt.s);
        if (at >= p0 && at < p1) {
          const f = frame0 + Math.floor((at - p0) * this.sps);
          const id = this.nid++;
          ev.push({ f, ti, n: nt.n, v: num(nt.v, 0.8), on: true, id });
          if (t.kind !== "drums") this.offs.push({ at: this.clock + f + Math.max(16, Math.round(num(nt.l, 1) * this.sps) - 8), tr: t.id, n: nt.n, id });
        }
      }
    }
  }
  advancePattern() {
    if (this.songMode && this.song.length) {
      this.songRep++;
      const cur = this.song[this.songIdx] || {};
      if (this.songRep >= Math.max(1, num(cur.r, 1))) {
        this.songRep = 0; this.songIdx++;
        if (this.songIdx >= this.song.length) {
          if (this.bounce || !this.loopSong) { this.finished = true; this.songIdx = this.song.length - 1; return false; }
          this.songIdx = 0;
        }
        this.pat = this.song[this.songIdx].p;
      }
    } else {
      if (this.bounce) { this.loopsLeft--; if (this.loopsLeft <= 0) { this.finished = true; return false; } }
      if (this.queued) { this.pat = this.queued; this.queued = null; }
    }
    return true;
  }
  metroClick(L, R, a, b) {
    for (const c of this.click) {
      for (let i = a; i < b; i++) {
        if (c.t >= c.n) break;
        const s = Math.sin(TAU * c.f * c.t / this.sr) * Math.exp(-c.t / (this.sr * 0.012)) * 0.35;
        if (c.d > 0) { c.d--; continue; }
        L[i] += s; R[i] += s; c.t++;
      }
    }
    this.click = this.click.filter(c => c.t < c.n);
  }
  process(inputs, outputs) {
    const N = 128;
    for (let i = 0; i < MAX_TRACKS; i++) { this.bufL[i].fill(0); this.bufR[i].fill(0); }
    // --- Ereignisse dieses Blocks sammeln ---
    const ev = [];
    let frame = 0;
    this.blockPos = this.playing ? this.pos : -1;
    if (this.playing && !this.finished) {
      while (frame < N) {
        const len = this.patLen(this.pat);
        const local = this.pos;                       // Position im aktuellen Pattern (negativ = Einzähler)
        const toEnd = local < 0 ? -local : len - local;
        const chunk = Math.min(N - frame, Math.max(1, Math.ceil(toEnd * this.sps - 1e-6)));
        const p1 = local + chunk / this.sps;
        if (local >= 0) this.gather(local, Math.min(p1, len), frame, ev);
        // Metronom: auf jedem Schlag
        if (this.metro || local < 0) {
          let k = Math.ceil(local / 4 - 1e-9) * 4;
          for (; k < p1; k += 4) { const f = frame + Math.floor((k - local) * this.sps); const bar = ((k % len) + len) % len === 0 || k === -16;
            this.click.push({ f: bar ? 1760 : 1320, t: 0, n: Math.floor(this.sr * 0.05), d: f }); }
        }
        this.pos = p1; frame += chunk;
        if (this.pos >= len - 1e-9 && local < len) {
          this.pos = 0;                              // einrasten: Step 0 des nächsten Durchgangs gehört dem nächsten Abschnitt
          if (!this.advancePattern()) { break; }
        } else if (local < 0 && this.pos >= -1e-9) this.pos = 0;
      }
      const step = Math.floor(this.pos);
      if (step !== this.lastStep) { this.lastStep = step; this.port.postMessage({ t: "pos", step, pat: this.pat, songIdx: this.songIdx }); }
    }
    // fällige Note-Aus
    if (this.offs.length) {
      const end = this.clock + N, keep = [];
      for (const o of this.offs) {
        if (o.at < end) { const ti = this.idx(o.tr); if (ti >= 0) ev.push({ f: Math.max(0, o.at - this.clock), ti, n: o.n, on: false, id: o.id }); }
        else keep.push(o);
      }
      this.offs = keep;
    }
    // Arpeggiator-Takt je Instrument
    for (let ti = 0; ti < this.ins.length; ti++) {
      const a = this.ins[ti].clockBlock(this.clock, this.clock + N);
      for (const x of a) ev.push({ f: Math.max(0, Math.min(N - 1, x.f)), ti, arp: x.tick ? 1 : 2 });
    }
    ev.sort((x, y) => x.f - y.f || (x.on === false ? -1 : 1));
    // --- rechnen, zwischen den Ereignissen ---
    let at = 0;
    const runTo = (to) => {
      if (to <= at) return;
      for (let ti = 0; ti < this.ins.length; ti++) {
        const ins = this.ins[ti];
        if (!busy(ins)) continue;                    // still: nichts zu rechnen
        if (ins.l1) modBlock(ins, at, to);
        ins.render(this.bufL[ti], this.bufR[ti], at, to);
        // 3.16: Regler "Pegel" — Orgel und Drums rechnen ihn selbst, alle anderen hier (0,8 = neutral wie bisher)
        if (!(ins instanceof Organ || ins instanceof Drums)) {
          const g = num(ins.p.vol, 0.8) / 0.8;
          if (g !== 1) { const L = this.bufL[ti], R = this.bufR[ti]; for (let i = at; i < to; i++) { L[i] *= g; R[i] *= g; } }
        }
      }
      at = to;
    };
    for (const e of ev) {
      runTo(Math.min(N, e.f));
      const ins = this.ins[e.ti]; if (!ins) continue;
      if (e.arp === 1) ins.arpTick();
      else if (e.arp === 2) { if (ins.arpNote != null) { ins.noteOff(ins.arpNote, -7); ins.arpNote = null; } }
      else if (e.on) ins.input(true, e.n, e.v, e.id);
      else ins.input(false, e.n, 0, e.id);
    }
    runTo(N);
    // --- ausgeben ---
    for (let ti = 0; ti < MAX_TRACKS && ti < outputs.length - 1; ti++) {
      const out = outputs[ti]; if (!out || !out[0]) continue;
      const L = this.bufL[ti], R = this.bufR[ti];
      for (let i = 0; i < N; i++) {
        let l = L[i], r = R[i];
        if (l !== l || l > 8 || l < -8) l = 0; if (r !== r || r > 8 || r < -8) r = 0;   // nie NaN in den Ausgang
        out[0][i] = l; if (out[1]) out[1][i] = r;
      }
    }
    const mo = outputs[MAX_TRACKS];
    if (mo && mo[0] && this.click.length) this.metroClick(mo[0], mo[1] || mo[0], 0, N);
    this.clock += N;
    if (this.finished && this.bounce && !this.doneSent) { this.doneSent = true; this.port.postMessage({ t: "done", at: this.clock }); }
    return true;
  }
}
registerProcessor("mws-engine", Engine);

// =====================================================================================================
// Limiter am Ende der Kette: Vorausschau 1,5 ms, Decke −1 dBFS — damit nichts mehr übersteuert
// =====================================================================================================
class Limiter extends AudioWorkletProcessor {
  constructor(o) {
    super();
    const p = (o && o.processorOptions) || {};
    this.ceil = Math.pow(10, num(p.ceil, -1) / 20);
    this.la = Math.max(8, Math.round(sampleRate * 0.0015));
    this.bl = new Float32Array(this.la); this.br = new Float32Array(this.la); this.need = new Float32Array(this.la);
    this.i = 0; this.g = 1; this.rel = Math.exp(-1 / (sampleRate * 0.12)); this.peak = 0; this.red = 0;
    this.n = 0;
    this.port.onmessage = (e) => { if (e.data && e.data.ceil != null) this.ceil = Math.pow(10, e.data.ceil / 20); };
  }
  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0];
    if (!out || !out[0]) return true;
    const L = (inp && inp[0]) || null, R = (inp && (inp[1] || inp[0])) || null;
    const oL = out[0], oR = out[1] || out[0];
    for (let k = 0; k < oL.length; k++) {
      const xl = L ? L[k] : 0, xr = R ? R[k] : 0;
      const a = Math.max(Math.abs(xl), Math.abs(xr));
      this.need[this.i] = a > this.ceil ? this.ceil / a : 1;
      let target = 1; for (let j = 0; j < this.la; j++) if (this.need[j] < target) target = this.need[j];
      if (target < this.g) this.g += (target - this.g) * 0.35; else this.g = target + (this.g - target) * this.rel;
      const dl = this.bl[this.i], dr = this.br[this.i];
      this.bl[this.i] = xl; this.br[this.i] = xr;
      this.i = (this.i + 1) % this.la;
      let yl = dl * this.g, yr = dr * this.g;
      if (yl > this.ceil) yl = this.ceil; else if (yl < -this.ceil) yl = -this.ceil;
      if (yr > this.ceil) yr = this.ceil; else if (yr < -this.ceil) yr = -this.ceil;
      oL[k] = yl; oR[k] = yr;
      const pk = Math.max(Math.abs(yl), Math.abs(yr)); if (pk > this.peak) this.peak = pk;
      if (1 - this.g > this.red) this.red = 1 - this.g;
    }
    if (++this.n >= 12) { this.port.postMessage({ peak: this.peak, red: this.red }); this.peak = 0; this.red = 0; this.n = 0; }
    return true;
  }
}
registerProcessor("mws-limiter", Limiter);

// 3.17: die Loop-Maschine (loops-engine.js) spielt mit denselben Instrumenten — sie lädt NACH dieser Datei in denselben
// AudioWorklet-Bereich und holt sich die Bausteine hier ab (Module teilen nur globalThis, keine Namen).
globalThis.MWS_DSP = { makeInstrument, modBlock, busy, Organ, Drums, Env, SVF, Biquad, LFO, SHAPE, lfoRate, sinp, tanh, blep, mtof, clamp, num, rnd };
